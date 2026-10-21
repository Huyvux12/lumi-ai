import io
import json

import httpx
import pytest
from app.models import Character, CharacterAvatar, User
from conftest import REPLY, register
from PIL import Image
from sqlalchemy import func, select


def image_bytes(size=(80, 60), format="PNG", **options):
    output = io.BytesIO()
    with Image.new("RGB", size, "#659ac7") as image:
        image.save(output, format=format, **options)
    return output.getvalue()


def profile(**changes):
    return {
        "name": "Harbor Keeper",
        "tagline": "The keeper of an ancient harbor library.",
        "description": "A thoughtful librarian looking for a missing book near the harbor.",
        "persona": "Friendly and observant. Speaks in gentle short sentences.",
        "scenario": "*The tide rises.* We are locked inside the lighthouse library during a storm.",
        "greeting": "*opens the library door* Come inside before the rain gets worse.",
        "tags": ["Fantasy"],
        "hue": 265,
        "seed": "harbor-keeper",
        **changes,
    }


async def upload(client, content=None, mime="image/png"):
    return await client.post(
        "/api/v1/avatars",
        files={"file": ("avatar.png", content if content is not None else image_bytes(), mime)},
    )


async def test_avatar_create_edit_list_and_remove_persist_in_database(env):
    app, client, _ = env
    account = await register(client)
    uploaded = await upload(client)
    assert uploaded.status_code == 200, uploaded.text
    avatar = uploaded.json()
    image = await client.get(avatar["image"])
    assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
    assert image.headers["cache-control"] == "no-store"
    assert image.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(image.content)) as stored:
        assert stored.format == "WEBP" and stored.size == (80, 60)
    created = await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))
    assert created.status_code == 200, created.text
    character = created.json()
    assert character["image"] == avatar["image"] and character["scenario"] == profile()["scenario"]
    for result in (
        (await client.get(f"/api/v1/characters/{character['id']}")).json(),
        next(
            c for c in (await client.get("/api/v1/characters?mine=true")).json() if c["id"] == character["id"]
        ),
    ):
        assert result["image"] == avatar["image"] and result["avatar_id"] == avatar["avatar_id"]
    async with app.state.db() as db:
        stored = await db.get(CharacterAvatar, avatar["avatar_id"])
        assert stored.owner_id == account["id"] and stored.content == image.content
    replacement = (await upload(client, image_bytes((120, 120)))).json()
    updated = await client.patch(
        f"/api/v1/characters/{character['id']}",
        json=profile(
            avatar_id=replacement["avatar_id"], scenario="A calm morning in a floating observatory."
        ),
    )
    assert updated.status_code == 200
    assert updated.json()["image"] == replacement["image"]
    assert updated.json()["scenario"] == "A calm morning in a floating observatory."
    removed = await client.patch(
        f"/api/v1/characters/{character['id']}", json=profile(avatar_id=None, scenario="")
    )
    assert removed.status_code == 200 and removed.json()["image"] is None
    assert removed.json()["scenario"] == "" and removed.json()["seed"] == "harbor-keeper"


async def test_private_unattached_and_pending_avatars_are_not_public(env):
    app, client, _ = env
    await register(client)
    avatar = (await upload(client)).json()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as guest:
        assert (await guest.get(avatar["image"])).status_code == 404
        created = (
            await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))
        ).json()
        assert (await guest.get(avatar["image"])).status_code == 404
        updated = await client.patch(
            f"/api/v1/characters/{created['id']}",
            json=profile(avatar_id=avatar["avatar_id"], visibility="public"),
        )
        assert updated.json()["status"] == "pending"
        assert (await guest.get(avatar["image"])).status_code == 404
        async with app.state.db() as db:
            character = await db.get(Character, created["id"])
            character.status = "approved"
            await db.commit()
        assert (await guest.get(avatar["image"])).status_code == 200
        async with app.state.db() as db:
            character = await db.get(Character, created["id"])
            character.status = "hidden"
            await db.commit()
        assert (await guest.get(avatar["image"])).status_code == 404
        assert (await client.get(avatar["image"])).status_code == 200


async def test_another_account_cannot_read_or_attach_private_avatar(env):
    app, client, _ = env
    await register(client)
    avatar = (await upload(client)).json()
    client.cookies.clear()
    await register(client, name="bob")
    assert (await client.get(avatar["image"])).status_code == 404
    response = await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))
    assert response.status_code == 422 and response.json()["code"] == "INVALID_AVATAR"
    owned = (await client.post("/api/v1/characters", json=profile())).json()
    response = await client.patch(
        f"/api/v1/characters/{owned['id']}", json=profile(avatar_id=avatar["avatar_id"])
    )
    assert response.status_code == 422
    async with app.state.db() as db:
        assert (
            await db.scalar(
                select(func.count()).select_from(Character).where(Character.owner_id.is_not(None))
            )
            == 1
        )
    assert (await client.get("/api/v1/avatars/../../etc/passwd")).status_code == 404


