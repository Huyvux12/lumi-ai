import json

import httpx
from conftest import provider, register, turn
from sqlalchemy import select
from test_admin import owner
from test_character_media import profile

from app.models import Voice
from app.seed import seed

EXPECTED = [
    "Zephyr",
    "Puck",
    "Charon",
    "Kore",
    "Fenrir",
    "Leda",
    "Orus",
    "Aoede",
    "Callirrhoe",
    "Autonoe",
    "Enceladus",
    "Iapetus",
    "Umbriel",
    "Algieba",
    "Despina",
    "Erinome",
    "Algenib",
    "Rasalgethi",
    "Laomedeia",
    "Achernar",
    "Alnilam",
    "Schedar",
    "Gacrux",
    "Pulcherrima",
    "Achird",
    "Zubenelgenubi",
    "Vindemiatrix",
    "Sadachbia",
    "Sadaltager",
    "Sulafat",
]
LEGACY = {"kore-warm", "puck-playful", "kore-moe"}


async def test_public_catalog_contains_all_official_and_styled_presets(env):
    app, client, _ = env
    response = await client.get("/api/v1/voices")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 33
    assert {v["id"] for v in rows} == {"gemini-" + v.lower() for v in EXPECTED} | LEGACY
    assert all(v["description_vi"] and v["description_en"] for v in rows)
    async with app.state.db() as db:
        voices = (await db.scalars(select(Voice))).all()
        assert {v.voice for v in voices} == set(EXPECTED)
        assert all(v.style == "" for v in voices if v.id.startswith("gemini-"))


async def test_reseed_preserves_admin_edits_and_disabled_presets(env):
    app, client, _ = env
    async with app.state.db() as db:
        row = await db.get(Voice, "gemini-zephyr")
        row.enabled = False
        row.name = "Edited name"
        row.style = "whispered"
        row.description_vi, row.description_en = "Tùy chỉnh", "Custom tone"
        legacy = await db.get(Voice, "kore-moe")
        legacy.style = "custom affectionate tone"
        await db.commit()
        await seed(db)
        await seed(db)
    rows = (await client.get("/api/v1/voices")).json()
    assert len(rows) == 32 and "gemini-zephyr" not in {r["id"] for r in rows}
    async with app.state.db() as db:
        row = await db.get(Voice, "gemini-zephyr")
        assert (row.name, row.style, row.description_vi, row.description_en) == (
            "Edited name",
            "whispered",
            "Tùy chỉnh",
            "Custom tone",
        )
        assert (await db.get(Voice, "kore-moe")).style == "custom affectionate tone"


async def test_admin_accepts_all_studio_voices_rejects_unknown_and_preserves_omitted_descriptions(env):
    app, client, _ = env
    await owner(app, client)
    original = next(v for v in (await client.get("/api/v1/admin/voices")).json() if v["id"] == "kore-warm")
    for voice in EXPECTED:
        body = {
            "name": "Custom preset",
            "voice": voice,
            "style": "",
            "enabled": True,
            "reason": "Verify official studio voice support",
        }
        response = await client.patch("/api/v1/admin/voices/kore-warm", json=body)
        assert response.status_code == 200, response.text
    unchanged = next(v for v in (await client.get("/api/v1/admin/voices")).json() if v["id"] == "kore-warm")
    assert unchanged["description_vi"] == original["description_vi"]
    assert unchanged["description_en"] == original["description_en"]
    body["voice"] = "MadeUpVoice"
    response = await client.patch("/api/v1/admin/voices/kore-warm", json=body)
    assert response.status_code == 400 and response.json()["code"] == "INVALID_VOICE"
    # Still offer all voices even if every preset formerly using one is remapped.
    await client.patch("/api/v1/admin/voices/gemini-zephyr", json={**body, "voice": "Sulafat"})
    assert set((await client.get("/api/v1/admin/voices/options")).json()) == set(EXPECTED)
    body.update(voice="Sulafat", description_vi="Dịu ấm tùy chỉnh", description_en="Custom gentle warmth")
    assert (await client.patch("/api/v1/admin/voices/kore-warm", json=body)).status_code == 200
    rows = (await client.get("/api/v1/admin/voices")).json()
    edited = next(v for v in rows if v["id"] == "kore-warm")
    assert edited["description_vi"] == body["description_vi"]
    assert edited["description_en"] == body["description_en"]
    assert len(rows) == 33


async def test_new_voice_persists_on_character_and_reaches_tts_with_override(env):
    app, client, _ = env
    captured = []

    def tts_provider(request):
        if ":streamGenerateContent" in request.url.path:
            data = json.loads(request.content)
            captured.append(data["generationConfig"]["speechConfig"]["voiceConfig"]["voice"])
            assert not data["contents"][0]["parts"][0]["speechMetadata"]["style"].startswith(",")
            # Reuse the PCM/transcript fixture, which checks the old default voice.
            data["generationConfig"]["speechConfig"]["voiceConfig"]["voice"] = "Kore"
            request = httpx.Request(request.method, request.url, json=data)
        return provider(request)

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(tts_provider))
    await register(client)
    body = {**profile(), "voice_id": "gemini-sulafat"}
    created = await client.post("/api/v1/characters", json=body)
    assert created.status_code == 200, created.text
    ident = created.json()["id"]
    assert (await client.get(f"/api/v1/characters/{ident}")).json()["voice_id"] == "gemini-sulafat"
    conv = (await client.post("/api/v1/conversations", json={"character_id": ident})).json()["id"]
    answer = await turn(client, conv)
    for i, selection in enumerate([{}, {"voice_id": "gemini-zephyr"}]):
        result = await client.post(
            f"/api/v1/messages/{answer['id']}/tts",
            json=selection,
            headers={"Idempotency-Key": f"studio-voice-test-{i}"},
        )
        assert result.status_code == 200, result.text
        pcm = await client.get(result.json()["stream_url"])
        assert pcm.status_code == 200 and len(pcm.content) == 4800
    assert captured == ["Sulafat", "Zephyr"]
    body["voice_id"] = "gemini-achird"
    assert (await client.patch(f"/api/v1/characters/{ident}", json=body)).status_code == 200
    assert (await client.get(f"/api/v1/characters/{ident}")).json()["voice_id"] == "gemini-achird"
    async with app.state.db() as db:
        row = await db.get(Voice, "gemini-achird")
        row.enabled = False
        await db.commit()
    unavailable = await client.post(
        f"/api/v1/messages/{answer['id']}/tts", json={}, headers={"Idempotency-Key": "disabled-studio-voice"}
    )
    assert unavailable.status_code == 422 and unavailable.json()["code"] == "INVALID_VOICE"
