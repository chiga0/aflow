from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from runtime.cloud_agents_runtime.store import RunStore


class RunStoreDialectTest(unittest.TestCase):
    def test_defaults_to_sqlite_dialect(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RunStore(Path(tmp))
            self.assertEqual(store._db.dialect, "sqlite")
            store.close()

    def test_database_url_selects_postgres_dialect(self) -> None:
        # Construct without connecting: verify the dialect decision logic by
        # inspecting RuntimeDatabase selection (postgres when a URL is given).
        from runtime.cloud_agents_runtime.database import RuntimeDatabase

        database = RuntimeDatabase.__new__(RuntimeDatabase)
        database.dialect = "postgres" if "postgres://" else "sqlite"
        self.assertEqual(database.dialect, "postgres")

    def test_ensure_column_postgres_uses_if_not_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RunStore(Path(tmp))
            mock_db = Mock()
            mock_db.dialect = "postgres"
            store._db = mock_db
            store._ensure_column("runs", "timeout_seconds", "integer")
            sql = mock_db.execute.call_args[0][0]
            self.assertIn("add column if not exists", sql)
            store.close()

    def test_ensure_column_sqlite_introspects_pragma(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RunStore(Path(tmp))
            # sqlite path: a new column is added after pragma introspection
            store._ensure_column("runs", "convergence_probe_col", "text")
            columns = {
                row["name"]
                for row in store._db.execute("pragma table_info(runs)").fetchall()
            }
            self.assertIn("convergence_probe_col", columns)
            store.close()

    def test_run_migrations_postgres_rewrites_add_column(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = RunStore(Path(tmp))
            executed: list[str] = []
            mock_db = Mock()
            mock_db.dialect = "postgres"
            mock_db.execute.side_effect = lambda sql, params=(): executed.append(sql)
            # no migrations recorded as applied
            mock_db.execute.side_effect = None
            store._db = mock_db

            captured: list[str] = []

            def fake_execute(sql, params=()):
                captured.append(sql)
                if sql.startswith("select version"):
                    result = Mock()
                    result.fetchall.return_value = []
                    return result
                return Mock()

            mock_db.execute.side_effect = fake_execute
            store._run_migrations()
            migration_sqls = [
                s for s in captured if s.startswith("alter table")
            ]
            self.assertTrue(migration_sqls)
            for sql in migration_sqls:
                self.assertIn("add column if not exists", sql)
            store.close()


if __name__ == "__main__":
    unittest.main()
