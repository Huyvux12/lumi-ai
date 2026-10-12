import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import JSON, String, column, select, table
from app.db import database


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
