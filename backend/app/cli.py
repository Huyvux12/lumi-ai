"""Administrative bootstrap. Passwords are read from the terminal, never from arguments."""

import argparse
import asyncio
import getpass
from sqlalchemy import select
from .config import Settings
from .db import database
from .models import Audit, User
from .security import passwords
from .seed import seed


async def run(command, email, username):
    cfg = Settings()
    cfg.validate()
    engine, factory = database(cfg.database_url)
    try:
        async with factory() as db:
            if command == "seed":
                await seed(db)
                print("Catalog, plans, voices and default prompt are ready.")
                return
            if not email or not username:
                raise SystemExit("Provide --email and --username")
            import re
            from email_validator import validate_email

            email = validate_email(email, check_deliverability=False).normalized.lower()
            if not re.fullmatch(r"[a-z0-9_.]{3,20}", username):
                raise SystemExit("Username must contain 3–20 lowercase letters, digits, . or _")
            exists = (
                await db.execute(select(User).where((User.email == email) | (User.username == username)))
            ).scalar_one_or_none()
            if exists:
                raise SystemExit("Account already exists; bootstrap will not modify an existing user.")
            password = getpass.getpass("Owner password (8–128 characters): ")
            confirm = getpass.getpass("Confirm password: ")
            if password != confirm or not 8 <= len(password) <= 128:
                raise SystemExit("Passwords differ or length is invalid.")
            user = User(
                email=email,
                username=username,
                name=username,
                password_hash=passwords.hash(password),
                role="owner",
                email_verified=True,
            )
            db.add(user)
            await db.flush()
            db.add(
                Audit(
                    actor_id=user.id, action="owner.bootstrap", target=user.id, details={"source": "terminal"}
                )
            )
            await db.commit()
            print("Owner created. Sign in and enable MFA in account security.")
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["seed", "bootstrap-owner"])
    parser.add_argument("--email")
    parser.add_argument("--username")
    args = parser.parse_args()
    asyncio.run(run(args.command, args.email, args.username))


if __name__ == "__main__":
    main()
