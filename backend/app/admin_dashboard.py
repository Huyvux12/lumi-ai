"""Bounded dashboard aggregates. Dates use Vietnam time on SQLite and PostgreSQL."""

from datetime import date, datetime, time, timedelta

from sqlalchemy import case, func, select

from .models import Audit, Character, Feedback, Order, PaymentEvent, Report, Subscription, Usage, User, now_ms
from .quotas import VN

DAY_MS = 86400000
VN_OFFSET_MS = 7 * 3600000
MODERATION_ACTIONS = ("character.moderate", "catalog.update", "scene.create", "scene.update", "report.close")


def local_day(column):
    # Integer division keeps SQLite/PostgreSQL buckets identical (no rounding casts).
    return (column + VN_OFFSET_MS) // DAY_MS


async def queue_counts(db):
    return {
        "characters_pending": await db.scalar(
            select(func.count())
            .select_from(Character)
            .where(
                Character.visibility == "public",
                Character.status == "pending",
            )
        ),
        "reports_open": await db.scalar(
            select(func.count()).select_from(Report).where(Report.status == "open")
        ),
    }


async def recent_activity(db, moderation=False):
    query = select(Audit.id, Audit.action, Audit.target, Audit.created_at, User.username).outerjoin(
        User,
        User.id == Audit.actor_id,
    )
    if moderation:
        query = query.where(Audit.action.in_(MODERATION_ACTIONS))
    rows = (await db.execute(query.order_by(Audit.created_at.desc(), Audit.id.desc()).limit(8))).all()
    # Detailed audit payloads can contain personal data; overview only needs metadata.
    return [
        {
            "id": row.id,
            "action": row.action,
            "target": row.target,
            "created_at": row.created_at,
            "actor": row.username,
        }
        for row in rows
    ]


async def moderation_dashboard(db):
    return {
        "scope": "moderation",
        "generated_at": now_ms(),
        "queue": await queue_counts(db),
        "activity": await recent_activity(db, moderation=True),
    }


