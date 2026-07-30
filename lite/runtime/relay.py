"""Event relay: maps qwen SSE events → aflow-lite events, persists and notifies."""

from __future__ import annotations

import logging
import threading
from typing import Any

from .adapter import QwenAdapter
from .models import Message, Session
from .store import Store

logger = logging.getLogger("aflow_lite.relay")

# Subscribers: session_id → list of threading.Event for SSE wakeup
_subscribers: dict[str, list[threading.Event]] = {}
_sub_lock = threading.Lock()


def subscribe(session_id: str) -> threading.Event:
    event = threading.Event()
    with _sub_lock:
        _subscribers.setdefault(session_id, []).append(event)
    return event


def unsubscribe(session_id: str, event: threading.Event) -> None:
    with _sub_lock:
        subs = _subscribers.get(session_id, [])
        if event in subs:
            subs.remove(event)
        if not subs:
            _subscribers.pop(session_id, None)


def _notify(session_id: str) -> None:
    with _sub_lock:
        for event in _subscribers.get(session_id, []):
            event.set()


def pump_session(
    session: Session,
    adapter: QwenAdapter,
    store: Store,
) -> None:
    """Background thread: read qwen SSE stream, map events, persist, notify.

    Runs until a terminal event (done/error) or the session is cancelled.
    Handles reconnection up to 3 times.
    """
    qwen_sid = session.qwen_session_id
    if not qwen_sid:
        return

    last_sse_id: str | None = None
    reconnects = 0
    max_reconnects = 3
    # Accumulate agent text for final persistence
    agent_text_buf: list[str] = []
    thought_text_buf: list[str] = []

    while reconnects < max_reconnects:
        current = store.get_session(session.id)
        if not current or current.status in ("completed", "failed", "cancelled"):
            return

        try:
            seen = 0
            for sse_id, event_name, payload in adapter.stream_events(qwen_sid, last_sse_id):
                current = store.get_session(session.id)
                if not current or current.status in ("completed", "failed", "cancelled"):
                    return

                if sse_id:
                    last_sse_id = sse_id

                mapped = map_qwen_event(session.id, event_name, payload)
                for event_type, data in mapped:
                    store.append_event(session.id, event_type, data)

                    # Accumulate text for persistence
                    if event_type == "message.delta":
                        text = str(data.get("text") or "")
                        if data.get("thought"):
                            thought_text_buf.append(text)
                        else:
                            # Flush thought buffer when real text starts
                            if thought_text_buf:
                                _save_assistant_message(store, session.id, "".join(thought_text_buf), thought=True)
                                thought_text_buf.clear()
                            agent_text_buf.append(text)
                    elif event_type == "tool.start":
                        # Flush any accumulated text before tool call
                        if thought_text_buf:
                            _save_assistant_message(store, session.id, "".join(thought_text_buf), thought=True)
                            thought_text_buf.clear()
                        if agent_text_buf:
                            _save_assistant_message(store, session.id, "".join(agent_text_buf))
                            agent_text_buf.clear()

                    _persist_message_if_needed(store, session.id, event_type, data)
                    _notify(session.id)

                    if event_type in ("done", "error"):
                        # Flush remaining buffers
                        if thought_text_buf:
                            _save_assistant_message(store, session.id, "".join(thought_text_buf), thought=True)
                            thought_text_buf.clear()
                        if agent_text_buf:
                            _save_assistant_message(store, session.id, "".join(agent_text_buf))
                            agent_text_buf.clear()
                        terminal_status = "completed" if event_type == "done" else "failed"
                        current = store.get_session(session.id)
                        if current and current.status not in ("cancelled",):
                            current.status = terminal_status
                            store.update_session(current)
                        _notify(session.id)
                        return
                seen += 1

            # Stream ended without terminal event
            reconnects += 1
            logger.info(
                "stream closed for %s (reconnect %d/%d)",
                session.id, reconnects, max_reconnects,
            )

        except Exception as exc:
            current = store.get_session(session.id)
            if not current or current.status in ("completed", "failed", "cancelled"):
                return
            reconnects += 1
            logger.warning(
                "stream error for %s: %s (reconnect %d/%d)",
                session.id, exc, reconnects, max_reconnects,
            )

    # Exhausted reconnects
    current = store.get_session(session.id)
    if current and current.status == "running":
        current.status = "failed"
        store.update_session(current)
        store.append_event(session.id, "error", {"reason": "stream disconnected"})
        _notify(session.id)


