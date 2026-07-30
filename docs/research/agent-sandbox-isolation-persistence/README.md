---
title: "云端 Agent 隔离、沙箱与持久化技术图谱"
status: active
created: 2026-07-30
updated: 2026-07-30
tags: [sandbox, isolation, persistence, microvm, container, durable-execution, agent-runtime]
search_queries:
  - "AI agent sandbox isolation code execution"
  - "AI agent persistence durable execution state"
  - "firecracker microvm agent"
  - "gvisor container sandbox"
  - "e2b daytona modal agent sandbox"
  - "restate temporal durable agent workflow"
sources:
  - url: https://github.com/e2b-dev/e2b
    title: "E2B — Cloud sandboxes for AI agents（13.2k stars）"
  - url: https://github.com/daytonaio/daytona
    title: "Daytona — Secure infra runtime for AI code execution（72.1k stars）"
  - url: https://modal.com
    title: "Modal — Serverless AI compute with sandboxes"
  - url: https://github.com/firecracker-microvm/firecracker
    title: "Firecracker — AWS microVM（28k+ stars）"
  - url: https://github.com/google/gvisor
    title: "gVisor — Google userspace application kernel（16k+ stars）"
  - url: https://github.com/restatedev/restate
    title: "Restate — Durable execution engine（7k+ stars）"
  - url: https://fly.io/docs/machines/
    title: "Fly Machines — Subsecond VMs"
  - url: https://github.com/diggerhq/opensandbox
    title: "Open Sandbox — Rust process-level sandbox（~100ms startup）"
---

# 云端 Agent 隔离、沙箱与持久化技术图谱

## 背景

云端 Agent 需要解决三个核心基础设施问题：

1. **隔离**：Agent 执行的代码（尤其是 AI 生成的代码）不能逃逸到宿主环境
2. **沙箱**：提供受控的执行环境（文件系统、网络、进程），同时允许 Agent 完成真实工作
3. **持久化**：Agent 的状态（对话、工具调用进度、中间产物）在崩溃、重启、迁移后不丢失

传统方案（Docker 容器 + SQLite）能工作，但存在隔离强度不足、启动慢、状态管理手动等问题。本文梳理 2025-2026 年出现或成熟的替代技术，评估其对 aflow 的适用性。

## 技术全景

```
隔离强度 ↑
│
│  Full VM (QEMU/KVM)
│  ┌─────────────────────────────────────────────────┐
│  │  MicroVM (Firecracker, Fly Machines)            │
│  │  ┌───────────────────────────────────────────┐  │
│  │  │  Userspace Kernel (gVisor)                │  │
│  │  │  ┌─────────────────────────────────────┐  │  │
│  │  │  │  Container (Docker, Podman)         │  │  │
│  │  │  │  ┌───────────────────────────────┐  │  │  │
│  │  │  │  │  Process (bubblewrap, seccomp)│  │  │  │
│  │  │  │  │  ┌─────────────────────────┐  │  │  │  │
│  │  │  │  │  │  V8 Isolate (CF Workers)│  │  │  │  │
│  │  │  │  │  │  WASM (Wasmtime)        │  │  │  │  │
│  │  │  │  │  └─────────────────────────┘  │  │  │  │
│  │  │  │  └───────────────────────────────┘  │  │  │
│  │  │  └─────────────────────────────────────┘  │  │
│  │  └───────────────────────────────────────────┘  │
│  └─────────────────────────────────────────────────┘
│
└──────────────────────────────────────────────────────→ 启动速度 ↑
```

## 一、隔离与沙箱技术

### 1.1 容器级（aflow 现状）

| 技术 | 隔离机制 | 启动时间 | 开销 | 适用性 |
|------|----------|----------|------|--------|
| **Docker / Podman** | namespace + cgroup + 共享内核 | ~1-5s | 低 | aflow 当前方案，`isolation.py` fail-closed |
| **gVisor** (`runsc`) | 用户态内核（Go 实现），拦截 syscall | ~1-2s | 中（syscall 开销） | 兼容 Docker/K8s，无需改代码 |
| **Kata Containers** | 轻量 VM + 容器接口 | ~2-5s | 中 | 兼容 OCI，K8s 原生 |

