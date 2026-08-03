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

try:
    from . import chat as _chat  # type: ignore[attr-defined]
except Exception:
    _chat = None  # type: ignore[assignment]

_hub_instance: Any = None


def _get_hub(store: Any, adapter: Any) -> Any:
    """One ChatHub per process, built lazily on first /api/chat request."""
    global _hub_instance
    if _hub_instance is None and _chat is not None:
        _hub_instance = _chat.ChatHub(adapter, store)
    return _hub_instance


def handle_get(handler: Any, path: str, store: Any, adapter: Any, auth: Any) -> bool:
    if _chat is not None and path.startswith("/api/chat/"):
        return _chat.handle_get(handler, path, _get_hub(store, adapter))
    if _missions is not None and _missions.handle_get(handler, path, store, adapter, auth):
        return True
    if _channels is not None and _channels.handle_get(handler, path, store, adapter, auth):
        return True
    return False


def handle_post(
    handler: Any,
    path: str,
    body: dict[str, Any],
    raw: bytes,
    store: Any,
    adapter: Any,
    auth: Any,
) -> bool:
    if _missions is not None and _missions.handle_post(handler, path, body, raw, store, adapter, auth):
        return True
    if _channels is not None and _channels.handle_post(handler, path, body, raw, store, adapter, auth):
        return True
    if _chat is not None and path.startswith("/api/chat/"):
        return _chat.handle_post(handler, path, body, _get_hub(store, adapter))
    return False


def handle_delete(handler: Any, path: str, store: Any, adapter: Any, auth: Any) -> bool:
    if _chat is not None and path.startswith("/api/chat/"):
        return _chat.handle_delete(handler, path, _get_hub(store, adapter))
    return False
