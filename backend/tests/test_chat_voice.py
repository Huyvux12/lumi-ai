import asyncio
import io
import json
import wave
import httpx
import pytest
from sqlalchemy import select, func
from fastapi import HTTPException
from app.models import Usage, Message, AudioJob, Plan, User, Prompt, Character
from app.prompts import checked_segments, speech_parts, BASE_PROMPT
from app.quotas import reserve, finish, active_plan
from app.token_budget import prompt_tokens
from conftest import register, conversation, turn, REPLY


async def test_public_quota_absent_and_structured_replay(env):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    response = await turn(client, ident)
    again = await turn(client, ident)
    assert response["id"] == again["id"]
    assert [s["type"] for s in response["segments"]] == ["narration", "dialogue"]
    assert "<giggle>" not in response["content"] and "tts_text" not in json.dumps(response)
    for path in [
        "/plans",
        "/me",
        "/billing/subscription",
        "/conversations/" + ident + "/messages",
        "/voices",
    ]:
        data = await client.get("/api/v1" + path)
        assert data.status_code == 200
        text = data.text
        for forbidden in [
            '"quota"',
            '"limits"',
            '"remaining"',
            '"provider_usage"',
            '"input_tokens"',
            '"output_tokens"',
        ]:
            assert forbidden not in text
    async with app.state.db() as db:
        rows = (await db.execute(select(Usage))).scalars().all()
        assert len(rows) == 1 and rows[0].status == "committed"
        assert rows[0].provider_usage["prompt_tokens"] == 800


async def test_atomic_quota_reservations(env):
    app, client, _ = env
    user = await register(client)
    async with app.state.db() as db:
        plan = await active_plan(db, "free")
        q = dict(plan.quota)
        q.update(chat_day=1, chat_period=1)
        plan.quota = q
        await db.commit()

    async def attempt(key):
        async with app.state.db() as db:
            try:
                usage, _ = await reserve(db, user["id"], "chat", key, 1)
                await db.commit()
                return usage.id
            except HTTPException as e:
                return e.status_code

    results = await asyncio.gather(attempt("one"), attempt("two"), attempt("three"))
    ids = [r for r in results if isinstance(r, str)]
    assert len(ids) == 1
    assert sorted(r for r in results if isinstance(r, int)) == [429, 429]
    await finish(app.state.db, ids[0], success=False)
    assert isinstance(await attempt("four"), str)


async def test_regenerate_reuses_user_message(env):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    first = await turn(client, ident)
    messages = (await client.get("/api/v1/conversations/" + ident + "/messages")).json()
    user_message = next(m for m in messages if m["role"] == "user")
    response = await client.post(
        "/api/v1/conversations/" + ident + "/turns",
        json={"text": "Xin chào", "retry_message_id": user_message["id"]},
        headers={"Idempotency-Key": "regen-second-123"},
    )
    assert "turn.completed" in response.text
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(Message).where(Message.role == "user")) == 1
        assert (
            await db.scalar(select(func.count()).select_from(Usage).where(Usage.status == "committed")) == 2
        )


async def test_tts_dialogue_only_pcm_cache_and_ownership(env):
    app, client, _ = env
    await register(client)
    ident = await conversation(client)
    answer = await turn(client, ident)
    response = await client.post(
        "/api/v1/messages/" + answer["id"] + "/tts", json={}, headers={"Idempotency-Key": "voice-first-123"}
    )
    assert response.status_code == 200, response.text
    job = response.json()
    pcm = await client.get(job["stream_url"])
    assert pcm.status_code == 200 and len(pcm.content) == 4800
    assert pcm.headers["X-Audio-Sample-Rate"] == "24000"
    again = await client.post(
        "/api/v1/messages/" + answer["id"] + "/tts", json={}, headers={"Idempotency-Key": "voice-second-123"}
    )
    assert again.json()["id"] == job["id"]
    assert (await client.get(again.json()["stream_url"])).content == pcm.content
    async with app.state.db() as db:
        ledger = (await db.execute(select(Usage).where(Usage.kind == "tts"))).scalars().all()
        assert len(ledger) == 1 and ledger[0].status == "committed" and ledger[0].secondary == 100
    await client.post("/api/v1/auth/logout")
    await register(client, "bobby")
    assert (await client.get(job["stream_url"])).status_code == 404


async def test_tts_missing_key_releases_without_200(env):
    app, client, cfg = env
    await register(client)
    ident = await conversation(client)
    answer = await turn(client, ident)
    cfg.google_key = ""
    job = (
        await client.post(
            "/api/v1/messages/" + answer["id"] + "/tts",
            json={},
            headers={"Idempotency-Key": "voice-missing-123"},
        )
    ).json()
    result = await client.get(job["stream_url"])
    assert result.status_code == 503
    async with app.state.db() as db:
        row = (await db.execute(select(Usage).where(Usage.kind == "tts"))).scalar_one()
        assert row.status == "released"


