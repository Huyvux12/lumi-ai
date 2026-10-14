"""Private user feedback and an admin-only support inbox."""

# ruff: noqa: B008 -- FastAPI evaluates dependency declarations at route registration.

from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field, field_validator
from sqlalchemy import func, or_, select

from .models import Audit, Feedback, FeedbackMessage, User, now_ms, uid
from .schemas import Input
from .security import db_session, fail, require_admin, require_user

router = APIRouter()
Kind = Literal["bug", "feature", "other"]
Status = Literal["new", "reviewing", "planned", "resolved", "closed"]
Priority = Literal["low", "normal", "high", "urgent"]


class CreateFeedback(Input):
    kind: Kind
    title: str = Field(min_length=5, max_length=120)
    body: str = Field(min_length=20, max_length=5000)
    source_path: str | None = Field(default=None, max_length=500)

    @field_validator("source_path")
    @classmethod
    def local_path(cls, value):
        if value is None:
            return None
        if (
            not value.startswith("/")
            or value.startswith("//")
            or "\\" in value
            or any(ord(c) < 32 for c in value)
        ):
            raise ValueError("Only a local page path is accepted")
        return urlsplit(value).path


class Reply(Input):
    body: str = Field(min_length=3, max_length=5000)


class AdminReply(Reply):
    internal: bool = False


class UpdateFeedback(Input):
    version: int = Field(ge=1)
    status: Status
    priority: Priority
    assignee_id: str | None = Field(default=None, max_length=36)
    reason: str = Field(default="", max_length=5000)


class ReadFeedback(Input):
    seen_at: int = Field(ge=0)


def serialize(row, admin=False):
    data = {
        "id": row.id,
        "code": row.code,
        "kind": row.kind,
        "title": row.title,
        "body": row.body,
        "source_path": row.source_path,
        "status": row.status,
        "created_at": row.created_at,
        "updated_at": row.updated_at if admin else row.public_updated_at,
        "public_updated_at": row.public_updated_at,
        "unread": row.public_updated_at > row.last_seen_at,
    }
    if admin:
        data.update(
            user_id=row.user_id, priority=row.priority, assignee_id=row.assignee_id, version=row.version
        )
    return data


async def get_feedback(db, ident, user, *, admin=False, lock=False):
    query = select(Feedback).where(Feedback.id == ident)
    if not admin:
        query = query.where(Feedback.user_id == user.id)
    if lock:
        query = query.with_for_update()
    row = await db.scalar(query)
    if row is None:
        fail("NOT_FOUND", "Không tìm thấy phản hồi.", 404)
    return row


