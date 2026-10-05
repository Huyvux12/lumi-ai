import time
import uuid
from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid.uuid4())


def now_ms():
    return int(time.time() * 1000)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    username: Mapped[str] = mapped_column(String(20), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(String(80))
    bio: Mapped[str] = mapped_column(String(200), default="")
    hue: Mapped[int] = mapped_column(Integer, default=265)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    role: Mapped[str] = mapped_column(String(16), default="user")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    mfa_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(16))
    expires_at: Mapped[int] = mapped_column(BigInteger)


class Character(Base):
    __tablename__ = "characters"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    data: Mapped[dict] = mapped_column(JSON)
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    status: Mapped[str] = mapped_column(String(16), default="approved")
    voice_id: Mapped[str] = mapped_column(String(40), default="kore-warm")
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms, index=True)


class Scene(Base):
    __tablename__ = "scenes"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[str] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    scene_id: Mapped[str | None] = mapped_column(ForeignKey("scenes.id"), nullable=True)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms, index=True)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    segments: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="complete")
    request_key: Mapped[str | None] = mapped_column(String(160), unique=True, nullable=True)
    reply_to: Mapped[str | None] = mapped_column(String(36), nullable=True)
    prompt_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms, index=True)


class Plan(Base):
    __tablename__ = "plan_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(16), index=True)
    price_vnd: Mapped[int] = mapped_column(Integer)
    quota: Mapped[dict] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    invoice: Mapped[str] = mapped_column(String(40), unique=True)
    request_key: Mapped[str] = mapped_column(String(160), unique=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("plan_versions.id"))
    amount_vnd: Mapped[int] = mapped_column(Integer)
    environment: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    paid_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(160), default="")
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class Subscription(Base):
    __tablename__ = "subscription_periods"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), unique=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("plan_versions.id"))
    starts_at: Mapped[int] = mapped_column(BigInteger)
    ends_at: Mapped[int] = mapped_column(BigInteger)
    anchor_at: Mapped[int] = mapped_column(BigInteger)
    period_index: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Usage(Base):
    __tablename__ = "usage_ledger"
    __table_args__ = (UniqueConstraint("user_id", "kind", "request_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    request_key: Mapped[str] = mapped_column(String(160))
    period: Mapped[str] = mapped_column(String(80), index=True)
    day: Mapped[str] = mapped_column(String(10))
    amount: Mapped[int] = mapped_column(Integer, default=0)
    secondary: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="reserved")
    provider_usage: Mapped[dict] = mapped_column(JSON, default=dict)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class Voice(Base):
    __tablename__ = "voice_presets"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    voice: Mapped[str] = mapped_column(String(40))
    style: Mapped[str] = mapped_column(String(300))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Prompt(Base):
    __tablename__ = "prompt_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    text: Mapped[str] = mapped_column(Text)
    active_tags: Mapped[list] = mapped_column(JSON)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class AudioJob(Base):
    __tablename__ = "audio_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))
    request_key: Mapped[str] = mapped_column(String(160), unique=True)
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    voice_id: Mapped[str] = mapped_column(ForeignKey("voice_presets.id"))
    parts: Mapped[list] = mapped_column(JSON)
    provider_voice: Mapped[str] = mapped_column(String(40), default="Kore", server_default="Kore")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    usage_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    expires_at: Mapped[int] = mapped_column(BigInteger)


class Audit(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    character_id: Mapped[str] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), default="open")
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


from sqlalchemy import Index

Index(
    "uq_active_plan",
    Plan.code,
    unique=True,
    postgresql_where=Plan.active.is_(True),
    sqlite_where=Plan.active.is_(True),
)
Index(
    "uq_published_prompt",
    Prompt.published,
    unique=True,
    postgresql_where=Prompt.published.is_(True),
    sqlite_where=Prompt.published.is_(True),
)
Index("ix_usage_account_kind_day", Usage.user_id, Usage.kind, Usage.day)
