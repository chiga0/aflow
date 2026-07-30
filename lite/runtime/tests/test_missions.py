import tempfile
import time
import unittest

from lite.runtime.adapter import QwenAdapter
from lite.runtime.missions import (
    DEFAULT_SEQUENTIAL_STEPS,
    _compose_prompt,
    _cancelled,
    handle_post,
    run_mission,
)
from lite.runtime.models import new_id, utc_now
from lite.runtime.store import Store

from lite.runtime.tests.fake_qwen import FakeQwen


class FakeHandler:
    def __init__(self):
        self.json_calls = []
        self.error_calls = []
        self.headers = {}

    def json(self, data, status=200, headers=None):
        self.json_calls.append((status, data))

    def error(self, status, msg):
        self.error_calls.append((int(status), msg))


def _make_mission(store: Store, steps=2) -> str:
    now = utc_now()
    mid = new_id("ms")
    store.upsert_mission({
        "id": mid, "title": "t", "goal": "goal text", "strategy": "sequential",
        "status": "pending", "cwd": None, "created_at": now, "updated_at": now, "metadata": {},
    })
    for i in range(steps):
        store.add_mission_step({
            "id": new_id("st"), "mission_id": mid, "ord": i, "role": "worker", "title": f"s{i}",
            "prompt": "do it", "qwen_session_id": None, "status": "pending", "result_text": "",
            "error": None, "started_at": None, "completed_at": None,
            "created_at": now, "updated_at": now,
        })
    return mid


class RunMissionTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))
        self.fake = FakeQwen(reply="STEP_OUT").start()
        self.adapter = QwenAdapter(base_url=self.fake.base_url)

    def tearDown(self):
        _cancelled.clear()
        self.fake.stop()

    def test_sequential_completes_with_artifacts(self):
        mid = _make_mission(self.store, steps=3)
        run_mission(self.store, self.adapter, mid)
        m = self.store.get_mission(mid)
        self.assertEqual(m["status"], "completed")
        steps = self.store.list_mission_steps(mid)
        self.assertTrue(all(s["status"] == "completed" for s in steps))
        self.assertTrue(all(s["result_text"] == "STEP_OUT" for s in steps))
        self.assertTrue(all(s["qwen_session_id"] for s in steps))

    def test_cancel_flag_cancels_all_steps(self):
        mid = _make_mission(self.store, steps=3)
        _cancelled.add(mid)
        run_mission(self.store, self.adapter, mid)
        m = self.store.get_mission(mid)
        self.assertEqual(m["status"], "cancelled")
        self.assertTrue(all(s["status"] == "cancelled" for s in self.store.list_mission_steps(mid)))

    def test_failed_step_fails_mission(self):
        # Empty frames => collect_turn returns completed with empty text but ok;
        # to force a failure, point adapter at a dead URL for the run.
        mid = _make_mission(self.store, steps=2)
        bad = QwenAdapter(base_url="http://127.0.0.1:1")  # nothing listening
        with self.assertLogs("lite.runtime.missions", level="ERROR") as cm:
            run_mission(self.store, bad, mid)
        self.assertTrue(any("failed" in m for m in cm.output))
        self.assertEqual(self.store.get_mission(mid)["status"], "failed")


class ComposePromptTests(unittest.TestCase):
    def test_includes_goal_and_previous(self):
        out = _compose_prompt({"goal": "G"}, {"role": "coder", "title": "T", "prompt": "P"}, "PREV_RESULT")
        self.assertIn("G", out)
        self.assertIn("PREV_RESULT", out)
        self.assertIn("P", out)

    def test_reviewer_constraint(self):
        out = _compose_prompt({"goal": "G"}, {"role": "reviewer", "title": "R", "prompt": "P"}, "")
        self.assertIn("JSON", out)


class CreateRouteTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))
        self.fake = FakeQwen(reply="OK").start()
        self.adapter = QwenAdapter(base_url=self.fake.base_url)

    def tearDown(self):
        _cancelled.clear()
        self.fake.stop()

    def test_validation(self):
        h = FakeHandler()
        handle_post(h, "/api/missions", {"goal": ""}, b"", self.store, self.adapter, None)
        self.assertEqual(h.error_calls[-1][0], 400)
        h = FakeHandler()
        handle_post(h, "/api/missions", {"goal": "g", "strategy": "fanout"}, b"", self.store, self.adapter, None)
        self.assertEqual(h.error_calls[-1][0], 400)

    def test_create_runs_to_completion(self):
        h = FakeHandler()
        handle_post(
            h, "/api/missions",
            {"goal": "回复两个字：好了", "steps": [{"role": "worker", "title": "x", "prompt": "回复 ok"}]},
            b"", self.store, self.adapter, None,
        )
        self.assertEqual(h.json_calls[-1][0], 201)
        mid = h.json_calls[-1][1]["id"]
        # background runner should finish quickly against the fake
        for _ in range(40):
            if self.store.get_mission(mid)["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.1)
        self.assertEqual(self.store.get_mission(mid)["status"], "completed")

    def test_default_template_has_three_steps(self):
        self.assertEqual(len(DEFAULT_SEQUENTIAL_STEPS), 3)
        self.assertEqual([s["role"] for s in DEFAULT_SEQUENTIAL_STEPS], ["planner", "coder", "reviewer"])


if __name__ == "__main__":
    unittest.main()
