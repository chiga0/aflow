"""Qwen serve HTTP client. Extracted from the original QwenServeAdapter."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Any, Generator

logger = logging.getLogger("runtime.adapter")

DEFAULT_TIMEOUT = 120


class QwenAdapter:
    """Thin client for qwen serve REST + SSE endpoints."""

    engine = "qwen"

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
    ):
        self.base_url = (
            base_url or os.environ.get("QWEN_SERVE_URL") or "http://127.0.0.1:4170"
        ).rstrip("/")
        self.token = token or os.environ.get("QWEN_SERVE_TOKEN")

    # ── REST calls ────────────────────────────────────────────

    def create_session(self, cwd: str | None = None) -> str:
        """POST /session → sessionId"""
        body: dict[str, Any] = {}
        if cwd:
            body["cwd"] = cwd
        resp = self._request("POST", "/session", body)
        session_id = resp.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            raise RuntimeError(f"qwen /session missing sessionId: {resp}")
        return session_id

    def send_prompt(self, session_id: str, prompt: str, images: list | None = None) -> dict[str, Any]:
        """POST /session/{id}/prompt → {promptId, ...}"""
        return self._request(
            "POST",
            f"/session/{session_id}/prompt",
            {"prompt": [{"type": "text", "text": prompt}]},
        )

    def cancel(self, session_id: str, reason: str = "cancelled") -> None:
        """POST /session/{id}/cancel"""
        try:
            self._request("POST", f"/session/{session_id}/cancel", {"reason": reason})
        except Exception as exc:
            logger.warning("cancel failed for %s: %s", session_id, exc)

    def health(self) -> bool:
        try:
            req = urllib.request.Request(f"{self.base_url}/health", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status < 500
        except Exception:
            return False

    def summarize(self, text: str, timeout: float = 12.0) -> str | None:
        """Ask qwen for a short title in a throwaway session.

        Returns the collected assistant text, or None on any failure / timeout.
        This never touches the lite store: it is a private, ephemeral call used
        only to refine a session title after the first turn completes.
        """
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
            return self._collect_title_text(session_id, timeout)
        except Exception as exc:
            logger.debug("summarize failed: %s", exc)
            return None
        finally:
            if session_id:
                try:
                    self.cancel(session_id, reason="title-summary")
                except Exception:
                    pass

    def _collect_title_text(self, session_id: str, timeout: float) -> str | None:
        deadline = time.monotonic() + timeout
        chunks: list[str] = []
        req = self._build_request(
            "GET",
            f"/session/{session_id}/events",
            headers={"accept": "text/event-stream"},
        )
        # Short per-read timeout so a stalled stream cannot block the worker.
        try:
            resp = urllib.request.urlopen(req, timeout=min(timeout, 8.0))
        except Exception:
            return None
        try:
            event_name: str | None = None
            data_lines: list[str] = []
            for raw_line in resp:
                if time.monotonic() > deadline:
                    break
                line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif line == "" and data_lines:
                    payload = _parse_json("\n".join(data_lines))
                    data_lines = []
                    text = _title_chunk_text(event_name, payload)
                    if text:
                        chunks.append(text)
                    if _is_title_terminal(event_name, payload):
                        break
                    event_name = None
        except Exception:
            pass
        finally:
            try:
                resp.close()
            except Exception:
                pass
        joined = "".join(chunks).strip()
        return joined or None

    # ── SSE stream ────────────────────────────────────────────

    def stream_events(
        self,
        session_id: str,
        last_event_id: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> Generator[tuple[str | None, str | None, Any], None, None]:
        """GET /session/{id}/events → yield (sse_id, event_name, data)

        Parses the SSE text protocol line by line. Yields one tuple per
        complete SSE frame. Reconnect logic is left to the caller. ``timeout``
        bounds a single socket read so a stalled stream cannot block forever.
        """
        headers = {"accept": "text/event-stream"}
        if last_event_id:
            headers["Last-Event-ID"] = last_event_id
        req = self._build_request("GET", f"/session/{session_id}/events", headers=headers)

        with urllib.request.urlopen(req, timeout=timeout) as resp:
            event_name: str | None = None
            event_id: str | None = None
            data_lines: list[str] = []

            for raw_line in resp:
                line = raw_line.decode("utf-8").rstrip("\n")

                if line.startswith("id:"):
                    event_id = line[3:].strip()
                elif line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif line == "" and data_lines:
                    payload = _parse_json("\n".join(data_lines))
                    yield event_id, event_name, payload
                    event_name = None
                    event_id = None
                    data_lines = []

    # ── HTTP helpers ──────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        req = self._build_request(method, path, payload=payload)
        try:
            with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
                body = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"qwen {method} {path}: {exc.code} {detail}") from exc
        if not body:
            return {}
        parsed = json.loads(body.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise RuntimeError(f"qwen {method} {path}: non-object JSON")
        return parsed

    def _build_request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> urllib.request.Request:
        req_headers = {"accept": "application/json"}
        req_headers.update(headers or {})
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            req_headers["content-type"] = "application/json"
        if self.token:
            req_headers["authorization"] = f"Bearer {self.token}"
        return urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=req_headers,
            method=method,
        )


def _parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _title_chunk_text(event_name: str | None, payload: Any) -> str:
    """Extract visible assistant text from a qwen SSE frame (title mode)."""
    if not isinstance(payload, dict):
        return ""
    qwen_type = payload.get("type") or event_name
    data = payload.get("data")
    if qwen_type == "session_update" and isinstance(data, dict):
        update = data.get("update") if isinstance(data.get("update"), dict) else data
        if update.get("sessionUpdate") == "agent_message_chunk":
            content = update.get("content")
            if isinstance(content, dict):
                return str(content.get("text") or "")
    return ""


def _is_title_terminal(event_name: str | None, payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    qwen_type = payload.get("type") or event_name
    return qwen_type in ("turn_complete", "turn_error", "session_died", "client_evicted")
