import asyncio
import logging
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, text, update
from .config import Settings
from .db import Base, database
from .models import AudioJob, AuthToken, Session, Usage, now_ms
from .security import COOKIE, RateLimiter, passwords
from .seed import seed
from . import admin_api, auth_api, billing_api, catalog_api, chat_api, speech_api

log = logging.getLogger("lumi")


class BodyTooLarge(Exception):
    pass


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        maximum = 6 * 1024 * 1024 if scope["path"].endswith("/speech/transcriptions") else 256 * 1024
        content_length = dict(scope.get("headers", [])).get(b"content-length", b"0")
        try:
            oversized = int(content_length) > maximum
        except ValueError:
            oversized = False
        if oversized:
            return await JSONResponse({"code": "BODY_TOO_LARGE", "message": "Dữ liệu gửi lên quá lớn."}, 413)(
                scope, receive, send
            )
        used, started = 0, False

        async def bounded():
            nonlocal used
            message = await receive()
            if message["type"] == "http.request":
                used += len(message.get("body", b""))
                if used > maximum:
                    raise BodyTooLarge
            return message

        async def tracking(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, bounded, tracking)
        except BodyTooLarge:
            if not started:
                await JSONResponse({"code": "BODY_TOO_LARGE", "message": "Dữ liệu gửi lên quá lớn."}, 413)(
                    scope, receive, send
                )


async def janitor(app):
    while True:
        await asyncio.sleep(30)
        try:
            at = now_ms()
            async with app.state.db() as db:
                await db.execute(delete(Session).where(Session.expires_at <= at))
                await db.execute(delete(AuthToken).where(AuthToken.expires_at <= at))
                await db.execute(
                    update(Usage)
                    .where(Usage.status == "reserved", Usage.expires_at <= at)
                    .values(status="released")
                )
                expired = (
                    (await db.execute(select(AudioJob).where(AudioJob.expires_at <= at))).scalars().all()
                )
                for job in expired:
                    (app.state.settings.data_dir / "audio" / (job.id + ".pcm")).unlink(missing_ok=True)
                    await db.delete(job)
                live = set((await db.execute(select(AudioJob.id).where(AudioJob.expires_at > at))).scalars())
                await db.commit()
            for path in (app.state.settings.data_dir / "audio").iterdir():
                if path.suffix in {".pcm", ".part"} and path.stem not in live:
                    path.unlink(missing_ok=True)
        except Exception:
            log.warning("Background cleanup failed")


def create_app(settings=None, *, transport=None):
    cfg = settings or Settings()
    cfg.validate()
    cfg.data_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    (cfg.data_dir / "audio").mkdir(mode=0o700, exist_ok=True)
    engine, factory = database(cfg.database_url)

    @asynccontextmanager
    async def lifespan(app):
        if cfg.auto_migrate:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
        async with factory() as db:
            await seed(db)
        app.state.http = httpx.AsyncClient(
            timeout=httpx.Timeout(90, connect=15),
            transport=transport,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20, keepalive_expiry=120),
        )
        app.state.limiter = RateLimiter(cfg)
        app.state.dummy_password = passwords.hash("lumi-invalid-account")
        task = asyncio.create_task(janitor(app))
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            active_tasks = list(app.state.chat_tasks.values()) + list(app.state.audio_tasks.values())
            for active in active_tasks:
                active.cancel()
            await asyncio.gather(*active_tasks, return_exceptions=True)
            await app.state.http.aclose()
            await app.state.limiter.close()
            await engine.dispose()

    app = FastAPI(
        title="Lumi API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if cfg.production else "/docs",
        redoc_url=None,
        openapi_url=None if cfg.production else "/openapi.json",
    )
    app.state.settings, app.state.db, app.state.engine = cfg, factory, engine
    app.state.chat_tasks, app.state.audio_tasks = {}, {}
    app.add_middleware(BodyLimit)

    @app.middleware("http")
    async def same_origin(request, call_next):
        if request.url.path != "/api/v1/payments/sepay/webhook":
            origin = request.headers.get("origin")
            unsafe = request.method not in {"GET", "HEAD", "OPTIONS"}
            if unsafe and origin and origin.rstrip("/") != cfg.public_url:
                return JSONResponse({"code": "ORIGIN_REJECTED", "message": "Yêu cầu không hợp lệ."}, 403)
            audio_start = request.url.path.endswith("/stream")
            if (
                (unsafe or audio_start)
                and COOKIE in request.cookies
                and request.headers.get("X-Lumi-Request") != "1"
            ):
                return JSONResponse({"code": "CSRF_REJECTED", "message": "Yêu cầu không hợp lệ."}, 403)
        try:
            response = await call_next(request)
        except Exception:
            # Do not log raw provider exceptions, URLs or message payloads.
            log.error("Request failed: %s %s", request.method, request.url.path)
            return JSONResponse(
                {"code": "INTERNAL_ERROR", "message": "Có lỗi xảy ra. Vui lòng thử lại."}, 500
            )
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        return JSONResponse(detail, exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic input error objects can include submitted passwords; never return them verbatim.
        return JSONResponse(
            {"code": "INVALID_INPUT", "message": "Dữ liệu không hợp lệ. Kiểm tra các trường đã nhập."}, 422
        )

    @app.get("/health")
    async def health():
        async with factory() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ok"}

    for module in (auth_api, catalog_api, chat_api, billing_api, speech_api, admin_api):
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
