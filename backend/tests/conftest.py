import base64
import json
import os
import httpx
import pytest
from app.config import Settings
from app.main import create_app

REPLY = {
    "schema_version": 1,
    "segments": [
        {"type": "narration", "text": "Cô nhìn ra cửa sổ."},
        {"type": "dialogue", "text": "<giggle> Chào cậu!", "emotion": "cheerful", "pace": "normal"},
    ],
}


def provider(request):
    if request.url.path.endswith("chat/completions"):
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(REPLY)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 800, "completion_tokens": 70},
            },
        )
    if request.url.path.endswith("audio/transcriptions"):
        assert b"language" in request.content and b"\r\nvi\r\n" in request.content
        return httpx.Response(200, json={"text": "Tôi muốn kể một câu chuyện.", "duration": 2.0})
    if ":streamGenerateContent" in request.url.path:
        data = json.loads(request.content)
        assert data["generationConfig"]["speechConfig"]["voiceConfig"]["voice"] == "Kore"
        parts = data["contents"][0]["parts"]
        assert all("Cô nhìn" not in p["text"] for p in parts)
        assert parts[0]["text"] == "<giggle> Chào cậu!"
        assert "cheerful" in parts[0]["speechMetadata"]["style"]
        event = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "audio/l16;rate=24000",
                                    "data": base64.b64encode(b"\x01\x00" * 2400).decode(),
                                }
                            }
                        ]
                    }
                }
            ]
        }
        return httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n")
    raise AssertionError(f"Unexpected provider request: {request.url.path}")


@pytest.fixture
async def env(tmp_path):
    cfg = Settings(
        database_url=os.getenv("LUMI_TEST_DATABASE_URL")
        or "sqlite+aiosqlite:///" + str(tmp_path / "test.db"),
        data_dir=tmp_path,
        groq_key="test-key",
        google_key="test-key",
        sepay_secret="test-secret",
        sepay_environment="test",
        bank_account="123456789",
        bank_holder="LUMI TEST",
        bank_code="MBBank",
        redis_url="",
    )
    app = create_app(cfg, transport=httpx.MockTransport(provider))
    if os.getenv("LUMI_TEST_DATABASE_URL"):
        from app.db import Base

        async with app.state.engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-Lumi-Request": "1"}
        ) as client:
            yield app, client, cfg


async def register(client, name="alice", password="CorrectHorse123!"):
    result = await client.post(
        "/api/v1/auth/register",
        json={
            "email": name + "@example.com",
            "username": name,
            "password": password,
            "name": name.title(),
            "hue": 265,
            "interests": [],
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


async def conversation(client):
    response = await client.post("/api/v1/conversations", json={"character_id": "kaito-kid"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def turn(client, ident, key="first-turn-123"):
    response = await client.post(
        f"/api/v1/conversations/{ident}/turns", headers={"Idempotency-Key": key}, json={"text": "Xin chào"}
    )
    assert response.status_code == 200, response.text
    frames = [json.loads(frame.split("data: ")[1]) for frame in response.text.strip().split("\n\n")]
    assert "message" in frames[-1], response.text
    return frames[-1]["message"]
