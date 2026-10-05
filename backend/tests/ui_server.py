"""Local UI test harness only. Production uses app.main:app and never imports this module."""

from pathlib import Path
import httpx
from app.config import Settings
from app.main import create_app
from conftest import provider

app = create_app(
    Settings(
        data_dir=Path(".data/ui-test"),
        database_url="sqlite+aiosqlite:///.data/ui-test/lumi.db",
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


@app.get("/api/v1/test/harness")
async def harness():
    return {"test_only": True, "environment": "local-mock"}
