import asyncio
import json
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from .catalog_api import accessible_character, message_view, own_conversation
from .models import Message, Prompt, Scene, Usage, now_ms
from .prompts import assistant_model_content
from .providers import generate_reply
from .quotas import entitlement, finish, reserve
from .schemas import TurnInput
from .security import db_session, fail, require_user

router = APIRouter()


def event(name, data):
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def replay(message):
    yield event("turn.started", {"id": message.id})
    for segment in message_view(message)["segments"]:
        yield event("segment.completed", {"id": message.id, "segment": segment})
    yield event("turn.completed", {"message": message_view(message)})


@router.post("/conversations/{ident}/turns")
async def turn(
    ident: str,
    body: TurnInput,
    request: Request,
    idempotency_key: str = Header(min_length=8, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
):
    settings = request.app.state.settings
    if settings.production and not settings.render_demo and not user.email_verified:
        fail("EMAIL_REQUIRED", "Vui lòng xác minh email trước khi trò chuyện.", 403)
    await request.app.state.limiter.check(f"chat:{user.id}", 30)
    conversation = await own_conversation(db, ident, user)
    character = await accessible_character(db, conversation.character_id, user)
    key = f"{user.id}:{idempotency_key}"
    previous = (await db.execute(select(Message).where(Message.request_key == key))).scalar_one_or_none()
    if previous:
        if previous.conversation_id != ident:
            fail("KEY_CONFLICT", "Mã yêu cầu đã được dùng cho hội thoại khác.", 409)
        if previous.status == "complete":
            return StreamingResponse(replay(previous), media_type="text/event-stream")
        fail("REQUEST_ACTIVE", "Yêu cầu đã được nhận. Hãy tải lại hội thoại.", 409)
    plan, _, _ = await entitlement(db, user.id)
    if len(body.text) > plan.quota["input_chars"]:
        fail("MESSAGE_TOO_LONG", "Tin nhắn quá dài. Vui lòng rút ngắn.", 422)
    usage, fresh = await reserve(db, user.id, "chat", idempotency_key, 1)
    if not fresh:
        fail("KEY_CONFLICT", "Mã yêu cầu đã được sử dụng.", 409)
    prompt = (
        await db.execute(
            select(Prompt).where(Prompt.published.is_(True)).order_by(Prompt.created_at.desc()).limit(1)
        )
    ).scalar_one()
    scene = await db.get(Scene, conversation.scene_id) if conversation.scene_id else None
    retry_message = None
    conditions = [Message.conversation_id == ident, Message.status == "complete"]
    if body.retry_message_id:
        retry_message = await db.get(Message, body.retry_message_id)
        if (
            not retry_message
            or retry_message.conversation_id != ident
            or retry_message.role != "user"
            or retry_message.content != body.text
        ):
            fail("INVALID_RETRY", "Không thể tạo lại phản hồi này.", 400)
        conditions.append(Message.created_at < retry_message.created_at)
    old = (
        (
            await db.execute(
                select(Message)
                .where(
                    *conditions,
                )
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(40)
            )
        )
        .scalars()
        .all()
    )
    history = [{"role": m.role, "content": assistant_model_content(m)} for m in reversed(old)]
    history.append({"role": "user", "content": body.text})
    user_message = retry_message or Message(conversation_id=ident, role="user", content=body.text)
    if not retry_message:
        db.add(user_message)
        await db.flush()
    answer = Message(
        conversation_id=ident,
        role="assistant",
        status="generating",
        request_key=key,
        reply_to=user_message.id,
        prompt_id=prompt.id,
        created_at=now_ms() + 1,
    )
    db.add(answer)
    conversation.updated_at = now_ms()
    await db.commit()
    factory = request.app.state.db

    async def stream():
        success, meta = False, {}
        yield event("turn.started", {"id": answer.id, "user_message": message_view(user_message)})
        task = asyncio.current_task()
        request.app.state.chat_tasks[answer.id] = task
        try:
            segments, meta = await generate_reply(
                request.app.state.http, settings, prompt, character, scene, history, plan.quota
            )
            async with factory() as update:
                current = await update.get(Message, answer.id, with_for_update=True)
                if not current or current.status != "generating":
                    return
                current.segments = segments
                current.content = "\n\n".join(
                    f"*{s['text']}*" if s["type"] == "narration" else s["text"] for s in segments
                )
                current.status = "complete"
                await update.commit()
                public = message_view(current)
            success = True
            await finish(factory, usage.id, success=True, provider_usage=meta)
            for segment in public["segments"]:
                yield event("segment.completed", {"id": answer.id, "segment": segment})
            yield event("turn.completed", {"message": public, "mode": "demo" if meta.get("demo") else "live"})
        except asyncio.CancelledError:
            raise
        except Exception:
            yield event(
                "turn.failed", {"id": answer.id, "message": "Chưa thể tạo phản hồi. Vui lòng thử lại."}
            )
        finally:
            request.app.state.chat_tasks.pop(answer.id, None)

            async def cleanup():
                async with factory() as update:
                    current = await update.get(Message, answer.id)
                    if current and current.status == "generating":
                        current.status = "failed"
                        await update.commit()
                await finish(factory, usage.id, success=success, provider_usage=meta)

            await asyncio.shield(cleanup())

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/turns/{ident}/cancel")
async def cancel(ident: str, request: Request, user=Depends(require_user), db=Depends(db_session)):
    message = await db.get(Message, ident)
    if not message:
        fail("NOT_FOUND", "Không tìm thấy phản hồi.", 404)
    await own_conversation(db, message.conversation_id, user)
    if message.status == "generating":
        message.status = "interrupted"
        await db.commit()
        task = request.app.state.chat_tasks.get(ident)
        if task:
            task.cancel()
    return {"ok": True}


from .schemas import CharacterInput, Input
from pydantic import Field
from types import SimpleNamespace


class PreviewInput(Input):
    character: CharacterInput
    text: str = Field(min_length=1, max_length=4000)


@router.post("/chat/preview")
async def preview(
    body: PreviewInput,
    request: Request,
    idempotency_key: str = Header(min_length=8, max_length=80),
    user=Depends(require_user),
    db=Depends(db_session),
):
    await request.app.state.limiter.check(f"preview:{user.id}", 10)
    plan, _, _ = await entitlement(db, user.id)
    if len(body.text) > plan.quota["input_chars"]:
        fail("MESSAGE_TOO_LONG", "Tin nhắn quá dài. Vui lòng rút ngắn.", 422)
    usage, fresh = await reserve(db, user.id, "chat", idempotency_key, 1)
    if not fresh:
        fail("KEY_CONFLICT", "Mã yêu cầu đã được sử dụng.", 409)
    prompt = (await db.execute(select(Prompt).where(Prompt.published.is_(True)))).scalar_one()
    await db.commit()
    try:
        segments, metadata = await generate_reply(
            request.app.state.http,
            request.app.state.settings,
            prompt,
            SimpleNamespace(data=body.character.model_dump()),
            None,
            [{"role": "user", "content": body.text}],
            plan.quota,
        )
        await finish(request.app.state.db, usage.id, success=True, provider_usage=metadata)
        return {
            "content": "\n\n".join(s["text"] for s in segments),
            "mode": "demo" if metadata.get("demo") else "live",
        }
    except BaseException:
        await asyncio.shield(finish(request.app.state.db, usage.id, success=False))
        raise
