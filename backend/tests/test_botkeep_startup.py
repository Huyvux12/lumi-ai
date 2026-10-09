"""Misconfigured native entry points must fail before attempting migrations."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet


@pytest.mark.parametrize("port", ["", "0", "65536", "not-a-port"])
def test_invalid_assigned_port_fails_before_database_connection(port):
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parents[1] / "botkeep_start.py")],
        env={
            **os.environ, "APP_ENV": "botkeep-demo", "AUTO_MIGRATE": "false",
            "DATABASE_URL": "postgresql://test:test@127.0.0.1:1/nonexistent",
            "PUBLIC_APP_URL": "https://demo.example.com", "SERVER_PORT": port,
            "MFA_ENCRYPTION_KEY": Fernet.generate_key().decode(),
            "DEMO_OWNER_PASSWORD": "synthetic-test-password-only", "SEPAY_ENV": "test",
            "AUDIO_CACHE_TTL_SECONDS": "3600",
        }, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode != 0
    assert "SERVER_PORT must be the port assigned" in result.stderr
    assert "ConnectionRefused" not in result.stderr
