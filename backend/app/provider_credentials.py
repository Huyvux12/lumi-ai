"""Encrypted database overrides; environment keys remain the fallback.

Only request-scoped runtime snapshots hold decrypted keys. Never cache them in
Settings, serialize them, or fall back silently after a decryption failure.
"""

import base64
import hmac
import re

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from .models import ProviderCredential
from .security import encryption, fail


def validate_key_id(ident):
    if ident not in {"groq", "deepgram"} and (
        not re.fullmatch(r"llm:[a-zA-Z0-9_-]{1,40}", ident) or ident == "llm:groq"
    ):
        fail("INVALID_KEY_REF", "Tên khóa không hợp lệ.", 422)
    return ident


def server_key(settings, ident):
    if ident == "groq":
        return settings.groq_key
    if ident == "deepgram":
        return settings.deepgram_key
    return settings.llm_keys.get(ident.removeprefix("llm:"), "")


def credential_cipher(settings):
    if settings.credential_key:
        return Fernet(settings.credential_key.encode())
    master = settings.mfa_key
    if not master:
        # Development uses the existing private, persistent local master key.
        encryption(settings)
        master = (settings.data_dir / "mfa.key").read_text().strip()
    derived = hmac.digest(base64.urlsafe_b64decode(master), b"lumi-ai/provider-credentials/v1", "sha256")
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_key(settings, ident, value):
    # Bind ciphertext to its target so swapping database rows cannot swap keys.
    return credential_cipher(settings).encrypt((ident + "\n" + value).encode()).decode()


async def resolve_key(db, settings, ident):
    row = await db.get(ProviderCredential, ident)
    if row is None:
        return server_key(settings, ident)
    try:
        payload = credential_cipher(settings).decrypt(row.ciphertext.encode()).decode()
        target, value = payload.split("\n", 1)
        if target != ident:
            raise ValueError
        return value
    except (InvalidToken, ValueError, UnicodeError):
        fail(
            "CREDENTIAL_UNAVAILABLE",
            "Không thể giải mã khóa AI. Liên hệ owner để khôi phục khóa mã hóa hoặc nhập lại API key.",
            503,
        )


async def credential_metadata(db, settings):
    rows = {row.id: row for row in (await db.scalars(select(ProviderCredential))).all()}
    identifiers = {"groq", "deepgram", *rows, *("llm:" + ref for ref in settings.llm_keys if ref != "groq")}
    result = {}
    for ident in sorted(identifiers):
        row = rows.get(ident)
        fallback = bool(server_key(settings, ident))
        result[ident] = {
            "id": ident,
            "configured": bool(row or fallback),
            "source": "admin" if row else "server" if fallback else "none",
            # Never expose any part of environment-managed keys.
            "suffix": row.suffix if row else None,
            "server_configured": fallback,
            "updated_at": row.updated_at if row else None,
        }
    return result
