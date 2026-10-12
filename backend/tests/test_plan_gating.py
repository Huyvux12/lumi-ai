import io
import wave

import pytest
from app.models import Audit, PaymentEvent, PlanSettings, Subscription, User
from app.plan_access import FREE_CLOSED_MESSAGE, PREMIUM_CLOSED_MESSAGE
from app.quotas import admin_usage
from app.seed import seed
from conftest import conversation, register, turn
from sqlalchemy import func, select
from test_admin import owner
from test_billing import payload, webhook


async def control(app, code, **changes):
    async with app.state.db() as db:
        row = await db.get(PlanSettings, code)
        for key, value in changes.items():
            setattr(row, key, value)
        await db.commit()


def signup(plan="free", **extra):
    return {
        "email": "new@example.com",
        "username": "newuser",
        "password": "CorrectHorse123!",
        "name": "New User",
        "plan": plan,
        **extra,
    }


async def availability(client, *, code="premium", enabled=True, discount_percent=0, promo_codes=None):
    return await client.put(
        f"/api/v1/admin/plans/{code}/availability",
        json={
            "enabled": enabled,
            "discount_percent": discount_percent,
            "promo_codes": promo_codes or [],
            "reason": "Adjust signup capacity and promotion",
        },
    )


async def test_admin_availability_persists_and_remains_accessible(env):
    app, client, _ = env
    await owner(app, client)
    assert (await availability(client, code="free", enabled=False)).status_code == 200
    assert (
        await availability(client, enabled=False, discount_percent=25, promo_codes=[" welcome25 "])
    ).status_code == 200
    async with app.state.db() as db:
        await seed(db)
    plans = (await client.get("/api/v1/plans")).json()
    assert len(plans) == 2
    assert next(p for p in plans if p["code"] == "free")["closed_message"] == FREE_CLOSED_MESSAGE
    premium = next(p for p in plans if p["code"] == "premium")
    assert not premium["enabled"] and premium["discount_percent"] == 25
    assert "promo_codes" not in premium
    settings = (await client.get("/api/v1/admin/plans")).json()
    assert next(p for p in settings if p["code"] == "premium")["promo_codes"] == ["WELCOME25"]
    assert (await client.get("/api/v1/me")).status_code == 200
    assert (await client.get("/api/v1/billing/history")).status_code == 200
    async with app.state.db() as db:
        assert (
            await db.scalar(
                select(func.count()).select_from(Audit).where(Audit.action == "plan.availability")
            )
            == 2
        )


async def test_closed_free_cannot_register_even_with_omitted_plan(env):
    app, client, _ = env
    await control(app, "free", enabled=False)
    for body in (signup(), {key: value for key, value in signup().items() if key != "plan"}):
        response = await client.post("/api/v1/auth/register", json=body)
        assert response.status_code == 403
        assert response.json() == {"code": "PLAN_CLOSED", "message": FREE_CLOSED_MESSAGE}
        assert "set-cookie" not in response.headers
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 0


async def test_premium_signup_requires_payment_and_cannot_fall_back_to_free(env):
    app, client, cfg = env
    await control(app, "free", enabled=False)
    response = await client.post("/api/v1/auth/register", json=signup("premium"))
    assert response.status_code == 200
    account = response.json()
    assert account["signup_plan"] == "premium" and account["plan"] is None
    assert not account["has_plan"] and not account["can_use_features"]
    response = await client.post("/api/v1/conversations", json={"character_id": "kaito-kid"})
    assert response.status_code == 403 and response.json()["code"] == "PLAN_REQUIRED"
    assert (await client.patch("/api/v1/me", json={"signup_plan": "free"})).status_code == 422
    created = (
        await client.post("/api/v1/billing/orders", headers={"Idempotency-Key": "premium-signup-order"})
    ).json()
    assert (await webhook(client, cfg, payload(created))).status_code == 200
    account = (await client.get("/api/v1/me")).json()
    assert account["plan"] == "premium" and account["can_use_features"]
    await conversation(client)
    async with app.state.db() as db:
        sub = await db.scalar(select(Subscription))
        sub.starts_at, sub.ends_at = 0, 1
        await db.commit()
    await control(app, "free", enabled=True)
    account = (await client.get("/api/v1/me")).json()
    assert account["plan"] is None and not account["can_use_features"]
    assert (await client.post("/api/v1/conversations", json={"character_id": "kaito-kid"})).status_code == 403


