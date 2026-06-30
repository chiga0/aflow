# 沙箱与隔离方案

> 结论：1-2 台小 VPS 不需要一开始上 Kubernetes 或多 ECS。建议用 Docker/rootless Docker、Git worktree、资源限制、网络出口控制和 model proxy 起步；当任务包含不可信代码或高风险网络访问时，把 sandbox worker 放到第二台 VPS。

## 隔离目标

Agent 沙箱不是只防止误删文件，它至少要控制五类风险：

| 风险 | 目标 |
| --- | --- |
| 文件系统破坏 | Agent 只能写自己的 workspace，不能碰宿主机和其他 run |
| 进程失控 | 限制 CPU、内存、进程数、运行时长，避免拖垮 VPS |
| 网络外联 | 默认最小网络权限，必要时经过 egress proxy |
| 密钥泄漏 | 真实模型 key、Git 凭证、云密钥不进入 Agent 容器 |
| 工具滥用 | 高风险 shell、git push、外部目录、密钥读取必须审批 |

## 推荐分级

| 等级 | 适用任务 | 隔离方式 | 部署建议 |
| --- | --- | --- | --- |
| L0 | 自己可信仓库、只读分析 | Git worktree + 进程超时 | 本机或单 VPS |
| L1 | 普通代码修改、测试、构建 | Docker + cgroups + seccomp + worktree | 单 VPS 可用 |
| L2 | 第三方仓库、未知脚本、网络工具 | Docker + egress proxy + 独立 worker 节点 | 双 VPS 更稳 |
| L3 | 恶意代码假设、强安全边界 | microVM/Firecracker/gVisor/Kata | 小 VPS 不建议起步 |

当前资源条件下，优先实现 L1，再用第二台 VPS 获得 L2 的爆炸半径隔离。

## Docker 运行策略

建议每个 run 一个容器，每个容器绑定一个独立 workspace：

```bash
docker run --rm \
  --name agent-run-xxx \
  --memory=768m \
  --cpus=0.75 \
  --pids-limit=256 \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --security-opt=seccomp=default \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --network none \
  -u 1000:1000 \
  -v /srv/agent/workspaces/run-xxx:/workspace:rw \
  -w /workspace \
  qwen-code-runner:latest
```

说明：

- `--memory`、`--cpus`、`--pids-limit` 控制资源。
- `--cap-drop=ALL` 和 `no-new-privileges` 降低提权风险。
- `--read-only` 让容器根文件系统不可写，只开放 `/workspace` 和 `/tmp`。
- `--network none` 是最安全默认值，但 coding agent 通常需要模型 API 和包管理网络，因此生产中更常用受控网络。
- `-u 1000:1000` 避免容器内 root 写出 root-owned 文件。

## 网络控制

Qwen Code 需要访问模型 API，部分任务也会用到 GitHub、npm、pip、apt 或文档站。不要把真实 API key 和全量公网直接交给容器。

推荐两种模式：

### 模式 A：受控出口网络

容器加入专用 Docker network，只能访问 egress proxy：

```text
agent container -> egress proxy -> allowlist domains
```

allowlist 起步可以包含：

- 模型网关域名。
- GitHub 只读访问。
- npm/pip registry。
- 用户明确允许的业务域名。

### 模式 B：模型代理隔离

Agent 只知道内部 `MODEL_PROXY_URL`，不持有真实模型 key：

```text
agent container -> model proxy -> OpenAI / Anthropic / Qwen / Gemini
```

model proxy 负责：

- 注入真实 API key。
- 按 tenant/run 限额。
- 记录 token、成本、延迟和错误。
- 做模型降级、重试和熔断。

这比把 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DASHSCOPE_API_KEY` 直接注入容器安全得多。

## 文件系统与 workspace

每个 run 应当有独立目录：

```text
/srv/agent/
  workspaces/
    run-001/
    run-002/
  artifacts/
    run-001/
      transcript.jsonl
      diff.patch
      final.md
  tmp/
```

推荐规则：

- 从 Git 仓库创建 worktree 或 shallow clone。
- workspace 只挂载当前 run 目录。
- artifact 目录由 worker supervisor 写入，Agent 不直接写系统级 artifact 索引。
- 禁止挂载宿主机 `/var/run/docker.sock`。
- 禁止挂载用户 home、SSH key、云厂商 credential 目录。

## 权限策略

高风险动作必须进入审批或策略拒绝：

| 动作 | 默认策略 |
| --- | --- |
| 读取 `.env`、`id_rsa`、云 credential | deny 或 ask |
| 写 workspace 外目录 | deny |
| `rm -rf`、磁盘清理、权限变更 | ask |
| `git push`、发布包、部署命令 | ask |
| 外部网络扫描、curl 任意地址 | ask 或 deny |
| 安装系统包 | ask |
| 启动长期 daemon | ask 并设置超时 |

Qwen Code 和 OpenCode 都已经体现了类似思路：权限不是“允许 shell”这么粗，而是对工具、路径、命令、模式和会话状态做细粒度控制。

## 什么时候需要第二台 VPS

如果满足任一条件，建议把 sandbox worker 拆到第二台机器：

- 运行陌生用户提交的仓库。
- 允许 Agent 执行测试脚本、安装依赖或访问公网。
- 需要跑多个并发 Agent。
- 宿主机上有重要数据库、密钥或其他服务。
- 任务会修改部署配置、CI/CD、云资源。

两台 VPS 的最小网络拓扑：

```text
VPS-1 control plane:
  API / Postgres / Event Store / Model Proxy

VPS-2 sandbox worker:
  Worker Supervisor / Docker / Workspaces

连接方式:
  WireGuard 或 Tailscale 内网
```

## Docker 的边界

Docker 是很好的工程隔离工具，但不是恶意代码强安全边界：

- 容器共享宿主机内核。
- 内核漏洞可能导致逃逸。
- rootful Docker daemon 权限很高。
- 网络、挂载、capability 配置错误会直接破坏隔离。

因此：

- 普通 coding agent：Docker 足够起步。
- 不可信代码：至少独立 worker VPS。
- 恶意对抗场景：需要 microVM、gVisor、Kata 或云厂商隔离环境。

## 最小落地清单

1. 为每个 run 创建独立 workspace。
2. 以非 root 用户运行容器。
3. 设置 CPU、内存、进程数、运行时长。
4. 禁止 Docker socket 和宿主机敏感目录挂载。
5. 模型 key 只放在 model proxy。
6. 高风险工具调用进入 permission flow。
7. 容器 stdout/stderr、Agent JSONL、diff、artifact 持久化。
8. run 结束后清理容器，按保留策略清理 workspace。

## 参考资料

- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)
- [Docker seccomp](https://docs.docker.com/engine/security/seccomp/)
- [Docker none network driver](https://docs.docker.com/engine/network/drivers/none/)
