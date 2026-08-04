#!/usr/bin/env python3
"""Post-deploy E2E smoke: health -> login -> chat turn over SSE.

Verifies the deployed product end-to-end with a real (tiny) agent turn:

    python3 scripts/e2e_smoke.py --base https://aflow.dev

Credentials come from --email/--password or AFLOW_AUTH_EMAIL /
AFLOW_AUTH_PASSWORD. Exits non-zero on any failed step. Used by the
deploy workflow right after a bare-metal deploy.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import http.cookiejar

# The VPS sits behind a cloud WAF that 403s non-browser user agents.
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
SSE_TIMEOUT = 180.0


def fail(msg: str) -> None:
    print(f"  FAIL {msg}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"  ok   {msg}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=os.environ.get("AFLOW_BASE", "https://aflow.dev"))
    ap.add_argument("--email", default=os.environ.get("AFLOW_AUTH_EMAIL", ""))
    ap.add_argument("--password", default=os.environ.get("AFLOW_AUTH_PASSWORD", ""))
    args = ap.parse_args()
    base = args.base.rstrip("/")

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def req(method: str, path: str, body: dict | None = None, timeout: float = 30.0):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"User-Agent": UA}
        if body is not None:
            headers["Content-Type"] = "application/json"
        r = urllib.request.Request(base + path, data=data, method=method, headers=headers)
        try:
            with opener.open(r, timeout=timeout) as resp:
                raw = resp.read()
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            fail(f"{method} {path} -> {exc.code}")

    # 1. health
    health = req("GET", "/api/health")
    if not health.get("ok"):
        fail("health not ok")
    ok(f"health (engine={health.get('engine')})")

    # 2. login
    req("POST", "/api/auth/login", {"email": args.email, "password": args.password})
    ok("login")

    # 3. create session + send a tiny prompt
    session = req("POST", "/api/chat/sessions")
    chat_id = session.get("id")
    if not chat_id:
        fail("no session id")
    req("POST", f"/api/chat/sessions/{chat_id}/messages",
        {"text": "回复两个字：收到"})
    ok(f"prompt sent ({chat_id})")

    # 4. stream SSE until turn.finished
    types: list[str] = []
    buf = b""
    r = urllib.request.Request(
        base + f"/api/chat/sessions/{chat_id}/events",
        headers={"User-Agent": UA, "Accept": "text/event-stream"},
    )
    with opener.open(r, timeout=SSE_TIMEOUT) as sse:
        while True:
            chunk = sse.read(1)
            if not chunk:
                break
            buf += chunk
            while b"\n\n" in buf:
                frame, buf = buf.split(b"\n\n", 1)
                for line in frame.split(b"\n"):
                    if line.startswith(b"data: "):
                        types.append(json.loads(line[6:]).get("type", ""))
            if "turn.finished" in types or "error" in types:
                break

    if "turn.finished" not in types:
        fail(f"no turn.finished (types={sorted(set(types))})")
    ok("sse stream (turn.finished)")

    # 5. assistant reply persisted
    detail = req("GET", f"/api/chat/sessions/{chat_id}")
    replies = [m for m in detail.get("messages", []) if m.get("role") == "assistant"]
    if not replies or not replies[-1].get("content"):
        fail("assistant reply missing/empty")
    ok(f"assistant reply: {replies[-1]['content'][:40]}")

    print("E2E SMOKE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
