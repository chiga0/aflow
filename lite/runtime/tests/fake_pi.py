"""Fake ``pi --mode rpc`` binary for PiAdapter tests.

Generates an executable python script that speaks pi's JSONL RPC protocol:
it answers ``prompt`` commands by emitting scripted events (from the
``FAKE_PI_FRAMES`` env var) and exits cleanly on ``exit``.
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
from typing import Any

_SCRIPT = r"""#!/usr/bin/env python3
import json, os, sys, time

frames = json.loads(os.environ.get("FAKE_PI_FRAMES", "[]"))
exit_after_prompt = os.environ.get("FAKE_PI_EXIT_AFTER") == "1"
delay_s = float(os.environ.get("FAKE_PI_DELAY_MS", "0")) / 1000.0

for line in sys.stdin:
    try:
        cmd = json.loads(line)
    except Exception:
        continue
    ctype = cmd.get("type")
    if cmd.get("id"):
        print(json.dumps({"id": cmd["id"], "type": "response",
                          "command": ctype, "success": True}), flush=True)
    if ctype == "prompt":
        if delay_s:
            time.sleep(delay_s)
        for frame in frames:
            print(json.dumps(frame), flush=True)
        if exit_after_prompt:
            break
    elif ctype == "exit":
        break
"""


def make_fake_pi(frames: list[dict[str, Any]], *, exit_after: bool = False,
                 delay_ms: int = 0) -> tuple[str, dict[str, str]]:
    """Write the fake binary; return (path, extra_env) for PiAdapter tests."""
    fd, path = tempfile.mkstemp(prefix="fake-pi-", suffix=".py")
    with os.fdopen(fd, "w") as f:
        f.write(_SCRIPT)
    os.chmod(path, stat.S_IRWXU)
    env = {"FAKE_PI_FRAMES": json.dumps(frames)}
    if exit_after:
        env["FAKE_PI_EXIT_AFTER"] = "1"
    if delay_ms:
        env["FAKE_PI_DELAY_MS"] = str(delay_ms)
    return path, env
