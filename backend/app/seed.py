import json
from pathlib import Path
from sqlalchemy import select
from .models import AISettings, Character, Plan, PlanSettings, Prompt, Scene, Voice
from .prompts import BASE_PROMPT, DEFAULT_TAGS
from .quotas import FREE, PREMIUM
from .voice_catalog import VOICE_PRESETS


async def seed(db):
    if not await db.get(AISettings, "global"):
        db.add(AISettings(id="global", llm_id="groq", stt_id="groq", version=1))
    catalog = json.loads((Path(__file__).parent / "seed" / "catalog.json").read_text())
    for data in catalog["characters"]:
        if not await db.get(Character, data["id"]):
            db.add(Character(id=data["id"], data=data, visibility="public"))
    for data in catalog["scenes"]:
        if not await db.get(Scene, data["id"]):
            db.add(Scene(id=data["id"], data=data))
    for code, price, quota in (("free", 0, FREE), ("premium", 250000, PREMIUM)):
        if not await db.get(PlanSettings, code):
            db.add(PlanSettings(code=code, enabled=True, discount_percent=0, promo_codes=[]))
        if not (await db.execute(select(Plan).where(Plan.code == code).limit(1))).scalar_one_or_none():
            db.add(Plan(code=code, price_vnd=price, quota=quota))
    for preset in VOICE_PRESETS:
        row = await db.get(Voice, preset["id"])
        if row is None:
            db.add(Voice(**preset))
    if not (await db.execute(select(Prompt).limit(1))).scalar_one_or_none():
        db.add(Prompt(text=BASE_PROMPT, active_tags=DEFAULT_TAGS, published=True))
    await db.commit()
