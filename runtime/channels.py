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
from urllib.parse import unquote, urlencode

from .adapter import QwenAdapter
from .auth import AuthConfig
from .metrics import METRICS
from .models import new_id, utc_now
from .relay import collect_turn
from .store import Store

logger = logging.getLogger("runtime.channels")

SUPPORTED_TYPES = {"dingtalk", "feishu", "webhook", "wecom", "bark", "serverchan", "email"}
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


def post_reply(channel: dict[str, Any], text: str, context: dict[str, Any] | None = None) -> None:
    """Deliver a message to the channel.

    Feishu app bots reply through the Open API (tenant_access_token +
    im/v1/messages) when app credentials are configured and a chat context
    is available; otherwise we fall back to the custom-bot webhook.
    """
    ctype = (channel.get("type") or "webhook").lower()
    snippet = text[:4000]
    if ctype == "feishu":
        meta = channel.get("metadata") or {}
        chat_id = (context or {}).get("chat_id")
        if meta.get("app_id") and meta.get("app_secret") and chat_id:
            try:
                _feishu_send(str(meta["app_id"]), str(meta["app_secret"]), str(chat_id), snippet)
                return
            except Exception:
                logger.warning("feishu open-api reply failed; falling back", exc_info=True)
    url = (channel.get("reply_url") or "").strip()
    if not url:
        return
    if ctype == "dingtalk":
        payload: dict[str, Any] = {"msgtype": "text", "text": {"content": snippet}}
    elif ctype == "feishu":
        payload = {"msg_type": "text", "content": {"text": snippet}}
    elif ctype == "wecom":
        # 企业微信群机器人：markdown 消息，secret 在 webhook key 里，无需签名
        payload = {"msgtype": "markdown", "markdown": {"content": snippet}}
    elif ctype == "bark":
        payload = {"title": "AFlow", "body": snippet, "group": "aflow"}
    else:
        payload = {"text": snippet, "channel_id": channel.get("id")}
    if ctype == "serverchan":
        # reply_url = https://sctapi.ftqq.com/<key>.send
        data = urllib.parse.urlencode({"title": "AFlow 通知", "desp": snippet}).encode()
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
    elif ctype == "email":
        _send_email(channel, snippet)
        return
    else:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception:
        logger.warning("channel reply failed for %s", channel.get("id"), exc_info=True)


def _send_email(channel: dict[str, Any], text: str) -> None:
    """Universal notify path: plain SMTP, works for every platform."""
    import smtplib
    from email.mime.text import MIMEText

    meta = channel.get("metadata") or {}
    host = str(meta.get("smtp_host") or "").strip()
    if not host:
        return
    port = int(meta.get("smtp_port") or 465)
    user = str(meta.get("smtp_user") or "")
    password = str(meta.get("smtp_pass") or "")
    to_addrs = [a.strip() for a in str(meta.get("mail_to") or user).split(",") if a.strip()]
    if not to_addrs:
        return
    msg = MIMEText(text, "plain", "utf-8")
    msg["Subject"] = "AFlow 通知"
    msg["From"] = user or "aflow@local"
    msg["To"] = ", ".join(to_addrs)
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15) as s:
            if user and password:
                s.login(user, password)
            s.sendmail(msg["From"], to_addrs, msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.starttls()
            if user and password:
                s.login(user, password)
            s.sendmail(msg["From"], to_addrs, msg.as_string())


def notify_channels(store: Store, title: str, body: str, url: str = "") -> int:
    """Fan a notification out to every enabled channel (fire-and-forget).

    Returns the number of channels delivered to. Used by the ChatHub notify
    hook so turn completion / approvals also land in DingTalk / Feishu /
    WeCom groups.
    """
    text = f"**{title}**\n{body}"
    if url:
        text += f"\n[打开 AFlow]({url})"
    sent = 0
    for channel in store.list_channels():
        if not int(channel.get("enabled", 1)):
            continue
        if not (channel.get("reply_url") or "").strip():
            continue
        try:
            post_reply(channel, text)
            sent += 1
        except Exception:
            logger.warning("channel notify failed for %s", channel.get("id"), exc_info=True)
    return sent


# ── feishu open api ───────────────────────────────────────

_FEISHU_TOKEN_CACHE: dict[str, tuple[str, float]] = {}


def _feishu_tenant_token(app_id: str, app_secret: str) -> str:
    cached = _FEISHU_TOKEN_CACHE.get(app_id)
    if cached and cached[1] > time.time() + 60:
        return cached[0]
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=json.dumps({"app_id": app_id, "app_secret": app_secret}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if data.get("code") != 0:
        raise RuntimeError(f"feishu token error: {data.get('msg')}")
    token = str(data["tenant_access_token"])
    _FEISHU_TOKEN_CACHE[app_id] = (token, time.time() + int(data.get("expire", 7200)))
    return token


def _feishu_send(app_id: str, app_secret: str, chat_id: str, text: str) -> None:
    token = _feishu_tenant_token(app_id, app_secret)
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
        data=json.dumps({
            "receive_id": chat_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}),
        }).encode(),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    if data.get("code") != 0:
        raise RuntimeError(f"feishu send error: {data.get('msg')}")


def _inbound_context(channel: dict[str, Any], body: Any) -> dict[str, Any]:
    """Reply routing hints (feishu chat id) extracted from the event body."""
    context: dict[str, Any] = {}
    if (channel.get("type") or "").lower() == "feishu" and isinstance(body, dict):
        message = (body.get("event") or {}).get("message") or {}
        if message.get("chat_id"):
            context["chat_id"] = str(message["chat_id"])
        if message.get("message_id"):
            context["message_id"] = str(message["message_id"])
    return context


def _run_inbound(channel: dict[str, Any], text: str, adapter: QwenAdapter,
                 context: dict[str, Any] | None = None) -> None:
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
    post_reply(channel, reply, context)


# ── redaction ───────────────────────────────────────────────


def _redact(channel: dict[str, Any]) -> dict[str, Any]:
    secret = channel.get("secret") or ""
    out = dict(channel)
    out["secret"] = {"configured": bool(secret), "prefix": secret[:4] if secret else ""}
    meta = dict(out.get("metadata") or {})
    if meta.get("app_secret"):
        meta["app_secret"] = {"configured": True}
    out["metadata"] = meta
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
    if len(parts) == 4 and parts[:2] == ["api", "channels"] and parts[3] == "test":
        channel = store.get_channel(parts[2])
        if not channel:
            handler.error(__import__("http").HTTPStatus.NOT_FOUND, "channel not found")
            return True
        try:
            post_reply(channel, "✅ AFlow 测试消息：渠道配置成功")
            handler.json({"ok": True})
        except Exception as exc:
            handler.error(__import__("http").HTTPStatus.BAD_GATEWAY, str(exc))
        return True
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
    existing_meta = (existing or {}).get("metadata") or {}
    in_meta = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    metadata: dict[str, Any] = {**existing_meta}
    for key in ("app_id", "app_secret", "smtp_host", "smtp_port", "smtp_user",
                "smtp_pass", "mail_to"):
        if key in in_meta:
            value = str(in_meta[key] or "").strip()
            if value:
                metadata[key] = value
            elif key.endswith("_secret") or key == "smtp_pass":
                metadata.pop(key, None)  # empty = clear
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
        "metadata": metadata,
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
        target=_run_inbound, args=(channel, text, adapter, _inbound_context(channel, body)),
        daemon=True,
    ).start()
    handler.json({"accepted": True}, status=HTTPStatus.ACCEPTED)
    return True