async def test_free_closure_blocks_replays_cached_audio_and_all_feature_entry_points(env):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    message = await turn(client, ident)
    audio = await client.post(
        f"/api/v1/messages/{message['id']}/tts", json={}, headers={"Idempotency-Key": "cached-audio-key"}
    )
    assert audio.status_code == 200
    stream_url = audio.json()["stream_url"]
    assert (await client.get(stream_url)).status_code == 200
    await control(app, "free", enabled=False)
    me = (await client.get("/api/v1/me")).json()
    assert me["plan"] == "free" and me["has_plan"] and not me["can_use_features"]
    assert me["plan_message"] == FREE_CLOSED_MESSAGE
    wav = io.BytesIO()
    with wave.open(wav, "wb") as out:
        out.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        out.writeframes(b"\0\0" * 16000)
    requests = [
        client.post("/api/v1/conversations", json={"character_id": "kaito-kid"}),
        client.post(
            f"/api/v1/conversations/{ident}/turns",
            json={"text": "Xin chào"},
            headers={"Idempotency-Key": "first-turn-123"},
        ),
        client.post(
            f"/api/v1/messages/{message['id']}/tts", json={}, headers={"Idempotency-Key": "cached-audio-key"}
        ),
        client.get(stream_url),
        client.post(
            "/api/v1/speech/transcriptions",
            files={"file": ("voice.wav", wav.getvalue(), "audio/wav")},
            headers={"Idempotency-Key": "transcription-key"},
        ),
        client.post("/api/v1/chat/preview", json={}, headers={"Idempotency-Key": "preview-blocked-key"}),
        client.post("/api/v1/characters", json={}),
        client.patch("/api/v1/characters/kaito-kid", json={}),
    ]
    for request in requests:
        response = await request
        assert response.status_code == 403, response.text
        assert response.json()["message"] == FREE_CLOSED_MESSAGE
    assert (await client.get(f"/api/v1/conversations/{ident}/messages")).status_code == 200
    assert (await client.post(f"/api/v1/turns/{message['id']}/cancel")).status_code == 200
    await control(app, "free", enabled=True)
    await turn(client, ident, key="reopened-turn-key")


async def test_premium_closure_blocks_paid_accounts_without_free_fallback(env):
    app, client, cfg = env
    await register(client)
    created = (
        await client.post("/api/v1/billing/orders", headers={"Idempotency-Key": "buy-premium-first"})
    ).json()
    await webhook(client, cfg, payload(created))
    await control(app, "premium", enabled=False)
    account = (await client.get("/api/v1/me")).json()
    assert account["plan"] == "premium" and not account["can_use_features"]
    assert account["plan_message"] == PREMIUM_CLOSED_MESSAGE
    for response in (
        await client.post("/api/v1/conversations", json={"character_id": "kaito-kid"}),
        await client.post("/api/v1/billing/orders", headers={"Idempotency-Key": "buy-premium-first"}),
        await client.post("/api/v1/billing/quote", json={}),
    ):
        assert response.status_code == 403 and response.json()["code"] == "PLAN_CLOSED"
    client.cookies.clear()
    assert (await client.post("/api/v1/auth/register", json=signup("premium"))).status_code == 403


