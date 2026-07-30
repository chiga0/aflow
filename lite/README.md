# aflow-lite

> 一个**能跑起来**的自托管 Agent 运行时：在浏览器或手机上描述目标，云端的 qwen agent 规划、执行、交付，全程实时可见。

aflow-lite 是 [aflow](../README.md) 的"瘦身重做"。原版为了多租户、DAG 编排、worker 调度、审计等目标堆到了 ~37k 行 / 40+ 领域概念，结果没有一个用户闭环真正跑通。lite 反过来：**先让一个人用起来**，把控制面压到 ~1.5k 行 Python + 一个生产级 WebShell 组件，移动端优先，云端一键部署。

## 它是什么 / 不是什么

| ✅ 是 | ❌ 不是（明确不做） |
|---|---|
| 单用户、自托管的 agent 控制台 | 多租户 / RBAC / 计费 |
| 实时流式聊天（代码高亮、tool 折叠、思考过程、权限审批） | 自研聊天 UI（直接复用 qwen 的 `WebShell`） |
| 服务端多步编排（plan → code → review） | DAG / fan-out 编排（仅 `sequential`） |
| 钉钉 / 飞书 / 通用 webhook 入口 | 自研多模型 adapter（见下） |
| 安装到手机主屏的 PWA（离线壳） | 原生 App |
| 一键 `docker compose up` + Caddy 自动 HTTPS | K8s / Temporal |

**为什么不做"多 adapter（claude/codex）"**：lite 的聊天 UI 是 qwen 的 `WebShell`，它与 qwen serve 的协议深度绑定（流式、tool、权限、模型切换都走 `/daemon`）。claude/codex 的协议与该 UI 不兼容，硬接只会得到一个劣化界面。多模型的正确做法是在 qwen 的模型选择器里加 provider（qwen 已支持 OpenAI 兼容端点），而不是在 lite 里重写 UI。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  浏览器 / 手机 PWA                                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │  StandaloneWebShell  (@qwen-code/web-shell)        │  │
│  │  流式渲染 · tool 折叠 · 思考过程 · 权限审批 · 模型切换 │  │
│  │  + AFlow 品牌欢迎页 / 登录页 / 离线壳 (service worker) │  │
│  └───────────────────────┬────────────────────────────┘  │
└──────────────────────────┼───────────────────────────────┘
            同源请求，登录 cookie 自动带上 (/daemon, /api)
