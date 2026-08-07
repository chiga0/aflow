---
title: 语音输入方案调研
status: active
tags: [voice, asr, mobile]
date: 2026-08-07
---

# 语音输入方案调研

目标：在国行安卓（无 GMS）上可用、低延迟的语音输入。

## 现状与失败原因

| 路径 | 现状 | 国行无 GMS 表现 |
|---|---|---|
| APK 原生 SpeechRecognizer | 已实现桥接 | 依赖厂商语音服务；无服务时 onError 秒回（表现为麦克风一闪而逝）。现已暴露错误码并授权后自动重试 |
| Web Speech API | 浏览器内置 | Chrome 语音走 Google 服务 → `network/service-not-allowed` 秒失败 |
| 服务端文件 ASR（OpenAI 兼容 `/audio/transcriptions`） | 已探测 | token-plan 键 **无文件 ASR 模型**（paraformer-v2/whisper/sensevoice 均 `Model not exist`） |

## 可用资产（已探测 2026-08-07）

`GET /compatible-mode/v1/models`（token-plan 键）返回 22 个模型，含：

- `qwen-audio-3.0-realtime-plus` —— **实时语音模型**（wss realtime 协议）
- `qwen-audio-3.0-tts-plus` —— TTS（可做语音回复，后续彩蛋）

即：现有 key 唯一可用的 ASR 是 **realtime wss**，没有文件转写。

## 方案矩阵

| 方案 | 延迟 | 依赖 | 复杂度 | 结论 |
|---|---|---|---|---|
| A. 原生 SpeechRecognizer | 300ms-2s | 厂商服务 | 已实现 | 保留为机会性回退 |
| B. Web Speech | 同上 | GMS | 已有 | 保留为回退 |
| C. 服务端文件 ASR | 1-3s | 需 ASR 端点/key | 低 | 做成可配置后端（`AFLOW_ASR_URL/MODEL/KEY`），有 key 即用 |
| D. **qwen realtime wss 桥** | **300-800ms 流式** | 现有 key ✅ | 中（~300 行） | **推荐主路径** |
| E. 端侧 WASM (sherpa-onnx) | 离线 | 模型 100MB+ | 中 | 仅离线场景，暂缓 |

## 推荐架构（D）

```
手机麦克风 (getUserMedia, AudioWorklet 降采样 PCM16@16k)
   │ WebSocket (wss://aflow.dev/api/asr/ws, 复用登录 cookie)
   ▼
runtime ASR 桥（stdlib 最小 wss 客户端 或 websockets 依赖）
   │ wss://…/realtime?model=qwen-audio-3.0-realtime-plus (Bearer key)
   ▼
转写增量 → 同 WS 回传 → 输入框实时上字
```

要点：
- 浏览器/APK 的 getUserMedia 不依赖 GMS → 全环境可录音
- realtime 协议：session.update(turn_detection server_vad) → input_audio_buffer.append(base64 pcm) → 收
  `conversation.item.input_audio_transcription.delta` 类事件（以 Qwen realtime 文档为准）
- VAD 断句 + 静音自动停止；UI 麦克风按钮 = 按住/点按切换，实时上字
- stdlib 无 wss 客户端：手写最小 WS（~150 行）或引入 `websockets`（+1 依赖，与 pi 同级的可接受度）

## 决策记录

- 2026-08-07：A/B 已实现为回退；C 留配置位；D 待用户拍板后实施。
