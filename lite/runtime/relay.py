"""Turn collector: drive one qwen session to completion without side effects.

In the WebShell architecture the *browser* streams the interactive chat
directly from qwen via the ``/daemon`` proxy. The control plane only needs to
*programmatically* run a qwen turn when it orchestrates work itself — i.e. for
server-side missions and inbound chat channels. ``collect_turn`` does exactly
that: it opens no lite DB rows, it just reads the qwen SSE stream until the
turn terminates and returns a structured result, optionally fanning each mapped
event out through ``on_event`` so callers can update progress or re-broadcast.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .adapter import QwenAdapter

logger = logging.getLogger("aflow_lite.relay")

EventCallback = Callable[[str, dict[str, Any]], None]


@dataclass
class ToolCall:
    id: str
    name: str
    input: Any = None
    output: Any = None
    is_error: bool = False


@dataclass
class TurnResult:
    status: str = "running"  # running | completed | failed | cancelled | timeout
    text: str = ""
    tools: list[ToolCall] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == "completed"


def collect_turn(
    adapter: QwenAdapter,
    qwen_session_id: str,
    *,
    on_event: EventCallback | None = None,
    timeout: float = 600.0,
    read_timeout: float = 60.0,
) -> TurnResult:
    """Read the qwen SSE stream for ``qwen_session_id`` until the turn ends.

    ``timeout`` is a wall-clock budget for the whole turn; ``read_timeout``
    bounds a single socket read. Already-collected text is preserved on failure.
    """
    result = TurnResult()
    deadline = time.monotonic() + timeout
    text_buf: list[str] = []
    tools_by_id: dict[str, ToolCall] = {}

    def emit(event_type: str, data: dict[str, Any]) -> None:
        if on_event:
            try:
                on_event(event_type, data)
            except Exception:
                logger.debug("on_event callback raised", exc_info=True)

    try:
        for _sse_id, _event_name, payload in adapter.stream_events(
            qwen_session_id, timeout=read_timeout
        ):
            if time.monotonic() > deadline:
                result.status = "timeout"
                result.error = f"turn exceeded {timeout:.0f}s budget"
                break

            for event_type, data in _map_qwen_event(payload):
                emit(event_type, data)

                if event_type == "message.delta" and not data.get("thought"):
                    text_buf.append(str(data.get("text") or ""))
                elif event_type == "tool.start":
                    tc = ToolCall(
                        id=str(data.get("tool_call_id") or ""),
                        name=str(data.get("name") or "tool"),
                        input=data.get("input"),
                    )
                    tools_by_id[tc.id] = tc
                    result.tools.append(tc)
                elif event_type == "tool.end":
                    tc = tools_by_id.get(str(data.get("tool_call_id") or ""))
                    if tc:
                        tc.output = data.get("output")
                        tc.is_error = bool(data.get("is_error"))
                elif event_type == "done":
                    result.status = "completed"
                elif event_type == "error":
                    result.status = "failed"
                    result.error = str(data.get("reason") or "turn error")

                if result.status in ("completed", "failed"):
                    break
            if result.status in ("completed", "failed", "timeout"):
                break
        else:
            # Stream closed cleanly without a terminal event.
            if result.status == "running":
                result.status = "completed"
    except Exception as exc:
        logger.warning("collect_turn stream error: %s", exc)
        if result.status == "running":
            result.status = "failed"
            result.error = str(exc)

    result.text = "".join(text_buf)
    if result.status == "running":
        result.status = "completed"
    return result


def _map_qwen_event(payload: Any) -> list[tuple[str, dict[str, Any]]]:
    """Map one qwen SSE payload to zero-or-more canonical (type, data) events."""
    if not isinstance(payload, dict):
        return []

    qwen_type = payload.get("type")
    data = payload.get("data")

    if qwen_type == "session_update" and isinstance(data, dict):
        update = data.get("update") if isinstance(data.get("update"), dict) else data
        kind = update.get("sessionUpdate")
        content = update.get("content")

        if kind == "agent_message_chunk" and isinstance(content, dict):
            text = str(content.get("text") or "")
            return [("message.delta", {"text": text})] if text else []
        if kind == "agent_thought_chunk" and isinstance(content, dict):
            text = str(content.get("text") or "")
            return [("message.delta", {"text": text, "thought": True})] if text else []
        if kind == "tool_call" and isinstance(content, dict):
            return [("tool.start", {
                "tool_call_id": str(content.get("id") or ""),
                "name": str(content.get("name") or "tool"),
                "input": content.get("input"),
            })]
        if kind == "tool_call_update" and isinstance(content, dict):
            return [("tool.update", {
                "tool_call_id": str(content.get("id") or ""),
                "name": str(content.get("name") or "tool"),
                "partial_output": content.get("output"),
            })]
        if kind == "tool_output" and isinstance(content, dict):
            return [("tool.end", {
                "tool_call_id": str(content.get("tool_use_id") or content.get("id") or ""),
                "name": str(content.get("name") or "tool"),
                "output": content.get("content") or content.get("output"),
                "is_error": bool(content.get("is_error")),
            })]
        if kind == "shell_output" and isinstance(content, dict):
            text = str(content.get("text") or "")
            return [("message.delta", {"text": text, "shell": True})] if text else []
        return []

    if qwen_type == "permission_request":
        return [("permission.request", {"raw": payload})]
    if qwen_type == "permission_resolved":
        return [("permission.resolved", {"raw": payload})]
    if qwen_type == "turn_complete":
        return [("done", {"raw_type": qwen_type})]
    if qwen_type in ("turn_error", "session_died", "client_evicted"):
        return [("error", {"reason": qwen_type, "raw": payload})]
    return []
