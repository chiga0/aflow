import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type SessionInfo } from "../lib/api";
import { StatusPill } from "../components/status-pill";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export function SessionList({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data.sessions);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    setError(null);
    try {
      const session = await api.createSession(text);
      setPrompt("");
      onOpen(session.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4">
        <h1 className="text-lg font-semibold">aflow</h1>
        <button
          onClick={refresh}
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </header>

      {/* New session input */}
      <form onSubmit={handleCreate} className="px-4 pb-3">
        <div className="flex gap-2">
          <input
            className="h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
            placeholder="描述你想让 agent 做的事..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            type="submit"
            disabled={!prompt.trim() || creating}
            className="h-11 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition-colors disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {creating ? "..." : "开始"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </form>

      {/* Session list */}
      <div className="flex-1 space-y-2 overflow-auto px-4 pb-8 scrollbar-hide">
        {sessions.length === 0 && (
          <div className="py-20 text-center text-sm text-zinc-600">
            还没有会话
            <br />
            输入一个任务开始吧
          </div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition-colors hover:border-zinc-700"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-zinc-100">
                {s.title || "未命名"}
              </span>
              <StatusPill status={s.status} />
            </div>
            <div className="mt-1.5 text-xs text-zinc-500">
              {timeAgo(s.updated_at)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
