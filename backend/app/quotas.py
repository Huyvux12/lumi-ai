import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select, update
from .models import Plan, Subscription, Usage, User, now_ms
from .plan_access import WAITLIST_MESSAGE, waiting
from .plan_catalog import FREE, PREMIUM  # noqa: F401  re-exported for existing imports
from .security import fail, lock_user

VN = ZoneInfo("Asia/Ho_Chi_Minh")
LEASE_MS = 120000
LEASE_HEARTBEAT_SECONDS = 20


class UsageExpired(RuntimeError):
    pass


@asynccontextmanager
async def usage_lease(factory, usage_id):
    """Renew independently of provider chunks; losing the lease stops its owner."""
    owner = asyncio.current_task()
    lost = False

    async def renew():
        at = now_ms()
        async with factory() as db:
            result = await db.execute(
                update(Usage).where(
                    Usage.id == usage_id, Usage.status == "reserved", Usage.expires_at > at
                ).values(expires_at=at + LEASE_MS)
            )
            await db.commit()
            if result.rowcount != 1:
                raise UsageExpired("Usage lease expired")

    try:
        await renew()
    except UsageExpired:
        fail("REQUEST_EXPIRED", "Yêu cầu đã hết hạn. Vui lòng thử lại.", 409)

    async def heartbeat():
        nonlocal lost
        try:
            while True:
                await asyncio.sleep(LEASE_HEARTBEAT_SECONDS)
                if owner.done():
                    # A response can fail before its suspended iterator is closed.
                    # Never keep an abandoned reservation alive indefinitely.
                    return
                await renew()
        except asyncio.CancelledError:
            raise
        except Exception:
            lost = True
            owner.cancel()

    task = asyncio.create_task(heartbeat())
    try:
        yield
    except asyncio.CancelledError:
        if lost:
            fail("REQUEST_EXPIRED", "Yêu cầu đã dừng. Vui lòng thử lại.", 409)
        raise
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


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
    user = await db.get(User, user_id)
    if not user:
        fail("AUTH_REQUIRED", "Vui lòng đăng nhập để tiếp tục.", 401)
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
        return plan, f"{plan.code}:{sub.id}", sub
    # Legacy "premium" sign-ups without a paid period fall back to Free like everyone else.
    plan = await active_plan(db, "free")
    month = datetime.fromtimestamp(at / 1000, VN).strftime("%Y-%m")
    return plan, f"free:{month}", None


async def feature_entitlement(db, user_id):
    plan, period, sub = await entitlement(db, user_id)
    user = await db.get(User, user_id)
    if await waiting(db, user, plan):
        fail("PLAN_CLOSED", WAITLIST_MESSAGE, 403)
    if user.waitlisted and not sub:
        # Free reopened: release the hold for good.
        user.waitlisted = False
    return plan, period, sub


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
    plan, period, _ = await feature_entitlement(db, user_id)
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
        expires_at=now_ms() + LEASE_MS,
    )
    db.add(usage)
    await db.flush()
    return usage, True


async def finish(factory, usage_id, *, success, amount=None, secondary=None, provider_usage=None):
    async with factory() as db:
        row = await db.get(Usage, usage_id, with_for_update=True)
        if not row or row.status != "reserved":
            if success:
                fail("REQUEST_EXPIRED", "Yêu cầu đã dừng. Vui lòng thử lại.", 409)
            return
        if success and row.expires_at <= now_ms():
            fail("REQUEST_EXPIRED", "Yêu cầu đã hết hạn. Vui lòng thử lại.", 409)
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
        "plan": plan.code if plan else None,
        "period": period,
        "limits": plan.quota if plan else {},
        "chat": await totals(db, user_id, period, "chat"),
        "tts": await totals(db, user_id, period, "tts"),
        "stt": await totals(db, user_id, period, "stt"),
        "ends_at": sub.ends_at if sub else None,
    }
