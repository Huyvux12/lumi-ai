"""Admin-only provider management; credentials stay in the backend secret store."""
# ruff: noqa: B008 -- FastAPI dependency declarations.

import asyncio
import time
from dataclasses import replace
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Form, Request, UploadFile
from pydantic import Field, model_validator
from sqlalchemy import func, select

from .catalog_api import accessible_character
from .models import AISettings, Audit, LLMProfile, Prompt, Usage, now_ms, uid
from .provider_config import resolve_llm, stt_runtime
from .provider_credentials import credential_metadata, resolve_key
from .provider_network import public_addresses, validate_base_url
from .providers import generate_reply, transcribe
from .quotas import LEASE_MS, PREMIUM, VN, finish, lock_user, usage_lease
from .schemas import Input, Reason
from .security import db_session, fail, require_admin

router = APIRouter(prefix="/admin/providers")


class Versioned(Reason):
    version: int = Field(ge=1)


class Selection(Versioned):
    llm_id: str = Field(min_length=1, max_length=36)
    stt_id: Literal["groq", "deepgram"]


class ProfileInput(Versioned):
    name: str = Field(min_length=2, max_length=80)
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,159}$")
    key_ref: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    tokenizer: Literal["qwen", "cl100k_base", "o200k_base", "utf8"] = "o200k_base"
    json_mode: Literal["json_object", "json_schema", "prompt"] = "json_object"
    token_parameter: Literal["max_tokens", "max_completion_tokens"] = "max_tokens"
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    reasoning_effort: Literal["none", "minimal", "low", "medium", "high"] | None = None
    input_price: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)
    output_price: float | None = Field(default=None, ge=0, le=10000, allow_inf_nan=False)

    @model_validator(mode="after")
    def price_pair(self):
        if (self.input_price is None) != (self.output_price is None):
            raise ValueError("Set both prices or leave both unknown")
        return self


class LLMTest(Input):
    version: int = Field(ge=1)
    character_id: str = Field(default="kaito-kid", max_length=80)
    text: str = Field(min_length=1, max_length=1000)


def profile_view(row, keys):
    data = {
        column: getattr(row, column)
        for column in (
            "id",
            "name",
            "base_url",
            "model",
            "key_ref",
            "tokenizer",
            "json_mode",
            "token_parameter",
            "temperature",
            "reasoning_effort",
            "input_price",
            "output_price",
            "version",
        )
    }
    key_id = "groq" if row.key_ref == "groq" else "llm:" + row.key_ref
    data.update(provider="openai_compatible", configured=keys.get(key_id, {}).get("configured", False), editable=True)
    return data


async def state_for(db, version=None, *, lock=False):
    query = select(AISettings).where(AISettings.id == "global")
    if lock:
        query = query.with_for_update()
    state = await db.scalar(query)
    if not state:
        fail("PROVIDER_UNAVAILABLE", "Cấu hình AI chưa được khởi tạo. Chạy migration trước.", 503)
    if version is not None and state.version != version:
        fail("PROVIDER_CONFLICT", "Cấu hình AI vừa thay đổi. Tải lại trước khi lưu hoặc thử.", 409)
    return state


def changed(db, state, actor, action, target, details):
    state.version += 1
    state.updated_at = now_ms()
    db.add(Audit(actor_id=actor.id, action=action, target=target, details=details))


@router.get("")
async def settings_view(request: Request, user=Depends(require_admin), db=Depends(db_session)):
    cfg = request.app.state.settings
    state = await state_for(db)
    profiles = (await db.scalars(select(LLMProfile).order_by(LLMProfile.created_at, LLMProfile.id))).all()
    keys = await credential_metadata(db, cfg)
    for profile in profiles:
        if profile.key_ref != "groq":
            keys.setdefault("llm:" + profile.key_ref, {"configured": False})
    owner = user.role == "owner"
    return {
        "selection": {key: getattr(state, key) for key in ("llm_id", "stt_id", "version", "updated_at")},
        "llm_profiles": [
            {
                "id": "groq",
                "name": "Groq",
                "provider": "groq",
                "model": cfg.groq_model,
                "configured": keys["groq"]["configured"],
                "editable": False,
            },
            *[profile_view(row, keys) for row in profiles],
        ],
        "stt_sources": [
            {
                "id": "groq",
                "name": "Groq Whisper",
                "model": cfg.stt_model,
                "language": "vi",
                "configured": keys["groq"]["configured"],
            },
            {
                "id": "deepgram",
                "name": "Deepgram Nova-3",
                "model": "nova-3",
                "language": "vi",
                "configured": keys["deepgram"]["configured"],
            },
        ],
        "key_refs": [
            {"id": "groq", "configured": keys["groq"]["configured"]},
            *[
                {"id": ident[4:], "configured": value["configured"]}
                for ident, value in sorted(keys.items())
                if ident.startswith("llm:")
            ],
        ],
        "allowed_hosts": cfg.llm_allowed_hosts,
        "demo_llm": cfg.demo_llm and not cfg.production,
        "can_manage_keys": owner,
    }


