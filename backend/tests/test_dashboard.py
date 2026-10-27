from datetime import datetime

import pytest
from conftest import register
from sqlalchemy import select

from app import admin_dashboard
from app.models import Audit, Character, Order, PaymentEvent, Plan, Report, Subscription, Usage, User
from app.quotas import VN


async def staff(app, client, role="owner"):
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = role
        await db.commit()
    return user["id"]


@pytest.mark.parametrize("days", [7, 30, 90])
async def test_empty_dashboard_has_complete_zero_series(env, days):
    app, client, _ = env
    await staff(app, client)
    result = await client.get(f"/api/v1/admin/dashboard?days={days}")
    assert result.status_code == 200, result.text
    data = result.json()
    assert len(data["series"]) == days
    assert data["period"]["timezone"] == "Asia/Ho_Chi_Minh"
    assert data["metrics"]["revenue_vnd"] == data["metrics"]["active_users"] == 0
    assert all(
        day["revenue_vnd"] == day["chat_turns"] == day["tts_requests"] == day["stt_requests"] == 0
        for day in data["series"]
    )
    assert data["activity"] == []


async def test_dashboard_groups_vietnam_days_and_counts_all_records(env, monkeypatch):
    app, client, _ = env
    owner = await staff(app, client)
    at = int(datetime(2026, 10, 14, 12, tzinfo=VN).timestamp() * 1000)
    midnight = int(datetime(2026, 10, 14, tzinfo=VN).timestamp() * 1000)
    start = midnight - 6 * admin_dashboard.DAY_MS
    monkeypatch.setattr(admin_dashboard, "now_ms", lambda: at)
    async with app.state.db() as db:
        (await db.get(User, owner)).created_at = start - 2 * admin_dashboard.DAY_MS
        accounts = [
            User(
                email=f"dashboard{i}@example.com",
                username=f"dash{i}",
                name="Dashboard test",
                password_hash="unused-test-hash",
                created_at=midnight,
            )
            for i in range(201)
        ]
        db.add_all(accounts)
        await db.flush()
        plan = await db.scalar(select(Plan).where(Plan.code == "premium", Plan.active.is_(True)))
        for i, (amount, status, environment, paid_at) in enumerate(
            [
                (250000, "paid", "test", midnight),
                (100000, "paid", "test", midnight - 1),
                (150000, "paid", "test", midnight + 1000),
                (50000, "refunded", "test", midnight),
                (200000, "paid", "test", start - 1),
                (999000, "paid", "live", midnight),
                (888000, "paid", "test", at + 1000),
            ]
        ):
            db.add(
                Order(
                    user_id=owner,
                    invoice=f"LUMI{i:016X}",
                    request_key=f"dashboard-order-{i}",
                    plan_id=plan.id,
                    amount_vnd=amount,
                    environment=environment,
                    status=status,
                    created_at=start - 20 * admin_dashboard.DAY_MS,
                    paid_at=paid_at,
                    expires_at=at + 10000,
                )
            )
        for i, (user, kind, status, amount, secondary, created, meta) in enumerate(
            [
                (
                    owner,
                    "chat",
                    "committed",
                    1,
                    0,
                    midnight,
                    {"prompt_tokens": 1000, "completion_tokens": 200},
                ),
                (owner, "tts", "committed", 100, 60000, midnight - 1, {}),
                (accounts[0].id, "stt", "committed", 120000, 0, midnight, {}),
                (accounts[1].id, "chat", "released", 1, 0, midnight, {}),
                (accounts[1].id, "tts", "reserved", 100, 999999, midnight, {}),
                (
                    accounts[2].id,
                    "admin_test",
                    "committed",
                    1,
                    0,
                    midnight,
                    {"prompt_tokens": 100, "completion_tokens": 50},
                ),
                (owner, "chat", "committed", 1, 0, start - 1, {}),
            ]
        ):
            db.add(
                Usage(
                    user_id=user,
                    kind=kind,
                    status=status,
                    amount=amount,
                    secondary=secondary,
                    request_key=f"dashboard-usage-{i}",
                    period="test",
                    day="2026-10-14",
                    created_at=created,
                    provider_usage=meta,
                    expires_at=at + 10000,
                )
            )
        db.add_all(
            [
                Character(
                    id="dashboard-public",
                    owner_id=owner,
                    data={"name": "Public"},
                    visibility="public",
                    status="pending",
                ),
                Character(
                    id="dashboard-private",
                    owner_id=owner,
                    data={"name": "Private"},
                    visibility="private",
                    status="pending",
                ),
                Report(user_id=owner, character_id="kaito-kid", reason="Open test report", status="open"),
                Report(user_id=owner, character_id="kaito-kid", reason="Closed test report", status="closed"),
                PaymentEvent(key="test:bank:review", status="review", payload={}),
                PaymentEvent(key="live:bank:review", status="review", payload={}),
                Audit(
                    actor_id=owner,
                    action="plan.availability",
                    target="free",
                    details={"private": "must not expose"},
                    created_at=at,
                ),
                Audit(
                    actor_id=owner,
                    action="character.moderate",
                    target="kaito-kid",
                    details={"reason": "test"},
                    created_at=at - 1,
                ),
            ]
        )
        await db.flush()
        paid = await db.scalar(select(Order).where(Order.request_key == "dashboard-order-0"))
        db.add(
            Subscription(
                user_id=owner,
                order_id=paid.id,
                plan_id=plan.id,
                starts_at=at - 1000,
                ends_at=at + 1000,
                anchor_at=at - 1000,
                period_index=1,
            )
        )
        await db.commit()
    result = await client.get("/api/v1/admin/dashboard?days=7")
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["metrics"] == {
        "revenue_vnd": 500000,
        "new_users": 201,
        "active_users": 2,
        "total_users": 202,
        "premium_users": 1,
        "gifted_users": 0,
        "referral_signups": 0,
        "referral_qualified": 0,
    }
    assert data["previous"] == {"revenue_vnd": 200000, "new_users": 1, "active_users": 1}
    by_day = {day["date"]: day for day in data["series"]}
    assert by_day["2026-10-13"]["revenue_vnd"] == 100000
    assert by_day["2026-10-14"]["revenue_vnd"] == 400000
    assert by_day["2026-10-13"]["tts_requests"] == 1
    assert by_day["2026-10-14"]["chat_turns"] == by_day["2026-10-14"]["stt_requests"] == 1
    assert data["usage"]["tts_ms"] == 60000 and data["usage"]["stt_ms"] == 120000
    assert data["usage"]["released_requests"] == 1
    assert data["usage"]["input_tokens"] == 1100 and data["usage"]["output_tokens"] == 250
    assert data["usage"]["llm_estimated_usd"] == 0.0019
    assert data["queue"] == {"characters_pending": 1, "reports_open": 1, "payments_review": 1, "feedback_new": 0}
    assert "details" not in data["activity"][0]
    moderator = await client.get("/api/v1/admin/moderation-dashboard")
    assert moderator.status_code == 200
    safe = moderator.json()
    assert set(safe) == {"scope", "generated_at", "queue", "activity"}
    assert set(safe["queue"]) == {"characters_pending", "reports_open"}
    assert [item["action"] for item in safe["activity"]] == ["character.moderate"]


