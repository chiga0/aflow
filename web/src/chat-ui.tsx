/**
 * aflow-lite mobile-first chat UI (pi engine).
 *
 * Talks to /api/chat/* instead of the qwen daemon: transcripts are owned by
 * the runtime, live events arrive over SSE (EventSource auto-resends
 * Last-Event-ID, which the server's replay buffer understands), and the whole
 * layout sizes itself from window.visualViewport so mobile IMEs never cover
 * the composer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ── types ─────────────────────────────────────────────── */

interface SessionMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  running?: boolean;
  last_status?: string | null;
}

interface ToolRecord {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  is_error?: boolean;
  running?: boolean;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools: ToolRecord[];
  images?: { mimeType?: string; bytes?: number; dataUrl?: string }[];
  status: string;
  created_at: string;
}

export interface PendingImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

interface SessionDetail extends SessionMeta {
  running: boolean;
  messages: Message[];
}

/* ── api helpers ───────────────────────────────────────── */

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    let msg = `${resp.status}`;
    try {
      const data = await resp.json();
      if (data?.error) msg = data.error;
    } catch {
      /* keep status */
    }
    throw new Error(msg);
  }
  return (await resp.json()) as T;
}

const SUGGESTIONS = [
  "审计当前项目的部署链路风险",
  "分析最近一次代码变更的影响",
  "写一个 hello world 并运行验证",
];

/* ── lightweight markdown (code fences only, by design) ── */

function RichText({ text }: { text: string }) {
  const parts = useMemo(() => text.split("```"), [text]);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf("\n");
          const lang = nl >= 0 ? part.slice(0, nl).trim() : part.trim();
          const code = nl >= 0 ? part.slice(nl + 1) : "";
          return (
            <div className="ac-code" key={i}>
              {lang && <div className="ac-code-lang">{lang}</div>}
              <pre>
                <code>{code.replace(/\n$/, "")}</code>
              </pre>
            </div>
          );
        }
        return part.trim() ? (
          <p key={i} className="ac-para">
            {part}
          </p>
        ) : null;
      })}
    </>
  );
}

/* ── tool card ─────────────────────────────────────────── */

function ToolCard({ tool }: { tool: ToolRecord }) {
  const [open, setOpen] = useState(false);
  const inputPreview = useMemo(() => {
    if (tool.input == null) return "";
    try {
      const s = typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input);
      return s.length > 140 ? s.slice(0, 140) + "…" : s;
    } catch {
      return "";
    }
  }, [tool.input]);
  return (
    <div className={`ac-tool ${tool.is_error ? "ac-tool--err" : ""}`}>
      <button type="button" className="ac-tool-head" onClick={() => setOpen(!open)}>
        <span className={`ac-tool-dot ${tool.running ? "ac-tool-dot--run" : ""}`} />
        <span className="ac-tool-name">{tool.name}</span>
        {inputPreview && <span className="ac-tool-args">{inputPreview}</span>}
        <span className="ac-tool-chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && tool.output != null && (
        <pre className="ac-tool-out">{tool.output.slice(0, 4000)}</pre>
      )}
    </div>
  );
}

/* ── message bubbles ───────────────────────────────────── */

function UserBubble({ text, images }: { text: string; images?: Message["images"] }) {
  return (
    <div className="ac-row ac-row--user">
      <div className="ac-bubble ac-bubble--user">
        {images && images.length > 0 && (
          <div className="ac-user-imgs">
            {images.map((im, i) =>
              im.dataUrl ? (
                <img key={i} src={im.dataUrl} alt="attached" className="ac-user-img" />
              ) : (
                <span key={i} className="ac-user-imgchip">📷</span>
              ),
            )}
          </div>
        )}
        {text}
      </div>
    </div>
  );
}

function collapsePreview(text: string): string {
  const lines = text.split("\n");
  if (lines.length > 12) return lines.slice(0, 12).join("\n") + "\n…";
  return text.slice(0, 500) + "…";
}

