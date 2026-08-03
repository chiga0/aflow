"""pi execution engine: drive ``pi --mode rpc`` subprocesses as the agent.

This is the lightweight alternative to ``qwen serve`` (see the pi RPC POC,
``scripts/pi_rpc_poc.py``): one short-lived Node process per session instead
of a resident daemon with a multi-GB heap allowance.

Design goal: emit **qwen-shaped SSE payloads** so ``relay.collect_turn``,
missions and channels work unchanged. Event mapping:

    pi message_update/text_delta       -> session_update agent_message_chunk
    pi message_update/thinking_delta   -> session_update agent_thought_chunk
    pi tool_execution_start/update/end -> tool_call / tool_call_update / tool_output
    pi turn_end (stopReason=error)     -> turn_error
    pi agent_settled                   -> turn_complete
    process died mid-turn              -> session_died

Configuration (environment):
    AFLOW_ENGINE=pi            selects this adapter in server.py
    PI_BIN                     pi executable (default: pi)
    PI_ENGINE_PROVIDER         provider id in models.json (default: bailian-token-plan)
    PI_ENGINE_MODEL            model id (default: qwen3.8-max)
    PI_ENGINE_BASE_URL         OpenAI-compatible baseUrl
    PI_ENGINE_API_KEY          literal key written to models.json (mode 0600);
                               if unset, models.json references
                               $QWENCLOUD_TOKEN_PLAN_API_KEY at request time
    PI_ENGINE_CONTEXT_WINDOW   default 1000000
    PI_ENGINE_MAX_TOKENS       default 32768
    PI_ENGINE_REASONING        "1"/"0" (default: 1)
    PI_ENGINE_IDLE_TTL         seconds before an idle process is reaped (default 900)
"""

from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Generator

logger = logging.getLogger("lite.runtime.pi_adapter")

DEFAULT_BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
_KEY_ENV_REF = "$QWENCLOUD_TOKEN_PLAN_API_KEY"

# Terminal qwen-shaped payload types (mirror relay._map_qwen_event contract).
_TERMINAL = ("turn_complete", "turn_error", "session_died", "client_evicted")


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass
class _PiSession:
    session_id: str
    proc: subprocess.Popen[str]
    cfg_dir: str
    events: queue.Queue[dict[str, Any]] = field(default_factory=queue.Queue)
    alive: bool = True
    last_activity: float = field(default_factory=time.monotonic)
    _lock: threading.Lock = field(default_factory=threading.Lock)


