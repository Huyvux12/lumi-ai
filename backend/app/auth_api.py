from typing import Annotated
import base64
import secrets
from fastapi import APIRouter, Depends, Request, Response
from pydantic import EmailStr, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from .models import AuthToken, Session, User, now_ms
from .quotas import entitlement
from .schemas import Input, Login, ProfilePatch, Register
from .security import (
    COOKIE,
    db_session,
    digest,
    encryption,
    fail,
    issue_session,
    passwords,
    require_user,
    send_auth_email,
    verify_password,
    verify_totp,
)

router = APIRouter()


async def public_user(db, user):
    plan, _, sub = await entitlement(db, user.id)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "username": user.username,
        "bio": user.bio,
        "hue": user.hue,
        "interests": user.interests,
        "createdAt": user.created_at,
        "role": user.role,
        "email_verified": user.email_verified,
        "mfa_enabled": user.mfa_enabled,
        "plan": plan.code,
        "subscription_ends_at": sub.ends_at if sub else None,
    }


@router.post("/auth/register")
async def register(body: Register, request: Request, response: Response, db=Depends(db_session)):
    await request.app.state.limiter.check(f"signup:{request.client.host}", 5, 3600)
    user = User(
        email=str(body.email).lower(),
        username=body.username,
        name=body.name.strip(),
        password_hash=passwords.hash(body.password),
        hue=body.hue,
        interests=body.interests,
    )
    db.add(user)
    try:
        await db.flush()
        await issue_session(db, user, response, request.app.state.settings)
        await send_auth_email(db, request.app.state.settings, user, "verify")
        await db.commit()
    except IntegrityError:
        await db.rollback()
        fail("ACCOUNT_EXISTS", "Email hoặc tên người dùng đã được đăng ký.", 409)
    return await public_user(db, user)


@router.post("/auth/login")
async def login(body: Login, request: Request, response: Response, db=Depends(db_session)):
    await request.app.state.limiter.check(f"login:{request.client.host}:{str(body.email).lower()}", 10, 300)
    user = (await db.execute(select(User).where(User.email == str(body.email).lower()))).scalar_one_or_none()
    # Verify a dummy hash too, avoiding a cheap account-existence timing distinction.
    stored = user.password_hash if user else request.app.state.dummy_password
    valid = verify_password(stored, body.password)
    if not user or not valid or not user.active:
        fail("INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.", 401)
    mfa = False
    if user.mfa_enabled:
        secret = encryption(request.app.state.settings).decrypt(user.mfa_secret.encode()).decode()
        if not verify_totp(secret, body.totp_code):
            fail("MFA_REQUIRED", "Nhập mã xác thực 6 số từ ứng dụng MFA.", 401)
        mfa = True
    if request.cookies.get(COOKIE):
        await db.execute(delete(Session).where(Session.token_hash == digest(request.cookies[COOKIE])))
    await issue_session(db, user, response, request.app.state.settings, mfa)
    await db.commit()
    return await public_user(db, user)


@router.post("/auth/logout")
async def logout(request: Request, response: Response, db=Depends(db_session)):
    if request.cookies.get(COOKIE):
        await db.execute(delete(Session).where(Session.token_hash == digest(request.cookies[COOKIE])))
        await db.commit()
    response.delete_cookie(
        COOKIE, path="/", secure=request.app.state.settings.production, httponly=True, samesite="lax"
    )
    return {"ok": True}


@router.get("/me")
async def me(user=Depends(require_user), db=Depends(db_session)):
    return await public_user(db, user)


@router.patch("/me")
async def edit_me(body: ProfilePatch, user=Depends(require_user), db=Depends(db_session)):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        fail("USERNAME_TAKEN", "Tên người dùng đã được sử dụng.", 409)
    return await public_user(db, user)


class EmailInput(Input):
    email: EmailStr


class TokenInput(Input):
    token: str = Field(min_length=20, max_length=100)


