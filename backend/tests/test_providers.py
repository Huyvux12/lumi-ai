import asyncio
import json
from dataclasses import FrozenInstanceError
from types import SimpleNamespace

import httpx
import pytest
from conftest import REPLY, conversation, turn
from fastapi import HTTPException
from sqlalchemy import select
from test_admin import owner
from test_chat_voice import wav

from app import provider_api, provider_network
from app.models import Usage
from app.provider_config import active_llm, active_stt
from app.provider_network import SafeLLMTransport, public_addresses
from app.seed import seed
from app.token_budget import openai_tokenizer, provider_prompt_tokens

PROFILE = {
    "name": "OpenAI Test",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "key_ref": "compat",
    "reason": "Add a compatible provider",
    "json_mode": "json_object",
    "tokenizer": "o200k_base",
}


@pytest.fixture
async def admin(env, monkeypatch):
    app, client, cfg = env
    await owner(app, client)
    cfg.llm_keys = {"compat": "secret-compatible-test", "empty": ""}
    cfg.deepgram_key = "secret-deepgram-test"

    async def addresses(host):
        return ["93.184.216.34"]

    monkeypatch.setattr(provider_network, "public_addresses", addresses)
    monkeypatch.setattr(provider_api, "public_addresses", addresses)
    return app, client, cfg


async def config(client):
    response = await client.get("/api/v1/admin/providers")
    assert response.status_code == 200, response.text
    return response.json()


