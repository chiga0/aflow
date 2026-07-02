#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from typing import Any


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a qwen-backed Cloud Agents mission")
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--token", default=os.environ.get("RUN_MANAGER_TOKEN"))
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument(
        "--goal",
        default=(
            "Run a concise cloud-agents product smoke review. Inspect runtime health, "
            "summarize risks, and produce a final mission report."
        ),
    )
    args = parser.parse_args(argv)

    client = Client(args.base_url, args.token)
    health = client.get("/health")
    print(f"health: {health}")
    capabilities = client.get("/capabilities")
    adapters = capabilities.get("adapters", {})
    print(f"adapters: {sorted(adapters)}")
    if "qwen" not in adapters:
        print("qwen adapter is not available", file=sys.stderr)
        return 1

    mission = client.post(
        "/missions",
        {
            "goal": args.goal,
            "adapter": "qwen",
            "strategy": "sequential",
            "timeout_seconds": int(args.timeout),
        },
    )
    mission_id = mission["mission_id"]
    print(f"mission: {mission_id}")

    deadline = time.monotonic() + args.timeout
    state: dict[str, Any] = mission
    while time.monotonic() < deadline:
        state = client.get(f"/missions/{mission_id}")
        print(
            "state:",
            state.get("status"),
            f"{state.get('completed_task_count')}/{state.get('task_count')}",
        )
        if state.get("status") in {"completed", "failed", "cancelled", "blocked"}:
            break
        time.sleep(5)

    events = client.get(f"/missions/{mission_id}/events.json").get("events", [])
    names = [event.get("type") for event in events]
    print(f"mission events: {names}")
    artifacts = client.get(f"/missions/{mission_id}/artifacts").get("artifacts", [])
    artifact_names = {artifact.get("name") for artifact in artifacts}
    print(f"mission artifacts: {sorted(artifact_names)}")

    if state.get("status") != "completed":
        print(f"mission did not complete: {state.get('status')}", file=sys.stderr)
        return 1
    if "mission.completed" not in names:
        print("missing mission.completed event", file=sys.stderr)
        return 1
    if "final_report.md" not in artifact_names and "final-report.md" not in artifact_names:
        print("missing final report artifact", file=sys.stderr)
        return 1
    return 0


class Client:
    def __init__(self, base_url: str, token: str | None):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def get(self, path: str) -> dict[str, Any]:
        return self.request("GET", path)

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", path, payload)

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"content-type": "application/json"} if payload is not None else {}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            parsed = json.loads(response.read().decode("utf-8"))
            assert isinstance(parsed, dict)
            return parsed


if __name__ == "__main__":
    raise SystemExit(main())
