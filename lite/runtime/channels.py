"""Inbound chat channels: DingTalk / Feishu / generic webhook.

A *channel* lets an external chat system drive the agent: it POSTs a message to
``/api/channels/:id/inbound``, aflow-lite verifies the platform signature, runs
the text through qwen (one ``collect_turn``), and POSTs the reply back to the
configured ``reply_url``. This is the "channel entry" the roadmap asked for,
kept deliberately thin — inbound turns are not persisted as missions (that is
the server-side orchestration path); channels are a stateless request/reply
bridge.

Signature schemes (verified against the raw request body):

* ``webhook``  — ``X-Aflow-Signature: <hmac_sha256(secret, body) hex>``
* ``dingtalk`` — ``timestamp`` + ``sign`` headers;
                 ``sign = base64(hmac_sha256(secret, f"{timestamp}\\n{secret}"))``,
                 with a 1-hour timestamp skew window.
* ``feishu``   — verification-token mode: ``header.token`` (or top-level
                 ``token``) must equal the channel secret. The Feishu URL
                 verification ``challenge`` is echoed back when the token matches.

A channel with no secret *rejects* inbound traffic — production deployments must
configure a secret. Configuration CRUD (``/api/channels``) is cookie-authed like
the rest of the control plane; only ``/inbound`` is public (signature-authed).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
import urllib.request
from typing import Any
from urllib.parse import unquote

from .adapter import QwenAdapter
from .auth import AuthConfig
from .metrics import METRICS
from .models import new_id, utc_now
from .relay import collect_turn
from .store import Store

logger = logging.getLogger("lite.runtime.channels")

SUPPORTED_TYPES = {"dingtalk", "feishu", "webhook"}
_SKEW_MS = 3600 * 1000


# ── signature verification ──────────────────────────────────


def _hmac_hex(secret: str, msg: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verify(
    channel: dict[str, Any],
    headers: Any,
    raw: bytes,
    body: Any,
) -> tuple[bool, dict[str, Any] | None]:
    """Return (signature_ok, challenge_response).

    ``challenge_response`` is non-None only for a Feishu URL-verification ping,
    which must be echoed regardless of whether a real message follows.
    """
    secret = channel.get("secret") or ""
    ctype = (channel.get("type") or "webhook").lower()

    # Feishu URL verification: echo the challenge when the verification token
    # matches (or no secret is configured, which we treat as a dev passthrough).
    challenge = body.get("challenge") if isinstance(body, dict) else None
    if ctype == "feishu" and challenge:
        tok = _feishu_token(body)
        if not secret or hmac.compare_digest(str(tok or ""), secret):
            return True, {"challenge": challenge}
        return False, None

    if not secret:
        return False, None

    if ctype == "dingtalk":
        ts = headers.get("timestamp") or headers.get("Timestamp") or ""
        sign = headers.get("sign") or headers.get("Sign") or ""
        if not ts or not sign:
            return False, None
        try:
            if abs(time.time() * 1000 - int(ts)) > _SKEW_MS:
                return False, None
        except ValueError:
            return False, None
        expected = base64.b64encode(
            hmac.new(
                secret.encode("utf-8"),
                f"{ts}\n{secret}".encode("utf-8"),
                hashlib.sha256,
            ).digest()
        ).decode("utf-8")
        return hmac.compare_digest(expected, sign), None

    if ctype == "feishu":
        return hmac.compare_digest(str(_feishu_token(body) or ""), secret), None

    # generic webhook
    sig = headers.get("x-aflow-signature") or headers.get("X-Aflow-Signature") or ""
    return hmac.compare_digest(_hmac_hex(secret, raw), sig), None


def _feishu_token(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    header = body.get("header")
    if isinstance(header, dict) and header.get("token"):
        return str(header["token"])
    if body.get("token"):
        return str(body["token"])
    return None


# ── inbound text extraction ─────────────────────────────────


def extract_text(channel: dict[str, Any], body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    ctype = (channel.get("type") or "webhook").lower()
    if ctype == "dingtalk":
        text = body.get("text")
        if isinstance(text, dict) and text.get("content"):
            return str(text["content"]).strip() or None
        return None
    if ctype == "feishu":
        event = body.get("event") or {}
        message = event.get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict) and parsed.get("text"):
                    return str(parsed["text"]).strip() or None
            except json.JSONDecodeError:
                pass
        if isinstance(event.get("text"), str) and event["text"].strip():
            return event["text"].strip()
        return None
    for key in ("text", "message", "prompt", "content"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


# ── reply delivery ──────────────────────────────────────────


def post_reply(channel: dict[str, Any], text: str) -> None:
    url = (channel.get("reply_url") or "").strip()
    if not url:
        return
    ctype = (channel.get("type") or "webhook").lower()
    snippet = text[:4000]
    if ctype == "dingtalk":
        payload: dict[str, Any] = {"msgtype": "text", "text": {"content": snippet}}
    elif ctype == "feishu":
        payload = {"msg_type": "text", "content": {"text": snippet}}
    else:
        payload = {"text": snippet, "channel_id": channel.get("id")}
    try:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception:
        logger.warning("channel reply failed for %s", channel.get("id"), exc_info=True)


def _run_inbound(channel: dict[str, Any], text: str, adapter: QwenAdapter) -> None:
    sid: str | None = None
    reply = ""
    try:
        sid = adapter.create_session()
        adapter.send_prompt(sid, text)
        result = collect_turn(adapter, sid, timeout=300.0)
        reply = result.text.strip() or "(无回复)"
    except Exception as exc:  # noqa: BLE001 — never let a channel thread crash
        logger.exception("channel inbound run failed for %s", channel.get("id"))
        reply = f"执行失败：{exc}"
    finally:
        if sid:
            try:
                adapter.cancel(sid, reason="channel-inbound-done")
            except Exception:
                pass
    post_reply(channel, reply)


# ── redaction ───────────────────────────────────────────────


def _redact(channel: dict[str, Any]) -> dict[str, Any]:
    secret = channel.get("secret") or ""
    out = dict(channel)
    out["secret"] = {"configured": bool(secret), "prefix": secret[:4] if secret else ""}
    return out


# ── HTTP routes ─────────────────────────────────────────────


def _parts(path: str) -> list[str]:
    return [unquote(p) for p in path.split("/") if p]


def handle_get(handler: Any, path: str, store: Store, adapter: QwenAdapter, auth: AuthConfig) -> bool:
    parts = _parts(path)
    if parts == ["api", "channels"]:
        handler.json({"channels": [_redact(c) for c in store.list_channels()]})
        return True
    if len(parts) == 3 and parts[:2] == ["api", "channels"]:
        channel = store.get_channel(parts[2])
        if not channel:
            handler.error(__import__("http").HTTPStatus.NOT_FOUND, "channel not found")
            return True
        handler.json({"channel": _redact(channel)})
        return True
    return False


def handle_post(
    handler: Any,
    path: str,
    body: dict[str, Any],
    raw: bytes,
    store: Store,
    adapter: QwenAdapter,
    auth: AuthConfig,
) -> bool:
    parts = _parts(path)
    if parts == ["api", "channels"]:
        return _upsert(handler, body, store)
    if len(parts) == 4 and parts[:2] == ["api", "channels"] and parts[3] == "inbound":
        return _inbound(handler, parts[2], body, raw, handler.headers, store, adapter)
    if len(parts) == 4 and parts[:2] == ["api", "channels"] and parts[3] == "delete":
        return _delete(handler, parts[2], store)
    return False


def _upsert(handler: Any, body: dict[str, Any], store: Store) -> bool:
    from http import HTTPStatus

    ctype = str(body.get("type") or "webhook").strip().lower()
    if ctype not in SUPPORTED_TYPES:
        handler.error(HTTPStatus.BAD_REQUEST, f"type must be one of {sorted(SUPPORTED_TYPES)}")
        return True
    channel_id = str(body.get("id") or "").strip() or new_id("ch")
    now = utc_now()
    existing = store.get_channel(channel_id)
    store.upsert_channel({
        "id": channel_id,
        "type": ctype,
        "name": str(body.get("name") or channel_id),
        "webhook_url": str(body.get("webhook_url") or ""),
        "secret": str(body.get("secret") or (existing or {}).get("secret") or ""),
        "reply_url": str(body.get("reply_url") or ""),
        "enabled": bool(body.get("enabled", True)),
        "created_at": (existing or {}).get("created_at") or now,
        "updated_at": now,
        "metadata": {},
    })
    handler.json({"channel": _redact(store.get_channel(channel_id))}, status=HTTPStatus.CREATED)
    return True


def _delete(handler: Any, channel_id: str, store: Store) -> bool:
    from http import HTTPStatus

    if not store.delete_channel(channel_id):
        handler.error(HTTPStatus.NOT_FOUND, "channel not found")
        return True
    handler.json({"deleted": True})
    return True


def _inbound(
    handler: Any,
    channel_id: str,
    body: dict[str, Any],
    raw: bytes,
    headers: Any,
    store: Store,
    adapter: QwenAdapter,
) -> bool:
    from http import HTTPStatus

    channel = store.get_channel(channel_id)
    if not channel or not channel.get("enabled", True):
        handler.error(HTTPStatus.NOT_FOUND, "channel not found")
        return True

    ok, challenge = verify(channel, headers, raw, body)
    if challenge is not None:
        handler.json(challenge)  # Feishu URL verification echo
        return True
    if not ok:
        METRICS.inc("aflow_channel_signature_failures_total", type=channel.get("type") or "webhook")
        handler.error(HTTPStatus.UNAUTHORIZED, "invalid signature")
        return True

    text = extract_text(channel, body)
    if not text:
        # Non-text events (e.g. Feishu card actions) are acked without a run.
        handler.json({"accepted": False, "reason": "no text"})
        return True

    threading.Thread(
        target=_run_inbound, args=(channel, text, adapter), daemon=True
    ).start()
    handler.json({"accepted": True}, status=HTTPStatus.ACCEPTED)
    return True
