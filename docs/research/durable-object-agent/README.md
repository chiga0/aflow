---
title: "Durable Object Agent 运行时方案"
status: active
created: 2026-07-30
updated: 2026-07-30
tags: [durable-object, cloudflare, agent-runtime, actor-model, agents-sdk, mcp]
search_queries:
  - "cloudflare durable objects AI agent"
  - "cloudflare agents sdk"
  - "durable object stateful agent runtime"
  - "actor model agent orchestration"
  - "cloudflare agents sdk code mode"
sources:
  - url: https://x.com/Vercantez/status/2082138839888589200
    title: "Miguel Salinas — Agent on Durable Object with Agents SDK & Code Mode"
  - url: https://github.com/cloudflare/agents
    title: "Cloudflare Agents SDK（GitHub，5.3k stars）"
  - url: https://developers.cloudflare.com/agents/
    title: "Cloudflare Agents SDK 官方文档"
  - url: https://blog.cloudflare.com/building-ai-agents-with-mcp-authn-authz-and-durable-objects/
    title: "Cloudflare Blog — Building AI Agents with MCP, AuthN/AuthZ, and Durable Objects"
  - url: https://news.ycombinator.com/item?id=47787042
    title: "HN — Durable Object alarm loop: $34k in 8 days, zero users"
---

# Durable Object Agent 运行时方案

## 背景

