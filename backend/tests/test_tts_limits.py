"""Regression tests for dropped dialogue audio and the Gemini TTS per-minute quota."""

import base64
import json

import httpx
import pytest
from conftest import conversation, register, turn
from fastapi import HTTPException
from sqlalchemy import select

from app import providers
from app.models import AudioJob, Message, Usage
from app.prompts import speech_budget_ms
from app.providers import RequestWindow, tts_stream

SIGH = {"type": "dialogue", "text": "Thôi được rồi.", "tts_text": "<sigh> Thôi được rồi.", "emotion": "sad", "id": "0"}


def sse(pcm):
    event = {"candidates": [{"content": {"parts": [
        {"inlineData": {"mimeType": "audio/l16;rate=24000", "data": base64.b64encode(pcm).decode()}}
    ]}}]}
    return "data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n"


def test_budget_covers_measured_gemini_timings():
    # Measured on gemini-3.8-flash-tts: this line rendered 2,360 ms; the old ceiling was 1,400 ms.
    assert speech_budget_ms([SIGH]) >= 2360 * 1.5
    three = [
        {"type": "dialogue", "text": t, "tts_text": t}
        for t in ("Câu thứ nhất: trời hôm nay đẹp quá.", "Câu thứ hai: mình muốn đi dạo công viên.",
                  "Câu thứ ba: cậu có muốn đi cùng không?")
    ]
    assert speech_budget_ms(three) >= 10800 * 1.5
    assert speech_budget_ms([{"type": "narration", "text": "Cô cười."}]) == 4000


async def test_short_tagged_line_is_streamed_in_full(env, monkeypatch):
    app, client, _ = env
    await register(client)
    answer = await turn(client, await conversation(client))
    async with app.state.db() as db:
        message = await db.get(Message, answer["id"])
        message.segments = [SIGH]
        await db.commit()
    spoken = b"\x01\x00" * 24000 * 2  # 2.0 s, longer than the old 1,400 ms ceiling for this line
    original = app.state.http._transport.handler

    def handler(request):
        if ":streamGenerateContent" in request.url.path:
            return httpx.Response(200, text=sse(spoken))
        return original(request)

    monkeypatch.setattr(app.state.http._transport, "handler", handler)
    job = (await client.post(
        f"/api/v1/messages/{answer['id']}/tts", json={}, headers={"Idempotency-Key": "sigh-line-key"}
    )).json()
    audio = await client.get(job["stream_url"])
    assert audio.status_code == 200 and audio.content == spoken
    async with app.state.db() as db:
        assert (await db.get(AudioJob, job["id"])).status == "complete"
        usage = (await db.execute(select(Usage).where(Usage.kind == "tts"))).scalar_one()
        assert usage.status == "committed" and usage.secondary == 2000


async def test_audio_past_the_ceiling_stops_cleanly_and_bills_what_was_spoken(env, monkeypatch):
    app, client, _ = env
    await register(client)
    answer = await turn(client, await conversation(client))
    async with app.state.db() as db:
        message = await db.get(Message, answer["id"])
        ceiling_ms = speech_budget_ms(message.segments)
    runaway = b"\x02\x00" * 24 * (ceiling_ms + 5000)
    original = app.state.http._transport.handler
    monkeypatch.setattr(
        app.state.http._transport, "handler",
        lambda request: httpx.Response(200, text=sse(runaway))
        if ":streamGenerateContent" in request.url.path else original(request),
    )
    job = (await client.post(
        f"/api/v1/messages/{answer['id']}/tts", json={}, headers={"Idempotency-Key": "runaway-key"}
    )).json()
    audio = await client.get(job["stream_url"])
    assert audio.status_code == 200 and len(audio.content) == ceiling_ms * 48
    async with app.state.db() as db:
        assert (await db.get(AudioJob, job["id"])).status == "complete"
        usage = (await db.execute(select(Usage).where(Usage.kind == "tts"))).scalar_one()
        assert usage.status == "committed" and usage.secondary == ceiling_ms


async def test_upstream_429_is_retried_once(env, monkeypatch):
    _, _, cfg = env
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) == 1:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": {"code": 429}})
        return httpx.Response(200, text=sse(b"\x01\x00" * 100))

    monkeypatch.setattr(providers, "tts_window", RequestWindow())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with tts_stream(client, cfg, [{"text": "Xin chào"}], "Kore") as chunks:
            audio = b"".join([chunk async for chunk in chunks])
    assert len(calls) == 2 and len(audio) == 200


async def test_repeated_upstream_429_reports_a_busy_voice(env, monkeypatch):
    _, _, cfg = env
    monkeypatch.setattr(providers, "tts_window", RequestWindow())
    transport = httpx.MockTransport(lambda request: httpx.Response(429, headers={"retry-after": "0"}))
    with pytest.raises(HTTPException) as error:
        async with httpx.AsyncClient(transport=transport) as client, tts_stream(
            client, cfg, [{"text": "Xin chào"}], "Kore"
        ):
            pass
    assert error.value.status_code == 429 and error.value.detail["code"] == "TTS_BUSY"


async def test_request_window_caps_calls_per_minute():
    now = [0.0]
    window = RequestWindow()
    for _ in range(9):
        await window.acquire(9, wait_s=0, clock=lambda: now[0])
    with pytest.raises(HTTPException) as error:
        await window.acquire(9, wait_s=8, clock=lambda: now[0])
    assert error.value.detail["code"] == "TTS_BUSY"
    now[0] = 60.0
    await window.acquire(9, wait_s=0, clock=lambda: now[0])
