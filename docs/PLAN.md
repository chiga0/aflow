# Phase 0 实施计划

## 目录结构

```
lite/
  DESIGN.md              ← 本文件
  PLAN.md                ← 实施计划
  runtime/
    __init__.py
    __main__.py           ← python -m lite.runtime
    models.py             ← Session, Message, Event dataclass
    store.py              ← sqlite 持久化
    adapter.py            ← qwen serve 客户端
    relay.py              ← SSE 事件中继 + 映射
    server.py             ← HTTP 路由
  web/
    index.html
    package.json
    vite.config.ts
    tailwind.config.ts
    tsconfig.json
    public/
      manifest.json       ← PWA
    src/
      main.tsx
      app.tsx             ← 路由
      lib/
        api.ts            ← HTTP 客户端
        sse.ts            ← EventSource 封装
      pages/
        session-list.tsx
        chat-detail.tsx
      components/
        message-bubble.tsx
        tool-call-card.tsx
        input-bar.tsx
        status-pill.tsx
  Dockerfile
  docker-compose.yml
```

## 实施步骤

### Step 1: Runtime 骨架
- [x] models.py — 3 个 dataclass
- [ ] store.py — sqlite 建表 + CRUD
- [ ] adapter.py — qwen serve 客户端（从现有 qwen.py 提取）
- [ ] relay.py — 事件映射 + SSE 格式化
- [ ] server.py — HTTP 路由 + SSE 端点
- [ ] __main__.py — 启动入口

### Step 2: Web 骨架
- [ ] 项目初始化（vite + react + tailwind）
- [ ] api.ts + sse.ts
- [ ] session-list.tsx
- [ ] chat-detail.tsx
- [ ] 组件：message-bubble, tool-call-card, input-bar, status-pill
- [ ] PWA manifest

### Step 3: 联调 + 部署
- [ ] 本地联调（runtime + qwen serve）
- [ ] Dockerfile + docker-compose.yml
- [ ] 端到端验证

### Step 4: 提交
- [ ] git commit 设计文档
- [ ] git commit runtime
- [ ] git commit web
- [ ] git commit 部署
