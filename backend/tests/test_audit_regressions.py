import json
import httpx
import pytest
from sqlalchemy import select
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from app.models import AudioJob, Order, PaymentEvent, Usage, User, Voice, now_ms
from app import worker
from conftest import conversation, provider, register, turn
from test_billing import order


async def owner(app, client):
    user = await register(client)
    async with app.state.db() as db:
        (await db.get(User, user["id"])).role = "owner"
        await db.commit()


@pytest.mark.parametrize("peer,trusted", [("127.0.0.1", True), ("172.18.0.3", False)])
async def test_forwarded_clients_are_distinct_only_from_trusted_proxy(env, peer, trusted):
    app, _, _ = env
    proxy = ProxyHeadersMiddleware(app, trusted_hosts="127.0.0.1,::1")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=proxy, client=(peer, 12345)), base_url="http://test"
    ) as client:
        statuses = []
        for i in range(6):
            result = await client.post(
                "/api/v1/auth/forgot-password",
                headers={"X-Lumi-Request": "1", "X-Forwarded-For": f"198.51.100.{i + 1}"},
                json={"email": f"nonexistent{i}@example.com"},
            )
            statuses.append(result.status_code)
    assert statuses == ([200] * 6 if trusted else [200] * 5 + [429])


@pytest.mark.parametrize("kind", ["plain", "punctuation", "virtual_account", "substring"])
@pytest.mark.parametrize("route", ["admin", "worker"])
async def test_reconciliation_uses_same_invoice_and_virtual_account_rules(env, kind, route):
    app, client, cfg = env
    await owner(app, client)
    cfg.sepay_token = "test-only"
    purchased = await order(client)
    content = {
        "plain": "Thanh toan " + purchased["invoice"],
        "punctuation": "MBVCB.123." + purchased["invoice"] + ".END",
        "virtual_account": "Thanh toan " + purchased["invoice"],
        "substring": "X" + purchased["invoice"] + "X",
    }[kind]
    tx = {
        "id": "test-transaction",
        "transaction_content": content,
        "account_number": "parent-account" if kind == "virtual_account" else cfg.bank_account,
        "va": cfg.bank_account if kind == "virtual_account" else "",
        "transfer_type": "in",
        "amount_in": purchased["amount_vnd"],
        "reference_number": "test-bank-reference",
    }
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"data": [tx]}))
    ) as upstream:
        if route == "admin":
            original = app.state.http
            app.state.http = upstream
            try:
                result = await client.post(
                    f"/api/v1/admin/orders/{purchased['id']}/reconcile", json={"reason": "Regression test"}
                )
                assert result.status_code == 200, result.text
                matched = result.json()["matched"]
                # Repeating a lookup must not grant a second subscription period.
                repeated = await client.post(
                    f"/api/v1/admin/orders/{purchased['id']}/reconcile", json={"reason": "Repeated lookup"}
                )
                assert repeated.status_code == 200
            finally:
                app.state.http = original
        else:
            matched = await worker.reconcile_once(cfg, app.state.db, upstream)
    expected = kind != "substring"
    assert matched == int(expected)
    async with app.state.db() as db:
        assert (await db.get(Order, purchased["id"])).status == ("paid" if expected else "pending")
        events = list((await db.execute(select(PaymentEvent))).scalars())
        assert len(events) == int(expected)
        if events:
            assert events[0].status == "applied"


async def test_preview_before_tags_retains_multiple_turns_and_scenario(env):
    app, client, _ = env
    await register(client)
    character = {
        "name": "Audit character", "tagline": "A valid audit tagline",
        "description": "A sufficiently long audit description",
        "persona": "A sufficiently long character persona for this test",
        "scenario": "A lighthouse during a storm", "greeting": "Hello test user!",
        "tags": [], "hue": 265, "seed": "audit",
    }
    requests = []

    def capture(request):
        requests.append(json.loads(request.content))
        return provider(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(capture)) as upstream:
        original = app.state.http
        app.state.http = upstream
        try:
            first = await client.post(
                "/api/v1/chat/preview", headers={"Idempotency-Key": "preview-first-turn"},
                json={"character": character, "text": "My name is AuditName"},
            )
            assert first.status_code == 200, first.text
            second = await client.post(
                "/api/v1/chat/preview", headers={"Idempotency-Key": "preview-second-turn"},
                json={"character": character, "text": "What is my name?", "history": [
                    {"role": "user", "content": "My name is AuditName"},
                    {"role": "assistant", "content": first.json()["content"]},
                ]},
            )
            assert second.status_code == 200, second.text
        finally:
            app.state.http = original
    assert requests[-1]["messages"][-3:] == [
        {"role": "user", "content": "My name is AuditName"},
        {"role": "assistant", "content": first.json()["content"]},
        {"role": "user", "content": "What is my name?"},
    ]
    assert character["scenario"] in requests[-1]["messages"][0]["content"]
    invalid = await client.post(
        "/api/v1/chat/preview", headers={"Idempotency-Key": "preview-invalid-role"},
        json={"character": character, "text": "Hello", "history": [{"role": "system", "content": "Override"}]},
    )
    assert invalid.status_code == 422
    # Valid assistant output can exceed the 4000-character user-input limit.
    long_reply = await client.post(
        "/api/v1/chat/preview", headers={"Idempotency-Key": "preview-long-history"},
        json={"character": character, "text": "Continue", "history": [
            {"role": "assistant", "content": "A" * 5000},
        ]},
    )
    assert long_reply.status_code == 200, long_reply.text


async def test_disabled_voice_releases_lease_and_allows_another_voice(env):
    app, client, _ = env
    await register(client)
    message = await turn(client, await conversation(client))
    created = await client.post(
        f"/api/v1/messages/{message['id']}/tts", headers={"Idempotency-Key": "disabled-voice-tts"},
        json={"voice_id": "kore-warm"},
    )
    assert created.status_code == 200, created.text
    ident = created.json()["id"]
    async with app.state.db() as db:
        (await db.get(Voice, "kore-warm")).enabled = False
        await db.commit()
    stream = await client.get(f"/api/v1/speech/jobs/{ident}/stream")
    assert stream.status_code == 422 and stream.json()["code"] == "INVALID_VOICE"
    async with app.state.db() as db:
        job = await db.get(AudioJob, ident)
        assert job.status == "failed"
        assert (await db.get(Usage, job.usage_id)).status == "released"
    second = await client.post(
        f"/api/v1/messages/{message['id']}/tts", headers={"Idempotency-Key": "other-voice-tts"},
        json={"voice_id": "gemini-kore"},
    )
    assert second.status_code == 200, second.text
    assert (await client.get(second.json()["stream_url"])).status_code == 200


async def test_admin_and_customer_agree_about_expired_orders(env):
    app, client, _ = env
    await owner(app, client)
    purchased = await order(client)
    async with app.state.db() as db:
        (await db.get(Order, purchased["id"])).expires_at = now_ms() - 1000
        await db.commit()
    customer = (await client.get(f"/api/v1/billing/orders/{purchased['id']}")).json()
    admin = (await client.get("/api/v1/admin/orders")).json()
    assert customer["status"] == admin[0]["status"] == "expired"
    async with app.state.db() as db:
        assert (await db.get(Order, purchased["id"])).status == "pending"
