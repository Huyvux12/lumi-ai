"""Add private user feedback and support conversations."""

import sqlalchemy as sa
from alembic import op

revision = "b7c23a90d416"
down_revision = "3e9b61a20f47"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "feedback",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source_path", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("assignee_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("public_updated_at", sa.BigInteger(), nullable=False),
        sa.Column("last_seen_at", sa.BigInteger(), nullable=False),
    )
    for column in ("user_id", "status", "updated_at"):
        op.create_index(f"ix_feedback_{column}", "feedback", [column])
    op.create_index("ix_feedback_user_public_updated", "feedback", ["user_id", "public_updated_at"])
    op.create_table(
        "feedback_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "feedback_id", sa.String(36), sa.ForeignKey("feedback.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("author_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("author_role", sa.String(16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("internal", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(16), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_feedback_messages_feedback_id", "feedback_messages", ["feedback_id"])
    op.create_index("ix_feedback_messages_thread_time", "feedback_messages", ["feedback_id", "created_at"])


def downgrade():
    op.drop_table("feedback_messages")
    op.drop_table("feedback")