**gVisor 详解**（[GitHub](https://github.com/google/gvisor)，16k+ stars）：

- Google 开发，用 Go 在用户态实现了一个 Linux 兼容内核（Sentry）
- 应用 syscall → Sentry 拦截 → 仅必要时调用宿主内核
- 文件操作通过独立的 Gofer 进程代理，应用无法直接访问宿主文件系统
- **不是** syscall 过滤器（seccomp），**不是** VM，是第三条路
- 已用于 Google Cloud Run、GKE Sandbox
- **对 aflow 的意义**：可以将 `docker run` 替换为 `docker run --runtime=runsc`，零代码改动提升隔离强度

### 1.2 MicroVM 级

| 技术 | 隔离机制 | 启动时间 | 内存开销 | 适用性 |
|------|----------|----------|----------|--------|
| **Firecracker** | KVM microVM，极简设备模型 | <125ms | 最低 128MiB | AWS Lambda/Fargate 底层 |
| **Fly Machines** | Firecracker + 全球边缘 | <1s（亚秒） | 按配置 | REST API 驱动，按秒计费 |
| **Cloud Hypervisor** | KVM，Rust 实现 | ~200ms | 中 | Intel 主导，Firecracker 替代 |

**Firecracker 详解**（[GitHub](https://github.com/firecracker-microvm/firecracker)，28k+ stars）：

- AWS 开发，Lambda 和 Fargate 的底层技术
- 极简 VMM：去掉 BIOS、PCI、USB 等不必要设备，攻击面最小化
- Jailer 进程：启动前施加 cgroup/namespace 隔离 + 降权
- 线程级 seccomp 过滤
- **对 aflow 的意义**：如果未来需要多租户 SaaS 化，每个 agent task 跑在独立 microVM 里是最强隔离。但 self-host 场景下 Docker 已够用

**Fly Machines 详解**（[文档](https://fly.io/docs/machines/)）：

- 亚秒启动/停止的轻量 VM，REST API 全生命周期管理
- 支持持久化 Volumes
- 全球多区域部署
- **对 aflow 的意义**：适合"按需启动 agent 执行环境"的模式，但引入外部依赖

### 1.3 进程级

| 技术 | 隔离机制 | 启动时间 | 开销 | 适用性 |
|------|----------|----------|------|--------|
| **bubblewrap** (`bwrap`) | namespace + seccomp | ~10ms | 极低 | Flatpak 底层，Linux only |
| **sandbox-exec** | macOS Seatbelt | ~10ms | 极低 | macOS only |
| **seccomp-BPF** | syscall 过滤 | 0（进程内） | 极低 | 精细控制但配置复杂 |
| **Open Sandbox** | Rust 进程级沙箱 | ~100ms | 低 | 专为 AI agent 设计 |

**Open Sandbox**（[GitHub](https://github.com/diggerhq/opensandbox)）：

- Rust 实现，专为 AI agent 代码执行设计
- ~100ms 启动，比 microVM 快一个数量级
- 自托管，开源
- **对 aflow 的意义**：如果 aflow 需要在同一台机器上快速隔离执行 review gate 脚本，进程级沙箱比启动容器快得多

### 1.4 V8 / WASM 级

| 技术 | 隔离机制 | 启动时间 | 限制 | 适用性 |
|------|----------|----------|------|--------|
| **V8 Isolate** (CF Workers) | V8 引擎内存隔离 | ~5ms | 无文件系统/git/CLI | 轻量 API agent（见 DO 调研） |
| **Wasmtime / WasmEdge** | WASM 线性内存 | ~1ms | 生态不成熟，无完整 OS 能力 | 插件/工具沙箱 |

**对 aflow 的意义**：不适合驱动真实 CLI，但适合沙箱化 review gate 的验证脚本（类似 Code Mode 思路）。

### 1.5 Agent 专用沙箱平台

| 平台 | 隔离方式 | 启动时间 | 持久化 | Stars | 特色 |
|------|----------|----------|--------|-------|------|
| **[E2B](https://github.com/e2b-dev/e2b)** | 云端 microVM | ~150ms | 临时（ephemeral） | 13.2k | Code Interpreter SDK，JS/Python SDK |
| **[Daytona](https://github.com/daytonaio/daytona)** | 独立内核沙箱 | <90ms | 快照 + Volumes | 72.1k | 完整计算机（FS/网络/PTY），MCP Server |
| **[Modal](https://modal.com)** | 容器 + 沙箱 | 亚秒冷启动 | Volumes | — | GPU 支持（H100/B200），按秒计费 |
| **[Coasty](https://coasty.ai)** | 云端 VM | — | — | — | Computer-use agent API（YC S26） |

**Daytona 详解**（72.1k stars，但 2026-06 已转私有仓库）：

- 每个沙箱 = 一台完整计算机：独立内核、文件系统、网络栈、vCPU/RAM/磁盘
- <90ms 启动
- 支持快照（snapshot）：冻结/恢复整个沙箱状态
- SDK 覆盖 Python / TypeScript / Ruby / Go / Java
- 内建 MCP Server、Web Terminal、SSH/VNC
- **⚠️ 风险**：核心已转私有，开源版不再维护

**E2B 详解**（13.2k stars，Apache-2.0）：

- 云端 microVM 沙箱，专为 AI 生成代码设计
- Code Interpreter SDK：类似 Jupyter 的代码块执行
- 支持自托管（Terraform，AWS/GCP/Azure/Linux）
- JS/Python SDK
- **对 aflow 的意义**：最接近 aflow 需求的开源方案——可以替代自建 Docker 隔离，但引入外部服务依赖

## 二、持久化与持久执行

### 2.1 技术对比

| 技术 | 模型 | 持久化粒度 | 崩溃恢复 | 适用性 |
|------|------|------------|----------|--------|
| **Temporal** | 工作流即代码，事件溯源 | 工作流 + Activity | 自动重放 | aflow 已有 POC（`temporal_bridge.py`） |
| **[Restate](https://github.com/restatedev/restate)** | 持久执行引擎 | 每实体 K/V + 执行进度 | 自动恢复部分进度 | 比 Temporal 轻量，单二进制 |
| **Durable Objects** | Actor + 内建 SQLite | 每实例 SQLite | 自动（见 DO 调研） | Cloudflare 锁定 |
| **Event Sourcing** | 追加式事件日志 | 事件流 | 重放 | aflow 已有（`events.jsonl`） |
| **快照（Snapshot）** | VM/进程内存快照 | 整个执行环境 | 从快照恢复 | Daytona / Morph Cloud |

### 2.2 Restate 详解

[Restate](https://github.com/restatedev/restate)（7k+ stars）是 Temporal 的轻量替代：

- **单二进制部署**，无需 Cassandra/Postgres/Redis 集群
- 代码执行到完成；失败时自动重试，**跳过已完成步骤**（不重复执行）
- 长时间等待（timer、webhook）时**挂起**代码，释放资源，promise resolve 后恢复
- 每实体隔离 K/V 状态，与执行进度一起持久化
- 支持 exactly-once 通信语义
- 内建 OpenTelemetry trace
- **对 aflow 的意义**：如果 V2 control plane 的 background runner 需要持久执行保证，Restate 比 Temporal 部署成本低得多（单进程 vs 5+ 组件）

### 2.3 快照模式（Snapshot-based Persistence）

传统持久化是"记录做了什么"（event sourcing），快照模式是"冻结整个执行环境"：

- **Daytona**：沙箱快照 = 完整计算机状态（内存 + 磁盘 + 进程）
- **Firecracker**：支持 VM 快照/恢复（AWS Lambda SnapStart 底层）
- **优势**：恢复速度极快（无需重放事件），对长时间运行任务友好
- **劣势**：快照体积大，存储成本高，跨架构不兼容

**对 aflow 的意义**：对 12 小时级别的 agent 任务，"执行到一半 → 快照 → 需要时恢复"比事件重放更实际。但需要容器/microVM 级支持。

## 三、综合对比矩阵

| 维度 | Docker (现状) | gVisor | Firecracker | E2B | Daytona | DO |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 隔离强度 | ★★★ | ★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★ |
| 启动速度 | ★★ | ★★ | ★★★★ | ★★★★ | ★★★★★ | ★★★★★ |
| CLI 支持 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 持久化 | 手动 | 手动 | 快照 | 临时 | 快照+卷 | 自动 |
| 自托管 | ✅ | ✅ | ✅ | ✅ | ⚠️ 停维 | ❌ |
| 资源开销 | 低 | 中 | 中 | — | 中 | 极低 |
| 改造成本 | — | 极低 | 高 | 中 | 中 | 不可行 |

## 四、与 aflow 的关联

### 短期可落地（低成本）

1. **gVisor 替换 Docker runtime**
   - `docker run --runtime=runsc` 或 Docker daemon 配置 `default-runtime: runsc`
   - 零代码改动，`isolation.py` 逻辑不变
   - 隔离强度从"共享内核"提升到"用户态内核"
   - 代价：部分 syscall 性能下降（I/O 密集场景 ~10-30%）

2. **进程级沙箱用于 review gate**
   - review gate 验证脚本不需要完整容器，用 bubblewrap（Linux）或 sandbox-exec（macOS）
   - 启动从 ~3s 降到 ~10ms
   - 在 `isolation.py` 中增加 `process` 隔离级别

### 中期可评估（需要原型）

3. **Restate 替代 Temporal POC**
   - 当前 Temporal 需要 5+ 组件（server + worker + Cassandra/Postgres + Redis + UI）
   - Restate 单二进制，内建状态持久化
   - 适合 V2 control plane 的 background runner 持久化
   - 评估点：Restate 的 Python SDK 成熟度、社区活跃度

4. **E2B 自托管评估**
   - 如果 aflow 需要 SaaS 化，E2B 的 microVM 沙箱 + Code Interpreter 是成熟方案
   - 自托管 via Terraform（AWS/GCP/Azure/Linux）
   - 评估点：与 aflow adapter 模式的集成成本

### 长期方向（架构演进）

5. **快照式持久化**
   - 对 12 小时级 agent 任务，event replay 不现实
   - Firecracker 快照 / 容器 checkpoint（CRIU）
   - 需要容器/microVM 级支持，与 gVisor 不兼容（gVisor 不支持 CRIU）

6. **per-entity 资源上限**
   - 无论选择哪种隔离技术，都需要：
     - CPU time 上限（防止 $34k 式失控）
     - 事件数 / 存储量上限
     - 异常检测 + 自动熔断
   - 参考 Cloudflare DO 的 $34k 事故教训（见 [DO 调研](../durable-object-agent/README.md)）

## 五、结论

### 核心判断

| 判断 | 理由 |
|------|------|
| **Docker 隔离对 self-host 够用，但 gVisor 是零成本升级** | 改一个 runtime 参数即可 |
| **Agent 专用沙箱（E2B/Daytona）是 SaaS 化的正确方向** | 但 Daytona 已停维，E2B 是更稳的选择 |
| **持久化应走 write-through + 持久执行引擎** | Restate 比 Temporal 轻量，适合 aflow 体量 |
| **快照式持久化是长时间任务的终极方案** | 但技术栈要求高（Firecracker/CRIU），中期再评估 |
| **V8/WASM 不适合 aflow 核心场景** | 无法驱动真实 CLI，仅适合 review gate 沙箱 |

### 推荐优先级

1. **gVisor runtime 替换**（改造成本：极低，收益：隔离强度 +1 级）
2. **进程级沙箱 for review gate**（改造成本：低，收益：启动速度 100x）
3. **Restate 评估**（改造成本：中，收益：替代 Temporal 5 组件部署）
4. **E2B 自托管 POC**（改造成本：中，收益：SaaS 化基础设施）
5. **快照式持久化调研**（改造成本：高，收益：12h+ 任务支持）

## 参考资料

### 隔离与沙箱
- [gVisor（GitHub）](https://github.com/google/gvisor) — Google 用户态内核，16k+ stars
- [Firecracker（GitHub）](https://github.com/firecracker-microvm/firecracker) — AWS microVM，28k+ stars
- [E2B（GitHub）](https://github.com/e2b-dev/e2b) — AI agent 云沙箱，13.2k stars，Apache-2.0
- [Daytona（GitHub）](https://github.com/daytonaio/daytona) — AI 代码执行运行时，72.1k stars（⚠️ 已转私有）
- [Modal](https://modal.com) — Serverless AI 计算 + 沙箱
- [Fly Machines](https://fly.io/docs/machines/) — 亚秒 VM
- [Open Sandbox](https://github.com/diggerhq/opensandbox) — Rust 进程级沙箱，~100ms

### 持久化与持久执行
- [Restate（GitHub）](https://github.com/restatedev/restate) — 持久执行引擎，7k+ stars
- [Temporal](https://temporal.io) — 工作流引擎（aflow 已有 POC）
- [Cloudflare Agents SDK](https://github.com/cloudflare/agents) — DO 持久化（见 [DO 调研](../durable-object-agent/README.md)）

### 安全与事故
- [HN — DO alarm loop $34k](https://news.ycombinator.com/item?id=47787042) — per-entity 资源上限的必要性
- [Execwall](https://github.com/sundarsub/execwall) — AI agent seccomp-BPF 防火墙
- [Traceforce（YC S26）](https://www.traceforce.ai) — AI 应用安全监控
