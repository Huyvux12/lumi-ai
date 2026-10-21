"""Plan tiers, their seed price/quota and public copy.

Quota ceilings are sized from provider cost at full use: LLM 280 VND per 1M tokens
(input and output), TTS 695 VND per 1,000 characters, STT not counted. Free stays
under ~1,500 VND a month; paid tiers keep roughly 70% margin when fully used.
Seed values only — live prices and quotas are immutable versions edited by the owner.
"""

FREE = dict(
    chat_day=20,
    chat_period=250,
    characters=3,
    tts_chars=1600,
    tts_ms=120000,
    stt_ms=300000,
    recording_seconds=60,
    input_chars=2000,
    input_tokens=2048,
    output_tokens=400,
)
BASIC = dict(
    chat_day=60,
    chat_period=1500,
    characters=8,
    tts_chars=15000,
    tts_ms=1200000,
    stt_ms=3600000,
    recording_seconds=90,
    input_chars=3000,
    input_tokens=4096,
    output_tokens=500,
)
PLUS = dict(
    chat_day=120,
    chat_period=3000,
    characters=20,
    tts_chars=30000,
    tts_ms=2400000,
    stt_ms=7200000,
    recording_seconds=120,
    input_chars=4000,
    input_tokens=6144,
    output_tokens=600,
)
PREMIUM = dict(
    chat_day=300,
    chat_period=8000,
    characters=50,
    tts_chars=75000,
    tts_ms=6000000,
    stt_ms=18000000,
    recording_seconds=120,
    input_chars=4000,
    input_tokens=8192,
    output_tokens=800,
)

# Ordered from lowest to highest tier; the position is the upgrade rank.
PLANS = {
    "free": dict(
        label="Free",
        price_vnd=0,
        quota=FREE,
        description="Khám phá nhân vật, trò chuyện và dùng thử giọng nói với giới hạn cơ bản.",
    ),
    "basic": dict(
        label="Basic",
        price_vnd=50000,
        quota=BASIC,
        description="Trò chuyện thường xuyên hơn, tạo thêm nhân vật và nghe nhân vật đọc lời thoại.",
    ),
    "plus": dict(
        label="Plus",
        price_vnd=99000,
        quota=PLUS,
        description="Hội thoại dài hơn, nhiều thời lượng giọng nói hơn cho người dùng hằng ngày.",
    ),
    "premium": dict(
        label="Premium",
        price_vnd=250000,
        quota=PREMIUM,
        description="Giới hạn rộng nhất cho trò chuyện, nhân vật và hội thoại giọng nói.",
    ),
}
PAID_CODES = tuple(code for code, plan in PLANS.items() if plan["price_vnd"])


def plan_label(code):
    return PLANS[code]["label"] if code in PLANS else code


def plan_rank(code):
    return list(PLANS).index(code) if code in PLANS else -1
