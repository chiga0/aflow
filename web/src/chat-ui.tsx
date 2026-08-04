/**
 * aflow mobile-first chat UI (pi engine), tailwind v4 + shadcn primitives.
 *
 * Talks to /api/chat/*: transcripts owned by the runtime, live events over
 * SSE (EventSource auto-resends Last-Event-ID; server replays its buffer),
 * layout sized from window.visualViewport so mobile IMEs never cover the
 * composer.
 */
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  Image as ImageIcon,
  Loader2,
  Menu,
  Mic,
  Monitor,
  Moon,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Search,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./components/ui/sheet";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";

/* ── types ────────────────────────────────────────────── */

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

interface SessionDetail extends SessionMeta {
  running: boolean;
  messages: Message[];
}

export interface PendingImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

/* ── api helpers ───────────────────────────────────────── */

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

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
            <div key={i} className="overflow-hidden rounded-lg border border-border bg-muted text-xs">
              {lang && (
                <div className="border-b border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {lang}
                </div>
              )}
              <pre className="overflow-x-auto p-2.5">
                <code className="font-mono text-foreground/85">{code.replace(/\n$/, "")}</code>
              </pre>
            </div>
          );
        }
        const clean = part.replace(/^\n+|\n+$/g, "");
        return clean ? (
          <p key={i} className="m-0 whitespace-pre-wrap">
            {clean}
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
      return s.length > 90 ? s.slice(0, 90) + "…" : s;
    } catch {
      return "";
    }
  }, [tool.input]);
  return (
    <div
      data-testid="tool-card"
      className={cn(
        "overflow-hidden rounded-lg border",
        tool.is_error ? "border-destructive/50" : "border-border",
      )}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 bg-secondary/40 px-2.5 py-1.5 text-left text-xs text-muted-foreground"
        onClick={() => setOpen(!open)}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            tool.running
              ? "bg-warning [animation:aflow-pulse_1s_ease-in-out_infinite]"
              : tool.is_error
                ? "bg-destructive"
                : "bg-success",
          )}
        />
        <span className="font-mono font-semibold text-foreground/85">{tool.name}</span>
        {inputPreview && (
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {inputPreview}
          </span>
        )}
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && tool.output != null && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap bg-muted p-2.5 font-mono text-[11px] text-muted-foreground">
          {tool.output.slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}

/* ── bubbles ───────────────────────────────────────────── */

