"""Web Push (RFC 8030) with VAPID (RFC 8292), stdlib-only.

Pushes carry **no payload**, so RFC 8291 content encryption is not needed:
the push is a wake-up ping and the service worker fetches the latest notice
from ``GET /api/push/peek`` (same-origin cookie auth) to render the
notification text locally.

VAPID requires an ES256 (P-256 ECDSA) JWT. Python's stdlib has no elliptic
curves, so a minimal, auditable P-256 implementation lives here:

* affine point ops with ``pow(x, -1, p)`` modular inverse
* deterministic ECDSA (RFC 6979) — no per-signature randomness to bias
* generator on-curve self-check at import (loud failure over silent breakage)

The private key is generated once and stored at ``<data-dir>/vapid.json``
(mode 0600). Subscriptions live in the ``push_subscriptions`` table.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from typing import Any

from .models import utc_now

logger = logging.getLogger("runtime.push")

# ── P-256 / secp256r1 domain parameters (FIPS 186-4) ──────────────────────
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_A = _P - 3
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5


def _on_curve(x: int, y: int) -> bool:
    return (y * y - (x * x * x + _A * x + 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B)) % _P == 0


assert _on_curve(_GX, _GY), "P-256 generator not on curve — constants broken"

_INF = None  # point at infinity


def _point_add(p1: Any, p2: Any) -> Any:
    if p1 is _INF:
        return p2
    if p2 is _INF:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % _P == 0:
        return _INF
    if p1 == p2:
        lam = (3 * x1 * x1 + _A) * pow(2 * y1, -1, _P) % _P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    y3 = (lam * (x1 - x3) - y1) % _P
    return (x3, y3)


def _point_mul(k: int, p: Any) -> Any:
    result = _INF
    addend = p
    while k:
        if k & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        k >>= 1
    return result


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _rfc6979_k(priv: int, digest: bytes) -> int:
    """Deterministic nonce (RFC 6979 §3.2, HMAC-SHA256)."""
    x_bytes = priv.to_bytes(32, "big")
    h1 = digest  # bits2int is identity for 256-bit hash / 256-bit n
    v = b"\x01" * 32
    k = b"\x00" * 32
    k = hmac.new(k, v + b"\x00" + x_bytes + h1, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + x_bytes + h1, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        cand = int.from_bytes(v, "big")
        if 1 <= cand < _N:
            return cand
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


def ecdsa_sign(priv: int, message: bytes) -> bytes:
    """Return r||s, 64 bytes."""
    digest = hashlib.sha256(message).digest()
    z = int.from_bytes(digest, "big")
    while True:
        k = _rfc6979_k(priv, digest)
        pt = _point_mul(k, (_GX, _GY))
        r = pt[0] % _N
        if r == 0:
            continue
        s = pow(k, -1, _N) * (z + r * priv) % _N
        if s == 0:
            continue
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def ecdsa_verify(pub: tuple[int, int], message: bytes, sig: bytes) -> bool:
    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:], "big")
    if not (1 <= r < _N and 1 <= s < _N):
        return False
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    w = pow(s, -1, _N)
    u1 = z * w % _N
    u2 = r * w % _N
    pt = _point_add(_point_mul(u1, (_GX, _GY)), _point_mul(u2, pub))
    if pt is _INF:
        return False
    return pt[0] % _N == r


class VapidKey:
    """P-256 keypair persisted at <data-dir>/vapid.json (mode 0600)."""

    def __init__(self, data_dir: str) -> None:
        path = os.path.join(data_dir, "vapid.json")
        if os.path.exists(path):
            with open(path) as f:
                raw = json.load(f)
            self.priv = int(raw["d"], 16)
        else:
            self.priv = int.from_bytes(os.urandom(32), "big") % (_N - 1) + 1
            os.makedirs(data_dir, exist_ok=True)
            with open(path, "w") as f:
                json.dump({"d": format(self.priv, "064x"), "created_at": utc_now()}, f)
            os.chmod(path, 0o600)
        pub = _point_mul(self.priv, (_GX, _GY))
        self.pub = pub
        # Uncompressed point, 65 bytes — the applicationServerKey format.
        self.pub_raw = b"\x04" + pub[0].to_bytes(32, "big") + pub[1].to_bytes(32, "big")

    def public_b64url(self) -> str:
        return _b64url(self.pub_raw)

    def jwt(self, audience: str, subject: str, ttl_s: int = 12 * 3600) -> str:
        header = _b64url(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
        claims = _b64url(json.dumps({
            "aud": audience,
            "exp": int(time.time()) + ttl_s,
            "sub": subject,
        }).encode())
        signing_input = f"{header}.{claims}".encode()
        sig = ecdsa_sign(self.priv, signing_input)
        return f"{header}.{claims}.{_b64url(sig)}"

    def auth_header(self, endpoint: str, subject: str) -> str:
        aud = urllib.parse.urlparse(endpoint)
        origin = f"{aud.scheme}://{aud.netloc}"
        token = self.jwt(origin, subject)
        return f"vapid t={token}, k={self.public_b64url()}"


class PushService:
    """Fan-out wake-up pushes + last-notice store for the SW to render."""

    def __init__(self, store: Any, data_dir: str, subject: str | None = None) -> None:
        self.store = store
        self.key = VapidKey(data_dir)
        self.subject = subject or os.environ.get("AFLOW_AUTH_EMAIL") or "aflow@localhost"
        if not self.subject.startswith(("mailto:", "https:")):
            self.subject = f"mailto:{self.subject}"
        self._last_notice: dict[str, Any] | None = None
        self._lock = threading.Lock()

    # ── notices ─────────────────────────────────────────────

    def notify(self, title: str, body: str, url: str = "/", tag: str = "aflow") -> None:
        """Record the notice and deliver a wake-up push (best effort)."""
        notice = {"title": title, "body": body[:120], "url": url, "tag": tag,
                  "ts": time.time()}
        with self._lock:
            self._last_notice = notice
        threading.Thread(
            target=self._deliver, args=(notice,), daemon=True, name="push-deliver"
        ).start()

    def peek(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._last_notice) if self._last_notice else {}

    def _deliver(self, notice: dict[str, Any]) -> None:
        subs = self.store.list_push_subscriptions()
        for sub in subs:
            endpoint = str(sub.get("endpoint") or "")
            if not endpoint.startswith(("https://", "http://")):
                continue
            try:
                req = urllib.request.Request(endpoint, data=b"", method="POST")
                req.add_header("TTL", "240")
                req.add_header("Urgency", "high" if "审批" in notice["title"] else "normal")
                req.add_header(
                    "Authorization", self.key.auth_header(endpoint, self.subject)
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp.read()
            except urllib.error.HTTPError as exc:  # type: ignore[attr-defined]
                if exc.code in (404, 410):  # subscription gone
                    self.store.delete_push_subscription(endpoint)
                    logger.info("push subscription gone: %s", endpoint)
            except Exception as exc:
                logger.debug("push delivery failed (%s): %s", endpoint, exc)


# ── HTTP routes (/api/push/*) ─────────────────────────────────────────────

def _get_service(store: Any) -> PushService | None:
    svc = getattr(store, "_push_service", None)
    if svc is None:
        data_dir = str(getattr(store, "_path", "data/aflow.db").parent)
        svc = PushService(store, data_dir)
        store._push_service = svc  # type: ignore[attr-defined]
    return svc


def handle_get(handler: Any, path: str, store: Any) -> bool:
    if path == "/api/push/publickey":
        svc = _get_service(store)
        handler.json({"publicKey": svc.key.public_b64url()})
        return True
    if path == "/api/push/peek":
        svc = _get_service(store)
        handler.json(svc.peek())
        return True
    return False


def handle_post(handler: Any, path: str, body: dict[str, Any], store: Any) -> bool:
    if path == "/api/push/subscribe":
        endpoint = str(body.get("endpoint") or "").strip()
        keys = body.get("keys") or {}
        if not endpoint.startswith(("https://", "http://")):
            handler.error(HTTPStatus.BAD_REQUEST, "endpoint required")
            return True
        store.add_push_subscription(
            endpoint,
            p256dh=str(keys.get("p256dh") or ""),
            auth=str(keys.get("auth") or ""),
        )
        handler.json({"ok": True})
        return True
    return False


def handle_delete(handler: Any, path: str, store: Any) -> bool:
    if path == "/api/push/subscribe":
        body = handler.read_body() if hasattr(handler, "read_body") else {}
        endpoint = str(body.get("endpoint") or "").strip()
        handler.json({"ok": bool(endpoint) and store.delete_push_subscription(endpoint)})
        return True
    return False
