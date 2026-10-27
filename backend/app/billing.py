import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode
from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from .models import Order, PaymentEvent, Plan, Subscription, now_ms
from .plan_catalog import plan_label, plan_rank
from .quotas import VN, active_plan
from .plan_access import require_plan_open
from .security import fail, lock_user


def month_at(anchor_ms: int, period_index: int):
    anchor = datetime.fromtimestamp(anchor_ms / 1000, VN)
    return int((anchor + relativedelta(months=period_index)).timestamp() * 1000)


def qr_url(settings, invoice, amount):
    return "https://vietqr.app/img?" + urlencode(
        {"acc": settings.bank_account, "bank": settings.bank_code, "amount": amount, "des": invoice}
    )


def order_status(order):
    return "expired" if order.status == "pending" and order.expires_at <= now_ms() else order.status


def matches_invoice(invoice, content):
    return bool(re.search(r"(?<![A-Z0-9])" + re.escape(invoice) + r"(?![A-Z0-9])", content.upper()))


def sepay_transaction_payload(transaction):
    """Translate SePay v2 lookup rows to the webhook schema, including virtual accounts."""
    return {
        "id": transaction.get("id"),
        "accountNumber": transaction.get("account_number"),
        "subAccount": transaction.get("va") or "",
        "content": str(transaction.get("transaction_content") or ""),
        "code": transaction.get("code"),
        "referenceCode": transaction.get("reference_number"),
        "transferType": transaction.get("transfer_type"),
        "transferAmount": transaction.get("amount_in"),
    }


def order_view(order, settings, code=None):
    return {
        "id": order.id,
        "plan": code,
        "plan_label": plan_label(code) if code else None,
        "credit_vnd": order.credit_vnd,
        "source": order.source,
        "invoice": order.invoice,
        "amount_vnd": order.amount_vnd,
        "list_price_vnd": order.list_price_vnd,
        "discount_percent": order.discount_percent,
        "promo_code": order.promo_code,
        "status": order_status(order),
        "created_at": order.created_at,
        "expires_at": order.expires_at,
        "paid_at": order.paid_at,
        "qr_url": qr_url(settings, order.invoice, order.amount_vnd),
        "bank": settings.bank_code,
        "account": settings.bank_account,
        "holder": settings.bank_holder,
        "environment": order.environment,
    }


async def open_periods(db, user_id, at):
    """Active periods not yet ended, the running one first and queued ones after."""
    return (
        (
            await db.execute(
                select(Subscription)
                .where(
                    Subscription.user_id == user_id,
                    Subscription.active.is_(True),
                    Subscription.ends_at > at,
                )
                .order_by(Subscription.starts_at)
            )
        )
        .scalars()
        .all()
    )


async def upgrade_credit(db, user_id, code, at):
    """Return (is_upgrade, credit) for buying `code` now.

    Moving to a higher tier starts immediately; the unused share of the running
    period and every queued period is credited against the new order.
    """
    periods = await open_periods(db, user_id, at)
    running = next((p for p in periods if p.starts_at <= at), None)
    if not running or plan_rank(code) <= plan_rank((await db.get(Plan, running.plan_id)).code):
        return False, 0
    credit = 0
    for period in periods:
        order = await db.get(Order, period.order_id)
        value = order.amount_vnd + order.credit_vnd if order else 0
        if period.starts_at <= at:
            value = value * (period.ends_at - at) // max(1, period.ends_at - period.starts_at)
        credit += value
    return True, credit


async def plan_quote(db, user, code, promo_code=None):
    controls = await require_plan_open(db, code)
    plan = await active_plan(db, code)
    promo = promo_code.strip().upper() if promo_code else None
    if promo and promo not in controls.promo_codes:
        fail("INVALID_PROMO_CODE", "Mã giảm giá không hợp lệ hoặc đã hết hiệu lực.", 422)
    percent = controls.discount_percent if promo else 0
    price = (plan.price_vnd * (100 - percent) + 50) // 100
    upgrade, credit = await upgrade_credit(db, user.id, code, now_ms()) if user else (False, 0)
    # Credit is rounded down to whole thousands so the transfer amount stays readable.
    credit = min(credit // 1000 * 1000, price)
    return plan, upgrade, {
        "list_price_vnd": plan.price_vnd,
        "discount_percent": percent,
        "promo_code": promo,
        "credit_vnd": credit,
        "amount_vnd": price - credit,
    }


async def create_order(db, settings, user, key, promo_code=None, code="premium"):
    await require_plan_open(db, code)
    await lock_user(db, user.id)
    request_key = f"{user.id}:{key}"
    existing = (await db.execute(select(Order).where(Order.request_key == request_key))).scalar_one_or_none()
    if existing:
        if existing.promo_code != (promo_code.strip().upper() if promo_code else None):
            fail("KEY_CONFLICT", "Mã yêu cầu đã dùng với mã giảm giá khác.", 409)
        if (await db.get(Plan, existing.plan_id)).code != code:
            fail("KEY_CONFLICT", "Mã yêu cầu đã dùng cho gói khác.", 409)
        return existing
    plan, _, quote = await plan_quote(db, user, code, promo_code)
    if quote["amount_vnd"] and not all(
        (settings.bank_code, settings.bank_account, settings.bank_holder, settings.sepay_secret)
    ):
        fail("BILLING_UNAVAILABLE", "Thanh toán chưa được cấu hình.", 503)
    order = Order(
        user_id=user.id,
        invoice=settings.payment_prefix.upper() + secrets.token_hex(8).upper(),
        request_key=request_key,
        plan_id=plan.id,
        **quote,
        environment=settings.sepay_environment,
        expires_at=now_ms() + 900000,
    )
    db.add(order)
    await db.flush()
    if order.amount_vnd == 0:
        await activate_order(db, order)
    return order


async def activate_order(db, order):
    """Grant the snapshotted period, including a legitimate 100% promo redemption.

    A same or lower tier queues after the last paid period. A higher tier replaces
    the running and queued periods from now; their value was credited on the order.
    """
    at = now_ms()
    code = (await db.get(Plan, order.plan_id)).code
    periods = await open_periods(db, order.user_id, at)
    running = next((p for p in periods if p.starts_at <= at), None)
    last = max(periods, key=lambda p: p.ends_at) if periods else None
    if running and plan_rank(code) > plan_rank((await db.get(Plan, running.plan_id)).code):
        for period in periods:
            if period.starts_at <= at:
                period.ends_at = at
            else:
                period.active = False
        last = None
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
        # Python accepts NaN/Infinity in JSON, but PostgreSQL rejects those numeric
        # tokens. Preserve them as audit strings after the amount validation above.
        payload=json.loads(json.dumps(payload), parse_constant=str),
        status="review" if reason else "applied",
        reason=reason,
    )
    db.add(event)
    if not reason:
        await activate_order(db, order)
    elif order and reason != "second_transfer":
        order.status = "review"
    await db.flush()
    return event
