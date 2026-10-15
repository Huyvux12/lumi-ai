"""Store encrypted provider key overrides separately from provider profiles."""

import sqlalchemy as sa
from alembic import op

revision = "d4e93a7c512b"
down_revision = "c1d82e4f630a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "provider_credentials",
        sa.Column("id", sa.String(44), primary_key=True),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("suffix", sa.String(4), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )


def downgrade():
    op.drop_table("provider_credentials")
