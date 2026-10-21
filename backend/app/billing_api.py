import json
from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .billing import apply_payment, authenticate_webhook, create_order, order_view, payment_key, plan_quote
from .models import Order, Plan, PlanSettings, Subscription
from .plan_access import access_view, closed_message
from .plan_catalog import PAID_CODES, PLANS, plan_label, plan_rank
from .schemas import OrderInput
from .quotas import entitlement
from .security import db_session, fail, require_user

router = APIRouter()


@router.get("/plans")
async def plans(db=Depends(db_session)):
    settings = {row.code: row for row in (await db.execute(select(PlanSettings))).scalars()}
    rows = {
        p.code: p
        for p in (await db.execute(select(Plan).where(Plan.active.is_(True)))).scalars()
        if p.code in PLANS and p.code in settings
    }
    return [
        {
            "code": code,
            "label": tier["label"],
            "rank": plan_rank(code),
            "price_vnd": rows[code].price_vnd,
            "duration": "1 tháng" if code in PAID_CODES else None,
            "description": tier["description"],
            "enabled": settings[code].enabled,
            "discount_percent": settings[code].discount_percent,
            "closed_message": closed_message(code) if not settings[code].enabled else None,
        }
        for code, tier in PLANS.items()
        if code in rows
    ]


@router.post("/billing/quote")
async def quote(body: OrderInput, user=Depends(require_user), db=Depends(db_session)):
    _, upgrade, result = await plan_quote(db, user, body.plan, body.promo_code)
    return {"plan": body.plan, "upgrade": upgrade, **result}


@router.post("/billing/orders")
async def order(
    request: Request,
    idempotency_key: str = Header(min_length=8, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
    body: OrderInput | None = None,
):
    await request.app.state.limiter.check(f"order:{user.id}", 10)
    body = body or OrderInput()
    row = await create_order(
        db, request.app.state.settings, user, idempotency_key, body.promo_code, body.plan
    )
    await db.commit()
    return order_view(row, request.app.state.settings, body.plan)


@router.get("/billing/orders/{ident}")
async def get_order(ident: str, request: Request, user=Depends(require_user), db=Depends(db_session)):
    row = await db.get(Order, ident)
    if not row or row.user_id != user.id:
        fail("NOT_FOUND", "Không tìm thấy đơn thanh toán.", 404)
    plan = await db.get(Plan, row.plan_id)
    return order_view(row, request.app.state.settings, plan.code if plan else None)


@router.get("/billing/history")
async def history(request: Request, user=Depends(require_user), db=Depends(db_session)):
    rows = await db.execute(
        select(Order, Plan.code)
        .join(Plan, Plan.id == Order.plan_id)
        .where(Order.user_id == user.id)
        .order_by(Order.created_at.desc())
        .limit(100)
    )
    return [order_view(row, request.app.state.settings, code) for row, code in rows]


@router.get("/billing/subscription")
async def subscription(user=Depends(require_user), db=Depends(db_session)):
    plan, _, sub = await entitlement(db, user.id)
    last = (
        await db.execute(
            select(Subscription)
            .where(Subscription.user_id == user.id, Subscription.active.is_(True))
            .order_by(Subscription.ends_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {
        "plan": plan.code if plan else None,
        "plan_label": plan_label(plan.code) if plan else None,
        **await access_view(db, user, plan),
        "ends_at": sub.ends_at if sub else None,
        "paid_until": last.ends_at if last else None,
    }


@router.post("/payments/sepay/webhook")
async def webhook(request: Request, db=Depends(db_session)):
    raw = await request.body()
    authenticate_webhook(
        request.app.state.settings,
        raw,
        request.headers.get("X-SePay-Signature"),
        request.headers.get("X-SePay-Timestamp"),
    )
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        fail("INVALID_EVENT", "Dữ liệu webhook không hợp lệ.", 422)
    if not isinstance(payload, dict):
        fail("INVALID_EVENT", "Dữ liệu webhook không hợp lệ.", 422)
    try:
        await apply_payment(db, request.app.state.settings, payload)
        await db.commit()
    except IntegrityError:
        # PostgreSQL uniqueness is the final fence against concurrent duplicate delivery.
        await db.rollback()
        key = payment_key(request.app.state.settings, payload)
        from .models import PaymentEvent

        if not await db.get(PaymentEvent, key):
            raise
    return {"success": True}
