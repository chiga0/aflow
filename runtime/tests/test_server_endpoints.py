from __future__ import annotations

import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path

from runtime.cloud_agents_runtime.auth import AuthConfig
from runtime.cloud_agents_runtime.server import build_server
from runtime.tests.test_runtime_server import (
    request_json as _request_json,
    request_no_redirect,
    request_raw,
    request_text,
    running_runtime,
)


AUTH = {"authorization": "Bearer secret"}


def request_json(url, method="GET", payload=None, headers=None):
    return _request_json(url, method=method, payload=payload, headers=headers or AUTH)


def http_status(url: str, method: str = "GET", payload=None, headers=None) -> int:
    try:
        request_json(url, method=method, payload=payload, headers=headers or AUTH)
        return 200
    except urllib.error.HTTPError as exc:
        exc.close()
        return exc.code


class ServerEndpointCoverageTest(unittest.TestCase):
    """Broad integration coverage for server.py HTTP endpoint handlers."""

    def test_health_head_and_misc_get_endpoints(self) -> None:
        with running_runtime(token="secret") as base:
            self.assertEqual(request_json(f"{base}/health")["ok"], True)
            head = request_no_redirect(f"{base}/health", method="HEAD")
            self.assertEqual(head.status, 200)
            self.assertEqual(
                request_no_redirect(f"{base}/nope", method="HEAD").status, 405
            )
            self.assertIn("adapters", request_json(f"{base}/capabilities"))
            self.assertEqual(
                request_json(f"{base}/acp")["protocol"], "acp-poc"
            )
            self.assertIn(
                "name", request_json(f"{base}/.well-known/agent-card.json")
            )
            self.assertIn("counts", request_json(f"{base}/queue"))
            self.assertIn("workers", request_json(f"{base}/workers"))
            self.assertEqual(http_status(f"{base}/workers/missing"), 404)
            self.assertIn(
                "notifications",
                request_json(f"{base}/permissions/notifications"),
            )
            self.assertIn("executors", request_json(f"{base}/executors"))
            self.assertIn("runs", request_json(f"{base}/metrics.json"))
            prom = request_text(f"{base}/metrics", headers=AUTH)
            self.assertIn("aflow_runs_total", prom)
            self.assertIn(
                "attachment",
                request_raw(f"{base}/ops/audit/export", headers=AUTH)
                .headers["content-disposition"],
            )
            self.assertIn("database", request_json(f"{base}/ops/status"))
            self.assertIn("status", request_json(f"{base}/cost/status"))
            self.assertIn("checks", request_json(f"{base}/ops/drills"))
            self.assertIn("backups", request_json(f"{base}/ops/backups"))
            self.assertIn("mode", request_json(f"{base}/access/policy"))
            self.assertIn("projects", request_json(f"{base}/access/projects"))
            self.assertIn("tokens", request_json(f"{base}/access/tokens"))
            self.assertIn("users", request_json(f"{base}/auth/users"))
            self.assertIn("components", request_json(f"{base}/p5/evaluations"))

    def test_oidc_endpoints_not_configured_and_callback_guards(self) -> None:
        with running_runtime(token="secret") as base:
            self.assertEqual(http_status(f"{base}/auth/oidc/login"), 404)
            self.assertEqual(http_status(f"{base}/auth/oidc/callback"), 404)

    def test_oidc_login_discovery_failure_returns_bad_gateway(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        server = build_server(
            "127.0.0.1",
            0,
            Path(tmp.name),
            auth_config=AuthConfig(
                token="secret",
                oidc_issuer="http://127.0.0.1:1",
                oidc_client_id="client",
            ),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            base = f"http://{host}:{port}"
            self.assertEqual(http_status(f"{base}/auth/oidc/login"), 502)
            self.assertEqual(http_status(f"{base}/auth/oidc/callback"), 400)
            self.assertEqual(
                http_status(f"{base}/auth/oidc/callback?code=c&state=s"), 403
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            tmp.cleanup()

    def test_v2_admin_read_endpoints(self) -> None:
        with running_runtime(token="secret") as base:
            self.assertIn("tasks", request_json(f"{base}/v2/admin/overview"))
            self.assertIn(
                "units", request_json(f"{base}/v2/admin/execution-units")
            )
            self.assertIn("channels", request_json(f"{base}/v2/admin/channels"))
            self.assertIn(
                "messages", request_json(f"{base}/v2/admin/channel-messages")
            )
            self.assertIn("tenants", request_json(f"{base}/v2/admin/tenants"))
            self.assertIn("projects", request_json(f"{base}/v2/admin/projects"))
            self.assertIn(
                "database", request_json(f"{base}/v2/admin/ha")
            )
            self.assertIn(
                "engines", request_json(f"{base}/v2/admin/workflow-engines")
            )
            self.assertIn(
                "members",
                request_json(f"{base}/v2/admin/projects/project_default/members"),
            )
            self.assertIn(
                "users",
                request_json(f"{base}/v2/admin/tenants/tenant_default/users"),
            )
            self.assertIn(
                "policies",
                request_json(f"{base}/v2/admin/tenants/tenant_default/rbac"),
            )

    def test_v2_task_detail_endpoints(self) -> None:
        with running_runtime(token="secret", worker_capacity=0) as base:
            task = request_json(
                f"{base}/v2/tasks",
                method="POST",
                payload={"goal": "coverage", "adapter": "fake"},
                headers=AUTH,
            )
            tid = task["task_id"]
            self.assertIn("tasks", request_json(f"{base}/v2/tasks"))
            self.assertEqual(request_json(f"{base}/v2/tasks/{tid}")["task_id"], tid)
            self.assertIn("events", request_json(f"{base}/v2/tasks/{tid}/events.json"))
            self.assertIn("steps", request_json(f"{base}/v2/tasks/{tid}/workflow"))
            self.assertIn(
                "artifacts", request_json(f"{base}/v2/tasks/{tid}/artifacts")
            )
            self.assertIn("task", request_json(f"{base}/v2/tasks/{tid}/audit.json"))
            self.assertIn(
                "evaluations", request_json(f"{base}/v2/tasks/{tid}/evaluations")
            )
            self.assertIn(
                "permissions", request_json(f"{base}/v2/tasks/{tid}/permissions")
            )
            self.assertIn("replays", request_json(f"{base}/v2/tasks/{tid}/replays"))
            self.assertIn(
                "events", request_json(f"{base}/v2/tasks/{tid}/webshell/events.json")
            )
            self.assertEqual(http_status(f"{base}/v2/tasks/missing"), 404)
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/events.json"), 404
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/workflow"), 404
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/artifacts"), 404
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/audit.json"), 404
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/evaluations"), 404
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/permissions"), 404
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/replays"), 404
            )

    def test_profile_mission_task_run_lifecycle_endpoints(self) -> None:
        with running_runtime(token="secret", worker_capacity=0) as base:
            profile = request_json(
                f"{base}/profiles",
                method="POST",
                payload={
                    "id": "cov-profile",
                    "display_name": "Cov",
                    "runtime": {"preferred_adapter": "fake"},
                },
                headers=AUTH,
            )
            self.assertEqual(profile["id"], "cov-profile")
            self.assertIn("profiles", request_json(f"{base}/profiles"))
            self.assertEqual(
                request_json(f"{base}/profiles/cov-profile")["id"], "cov-profile"
            )
            self.assertEqual(http_status(f"{base}/profiles/missing"), 404)

            mission = request_json(
                f"{base}/missions",
                method="POST",
                payload={"goal": "cov mission", "strategy": "sequential",
                         "adapter": "fake"},
                headers=AUTH,
            )
            mid = mission["mission_id"]
            self.assertIn("missions", request_json(f"{base}/missions"))
            self.assertEqual(request_json(f"{base}/missions/{mid}")["mission_id"], mid)
            self.assertIn(
                "events", request_json(f"{base}/missions/{mid}/events.json")
            )
            self.assertIn(
                "artifacts", request_json(f"{base}/missions/{mid}/artifacts")
            )
            self.assertIn(
                "workflow",
                request_json(f"{base}/temporal/workflows/missions/{mid}/plan"),
            )
            self.assertEqual(http_status(f"{base}/missions/missing"), 404)
            self.assertEqual(
                http_status(f"{base}/missions/missing/events.json"), 404
            )
            cancelled_mission = request_json(
                f"{base}/missions/{mid}/cancel",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )
            self.assertIn(cancelled_mission["status"], {"cancelled", "completed"})
            self.assertEqual(
                http_status(
                    f"{base}/missions/missing/cancel", method="POST", payload={}
                ),
                404,
            )

            run = request_json(
                f"{base}/runs",
                method="POST",
                payload={"prompt": "cov run", "adapter": "fake"},
                headers=AUTH,
            )
            rid = run["run_id"]
            self.assertIn("runs", request_json(f"{base}/runs"))
            self.assertEqual(request_json(f"{base}/runs/{rid}")["run_id"], rid)
            self.assertIn("run", request_json(f"{base}/runs/{rid}/audit.json"))
            self.assertIn(
                "artifacts", request_json(f"{base}/runs/{rid}/artifacts")
            )
            self.assertIn("executor", request_json(f"{base}/runs/{rid}/executor"))
            self.assertIn(
                "workflow", request_json(f"{base}/temporal/workflows/runs/{rid}/plan")
            )
            self.assertEqual(http_status(f"{base}/runs/missing"), 404)
            self.assertEqual(http_status(f"{base}/runs/missing/executor"), 404)
            request_json(
                f"{base}/runs/{rid}/input",
                method="POST",
                payload={"prompt": "follow up"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(
                    f"{base}/runs/{rid}/input", method="POST", payload={}
                ),
                400,
            )
            request_json(
                f"{base}/runs/{rid}/cancel",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )

    def test_task_and_a2a_and_session_endpoints(self) -> None:
        with running_runtime(token="secret", worker_capacity=0) as base:
            task = request_json(
                f"{base}/tasks",
                method="POST",
                payload={"goal": "cov task", "adapter": "fake"},
                headers=AUTH,
            )
            tid = task["task_id"]
            self.assertIn("tasks", request_json(f"{base}/tasks"))
            self.assertEqual(request_json(f"{base}/tasks/{tid}")["task_id"], tid)
            self.assertIn("events", request_json(f"{base}/tasks/{tid}/events.json"))
            self.assertIn("artifacts", request_json(f"{base}/tasks/{tid}/artifacts"))
            self.assertEqual(http_status(f"{base}/tasks/{tid}/result"), 200)
            self.assertEqual(http_status(f"{base}/tasks/missing"), 404)
            self.assertEqual(
                http_status(f"{base}/tasks/missing/events.json"), 404
            )
            request_json(
                f"{base}/tasks/{tid}/messages",
                method="POST",
                payload={"message": "hello"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(
                    f"{base}/tasks/{tid}/messages", method="POST", payload={}
                ),
                400,
            )
            request_json(
                f"{base}/tasks/{tid}/cancel",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(
                    f"{base}/tasks/missing/cancel", method="POST", payload={}
                ),
                404,
            )

            self.assertIn("tasks", request_json(f"{base}/a2a/tasks"))
            a2a = request_json(
                f"{base}/a2a/tasks",
                method="POST",
                payload={"goal": "a2a cov", "adapter": "fake"},
                headers=AUTH,
            )
            self.assertIn("task_id", a2a)
            self.assertEqual(http_status(f"{base}/a2a/tasks/missing"), 404)
            self.assertEqual(
                http_status(f"{base}/a2a/tasks/missing/events.json"), 404
            )
            self.assertEqual(
                http_status(f"{base}/a2a/tasks/missing/artifacts"), 404
            )

            session = request_json(
                f"{base}/session",
                method="POST",
                payload={"prompt": "session cov", "adapter": "fake"},
                headers=AUTH,
            )
            sid = session["session"]["id"]
            self.assertIn("session", session)
            request_json(
                f"{base}/session/{sid}/prompt",
                method="POST",
                payload={"prompt": "more"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(
                    f"{base}/session/{sid}/prompt", method="POST", payload={}
                ),
                400,
            )
            request_json(
                f"{base}/session/{sid}/cancel",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )

    def test_access_auth_worker_management_endpoints(self) -> None:
        with running_runtime(token="secret", worker_capacity=0) as base:
            project = request_json(
                f"{base}/access/projects",
                method="POST",
                payload={"project_id": "cov-proj", "display_name": "Cov"},
                headers=AUTH,
            )
            self.assertEqual(project["project_id"], "cov-proj")
            token = request_json(
                f"{base}/access/tokens",
                method="POST",
                payload={"name": "cov-token", "scopes": ["tasks:read"]},
                headers=AUTH,
            )
            self.assertIn("token_id", token)
            revoked = request_json(
                f"{base}/access/tokens/{token['token_id']}/revoke",
                method="POST",
                payload={},
                headers=AUTH,
            )
            self.assertEqual(revoked["status"], "revoked")

            user = request_json(
                f"{base}/auth/users",
                method="POST",
                payload={
                    "email": "cov@example.com",
                    "password": "cov-password-123",
                    "roles": ["member"],
                },
                headers=AUTH,
            )
            self.assertEqual(user["email"], "cov@example.com")
            roles_updated = request_json(
                f"{base}/auth/users/cov@example.com/roles",
                method="POST",
                payload={"roles": ["member", "auditor"]},
                headers=AUTH,
            )
            self.assertIn("auditor", roles_updated["roles"])
            status_updated = request_json(
                f"{base}/auth/users/cov@example.com/status",
                method="POST",
                payload={"status": "disabled"},
                headers=AUTH,
            )
            self.assertEqual(status_updated["status"], "disabled")
            request_json(
                f"{base}/auth/users/cov@example.com/password",
                method="POST",
                payload={"password": "new-cov-password-123"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(
                    f"{base}/auth/users/missing@example.com/roles",
                    method="POST",
                    payload={"roles": ["member"]},
                ),
                404,
            )

            registration = request_json(
                f"{base}/workers/registrations",
                method="POST",
                payload={
                    "worker_id": "cov-worker",
                    "control_url": "http://127.0.0.1:9",
                    "capacity": 1,
                },
                headers=AUTH,
            )
            self.assertEqual(registration["worker_id"], "cov-worker")
            request_json(
                f"{base}/workers/cov-worker/heartbeat",
                method="POST",
                payload={"capacity": 1},
                headers=AUTH,
            )
            self.assertIn("worker", request_json(f"{base}/workers/cov-worker"))
            self.assertIn(
                "worker_id",
                request_json(f"{base}/workers/cov-worker/control"),
            )
            request_json(
                f"{base}/workers/cov-worker/drain",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )
            request_json(
                f"{base}/workers/cov-worker/resume",
                method="POST",
                payload={},
                headers=AUTH,
            )
            request_json(
                f"{base}/workers/cov-worker/retry",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )

    def test_ops_cleanup_backup_and_acp_endpoints(self) -> None:
        with running_runtime(token="secret", worker_capacity=0) as base:
            self.assertIn("cleanup", request_json(
                f"{base}/cleanup", method="POST", payload={}, headers=AUTH
            ))
            backup = request_json(
                f"{base}/ops/backups", method="POST", payload={}, headers=AUTH
            )
            self.assertIn("backup", backup)
            self.assertIn("checks", request_json(
                f"{base}/ops/drills", method="POST", payload={}, headers=AUTH
            ))
            acp_response = request_json(
                f"{base}/acp",
                method="POST",
                payload={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "capabilities.get",
                    "params": {},
                },
                headers=AUTH,
            )
            self.assertIn("jsonrpc", acp_response)

    def test_v2_task_mutation_and_admin_write_endpoints(self) -> None:
        with running_runtime(token="secret", worker_capacity=0) as base:
            task = request_json(
                f"{base}/v2/tasks",
                method="POST",
                payload={"goal": "cov v2", "adapter": "fake"},
                headers=AUTH,
            )
            tid = task["task_id"]
            request_json(
                f"{base}/v2/tasks/{tid}/messages",
                method="POST",
                payload={"message": "hello v2"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/messages",
                            method="POST", payload={"message": "x"}),
                404,
            )
            # retry may be 202 (terminal task) or 400 (still running); both
            # exercise the endpoint.
            self.assertIn(
                http_status(f"{base}/v2/tasks/{tid}/retry",
                            method="POST", payload={}),
                (200, 202, 400, 409),
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/retry",
                            method="POST", payload={}),
                404,
            )
            request_json(
                f"{base}/v2/tasks/{tid}/cancel",
                method="POST",
                payload={"reason": "cov"},
                headers=AUTH,
            )
            self.assertEqual(
                http_status(f"{base}/v2/tasks/missing/cancel",
                            method="POST", payload={}),
                404,
            )

            unit = request_json(
                f"{base}/v2/admin/execution-units",
                method="POST",
                payload={
                    "unit_id": "cov-unit",
                    "kind": "remote-worker",
                    "adapters": ["fake"],
                },
                headers=AUTH,
            )
            self.assertEqual(unit["unit_id"], "cov-unit")
            request_json(
                f"{base}/v2/admin/projects",
                method="POST",
                payload={"project_id": "cov-v2-proj", "display_name": "Cov"},
                headers=AUTH,
            )
            self.assertIn(
                "members",
                request_json(f"{base}/v2/admin/projects/cov-v2-proj/members"),
            )
            request_json(
                f"{base}/v2/admin/projects/cov-v2-proj/members",
                method="POST",
                payload={"email": "m@example.com", "roles": ["member"]},
                headers=AUTH,
            )
            request_json(
                f"{base}/v2/admin/tenants/tenant_default/users",
                method="POST",
                payload={"email": "tu@example.com", "roles": ["member"]},
                headers=AUTH,
            )
            request_json(
                f"{base}/v2/admin/tenants/tenant_default/rbac",
                method="POST",
                payload={"role": "member", "scopes": ["tasks:read"]},
                headers=AUTH,
            )

    def test_v1_run_and_mission_detail_endpoints(self) -> None:
        with running_runtime(token="secret") as base:
            run = request_json(
                f"{base}/runs",
                method="POST",
                payload={"prompt": "v1 coverage run", "adapter": "fake"},
                headers=AUTH,
            )
            rid = run["run_id"]
            self.assertIn("runs", request_json(f"{base}/runs"))
            self.assertEqual(request_json(f"{base}/runs/{rid}")["run_id"], rid)
            self.assertEqual(http_status(f"{base}/runs/missing"), 404)
            self.assertIn("executor", request_json(f"{base}/runs/{rid}/executor"))
            self.assertIn(
                "workflow",
                request_json(f"{base}/temporal/workflows/runs/{rid}/plan"),
            )
            self.assertEqual(
                http_status(f"{base}/temporal/workflows/runs/missing/plan"), 404
            )
            self.assertIn(
                "notifications",
                request_json(f"{base}/runs/{rid}/permission-notifications"),
            )
            self.assertIn("events", request_json(f"{base}/runs/{rid}/events.json"))
            self.assertIn("run", request_json(f"{base}/runs/{rid}/audit.json"))
            self.assertIn(
                "artifacts", request_json(f"{base}/runs/{rid}/artifacts")
            )
            self.assertEqual(
                http_status(f"{base}/runs/{rid}/artifacts/missing.json"), 404
            )
            self.assertIn(
                "events", request_json(f"{base}/session/{rid}/events.json")
            )
            self.assertEqual(http_status(f"{base}/session/missing/events.json"), 404)

            mission = request_json(
                f"{base}/missions",
                method="POST",
                payload={
                    "goal": "v1 coverage mission",
                    "strategy": "custom",
                    "adapter": "fake",
                    "tasks": [
                        {"id": "plan", "profile": "planner", "prompt": "plan"},
                        {
                            "id": "report",
                            "profile": "reviewer",
                            "depends_on": ["plan"],
                            "prompt": "report",
                        },
                    ],
                },
                headers=AUTH,
            )
            mid = mission.get("mission_id")
            self.assertTrue(mid)
            self.assertIn("missions", request_json(f"{base}/missions"))
            self.assertEqual(
                request_json(f"{base}/missions/{mid}")["mission_id"], mid
            )
            self.assertIn(
                "workflow",
                request_json(f"{base}/temporal/workflows/missions/{mid}/plan"),
            )
            self.assertIn(
                "artifacts", request_json(f"{base}/missions/{mid}/artifacts")
            )
            self.assertIn(
                "events", request_json(f"{base}/missions/{mid}/events.json")
            )
            self.assertEqual(http_status(f"{base}/missions/missing"), 404)
            self.assertEqual(
                http_status(f"{base}/temporal/workflows/missions/missing/plan"), 404
            )
            # HEAD requests exercise do_HEAD branches (no body to parse).
            import urllib.request

            head_req = urllib.request.Request(
                f"{base}/health", method="HEAD", headers=AUTH
            )
            with urllib.request.urlopen(head_req, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
            head_405 = urllib.request.Request(
                f"{base}/runs", method="HEAD", headers=AUTH
            )
            try:
                urllib.request.urlopen(head_405, timeout=5)
                self.fail("expected 405 for HEAD /runs")
            except urllib.error.HTTPError as exc:
                self.assertEqual(exc.code, 405)


if __name__ == "__main__":
    unittest.main()
