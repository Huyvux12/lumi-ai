"""Check the real Render container through its public Next.js proxy (CI only)."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = os.getenv("DEMO_TEST_URL", "http://127.0.0.1:10000")
ORIGIN = "https://demo.example.com"
cookies = {}


def request(path, body=None, *, expected=200, method=None):
    headers = {
        "Origin": ORIGIN,
        "X-Lumi-Request": "1",
        "Idempotency-Key": secrets.token_hex(16),
    }
    if cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    if body is not None:
        headers["Content-Type"] = "application/json"
    data = json.dumps(body).encode() if body is not None else None
    req = Request(BASE + path, data=data, headers=headers, method=method)
    try:
        response = urlopen(req, timeout=20)
    except HTTPError as error:
        response = error
    with response:
        content = response.read().decode()
        assert response.status == expected, (path, response.status, content)
        cookie = response.headers.get("Set-Cookie")
        if cookie:
            jar = SimpleCookie(cookie)
            for name, value in jar.items():
                cookies[name] = value.value
            if expected == 200 and path.endswith(("register", "login")):
                assert "secure" in cookie.lower() and "httponly" in cookie.lower()
        return content


def main():
    deadline = time.monotonic() + 120
    while True:
        try:
            request("/health")
            break
        except (URLError, AssertionError):
            if time.monotonic() >= deadline:
                raise RuntimeError("Demo container did not become healthy") from None
            time.sleep(1)
    assert "Bản demo" in request("/")
    assert len(json.loads(request("/api/v1/characters"))) > 0
    suffix = secrets.token_hex(4)
    user = json.loads(
        request(
            "/api/v1/auth/register",
            {
                "email": f"demo-{suffix}@example.com",
                "username": f"demo_{suffix}",
                "name": "Render Test",
                "password": secrets.token_urlsafe(24),
            },
        )
    )
    assert not user["email_verified"]
    assert json.loads(request("/api/v1/me"))["id"] == user["id"]
    conv = json.loads(request("/api/v1/conversations", {"character_id": "kaito-kid"}))
    reply = request(f"/api/v1/conversations/{conv['id']}/turns", {"text": "Xin chào"})
    assert "turn.completed" in reply and '"mode": "demo"' in reply
    request("/api/v1/auth/forgot-password", {"email": user["email"]}, expected=503)
    request("/api/v1/billing/orders", expected=503, method="POST")
    # Secrets are synthetic CI values; never print them or production credentials.
    config = dict(
        line.split("=", 1)
        for line in Path("/tmp/personax-demo-test.env").read_text().splitlines()
    )
    cookies.clear()
    owner = json.loads(
        request(
            "/api/v1/auth/login",
            {
                "email": "demo-owner@example.com",
                "password": config["DEMO_OWNER_PASSWORD"],
            },
        )
    )
    assert owner["role"] == "owner"
    request("/api/v1/admin/summary", expected=403)
    secret = json.loads(
        request("/api/v1/auth/mfa/setup", {"password": config["DEMO_OWNER_PASSWORD"]})
    )["secret"]
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    raw = hmac.new(
        key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1
    ).digest()
    offset = raw[-1] & 15
    code = f"{(struct.unpack('>I', raw[offset : offset + 4])[0] & 0x7FFFFFFF) % 1000000:06d}"
    request("/api/v1/auth/mfa/confirm", {"code": code})
    request("/api/v1/admin/summary")
    print(
        "Render container: health, UI, signup, secure cookies, chat SSE and owner MFA passed."
    )


if __name__ == "__main__":
    main()
