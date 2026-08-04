import base64
import hashlib
import hmac
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from runtime.adapter import QwenAdapter
from runtime.channels import (
    _redact,
    extract_text,
    handle_post,
    verify,
)
from runtime.models import new_id, utc_now
from runtime.store import Store

from runtime.tests.fake_qwen import FakeQwen


def _hmac_hex(secret, msg):
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


class FakeHandler:
    def __init__(self, headers=None):
        self.json_calls = []
        self.error_calls = []
        self.headers = headers or {}

    def json(self, data, status=200, headers=None):
        self.json_calls.append((status, data))

    def error(self, status, msg):
        self.error_calls.append((int(status), msg))


def _store_with_channel(store, ctype, secret, reply_url=""):
    now = utc_now()
    cid = new_id("ch")
    store.upsert_channel({
        "id": cid, "type": ctype, "name": "n", "webhook_url": "",
        "secret": secret, "reply_url": reply_url, "enabled": True,
        "created_at": now, "updated_at": now, "metadata": {},
    })
    return cid


class VerifyTests(unittest.TestCase):
    def test_webhook_valid_and_invalid(self):
        ch = {"type": "webhook", "secret": "s"}
        raw = b'{"text":"hi"}'
        ok, chal = verify(ch, {"x-aflow-signature": _hmac_hex("s", raw)}, raw, {})
        self.assertTrue(ok)
        self.assertIsNone(chal)
        ok, _ = verify(ch, {"x-aflow-signature": "deadbeef"}, raw, {})
        self.assertFalse(ok)

    def test_dingtalk_valid_and_stale(self):
        ch = {"type": "dingtalk", "secret": "dt"}
        ts = str(int(time.time() * 1000))
        sign = base64.b64encode(hmac.new(b"dt", f"{ts}\ndt".encode(), hashlib.sha256).digest()).decode()
        ok, _ = verify(ch, {"timestamp": ts, "sign": sign}, b"{}", {})
        self.assertTrue(ok)
        old = str(int((time.time() - 7200) * 1000))
        old_sign = base64.b64encode(hmac.new(b"dt", f"{old}\ndt".encode(), hashlib.sha256).digest()).decode()
        ok, _ = verify(ch, {"timestamp": old, "sign": old_sign}, b"{}", {})
        self.assertFalse(ok)

    def test_feishu_token_and_challenge(self):
        ch = {"type": "feishu", "secret": "ft"}
        ok, _ = verify(ch, {}, b"{}", {"header": {"token": "ft"}})
        self.assertTrue(ok)
        ok, _ = verify(ch, {}, b"{}", {"header": {"token": "wrong"}})
        self.assertFalse(ok)
        ok, chal = verify(ch, {}, b"{}", {"challenge": "abc", "header": {"token": "ft"}})
        self.assertTrue(ok)
        self.assertEqual(chal, {"challenge": "abc"})

    def test_no_secret_rejects(self):
        ok, _ = verify({"type": "webhook", "secret": ""}, {"x-aflow-signature": "x"}, b"{}", {})
        self.assertFalse(ok)


class ExtractTests(unittest.TestCase):
    def test_dingtalk(self):
        self.assertEqual(extract_text({"type": "dingtalk"}, {"text": {"content": "  hi  "}}), "hi")
        self.assertIsNone(extract_text({"type": "dingtalk"}, {"text": {"content": ""}}))

    def test_feishu(self):
        body = {"event": {"message": {"content": json.dumps({"text": "yo"})}}}
        self.assertEqual(extract_text({"type": "feishu"}, body), "yo")

    def test_webhook(self):
        self.assertEqual(extract_text({"type": "webhook"}, {"message": "m"}), "m")
        self.assertIsNone(extract_text({"type": "webhook"}, {}))


class RedactTests(unittest.TestCase):
    def test_redact(self):
        r = _redact({"secret": "sekret", "id": "c"})
        self.assertEqual(r["secret"], {"configured": True, "prefix": "sekr"})
        r2 = _redact({"secret": "", "id": "c"})
        self.assertEqual(r2["secret"]["configured"], False)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(tempfile.mktemp(suffix=".db"))

    def test_upsert_validation_and_redaction(self):
        h = FakeHandler()
        handle_post(h, "/api/channels", {"type": "bogus"}, b"", self.store, None, None)
        self.assertEqual(h.error_calls[-1][0], 400)
        h = FakeHandler()
        handle_post(h, "/api/channels", {"type": "webhook", "secret": "sekret"}, b"", self.store, None, None)
        self.assertEqual(h.json_calls[-1][0], 201)
        self.assertEqual(h.json_calls[-1][1]["channel"]["secret"]["prefix"], "sekr")

    def test_delete(self):
        cid = _store_with_channel(self.store, "webhook", "s")
        h = FakeHandler()
        handle_post(h, f"/api/channels/{cid}/delete", {}, b"", self.store, None, None)
        self.assertEqual(h.json_calls[-1][0], 200)
        h = FakeHandler()
        handle_post(h, f"/api/channels/{cid}/delete", {}, b"", self.store, None, None)
        self.assertEqual(h.error_calls[-1][0], 404)

    def test_inbound_bad_signature(self):
        cid = _store_with_channel(self.store, "webhook", "s")
        raw = b'{"text":"hi"}'
        h = FakeHandler(headers={"x-aflow-signature": "wrong"})
        handle_post(h, f"/api/channels/{cid}/inbound", json.loads(raw), raw, self.store, None, None)
        self.assertEqual(h.error_calls[-1][0], 401)

    def test_inbound_feishu_challenge(self):
        cid = _store_with_channel(self.store, "feishu", "ft")
        body = {"challenge": "zzz", "header": {"token": "ft"}}
        raw = json.dumps(body).encode()
        h = FakeHandler()
        handle_post(h, f"/api/channels/{cid}/inbound", body, raw, self.store, None, None)
        self.assertEqual(h.json_calls[-1][1], {"challenge": "zzz"})


class InboundRoundtripTests(unittest.TestCase):
    def test_webhook_runs_and_replies(self):
        # local echo reply server
        received = []
        lock = threading.Lock()

        class Echo(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                with lock:
                    received.append(json.loads(self.rfile.read(n)))
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        echo = ThreadingHTTPServer(("127.0.0.1", 0), Echo)
        threading.Thread(target=echo.serve_forever, daemon=True).start()
        reply_url = f"http://127.0.0.1:{echo.server_address[1]}/r"

        fake = FakeQwen(reply="REPLY_TEXT").start()
        try:
            store = Store(tempfile.mktemp(suffix=".db"))
            adapter = QwenAdapter(base_url=fake.base_url)
            cid = _store_with_channel(store, "webhook", "s", reply_url=reply_url)
            body = {"text": "ping"}
            raw = json.dumps(body).encode()
            h = FakeHandler(headers={"x-aflow-signature": _hmac_hex("s", raw)})
            handle_post(h, f"/api/channels/{cid}/inbound", body, raw, store, adapter, None)
            self.assertEqual(h.json_calls[-1][0], 202)
            # wait for the async reply
            deadline = time.time() + 20
            while time.time() < deadline:
                with lock:
                    if received:
                        break
                time.sleep(0.1)
            with lock:
                self.assertTrue(received)
                self.assertEqual(received[-1].get("text"), "REPLY_TEXT")
        finally:
            fake.stop()
            echo.shutdown()
            echo.server_close()


if __name__ == "__main__":
    unittest.main()