async def create(client, **extra):
    state = (await config(client))["selection"]
    response = await client.post(
        "/api/v1/admin/providers/llm", json={**PROFILE, "version": state["version"], **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def activate(client, **extra):
    state = (await config(client))["selection"]
    return await client.patch(
        "/api/v1/admin/providers",
        json={
            "llm_id": state["llm_id"],
            "stt_id": state["stt_id"],
            "version": state["version"],
            "reason": "Switch providers for this test",
            **extra,
        },
    )


async def test_defaults_no_secrets_persistence_and_snapshots(admin):
    app, client, cfg = admin
    initial = await config(client)
    assert initial["selection"]["llm_id"] == initial["selection"]["stt_id"] == "groq"
    ident = await create(client)
    async with app.state.db() as db:
        old = await active_llm(db, cfg)
        old_stt = await active_stt(db, cfg)
    assert (await activate(client, llm_id=ident, stt_id="deepgram")).status_code == 200
    async with app.state.db() as db:
        await seed(db)
        runtime = await active_llm(db, cfg)
        current_stt = await active_stt(db, cfg)
        assert runtime.id == ident and current_stt.id == "deepgram"
        assert runtime.key == cfg.llm_keys["compat"]
        assert old.id == old_stt.id == "groq"
        with pytest.raises(FrozenInstanceError):
            runtime.model = "modified"
    data = await config(client)
    assert next(row for row in data["llm_profiles"] if row["id"] == ident)["tokenizer"] == "o200k_base"
    all_public = (
        json.dumps(data)
        + (await client.get("/api/v1/admin/audit")).text
        + (await client.get("/api/v1/admin/dashboard")).text
    )
    assert cfg.llm_keys["compat"] not in all_public and cfg.deepgram_key not in all_public


async def test_conflicts_active_delete_and_missing_credentials(admin):
    _app, client, cfg = admin
    ident = await create(client)
    stale = (await config(client))["selection"]
    assert (await activate(client, llm_id=ident)).status_code == 200
    response = await client.patch(
        "/api/v1/admin/providers",
        json={**{k: stale[k] for k in ("llm_id", "stt_id", "version")}, "reason": "Stale admin update"},
    )
    assert response.status_code == 409
    state = (await config(client))["selection"]
    response = await client.request(
        "DELETE",
        f"/api/v1/admin/providers/llm/{ident}",
        json={"version": state["version"], "reason": "Delete active source"},
    )
    assert response.status_code == 409
    empty = await create(client, name="No credentials", key_ref="empty")
    assert (await activate(client, llm_id=empty)).status_code == 422
    cfg.deepgram_key = ""
    assert (await activate(client, stt_id="deepgram")).status_code == 422
    assert (await activate(client, llm_id="groq")).status_code == 200
    state = (await config(client))["selection"]
    assert (
        await client.request(
            "DELETE",
            f"/api/v1/admin/providers/llm/{ident}",
            json={"version": state["version"], "reason": "Delete unused source"},
        )
    ).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"base_url": "http://api.openai.com/v1"},
        {"base_url": "https://127.0.0.1/v1"},
        {"base_url": "https://api.openai.com:8000/v1"},
        {"base_url": "https://api.openai.com/v1?key=secret"},
        {"base_url": "https://user:pass@api.openai.com/v1"},
        {"base_url": "https://evil.example/v1"},
        {"base_url": "https://api.openai.com.evil.example/v1"},
        {"key_ref": "unknown"},
        {"input_price": 1},
        {"temperature": 3},
        {"json_mode": "arbitrary"},
        {"api_key": "not-accepted"},
    ],
)
async def test_profile_validation_and_endpoint_allowlist(admin, changes):
    _, client, _ = admin
    state = (await config(client))["selection"]
    response = await client.post(
        "/api/v1/admin/providers/llm", json={**PROFILE, "version": state["version"], **changes}
    )
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("mode", ["json_object", "json_schema", "prompt"])
async def test_compatible_llm_payload_and_actual_chat_usage(admin, mode):
    app, client, cfg = admin
    ident = await create(
        client,
        json_mode=mode,
        token_parameter="max_completion_tokens",
        temperature=0.5,
        reasoning_effort="low",
        input_price=2,
        output_price=5,
    )
    seen = []

    async def upstream(request):
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(REPLY)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1000, "completion_tokens": 200, "debug": "must not persist"},
            },
        )

    guard = SafeLLMTransport(cfg, httpx.MockTransport(upstream))
    async with httpx.AsyncClient(transport=guard) as compatible:
        app.state.compatible_http = compatible
        assert (await activate(client, llm_id=ident)).status_code == 200
        answer = await turn(client, await conversation(client))
    assert answer["segments"]
    request = seen[0]
    assert request.url.host == "93.184.216.34" and request.headers["host"] == "api.openai.com"
    assert request.extensions["sni_hostname"] == "api.openai.com"
    assert request.headers["Authorization"] == "Bearer secret-compatible-test"
    payload = json.loads(request.content)
    assert payload["model"] == "gpt-4o-mini" and payload["max_completion_tokens"] == 400
    assert "max_tokens" not in payload and payload["reasoning_effort"] == "low"
    if mode == "prompt":
        assert "response_format" not in payload
    else:
        assert payload["response_format"]["type"] == mode
        if mode == "json_schema":
            schema = payload["response_format"]["json_schema"]["schema"]
            assert schema["additionalProperties"] is False and "segments" in schema["required"]
            assert "oneOf" not in json.dumps(schema) and "discriminator" not in json.dumps(schema)
    async with app.state.db() as db:
        usage = await db.scalar(select(Usage).where(Usage.kind == "chat"))
        assert usage.provider_usage["model"] == "gpt-4o-mini"
        assert usage.provider_usage["estimated_cost_usd"] == 0.003
        assert "debug" not in usage.provider_usage
    dashboard = (await client.get("/api/v1/admin/dashboard")).json()
    assert dashboard["usage"]["llm_estimated_usd"] == 0.003
    assert dashboard["services"]["llm"]["name"] == "OpenAI Test"


