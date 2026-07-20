from __future__ import annotations

import asyncio
import json
import sys
import types
import unittest
from unittest import mock

from runtime.cloud_agents_runtime import temporal_bridge, temporal_worker


class AsyncResponse:
    def __init__(self, payload: dict[str, str]):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class TemporalRuntimeTest(unittest.TestCase):
    def test_missing_sdk_reports_actionable_errors(self):
        with mock.patch.dict(sys.modules, {"temporalio": None}):
            with self.assertRaisesRegex(RuntimeError, "runtime dependency is missing"):
                asyncio.run(temporal_bridge.start_task_workflow("task_missing"))
            with self.assertRaisesRegex(RuntimeError, "required to run"):
                temporal_bridge.workflow_definition()
            with self.assertRaisesRegex(RuntimeError, "required to run"):
                asyncio.run(temporal_worker.run_worker())

    def test_settings_and_runtime_http_activity(self):
        with mock.patch.dict(
            "os.environ",
            {
                "TEMPORAL_ADDRESS": "temporal.example:7233",
                "TEMPORAL_NAMESPACE": "prod",
                "TEMPORAL_TASK_QUEUE": "aflow-v2",
                "V2_RUNTIME_INTERNAL_URL": "http://runtime.example/",
                "RUN_MANAGER_TOKEN": "internal-token",
            },
            clear=True,
        ):
            self.assertEqual(
                temporal_bridge.temporal_settings(),
                {
                    "address": "temporal.example:7233",
                    "namespace": "prod",
                    "task_queue": "aflow-v2",
                },
            )
            with mock.patch(
                "urllib.request.urlopen",
                return_value=AsyncResponse({"status": "completed"}),
            ) as urlopen:
                result = temporal_worker.execute_runtime_task({"task_id": "task_1"})

        self.assertEqual(result, {"task_id": "task_1", "status": "completed"})
        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "http://runtime.example/v2/internal/tasks/task_1/execute",
        )
        self.assertEqual(request.headers["Authorization"], "Bearer internal-token")

    def test_start_workflow_connects_and_dispatches(self):
        client = mock.Mock()
        client.start_workflow = mock.AsyncMock()
        client_type = mock.Mock()
        client_type.connect = mock.AsyncMock(return_value=client)
        client_module = types.ModuleType("temporalio.client")
        client_module.Client = client_type
        temporalio = types.ModuleType("temporalio")
        temporalio.client = client_module

        with mock.patch.dict(
            sys.modules,
            {"temporalio": temporalio, "temporalio.client": client_module},
        ):
            workflow_id = asyncio.run(temporal_bridge.start_task_workflow("task_2"))

        self.assertEqual(workflow_id, "agentflow-v2-task_2")
        client_type.connect.assert_awaited_once_with(
            "127.0.0.1:7233", namespace="default"
        )
        client.start_workflow.assert_awaited_once()

    def test_workflow_definition_executes_durable_activity(self):
        calls: list[tuple] = []

        class RetryPolicy:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        class WorkflowApi:
            def defn(self, **_kwargs):
                return lambda value: value

            def run(self, value):
                return value

            async def execute_activity(self, *args, **kwargs):
                calls.append((args, kwargs))
                return {"status": "completed"}

        temporalio = types.ModuleType("temporalio")
        temporalio.workflow = WorkflowApi()
        common = types.ModuleType("temporalio.common")
        common.RetryPolicy = RetryPolicy
        with mock.patch.dict(
            sys.modules,
            {"temporalio": temporalio, "temporalio.common": common},
        ):
            workflow_type = temporal_bridge.workflow_definition()
            result = asyncio.run(workflow_type().run({"task_id": "task_3"}))

        self.assertEqual(result, {"status": "completed"})
        self.assertEqual(calls[0][0][0], "agentflow.execute_v2_task")
        self.assertEqual(calls[0][1]["retry_policy"].kwargs["maximum_attempts"], 3)

    def test_worker_registers_workflow_and_activity(self):
        workers: list[object] = []

        class ActivityApi:
            def defn(self, **_kwargs):
                return lambda value: value

        class Client:
            @staticmethod
            async def connect(*_args, **_kwargs):
                return object()

        class Worker:
            def __init__(self, _client, **kwargs):
                self.kwargs = kwargs
                workers.append(self)

            async def run(self):
                result = await self.kwargs["activities"][0]({"task_id": "task_4"})
                self.result = result

        temporalio = types.ModuleType("temporalio")
        temporalio.activity = ActivityApi()
        client_module = types.ModuleType("temporalio.client")
        client_module.Client = Client
        worker_module = types.ModuleType("temporalio.worker")
        worker_module.Worker = Worker
        with mock.patch.dict(
            sys.modules,
            {
                "temporalio": temporalio,
                "temporalio.client": client_module,
                "temporalio.worker": worker_module,
            },
        ), mock.patch.object(
            temporal_worker, "workflow_definition", return_value=object()
        ), mock.patch.object(
            temporal_worker,
            "execute_runtime_task",
            return_value={"task_id": "task_4", "status": "completed"},
        ):
            asyncio.run(temporal_worker.run_worker())

        self.assertEqual(workers[0].kwargs["task_queue"], "agentflow-v2")
        self.assertEqual(workers[0].result["status"], "completed")

    def test_worker_main_runs_async_entrypoint(self):
        with mock.patch.object(
            temporal_worker, "run_worker", new=mock.AsyncMock()
        ) as run_worker:
            self.assertEqual(temporal_worker.main([]), 0)
        run_worker.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
