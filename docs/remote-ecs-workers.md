# 本地控制面接入远端 ECS 执行单元

本文适用于控制面仅监听本机 `127.0.0.1:8765`、ECS 只承担 `capacity=1` Qwen worker 的部署方式。它避免直接把控制面 HTTP 端口暴露到公网，适合开发机或 NAS 控制面。

## 架构与安全边界

```text
Browser -> local AgentFlow -> durable run queue -> reverse SSH tunnel
        -> ECS remote worker -> loopback qwen serve -> artifacts/events -> local AgentFlow
```

- 浏览器和主控数据仍留在本机或 NAS。
- ECS 使用仅包含 `workers:*` 的可撤销 token，不使用主控 token。
- SSH 反向端口只绑定 ECS 的 `127.0.0.1`。
- Qwen daemon 只绑定 ECS loopback，并使用随机 bearer token。
- 2C2G ECS 固定 `capacity=1`，不要同时运行构建、Playwright 和多个 Qwen 会话。

## 1. 建立可恢复的反向通道

复制示例并限制权限：

```bash
cp deploy/worker-tunnel.env.example .env.worker-tunnel-hk
chmod 600 .env.worker-tunnel-hk
```

编辑 SSH 目标和 PEM 绝对路径后启动：

```bash
./scripts/manage_worker_tunnel.sh start .env.worker-tunnel-hk
./scripts/manage_worker_tunnel.sh status .env.worker-tunnel-hk
```

脚本在 `.runtime/worker-tunnels/` 保存 pid 和日志；SSH 断开后会自动重连。每台 ECS 使用独立配置。不同 ECS 可以复用远端端口 `18765`，因为端口位于不同主机。

## 2. 创建 worker 专用 token

使用主控 token 调用：

```bash
curl -fsS http://127.0.0.1:8765/access/tokens \
  -H "Authorization: Bearer $RUN_MANAGER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"worker-ecs-hk","scopes":["workers:*"]}'
```

返回的 `token` 只显示一次。部署完成后可在 Admin -> Access 中撤销。

## 3. 一键安装 Qwen worker

新主机或需要由脚本管理 Qwen daemon：

```bash
RUN_WORKER_CONTROL_URL=http://127.0.0.1:18765 \
RUN_WORKER_TOKEN=cat_replace_me \
RUN_WORKER_ID=worker-ecs-hk \
RUN_WORKER_CAPACITY=1 \
RUN_WORKER_METADATA_JSON='{"region":"hk","labels":{"execution_unit_id":"ecs-hk"},"workspace":"/var/lib/cloud-agents-worker/workspace"}' \
QWEN_SETTINGS_FILE="$HOME/.qwen/settings.json" \
REPO_REF=main \
  ./scripts/deploy_worker_vps.sh root@203.0.113.10 /absolute/path/worker.pem
```

脚本会幂等执行以下步骤：

1. 安装或升级到 Node.js 22。
2. 安装固定版本的 `qwen-code`。
3. 同步指定 `REPO_REF`。
4. 以 `cloudagents` 用户启动受限的 `cloud-agents-qwen.service`。
5. 安装并启动 `cloud-agents-worker.service`。
6. 等待 Qwen 健康检查和 worker 心跳真正可见后才返回成功。

如果 ECS 已经有受保护的 Qwen daemon，可复用其环境文件，避免低内存主机启动第二个 daemon：

```bash
QWEN_MANAGED_SERVE=0 \
QWEN_SERVE_ENV_FILE=/etc/cloud-agents-runtime.env \
QWEN_SERVE_URL=http://127.0.0.1:4170 \
  ./scripts/deploy_worker_vps.sh root@203.0.113.10 /absolute/path/worker.pem
```

token 和 Qwen 配置通过 root-only 临时文件传输，不放在 SSH 命令行参数或公共 `/tmp` 中。

## 4. 注册产品执行单元

worker 心跳和产品执行单元是两个对象。两者通过同一个 `execution_unit_id` 标签关联：

```bash
curl -fsS http://127.0.0.1:8765/v2/admin/execution-units \
  -H "Authorization: Bearer $RUN_MANAGER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "unit_id":"ecs-hk",
    "kind":"ecs",
    "status":"active",
    "labels":{"region":"hk","size":"2c2g"},
    "resources":{"cpu":2,"memory_mb":1708},
    "adapters":["qwen"],
    "features":["remote-worker","artifacts","workspace"]
  }'
```

Client 的“执行设置（高级）”可以显式选择该单元；自动调度会在可用的 remote-worker 单元间稳定分配。后续消息默认沿用同一执行单元。

## 5. 验收与排障

```bash
curl -fsS http://127.0.0.1:8765/workers \
  -H "Authorization: Bearer $RUN_MANAGER_TOKEN"

ssh -i /absolute/path/worker.pem root@203.0.113.10 \
  'systemctl is-active cloud-agents-worker; systemctl is-active cloud-agents-qwen; qwen --version'
```

验收任务必须确认：

- V2 Task 的 `metadata.dispatch.execution_unit_id` 是目标 ECS。
- Task 产物中的 `adapter.execution_mode` 是 `remote-worker`。
- `remote_run_id` 对应队列中的 Run，`worker_id` 是目标 ECS worker。
- Run 具有 `message.delta`、`run.completed` 和远端上传产物。
- tunnel 或 worker 重启后，心跳恢复且新任务仍能完成。

常见问题：

| 现象 | 检查 |
| --- | --- |
| worker 一直离线 | tunnel status、ECS `127.0.0.1:18765`、worker journal |
| Qwen adapter not configured | `QWEN_SERVE_URL`、Qwen service health、token 是否一致 |
| 任务被本地执行 | worker 标签与执行单元 `unit_id` 是否一致 |
| workspace mismatch | metadata 中的 `workspace` 是否为 ECS 真实绝对路径 |
| 2C2G OOM | capacity 保持 1，停掉重复 Qwen daemon，检查 `MemoryCurrent` |

停止通道：

```bash
./scripts/manage_worker_tunnel.sh stop .env.worker-tunnel-hk
```