async def dashboard(db, settings, days):
    at = now_ms()
    today = datetime.fromtimestamp(at / 1000, VN).date()
    start_date = today - timedelta(days=days - 1)
    start = int(datetime.combine(start_date, time.min, VN).timestamp() * 1000)
    previous_start = start - days * DAY_MS
    end = at + 1
    epoch = date(1970, 1, 1)
    series = {
        (start_date + timedelta(days=i)).isoformat(): {
            "date": (start_date + timedelta(days=i)).isoformat(),
            "revenue_vnd": 0,
            "chat_turns": 0,
            "stt_requests": 0,
            "tts_requests": 0,
        }
        for i in range(days)
    }

    def order_window(lower, upper):
        return [
            Order.environment == settings.sepay_environment,
            Order.status == "paid",
            Order.paid_at >= lower,
            Order.paid_at < upper,
        ]

    order_day = local_day(Order.paid_at)
    revenue_rows = (
        await db.execute(
            select(
                order_day.label("day"),
                func.sum(Order.amount_vnd).label("amount"),
            )
            .where(*order_window(start, end))
            .group_by(order_day)
        )
    ).all()
    for row in revenue_rows:
        series[(epoch + timedelta(days=int(row.day))).isoformat()]["revenue_vnd"] = int(row.amount)

    committed = Usage.status == "committed"
    chat = (Usage.kind == "chat") & committed
    stt = (Usage.kind == "stt") & committed
    tts = (Usage.kind == "tts") & committed
    llm = Usage.kind.in_(("chat", "admin_test"))
    usage_day = local_day(Usage.created_at)
    usage_rows = (
        await db.execute(
            select(
                usage_day.label("day"),
                func.sum(case((chat, Usage.amount), else_=0)).label("chat_turns"),
                func.sum(case((stt, 1), else_=0)).label("stt_requests"),
                func.sum(case((tts, 1), else_=0)).label("tts_requests"),
                func.sum(case((stt, Usage.amount), else_=0)).label("stt_ms"),
                func.sum(case((tts, Usage.secondary), else_=0)).label("tts_ms"),
                func.sum(case((Usage.status == "released", 1), else_=0)).label("released_requests"),
                func.sum(
                    case((llm, func.coalesce(Usage.provider_usage["prompt_tokens"].as_integer(), 0)), else_=0)
                ).label("input_tokens"),
                func.sum(
                    case(
                        (llm, func.coalesce(Usage.provider_usage["completion_tokens"].as_integer(), 0)),
                        else_=0,
                    )
                ).label("output_tokens"),
            )
            .where(Usage.created_at >= start, Usage.created_at < end)
            .group_by(usage_day)
        )
    ).all()
    usage = {
        key: 0
        for key in (
            "chat_turns",
            "stt_requests",
            "tts_requests",
            "stt_ms",
            "tts_ms",
            "released_requests",
            "input_tokens",
            "output_tokens",
        )
    }
    for row in usage_rows:
        day = series[(epoch + timedelta(days=int(row.day))).isoformat()]
        for key in usage:
            value = int(getattr(row, key))
            usage[key] += value
            if key in day:
                day[key] = value
    usage["llm_estimated_usd"] = round(
        (usage["input_tokens"] * 0.8 + usage["output_tokens"] * 4) / 1000000, 4
    )

    async def new_users(lower, upper):
        return await db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= lower, User.created_at < upper)
        )

    async def active_users(lower, upper):
        return await db.scalar(
            select(func.count(func.distinct(Usage.user_id))).where(
                Usage.created_at >= lower,
                Usage.created_at < upper,
                committed,
                Usage.kind.in_(("chat", "stt", "tts")),
            )
        )

    queue = await queue_counts(db)
    queue["feedback_new"] = await db.scalar(
        select(func.count()).select_from(Feedback).where(Feedback.status == "new")
    )
    queue["payments_review"] = await db.scalar(
        select(func.count())
        .select_from(PaymentEvent)
        .where(
            PaymentEvent.status == "review",
            PaymentEvent.key.startswith(settings.sepay_environment + ":"),
        )
    )
    metrics = {
        "revenue_vnd": sum(day["revenue_vnd"] for day in series.values()),
        "new_users": await new_users(start, end),
        "active_users": await active_users(start, end),
        "total_users": await db.scalar(select(func.count()).select_from(User)),
        "premium_users": await db.scalar(
            select(func.count(func.distinct(Subscription.user_id))).where(
                Subscription.active.is_(True),
                Subscription.starts_at <= at,
                Subscription.ends_at > at,
            )
        ),
    }
    previous = {
        "revenue_vnd": int(
            await db.scalar(
                select(func.coalesce(func.sum(Order.amount_vnd), 0)).where(
                    *order_window(previous_start, start),
                )
            )
        ),
        "new_users": await new_users(previous_start, start),
        "active_users": await active_users(previous_start, start),
    }
    return {
        "scope": "admin",
        "generated_at": at,
        "period": {
            "days": days,
            "start": start_date.isoformat(),
            "end": today.isoformat(),
            "timezone": "Asia/Ho_Chi_Minh",
        },
        "metrics": metrics,
        "previous": previous,
        "series": list(series.values()),
        "usage": usage,
        "queue": queue,
        "activity": await recent_activity(db),
        "services": {
            "groq": bool(settings.groq_key),
            "tts": bool(settings.google_key)
            if settings.tts_auth_mode == "api_key"
            else bool(settings.tts_project)
            if settings.tts_auth_mode == "adc"
            else False,
            "sepay": all(
                (settings.sepay_secret, settings.bank_account, settings.bank_code, settings.bank_holder)
            ),
            "sepay_environment": settings.sepay_environment,
            "demo_llm": settings.demo_llm,
        },
    }