async def listing(db, *, user_id=None, status=None, kind=None, q="", page=1, page_size=20):
    conditions = []
    if user_id is not None:
        conditions.append(Feedback.user_id == user_id)
    if status:
        conditions.append(Feedback.status == status)
    if kind:
        conditions.append(Feedback.kind == kind)
    if q.strip():
        conditions.append(
            or_(
                Feedback.code.icontains(q.strip(), autoescape=True),
                Feedback.title.icontains(q.strip(), autoescape=True),
            )
        )
    total = await db.scalar(select(func.count()).select_from(Feedback).where(*conditions))
    order = Feedback.public_updated_at if user_id is not None else Feedback.updated_at
    rows = (
        await db.scalars(
            select(Feedback)
            .where(*conditions)
            .order_by(order.desc(), Feedback.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return {
        "items": [serialize(row, admin=user_id is None) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def detail(db, row, *, admin=False, message_page=0):
    conditions = [FeedbackMessage.feedback_id == row.id]
    if not admin:
        conditions.append(FeedbackMessage.internal.is_(False))
    total = await db.scalar(select(func.count()).select_from(FeedbackMessage).where(*conditions))
    pages = max(1, (total + 49) // 50)
    page = min(message_page or pages, pages)
    messages = (
        await db.scalars(
            select(FeedbackMessage)
            .where(*conditions)
            .order_by(FeedbackMessage.created_at, FeedbackMessage.id)
            .offset((page - 1) * 50)
            .limit(50)
        )
    ).all()
    data = serialize(row, admin)
    if admin:
        sender = await db.get(User, row.user_id)
        data["sender"] = {"id": sender.id, "username": sender.username, "name": sender.name}
    return {
        "feedback": data,
        "messages": [
            {
                "id": m.id,
                "body": m.body,
                "internal": m.internal,
                "status": m.status,
                "author_role": m.author_role,
                "created_at": m.created_at,
            }
            for m in messages
        ],
        "message_page": page,
        "message_pages": pages,
    }


def log_action(db, user, action, row, details):
    db.add(Audit(actor_id=user.id, action=action, target=row.id, details=details))


def touch(row, *, public=False):
    # Monotonic timestamps avoid losing unread updates within the same millisecond.
    row.updated_at = max(now_ms(), row.updated_at + 1)
    row.version += 1
    if public:
        row.public_updated_at = row.updated_at


@router.post("/feedback", status_code=201)
async def create(body: CreateFeedback, request: Request, user=Depends(require_user), db=Depends(db_session)):
    await request.app.state.limiter.check(f"feedback:create:{user.id}", 5, 3600)
    ident, at = uid(), now_ms()
    row = Feedback(
        id=ident,
        code="FB-" + ident.replace("-", "")[:12].upper(),
        user_id=user.id,
        kind=body.kind,
        title=body.title,
        body=body.body,
        source_path=body.source_path,
        created_at=at,
        updated_at=at,
        public_updated_at=at,
        last_seen_at=at,
    )
    db.add(row)
    await db.commit()
    return serialize(row)


@router.get("/feedback")
async def mine(
    status: Status | None = None,
    kind: Kind | None = None,
    page: int = Query(1, ge=1, le=50000),
    page_size: int = Query(20, ge=1, le=50),
    user=Depends(require_user),
    db=Depends(db_session),
):
    return await listing(db, user_id=user.id, status=status, kind=kind, page=page, page_size=page_size)


@router.get("/feedback/{ident}")
async def user_detail(
    ident: str,
    message_page: int = Query(0, ge=0, le=50000),
    user=Depends(require_user),
    db=Depends(db_session),
):
    return await detail(db, await get_feedback(db, ident, user), message_page=message_page)


@router.post("/feedback/{ident}/messages", status_code=201)
async def user_reply(
    ident: str, body: Reply, request: Request, user=Depends(require_user), db=Depends(db_session)
):
    row = await get_feedback(db, ident, user, lock=True)
    if row.status in {"resolved", "closed"}:
        fail("FEEDBACK_FINISHED", "Phản hồi đã kết thúc. Hãy gửi phản hồi mới nếu cần hỗ trợ thêm.", 409)
    await request.app.state.limiter.check(f"feedback:reply:{user.id}", 30, 3600)
    previous_public = row.public_updated_at
    touch(row, public=True)
    # A user's own reply is already seen; earlier admin updates stay unread until acknowledged.
    if row.last_seen_at >= previous_public:
        row.last_seen_at = row.public_updated_at
    db.add(
        FeedbackMessage(
            feedback_id=row.id,
            author_id=user.id,
            author_role="user",
            body=body.body,
            created_at=row.updated_at,
        )
    )
    await db.commit()
    return {"ok": True}


@router.post("/feedback/{ident}/read")
async def read(ident: str, body: ReadFeedback, user=Depends(require_user), db=Depends(db_session)):
    row = await get_feedback(db, ident, user, lock=True)
    row.last_seen_at = max(row.last_seen_at, min(body.seen_at, row.public_updated_at))
    await db.commit()
    return {"ok": True}


@router.get("/admin/feedback")
async def inbox(
    status: Status | None = None,
    kind: Kind | None = None,
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1, le=50000),
    page_size: int = Query(20, ge=1, le=50),
    user=Depends(require_admin),
    db=Depends(db_session),
):
    return await listing(db, status=status, kind=kind, q=q, page=page, page_size=page_size)


@router.get("/admin/feedback-assignees")
async def assignees(user=Depends(require_admin), db=Depends(db_session)):
    rows = (
        await db.scalars(
            select(User)
            .where(User.role.in_(("admin", "owner")), User.active.is_(True))
            .order_by(User.username)
        )
    ).all()
    return [{"id": row.id, "username": row.username, "name": row.name} for row in rows]


@router.get("/admin/feedback/{ident}")
async def admin_detail(
    ident: str,
    message_page: int = Query(0, ge=0, le=50000),
    user=Depends(require_admin),
    db=Depends(db_session),
):
    return await detail(
        db, await get_feedback(db, ident, user, admin=True), admin=True, message_page=message_page
    )


@router.post("/admin/feedback/{ident}/messages", status_code=201)
async def admin_reply(
    ident: str, body: AdminReply, request: Request, user=Depends(require_admin), db=Depends(db_session)
):
    row = await get_feedback(db, ident, user, admin=True, lock=True)
    await request.app.state.limiter.check(f"feedback:admin-reply:{user.id}", 120, 3600)
    touch(row, public=not body.internal)
    db.add(
        FeedbackMessage(
            feedback_id=row.id,
            author_id=user.id,
            author_role="admin",
            body=body.body,
            internal=body.internal,
            created_at=row.updated_at,
        )
    )
    log_action(db, user, "feedback.note" if body.internal else "feedback.reply", row, {})
    await db.commit()
    return {"ok": True}


@router.patch("/admin/feedback/{ident}")
async def update(ident: str, body: UpdateFeedback, user=Depends(require_admin), db=Depends(db_session)):
    row = await get_feedback(db, ident, user, admin=True, lock=True)
    if row.version != body.version:
        fail("FEEDBACK_CONFLICT", "Phản hồi vừa được cập nhật. Tải lại trước khi lưu.", 409)
    changed_status = row.status != body.status
    if changed_status and body.status in {"resolved", "closed"} and len(body.reason) < 3:
        fail("REASON_REQUIRED", "Nhập lời giải thích khi giải quyết hoặc đóng phản hồi.", 422)
    if body.assignee_id is not None:
        assignee = await db.get(User, body.assignee_id)
        if not assignee or not assignee.active or assignee.role not in {"admin", "owner"}:
            fail("INVALID_ASSIGNEE", "Người xử lý phải là quản trị viên đang hoạt động.", 422)
    previous = row.status
    row.status, row.priority, row.assignee_id = body.status, body.priority, body.assignee_id
    touch(row, public=changed_status)
    if changed_status:
        db.add(
            FeedbackMessage(
                feedback_id=row.id,
                author_id=user.id,
                author_role="admin",
                body=body.reason,
                status=body.status,
                created_at=row.updated_at,
            )
        )
    log_action(
        db,
        user,
        "feedback.update",
        row,
        {
            "from_status": previous,
            "status": row.status,
            "priority": row.priority,
            "assignee_id": row.assignee_id,
        },
    )
    await db.commit()
    return {"ok": True}
