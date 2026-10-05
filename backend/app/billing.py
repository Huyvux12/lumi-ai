import hashlib
import hmac
import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode
from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from .models import Order, PaymentEvent, Subscription, now_ms
from .quotas import VN, active_plan
from .security import fail, lock_user


def month_at(anchor_ms: int, period_index: int):
    anchor = datetime.fromtimestamp(anchor_ms / 1000, VN)
    return int((anchor + relativedelta(months=period_index)).timestamp() * 1000)


def qr_url(settings, invoice, amount):
    return "https://vietqr.app/img?" + urlencode(
        {"acc": settings.bank_account, "bank": settings.bank_code, "amount": amount, "des": invoice}
    )


def order_view(order, settings):
    status = "expired" if order.status == "pending" and order.expires_at <= now_ms() else order.status
    return {
        "id": order.id,
        "invoice": order.invoice,
        "amount_vnd": order.amount_vnd,
        "status": status,
        "created_at": order.created_at,
        "expires_at": order.expires_at,
        "paid_at": order.paid_at,
        "qr_url": qr_url(settings, order.invoice, order.amount_vnd),
        "bank": settings.bank_code,
        "account": settings.bank_account,
        "holder": settings.bank_holder,
        "environment": order.environment,
    }


async def create_order(db, settings, user, key):
    if not all((settings.bank_code, settings.bank_account, settings.bank_holder, settings.sepay_secret)):
        fail("BILLING_UNAVAILABLE", "Thanh toán chưa được cấu hình.", 503)
    await lock_user(db, user.id)
    request_key = f"{user.id}:{key}"
    existing = (await db.execute(select(Order).where(Order.request_key == request_key))).scalar_one_or_none()
    if existing:
        return existing
    plan = await active_plan(db, "premium")
    order = Order(
        user_id=user.id,
        invoice=settings.payment_prefix.upper() + secrets.token_hex(8).upper(),
        request_key=request_key,
        plan_id=plan.id,
        amount_vnd=plan.price_vnd,
        environment=settings.sepay_environment,
        expires_at=now_ms() + 900000,
    )
    db.add(order)
    await db.flush()
    return order


def authenticate_webhook(settings, raw, signature, timestamp):
    if not settings.sepay_secret:
        fail("BILLING_UNAVAILABLE", "Webhook chưa được cấu hình.", 503)
    try:
        at = int(timestamp)
    except (ValueError, TypeError):
        fail("INVALID_SIGNATURE", "Webhook không hợp lệ.", 401)
    if abs(now_ms() // 1000 - at) > 300:
        fail("INVALID_SIGNATURE", "Webhook đã hết hạn xác thực.", 401)
    signed = str(at).encode() + b"." + raw
    expected = "sha256=" + hmac.new(settings.sepay_secret.encode(), signed, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        fail("INVALID_SIGNATURE", "Webhook không hợp lệ.", 401)


def _account_matches(settings, payload):
    expected = str(settings.bank_account)
    reported = {
        str(payload.get("accountNumber") or ""),
        str(payload.get("subAccount") or ""),
        str(payload.get("va") or ""),
    }
    return bool(expected) and expected in reported


def payment_key(settings, payload):
    # v2 lookup IDs are UUIDs; bank webhook IDs can be integers. Prefer the shared bank reference.
    ref = payload.get("referenceCode")
    suffix = (
        "ref:" + hashlib.sha256(str(ref).strip().upper().encode()).hexdigest()
        if ref
        else str(payload.get("id"))
    )
    return f"{settings.sepay_environment}:{settings.bank_account}:{suffix}"


async def apply_payment(db, settings, payload):
    transaction = payload.get("id")
    if isinstance(transaction, bool) or not isinstance(transaction, (str, int)) or not str(transaction):
        fail("INVALID_EVENT", "Giao dịch thiếu ID.", 422)
    if len(str(transaction)) > 60:
        fail("INVALID_EVENT", "ID giao dịch không hợp lệ.", 422)
    key = payment_key(settings, payload)
    existing = await db.get(PaymentEvent, key)
    if existing:
        return existing
    # Match only exact standalone transfer identifiers, never a substring/fuzzy match.
    pattern = r"(?<![A-Z0-9])" + re.escape(settings.payment_prefix.upper()) + r"[A-F0-9]{16}(?![A-Z0-9])"
    found = set(
        re.findall(
            pattern, str(payload.get("code") or "").upper() + " " + str(payload.get("content") or "").upper()
        )
    )
    order = None
    if len(found) == 1:
        order = (
            await db.execute(select(Order).where(Order.invoice == next(iter(found))))
        ).scalar_one_or_none()
    if order:
        await lock_user(db, order.user_id)
        # Another process may have committed the event while this request waited for the user row.
        existing = await db.get(PaymentEvent, key, populate_existing=True)
        if existing:
            return existing
        await db.refresh(order)
    amount = None
    try:
        value = Decimal(str(payload.get("transferAmount")))
        if value.is_finite() and value == value.to_integral_value():
            amount = int(value)
    except (InvalidOperation, ValueError):
        pass
    reason = ""
    if payload.get("transferType") != "in":
        reason = "not_incoming"
    elif not _account_matches(settings, payload):
        reason = "wrong_account"
    elif not order or order.environment != settings.sepay_environment:
        reason = "unknown_invoice"
    elif amount != order.amount_vnd:
        reason = "amount_mismatch"
    elif order.status == "paid":
        reason = "second_transfer"
    elif order.status not in {"pending", "expired", "cancelled", "review"}:
        reason = "order_not_payable"
    event = PaymentEvent(
        key=key,
        order_id=order.id if order else None,
        payload=payload,
        status="review" if reason else "applied",
        reason=reason,
    )
    db.add(event)
    if not reason:
        last = (
            await db.execute(
                select(Subscription)
                .where(
                    Subscription.user_id == order.user_id,
                    Subscription.active.is_(True),
                    Subscription.ends_at > now_ms(),
                )
                .order_by(Subscription.ends_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        at = now_ms()
        anchor = last.anchor_at if last else at
        index = last.period_index + 1 if last else 1
        db.add(
            Subscription(
                user_id=order.user_id,
                order_id=order.id,
                plan_id=order.plan_id,
                starts_at=last.ends_at if last else at,
                ends_at=month_at(anchor, index),
                anchor_at=anchor,
                period_index=index,
            )
        )
        order.status, order.paid_at = "paid", at
    elif order and reason != "second_transfer":
        order.status = "review"
    await db.flush()
    return event
