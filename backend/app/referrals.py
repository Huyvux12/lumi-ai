"""Invite codes: a 7-day Basic trial for the invitee, a free Basic month per three qualified invites.

An invite qualifies once the invitee has verified their email and completed one chat turn.
Gifted periods are 0đ orders with their own `source`, so they never count as revenue or as
paying users.
"""

import secrets
from datetime import timedelta
from sqlalchemy import func, select
from .billing import activate_order, open_periods
from .models import Order, Subscription, Usage, User, now_ms
from .quotas import active_plan
from .security import lock_user

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 7
TRIAL_DAYS = 7
INVITES_PER_REWARD = 3
MAX_REWARDS = 3
GIFT_SOURCES = ("referral_trial", "referral_reward")


def random_code():
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


async def new_invite_code(db):
    while True:
        code = random_code()
        if not await db.scalar(select(User.id).where(User.invite_code == code)):
            return code


def normalize(code):
    return (code or "").strip().upper() or None


async def inviter_for(db, code):
    code = normalize(code)
    if not code:
        return None
    return (
        await db.execute(select(User).where(User.invite_code == code, User.active.is_(True)))
    ).scalar_one_or_none()


async def ensure_invite_code(db, user):
    if not user.invite_code:
        user.invite_code = await new_invite_code(db)
        await db.flush()
    return user.invite_code


async def grant_period(db, settings, user_id, code, source, key, days=None):
    """Grant a gifted period once per (user, key). Returns the order, or None if already granted."""
    request_key = f"{user_id}:{key}"
    if await db.scalar(select(Order.id).where(Order.request_key == request_key)):
        return None
    plan = await active_plan(db, code)
    at = now_ms()
    order = Order(
        user_id=user_id,
        invoice="GIFT" + secrets.token_hex(8).upper(),
        request_key=request_key,
        plan_id=plan.id,
        amount_vnd=0,
        list_price_vnd=plan.price_vnd,
        discount_percent=100,
        promo_code=source.upper()[:32],
        source=source,
        environment=settings.sepay_environment,
        expires_at=at,
    )
    db.add(order)
    await db.flush()
    if days is None:
        # A month, queued after any paid period exactly like a renewal.
        await activate_order(db, order)
    else:
        # A short trial never pre-empts a period the user already has; it waits for it to end.
        periods = await open_periods(db, user_id, at)
        start = max([at, *(p.ends_at for p in periods)])
        db.add(
            Subscription(
                user_id=user_id,
                order_id=order.id,
                plan_id=plan.id,
                starts_at=start,
                ends_at=start + int(timedelta(days=days).total_seconds() * 1000),
                anchor_at=start,
                period_index=1,
            )
        )
        order.status, order.paid_at = "paid", at
    await db.flush()
    return order


async def grant_trial(db, settings, user):
    if user.referred_by:
        return await grant_period(db, settings, user.id, "basic", "referral_trial", "referral-trial", TRIAL_DAYS)
    return None


async def qualified_count(db, inviter_id):
    return await db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.referred_by == inviter_id, User.referral_qualified_at.is_not(None))
    )


async def rewards_granted(db, user_id):
    return await db.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.user_id == user_id, Order.source == "referral_reward")
    )


async def maybe_qualify(db, settings, user_id):
    """Count the invite once its user is verified and has chatted; reward the inviter per three."""
    user = await db.get(User, user_id)
    if not user or not user.referred_by or user.referral_qualified_at or not user.email_verified:
        return False
    chatted = await db.scalar(
        select(Usage.id).where(Usage.user_id == user_id, Usage.kind == "chat", Usage.status == "committed").limit(1)
    )
    if not chatted:
        return False
    inviter = await lock_user(db, user.referred_by)
    await db.refresh(user)
    if user.referral_qualified_at:
        return False
    user.referral_qualified_at = now_ms()
    await db.flush()
    earned = min(await qualified_count(db, inviter.id) // INVITES_PER_REWARD, MAX_REWARDS)
    for n in range(await rewards_granted(db, inviter.id) + 1, earned + 1):
        await grant_period(db, settings, inviter.id, "basic", "referral_reward", f"referral-reward-{n}")
    return True


async def invite_summary(db, settings, user):
    code = await ensure_invite_code(db, user)
    invited = await db.scalar(select(func.count()).select_from(User).where(User.referred_by == user.id))
    qualified = await qualified_count(db, user.id)
    granted = await rewards_granted(db, user.id)
    remaining = (
        0 if granted >= MAX_REWARDS else INVITES_PER_REWARD - qualified % INVITES_PER_REWARD
    )
    return {
        "code": code,
        "link": f"{settings.public_url.rstrip('/')}/i/{code}",
        "invited": invited,
        "qualified": qualified,
        "rewards_granted": granted,
        "rewards_max": MAX_REWARDS,
        "invites_per_reward": INVITES_PER_REWARD,
        "remaining_to_next": remaining,
        "trial_days": TRIAL_DAYS,
    }
