from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Register(Input):
    email: EmailStr
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(min_length=8, max_length=128)
    name: str = Field(min_length=2, max_length=80)
    username: str = Field(pattern=r"^[a-z0-9_.]{3,20}$")
    hue: int = Field(default=265, ge=0, le=360)
    interests: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("password")
    @classmethod
    def password_not_trimmed(cls, v):
        return v


class Login(Input):
    email: EmailStr
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(min_length=1, max_length=128)
    totp_code: str | None = Field(default=None, pattern=r"^\d{6}$")


class ProfilePatch(Input):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    username: str | None = Field(default=None, pattern=r"^[a-z0-9_.]{3,20}$")
    bio: str | None = Field(default=None, max_length=200)
    hue: int | None = Field(default=None, ge=0, le=360)
    interests: list[str] | None = Field(default=None, max_length=10)


class CharacterInput(Input):
    name: str = Field(min_length=2, max_length=40)
    tagline: str = Field(min_length=10, max_length=90)
    description: str = Field(min_length=20, max_length=600)
    persona: str = Field(min_length=30, max_length=1200)
    greeting: str = Field(min_length=10, max_length=600)
    tags: list[str] = Field(min_length=1, max_length=4)
    hue: int = Field(ge=0, le=360)
    seed: str = Field(max_length=80)
    visibility: Literal["private", "public"] = "private"
    voice_id: str = "kore-warm"

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, values):
        if any(not v.strip() or len(v) > 24 for v in values):
            raise ValueError("Tags must contain 1–24 characters")
        return list(dict.fromkeys(values))


class ConversationInput(Input):
    character_id: str = Field(max_length=80)
    scene_id: str | None = Field(default=None, max_length=80)


class TurnInput(Input):
    retry_message_id: str | None = Field(default=None, max_length=80)
    text: str = Field(min_length=1, max_length=4000)


class Narration(Input):
    type: Literal["narration"]
    text: str = Field(min_length=1, max_length=2500)


class Dialogue(Input):
    type: Literal["dialogue"]
    text: str = Field(min_length=1, max_length=2500)
    emotion: Literal["neutral", "warm", "cheerful", "excited", "sad", "angry", "nervous", "sarcastic"] = (
        "neutral"
    )
    pace: Literal["slow", "normal", "fast"] = "normal"
    delivery: Literal["normal", "whispered"] = "normal"


Segment = Annotated[Narration | Dialogue, Field(discriminator="type")]


class Reply(Input):
    schema_version: Literal[1]
    segments: list[Segment] = Field(min_length=1, max_length=8)


class TTSInput(Input):
    voice_id: str | None = Field(default=None, max_length=40)


class Reason(Input):
    reason: str = Field(min_length=3, max_length=500)


class Quota(Input):
    chat_day: int = Field(ge=1, le=10000)
    chat_period: int = Field(ge=1, le=100000)
    characters: int = Field(ge=1, le=1000)
    tts_chars: int = Field(ge=0, le=10000000)
    tts_ms: int = Field(ge=0, le=360000000)
    stt_ms: int = Field(ge=0, le=360000000)
    recording_seconds: int = Field(ge=1, le=120)
    input_chars: int = Field(ge=100, le=4000)
    input_tokens: int = Field(ge=512, le=32000)
    output_tokens: int = Field(ge=100, le=2000)


class PlanPatch(Reason):
    price_vnd: int = Field(ge=0, le=10000000)
    quota: Quota


class UserPatch(Reason):
    active: bool | None = None
    role: Literal["user", "moderator", "admin", "owner"] | None = None


class PromptInput(Reason):
    text: str = Field(min_length=20, max_length=12000)
    active_tags: list[str] = Field(max_length=40)


class VoiceInput(Reason):
    name: str = Field(min_length=2, max_length=80)
    voice: str = Field(min_length=2, max_length=40)
    style: str = Field(max_length=300)
    enabled: bool
