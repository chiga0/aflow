# 通知渠道接入指南

aflow 的渠道分两类：**双向**（在 IM 里给机器人派任务）和**单向通知**
（任务完成/审批/失败推送到你的日常工具）。所有渠道在 设置 → 通知渠道 里配置，
可并存多个，通知会扇出到全部已启用渠道。

## 单向通知（通用层，推荐先配）

| 类型 | 适用 | 配置 |
|---|---|---|
| **email** | 全平台通用，零依赖 | SMTP 主机/端口/账号/授权码/收件人（QQ/163/Gmail/企业邮均可） |
| **bark** | iOS 推送神器 | reply_url 填 `https://api.day.app/<你的key>` |
| **serverchan** | 推送到微信公众号 | reply_url 填 `https://sctapi.ftqq.com/<SendKey>.send` |
| **wecom** | 企业微信群 | reply_url 填群机器人 webhook |
| **webhook** | 任意自有系统 | reply_url 收 JSON `{"text": ...}`，可用 secret 做 HMAC 校验 |

## 双向（IM 派任务）

### 飞书（应用机器人）
1. [飞书开放平台](https://open.feishu.cn) → 创建企业自建应用 → 开启**机器人**能力
2. 凭证页拿 **App ID / App Secret**
3. **事件订阅**：请求 URL 填 `https://<你的域名>/api/channels/<id>/inbound`
   （先在 aflow 设置里创建 feishu 渠道，把页面上的 **Verification Token** 填到
   aflow 的 secret 栏；飞书会发 challenge，aflow 自动回声通过校验）
4. 添加事件 `im.message.receive_v1`；发布应用并加到群/单聊
5. aflow 渠道表单里填 App ID / App Secret → 回复走 Open API 回到原会话
   （未填则降级为 webhook 推送）

### 钉钉（outgoing 机器人）
1. 群里添加**自定义机器人** → 安全设置选**加签**，复制 secret
2. aflow 渠道 type=dingtalk，reply_url=机器人 webhook，secret=加签密钥
3. 钉钉 outgoing 回调指向 inbound URL 即可双向（签名校验已实现）

### 企业微信
群机器人仅单向；双向需企业应用回调（XML 加解密），暂未实现——建议用邮件/Bark 做通知。

## 通用 webhook 契约

入站：`POST /api/channels/<id>/inbound`，body 任意 JSON，文本从
`text|message|prompt|content` 字段提取；签名头
`X-Aflow-Signature: hmac_sha256(secret, raw).hex()`（配置 secret 时必带）。

出站：`POST reply_url`，JSON `{"text": "...", "channel_id": "..."}`。
