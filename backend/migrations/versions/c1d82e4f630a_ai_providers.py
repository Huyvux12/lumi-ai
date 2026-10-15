"""Persist active STT/LLM sources and OpenAI-compatible profiles (no secrets)."""

import sqlalchemy as sa
from alembic import op

revision = "c1d82e4f630a"
down_revision = "b7c23a90d416"
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table(
        "ai_settings",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("llm_id", sa.String(36), nullable=False),
        sa.Column("stt_id", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.bulk_insert(
        table, [{"id": "global", "llm_id": "groq", "stt_id": "groq", "version": 1, "updated_at": 0}]
    )
    op.create_table(
        "llm_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("key_ref", sa.String(40), nullable=False),
        sa.Column("tokenizer", sa.String(16), nullable=False),
        sa.Column("json_mode", sa.String(16), nullable=False),
        sa.Column("token_parameter", sa.String(24), nullable=False),
        sa.Column("temperature", sa.Double(), nullable=True),
        sa.Column("reasoning_effort", sa.String(16), nullable=True),
        sa.Column("input_price", sa.Double(), nullable=True),
        sa.Column("output_price", sa.Double(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )


def downgrade():
    op.drop_table("llm_profiles")
    op.drop_table("ai_settings")
