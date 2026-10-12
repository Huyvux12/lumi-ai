"""Bounded, account-owned raster uploads; images share character visibility."""

import asyncio
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from sqlalchemy import delete, exists, select
from .models import Character, CharacterAvatar
from .security import fail

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_STORED_BYTES = 1024 * 1024
MAX_ACCOUNT_BYTES = 32 * 1024 * 1024
MAX_ACCOUNT_AVATARS = 40
UNATTACHED_TTL_MS = 24 * 3600 * 1000
MIMES = {"image/jpeg", "image/png", "image/webp"}


def normalize_avatar(content):
    with Image.open(BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as source:
        if source.width * source.height > MAX_PIXELS or getattr(source, "n_frames", 1) != 1:
            raise ValueError("Image dimensions or frames exceed the limit")
        source.load()
        oriented = ImageOps.exif_transpose(source)
        oriented.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        # Copy pixels into a fresh image so EXIF/GPS, comments and profiles never persist.
        pixels = oriented.convert("RGBA")
        clean = Image.new("RGBA", pixels.size)
        clean.paste(pixels)
        target = BytesIO()
        clean.save(target, format="WEBP", quality=85, method=4)
        result = target.getvalue()
        if len(result) > MAX_STORED_BYTES:
            raise ValueError("Encoded image exceeds the limit")
        return result


async def read_avatar(file: UploadFile):
    try:
        if (file.content_type or "").split(";")[0] not in MIMES:
            fail("INVALID_IMAGE", "Chọn ảnh PNG, JPEG hoặc WebP tĩnh.", 422)
        content = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if not content or len(content) > MAX_UPLOAD_BYTES:
        fail("INVALID_IMAGE", "Ảnh phải có dữ liệu và không vượt quá 5 MB.", 422)
    try:
        return await asyncio.to_thread(normalize_avatar, content)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        fail("INVALID_IMAGE", "Ảnh không hợp lệ. Chọn ảnh tĩnh tối đa 5 MB và 16 megapixel.", 422)


async def require_owned_avatar(db, avatar_id, user):
    if avatar_id:
        avatar = await db.get(CharacterAvatar, avatar_id)
        if not avatar or avatar.owner_id != user.id:
            fail("INVALID_AVATAR", "Ảnh đại diện không tồn tại hoặc không thuộc tài khoản của bạn.", 422)


def avatar_referenced():
    return exists(select(Character.id).where(Character.data["avatar_id"].as_string() == CharacterAvatar.id))


async def delete_unused_avatar(db, avatar_id, owner_id):
    # Caller holds the owner's user lock, shared with all attachment mutations.
    if avatar_id:
        await db.execute(delete(CharacterAvatar).where(
            CharacterAvatar.id == avatar_id, CharacterAvatar.owner_id == owner_id, ~avatar_referenced()
        ))