┌──────────────────────────▼───────────────────────────────┐
│  aflow-lite runtime  (Python stdlib, 单进程, ~1.5k 行)     │
│                                                          │
│   auth 网关 ── 密码登录(cookie) / Bearer token            │
│      │                                                   │
│      ├─ /daemon/*   ──► 反向代理到 qwen serve (含 SSE)     │
│      ├─ /api/missions  ──► 服务端 sequential 编排          │
│      ├─ /api/channels  ──► 钉钉/飞书/webhook 入站 + 回推   │
│      ├─ /api/health · /metrics (Prometheus)              │
│      └─ /            ──► 静态 SPA                         │
└──────────────────────────┬───────────────────────────────┘
                           │ REST + SSE
┌──────────────────────────▼───────────────────────────────┐
│  qwen serve  (外部进程, 真正的 agent 执行 + 模型调用)       │
└──────────────────────────────────────────────────────────┘
```

关键设计：**浏览器直连 qwen（经 runtime 代理鉴权）**，runtime 不镜像聊天 transcript。这让 runtime 极小，且聊天体验完全由成熟的 WebShell 提供。runtime 只在"服务端编排（missions）"和"channel 入站"时才自己驱动 qwen session（通过无副作用的 `relay.collect_turn`）。

模块：

| 文件 | 职责 |
|---|---|
| `runtime/server.py` | auth 网关 + `/daemon` 反向代理（含 SSE）+ 静态 + health/metrics + 路由分发 |
| `runtime/auth.py` | scrypt 密码 + Bearer token + bootstrap 密码 + cookie |
| `runtime/adapter.py` | qwen serve REST/SSE 客户端 + `summarize` |
| `runtime/relay.py` | `collect_turn`：把一个 qwen session 跑到结束，返回结构化结果（无副作用） |
| `runtime/missions.py` | sequential 编排（plan→code→review），每步结果即 artifact |
| `runtime/channels.py` | 三套签名校验 + 入站文本提取 + 异步执行 + 回推 + 配置 CRUD |
| `runtime/store.py` | SQLite：auth_sessions / missions / mission_steps / channels |
| `runtime/titles.py` | 即时标题规则 + LLM 标题清洗 |
| `runtime/metrics.py` | 线程安全的 Prometheus 文本格式 |
| `web/` | React + Vite + Tailwind，挂载 WebShell + 品牌登录/欢迎页 + PWA |

## 快速开始（本地）

需要：Python 3.12、Node 22、已安装的 `qwen` CLI。

```bash
# 1) 起 qwen serve（agent 执行后端）
qwen serve --hostname 127.0.0.1 --port 4170 &

# 2) 起 runtime（首次会生成 bootstrap 密码，打印在日志里）
cd <repo>
python3 -m lite.runtime --port 8765

# 3) 起 web（开发模式，/api 与 /daemon 代理到 8765）
cd lite/web && npm install && npm run dev
```

打开 `http://localhost:5173`，用日志里的 bootstrap 密码登录（默认邮箱 `admin@aflow.local`），即可对话。

> 想免登录本地调试：`AFLOW_AUTH_DISABLED=1 python3 -m lite.runtime`。**生产绝不要**这样跑。

## 认证

默认**开启**——一个运行时绝不能裸跑。三种配置方式：

```bash
# 方式 A：显式密码（推荐生产）
AFLOW_AUTH_EMAIL=you@example.com AFLOW_AUTH_PASSWORD='强密码' python3 -m lite.runtime

# 方式 B：什么都不设 → 自动生成 bootstrap 密码，写入 data/BOOTSTRAP_PASSWORD.txt (0600)
python3 -m lite.runtime   # 日志会打印邮箱与密码文件路径

# 方式 C：脚本/CI 用 Bearer token
AFLOW_AUTH_TOKEN='随机串' python3 -m lite.runtime
curl -H "Authorization: Bearer 随机串" http://host:8765/metrics

# 仅本地：关闭认证
AFLOW_AUTH_DISABLED=1 python3 -m lite.runtime
```

浏览器登录后拿到 `HttpOnly` cookie，同源请求（含 WebShell 的 `/daemon` 调用）自动带上，因此代理能鉴权。

## API 速查

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 否 | 含 qwen 连通性、延迟、uptime、auth 状态 |
| GET | `/metrics` | 是 | Prometheus 文本格式 |
| POST | `/api/auth/login` | 否 | 邮箱+密码 → Set-Cookie |
| POST | `/api/auth/logout` | 否 | 吊销 cookie |
| GET/POST | `/daemon/*` | 是 | 反向代理到 qwen serve（含 SSE 流） |
| GET/POST | `/api/missions` | 是 | 服务端 sequential 编排 |
| POST | `/api/missions/:id/cancel` | 是 | 取消编排 |
| GET/POST/DELETE-via-POST | `/api/channels` | 是 | channel 配置 CRUD（secret 脱敏） |
| POST | `/api/channels/:id/inbound` | **签名** | webhook 入站（无 cookie，靠平台签名） |

**Mission 示例**（默认 plan→code→review 三步）：

```bash
curl -b jar -X POST http://host:8765/api/missions \
  -H 'content-type: application/json' \
  -d '{"goal":"审计当前项目的部署链路，输出风险与修复顺序"}'
curl -b jar http://host:8765/api/missions/<id>   # 每步 result_text 即产物
```

**Channel 入站**（通用 webhook，HMAC 签名）：

```bash
SECRET='...' ; BODY='{"text":"查询杭州今日天气"}'
SIG=$(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -X POST http://host:8765/api/channels/<id>/inbound \
  -H "content-type: application/json" -H "x-aflow-signature: $SIG" -d "$BODY"
# → 202，agent 跑完后把回复 POST 到该 channel 的 reply_url
```

支持 `webhook`（`x-aflow-signature`）、`dingtalk`（`timestamp`+`sign`，1 小时 skew 窗口）、`feishu`（verification token + challenge 握手）。**未配置 secret 的 channel 会拒绝入站**。

## 移动端 PWA

- 完整 manifest（含 maskable 图标、主题色、快捷方式）。
- service worker：`/api`、`/daemon` 走网络不缓存；哈希资源缓存优先；导航网络优先、离线回退到品牌壳。
- 手机 Safari/Chrome "添加到主屏幕" 后以独立窗口打开，体验接近原生 App。
- 离线时展示品牌登录壳（无法校验登录态，故不展示连不上后端的 WebShell）。

## 测试

```bash
bash lite/scripts/test_lite.sh        # runtime 单测 + web typecheck + web build
AFLOW_E2E=1 bash lite/scripts/test_lite.sh   # 额外跑 Playwright e2e（需 runtime 在 8765）
```

- runtime 测试**完全离线**：`tests/fake_qwen.py` 模拟 qwen serve 协议，69 个用例覆盖标题、密码、持久化、metrics、`collect_turn`、mission 编排、三套 channel 签名、HTTP 服务器。CI 用 `-W error::ResourceWarning` 严格模式跑。
- web e2e：`lite/web/e2e/smoke.test.mjs`（Playwright），`npm run test:e2e`。
- CI：`.github/workflows/lite-ci.yml`，仅 `lite/**` 改动触发。

## 部署

见 [`lite/deploy/`](deploy/)：

- `deploy/docker-compose.yml` — runtime + qwen 两容器，`docker compose up -d` 即起。
- `deploy/Dockerfile` — 多阶段：node 构建 web，python-slim 跑 runtime，内嵌静态。
- `deploy/Caddyfile` — 自动 HTTPS 反代（手机局域网访问需要 HTTPS 才能用麦克风等 API）。
- `deploy/deploy_vps.sh` — 幂等的 VPS 部署脚本（rsync + compose + caddy）。

最小手搓部署：

```bash
cd lite
AFLOW_AUTH_EMAIL=you@example.com AFLOW_AUTH_PASSWORD='强密码' \
  docker compose -f deploy/docker-compose.yml up -d --build
# 公网/局域网加 HTTPS：把 deploy/Caddyfile 的 :8765 换成你的域名，caddy 自动签证书
```

qwen 的模型凭据通过挂载 `~/.qwen/settings.json` 注入 qwen 容器（见 compose 注释）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `QWEN_SERVE_URL` | `http://127.0.0.1:4170` | qwen serve 地址 |
| `QWEN_SERVE_TOKEN` | - | qwen serve 的 bearer（loopback 可省） |
| `AFLOW_AUTH_EMAIL` / `AFLOW_AUTH_PASSWORD` | - | 登录凭据 |
| `AFLOW_AUTH_TOKEN` | - | 脚本/CI 的 bearer |
| `AFLOW_AUTH_DISABLED` | `0` | 关闭认证（仅本地） |
| `AFLOW_STATIC_DIR` | - | 内置静态目录（容器内已设） |
| `AFLOW_CORS_ORIGIN` | `*` | CORS |

## 范围与未来

已实现的"未来项"会在审计表里标注。当前**有意不做**的：多租户/RBAC、DAG 编排、自研多模型 adapter、channel 入站历史持久化（v1 入站是无状态 request/reply）。这些都是 aflow 原版的能力，等 lite 证明单用户闭环有价值后，按需从原版**移植**而非重写。

### 历史清理提示

早期 commit 曾误把运行时数据库 `data/aflow.db` 提交进 git（根 `.gitignore` 当时没有 `data/` 规则）。现已 untrack 并在 `.gitignore` 忽略。该 blob 仅含本地测试数据（随机 session token、公开示例弱密码的 scrypt hash、空表），**无真实 secret**，因此没有 force-rewrite 已推送历史。如需彻底从历史清除：

```bash
git filter-repo --invert-paths --path data/aflow.db --force
# 然后 force-push 该分支
```
