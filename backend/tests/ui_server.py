"""Local UI test harness only. Production uses app.main:app and never imports this module."""

from pathlib import Path
import asyncio
import tempfile
from contextlib import asynccontextmanager
import httpx
from app.config import Settings
from app.main import create_app
from app.models import User
from app.security import passwords
from conftest import provider

directory = Path(tempfile.mkdtemp(prefix="lumi-browser-tests-"))
app = create_app(
    Settings(
        data_dir=directory,
        database_url="sqlite+aiosqlite:///" + str(directory / "test.db"),
        groq_key="ui-test",
        google_key="ui-test",
        sepay_secret="ui-test-secret",
        bank_code="MBBank",
        bank_account="123456789",
        bank_holder="LUMI TEST",
        sepay_environment="test",
        public_url="http://127.0.0.1:3001",
    ),
    transport=httpx.MockTransport(provider),
)

original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(app):
    async with original_lifespan(app):
        async with app.state.db() as db:
            db.add(User(email="moderator@example.com", username="review_moderator", name="Review Moderator",
                        password_hash=passwords.hash("BrowserTest123!"), role="moderator"))
            await db.commit()
        yield


app.router.lifespan_context = lifespan


@app.get("/api/v1/test/harness")
async def harness():
    return {"test_only": True, "environment": "local-mock"}


@app.get("/api/v1/test/slow")
async def slow():
    await asyncio.sleep(31)
    return {"completed": True}
