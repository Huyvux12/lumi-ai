import io
import itertools
import wave

import pytest
from app.models import Audit, PaymentEvent, PlanSettings, Subscription, User, now_ms
from app.plan_access import WAITLIST_MESSAGE, closed_message
from app.quotas import admin_usage
from app.seed import seed
from conftest import conversation, register, turn
from sqlalchemy import func, select
from test_admin import owner
from test_billing import payload, webhook

TRANSFERS = itertools.count(93000)


async def control(app, code, **changes):
    async with app.state.db() as db:
        row = await db.get(PlanSettings, code)
        for key, value in changes.items():
            setattr(row, key, value)
        await db.commit()


def signup(**extra):
    return {
        "email": "new@example.com",
        "username": "newuser",
        "password": "CorrectHorse123!",
        "name": "New User",
        **extra,
    }


def silence():
    wav = io.BytesIO()
    with wave.open(wav, "wb") as out:
        out.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        out.writeframes(b"\0\0" * 16000)
    return wav.getvalue()


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


async def buy(client, cfg, code, key, **body):
    response = await client.post(
        "/api/v1/billing/orders", json={"plan": code, **body}, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 200, response.text
    created = response.json()
    if created["status"] != "paid":
        event = payload(created, id=next(TRANSFERS), transferAmount=created["amount_vnd"])
        assert (await webhook(client, cfg, event)).status_code == 200
    return created


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
    assert [p["code"] for p in plans] == ["free", "basic", "plus", "premium"]
    assert [p["price_vnd"] for p in plans] == [0, 50000, 99000, 250000]
    assert next(p for p in plans if p["code"] == "free")["closed_message"] == closed_message("free")
    assert "sever" not in closed_message("free")
    premium = next(p for p in plans if p["code"] == "premium")
    assert not premium["enabled"] and premium["discount_percent"] == 25
    assert premium["closed_message"] == closed_message("premium")
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


async def test_signup_no_longer_takes_a_plan(env):
    _, client, _ = env
    assert (await client.post("/api/v1/auth/register", json=signup(plan="premium"))).status_code == 422


async def test_closed_free_waitlists_new_accounts_until_it_reopens(env):
    app, client, cfg = env
    await control(app, "free", enabled=False)
    response = await client.post("/api/v1/auth/register", json=signup())
    assert response.status_code == 200 and "set-cookie" in response.headers
    account = response.json()
    assert account["plan"] == "free" and account["waitlisted"]
    assert not account["can_use_features"] and account["plan_message"] == WAITLIST_MESSAGE
    response = await client.post("/api/v1/conversations", json={"character_id": "kaito-kid"})
    assert response.status_code == 403 and response.json()["message"] == WAITLIST_MESSAGE
    # Billing stays reachable, and paying skips the queue.
    await buy(client, cfg, "basic", "skip-the-queue-key")
    account = (await client.get("/api/v1/me")).json()
    assert account["plan"] == "basic" and account["can_use_features"] and not account["waitlisted"]
    await conversation(client)
    async with app.state.db() as db:
        sub = await db.scalar(select(Subscription))
        sub.starts_at, sub.ends_at = 0, 1
        await db.commit()
    account = (await client.get("/api/v1/me")).json()
    assert account["plan"] == "free" and account["waitlisted"]
    await control(app, "free", enabled=True)
    account = (await client.get("/api/v1/me")).json()
    assert account["can_use_features"] and not account["waitlisted"]
    await conversation(client)
    async with app.state.db() as db:
        assert not (await db.scalar(select(User))).waitlisted
    # Released for good: closing Free again leaves this account alone.
    await control(app, "free", enabled=False)
    assert (await client.get("/api/v1/me")).json()["can_use_features"]


async def test_free_closure_leaves_existing_free_accounts_working(env):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    message = await turn(client, ident)
    await control(app, "free", enabled=False)
    me = (await client.get("/api/v1/me")).json()
    assert me["plan"] == "free" and me["can_use_features"] and not me["waitlisted"]
    assert me["plan_message"] is None
    await turn(client, ident, key="still-working-turn")
    audio = await client.post(
        f"/api/v1/messages/{message['id']}/tts", json={}, headers={"Idempotency-Key": "cached-audio-key"}
    )
    assert audio.status_code == 200
    response = await client.post(
        "/api/v1/speech/transcriptions",
        files={"file": ("voice.wav", silence(), "audio/wav")},
        headers={"Idempotency-Key": "transcription-key"},
    )
    assert response.status_code != 403, response.text


async def test_waitlisted_accounts_are_blocked_at_every_feature_entry_point(env):
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
    async with app.state.db() as db:
        (await db.scalar(select(User))).waitlisted = True
        await db.commit()
    me = (await client.get("/api/v1/me")).json()
    assert me["waitlisted"] and not me["can_use_features"] and me["plan_message"] == WAITLIST_MESSAGE
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
            files={"file": ("voice.wav", silence(), "audio/wav")},
            headers={"Idempotency-Key": "transcription-key"},
        ),
        client.post("/api/v1/chat/preview", json={}, headers={"Idempotency-Key": "preview-blocked-key"}),
        client.post("/api/v1/characters", json={}),
        client.patch("/api/v1/characters/kaito-kid", json={}),
    ]
    for request in requests:
        response = await request
        assert response.status_code == 403, response.text
        assert response.json()["message"] == WAITLIST_MESSAGE
    assert (await client.get(f"/api/v1/conversations/{ident}/messages")).status_code == 200
    assert (await client.post(f"/api/v1/turns/{message['id']}/cancel")).status_code == 200
    await control(app, "free", enabled=True)
    await turn(client, ident, key="reopened-turn-key")


