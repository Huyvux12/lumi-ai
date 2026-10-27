"""Configuration is read once at startup; provider credentials never enter public DTOs."""

import os
import json
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=False)


def flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


def provider_value(name, default):
    try:
        config = json.loads(os.getenv("AI_PROVIDER_CONFIG_JSON", "{}") or "{}")
        if not isinstance(config, dict):
            raise ValueError
        return config.get(name, default)
    except (ValueError, TypeError):
        raise RuntimeError("AI_PROVIDER_CONFIG_JSON must be a JSON object") from None


@dataclass
class Settings:
    environment: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./.data/lumi.db")
    )
    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", ""))
    public_url: str = field(
        default_factory=lambda: os.getenv("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
    )
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", ".data")))
    auto_migrate: bool = field(default_factory=lambda: flag("AUTO_MIGRATE", True))
    demo_llm: bool = field(default_factory=lambda: flag("DEMO_LLM", False))
    groq_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""))
    groq_model: str = field(default_factory=lambda: os.getenv("GROQ_LLM_MODEL", "qwen/qwen3.8-27b"))
    stt_model: str = field(default_factory=lambda: os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"))
    deepgram_key: str = field(
        repr=False,
        default_factory=lambda: os.getenv("DEEPGRAM_API_KEY") or provider_value("deepgram_api_key", ""),
    )
    credential_key: str = field(
        repr=False,
        default_factory=lambda: os.getenv("AI_CREDENTIAL_ENCRYPTION_KEY")
        or provider_value("credential_encryption_key", ""),
    )
    llm_keys: dict = field(
        repr=False,
        default_factory=lambda: (
            json.loads(os.environ["LLM_API_KEYS_JSON"])
            if os.getenv("LLM_API_KEYS_JSON")
            else provider_value("llm_api_keys", {})
        ),
    )
    llm_allowed_hosts: list[str] = field(
        default_factory=lambda: (
            os.environ["LLM_ALLOWED_HOSTS"].split(",")
            if os.getenv("LLM_ALLOWED_HOSTS")
            else provider_value("llm_allowed_hosts", ["api.openai.com", "openrouter.ai", "api.groq.com"])
        )
    )
    google_key: str = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY", ""))
    tts_model: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"))
    tts_project: str = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT", ""))
    tts_auth_mode: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_AUTH_MODE", "api_key"))
    # Gemini TTS quota is per minute for the whole project; stay one under the provider limit.
    tts_rpm: int = field(default_factory=lambda: int(os.getenv("GEMINI_TTS_RPM", "9")))
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

    @property
    def production(self):
        return self.environment == "production"

    def validate(self):
        import re

        if self.credential_key:
            from cryptography.fernet import Fernet

            try:
                Fernet(self.credential_key.encode())
            except (ValueError, TypeError, AttributeError):
                raise RuntimeError("AI_CREDENTIAL_ENCRYPTION_KEY must be a Fernet key") from None

        if (
            not isinstance(self.deepgram_key, str)
            or any(ord(c) < 32 for c in self.deepgram_key)
            or not isinstance(self.llm_keys, dict)
            or len(self.llm_keys) > 50
        ):
            raise RuntimeError("Invalid AI provider credentials configuration")
        if any(
            not isinstance(k, str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", k)
            or not isinstance(v, str)
            or len(v) > 8192
            or any(ord(c) < 32 for c in v)
            for k, v in self.llm_keys.items()
        ):
            raise RuntimeError("Invalid LLM key references")
        if (
            not isinstance(self.llm_allowed_hosts, list)
            or len(self.llm_allowed_hosts) > 50
            or any(not isinstance(host, str) for host in self.llm_allowed_hosts)
        ):
            raise RuntimeError("LLM_ALLOWED_HOSTS must be a list of trusted public hostnames")
        self.llm_allowed_hosts = [host.strip().lower() for host in self.llm_allowed_hosts if host.strip()]
        if self.database_url.startswith(("postgres://", "postgresql://")):
            self.database_url = "postgresql+asyncpg://" + self.database_url.split("://", 1)[1]
        if self.production:
            if not self.database_url.startswith("postgresql+asyncpg://"):
                raise RuntimeError("Production requires PostgreSQL")
            if not self.public_url.startswith("https://") or not self.redis_url or not self.mfa_key:
                raise RuntimeError("Production requires HTTPS, Redis and MFA_ENCRYPTION_KEY")
            if self.demo_llm or self.auto_migrate:
                raise RuntimeError("Disable DEMO_LLM and AUTO_MIGRATE in production")
        if self.sepay_environment not in {"test", "live"}:
            raise RuntimeError("SEPAY_ENV must be test or live")
        if not self.payment_prefix.isalnum() or len(self.payment_prefix) > 10:
            raise RuntimeError("SEPAY_PAYMENT_PREFIX must contain 1–10 letters/digits")
