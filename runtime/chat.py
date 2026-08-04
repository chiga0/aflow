"""Chat control plane for the mobile-first UI (pi engine).

The WebShell architecture lets the browser talk to qwen directly; the new UI
instead drives the execution engine through this module:

    POST /api/chat/sessions                  create a chat session
    GET  /api/chat/sessions                  list sessions (history)
    GET  /api/chat/sessions/:id              session + full message history
    POST /api/chat/sessions/:id/messages     send a prompt (starts a turn)
    GET  /api/chat/sessions/:id/events       SSE stream of canonical events
    POST /api/chat/sessions/:id/cancel       abort the running turn
    DELETE /api/chat/sessions/:id            close + delete

Unlike WebShell, the transcript is owned by aflow-lite: user prompts and
assistant turns (text + tool records) are persisted in the store, and live
events are fanned out to SSE subscribers with a small replay buffer so a
reconnecting client can resume mid-turn via ``Last-Event-ID``.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, Generator

from .models import new_id, utc_now
from .relay import TurnResult, _map_qwen_event
from .store import Store
from .titles import rule_title

logger = logging.getLogger("runtime.chat")

TURN_TIMEOUT = float(__import__("os").environ.get("AFLOW_CHAT_TURN_TIMEOUT", "1800"))
REPLAY_BUFFER = 500
HEARTBEAT_S = 15.0
MAX_IMAGES = 3
MAX_IMAGE_B64 = 4 * 1024 * 1024  # ~3MB raw


def _validate_images(images: Any) -> list[dict[str, Any]]:
    """Bound the attachment payload; drop anything malformed."""
    if not isinstance(images, list):
        return []
    out: list[dict[str, Any]] = []
    for img in images[:MAX_IMAGES]:
        if not isinstance(img, dict):
            continue
        data = str(img.get("data") or "")
        mime = str(img.get("mimeType") or "image/png")
        if not data or len(data) > MAX_IMAGE_B64 or not mime.startswith("image/"):
            continue
        out.append({"data": data, "mimeType": mime})
    return out


@dataclass
class _SessionState:
    chat_id: str
    pi_sid: str | None = None
    running: bool = False
    seq: int = 0
    buffer: deque[tuple[int, str, dict[str, Any]]] = field(
        default_factory=lambda: deque(maxlen=REPLAY_BUFFER)
    )
    subscribers: list[queue.Queue[tuple[int, str, dict[str, Any]] | None]] = field(
        default_factory=list
    )
    lock: threading.Lock = field(default_factory=threading.Lock)


class ChatHub:
    """Owns live chat sessions on top of an execution adapter."""

    def __init__(self, adapter: Any, store: Store) -> None:
        self.adapter = adapter
        self.store = store
        self._states: dict[str, _SessionState] = {}
        self._lock = threading.Lock()

    # ── lifecycle ────────────────────────────────────────────

    def create_session(self) -> dict[str, Any]:
        chat_id = new_id("chat")
        now = utc_now()
        self.store.create_chat_session(chat_id, now)
        with self._lock:
            self._states[chat_id] = _SessionState(chat_id=chat_id)
        # Prewarm the engine process in the background so the first message
        # does not pay the cold-start cost (mobile users feel every second).
        if getattr(self.adapter, "engine", "") == "pi":
            state = self._states[chat_id]
            threading.Thread(
                target=self._ensure_pi, args=(state,), daemon=True,
                name=f"chat-prewarm-{chat_id}",
            ).start()
        return self.store.get_chat_session(chat_id) or {"id": chat_id}

    def delete_session(self, chat_id: str) -> bool:
        state = self._get_state(chat_id)
        if state:
            self._close_pi(state)
            with self._lock:
                self._states.pop(chat_id, None)
        if not self.store.get_chat_session(chat_id):
            return False
        self.store.delete_chat_session(chat_id)
        return True

    def _get_state(self, chat_id: str) -> _SessionState | None:
        with self._lock:
            state = self._states.get(chat_id)
        if state:
            return state
        # Restore a persisted-but-cold session (server restart).
        if self.store.get_chat_session(chat_id):
            state = _SessionState(chat_id=chat_id)
            with self._lock:
                self._states[chat_id] = state
            return state
        return None

    def _ensure_pi(self, state: _SessionState) -> str:
        """Return a live engine session id, respawning when it was reaped."""
        if state.pi_sid:
            registry = getattr(self.adapter, "_sessions", None)
            if registry is None or state.pi_sid in registry:
                return state.pi_sid
        state.pi_sid = self.adapter.create_session()
        return state.pi_sid

    def _close_pi(self, state: _SessionState) -> None:
        if state.pi_sid and hasattr(self.adapter, "close_session"):
            try:
                self.adapter.close_session(state.pi_sid)
            except Exception:
                logger.debug("pi close failed for %s", state.chat_id, exc_info=True)
        state.pi_sid = None

    # ── messaging ────────────────────────────────────────────

    def send_message(
        self, chat_id: str, text: str, images: list | None = None
    ) -> dict[str, Any]:
        state = self._get_state(chat_id)
        if state is None:
            raise KeyError(chat_id)
        images = _validate_images(images)
        with state.lock:
            if state.running:
                raise RuntimeError("a turn is already running")
            state.running = True
        now = utc_now()
        self.store.add_chat_message(
            chat_id, "user", text, now,
            images=json.dumps(
                [{"mimeType": i.get("mimeType"), "bytes": len(i.get("data", ""))}
                 for i in images],
                ensure_ascii=False,
            ) if images else "[]",
        )
        self.store.touch_chat_session(chat_id, now)
        threading.Thread(
            target=self._drive_turn, args=(state, text, images), daemon=True,
            name=f"chat-turn-{chat_id}",
        ).start()
        return {"ok": True, "running": True}

    def cancel(self, chat_id: str) -> bool:
        state = self._get_state(chat_id)
        if state is None or not state.pi_sid:
            return False
        try:
            self.adapter.cancel(state.pi_sid, reason="chat-cancel")
        except Exception:
            logger.debug("cancel failed for %s", chat_id, exc_info=True)
        state.pi_sid = None  # aborted process is closed by adapter.cancel
        return True

    def respond_approval(
        self, chat_id: str, request_id: str, approved: bool
    ) -> bool:
        """Forward an approval-card decision to the engine (pi RPC)."""
        state = self._get_state(chat_id)
        if state is None or not state.pi_sid:
            return False
        respond = getattr(self.adapter, "respond_ui", None)
        ok = bool(respond and respond(state.pi_sid, request_id, approved))
        self._broadcast(state, "permission.resolved", {
            "request_id": request_id, "approved": approved,
        })
        return ok

    def _drive_turn(
        self, state: _SessionState, prompt: str, images: list | None = None
    ) -> None:
        result = TurnResult()
        text_buf: list[str] = []
        tools: list[dict[str, Any]] = []
        tools_by_id: dict[str, dict[str, Any]] = {}
        deadline = time.monotonic() + TURN_TIMEOUT
        try:
            pi_sid = self._ensure_pi(state)
            self.adapter.send_prompt(pi_sid, prompt, images=images or None)
            for _i, _n, payload in self.adapter.stream_events(pi_sid, timeout=60.0):
                if time.monotonic() > deadline:
                    result.status = "timeout"
                    result.error = f"turn exceeded {TURN_TIMEOUT:.0f}s budget"
                    self._broadcast(state, "error", {"reason": result.error})
                    break
                for etype, data in _map_qwen_event(payload):
                    self._broadcast(state, etype, data)
                    if etype == "message.delta" and not data.get("thought"):
                        text_buf.append(str(data.get("text") or ""))
                    elif etype == "tool.start":
                        rec = {
                            "id": str(data.get("tool_call_id") or ""),
                            "name": str(data.get("name") or "tool"),
                            "input": data.get("input"),
                        }
                        tools_by_id[rec["id"]] = rec
                        tools.append(rec)
                    elif etype == "tool.end":
                        rec = tools_by_id.get(str(data.get("tool_call_id") or ""))
                        if rec:
                            rec["output"] = data.get("output")
                            rec["is_error"] = bool(data.get("is_error"))
                    elif etype == "done":
                        result.status = "completed"
                    elif etype == "error":
                        result.status = "failed"
                        result.error = str(data.get("reason") or "turn error")
                    elif etype == "permission.autocancel":
                        # Unsupported dialog kind: never let the agent block.
                        try:
                            self.adapter.respond_ui(
                                pi_sid, str(data.get("request_id") or ""), False
                            )
                        except Exception:
                            logger.debug("autocancel failed", exc_info=True)
                if result.status in ("completed", "failed", "timeout"):
                    break
        except Exception as exc:
            logger.warning("chat turn failed (%s): %s", state.chat_id, exc)
            if result.status == "running":
                result.status = "failed"
                result.error = str(exc)
        finally:
            result.text = "".join(text_buf)
            if result.status == "running":
                result.status = "completed"
            self._finish_turn(state, prompt, result, tools)

    def _finish_turn(
        self,
        state: _SessionState,
        prompt: str,
        result: TurnResult,
        tools: list[dict[str, Any]],
    ) -> None:
        now = utc_now()
        text = result.text or (result.error or "")
        self.store.add_chat_message(
            state.chat_id, "assistant", text, now,
            tools=json.dumps(tools, ensure_ascii=False, default=str),
            status=result.status,
        )
        self.store.touch_chat_session(state.chat_id, now)
        session = self.store.get_chat_session(state.chat_id)
        if session and not session.get("title"):
            title = rule_title(prompt)[:40]
            self.store.set_chat_session_title(state.chat_id, title)
        self._broadcast(state, "turn.finished", {
            "status": result.status, "error": result.error,
        })
        with state.lock:
            state.running = False

    # ── event fan-out ────────────────────────────────────────

    def _broadcast(self, state: _SessionState, etype: str, data: dict[str, Any]) -> None:
        with state.lock:
            state.seq += 1
            item = (state.seq, etype, data)
            state.buffer.append(item)
            subs = list(state.subscribers)
        for q in subs:
            try:
                q.put_nowait(item)
            except Exception:
                pass

    def subscribe(
        self, chat_id: str, last_event_id: int = 0
    ) -> Generator[tuple[int, str, dict[str, Any]], None, None] | None:
        """Return an event iterator, or None when the session does not exist.

        Yields (seq, type, data); replays buffered events past last_event_id.
        Yields None items as heartbeats (caller decides how to serialize).
        """
        state = self._get_state(chat_id)
        if state is None:
            return None
        return self._iter_events(state, last_event_id)

    def _iter_events(
        self, state: _SessionState, last_event_id: int
    ) -> Generator[tuple[int, str, dict[str, Any]] | None, None, None]:
        q: queue.Queue[Any] = queue.Queue(maxsize=1000)
        with state.lock:
            replay = [item for item in state.buffer if item[0] > last_event_id]
            state.subscribers.append(q)
        try:
            for item in replay:
                yield item
            while True:
                try:
                    item = q.get(timeout=HEARTBEAT_S)
                except queue.Empty:
                    yield None  # heartbeat
                    continue
                yield item
        finally:
            with state.lock:
                if q in state.subscribers:
                    state.subscribers.remove(q)

    # ── reads ────────────────────────────────────────────────

    def list_sessions(self) -> list[dict[str, Any]]:
        """Session list enriched with live running flag + last status."""
        out = []
        for row in self.store.list_chat_sessions():
            state = self._states.get(row["id"])
            row["running"] = bool(state and state.running)
            row["last_status"] = self.store.last_chat_status(row["id"])
            out.append(row)
        return out

    def session_detail(self, chat_id: str) -> dict[str, Any] | None:
        session = self.store.get_chat_session(chat_id)
        if not session:
            return None
        state = self._get_state(chat_id)
        session["running"] = bool(state and state.running)
        session["messages"] = self.store.list_chat_messages(chat_id)
        return session


# ── HTTP routes ──────────────────────────────────────────────


def _parts(path: str) -> list[str]:
    return [p for p in path.split("?")[0].split("/") if p]


def handle_get(handler: Any, path: str, hub: ChatHub) -> bool:
    parts = _parts(path)
    if parts == ["api", "chat", "sessions"]:
        handler.json({"sessions": hub.list_sessions()})
        return True
    if len(parts) >= 4 and parts[:3] == ["api", "chat", "sessions"]:
        chat_id = parts[3]
        if len(parts) == 5 and parts[4] == "events":
            return _stream_events(handler, hub, chat_id)
        if len(parts) == 4:
            detail = hub.session_detail(chat_id)
            if detail is None:
                handler.error(HTTPStatus.NOT_FOUND, "chat session not found")
            else:
                handler.json(detail)
            return True
    return False


def handle_post(handler: Any, path: str, body: dict[str, Any], hub: ChatHub) -> bool:
    parts = _parts(path)
    if parts == ["api", "chat", "sessions"]:
        handler.json(hub.create_session(), status=HTTPStatus.CREATED)
        return True
    if len(parts) == 5 and parts[:3] == ["api", "chat", "sessions"]:
        chat_id = parts[3]
        if parts[4] == "messages":
            text = str(body.get("text") or "").strip()
            images = body.get("images")
            if not text and not images:
                handler.error(HTTPStatus.BAD_REQUEST, "text or images required")
                return True
            try:
                handler.json(
                    hub.send_message(chat_id, text, images),
                    status=HTTPStatus.ACCEPTED,
                )
            except KeyError:
                handler.error(HTTPStatus.NOT_FOUND, "chat session not found")
            except RuntimeError as exc:
                handler.error(HTTPStatus.CONFLICT, str(exc))
            return True
        if parts[4] == "cancel":
            handler.json({"ok": hub.cancel(chat_id)})
            return True
        if parts[4] == "approvals":
            request_id = str(body.get("request_id") or "")
            approved = bool(body.get("approved"))
            if not request_id:
                handler.error(HTTPStatus.BAD_REQUEST, "request_id is required")
                return True
            handler.json({"ok": hub.respond_approval(chat_id, request_id, approved)})
            return True
    return False


def handle_delete(handler: Any, path: str, hub: ChatHub) -> bool:
    parts = _parts(path)
    if len(parts) == 4 and parts[:3] == ["api", "chat", "sessions"]:
        if hub.delete_session(parts[3]):
            handler.json({"ok": True})
        else:
            handler.error(HTTPStatus.NOT_FOUND, "chat session not found")
        return True
    return False


def _stream_events(handler: Any, hub: ChatHub, chat_id: str) -> bool:
    last_event_id = 0
    header_value = handler.headers.get("Last-Event-ID") or ""
    if header_value.isdigit():
        last_event_id = int(header_value)
    stream = hub.subscribe(chat_id, last_event_id)
    if stream is None:
        handler.error(HTTPStatus.NOT_FOUND, "chat session not found")
        return True

    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    def write(event_id: int | None, payload: dict[str, Any]) -> None:
        if event_id is not None:
            handler.wfile.write(f"id: {event_id}\n".encode("utf-8"))
        handler.wfile.write(
            b"data: " + json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8") + b"\n\n"
        )
        handler.wfile.flush()

    try:
        for item in stream:
            if item is None:
                handler.wfile.write(b": hb\n\n")
                handler.wfile.flush()
                continue
            seq, etype, data = item
            write(seq, {"type": etype, "data": data})
            if etype == "turn.finished":
                # Keep the stream open for the next turn; the client stays
                # subscribed across turns.
                continue
    except (BrokenPipeError, ConnectionResetError):
        pass
    return True
