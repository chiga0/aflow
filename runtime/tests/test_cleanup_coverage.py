from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from runtime.cloud_agents_runtime.cleanup import (
    CleanupManager,
    CleanupPolicy,
    CleanupResult,
    directory_size,
    env_bool,
    env_nonnegative_int,
    is_relative_to,
    remove_workspace,
    terminal_created_at,
)
from runtime.cloud_agents_runtime.store import RunStore


class FakeEvent:
    def __init__(self, type_: str, created_at: str):
        self.type = type_
        self.created_at = created_at


class CleanupHelpersTest(unittest.TestCase):
    def test_env_bool_variants(self):
        for truthy in ("1", "true", "YES", "on"):
            with mock.patch.dict("os.environ", {"B": truthy}):
                self.assertTrue(env_bool("B", False))
        with mock.patch.dict("os.environ", {"B": "0"}):
            self.assertFalse(env_bool("B", True))
        with mock.patch.dict("os.environ", {"B": ""}):
            self.assertTrue(env_bool("B", True))
        self.assertFalse(env_bool("MISSING_XYZ", False))

    def test_env_nonnegative_int(self):
        with mock.patch.dict("os.environ", {"N": "5"}):
            self.assertEqual(env_nonnegative_int("N", 1), 5)
        with mock.patch.dict("os.environ", {"N": "abc"}):
            with self.assertRaises(ValueError):
                env_nonnegative_int("N", 1)
        with mock.patch.dict("os.environ", {"N": "-1"}):
            with self.assertRaises(ValueError):
                env_nonnegative_int("N", 1)
        self.assertEqual(env_nonnegative_int("MISSING_XYZ", 9), 9)

    def test_is_relative_to(self):
        self.assertTrue(is_relative_to(Path("/a/b/c"), Path("/a/b")))
        self.assertFalse(is_relative_to(Path("/x/y"), Path("/a/b")))

    def test_directory_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.txt").write_text("hello")
            (root / "sub").mkdir()
            (root / "sub" / "b.txt").write_text("world!")
            self.assertEqual(directory_size(root), 11)

    def test_terminal_created_at(self):
        now = datetime.now(timezone.utc).isoformat()
        events = [FakeEvent("run.started", now), FakeEvent("run.completed", now)]
        self.assertIsNotNone(terminal_created_at(events))
        self.assertIsNone(terminal_created_at([FakeEvent("run.started", now)]))
        self.assertIsNone(
            terminal_created_at([FakeEvent("run.completed", "not-a-date")])
        )

    def test_remove_workspace_plain_and_git_worktree_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            plain = Path(tmp) / "plain"
            plain.mkdir()
            (plain / "f.txt").write_text("x")
            remove_workspace(plain, {"strategy": "empty"})
            self.assertFalse(plain.exists())

            wt = Path(tmp) / "wt"
            wt.mkdir()
            (wt / "g.txt").write_text("y")
            # git worktree remove fails (not a real worktree) → falls back to rmtree
            remove_workspace(
                wt, {"strategy": "git_worktree", "source_path": tmp}
            )
            self.assertFalse(wt.exists())

    def test_policy_from_env_and_dicts(self):
        with mock.patch.dict(
            "os.environ",
            {
                "RUN_MANAGER_CLEANUP_ENABLED": "false",
                "RUN_MANAGER_CLEANUP_INTERVAL_SECONDS": "0",
            },
        ):
            policy = CleanupPolicy.from_env()
        self.assertFalse(policy.enabled)
        self.assertEqual(policy.interval_seconds, 1)
        self.assertIn("enabled", policy.to_dict())
        self.assertIn("workspaces_deleted", CleanupResult().to_dict())


class CleanupManagerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.store = RunStore(self.root)

    def tearDown(self):
        self.store.close()
        self._tmp.cleanup()

    def test_run_once_cleans_expired_isolated_workspace_and_artifacts(self):
        run = self.store.create_run(
            __import__(
                "runtime.cloud_agents_runtime.models", fromlist=["RunSpec"]
            ).RunSpec.from_payload({"prompt": "x", "adapter": "fake"})
        )
        ws = self.root / "workspaces" / run.run_id
        ws.mkdir(parents=True)
        (ws / "file.txt").write_text("data")
        run_dir = self.store.run_dir(run.run_id)
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "artifact.json").write_text("{}")
        self.store.append_event(
            run.run_id,
            "run.completed",
            {"workspace_allocation": {"isolated": True, "path": str(ws)}},
        )
        # backdate the terminal event so retention has elapsed
        old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
        self.store._db.execute(
            "update run_events set created_at=? where run_id=?",
            (old, run.run_id),
        )
        self.store._db.commit()
        spec_meta = {
            "workspace_allocation": {"isolated": True, "path": str(ws)}
        }
        self.store._db.execute(
            "update runs set spec_json=json_patch(spec_json, ?) where run_id=?",
            (
                '{"metadata":' + __import__("json").dumps(spec_meta) + "}",
                run.run_id,
            ),
        )
        self.store._db.commit()
        self.store._load_from_db()

        mgr = CleanupManager(
            self.store,
            CleanupPolicy(
                workspace_retention_seconds=1, artifact_retention_seconds=1
            ),
        )
        result = mgr.run_once()
        self.assertTrue(result.workspaces_deleted or result.artifacts_deleted)
        self.assertFalse(ws.exists())

    def test_run_once_skips_nonterminal_and_unisolated(self):
        run = self.store.create_run(
            __import__(
                "runtime.cloud_agents_runtime.models", fromlist=["RunSpec"]
            ).RunSpec.from_payload({"prompt": "y", "adapter": "fake"})
        )
        mgr = CleanupManager(self.store, CleanupPolicy())
        result = mgr.run_once()
        self.assertEqual(result.workspaces_deleted, [])
        self.assertEqual(result.artifacts_deleted, [])
        self.assertIsNotNone(run.run_id)


if __name__ == "__main__":
    unittest.main()
