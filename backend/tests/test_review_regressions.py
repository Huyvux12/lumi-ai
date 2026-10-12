import asyncio
import os
import threading
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update

from app import auth_api, catalog_api, chat_api, quotas, worker
from app.maintenance import cleanup_once, recover_interrupted, rebuild_search
from app.models import AudioJob, Character, CharacterAvatar, Message, Order, Usage, User, now_ms
from app.security import password_work, totp
from conftest import conversation, provider, register, turn
from test_character_media import profile, upload


async def test_chat_emits_heartbeats_while_provider_is_silent(env, monkeypatch):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    monkeypatch.setattr(chat_api, "CHAT_HEARTBEAT_SECONDS", 0.01)

    async def delayed(request):
        await asyncio.sleep(0.08)
        return provider(request)

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(delayed))
    response = await client.post(
        f"/api/v1/conversations/{ident}/turns",
        json={"text": "Xin chào"},
        headers={"Idempotency-Key": "heartbeat-test"},
    )
    assert ": keepalive\n\n" in response.text and "turn.completed" in response.text


async def test_recovery_releases_orphan_requests_but_keeps_resumable_audio(env):
    app, client, _ = env
    account = await register(client)
    reply = await turn(client, await conversation(client))
    async with app.state.db() as db:
        orphan = Usage(
            user_id=account["id"],
            kind="stt",
            request_key="crashed-stt",
            period="test",
            day="test",
            expires_at=now_ms() + 120000,
        )
        ready = Usage(
            user_id=account["id"],
            kind="tts",
            request_key="ready-audio",
            period="test",
            day="test",
            expires_at=now_ms() + 120000,
        )
        db.add_all([orphan, ready])
        await db.flush()
        db.add(
            AudioJob(
                user_id=account["id"],
                message_id=reply["id"],
                request_key="ready-audio",
                cache_key="test",
                voice_id="kore-warm",
                parts=[],
                usage_id=ready.id,
                expires_at=now_ms() + 86400000,
            )
        )
        await db.commit()
        orphan_id, ready_id = orphan.id, ready.id
    await recover_interrupted(app.state.db)
    async with app.state.db() as db:
        assert (await db.get(Usage, orphan_id)).status == "released"
        assert (await db.get(Usage, ready_id)).status == "reserved"


async def test_login_ip_limit_survives_rotating_email_addresses(env, monkeypatch):
    app, client, _ = env
    monkeypatch.setattr(auth_api, "verify_password", lambda *args: False)
    for i in range(30):
        response = await client.post(
            "/api/v1/auth/login", json={"email": f"missing{i}@example.com", "password": "wrong"}
        )
        assert response.status_code == 401
    response = await client.post(
        "/api/v1/auth/login", json={"email": "different@example.com", "password": "wrong"}
    )
    assert response.status_code == 429 and response.json()["code"] == "RATE_LIMIT"


async def test_login_global_limit_is_independent_of_account(env, monkeypatch):
    app, client, _ = env
    for _ in range(300):
        await app.state.limiter.check("login-global", 300, 60)
    response = await client.post("/api/v1/auth/login", json={"email": "new@example.com", "password": "wrong"})
    assert response.status_code == 429


async def test_password_threads_are_bounded_even_after_disconnect():
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(password_slots=asyncio.Semaphore(1))))
    started, release = threading.Event(), threading.Event()
    thread_ids = []

    def work():
        thread_ids.append(threading.get_ident())
        started.set()
        release.wait(3)

    task = asyncio.create_task(password_work(request, work))
    try:
        assert await asyncio.to_thread(started.wait, 1)
        assert thread_ids[0] != threading.get_ident()
        with pytest.raises(HTTPException) as error:
            await password_work(request, work)
        assert error.value.status_code == 429
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert request.app.state.password_slots.locked()
    finally:
        release.set()
    await asyncio.wait_for(request.app.state.password_slots.acquire(), 1)
    request.app.state.password_slots.release()