function AssistantBubble({
  text,
  tools,
  status,
  streaming,
}: {
  text: string;
  tools: ToolRecord[];
  status?: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 500 || text.split("\n").length > 12;
  const shown = long && !expanded ? collapsePreview(text) : text;
  return (
    <div className="ac-row">
      <div className="ac-bubble ac-bubble--assistant">
        {tools.map((t) => (
          <ToolCard key={t.id || t.name} tool={t} />
        ))}
        {shown && <RichText text={shown} />}
        {long && (
          <button type="button" className="ac-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "展开全文"}
          </button>
        )}
        {streaming && !text && tools.every((t) => !t.running) && (
          <div className="ac-thinking">
            <span className="ac-dot" />
            <span className="ac-dot" />
            <span className="ac-dot" />
          </div>
        )}
        {status && status !== "completed" && (
          <div className="ac-status ac-status--bad">
            {status === "failed" ? "执行失败" : status === "timeout" ? "超时" : status}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── input bar ─────────────────────────────────────────── */

function InputBar({
  running,
  images,
  onSend,
  onCancel,
  onPickImage,
  onRemoveImage,
}: {
  running: boolean;
  images: PendingImage[];
  onSend: (text: string) => void;
  onCancel: () => void;
  onPickImage: (file: File) => void;
  onRemoveImage: (index: number) => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const autosize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const submit = () => {
    const value = text.trim();
    if (!value || running) return;
    onSend(value);
    setText("");
    requestAnimationFrame(autosize);
  };

  return (
    <div className="ac-inputbar-wrap">
      {images.length > 0 && (
        <div className="ac-previews">
          {images.map((im, i) => (
            <div key={i} className="ac-preview">
              <img src={im.dataUrl} alt="" />
              <button type="button" aria-label="移除图片" onClick={() => onRemoveImage(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="ac-inputbar">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickImage(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="ac-attach"
          aria-label="附加截图"
          disabled={running || images.length >= 3}
          onClick={() => fileRef.current?.click()}
        >
          📷
        </button>
        <textarea
        ref={ref}
        className="ac-input"
        rows={1}
        placeholder="描述你想让 Agent 完成的任务…"
        value={text}
        enterKeyHint="send"
        onChange={(e) => {
          setText(e.target.value);
          autosize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
        {running ? (
          <button type="button" className="ac-btn ac-btn--stop" onClick={onCancel} aria-label="停止">
            ■
          </button>
        ) : (
          <button
            type="button"
            className="ac-btn ac-btn--send"
            onClick={submit}
            disabled={(!text.trim() && images.length === 0)}
            aria-label="发送"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

/* ── main component ────────────────────────────────────── */

export function ChatApp({ height }: { height: number | null }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<ToolRecord[]>([]);
  // Refs mirror the live buffers so the turn.finished handler can finalize
  // the assistant message locally without stale-closure state.
  const liveTextRef = useRef("");
  const liveToolsRef = useRef<ToolRecord[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [approvals, setApprovals] = useState<
    { request_id: string; title: string; message: string }[]
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  // Scroll etiquette: only auto-scroll when the user is already near the
  // bottom; reading history must never be yanked back by new content.
  const stickToBottom = useRef(true);
  // Two-step delete: first tap arms the confirmation, second tap deletes.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const data = await api<{ sessions: SessionMeta[] }>("GET", "/api/chat/sessions");
      setSessions(data.sessions);
    } catch {
      /* session list is non-critical */
    }
  }, []);

  const openSession = useCallback(async (id: string | null) => {
    setActiveId(id);
    setDrawerOpen(false);
    setError(null);
    setLiveText("");
    setLiveTools([]);
    liveTextRef.current = "";
    liveToolsRef.current = [];
    setLiveRunning(false);
    setApprovals([]);
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api<SessionDetail>("GET", `/api/chat/sessions/${id}`));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }, []);

  const newSession = useCallback(async () => {
    try {
      const session = await api<SessionMeta>("POST", "/api/chat/sessions");
      await refreshSessions();
      await openSession(session.id);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }, [openSession, refreshSessions]);

  /* SSE subscription with replay + auto-reconnect */
  useEffect(() => {
    if (!activeId) return;
    const es = new EventSource(`/api/chat/sessions/${activeId}/events`, {
      withCredentials: true,
    });
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { type: string; data: Record<string, unknown> };
        const data = ev.data || {};
        switch (ev.type) {
          case "message.delta":
            if (!data.thought) {
              liveTextRef.current += String(data.text || "");
              setLiveText(liveTextRef.current);
            }
            setLiveRunning(true);
            break;
          case "tool.start":
            setLiveRunning(true);
            liveToolsRef.current = [
              ...liveToolsRef.current,
              {
                id: String(data.tool_call_id || ""),
                name: String(data.name || "tool"),
                input: data.input,
                running: true,
              },
            ];
            setLiveTools(liveToolsRef.current);
            break;
          case "tool.update":
            liveToolsRef.current = liveToolsRef.current.map((t) =>
              t.id === String(data.tool_call_id || "")
                ? { ...t, output: String(data.partial_output ?? t.output ?? "") }
                : t,
            );
            setLiveTools(liveToolsRef.current);
            break;
          case "tool.end":
            liveToolsRef.current = liveToolsRef.current.map((t) =>
              t.id === String(data.tool_call_id || "")
                ? {
                    ...t,
                    running: false,
                    output: String(data.output ?? ""),
                    is_error: Boolean(data.is_error),
                  }
                : t,
            );
            setLiveTools(liveToolsRef.current);
            break;
          case "error":
            setError(String(data.reason || "执行出错"));
            break;
          case "permission.request":
            setLiveRunning(true);
            notify("AFlow 需要审批", String(data.message || "").slice(0, 80));
            setApprovals((as) => [
              ...as,
              {
                request_id: String(data.request_id || ""),
                title: String(data.title || "需要审批"),
                message: String(data.message || ""),
              },
            ]);
            break;
          case "permission.resolved":
            setApprovals((as) =>
              as.filter((a) => a.request_id !== String(data.request_id || "")),
            );
            break;
          case "turn.finished": {
            setLiveRunning(false);
            // Finalize the assistant message locally from the live buffers so
            // the reply never disappears even when the reconcile fetch is
            // blocked (WAF / flaky mobile network).
            const content = liveTextRef.current;
            const tools = liveToolsRef.current;
            setDetail((d) =>
              d
                ? {
                    ...d,
                    running: false,
                    messages: [
                      ...d.messages,
                      {
                        id: Date.now(),
                        role: "assistant",
                        content,
                        tools,
                        status: String(data.status || "completed"),
                        created_at: new Date().toISOString(),
                      },
                    ],
                  }
                : d,
            );
            liveTextRef.current = "";
            liveToolsRef.current = [];
            setLiveText("");
            setLiveTools([]);
            refreshSessions();
            notify("AFlow 完成", content.slice(0, 80) || "任务已完成");
            // Best-effort reconcile with the persisted transcript.
            api<SessionDetail>("GET", `/api/chat/sessions/${activeId}`)
              .then(setDetail)
              .catch(() => undefined);
            break;
          }
          default:
            break;
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [activeId, refreshSessions]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  /* in-tab notifications: completion & approval moments */
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const notify = useCallback((title: string, body: string) => {
    if (typeof document !== "undefined" && !document.hidden) return;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body });
      }
      navigator.vibrate?.(120);
    } catch {
      /* ignore */
    }
  }, []);

  /* auto-scroll on new content, only when the user is at the bottom */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [detail, liveText, liveTools]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const send = useCallback(
    async (text: string, images?: PendingImage[]) => {
      let id = activeId;
      const imgs = images || [];
      try {
        if (!id) {
          const session = await api<SessionMeta>("POST", "/api/chat/sessions");
          id = session.id;
          setActiveId(id);
          setDetail({ ...session, running: false, messages: [] });
        }
        // Optimistic user bubble.
        setDetail((d) =>
          d
            ? {
                ...d,
                messages: [
                  ...d.messages,
                  {
                    id: Date.now(),
                    role: "user",
                    content: text,
                    tools: [],
                    images: imgs.map((im) => ({ dataUrl: im.dataUrl, mimeType: im.mimeType })),
                    status: "completed",
                    created_at: new Date().toISOString(),
                  },
                ],
              }
            : d,
        );
        setLiveRunning(true);
        setError(null);
        liveTextRef.current = "";
        liveToolsRef.current = [];
        stickToBottom.current = true;
        await api("POST", `/api/chat/sessions/${id}/messages`, {
          text,
          images: imgs.map((im) => ({ data: im.base64, mimeType: im.mimeType })),
        });
        setPendingImages([]);
        refreshSessions();
      } catch (exc) {
        setLiveRunning(false);
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [activeId, refreshSessions],
  );

  const decideApproval = useCallback(
    async (requestId: string, approved: boolean) => {
      if (!activeId) return;
      setApprovals((as) => as.filter((a) => a.request_id !== requestId));
      try {
        await api("POST", `/api/chat/sessions/${activeId}/approvals`, {
          request_id: requestId,
          approved,
        });
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [activeId],
  );

  const pickImage = useCallback((file: File) => {
    if (file.size > 3 * 1024 * 1024) {
      setError("图片不能超过 3MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      if (!base64) return;
      setPendingImages((ps) =>
        ps.length >= 3 ? ps : [...ps, { dataUrl, base64, mimeType: file.type || "image/png" }],
      );
    };
    reader.readAsDataURL(file);
  }, []);

  const cancel = useCallback(async () => {
    if (activeId) {
      try {
        await api("POST", `/api/chat/sessions/${activeId}/cancel`);
      } catch {
        /* cancel is best-effort */
      }
    }
  }, [activeId]);

  const removeSession = useCallback(
    async (id: string) => {
      if (armedDelete !== id) {
        // First tap: arm the confirmation, auto-disarm after 3s.
        setArmedDelete(id);
        window.setTimeout(() => setArmedDelete((cur) => (cur === id ? null : cur)), 3000);
        return;
      }
      setArmedDelete(null);
      try {
        await api("DELETE", `/api/chat/sessions/${id}`);
      } catch {
        /* ignore */
      }
      if (activeId === id) openSession(null);
      refreshSessions();
    },
    [armedDelete, activeId, openSession, refreshSessions],
  );

  const running = liveRunning || Boolean(detail?.running);
  const lastUserText = useMemo(() => {
    const msgs = detail?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") return msgs[i].content;
    }
    return "";
  }, [detail]);

  return (
    <div
      className="ac-shell"
      style={{ height: height ? `${height}px` : "100dvh" }}
    >
      {/* header */}
      <header className="ac-header">
        <button
          type="button"
          className="ac-iconbtn"
          onClick={() => setDrawerOpen(true)}
          aria-label="会话列表"
        >
          ☰
        </button>
        <div className="ac-header-title">
          {detail?.title || "AFlow"}
          <span className="ac-engine">pi</span>
        </div>
        <button type="button" className="ac-iconbtn" onClick={() => newSession()} aria-label="新会话">
          ＋
        </button>
      </header>

      {/* session drawer */}
      {drawerOpen && (
        <div className="ac-drawer-bg" onClick={() => setDrawerOpen(false)}>
          <div className="ac-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="ac-drawer-head">
              <span>会话</span>
              <button type="button" className="ac-mini-btn" onClick={() => newSession()}>
                ＋ 新会话
              </button>
            </div>
            <div className="ac-drawer-list">
              {sessions.length === 0 && <div className="ac-empty">暂无会话</div>}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`ac-session ${s.id === activeId ? "ac-session--active" : ""}`}
                  onClick={() => openSession(s.id)}
                >
                  <div className="ac-session-title">
                    {s.running && <span className="ac-badge ac-badge--run">运行中</span>}
                    {!s.running && (s.last_status === "failed" || s.last_status === "timeout") && (
                      <span className="ac-badge ac-badge--bad">
                        {s.last_status === "failed" ? "失败" : "超时"}
                      </span>
                    )}
                    {s.title || "新会话"}
                  </div>
                  <div className="ac-session-meta">
                    {new Date(s.updated_at).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <button
                    type="button"
                    className={`ac-session-del ${armedDelete === s.id ? "ac-session-del--armed" : ""}`}
                    aria-label="删除会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(s.id);
                    }}
                  >
                    {armedDelete === s.id ? "确认?" : "✕"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* messages */}
      <div className="ac-scroll" ref={scrollRef} onScroll={onScroll}>
        {!activeId && (
          <div className="ac-welcome">
            <div className="ac-welcome-title">AFlow</div>
            <p>描述你的目标，Agent 会规划、执行并交付结果。</p>
            <div className="ac-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="ac-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {detail?.messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.content} images={m.images} />
          ) : (
            <AssistantBubble
              key={m.id}
              text={m.content}
              tools={m.tools || []}
              status={m.status}
            />
          ),
        )}
        {running && (liveText || liveTools.length > 0 || !detail?.running) && (
          <AssistantBubble text={liveText} tools={liveTools} streaming />
        )}
        {error && (
          <div className="ac-error">
            <span>{error}</span>
            {lastUserText && (
              <button type="button" className="ac-retry" onClick={() => send(lastUserText)}>
                重试
              </button>
            )}
          </div>
        )}
      </div>

      {/* composer */}
      {approvals.length > 0 && (
        <div className="ac-approvals">
          {approvals.map((a) => (
            <div key={a.request_id} className="ac-approval">
              <div className="ac-approval-title">⚠️ {a.title}</div>
              <div className="ac-approval-msg">{a.message}</div>
              <div className="ac-approval-actions">
                <button
                  type="button"
                  className="ac-approve-ok"
                  onClick={() => decideApproval(a.request_id, true)}
                >
                  允许
                </button>
                <button
                  type="button"
                  className="ac-approve-no"
                  onClick={() => decideApproval(a.request_id, false)}
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <InputBar
        running={running}
        images={pendingImages}
        onSend={(t) => send(t, pendingImages)}
        onCancel={cancel}
        onPickImage={pickImage}
        onRemoveImage={(i) => setPendingImages((ps) => ps.filter((_p, j) => j !== i))}
      />
    </div>
  );
}

/* ── styles ────────────────────────────────────────────── */

export const chatStyles = `
.ac-shell {
  display: flex; flex-direction: column; background: #09090b; color: #f4f4f5;
  width: 100vw; overflow: hidden;
  font-family: "SF Pro Text", Inter, system-ui, -apple-system, sans-serif;
}
.ac-header {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.55rem 0.6rem;
  padding-top: calc(0.55rem + env(safe-area-inset-top, 0px));
  border-bottom: 1px solid rgba(255,255,255,0.07);
  background: rgba(9,9,11,0.9); backdrop-filter: blur(10px);
  flex: 0 0 auto;
}
.ac-header-title {
  flex: 1; text-align: center; font-size: 0.95rem; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  display: flex; align-items: center; justify-content: center; gap: 0.4rem;
}
.ac-engine {
  font-size: 0.6rem; padding: 1px 6px; border-radius: 4px;
  background: rgba(99,102,241,0.18); color: #a5b4fc; letter-spacing: 0.06em;
}
.ac-iconbtn {
  width: 38px; height: 38px; border: none; border-radius: 10px;
  background: transparent; color: #d4d4d8; font-size: 1.05rem; cursor: pointer;
  display: grid; place-items: center; flex: 0 0 auto;
}
.ac-iconbtn:active { background: rgba(255,255,255,0.08); }

.ac-scroll {
  flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 0.9rem 0.75rem 0.5rem; display: flex; flex-direction: column; gap: 0.6rem;
}
.ac-row { display: flex; }
.ac-row--user { justify-content: flex-end; }
.ac-bubble {
  max-width: 86%; padding: 0.55rem 0.8rem; border-radius: 14px;
  font-size: 0.92rem; line-height: 1.55; overflow-wrap: anywhere;
}
.ac-bubble--user {
  background: linear-gradient(135deg, #4f46e5, #0891b2); color: #fff;
  border-bottom-right-radius: 4px; white-space: pre-wrap;
}
.ac-bubble--assistant {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07);
  border-bottom-left-radius: 4px; display: flex; flex-direction: column; gap: 0.45rem;
}
.ac-para { margin: 0; white-space: pre-wrap; }
.ac-code {
  background: #0c0c0f; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; overflow: hidden; font-size: 0.8rem;
}
.ac-code-lang {
  padding: 0.25rem 0.6rem; font-size: 0.65rem; color: #71717a;
  border-bottom: 1px solid rgba(255,255,255,0.06); text-transform: uppercase; letter-spacing: 0.05em;
}
.ac-code pre { margin: 0; padding: 0.6rem; overflow-x: auto; }
.ac-code code { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #d4d4d8; }

.ac-tool { border: 1px solid rgba(255,255,255,0.09); border-radius: 8px; overflow: hidden; }
.ac-tool--err { border-color: rgba(239,68,68,0.4); }
.ac-tool-head {
  display: flex; align-items: center; gap: 0.45rem; width: 100%;
  background: rgba(255,255,255,0.03); border: none; color: #a1a1aa;
  padding: 0.4rem 0.6rem; font-size: 0.75rem; cursor: pointer; text-align: left;
}
.ac-tool-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; flex: 0 0 auto; }
.ac-tool-dot--run { background: #f59e0b; animation: ac-pulse 1s ease-in-out infinite; }
.ac-tool--err .ac-tool-dot { background: #ef4444; }
.ac-tool-name { font-weight: 600; color: #d4d4d8; font-family: ui-monospace, monospace; }
.ac-tool-args {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #71717a; font-family: ui-monospace, monospace;
}
.ac-tool-chev { color: #52525b; }
.ac-tool-out {
  margin: 0; padding: 0.5rem 0.6rem; font-size: 0.72rem; color: #a1a1aa;
  background: #0c0c0f; overflow-x: auto; max-height: 220px; overflow-y: auto;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; white-space: pre-wrap;
}

.ac-thinking { display: flex; gap: 4px; padding: 0.2rem 0; }
.ac-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #818cf8;
  animation: ac-pulse 1.2s ease-in-out infinite;
}
.ac-dot:nth-child(2) { animation-delay: 0.2s; }
.ac-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes ac-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }

.ac-status--bad { color: #fca5a5; font-size: 0.8rem; }
.ac-error {
  align-self: center; max-width: 90%; font-size: 0.8rem; color: #fca5a5;
  background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
  border-radius: 8px; padding: 0.45rem 0.7rem;
  display: flex; align-items: center; gap: 0.6rem;
}
.ac-retry {
  border: 1px solid rgba(252,165,165,0.5); background: transparent; color: #fca5a5;
  font-size: 0.72rem; border-radius: 6px; padding: 0.2rem 0.55rem; cursor: pointer;
  flex: 0 0 auto;
}
.ac-more {
  border: none; background: transparent; color: #818cf8; font-size: 0.75rem;
  cursor: pointer; padding: 0.1rem 0; text-align: left;
}
.ac-badge {
  display: inline-block; font-size: 0.6rem; padding: 1px 6px; border-radius: 4px;
  margin-right: 0.35rem; vertical-align: 1px; letter-spacing: 0.03em;
}
.ac-badge--run { background: rgba(245,158,11,0.18); color: #fbbf24; animation: ac-pulse 1.2s infinite; }
.ac-badge--bad { background: rgba(239,68,68,0.18); color: #fca5a5; }
.ac-chips { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.2rem; width: 100%; max-width: 300px; }
.ac-chip {
  border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
  color: #a1a1aa; font-size: 0.82rem; border-radius: 10px; padding: 0.6rem 0.8rem;
  cursor: pointer; text-align: left; transition: all 0.2s;
}
.ac-chip:active { background: rgba(99,102,241,0.15); color: #e0e7ff; }

.ac-approvals {
  padding: 0.5rem 0.75rem 0;
  display: flex; flex-direction: column; gap: 0.5rem;
  background: rgba(9,9,11,0.92);
}
.ac-approval {
  border: 1px solid rgba(245,158,11,0.4); background: rgba(245,158,11,0.08);
  border-radius: 12px; padding: 0.6rem 0.75rem;
  animation: aflow-fade-in 0.25s ease-out both;
}
.ac-approval-title { font-size: 0.85rem; font-weight: 600; color: #fbbf24; }
.ac-approval-msg {
  font-size: 0.78rem; color: #d4d4d8; margin-top: 0.3rem;
  white-space: pre-wrap; font-family: ui-monospace, "SF Mono", Menlo, monospace;
  max-height: 120px; overflow-y: auto;
}
.ac-approval-actions { display: flex; gap: 0.5rem; margin-top: 0.55rem; }
.ac-approve-ok, .ac-approve-no {
  flex: 1; height: 38px; border-radius: 9px; border: none; cursor: pointer;
  font-size: 0.85rem; font-weight: 600;
}
.ac-approve-ok { background: #16a34a; color: #fff; }
.ac-approve-no { background: rgba(239,68,68,0.85); color: #fff; }
.ac-inputbar-wrap {
  border-top: 1px solid rgba(255,255,255,0.07);
  background: rgba(9,9,11,0.92); backdrop-filter: blur(10px);
  flex: 0 0 auto;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.ac-previews { display: flex; gap: 0.4rem; padding: 0.5rem 0.75rem 0; }
.ac-preview { position: relative; }
.ac-preview img {
  width: 52px; height: 52px; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
}
.ac-preview button {
  position: absolute; top: -6px; right: -6px; width: 18px; height: 18px;
  border-radius: 50%; border: none; background: rgba(24,24,27,0.9); color: #a1a1aa;
  font-size: 0.6rem; cursor: pointer; display: grid; place-items: center;
}
.ac-inputbar {
  display: flex; align-items: flex-end; gap: 0.5rem;
  padding: 0.55rem 0.75rem;
}
.ac-input {
  flex: 1; resize: none; border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
  color: #f4f4f5; font-size: 16px; /* 16px prevents iOS zoom-on-focus */
  line-height: 1.4; padding: 0.55rem 0.75rem; outline: none; max-height: 120px;
  font-family: inherit;
}
.ac-input:focus { border-color: #6366f1; }
.ac-attach {
  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(255,255,255,0.06); font-size: 1rem; flex: 0 0 auto;
  display: grid; place-items: center;
}
.ac-attach:disabled { opacity: 0.35; cursor: default; }
.ac-user-imgs { display: flex; gap: 0.35rem; margin-bottom: 0.35rem; flex-wrap: wrap; }
.ac-user-img {
  max-width: 160px; max-height: 120px; border-radius: 8px; display: block;
  border: 1px solid rgba(255,255,255,0.25);
}
.ac-user-imgchip {
  display: inline-block; padding: 2px 8px; border-radius: 6px;
  background: rgba(255,255,255,0.15); font-size: 0.75rem;
}
.ac-btn {
  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
  font-size: 1.1rem; display: grid; place-items: center; flex: 0 0 auto;
  color: #fff; transition: opacity 0.15s;
}
.ac-btn--send { background: linear-gradient(135deg, #6366f1, #06b6d4); }
.ac-btn--send:disabled { opacity: 0.35; cursor: default; }
.ac-btn--stop { background: rgba(239,68,68,0.85); font-size: 0.85rem; }

.ac-drawer-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 40;
}
.ac-drawer {
  position: absolute; top: 0; left: 0; bottom: 0; width: min(300px, 84vw);
  background: #101013; border-right: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; padding-top: env(safe-area-inset-top, 0px);
}
.ac-drawer-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.8rem 0.9rem; font-weight: 600; font-size: 0.95rem;
}
.ac-mini-btn {
  border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
  color: #d4d4d8; font-size: 0.75rem; border-radius: 8px; padding: 0.3rem 0.6rem;
  cursor: pointer;
}
.ac-drawer-list { flex: 1; overflow-y: auto; padding: 0 0.5rem 1rem; }
.ac-empty { color: #52525b; font-size: 0.85rem; text-align: center; padding: 2rem 0; }
.ac-session {
  position: relative; padding: 0.6rem 1.8rem 0.6rem 0.7rem; border-radius: 10px;
  cursor: pointer; margin-bottom: 2px;
}
.ac-session:active, .ac-session--active { background: rgba(99,102,241,0.14); }
.ac-session-title {
  font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ac-session-meta { font-size: 0.7rem; color: #71717a; margin-top: 2px; }
.ac-session-del {
  position: absolute; right: 0.4rem; top: 50%; transform: translateY(-50%);
  border: none; background: transparent; color: #52525b; cursor: pointer;
  font-size: 0.8rem; padding: 0.3rem;
}
.ac-session-del--armed {
  color: #fca5a5; background: rgba(239,68,68,0.15); border-radius: 6px;
  font-size: 0.7rem; padding: 0.3rem 0.45rem;
}

.ac-welcome { text-align: center; margin: auto; padding: 1.5rem; color: #a1a1aa; }
.ac-welcome-title {
  font-size: 1.7rem; font-weight: 800; margin-bottom: 0.5rem;
  background: linear-gradient(135deg, #c7d2fe, #a5f3fc);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.ac-welcome p { font-size: 0.9rem; line-height: 1.6; }
`;
