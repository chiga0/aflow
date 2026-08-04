# 移动优先 UI 验收清单

> 对照 `docs/codex-mobile-interaction.md` 与 Nielsen 启发式原则。
> 截图矩阵：`web/e2e/screenshots/{mobile,desktop}-{1..5}-*.png`，
> 生成：`python3 scripts/ui_matrix.py`（fake pi，确定性帧）。

## 已验证（截图/测试可证）

- [x] 空态：欢迎页有品牌、一句话定位、底部输入框可见（mobile-1）
- [x] 发送即显：用户气泡乐观渲染，不等服务端
- [x] 流式中：思考动画（三点）+ 发送键变红色停止键，可随时取消（mobile-2）
- [x] 工具可见性：工具卡片显示名称/参数/状态点，可展开输出（mobile-3）
- [x] 代码块：语言标签 + 等宽字体 + 横向可滚（mobile-3）
- [x] 错误态：人话错误提示条（mobile-4）
- [x] 会话历史：抽屉列表含标题/时间/删除，当前会话高亮（mobile-5）
- [x] 删除需二次确认（两步 tap，3s 自动解除）
- [x] 键盘遮挡：visualViewport 驱动高度 + `100dvh` 回退（代码级，需真机复核）
- [x] iOS 聚焦不缩放：input 16px
- [x] 中文组词安全：`isComposing` 时 Enter 不发送
- [x] 断线恢复：EventSource 自动重连 + Last-Event-ID 服务端 replay
- [x] 滚动礼仪：用户上翻历史时新内容不强制拽回底部
- [x] 安全区：header/composer 使用 `env(safe-area-inset-*)`

## 需真机复核（我无法验证）

- [ ] iPhone/Android 真机键盘弹起后输入框位置与收起行为
- [ ] PWA 安装到主屏后的状态栏/刘海表现
- [ ] 弱网（3G/丢包）下 SSE 重连体感
- [ ] 深色环境外的可读性（目前仅暗色主题）
- [ ] 横屏与 iPad 分屏
- [ ] 触控目标在真机上的实际手感（≥44pt 已按规范设置）

## 对照 Codex 的差距（backlog，见调研文档 §5）

- [x] P0 会话列表状态徽标（running/待审批/完成/失败）— `23008a7`
- [x] P0 长消息折叠 + 展开 — `23008a7`
- [x] P1 截图作为任务输入（pi RPC 原生支持 image）— `7813b2f`
- [x] P1 审批卡片 — `e240886`；in-tab 通知 — `8d32546`
- [x] P1 PWA 后台推送（Web Push / VAPID，stdlib P-256）— runtime/push.py
- [x] P2 任务中途切换模型（热切换，对排队消息与下一 turn 生效）
- [x] P2 语音输入（Web Speech API，不支持时隐藏按钮、系统听写兜底）

## 持久化 followup（已立项，见 PLAN.md）

- [ ] 图片落库，历史可回看截图
- [ ] thinking 持久化
- [ ] mid-turn 增量落库
