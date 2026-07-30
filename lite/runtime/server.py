"""HTTP server. All routes, <400 lines."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse, parse_qs

from . import __version__
from .adapter import QwenAdapter
from .models import Message, Session
from .relay import pump_session, subscribe, unsubscribe
from .store import Store

logger = logging.getLogger("aflow_lite.server")

MAX_BODY = 4 * 1024 * 1024


def make_handler(store: Store, adapter: QwenAdapter) -> type[BaseHTTPRequestHandler]:

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = f"aflow-lite/{__version__}"

        # ── Routing ───────────────────────────────────────────

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            parts = [p for p in path.split("/") if p]

            if path == "/api/health":
                return self.json({"ok": True, "version": __version__, "qwen": adapter.health()})

            if parts == ["api", "sessions"]:
                sessions = store.list_sessions()
                return self.json({"sessions": [s.to_dict() for s in sessions]})

            if len(parts) == 3 and parts[0] == "api" and parts[1] == "sessions":
                session = store.get_session(parts[2])
                if not session:
                    return self.error(HTTPStatus.NOT_FOUND, "session not found")
                messages = store.list_messages(parts[2])
                return self.json({
                    "session": session.to_dict(),
                    "messages": [m.to_dict() for m in messages],
                })

            if len(parts) == 4 and parts[0] == "api" and parts[1] == "sessions" and parts[3] == "events":
                return self.stream_events(parts[2])

            # SPA fallback: serve web/index.html for non-API paths
            if not path.startswith("/api/"):
                return self.serve_spa()

            self.error(HTTPStatus.NOT_FOUND, "not found")

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            parts = [p for p in path.split("/") if p]
            body = self.read_body()

            if parts == ["api", "sessions"]:
                return self.create_session(body)

            if len(parts) == 4 and parts[0] == "api" and parts[1] == "sessions" and parts[3] == "prompt":
                return self.send_prompt(parts[2], body)

            if len(parts) == 4 and parts[0] == "api" and parts[1] == "sessions" and parts[3] == "cancel":
                return self.cancel_session(parts[2])

            self.error(HTTPStatus.NOT_FOUND, "not found")

        # ── Handlers ──────────────────────────────────────────

        def create_session(self, body: dict[str, Any]) -> None:
            prompt = str(body.get("prompt") or "").strip()
            workspace = body.get("workspace")
            title = prompt[:60] if prompt else "New session"

            session = Session.create(title=title, workspace=workspace)
            store.create_session(session)

            if prompt:
                # Save user message
                store.append_message(Message.create(session.id, "user", prompt))
                # Start agent
                self._start_agent(session, prompt)
            else:
                session.status = "idle"
                store.update_session(session)

            self.json(session.to_dict(), status=HTTPStatus.CREATED)

        def send_prompt(self, session_id: str, body: dict[str, Any]) -> None:
            session = store.get_session(session_id)
            if not session:
                return self.error(HTTPStatus.NOT_FOUND, "session not found")
            if session.status == "running":
                return self.error(HTTPStatus.CONFLICT, "session is already running")
            if session.status in ("completed", "failed", "cancelled"):
                # Allow follow-up: reset to running
                pass

            prompt = str(body.get("prompt") or "").strip()
            if not prompt:
                return self.error(HTTPStatus.BAD_REQUEST, "prompt is required")

            store.append_message(Message.create(session_id, "user", prompt))
            self._start_agent(session, prompt)
            self.json({"ok": True, "session": store.get_session(session_id).to_dict()})

        def cancel_session(self, session_id: str) -> None:
            session = store.get_session(session_id)
            if not session:
                return self.error(HTTPStatus.NOT_FOUND, "session not found")
            if session.qwen_session_id:
                adapter.cancel(session.qwen_session_id)
            session.status = "cancelled"
            store.update_session(session)
            store.append_event(session_id, "done", {"status": "cancelled"})
            self.json({"ok": True, "session": session.to_dict()})

        def stream_events(self, session_id: str) -> None:
            session = store.get_session(session_id)
            if not session:
                return self.error(HTTPStatus.NOT_FOUND, "session not found")

            # Parse Last-Event-ID
            last_id = 0
            header_val = self.headers.get("Last-Event-ID")
            if header_val:
                try:
                    last_id = int(header_val)
                except ValueError:
                    pass

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self._cors()
            self.end_headers()

            wake = subscribe(session_id)
            try:
                while True:
                    events = store.events_since(session_id, last_id)
                    for event in events:
                        last_id = event.id
                        self._write_sse(event.id, event.type, event.data)

                    # Check terminal
                    current = store.get_session(session_id)
                    if current and current.status in ("completed", "failed", "cancelled"):
                        # Flush remaining
                        events = store.events_since(session_id, last_id)
                        for event in events:
                            self._write_sse(event.id, event.type, event.data)
                        break

                    # Wait for new events or timeout for keepalive
                    wake.clear()
                    wake.wait(timeout=15)
                    if not wake.is_set():
                        # Keepalive
                        try:
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            break
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                unsubscribe(session_id, wake)

        # ── Agent lifecycle ───────────────────────────────────

        def _start_agent(self, session: Session, prompt: str) -> None:
            session.status = "running"
            store.update_session(session)
            store.append_event(session.id, "status.change", {"status": "running"})

            thread = threading.Thread(
                target=self._run_agent,
                args=(session.id, prompt),
                daemon=True,
            )
            thread.start()

        def _run_agent(self, session_id: str, prompt: str) -> None:
            session = store.get_session(session_id)
            if not session:
                return
            try:
                # Create qwen session if needed
                if not session.qwen_session_id:
                    qwen_sid = adapter.create_session(cwd=session.workspace)
                    session.qwen_session_id = qwen_sid
                    store.update_session(session)
                    store.append_event(session_id, "status.change", {
                        "status": "running",
                        "qwen_session_id": qwen_sid,
                    })

                # Send prompt
                adapter.send_prompt(session.qwen_session_id, prompt)

                # Pump events (blocks until terminal)
                pump_session(session, adapter, store)

            except Exception as exc:
                logger.exception("agent run failed for %s", session_id)
                current = store.get_session(session_id)
                if current and current.status == "running":
                    current.status = "failed"
                    store.update_session(current)
                reason = str(exc)
                store.append_event(session_id, "error", {"reason": reason})
                store.append_message(Message.create(session_id, "system", f"❌ {reason}"))
                from .relay import _notify
                _notify(session_id)

        # ── SSE writer ────────────────────────────────────────

        def _write_sse(self, event_id: int, event_type: str, data: dict[str, Any]) -> None:
            payload = json.dumps(data, ensure_ascii=False, default=str)
            frame = f"id: {event_id}\nevent: {event_type}\ndata: {payload}\n\n"
            self.wfile.write(frame.encode("utf-8"))
            self.wfile.flush()

        # ── SPA serving ───────────────────────────────────────

        def serve_spa(self) -> None:
            """Serve the built web frontend, or a placeholder."""
            static_dir = os.environ.get("AFLOW_STATIC_DIR")
            if static_dir:
                from pathlib import Path
                index = Path(static_dir) / "index.html"
                if index.exists():
                    body = index.read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            # Placeholder
            body = b"<html><body><h1>aflow-lite</h1><p>API is running. Build web/ and set AFLOW_STATIC_DIR.</p></body></html>"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        # ── HTTP helpers ──────────────────────────────────────

        def json(self, data: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def error(self, status: HTTPStatus, message: str) -> None:
            self.json({"error": message}, status=status)

        def read_body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return {}
            if length == 0:
                return {}
            raw = self.rfile.read(length)
            try:
                parsed = json.loads(raw.decode("utf-8"))
                return parsed if isinstance(parsed, dict) else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                return {}

        def _cors(self) -> None:
            origin = os.environ.get("AFLOW_CORS_ORIGIN", "*")
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self._cors()
            self.end_headers()

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.debug(fmt, *args)

    return Handler


def run_server(
    host: str = "0.0.0.0",
    port: int = 8765,
    db_path: str = "data/aflow.db",
) -> None:
    store = Store(db_path)
    adapter = QwenAdapter()
    handler = make_handler(store, adapter)
    server = ThreadingHTTPServer((host, port), handler)
    logger.info("aflow-lite %s listening on %s:%d", __version__, host, port)
    logger.info("qwen serve: %s", adapter.base_url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("shutting down")
        server.shutdown()
