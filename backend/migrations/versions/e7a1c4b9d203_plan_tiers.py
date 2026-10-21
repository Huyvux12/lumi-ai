"""Add Basic and Plus tiers, cost-based quotas, the Free waitlist and upgrade credit."""

import time
import uuid

import sqlalchemy as sa
from alembic import op

revision = "e7a1c4b9d203"
down_revision = "d4e93a7c512b"
branch_labels = None
depends_on = None

# Snapshot of app/plan_catalog.py at this revision; migrations never import app code.
TIERS = {
    "free": (0, dict(chat_day=20, chat_period=250, characters=3, tts_chars=1600, tts_ms=120000,
                     stt_ms=300000, recording_seconds=60, input_chars=2000, input_tokens=2048,
                     output_tokens=400)),
    "basic": (50000, dict(chat_day=60, chat_period=1500, characters=8, tts_chars=15000, tts_ms=1200000,
                          stt_ms=3600000, recording_seconds=90, input_chars=3000, input_tokens=4096,
                          output_tokens=500)),
    "plus": (99000, dict(chat_day=120, chat_period=3000, characters=20, tts_chars=30000, tts_ms=2400000,
                         stt_ms=7200000, recording_seconds=120, input_chars=4000, input_tokens=6144,
                         output_tokens=600)),
    "premium": (250000, dict(chat_day=300, chat_period=8000, characters=50, tts_chars=75000,
                             tts_ms=6000000, stt_ms=18000000, recording_seconds=120, input_chars=4000,
                             input_tokens=8192, output_tokens=800)),
}


def upgrade():
    op.add_column("users", sa.Column("waitlisted", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("orders", sa.Column("credit_vnd", sa.Integer(), server_default="0", nullable=False))
    settings = sa.table(
        "plan_settings",
        sa.column("code", sa.String),
        sa.column("enabled", sa.Boolean),
        sa.column("discount_percent", sa.Integer),
        sa.column("promo_codes", sa.JSON),
    )
    plans = sa.table(
        "plan_versions",
        sa.column("id", sa.String),
        sa.column("code", sa.String),
        sa.column("price_vnd", sa.Integer),
        sa.column("quota", sa.JSON),
        sa.column("active", sa.Boolean),
        sa.column("created_at", sa.BigInteger),
    )
    bind = op.get_bind()
    existing = set(bind.execute(sa.select(settings.c.code)).scalars())
    op.bulk_insert(
        settings,
        [
            {"code": code, "enabled": True, "discount_percent": 0, "promo_codes": []}
            for code in TIERS
            if code not in existing
        ],
    )
    # New immutable versions; paid periods keep the version they were bought with.
    op.execute(plans.update().where(plans.c.code.in_(list(TIERS)), plans.c.active.is_(True)).values(active=False))
    at = int(time.time() * 1000)
    op.bulk_insert(
        plans,
        [
            {"id": str(uuid.uuid4()), "code": code, "price_vnd": price, "quota": quota, "active": True,
             "created_at": at}
            for code, (price, quota) in TIERS.items()
        ],
    )


def downgrade():
    # Earlier code only knows Free and Premium; hide the new tiers but keep their order history.
    op.execute("UPDATE plan_versions SET active = false WHERE code IN ('basic', 'plus')")
    op.execute("DELETE FROM plan_settings WHERE code IN ('basic', 'plus')")
    op.drop_column("orders", "credit_vnd")
    op.drop_column("users", "waitlisted")
