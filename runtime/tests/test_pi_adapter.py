import unittest
from unittest import mock

from runtime.pi_adapter import PiAdapter, _map_pi_event
from runtime.relay import collect_turn
from runtime.tests.fake_pi import make_fake_pi

TEXT_DELTA = lambda t: {  # noqa: E731
    "type": "message_update",
    "assistantMessageEvent": {"type": "text_delta", "delta": t},
}
THINKING_DELTA = lambda t: {  # noqa: E731
    "type": "message_update",
    "assistantMessageEvent": {"type": "thinking_delta", "delta": t},
}
SETTLED = {"type": "agent_settled"}


def make_adapter(frames, **kwargs):
    path, extra_env = make_fake_pi(frames, **kwargs)
    env = {"PI_BIN": path, **extra_env}
    patcher = mock.patch.dict("os.environ", env)
    patcher.start()
    adapter = PiAdapter()
    return adapter, patcher


class PiAdapterTurnTests(unittest.TestCase):
    def test_full_turn_via_collect_turn(self):
        frames = [
            TEXT_DELTA("Hello "),
            {"type": "tool_execution_start", "toolCallId": "tc1",
             "toolName": "write", "args": {"path": "a.txt"}},
            {"type": "tool_execution_end", "toolCallId": "tc1", "toolName": "write",
             "result": {"content": [{"type": "text", "text": "written"}]},
             "isError": False},
            TEXT_DELTA("done"),
            SETTLED,
        ]
        adapter, patcher = make_adapter(frames)
        try:
            sid = adapter.create_session()
            adapter.send_prompt(sid, "hi")
            seen: list[str] = []
            result = collect_turn(adapter, sid, on_event=lambda t, d: seen.append(t))
            self.assertTrue(result.ok)
            self.assertEqual(result.text, "Hello done")
            self.assertEqual(len(result.tools), 1)
            self.assertEqual(result.tools[0].name, "write")
            self.assertEqual(result.tools[0].output, "written")
            self.assertFalse(result.tools[0].is_error)
            self.assertIn("message.delta", seen)
            self.assertIn("tool.start", seen)
            self.assertIn("done", seen)
        finally:
            adapter.shutdown()
            patcher.stop()

    def test_error_turn(self):
        frames = [
            {"type": "turn_end", "message": {
                "role": "assistant", "stopReason": "error",
                "errorMessage": "401 invalid key"}},
            SETTLED,
        ]
        adapter, patcher = make_adapter(frames)
        try:
            sid = adapter.create_session()
            adapter.send_prompt(sid, "hi")
            result = collect_turn(adapter, sid)
            self.assertEqual(result.status, "failed")
            self.assertIn("401", result.error or "")
        finally:
            adapter.shutdown()
            patcher.stop()

    def test_process_died_mid_turn(self):
        frames = [TEXT_DELTA("partial ")]  # no terminal event
        adapter, patcher = make_adapter(frames, exit_after=True)
        try:
            sid = adapter.create_session()
            adapter.send_prompt(sid, "hi")
            result = collect_turn(adapter, sid, timeout=10.0)
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.text, "partial ")
        finally:
            adapter.shutdown()
            patcher.stop()

    def test_summarize(self):
        frames = [TEXT_DELTA("部署优化"), SETTLED]
        adapter, patcher = make_adapter(frames)
        try:
            title = adapter.summarize("帮我把服务部署到 VPS 上并优化内存占用")
            self.assertEqual(title, "部署优化")
        finally:
            adapter.shutdown()
            patcher.stop()

    def test_health_with_missing_binary(self):
        with mock.patch.dict("os.environ", {"PI_BIN": "/nonexistent/pi-xyz"}):
            self.assertFalse(PiAdapter().health())


class PiEventMappingTests(unittest.TestCase):
    def test_thinking_maps_to_thought_chunk(self):
        payloads = _map_pi_event(THINKING_DELTA("hmm"))
        self.assertEqual(len(payloads), 1)
        update = payloads[0]["data"]["update"]
        self.assertEqual(update["sessionUpdate"], "agent_thought_chunk")
        self.assertEqual(update["content"]["text"], "hmm")

    def test_tool_update_flattens_partial_result(self):
        payloads = _map_pi_event({
            "type": "tool_execution_update", "toolCallId": "t",
            "toolName": "bash",
            "partialResult": {"content": [{"type": "text", "text": "out"}]},
        })
        update = payloads[0]["data"]["update"]
        self.assertEqual(update["sessionUpdate"], "tool_call_update")
        self.assertEqual(update["content"]["output"], "out")

    def test_unknown_events_map_to_nothing(self):
        for event in ({"type": "response", "success": True},
                      {"type": "agent_start"},
                      {"type": "message_update",
                       "assistantMessageEvent": {"type": "text_start"}}):
            self.assertEqual(_map_pi_event(event), [])

    def test_agent_settled_is_turn_complete(self):
        payloads = _map_pi_event(SETTLED)
        self.assertEqual(payloads[0]["type"], "turn_complete")


if __name__ == "__main__":
    unittest.main()
