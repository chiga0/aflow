from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from runtime.cloud_agents_runtime.models import RunSpec
from runtime.cloud_agents_runtime.store import RunStore


def make_store_with_run(test_case: unittest.TestCase) -> tuple[RunStore, str]:
    """Create a sqlite-backed store with one run already in the cache."""
    tmp = tempfile.TemporaryDirectory()
    test_case.addCleanup(tmp.cleanup)
    store = RunStore(Path(tmp.name))
    test_case.addCleanup(store.close)
    run = store.create_run(
        RunSpec.from_payload({"prompt": "x", "adapter": "fake"})
    )
    return store, run.run_id


def event_row(run_id: str, sequence: int, type_: str = "agent.message") -> dict:
    return {
        "run_id": run_id,
        "sequence": sequence,
        "event_id": f"e{sequence}",
        "type": type_,
        "data_json": "{}",
        "created_at": "2026-01-01T00:00:00+00:00",
    }


def run_row(run_id: str, status: str = "running") -> dict:
    return {
        "run_id": run_id,
        "spec_json": '{"prompt": "x", "adapter": "fake"}',
        "status": status,
        "adapter_run_id": None,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "event_count": 1,
        "prompt_count": 0,
    }


class PostgresEventPathTest(unittest.TestCase):
    def test_events_since_postgres_reads_from_db(self) -> None:
        store, run_id = make_store_with_run(self)
        mock_db = Mock()
        mock_db.dialect = "postgres"

        def fake_execute(sql, params=()):
            result = Mock()
            if "from run_events" in sql:
                result.fetchall.return_value = [event_row(run_id, 1)]
            else:
                result.fetchall.return_value = []
                result.fetchone.return_value = None
            return result

        mock_db.execute.side_effect = fake_execute
        store._db = mock_db
        events = store.events_since(run_id, 0)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].type, "agent.message")
        self.assertEqual(events[0].sequence, 1)

    def test_max_sequence_postgres_returns_db_max(self) -> None:
        store, run_id = make_store_with_run(self)
        mock_db = Mock()
        mock_db.dialect = "postgres"

        def fake_execute(sql, params=()):
            result = Mock()
            if "max(sequence)" in sql:
                result.fetchone.return_value = {"max_seq": 7}
            else:
                result.fetchone.return_value = None
            return result

        mock_db.execute.side_effect = fake_execute
        store._db = mock_db
        self.assertEqual(store.max_sequence(run_id), 7)

    def test_is_terminal_postgres_uses_db_status(self) -> None:
        store, run_id = make_store_with_run(self)
        # run cached as "completed" -> terminal without querying events
        store._runs[run_id].status = "completed"
        mock_db = Mock()
        mock_db.dialect = "postgres"
        mock_db.execute.return_value = Mock(fetchall=Mock(return_value=[]))
        store._db = mock_db
        self.assertTrue(store.is_terminal(run_id))

    def test_load_run_from_db_populates_cache(self) -> None:
        store, run_id = make_store_with_run(self)
        # drop from cache to force a DB load
        store._runs.pop(run_id)
        mock_db = Mock()
        mock_db.dialect = "postgres"
        mock_db.execute.return_value = Mock(
            fetchone=Mock(return_value=run_row(run_id, "running"))
        )
        store._db = mock_db
        loaded = store._load_run_from_db(run_id)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.run_id, run_id)
        self.assertIn(run_id, store._runs)

    def test_wait_for_events_postgres_returns_db_events(self) -> None:
        store, run_id = make_store_with_run(self)
        mock_db = Mock()
        mock_db.dialect = "postgres"

        def fake_execute(sql, params=()):
            result = Mock()
            if "from run_events" in sql:
                result.fetchall.return_value = [event_row(run_id, 2)]
            else:
                result.fetchall.return_value = []
                result.fetchone.return_value = None
            return result

        mock_db.execute.side_effect = fake_execute
        store._db = mock_db
        events = store.wait_for_events(run_id, 1, timeout=1.0)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].sequence, 2)

    def test_append_event_postgres_sequence_from_db(self) -> None:
        store, run_id = make_store_with_run(self)
        mock_db = Mock()
        mock_db.dialect = "postgres"
        mock_db.task_lock = Mock()

        def fake_execute(sql, params=()):
            result = Mock()
            if "max(sequence)" in sql:
                result.fetchone.return_value = {"max_seq": 41}
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            return result

        mock_db.execute.side_effect = fake_execute
        mock_db.commit = Mock()
        store._db = mock_db
        event = store.append_event(run_id, "agent.message", {"text": "hi"})
        # sequence derived from DB max (41) + 1, not the in-memory list length
        self.assertEqual(event.sequence, 42)
        mock_db.task_lock.assert_called_with(run_id)


if __name__ == "__main__":
    unittest.main()
