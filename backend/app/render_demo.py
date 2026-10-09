"""Create a hosted demo owner once using credentials supplied in Environment."""

from email_validator import validate_email
from sqlalchemy import select

from .config import Settings
from .db import database
from .models import Audit, User
from .security import passwords


async def bootstrap_owner(settings: Settings):
    if not settings.hosted_demo:
        raise RuntimeError("This bootstrap is restricted to hosted demo environments")
    username = "render_owner" if settings.render_demo else "botkeep_owner"
    email = validate_email(settings.demo_owner_email, check_deliverability=False).normalized.lower()
    engine, factory = database(settings.database_url)
    try:
        async with factory() as db:
            existing = (
                await db.execute(
                    select(User).where((User.email == email) | (User.username == username))
                )
            ).scalar_one_or_none()
            if existing:
                if existing.email != email or existing.username != username or existing.role != "owner":
                    raise RuntimeError("Demo owner identity conflicts with an existing account")
                # Never reset a stored password, MFA, or permissions on restart.
                return
            user = User(
                email=email,
                username=username,
                name="Demo Owner",
                password_hash=passwords.hash(settings.demo_owner_password),
                role="owner",
                email_verified=False,
            )
            db.add(user)
            await db.flush()
            db.add(
                Audit(
                    actor_id=user.id,
                    action="owner.bootstrap",
                    target=user.id,
                    details={"source": settings.environment},
                )
            )
            await db.commit()
    finally:
        await engine.dispose()
