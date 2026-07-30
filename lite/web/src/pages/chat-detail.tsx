import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SessionInfo } from "../lib/api";
import { subscribeSession, type SseEvent, type SseStatus } from "../lib/sse";
import { MessageBubble, type TranscriptItem } from "../components/message-bubble";
import { InputBar } from "../components/input-bar";
import { StatusPill } from "../components/status-pill";

export function ChatDetail({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [sseStatus, setSseStatus] = useState<SseStatus>("connecting");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentTextRef = useRef<string>("");

  // Load session + history
  useEffect(() => {
    (async () => {
      try {
        const data = await api.getSession(sessionId);
        setSession(data.session);
        // Build transcript from persisted messages
        const history: TranscriptItem[] = data.messages.map((m) => {
          if (m.role === "user")
            return { id: m.id, kind: "user" as const, text: m.content };
          if (m.role === "tool")
            return {
              id: m.id,
              kind: "tool" as const,
              text: m.content,
              toolName: m.tool_name ?? undefined,
              toolOutput: m.content || undefined,
            };
          if (m.role === "system")
            return { id: m.id, kind: "error" as const, text: m.content };
          return { id: m.id, kind: "agent" as const, text: m.content };
        });
        setItems(history);
      } catch {
        // session not found
      }
    })();
  }, [sessionId]);

  // SSE subscription
  useEffect(() => {
    agentTextRef.current = "";

    const handleEvent = (event: SseEvent) => {
      const { type, data } = event;

      if (type === "message.delta") {
        const text = String(data.text ?? "");
        const isThought = Boolean(data.thought);
        agentTextRef.current += text;
        const fullText = agentTextRef.current;
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "agent" && last.thought === isThought) {
            return [...prev.slice(0, -1), { ...last, text: fullText }];
          }
          return [
            ...prev,
            {
              id: `live-${event.id}`,
              kind: "agent" as const,
              text: fullText,
              thought: isThought,
            },
          ];
        });
        return;
      }

      if (type === "tool.start") {
        // Flush accumulated agent text
        agentTextRef.current = "";
        setItems((prev) => [
          ...prev,
          {
            id: `tool-${event.id}`,
            kind: "tool" as const,
            text: "",
            toolName: String(data.name ?? "tool"),
            toolInput: data.input,
          },
        ]);
        return;
      }

      if (type === "tool.end") {
        setItems((prev) =>
          prev.map((item) =>
            item.id === `tool-${event.id}` || 
            (item.kind === "tool" && item.toolName === data.name && !item.toolOutput)
              ? {
                  ...item,
                  toolOutput: data.output,
                  isError: Boolean(data.is_error),
                }
              : item,
          ),
        );
        return;
      }

      if (type === "error") {
        agentTextRef.current = "";
        setItems((prev) => [
          ...prev,
          {
            id: `err-${event.id}`,
            kind: "error" as const,
            text: String(data.reason ?? "unknown error"),
          },
        ]);
        return;
      }

      if (type === "done") {
        agentTextRef.current = "";
        setSession((prev) =>
          prev ? { ...prev, status: "completed" } : prev,
        );
        return;
      }

      if (type === "status.change") {
        const status = String(data.status ?? "");
        if (status) {
          setSession((prev) => (prev ? { ...prev, status } : prev));
        }
      }
    };

    const cleanup = subscribeSession(sessionId, handleEvent, setSseStatus);
    return cleanup;
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length, items[items.length - 1]?.text]);

  // Send prompt
  const handleSend = useCallback(
    async (text: string) => {
      setSending(true);
      setItems((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, kind: "user" as const, text },
      ]);
      try {
        await api.sendPrompt(sessionId, text);
        setSession((prev) => (prev ? { ...prev, status: "running" } : prev));
      } catch {
        setItems((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            kind: "error" as const,
            text: "发送失败",
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [sessionId],
  );

  const handleCancel = useCallback(async () => {
    try {
      await api.cancelSession(sessionId);
      setSession((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
    } catch {
      // ignore
    }
  }, [sessionId]);

  const isRunning = session?.status === "running";
  const isTerminal = ["completed", "failed", "cancelled"].includes(
    session?.status ?? "",
  );

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">
            {session?.title ?? "..."}
          </h1>
        </div>
        {session && <StatusPill status={session.status} />}
        {isRunning && (
          <button
            onClick={handleCancel}
            className="rounded-lg px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
          >
            取消
          </button>
        )}
      </header>

      {/* SSE status bar */}
      {sseStatus !== "live" && !isTerminal && (
        <div className="bg-zinc-900 px-4 py-1.5 text-center text-xs text-zinc-500">
          {sseStatus === "connecting" ? "连接中..." : "已断开"}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-auto px-4 py-4 scrollbar-hide"
      >
        {items.map((item) => (
          <MessageBubble key={item.id} item={item} />
        ))}
        {items.length === 0 && (
          <div className="py-20 text-center text-sm text-zinc-600">
            等待 agent 响应...
          </div>
        )}
      </div>

      {/* Input */}
      <InputBar
        onSend={handleSend}
        disabled={sending || isRunning}
        placeholder={
          isRunning ? "agent 正在执行..." : "输入消息..."
        }
      />
    </div>
  );
}
