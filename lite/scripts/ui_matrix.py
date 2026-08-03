#!/usr/bin/env python3
"""Boot aflow-lite on a fake pi engine and capture the UI state matrix.

Usage: python3 scripts/ui_matrix.py [port]

Produces lite/web/e2e/screenshots/{mobile,desktop}-{1..5}-*.png covering:
welcome, streaming, completed (tool cards + code), error, session drawer.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LITE = HERE.parent
sys.path.insert(0, str(LITE.parent))

from lite.runtime.tests.fake_pi import make_fake_pi  # noqa: E402

FRAMES = [
    {"type": "message_update",
     "assistantMessageEvent": {"type": "thinking_delta", "delta": "分析项目结构…"}},
    {"type": "tool_execution_start", "toolCallId": "t1",
     "toolName": "bash", "args": {"command": "ls -la"}},
    {"type": "tool_execution_update", "toolCallId": "t1", "toolName": "bash",
     "partialResult": {"content": [{"type": "text", "text": "app.py"}]}},
    {"type": "tool_execution_end", "toolCallId": "t1", "toolName": "bash",
     "result": {"content": [{"type": "text", "text": "app.py\nREADME.md"}]},
     "isError": False},
    {"type": "message_update",
     "assistantMessageEvent": {"type": "text_delta",
                                "delta": "检查完成。示例代码：\n```python\nprint('hello aflow')\n```\n"}},
    {"type": "message_update",
     "assistantMessageEvent": {"type": "text_delta", "delta": "已完成，共 2 个文件。"}},
    {"type": "agent_settled"},
]


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8910
    fake_bin, fake_env = make_fake_pi(FRAMES, delay_ms=1200)
    db = tempfile.mktemp(suffix=".db")
    static_dir = LITE / "web" / "dist"
    if not static_dir.is_dir():
        print("web/dist missing — run `npm run build` in lite/web first", file=sys.stderr)
        return 2

    env = dict(
        os.environ,
        **fake_env,
        PI_BIN=fake_bin,
        AFLOW_ENGINE="pi",
        AFLOW_AUTH_DISABLED="1",
        AFLOW_STATIC_DIR=str(static_dir),
    )
    server = subprocess.Popen(
        [sys.executable, "-m", "lite.runtime",
         "--host", "127.0.0.1", "--port", str(port), "--db", db],
        env=env, cwd=str(LITE.parent),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(40):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
                    if r.status == 200:
                        break
            except Exception:
                time.sleep(0.25)
        else:
            print("server did not come up", file=sys.stderr)
            return 1

        result = subprocess.run(
            ["node", "e2e/ui_screenshots.mjs"],
            cwd=str(LITE / "web"),
            env=dict(os.environ, AFLOW_BASE=f"http://127.0.0.1:{port}"),
        )
        return result.returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        for p in (db,):
            try:
                os.remove(p)
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
