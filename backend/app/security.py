import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import smtplib
import struct
import time
from collections import OrderedDict
from email.message import EmailMessage
from urllib.parse import quote
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request
from redis.asyncio import from_url
from sqlalchemy import select
from .models import AuthToken, Session, User, now_ms

COOKIE = "lumi_session"
passwords = PasswordHasher()


def fail(code: str, message: str, status=400):
    raise HTTPException(status, {"code": code, "message": message})


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def db_session(request: Request):
    async with request.app.state.db() as db:
        yield db


async def optional_user(request: Request, db=Depends(db_session)):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    session = await db.get(Session, digest(token))
    if not session or session.expires_at <= now_ms():
        return None
    user = await db.get(User, session.user_id)
    if not user or not user.active:
        return None
    request.state.session = session
    return user


async def require_user(user=Depends(optional_user)):
    if not user:
        fail("AUTH_REQUIRED", "Vui lòng đăng nhập để tiếp tục.", 401)
    return user


async def require_staff(request: Request, user=Depends(require_user)):
    if user.role not in {"admin", "owner", "moderator"}:
        fail("FORBIDDEN", "Bạn không có quyền quản trị.", 403)
    if request.app.state.settings.production and (
        not user.mfa_enabled or not request.state.session.mfa_verified
    ):
        fail("MFA_REQUIRED", "Hãy thiết lập và xác minh MFA để vào quản trị.", 403)
    return user


async def require_admin(user=Depends(require_staff)):
    if user.role not in {"admin", "owner"}:
        fail("FORBIDDEN", "Chỉ quản trị viên có quyền truy cập.", 403)
    return user


async def require_owner(user=Depends(require_admin)):
    if user.role != "owner":
        fail("FORBIDDEN", "Chỉ chủ dự án có quyền thực hiện.", 403)
    return user


def verify_password(stored: str, supplied: str):
    try:
        return passwords.verify(stored, supplied)
    except VerificationError:
        return False


def encryption(settings):
    key = settings.mfa_key
    if not key:
        path = settings.data_dir / "mfa.key"
        if not path.exists():
            path.write_bytes(Fernet.generate_key())
            path.chmod(0o600)
        key = path.read_text().strip()
    return Fernet(key.encode())


def totp(secret: str, at: float | None = None):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    counter = int((time.time() if at is None else at) // 30)
    raw = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = raw[-1] & 15
    number = (struct.unpack(">I", raw[offset : offset + 4])[0] & 0x7FFFFFFF) % 1000000
    return f"{number:06d}"


def verify_totp(secret: str, code: str | None):
    return bool(
        code and any(hmac.compare_digest(totp(secret, time.time() + step * 30), code) for step in (-1, 0, 1))
    )


async def issue_session(db, user, response, settings, mfa=False):
    token = secrets.token_urlsafe(32)
    db.add(
        Session(
            token_hash=digest(token), user_id=user.id, expires_at=now_ms() + 30 * 86400000, mfa_verified=mfa
        )
    )
    response.set_cookie(
        COOKIE, token, max_age=30 * 86400, httponly=True, secure=settings.production, samesite="lax", path="/"
    )


async def send_auth_email(db, settings, user, purpose):
    raw = secrets.token_urlsafe(32)
    db.add(
        AuthToken(
            token_hash=digest(raw),
            user_id=user.id,
            purpose=purpose,
            expires_at=now_ms() + (3600000 if purpose == "reset" else 86400000),
        )
    )
    route = "reset-password" if purpose == "reset" else "verify-email"
    url = f"{settings.public_url}/{route}?token={quote(raw)}"
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = user.email
    message["Subject"] = "PersonaX — đặt lại mật khẩu" if purpose == "reset" else "PersonaX — xác minh email"
    message.set_content(f"Mở liên kết sau để tiếp tục:\n{url}\nNếu bạn không yêu cầu, hãy bỏ qua email.")
    if settings.smtp_host:

        def send():
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(message)

        await asyncio.to_thread(send)
    elif not settings.production:
        # Private development outbox, never an HTTP endpoint or a log entry.
        directory = settings.data_dir / "outbox"
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / f"{secrets.token_hex(12)}.eml"
        path.write_text(message.as_string())
        path.chmod(0o600)
    else:
        fail("MAIL_UNAVAILABLE", "Chức năng email đang tạm gián đoạn.", 503)


class RateLimiter:
    def __init__(self, settings):
        self.settings = settings
        self.redis = from_url(settings.redis_url) if settings.redis_url else None
        self.local = OrderedDict()
        self.lock = asyncio.Lock()

    async def check(self, key: str, maximum: int, window=60):
        hashed = digest(key)
        if self.redis:
            # INCR and EXPIRE are atomic, including the first request.
            count = await self.redis.eval(
                "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
                1,
                f"lumi:rate:{hashed}",
                window,
            )
        else:
            async with self.lock:
                now = time.monotonic()
                cutoff, count = self.local.get(hashed, (now + window, 0))
                if now >= cutoff:
                    cutoff, count = now + window, 0
                count += 1
                self.local[hashed] = (cutoff, count)
                if len(self.local) > 10000:
                    self.local.popitem(last=False)
        if count > maximum:
            fail("RATE_LIMIT", "Bạn thao tác quá nhanh. Vui lòng thử lại sau.", 429)

    async def close(self):
        if self.redis:
            await self.redis.aclose()


async def lock_user(db, user_id):
    # PostgreSQL row lock serializes reservations, orders and renewals across processes.
    return (await db.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one()
