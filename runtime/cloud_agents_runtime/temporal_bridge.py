from __future__ import annotations

import os
from datetime import timedelta
from typing import Any


def temporal_settings() -> dict[str, str]:
    return {
        "address": os.environ.get("TEMPORAL_ADDRESS") or "127.0.0.1:7233",
        "namespace": os.environ.get("TEMPORAL_NAMESPACE") or "default",
        "task_queue": os.environ.get("TEMPORAL_TASK_QUEUE") or "agentflow-v2",
    }


async def start_task_workflow(task_id: str) -> str:
    try:
        from temporalio.client import Client
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Temporal is configured but the temporalio runtime dependency is missing"
        ) from exc

    settings = temporal_settings()
    client = await Client.connect(
        settings["address"],
        namespace=settings["namespace"],
    )
    workflow_id = f"agentflow-v2-{task_id}"
    await client.start_workflow(
        "AgentFlowV2TaskWorkflow",
        {"task_id": task_id},
        id=workflow_id,
        task_queue=settings["task_queue"],
    )
    return workflow_id


def workflow_definition() -> Any:
    try:
        from temporalio import workflow
        from temporalio.common import RetryPolicy
    except ModuleNotFoundError as exc:
        raise RuntimeError("temporalio is required to run the Temporal worker") from exc

    @workflow.defn(name="AgentFlowV2TaskWorkflow")
    class AgentFlowV2TaskWorkflow:
        @workflow.run
        async def run(self, payload: dict[str, str]) -> dict[str, str]:
            return await workflow.execute_activity(
                "agentflow.execute_v2_task",
                payload,
                start_to_close_timeout=timedelta(hours=12),
                heartbeat_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=2),
                    backoff_coefficient=2,
                    maximum_interval=timedelta(minutes=1),
                    maximum_attempts=3,
                ),
            )

    return AgentFlowV2TaskWorkflow