@pytest.mark.parametrize("role", ["user", "moderator", "admin", "owner"])
async def test_dashboard_permissions_and_period_validation(env, role):
    app, client, _ = env
    assert (await client.get("/api/v1/admin/dashboard")).status_code == 401
    await staff(app, client, role)
    result = await client.get("/api/v1/admin/dashboard?days=7")
    assert result.status_code == (200 if role in {"admin", "owner"} else 403)
    safe = await client.get("/api/v1/admin/moderation-dashboard")
    assert safe.status_code == (403 if role == "user" else 200)
    if role in {"admin", "owner"}:
        assert (await client.get("/api/v1/admin/dashboard?days=14")).status_code == 422
        app.state.settings.environment = "production"
        assert (await client.get("/api/v1/admin/dashboard")).json()["code"] == "MFA_REQUIRED"


async def test_service_flags_reflect_selected_auth_mode_and_required_bank_fields(env):
    app, client, cfg = env
    await staff(app, client)
    cfg.tts_auth_mode = "adc"
    cfg.tts_project = ""
    cfg.bank_holder = ""
    first = (await client.get("/api/v1/admin/dashboard")).json()["services"]
    assert first["tts"] is False and first["sepay"] is False
    cfg.tts_project = "test-project"
    cfg.bank_holder = "Test account holder"
    second = (await client.get("/api/v1/admin/dashboard")).json()["services"]
    assert second["tts"] is True and second["sepay"] is True
    assert "google_key" not in second and "sepay_secret" not in second
