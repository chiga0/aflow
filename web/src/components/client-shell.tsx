import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronRight,
  Folder,
  Languages,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { runtimeApi, type Conversation } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui";

export function ClientShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const conversations = useQuery({
    queryKey: ["conversations", { includeArchived: true }],
    queryFn: () => runtimeApi.conversations(true),
    refetchInterval: 10000,
  });
  const approvals = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => runtimeApi.approvals("pending"),
    refetchInterval: 5000,
  });
  const pendingApprovalCount = approvals.data?.approvals?.length ?? 0;

  return (
    <div
      className={cn(
        "min-h-screen bg-background text-foreground md:grid",
        collapsed
          ? "md:grid-cols-[64px_minmax(0,1fr)]"
          : "md:grid-cols-[272px_minmax(0,1fr)]",
      )}
    >
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-card md:block">
        <ConversationSidebar
          collapsed={collapsed}
          conversations={conversations.data?.conversations ?? []}
          pendingApprovalCount={pendingApprovalCount}
          onCollapse={() => setCollapsed((value) => !value)}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden">
          <aside className="h-full w-[min(88vw,320px)] border-r border-border bg-card shadow-2xl">
            <ConversationSidebar
              conversations={conversations.data?.conversations ?? []}
              pendingApprovalCount={pendingApprovalCount}
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <section className="min-w-0">
        <button
          aria-label="打开会话导航"
          className="fixed left-2 top-1.5 z-40 grid h-11 w-11 place-items-center rounded-md border border-border bg-card shadow-sm md:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </button>
        <Outlet />
      </section>
    </div>
  );
}