async def test_pending_audio_cancel_releases(env):
    app, client, cfg = env
    await register(client)
    ident = await conversation(client)
    answer = await turn(client, ident)
    job = (
        await client.post(
            "/api/v1/messages/" + answer["id"] + "/tts",
            json={},
            headers={"Idempotency-Key": "voice-cancel-123"},
        )
    ).json()
    assert (await client.post("/api/v1/speech/jobs/" + job["id"] + "/cancel")).status_code == 200
    assert (await client.get(job["stream_url"])).status_code == 409
    async with app.state.db() as db:
        row = (await db.execute(select(Usage).where(Usage.kind == "tts"))).scalar_one()
        assert row.status == "released"


def wav(seconds=2):
    data = io.BytesIO()
    with wave.open(data, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(b"\x00\x00" * 16000 * seconds)
    return data.getvalue()


async def test_stt_vietnamese_real_probe_editable_transcript(env):
    app, client, cfg = env
    await register(client)
    response = await client.post(
        "/api/v1/speech/transcriptions",
        files={"file": ("recording.wav", wav(), "audio/wav")},
        headers={"Idempotency-Key": "stt-first-123"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"text": "Tôi muốn kể một câu chuyện."}
    assert (await client.get("/api/v1/conversations")).json() == []
    for content, mime in [
        (b"invalid", "audio/wav"),
        (wav(61), "audio/wav"),
        (b"<html>hello</html>", "text/html"),
    ]:
        response = await client.post(
            "/api/v1/speech/transcriptions",
            files={"file": ("file.wav", content, mime)},
            headers={"Idempotency-Key": "stt-invalid-123"},
        )
        assert response.status_code == 422
    async with app.state.db() as db:
        row = (await db.execute(select(Usage).where(Usage.kind == "stt"))).scalar_one()
        assert row.amount == 2000 and row.status == "committed"


@pytest.mark.parametrize(
    "dialogue", ["<unknown> Hello", "<giggle><giggle><giggle> Hello", "Hello <broken", "<laugh>"]
)
def test_invalid_vocal_tags_rejected(dialogue):
    raw = json.dumps({"schema_version": 1, "segments": [{"type": "dialogue", "text": dialogue}]})
    with pytest.raises(ValueError):
        checked_segments(raw, ["giggle", "laugh"])


def test_narrative_tags_never_spoken():
    raw = json.dumps(
        {"schema_version": 1, "segments": [{"type": "narration", "text": "<laugh> Đi vào rừng."}]}
    )
    segments = checked_segments(raw, ["laugh"])
    assert segments[0]["text"] == "Đi vào rừng."
    from types import SimpleNamespace

    assert speech_parts(segments, SimpleNamespace(style="warm")) == []


async def test_prompt_fits_free_budget(env):
    app, client, cfg = env
    from app.prompts import system_prompt

    async with app.state.db() as db:
        prompt = (await db.execute(select(Prompt))).scalar_one()
        character = await db.get(Character, "kaito-kid")
        tokens = prompt_tokens(
            [
                {"role": "system", "content": system_prompt(prompt, character)},
                {"role": "user", "content": "Xin chào"},
            ]
        )
        assert tokens < 2048


async def test_invalid_model_reply_releases_quota(env):
    app, client, cfg = env
    await register(client)
    ident = await conversation(client)

    def invalid(request):
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "not a JSON reply"}, "finish_reason": "stop"}]}
        )

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(invalid))
    response = await client.post(
        "/api/v1/conversations/" + ident + "/turns",
        json={"text": "Xin chào"},
        headers={"Idempotency-Key": "broken-turn-123"},
    )
    assert response.status_code == 200 and "turn.failed" in response.text
    async with app.state.db() as db:
        usage = (await db.execute(select(Usage))).scalar_one()
        assert usage.status == "released"
        answer = (await db.execute(select(Message).where(Message.role == "assistant"))).scalar_one()
        assert answer.status == "failed"


async def test_cancel_inflight_chat_releases_reservation(env):
    app, client, cfg = env
    await register(client)
    ident = await conversation(client)
    started = asyncio.Event()
    hold = asyncio.Event()

    async def delayed(request):
        started.set()
        await hold.wait()
        return httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(REPLY)}, "finish_reason": "stop"}]}
        )

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(delayed))
    pending = asyncio.create_task(
        client.post(
            "/api/v1/conversations/" + ident + "/turns",
            json={"text": "Xin chào"},
            headers={"Idempotency-Key": "cancel-inflight-123"},
        )
    )
    await asyncio.wait_for(started.wait(), 3)
    async with app.state.db() as db:
        answer = (
            await db.execute(
                select(Message).where(Message.conversation_id == ident, Message.role == "assistant")
            )
        ).scalar_one()
        message_id = answer.id
    result = await client.post("/api/v1/turns/" + message_id + "/cancel")
    assert result.status_code == 200
    try:
        await asyncio.wait_for(pending, 3)
    except (asyncio.CancelledError, AssertionError):
        # ASGITransport has no completed response when the server stream is cancelled.
        pass
    finally:
        hold.set()
    async with app.state.db() as db:
        answer = await db.get(Message, message_id)
        ledger = (await db.execute(select(Usage))).scalar_one()
        assert answer.status == "interrupted"
        assert ledger.status == "released"
