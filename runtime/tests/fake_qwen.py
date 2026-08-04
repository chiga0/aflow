"""In-memory fake of the qwen serve HTTP/SSE protocol, for offline tests.

It implements just enough of the REST + SSE surface that ``QwenAdapter`` and
``relay.collect_turn`` exercise: session create, prompt, cancel, health, and an
``/events`` SSE stream that replays a configurable frame sequence. No network,
no model, no credentials — fully deterministic.
"""

from __future__ import annotations

import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def _default_frames(reply: str) -> list[dict[str, Any]]:
    return [
        {
            "type": "session_update",
            "data": {
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"text": reply},
                }
            },
        },
        {"type": "turn_complete", "data": {}},
    ]


class FakeQwen:
    def __init__(self, reply: str = "FAKE_REPLY", frames: list[dict[str, Any]] | None = None) -> None:
        self.reply = reply
        self.frames = frames if frames is not None else _default_frames(reply)
        self.cancelled: set[str] = set()
        self.prompts: dict[str, list[str]] = {}
        self._server: ThreadingHTTPServer | None = None
        self.base_url: str = ""

    def start(self) -> "FakeQwen":
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _json(self, code: int, obj: Any) -> None:
                body = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _read_body(self) -> bytes:
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n > 0 else b""

            def _sid(self) -> str:
                # /session/{sid}/<verb>
                return self.path.split("/")[-2]

            def do_GET(self) -> None:  # noqa: N802
                if self.path == "/health":
                    return self._json(200, {"status": "ok"})
                if self.path.endswith("/events"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    try:
                        for i, frame in enumerate(outer.frames, start=1):
                            line = f"id: {i}\ndata: {json.dumps(frame)}\n\n"
                            self.wfile.write(line.encode("utf-8"))
                            self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        pass
                    return
                self._json(200, {})

            def do_POST(self) -> None:  # noqa: N802
                raw = self._read_body()
                if self.path == "/session":
                    sid = str(uuid.uuid4())
                    outer.prompts.setdefault(sid, [])
                    return self._json(200, {"sessionId": sid})
                if self.path.endswith("/prompt"):
                    sid = self._sid()
                    try:
                        body = json.loads(raw or b"{}")
                        text = "".join(
                            b.get("text", "") for b in body.get("prompt", []) if isinstance(b, dict)
                        )
                    except json.JSONDecodeError:
                        text = ""
                    outer.prompts.setdefault(sid, []).append(text)
                    return self._json(200, {"promptId": str(uuid.uuid4())})
                if self.path.endswith("/cancel"):
                    outer.cancelled.add(self._sid())
                    return self._json(200, {})
                self._json(200, {})

            def log_message(self, *a: Any) -> None:  # silence
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
