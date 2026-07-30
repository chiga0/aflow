"""Shared helpers and domain models.

The WebShell-driven architecture means qwen owns the live chat transcript, so
aflow-lite does *not* mirror every message. The store only persists what the
control plane itself owns: auth sessions (see ``store.py``) and, later, the
mission / channel orchestration state (see the missions & channels modules).
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"
