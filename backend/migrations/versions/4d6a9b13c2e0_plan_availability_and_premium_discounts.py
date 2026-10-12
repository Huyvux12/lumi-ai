"""Persist account plan choice, live availability and order discount snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "4d6a9b13c2e0"
down_revision = "27fc1722d51b"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("signup_plan", sa.String(16), server_default="free", nullable=False))
    table = op.create_table(
        "plan_settings",
        sa.Column("code", sa.String(16), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("discount_percent", sa.Integer(), nullable=False),
        sa.Column("promo_codes", sa.JSON(), nullable=False),
    )
    op.bulk_insert(
        table,
        [
            {"code": code, "enabled": True, "discount_percent": 0, "promo_codes": []}
            for code in ("free", "premium")
        ],
    )
    op.add_column("orders", sa.Column("list_price_vnd", sa.Integer(), server_default="0", nullable=False))
    op.add_column("orders", sa.Column("discount_percent", sa.Integer(), server_default="0", nullable=False))
    op.add_column("orders", sa.Column("promo_code", sa.String(32), nullable=True))
    op.execute("UPDATE orders SET list_price_vnd = amount_vnd")


def downgrade():
    for column in ("promo_code", "discount_percent", "list_price_vnd"):
        op.drop_column("orders", column)
    op.drop_table("plan_settings")
    op.drop_column("users", "signup_plan")
