import json
from fastapi import APIRouter, Depends, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from .models import Character, CharacterAvatar, Conversation, Message, Report, Scene, Voice, now_ms, uid
from .avatars import read_avatar, require_owned_avatar, delete_unused_avatar, avatar_referenced, MAX_ACCOUNT_AVATARS, MAX_ACCOUNT_BYTES
from .search import normalized
from .quotas import entitlement
from .schemas import CharacterInput, ConversationInput, Input
from .security import db_session, fail, lock_user, optional_user, require_feature_user, require_user
from pydantic import Field

router = APIRouter()


async def accessible_character(db, ident, user):
    character = await db.get(Character, ident)
    owner = bool(user and character and character.owner_id == user.id)
    if not character or (
        not owner and not (character.visibility == "public" and character.status == "approved")
    ):
        fail("NOT_FOUND", "Không tìm thấy nhân vật.", 404)
    return character


async def character_view(db, c):
    owner = c.owner_id
    count = await db.scalar(
        select(func.count()).select_from(Conversation).where(Conversation.character_id == c.id)
    )
    return {
        **c.data,
        "image": f"/api/v1/avatars/{c.data['avatar_id']}" if c.data.get("avatar_id") else c.data.get("image"),
        "id": c.id,
        "owner": owner,
        "createdAt": c.created_at,
        "updatedAt": c.updated_at,
        "visibility": c.visibility,
        "status": c.status,
        "voice_id": c.voice_id,
        "chats": count,
    }


@router.post("/avatars")
async def upload_avatar(
    request: Request, file: UploadFile, user=Depends(require_feature_user), db=Depends(db_session)
):
    await request.app.state.limiter.check(f"avatar:{user.id}", 30, 3600)
    content = await read_avatar(file)
    await lock_user(db, user.id)
    count, size = (await db.execute(select(func.count(), func.coalesce(func.sum(func.length(CharacterAvatar.content)), 0)).where(CharacterAvatar.owner_id == user.id))).one()
    if count >= MAX_ACCOUNT_AVATARS or size + len(content) > MAX_ACCOUNT_BYTES:
        fail("AVATAR_QUOTA_REACHED", "Kho ảnh đã đầy. Xóa hoặc thay ảnh nhân vật trước khi tải thêm.", 429)
    avatar = CharacterAvatar(owner_id=user.id, content=content)
    db.add(avatar)
    await db.commit()
    return {"avatar_id": avatar.id, "image": f"/api/v1/avatars/{avatar.id}"}


@router.get("/avatars/{ident}")
async def avatar_image(ident: str, user=Depends(optional_user), db=Depends(db_session)):
    avatar = await db.get(CharacterAvatar, ident)
    if not avatar:
        fail("NOT_FOUND", "Không tìm thấy ảnh đại diện.", 404)
    if not user or user.id != avatar.owner_id:
        public = await db.scalar(
            select(Character.id)
            .where(
                Character.data["avatar_id"].as_string() == ident,
                Character.visibility == "public",
                Character.status == "approved",
            )
            .limit(1)
        )
        if not public:
            fail("NOT_FOUND", "Không tìm thấy ảnh đại diện.", 404)
    return Response(avatar.content, media_type="image/webp")


@router.delete("/avatars/{ident}")
async def delete_avatar(ident: str, user=Depends(require_user), db=Depends(db_session)):
    await lock_user(db, user.id)
    avatar = await db.get(CharacterAvatar, ident)
    if not avatar or avatar.owner_id != user.id:
        fail("NOT_FOUND", "Không tìm thấy ảnh đại diện.", 404)
    if await db.scalar(select(avatar_referenced()).where(CharacterAvatar.id == ident)):
        fail("AVATAR_IN_USE", "Ảnh đang được nhân vật sử dụng.", 409)
    await db.delete(avatar)
    await db.commit()
    return {"ok": True}


