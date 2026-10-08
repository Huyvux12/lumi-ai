import json

import pytest
from conftest import conversation, register
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import Settings
from app.models import Audit, AuthToken, User
from app.render_demo import bootstrap_owner
from app.security import encryption, totp, verify_password


def demo_settings(**overrides):
    return Settings(
        **{
            "environment": "render-demo",
            "database_url": "postgresql://demo:secret@db/demo",
            "public_url": "https://demo.onrender.com",
            "auto_migrate": False,
            "mfa_key": Fernet.generate_key().decode(),
            "redis_url": "",
            "demo_owner_password": "A-long-demo-password-123!",
            "sepay_environment": "test",
            **overrides,
        }
    )


def test_demo_validation_and_production_guards(monkeypatch):
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://assigned-name.onrender.com")
    assert Settings().public_url == "https://assigned-name.onrender.com"
    cfg = demo_settings()
    cfg.validate()
    assert cfg.database_url.startswith("postgresql+asyncpg://")
    assert cfg.production and cfg.sample_replies
    for override in (
        {"public_url": "http://demo.example"},
        {"database_url": "sqlite+aiosqlite:///demo.db"},
        {"sepay_environment": "live"},
        {"mfa_key": ""},
        {"demo_owner_password": "short"},
        {"auto_migrate": True},
        {"environment": "production"},
        {"environment": "production", "redis_url": "redis://cache", "demo_llm": True},
    ):
        with pytest.raises((RuntimeError, ValueError)):
            demo_settings(**override).validate()
    cfg.groq_key = "configured"
    assert not cfg.sample_replies


@pytest.fixture
async def demo_env(env):
    # Reuse the SQLite/Postgres test harness while exercising hosted security.
    app, client, cfg = env
    cfg.environment = "render-demo"
    cfg.public_url = "https://test"
    cfg.groq_key = ""
    cfg.demo_owner_password = "A-long-demo-password-123!"
    cfg.mfa_key = Fernet.generate_key().decode()
    client.base_url = "https://test"
    yield app, client, cfg


async def test_demo_signup_chat_and_disabled_services(demo_env):
    app, client, cfg = demo_env
    result = await register(client)
    assert result["email_verified"] is False
    cookie = next(c for c in client.cookies.jar if c.name == "lumi_session")
    assert cookie.secure and cookie.has_nonstandard_attr("HttpOnly")
    assert not (cfg.data_dir / "outbox").exists()
    async with app.state.db() as db:
        assert (await db.execute(select(AuthToken))).scalars().all() == []
    ident = await conversation(client)
    reply = await client.post(
        f"/api/v1/conversations/{ident}/turns",
        json={"text": "Xin chào"},
        headers={"Idempotency-Key": "render-demo-turn-123"},
    )
    frames = [json.loads(f.split("data: ")[1]) for f in reply.text.strip().split("\n\n")]
    assert frames[-1]["mode"] == "demo"
    assert "message" in frames[-1]
    for path, payload in [
        ("/auth/forgot-password", {"email": "alice@example.com"}),
        ("/auth/forgot-password", {"email": "unknown@example.com"}),
        ("/auth/resend-verification", None),
        ("/billing/orders", None),
        ("/payments/sepay/webhook", {}),
    ]:
        response = await client.post(
            "/api/v1" + path, json=payload, headers={"Idempotency-Key": "demo-payment-123"}
        )
        assert response.status_code == 503
    rejected = await client.patch("/api/v1/me", headers={"Origin": "https://evil.example"}, json={"bio": "x"})
    assert rejected.status_code == 403


async def test_demo_owner_restart_preserves_credentials_and_mfa(demo_env):
    app, client, cfg = demo_env
    original_password = cfg.demo_owner_password
    await bootstrap_owner(cfg)
    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": cfg.demo_owner_email,
            "password": original_password,
        },
    )
    assert login.status_code == 200
    assert (await client.get("/api/v1/admin/summary")).json()["code"] == "MFA_REQUIRED"
    setup = await client.post("/api/v1/auth/mfa/setup", json={"password": original_password})
    secret = setup.json()["secret"]
    assert (await client.post("/api/v1/auth/mfa/confirm", json={"code": totp(secret)})).status_code == 200
    assert (await client.get("/api/v1/admin/summary")).status_code == 200
    cfg.demo_owner_password = "Changed-env-must-not-reset-password!"
    await bootstrap_owner(cfg)
    async with app.state.db() as db:
        user = (await db.execute(select(User).where(User.email == cfg.demo_owner_email))).scalar_one()
        assert verify_password(user.password_hash, original_password)
        assert encryption(cfg).decrypt(user.mfa_secret.encode()).decode() == secret
        assert (
            len((await db.execute(select(Audit).where(Audit.action == "owner.bootstrap"))).scalars().all())
            == 1
        )


async def test_demo_bootstrap_never_promotes_existing_user(demo_env):
    app, client, cfg = demo_env
    user = await register(client, "render_owner")
    with pytest.raises(RuntimeError, match="conflicts"):
        await bootstrap_owner(cfg)
    async with app.state.db() as db:
        assert (await db.get(User, user["id"])).role == "user"
