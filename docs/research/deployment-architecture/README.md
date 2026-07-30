---
title: "aflow 部署架构：基于现有硬件的最优分配"
status: active
created: 2026-07-30
updated: 2026-07-30
tags: [deployment, architecture, hardware, worker, nas, ecs]
search_queries:
  - "aflow deployment architecture"
  - "self-hosted agent runtime hardware"
  - "distributed worker pool small cluster"
sources:
  - url: https://github.com/chiga0/aflow
    title: "aflow 项目仓库"
---

# aflow 部署架构：基于现有硬件的最优分配

## 背景

基于实际硬件条件设计 aflow 的部署架构，目标：最大化利用率、不引入不必要的分布式复杂度。

## 硬件清单

| 机器 | 配置 | 在线 | 强项 |
|------|------|:---:|------|
| **NAS（性能版）** | 多核 x86 / 16GB RAM / 大存储 | 7×24 | 永远在线、存储本地化 |
| **Mac Mini** | 16GB RAM / 512GB | 开机时 | 算力强、开发调试 |
| **ECS × 3** | 2c2g 每台 | 7×24 | 公网 IP、轻量任务 |

### 关键实测数据

qwen-code agent CLI 实际资源占用（macOS 实测）：

| 状态 | RSS 内存 | CPU |
|------|---------|-----|
| 活跃执行中 | 367-440MB（主进程 + 子进程） | 5-15%（突发） |
| 空闲等待 | 50-150MB | ~0% |
| 一次完整任务（含 git） | ~500-800MB | I/O 密集，CPU 非瓶颈 |

**结论**：2c2g ECS 可以跑 1 个并发 agent 任务（剩余 ~600MB-1GB），16GB 机器可以跑 3-5 个。

## 架构设计

```
                  公网 / 钉钉 / 飞书
                        │
                        ▼
          ┌─ ECS 1（2c2g）────────────┐
          │  Nginx + TLS 反代          │
          │  → NAS:8765（Tailscale）   │
          │  + Worker ×1（轻任务）     │
          └───────────────────────────┘
                        │
          ┌─ ECS 2（2c2g）────────────┐
          │  Worker ×1（轻任务）       │
          └───────────────────────────┘
                        │
          ┌─ ECS 3（2c2g）────────────┐
          │  Worker ×1（轻任务）       │
          └───────────────────────────┘
                        │
            Tailscale 虚拟网段
                        │
     ┌─ NAS（16GB）⭐ 主力 ──────────────────┐
     │                                        │
     │  aflow runtime（control plane + API）   │
     │  SQLite WAL（本地 SSD）                 │
     │  Worker ×3-4（日常 agent 任务）         │
     │  /artifacts（本地存储，无需挂载）        │
     │  /backups（每日自动备份）               │
     │  Prometheus + Grafana                   │
     │                                        │
     │  7×24 在线，任务来了随时跑              │
     └────────────────────────────────────────┘
                        │
            Tailscale（Mac Mini 开机时加入）
                        │
     ┌─ Mac Mini（16GB）──────────────────────┐
     │  Worker ×4-5（重任务 / 批量任务）       │
     │  大型重构、多文件修改、全量测试          │
     │  开发调试用                             │
     │  关机时任务自动漂移到 NAS + ECS         │
     └────────────────────────────────────────┘
```

## 各机器职责

### NAS — 主力（7×24）

| 服务 | 资源 | 说明 |
|------|------|------|
| aflow runtime | ~512MB | control plane + API + SQLite |
| Worker ×3-4 | ~2-3GB | 日常 agent 任务 |
| Prometheus + Grafana | ~512MB | 监控（aflow `/metrics` 已有） |
| 存储 | — | artifacts、backups、workspaces |
| **合计** | **~3-4GB / 16GB** | 余量充足 |

NAS 做主力的理由：
- **永远在线**：Mac Mini 会休眠/关机，NAS 不会
- **存储本地化**：产物直接写本地盘，无 NFS 延迟
- **备份天然**：RAID + 定时快照，数据安全性最高

### Mac Mini — 加速器（开机时）

| 服务 | 资源 | 说明 |
|------|------|------|
| Worker ×4-5 | ~3-4GB | 重任务、批量任务 |
| 开发环境 | ~2GB | 本地调试 aflow |
| **合计** | **~5-6GB / 16GB** | |