@router.get("/characters")
async def characters(
    q: str = Query(default="", max_length=100),
    tag: str = Query(default="", max_length=30),
    mine: bool = False,
    official: bool = False,
    ids: list[str] = Query(default=[], max_length=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    user=Depends(optional_user),
    db=Depends(db_session),
):
    if mine and not user:
        fail("AUTH_REQUIRED", "Vui lòng đăng nhập.", 401)
    condition = (
        Character.owner_id == user.id
        if mine
        else (
            ((Character.visibility == "public") & (Character.status == "approved"))
            | (Character.owner_id == user.id if user else False)
        )
    )
    query = select(Character).where(condition)
    if official:
        query = query.where(Character.owner_id.is_(None))
    if ids:
        query = query.where(Character.id.in_(ids))
    if q:
        query = query.where(Character.search_text.contains(normalized(q), autoescape=True))
    if tag:
        # Search complete JSON string tokens, with case-sensitive position functions.
        position = func.strpos if db.get_bind().dialect.name == "postgresql" else func.instr
        query = query.where(position(Character.tags_text, json.dumps(tag)) > 0)
    query = query.order_by(Character.updated_at.desc(), Character.id.desc())
    rows = (await db.execute(query.offset(offset).limit(limit))).scalars().all()
    return [await character_view(db, c) for c in rows]


@router.get("/characters/{ident}")
async def character(ident: str, user=Depends(optional_user), db=Depends(db_session)):
    return await character_view(db, await accessible_character(db, ident, user))


@router.post("/characters")
async def create_character(body: CharacterInput, user=Depends(require_feature_user), db=Depends(db_session)):
    await lock_user(db, user.id)
    plan, _, _ = await entitlement(db, user.id)
    count = await db.scalar(select(func.count()).select_from(Character).where(Character.owner_id == user.id))
    if count >= plan.quota["characters"]:
        fail("QUOTA_REACHED", "Bạn đã đạt giới hạn tạo nhân vật hiện tại.", 429)
    await require_owned_avatar(db, body.avatar_id, user)
    voice = await db.get(Voice, body.voice_id)
    if not voice or not voice.enabled:
        fail("INVALID_VOICE", "Giọng đọc không khả dụng.")
    data = body.model_dump(exclude={"visibility", "voice_id"})
    data["creator"] = user.username
    c = Character(
        id="u-" + uid(),
        owner_id=user.id,
        data=data,
        visibility=body.visibility,
        status="pending" if body.visibility == "public" else "approved",
        voice_id=body.voice_id,
    )
    db.add(c)
    await db.commit()
    return await character_view(db, c)


@router.patch("/characters/{ident}")
async def edit_character(
    ident: str, body: CharacterInput, user=Depends(require_feature_user), db=Depends(db_session)
):
    await lock_user(db, user.id)
    c = await accessible_character(db, ident, user)
    if c.owner_id != user.id:
        fail("FORBIDDEN", "Bạn không có quyền sửa nhân vật này.", 403)
    old_avatar = c.data.get("avatar_id")
    avatar_id = body.avatar_id if "avatar_id" in body.model_fields_set else old_avatar
    await require_owned_avatar(db, avatar_id, user)
    voice = await db.get(Voice, body.voice_id)
    if not voice or not voice.enabled:
        fail("INVALID_VOICE", "Giọng đọc không khả dụng.")
    data = body.model_dump(exclude={"visibility", "voice_id"})
    if "scenario" not in body.model_fields_set:
        data["scenario"] = c.data.get("scenario", "")
    c.data = {**data, "avatar_id": avatar_id, "creator": user.username}
    c.visibility, c.voice_id = body.visibility, body.voice_id
    c.status = "pending" if body.visibility == "public" else "approved"
    c.updated_at = now_ms()
    await db.flush()
    if old_avatar != avatar_id:
        await delete_unused_avatar(db, old_avatar, user.id)
    await db.commit()
    return await character_view(db, c)


@router.delete("/characters/{ident}")
async def delete_character(ident: str, user=Depends(require_user), db=Depends(db_session)):
    await lock_user(db, user.id)
    c = await accessible_character(db, ident, user)
    if c.owner_id != user.id:
        fail("FORBIDDEN", "Bạn không có quyền xóa nhân vật này.", 403)
    avatar_id = c.data.get("avatar_id")
    await db.delete(c)
    await db.flush()
    await delete_unused_avatar(db, avatar_id, user.id)
    await db.commit()
    return {"ok": True}


@router.get("/scenes")
async def scenes(db=Depends(db_session)):
    return [row.data for row in (await db.execute(select(Scene))).scalars()]


@router.get("/voices")
async def voices(db=Depends(db_session)):
    return [
        {"id": v.id, "name": v.name}
        for v in (await db.execute(select(Voice).where(Voice.enabled.is_(True)))).scalars()
    ]


@router.post("/conversations")
async def create_conversation(body: ConversationInput, user=Depends(require_feature_user), db=Depends(db_session)):
    await accessible_character(db, body.character_id, user)
    if body.scene_id and not await db.get(Scene, body.scene_id):
        fail("NOT_FOUND", "Không tìm thấy bối cảnh.", 404)
    row = Conversation(user_id=user.id, character_id=body.character_id, scene_id=body.scene_id)
    db.add(row)
    await db.commit()
    return {"id": row.id, "character_id": row.character_id, "scene_id": row.scene_id}


async def own_conversation(db, ident, user):
    row = await db.get(Conversation, ident)
    if not row or row.user_id != user.id:
        fail("NOT_FOUND", "Không tìm thấy hội thoại.", 404)
    return row


@router.get("/conversations")
async def conversations(
    character_id: str | None = Query(default=None, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
):
    query = select(Conversation).where(Conversation.user_id == user.id)
    if character_id:
        query = query.where(Conversation.character_id == character_id)
    rows = (await db.execute(query.order_by(Conversation.updated_at.desc()).limit(100))).scalars()
    return [
        {"id": r.id, "character_id": r.character_id, "scene_id": r.scene_id, "updated_at": r.updated_at}
        for r in rows
    ]


def message_view(message):
    # Metadata carries dialogue decisions but never quota/provider usage or the system prompt.
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "segments": [{k: v for k, v in s.items() if k != "tts_text"} for s in message.segments],
        "status": message.status,
        "created_at": message.created_at,
        "reply_to": message.reply_to,
    }


@router.get("/conversations/{ident}/messages")
async def messages(ident: str, before: int | None = None, before_id: str | None = Query(default=None, max_length=36), user=Depends(require_user), db=Depends(db_session)):
    await own_conversation(db, ident, user)
    query = select(Message).where(Message.conversation_id == ident)
    if before is not None:
        condition = Message.created_at < before
        if before_id:
            condition = or_(condition, (Message.created_at == before) & (Message.id < before_id))
        query = query.where(condition)
    rows = (
        (await db.execute(query.order_by(Message.created_at.desc(), Message.id.desc()).limit(100)))
        .scalars()
        .all()
    )
    return [message_view(m) for m in reversed(rows)]


@router.delete("/conversations/{ident}")
async def delete_conversation(ident: str, user=Depends(require_user), db=Depends(db_session)):
    row = await own_conversation(db, ident, user)
    await db.delete(row)
    await db.commit()
    return {"ok": True}


class ReportInput(Input):
    character_id: str = Field(max_length=80)
    reason: str = Field(min_length=5, max_length=1000)


@router.post("/reports")
async def report(body: ReportInput, request: Request, user=Depends(require_user), db=Depends(db_session)):
    await request.app.state.limiter.check(f"report:{user.id}", 5, 3600)
    await accessible_character(db, body.character_id, user)
    db.add(Report(user_id=user.id, character_id=body.character_id, reason=body.reason))
    await db.commit()
    return {"ok": True}


@router.get("/me/stats")
async def my_stats(user=Depends(require_user), db=Depends(db_session)):
    conversations = await db.scalar(
        select(func.count()).select_from(Conversation).where(Conversation.user_id == user.id)
    )
    sent = await db.scalar(
        select(func.count())
        .select_from(Message)
        .join(Conversation)
        .where(Conversation.user_id == user.id, Message.role == "user")
    )
    return {"conversations": conversations, "sent": sent}


@router.get("/scenes/{ident}")
async def scene(ident: str, db=Depends(db_session)):
    row = await db.get(Scene, ident)
    if not row:
        fail("NOT_FOUND", "Không tìm thấy bối cảnh.", 404)
    return row.data


@router.get("/conversations/{ident}")
async def conversation(ident: str, user=Depends(require_user), db=Depends(db_session)):
    row = await own_conversation(db, ident, user)
    return {
        "id": row.id,
        "character_id": row.character_id,
        "scene_id": row.scene_id,
        "updated_at": row.updated_at,
    }