async def test_slow_chat_renews_lease_and_stays_metered(env, monkeypatch):
    app, client, _ = env
    account = await register(client)
    ident = await conversation(client)
    from app.token_budget import tokenizer

    tokenizer()  # Keep cold tokenizer loading out of the accelerated lease clock.
    # Keep the lease shorter than the provider wait but allow for database/CI scheduling.
    monkeypatch.setattr(quotas, "LEASE_MS", 1000)
    monkeypatch.setattr(quotas, "LEASE_HEARTBEAT_SECONDS", 0.02)
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow(request):
        started.set()
        await release.wait()
        return provider(request)

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    pending = asyncio.create_task(turn(client, ident))
    await asyncio.wait_for(started.wait(), 2)
    try:
        await asyncio.sleep(1.25)
        await cleanup_once(app)
        async with app.state.db() as db:
            ledger = (await db.execute(select(Usage))).scalar_one()
            assert ledger.status == "reserved" and ledger.expires_at > now_ms()
            with pytest.raises(HTTPException) as error:
                await quotas.reserve(db, account["id"], "chat", "second-running-request", 1)
            assert error.value.detail["code"] == "REQUEST_ACTIVE"
    finally:
        release.set()
    assert (await asyncio.wait_for(pending, 3))["status"] == "complete"
    async with app.state.db() as db:
        assert (await db.scalar(select(Usage))).status == "committed"


async def test_slow_initial_audio_response_renews_lease(env, monkeypatch):
    app, client, _ = env
    await register(client)
    reply = await turn(client, await conversation(client))
    monkeypatch.setattr(quotas, "LEASE_MS", 1000)
    monkeypatch.setattr(quotas, "LEASE_HEARTBEAT_SECONDS", 0.02)

    async def slow(request):
        await asyncio.sleep(1.25)
        return provider(request)

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    job = (
        await client.post(
            f"/api/v1/messages/{reply['id']}/tts", json={}, headers={"Idempotency-Key": "slow-audio-start"}
        )
    ).json()
    response = await client.get(job["stream_url"])
    assert response.status_code == 200 and response.content
    async with app.state.db() as db:
        assert (await db.scalar(select(Usage).where(Usage.kind == "tts"))).status == "committed"


async def test_lost_lease_cancels_owner_and_never_commits_success(env, monkeypatch):
    app, client, _ = env
    account = await register(client)
    monkeypatch.setattr(quotas, "LEASE_HEARTBEAT_SECONDS", 0.01)
    async with app.state.db() as db:
        usage, _ = await quotas.reserve(db, account["id"], "chat", "lease-lost-test", 1)
        ident = usage.id
        await db.commit()
    with pytest.raises(HTTPException) as error:
        async with quotas.usage_lease(app.state.db, ident):
            async with app.state.db() as db:
                (await db.get(Usage, ident)).status = "released"
                await db.commit()
            await asyncio.sleep(1)
    assert error.value.detail["code"] == "REQUEST_EXPIRED"
    with pytest.raises(HTTPException):
        await quotas.finish(app.state.db, ident, success=True)


async def test_abandoned_iterator_does_not_renew_a_finished_owners_lease(env, monkeypatch):
    app, client, _ = env
    account = await register(client)
    monkeypatch.setattr(quotas, "LEASE_MS", 100)
    monkeypatch.setattr(quotas, "LEASE_HEARTBEAT_SECONDS", 0.01)
    async with app.state.db() as db:
        usage, _ = await quotas.reserve(db, account["id"], "tts", "abandoned-iterator", 1)
        ident = usage.id
        await db.commit()

    async def owner():
        context = quotas.usage_lease(app.state.db, ident)
        await context.__aenter__()
        return context

    context = await asyncio.create_task(owner())
    try:
        await asyncio.sleep(0.2)
        await cleanup_once(app)
        async with app.state.db() as db:
            assert (await db.get(Usage, ident)).status == "released"
    finally:
        await context.__aexit__(None, None, None)


