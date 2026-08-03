#!/usr/bin/env python3
"""POC: drive pi --mode rpc against the Bailian token-plan endpoint.

Validates two things for the aflow-lite "replace qwen-code" evaluation:
  1. Protocol: pi RPC JSONL (prompt -> streamed events, tool calls) works
     against an OpenAI-compatible custom provider configured via models.json.
  2. Memory: samples the pi subprocess RSS during a real turn so we can
     compare against qwen serve on the 1.6GB VPS.

Usage:
  QWENCLOUD_TOKEN_PLAN_API_KEY=sk-... python3 scripts/pi_rpc_poc.py
  QWENCLOUD_TOKEN_PLAN_API_KEY=sk-... python3 scripts/pi_rpc_poc.py --model qwen3.6-flash

Run this same script on the VPS to measure memory there.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"

# pi reads provider/model catalog from <PI_CODING_AGENT_DIR>/models.json.
# apiKey "$VAR" references are resolved from the environment at request time.
MODELS_JSON = """
{
  "providers": {
    "bailian-token-plan": {
      "baseUrl": "%(base_url)s",
      "api": "openai-completions",
      "apiKey": "$QWENCLOUD_TOKEN_PLAN_API_KEY",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen3.8-max",
          "name": "qwen3.8-max",
          "reasoning": true,
          "contextWindow": 1000000,
          "maxTokens": 32768
        },
        {
          "id": "qwen3.6-flash",
          "name": "qwen3.6-flash",
          "reasoning": false,
          "contextWindow": 1000000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
"""

PROMPT = (
    "Use your tools: create a file named poc-hello.txt containing the text "
    "'hello from pi rpc poc', then read it back and confirm the content. "
    "Keep the answer short."
)


def rss_mb(pid: int) -> float | None:
    """Resident set size of a process in MB (macOS + Linux)."""
    try:
        out = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True, text=True, timeout=5,
        )
        return int(out.stdout.strip()) / 1024.0
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", default="qwen3.8-max")
    ap.add_argument("--prompt", default=PROMPT)
    ap.add_argument("--timeout", type=float, default=180.0)
    args = ap.parse_args()

    if not os.environ.get("QWENCLOUD_TOKEN_PLAN_API_KEY"):
        print("ERROR: set QWENCLOUD_TOKEN_PLAN_API_KEY", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="pi-poc-") as cfg_dir:
        with open(os.path.join(cfg_dir, "models.json"), "w") as f:
            f.write(MODELS_JSON % {"base_url": BASE_URL})

        env = dict(os.environ, PI_CODING_AGENT_DIR=cfg_dir)
        cmd = [
            "pi", "--mode", "rpc", "--no-session",
            "--provider", "bailian-token-plan", "--model", args.model,
        ]
        print(f"$ {' '.join(cmd)}  (PI_CODING_AGENT_DIR={cfg_dir})")
        t0 = time.time()
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, env=env,
        )

        peak_rss = 0.0
        samples = 0
        stats = {"text_delta": 0, "tool_execution": 0, "events": 0, "chars": 0}
        done = False
        deadline = time.time() + args.timeout
        first_token_at = None

        req = {"id": "poc-1", "type": "prompt", "message": args.prompt}
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()

        while not done and time.time() < deadline:
            mb = rss_mb(proc.pid)
            if mb:
                peak_rss = max(peak_rss, mb)
                samples += 1
            line = proc.stdout.readline()
            if not line:
                break
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = ev.get("type")
            stats["events"] += 1
            if etype == "message_update":
                aev = ev.get("assistantMessageEvent", {})
                if aev.get("type") == "text_delta":
                    stats["text_delta"] += 1
                    stats["chars"] += len(aev.get("delta", ""))
                    if first_token_at is None:
                        first_token_at = time.time() - t0
                    sys.stdout.write(aev.get("delta", ""))
                    sys.stdout.flush()
            elif etype == "tool_execution_start":
                stats["tool_execution"] += 1
                print(f"\n[tool] {ev.get('toolName')}", flush=True)
            elif etype == "agent_end":
                done = True
            elif etype == "response" and not ev.get("success"):
                print(f"\nERROR response: {ev}", file=sys.stderr)
                done = True

        proc.stdin.write(json.dumps({"type": "exit"}) + "\n")
        try:
            proc.stdin.flush()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

        print("\n\n── POC summary ──────────────────────────")
        print(f"model            : {args.model}")
        print(f"completed        : {done}")
        print(f"wall time        : {time.time() - t0:.1f}s")
        if first_token_at is not None:
            print(f"first token      : {first_token_at:.1f}s")
        print(f"events           : {stats['events']} "
              f"(text_delta={stats['text_delta']}, chars={stats['chars']}, "
              f"tool_calls={stats['tool_execution']})")
        print(f"peak RSS         : {peak_rss:.0f} MB ({samples} samples)")
        err = proc.stderr.read()
        if err.strip():
            print(f"stderr tail      : {err.strip()[-400:]}")
        return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
