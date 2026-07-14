from __future__ import annotations

import time

from cloud_agents_runtime.v2_control_plane import V2ControlPlane


def wait_for_status(control: V2ControlPlane, task_id: str, status: str) -> dict:
    deadline = time.time() + 2
    while time.time() < deadline:
        task = control.get_task(task_id)
        if task["status"] == status:
            return task
        time.sleep(0.02)
    return control.get_task(task_id)


def test_create_task_builds_plan_events_and_result(tmp_path):
    control = V2ControlPlane(tmp_path)

    task = control.create_task(
        {"goal": "Draft a release checklist for the V2 product", "adapter": "fake"},
        principal="user_1",
        idempotency_key="task-key-1",
    )

    assert task["task_id"].startswith("task_")
    assert task["plan"]["strategy"] == "single-agent-fast-path"
    assert task["progress"]["total_steps"] == 1

    completed = wait_for_status(control, task["task_id"], "completed")

    assert completed["status"] == "completed"
    assert completed["result"]["evaluation"]["status"] == "passed"
    assert completed["progress"]["percent"] == 100
    assert [event["type"] for event in control.events(task["task_id"])][:2] == [
        "task.created",
        "plan.created",
    ]


def test_complex_task_uses_orchestrator_workers_plan(tmp_path):
    control = V2ControlPlane(tmp_path)
    goal = "Build a complete tenant-aware agent platform. " * 5

    task = control.create_task({"goal": goal, "mode": "auto"}, principal="user_1")

    assert task["plan"]["strategy"] == "orchestrator-workers"
    assert [agent["role"] for agent in task["plan"]["agent_tasks"]] == [
        "brain",
        "builder",
        "reviewer",
    ]


def test_idempotency_key_returns_existing_task(tmp_path):
    control = V2ControlPlane(tmp_path)

    first = control.create_task(
        {"goal": "Summarize the architecture"},
        principal="user_1",
        idempotency_key="same-key",
    )
    second = control.create_task(
        {"goal": "This should not create another task"},
        principal="user_1",
        idempotency_key="same-key",
    )

    assert second["task_id"] == first["task_id"]
    assert len(control.list_tasks()) == 1


def test_admin_overview_and_execution_unit_registration(tmp_path):
    control = V2ControlPlane(tmp_path)

    unit = control.register_execution_unit(
        {
            "unit_id": "docker-a",
            "kind": "docker",
            "labels": {"region": "local"},
            "adapters": ["fake", "qwen"],
            "features": ["artifacts", "events"],
        }
    )
    overview = control.admin_overview()

    assert unit["unit_id"] == "docker-a"
    assert any(item["platform"] == "feishu" for item in overview["channels"])
    assert overview["reliability"]["idempotency"] == "enabled"


def test_append_message_writes_canonical_event(tmp_path):
    control = V2ControlPlane(tmp_path)
    task = control.create_task({"goal": "Review logs"}, principal="user_1")

    event = control.append_message(
        task["task_id"],
        "Please include risk summary",
        principal="user_1",
    )

    assert event["type"] == "user.message"
    assert event["payload"]["message"] == "Please include risk summary"
