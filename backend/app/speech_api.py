import asyncio
import hashlib
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from fastapi import APIRouter, Depends, Header, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from .catalog_api import own_conversation
from .models import AudioJob, Character, Message, Usage, Voice, now_ms
from .prompts import speech_parts
from .providers import normalize_audio, transcribe, tts_stream
from .quotas import entitlement, finish, reserve
from .schemas import TTSInput
from .security import db_session, fail, require_user

router = APIRouter()
MIMES = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
}


@router.post("/speech/transcriptions")
async def stt(
    request: Request,
    file: UploadFile,
    idempotency_key: str = Header(min_length=8, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
):
    await request.app.state.limiter.check(f"stt:{user.id}", 10)
    if not shutil.which("ffmpeg"):
        fail("PROVIDER_UNAVAILABLE", "Máy chủ chưa hỗ trợ giải mã âm thanh. Vui lòng nhập văn bản.", 503)
    mime = (file.content_type or "").split(";")[0]
    if mime not in MIMES:
        fail("INVALID_AUDIO", "Định dạng ghi âm không hỗ trợ.", 422)
    content = await file.read(5 * 1024 * 1024 + 1)
    await file.close()
    if len(content) > 5 * 1024 * 1024 or not content:
        fail("INVALID_AUDIO", "Bản ghi âm trống hoặc quá lớn.", 422)
    fd, name = tempfile.mkstemp(suffix=MIMES[mime], dir=request.app.state.settings.data_dir)
    source = Path(name)
    try:
        # Windows locks an open file against other processes. ffmpeg must see it closed.
        with os.fdopen(fd, "wb") as temp:
            temp.write(content)
        content, duration = await normalize_audio(source, request.app.state.settings.data_dir)
    finally:
        source.unlink(missing_ok=True)
    plan, _, _ = await entitlement(db, user.id)
    if duration > plan.quota["recording_seconds"] * 1000:
        fail("INVALID_AUDIO", "Bản ghi âm quá dài.", 422)
    usage, fresh = await reserve(db, user.id, "stt", idempotency_key, duration)
    if not fresh:
        fail("KEY_CONFLICT", "Bản ghi âm này đã được xử lý. Vui lòng kiểm tra ô nhập.", 409)
    await db.commit()
    try:
        text, meta = await transcribe(
            request.app.state.http, request.app.state.settings, content, "recording.wav", "audio/wav"
        )
        await finish(request.app.state.db, usage.id, success=True, provider_usage=meta)
        return {"text": text}
    except BaseException:
        await asyncio.shield(finish(request.app.state.db, usage.id, success=False))
        raise


@router.post("/messages/{ident}/tts")
async def create_tts(
    ident: str,
    body: TTSInput,
    request: Request,
    idempotency_key: str = Header(min_length=8, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
):
    await request.app.state.limiter.check(f"tts:{user.id}", 15)
    message = await db.get(Message, ident)
    if not message or message.role != "assistant" or message.status != "complete":
        fail("NOT_FOUND", "Chưa có lời thoại để đọc.", 404)
    conversation = await own_conversation(db, message.conversation_id, user)
    character = await db.get(Character, conversation.character_id)
    voice = await db.get(Voice, body.voice_id or character.voice_id)
    if not voice or not voice.enabled:
        fail("INVALID_VOICE", "Giọng đọc không khả dụng.", 422)
    parts = speech_parts(message.segments, voice)
    if not parts:
        fail("NO_DIALOGUE", "Phản hồi này chỉ có lời dẫn, không có lời thoại.", 422)
    key = f"{user.id}:{idempotency_key}"
    previous = (await db.execute(select(AudioJob).where(AudioJob.request_key == key))).scalar_one_or_none()
    if previous:
        if previous.message_id != ident or previous.voice_id != voice.id:
            fail("KEY_CONFLICT", "Mã yêu cầu đã được sử dụng.", 409)
        return {"id": previous.id, "stream_url": f"/api/v1/speech/jobs/{previous.id}/stream"}
    cache_key = hashlib.sha256(
        json.dumps(
            [user.id, message.id, parts, voice.voice, request.app.state.settings.tts_model], sort_keys=True
        ).encode()
    ).hexdigest()
    cached = (
        await db.execute(
            select(AudioJob)
            .where(
                AudioJob.cache_key == cache_key, AudioJob.status == "complete", AudioJob.expires_at > now_ms()
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    audio_dir = request.app.state.settings.data_dir / "audio"
    if cached and (audio_dir / (cached.id + ".pcm")).exists():
        return {"id": cached.id, "stream_url": f"/api/v1/speech/jobs/{cached.id}/stream"}
    chars = sum(len(s["text"]) for s in message.segments if s["type"] == "dialogue")
    estimate_ms = max(1000, chars * 100)  # Reservation, replaced with actual PCM duration when complete.
    usage, fresh = await reserve(db, user.id, "tts", idempotency_key, chars, estimate_ms)
    if not fresh:
        fail("KEY_CONFLICT", "Mã yêu cầu đã được sử dụng.", 409)
    row = AudioJob(
        user_id=user.id,
        message_id=ident,
        request_key=key,
        cache_key=cache_key,
        voice_id=voice.id,
        provider_voice=voice.voice,
        parts=parts,
        usage_id=usage.id,
        expires_at=now_ms() + request.app.state.settings.audio_cache_ttl_seconds * 1000,
    )
    db.add(row)
    await db.commit()
    return {"id": row.id, "stream_url": f"/api/v1/speech/jobs/{row.id}/stream"}


@router.get("/speech/jobs/{ident}/stream")
async def audio(ident: str, request: Request, user=Depends(require_user), db=Depends(db_session)):
    row = await db.get(AudioJob, ident, with_for_update=True)
    if not row or row.user_id != user.id or row.expires_at <= now_ms():
        fail("NOT_FOUND", "Không tìm thấy bản đọc.", 404)
    path = request.app.state.settings.data_dir / "audio" / (row.id + ".pcm")
    headers = {
        "X-Audio-Sample-Rate": "24000",
        "X-Audio-Channels": "1",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
    }
    if row.status == "complete" and path.exists():
        return FileResponse(path, media_type="application/octet-stream", headers=headers)
    if row.status != "pending":
        fail("AUDIO_UNAVAILABLE", "Bản đọc đã dừng hoặc đang được xử lý.", 409)
    usage = await db.get(Usage, row.usage_id)
    if not usage or usage.status != "reserved" or usage.expires_at <= now_ms():
        fail("AUDIO_UNAVAILABLE", "Yêu cầu đọc đã hết hạn. Hãy thử lại.", 409)
    voice = await db.get(Voice, row.voice_id)
    if not voice or not voice.enabled:
        fail("INVALID_VOICE", "Giọng đọc không khả dụng.", 422)
    row.status = "streaming"
    await db.commit()
    # Enter the upstream context before sending HTTP 200 so configuration errors are real HTTP errors.
    context = tts_stream(request.app.state.http, request.app.state.settings, row.parts, row.provider_voice)
    try:
        chunks = await context.__aenter__()
    except BaseException:
        row.status = "failed"
        await db.commit()
        await finish(request.app.state.db, row.usage_id, success=False)
        raise
    max_bytes = usage.secondary * 48  # 48 PCM bytes per millisecond; never exceed reserved time.

    async def stream():
        received, complete = 0, False
        checked_at = 0.0
        task = asyncio.current_task()
        request.app.state.audio_tasks[row.id] = task
        temporary = path.with_suffix(".part")
        try:
            with temporary.open("wb") as out:
                async for chunk in chunks:
                    if await request.is_disconnected():
                        return
                    if time.monotonic() - checked_at >= 0.25:
                        async with request.app.state.db() as check:
                            current = await check.get(AudioJob, row.id)
                            if not current or current.status != "streaming":
                                return
                            reservation = await check.get(Usage, row.usage_id)
                            if reservation and reservation.status == "reserved":
                                reservation.expires_at = now_ms() + 120000
                                await check.commit()
                        checked_at = time.monotonic()
                    remaining = max_bytes - received
                    if len(chunk) > remaining:
                        raise ValueError("Audio exceeds reserved duration")
                    chunk = chunk[: remaining - remaining % 2]
                    if not chunk:
                        break
                    received += len(chunk)
                    out.write(chunk)
                    yield chunk
                complete = received > 0
            if complete:
                temporary.replace(path)
        finally:
            request.app.state.audio_tasks.pop(row.id, None)
            temporary.unlink(missing_ok=True)
            await context.__aexit__(None, None, None)

            async def cleanup():
                async with request.app.state.db() as update:
                    current = await update.get(AudioJob, row.id)
                    if current:
                        current.status = (
                            "complete"
                            if complete
                            else ("cancelled" if current.status == "cancelled" else "failed")
                        )
                        current.duration_ms = received // 48
                        await update.commit()
                await finish(
                    request.app.state.db,
                    row.usage_id,
                    success=received > 0,
                    secondary=received // 48,
                    provider_usage={"pcm_bytes": received, "model": request.app.state.settings.tts_model},
                )

            await asyncio.shield(cleanup())

    return StreamingResponse(stream(), media_type="application/octet-stream", headers=headers)


@router.post("/speech/jobs/{ident}/cancel")
async def cancel(ident: str, request: Request, user=Depends(require_user), db=Depends(db_session)):
    row = await db.get(AudioJob, ident)
    if not row or row.user_id != user.id:
        fail("NOT_FOUND", "Không tìm thấy bản đọc.", 404)
    if row.status in {"pending", "streaming"}:
        pending = row.status == "pending"
        row.status = "cancelled"
        await db.commit()
        task = request.app.state.audio_tasks.get(ident)
        if task:
            task.cancel()
        elif pending and row.usage_id:
            await finish(request.app.state.db, row.usage_id, success=False)
    return {"ok": True}
