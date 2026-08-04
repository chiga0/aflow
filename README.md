# aflow

aflow 是一个**自托管的轻量 Agent 运行时**：在浏览器或手机上描述目标，
云端的执行 Agent（默认 [pi](https://pi.dev)）规划、执行、交付，全程实时可见。

设计哲学：**先让一个人用起来**。控制面是 ~2.5k 行 stdlib Python + 一个
移动优先的 Web 控制台；执行面是按需 spawn 的 `pi --mode rpc` 子进程
（~180MB/会话，跑完即退），而不是常驻的多 GB daemon。

在线文档与调研见 [docs/](docs/)，设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 它是什么 / 不是什么

| ✅ 是 | ❌ 不是（明确不做） |
|---|---|
| 单用户、自托管的 agent 控制台 | 多租户 / RBAC / 计费 |
| 实时流式聊天（代码高亮、tool 折叠、思考过程） | 手机上做 diff 精读 / 代码编辑 |
| 服务端 sequential 编排（plan → code → review） | DAG / fan-out 编排（路线图中） |
| 钉钉 / 飞书 / 通用 webhook 入口 | 原生 App（PWA 安装到主屏） |
| 一键部署到 1.6GB VPS | K8s / Temporal |

## 本地运行

```bash
# runtime（stdlib-only，无依赖）+ web 控制台
python3 -m runtime --host 127.0.0.1 --port 8765 &
cd web && npm install && npm run dev

# 或构建后由 runtime 直接服务静态文件
cd web && npm run build
AFLOW_STATIC_DIR=$PWD/dist AFLOW_AUTH_DISABLED=1 python3 -m runtime --port 8765
```

执行引擎默认 `pi`（需 `pi` 在 PATH 且配置 `PI_ENGINE_API_KEY`）；
`AFLOW_ENGINE=qwen` 回退到 qwen serve daemon。变量见 [.env.example](.env.example)。

## 部署

```bash
# bare-metal（推荐小 VPS，无 Docker 依赖）
deploy/deploy_baremetal.sh user@host [/opt/aflow]

# docker compose（pi 引擎，无 qwen daemon）
docker compose -f deploy/docker-compose.pi.yml up -d --build
```

## 测试

```bash
make test            # runtime 单测 + web typecheck + web build
make screenshots     # 确定性 UI 状态矩阵截图（fake pi）
python3 -m unittest discover -s runtime/tests
```

## GitHub 仓库配置（secrets / variables）

| 名称 | 类型 | 用途 |
|---|---|---|
| `AFLOW_AUTH_PASSWORD` | secret | Web 登录密码 |
| `AFLOW_AUTH_EMAIL` | secret | Web 登录邮箱 |
| `AFLOW_DEPLOY_SSH_KEY` | secret | VPS 部署私钥 |
| `AFLOW_PI_API_KEY` | secret | 模型 key |
| `AFLOW_DEPLOY_TARGET` | variable | VPS 部署目标（user@host） |

## 目录

```
runtime/   控制面：auth 网关、/api/chat、missions、channels、pi/qwen adapter
web/       移动优先 Web 控制台（React + Vite + Tailwind，PWA）
deploy/    bare-metal / compose / Dockerfile / HTTPS
scripts/   自测、UI 截图矩阵等开发工具
docs/      设计（DESIGN/PLAN）、Codex 移动端调研、验收清单
```