async def test_recovery_repairs_generating_messages_and_streaming_jobs(env):
    app, client, _ = env
    account = await register(client)
    ident = await conversation(client)
    async with app.state.db() as db:
        sent = Message(conversation_id=ident, role="user", content="Xin chào")
        db.add(sent)
        await db.flush()
        answer = Message(
            conversation_id=ident,
            role="assistant",
            status="generating",
            request_key=account["id"] + ":crashed-request",
            reply_to=sent.id,
        )
        usage = Usage(
            user_id=account["id"],
            kind="chat",
            request_key="crashed-request",
            period="test",
            day="test",
            expires_at=now_ms() + 120000,
        )
        audio_usage = Usage(
            user_id=account["id"],
            kind="tts",
            request_key="crashed-audio",
            period="test",
            day="test",
            expires_at=now_ms() + 120000,
        )
        db.add_all([answer, usage, audio_usage])
        await db.flush()
        job = AudioJob(
            user_id=account["id"],
            message_id=answer.id,
            request_key="crashed-audio",
            cache_key="test",
            voice_id="kore-warm",
            parts=[],
            usage_id=audio_usage.id,
            status="streaming",
            expires_at=now_ms() + 86400000,
        )
        db.add(job)
        await db.commit()
        answer_id, job_id, sent_id = answer.id, job.id, sent.id
    await recover_interrupted(app.state.db)
    async with app.state.db() as db:
        assert (await db.get(Message, answer_id)).status == "failed"
        assert (await db.get(AudioJob, job_id)).status == "failed"
        assert all(u.status == "released" for u in (await db.execute(select(Usage))).scalars())
    response = await client.post(
        f"/api/v1/conversations/{ident}/turns",
        json={"text": "Xin chào"},
        headers={"Idempotency-Key": "crashed-request"},
    )
    assert response.status_code == 409 and response.json()["code"] == "REQUEST_FAILED"
    retry = await client.post(
        f"/api/v1/conversations/{ident}/turns",
        json={"text": "Xin chào", "retry_message_id": sent_id},
        headers={"Idempotency-Key": "recovered-retry"},
    )
    assert "turn.completed" in retry.text
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(Message).where(Message.role == "user")) == 1


async def test_audio_cleanup_rechecks_job_created_after_initial_scan(env):
    app, client, cfg = env
    account = await register(client)
    reply = await turn(client, await conversation(client))
    factory = app.state.db
    ident = "11111111-1111-1111-1111-111111111111"
    live = cfg.data_dir / "audio" / (ident + ".part")
    orphan = cfg.data_dir / "audio" / "old-orphan.pcm"
    young = cfg.data_dir / "audio" / "new-orphan.part"
    orphan.write_bytes(b"pcm")
    young.write_bytes(b"pcm")
    os.utime(orphan, (1, 1))
    created = False

    @asynccontextmanager
    async def during_scan():
        nonlocal created
        async with factory() as db:
            yield db
        if not created:
            created = True
            async with factory() as db:
                db.add(
                    AudioJob(
                        id=ident,
                        user_id=account["id"],
                        message_id=reply["id"],
                        request_key="new-live-job",
                        cache_key="test",
                        voice_id="kore-warm",
                        parts=[],
                        status="streaming",
                        expires_at=now_ms() + 86400000,
                    )
                )
                await db.commit()
            live.write_bytes(b"pcm")
            os.utime(live, (1, 1))

    app.state.db = during_scan
    try:
        await cleanup_once(app)
    finally:
        app.state.db = factory
    assert live.exists() and young.exists() and not orphan.exists()


async def test_avatar_lifecycle_preserves_shared_references(env):
    app, client, _ = env
    await register(client)
    avatar = (await upload(client)).json()
    one = (await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))).json()
    two = (await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))).json()
    assert (await client.delete("/api/v1/avatars/" + avatar["avatar_id"])).status_code == 409
    assert (await client.delete("/api/v1/characters/" + one["id"])).status_code == 200
    assert (await client.get(avatar["image"])).status_code == 200
    await client.patch("/api/v1/characters/" + two["id"], json=profile(avatar_id=None))
    assert (await client.get(avatar["image"])).status_code == 404


