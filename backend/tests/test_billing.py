import asyncio
import hashlib
import hmac
import json
import time
from datetime import datetime
from sqlalchemy import func, select
from app.models import Order, PaymentEvent, Subscription, User, Plan
from app.billing import apply_payment, month_at
from app.quotas import VN
from conftest import register


async def order(client, key="buy-first-123"):
    response = await client.post("/api/v1/billing/orders", headers={"Idempotency-Key": key})
    assert response.status_code == 200, response.text
    return response.json()


def payload(o, **changes):
    return {
        "id": 92704,
        "accountNumber": "123456789",
        "content": "Thanh toan " + o["invoice"],
        "transferType": "in",
        "transferAmount": 250000,
        **changes,
    }


async def webhook(client, cfg, event, signature=None, at=None):
    raw = json.dumps(event, ensure_ascii=False).encode()
    at = at if at is not None else int(time.time())
    signed = str(at).encode() + b"." + raw
    signature = (
        signature or "sha256=" + hmac.new(cfg.sepay_secret.encode(), signed, hashlib.sha256).hexdigest()
    )
    return await client.post(
        "/api/v1/payments/sepay/webhook",
        content=raw,
        headers={"X-SePay-Signature": signature, "X-SePay-Timestamp": str(at)},
    )


async def test_qr_idempotence_signature_and_duplicate_delivery(env):
    app, client, cfg = env
    user = await register(client)
    first = await order(client)
    second = await order(client)
    assert first["id"] == second["id"]
    assert (
        first["amount_vnd"] == 250000
        and "vietqr.app/img?" in first["qr_url"]
        and first["invoice"] in first["qr_url"]
    )
    assert (await webhook(client, cfg, payload(first), signature="sha256=wrong")).status_code == 401
    assert (await webhook(client, cfg, payload(first), at=int(time.time()) - 301)).status_code == 401
    results = await asyncio.gather(*[webhook(client, cfg, payload(first)) for _ in range(5)])
    assert all(r.status_code == 200 and r.json() == {"success": True} for r in results)
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(PaymentEvent)) == 1
        subs = (await db.execute(select(Subscription))).scalars().all()
        assert len(subs) == 1 and subs[0].ends_at == month_at(subs[0].starts_at, 1)
    status = (await client.get("/api/v1/billing/orders/" + first["id"])).json()
    assert status["status"] == "paid"
    assert (await client.get("/api/v1/billing/subscription")).json()["plan"] == "premium"
    assert (await webhook(client, cfg, payload(first, id=92705))).status_code == 200
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 1
        event = await db.get(PaymentEvent, "test:123456789:92705")
        assert event.reason == "second_transfer"


import pytest


@pytest.mark.parametrize(
    "changes",
    [
        {"transferAmount": 249999},
        {"transferAmount": 250001},
        {"transferType": "out"},
        {"accountNumber": "wrong"},
        {"content": "UNKNOWN"},
        {"content": "XLUMI0000000000000000X"},
        {"transferAmount": float("inf")},
    ],
)
async def test_invalid_payment_never_activates(env, changes):
    app, client, cfg = env
    await register(client)
    o = await order(client)
    response = await webhook(client, cfg, payload(o, **changes))
    assert response.status_code == 200
    assert (await client.get("/api/v1/billing/subscription")).json()["plan"] == "free"
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 0


def test_original_month_anchor():
    january = int(datetime(2027, 1, 31, 10, 30, tzinfo=VN).timestamp() * 1000)
    assert datetime.fromtimestamp(month_at(january, 1) / 1000, VN).day == 28
    assert datetime.fromtimestamp(month_at(january, 2) / 1000, VN).day == 31
    leap = int(datetime(2028, 1, 31, 10, 30, tzinfo=VN).timestamp() * 1000)
    assert datetime.fromtimestamp(month_at(leap, 1) / 1000, VN).day == 29


async def test_early_renewal_keeps_current_period_and_snapshot(env):
    app, client, cfg = env
    await register(client)
    first = await order(client)
    await webhook(client, cfg, payload(first))
    old = (await client.get("/api/v1/billing/subscription")).json()
    second = await order(client, "buy-second-123")
    await webhook(client, cfg, payload(second, id=92706))
    new = (await client.get("/api/v1/billing/subscription")).json()
    assert new["ends_at"] == old["ends_at"] and new["paid_until"] > old["paid_until"]
    async with app.state.db() as db:
        rows = (await db.execute(select(Subscription).order_by(Subscription.period_index))).scalars().all()
        assert rows[1].starts_at == rows[0].ends_at and rows[1].anchor_at == rows[0].anchor_at
        assert rows[1].ends_at == month_at(rows[0].anchor_at, 2)


async def test_reconcile_v2_and_webhook_share_bank_reference(env):
    app, client, cfg = env
    from test_admin import owner
    import httpx

    await owner(app, client)
    o = await order(client)
    event = payload(o, referenceCode="FT26069ABC")
    await webhook(client, cfg, event)
    cfg.sepay_token = "test-token"

    def lookup(request):
        assert str(request.url).startswith("https://userapi-sandbox.sepay.vn/v2/transactions")
        return httpx.Response(
            200,
            json={
                "status": "success",
                "data": [
                    {
                        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                        "account_number": cfg.bank_account,
                        "transaction_content": "Thanh toan " + o["invoice"],
                        "transfer_type": "in",
                        "amount_in": 250000,
                        "reference_number": "FT26069ABC",
                    }
                ],
            },
        )

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(lookup))
    result = await client.post(
        "/api/v1/admin/orders/" + o["id"] + "/reconcile", json={"reason": "Verify bank reference"}
    )
    assert result.status_code == 200, result.text
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(PaymentEvent)) == 1
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 1
