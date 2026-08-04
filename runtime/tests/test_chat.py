import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

from runtime import routes_extra
from runtime.auth import AuthConfig, hash_password
from runtime.chat import ChatHub
from runtime.pi_adapter import PiAdapter
from runtime.server import make_handler
from runtime.store import Store
from runtime.tests.fake_pi import make_fake_pi

FRAMES = [
    {"type": "message_update",
     "assistantMessageEvent": {"type": "text_delta", "delta": "你好，"}},
    {"type": "tool_execution_start", "toolCallId": "t1",
     "toolName": "bash", "args": {"command": "ls"}},
    {"type": "tool_execution_end", "toolCallId": "t1", "toolName": "bash",
     "result": {"content": [{"type": "text", "text": "a.txt"}]}, "isError": False},
    {"type": "message_update",
     "assistantMessageEvent": {"type": "text_delta", "delta": "已完成。"}},
    {"type": "agent_settled"},
]


def _wait(fn, timeout=10.0, interval=0.05):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if fn():
            return True
        time.sleep(interval)
    return False


def make_pi_adapter(frames, delay_ms: int = 0):
    path, extra_env = make_fake_pi(frames, delay_ms=delay_ms)
    patcher = mock.patch.dict("os.environ", {"PI_BIN": path, **extra_env})
    patcher.start()
    return PiAdapter(), patcher


class ChatHubTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))
        self.adapter, self.patcher = make_pi_adapter(FRAMES)
        self.hub = ChatHub(self.adapter, self.store)

    def tearDown(self):
        self.adapter.shutdown()
        self.patcher.stop()

    def test_full_turn_persists_messages_and_title(self):
        session = self.hub.create_session()
        chat_id = session["id"]
        self.hub.send_message(chat_id, "帮我看看目录里有什么文件")

        done = _wait(lambda: not self.hub._get_state(chat_id).running)
        self.assertTrue(done, "turn did not finish in time")

        detail = self.hub.session_detail(chat_id)
        self.assertIsNotNone(detail)
        roles = [m["role"] for m in detail["messages"]]
        self.assertEqual(roles, ["user", "assistant"])
        assistant = detail["messages"][1]
        self.assertEqual(assistant["content"], "你好，已完成。")
        self.assertEqual(assistant["status"], "completed")
        self.assertEqual(len(assistant["tools"]), 1)
        self.assertEqual(assistant["tools"][0]["name"], "bash")
        self.assertEqual(assistant["tools"][0]["output"], "a.txt")
        self.assertTrue(detail["title"], "title should be set from the prompt")

    def test_replay_buffer_cleared_after_turn(self):
        """Late subscribers must not re-stream a finished turn as live.

        (Previously buffered events replayed on every reconnect and the
        persisted reply rendered twice until the reconcile refetch.)
        """
        session = self.hub.create_session()
        chat_id = session["id"]
        self.hub.send_message(chat_id, "hi")
        self.assertTrue(_wait(lambda: not self.hub._get_state(chat_id).running))
        state = self.hub._get_state(chat_id)
        self.assertEqual(len(state.buffer), 0)

    def test_message_queue_while_running(self):
        slow_adapter, slow_patcher = make_pi_adapter(FRAMES, delay_ms=500)
        try:
            hub = ChatHub(slow_adapter, self.store)
            session = hub.create_session()
            chat_id = session["id"]
            hub.send_message(chat_id, "first")
            self.assertTrue(_wait(lambda: hub._get_state(chat_id).running))
            # second message queues instead of 409
            res = hub.send_message(chat_id, "second")
            self.assertTrue(res.get("queued"))
            _wait(lambda: not hub._get_state(chat_id).running, timeout=15)
            detail = hub.session_detail(chat_id)
            users = [m for m in detail["messages"] if m["role"] == "user"]
            self.assertEqual(len(users), 2)
        finally:
            slow_adapter.shutdown()
            slow_patcher.stop()

    def test_approval_flow(self):
        session = self.hub.create_session()
        chat_id = session["id"]
        stream = self.hub.subscribe(chat_id)
        self.hub.send_message(chat_id, "DANGEROUS rm -rf /tmp/x")

        request_id = None
        for item in stream:
            if item is None:
                break
            _seq, etype, data = item
            if etype == "permission.request":
                request_id = data["request_id"]
                break
        self.assertIsNotNone(request_id, "approval card event missing")

        self.assertTrue(self.hub.respond_approval(chat_id, request_id, True))

        seen = []
        for item in stream:
            if item is None:
                break
            _seq, etype, data = item
            seen.append(etype)
            if etype == "turn.finished":
                break
        self.assertIn("permission.resolved", seen)
        self.assertIn("turn.finished", seen)

    def test_images_persist_metadata_and_validate(self):
        session = self.hub.create_session()
        chat_id = session["id"]
        tiny = "QUJD"  # "ABC"
        huge = "A" * (5 * 1024 * 1024)
        self.hub.send_message(
            chat_id, "看图",
            images=[
                {"data": tiny, "mimeType": "image/png"},
                {"data": huge, "mimeType": "image/png"},   # dropped: too big
                {"data": tiny, "mimeType": "text/plain"},  # dropped: not image
            ],
        )
        done = _wait(lambda: not self.hub._get_state(chat_id).running)
        self.assertTrue(done)
        detail = self.hub.session_detail(chat_id)
        user = detail["messages"][0]
        self.assertEqual(len(user["images"]), 1)
        self.assertEqual(user["images"][0]["mimeType"], "image/png")

    def test_delete_session(self):
        session = self.hub.create_session()
        chat_id = session["id"]
        self.assertTrue(self.hub.delete_session(chat_id))
        self.assertIsNone(self.hub.session_detail(chat_id))
        self.assertFalse(self.hub.delete_session(chat_id))


class ChatHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = Store(tempfile.mktemp(suffix=".db"))
        cls.adapter, cls.patcher = make_pi_adapter(FRAMES)
        cfg = AuthConfig(
            enabled=True, email="a@b.c",
            password_hash=hash_password("secret"), api_token="tok",
        )
        routes_extra._hub_instance = None  # fresh hub for this server
        handler = make_handler(cls.store, cls.adapter, cfg)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.srv.server_address[1]
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.adapter.shutdown()
        cls.patcher.stop()
        routes_extra._hub_instance = None

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer tok"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}

    def test_chat_flow_over_http(self):
        session = self._req("POST", "/api/chat/sessions")
        chat_id = session["id"]

        resp = self._req("POST", f"/api/chat/sessions/{chat_id}/messages",
                         {"text": "列出文件"})
        self.assertTrue(resp["running"])

        # SSE stream (replays the whole turn since Last-Event-ID is unset).
        req = urllib.request.Request(
            self.base + f"/api/chat/sessions/{chat_id}/events",
            headers={"Authorization": "Bearer tok", "Accept": "text/event-stream"},
        )
        types = []
        with urllib.request.urlopen(req, timeout=15) as sse:
            buffer = b""
            while True:
                chunk = sse.read(1)
                if not chunk:
                    break
                buffer += chunk
                while b"\n\n" in buffer:
                    frame, buffer = buffer.split(b"\n\n", 1)
                    for line in frame.split(b"\n"):
                        if line.startswith(b"data: "):
                            ev = json.loads(line[6:])
                            types.append(ev["type"])
                if "turn.finished" in types:
                    break
        self.assertIn("message.delta", types)
        self.assertIn("tool.start", types)
        self.assertIn("turn.finished", types)

        detail = self._req("GET", f"/api/chat/sessions/{chat_id}")
        self.assertEqual([m["role"] for m in detail["messages"]], ["user", "assistant"])

        listing = self._req("GET", "/api/chat/sessions")
        self.assertTrue(any(s["id"] == chat_id for s in listing["sessions"]))

        deleted = self._req("DELETE", f"/api/chat/sessions/{chat_id}")
        self.assertTrue(deleted["ok"])

    def test_unauthenticated_chat_is_rejected(self):
        req = urllib.request.Request(self.base + "/api/chat/sessions")
        try:
            urllib.request.urlopen(req, timeout=5)
            self.fail("expected 401")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 401)


if __name__ == "__main__":
    unittest.main()
