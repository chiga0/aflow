import http.cookiejar
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from runtime.adapter import QwenAdapter
from runtime.auth import AuthConfig, hash_password
from runtime.metrics import METRICS
from runtime.server import make_handler
from runtime.store import Store

from runtime.tests.fake_qwen import FakeQwen


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._static = tempfile.mkdtemp()
        with open(os.path.join(cls._static, "index.html"), "w") as f:
            f.write("<html>SPA_OK</html>")
        os.makedirs(os.path.join(cls._static, "assets"), exist_ok=True)
        with open(os.path.join(cls._static, "assets", "a.js"), "w") as f:
            f.write("var x=1;")
        os.environ["AFLOW_STATIC_DIR"] = cls._static

        cls.fake = FakeQwen().start()
        cls.store = Store(tempfile.mktemp(suffix=".db"))
        cls.adapter = QwenAdapter(base_url=cls.fake.base_url)
        cls.cfg = AuthConfig(
            enabled=True, email="a@b.c", password_hash=hash_password("secret"), api_token="tok"
        )
        METRICS.set_gauge("aflow_up", 1.0)
        handler = make_handler(cls.store, cls.adapter, cls.cfg)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.srv.server_address[1]
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.fake.stop()
        os.environ.pop("AFLOW_STATIC_DIR", None)

    def setUp(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def _req(self, method, path, body=None, authed=True, headers=None):
        h = {"Content-Type": "application/json"}
        if headers:
            h.update(headers)
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            resp = (self.opener.open if authed else urllib.request.urlopen)(r, timeout=15)
            return resp.status, resp.read(), dict(resp.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def test_health_public(self):
        s, b, _ = self._req("GET", "/api/health", authed=False)
        self.assertEqual(s, 200)
        self.assertTrue(json.loads(b)["auth"]["enabled"])

    def test_session_probe_unauthed(self):
        s, b, _ = self._req("GET", "/api/auth/session", authed=False)
        self.assertEqual(s, 200)
        self.assertFalse(json.loads(b)["authenticated"])

    def test_login_wrong_then_right(self):
        s, _, _ = self._req("POST", "/api/auth/login", {"email": "a@b.c", "password": "nope"})
        self.assertEqual(s, 401)
        s, b, hdrs = self._req("POST", "/api/auth/login", {"email": "a@b.c", "password": "secret"})
        self.assertEqual(s, 200)
        self.assertTrue(json.loads(b)["authenticated"])
        cookie = (hdrs.get("Set-Cookie") or hdrs.get("set-cookie") or "")
        self.assertIn("aflow_session=", cookie)
        self.assertIn("HttpOnly", cookie)

    def test_metrics_requires_auth(self):
        s, _, _ = self._req("GET", "/metrics", authed=False)
        self.assertEqual(s, 401)
        # login first
        self._req("POST", "/api/auth/login", {"email": "a@b.c", "password": "secret"})
        s, b, _ = self._req("GET", "/metrics")
        self.assertEqual(s, 200)
        self.assertIn(b"aflow_up 1.0", b)

    def test_metrics_bearer_token(self):
        s, b, _ = self._req("GET", "/metrics", authed=False, headers={"Authorization": "Bearer tok"})
        self.assertEqual(s, 200)
        self.assertIn(b"aflow_up", b)

    def test_daemon_proxy_requires_auth_then_proxies(self):
        s, _, _ = self._req("GET", "/daemon/health", authed=False)
        self.assertEqual(s, 401)
        self._req("POST", "/api/auth/login", {"email": "a@b.c", "password": "secret"})
        s, b, _ = self._req("GET", "/daemon/health")
        self.assertEqual(s, 200)
        self.assertEqual(json.loads(b)["status"], "ok")

    def test_extension_route_requires_auth(self):
        s, _, _ = self._req("GET", "/api/missions", authed=False)
        self.assertEqual(s, 401)
        s, _, _ = self._req("POST", "/api/missions", {"goal": "g"}, authed=False)
        self.assertEqual(s, 401)

    def test_static_spa_and_asset(self):
        s, b, _ = self._req("GET", "/", authed=False)
        self.assertEqual(s, 200)
        self.assertIn(b"SPA_OK", b)
        s, b, hdrs = self._req("GET", "/assets/a.js", authed=False)
        self.assertEqual(s, 200)
        self.assertIn(b"var x=1", b)
        self.assertIn("max-age=31536000", hdrs.get("Cache-Control", ""))

    def test_logout_invalidates_cookie(self):
        self._req("POST", "/api/auth/login", {"email": "a@b.c", "password": "secret"})
        s, _, _ = self._req("GET", "/metrics")
        self.assertEqual(s, 200)
        self._req("POST", "/api/auth/logout")
        s, _, _ = self._req("GET", "/metrics")
        self.assertEqual(s, 401)


if __name__ == "__main__":
    unittest.main()