async def test_paid_closure_only_stops_new_orders(env):
    app, client, cfg = env
    await register(client)
    await buy(client, cfg, "premium", "buy-premium-first")
    await control(app, "premium", enabled=False)
    account = (await client.get("/api/v1/me")).json()
    assert account["plan"] == "premium" and account["can_use_features"]
    await conversation(client)
    for response in (
        await client.post("/api/v1/billing/orders", headers={"Idempotency-Key": "buy-premium-again"}),
        await client.post("/api/v1/billing/quote", json={}),
    ):
        assert response.status_code == 403 and response.json()["code"] == "PLAN_CLOSED"
        assert response.json()["message"] == closed_message("premium")
    # Other tiers stay purchasable.
    assert (await client.post("/api/v1/billing/quote", json={"plan": "plus"})).status_code == 200


async def test_legacy_premium_signup_without_payment_falls_back_to_free(env):
    app, client, _ = env
    account = await register(client)
    async with app.state.db() as db:
        (await db.get(User, account["id"])).signup_plan = "premium"
        await db.commit()
    me = (await client.get("/api/v1/me")).json()
    assert me["plan"] == "free" and me["can_use_features"]
    await conversation(client)


async def test_each_paid_tier_is_sold_at_its_own_price(env):
    app, client, cfg = env
    await register(client)
    for code, price in (("basic", 50000), ("plus", 99000), ("premium", 250000)):
        quote = (await client.post("/api/v1/billing/quote", json={"plan": code})).json()
        assert quote["amount_vnd"] == price and quote["credit_vnd"] == 0 and not quote["upgrade"]
    created = await buy(client, cfg, "basic", "buy-basic-first")
    assert created["amount_vnd"] == 50000 and created["plan"] == "basic"
    me = (await client.get("/api/v1/me")).json()
    assert me["plan"] == "basic"
    history = (await client.get("/api/v1/billing/history")).json()
    assert history[0]["plan"] == "basic" and history[0]["status"] == "paid"
    async with app.state.db() as db:
        usage = await admin_usage(db, me["id"])
        assert usage["period"].startswith("basic:") and usage["limits"]["chat_period"] == 1500
    # The same idempotency key for another tier is a conflict, not a silent reuse.
    response = await client.post(
        "/api/v1/billing/orders", json={"plan": "plus"}, headers={"Idempotency-Key": "buy-basic-first"}
    )
    assert response.status_code == 409


