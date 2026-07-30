---
title: "Durable Object Agent 运行时方案"
status: active
created: 2026-07-30
updated: 2026-07-30
tags: [durable-object, cloudflare, agent-runtime, actor-model]
sources:
  - url: https://x.com/Vercantez/status/2082138839888589200
    title: "Miguel Salinas — Agent on Durable Object with Agents SDK & Code Mode"
---

# Durable Object Agent 运行时方案

## 背景

2026-07-28，Miguel Salinas（[@Vercantez](https://x.com/Vercantez)）在 X 上分享了将 AI Agent 完全运行在 Cloudflare Durable Object 上的实践：

> "We rewrote our agent to run entirely in a Durable Object with Pi, Agents SDK and Code Mode"

## 方案概述

### 核心技术栈

| 组件 | 作用 |
|------|------|
| **Durable Object** | 有状态计算原语，每个 Agent 实例拥有独立持久存储和单线程一致性保证 |
| **Agents SDK** | Cloudflare 官方 Agent 框架，提供 Agent 基类、状态管理、WebSocket 通信 |
| **Code Mode** | Workers 沙箱中的代码执行能力，让 Agent 安全运行生成的代码 |

### 架构特点

- **Actor 模型**：每个 Agent 是一个 Durable Object 实例，天然隔离、天然持久
- **Write-through 持久化**：每次状态变更自动落盘，无需手动 reconcile
- **边缘部署**：全球分布，就近接入

### 社区反馈

- Nathan Flurry："虚拟操作系统是正确方向"
- Munawar Shah：受限沙箱环境反而让 Agent 更可靠——"砍了腿给了根拐杖，反而走得更快"
- Dylan Mikus 提问：Agent 迭代构建应用时，运行时在 Workers + DO 里如何处理？

## 可行性分析

### 优势

- **状态持久化零成本**：DO 内建持久存储，进程崩溃状态不丢，无需 SQLite + JSONL + 启动 reconcile
- **并发安全**：单线程一致性天然消除竞争，不需要 `RLock`、lease 续约、orphan job 回收
- **代码隔离**：Code Mode 沙箱天然隔离，不用自建 Docker/Podman 容器编排
- **运维极简**：无需管理服务器、数据库、消息队列

### 局限

- **执行时长受限**：DO 有 CPU 时间上限，无法支撑数十分钟甚至 12 小时的重型 CLI 任务
- **生态锁定**：绑死 Cloudflare，与 self-hostable（NAS / VPS / 裸金属）定位根本冲突
- **CLI 执行不现实**：V8 isolate 无法运行 qwen-code / codex / claude-code 等需要完整 Node.js + git + 文件系统的真实 CLI
- **成本**：高频 SSE 推送 + 大量存储写入在 DO 计费模型下不经济

### 适用场景判断

| 场景 | 是否适合 |
|------|----------|
| 轻量 API 编排 Agent（调 API、路由、状态管理） | ✅ 非常适合 |
| 多租户 SaaS Agent 服务 | ✅ 适合 |
| 驱动真实 coding CLI 的重型 Agent Runtime | ❌ 不适合 |
| 需要 self-host 的私有化部署 | ❌ 不适合 |

## 与 aflow 的关联

### 可借鉴的设计思想

#### 1. Actor-per-Entity：每个 Run/Task 一个独立 Actor

**aflow 现状**：`RunManager` 用全局 `RLock` 保护所有内存 dict，所有 run 的状态转换争同一把锁。

**借鉴方向**：将每个 Run/Task 的状态机封装为独立 actor（`asyncio.Task` + 消息队列，或每个 run 一个 `threading.Thread` + `queue.Queue`）：

- 消除全局锁竞争
- 每个 run 的 reconcile 逻辑自包含
- 崩溃恢复粒度更细，不用启动时做全局 `fail_orphaned_jobs` + `recover_expired_leases` + `missions.reconcile` 三连

#### 2. Write-through 持久化

**aflow 现状**：内存为主、SQLite 为辅，事件先写内存 list 再落盘，启动时需要 convergence 逻辑修补不一致。

**借鉴方向**：事件写入改为 write-through（先写 SQLite/Postgres，成功后更新内存投影）。`RuntimeDatabase` 已支持 Postgres advisory lock 和 `FOR UPDATE SKIP LOCKED`，基础设施就绪。可大幅简化 `recover_expired_leases` / `fail_orphaned_jobs` 等补偿逻辑。

#### 3. 事件流直挂 Task 实体

**aflow 现状**：SSE 从集中式 event store 读取，经 `ui_projection.py` 格式转换，中间隔多层。

**借鉴方向**：每个 task 的 SSE endpoint 直接订阅该 task 的事件写入（pub/sub）。单进程用 `threading.Condition`（已有）或 asyncio broadcast；多进程 / 多 worker 用 Postgres `LISTEN/NOTIFY` 或 Redis pub/sub。

### 不需要借鉴的

- **多租户物理隔离**：V2 RBAC + row-level 隔离对 self-host 场景足够
- **Code Mode 沙箱**：aflow 的 `isolation.py` fail-closed 容器隔离更适合真实 CLI 场景

## 结论与建议

DO 方案对轻量 API 编排 Agent 合理且优雅，但与 aflow 的重型 CLI Agent Runtime 不在同一赛道。**真正值得借鉴的是 actor-per-entity + write-through 持久化思想**，可在现有 Python + SQLite/Postgres 栈上落地，无需引入 Cloudflare 依赖。

### 后续行动

- [ ] 评估 RunManager actor-per-entity 重构的影响范围与迁移路径
- [ ] 在 V2 control plane 试点 write-through 事件写入
- [ ] 调研 Postgres `LISTEN/NOTIFY` 替代 SSE 轮询的可行性

## 参考资料

- [原始推文 — Miguel Salinas](https://x.com/Vercantez/status/2082138839888589200)
- [Cloudflare Durable Objects 文档](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
