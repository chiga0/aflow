#!/usr/bin/env python3
"""Manual verification of the approval-card flow against a live deploy.

Sends a prompt that makes the agent run a dangerous bash command;
expects a permission.request, approves it, and expects the turn to
finish. Model-dependent, so not part of CI e2e.

    AFLOW_AUTH_EMAIL=.. AFLOW_AUTH_PASSWORD=.. python3 scripts/verify_approval.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import http.cookiejar

BASE = os.environ.get("AFLOW_BASE", "https://aflow.dev").rstrip("/")
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(method, path, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": UA}
    if body is not None:
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    with op.open(r, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else {}


req("POST", "/api/auth/login", {
    "email": os.environ["AFLOW_AUTH_EMAIL"],
    "password": os.environ["AFLOW_AUTH_PASSWORD"],
})
sid = req("POST", "/api/chat/sessions")["id"]
req("POST", f"/api/chat/sessions/{sid}/messages", {
    "text": "请用 bash 工具执行这条命令：rm -rf /tmp/aflow-approve-demo（必须用 bash）",
})
print("session:", sid, "- waiting for approval card…")

types = []
buf = b""
r = urllib.request.Request(
    BASE + f"/api/chat/sessions/{sid}/events",
    headers={"User-Agent": UA, "Accept": "text/event-stream"},
)
approved = False
with op.open(r, timeout=300) as sse:
    while True:
        ch = sse.read(1)
        if not ch:
            break
        buf += ch
        while b"\n\n" in buf:
            frame, buf = buf.split(b"\n\n", 1)
            for line in frame.split(b"\n"):
                if not line.startswith(b"data: "):
                    continue
                ev = json.loads(line[6:])
                types.append(ev["type"])
                if ev["type"] == "permission.request" and not approved:
                    print("approval card:", json.dumps(ev["data"], ensure_ascii=False)[:200])
                    req("POST", f"/api/chat/sessions/{sid}/approvals", {
                        "request_id": ev["data"]["request_id"], "approved": True,
                    })
                    approved = True
                    print("approved ->")
        if "turn.finished" in types:
            break

print("types:", sorted(set(types)))
ok = "permission.request" in types and "turn.finished" in types
print("APPROVAL FLOW", "PASSED" if ok else "FAILED")
sys.exit(0 if ok else 1)