async def test_probes_do_not_activate_and_release_failed_usage(admin):
    app, client, cfg = admin
    ident = await create(client)
    state = (await config(client))["selection"]
    result = await client.post(
        f"/api/v1/admin/providers/llm/{ident}/test", json={"version": state["version"], "text": "Xin chào"}
    )
    assert result.status_code == 200, result.text
    assert result.json()["provider_id"] == ident and "tts_text" not in result.text
    assert (await config(client))["selection"]["llm_id"] == "groq"

    async def bad(request):
        return httpx.Response(429, json={"error": "secret-compatible-test"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(bad)) as upstream:
        app.state.http = upstream
        response = await client.post(
            "/api/v1/admin/providers/stt/deepgram/test",
            files={"file": ("probe.wav", wav(), "audio/wav")},
            data={"version": state["version"]},
        )
        assert response.status_code == 502 and cfg.deepgram_key not in response.text
    async with app.state.db() as db:
        rows = (
            await db.scalars(
                select(Usage)
                .where(Usage.kind.in_(("admin_test", "admin_stt_test")))
                .order_by(Usage.created_at)
            )
        ).all()
        assert {row.status for row in rows} == {"committed", "released"}
    assert (await config(client))["selection"]["stt_id"] == "groq"


async def test_nova3_raw_wav_vietnamese_quota_and_user_flow(admin):
    app, client, _cfg = admin
    assert (await activate(client, stt_id="deepgram")).status_code == 200
    seen = []

    async def upstream(request):
        seen.append(request)
        assert request.url.params["model"] == "nova-3" and request.url.params["language"] == "vi"
        assert request.headers["authorization"] == "Token secret-deepgram-test"
        assert request.headers["content-type"] == "audio/wav" and request.content.startswith(b"RIFF")
        return httpx.Response(
            200,
            json={
                "results": {
                    "channels": [{"alternatives": [{"transcript": "  Xin chào, mình nói tiếng Việt.  "}]}]
                },
                "metadata": {"duration": 2},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        app.state.http = http
        response = await client.post(
            "/api/v1/speech/transcriptions",
            files={"file": ("voice.wav", wav(), "audio/wav")},
            headers={"Idempotency-Key": "nova-test-123"},
        )
    assert response.status_code == 200 and response.json() == {"text": "Xin chào, mình nói tiếng Việt."}
    assert len(seen) == 1
    async with app.state.db() as db:
        row = await db.scalar(select(Usage).where(Usage.kind == "stt"))
        assert row.amount == 2000 and row.status == "committed"
        assert row.provider_usage["provider"] == "deepgram" and row.provider_usage["model"] == "nova-3"


@pytest.mark.parametrize("kind", ["empty", "malformed", "timeout", "429", "401"])
async def test_stt_failure_releases_quota_without_fallback(admin, kind):
    app, client, _ = admin
    await activate(client, stt_id="deepgram")
    calls = []

    def upstream(request):
        calls.append(request.url.host)
        if kind == "timeout":
            raise httpx.ReadTimeout("upstream secret error")
        if kind in {"429", "401"}:
            return httpx.Response(int(kind), json={"error": "upstream secret error"})
        if kind == "malformed":
            return httpx.Response(200, json={"results": {}})
        return httpx.Response(
            200, json={"results": {"channels": [{"alternatives": [{"transcript": "   "}]}]}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        app.state.http = http
        result = await client.post(
            "/api/v1/speech/transcriptions",
            files={"file": ("voice.wav", wav(), "audio/wav")},
            headers={"Idempotency-Key": "nova-fail-123"},
        )
    assert result.status_code == (422 if kind == "empty" else 502), result.text
    assert "secret error" not in result.text and calls == ["api.deepgram.com"]
    async with app.state.db() as db:
        assert (await db.scalar(select(Usage).where(Usage.kind == "stt"))).status == "released"


@pytest.mark.parametrize(
    "kind", ["invalid-json", "empty-choices", "invalid-segments", "length", "429", "timeout", "redirect"]
)
async def test_llm_failure_is_bounded_no_fallback_and_no_charge(admin, kind):
    app, client, cfg = admin
    ident = await create(client)
    await activate(client, llm_id=ident)
    calls = []

    def upstream(request):
        calls.append(request)
        if kind == "timeout":
            raise httpx.ReadTimeout("provider secret")
        if kind == "429":
            return httpx.Response(429, json={"error": "provider secret"})
        if kind == "redirect":
            return httpx.Response(302, headers={"location": "http://127.0.0.1/metadata"})
        if kind == "invalid-json":
            return httpx.Response(200, text="not JSON")
        if kind == "empty-choices":
            return httpx.Response(200, json={"choices": []})
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "wrong schema" if kind == "invalid-segments" else json.dumps(REPLY)
                        },
                        "finish_reason": "length" if kind == "length" else "stop",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=SafeLLMTransport(cfg, httpx.MockTransport(upstream))) as http:
        app.state.compatible_http = http
        convo = await conversation(client)
        response = await client.post(
            f"/api/v1/conversations/{convo}/turns",
            json={"text": "Xin chào"},
            headers={"Idempotency-Key": "provider-fail-123"},
        )
    assert "turn.failed" in response.text and "provider secret" not in response.text
    assert 1 <= len(calls) <= 2 and all(r.headers["host"] == "api.openai.com" for r in calls)
    async with app.state.db() as db:
        assert (await db.scalar(select(Usage).where(Usage.kind == "chat"))).status == "released"


async def test_roles_mfa_csrf_and_missing_key(env):
    app, client, cfg = env
    user = await owner(app, client)
    from app.models import User

    for role in ("user", "moderator"):
        async with app.state.db() as db:
            (await db.get(User, user["id"])).role = role
            await db.commit()
        assert (await client.get("/api/v1/admin/providers")).status_code == 403
        assert (
            await client.patch(
                "/api/v1/admin/providers",
                json={"llm_id": "groq", "stt_id": "deepgram", "version": 1, "reason": "Forbidden selection"},
            )
        ).status_code == 403
    async with app.state.db() as db:
        (await db.get(User, user["id"])).role = "admin"
        await db.commit()
    cfg.environment = "production"
    assert (await client.get("/api/v1/admin/providers")).status_code == 403
    cfg.environment = "development"
    assert (
        await client.patch(
            "/api/v1/admin/providers",
            json={"llm_id": "groq", "stt_id": "deepgram", "version": 1, "reason": "Missing credentials"},
        )
    ).status_code == 422
    del client.headers["X-Lumi-Request"]
    assert (
        await client.patch(
            "/api/v1/admin/providers",
            json={"llm_id": "groq", "stt_id": "groq", "version": 1, "reason": "CSRF attempt"},
        )
    ).status_code == 403


async def test_private_dns_rejected_and_public_tls_is_pinned(monkeypatch):
    loop = asyncio.get_running_loop()

    async def private(*args, **kwargs):
        return [(2, 1, 6, "", ("169.254.169.254", 443))]

    monkeypatch.setattr(loop, "getaddrinfo", private)
    with pytest.raises(HTTPException) as error:
        await public_addresses("api.openai.com")
    assert error.value.status_code == 422

    async def mixed(*args, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 443)), (2, 1, 6, "", ("127.0.0.1", 443))]

    monkeypatch.setattr(loop, "getaddrinfo", mixed)
    with pytest.raises(HTTPException):
        await public_addresses("api.openai.com")
    seen = []

    async def public(*args, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 443))]

    monkeypatch.setattr(loop, "getaddrinfo", public)

    def upstream(request):
        seen.append(request)
        return httpx.Response(200, json={})

    async with httpx.AsyncClient(
        transport=SafeLLMTransport(
            SimpleNamespace(llm_allowed_hosts=["api.openai.com"]), httpx.MockTransport(upstream)
        )
    ) as http:
        await http.post("https://api.openai.com/v1/chat/completions", json={})
    assert seen[0].url.host == "93.184.216.34" and seen[0].extensions["sni_hostname"] == "api.openai.com"


