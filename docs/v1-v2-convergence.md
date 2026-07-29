# V1/V2 状态系统收敛设计

## 背景与问题

运行时当前并存**两套平行状态机**（非分层），这是"真多副本"的拦路虎：

| 维度 | V1 RunStore (`store.py`) | V2 ControlPlane (`v2_control_plane.py`) |
|---|---|---|
| 工作单元 | `runs` | `v2_tasks` + `v2_agent_tasks` |
| 事件日志 | `run_events` / `raw_events` | `v2_events` / `v2_event_dedup` |
| 租约/队列 | `run_jobs` + `workers` | `v2_agent_leases` + `v2_execution_units` |
| 权限 | `permission_notifications` | `v2_permissions` |
| 身份/访问 | `access_projects` / `api_tokens` / `auth_users` / `auth_sessions` | `v2_tenants` / `v2_tenant_users` / `v2_rbac_policies` / `v2_projects` |
| 编排 | `missions` / `mission_tasks` | `v2_plans` / `v2_workflow_runs` / `v2_workflow_steps` |
| 后端 | **SQLite 单连接** + 进程内 `RLock`/`Condition` + 内存缓存 | **SQLite/Postgres**（`database.py`），advisory lock + `SKIP LOCKED` |
| 多副本 | ❌ 阻塞 | ✅ Postgres 下就绪 |

V2 不创建 V1 run，两者零共享状态（`v2_control_plane.py` 不 import `store`/`manager`）。`RunManager` 只是把两者并排实例化（`manager.py:54-55`），用两个不同 DB 文件（`runtime.db` vs `v2/control_plane.db`）。

**核心矛盾**：V2 已经是 Task-first、多副本就绪的未来方向（WebShell UI、DAG、租户/RBAC 都建在 V2 上），但 V1 仍承载 auth/access、部分运行语义，且其 SQLite 单连接设计阻塞水平扩展。

## 目标

1. **解锁多副本**：让所有共享状态跑在 Postgres 上，去掉进程内锁依赖。
2. **单一事实来源**：V2 Task-first 模型成为权威状态；V1 退化为 V2 的投影或彻底退役。
3. **不破坏现有功能**：增量迁移，每步可回滚，WebShell/管理台/worker 全程可用。

## 收敛策略：三阶段

### 阶段 A — 统一存储底座（解锁多副本，风险最低）

让 V1 `RunStore` 复用 V2 已有的 `RuntimeDatabase` 抽象（`database.py`），从而 V1 也能跑在 Postgres 上。

- **A1**：`RunStore.__init__` 接受 `database_url`，用 `RuntimeDatabase` 替代裸 `sqlite3.connect`。
- **A2**：把 `store.py` 的 SQLite 专有语法（`PRAGMA`、`?` 占位符、`PRAGMA table_info`）改为 `RuntimeDatabase` 的方言无关接口（已有 Postgres 翻译层）。
- **A3**：把进程内 `RLock`/`Condition` 的事件等待，替换为 DB 级协调（Postgres advisory lock + `SKIP LOCKED`，SQLite 退化为轮询）。这是去内存缓存的关键。
- **A4**：移除 `_load_from_db()` 全量内存镜像，改为按需查询 + 短缓存。

**产出**：V1 和 V2 都能跑在同一个 Postgres 实例，多副本不再被 V1 阻塞。

### 阶段 B — 身份/访问统一到 V2（消除重复 RBAC）

V1 的 `auth_users`/`auth_sessions`/`api_tokens`/`access_projects` 与 V2 的 `v2_tenants`/`v2_tenant_users`/`v2_rbac_policies`/`v2_projects` 重复。

- **B1**：以 V2 租户/RBAC 为权威，V1 auth 改为读写 V2 表（或视图）。
- **B2**：session/token 签发统一到 V2 身份模型。
- **B3**：管理台 access 页面只读 V2。

### 阶段 C — 运行语义收敛（V1 run → V2 task 投影）

最复杂、最后做。V1 `runs`/`run_events`/`run_jobs` 迁移到 V2 Task-first 模型。

- **C1**：V1 `create_run` 改为在 V2 创建 single-agent task；V1 run 成为 V2 task 的投影/别名。
- **C2**：事件流统一（V1 `run_events` → V2 `v2_events`），`ui_projection`/`agent_events` 适配。
- **C3**：worker 租约统一（V1 `run_jobs`+`workers` → V2 `v2_agent_leases`+`v2_execution_units`）。
- **C4**：退役 V1 `RunStore` 的 run/job/worker 表，保留为兼容视图或彻底删除。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 阶段 A3 去内存锁影响 SSE 实时性 | Postgres `LISTEN/NOTIFY` 或短轮询兜底；先双写对比 |
| 阶段 C 破坏 WebShell/worker 协议 | 投影层保持 V1 API 形状；灰度切换 + feature flag |
| 迁移期数据不一致 | 双写 + 校验脚本；每阶段独立可回滚 |
| Postgres 成为单点 | HA profile 已有 Postgres；配合备份/恢复演练 |

## 本轮（Phase 3 启动）范围

先做 **阶段 A1+A2**（`RunStore` 接入 `RuntimeDatabase`，获得 Postgres 能力），这是解锁多副本的最小关键增量，风险最低、价值最高。A3/A4（去内存锁）作为紧随的下一步。阶段 B/C 待 A 稳定后单独排期。

## 验收标准

- `RUNTIME_DATABASE_URL=postgres://...` 时 V1 RunStore 全量测试通过。
- 两个 runtime 进程共享同一 Postgres，互不破坏对方状态（多副本冒烟）。
- 现有 SQLite 路径（默认）行为不变，全量测试通过。
