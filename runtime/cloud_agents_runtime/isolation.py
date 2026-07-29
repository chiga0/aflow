"""Execution isolation policy for real-CLI adapters.

Real-CLI adapters (codex/claude/opencode/qwen) execute arbitrary commands
on the worker host. Without container isolation a single prompt-injection
in the task goal can escape the workspace and compromise the host. This
module makes isolation *fail-closed*: a real-CLI adapter runs ONLY inside a
container; when container isolation is not configured the task is refused
rather than silently degraded to bare-host execution.

The ``fake`` adapter and the protocol-simulation path (real CLI disabled)
never execute arbitrary commands and are therefore exempt.
"""

from __future__ import annotations

import os
import shlex
from dataclasses import dataclass
from pathlib import Path

REAL_CLI_ADAPTERS = frozenset({"codex", "claude", "opencode", "qwen"})

# Env var prefixes that carry the secrets/config a CLI needs to authenticate.
# Only these are forwarded into the container; PATH/HOME/system vars come from
# the container image so the host filesystem is never leaked.
_FORWARDED_PREFIXES = ("V2_", "QWEN_", "CODEX_", "ANTHROPIC_", "OPENAI_", "OPENCODE_")


class IsolationUnavailableError(RuntimeError):
    """A real-CLI adapter requires container isolation that is not configured."""


def adapter_requires_isolation(adapter: str) -> bool:
    return adapter in REAL_CLI_ADAPTERS


@dataclass
class V2IsolationConfig:
    strategy: str
    image: str | None
    command_template: str | None
    cpus: float
    memory_mb: int
    pids: int
    network: str
    extra_args: str | None
    allow_unisolated: bool

    @classmethod
    def from_env(cls) -> "V2IsolationConfig":
        image = os.environ.get("V2_CONTAINER_IMAGE") or os.environ.get(
            "QWEN_CONTAINER_IMAGE"
        )
        command_template = os.environ.get("V2_CONTAINER_COMMAND") or os.environ.get(
            "QWEN_CONTAINER_COMMAND"
        )
        explicit = (os.environ.get("V2_ISOLATION_STRATEGY") or "").strip().lower()
        if explicit in {"container", "docker"}:
            strategy = "container"
        elif explicit in {"none", "off", "disabled"}:
            strategy = "none"
        else:
            strategy = "container" if (image or command_template) else "none"
        return cls(
            strategy=strategy,
            image=image,
            command_template=command_template,
            cpus=float(os.environ.get("V2_CONTAINER_CPUS") or "1"),
            memory_mb=int(os.environ.get("V2_CONTAINER_MEMORY_MB") or "1024"),
            pids=int(os.environ.get("V2_CONTAINER_PIDS") or "256"),
            network=os.environ.get("V2_CONTAINER_NETWORK") or "bridge",
            extra_args=os.environ.get("V2_CONTAINER_EXTRA_ARGS"),
            allow_unisolated=os.environ.get("V2_ALLOW_UNISOLATED_CLI") == "1",
        )

    @property
    def container_available(self) -> bool:
        return self.strategy == "container" and bool(self.image or self.command_template)


def _forwarded_env(env: dict[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in env.items()
        if key.startswith(_FORWARDED_PREFIXES)
    }


def build_isolated_command(
    config: V2IsolationConfig,
    cli_command: list[str],
    *,
    workspace: Path,
    env: dict[str, str],
    container_name: str,
) -> list[str]:
    """Wrap an arbitrary CLI command in a ``docker run`` invocation.

    The workspace is bind-mounted read-write at the same path and set as the
    working directory; stdin is kept open (``-i``) so the JSON envelope can be
    piped to the CLI exactly as in bare-host execution.
    """
    if config.command_template:
        command = shlex.split(config.command_template)
        command.extend(cli_command)
        return command
    if not config.image:
        raise IsolationUnavailableError(
            "container isolation requested but no V2_CONTAINER_IMAGE is configured"
        )
    command = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        container_name,
        "--cpus",
        f"{config.cpus:g}",
        "--memory",
        f"{config.memory_mb}m",
        "--pids-limit",
        str(config.pids),
        "--network",
        config.network,
        "-v",
        f"{workspace}:{workspace}:rw",
        "-w",
        str(workspace),
    ]
    for key, value in sorted(_forwarded_env(env).items()):
        command.extend(["-e", f"{key}={value}"])
    if config.extra_args:
        command.extend(shlex.split(config.extra_args))
    command.append(config.image)
    command.extend(cli_command)
    return command


def resolve_cli_execution(
    config: V2IsolationConfig,
    adapter: str,
    cli_command: list[str],
    *,
    workspace: Path,
    env: dict[str, str],
    container_name: str,
) -> tuple[list[str], dict[str, str] | None, str]:
    """Fail-closed resolution of how a real-CLI adapter command must run.

    Returns ``(command, popen_env, execution_mode)``:
      - real-CLI adapter + container available → docker-wrapped command,
        ``None`` env (secrets are baked into ``-e`` flags), mode
        ``"real-cli-container"``;
      - real-CLI adapter + no container + escape hatch → bare command with the
        caller's env, mode ``"real-cli-unisolated"`` (development only);
      - real-CLI adapter + no container + no escape hatch → raises
        :class:`IsolationUnavailableError` (fail-closed);
      - non-real-CLI adapter → bare command unchanged, mode ``"real-cli"``.
    """
    if not adapter_requires_isolation(adapter):
        return cli_command, env, "real-cli"
    if config.container_available:
        return (
            build_isolated_command(
                config,
                cli_command,
                workspace=workspace,
                env=env,
                container_name=container_name,
            ),
            None,
            "real-cli-container",
        )
    if config.allow_unisolated:
        return cli_command, env, "real-cli-unisolated"
    raise IsolationUnavailableError(
        f"adapter '{adapter}' executes arbitrary commands and requires container "
        "isolation, but none is configured. Set V2_CONTAINER_IMAGE (or "
        "V2_CONTAINER_COMMAND) to run it inside a container. Bare-host execution "
        "is refused; set V2_ALLOW_UNISOLATED_CLI=1 to override for local "
        "development only."
    )