def map_qwen_event(
    session_id: str,
    event_name: str | None,
    payload: Any,
) -> list[tuple[str, dict[str, Any]]]:
    """Map one qwen SSE frame to zero or more aflow-lite events."""
    if not isinstance(payload, dict):
        return []

    qwen_type = payload.get("type") or event_name
    data = payload.get("data")

    # session_update wraps most streaming content
    if qwen_type == "session_update" and isinstance(data, dict):
        update = data.get("update") if isinstance(data.get("update"), dict) else data
        session_update = update.get("sessionUpdate")
        content = update.get("content")

        if session_update == "agent_message_chunk" and isinstance(content, dict):
            text = str(content.get("text") or "")
            if text:
                return [("message.delta", {"text": text})]

        if session_update == "agent_thought_chunk" and isinstance(content, dict):
            text = str(content.get("text") or "")
            if text:
                return [("message.delta", {"text": text, "thought": True})]

        if session_update == "tool_call" and isinstance(content, dict):
            return [("tool.start", {
                "tool_call_id": str(content.get("id") or ""),
                "name": str(content.get("name") or "tool"),
                "input": content.get("input"),
            })]

        if session_update == "tool_call_update" and isinstance(content, dict):
            return [("tool.update", {
                "tool_call_id": str(content.get("id") or ""),
                "name": str(content.get("name") or "tool"),
                "partial_output": content.get("output"),
            })]

        if session_update == "tool_output" and isinstance(content, dict):
            return [("tool.end", {
                "tool_call_id": str(content.get("tool_use_id") or content.get("id") or ""),
                "name": str(content.get("name") or "tool"),
                "output": content.get("content") or content.get("output"),
                "is_error": bool(content.get("is_error")),
            })]

        if session_update in ("shell_output",):
            text = str(content.get("text") or "") if isinstance(content, dict) else ""
            if text:
                return [("message.delta", {"text": text, "shell": True})]

        return []

    # permission
    if qwen_type == "permission_request":
        return [("permission.request", {"raw": payload})]

    if qwen_type == "permission_resolved":
        return [("permission.resolved", {"raw": payload})]

    # terminal
    if qwen_type == "turn_complete":
        return [("done", {"raw_type": qwen_type})]

    if qwen_type in ("turn_error", "session_died", "client_evicted"):
        return [("error", {"reason": qwen_type, "raw": payload})]

    return []


def _save_assistant_message(
    store: Store,
    session_id: str,
    text: str,
    *,
    thought: bool = False,
) -> None:
    """Persist accumulated assistant text as a message."""
    if not text.strip():
        return
    store.append_message(Message.create(
        session_id,
        "assistant",
        content=text,
        partial=False,
    ))


def _persist_message_if_needed(
    store: Store,
    session_id: str,
    event_type: str,
    data: dict[str, Any],
) -> None:
    """Persist select events as messages for history replay."""
    if event_type == "message.delta":
        # Deltas are transient; we accumulate them in the SSE stream.
        # A full assistant message is persisted on 'done'.
        return
    if event_type == "tool.start":
        store.append_message(Message.create(
            session_id,
            "tool",
            content=str(data.get("input") or ""),
            tool_name=data.get("name"),
            tool_call_id=data.get("tool_call_id"),
        ))
    elif event_type == "tool.end":
        output = data.get("output")
        text = str(output) if output is not None else ""
        store.append_message(Message.create(
            session_id,
            "tool",
            content=text[:8000],
            tool_name=data.get("name"),
            tool_call_id=data.get("tool_call_id"),
        ))
    elif event_type == "error":
        reason = data.get("reason") or "unknown error"
        store.append_message(Message.create(
            session_id,
            "system",
            content=f"❌ {reason}",
        ))
