# 实施计划与状态

> 活文档：记录"计划 → 实际"的偏差与当前 followup。
> 架构细节见 [DESIGN.md](DESIGN.md)，UI 验收见 [ui-acceptance-checklist.md](ui-acceptance-checklist.md)。

## 当前状态（Phase 0 ✅ / Phase 1 主体 ✅）

单用户闭环已跑通并日常可用：手机 PWA 发消息 → pi agent 执行 → 实时流式可见
→ 危险命令审批 → 结果交付 → 历史可回看。部署走 bare-metal / compose，CI 一键
deploy + post-deploy e2e smoke。

## 原计划回顾与偏差

原 Phase 0 计划（`lite/` 骨架、qwen serve 单一 adapter）已**全部完成且被超越**，
主要偏差：

| 原计划 | 实际 |
|--------|------|
| 引擎 = qwen serve daemon | **pi `--mode rpc` 子进程**为默认（~180MB/会话、跑完即退），qwen serve 保留为回退 |
| 路由 `/api/sessions/*` | `/api/chat/sessions/*`（chat hub 持有 transcript） |
| store 3 张表 | 6 张表：+ `chat_sessions` / `chat_messages` / `channels` |
| 无 auth | 登录会话 + 统一 `/api/*` 鉴权闸门 |
| 无审批 | 危险命令审批卡（pi extension gate）+ PWA 通知 |
| 无图片输入 | 截图/图片附件（pi vision，自动模型路由） |
| 无 missions/channels | 服务端 sequential 编排 + 钉钉/飞书/webhook 入口 |
| Web <1800 行 | ~1900 行（PWA、离线壳、更新策略、pull-to-refresh） |

## 进行中 / Followup

### 本轮（A+C 收尾）
- [x] 品牌 logo 全套资产 + README/web 集成
- [x] 文档刷新（本文件 + DESIGN.md）
- [x] 任务中途切换模型（对排队消息与下一 turn 生效）
- [x] PWA 后台推送（Web Push / VAPID，stdlib 实现）
- [x] 语音输入（Web Speech API，已在 composer）

### 持久化改进（followup，已立项未做）
- [ ] 图片落库（压缩后存盘），历史可回看截图而非占位 chip
- [ ] thinking 内容持久化（历史可展开思考过程）
- [ ] mid-turn 增量落库（进程崩溃不丢半条回复）

### 需真机复核（人肉，无法自动化）
- [ ] iPhone/Android 键盘弹起/收起行为
- [ ] PWA 主屏安装后刘海/状态栏
- [ ] 弱网 SSE 重连体感
- [ ] 横屏 / iPad 分屏

### Phase 2（长期路线，见 DESIGN.md §10）
- [ ] Mission DAG + Review Gate + Worker 调度 + 隔离
