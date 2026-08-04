"""Minimal single-user auth: password login (cookie) + API token (Bearer).

Stdlib only. Passwords hashed with hashlib.scrypt. Sessions persisted in the
SQLite store so a restart does not log the browser out.

Auth is *enabled by default* (a production runtime must never run open). When
no password or token is configured, a random bootstrap password is generated
once and written to ``data/BOOTSTRAP_PASSWORD.txt`` (mode 0600) and logged a
single time. Set ``AFLOW_AUTH_DISABLED=1`` to opt out (local dev only).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from dataclasses import dataclass
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

logger = logging.getLogger("runtime.auth")

COOKIE_NAME = "aflow_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 14  # 14 days
BOOTSTRAP_FILE = "data/BOOTSTRAP_PASSWORD.txt"


def hash_password(password: str, salt: bytes | None = None) -> str:
    """scrypt password hash, format: scrypt$<salt_hex>$<hash_hex>."""
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    try:
        _, salt_hex, hash_hex = stored.split("$", 2)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )
    return hmac.compare_digest(dk, expected)


@dataclass
class AuthConfig:
    enabled: bool
    email: str
    password_hash: str
    api_token: str  # bearer token for scripts/CI; empty = disabled
    session_ttl: int = SESSION_TTL_SECONDS
    cookie_name: str = COOKIE_NAME
    bootstrap_path: str | None = None  # set when a bootstrap password was generated

    @property
    def password_login_enabled(self) -> bool:
        return bool(self.email and self.password_hash)

    @property
    def token_enabled(self) -> bool:
        return bool(self.api_token)

    @classmethod
    def from_env(cls, data_dir: str = "data") -> "AuthConfig":
        disabled = _env_bool("AFLOW_AUTH_DISABLED", False)
        email = (os.environ.get("AFLOW_AUTH_EMAIL") or "").strip()
        password = os.environ.get("AFLOW_AUTH_PASSWORD") or ""
        password_hash = (
            hash_password(password) if password else ""
        )
        api_token = (os.environ.get("AFLOW_AUTH_TOKEN") or "").strip()

        bootstrap_path: str | None = None
        # If auth is not disabled and no credentials at all were provided,
        # generate a bootstrap password so the runtime is never accidentally open.
        if not disabled and not password and not api_token:
            bootstrap_path = _write_bootstrap_password(data_dir)
            password = Path(bootstrap_path).read_text(encoding="utf-8").strip()
            password_hash = hash_password(password)
            if not email:
                email = "admin@aflow.local"
            logger.warning(
                "AUTH: no AFLOW_AUTH_PASSWORD/AFLOW_AUTH_TOKEN set. Generated a "
                "bootstrap password and wrote it to %s (mode 0600). Use email=%s. "
                "Set AFLOW_AUTH_DISABLED=1 for passwordless local dev.",
                bootstrap_path,
                email,
            )

        enabled = (not disabled) and bool(password_hash or api_token)
        if disabled:
            logger.warning("AUTH: disabled via AFLOW_AUTH_DISABLED=1 (insecure).")
        return cls(
            enabled=enabled,
            email=email,
            password_hash=password_hash,
            api_token=api_token,
            bootstrap_path=bootstrap_path,
        )


def _write_bootstrap_password(data_dir: str) -> str:
    path = Path(data_dir) / "BOOTSTRAP_PASSWORD.txt"
    if path.exists():
        # Reuse an existing bootstrap password across restarts.
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    password = secrets.token_urlsafe(16)
    path.write_text(password + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return str(path)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def parse_cookie(header: str | None, name: str) -> str | None:
    if not header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(header)
    except Exception:
        return None
    morsel = cookie.get(name)
    return morsel.value if morsel else None


def check_request_auth(
    headers: Any,
    config: AuthConfig,
    is_session_valid: "callable[[str], bool]",
) -> bool:
    """Return True if the request is authenticated (or auth is disabled)."""
    if not config.enabled:
        return True
    # Bearer token (scripts / CI / cross-origin clients).
    authz = headers.get("Authorization") or headers.get("authorization") or ""
    if authz.lower().startswith("bearer ") and config.token_enabled:
        supplied = authz[7:].strip()
        if supplied and hmac.compare_digest(supplied, config.api_token):
            return True
    # Session cookie (browser, same-origin WebShell requests).
    sid = parse_cookie(headers.get("Cookie"), config.cookie_name)
    if sid and is_session_valid(sid):
        return True
    return False


def set_cookie_header(
    session_id: str,
    *,
    ttl: int,
    secure: bool,
    cookie_name: str = COOKIE_NAME,
) -> str:
    parts = [
        f"{cookie_name}={session_id}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={ttl}",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie_header(
    secure: bool,
    cookie_name: str = COOKIE_NAME,
) -> str:
    parts = [f"{cookie_name}=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)
