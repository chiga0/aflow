"""Extension seam for control-plane routes (missions & channels).

``server.py`` keeps its core small (auth gateway + proxy + static + metrics) and
delegates the orchestration routes here. The mission & channel handlers live in
their own modules; this module is the single dispatch table so the server never
has to know their internals.

During early bootstrap (before the missions/channels modules exist) the
handlers simply report "no match" and the server returns 404.
"""

from __future__ import annotations

from typing import Any

try:
    from . import missions as _missions  # type: ignore[attr-defined]
except Exception:
    _missions = None  # type: ignore[assignment]

try:
    from . import channels as _channels  # type: ignore[attr-defined]
except Exception:
    _channels = None  # type: ignore[assignment]


def handle_get(handler: Any, path: str, store: Any, adapter: Any, auth: Any) -> bool:
    if _missions is not None and _missions.handle_get(handler, path, store, adapter, auth):
        return True
    if _channels is not None and _channels.handle_get(handler, path, store, adapter, auth):
        return True
    return False


def handle_post(
    handler: Any, path: str, body: dict[str, Any], store: Any, adapter: Any, auth: Any
) -> bool:
    if _missions is not None and _missions.handle_post(handler, path, body, store, adapter, auth):
        return True
    if _channels is not None and _channels.handle_post(handler, path, body, store, adapter, auth):
        return True
    return False
