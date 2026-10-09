"""Migrate and launch one FastAPI process on Botkeep's assigned port."""

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv


def main():
    os.chdir(Path(__file__).resolve().parent)
    load_dotenv(override=False)
    os.environ.setdefault("AUDIO_CACHE_TTL_SECONDS", "3600")
    import uvicorn

    from app.config import Settings
    from app.render_demo import bootstrap_owner

    cfg = Settings()
    cfg.validate()
    if cfg.environment != "botkeep-demo":
        raise RuntimeError("Botkeep startup requires APP_ENV=botkeep-demo")
    raw_port = os.getenv("SERVER_PORT", "")
    if not raw_port.isdecimal() or not 1 <= int(raw_port) <= 65535:
        raise RuntimeError("SERVER_PORT must be the port assigned in Botkeep Network")
    cfg.data_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    if not shutil.which("ffmpeg"):
        print("ffmpeg unavailable: speech-to-text is disabled; text chat remains available.", flush=True)
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    asyncio.run(bootstrap_owner(cfg))
    uvicorn.run(
        "app.main:app", host="0.0.0.0", port=int(raw_port), workers=1,
        access_log=False, proxy_headers=False,
    )


if __name__ == "__main__":
    main()
