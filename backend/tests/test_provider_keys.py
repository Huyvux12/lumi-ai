"""Credential storage, owner permissions, request snapshots and secret redaction."""
# ruff: noqa: F811 -- pytest injects the imported fixture into test parameters.

from dataclasses import replace

import httpx
import pytest
from conftest import register
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from test_chat_voice import wav
from test_providers import activate, admin, config, create  # noqa: F401 -- shared fixture

from app.config import Settings
from app.models import Audit, ProviderCredential, User
from app.provider_config import active_llm, active_stt
from app.provider_credentials import credential_cipher, resolve_key
from app.provider_key_api import KeyInput
from app.security import encryption

KEY = "sk-test-admin-credential-ABCD"


async def put(client, ident, value=KEY, **extra):
    state = (await config(client))["selection"]
    return await client.put(
        "/api/v1/admin/providers/keys/" + ident,
        json={"version": state["version"], "api_key": value, **extra},
    )


async def remove(client, ident):
    state = (await config(client))["selection"]
    return await client.request(
        "DELETE", "/api/v1/admin/providers/keys/" + ident, json={"version": state["version"]}
    )


async def metadata(client):
    response = await client.get("/api/v1/admin/providers/keys")
    assert response.status_code == 200, response.text
    return {item["id"]: item for item in response.json()["keys"]}


async def test_owner_without_mfa_can_store_encrypted_key_and_only_read_suffix(admin):
    app, client, cfg = admin
    assert (await client.get("/api/v1/me")).json()["mfa_enabled"] is False
    response = await put(client, "groq")
    assert response.status_code == 200, response.text
    view = (await metadata(client))["groq"]
    assert view["source"] == "admin" and view["suffix"] == "ABCD"
    assert view["active"] and view["server_configured"]
    async with app.state.db() as db:
        row = await db.get(ProviderCredential, "groq")
        assert KEY not in row.ciphertext
        assert credential_cipher(cfg).decrypt(row.ciphertext.encode()).decode() == "groq\n" + KEY
        audit = (await db.scalars(select(Audit).where(Audit.action == "provider.key.save"))).one()
        assert audit.target == "groq" and audit.details == {}
    public = response.text
    for path in (
        "/admin/providers/keys",
        "/admin/providers",
        "/admin/audit",
        "/admin/dashboard",
        "/admin/summary",
    ):
        result = await client.get("/api/v1" + path)
        assert result.status_code == 200, result.text
        public += result.text
    assert KEY not in public and "ciphertext" not in public
    assert cfg.groq_key not in (await client.get("/api/v1/admin/providers/keys")).text
    assert (await client.get("/api/v1/admin/providers/keys/groq")).status_code == 405
    assert "**********" in repr(KeyInput(version=1, api_key=KEY))


@pytest.mark.parametrize("role", ["user", "moderator", "admin"])
async def test_only_owner_can_read_or_modify_key_metadata(env, role):
    app, client, _ = env
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = role
        await db.commit()
    for method, path, body in (
        ("GET", "/keys", None),
        ("PUT", "/keys/groq", {"version": 1, "api_key": KEY}),
        ("DELETE", "/keys/groq", {"version": 1}),
    ):
        assert (await client.request(method, "/api/v1/admin/providers" + path, json=body)).status_code == 403
    if role == "admin":
        assert not (await config(client))["can_manage_keys"]


async def test_anonymous_and_csrf_cannot_manage_keys(env):
    app, client, _ = env
    assert (await client.get("/api/v1/admin/providers/keys")).status_code == 401
    from test_admin import owner

    await owner(app, client)
    response = await client.put(
        "/api/v1/admin/providers/keys/groq",
        headers={"Origin": "https://evil.example"},
        json={"version": 1, "api_key": KEY},
    )
    assert response.status_code == 403
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=client.cookies
    ) as unsafe:
        response = await unsafe.put("/api/v1/admin/providers/keys/groq", json={"version": 1, "api_key": KEY})
        assert response.status_code == 403


@pytest.mark.parametrize(
    "value",
    ["short", "secret\nHEADER:value", "secret value", "secret\x7fvalue", "khóa-bí-mật-123", "x" * 8193],
)
async def test_invalid_keys_are_rejected_without_echoing_input(admin, value):
    _, client, _ = admin
    response = await put(client, "groq", value)
    assert response.status_code == 422, response.text
    assert value not in response.text


@pytest.mark.parametrize("ident", ["llm:groq", "bad", "llm:", "llm:bad.name"])
async def test_invalid_target_is_rejected(admin, ident):
    _, client, _ = admin
    assert (await put(client, ident)).status_code == 422


async def test_rotation_changes_new_snapshots_and_shared_groq_stt(admin):
    app, client, cfg = admin
    async with app.state.db() as db:
        original = await active_llm(db, cfg)
    assert (await put(client, "groq")).status_code == 200
    async with app.state.db() as db:
        first = await active_llm(db, cfg)
        assert first.key == (await active_stt(db, cfg)).key == KEY
    second = "sk-rotated-credential-EFGH"
    assert (await put(client, "groq", second)).status_code == 200
    async with app.state.db() as db:
        assert (await active_llm(db, cfg)).key == second
    assert first.key == KEY and original.key == cfg.groq_key
    assert KEY not in repr(first) and second not in repr(await active_stt_snapshot(app, cfg))
    assert (await remove(client, "groq")).json()["restored_server_key"] is True
    async with app.state.db() as db:
        assert (await active_llm(db, cfg)).key == cfg.groq_key
    assert (await metadata(client))["groq"]["source"] == "server"


