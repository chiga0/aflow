# aflow-lite 设计方案

> Phase 0: 单 Agent、移动优先、云端部署、能用。

## 1. 问题

aflow 当前有 ~37,000 行代码、40+ 个领域概念、v1/v2 两套 API 并行，
但 **没有一个用户闭环跑通**：在手机上发一句话 → 云端 agent 执行 → 实时看到过程 → 拿到结果。

复杂度堆叠导致项目无法被实际使用。

## 2. 目标

**一个人在手机上发一句话，云端 qwen agent 跑完，实时看到过程，拿到结果。**

非目标（Phase 0 不做）：
- 多 Agent 编排 / Mission DAG
- 多租户 / RBAC / Tenant / Project
- Worker 调度 / Executor 容器管理
- Review Gate / 审批流
- Budget / Cost 管控
- Channel 集成（钉钉/飞书/企微）
- Temporal / A2A / ACP
- 多 adapter（只支持 qwen serve）

## 3. 架构

```
┌─────────────────────────────────────────────┐
│  Mobile-first PWA                           │
│                                             │
│  /            → Session 列表                │
│  /chat/:id    → 实时 Chat（SSE 流式）        │
│                                             │
│  技术：React + Vite + Tailwind              │
│  目标：<2000 行 TSX                         │
└──────────────────┬──────────────────────────┘
                   │ HTTP + SSE
┌──────────────────▼──────────────────────────┐
│  Runtime (Python, stdlib only)              │
│                                             │
│  POST /api/sessions              创建       │
│  GET  /api/sessions              列表       │
│  GET  /api/sessions/:id          详情       │
│  POST /api/sessions/:id/prompt   发消息     │
│  GET  /api/sessions/:id/events   SSE 流     │
│  POST /api/sessions/:id/cancel   取消       │
│  GET  /api/health                健康检查   │
│                                             │
│  内部模块：                                  │
│  - store.py     sqlite 持久化（3 张表）      │
│  - adapter.py   qwen serve 客户端           │
│  - relay.py     SSE 事件中继 + 映射          │
│  - server.py    HTTP 路由（<400 行）         │
│                                             │
│  目标：<1500 行 Python                      │
└──────────────────┬──────────────────────────┘
                   │ HTTP + SSE
┌──────────────────▼──────────────────────────┐
│  qwen serve (外部进程)                       │
│  已有的 agent CLI daemon                    │
└─────────────────────────────────────────────┘
```

## 4. 数据模型

只有 3 个概念：

### Session
一次 agent 会话。对应 qwen serve 的一个 session。

```python
@dataclass
class Session:
    id: str                    # "s_<hex12>"
    title: str                 # 用户可编辑，默认取首条 prompt 前 40 字
    status: str                # idle | running | completed | failed | cancelled
    qwen_session_id: str | None
    created_at: str
    updated_at: str
```

### Message
一条消息。user / assistant / tool / system。

```python
@dataclass
class Message:
    id: str                    # "m_<hex12>"
    session_id: str
    role: str                  # user | assistant | tool | system
    content: str               # 文本内容
    tool_name: str | None      # role=tool 时的工具名
    tool_call_id: str | None   # role=tool 时关联的 call id
    partial: bool              # 是否为流式片段
    created_at: str
```

### Event
SSE 事件。append-only，用于实时推送和回放。

```python
@dataclass
class Event:
    id: int                    # 自增序列号（SSE id）
    session_id: str
    type: str                  # message.delta | tool.start | tool.end |
                               # status.change | error | done
    data: dict                 # JSON payload
    created_at: str
```

## 5. API 设计

### POST /api/sessions
创建 session。可选传入首条 prompt 立即开始。

```json
// Request
{ "prompt": "审计当前项目的部署链路" }

// Response 201
{ "id": "s_a1b2c3", "title": "审计当前项目的部署链路", "status": "running" }
```

### GET /api/sessions
列出所有 session，按 updated_at 倒序。

```json
{ "sessions": [ { "id": "...", "title": "...", "status": "...", ... } ] }
```

### GET /api/sessions/:id
Session 详情 + 消息历史。

```json
{
  "session": { ... },
  "messages": [ ... ]
}
```

### POST /api/sessions/:id/prompt
向 running/idle 的 session 追加消息。

```json
{ "prompt": "再看看 CI 配置" }
```

