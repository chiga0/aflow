#!/usr/bin/env python3
"""Multi-replica smoke test for the V1 RunStore on Postgres.

Validates the phase A1-A4 convergence work end to end against a real
Postgres: two RunStore instances share one database (simulating two
runtime replicas) and must observe each other's runs/events through the
DB rather than their private in-memory caches.

Requires RUNTIME_DATABASE_URL to be set (e.g.
postgres://postgres:aflow_test@127.0.0.1:5433/aflow).
"""
from __future__ import annotations

import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from runtime.cloud_agents_runtime.models import RunSpec
from runtime.cloud_agents_runtime.store import RunStore


def spec(goal: str) -> RunSpec:
    return RunSpec.from_payload({"prompt": goal, "adapter": "fake"})


def main() -> int:
    database_url = os.environ.get("RUNTIME_DATABASE_URL")
    if not database_url:
        raise SystemExit("RUNTIME_DATABASE_URL is required")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        # Two replicas: same Postgres, separate local artifact roots.
        first = RunStore(root / "first", database_url)
        second = RunStore(root / "second", database_url)
        if first._db.dialect != "postgres":
            raise RuntimeError("expected postgres dialect")

        # A4: a run created by replica 1 is readable by replica 2 (via DB).
        run = first.create_run(spec("verify shared postgres run state"))
        seen = second.get_run(run.run_id)
        if seen is None or seen.run_id != run.run_id:
            raise RuntimeError("second replica cannot read shared run")

        # A3/A4: concurrent appends from both replicas must not collide on
        # sequence (task_lock + DB max+1).
        def append_batch(store: RunStore, n: int) -> None:
            for i in range(n):
                store.append_event(run.run_id, "agent.message", {"i": i})

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda s: append_batch(s, 5), (first, second)))

        sequences = sorted(
            e.sequence for e in first.events_since(run.run_id, 0)
        )
        # 1 (run.created) + 10 agent.message events == sequences 1..11, unique.
        if sequences != list(range(1, 12)):
            raise RuntimeError(f"sequence collision or gap: {sequences}")

        # A4: replica 2 sees the same events through the DB.
        second_sequences = sorted(
            e.sequence for e in second.events_since(run.run_id, 0)
        )
        if second_sequences != sequences:
            raise RuntimeError("replicas disagree on event log")

        # A3: replica 2 waits for new events; replica 1 appends; replica 2
        # wakes via DB polling and observes the new event.
        observed: list[int] = []

        def waiter() -> None:
            events = second.wait_for_events(run.run_id, 11, timeout=5.0)
            observed.extend(e.sequence for e in events)

        thread = threading.Thread(target=waiter)
        thread.start()
        time.sleep(0.5)  # let the waiter start polling
        first.append_event(run.run_id, "run.completed", {})
        thread.join(timeout=6.0)
        if 12 not in observed:
            raise RuntimeError(f"cross-replica wait missed event: {observed}")

        # A4: terminal status is visible to replica 2 from the DB.
        if not second.is_terminal(run.run_id):
            raise RuntimeError("second replica did not observe terminal status")

        first.close()
        second.close()

    print("postgres v1 multi-replica RunStore smoke: passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
