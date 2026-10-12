"""Add the 30 Gemini studio voices and bilingual preset descriptions."""

import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "3e9b61a20f47"
down_revision = "6ab83e12d901"
branch_labels = None
depends_on = None


def upgrade():
    for key in ("description_vi", "description_en"):
        op.add_column("voice_presets", sa.Column(key, sa.String(300), server_default="", nullable=False))
    voices = sa.table(
        "voice_presets",
        sa.column("id", sa.String(40)),
        sa.column("name", sa.String(80)),
        sa.column("voice", sa.String(40)),
        sa.column("style", sa.String(300)),
        sa.column("description_vi", sa.String(300)),
        sa.column("description_en", sa.String(300)),
        sa.column("enabled", sa.Boolean()),
    )
    connection = op.get_bind()
    existing = set(connection.execute(sa.select(voices.c.id)).scalars())
    # Immutable versioned data shared with startup seed; no mutable model imports.
    snapshot = Path(__file__).parents[2] / "app" / "seed" / "voices_v1.json"
    for preset in json.loads(snapshot.read_text(encoding="utf-8")):
        if preset["id"] not in existing:
            connection.execute(voices.insert().values(**preset, enabled=True))
        else:
            connection.execute(
                voices.update()
                .where(voices.c.id == preset["id"])
                .values(description_vi=preset["description_vi"], description_en=preset["description_en"])
            )


def downgrade():
    # Retain additive presets: existing characters/audio jobs can reference them.
    op.drop_column("voice_presets", "description_en")
    op.drop_column("voice_presets", "description_vi")
