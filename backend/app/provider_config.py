"""Persistent choices, immutable request snapshots, and per-request price snapshots."""

from dataclasses import dataclass, field

from sqlalchemy import case, func, select

from .models import AISettings, LLMProfile, Usage
from .security import fail


@dataclass(frozen=True)
class LLMRuntime:
    id: str
    name: str
    provider: str
    base_url: str
    model: str
    key: str = field(repr=False)
    tokenizer: str = "o200k_base"
    json_mode: str = "json_object"
    token_parameter: str = "max_tokens"
    temperature: float | None = None
    reasoning_effort: str | None = None
    input_price: float | None = None
    output_price: float | None = None


@dataclass(frozen=True)
class STTRuntime:
    id: str
    model: str
    key: str = field(repr=False)
    language: str = "vi"


def key_for(settings, ref):
    return settings.groq_key if ref == "groq" else settings.llm_keys.get(ref, "")


def groq_runtime(settings):
    priced = settings.groq_model == "qwen/qwen3.8-27b"
    return LLMRuntime(
        id="groq",
        name="Groq",
        provider="groq",
        base_url="https://api.groq.com/openai/v1",
        model=settings.groq_model,
        tokenizer="qwen" if settings.groq_model.startswith("qwen/") else "o200k_base",
        key=settings.groq_key,
        token_parameter="max_completion_tokens",
        temperature=0.8,
        reasoning_effort="none" if settings.groq_model.startswith("qwen/") else None,
        input_price=0.8 if priced else None,
        output_price=4.0 if priced else None,
    )


def profile_runtime(row, settings):
    return LLMRuntime(
        id=row.id,
        name=row.name,
        provider="openai_compatible",
        base_url=row.base_url,
        model=row.model,
        key=key_for(settings, row.key_ref),
        tokenizer=row.tokenizer,
        json_mode=row.json_mode,
        token_parameter=row.token_parameter,
        temperature=row.temperature,
        reasoning_effort=row.reasoning_effort,
        input_price=row.input_price,
        output_price=row.output_price,
    )


async def resolve_llm(db, settings, ident):
    if ident == "groq":
        return groq_runtime(settings)
    row = await db.get(LLMProfile, ident)
    if row is None:
        fail("PROVIDER_NOT_FOUND", "Không tìm thấy cấu hình LLM.", 404)
    return profile_runtime(row, settings)


def resolve_stt(settings, ident):
    if ident == "groq":
        return STTRuntime("groq", settings.stt_model, settings.groq_key)
    if ident == "deepgram":
        return STTRuntime("deepgram", "nova-3", settings.deepgram_key)
    fail("INVALID_PROVIDER", "Nguồn STT không hợp lệ.", 422)


async def active_llm(db, settings):
    state = await db.get(AISettings, "global")
    return await resolve_llm(db, settings, state.llm_id if state else "groq")


async def active_stt(db, settings):
    state = await db.get(AISettings, "global")
    return resolve_stt(settings, state.stt_id if state else "groq")


def llm_usage(data, runtime):
    usage = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = data.get(key) if isinstance(data, dict) else None
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 10**10:
            usage[key] = value
    usage.update(provider=runtime.provider, profile_id=runtime.id, model=runtime.model)
    if (
        runtime.input_price is not None
        and runtime.output_price is not None
        and "prompt_tokens" in usage
        and "completion_tokens" in usage
    ):
        usage.update(
            input_price_per_million=runtime.input_price,
            output_price_per_million=runtime.output_price,
            estimated_cost_usd=round(
                (
                    usage["prompt_tokens"] * runtime.input_price
                    + usage["completion_tokens"] * runtime.output_price
                )
                / 1_000_000,
                10,
            ),
        )
    return usage


async def cost_totals(db, start, end):
    meta = Usage.provider_usage
    cost = meta["estimated_cost_usd"].as_float()
    legacy = meta["provider"].as_string().is_(None) & meta["demo"].as_boolean().is_not(True)
    legacy_cost = (
        func.coalesce(meta["prompt_tokens"].as_integer(), 0) * 0.8
        + func.coalesce(meta["completion_tokens"].as_integer(), 0) * 4
    ) / 1_000_000
    result = (
        await db.execute(
            select(
                func.coalesce(func.sum(case((cost.is_not(None), cost), (legacy, legacy_cost), else_=0)), 0),
                func.sum(
                    case((cost.is_(None) & ~legacy & meta["demo"].as_boolean().is_not(True), 1), else_=0)
                ),
                func.sum(case((legacy & (legacy_cost > 0), 1), else_=0)),
            ).where(
                Usage.kind.in_(("chat", "admin_test")),
                Usage.status == "committed",
                Usage.created_at >= start,
                Usage.created_at < end,
            )
        )
    ).one()
    return {
        "usd": round(float(result[0]), 4),
        "unpriced_requests": int(result[1] or 0),
        "legacy_requests": int(result[2] or 0),
    }