async def active_stt_snapshot(app, cfg):
    async with app.state.db() as db:
        return await active_stt(db, cfg)


async def test_new_compatible_reference_works_and_active_last_key_cannot_be_deleted(admin):
    app, client, cfg = admin
    assert (await put(client, "llm:new_source")).status_code == 200
    ident = await create(client, key_ref="new_source")
    assert (await activate(client, llm_id=ident)).status_code == 200
    async with app.state.db() as db:
        assert (await active_llm(db, cfg)).key == KEY
    view = (await metadata(client))["llm:new_source"]
    assert view["active"] and "LLM · OpenAI Test" in view["used_by"]
    assert (await remove(client, "llm:new_source")).status_code == 409
    assert (await activate(client, llm_id="groq")).status_code == 200
    assert (await remove(client, "llm:new_source")).status_code == 200
    data = await config(client)
    assert not next(item for item in data["llm_profiles"] if item["id"] == ident)["configured"]
    assert not (await metadata(client))["llm:new_source"]["configured"]
    assert (await activate(client, llm_id=ident)).status_code == 422


async def test_saved_keys_reach_real_adapter_and_probes_do_not_activate(admin):
    app, client, cfg = admin
    assert (await put(client, "llm:compat")).status_code == 200
    assert (await put(client, "deepgram")).status_code == 200
    ident = await create(client)
    seen = []
    from conftest import provider

    def upstream(request):
        seen.append((request.url.path, request.headers["Authorization"]))
        return provider(request)

    # Replace injected transports; both production adapters still run.
    app.state.compatible_http._transport.test_transport = httpx.MockTransport(upstream)
    app.state.compatible_http._transport.transports.clear()
    previous = app.state.http
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        app.state.http = http
        try:
            state = (await config(client))["selection"]
            response = await client.post(
                f"/api/v1/admin/providers/llm/{ident}/test",
                json={"version": state["version"], "text": "Xin chào"},
            )
            assert response.status_code == 200, response.text
            response = await client.post(
                "/api/v1/admin/providers/stt/deepgram/test",
                data={"version": state["version"]},
                files={"file": ("probe.wav", wav(), "audio/wav")},
            )
            assert response.status_code == 200, response.text
        finally:
            app.state.http = previous
    assert ("/v1/chat/completions", "Bearer " + KEY) in seen
    assert ("/v1/listen", "Token " + KEY) in seen
    assert (await config(client))["selection"]["llm_id"] == "groq"
    assert cfg.llm_keys["compat"] != KEY and cfg.deepgram_key != KEY


async def test_stale_version_cannot_overwrite_or_delete_a_key(admin):
    _, client, _ = admin
    stale = (await config(client))["selection"]["version"]
    assert (await put(client, "groq")).status_code == 200
    assert (await put(client, "groq", "another-secret-EFGH", version=stale)).status_code == 409
    response = await client.request("DELETE", "/api/v1/admin/providers/keys/groq", json={"version": stale})
    assert response.status_code == 409
    assert (await metadata(client))["groq"]["suffix"] == "ABCD"


async def test_wrong_master_and_row_swapping_fail_closed_and_owner_can_reenter(admin):
    app, client, cfg = admin
    assert (await put(client, "groq")).status_code == 200
    async with app.state.db() as db:
        with pytest.raises(HTTPException) as error:
            await resolve_key(db, replace(cfg, credential_key=Fernet.generate_key().decode()), "groq")
        assert error.value.status_code == 503
        db.add(
            ProviderCredential(
                id="deepgram", ciphertext=(await db.get(ProviderCredential, "groq")).ciphertext, suffix="ABCD"
            )
        )
        await db.commit()
    state = (await config(client))["selection"]
    response = await client.post(
        "/api/v1/admin/providers/stt/deepgram/test",
        data={"version": state["version"]},
        files={"file": ("probe.wav", wav(), "audio/wav")},
    )
    assert response.status_code == 503 and response.json()["code"] == "CREDENTIAL_UNAVAILABLE"
    assert KEY not in response.text
    assert (await put(client, "deepgram", "recovered-secret-1234")).status_code == 200
    async with app.state.db() as db:
        assert await resolve_key(db, cfg, "deepgram") == "recovered-secret-1234"


def test_credential_encryption_is_separate_from_mfa_and_invalid_configuration_is_redacted(tmp_path):
    cfg = Settings(data_dir=tmp_path, mfa_key=Fernet.generate_key().decode(), credential_key="")
    token = credential_cipher(cfg).encrypt(KEY.encode())
    from cryptography.fernet import InvalidToken

    with pytest.raises(InvalidToken):
        encryption(cfg).decrypt(token)
    cfg.credential_key = "invalid-secret-master-key"
    with pytest.raises(RuntimeError, match="must be a Fernet key") as error:
        cfg.validate()
    assert cfg.credential_key not in str(error.value)
