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
from app import provider_network, provider_api
from conftest import provider

directory = Path(tempfile.mkdtemp(prefix="lumi-browser-tests-"))
app = create_app(
    Settings(
        data_dir=directory,
        database_url="sqlite+aiosqlite:///" + str(directory / "test.db"),
        groq_key="ui-test",
        deepgram_key="ui-deepgram-test",
        llm_keys={"compat": "ui-compatible-test"},
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
            hashed = passwords.hash("BrowserTest123!")
            for role in ("moderator", "admin", "owner", "key_owner"):
                db.add(User(email=f"{role}@example.com", username=f"review_{role}", name=f"Review {role.title()}",
                            password_hash=hashed, role="owner" if role == "key_owner" else role))
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


# No external DNS/network in browser tests. SafeLLMTransport still validates the host and pins the address.
async def test_public_addresses(host):
    return ["93.184.216.34"]

provider_network.public_addresses = test_public_addresses
provider_api.public_addresses = test_public_addresses
