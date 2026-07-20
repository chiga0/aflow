# Agent CLI 配置

aflow 的 Task adapter 支持 `fake`、`qwen`、`codex`、`claude` 和 `opencode`。只有同时满足“启用真实 CLI + 命令存在 + 认证有效”时，任务才是 `real-cli`；否则真实 adapter 会降级为 `protocol-simulated`，这适合 UI/协议演示，但不能作为真实 Agent 验收。

## 1. 统一开关与命令

在 `.env.local` 或部署环境中配置：

```dotenv
V2_ENABLE_REAL_CLI_ADAPTERS=1
V2_QWEN_CODE_COMMAND=qwen
V2_CODEX_CLI_COMMAND=codex exec --skip-git-repo-check -
V2_CLAUDE_CODE_COMMAND=claude -p
V2_OPENCODE_COMMAND=opencode run
V2_LOCAL_EXECUTION_UNIT_ADAPTERS=fake,qwen,codex,opencode
```

修改后重建 Runtime 镜像，否则容器不会获得新环境或 CLI：

```bash
docker compose --env-file .env.local \
  -f deploy/docker-compose.runtime.yml up -d --build
```

默认 Runtime 镜像预装固定版本的 qwen-code、Codex CLI 和 OpenCode。Claude Code 没有预装；使用时需要自定义镜像，并确认其安装与许可方式。

## 2. qwen-code

默认命令：

```dotenv
V2_QWEN_CODE_COMMAND=qwen
```

先在与 Runtime 相同的用户和容器环境中完成认证。Qwen Code 官方当前推荐 API Key 或 Coding Plan；Qwen OAuth 免费层已停止。配置通常位于 `~/.qwen/settings.json`，也可以通过环境变量注入。不要把 API Key 写入仓库。

容器化部署需要把 Qwen 配置只读挂载到容器，或通过 secret manager 注入对应环境变量；宿主机已经登录不代表容器内自动登录。

验证：

```bash
docker compose --env-file .env.local -f deploy/docker-compose.runtime.yml \
  exec runtime qwen --version
python3 scripts/local_stack.py demo --adapter qwen --require-real-cli --timeout 600
```

参考：[Qwen Code 官方仓库与认证说明](https://github.com/QwenLM/qwen-code)、[配置层级](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md)。

## 3. Codex CLI

默认命令使用 `-` 从 stdin 接收 aflow 的任务 envelope：

```dotenv
V2_CODEX_CLI_COMMAND=codex exec --skip-git-repo-check -
```

交互环境可运行 `codex login`；服务器或自动化环境可以使用 API Key 登录，也可将密钥作为受控 secret 注入。aflow 的 Runtime 镜像以非 root 用户运行，因此认证文件必须对该用户可读，且不要把整个宿主机 home 可写挂载进容器。

验证：

```bash
docker compose --env-file .env.local -f deploy/docker-compose.runtime.yml \
  exec runtime codex login status
python3 scripts/local_stack.py demo --adapter codex --require-real-cli --timeout 600
```

参考：[Codex 非交互模式](https://developers.openai.com/codex/noninteractive/)。

## 4. OpenCode

默认命令：

```dotenv
V2_OPENCODE_COMMAND=opencode run
```

OpenCode 官方 npm 包是 `opencode-ai`。先用交互式 `opencode` 的 `/connect`，或 `opencode auth login` 配置所选 provider；凭证必须存在于 Runtime 用户可见的配置目录或由 secret 环境变量提供。

验证：

```bash
docker compose --env-file .env.local -f deploy/docker-compose.runtime.yml \
  exec runtime opencode --version
docker compose --env-file .env.local -f deploy/docker-compose.runtime.yml \
  exec runtime opencode auth list
python3 scripts/local_stack.py demo --adapter opencode --require-real-cli --timeout 600
```

参考：[OpenCode 官方安装与配置](https://opencode.ai/docs/)、[Provider 认证](https://opencode.ai/docs/providers/)。

## 5. Agent 与角色配置的区别

adapter 决定“用哪个 CLI 执行”；Agent Profile 决定“以什么角色、权限和交付约束执行”。内置 Profile 包括 brain、builder、tester、reviewer、doc-writer 和 release-gate，默认偏好 qwen，但任务显式 adapter 可以覆盖运行时选择。

建议映射：

| 角色 | 推荐 adapter | 原因 |
| --- | --- | --- |
| brain / reviewer | qwen 或 codex | 规划、审阅和结构化输出 |
| builder | codex、qwen 或 opencode | 需要真实代码修改与命令执行 |
| tester | 与 builder 不同的 adapter | 降低同源偏差 |
| release-gate | qwen 或 codex，最小权限 | 只读审计，不授予部署权限 |

生产环境不要让所有 Profile 共用一套无限权限凭证。至少区分只读评审、可写构建、网络访问和生产部署权限。

## 6. 逐个验收

每个 Agent 必须单独执行：

1. 容器内 `--version` 成功。
2. 容器内认证状态成功。
3. `demo --adapter <name> --require-real-cli` 完成。
4. Client Chat 有实时输出。
5. artifact 中 `execution_mode=real-cli`。
6. 失败时日志不包含 API Key、access token 或完整认证文件。

如果结果是 `protocol-simulated`，依次检查 `V2_ENABLE_REAL_CLI_ADAPTERS`、命令名、镜像是否重建、认证文件挂载、环境变量和 Runtime 用户权限。