2026-07-28，Miguel Salinas（[@Vercantez](https://x.com/Vercantez)）在 X 上分享了将 AI Agent 完全运行在 Cloudflare Durable Object 上的实践：

> "We rewrote our agent to run entirely in a Durable Object with Pi, Agents SDK and Code Mode"

这不是一个孤立的实验——Cloudflare 已将 Agents SDK 作为一级产品推进，GitHub 仓库 [cloudflare/agents](https://github.com/cloudflare/agents) 有 **5.3k stars、1458 commits、30+ 官方示例**，覆盖 chat、voice、MCP、workflows、Code Mode 等场景。

## 方案概述

### 核心技术栈

| 组件 | 作用 | 成熟度 |
|------|------|--------|
| **Durable Object** | 有状态计算原语，每个 Agent 实例拥有独立 SQLite 存储和单线程一致性 | GA，已纳入免费层 |
| **Agents SDK** (`agents` npm) | Agent 基类、`@callable()` RPC、状态同步、WebSocket、调度、子 agent 组合 | 活跃迭代中（不接受外部 PR） |
| **Code Mode** (`@cloudflare/agents/codemode`) | LLM 生成 TypeScript 代替逐个 tool call，在隔离 Worker 沙箱中执行 | 实验性 |
| **MCP 集成** | Agent 可同时作为 MCP Server（暴露工具）和 MCP Client（连接外部服务） | 支持 OAuth 2.1 |
| **Workflows** | 持久化多步任务，支持 human-in-the-loop 审批 | GA |

### SDK 架构（四层）

```
┌─────────────────────────────────────────────────┐
│  Communication Channels                         │
│  Chat / Voice / Email / Slack / Webhooks        │
├─────────────────────────────────────────────────┤
│  Agent Harness                                  │
│  控制循环：规划 → 工具调用 → 响应 → 模型交互     │
├─────────────────────────────────────────────────┤
│  Agents SDK Runtime                             │
│  Agent 类 / 状态管理 / Session / 路由 /          │
│  WebSocket / 调度 / Fibers / 可观测性            │
├─────────────────────────────────────────────────┤
│  Tools                                          │
│  浏览器自动化 / 沙箱代码执行 / AI Search /       │
│  MCP Tools / x402 支付 / Code Mode              │
└─────────────────────────────────────────────────┘
```

### 关键设计模式

**1. Agent 即 Durable Object**

```typescript
import { Agent, callable } from "agents";

export class MyAgent extends Agent {
  @callable()
  async addTodo(text: string) {
    this.setState({ todos: [...this.state.todos, text] });
  }
}
```

- 每个 Agent 实例 = 一个 DO 实例，拥有独立 SQLite 存储
- `setState()` 自动同步到所有已连接客户端
- 空闲时自动休眠（hibernation），WebSocket 保持但零计算成本
- 唤醒时从持久化状态恢复，无需 reconcile

**2. MCP Client + OAuth 2.1**

```typescript
async onStart() {
  this.mcp = new MCPClientManager("my-agent", "1.0.0", {
    baseCallbackUri: `${host}/agents/${ns}/${this.name}/callback`,
    storage: this.ctx.storage,
  });
  const { authUrl } = await this.mcp.connect("https://mcp-server.example.com/sse");
  // authUrl → 用户完成 OAuth → callback 自动处理
}
```

- 支持同时连接多个 MCP Server，自动命名空间防冲突
- 集成 Stytch / Auth0 / WorkOS 做 BYO Auth

**3. Code Mode（LLM 写代码代替 tool call）**

- LLM 生成 TypeScript 代码而非逐个调用工具
- 代码在隔离 Worker 中执行，带虚拟文件系统
- 社区评价："砍了腿给了根拐杖，反而走得更快"——受限沙箱反而提高了可靠性

### 真实产品与案例

| 项目 | 描述 | 规模 |
|------|------|------|
| [Hallucinating Splines](https://hallucinatingsplines.com) | AI agent 当市长玩 SimCity，基于 MicropolisJS | 387 个 AI 市长，1842 座城市，HN 216 points |
| [ElatoAI](https://github.com/akdeb/ElatoAI) | ESP32 硬件 + DO 实现实时语音 AI | 嵌入式 + 边缘 agent |
| [Agent Vault](https://github.com/Infisical/agent-vault) | Agent 凭证代理和保险库 | HN 156 points |
| [Cloudflare 官方 Showcase](https://github.com/cloudflare/agents/tree/main/examples/showcase) | 全功能演示：state + scheduling + chat + tools + MCP + workflows + email + voice | 官方参考实现 |

### 社区反馈

- Nathan Flurry："虚拟操作系统是正确方向"
- Munawar Shah：受限沙箱环境反而让 Agent 更可靠
- Dylan Mikus：Agent 迭代构建应用时，运行时在 Workers + DO 里如何处理？（暗示 Agent 直接操作 Cloudflare 沙箱）

## 可行性分析

### 优势

- **状态持久化零成本**：DO 内建 SQLite，进程崩溃状态不丢，无需 SQLite + JSONL + 启动 reconcile
- **并发安全**：单线程一致性天然消除竞争，不需要 `RLock`、lease 续约、orphan job 回收
- **代码隔离**：Code Mode 沙箱天然隔离，不用自建 Docker/Podman 容器编排
- **运维极简**：无需管理服务器、数据库、消息队列
- **弹性规模**：声称支持数千万并发实例，空闲零成本
- **MCP 原生**：同时作为 MCP Server 和 Client，OAuth 2.1 内建
- **免费层**：DO 已纳入免费层，适合原型验证

### 局限与风险

- **执行时长受限**：DO 有 CPU 时间上限，无法支撑数十分钟甚至 12 小时的重型 CLI 任务
- **生态锁定**：绑死 Cloudflare，与 self-hostable（NAS / VPS / 裸金属）定位根本冲突
- **CLI 执行不现实**：V8 isolate 无法运行 qwen-code / codex / claude-code 等需要完整 Node.js + git + 文件系统的真实 CLI
- **⚠️ 成本失控风险**：2026-04 发生 [$34k alarm loop 事故](https://news.ycombinator.com/item?id=47787042)——`onStart()` 中未检查已有 alarm 导致自我循环，8 天内产生 930B row reads/天，零用户零价值。Cloudflare 无 DO 级消费上限、无 row read 告警，solo 开发者险些破产
- **SDK 成熟度**：不接受外部 PR，API 快速变化中，生产稳定性待验证

### $34k 事故教训（对 aflow 的警示）

| 问题 | Cloudflare DO | aflow 对应 |
|------|---------------|------------|
| 无消费上限 | DO 无 hard spend cap | aflow 有 concurrency semaphore（默认 200） |
| 无异常告警 | 仅监控 CPU time，不监控 row reads | aflow 有 Prometheus `/metrics` + 结构化日志 |
| 自循环 bug | alarm 无条件重设 | aflow 的 lease 机制有 expiry 但无 circuit breaker 上限 |
| 预览环境泄漏 | 60+ preview 部署各创建独立 DO 实例 | aflow 无 preview 环境概念 |

**启示**：任何 actor-per-entity 架构都需要 **per-entity 资源上限 + 异常检测**，aflow 如果借鉴 actor 模型，必须同步设计 circuit breaker 和消费告警。

### 适用场景判断

| 场景 | 是否适合 |
|------|----------|
| 轻量 API 编排 Agent（调 API、路由、状态管理） | ✅ 非常适合 |
| 多租户 SaaS Agent 服务（每用户一个 agent） | ✅ 适合 |
| MCP Server / Client 集成 | ✅ 原生支持 |
| 驱动真实 coding CLI 的重型 Agent Runtime | ❌ 不适合 |
| 需要 self-host 的私有化部署 | ❌ 不适合 |
| 长时间运行任务（>30min） | ❌ 不适合 |

## 与 aflow 的关联

### 可借鉴的设计思想

#### 1. Actor-per-Entity：每个 Run/Task 一个独立 Actor

**aflow 现状**：`RunManager` 用全局 `RLock` 保护所有内存 dict，所有 run 的状态转换争同一把锁。

**借鉴方向**：将每个 Run/Task 的状态机封装为独立 actor（`asyncio.Task` + 消息队列，或每个 run 一个 `threading.Thread` + `queue.Queue`）：

- 消除全局锁竞争
- 每个 run 的 reconcile 逻辑自包含
- 崩溃恢复粒度更细，不用启动时做全局 `fail_orphaned_jobs` + `recover_expired_leases` + `missions.reconcile` 三连

**⚠️ 必须同步设计**：per-entity 资源上限（CPU time / 事件数 / 存储量），避免 $34k 式失控。

#### 2. Write-through 持久化

**aflow 现状**：内存为主、SQLite 为辅，事件先写内存 list 再落盘，启动时需要 convergence 逻辑修补不一致。

**借鉴方向**：事件写入改为 write-through（先写 SQLite/Postgres，成功后更新内存投影）。`RuntimeDatabase` 已支持 Postgres advisory lock 和 `FOR UPDATE SKIP LOCKED`，基础设施就绪。可大幅简化 `recover_expired_leases` / `fail_orphaned_jobs` 等补偿逻辑。

#### 3. 事件流直挂 Task 实体

**aflow 现状**：SSE 从集中式 event store 读取，经 `ui_projection.py` 格式转换，中间隔多层。

**借鉴方向**：每个 task 的 SSE endpoint 直接订阅该 task 的事件写入（pub/sub）。单进程用 `threading.Condition`（已有）或 asyncio broadcast；多进程 / 多 worker 用 Postgres `LISTEN/NOTIFY` 或 Redis pub/sub。

#### 4. Code Mode 思路：受限沙箱提高可靠性

**aflow 现状**：Agent 通过 adapter 驱动真实 CLI，权限边界由容器隔离（`isolation.py`）控制。

**借鉴方向**：Code Mode 的"LLM 生成代码 → 沙箱执行"模式值得关注。对 aflow 的 review gate 场景，可以考虑让 reviewer agent 在受限沙箱中执行验证脚本，而非直接操作宿主文件系统。

### 不需要借鉴的

- **多租户物理隔离**：V2 RBAC + row-level 隔离对 self-host 场景足够
- **MCP 集成**：aflow 的 adapter 模式（fake/qwen/codex/claude/opencode）已覆盖多 agent 接入，MCP 是另一种协议选择而非架构改进
- **休眠/唤醒模型**：aflow 的 worker 是长驻进程轮询，不需要 DO 式休眠

## 结论与建议

DO + Agents SDK 是一个**真实、活跃、有产品 backing 的技术方向**（5.3k stars、Cloudflare 一级产品、30+ 官方示例），而非仅停留在概念阶段。但它与 aflow 的重型 CLI Agent Runtime 不在同一赛道。

**真正值得借鉴的是四个设计思想**：
1. Actor-per-entity（消除全局锁）
2. Write-through 持久化（消除启动 reconcile）
3. 事件流直挂实体（简化 SSE 链路）
4. 受限沙箱执行（提高 review gate 安全性）

这些可在现有 Python + SQLite/Postgres 栈上落地，无需引入 Cloudflare 依赖。但 **$34k 事故警示**：任何 actor 化改造必须同步设计 per-entity 资源上限和异常检测。

### 后续行动

- [ ] 评估 RunManager actor-per-entity 重构的影响范围与迁移路径
- [ ] 在 V2 control plane 试点 write-through 事件写入
- [ ] 调研 Postgres `LISTEN/NOTIFY` 替代 SSE 轮询的可行性
- [ ] 设计 per-entity circuit breaker（事件数上限 / CPU time 上限 / 存储上限）
- [ ] 跟踪 Agents SDK 的 Code Mode 演进，评估 review gate 沙箱化可行性

## 参考资料

### 一手来源
- [原始推文 — Miguel Salinas](https://x.com/Vercantez/status/2082138839888589200)
- [Cloudflare Agents SDK（GitHub）](https://github.com/cloudflare/agents) — 5.3k stars, 1458 commits, 30+ examples
- [Agents SDK 官方文档](https://developers.cloudflare.com/agents/)
- [Cloudflare Blog — Building AI Agents with MCP, AuthN/AuthZ, and DO](https://blog.cloudflare.com/building-ai-agents-with-mcp-authn-authz-and-durable-objects/)

### 案例与社区
- [Hallucinating Splines — AI agents play SimCity](https://hallucinatingsplines.com)（HN 216 points）
- [ElatoAI — ESP32 + DO 语音 AI](https://github.com/akdeb/ElatoAI)
- [Agent Vault — Agent 凭证管理](https://github.com/Infisical/agent-vault)（HN 156 points）

### 风险与教训
- [HN — Durable Object alarm loop: $34k in 8 days](https://news.ycombinator.com/item?id=47787042)
- [Cloudflare DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)