@pytest.mark.parametrize("limit,value", [("MAX_ACCOUNT_AVATARS", 1), ("MAX_ACCOUNT_BYTES", 0)])
async def test_avatar_storage_is_bounded(env, monkeypatch, limit, value):
    app, client, _ = env
    await register(client)
    first = (await upload(client)).json()
    monkeypatch.setattr(catalog_api, limit, value)
    response = await upload(client)
    assert response.status_code == 429 and response.json()["code"] == "AVATAR_QUOTA_REACHED"
    assert (await client.delete("/api/v1/avatars/" + first["avatar_id"])).status_code == 200
    if limit == "MAX_ACCOUNT_AVATARS":
        assert (await upload(client)).status_code == 200


async def test_avatar_cleanup_expires_staged_images_without_deleting_attachments(env):
    app, client, _ = env
    account = await register(client)
    avatar = (await upload(client)).json()
    await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))
    async with app.state.db() as db:
        (await db.get(CharacterAvatar, avatar["avatar_id"])).created_at = 1
        orphan = CharacterAvatar(owner_id=account["id"], content=b"unused", created_at=1)
        fresh = CharacterAvatar(owner_id=account["id"], content=b"draft")
        db.add_all([orphan, fresh])
        await db.commit()
        orphan_id, fresh_id = orphan.id, fresh.id
    await cleanup_once(app)
    async with app.state.db() as db:
        assert await db.get(CharacterAvatar, orphan_id) is None
        assert await db.get(CharacterAvatar, fresh_id) is not None
        assert await db.get(CharacterAvatar, avatar["avatar_id"]) is not None


async def test_staff_preview_is_scoped_to_public_moderation_and_requires_mfa(env):
    app, client, cfg = env
    await register(client)
    avatar = (await upload(client)).json()
    pending = (
        await client.post(
            "/api/v1/characters", json=profile(visibility="public", avatar_id=avatar["avatar_id"])
        )
    ).json()
    private_avatar = (await upload(client)).json()
    private = (
        await client.post("/api/v1/characters", json=profile(avatar_id=private_avatar["avatar_id"]))
    ).json()
    client.cookies.clear()
    mod = await register(client, "moderator")
    assert (await client.get(f"/api/v1/admin/characters/{pending['id']}/preview")).status_code == 403
    async with app.state.db() as db:
        (await db.get(User, mod["id"])).role = "moderator"
        await db.commit()
    result = await client.get(f"/api/v1/admin/characters/{pending['id']}/preview")
    assert result.status_code == 200 and result.json()["scenario"] == profile()["scenario"]
    assert (await client.get(result.json()["image"])).status_code == 200
    assert (await client.get(avatar["image"])).status_code == 404
    assert (await client.get(f"/api/v1/characters/{pending['id']}")).status_code == 404
    assert (await client.get(f"/api/v1/admin/characters/{private['id']}/preview")).status_code == 404
    assert (await client.get("/api/v1/admin/avatars/" + private_avatar["avatar_id"])).status_code == 404
    cfg.environment = "production"
    assert (await client.get(result.json()["image"])).status_code == 403
    cfg.environment = "development"
    secret = (await client.post("/api/v1/auth/mfa/setup", json={"password": "CorrectHorse123!"})).json()[
        "secret"
    ]
    assert (await client.post("/api/v1/auth/mfa/confirm", json={"code": totp(secret)})).status_code == 200
    cfg.environment = "production"
    assert (await client.get(result.json()["image"])).status_code == 200