async def test_upgrade_starts_now_and_credits_unused_time(env):
    app, client, cfg = env
    await register(client)
    await buy(client, cfg, "basic", "buy-basic-first")
    await buy(client, cfg, "basic", "renew-basic-early")
    at = now_ms()
    async with app.state.db() as db:
        first, queued = (await db.execute(select(Subscription).order_by(Subscription.starts_at))).scalars()
        # Half of the running period is left; the queued one is untouched.
        length = first.ends_at - first.starts_at
        first.starts_at, first.ends_at = at - length // 2, at + length // 2
        queued.starts_at, queued.ends_at = first.ends_at, first.ends_at + length
        await db.commit()
    quote = (await client.post("/api/v1/billing/quote", json={"plan": "premium"})).json()
    assert quote["upgrade"]
    # 25,000 left of the first + 50,000 queued, rounded down to whole thousands.
    assert quote["credit_vnd"] in (74000, 75000) and quote["credit_vnd"] % 1000 == 0
    assert quote["amount_vnd"] == 250000 - quote["credit_vnd"]
    created = await buy(client, cfg, "premium", "upgrade-to-premium")
    assert abs(created["credit_vnd"] - quote["credit_vnd"]) <= 1000 and created["amount_vnd"] % 1000 == 0
    me = (await client.get("/api/v1/me")).json()
    assert me["plan"] == "premium"
    async with app.state.db() as db:
        # Sorted by start: the truncated period, the upgrade, then the cancelled queued period.
        old, new, gone = (
            (await db.execute(select(Subscription).order_by(Subscription.starts_at))).scalars().all()
        )
        assert old.active and old.ends_at <= new.starts_at
        assert not gone.active
        assert new.active and new.period_index == 1 and new.starts_at >= at
        usage = await admin_usage(db, me["id"])
        assert usage["limits"]["chat_period"] == 8000


async def test_lower_or_same_tier_queues_after_current_period(env):
    app, client, cfg = env
    await register(client)
    await buy(client, cfg, "plus", "buy-plus-first")
    quote = (await client.post("/api/v1/billing/quote", json={"plan": "basic"})).json()
    assert not quote["upgrade"] and quote["credit_vnd"] == 0 and quote["amount_vnd"] == 50000
    await buy(client, cfg, "basic", "then-basic")
    assert (await client.get("/api/v1/me")).json()["plan"] == "plus"
    async with app.state.db() as db:
        plus, basic = (await db.execute(select(Subscription).order_by(Subscription.starts_at))).scalars()
        assert plus.active and basic.active and basic.starts_at == plus.ends_at


async def test_credit_covering_the_price_activates_without_payment(env):
    app, client, cfg = env
    await owner(app, client)
    assert (
        await availability(client, code="plus", discount_percent=50, promo_codes=["HALF"])
    ).status_code == 200
    await buy(client, cfg, "basic", "buy-basic-first")
    await buy(client, cfg, "basic", "renew-basic-early")
    created = (
        await client.post(
            "/api/v1/billing/orders",
            json={"plan": "plus", "promo_code": "HALF"},
            headers={"Idempotency-Key": "upgrade-with-credit"},
        )
    ).json()
    # 49,500 after the discount, covered by ~100,000 of Basic credit.
    assert created["amount_vnd"] == 0 and created["credit_vnd"] == 49500 and created["status"] == "paid"
    assert (await client.get("/api/v1/me")).json()["plan"] == "plus"


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
    assert (
        await client.post(
            "/api/v1/billing/orders", json={"plan": "free"}, headers={"Idempotency-Key": "buy-free-key"}
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
    assert (await availability(client, code="basic", discount_percent=10)).status_code == 200
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