class PiAdapter:
    """Adapter with the same surface as QwenAdapter, backed by pi RPC."""

    engine = "pi"

    def __init__(self) -> None:
        self.pi_bin = _env("PI_BIN", "pi")
        self.provider = _env("PI_ENGINE_PROVIDER", "bailian-token-plan")
        self.model = _env("PI_ENGINE_MODEL", "qwen3.8-max")
        self.base_url = _env("PI_ENGINE_BASE_URL", DEFAULT_BASE_URL)
        self.api_key = os.environ.get("PI_ENGINE_API_KEY") or ""
        self.context_window = int(_env("PI_ENGINE_CONTEXT_WINDOW", "1000000"))
        self.max_tokens = int(_env("PI_ENGINE_MAX_TOKENS", "32768"))
        self.reasoning = _env("PI_ENGINE_REASONING", "1") != "0"
        self.idle_ttl = float(_env("PI_ENGINE_IDLE_TTL", "900"))
        self._sessions: dict[str, _PiSession] = {}
        self._lock = threading.Lock()

    # ── adapter surface (QwenAdapter compatible) ─────────────

    def create_session(self, cwd: str | None = None) -> str:
        self._reap_idle()
        session_id = f"pi-{uuid.uuid4().hex[:12]}"
        cfg_dir = tempfile.mkdtemp(prefix="aflow-pi-")
        os.chmod(cfg_dir, 0o700)
        self._write_models_json(cfg_dir)

        cmd = [
            self.pi_bin, "--mode", "rpc", "--no-session",
            "--provider", self.provider, "--model", self.model,
        ]
        env = dict(os.environ, PI_CODING_AGENT_DIR=cfg_dir)
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                cwd=cwd or None,
                env=env,
            )
        except Exception:
            shutil.rmtree(cfg_dir, ignore_errors=True)
            raise

        session = _PiSession(session_id=session_id, proc=proc, cfg_dir=cfg_dir)
        with self._lock:
            self._sessions[session_id] = session
        threading.Thread(
            target=self._reader, args=(session,), daemon=True,
            name=f"pi-reader-{session_id}",
        ).start()
        logger.info("pi session %s started (pid=%s model=%s cwd=%s)",
                    session_id, proc.pid, self.model, cwd or ".")
        return session_id

    def send_prompt(self, session_id: str, prompt: str) -> dict[str, Any]:
        session = self._get(session_id)
        self._send(session, {"type": "prompt", "message": prompt})
        session.last_activity = time.monotonic()
        return {"ok": True}

    def cancel(self, session_id: str, reason: str = "cancelled") -> None:
        session = self._sessions.get(session_id)
        if not session:
            return
        try:
            self._send(session, {"type": "abort"})
        except Exception:
            logger.debug("abort failed for %s (%s)", session_id, reason)
        self.close_session(session_id)

    def close_session(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if not session:
            return
        self._terminate(session)

    def shutdown(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            self._terminate(session)

    def health(self) -> bool:
        return shutil.which(self.pi_bin) is not None

    def summarize(self, text: str, timeout: float = 12.0) -> str | None:
        """Short-title summariser mirroring QwenAdapter.summarize."""
        snippet = (text or "")[:600]
        if not snippet.strip():
            return None
        session_id: str | None = None
        try:
            session_id = self.create_session()
            self.send_prompt(
                session_id,
                "用不超过8个字概括下面任务的标题，只输出标题本身，不要解释、不要标点、不要引号：\n"
                + snippet,
            )
            chunks: list[str] = []
            deadline = time.monotonic() + timeout
            for _i, _n, payload in self.stream_events(session_id, timeout=2.0):
                mapped = _first_chunk_text(payload)
                if mapped:
                    chunks.append(mapped)
                kind = payload.get("type") if isinstance(payload, dict) else None
                if kind in _TERMINAL or time.monotonic() > deadline:
                    break
            title = "".join(chunks).strip()
            return title or None
        except Exception as exc:
            logger.debug("pi summarize failed: %s", exc)
            return None
        finally:
            if session_id:
                self.close_session(session_id)

    def stream_events(
        self, session_id: str, timeout: float = 60.0
    ) -> Generator[tuple[Any, Any, dict[str, Any]], None, None]:
        """Yield (None, None, qwen_shaped_payload) until a terminal payload.

        ``timeout`` bounds a single queue read, matching QwenAdapter semantics.
        """
        session = self._get(session_id)
        while True:
            try:
                payload = session.events.get(timeout=timeout)
            except queue.Empty:
                if not self._proc_alive(session):
                    yield (None, None, {"type": "session_died", "data": {}})
                    return
                continue
            session.last_activity = time.monotonic()
            yield (None, None, payload)
            if isinstance(payload, dict) and payload.get("type") in _TERMINAL:
                return

    # ── internals ────────────────────────────────────────────

    def _get(self, session_id: str) -> _PiSession:
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"unknown pi session: {session_id}")
        return session

    def _proc_alive(self, session: _PiSession) -> bool:
        return session.proc.poll() is None

    def _send(self, session: _PiSession, command: dict[str, Any]) -> None:
        with session._lock:
            if session.proc.poll() is not None:
                raise RuntimeError(f"pi process for {session.session_id} exited")
            assert session.proc.stdin is not None
            session.proc.stdin.write(json.dumps(command, ensure_ascii=False) + "\n")
            session.proc.stdin.flush()

    def _terminate(self, session: _PiSession) -> None:
        try:
            if session.proc.poll() is None:
                session.proc.stdin and session.proc.stdin.close()
                try:
                    session.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    session.proc.kill()
                    session.proc.wait(timeout=3)
        except Exception:
            logger.debug("pi terminate failed for %s", session.session_id, exc_info=True)
        shutil.rmtree(session.cfg_dir, ignore_errors=True)
        session.alive = False

    def _reap_idle(self) -> None:
        now = time.monotonic()
        with self._lock:
            idle = [
                sid for sid, s in self._sessions.items()
                if now - s.last_activity > self.idle_ttl
            ]
        for sid in idle:
            logger.info("reaping idle pi session %s", sid)
            self.close_session(sid)

    def _write_models_json(self, cfg_dir: str) -> None:
        models = {
            "providers": {
                self.provider: {
                    "baseUrl": self.base_url,
                    "api": "openai-completions",
                    "apiKey": self.api_key or _KEY_ENV_REF,
                    "compat": {
                        "supportsDeveloperRole": False,
                        "supportsReasoningEffort": False,
                    },
                    "models": [
                        {
                            "id": self.model,
                            "name": self.model,
                            "reasoning": self.reasoning,
                            "contextWindow": self.context_window,
                            "maxTokens": self.max_tokens,
                        }
                    ],
                }
            }
        }
        path = os.path.join(cfg_dir, "models.json")
        with open(path, "w") as f:
            json.dump(models, f, indent=2)
        os.chmod(path, 0o600)

    def _reader(self, session: _PiSession) -> None:
        """Read pi JSONL stdout, map to qwen-shaped payloads, enqueue."""
        assert session.proc.stdout is not None
        try:
            for line in session.proc.stdout:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for payload in _map_pi_event(event):
                    session.events.put(payload)
        except Exception:
            logger.debug("pi reader error for %s", session.session_id, exc_info=True)
        finally:
            session.alive = False
            # If the process dies while a turn is being consumed, the reader
            # enqueues a terminal marker so stream_events() does not hang.
            session.events.put({"type": "session_died", "data": {}})


def _map_pi_event(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Map one pi RPC event to zero-or-more qwen-shaped payloads."""
    etype = event.get("type")

    if etype == "message_update":
        a = event.get("assistantMessageEvent") or {}
        kind = a.get("type")
        if kind == "text_delta":
            text = str(a.get("delta") or "")
            return [_session_update("agent_message_chunk", text)] if text else []
        if kind == "thinking_delta":
            text = str(a.get("delta") or "")
            return [_session_update("agent_thought_chunk", text)] if text else []
        if kind == "error":
            return [{"type": "turn_error",
                     "data": {"reason": "assistant_error", "raw": a}}]
        return []

    if etype == "tool_execution_start":
        return [{"type": "session_update", "data": {"update": {
            "sessionUpdate": "tool_call",
            "content": {
                "id": str(event.get("toolCallId") or ""),
                "name": str(event.get("toolName") or "tool"),
                "input": event.get("args"),
            },
        }}}]

    if etype == "tool_execution_update":
        return [{"type": "session_update", "data": {"update": {
            "sessionUpdate": "tool_call_update",
            "content": {
                "id": str(event.get("toolCallId") or ""),
                "name": str(event.get("toolName") or "tool"),
                "output": _result_text(event.get("partialResult")),
            },
        }}}]

    if etype == "tool_execution_end":
        return [{"type": "session_update", "data": {"update": {
            "sessionUpdate": "tool_output",
            "content": {
                "tool_use_id": str(event.get("toolCallId") or ""),
                "id": str(event.get("toolCallId") or ""),
                "name": str(event.get("toolName") or "tool"),
                "content": _result_text(event.get("result")),
                "is_error": bool(event.get("isError")),
            },
        }}}]

    if etype == "turn_end":
        message = event.get("message") or {}
        if message.get("stopReason") == "error":
            return [{"type": "turn_error", "data": {
                "reason": str(message.get("errorMessage") or "model error"),
                "raw": {"stopReason": "error"},
            }}]
        return []

    if etype == "agent_settled":
        return [{"type": "turn_complete", "data": {"raw_type": "agent_settled"}}]

    return []


def _session_update(kind: str, text: str) -> dict[str, Any]:
    return {"type": "session_update", "data": {"update": {
        "sessionUpdate": kind, "content": {"text": text},
    }}}


def _result_text(result: Any) -> str:
    """Flatten pi tool result content ([{type:text,text:...}]) to plain text."""
    if not isinstance(result, dict):
        return ""
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    parts = [
        str(item.get("text") or "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    ]
    return "".join(parts)


def _first_chunk_text(payload: Any) -> str:
    """Extract assistant text from a qwen-shaped payload (for summarize)."""
    if not isinstance(payload, dict) or payload.get("type") != "session_update":
        return ""
    data = payload.get("data") or {}
    update = data.get("update") if isinstance(data.get("update"), dict) else data
    if update.get("sessionUpdate") != "agent_message_chunk":
        return ""
    content = update.get("content")
    return str(content.get("text") or "") if isinstance(content, dict) else ""