async def validate_profile(body, cfg, db):
    base = validate_base_url(body.base_url, cfg)
    keys = await credential_metadata(db, cfg)
    if body.key_ref != "groq" and "llm:" + body.key_ref not in keys:
        fail("INVALID_KEY_REF", "Tên khóa chưa được đăng ký. Owner có thể thêm khóa ở mục Khóa API.", 422)
    from urllib.parse import urlsplit

    await public_addresses(urlsplit(base).hostname)
    return base


@router.post("/llm", status_code=201)
async def create_profile(
    body: ProfileInput, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    base = await validate_profile(body, request.app.state.settings, db)
    state = await state_for(db, body.version, lock=True)
    if await db.scalar(select(func.count()).select_from(LLMProfile)) >= 50:
        fail("PROFILE_LIMIT", "Tối đa 50 cấu hình LLM. Xóa cấu hình không dùng trước khi thêm.", 422)
    row = LLMProfile(**body.model_dump(exclude={"reason", "version", "base_url"}), base_url=base)
    db.add(row)
    await db.flush()
    changed(
        db,
        state,
        user,
        "provider.profile.create",
        row.id,
        {"name": row.name, "model": row.model, "reason": body.reason},
    )
    await db.commit()
    return {"id": row.id}


@router.put("/llm/{ident}")
async def edit_profile(
    ident: str, body: ProfileInput, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    base = await validate_profile(body, request.app.state.settings, db)
    state = await state_for(db, body.version, lock=True)
    row = await db.get(LLMProfile, ident)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy cấu hình LLM có thể sửa.", 404)
    for key, value in body.model_dump(exclude={"reason", "version", "base_url"}).items():
        setattr(row, key, value)
    row.base_url, row.updated_at, row.version = base, now_ms(), row.version + 1
    key_id = "groq" if row.key_ref == "groq" else "llm:" + row.key_ref
    if state.llm_id == row.id and not await resolve_key(db, request.app.state.settings, key_id):
        fail("PROVIDER_NOT_CONFIGURED", "Cấu hình đang hoạt động phải có API key.", 422)
    changed(
        db,
        state,
        user,
        "provider.profile.update",
        row.id,
        {"name": row.name, "model": row.model, "reason": body.reason},
    )
    await db.commit()
    return {"ok": True}


@router.delete("/llm/{ident}")
async def delete_profile(ident: str, body: Versioned, user=Depends(require_admin), db=Depends(db_session)):
    state = await state_for(db, body.version, lock=True)
    if state.llm_id == ident:
        fail("PROVIDER_ACTIVE", "Đổi sang nguồn LLM khác trước khi xóa cấu hình đang hoạt động.", 409)
    row = await db.get(LLMProfile, ident)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy cấu hình LLM có thể xóa.", 404)
    await db.delete(row)
    changed(db, state, user, "provider.profile.delete", ident, {"reason": body.reason})
    await db.commit()
    return {"ok": True}


@router.patch("")
async def select_providers(
    body: Selection, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    state = await state_for(db, body.version, lock=True)
    cfg = request.app.state.settings
    llm = await resolve_llm(db, cfg, body.llm_id)
    stt = await stt_runtime(db, cfg, body.stt_id)
    if (state.llm_id != body.llm_id and not llm.key) or (state.stt_id != body.stt_id and not stt.key):
        fail("PROVIDER_NOT_CONFIGURED", "Nguồn được chọn chưa có API key ở backend.", 422)
    if llm.provider == "openai_compatible":
        from urllib.parse import urlsplit

        await public_addresses(urlsplit(validate_base_url(llm.base_url, cfg)).hostname)
    previous = {"llm_id": state.llm_id, "stt_id": state.stt_id}
    state.llm_id, state.stt_id = body.llm_id, body.stt_id
    changed(
        db,
        state,
        user,
        "provider.select",
        "global",
        {
            "before": previous,
            "after": {"llm_id": state.llm_id, "stt_id": state.stt_id},
            "reason": body.reason,
        },
    )
    await db.commit()
    return {"ok": True}


async def reserve_probe(db, user, kind, amount):
    await lock_user(db, user.id)
    if await db.scalar(
        select(Usage.id)
        .where(
            Usage.user_id == user.id,
            Usage.kind.in_(("admin_test", "admin_stt_test")),
            Usage.status == "reserved",
            Usage.expires_at > now_ms(),
        )
        .limit(1)
    ):
        fail("REQUEST_ACTIVE", "Một lần thử AI đang chạy. Vui lòng đợi.", 409)
    usage = Usage(
        user_id=user.id,
        kind=kind,
        amount=amount,
        secondary=0,
        request_key=uid(),
        period="admin",
        day=datetime.now(VN).strftime("%Y-%m-%d"),
        expires_at=now_ms() + LEASE_MS,
    )
    db.add(usage)
    await db.flush()
    return usage


@router.post("/llm/{ident}/test")
async def test_llm(
    ident: str, body: LLMTest, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    await request.app.state.limiter.check(f"provider-test:{user.id}", 5, 60)
    await state_for(db, body.version, lock=True)
    cfg = request.app.state.settings
    runtime = await resolve_llm(db, cfg, ident)
    if not runtime.key:
        fail("PROVIDER_NOT_CONFIGURED", "Nguồn LLM chưa có API key.", 422)
    character = await accessible_character(db, body.character_id, user)
    prompt = await db.scalar(select(Prompt).where(Prompt.published.is_(True)))
    usage = await reserve_probe(db, user, "admin_test", 1)
    db.add(
        Audit(actor_id=user.id, action="provider.llm.test", target=ident, details={"model": runtime.model})
    )
    await db.commit()
    started = time.perf_counter()
    try:
        async with usage_lease(request.app.state.db, usage.id):
            segments, metadata = await generate_reply(
                request.app.state.http,
                replace(cfg, demo_llm=False),
                prompt,
                character,
                None,
                [{"role": "user", "content": body.text}],
                PREMIUM,
                provider=runtime,
                compatible_client=request.app.state.compatible_http,
            )
        await finish(request.app.state.db, usage.id, success=True, provider_usage=metadata)
        return {
            "provider_id": runtime.id,
            "model": runtime.model,
            "elapsed_ms": round((time.perf_counter() - started) * 1000),
            "segments": [
                {key: value for key, value in segment.items() if key != "tts_text"} for segment in segments
            ],
            "usage": metadata,
        }
    except BaseException:
        await asyncio.shield(finish(request.app.state.db, usage.id, success=False))
        raise


@router.post("/stt/{ident}/test")
async def test_stt(
    ident: str,
    request: Request,
    file: UploadFile,
    version: int = Form(ge=1),
    user=Depends(require_admin),
    db=Depends(db_session),
):
    from .speech_api import read_recording

    await request.app.state.limiter.check(f"provider-test:{user.id}", 5, 60)
    await state_for(db, version, lock=True)
    cfg = request.app.state.settings
    runtime = await stt_runtime(db, cfg, ident)
    if not runtime.key:
        fail("PROVIDER_NOT_CONFIGURED", "Nguồn STT chưa có API key.", 422)
    await db.commit()  # The probe uses the snapshot; release the configuration lock before decoding.
    content, duration = await read_recording(file, cfg)
    if duration > 30000:
        fail("INVALID_AUDIO", "Đoạn thử STT tối đa 30 giây.", 422)
    usage = await reserve_probe(db, user, "admin_stt_test", duration)
    db.add(
        Audit(
            actor_id=user.id,
            action="provider.stt.test",
            target=ident,
            details={"model": runtime.model, "duration_ms": duration},
        )
    )
    await db.commit()
    started = time.perf_counter()
    try:
        async with usage_lease(request.app.state.db, usage.id):
            text, metadata = await transcribe(
                request.app.state.http, cfg, content, "recording.wav", "audio/wav", provider=runtime
            )
        await finish(request.app.state.db, usage.id, success=True, provider_usage=metadata)
        return {
            "provider_id": runtime.id,
            "model": runtime.model,
            "text": text,
            "elapsed_ms": round((time.perf_counter() - started) * 1000),
        }
    except BaseException:
        await asyncio.shield(finish(request.app.state.db, usage.id, success=False))
        raise
