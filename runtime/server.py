"""HTTP server: auth gateway + /daemon reverse proxy + static SPA + metrics.

In the WebShell architecture the browser talks to qwen *through* us: every
``/daemon/*`` request is authenticated here (cookie or bearer token) and then
forwarded to qwen serve, including SSE streams. We also serve the built SPA,
expose a Prometheus ``/metrics`` endpoint, an enriched ``/api/health``, and the
login/session endpoints. Mission & channel control-plane routes are added by
their own modules (see missions.py / channels.py).
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from . import __version__
from .adapter import QwenAdapter
from .auth import (
    AuthConfig,
    check_request_auth,
    clear_cookie_header,
    parse_cookie,
    set_cookie_header,
    verify_password,
)
from .metrics import METRICS
from .store import Store

logger = logging.getLogger("runtime.server")

MAX_BODY = 4 * 1024 * 1024

# Paths that never require authentication (the SPA shell + login + probes).
_PUBLIC_EXACT = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/session",
    "/api/auth/logout",
    "/manifest.json",
    "/sw.js",
    "/favicon.ico",
}


def _is_public_path(path: str) -> bool:
    if path in _PUBLIC_EXACT:
        return True
    if path in {"/", "/index.html"}:
        return True
    # Static assets needed before login (icons, hashed bundles).
    if path.startswith("/assets/") or path.startswith("/icons/"):
        return True
    if path.startswith("/icon-") or path.startswith("/apple-touch-icon") or path.startswith("/favicon-"):
        return True
    # Inbound webhooks carry no browser cookie; they authenticate via a
    # per-channel signature verified inside the handler.
    if path.startswith("/api/channels/") and path.endswith("/inbound"):
        return True
    return False


def make_handler(
    store: Store,
    adapter: QwenAdapter,
    auth_config: AuthConfig,
) -> type[BaseHTTPRequestHandler]:

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = f"aflow-lite/{__version__}"
        _metric_status: int = 500

        # ── auth helpers ──────────────────────────────────────

        def _is_secure(self) -> bool:
            fwd = (self.headers.get("X-Forwarded-Proto") or "").lower()
            return fwd == "https"

        def _session_valid(self, sid: str) -> bool:
            return store.get_auth_session(sid) is not None

        def _authenticated(self) -> bool:
            return check_request_auth(self.headers, auth_config, self._session_valid)

        def _current_email(self) -> str | None:
            sid = parse_cookie(self.headers.get("Cookie"), auth_config.cookie_name)
            if sid:
                row = store.get_auth_session(sid)
                if row:
                    return row["email"]
            return None

        def _require_auth(self) -> bool:
            """Return True (and emit 401) when the request must be blocked."""
            if _is_public_path(urlparse(self.path).path):
                return False
            if self._authenticated():
                return False
            METRICS.inc("aflow_auth_failures_total")
            self.json(
                {"error": "authentication required", "login": "/api/auth/login"},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return True

        # ── routing ───────────────────────────────────────────

        def do_HEAD(self) -> None:
            try:
                path = urlparse(self.path).path
                # HEAD is used by Cloudflare/monitors; answer 200 for health and
                # any non-API (SPA/static) path, 405 only for unknown API routes.
                if path == "/api/health" or not path.startswith("/api/"):
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
                self.send_header("Content-Length", "0")
                self.end_headers()
            finally:
                self._record_metric("HEAD")

        def do_GET(self) -> None:
            try:
                path = urlparse(self.path).path
                # Unified auth gate: every /api/* route that is not explicitly
                # public (health, login, session probe) requires auth. This
                # protects extension routes (missions/channels) automatically.
                if path.startswith("/api/") and not _is_public_path(path):
                    if self._require_auth():
                        return
                if path == "/api/health":
                    return self.handle_health()
                if path == "/metrics":
                    if self._require_auth():
                        return
                    return self.handle_metrics()
                if path == "/api/auth/session":
                    return self.handle_session_status()
                # Daemon proxy (authenticated).
                if path == "/daemon" or path.startswith("/daemon/"):
                    if self._require_auth():
                        return
                    return self._proxy_get()
                # Everything else that is not /api/* is the SPA / static assets.
                if not path.startswith("/api/"):
                    return self.serve_spa()
                # Unknown /api/* — mission & channel routes are mounted below.
                from . import routes_extra  # noqa: F401  (optional extension point)
                if routes_extra.handle_get(self, path, store, adapter, auth_config):
                    return
                self.error(HTTPStatus.NOT_FOUND, "not found")
            finally:
                self._record_metric("GET")

        def do_POST(self) -> None:
            try:
                # Read the raw body exactly once: webhook signature verification
                # and the /daemon proxy both need the original bytes.
                self._raw_body = self._read_raw()
                path = urlparse(self.path).path
                if path == "/api/auth/login":
                    return self.handle_login()
                if path == "/api/auth/logout":
                    return self.handle_logout()
                # Unified auth gate for every other POST (daemon + /api/* ext).
                if (path.startswith("/api/") or path == "/daemon" or path.startswith("/daemon/")):
                    if self._require_auth():
                        return
                if path == "/daemon" or path.startswith("/daemon/"):
                    return self._proxy_post()
                if path.startswith("/api/"):
                    body = self.read_body()
                    from . import routes_extra
                    if routes_extra.handle_post(
                        self, path, body, self._raw_body, store, adapter, auth_config
                    ):
                        return
                self.error(HTTPStatus.NOT_FOUND, "not found")
            finally:
                self._record_metric("POST")

        def do_DELETE(self) -> None:
            try:
                path = urlparse(self.path).path
                if path.startswith("/api/") and not _is_public_path(path):
                    if self._require_auth():
                        return
                if path.startswith("/api/"):
                    from . import routes_extra
                    if routes_extra.handle_delete(self, path, store, adapter, auth_config):
                        return
                self.error(HTTPStatus.NOT_FOUND, "not found")
            finally:
                self._record_metric("DELETE")

        def do_OPTIONS(self) -> None:
            try:
                path = urlparse(self.path).path
                if path == "/daemon" or path.startswith("/daemon/"):
                    return self._proxy_options()
                self.send_response(HTTPStatus.NO_CONTENT)
                self._cors()
                self.end_headers()
            finally:
                self._record_metric("OPTIONS")

        # ── auth endpoints ────────────────────────────────────

        def handle_session_status(self) -> None:
            self.json({
                "authenticated": self._authenticated(),
                "auth_enabled": auth_config.enabled,
                "email": self._current_email(),
            })

        def handle_login(self) -> None:
            body = self.read_body()
            email = str(body.get("email") or "").strip()
            password = str(body.get("password") or "")
            ok = (
                auth_config.password_login_enabled
                and email.lower() == auth_config.email.lower()
                and verify_password(password, auth_config.password_hash)
            )
            if not ok:
                METRICS.inc("aflow_auth_failures_total")
                return self.json({"error": "invalid credentials"}, status=HTTPStatus.UNAUTHORIZED)
            sid = secrets.token_urlsafe(32)
            expires = datetime.now(timezone.utc) + timedelta(seconds=auth_config.session_ttl)
            store.create_auth_session(sid, email, expires.isoformat(timespec="milliseconds"))
            self.json(
                {"authenticated": True, "email": email},
                headers={
                    "Set-Cookie": set_cookie_header(
                        sid, ttl=auth_config.session_ttl, secure=self._is_secure()
                    )
                },
            )

        def handle_logout(self) -> None:
            sid = parse_cookie(self.headers.get("Cookie"), auth_config.cookie_name)
            if sid:
                store.delete_auth_session(sid)
            self.json(
                {"authenticated": False},
                headers={
                    "Set-Cookie": clear_cookie_header(secure=self._is_secure())
                },
            )

        # ── health & metrics ──────────────────────────────────

        def handle_health(self) -> None:
            qwen_up, latency_ms = _qwen_probe(adapter)
            METRICS.set_gauge("aflow_qwen_up", 1.0 if qwen_up else 0.0)
            self.json({
                "ok": True,
                "version": __version__,
                "engine": getattr(adapter, "engine", "qwen"),
                "qwen": qwen_up,
                "qwen_latency_ms": latency_ms,
                "uptime_seconds": round(METRICS.uptime_seconds(), 3),
                "auth": {
                    "enabled": auth_config.enabled,
                    "password_login": auth_config.password_login_enabled,
                    "token": auth_config.token_enabled,
                },
            })

        def handle_metrics(self) -> None:
            body = METRICS.render().encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        # ── SPA / static ──────────────────────────────────────

        def serve_spa(self) -> None:
            static_dir = os.environ.get("AFLOW_STATIC_DIR")
            path = urlparse(self.path).path
            if static_dir:
                from pathlib import Path

                root = Path(static_dir).resolve()
                rel = path.lstrip("/") or "index.html"
                candidate = (root / rel).resolve()
                # Prevent path traversal outside the static root.
                if str(candidate).startswith(str(root)) and candidate.is_file():
                    return self._write_file(candidate)
                index = root / "index.html"
                if index.is_file():
                    return self._write_file(index)
            body = (
                b"<html><body><h1>aflow-lite</h1><p>API is running. "
                b"Build web/ and set AFLOW_STATIC_DIR.</p></body></html>"
            )
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _write_file(self, path: "Any") -> None:
            import mimetypes

            body = path.read_bytes()
            ctype, _ = mimetypes.guess_type(str(path))
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            if "/assets/" in self.path:
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(body)

        # ── daemon reverse proxy ──────────────────────────────

        def _proxy_get(self) -> None:
            target_path = self.path.replace("/daemon", "", 1) or "/"
            target_url = f"{adapter.base_url}{target_path}"
            headers = {"accept": self.headers.get("accept", "*/*")}
            if self.headers.get("Last-Event-ID"):
                headers["Last-Event-ID"] = self.headers["Last-Event-ID"]
            if adapter.token:
                headers["authorization"] = f"Bearer {adapter.token}"
            req = urllib.request.Request(target_url, headers=headers, method="GET")
            accept = self.headers.get("accept", "")

            if "text/event-stream" in accept:
                try:
                    resp = urllib.request.urlopen(req, timeout=300)
                except Exception as exc:
                    return self.error(HTTPStatus.BAD_GATEWAY, str(exc))
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("X-Accel-Buffering", "no")
                self._cors()
                self.end_headers()
                try:
                    while True:
                        chunk = resp.read(4096)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                finally:
                    resp.close()
                return

            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = resp.read()
                    ct = resp.headers.get("Content-Type", "application/json")
                    self.send_response(resp.status)
                    self.send_header("Content-Type", ct)
                    self.send_header("Content-Length", str(len(body)))
                    self._cors()
                    self.end_headers()
                    self.wfile.write(body)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_raw(exc.code, "application/json", detail.encode("utf-8"))
            except Exception as exc:
                self.error(HTTPStatus.BAD_GATEWAY, str(exc))

        def _proxy_post(self) -> None:
            target_path = self.path.replace("/daemon", "", 1) or "/"
            target_url = f"{adapter.base_url}{target_path}"
            body = self._raw_body if getattr(self, "_raw_body", b"") else None
            headers = {"content-type": self.headers.get("Content-Type", "application/json")}
            if adapter.token:
                headers["authorization"] = f"Bearer {adapter.token}"
            req = urllib.request.Request(target_url, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    resp_body = resp.read()
                    self.send_response(resp.status)
                    self.send_header(
                        "Content-Type",
                        resp.headers.get("Content-Type", "application/json"),
                    )
                    self.send_header("Content-Length", str(len(resp_body)))
                    self._cors()
                    self.end_headers()
                    self.wfile.write(resp_body)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_raw(exc.code, "application/json", detail.encode("utf-8"))
            except Exception as exc:
                self.error(HTTPStatus.BAD_GATEWAY, str(exc))

        def _proxy_options(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization, Last-Event-ID",
            )
            self.end_headers()

        # ── HTTP helpers ──────────────────────────────────────

        def send_response(self, code: int, message: str | None = None) -> None:
            self._metric_status = code
            super().send_response(code, message)

        def json(
            self,
            data: Any,
            status: HTTPStatus = HTTPStatus.OK,
            headers: dict[str, str] | None = None,
        ) -> None:
            body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def error(self, status: HTTPStatus, message: str) -> None:
            self.json({"error": message}, status=status)

        def _send_raw(self, code: int, ctype: str, body: bytes) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def read_body(self) -> dict[str, Any]:
            return self._parse_body(getattr(self, "_raw_body", b""))

        def _read_raw(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return b""
            return self.rfile.read(length)

        @staticmethod
        def _parse_body(raw: bytes) -> dict[str, Any]:
            if not raw:
                return {}
            try:
                parsed = json.loads(raw.decode("utf-8"))
                return parsed if isinstance(parsed, dict) else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                return {}

        def _cors(self) -> None:
            origin = os.environ.get("AFLOW_CORS_ORIGIN", "*")
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization, Last-Event-ID",
            )

        def _record_metric(self, method: str) -> None:
            METRICS.inc(
                "aflow_http_requests_total",
                method=method,
                status=str(self._metric_status),
            )

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.debug(fmt, *args)

    return Handler


def _qwen_probe(adapter: QwenAdapter) -> tuple[bool, int]:
    start = time.monotonic()
    up = adapter.health()
    return up, int((time.monotonic() - start) * 1000)


def _qwen_watchdog(adapter: QwenAdapter, interval: float = 10.0) -> None:
    """Background loop keeping the qwen_up gauge fresh for /metrics."""
    while True:
        try:
            up, _ = _qwen_probe(adapter)
            METRICS.set_gauge("aflow_qwen_up", 1.0 if up else 0.0)
        except Exception:
            METRICS.set_gauge("aflow_qwen_up", 0.0)
        time.sleep(interval)


def run_server(
    host: str = "0.0.0.0",
    port: int = 8765,
    db_path: str = "data/aflow.db",
) -> None:
    store = Store(db_path)
    engine = os.environ.get("AFLOW_ENGINE", "qwen").strip().lower()
    if engine == "pi":
        from .pi_adapter import PiAdapter

        adapter: Any = PiAdapter()
        logger.info("execution engine: pi (%s %s)", adapter.pi_bin, adapter.model)
    else:
        adapter = QwenAdapter()
        logger.info("execution engine: qwen serve (%s)", adapter.base_url)
    auth_config = AuthConfig.from_env(data_dir=str(__import__("pathlib").Path(db_path).parent))
    METRICS.set_gauge("aflow_up", 1.0)

    watchdog = threading.Thread(
        target=_qwen_watchdog, args=(adapter,), daemon=True, name="qwen-watchdog"
    )
    watchdog.start()

    handler = make_handler(store, adapter, auth_config)
    server = ThreadingHTTPServer((host, port), handler)
    logger.info("aflow-lite %s listening on %s:%d", __version__, host, port)
    logger.info("auth enabled: %s (password_login=%s, token=%s)",
                auth_config.enabled, auth_config.password_login_enabled, auth_config.token_enabled)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("shutting down")
        server.shutdown()
    finally:
        if hasattr(adapter, "shutdown"):
            adapter.shutdown()
