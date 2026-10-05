from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select
from .models import Plan, Subscription, Usage, now_ms
from .security import fail, lock_user

VN = ZoneInfo("Asia/Ho_Chi_Minh")
FREE = dict(
    chat_day=20,
    chat_period=200,
    characters=3,
    tts_chars=2000,
    tts_ms=120000,
    stt_ms=300000,
    recording_seconds=60,
    input_chars=2000,
    input_tokens=2048,
    output_tokens=400,
)
PREMIUM = dict(
    chat_day=50,
    chat_period=800,
    characters=20,
    tts_chars=50000,
    tts_ms=2700000,
    stt_ms=7200000,
    recording_seconds=120,
    input_chars=4000,
    input_tokens=4096,
    output_tokens=600,
)


async def active_plan(db, code):
    return (
        await db.execute(
            select(Plan)
            .where(Plan.code == code, Plan.active.is_(True))
            .order_by(Plan.created_at.desc(), Plan.id)
            .limit(1)
        )
    ).scalar_one()


async def entitlement(db, user_id, at=None):
    at = now_ms() if at is None else at
    sub = (
        await db.execute(
            select(Subscription)
            .where(
                Subscription.user_id == user_id,
                Subscription.active.is_(True),
                Subscription.starts_at <= at,
                Subscription.ends_at > at,
            )
            .order_by(Subscription.starts_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if sub:
        plan = await db.get(Plan, sub.plan_id)
        return plan, f"premium:{sub.id}", sub
    plan = await active_plan(db, "free")
    month = datetime.fromtimestamp(at / 1000, VN).strftime("%Y-%m")
    return plan, f"free:{month}", None


async def totals(db, user_id, period, kind):
    rows = (
        (
            await db.execute(
                select(Usage).where(
                    Usage.user_id == user_id,
                    Usage.period == period,
                    Usage.kind == kind,
                    (Usage.status == "committed")
                    | ((Usage.status == "reserved") & (Usage.expires_at > now_ms())),
                )
            )
        )
        .scalars()
        .all()
    )
    day = datetime.now(VN).strftime("%Y-%m-%d")
    today = (
        (
            await db.execute(
                select(Usage).where(
                    Usage.user_id == user_id,
                    Usage.kind == kind,
                    Usage.day == day,
                    (Usage.status == "committed")
                    | ((Usage.status == "reserved") & (Usage.expires_at > now_ms())),
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        "amount": sum(r.amount for r in rows),
        "secondary": sum(r.secondary for r in rows),
        "day": sum(r.amount for r in today),
        "active": sum(r.status == "reserved" for r in rows),
    }


async def reserve(db, user_id, kind, request_key, amount, secondary=0):
    await lock_user(db, user_id)
    previous = (
        await db.execute(
            select(Usage).where(
                Usage.user_id == user_id,
                Usage.kind == kind,
                Usage.request_key == request_key,
            )
        )
    ).scalar_one_or_none()
    if previous:
        return previous, False
    plan, period, _ = await entitlement(db, user_id)
    values = await totals(db, user_id, period, kind)
    q = plan.quota
    over = False
    if kind == "chat":
        over = values["amount"] + amount > q["chat_period"] or values["day"] + amount > q["chat_day"]
    elif kind == "tts":
        over = values["amount"] + amount > q["tts_chars"] or values["secondary"] + secondary > q["tts_ms"]
    elif kind == "stt":
        over = values["amount"] + amount > q["stt_ms"]
    if over:
        fail("QUOTA_REACHED", "Bạn đã đạt giới hạn sử dụng hiện tại.", 429)
    active = await db.scalar(
        select(Usage.id)
        .where(
            Usage.user_id == user_id,
            Usage.kind == kind,
            Usage.status == "reserved",
            Usage.expires_at > now_ms(),
        )
        .limit(1)
    )
    if active:
        fail("REQUEST_ACTIVE", "Một yêu cầu đang được xử lý. Vui lòng đợi hoặc dừng yêu cầu đó.", 409)
    usage = Usage(
        user_id=user_id,
        kind=kind,
        request_key=request_key,
        period=period,
        day=datetime.now(VN).strftime("%Y-%m-%d"),
        amount=amount,
        secondary=secondary,
        expires_at=now_ms() + 120000,
    )
    db.add(usage)
    await db.flush()
    return usage, True


async def finish(factory, usage_id, *, success, amount=None, secondary=None, provider_usage=None):
    async with factory() as db:
        row = await db.get(Usage, usage_id, with_for_update=True)
        if not row or row.status != "reserved":
            return
        row.status = "committed" if success else "released"
        if amount is not None:
            row.amount = amount
        if secondary is not None:
            row.secondary = secondary
        if provider_usage is not None:
            row.provider_usage = provider_usage
        await db.commit()


async def admin_usage(db, user_id):
    plan, period, sub = await entitlement(db, user_id)
    return {
        "plan": plan.code,
        "period": period,
        "limits": plan.quota,
        "chat": await totals(db, user_id, period, "chat"),
        "tts": await totals(db, user_id, period, "tts"),
        "stt": await totals(db, user_id, period, "stt"),
        "ends_at": sub.ends_at if sub else None,
    }