class ResetInput(TokenInput):
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(min_length=8, max_length=128)


@router.post("/auth/forgot-password")
async def forgot(body: EmailInput, request: Request, db=Depends(db_session)):
    await request.app.state.limiter.check(f"forgot:{request.client.host}", 5, 3600)
    user = (await db.execute(select(User).where(User.email == str(body.email).lower()))).scalar_one_or_none()
    if user and user.active:
        await send_auth_email(db, request.app.state.settings, user, "reset")
        await db.commit()
    return {"ok": True, "message": "Nếu tài khoản tồn tại, liên kết sẽ được gửi đến email của bạn."}


async def consume_token(db, token, purpose):
    row = await db.get(AuthToken, digest(token), with_for_update=True)
    if not row or row.purpose != purpose or row.expires_at <= now_ms():
        fail("INVALID_TOKEN", "Liên kết không hợp lệ hoặc đã hết hạn.", 400)
    user = await db.get(User, row.user_id)
    await db.delete(row)
    return user


@router.post("/auth/verify-email")
async def verify_email(body: TokenInput, db=Depends(db_session)):
    user = await consume_token(db, body.token, "verify")
    user.email_verified = True
    await db.commit()
    return {"ok": True}


@router.post("/auth/resend-verification")
async def resend(request: Request, user=Depends(require_user), db=Depends(db_session)):
    await request.app.state.limiter.check(f"verify:{user.id}", 3, 3600)
    if not user.email_verified:
        await send_auth_email(db, request.app.state.settings, user, "verify")
        await db.commit()
    return {"ok": True}


@router.post("/auth/reset-password")
async def reset_password(body: ResetInput, db=Depends(db_session)):
    user = await consume_token(db, body.token, "reset")
    user.password_hash = passwords.hash(body.password)
    await db.execute(delete(Session).where(Session.user_id == user.id))
    await db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.purpose == "reset"))
    await db.commit()
    return {"ok": True}


class PasswordInput(Input):
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(max_length=128)


class MFAInput(Input):
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/auth/mfa/setup")
async def mfa_setup(
    body: PasswordInput, request: Request, user=Depends(require_user), db=Depends(db_session)
):
    await request.app.state.limiter.check(f"mfa:{user.id}", 10, 300)
    if user.mfa_enabled or not verify_password(user.password_hash, body.password):
        fail("INVALID_CREDENTIALS", "MFA đã bật hoặc mật khẩu không đúng.", 400)
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    user.mfa_secret = encryption(request.app.state.settings).encrypt(secret.encode()).decode()
    await db.commit()
    from urllib.parse import quote

    return {"secret": secret, "uri": f"otpauth://totp/Lumi:{quote(user.email)}?secret={secret}&issuer=Lumi"}


@router.post("/auth/mfa/confirm")
async def mfa_confirm(body: MFAInput, request: Request, user=Depends(require_user), db=Depends(db_session)):
    await request.app.state.limiter.check(f"mfa:{user.id}", 10, 300)
    if not user.mfa_secret:
        fail("MFA_REQUIRED", "Hãy thiết lập MFA trước.")
    secret = encryption(request.app.state.settings).decrypt(user.mfa_secret.encode()).decode()
    if not verify_totp(secret, body.code):
        fail("INVALID_CODE", "Mã MFA không đúng.", 400)
    user.mfa_enabled = True
    # Other sessions must authenticate MFA again; this session has just proved possession.
    current = digest(request.cookies.get(COOKIE, ""))
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.token_hash != current))
    request.state.session.mfa_verified = True
    await db.commit()
    return {"ok": True}


@router.post("/auth/revoke-sessions")
async def revoke_sessions(request: Request, user=Depends(require_user), db=Depends(db_session)):
    current = digest(request.cookies.get(COOKIE, ""))
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.token_hash != current))
    await db.commit()
    return {"ok": True}
