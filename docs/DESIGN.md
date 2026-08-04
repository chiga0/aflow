# aflow-lite 设计方案（现状版）

> 自托管的轻量 Agent 运行时：手机/浏览器描述目标 → 云端 agent 规划、执行、交付，全程实时可见。
> 本文描述**当前实现**；计划与偏差见 [PLAN.md](PLAN.md)。

## 1. 设计哲学

**先让一个人用起来。**

- 控制面：~3.6k 行 **stdlib-only** Python（无三方依赖），单文件 SQLite
- 执行面：按需 spawn 的 `pi --mode rpc` 子进程（~180MB/会话，跑完即退），
  而不是常驻多 GB daemon；qwen serve 保留为回退引擎
- 界面：移动优先 PWA（React + Vite + Tailwind v4），可装到主屏幕

## 2. 架构

```
┌──────────────────────────────────────────────┐
│  Mobile-first PWA (web/)                     │
│  流式聊天 · 工具卡 · 审批卡 · 图片/语音输入     │
│  模型切换 · 会话历史 · 离线壳 · Web Push       │
└───────────────────┬──────────────────────────┘
                    │ HTTP + SSE (+ Web Push)
┌───────────────────▼──────────────────────────┐
│  Runtime (Python stdlib only)                │
│  server.py   路由 + 统一鉴权闸门 + SPA 服务    │
│  chat.py     ChatHub：turn 驱动、SSE fan-out、 │
│              replay buffer、审批、模型路由     │
│  store.py    sqlite 持久化（6 张表）           │
│  pi_adapter  pi --mode rpc 子进程引擎（默认）  │
│  adapter.py  qwen serve 客户端（回退）         │
│  relay.py    事件归一化（pi/qwen → 规范事件）   │
│  missions.py 服务端 sequential 编排            │
│  channels.py 钉钉/飞书/webhook 入口            │
└───────────────────┬──────────────────────────┘
                    │ stdio JSON-RPC          │ HTTP SSE
┌───────────────────▼──────────┐   ┌──────────▼─────────┐
│  pi --mode rpc (子进程)       │   │  qwen serve (回退)  │
│  每会话一个，空闲回收          │   │  常驻 daemon        │
└──────────────────────────────┘   └────────────────────┘
```

## 3. API 表面

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查（公开） |
| `/api/auth/login` / `logout` / `session` | POST/POST/GET | 登录会话 |
| `/api/chat/sessions` | POST / GET | 创建（后台预热 pi 进程）/ 列表 |
| `/api/chat/sessions/:id` | GET / DELETE | 详情+历史 / 删除 |
| `/api/chat/sessions/:id/messages` | POST | 发消息；turn 运行中则入队（pi） |
| `/api/chat/sessions/:id/events` | GET | SSE 流，`Last-Event-ID` 断线续播 |
| `/api/chat/sessions/:id/cancel` | POST | 取消当前 turn |
| `/api/chat/sessions/:id/options` | POST | 模型 / 审批模式切换 |
| `/api/chat/sessions/:id/approvals` | POST | 审批卡决策（approve/deny） |
| `/api/missions/*` | — | 服务端多步编排 |
| `/api/channels/*` | — | IM/webhook 入口配置 |
| `/metrics` | GET | 请求指标 |

除公开路由外，所有 `/api/*` 与 `/daemon/*` 过统一鉴权闸门。

## 4. 执行引擎与事件归一化

`pi_adapter` 把 pi RPC 事件映射成 **qwen 形状**的 payload，使 `relay`、
missions、channels 对引擎无感：

```
pi message_update/text_delta      → session_update agent_message_chunk
pi message_update/thinking_delta  → session_update agent_thought_chunk
pi tool_execution_start/update/end→ tool_call / tool_call_update / tool_output
pi permission_request (gate ext)  → permission_request
pi turn_end / agent_settled       → turn_complete / turn_error
进程中途死亡                       → session_died
```

- **自动模型路由**：带图请求走快视觉模型（默认 qwen3.6-flash），纯文本走强模型
  （默认 qwen3.8-max）；用户显式选模型后不覆盖