function UserBubble({ text, images }: { text: string; images?: Message["images"] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[86%] rounded-2xl rounded-br-sm bg-gradient-to-br from-primary to-accent px-3.5 py-2 text-[15px] leading-relaxed text-white">
        {images && images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {images.map((im, i) =>
              im.dataUrl ? (
                <img
                  key={i}
                  src={im.dataUrl}
                  alt="attached"
                  className="max-h-28 max-w-40 rounded-lg border border-[rgba(255,255,255,0.25)]"
                />
              ) : (
                <span key={i} className="rounded-md bg-white/15 px-2 py-0.5 text-xs">
                  📷
                </span>
              ),
            )}
          </div>
        )}
        <span className="whitespace-pre-wrap break-words">{text}</span>
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
  thinking,
  tools,
  status,
  streaming,
}: {
  text: string;
  thinking?: string;
  tools: ToolRecord[];
  status?: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const long = text.length > 500 || text.split("\n").length > 12;
  const shown = long && !expanded ? collapsePreview(text) : text;
  return (
    <div className="flex">
      <div
        data-testid="assistant-bubble"
        className="flex max-w-[86%] flex-col gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-[15px] leading-relaxed"
      >
        {streaming && thinking && (
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
              onClick={() => setThinkOpen(!thinkOpen)}
            >
              <span className="[animation:aflow-pulse_1.2s_ease-in-out_infinite]">💭</span>
              思考中…
              {thinkOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
            {thinkOpen && (
              <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {thinking.slice(-2000)}
              </div>
            )}
          </div>
        )}
        {tools.map((t) => (
          <ToolCard key={t.id || t.name} tool={t} />
        ))}
        {shown && <RichText text={shown} />}
        {long && (
          <button
            type="button"
            className="cursor-pointer self-start text-xs text-primary"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : "展开全文"}
          </button>
        )}
        {streaming && !text && !thinking && tools.every((t) => !t.running) && (
          <div data-testid="thinking" className="flex gap-1 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary [animation:aflow-pulse_1.2s_ease-in-out_infinite]" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary [animation:aflow-pulse_1.2s_ease-in-out_infinite_0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary [animation:aflow-pulse_1.2s_ease-in-out_infinite_0.4s]" />
          </div>
        )}
        {status && status !== "completed" && (
          <div className="text-xs text-destructive">
            {status === "failed" ? "执行失败" : status === "timeout" ? "超时" : status}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── chatbox (composer) ────────────────────────────────── */

interface ChatboxProps {
  running: boolean;
  images: PendingImage[];
  files: { name: string; text: string }[];
  models: string[];
  model: string;
  gateMode: "strict" | "auto";
  onSend: (text: string) => void;
  onCancel: () => void;
  onPickImage: (file: File) => void;
  onPickFile: (file: File) => void;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onModel: (model: string) => void;
  onGateMode: (mode: "strict" | "auto") => void;
}

function Chatbox(p: ChatboxProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const autosize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, []);

  const canSend = Boolean(text.trim() || p.images.length || p.files.length);

  const submit = () => {
    if (!canSend || p.running) return;
    p.onSend(text.trim());
    setText("");
    requestAnimationFrame(autosize);
  };

  const toggleVoice = () => {
    const w = window as unknown as Record<string, any>;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let final = "";
      for (const r of e.results) if (r.isFinal) final += r[0].transcript;
      if (final) {
        setText((t) => (t ? t + final : final));
        requestAnimationFrame(autosize);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const hasSR =
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as Record<string, any>).SpeechRecognition ||
        (window as unknown as Record<string, any>).webkitSpeechRecognition,
    );

  return (
    <div className="shrink-0 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {(p.images.length > 0 || p.files.length > 0) && (
        <div className="flex gap-2 px-3 pt-2.5">
          {p.images.map((im, i) => (
            <div key={`i${i}`} className="relative">
              <img src={im.dataUrl} alt="" className="h-13 w-13 rounded-lg border border-border object-cover" />
              <button
                type="button"
                aria-label="移除图片"
                className="absolute -right-1.5 -top-1.5 grid h-4.5 w-4.5 cursor-pointer place-items-center rounded-full bg-card text-[9px] text-muted-foreground"
                onClick={() => p.onRemoveImage(i)}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {p.files.map((f, i) => (
            <div
              key={`f${i}`}
              className="flex max-w-36 items-center gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground"
            >
              <FileText size={12} className="shrink-0" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                aria-label="移除文件"
                className="cursor-pointer text-muted-foreground"
                onClick={() => p.onRemoveFile(i)}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mx-3 my-2.5 rounded-2xl border border-border bg-card shadow-xl shadow-black/30 focus-within:border-ring">
        <Textarea
          ref={ref}
          data-testid="composer-input"
          className="max-h-36 border-0 bg-transparent px-3.5 pt-3 pb-1 text-base focus-visible:ring-0"
          rows={1}
          placeholder={listening ? "正在听… 说完自动填入" : "描述你想让 Agent 完成的任务…"}
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
        <div className="flex items-center gap-1 px-2 pb-2">
          {/* + attach menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="附加内容" className="rounded-full text-muted-foreground">
                <Paperclip size={17} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuLabel>附加</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => imgRef.current?.click()}>
                <ImageIcon size={14} /> 图片 / 截图
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileRef.current?.click()}>
                <FileText size={14} /> 文件（文本）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasSR && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="语音输入"
              className={cn(
                "rounded-full",
                listening
                  ? "bg-destructive/80 text-white [animation:aflow-pulse_1.2s_infinite]"
                  : "text-muted-foreground",
              )}
              onClick={toggleVoice}
            >
              <Mic size={17} />
            </Button>
          )}

          <div className="flex-1" />

          {/* model switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="切换模型"
                title={p.running ? "切换后对排队消息与下一轮生效" : undefined}
                className="h-8 max-w-32 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Cpu size={14} className="min-[420px]:hidden" />
                <span className="hidden truncate min-[420px]:inline">{p.model}</span>
                <ChevronDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuLabel>模型</DropdownMenuLabel>
              {p.models.map((m) => (
                <DropdownMenuItem
                  key={m}
                  className={cn(m === p.model && "bg-primary/15 text-primary")}
                  onClick={() => p.onModel(m)}
                >
                  {m === p.model ? "✓ " : ""}
                  {m}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* approval mode */}
          <Button
            variant="ghost"
            size="sm"
            aria-label="审批模式"
            disabled={p.running}
            title={p.gateMode === "strict" ? "危险命令需审批" : "自动执行（免审批）"}
            className={cn(
              "h-8 gap-1 px-1.5 text-xs",
              p.gateMode === "strict"
                ? "text-muted-foreground hover:text-foreground"
                : "text-warning hover:brightness-110",
            )}
            onClick={() => p.onGateMode(p.gateMode === "strict" ? "auto" : "strict")}
          >
            {p.gateMode === "strict" ? <ShieldCheck size={14} /> : <Zap size={14} />}
            <span className="hidden min-[420px]:inline">
              {p.gateMode === "strict" ? "审批" : "自动"}
            </span>
          </Button>

          {p.running && (
            <Button
              data-testid="composer-stop"
              variant="destructive"
              size="icon"
              aria-label="停止"
              className="rounded-full"
              onClick={p.onCancel}
            >
              <Square size={14} fill="currentColor" />
            </Button>
          )}
          <Button
            data-testid="composer-send"
            size="icon"
            aria-label="发送"
            title={p.running ? "排队发送" : "发送"}
            className="rounded-full bg-foreground text-background hover:opacity-90"
            disabled={!canSend}
            onClick={submit}
          >
            <Send size={15} />
          </Button>
        </div>
      </div>

      <input
        ref={imgRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) p.onPickImage(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) p.onPickFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── theme (system / light / dark, persisted) ─────────── */

type ThemePref = "system" | "light" | "dark";

function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem("aflow-theme") as ThemePref) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const light = pref === "light" || (pref === "system" && mq.matches);
      document.documentElement.dataset.theme = light ? "light" : "dark";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
  const set = useCallback((t: ThemePref) => {
    setPref(t);
    try {
      localStorage.setItem("aflow-theme", t);
    } catch {
      /* private mode */
    }
  }, []);
  return [pref, set];
}

/* ── main component ────────────────────────────────────── */

export function ChatApp({ height }: { height: number | null }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveThinking, setLiveThinking] = useState("");
  const [liveTools, setLiveTools] = useState<ToolRecord[]>([]);
  const liveTextRef = useRef("");
  const liveThinkingRef = useRef("");
  const liveToolsRef = useRef<ToolRecord[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; text: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [engine, setEngine] = useState("pi");
  const [gateMode, setGateMode] = useState<"strict" | "auto">("strict");
  const [approvals, setApprovals] = useState<
    { request_id: string; title: string; message: string }[]
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [query, setQuery] = useState("");
  const [themePref, setThemePref] = useTheme();
  const [pullPx, setPullPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const touchY = useRef<number | null>(null);

  /* PWA update banner (deploy replaced the service worker) */
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener("aflow:update-available", onUpdate);
    return () => window.removeEventListener("aflow:update-available", onUpdate);
  }, []);

  /* native-feel pull-to-refresh: content follows the finger with resistance,
     indicator arrow rotates with progress, spring-back on release. */
  const PULL_MAX = 96;
  const PULL_TRIGGER = 56;
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchY.current = scrollRef.current?.scrollTop === 0 ? e.touches[0].clientY : null;
    setDragging(true);
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchY.current == null || refreshing) return;
    const dy = e.touches[0].clientY - touchY.current;
    if (scrollRef.current?.scrollTop === 0 && dy > 0) {
      setPullPx(Math.min(dy * 0.45, PULL_MAX));
    } else {
      setPullPx(0);
    }
  }, [refreshing]);
  const onTouchEnd = useCallback(() => {
    setDragging(false);
    if (pullPx > PULL_TRIGGER && !refreshing) {
      setRefreshing(true);
      setPullPx(48);
      window.dispatchEvent(new Event("aflow:check-update"));
      window.setTimeout(() => window.location.reload(), 500);
    } else {
      setPullPx(0);
    }
    touchY.current = null;
  }, [pullPx, refreshing]);

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
    setLiveThinking("");
    setLiveTools([]);
    liveTextRef.current = "";
    liveThinkingRef.current = "";
    liveToolsRef.current = [];
    setLiveRunning(false);
    setApprovals([]);
    stickToBottom.current = true;
    // Clear before fetching so the previous session never renders under the
    // new id (users saw a wrong-session flash while the fetch was in flight).
    setDetail(null);
    if (!id) {
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
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { type: string; data: Record<string, unknown> };
        const data = ev.data || {};
        switch (ev.type) {
          case "message.delta":
            if (data.thought) {
              liveThinkingRef.current += String(data.text || "");
              setLiveThinking(liveThinkingRef.current);
            } else {
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
            if (typeof document !== "undefined" && document.hidden) {
              navigator.vibrate?.(120);
            }
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
            liveThinkingRef.current = "";
            liveToolsRef.current = [];
            setLiveText("");
            setLiveThinking("");
            setLiveTools([]);
            refreshSessions();
            if (typeof document !== "undefined" && document.hidden) {
              try {
                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                  new Notification("AFlow 完成", { body: content.slice(0, 80) || "任务已完成" });
                }
                navigator.vibrate?.(120);
              } catch {
                /* ignore */
              }
            }
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
    };
  }, [activeId, refreshSessions]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    api<{ models: string[]; engine?: string }>("GET", "/api/chat/meta")
      .then((m) => {
        setModels(m.models || []);
        setModel((cur) => cur || (m.models || [])[0] || "");
        if (m.engine) setEngine(m.engine);
      })
      .catch(() => undefined);
  }, []);

  /* request notification permission once, then subscribe for background push */
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const subscribePush = async () => {
      try {
        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        if (!reg.pushManager) return;
        const meta = await api<{ publicKey: string }>("GET", "/api/push/publickey");
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(meta.publicKey),
          });
        }
        const json = sub.toJSON();
        await api("POST", "/api/push/subscribe", {
          endpoint: json.endpoint,
          keys: json.keys,
        });
      } catch {
        /* push unsupported (e.g. iOS webview) — in-tab notifications still work */
      }
    };
    if (Notification.permission === "granted") {
      subscribePush();
    } else if (Notification.permission === "default") {
      Notification.requestPermission()
        .then((p) => {
          if (p === "granted") subscribePush();
        })
        .catch(() => undefined);
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
    async (text: string, images?: PendingImage[], files?: { name: string; text: string }[]) => {
      let id = activeId;
      const imgs = images || [];
      const fls = files || [];
      const finalText =
        text + fls.map((f) => `\n\n📄 ${f.name}：\n\`\`\`\n${f.text}\n\`\`\``).join("");
      // Clear attachment previews immediately — waiting for the upload made
      // them linger for seconds on mobile networks.
      setPendingImages([]);
      setPendingFiles([]);
      try {
        if (!id) {
          const session = await api<SessionMeta>("POST", "/api/chat/sessions");
          id = session.id;
          setActiveId(id);
          setDetail({ ...session, running: false, messages: [] });
          await api("POST", `/api/chat/sessions/${id}/options`, {
            model: model || undefined,
            gate_mode: gateMode,
          }).catch(() => undefined);
        }
        setDetail((d) =>
          d
            ? {
                ...d,
                messages: [
                  ...d.messages,
                  {
                    id: Date.now(),
                    role: "user",
                    content: finalText,
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
        const wasRunning = liveRunning || Boolean(detail?.running);
        if (!wasRunning) {
          // fresh turn: reset live buffers; a queued message must not
          // wipe the current turn's stream.
          liveTextRef.current = "";
          liveThinkingRef.current = "";
          liveToolsRef.current = [];
          setLiveText("");
          setLiveThinking("");
          setLiveTools([]);
          stickToBottom.current = true;
        }
        await api("POST", `/api/chat/sessions/${id}/messages`, {
          text: finalText,
          images: imgs.map((im) => ({ data: im.base64, mimeType: im.mimeType })),
        });
        refreshSessions();
      } catch (exc) {
        setLiveRunning(false);
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [activeId, refreshSessions, model, gateMode, liveRunning, detail],
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

  const pickImage = useCallback((file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setError("图片不能超过 8MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale phone photos before upload: 3MB originals meant slow
        // POSTs and slow vision turns. <=1280px JPEG is plenty for the model.
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext("2d");
        if (!g) return;
        g.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const base64 = dataUrl.split(",")[1] || "";
        if (!base64) return;
        setPendingImages((ps) =>
          ps.length >= 3 ? ps : [...ps, { dataUrl, base64, mimeType: "image/jpeg" }],
        );
      };
      img.onerror = () => setError("图片解析失败");
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  }, []);

  const pickFile = useCallback((file: File) => {
    if (file.size > 256 * 1024) {
      setError("文本文件不能超过 256KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      setPendingFiles((fs) => (fs.length >= 3 ? fs : [...fs, { name: file.name, text: content }]));
    };
    reader.readAsText(file);
  }, []);

  const changeModel = useCallback(
    async (m: string) => {
      setModel(m);
      if (!activeId) return;
      try {
        await api("POST", `/api/chat/sessions/${activeId}/options`, { model: m });
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [activeId],
  );

  const changeGateMode = useCallback(
    async (mode: "strict" | "auto") => {
      setGateMode(mode);
      if (!activeId) return;
      try {
        await api("POST", `/api/chat/sessions/${activeId}/options`, { gate_mode: mode });
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [activeId],
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
      data-testid="shell"
      className="flex w-screen flex-col overflow-hidden bg-background text-foreground"
      style={{ height: height ? `${height}px` : "100dvh" }}
    >
      {/* update snackbar (Material: actionable notices live at the bottom,
          thumb-reachable) — sits just above the composer */}
      {updateAvailable && (
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-3 py-2 text-xs backdrop-blur">
          <Sparkles size={14} className="shrink-0 text-primary" />
          <span className="flex-1">发现新版本</span>
          <button
            type="button"
            className="cursor-pointer rounded-lg bg-primary px-2.5 py-1 font-semibold text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            更新
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="cursor-pointer p-1 text-muted-foreground"
            onClick={() => setUpdateAvailable(false)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background/90 px-2 py-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] backdrop-blur">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="drawer-open" aria-label="会话列表">
              <Menu size={18} />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" data-testid="drawer" className="pt-[env(safe-area-inset-top)]">
            <SheetHeader className="flex-row items-center justify-between">
              <SheetTitle>会话</SheetTitle>
              <SheetClose asChild>
                <Button variant="outline" size="sm" onClick={() => newSession()}>
                  ＋ 新会话
                </Button>
              </SheetClose>
            </SheetHeader>
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
                <Search size={14} className="shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索会话…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {sessions.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无会话</div>
              )}
              {sessions
                .filter(
                  (s) =>
                    !query.trim() ||
                    (s.title || "").toLowerCase().includes(query.trim().toLowerCase()),
                )
                .map((s) => (
                <div
                  key={s.id}
                  data-testid="session-item"
                  className={cn(
                    "relative mb-0.5 cursor-pointer rounded-xl px-3 py-2.5 pr-9",
                    s.id === activeId ? "bg-primary/15" : "hover:bg-secondary/50 active:bg-secondary/50",
                  )}
                  onClick={() => openSession(s.id)}
                >
                  <div className="truncate text-sm">
                    {s.running && (
                      <span className="mr-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning [animation:aflow-pulse_1.2s_infinite]">
                        运行中
                      </span>
                    )}
                    {!s.running && (s.last_status === "failed" || s.last_status === "timeout") && (
                      <span className="mr-1.5 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                        {s.last_status === "failed" ? "失败" : "超时"}
                      </span>
                    )}
                    {s.title || "新会话"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(s.updated_at).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <button
                    type="button"
                    aria-label="删除会话"
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5",
                      armedDelete === s.id
                        ? "bg-destructive/15 text-xs text-destructive"
                        : "text-muted-foreground",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSession(s.id);
                    }}
                  >
                    {armedDelete === s.id ? "确认?" : <Trash2 size={13} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1 border-t border-border p-3">
              {(
                [
                  ["system", Monitor, "跟随系统"],
                  ["light", Sun, "浅色"],
                  ["dark", Moon, "深色"],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs",
                    themePref === value
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-secondary/60",
                  )}
                  onClick={() => setThemePref(value)}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[15px] font-semibold">
          <span className="truncate">{detail?.title || "AFlow"}</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] tracking-wide text-primary">
            {engine}
          </span>
        </div>

        <Button variant="ghost" size="icon" aria-label="新会话" onClick={() => newSession()}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
      </header>

      {/* pull-to-refresh indicator */}
      <div
        aria-hidden
        className="flex items-end justify-center overflow-hidden"
        style={{
          height: refreshing ? 40 : Math.min(pullPx, PULL_MAX) * 0.5,
          transition: dragging ? "none" : "height 0.25s cubic-bezier(0.2, 0.8, 0.4, 1)",
        }}
      >
        <div className="flex items-center gap-1.5 pb-1.5 text-[11px] text-muted-foreground">
          {refreshing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ArrowDown
              size={13}
              style={{
                transform: `rotate(${(Math.min(pullPx, PULL_TRIGGER) / PULL_TRIGGER) * 180}deg)`,
              }}
            />
          )}
          {refreshing ? "刷新中…" : pullPx > PULL_TRIGGER ? "释放刷新" : "下拉刷新"}
        </div>
      </div>

      {/* messages */}
      <div
        data-testid="scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3.5 [overscroll-behavior-y:contain]"
        style={{
          transform: `translateY(${refreshing ? 40 : pullPx}px)`,
          transition: dragging ? "none" : "transform 0.25s cubic-bezier(0.2, 0.8, 0.4, 1)",
        }}
      >
        {!activeId && (
          <div className="m-auto flex max-w-75 flex-col items-center px-6 text-center">
            <img src="/logo.png" alt="AFlow" className="mb-3 h-16 w-16" />
            <div className="mb-2 bg-gradient-to-br from-primary to-accent bg-[length:200%_200%] bg-clip-text text-3xl font-extrabold text-transparent [animation:aflow-shimmer_6s_ease-in-out_infinite]">
              AFlow
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              描述你的目标，Agent 会规划、执行并交付结果。
            </p>
            <div className="mt-5 flex w-full flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="cursor-pointer rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground active:bg-primary/15"
                  onClick={() => send(s)}
                >
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
            <AssistantBubble key={m.id} text={m.content} tools={m.tools || []} status={m.status} />
          ),
        )}
        {running && (
          <AssistantBubble
            text={liveText}
            thinking={liveThinking}
            tools={liveTools}
            streaming
          />
        )}
        {error && (
          <div
            data-testid="error"
            className="mx-auto flex max-w-[90%] items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <span>{error}</span>
            {lastUserText && (
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-md border border-destructive/50 px-2 py-0.5 text-[11px]"
                onClick={() => send(lastUserText)}
              >
                重试
              </button>
            )}
          </div>
        )}
      </div>

      {/* approval cards */}
      {approvals.length > 0 && (
        <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
          {approvals.map((a) => (
            <div
              key={a.request_id}
              className="rounded-xl border border-warning/40 bg-warning/10 p-3 [animation:aflow-fade-in_0.25s_ease-out_both]"
            >
              <div className="text-sm font-semibold text-warning">⚠️ {a.title}</div>
              <div className="mt-1 max-h-30 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-foreground/85">
                {a.message}
              </div>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" className="flex-1 bg-success hover:brightness-110"
                  onClick={() => decideApproval(a.request_id, true)}>
                  允许
                </Button>
                <Button size="sm" variant="destructive" className="flex-1"
                  onClick={() => decideApproval(a.request_id, false)}>
                  拒绝
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* composer */}
      <Chatbox
        running={running}
        images={pendingImages}
        files={pendingFiles}
        models={models}
        model={model || "qwen3.8-max"}
        gateMode={gateMode}
        onSend={(t) => send(t, pendingImages, pendingFiles)}
        onCancel={cancel}
        onPickImage={pickImage}
        onPickFile={pickFile}
        onRemoveImage={(i) => setPendingImages((ps) => ps.filter((_p, j) => j !== i))}
        onRemoveFile={(i) => setPendingFiles((fs) => fs.filter((_f, j) => j !== i))}
        onModel={changeModel}
        onGateMode={changeGateMode}
      />
    </div>
  );
}
