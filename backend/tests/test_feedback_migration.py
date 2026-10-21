"""Exercise the deployed schema, including upgrade from the previous release."""

import os
import subprocess
import sys
from pathlib import Path

import httpx
from conftest import register
from sqlalchemy import select, text

from app.config import Settings
from app.db import database
from app.main import create_app
from app.models import Feedback, User


async def test_feedback_upgrade_serves_api_without_create_all_and_preserves_existing_users(tmp_path):
    root = Path(__file__).parents[2]
    url = "sqlite+aiosqlite:///" + str(tmp_path / "upgrade.db")
    env = {**os.environ, "APP_ENV": "development", "DATABASE_URL": url, "DATA_DIR": str(tmp_path)}

    def migrate(action, target=None):
        subprocess.run(
            [
                sys.executable,
                "-m",
                "alembic",
                "-c",
                "backend/alembic.ini",
                action,
                *([target] if target else []),
            ],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
        )

    migrate("upgrade", "3e9b61a20f47")
    engine, factory = database(url)
    async with factory() as db:
        # Raw SQL: the ORM model has columns this older schema does not.
        await db.execute(
            text(
                "INSERT INTO users (id, username, email, name, password_hash, bio, hue, interests,"
                " signup_plan, role, active, email_verified, mfa_enabled, created_at) VALUES"
                " ('legacy-user', 'legacy', 'legacy@example.com', 'Legacy User', 'unused', '', 265,"
                " '[]', 'free', 'user', 1, 0, 0, 0)"
            )
        )
        await db.commit()
    await engine.dispose()
    migrate("upgrade", "head")
    migrate("check")
    app = create_app(Settings(database_url=url, data_dir=tmp_path, auto_migrate=False, redis_url=""))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-Lumi-Request": "1"}
        ) as client,
    ):
        await register(client)
        response = await client.post(
            "/api/v1/feedback",
            json={
                "kind": "feature",
                "title": "A migrated feedback",
                "body": "Feedback works on the migrated deployment schema.",
            },
        )
        assert response.status_code == 201, response.text
        ident = response.json()["id"]
        assert (await client.get(f"/api/v1/feedback/{ident}")).status_code == 200
        async with app.state.db() as db:
            assert (await db.get(User, "legacy-user")).name == "Legacy User"
    migrate("downgrade", "3e9b61a20f47")
    migrate("upgrade", "head")
    migrate("check")
    engine, factory = database(url)
    try:
        async with factory() as db:
            assert (await db.get(User, "legacy-user")).name == "Legacy User"
            assert (await db.scalars(select(Feedback))).all() == []
    finally:
        await engine.dispose()
