from sqlalchemy import select
from app.models import User, Prompt, Plan, Character, Audit, Usage
from conftest import register, conversation, turn
from test_billing import order, payload, webhook


async def owner(app, client):
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = "owner"
        await db.commit()
    return user


async def test_plan_snapshot_prompt_publish_and_audit(env):
    app, client, cfg = env
    user = await owner(app, client)
    purchased = await order(client)
    plan = next(
        p for p in (await client.get("/api/v1/admin/plans")).json() if p["code"] == "premium" and p["active"]
    )
    q = dict(plan["quota"])
    q["chat_period"] = 500
    response = await client.post(
        "/api/v1/admin/plans/premium",
        json={"price_vnd": 250000, "quota": q, "reason": "Adjust cost envelope"},
    )
    assert response.status_code == 200, response.text
    await webhook(client, cfg, payload(purchased))
    usage = (await client.get("/api/v1/admin/users/" + user["id"] + "/usage")).json()
    assert usage["limits"]["chat_period"] == 800
    response = await client.post(
        "/api/v1/admin/prompts",
        json={
            "text": "Trả lời trong vai nhân vật và theo đúng hợp đồng JSON.",
            "active_tags": ["giggle"],
            "reason": "Test a new prompt",
        },
    )
    assert response.status_code == 200
    ident = response.json()["id"]
    test = await client.post(
        "/api/v1/admin/prompts/" + ident + "/test", json={"character_id": "kaito-kid", "text": "Xin chào"}
    )
    assert test.status_code == 200 and "tts_text" not in test.text
    assert (
        await client.post(
            "/api/v1/admin/prompts/" + ident + "/publish", json={"reason": "Publish tested prompt"}
        )
    ).status_code == 200
    versions = (await client.get("/api/v1/admin/prompts")).json()["versions"]
    assert sum(p["published"] for p in versions) == 1
    assert next(p for p in versions if p["published"])["id"] == ident
    actions = {a["action"] for a in (await client.get("/api/v1/admin/audit")).json()}
    assert {"plan.version", "prompt.draft", "prompt.test", "prompt.publish"} <= actions


async def test_moderator_cannot_read_billing_quota_or_grant_roles(env):
    app, client, cfg = env
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = "moderator"
        await db.commit()
    for route in [
        "/admin/summary",
        "/admin/users",
        "/admin/plans",
        "/admin/orders",
        "/admin/payments",
        "/admin/audit",
        "/admin/users/" + user["id"] + "/usage",
    ]:
        assert (await client.get("/api/v1" + route)).status_code == 403
    assert (await client.get("/api/v1/admin/characters")).status_code == 200
    response = await client.patch(
        "/api/v1/admin/characters/kaito-kid", json={"status": "hidden", "reason": "Review a report"}
    )
    assert response.status_code == 200
    assert (await client.get("/api/v1/characters/kaito-kid")).status_code == 404


async def test_production_admin_requires_mfa(env):
    app, client, cfg = env
    await owner(app, client)
    cfg.environment = "production"
    response = await client.get("/api/v1/admin/summary")
    assert response.status_code == 403 and response.json()["code"] == "MFA_REQUIRED"


async def test_record_refund_revokes_only_matching_period(env):
    app, client, cfg = env
    await owner(app, client)
    one = await order(client)
    await webhook(client, cfg, payload(one))
    response = await client.post(
        "/api/v1/admin/orders/" + one["id"] + "/record-refund",
        json={"reason": "Bank refund completed and verified"},
    )
    assert response.status_code == 200
    assert (await client.get("/api/v1/billing/subscription")).json()["plan"] == "free"
    assert (
        await client.post(
            "/api/v1/admin/orders/" + one["id"] + "/record-refund", json={"reason": "Repeated refund"}
        )
    ).status_code == 409
