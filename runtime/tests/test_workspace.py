from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from runtime.cloud_agents_runtime.models import RunSpec
from runtime.cloud_agents_runtime.workspace import (
    WorkspaceAllocation,
    WorkspaceAllocator,
    apply_allocation,
    is_git_worktree,
    source_path_for,
)


def make_spec(**overrides) -> RunSpec:
    payload = {"prompt": "test", "adapter": "fake"}
    payload.update(overrides)
    return RunSpec.from_payload(payload)


class TestWorkspaceAllocation(unittest.TestCase):
    def test_to_dict(self):
        allocation = WorkspaceAllocation(
            run_id="run_1",
            strategy="empty",
            path="/tmp/ws",
        )
        result = allocation.to_dict()
        self.assertEqual(result["run_id"], "run_1")
        self.assertEqual(result["strategy"], "empty")
        self.assertEqual(result["path"], "/tmp/ws")
        self.assertTrue(result["isolated"])
        self.assertIsNone(result["source_path"])

    def test_to_dict_shared(self):
        allocation = WorkspaceAllocation(
            run_id="run_2",
            strategy="shared",
            path="/shared",
            isolated=False,
            source_path="/shared",
        )
        result = allocation.to_dict()
        self.assertFalse(result["isolated"])
        self.assertEqual(result["source_path"], "/shared")


class TestSourcePathFor(unittest.TestCase):
    def test_workspace_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = make_spec(workspace=tmp)
            result = source_path_for(spec)
            self.assertIsNotNone(result)
            self.assertEqual(result, Path(tmp).resolve())

    def test_local_repo_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = make_spec(repo=tmp)
            result = source_path_for(spec)
            self.assertIsNotNone(result)

    def test_remote_repo_returns_none(self):
        spec = make_spec(repo="https://github.com/example/repo.git")
        self.assertIsNone(source_path_for(spec))

    def test_no_workspace_or_repo(self):
        spec = make_spec()
        self.assertIsNone(source_path_for(spec))

    def test_nonexistent_repo_returns_none(self):
        spec = make_spec(repo="/nonexistent/path/xyz")
        self.assertIsNone(source_path_for(spec))


class TestIsGitWorktree(unittest.TestCase):
    def test_non_git_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(is_git_worktree(Path(tmp)))

    def test_nonexistent_directory(self):
        self.assertFalse(is_git_worktree(Path("/nonexistent/xyz")))


class TestWorkspaceAllocator(unittest.TestCase):
    def test_empty_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            allocator = WorkspaceAllocator(Path(tmp))
            spec = make_spec()
            allocation = allocator.prepare("run_empty", spec)
            self.assertEqual(allocation.strategy, "empty")
            self.assertTrue(Path(allocation.path).is_dir())
            self.assertTrue(allocation.isolated)
            self.assertEqual(spec.workspace, allocation.path)

    def test_directory_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"
            source.mkdir()
            (source / "file.txt").write_text("hello")
            (source / "__pycache__").mkdir()
            (source / "__pycache__" / "cache.pyc").write_text("x")

            allocator = WorkspaceAllocator(Path(tmp))
            spec = make_spec(workspace=str(source))
            allocation = allocator.prepare("run_copy", spec)
            self.assertEqual(allocation.strategy, "directory_copy")
            self.assertTrue(Path(allocation.path, "file.txt").exists())
            self.assertFalse(
                Path(allocation.path, "__pycache__").exists()
            )
            self.assertEqual(
                allocation.source_path, str(source.resolve())
            )

    def test_shared_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            allocator = WorkspaceAllocator(Path(tmp))
            spec = make_spec(
                workspace=tmp,
                sandbox={"workspace_strategy": "shared"},
            )
            allocation = allocator.prepare("run_shared", spec)
            self.assertEqual(allocation.strategy, "shared")
            self.assertFalse(allocation.isolated)
            self.assertEqual(
                allocation.path, str(Path(tmp).resolve())
            )

    def test_duplicate_workspace_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            allocator = WorkspaceAllocator(Path(tmp))
            spec = make_spec()
            allocator.prepare("run_dup", spec)
            with self.assertRaises(RuntimeError):
                allocator.prepare("run_dup", make_spec())

    def test_invalid_repo_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            allocator = WorkspaceAllocator(Path(tmp))
            spec = make_spec(repo="/nonexistent/repo/xyz")
            with self.assertRaises(ValueError):
                allocator.prepare("run_bad_repo", spec)


class TestApplyAllocation(unittest.TestCase):
    def test_updates_spec(self):
        spec = make_spec()
        allocation = WorkspaceAllocation(
            run_id="run_1",
            strategy="empty",
            path="/tmp/ws",
        )
        apply_allocation(spec, allocation)
        self.assertEqual(spec.workspace, "/tmp/ws")
        self.assertIn("workspace_allocation", spec.metadata)
        self.assertEqual(
            spec.metadata["workspace_allocation"]["strategy"],
            "empty",
        )


if __name__ == "__main__":
    unittest.main()
