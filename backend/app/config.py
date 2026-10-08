"""Configuration is read once at startup; provider credentials never enter public DTOs."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=False)


def flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


@dataclass
class Settings:
    environment: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./.data/lumi.db")
    )
    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", ""))
    public_url: str = field(
        default_factory=lambda: os.getenv(
            "PUBLIC_APP_URL", os.getenv("RENDER_EXTERNAL_URL", "http://localhost:3000")
        ).rstrip("/")
    )
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", ".data")))
    auto_migrate: bool = field(default_factory=lambda: flag("AUTO_MIGRATE", True))
    demo_llm: bool = field(default_factory=lambda: flag("DEMO_LLM", False))
    groq_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""))
    groq_model: str = field(default_factory=lambda: os.getenv("GROQ_LLM_MODEL", "qwen/qwen3.8-27b"))
    stt_model: str = field(default_factory=lambda: os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"))
    google_key: str = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY", ""))
    tts_model: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"))
    tts_project: str = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT", ""))
    tts_auth_mode: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_AUTH_MODE", "api_key"))
    sepay_secret: str = field(default_factory=lambda: os.getenv("SEPAY_WEBHOOK_SECRET", ""))
    sepay_token: str = field(default_factory=lambda: os.getenv("SEPAY_API_TOKEN", ""))
    sepay_environment: str = field(default_factory=lambda: os.getenv("SEPAY_ENV", "test"))
    bank_code: str = field(default_factory=lambda: os.getenv("SEPAY_BANK_CODE", ""))
    bank_account: str = field(default_factory=lambda: os.getenv("SEPAY_ACCOUNT_NUMBER", ""))
    bank_holder: str = field(default_factory=lambda: os.getenv("SEPAY_ACCOUNT_HOLDER", ""))
    payment_prefix: str = field(default_factory=lambda: os.getenv("SEPAY_PAYMENT_PREFIX", "LUMI"))
    mfa_key: str = field(default_factory=lambda: os.getenv("MFA_ENCRYPTION_KEY", ""))
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: os.getenv("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    mail_from: str = field(default_factory=lambda: os.getenv("MAIL_FROM", "lumi@localhost"))
    demo_owner_password: str = field(default_factory=lambda: os.getenv("DEMO_OWNER_PASSWORD", ""))
    demo_owner_email: str = field(default_factory=lambda: os.getenv("DEMO_OWNER_EMAIL", "demo-owner@example.com"))

    @property
    def render_demo(self):
        return self.environment == "render-demo"

    @property
    def sample_replies(self):
        return self.demo_llm or (self.render_demo and not self.groq_key)

    @property
    def production(self):
        # Hosted demos retain HTTPS cookies and staff MFA requirements.
        return self.environment in {"production", "render-demo"}

    def validate(self):
        if self.database_url.startswith(("postgres://", "postgresql://")):
            self.database_url = "postgresql+asyncpg://" + self.database_url.split("://", 1)[1]
        if self.production:
            if not self.database_url.startswith("postgresql+asyncpg://"):
                raise RuntimeError("Production requires PostgreSQL")
            if not self.public_url.startswith("https://") or not self.mfa_key:
                raise RuntimeError("Hosted environments require HTTPS and MFA_ENCRYPTION_KEY")
            if not self.render_demo and not self.redis_url:
                raise RuntimeError("Production requires HTTPS, Redis and MFA_ENCRYPTION_KEY")
            if (self.demo_llm and not self.render_demo) or self.auto_migrate:
                raise RuntimeError("Disable DEMO_LLM and AUTO_MIGRATE in production")
            from cryptography.fernet import Fernet

            Fernet(self.mfa_key.encode())
        if self.render_demo:
            if self.sepay_environment != "test":
                raise RuntimeError("Render demo cannot use live payments")
            if not 16 <= len(self.demo_owner_password) <= 128:
                raise RuntimeError("Render demo requires DEMO_OWNER_PASSWORD with 16–128 characters")
        if self.sepay_environment not in {"test", "live"}:
            raise RuntimeError("SEPAY_ENV must be test or live")
        if not self.payment_prefix.isalnum() or len(self.payment_prefix) > 10:
            raise RuntimeError("SEPAY_PAYMENT_PREFIX must contain 1–10 letters/digits")