def test_tokenizer_assets_work_offline_and_keep_context_bounded():
    assert openai_tokenizer("o200k_base").encode("hello world") == [24912, 2375]
    assert openai_tokenizer("cl100k_base").encode("hello world") == [15339, 1917]
    messages = [{"role": "user", "content": "Xin chào, mình muốn kể chuyện."}]
    assert provider_prompt_tokens(messages, "o200k_base") < provider_prompt_tokens(messages, "utf8")


async def test_inflight_llm_keeps_snapshot_while_admin_changes_source(admin):
    app, client, cfg = admin
    first = await create(client, name="First model", model="gpt-4o-mini")
    second = await create(client, name="Second model", model="gpt-4o")
    await activate(client, llm_id=first)
    started, release = asyncio.Event(), asyncio.Event()
    seen = []

    async def upstream(request):
        seen.append(json.loads(request.content)["model"])
        if len(seen) == 1:
            started.set()
            await release.wait()
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(REPLY)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            },
        )

    async with httpx.AsyncClient(transport=SafeLLMTransport(cfg, httpx.MockTransport(upstream))) as http:
        app.state.compatible_http = http
        convo = await conversation(client)
        task = asyncio.create_task(turn(client, convo, "snapshot-turn-111"))
        try:
            await asyncio.wait_for(started.wait(), 5)
            assert (await activate(client, llm_id=second)).status_code == 200
        finally:
            release.set()
        await task
        await turn(client, convo, "snapshot-turn-222")
    assert seen == ["gpt-4o-mini", "gpt-4o"]
    async with app.state.db() as db:
        rows = (await db.scalars(select(Usage).where(Usage.kind == "chat").order_by(Usage.created_at))).all()
        assert [row.provider_usage["profile_id"] for row in rows] == [first, second]


