import json
from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .billing import apply_payment, authenticate_webhook, create_order, order_view, payment_key
from .models import Order, Plan, Subscription
from .quotas import entitlement
from .security import db_session, fail, require_user

router = APIRouter()


@router.get("/plans")
async def plans(db=Depends(db_session)):
    rows = (await db.execute(select(Plan).where(Plan.active.is_(True)))).scalars()
    descriptions = {
        "free": "Khám phá nhân vật, trò chuyện và dùng thử giọng nói với giới hạn cơ bản.",
        "premium": "Mở rộng trò chuyện, tạo nhân vật và hội thoại giọng nói với giới hạn cao hơn Free.",
    }
    return [
        {
            "code": p.code,
            "price_vnd": p.price_vnd,
            "duration": "1 tháng" if p.code == "premium" else None,
            "description": descriptions[p.code],
        }
        for p in rows
    ]


@router.post("/billing/orders")
async def order(
    request: Request,
    idempotency_key: str = Header(min_length=8, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
):
    await request.app.state.limiter.check(f"order:{user.id}", 10)
    if request.app.state.settings.render_demo:
        fail("DEMO_PAYMENTS_DISABLED", "Bản demo không nhận thanh toán. Không chuyển tiền thật.", 503)
    row = await create_order(db, request.app.state.settings, user, idempotency_key)
    await db.commit()
    return order_view(row, request.app.state.settings)


@router.get("/billing/orders/{ident}")
async def get_order(ident: str, request: Request, user=Depends(require_user), db=Depends(db_session)):
    row = await db.get(Order, ident)
    if not row or row.user_id != user.id:
        fail("NOT_FOUND", "Không tìm thấy đơn thanh toán.", 404)
    return order_view(row, request.app.state.settings)


@router.get("/billing/history")
async def history(request: Request, user=Depends(require_user), db=Depends(db_session)):
    rows = (
        await db.execute(
            select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(100)
        )
    ).scalars()
    return [order_view(row, request.app.state.settings) for row in rows]


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
        "plan": plan.code,
        "ends_at": sub.ends_at if sub else None,
        "paid_until": last.ends_at if last else None,
    }


@router.post("/payments/sepay/webhook")
async def webhook(request: Request, db=Depends(db_session)):
    if request.app.state.settings.render_demo:
        fail("DEMO_PAYMENTS_DISABLED", "Thanh toán bị tắt trong bản demo.", 503)
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