- 开机时加入 Tailscale 网段，worker 自动注册
- 关机时心跳超时，任务自动漂移（aflow 已有 lease 机制）

### ECS × 3 — 触手（公网 + 轻活）

| 机器 | 职责 | 并发 |
|------|------|:---:|
| ECS 1 | Nginx 反代 + TLS + Worker（轻任务） | 1 |
| ECS 2 | Worker（review gate / 文档生成） | 1 |
| ECS 3 | Worker（review gate / 文档生成） | 1 |

- 2c2g 跑 1 个 agent 任务实测可行（~1-1.4GB / 2GB）
- 只接轻任务（`--labels light,medium`），避免 OOM

## 并发能力

| 机器 | 并发 | 在线 | 任务类型 |
|------|:---:|:---:|------|
| NAS | 3-4 | 7×24 | 日常所有任务 |
| Mac Mini | 4-5 | 开机时 | 重任务、批量 |
| ECS × 3 | 1 × 3 | 7×24 | review、文档、轻任务 |
| **总计** | **10-12** | | |

## 任务路由

aflow worker 已有 claim 机制，通过标签路由：

```bash
# NAS worker：接所有任务
python -m cloud_agents_runtime.worker \
  --concurrency 4 --labels heavy,medium,light

# Mac Mini worker：接所有任务（重任务优先）
python -m cloud_agents_runtime.worker \
  --concurrency 5 --labels heavy,medium,light

# ECS worker：只接轻任务
python -m cloud_agents_runtime.worker \
  --concurrency 1 --labels light,medium
```

## 任务漂移（故障转移）

Mac Mini 关机或 ECS 宕机时，aflow 已有的 convergence 机制自动处理：

```
Worker 宕机
  → 心跳超时（store.prune_stale_workers）
  → 未完成任务 lease 过期（store.recover_expired_leases）
  → 任务重新入队
  → 其他 Worker claim 继续执行
```

无需额外开发。

## 网络拓扑

```
Tailscale 虚拟网段（100.x.y.0/24）
├── NAS:        100.x.y.1  ← aflow runtime API（:8765）
├── Mac Mini:   100.x.y.2  ← worker → NAS:8765
├── ECS 1:      100.x.y.3  ← Nginx 反代 + worker
├── ECS 2:      100.x.y.4  ← worker
└── ECS 3:      100.x.y.5  ← worker

公网 → ECS 1:443（Nginx）→ Tailscale → NAS:8765
```

## 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据库 | SQLite WAL（NAS 本地） | 单机场景够用，不引入 PG 运维 |
| 隔离 | Docker（默认 runtime） | 所有机器都支持，NAS 装不了 gVisor |
| 公网接入 | Tailscale + ECS Nginx | 零配置组网，ECS 做 TLS 终端 |
| 持久化 | SQLite write-through + NAS 本地备份 | 简单可靠 |
| 监控 | Prometheus on NAS | aflow 已有 `/metrics`，NAS 7×24 收集 |
| 云沙箱 | 不需要 | 10-12 并发足够，无需 E2B |

## 不推荐做的事

| ❌ | 理由 |
|----|------|
| 上 PostgreSQL | 单机 SQLite 够用，PG 是分布式场景才需要 |
| 上 Temporal / Restate | 5+ 组件运维成本远超收益 |
| 自托管 E2B | 需要 7+ 台机器 + 嵌套虚拟化 |
| NAS 只做存储 | 16GB 性能 NAS 只当 NFS 用是浪费 |
| ECS 跑重任务 | 2GB RAM 跑大型重构会 OOM |

## 后续行动

- [ ] NAS 上部署 aflow runtime（docker-compose.runtime.yml）
- [ ] 配置 Tailscale 组网（NAS + Mac Mini + ECS × 3）
- [ ] ECS 1 配置 Nginx 反代 + TLS
- [ ] 各 worker 配置标签和并发数
- [ ] NAS 上部署 Prometheus + Grafana
- [ ] 验证任务漂移：Mac Mini 关机后任务自动转移到 NAS

## 参考资料

- [aflow 部署文档](../../deployment-scenarios.md)
- [aflow 自部署指南](../../self-deploy.md)
- [Agent 隔离与持久化调研](../agent-sandbox-isolation-persistence/README.md)
