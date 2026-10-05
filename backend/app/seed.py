import json
from pathlib import Path
from sqlalchemy import select
from .models import Character, Plan, Prompt, Scene, Voice
from .prompts import BASE_PROMPT, DEFAULT_TAGS
from .quotas import FREE, PREMIUM


async def seed(db):
    catalog = json.loads((Path(__file__).parent / "seed" / "catalog.json").read_text())
    for data in catalog["characters"]:
        if not await db.get(Character, data["id"]):
            db.add(Character(id=data["id"], data=data, visibility="public"))
    for data in catalog["scenes"]:
        if not await db.get(Scene, data["id"]):
            db.add(Scene(id=data["id"], data=data))
    for code, price, quota in (("free", 0, FREE), ("premium", 250000, PREMIUM)):
        if not (await db.execute(select(Plan).where(Plan.code == code).limit(1))).scalar_one_or_none():
            db.add(Plan(code=code, price_vnd=price, quota=quota))
    for ident, name, voice, style in (
        ("kore-warm", "Kore · Ấm áp", "Kore", "warm and friendly Vietnamese"),
        ("puck-playful", "Puck · Vui vẻ", "Puck", "playful, cheerful Vietnamese"),
        ("kore-moe", "Kore · Moe", "Kore", "high pitch, soft and sweet, playful, affectionate"),
    ):
        if not await db.get(Voice, ident):
            db.add(Voice(id=ident, name=name, voice=voice, style=style))
    if not (await db.execute(select(Prompt).limit(1))).scalar_one_or_none():
        db.add(Prompt(text=BASE_PROMPT, active_tags=DEFAULT_TAGS, published=True))
    await db.commit()
