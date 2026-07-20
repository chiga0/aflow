# aflow

aflow is a self-hostable Agent runtime for long-running cloud execution,
human approval, worker scheduling, audit trails, and recovery.

Online site: https://chiga0.github.io/aflow/

## Reading path

Start with the learner-facing docs before jumping into the design notes:

- [认识 aflow](docs/getting-started.md)
- [核心概念](docs/concepts.md)
- [使用管理台](docs/user-guide.md)
- [从部署到可用产品的完整教程](docs/deployment-runbook.md)
- [钉钉、飞书、企业微信机器人接入](docs/channel-integrations.md)
- [执行单元发现、注册与调度](docs/execution-units.md)
- [架构走读](docs/architecture-walkthrough.md)
- [排障手册](docs/troubleshooting.md)
- [产品可用性审计](docs/implementation/product-usability-audit.md)

## Local preview

```bash
python3 -m pip install -r requirements.txt
mkdocs serve
```

## aflow Runtime

The runtime lives in [runtime](runtime/). It provides a stdlib Run Manager with
`/runs`, `/missions`, `/workers`, `/executors`, `/auth`, `/access`, and
artifact/audit APIs over a pluggable SAEU adapter boundary.

```bash
python3 -m runtime.cloud_agents_runtime --host 127.0.0.1 --port 8765
python3 -m unittest discover -s runtime/tests
```

## Local/NAS quick start

Docker with Compose v2 is the only prerequisite. The helper generates private
credentials, builds the complete Runtime and Web image, registers the co-located
execution unit, waits for health, and runs an HTTP smoke test.

```bash
make local-up
make local-demo
```

Open `http://127.0.0.1:8765`. The login email is printed after startup; the generated
password stays in `.env.local`, which is mode `0600` and ignored by Git.

The default demo uses the deterministic adapter so first startup does not depend on
third-party credentials. See the
[deployment runbook](docs/deployment-runbook.md#3-快速路径-a本机或-nas-作为控制面)
for LAN exposure, real CLI adapters, diagnostics, and shutdown.