### GET /api/sessions/:id/events
SSE 流。支持 `Last-Event-ID` 断线重连。

```
id: 1
event: message.delta
data: {"text": "正在分析"}

id: 2
event: tool.start
data: {"tool_call_id": "tc_1", "name": "bash", "input": {"command": "ls"}}

id: 3
event: tool.end
data: {"tool_call_id": "tc_1", "name": "bash", "output": "..."}

id: 4
event: done
data: {"status": "completed"}
```

### POST /api/sessions/:id/cancel
取消正在运行的 session。

### GET /api/health
```json
{ "ok": true, "version": "0.1.0", "qwen": "connected" }
```

## 6. Adapter 设计

从现有 `QwenServeAdapter` 提取核心，去掉 executor/mission/review_gate 耦合：

```python
class QwenAdapter:
    def __init__(self, base_url: str, token: str | None = None): ...

    def create_session(self, cwd: str | None = None) -> str:
        """POST /session → sessionId"""

    def send_prompt(self, session_id: str, prompt: str) -> dict:
        """POST /session/{id}/prompt → {promptId}"""

    def stream_events(self, session_id: str, last_id: str | None = None):
        """GET /session/{id}/events → yield (event_name, data)"""

    def cancel(self, session_id: str) -> None:
        """POST /session/{id}/cancel"""
```

事件映射（qwen SSE → aflow-lite Event）：

| qwen 事件 | aflow-lite 事件 |
|-----------|----------------|
| session_update / agent_message_chunk | message.delta |
| session_update / tool_call | tool.start |
| session_update / tool_call_update | tool.update |
| session_update / tool_output | tool.end |
| permission_request | permission.request |
| turn_complete | done |
| turn_error / session_died | error |

## 7. Web 设计

### 页面结构

```
/                SessionList    会话列表（卡片式，状态徽标）
/chat/:id        ChatDetail     实时对话（流式渲染 + 输入栏）
```

### 组件

```
SessionCard      列表项：标题 + 状态 + 时间
MessageBubble    消息气泡（user 右对齐，agent 左对齐）
ToolCallCard     可折叠的 tool call（名称 + 输入 + 输出）
InputBar         底部固定输入栏（textarea + 发送按钮）
StatusPill       状态徽标（running/completed/failed）
```

### 移动端优先

- 单列布局，无侧边栏
- 底部固定输入栏（iOS safe area）
- 触摸目标 ≥ 44px
- PWA manifest（可添加到主屏幕）
- 深色模式跟随系统

## 8. 部署

```yaml
# docker-compose.yml
services:
  aflow-lite:
    build: .
    ports: ["8765:8765"]
    environment:
      - QWEN_SERVE_URL=http://qwen:4170
    volumes:
      - data:/data

  qwen:
    image: qwen-code/qwen:latest
    command: qwen serve --hostname 0.0.0.0 --port 4170
    volumes:
      - workspace:/workspace
```

单命令启动：`docker compose up -d`

## 9. 代码量预算

| 模块 | 目标行数 |
|------|---------|
| runtime/server.py | <400 |
| runtime/store.py | <300 |
| runtime/adapter.py | <350 |
| runtime/relay.py | <200 |
| runtime/models.py | <80 |
| **Runtime 合计** | **<1330** |
| web/pages/ | <600 |
| web/components/ | <800 |
| web/lib/ | <400 |
| **Web 合计** | **<1800** |
| **总计** | **<3130** |

## 10. 从现有代码复用什么

| 现有模块 | 复用方式 |
|---------|---------|
| adapters/qwen.py | 提取 _request, _build_request, SSE 解析 → adapter.py |
| agent_events.py | 提取 _translate_qwen 的映射逻辑 → relay.py |
| store.py | 不复用（太重），重写 3 表 sqlite |
| server.py | 不复用（2900 行路由），重写 |
| web LiveRunnerPanel | 提取 transcript 渲染逻辑 → ChatDetail |
| web SSE hooks | 提取 useRunLiveDaemonEvents → useSessionEvents |

## 11. Phase 路线

| Phase | 目标 | 周期 |
|-------|------|------|
| **0** | 单 agent 跑通，手机能用 | 2-3 周 |
| 1 | auth + 历史 + 多 adapter + 审批 + 部署打磨 | +3-4 周 |
| 2 | Mission DAG + Review Gate + Worker + 隔离 | +4-6 周 |
