"""HTTP end-to-end check through Next rewrites, using backend/tests/ui_server.py only."""

import asyncio
import hashlib
import hmac
import json
import secrets
import time
import httpx


async def main():
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:3001",
        trust_env=False,
        timeout=30,
        headers={"X-Lumi-Request": "1", "Origin": "http://127.0.0.1:3001"},
    ) as client:
        marker = await client.get("/api/v1/test/harness")
        assert marker.status_code == 200 and marker.json().get("test_only") is True, (
            "Run the local test harness first"
        )
        suffix = secrets.token_hex(4)
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"bridge-{suffix}@example.com",
                "username": "bridge_" + suffix,
                "password": secrets.token_urlsafe(20),
                "name": "Bridge Test",
                "hue": 265,
                "interests": [],
            },
        )
        assert response.status_code == 200, response.text
        assert "httponly" in response.headers["set-cookie"].lower()
        assert (await client.get("/api/v1/me")).status_code == 200
        conv = await client.post(
            "/api/v1/conversations", json={"character_id": "kaito-kid"}
        )
        assert conv.status_code == 200, conv.text
        response = await client.post(
            "/api/v1/conversations/" + conv.json()["id"] + "/turns",
            json={"text": "Xin chào"},
            headers={"Idempotency-Key": secrets.token_hex(16)},
        )
        assert response.status_code == 200 and "turn.completed" in response.text, (
            response.text
        )
        frames = [
            json.loads(frame.split("data: ")[1])
            for frame in response.text.strip().split("\n\n")
        ]
        answer = frames[-1]["message"]
        job = await client.post(
            "/api/v1/messages/" + answer["id"] + "/tts",
            json={},
            headers={"Idempotency-Key": secrets.token_hex(16)},
        )
        assert job.status_code == 200, job.text
        pcm = await client.get(job.json()["stream_url"])
        assert pcm.status_code == 200 and len(pcm.content) == 4800
        response = await client.post(
            "/api/v1/billing/orders", headers={"Idempotency-Key": secrets.token_hex(16)}
        )
        assert response.status_code == 200, response.text
        order = response.json()
        assert order["environment"] == "test"
        event = {
            "id": int(time.time() * 1000),
            "transferType": "in",
            "transferAmount": order["amount_vnd"],
            "accountNumber": order["account"],
            "content": order["invoice"],
        }
        raw = json.dumps(event).encode()
        stamp = str(int(time.time()))
        signature = (
            "sha256="
            + hmac.new(
                b"ui-test-secret", stamp.encode() + b"." + raw, hashlib.sha256
            ).hexdigest()
        )
        result = await client.post(
            "/api/v1/payments/sepay/webhook",
            content=raw,
            headers={"X-SePay-Timestamp": stamp, "X-SePay-Signature": signature},
        )
        assert result.status_code == 200 and result.json() == {"success": True}, (
            result.text
        )
        assert (await client.get("/api/v1/billing/orders/" + order["id"])).json()[
            "status"
        ] == "paid"
        assert (await client.get("/api/v1/billing/subscription")).json()[
            "plan"
        ] == "premium"
        assert (await client.get("/api/v1/admin/users")).status_code == 403
        await client.post("/api/v1/auth/logout")
        assert (await client.get("/api/v1/me")).status_code == 401
        print(
            "Next → Python bridge: cookie, authenticated chat/SSE, PCM, QR/webhook, Premium, RBAC and logout passed."
        )


if __name__ == "__main__":
    asyncio.run(main())
