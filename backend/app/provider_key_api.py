"""Owner-only write-only credential management. No plaintext read endpoint."""
# ruff: noqa: B008 -- FastAPI dependencies.

from fastapi import APIRouter, Depends, Request
from pydantic import Field, SecretStr, field_validator
from sqlalchemy import func, select

from .models import LLMProfile, ProviderCredential, now_ms
from .provider_api import changed, state_for
from .provider_credentials import credential_metadata, encrypt_key, server_key, validate_key_id
from .schemas import Input
from .security import db_session, fail, require_owner

router = APIRouter(prefix="/admin/providers/keys")


class KeyVersion(Input):
    version: int = Field(ge=1)


class KeyInput(KeyVersion):
    api_key: SecretStr = Field(min_length=8, max_length=8192)

    @field_validator("api_key")
    @classmethod
    def safe_header(cls, value):
        if any(not 33 <= ord(char) <= 126 for char in value.get_secret_value()):
            raise ValueError("API key must contain visible ASCII characters only")
        return value


async def key_usage(db, state):
    usage = {
        "groq": {
            "used_by": ["LLM · Groq", "STT · Groq Whisper"],
            "active": state.llm_id == "groq" or state.stt_id == "groq",
        },
        "deepgram": {"used_by": ["STT · Deepgram Nova-3"], "active": state.stt_id == "deepgram"},
    }
    for profile in (await db.scalars(select(LLMProfile))).all():
        ident = "groq" if profile.key_ref == "groq" else "llm:" + profile.key_ref
        item = usage.setdefault(ident, {"used_by": [], "active": False})
        item["used_by"].append("LLM · " + profile.name)
        item["active"] |= profile.id == state.llm_id
    return usage


@router.get("")
async def list_keys(request: Request, user=Depends(require_owner), db=Depends(db_session)):
    state = await state_for(db)
    keys = await credential_metadata(db, request.app.state.settings)
    usage = await key_usage(db, state)
    for ident, item in usage.items():
        keys.setdefault(
            ident,
            {
                "id": ident,
                "configured": False,
                "source": "none",
                "suffix": None,
                "server_configured": False,
                "updated_at": None,
            },
        )
        keys[ident].update(item)
    return {
        "version": state.version,
        "keys": [{"used_by": [], "active": False, **item} for _, item in sorted(keys.items())],
    }


@router.put("/{ident}")
async def save_key(
    ident: str, body: KeyInput, request: Request, user=Depends(require_owner), db=Depends(db_session)
):
    validate_key_id(ident)
    await request.app.state.limiter.check(f"provider-key:{user.id}", 10, 300)
    state = await state_for(db, body.version, lock=True)
    row = await db.get(ProviderCredential, ident)
    if row is None:
        if (
            ident.startswith("llm:")
            and await db.scalar(
                select(func.count())
                .select_from(ProviderCredential)
                .where(ProviderCredential.id.like("llm:%"))
            )
            >= 50
        ):
            fail("KEY_LIMIT", "Tối đa 50 khóa OpenAI-compatible lưu ở admin.", 422)
        row = ProviderCredential(id=ident)
        db.add(row)
    value = body.api_key.get_secret_value()
    row.ciphertext = encrypt_key(request.app.state.settings, ident, value)
    row.suffix, row.updated_at = value[-4:], now_ms()
    # Audit contains only fixed metadata: no request bodies or free-form text.
    changed(db, state, user, "provider.key.save", ident, {})
    await db.commit()
    return {"ok": True}


@router.delete("/{ident}")
async def delete_key(
    ident: str, body: KeyVersion, request: Request, user=Depends(require_owner), db=Depends(db_session)
):
    validate_key_id(ident)
    await request.app.state.limiter.check(f"provider-key:{user.id}", 10, 300)
    state = await state_for(db, body.version, lock=True)
    row = await db.get(ProviderCredential, ident)
    if row is None:
        fail(
            "KEY_NOT_FOUND",
            "Không có khóa lưu ở admin để xóa. Khóa server cần đổi ở cấu hình triển khai.",
            404,
        )
    fallback = bool(server_key(request.app.state.settings, ident))
    usage = await key_usage(db, state)
    if usage.get(ident, {}).get("active") and not fallback:
        fail("KEY_IN_USE", "Đổi nguồn đang hoạt động trước khi xóa khóa cuối cùng của nguồn đó.", 409)
    await db.delete(row)
    changed(db, state, user, "provider.key.delete", ident, {"restored_server_key": fallback})
    await db.commit()
    return {"ok": True, "restored_server_key": fallback}