async def test_catalog_filters_before_pagination_and_search_updates(env):
    app, client, _ = env
    account = await register(client)
    async with app.state.db() as db:
        db.add(
            Character(
                id="u-older",
                owner_id=account["id"],
                data=profile(name="Café Đêm", tags=["Rare"]),
                updated_at=1,
            )
        )
        for i in range(205):
            db.add(
                Character(
                    id=f"new-public-{i}",
                    data=profile(name=f"New public {i}"),
                    visibility="public",
                    updated_at=now_ms() + i,
                )
            )
        await db.commit()
    assert len((await client.get("/api/v1/characters")).json()) == 200
    for query in ("q=cafe+dem", "tag=Rare", "ids=u-older", "mine=true"):
        assert [r["id"] for r in (await client.get("/api/v1/characters?" + query)).json()] == ["u-older"]
    await client.patch("/api/v1/characters/u-older", json=profile(name="Updated name", tags=["Rare"]))
    assert [r["id"] for r in (await client.get("/api/v1/characters?q=Updated+name")).json()] == ["u-older"]
    assert (await client.get("/api/v1/characters?q=Updated+name&limit=1&offset=1")).json() == []
    assert (await client.get("/api/v1/characters?tag=rare")).json() == []
    await client.patch("/api/v1/characters/u-older", json=profile(tags=["Tâm sự", 'quoted "tag"']))
    for tag in ["Tâm sự", 'quoted "tag"']:
        assert [r["id"] for r in (await client.get("/api/v1/characters", params={"tag": tag})).json()] == [
            "u-older"
        ]


async def test_history_composite_cursor_keeps_timestamp_ties(env):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    async with app.state.db() as db:
        for i in range(101):
            db.add(Message(conversation_id=ident, role="user", content=f"tie-{i}", created_at=123456))
        await db.commit()
    first = (await client.get(f"/api/v1/conversations/{ident}/messages")).json()
    second = (
        await client.get(
            f"/api/v1/conversations/{ident}/messages",
            params={"before": first[0]["created_at"], "before_id": first[0]["id"]},
        )
    ).json()
    assert len(first) == 100 and len(second) == 1
    assert len({m["id"] for m in first + second}) == 101


async def test_restart_rebuilds_search_after_legacy_revision_writes(env):
    app, client, _ = env
    await register(client)
    created = (await client.post("/api/v1/characters", json=profile())).json()
    # Bulk SQL bypasses the new mapper events, just like the previous app revision.
    async with app.state.db() as db:
        await db.execute(
            update(Character)
            .where(Character.id == created["id"])
            .values(data=profile(name="Legacy rename", tags=["New legacy tag"]))
        )
        await db.commit()
    await rebuild_search(app.state.db)
    for query in ({"q": "Legacy rename"}, {"tag": "New legacy tag"}):
        assert [r["id"] for r in (await client.get("/api/v1/characters", params=query)).json()] == [
            created["id"]
        ]


async def test_reconciliation_rotates_past_oldest_100_even_after_provider_failure(env, monkeypatch):
    app, client, cfg = env
    account = await register(client)
    cfg.sepay_token = "local-test-only"
    async with app.state.db() as db:
        plan = await quotas.active_plan(db, "premium")
        for i in range(101):
            db.add(
                Order(
                    user_id=account["id"],
                    invoice=f"LUMI{i:016X}",
                    request_key=f"review-order-{i}",
                    plan_id=plan.id,
                    amount_vnd=250000,
                    environment="test",
                    created_at=now_ms() - 10000 + i,
                    expires_at=now_ms() + 900000,
                )
            )
        await db.commit()
    seen = []

    async def no_wait(seconds):
        pass

    monkeypatch.setattr(worker, "asyncio", SimpleNamespace(sleep=no_wait))

    def bank(request):
        seen.append(request.url.params["q"])
        return httpx.Response(500 if len(seen) == 1 else 200, json={"data": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(bank)) as bank_client:
        with pytest.raises(RuntimeError):
            await worker.reconcile_once(cfg, app.state.db, bank_client)
        await worker.reconcile_once(cfg, app.state.db, bank_client)
    assert len(set(seen)) == 101
    assert "LUMI0000000000000064" in seen
