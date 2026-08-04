import base64
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from runtime import push
from runtime.store import Store


def _wait(fn, timeout=5.0, interval=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if fn():
            return True
        time.sleep(interval)
    return False


class P256Tests(unittest.TestCase):
    def test_generator_on_curve(self):
        self.assertTrue(push._on_curve(push._GX, push._GY))

    def test_sign_verify_roundtrip(self):
        priv = int.from_bytes(b"\x01" * 32, "big") % push._N
        pub = push._point_mul(priv, (push._GX, push._GY))
        sig = push.ecdsa_sign(priv, b"hello vapid")
        self.assertEqual(len(sig), 64)
        self.assertTrue(push.ecdsa_verify(pub, b"hello vapid", sig))

    def test_verify_rejects_tampered(self):
        priv = int.from_bytes(b"\x02" * 32, "big") % push._N
        pub = push._point_mul(priv, (push._GX, push._GY))
        sig = push.ecdsa_sign(priv, b"payload")
        bad = bytes([sig[0] ^ 1]) + sig[1:]
        self.assertFalse(push.ecdsa_verify(pub, b"payload", bad))
        self.assertFalse(push.ecdsa_verify(pub, b"other", sig))

    def test_sign_is_deterministic_rfc6979(self):
        priv = 12345678901234567890
        a = push.ecdsa_sign(priv, b"same")
        b = push.ecdsa_sign(priv, b"same")
        self.assertEqual(a, b)
        self.assertNotEqual(a, push.ecdsa_sign(priv, b"diff"))


class VapidKeyTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.key = push.VapidKey(self.dir)

    def test_public_key_uncompressed(self):
        self.assertEqual(len(self.key.pub_raw), 65)
        self.assertEqual(self.key.pub_raw[0], 4)

    def test_key_persists_across_instances(self):
        again = push.VapidKey(self.dir)
        self.assertEqual(again.priv, self.key.priv)

    def test_jwt_verifies_and_aud_matches(self):
        endpoint = "https://push.example.org/some/sub"
        header = self.key.auth_header(endpoint, "mailto:t@example.org")
        self.assertTrue(header.startswith("vapid t="))
        token = header.split("t=")[1].split(",")[0]
        h, c, s = token.split(".")
        pad = lambda x: x + "=" * (-len(x) % 4)
        claims = json.loads(base64.urlsafe_b64decode(pad(c)))
        self.assertEqual(claims["aud"], "https://push.example.org")
        self.assertEqual(claims["sub"], "mailto:t@example.org")
        sig = base64.urlsafe_b64decode(pad(s))
        signing_input = f"{h}.{c}".encode()
        self.assertTrue(push.ecdsa_verify(self.key.pub, signing_input, sig))


class _PushSink(BaseHTTPRequestHandler):
    status_code = 201
    seen = []

    def do_POST(self):
        _PushSink.seen.append({
            "path": self.path,
            "auth": self.headers.get("Authorization", ""),
            "ttl": self.headers.get("TTL", ""),
        })
        self.send_response(_PushSink.status_code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


class PushServiceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = Store(tempfile.mktemp(suffix=".db"))
        _PushSink.seen = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _PushSink)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}/sub/abc"

    def tearDown(self):
        self.server.shutdown()

    def test_notify_delivers_vapid_and_records_peek(self):
        self.store.add_push_subscription(self.endpoint, p256dh="x", auth="y")
        svc = push.PushService(self.store, self.dir)
        svc.notify("✅ AFlow · 任务完成", "done", tag="t1")
        self.assertTrue(_wait(lambda: len(_PushSink.seen) == 1))
        seen = _PushSink.seen[0]
        self.assertTrue(seen["auth"].startswith("vapid t="))
        self.assertEqual(svc.peek()["title"], "✅ AFlow · 任务完成")

    def test_gone_subscription_is_removed(self):
        _PushSink.status_code = 410
        self.store.add_push_subscription(self.endpoint)
        svc = push.PushService(self.store, self.dir)
        svc.notify("x", "y")
        self.assertTrue(_wait(lambda: not self.store.list_push_subscriptions()))

    def test_subscribe_routes_validate(self):
        class H:
            def __init__(self):
                self.out = None

            def json(self, payload, status=None):
                self.out = payload

            def error(self, status, msg):
                self.out = {"error": msg}

        h = H()
        self.assertTrue(push.handle_post(h, "/api/push/subscribe", {
            "endpoint": "https://ok.example/sub", "keys": {"p256dh": "a", "auth": "b"},
        }, self.store))
        self.assertEqual(h.out, {"ok": True})
        self.assertEqual(len(self.store.list_push_subscriptions()), 1)

        h2 = H()
        push.handle_post(h2, "/api/push/subscribe", {"endpoint": "not-a-url"}, self.store)
        self.assertIn("error", h2.out)

        # delete via handler with read_body
        class HD(H):
            def read_body(self):
                return {"endpoint": "https://ok.example/sub"}

        h4 = HD()
        self.assertTrue(push.handle_delete(h4, "/api/push/subscribe", self.store))
        self.assertEqual(h4.out, {"ok": True})
        self.assertEqual(self.store.list_push_subscriptions(), [])

    def test_publickey_and_peek_routes(self):
        class H:
            out = None

            def json(self, payload, status=None):
                H.out = payload

        self.assertTrue(push.handle_get(H(), "/api/push/publickey", self.store))
        raw = base64.urlsafe_b64decode(H.out["publicKey"] + "=" * (-len(H.out["publicKey"]) % 4))
        self.assertEqual(len(raw), 65)
        self.assertTrue(push.handle_get(H(), "/api/push/peek", self.store))
        self.assertEqual(H.out, {})


if __name__ == "__main__":
    unittest.main()
