"""Upgrade the deployed provider schema without recreating existing tables."""

import os
import subprocess
import sys
from pathlib import Path

import httpx
from sqlalchemy import select
from test_admin import owner

from app.config import Settings
from app.db import database
from app.main import create_app
from app.models import AISettings, LLMProfile, ProviderCredential
from app.provider_config import active_llm


async def test_key_upgrade_preserves_profiles_and_key_survives_restart(tmp_path):
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

    migrate("upgrade", "c1d82e4f630a")
    engine, factory = database(url)
    async with factory() as db:
        db.add(
            LLMProfile(
                id="existing",
                name="Existing OpenAI",
                base_url="https://api.openai.com/v1",
                model="gpt-4o-mini",
                key_ref="existing",
            )
        )
        state = await db.get(AISettings, "global")
        state.llm_id = "existing"
        state.version = 7
        await db.commit()
    await engine.dispose()
    migrate("upgrade", "head")
    migrate("check")
    cfg = Settings(
        database_url=url,
        data_dir=tmp_path,
        auto_migrate=False,
        redis_url="",
        llm_keys={"existing": "server-original-key"},
        credential_key="",
        mfa_key="",
    )
    app = create_app(cfg)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-Lumi-Request": "1"}
        ) as client,
    ):
        await owner(app, client)
        response = await client.put(
            "/api/v1/admin/providers/keys/llm:existing",
            json={"version": 7, "api_key": "persisted-secret-5678"},
        )
        assert response.status_code == 200, response.text
    # A new application instance loads the persisted ciphertext and private key file.
    app = create_app(cfg)
    async with app.router.lifespan_context(app), app.state.db() as db:
        assert (await active_llm(db, cfg)).key == "persisted-secret-5678"
        assert (await db.get(AISettings, "global")).version == 8
    migrate("downgrade", "c1d82e4f630a")
    migrate("upgrade", "head")
    migrate("check")
    engine, factory = database(url)
    try:
        async with factory() as db:
            assert (await db.get(LLMProfile, "existing")).name == "Existing OpenAI"
            assert (await db.get(AISettings, "global")).llm_id == "existing"
            assert list(await db.scalars(select(ProviderCredential))) == []
    finally:
        await engine.dispose()