function ConversationSidebar({
  collapsed = false,
  onClose,
  onCollapse,
  onNavigate,
  conversations,
  pendingApprovalCount,
}: {
  collapsed?: boolean;
  onClose?: () => void;
  onCollapse?: () => void;
  onNavigate?: () => void;
  conversations: Conversation[];
  pendingApprovalCount: number;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const session = useQuery({
    queryKey: ["auth", "session"],
    queryFn: runtimeApi.session,
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "completed" | "archived">("all");
  const roles = session.data?.principal?.roles ?? [];
  const canUseAdmin = roles.some((role) =>
    ["owner", "operator", "auditor"].includes(role),
  );
  const visibleConversations = useMemo(
    () => projectConversations(conversations, query, filter),
    [conversations, filter, query],
  );

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
        <Link
          aria-label="新建会话"
          className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted"
          to="/"
        >
          <Plus className="h-4 w-4" />
        </Link>
        <Link
          aria-label={
            pendingApprovalCount ? `${pendingApprovalCount} 项待审批` : "待审批"
          }
          className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-muted"
          to="/approvals"
        >
          <BellRing className="h-4 w-4" />
          {pendingApprovalCount ? (
            <span className="absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] text-white">
              {pendingApprovalCount > 9 ? "9+" : pendingApprovalCount}
            </span>
          ) : null}
        </Link>
        <button
          aria-label="展开会话导航"
          className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted"
          onClick={onCollapse}
        >
          <PanelLeftClose className="h-4 w-4 rotate-180" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-3">
        <Link
          className="flex items-center gap-2 px-2 text-sm font-semibold"
          to="/"
          onClick={onNavigate}
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-3.5 w-3.5" />
          </span>
          AgentFlow
        </Link>
        {onClose ? (
          <Button
            aria-label="关闭会话导航"
            className="h-11 w-11 md:h-9 md:w-9"
            size="icon"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            aria-label="收起会话导航"
            size="icon"
            variant="ghost"
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="grid gap-1 px-2">
        <Link
          className={cn(
            "flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted md:h-9",
            pathname === "/" && "bg-muted",
          )}
          to="/"
          onClick={onNavigate}
        >
          <Plus className="h-4 w-4" /> 新建会话
        </Link>
        <Link
          className={cn(
            "flex h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted md:h-9",
            pathname.startsWith("/approvals") && "bg-muted",
          )}
          to="/approvals"
          onClick={onNavigate}
        >
          <BellRing className="h-4 w-4" />
          <span className="flex-1">待我处理</span>
          {pendingApprovalCount ? (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-white">
              {pendingApprovalCount}
            </span>
          ) : null}
        </Link>
        <Link
          className={cn(
            "flex h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:h-9",
            pathname === "/mobile" && "bg-muted text-foreground",
          )}
          to="/mobile"
          onClick={onNavigate}
        >
          <Smartphone className="h-4 w-4" /> 移动决策台
        </Link>
        <button
          className={cn(
            "flex h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:h-9",
            filter === "completed" && "bg-muted text-foreground",
          )}
          onClick={() =>
            setFilter((value) => (value === "completed" ? "all" : "completed"))
          }
        >
          <CheckCircle2 className="h-4 w-4" />
          {filter === "completed" ? "返回全部会话" : "已完成"}
        </button>
        <button
          className={cn(
            "flex h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:h-9",
            filter === "archived" && "bg-muted text-foreground",
          )}
          onClick={() =>
            setFilter((value) => (value === "archived" ? "all" : "archived"))
          }
        >
          <Archive className="h-4 w-4" />
          {filter === "archived" ? "返回全部会话" : "已归档"}
        </button>
      </nav>

      <div className="px-3 py-3">
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground md:h-8">
          <Search className="h-3.5 w-3.5" />
          <input
            aria-label="搜索会话"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            placeholder="搜索会话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="mb-2 flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Folder className="h-3.5 w-3.5" /> 项目
        </div>
        <div className="mb-2 flex items-center justify-between px-2 text-sm font-medium">
          <span>agent-flow</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        {visibleConversations.length ? (
          <div className="grid gap-0.5">
            {visibleConversations.map((conversation) => (
              <ConversationLink
                key={conversation.conversation_id}
                active={pathname.startsWith(
                  `/conversations/${conversation.conversation_id}`,
                )}
                conversation={conversation}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {query ? "没有匹配的会话" : "还没有会话"}
          </div>
        )}
      </div>

      <div className="border-t border-border p-2">
        {canUseAdmin ? (
          <Link
            className="flex h-11 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:h-9"
            to="/admin"
            onClick={onNavigate}
          >
            <ShieldCheck className="h-4 w-4" /> 管理后台
          </Link>
        ) : null}
        <ClientPreferences />
      </div>
    </div>
  );
}

function projectConversations(
  conversations: Conversation[],
  query: string,
  filter: "all" | "completed" | "archived",
): Conversation[] {
  const value = query.trim().toLocaleLowerCase();
  return conversations
    .filter((conversation) => {
      if (filter === "archived") return Boolean(conversation.archived_at);
      if (conversation.archived_at) return false;
      return filter !== "completed" || conversation.status === "completed";
    })
    .filter((conversation) =>
      value
        ? `${conversation.title} ${conversation.latest_execution?.trigger_message ?? ""}`
            .toLocaleLowerCase()
            .includes(value)
        : true,
    );
}

function conversationSummary(conversation: Conversation) {
  if (conversation.pending_approval_count) {
    return `${conversation.pending_approval_count} 项等待审批`;
  }
  if (conversation.status === "active") return "正在执行";
  if (conversation.status === "waiting_user") return "等待你的决定";
  if (conversation.status === "failed") return "需要处理";
  if (conversation.status === "completed") return "已完成，可继续追问";
  return conversation.latest_execution?.trigger_message ?? "可以继续对话";
}

function ConversationLink({
  active,
  conversation,
  onNavigate,
}: {
  active: boolean;
  conversation: Conversation;
  onNavigate?: () => void;
}) {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (payload: { pinned?: boolean; archived?: boolean }) =>
      runtimeApi.updateConversation(conversation.conversation_id, {
        version: conversation.version,
        ...payload,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
  const state =
    conversation.status === "active"
      ? "active"
      : conversation.status === "failed" ||
          conversation.status === "waiting_user"
        ? "failed"
        : conversation.status === "completed"
          ? "completed"
          : "idle";
  return (
    <div
      className={cn(
        "group relative rounded-md text-sm transition-colors hover:bg-muted",
        active && "bg-muted",
      )}
    >
      <Link
        className="grid gap-1 px-3 py-2 pr-14"
        params={{ conversationId: conversation.conversation_id }}
        to="/conversations/$conversationId"
        onClick={onNavigate}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              state === "active" && "animate-pulse bg-warning",
              state === "completed" && "bg-success",
              state === "failed" && "bg-destructive",
              state === "idle" && "bg-muted-foreground/40",
            )}
          />
          <span className="truncate">{conversation.title}</span>
        </span>
        <span className="truncate pl-3.5 text-xs text-muted-foreground">
          {conversationSummary(conversation)}
        </span>
      </Link>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          aria-label={conversation.pinned_at ? "取消置顶会话" : "置顶会话"}
          className={cn(
            "grid h-7 w-7 place-items-center rounded hover:bg-background",
            conversation.pinned_at && "text-primary",
          )}
          disabled={update.isPending}
          onClick={() => update.mutate({ pinned: !conversation.pinned_at })}
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label={conversation.archived_at ? "恢复已归档会话" : "归档会话"}
          className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
          disabled={update.isPending}
          onClick={() => update.mutate({ archived: !conversation.archived_at })}
        >
          <Archive className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ClientPreferences() {
  const { locale, toggleLocale } = useI18n();
  const queryClient = useQueryClient();
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const logout = useMutation({
    mutationFn: runtimeApi.logout,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["auth", "session"] }),
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("cloud-agents-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="mt-1 flex items-center gap-1 px-1">
      <Button
        aria-label="切换语言"
        className="h-11 flex-1 md:h-8"
        size="sm"
        variant="ghost"
        onClick={toggleLocale}
      >
        <Languages className="h-4 w-4" /> {locale === "zh" ? "EN" : "中文"}
      </Button>
      <Button
        aria-label="切换主题"
        className="h-11 w-11 md:h-9 md:w-9"
        size="icon"
        variant="ghost"
        onClick={() => setDark((value) => !value)}
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
      <Button
        aria-label="退出登录"
        className="h-11 w-11 md:h-9 md:w-9"
        disabled={logout.isPending}
        size="icon"
        variant="ghost"
        onClick={() => logout.mutate()}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ActivityCapsule({
  label,
  lifted = false,
  onStop,
  pending = false,
}: {
  label: string;
  lifted?: boolean;
  onStop?: () => void;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "fixed left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-xs shadow-xl backdrop-blur md:left-[calc(50%+136px)]",
        lifted ? "bottom-36" : "bottom-3",
      )}
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
      <span className="max-w-64 truncate text-muted-foreground">{label}</span>
      {onStop ? (
        <button
          className="font-medium text-foreground hover:text-destructive"
          disabled={pending}
          onClick={onStop}
        >
          {pending ? "停止中" : "停止"}
        </button>
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
      )}
    </div>
  );
}