async def test_promo_price_is_server_calculated_snapshotted_and_paid_exactly(env):
    app, client, cfg = env
    await owner(app, client)
    assert (await availability(client, discount_percent=25, promo_codes=["SAVE25"])).status_code == 200
    quote = (await client.post("/api/v1/billing/quote", json={"promo_code": " save25 "})).json()
    assert quote["amount_vnd"] == 187500 and quote["discount_percent"] == 25
    headers = {"Idempotency-Key": "discounted-order-key"}
    created = (
        await client.post("/api/v1/billing/orders", json={"promo_code": "save25"}, headers=headers)
    ).json()
    assert created["amount_vnd"] == 187500 and created["list_price_vnd"] == 250000
    assert "amount=187500" in created["qr_url"]
    assert (await availability(client, discount_percent=50, promo_codes=["SAVE25"])).status_code == 200
    same = (
        await client.post("/api/v1/billing/orders", json={"promo_code": "SAVE25"}, headers=headers)
    ).json()
    assert same["id"] == created["id"] and same["discount_percent"] == 25
    assert (await client.post("/api/v1/billing/orders", json={}, headers=headers)).status_code == 409
    assert (await webhook(client, cfg, payload(created, transferAmount=250000))).status_code == 200
    assert (await client.get("/api/v1/me")).json()["plan"] == "free"
    assert (await webhook(client, cfg, payload(created, id=92705, transferAmount=187500))).status_code == 200
    assert (await client.get("/api/v1/me")).json()["plan"] == "premium"
    quote = (await client.post("/api/v1/billing/quote", json={"promo_code": "SAVE25"})).json()
    assert quote["amount_vnd"] == 125000


async def test_invalid_removed_codes_and_client_supplied_prices_are_rejected(env):
    _, client, _ = env
    await owner(*env[:2])
    assert (await availability(client, discount_percent=25, promo_codes=["SAVE25"])).status_code == 200
    assert (await client.post("/api/v1/billing/quote", json={"promo_code": "WRONG"})).status_code == 422
    assert (await availability(client, discount_percent=25, promo_codes=[])).status_code == 200
    assert (
        await client.post(
            "/api/v1/billing/orders",
            json={"promo_code": "SAVE25"},
            headers={"Idempotency-Key": "removed-code-key"},
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/billing/orders",
            json={"amount_vnd": 1, "discount_percent": 100},
            headers={"Idempotency-Key": "forged-price-key"},
        )
    ).status_code == 422
    assert (await client.post("/api/v1/billing/quote", json={})).json()["amount_vnd"] == 250000


async def test_full_discount_grants_one_real_period_without_fake_bank_events(env):
    app, client, cfg = env
    await owner(app, client)
    assert (await availability(client, discount_percent=100, promo_codes=["GIFT100"])).status_code == 200
    cfg.sepay_secret = cfg.bank_account = ""
    headers = {"Idempotency-Key": "complimentary-period-key"}
    first = (
        await client.post("/api/v1/billing/orders", json={"promo_code": "GIFT100"}, headers=headers)
    ).json()
    assert first["status"] == "paid" and first["amount_vnd"] == 0
    second = (
        await client.post("/api/v1/billing/orders", json={"promo_code": "gift100"}, headers=headers)
    ).json()
    assert second["id"] == first["id"]
    assert (await client.get("/api/v1/me")).json()["can_use_features"]
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(Subscription)) == 1
        assert await db.scalar(select(func.count()).select_from(PaymentEvent)) == 0


@pytest.mark.parametrize("percent", [-1, 101, 1.5, True])
async def test_discount_bounds_are_enforced(env, percent):
    app, client, _ = env
    await owner(app, client)
    assert (await availability(client, discount_percent=percent)).status_code == 422


@pytest.mark.parametrize("role", ["user", "moderator"])
async def test_only_admins_and_owners_change_plan_controls(env, role):
    app, client, _ = env
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = role
        await db.commit()
    assert (await availability(client, code="free", enabled=False)).status_code == 403


async def test_admin_can_control_plans_and_free_cannot_have_discounts(env):
    app, client, _ = env
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = "admin"
        await db.commit()
    assert (await availability(client, code="free", enabled=False)).status_code == 200
    assert (await availability(client, code="free", discount_percent=10)).status_code == 422
    assert (await availability(client, promo_codes=["x"])).status_code == 422
    client.cookies.clear()
    assert (await client.post("/api/v1/billing/quote", json={})).status_code == 401
    assert (await client.post("/api/v1/conversations", json={"character_id": "kaito-kid"})).status_code == 401


async def test_locked_account_usage_remains_readable_by_admin_tools(env):
    app, client, _ = env
    account = await register(client)
    async with app.state.db() as db:
        user = await db.get(User, account["id"])
        user.active = False
        await db.commit()
        assert (await admin_usage(db, user.id))["plan"] == "free"
    assert (await client.get("/api/v1/me")).status_code == 401
