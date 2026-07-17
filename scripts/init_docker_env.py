#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = REPO_ROOT / "deploy" / "runtime.2c2g-qwen.env.example"


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    if output.exists() and not args.force:
        raise FileExistsError(f"{output} already exists; pass --force to replace it")

    workspace = Path(args.workspace).expanduser().resolve()
    settings = Path(args.qwen_settings).expanduser().resolve()
    if not workspace.is_dir():
        raise NotADirectoryError(f"workspace does not exist: {workspace}")
    if not settings.is_file():
        raise FileNotFoundError(f"Qwen settings file does not exist: {settings}")

    values = {
        "RUN_MANAGER_TOKEN": secrets.token_urlsafe(32),
        "RUNTIME_BOOTSTRAP_PASSWORD": secrets.token_urlsafe(24),
        "RUN_MANAGER_SESSION_SECRET": secrets.token_urlsafe(32),
        "RUN_MANAGER_BOOTSTRAP_EMAIL": args.email,
        "AGENTFLOW_WORKSPACE_DIR": str(workspace),
        "QWEN_SETTINGS_FILE": str(settings),
        "RUNTIME_UID": str(args.uid),
        "RUNTIME_GID": str(args.gid),
    }
    lines = DEFAULT_TEMPLATE.read_text(encoding="utf-8").splitlines()
    rendered: list[str] = []
    seen: set[str] = set()
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line and not line.startswith("#") else ""
        if key in values:
            rendered.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            rendered.append(line)
    for key in ["RUNTIME_UID", "RUNTIME_GID"]:
        if key not in seen:
            rendered.append(f"{key}={values[key]}")

    output.write_text("\n".join(rendered) + "\n", encoding="utf-8")
    os.chmod(output, 0o600)
    print(f"created {output} with mode 0600")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a secret Docker env file")
    parser.add_argument("--output", default=REPO_ROOT / ".env.docker")
    parser.add_argument("--workspace", default=REPO_ROOT)
    parser.add_argument("--qwen-settings", default=Path.home() / ".qwen" / "settings.json")
    parser.add_argument("--email", default="owner@example.com")
    parser.add_argument("--uid", type=int, default=os.getuid())
    parser.add_argument("--gid", type=int, default=os.getgid())
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
