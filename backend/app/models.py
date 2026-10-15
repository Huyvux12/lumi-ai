import time
import uuid
import json
from sqlalchemy import Double, BigInteger, Boolean, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint, event
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
    signup_plan: Mapped[str] = mapped_column(String(16), default="free", server_default="free")
    role: Mapped[str] = mapped_column(String(16), default="user")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class AISettings(Base):
    __tablename__ = "ai_settings"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default="global")
    llm_id: Mapped[str] = mapped_column(String(36), default="groq")
    stt_id: Mapped[str] = mapped_column(String(16), default="groq")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class ProviderCredential(Base):
    __tablename__ = "provider_credentials"
    id: Mapped[str] = mapped_column(String(44), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text)
    suffix: Mapped[str] = mapped_column(String(4))
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class LLMProfile(Base):
    __tablename__ = "llm_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(80))
    base_url: Mapped[str] = mapped_column(String(500))
    model: Mapped[str] = mapped_column(String(160))
    key_ref: Mapped[str] = mapped_column(String(40))
    tokenizer: Mapped[str] = mapped_column(String(16), default="o200k_base")
    json_mode: Mapped[str] = mapped_column(String(16), default="json_object")
    token_parameter: Mapped[str] = mapped_column(String(24), default="max_tokens")
    temperature: Mapped[float | None] = mapped_column(Double, nullable=True)
    reasoning_effort: Mapped[str | None] = mapped_column(String(16), nullable=True)
    input_price: Mapped[float | None] = mapped_column(Double, nullable=True)
    output_price: Mapped[float | None] = mapped_column(Double, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


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
    search_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    tags_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    status: Mapped[str] = mapped_column(String(16), default="approved")
    voice_id: Mapped[str] = mapped_column(String(40), default="kore-warm")
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms, index=True)


class CharacterAvatar(Base):
    __tablename__ = "character_avatars"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


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


class PlanSettings(Base):
    __tablename__ = "plan_settings"
    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    discount_percent: Mapped[int] = mapped_column(Integer, default=0)
    promo_codes: Mapped[list] = mapped_column(JSON, default=list)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    invoice: Mapped[str] = mapped_column(String(40), unique=True)
    request_key: Mapped[str] = mapped_column(String(160), unique=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("plan_versions.id"))
    amount_vnd: Mapped[int] = mapped_column(Integer)
    list_price_vnd: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    discount_percent: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    promo_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    environment: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    paid_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reconciled_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)


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
    description_vi: Mapped[str] = mapped_column(String(300), default="", server_default="")
    description_en: Mapped[str] = mapped_column(String(300), default="", server_default="")
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


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    source_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="new", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms, index=True)
    public_updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    last_seen_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class FeedbackMessage(Base):
    __tablename__ = "feedback_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    feedback_id: Mapped[str] = mapped_column(ForeignKey("feedback.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    author_role: Mapped[str] = mapped_column(String(16))
    body: Mapped[str] = mapped_column(Text)
    internal: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


from sqlalchemy import Index

Index("ix_feedback_user_public_updated", Feedback.user_id, Feedback.public_updated_at)
Index("ix_feedback_messages_thread_time", FeedbackMessage.feedback_id, FeedbackMessage.created_at)

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


@event.listens_for(Character, "before_insert")
@event.listens_for(Character, "before_update")
def update_character_search(mapper, connection, character):
    from .search import character_search

    character.search_text = character_search(character.data)
    character.tags_text = json.dumps(character.data.get("tags", []))
