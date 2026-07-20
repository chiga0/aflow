from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class DeployAssetsTest(unittest.TestCase):
    def test_worker_deploy_script_supports_real_cli_and_offline_sources(self) -> None:
        script_path = ROOT / "scripts" / "deploy_worker_vps.sh"
        script = script_path.read_text(encoding="utf-8")

        subprocess.run(["bash", "-n", str(script_path)], check=True)
        self.assertNotIn('RUN_WORKER_METADATA_JSON="${RUN_WORKER_METADATA_JSON:-{}}"', script)
        for contract in (
            'V2_WORKSPACE_ROOTS="${V2_WORKSPACE_ROOTS:-$STATE_DIR}"',
            'V2_ENABLE_REAL_CLI_ADAPTERS="${V2_ENABLE_REAL_CLI_ADAPTERS:-1}"',
            'V2_QWEN_CODE_COMMAND="${V2_QWEN_CODE_COMMAND:-qwen -y}"',
            'SOURCE_BUNDLE_FILE="${SOURCE_BUNDLE_FILE:-}"',
            'git clone --branch "$SOURCE_BUNDLE_REF"',
            'node package already installed: $package',
            "remove legacy worker path override",
            "Acquire::Retries=5",
        ):
            self.assertIn(contract, script)

        example = (
            ROOT / "deploy" / "systemd" / "cloud-agents-worker.env.example"
        ).read_text(encoding="utf-8")
        for setting in (
            "V2_WORKSPACE_ROOTS=/var/lib/cloud-agents-worker",
            "V2_ENABLE_REAL_CLI_ADAPTERS=1",
            "V2_QWEN_CODE_COMMAND=qwen -y",
            "V2_AGENT_TIMEOUT_SECONDS=3600",
        ):
            self.assertIn(setting, example)

        runbook = (ROOT / "docs" / "deployment-runbook.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("SOURCE_BUNDLE_FILE=/tmp/agentflow-worker.bundle", runbook)
        self.assertIn("V2_QWEN_CODE_COMMAND=qwen -y", runbook)

        execution_units = (ROOT / "docs" / "execution-units.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("`/etc/cloud-agents-worker.env`：", execution_units)
        self.assertIn(
            "`/etc/systemd/system/cloud-agents-worker.service`：",
            execution_units,
        )

    def test_runtime_image_build_is_secret_safe_and_cache_friendly(self) -> None:
        dockerfile = (ROOT / "deploy" / "Dockerfile.runtime").read_text(
            encoding="utf-8"
        )
        compose = (ROOT / "deploy" / "docker-compose.runtime.yml").read_text(
            encoding="utf-8"
        )
        dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")

        self.assertIn("ARG NODE_BASE_IMAGE=", dockerfile)
        self.assertIn("ARG PYTHON_BASE_IMAGE=", dockerfile)
        self.assertLess(
            dockerfile.index("COPY runtime/requirements.txt"),
            dockerfile.index("npm install -g"),
        )
        self.assertGreater(
            dockerfile.index("COPY runtime /app/runtime"),
            dockerfile.index("npm install -g"),
        )
        self.assertIn("Acquire::Retries=5", dockerfile)
        self.assertIn("NODE_BASE_IMAGE: ${NODE_IMAGE:-", compose)
        self.assertIn("PYTHON_BASE_IMAGE: ${PYTHON_IMAGE:-", compose)
        self.assertIn(".env.*", dockerignore)
        self.assertIn(".runtime", dockerignore)


if __name__ == "__main__":
    unittest.main()
