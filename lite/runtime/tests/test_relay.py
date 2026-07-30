import unittest

from lite.runtime.adapter import QwenAdapter
from lite.runtime.relay import collect_turn

from lite.runtime.tests.fake_qwen import FakeQwen


class CollectTurnTests(unittest.TestCase):
    def test_default_reply(self):
        fake = FakeQwen(reply="HELLO").start()
        try:
            adapter = QwenAdapter(base_url=fake.base_url)
            sid = adapter.create_session()
            adapter.send_prompt(sid, "hi")
            seen = []
            result = collect_turn(adapter, sid, on_event=lambda t, d: seen.append(t))
            self.assertTrue(result.ok)
            self.assertEqual(result.text, "HELLO")
            self.assertIn("message.delta", seen)
            self.assertIn("done", seen)
        finally:
            fake.stop()

    def test_tool_mapping(self):
        frames = [
            {"type": "session_update", "data": {"update": {
                "sessionUpdate": "tool_call",
                "content": {"id": "tc1", "name": "bash", "input": {"command": "ls"}}}}},
            {"type": "session_update", "data": {"update": {
                "sessionUpdate": "tool_output",
                "content": {"tool_use_id": "tc1", "name": "bash",
                            "content": "file1\nfile2", "is_error": False}}}},
            {"type": "session_update", "data": {"update": {
                "sessionUpdate": "agent_message_chunk", "content": {"text": "完成"}}}},
            {"type": "turn_complete", "data": {}},
        ]
        fake = FakeQwen(frames=frames).start()
        try:
            adapter = QwenAdapter(base_url=fake.base_url)
            sid = adapter.create_session()
            adapter.send_prompt(sid, "list")
            result = collect_turn(adapter, sid)
            self.assertTrue(result.ok)
            self.assertEqual(result.text, "完成")
            self.assertEqual(len(result.tools), 1)
            self.assertEqual(result.tools[0].name, "bash")
            self.assertIn("file1", str(result.tools[0].output))
            self.assertFalse(result.tools[0].is_error)
        finally:
            fake.stop()

    def test_turn_error(self):
        frames = [{"type": "turn_error", "data": {"message": "boom"}}]
        fake = FakeQwen(frames=frames).start()
        try:
            adapter = QwenAdapter(base_url=fake.base_url)
            sid = adapter.create_session()
            adapter.send_prompt(sid, "x")
            result = collect_turn(adapter, sid)
            self.assertFalse(result.ok)
            self.assertEqual(result.status, "failed")
        finally:
            fake.stop()

    def test_thought_not_in_text(self):
        frames = [
            {"type": "session_update", "data": {"update": {
                "sessionUpdate": "agent_thought_chunk", "content": {"text": "thinking..."}}}},
            {"type": "session_update", "data": {"update": {
                "sessionUpdate": "agent_message_chunk", "content": {"text": "answer"}}}},
            {"type": "turn_complete", "data": {}},
        ]
        fake = FakeQwen(frames=frames).start()
        try:
            adapter = QwenAdapter(base_url=fake.base_url)
            sid = adapter.create_session()
            adapter.send_prompt(sid, "q")
            result = collect_turn(adapter, sid)
            self.assertEqual(result.text, "answer")  # thought excluded from final text
        finally:
            fake.stop()


if __name__ == "__main__":
    unittest.main()
