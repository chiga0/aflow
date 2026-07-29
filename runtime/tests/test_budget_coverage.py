from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from runtime.cloud_agents_runtime.budget import (
    BudgetConfig,
    CostManager,
    clamp,
    env_float,
    numeric_metadata,
)
from runtime.cloud_agents_runtime.models import RunSpec
from runtime.cloud_agents_runtime.store import RunStore


def spec(**metadata) -> RunSpec:
    payload = {"prompt": "cost probe", "adapter": "fake"}
    if metadata:
        payload["metadata"] = metadata
    return RunSpec.from_payload(payload)


class PureHelpersTest(unittest.TestCase):
    def test_clamp_bounds(self):
        self.assertEqual(clamp(1.5, 0.0, 1.0), 1.0)
        self.assertEqual(clamp(-0.5, 0.0, 1.0), 0.0)
        self.assertEqual(clamp(0.5, 0.0, 1.0), 0.5)

    def test_env_float_valid_invalid_negative(self):
        with mock.patch.dict("os.environ", {"X": "2.5"}):
            self.assertEqual(env_float("X", 0.0), 2.5)
        with mock.patch.dict("os.environ", {"X": "abc"}):
            self.assertEqual(env_float("X", 1.0), 1.0)
        with mock.patch.dict("os.environ", {"X": "-3"}):
            self.assertEqual(env_float("X", 0.0), 0.0)
        with mock.patch.dict("os.environ", {"X": ""}):
            self.assertEqual(env_float("X", 4.0), 4.0)
        self.assertEqual(env_float("MISSING_VAR_XYZ", 7.0), 7.0)

    def test_numeric_metadata_variants(self):
        self.assertIsNone(numeric_metadata(True))
        self.assertEqual(numeric_metadata(3), 3.0)
        self.assertEqual(numeric_metadata(2.5), 2.5)
        self.assertEqual(numeric_metadata("1.5"), 1.5)
        self.assertIsNone(numeric_metadata("nope"))
        self.assertIsNone(numeric_metadata(None))
        self.assertEqual(numeric_metadata(-2), 0.0)

    def test_budget_config_from_env_and_dict(self):
        with mock.patch.dict(
            "os.environ",
            {
                "RUN_MANAGER_COST_MONTHLY_BUDGET_USD": "100",
                "RUN_MANAGER_COST_PER_RUN_BUDGET_USD": "10",
                "RUN_MANAGER_COST_WARNING_RATIO": "2.0",
            },
        ):
            cfg = BudgetConfig.from_env()
        self.assertEqual(cfg.monthly_budget_usd, 100.0)
        self.assertEqual(cfg.per_run_budget_usd, 10.0)
        self.assertEqual(cfg.warning_ratio, 1.0)
        self.assertIn("monthly_budget_usd", cfg.to_dict())


class CostManagerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.store = RunStore(Path(self._tmp.name))

    def tearDown(self):
        self.store.close()
        self._tmp.cleanup()

    def test_quote_allowed_and_exceeded(self):
        mgr = CostManager(
            self.store,
            BudgetConfig(per_run_budget_usd=5.0, estimated_cost_per_run_usd=1.0),
        )
        quote = mgr.quote(spec())
        self.assertTrue(quote["allowed"])
        self.assertEqual(quote["estimated_cost_usd"], 1.0)
        over = mgr.quote(spec(estimated_cost_usd=99.0))
        self.assertFalse(over["allowed"])
        self.assertIn("per-run budget exceeded", over["reasons"])

    def test_quote_monthly_exceeded(self):
        mgr = CostManager(
            self.store,
            BudgetConfig(monthly_budget_usd=2.0, estimated_cost_per_run_usd=5.0),
        )
        quote = mgr.quote(spec())
        self.assertFalse(quote["allowed"])
        self.assertIn("monthly budget exceeded", quote["reasons"])

    def test_require_allowed_raises(self):
        mgr = CostManager(
            self.store, BudgetConfig(per_run_budget_usd=1.0)
        )
        with self.assertRaises(ValueError):
            mgr.require_allowed(spec(estimated_cost_usd=50.0))
        ok = mgr.require_allowed(spec(estimated_cost_usd=0.1))
        self.assertTrue(ok["allowed"])

    def test_estimate_spec_explicit_and_fallback(self):
        mgr = CostManager(
            self.store, BudgetConfig(estimated_cost_per_run_usd=3.0)
        )
        self.assertEqual(mgr.estimate_spec(spec(estimated_cost_usd=8.0)), 8.0)
        self.assertEqual(mgr.estimate_spec(spec()), 3.0)

    def test_status_unconfigured_ok_warn_over(self):
        unconfigured = CostManager(self.store, BudgetConfig()).status()
        self.assertEqual(unconfigured["status"], "unconfigured")
        self.assertIsNone(unconfigured["warning_threshold_usd"])

        ok_mgr = CostManager(self.store, BudgetConfig(monthly_budget_usd=100.0))
        self.assertEqual(ok_mgr.status()["status"], "ok")

        run = self.store.create_run(spec(estimated_cost_usd=9.0))
        warn_mgr = CostManager(
            self.store,
            BudgetConfig(monthly_budget_usd=10.0, warning_ratio=0.8),
        )
        self.assertEqual(warn_mgr.status()["status"], "warn")

        self.store.create_run(spec(estimated_cost_usd=9.0), run_id="run_over")
        over_mgr = CostManager(self.store, BudgetConfig(monthly_budget_usd=10.0))
        self.assertEqual(over_mgr.status()["status"], "over_budget")
        self.assertEqual(run.spec.adapter, "fake")

    def test_summary_and_run_cost_entry(self):
        self.store.create_run(spec(estimated_cost_usd=4.0))
        mgr = CostManager(
            self.store,
            BudgetConfig(
                monthly_budget_usd=50.0, estimated_cost_per_prompt_usd=0.5
            ),
        )
        summary = mgr.summary()
        self.assertEqual(summary["run_count"], 1)
        self.assertNotIn("runs", summary)
        run = self.store.list_runs()[0]
        entry = mgr.run_cost_entry(run)
        self.assertEqual(entry["run_id"], run.run_id)
        self.assertGreaterEqual(entry["estimated_cost_usd"], 4.0)


if __name__ == "__main__":
    unittest.main()
