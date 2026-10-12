import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import JSON, String, column, select, table

from app.db import database
from app.models import Voice


async def test_existing_character_search_is_backfilled_by_upgrade(tmp_path):
    root = Path(__file__).parents[2]
    url = "sqlite+aiosqlite:///" + str(tmp_path / "legacy.db")
    env = {**os.environ, "APP_ENV": "development", "DATABASE_URL": url, "DATA_DIR": str(tmp_path)}

    def migrate(target):
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", target],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
        )

    migrate("82c7f03d9a16")
    engine, factory = database(url)
    characters = table(
        "characters",
        column("id", String()),
        column("data", JSON()),
        column("visibility"),
        column("status"),
        column("voice_id"),
        column("created_at"),
        column("updated_at"),
    )
    async with factory() as db:
        await db.execute(
            characters.insert().values(
                id="legacy",
                data={"name": "Café Đêm", "tags": ["Fantasy"]},
                visibility="public",
                status="approved",
                voice_id="kore-warm",
                created_at=1,
                updated_at=1,
            )
        )
        await db.commit()
    await engine.dispose()
    migrate("head")
    engine, factory = database(url)
    migrated = table(
        "characters", column("id"), column("search_text"), column("tags_text"), column("data", JSON())
    )
    try:
        async with factory() as db:
            row = (await db.execute(select(migrated))).one()
            assert "cafe dem" in row.search_text and "fantasy" in row.search_text
            assert row.tags_text == '["Fantasy"]'
            assert row.data == {"name": "Café Đêm", "tags": ["Fantasy"]}
    finally:
        await engine.dispose()


async def test_voice_upgrade_seeds_all_studio_voices_preserving_legacy_configuration(tmp_path):
    root = Path(__file__).parents[2]
    url = "sqlite+aiosqlite:///" + str(tmp_path / "voices.db")
    env = {**os.environ, "APP_ENV": "development", "DATABASE_URL": url, "DATA_DIR": str(tmp_path)}

    def migrate(action, target):
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", action, target],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
        )

    migrate("upgrade", "6ab83e12d901")
    engine, factory = database(url)
    legacy = table("voice_presets", *(column(k) for k in ("id", "name", "voice", "style", "enabled")))
    async with factory() as db:
        await db.execute(
            legacy.insert().values(
                id="kore-moe",
                name="Legacy custom name",
                voice="Kore",
                style="quiet custom delivery",
                enabled=False,
            )
        )
        await db.commit()
    await engine.dispose()
    migrate("upgrade", "head")
    # Additive presets survive rollback so character/audio references remain valid.
    migrate("downgrade", "6ab83e12d901")
    migrate("upgrade", "head")
    engine, factory = database(url)
    try:
        async with factory() as db:
            rows = (await db.scalars(select(Voice))).all()
            assert len(rows) == 33
            assert len({v.voice for v in rows}) == 30
            assert all(v.description_vi and v.description_en for v in rows)
            row = next(v for v in rows if v.id == "kore-moe")
            assert (row.name, row.style, row.enabled) == (
                "Legacy custom name",
                "quiet custom delivery",
                False,
            )
    finally:
        await engine.dispose()

    # The migrated DB serves the catalog before startup seed is run.
    import httpx

    from app.config import Settings
    from app.main import create_app

    app = create_app(Settings(database_url=url, data_dir=tmp_path, auto_migrate=False))
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/voices")
            assert response.status_code == 200
            assert len(response.json()) == 32
            assert sum(v["id"].startswith("gemini-") for v in response.json()) == 30
    finally:
        await app.state.engine.dispose()