async def test_price_edit_does_not_reprice_history_and_unknown_rates_are_explicit(admin):
    _app, client, _ = admin
    ident = await create(client, input_price=2, output_price=5)
    await activate(client, llm_id=ident)
    await turn(client, await conversation(client), "priced-request-111")
    before = (await client.get("/api/v1/admin/dashboard")).json()["usage"]["llm_estimated_usd"]
    state = (await config(client))["selection"]
    result = await client.put(
        f"/api/v1/admin/providers/llm/{ident}",
        json={**PROFILE, "version": state["version"], "input_price": 100, "output_price": 100},
    )
    assert result.status_code == 200, result.text
    assert (await client.get("/api/v1/admin/dashboard")).json()["usage"]["llm_estimated_usd"] == before
    unknown = await create(client, name="Unpriced source")
    await activate(client, llm_id=unknown)
    await turn(client, await conversation(client), "unpriced-request-222")
    usage = (await client.get("/api/v1/admin/dashboard")).json()["usage"]
    assert usage["llm_estimated_usd"] == before and usage["unpriced_llm_requests"] == 1


async def test_stt_snapshot_and_probe_limits(admin):
    app, client, _cfg = admin
    started, release = asyncio.Event(), asyncio.Event()

    async def upstream(request):
        if request.url.path.endswith("/transcriptions"):
            started.set()
            await release.wait()
            return httpx.Response(200, json={"text": "Groq started first", "duration": 2})
        return httpx.Response(
            200, json={"results": {"channels": [{"alternatives": [{"transcript": "Nova next"}]}]}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        app.state.http = http
        task = asyncio.create_task(
            client.post(
                "/api/v1/speech/transcriptions",
                files={"file": ("voice.wav", wav(), "audio/wav")},
                headers={"Idempotency-Key": "snapshot-stt-111"},
            )
        )
        try:
            await asyncio.wait_for(started.wait(), 5)
            assert (await activate(client, stt_id="deepgram")).status_code == 200
        finally:
            release.set()
        assert (await task).json()["text"] == "Groq started first"
        result = await client.post(
            "/api/v1/speech/transcriptions",
            files={"file": ("voice.wav", wav(), "audio/wav")},
            headers={"Idempotency-Key": "snapshot-stt-222"},
        )
        assert result.json()["text"] == "Nova next"
    state = (await config(client))["selection"]
    result = await client.post(
        "/api/v1/admin/providers/stt/deepgram/test",
        files={"file": ("long.wav", wav(31), "audio/wav")},
        data={"version": state["version"]},
    )
    assert result.status_code == 422
    async with app.state.db() as db:
        rows = (await db.scalars(select(Usage).where(Usage.kind == "stt").order_by(Usage.created_at))).all()
        assert [row.provider_usage["provider"] for row in rows] == ["groq", "deepgram"]


def test_provider_secret_json_configuration(monkeypatch):
    from app.config import Settings

    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEYS_JSON", raising=False)
    monkeypatch.delenv("LLM_ALLOWED_HOSTS", raising=False)
    monkeypatch.setenv(
        "AI_PROVIDER_CONFIG_JSON",
        json.dumps(
            {
                "deepgram_api_key": "deepgram-secret",
                "llm_api_keys": {"compat": "compatible-secret"},
                "llm_allowed_hosts": ["api.openai.com"],
            }
        ),
    )
    cfg = Settings()
    cfg.validate()
    assert cfg.deepgram_key == "deepgram-secret" and cfg.llm_keys == {"compat": "compatible-secret"}
    monkeypatch.setenv("DEEPGRAM_API_KEY", "override")
    assert Settings().deepgram_key == "override"


async def test_full_nova_compatible_llm_gemini_voice_pipeline(admin):
    _app, client, _ = admin
    ident = await create(client)
    assert (await activate(client, llm_id=ident, stt_id="deepgram")).status_code == 200
    result = await client.post(
        "/api/v1/speech/transcriptions",
        files={"file": ("voice.wav", wav(), "audio/wav")},
        headers={"Idempotency-Key": "full-voice-stt-123"},
    )
    assert result.status_code == 200, result.text
    convo = await conversation(client)
    response = await client.post(
        f"/api/v1/conversations/{convo}/turns",
        json={"text": result.json()["text"]},
        headers={"Idempotency-Key": "full-voice-chat-123"},
    )
    frames = [
        json.loads(frame.split("data: ")[1])
        for frame in response.text.strip().split("\n\n")
        if "data: " in frame
    ]
    answer = frames[-1]["message"]
    tts = await client.post(
        f"/api/v1/messages/{answer['id']}/tts", json={}, headers={"Idempotency-Key": "full-voice-tts-123"}
    )
    assert tts.status_code == 200, tts.text
    audio = await client.get(tts.json()["stream_url"])
    assert audio.status_code == 200 and len(audio.content) == 4800
