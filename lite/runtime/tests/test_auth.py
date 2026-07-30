import os
import tempfile
import unittest

from lite.runtime.auth import (
    AuthConfig,
    check_request_auth,
    hash_password,
    parse_cookie,
    verify_password,
)


class PasswordTests(unittest.TestCase):
    def test_roundtrip(self):
        h = hash_password("hunter2")
        self.assertTrue(h.startswith("scrypt$"))
        self.assertTrue(verify_password("hunter2", h))

    def test_wrong_password(self):
        h = hash_password("hunter2")
        self.assertFalse(verify_password("wrong", h))

    def test_malformed_stored(self):
        self.assertFalse(verify_password("x", "garbage"))
        self.assertFalse(verify_password("x", ""))
        self.assertFalse(verify_password("x", "scrypt$not-hex$xx"))

    def test_unique_salts(self):
        self.assertNotEqual(hash_password("same"), hash_password("same"))


class CookieTests(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_cookie("a=1; aflow_session=abc; z=9", "aflow_session"), "abc")

    def test_missing(self):
        self.assertIsNone(parse_cookie("a=1", "aflow_session"))
        self.assertIsNone(parse_cookie(None, "aflow_session"))


class AuthConfigTests(unittest.TestCase):
    def test_explicit_password(self):
        cfg = AuthConfig(enabled=True, email="a@b.c", password_hash=hash_password("p"), api_token="")
        self.assertTrue(cfg.password_login_enabled)
        self.assertFalse(cfg.token_enabled)

    def test_bootstrap_generated_when_no_creds(self):
        with tempfile.TemporaryDirectory() as d:
            for k in ("AFLOW_AUTH_DISABLED", "AFLOW_AUTH_EMAIL", "AFLOW_AUTH_PASSWORD", "AFLOW_AUTH_TOKEN"):
                os.environ.pop(k, None)
            cfg = AuthConfig.from_env(data_dir=d)
            self.assertTrue(cfg.enabled)
            self.assertTrue(cfg.password_login_enabled)
            self.assertIsNotNone(cfg.bootstrap_path)
            self.assertTrue(os.path.exists(cfg.bootstrap_path))
            # Reusing the same dir keeps the same bootstrap password.
            cfg2 = AuthConfig.from_env(data_dir=d)
            self.assertEqual(cfg.email, cfg2.email)
            self.assertEqual(
                open(cfg.bootstrap_path).read().strip(),
                open(cfg2.bootstrap_path).read().strip(),
            )

    def test_disabled(self):
        os.environ["AFLOW_AUTH_DISABLED"] = "1"
        try:
            cfg = AuthConfig.from_env(data_dir=tempfile.mkdtemp())
            self.assertFalse(cfg.enabled)
        finally:
            os.environ.pop("AFLOW_AUTH_DISABLED", None)


class CheckAuthTests(unittest.TestCase):
    def _cfg(self):
        return AuthConfig(
            enabled=True,
            email="a@b.c",
            password_hash=hash_password("p"),
            api_token="tok",
        )

    def test_disabled_always_ok(self):
        cfg = AuthConfig(enabled=False, email="", password_hash="", api_token="")
        self.assertTrue(check_request_auth({}, cfg, lambda sid: False))

    def test_bearer(self):
        cfg = self._cfg()
        self.assertTrue(check_request_auth({"Authorization": "Bearer tok"}, cfg, lambda sid: False))
        self.assertFalse(check_request_auth({"Authorization": "Bearer nope"}, cfg, lambda sid: False))

    def test_cookie(self):
        cfg = self._cfg()
        self.assertTrue(
            check_request_auth({"Cookie": "aflow_session=good"}, cfg, lambda sid: sid == "good")
        )
        self.assertFalse(
            check_request_auth({"Cookie": "aflow_session=bad"}, cfg, lambda sid: sid == "good")
        )

    def test_nothing(self):
        cfg = self._cfg()
        self.assertFalse(check_request_auth({}, cfg, lambda sid: False))


if __name__ == "__main__":
    unittest.main()
