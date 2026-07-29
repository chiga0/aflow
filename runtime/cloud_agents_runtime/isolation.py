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

import logging
import os
import re
import shlex
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("cloud_agents_runtime")

REAL_CLI_ADAPTERS = frozenset({"codex", "claude", "opencode", "qwen"})

# Env var prefixes that carry the secrets/config a CLI needs to authenticate.
# Only these are forwarded into the container; PATH/HOME/system vars come from
# the container image so the host filesystem is never leaked.
_FORWARDED_PREFIXES = ("V2_", "QWEN_", "CODEX_", "ANTHROPIC_", "OPENAI_", "OPENCODE_")

# Only simple uppercase identifiers may be forwarded as container env keys.
_VALID_ENV_KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")


class IsolationUnavailableError(RuntimeError):
    """A real-CLI adapter requires container isolation that is not configured."""


def adapter_requires_isolation(adapter: str) -> bool:
    return adapter in REAL_CLI_ADAPTERS


def _parse_positive(name: str, default: str, cast: type) -> float | int:
    raw = os.environ.get(name) or default
    try:
        value = cast(raw)
    except (ValueError, TypeError):
        raise ValueError(f"{name}={raw!r} is not a valid number") from None
    if value <= 0:
        raise ValueError(f"{name} must be positive, got {value}")
    return value


# Container runtimes recognized as providing real isolation. A command_template
# starting with anything else is treated as a custom (unenforced) override.
_CONTAINER_RUNTIMES = ("docker", "podman", "nerdctl")


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
            cpus=_parse_positive("V2_CONTAINER_CPUS", "1", float),
            memory_mb=_parse_positive("V2_CONTAINER_MEMORY_MB", "1024", int),
            pids=_parse_positive("V2_CONTAINER_PIDS", "256", int),
            network=os.environ.get("V2_CONTAINER_NETWORK") or "bridge",
            extra_args=os.environ.get("V2_CONTAINER_EXTRA_ARGS"),
            allow_unisolated=os.environ.get("V2_ALLOW_UNISOLATED_CLI") == "1",
        )

    @property
    def container_available(self) -> bool:
        return self.strategy == "container" and bool(self.image or self.command_template)


def _forwarded_env(env: dict[str, str]) -> dict[str, str]:
    forwarded: dict[str, str] = {}
    for key, value in env.items():
        if not key.startswith(_FORWARDED_PREFIXES):
            continue
        if not _VALID_ENV_KEY.match(key):
            logger.warning("skipping malformed container env key: %r", key)
            continue
        forwarded[key] = value
    return forwarded


def _compact_number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def _docker_cli_env() -> dict[str, str]:
    """Minimal env for the ``docker`` CLI process itself.

    The container's secrets are passed via ``-e`` flags; the docker CLI only
    needs PATH/HOME and DOCKER_* connection settings. This avoids leaking the
    worker's unrelated secrets (AWS_*, GITHUB_TOKEN, ...) into the docker
    process environment.
    """
    return {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "TMPDIR"} or key.startswith("DOCKER_")
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

    Hardening: capabilities are dropped and new privileges forbidden so a
    prompt-injected CLI cannot escalate inside the container.

    Threat-model notes (operator must weigh these):
      * Secrets are forwarded via ``-e KEY=VALUE`` and are therefore visible
        through ``docker inspect`` and ``/proc/<pid>/environ`` to local users.
        For higher security, run a controlled egress proxy and drop secrets
        from the container env.
      * The default ``bridge`` network gives the CLI full outbound access, so
        a compromised CLI can exfiltrate the forwarded credentials. Set
        ``V2_CONTAINER_NETWORK=none`` (with a proxy) for high-security tasks.
      * ``command_template`` is a trusted-operator override: it is used verbatim
        and enforces NONE of the resource/network/mount guarantees below. It is
        reported separately as ``real-cli-custom`` so auditing can distinguish
        it from true image-based isolation.
    """
    if config.command_template:
        template = shlex.split(config.command_template)
        if not template or template[0] not in _CONTAINER_RUNTIMES:
            logger.warning(
                "V2_CONTAINER_COMMAND does not start with a recognized container "
                "runtime %s; the command runs as a custom override with NO enforced "
                "isolation.",
                _CONTAINER_RUNTIMES,
            )
        template.extend(cli_command)
        return template
    if not config.image:
        raise IsolationUnavailableError(
            "container isolation requested but no V2_CONTAINER_IMAGE is configured"
        )
    command = [
        "docker",
        "run",
        "--rm",
        "--force-rm",
        "-i",
        "--name",
        container_name,
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--cpus",
        _compact_number(config.cpus),
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
      - real-CLI adapter + image → docker-wrapped command, minimal docker env,
        mode ``"real-cli-container"``;
      - real-CLI adapter + command_template → custom command, minimal docker
        env, mode ``"real-cli-custom"`` (operator override, unenforced);
      - real-CLI adapter + no container + escape hatch → bare command with the
        caller's env, mode ``"real-cli-unisolated"`` (development only);
      - real-CLI adapter + no container + no escape hatch → raises
        :class:`IsolationUnavailableError` (fail-closed);
      - non-real-CLI adapter → bare command unchanged, mode ``"real-cli"``.
    """
    if not adapter_requires_isolation(adapter):
        return cli_command, env, "real-cli"
    if config.container_available:
        mode = "real-cli-custom" if config.command_template else "real-cli-container"
        return (
            build_isolated_command(
                config,
                cli_command,
                workspace=workspace,
                env=env,
                container_name=container_name,
            ),
            _docker_cli_env(),
            mode,
        )
    if config.allow_unisolated:
        logger.warning(
            "ISOLATION DISABLED: adapter '%s' is running on the bare host "
            "(V2_ALLOW_UNISOLATED_CLI=1). This is for local development only and "
            "MUST NOT be used in production.",
            adapter,
        )
        return cli_command, env, "real-cli-unisolated"
    raise IsolationUnavailableError(
        f"adapter '{adapter}' executes arbitrary commands and requires container "
        "isolation, but none is configured. Set V2_CONTAINER_IMAGE (or "
        "V2_CONTAINER_COMMAND) to run it inside a container. Bare-host execution "
        "is refused; set V2_ALLOW_UNISOLATED_CLI=1 to override for local "
        "development only."
    )


def resolve_verification_execution(
    config: V2IsolationConfig,
    command: list[str],
    *,
    workspace: Path,
    env: dict[str, str],
    container_name: str,
) -> tuple[list[str], dict[str, str] | None]:
    """Fail-closed resolution for a workspace ``test_command``.

    A workspace test command is arbitrary attacker-controlled argv (it comes
    from the task request), so it must ALWAYS run inside a container — there is
    no adapter exemption. Returns ``(command, popen_env)``; raises
    :class:`IsolationUnavailableError` when no container is configured and the
    escape hatch is not set.
    """
    if config.container_available:
        return (
            build_isolated_command(
                config,
                command,
                workspace=workspace,
                env=env,
                container_name=container_name,
            ),
            _docker_cli_env(),
        )
    if config.allow_unisolated:
        logger.warning(
            "ISOLATION DISABLED: workspace test_command is running on the bare "
            "host (V2_ALLOW_UNISOLATED_CLI=1). Development only."
        )
        return command, env
    raise IsolationUnavailableError(
        "workspace test_command executes arbitrary commands and requires "
        "container isolation, but none is configured. Set V2_CONTAINER_IMAGE "
        "(or V2_CONTAINER_COMMAND). Bare-host execution is refused; set "
        "V2_ALLOW_UNISOLATED_CLI=1 to override for local development only."
    )