@pytest.mark.parametrize(
    "content,mime",
    [
        (b"", "image/png"),
        (b"not an image", "image/png"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/png"),
        (b"<html>not a raster image</html>", "image/webp"),
        (b"GIF89a", "image/gif"),
        (b"x" * (5 * 1024 * 1024 + 1), "image/png"),
    ],
)
async def test_invalid_images_are_rejected_without_persisting(env, content, mime):
    app, client, _ = env
    await register(client)
    response = await upload(client, content, mime)
    assert response.status_code == 422, response.text
    async with app.state.db() as db:
        assert await db.scalar(select(func.count()).select_from(CharacterAvatar)) == 0


async def test_avatar_size_orientation_and_metadata_are_normalized(env):
    _, client, _ = env
    await register(client)
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "Private source annotation"
    avatar = (await upload(client, image_bytes((1600, 800), format="JPEG", exif=exif), "image/jpeg")).json()
    result = await client.get(avatar["image"])
    with Image.open(io.BytesIO(result.content)) as image:
        assert image.size == (512, 1024)
        assert not image.getexif() and "exif" not in image.info
    assert b"Private source annotation" not in result.content


async def test_excessive_dimensions_animation_and_request_bodies_are_rejected(env):
    _, client, _ = env
    await register(client)
    oversized = await upload(client, image_bytes((4100, 4000)))
    assert oversized.status_code == 422
    output = io.BytesIO()
    with Image.new("RGB", (10, 10), "red") as first, Image.new("RGB", (10, 10), "blue") as second:
        first.save(output, format="WEBP", save_all=True, append_images=[second], duration=100)
    assert (await upload(client, output.getvalue(), "image/webp")).status_code == 422
    huge = await client.post(
        "/api/v1/avatars", content=b"x" * (6 * 1024 * 1024 + 1), headers={"Content-Type": "image/png"}
    )
    assert huge.status_code == 413


async def test_legacy_edit_preserves_avatar_and_scenario(env):
    _, client, _ = env
    await register(client)
    avatar = (await upload(client)).json()
    created = (await client.post("/api/v1/characters", json=profile(avatar_id=avatar["avatar_id"]))).json()
    legacy = profile()
    legacy.pop("scenario")
    updated = await client.patch(f"/api/v1/characters/{created['id']}", json=legacy)
    assert updated.status_code == 200
    assert updated.json()["image"] == avatar["image"]
    assert updated.json()["scenario"] == created["scenario"]
    assert (await client.post("/api/v1/characters", json=profile(scenario="x" * 1201))).status_code == 422


async def test_scenario_reaches_chat_preview_and_budgeted_system_prompt(env):
    app, client, _ = env
    await register(client)
    captured = []

    def provider(request):
        body = json.loads(request.content)
        captured.append(body["messages"])
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(REPLY)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 800, "completion_tokens": 70},
            },
        )

    await app.state.http.aclose()
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    created = (await client.post("/api/v1/characters", json=profile())).json()
    conv = (await client.post("/api/v1/conversations", json={"character_id": created["id"]})).json()
    chat = await client.post(
        f"/api/v1/conversations/{conv['id']}/turns",
        json={"text": "*opens a book* Hello"},
        headers={"Idempotency-Key": "scenario-chat-request"},
    )
    assert chat.status_code == 200 and "turn.completed" in chat.text
    preview = await client.post(
        "/api/v1/chat/preview",
        json={"character": profile(), "text": "Hello again"},
        headers={"Idempotency-Key": "scenario-preview-request"},
    )
    assert preview.status_code == 200, preview.text
    assert len(captured) == 2
    for messages in captured:
        system = messages[0]["content"]
        assert profile()["scenario"] in system and profile()["persona"] in system
        assert profile()["description"] in system and "OUTPUT_SCHEMA" in system
        assert "narration" in system and "dialogue" in system
    assert captured[0][-1]["content"] == "*opens a book* Hello"
    assert (await client.get(f"/api/v1/characters/{created['id']}")).json()["greeting"] == profile()[
        "greeting"
    ]


async def test_avatar_upload_reuses_existing_auth_and_plan_permissions(env):
    app, client, _ = env
    assert (await upload(client)).status_code == 401
    await register(client)
    from app.models import PlanSettings

    async with app.state.db() as db:
        free = await db.get(PlanSettings, "free")
        free.enabled = False
        await db.commit()
    # Closing Free only holds waitlisted sign-ups; existing accounts keep uploading.
    assert (await upload(client)).status_code == 200
    async with app.state.db() as db:
        (await db.scalar(select(User))).waitlisted = True
        await db.commit()
    response = await upload(client)
    assert response.status_code == 403 and response.json()["code"] == "PLAN_CLOSED"
