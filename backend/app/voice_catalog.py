"""Versioned studio presets from Google's speech-generation documentation.

Keep voices_v1.json immutable: Alembic also uses this snapshot. Native presets
leave style empty so the provider's original tone is preserved.
"""

import json
from pathlib import Path

VOICE_PRESETS = json.loads((Path(__file__).parent / "seed" / "voices_v1.json").read_text(encoding="utf-8"))
OFFICIAL_VOICES = frozenset(preset["voice"] for preset in VOICE_PRESETS)


def voice_view(voice):
    return {
        "id": voice.id,
        "name": voice.name,
        "description_vi": voice.description_vi,
        "description_en": voice.description_en,
    }
