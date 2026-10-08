"""Create a demo owner once; credentials come from Render's generated secret."""

from email_validator import validate_email
from sqlalchemy import select

from .config import Settings
from .db import database
from .models import Audit, User
from .security import passwords


async def bootstrap_owner(settings: Settings):
    if not settings.render_demo:
        raise RuntimeError("This bootstrap is restricted to APP_ENV=render-demo")
    email = validate_email(settings.demo_owner_email, check_deliverability=False).normalized.lower()
    engine, factory = database(settings.database_url)
    try:
        async with factory() as db:
            existing = (
                await db.execute(
                    select(User).where((User.email == email) | (User.username == "render_owner"))
                )
            ).scalar_one_or_none()
            if existing:
                if existing.email != email or existing.username != "render_owner" or existing.role != "owner":
                    raise RuntimeError("Demo owner identity conflicts with an existing account")
                # Never reset a stored password, MFA, or permissions on restart.
                return
            user = User(
                email=email,
                username="render_owner",
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
                    details={"source": "render-demo"},
                )
            )
            await db.commit()
    finally:
        await engine.dispose()
