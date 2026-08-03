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
  status: string;
  created_at: string;
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

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ac-row ac-row--user">
      <div className="ac-bubble ac-bubble--user">{text}</div>
    </div>
  );
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
  return (
    <div className="ac-row">
      <div className="ac-bubble ac-bubble--assistant">
        {tools.map((t) => (
          <ToolCard key={t.id || t.name} tool={t} />
        ))}
        {text && <RichText text={text} />}
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
  onSend,
  onCancel,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

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
    <div className="ac-inputbar">
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
          disabled={!text.trim()}
          aria-label="发送"
        >
          ↑
        </button>
      )}
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
  const [liveRunning, setLiveRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setLiveRunning(false);
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
            if (!data.thought) setLiveText((t) => t + String(data.text || ""));
            setLiveRunning(true);
            break;
          case "tool.start":
            setLiveRunning(true);
            setLiveTools((ts) => [
              ...ts,
              {
                id: String(data.tool_call_id || ""),
                name: String(data.name || "tool"),
                input: data.input,
                running: true,
              },
            ]);
            break;
          case "tool.update":
            setLiveTools((ts) =>
              ts.map((t) =>
                t.id === String(data.tool_call_id || "")
                  ? { ...t, output: String(data.partial_output ?? t.output ?? "") }
                  : t,
              ),
            );
            break;
          case "tool.end":
            setLiveTools((ts) =>
              ts.map((t) =>
                t.id === String(data.tool_call_id || "")
                  ? {
                      ...t,
                      running: false,
                      output: String(data.output ?? ""),
                      is_error: Boolean(data.is_error),
                    }
                  : t,
              ),
            );
            break;
          case "error":
            setError(String(data.reason || "执行出错"));
            break;
          case "turn.finished":
            setLiveRunning(false);
            // Flush: reload the persisted transcript and clear live buffers.
            api<SessionDetail>("GET", `/api/chat/sessions/${activeId}`)
              .then(setDetail)
              .catch(() => undefined);
            setLiveText("");
            setLiveTools([]);
            refreshSessions();
            break;
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
    async (text: string) => {
      let id = activeId;
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
                    status: "completed",
                    created_at: new Date().toISOString(),
                  },
                ],
              }
            : d,
        );
        setLiveRunning(true);
        setError(null);
        stickToBottom.current = true;
        await api("POST", `/api/chat/sessions/${id}/messages`, { text });
        refreshSessions();
      } catch (exc) {
        setLiveRunning(false);
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [activeId, refreshSessions],
  );

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
                  <div className="ac-session-title">{s.title || "新会话"}</div>
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
          </div>
        )}
        {detail?.messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.content} />
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
        {error && <div className="ac-error">{error}</div>}
      </div>

      {/* composer */}
      <InputBar running={running} onSend={send} onCancel={cancel} />
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
}

.ac-inputbar {
  display: flex; align-items: flex-end; gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  padding-bottom: calc(0.55rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid rgba(255,255,255,0.07);
  background: rgba(9,9,11,0.92); backdrop-filter: blur(10px);
  flex: 0 0 auto;
}
.ac-input {
  flex: 1; resize: none; border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
  color: #f4f4f5; font-size: 16px; /* 16px prevents iOS zoom-on-focus */
  line-height: 1.4; padding: 0.55rem 0.75rem; outline: none; max-height: 120px;
  font-family: inherit;
}
.ac-input:focus { border-color: #6366f1; }
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
