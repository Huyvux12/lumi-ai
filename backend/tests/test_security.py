import re
import httpx
from sqlalchemy import select
from app.models import Character, User
from app.security import totp
from conftest import register, conversation, turn


async def test_session_password_spaces_and_csrf(env):
    app, client, cfg = env
    password = "  Password spaces!  "
    await register(client, password=password)
    assert "HttpOnly" in client.cookies.jar._cookies["test.local"]["/"]["lumi_session"]._rest
    cookie = client.cookies.get("lumi_session")
    assert cookie != "1" and len(cookie) > 30
    result = await client.patch("/api/v1/me", headers={"X-Lumi-Request": ""}, json={"bio": "new"})
    assert result.status_code == 403
    result = await client.patch("/api/v1/me", headers={"Origin": "https://evil.example"}, json={"bio": "new"})
    assert result.status_code == 403
    await client.post("/api/v1/auth/logout")
    assert (await client.get("/api/v1/me")).status_code == 401
    result = await client.post(
        "/api/v1/auth/login", json={"email": "alice@example.com", "password": password}
    )
    assert result.status_code == 200
    await client.post("/api/v1/auth/logout")
    assert (
        await client.post(
            "/api/v1/auth/login", json={"email": "alice@example.com", "password": password.strip()}
        )
    ).status_code == 401


async def test_registration_cannot_set_role_or_leak_password(env):
    _, client, _ = env
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "alice@example.com",
            "password": "TopSecret!",
            "name": "Alice",
            "username": "alice",
            "role": "owner",
        },
    )
    assert response.status_code == 422
    assert "TopSecret" not in response.text and "input" not in response.json()
    await register(client)
    assert (await client.get("/api/v1/admin/users")).status_code == 403
    client.cookies.set("lumi_session", "1")
    assert (await client.get("/api/v1/me")).status_code == 401


async def test_cross_account_ownership_and_private_character(env):
    app, client, _ = env
    alice = await register(client)
    ident = await conversation(client)
    answer = await turn(client, ident)
    response = await client.post(
        "/api/v1/characters",
        json={
            "name": "A private friend",
            "tagline": "A private friend to chat with",
            "description": "A fictional friend created for privacy tests.",
            "persona": "Friendly and thoughtful. Speaks in gentle short sentences.",
            "greeting": "Hello, how are you doing today?",
            "tags": ["Bạn bè"],
            "hue": 265,
            "seed": "alice",
            "visibility": "private",
        },
    )
    assert response.status_code == 200, response.text
    character = response.json()
    assert character["owner"] == alice["id"] and alice["email"] not in response.text
    await client.post("/api/v1/auth/logout")
    await register(client, "bobby")
    for path in [
        f"/conversations/{ident}",
        f"/conversations/{ident}/messages",
        f"/characters/{character['id']}",
    ]:
        assert (await client.get("/api/v1" + path)).status_code == 404
    result = await client.post(
        f"/api/v1/messages/{answer['id']}/tts", json={}, headers={"Idempotency-Key": "other-user-123"}
    )
    assert result.status_code == 404
    assert (await client.delete("/api/v1/characters/" + character["id"])).status_code == 404
    assert (await client.get("/api/v1/conversations")).json() == []
    await client.post("/api/v1/auth/logout")
    async with app.state.db() as db:
        c = await db.get(Character, "kaito-kid")
        c.status = "hidden"
        await db.commit()
    assert (await client.get("/api/v1/characters/kaito-kid")).status_code == 404


async def test_reset_single_use_revokes_sessions(env):
    app, client, cfg = env
    await register(client)
    await client.post("/api/v1/auth/forgot-password", json={"email": "alice@example.com"})
    mails = list((cfg.data_dir / "outbox").glob("*.eml"))
    from email import policy
    from email.parser import BytesParser

    text = "\n".join(
        BytesParser(policy=policy.default).parsebytes(p.read_bytes()).get_content() for p in mails
    )
    token = re.search(r"reset-password\?token=([\w-]+)", text).group(1)
    response = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "AnotherPassword123!"}
    )
    assert response.status_code == 200
    assert (await client.get("/api/v1/me")).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/reset-password", json={"token": token, "password": "ThirdPassword123!"}
        )
    ).status_code == 400
    assert (
        await client.post(
            "/api/v1/auth/login", json={"email": "alice@example.com", "password": "AnotherPassword123!"}
        )
    ).status_code == 200


async def test_mfa_login_and_admin_quota(env):
    app, client, cfg = env
    user = await register(client)
    async with app.state.db() as db:
        row = await db.get(User, user["id"])
        row.role = "owner"
        await db.commit()
    result = await client.post("/api/v1/auth/mfa/setup", json={"password": "CorrectHorse123!"})
    secret = result.json()["secret"]
    assert (await client.post("/api/v1/auth/mfa/confirm", json={"code": totp(secret)})).status_code == 200
    assert (await client.get("/api/v1/admin/users/" + user["id"] + "/usage")).status_code == 200
    await client.post("/api/v1/auth/logout")
    assert (
        await client.post("/api/v1/auth/login", json={"email": user["email"], "password": "CorrectHorse123!"})
    ).status_code == 401
    result = await client.post(
        "/api/v1/auth/login",
        json={"email": user["email"], "password": "CorrectHorse123!", "totp_code": totp(secret)},
    )
    assert result.status_code == 200
    assert "secret" not in result.text


async def test_oversized_body_is_rejected_without_echo(env):
    app, client, cfg = env
    response = await client.post(
        "/api/v1/auth/register", content=b"x" * 300000, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json()["code"] == "BODY_TOO_LARGE"
