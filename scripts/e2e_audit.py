#!/usr/bin/env python3
"""End-to-end audit cases for aflow local Docker deployment.

Runs real tasks against the live runtime, audits events/artifacts/responses,
and reports pass/fail with full diagnostics. Designed to be run after every
deployment to verify the system is truly functional.

Usage:
    python3 scripts/e2e_audit.py [--timeout 60] [--base-url http://127.0.0.1:8765]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / ".env.local"
DEFAULT_URL = "http://127.0.0.1:8765"


@dataclass
class CaseResult:
    name: str
    passed: bool
    duration_s: float
    details: list[str] = field(default_factory=list)
    error: str = ""


def read_token(env_file: Path) -> str:
    for line in env_file.read_text().splitlines():
        if line.startswith("RUN_MANAGER_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"RUN_MANAGER_TOKEN not found in {env_file}")


def api(
    base_url: str,
    token: str,
    method: str,
    path: str,
    body: dict | None = None,
    timeout: int = 10,
) -> dict[str, Any]:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        base_url + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")
        return {"_http_error": exc.code, "_body": body_text}


def wait_for_task(
    base_url: str, token: str, task_id: str, timeout: int
) -> dict[str, Any]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = api(base_url, token, "GET", f"/v2/tasks/{task_id}")
        if task.get("status") in ("completed", "failed", "cancelled"):
            return task
        time.sleep(1)
    return api(base_url, token, "GET", f"/v2/tasks/{task_id}")


def get_events(base_url: str, token: str, task_id: str) -> list[dict]:
    resp = api(base_url, token, "GET", f"/v2/tasks/{task_id}/events.json")
    return resp.get("events", [])


def get_artifacts(base_url: str, token: str, task_id: str) -> list[dict]:
    resp = api(base_url, token, "GET", f"/v2/tasks/{task_id}/artifacts")
    return resp.get("artifacts", [])


# ─── Test Cases ───────────────────────────────────────────────────────────────


def case_simple_qa(base_url: str, token: str, timeout: int) -> CaseResult:
    """Single-agent Q&A: verify real AI response (not echo)."""
    name = "simple_qa_real_ai"
    start = time.time()
    details = []

    task = api(base_url, token, "POST", "/v2/tasks", {
        "goal": "用一句话回答：地球是圆的还是方的？只回答结论。",
        "mode": "single",
        "adapter": "qwen",
        "channel": "web",
    }, timeout=10)

    if "_http_error" in task:
        return CaseResult(
            name,
            False,
            time.time() - start,
            error=f"HTTP {task['_http_error']}: {task['_body'][:200]}",
        )

    task_id = task["task_id"]
    details.append(f"task_id={task_id}")

    final = wait_for_task(base_url, token, task_id, timeout)
    status = final.get("status")
    exec_mode = final.get("execution_mode", "")
    details.append(f"status={status}, execution_mode={exec_mode}")

    # Audit checks
    checks = []
    checks.append(("status=completed", status == "completed"))
    checks.append(("real-cli execution", "real-cli" in exec_mode))

    # Check agent messages for meaningful response (not echo)
    events = final.get("events", [])
    agent_msgs = [
        e["payload"].get("message", "")
        for e in events
        if e["type"] == "agent.message" and e.get("payload", {}).get("message")
    ]
    all_text = " ".join(agent_msgs).lower()
    details.append(f"agent_messages={agent_msgs[:3]}")

    # Response should mention 圆/round and NOT just echo the question
    has_answer = any(kw in all_text for kw in ["圆", "round", "球形", "sphere"])
    not_echo = "地球是圆的还是方的" not in all_text or len(all_text) > 50
    checks.append(("meaningful answer (not echo)", has_answer and not_echo))

    # Event timeline audit
    event_types = [e["type"] for e in events]
    has_lifecycle = (
        "task.created" in event_types
        and "plan.created" in event_types
        and "dispatch.selected" in event_types
    )
    checks.append(("event lifecycle present", has_lifecycle))

    for label, ok in checks:
        details.append(f"  {'✓' if ok else '✗'} {label}")

    passed = all(ok for _, ok in checks)
    return CaseResult(name, passed, time.time() - start, details)


def case_code_generation(base_url: str, token: str, timeout: int) -> CaseResult:
    """Code generation: verify qwen produces actual code."""
    name = "code_generation"
    start = time.time()
    details = []

    task = api(base_url, token, "POST", "/v2/tasks", {
        "goal": "写一个Python函数 is_palindrome(s: str) -> bool 判断回文串。只输出代码，不要解释。",
        "mode": "single",
        "adapter": "qwen",
        "channel": "web",
    }, timeout=10)

    if "_http_error" in task:
        return CaseResult(name, False, time.time() - start, error=f"HTTP {task['_http_error']}")

    task_id = task["task_id"]
    details.append(f"task_id={task_id}")

    final = wait_for_task(base_url, token, task_id, timeout)
    status = final.get("status")
    details.append(f"status={status}")

    events = final.get("events", [])
    agent_msgs = [
        e["payload"].get("message", "")
        for e in events
        if e["type"] == "agent.message" and e.get("payload", {}).get("message")
    ]
    all_text = " ".join(agent_msgs)
    details.append(f"response_length={len(all_text)}")

    checks = []
    checks.append(("status=completed", status == "completed"))
    checks.append(("contains function def", "def is_palindrome" in all_text or "def " in all_text))
    checks.append(("contains return/logic", "return" in all_text.lower()))

    for label, ok in checks:
        details.append(f"  {'✓' if ok else '✗'} {label}")

    passed = all(ok for _, ok in checks)
    return CaseResult(name, passed, time.time() - start, details)


def case_multi_agent(base_url: str, token: str, timeout: int) -> CaseResult:
    """Multi-agent orchestration: verify plan with multiple roles."""
    name = "multi_agent_orchestration"
    start = time.time()
    details = []

    task = api(base_url, token, "POST", "/v2/tasks", {
        "goal": "用3行文字描述一个TODO API的设计：端点、请求体、响应。",
        "mode": "multi-agent",
        "adapter": "qwen",
        "channel": "web",
    }, timeout=10)

    if "_http_error" in task:
        return CaseResult(name, False, time.time() - start, error=f"HTTP {task['_http_error']}")

    task_id = task["task_id"]
    details.append(f"task_id={task_id}")

    # Check plan structure immediately
    plan = task.get("plan", {})
    strategy = plan.get("strategy", "")
    agent_tasks = plan.get("agent_tasks", [])
    roles = [at.get("role", "") for at in agent_tasks]
    details.append(f"strategy={strategy}, roles={roles}")

    final = wait_for_task(base_url, token, task_id, timeout)
    status = final.get("status")
    details.append(f"final_status={status}")

    events = final.get("events", [])
    agent_actors = set(
        e.get("actor", "")
        for e in events
        if e["type"] == "agent.message"
    )
    details.append(f"agent_actors={sorted(agent_actors)}")

    # Check artifacts
    artifacts = get_artifacts(base_url, token, task_id)
    details.append(f"artifacts_count={len(artifacts)}")

    checks = []
    checks.append(("completed or running with progress", status in ("completed", "running")))
    checks.append(("orchestrator-workers strategy", strategy == "orchestrator-workers"))
    checks.append(("multiple roles planned", len(agent_tasks) >= 2))
    checks.append(("at least one actor produced output", len(agent_actors) >= 1))
    checks.append(("artifacts produced", len(artifacts) >= 1))

    for label, ok in checks:
        details.append(f"  {'✓' if ok else '✗'} {label}")

    passed = all(ok for _, ok in checks)
    return CaseResult(name, passed, time.time() - start, details)


def case_error_handling(base_url: str, token: str, timeout: int) -> CaseResult:
    """Error handling: invalid adapter should not crash the system."""
    name = "error_invalid_adapter"
    start = time.time()
    details = []

    task = api(base_url, token, "POST", "/v2/tasks", {
        "goal": "test error handling",
        "mode": "single",
        "adapter": "nonexistent_adapter_xyz",
        "channel": "web",
    }, timeout=10)

    # Should not return HTTP 500 (system crash)
    if "_http_error" in task:
        code = task["_http_error"]
        details.append(f"HTTP error {code}")
        # 4xx is acceptable (validation error), 5xx is not
        passed = code < 500
        details.append(f"  {'✓' if passed else '✗'} no server crash (HTTP {code})")
        return CaseResult(name, passed, time.time() - start, details)

    # Runtime may fall back to fake adapter (graceful degradation) — that's OK
    task_id = task.get("task_id", "")
    actual_adapter = task.get("adapter", "")
    details.append(f"task created, adapter fallback={actual_adapter}")

    if task_id:
        final = wait_for_task(base_url, token, task_id, min(timeout, 15))
        status = final.get("status")
        details.append(f"status={status}")
        # System didn't crash — task either completed (fallback) or failed gracefully
        passed = status in ("completed", "failed", "cancelled")
        details.append(f"  {'✓' if passed else '✗'} system stable (no crash)")
    else:
        passed = False
        details.append("  ✗ unexpected response")

    return CaseResult(name, passed, time.time() - start, details)


def case_health_and_capabilities(base_url: str, token: str, timeout: int) -> CaseResult:
    """Basic health and capabilities check."""
    name = "health_and_capabilities"
    start = time.time()
    details = []

    health = api(base_url, token, "GET", "/health")
    details.append(f"health={health}")

    caps = api(base_url, token, "GET", "/v2/capabilities")
    adapters = [a["adapter"] for a in caps.get("adapters", [])]
    details.append(f"adapters={adapters}")

    units = api(base_url, token, "GET", "/v2/admin/execution-units")
    unit_list = units.get("units", [])
    active_units = [u for u in unit_list if u.get("status") == "active"]
    details.append(f"active_units={len(active_units)}")

    checks = []
    checks.append(("health ok", health.get("ok") is True))
    checks.append(("qwen adapter registered", "qwen" in adapters))
    checks.append(("at least one active unit", len(active_units) >= 1))

    for label, ok in checks:
        details.append(f"  {'✓' if ok else '✗'} {label}")

    passed = all(ok for _, ok in checks)
    return CaseResult(name, passed, time.time() - start, details)


# ─── Runner ───────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="aflow E2E audit")
    parser.add_argument("--base-url", default=DEFAULT_URL)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--timeout", type=int, default=60, help="per-case timeout in seconds")
    args = parser.parse_args()

    token = read_token(args.env_file)
    base_url = args.base_url.rstrip("/")

    print(f"{'='*60}")
    print(f"aflow E2E Audit — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Target: {base_url}")
    print(f"{'='*60}\n")

    cases = [
        case_health_and_capabilities,
        case_simple_qa,
        case_code_generation,
        case_multi_agent,
        case_error_handling,
    ]

    results: list[CaseResult] = []
    for case_fn in cases:
        print(f"▶ {case_fn.__name__}...")
        try:
            result = case_fn(base_url, token, args.timeout)
        except Exception as exc:
            result = CaseResult(case_fn.__name__, False, 0, error=str(exc))
        results.append(result)
        status_icon = "✅" if result.passed else "❌"
        print(f"  {status_icon} {result.name} ({result.duration_s:.1f}s)")
        for line in result.details:
            print(f"    {line}")
        if result.error:
            print(f"    ERROR: {result.error}")
        print()

    # Summary
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print(f"{'='*60}")
    print(f"RESULT: {passed}/{total} cases passed")
    if passed < total:
        failed = [r.name for r in results if not r.passed]
        print(f"FAILED: {', '.join(failed)}")
    print(f"{'='*60}")

    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
