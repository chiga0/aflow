from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.request
from typing import Any

from .temporal_bridge import temporal_settings, workflow_definition


def execute_runtime_task(payload: dict[str, str]) -> dict[str, str]:
    task_id = str(payload["task_id"])
    base_url = (os.environ.get("V2_RUNTIME_INTERNAL_URL") or "http://runtime:8765").rstrip(
        "/"
    )
    token = os.environ.get("RUN_MANAGER_TOKEN") or ""
    body = json.dumps({}).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/v2/internal/tasks/{task_id}/execute",
        data=body,
        method="POST",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=12 * 60 * 60) as response:
        result = json.loads(response.read().decode("utf-8"))
    return {"task_id": task_id, "status": str(result.get("status") or "completed")}


async def run_worker() -> None:
    try:
        from temporalio import activity
        from temporalio.client import Client
        from temporalio.worker import Worker
    except ModuleNotFoundError as exc:
        raise RuntimeError("temporalio is required to run the Temporal worker") from exc

    settings = temporal_settings()
    client = await Client.connect(
        settings["address"], namespace=settings["namespace"]
    )

    @activity.defn(name="agentflow.execute_v2_task")
    async def execute_v2_task(payload: dict[str, str]) -> dict[str, str]:
        return await asyncio.to_thread(execute_runtime_task, payload)

    worker = Worker(
        client,
        task_queue=settings["task_queue"],
        workflows=[workflow_definition()],
        activities=[execute_v2_task],
    )
    await worker.run()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AgentFlow V2 Temporal worker")
    parser.parse_args(argv)
    asyncio.run(run_worker())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
