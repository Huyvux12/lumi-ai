"""Persist account-owned character avatars; scenario remains in profile JSON."""

import sqlalchemy as sa
from alembic import op

revision = "82c7f03d9a16"
down_revision = "4d6a9b13c2e0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "character_avatars",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_character_avatars_owner_id", "character_avatars", ["owner_id"])


def downgrade():
    op.drop_index("ix_character_avatars_owner_id", table_name="character_avatars")
    op.drop_table("character_avatars")
