"""Invite codes, referral tracking and the source of gifted 0đ periods."""

import secrets

import sqlalchemy as sa
from alembic import op

revision = "f3b8d5a1c7e2"
down_revision = "e7a1c4b9d203"
branch_labels = None
depends_on = None

# Snapshot of app/referrals.py at this revision; migrations never import app code.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def upgrade():
    # Batch mode: SQLite cannot add a foreign key with ALTER; PostgreSQL runs plain ALTERs.
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("invite_code", sa.String(12), nullable=True))
        batch.add_column(sa.Column("referred_by", sa.String(36), nullable=True))
        batch.add_column(sa.Column("referral_qualified_at", sa.BigInteger(), nullable=True))
        batch.create_foreign_key("fk_users_referred_by_users", "users", ["referred_by"], ["id"])
    op.add_column(
        "orders", sa.Column("source", sa.String(24), server_default="purchase", nullable=False)
    )
    users = sa.table("users", sa.column("id", sa.String), sa.column("invite_code", sa.String))
    bind = op.get_bind()
    taken = set()
    for (ident,) in bind.execute(sa.select(users.c.id)).all():
        code = ""
        while not code or code in taken:
            code = "".join(secrets.choice(ALPHABET) for _ in range(7))
        taken.add(code)
        bind.execute(users.update().where(users.c.id == ident).values(invite_code=code))
    op.create_index("ix_users_invite_code", "users", ["invite_code"], unique=True)
    op.create_index("ix_users_referred_by", "users", ["referred_by"])


def downgrade():
    op.drop_index("ix_users_referred_by", "users")
    op.drop_index("ix_users_invite_code", "users")
    op.drop_column("orders", "source")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_referred_by_users", type_="foreignkey")
        batch.drop_column("referral_qualified_at")
        batch.drop_column("referred_by")
        batch.drop_column("invite_code")