- **审批 gate**：pi extension 拦截危险命令 → `permission.request` 事件 → 审批卡 →
  `respond_ui` 回传决策；不支持的对话框类型自动拒绝（永不阻塞 agent）
- **中途换模型**：`set_model` 对活的 pi 会话生效，影响排队消息与下一 turn

## 5. 持久化（两层分离）

**持久层** — SQLite `data/aflow.db`：

| 表 | 内容 |
|----|------|
| `auth_sessions` | 浏览器登录会话 |
| `chat_sessions` | id / title / created / updated |
| `chat_messages` | role、content、tools(JSON)、images(元数据 JSON)、status |
| `missions` / `mission_steps` | 服务端编排 |
| `channels` | IM/webhook 配置 |

写入时机：user 消息发送即落库；assistant 消息 **turn 结束一次性落库**
（全文 + tool 记录 + status）；标题首轮规则生成。迁移用
`CREATE TABLE IF NOT EXISTS` + 守卫式 `ALTER TABLE`，原地升级。

**实时层** — 内存 `_SessionState`：SSE 订阅者 + replay buffer
（deque 500，带 seq）。turn 结束清空 buffer，避免重连重复渲染已落库内容。

**已知边界**（followup，见 PLAN.md）：图片只存元数据（历史为占位 chip）、
thinking 不落库、mid-turn 崩溃丢半条回复（web 端 local finalize 兜底）。

## 6. Web 设计

- 单列移动优先；底部固定 composer（iOS safe-area）；触摸目标 ≥44px
- 流式：思考动画、发送键变停止键、tool 卡可折叠、代码块横向滚
- 乐观渲染：发送即显；断线 EventSource 自动重连 + replay
- 滚动礼仪：用户上翻时不强制拽回底部
- 中文输入法安全（`isComposing` 不触发发送）
- 图片附件：≤1280px JPEG 压缩后上传；历史 chip 占位
- 语音输入：Web Speech API（不支持时隐藏按钮，系统键盘听写兜底）
- 通知：turn 完成/审批 in-tab 通知 + Notification；后台 Web Push（§7）
- PWA：manifest + maskable icon；SW 离线壳（导航 cache-first 防启动闪白）、
  build-stamped 更新 + pull-to-refresh + 底部更新 snackbar

## 7. Web Push（后台推送）

stdlib 实现的 VAPID（RFC 8292）：`runtime/push.py` 内置 P-256 ECDSA
（RFC 6979 确定性签名，无三方依赖）。

```
浏览器 pushManager.subscribe(VAPID pubKey)
  → POST /api/push/subscribe 存 endpoint+keys
turn 完成 / 审批请求 → POST endpoint（Authorization: vapid t=jwt, k=pubkey）
  → SW push 事件 → showNotification；404/410 自动退订
```

无 payload 推送不需要 RFC 8291 内容加密；通知文案由 SW 本地生成。

## 8. 部署

- **bare-metal**（推荐小 VPS）：`deploy/deploy_baremetal.sh`，无 Docker 依赖
- **compose**：`deploy/docker-compose.pi.yml`（pi 引擎）
- **CI**：workflow_dispatch 一键 deploy + post-deploy e2e smoke
  （health/login/chat turn/SSE/persist）
- HTTPS：Caddy / `docker-compose.https.yml`

## 9. 代码量现状

| 模块 | 行数 |
|------|------|
| runtime/（含 push/missions/channels） | ~3.6k |
| web/src/ | ~1.9k |

超出原预算（<3.1k），换来 auth、审批、图片、missions、channels、
推送等 Phase 1 能力；stdlib-only 与移动优先两条硬约束未破。

## 10. Phase 路线

| Phase | 目标 | 状态 |
|-------|------|------|
| 0 | 单 agent 跑通，手机能用 | ✅ |
| 1 | auth + 历史 + 多 adapter + 审批 + 部署打磨 + 推送 | ✅ 主体 |
| 2 | Mission DAG + Review Gate + Worker + 隔离 | 未开始 |
