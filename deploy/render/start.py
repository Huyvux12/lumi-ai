"""Supervise one frontend and one loopback-only backend on Render Free."""

import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

children = []
stopping = False


def stop(signum=None, frame=None):
    global stopping
    stopping = True
    for child in children:
        if child.poll() is None:
            child.terminate()


def main():
    from app.config import Settings
    from app.render_demo import bootstrap_owner

    cfg = Settings()
    cfg.validate()
    if not cfg.render_demo:
        raise RuntimeError("The Render Free image requires APP_ENV=render-demo")
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    asyncio.run(bootstrap_owner(cfg))
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                    "--workers",
                    "1",
                    "--no-access-log",
                ]
            )
        )
        # Bind the public port only when migrations, seeding and the API are ready.
        deadline = time.monotonic() + 120
        while not stopping:
            if children[0].poll() is not None:
                raise RuntimeError("Backend exited during startup")
            try:
                with urlopen("http://127.0.0.1:8000/health", timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("Backend did not become healthy")
            time.sleep(0.25)
        if stopping:
            return 0
        frontend = Path(os.getenv("RENDER_FRONTEND_DIR", "/app/frontend"))
        children.append(
            subprocess.Popen(
                ["node", str(frontend / "server.js")],
                cwd=frontend,
                env={
                    **os.environ,
                    "HOSTNAME": "0.0.0.0",
                    "PORT": os.getenv("PORT", "10000"),
                },
            )
        )
        while not stopping:
            if any(child.poll() is not None for child in children):
                print("A web process exited; stopping the service.", flush=True)
                return 1
            time.sleep(0.25)
        return 0
    finally:
        stop()
        deadline = time.monotonic() + 10
        for child in children:
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    sys.exit(main())
