import tempfile
import unittest

from lite.runtime.models import new_id, utc_now
from lite.runtime.store import Store


class AuthSessionTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))

    def test_create_get_delete(self):
        self.store.create_auth_session("s1", "a@b.c", "2099-01-01T00:00:00.000+00:00")
        row = self.store.get_auth_session("s1")
        self.assertEqual(row["email"], "a@b.c")
        self.store.delete_auth_session("s1")
        self.assertIsNone(self.store.get_auth_session("s1"))

    def test_expired_session_purged_on_read(self):
        self.store.create_auth_session("s2", "a@b.c", "2000-01-01T00:00:00.000+00:00")
        self.assertIsNone(self.store.get_auth_session("s2"))

    def test_purge_expired(self):
        self.store.create_auth_session("old", "a@b.c", "2000-01-01T00:00:00.000+00:00")
        self.store.create_auth_session("new", "a@b.c", "2099-01-01T00:00:00.000+00:00")
        removed = self.store.purge_expired_auth_sessions()
        self.assertEqual(removed, 1)
        self.assertIsNotNone(self.store.get_auth_session("new"))


class MissionTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))

    def test_mission_and_steps(self):
        now = utc_now()
        mid = new_id("ms")
        self.store.upsert_mission({
            "id": mid, "title": "t", "goal": "g", "strategy": "sequential",
            "status": "pending", "cwd": None, "created_at": now, "updated_at": now, "metadata": {},
        })
        for i in range(2):
            self.store.add_mission_step({
                "id": new_id("st"), "mission_id": mid, "ord": i, "role": "r", "title": "t",
                "prompt": "p", "qwen_session_id": None, "status": "pending", "result_text": "",
                "error": None, "started_at": None, "completed_at": None,
                "created_at": now, "updated_at": now,
            })
        steps = self.store.list_mission_steps(mid)
        self.assertEqual(len(steps), 2)
        self.store.update_mission_step(steps[0]["id"], status="completed", result_text="done")
        self.assertEqual(self.store.list_mission_steps(mid)[0]["result_text"], "done")
        self.assertEqual(self.store.get_mission(mid)["status"], "pending")
        self.assertEqual(len(self.store.list_missions()), 1)

    def test_upsert_idempotent(self):
        now = utc_now()
        payload = {
            "id": "m1", "title": "t", "goal": "g", "strategy": "sequential",
            "status": "running", "cwd": None, "created_at": now, "updated_at": now, "metadata": {},
        }
        self.store.upsert_mission(payload)
        payload["status"] = "completed"
        self.store.upsert_mission(payload)
        self.assertEqual(self.store.get_mission("m1")["status"], "completed")
        self.assertEqual(len(self.store.list_missions()), 1)


class ChannelTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))

    def test_crud(self):
        now = utc_now()
        self.store.upsert_channel({
            "id": "c1", "type": "webhook", "name": "n", "webhook_url": "",
            "secret": "sekret", "reply_url": "http://x", "enabled": True,
            "created_at": now, "updated_at": now, "metadata": {},
        })
        ch = self.store.get_channel("c1")
        self.assertEqual(ch["secret"], "sekret")
        self.assertTrue(ch["enabled"])
        self.assertEqual(len(self.store.list_channels()), 1)
        self.assertTrue(self.store.delete_channel("c1"))
        self.assertFalse(self.store.delete_channel("c1"))


if __name__ == "__main__":
    unittest.main()
