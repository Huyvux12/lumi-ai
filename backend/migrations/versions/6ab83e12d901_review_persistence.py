"""Search catalog before pagination and track reconciliation fairness."""

import unicodedata
import json
from alembic import op
import sqlalchemy as sa

revision = "6ab83e12d901"
down_revision = "82c7f03d9a16"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("characters", sa.Column("search_text", sa.Text(), server_default="", nullable=False))
    op.add_column("characters", sa.Column("tags_text", sa.Text(), server_default="", nullable=False))
    table = sa.table(
        "characters",
        sa.column("id", sa.String()),
        sa.column("data", sa.JSON()),
        sa.column("search_text", sa.Text()),
        sa.column("tags_text", sa.Text()),
    )
    connection = op.get_bind()
    for ident, data in connection.execute(sa.select(table.c.id, table.c.data)).all():
        text = " ".join(str(data.get(k, "")) for k in ("name", "tagline", "description", "tags"))
        value = "".join(
            c
            for c in unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
            if not unicodedata.combining(c)
        )
        connection.execute(
            table.update()
            .where(table.c.id == ident)
            .values(search_text=value, tags_text=json.dumps(data.get("tags", [])))
        )
    op.add_column("orders", sa.Column("reconciled_at", sa.BigInteger(), nullable=True))
    op.create_index("ix_orders_reconciled_at", "orders", ["reconciled_at"])


def downgrade():
    op.drop_index("ix_orders_reconciled_at", table_name="orders")
    op.drop_column("orders", "reconciled_at")
    op.drop_column("characters", "search_text")
    op.drop_column("characters", "tags_text")
