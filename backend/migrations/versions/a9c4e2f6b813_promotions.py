"""Admin on/off switches for in-app promotions, starting with the invite popup."""

import time

import sqlalchemy as sa
from alembic import op

revision = "a9c4e2f6b813"
down_revision = "f3b8d5a1c7e2"
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table(
        "promotions",
        sa.Column("code", sa.String(32), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.bulk_insert(table, [{"code": "invite_banner", "enabled": True, "updated_at": int(time.time() * 1000)}])


def downgrade():
    op.drop_table("promotions")
