import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  Bot,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Clock3,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  Layers3,
  MessageSquare,
  Network,
  Pencil,
  RadioTower,
  RefreshCw,
  Route,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  TerminalSquare,
  Users,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Metric,
  Select,
  StatusBadge,
  Textarea,
  statusLabel,
} from "./components/ui";
import { ActivityCapsule } from "./components/client-shell";
import {
  ApiError,
  conversationEventStreamHref,
  mobileNotificationStreamHref,
  runtimeApi,
  type ConversationContentBlock,
  type ConversationMessage,
  type ApprovalRequest,
  type MobileSnapshot,
  type MobileNotification,
  type V2AdminOverview,
  type V2AgentTask,
  type V2Artifact,
  type V2Channel,
  type V2ChannelMessage,
  type V2Evaluation,
  type V2Event,
  type V2Plan,
  type V2Replay,
  type V2Tenant,
  type V2WorkflowStep,
} from "./lib/api";

const modeOptions = [
  {
    value: "auto",
    label: "Auto",
    detail: "balanced",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    value: "workflow",
    label: "Workflow",
    detail: "DAG",
    icon: <Route className="h-4 w-4" />,
  },
  {
    value: "multi-agent",
    label: "Multi-agent",
    detail: "brain + workers",
    icon: <Layers3 className="h-4 w-4" />,
  },
];

const channelOptions = [
  { value: "web", label: "Web", icon: <MessageSquare className="h-4 w-4" /> },
  {
    value: "mobile",
    label: "Mobile",
    icon: <Smartphone className="h-4 w-4" />,
  },
  {
    value: "dingtalk",
    label: "DingTalk",
    icon: <RadioTower className="h-4 w-4" />,
  },
  {
    value: "feishu",
    label: "Feishu",
    icon: <RadioTower className="h-4 w-4" />,
  },
  { value: "wecom", label: "WeCom", icon: <RadioTower className="h-4 w-4" /> },
];

const adapterOptions = [
  { value: "auto", label: "Auto", icon: <Bot className="h-4 w-4" /> },
  {
    value: "qwen",
    label: "qwen-code",
    icon: <TerminalSquare className="h-4 w-4" />,
  },
  {
    value: "codex",
    label: "codex cli",
    icon: <TerminalSquare className="h-4 w-4" />,
  },
  {
    value: "claude",
    label: "claude code",
    icon: <TerminalSquare className="h-4 w-4" />,
  },
  {
    value: "opencode",
    label: "opencode",
    icon: <TerminalSquare className="h-4 w-4" />,
  },
  { value: "fake", label: "fake", icon: <CheckCircle2 className="h-4 w-4" /> },
];

const taskTemplates = [
  "把这个需求拆成可执行计划，并输出风险清单和验收标准。",
  "生成一份本周运维巡检报告，标出异常、影响和下一步动作。",
  "审计当前项目的部署链路，给出可以直接执行的修复顺序。",
];

export function ProductClientPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState("auto");
  const [channel, setChannel] = useState("web");
  const [adapter, setAdapter] = useState("auto");
  const conversations = useQuery({
    queryKey: ["conversations", { includeArchived: true }],
    queryFn: () => runtimeApi.conversations(true),
    refetchInterval: 10000,
  });
  const overview = useQuery({
    queryKey: ["v2", "admin", "overview"],
    queryFn: runtimeApi.v2AdminOverview,
    refetchInterval: 5000,
  });
  const createConversation = useMutation({
    mutationFn: runtimeApi.createConversation,
    onSuccess: async (conversation) => {
      setGoal("");
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await navigate({
        to: "/conversations/$conversationId",
        params: { conversationId: conversation.conversation_id },
      });
    },
  });
  const channels = overview.data?.channels ?? [];
  const units = overview.data?.execution_units ?? [];
  const availableAdapters = Array.from(
    new Set(units.flatMap((unit) => unit.adapters)),
  );
  const activeCount = (conversations.data?.conversations ?? []).filter(
    (conversation) => ["active", "waiting_user"].includes(conversation.status),
  ).length;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal.trim()) {
      return;
    }
    createConversation.mutate({
      goal: goal.trim(),
      mode,
      channel,
      adapter,
      metadata: { product_surface: "client", conversation_projection: true },
    });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-14 md:px-5">
        <div>
          <h1 className="text-sm font-semibold">新建会话</h1>
          <p className="text-xs text-muted-foreground">agent-flow</p>
        </div>
        {activeCount ? (
          <Badge tone="warn">{activeCount} 个任务在后台运行</Badge>
        ) : (
          <Badge tone="ok">已就绪</Badge>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-6 pt-[10vh] sm:px-8">
        <section className="flex-1">
          <div className="mx-auto grid max-w-xl justify-items-center gap-3 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-xl border border-border bg-card shadow-sm">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              今天想完成什么？
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              描述目标即可。AgentFlow 会自动规划工作、组织多个 Agent，
              并且只在需要你做决定时打断你。
            </p>
          </div>

          <div className="mt-8 grid gap-2 sm:grid-cols-3">
            {taskTemplates.map((template) => (
              <button
                key={template}
                className="rounded-lg border border-border bg-card p-3 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                type="button"
                onClick={() => setGoal(template)}
              >
                {template}
              </button>
            ))}
          </div>
        </section>

        <form
          aria-label="New Task"
          className="sticky bottom-3 mt-8 rounded-2xl border border-border bg-card p-3 shadow-xl"
          onSubmit={submit}
        >
          <Textarea
            aria-label="任务目标"
            className="min-h-28 w-full resize-none border-0 bg-transparent px-1 py-1 text-base shadow-none focus:ring-0"
            placeholder="向 AgentFlow 描述你的任务……"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
            <details className="group relative">
              <summary className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                执行设置（高级）
              </summary>
              <div className="absolute bottom-14 z-20 grid w-[min(420px,calc(100vw-3rem))] gap-3 rounded-lg border border-border bg-card p-3 shadow-xl sm:grid-cols-3">
                <Field label="执行方式">
                  <Select
                    className="h-11 sm:h-9"
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                  >
                    {modeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Agent CLI">
                  <Select
                    className="h-11 sm:h-9"
                    value={adapter}
                    onChange={(event) => setAdapter(event.target.value)}
                  >
                    {adapterOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                        {option.value !== "auto" &&
                        !availableAdapters.includes(option.value)
                          ? "（未发现）"
                          : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="来源渠道">
                  <Select
                    className="h-11 sm:h-9"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value)}
                  >
                    {channelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                        {channelStatus(channels, option.value) === "configured"
                          ? ""
                          : "（未配置）"}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </details>

            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Enter 发送
              </span>
              <Button
                aria-label={
                  createConversation.isPending ? "正在启动" : "发送任务"
                }
                disabled={createConversation.isPending || !goal.trim()}
                className="h-11 w-11 sm:h-9 sm:w-9"
                size="icon"
                type="submit"
                variant="primary"
              >
                {createConversation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          {createConversation.isError ? (
            <p className="mt-2 text-xs text-destructive">
              任务暂时无法启动，请检查连接后重试。
            </p>
          ) : null}
        </form>
      </main>
      {activeCount ? (
        <ActivityCapsule label={`${activeCount} 个会话正在后台推进`} />
      ) : null}
    </div>
  );
}

function modeLabel(value: string) {
  return modeOptions.find((option) => option.value === value)?.label ?? value;
}

function adapterLabel(value: string) {
  return (
    adapterOptions.find((option) => option.value === value)?.label ?? value
  );
}

function channelStatus(
  channels: V2AdminOverview["channels"],
  platform: string,
) {
  return (
    channels.find((channel) => channel.platform === platform)?.status ??
    (platform === "web" ? "configured" : "reserved")
  );
}

type ConversationCanvasTab =
  | "plan"
  | "agents"
  | "diff"
  | "files"
  | "artifacts"
  | "workflow"
  | "evaluation"
  | "activity";

const conversationCanvasTabs: Array<{
  id: ConversationCanvasTab;
  label: string;
}> = [
  { id: "plan", label: "计划" },
  { id: "agents", label: "Agent" },
  { id: "diff", label: "变更" },
  { id: "files", label: "文件" },
  { id: "artifacts", label: "产物" },
  { id: "workflow", label: "流程" },
  { id: "evaluation", label: "验收" },
  { id: "activity", label: "活动" },
];

export function ProductConversationPage() {
  const {
    conversationId,
    canvasTab: routeCanvasTab,
    entityId: routeEntityId,
  } = useParams({
    strict: false,
  }) as { conversationId: string; canvasTab?: string; entityId?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contextCanvasRef = useRef<HTMLElement>(null);
  const cursorRef = useRef(0);
  const [message, setMessage] = useState("");
  const [streamState, setStreamState] = useState<
    "connecting" | "connected" | "reconnecting" | "unsupported"
  >("connecting");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string>();
  const [historicalMessages, setHistoricalMessages] = useState<
    ConversationMessage[]
  >([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const canvasTab = normalizeCanvasTab(routeCanvasTab);
  const fallbackInterval = streamState === "connected" ? false : 5000;

  const conversation = useQuery({
    queryKey: ["conversations", conversationId],
    queryFn: () => runtimeApi.conversation(conversationId),
    refetchInterval: fallbackInterval,
  });
  const messages = useQuery({
    queryKey: ["conversations", conversationId, "messages"],
    queryFn: () => runtimeApi.conversationMessages(conversationId),
    refetchInterval: fallbackInterval,
  });
  const canvas = useQuery({
    queryKey: ["conversations", conversationId, "canvas"],
    queryFn: () => runtimeApi.conversationCanvas(conversationId),
    refetchInterval: fallbackInterval,
  });
  const activity = useQuery({
    queryKey: ["conversations", conversationId, "activity"],
    queryFn: () => runtimeApi.conversationActivity(conversationId),
    refetchInterval: fallbackInterval,
  });

  const refreshConversation = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      queryClient.invalidateQueries({
        queryKey: ["conversations", conversationId],
      }),
    ]);
  };
  const sendMessage = useMutation({
    mutationFn: () =>
      runtimeApi.submitConversationMessage(conversationId, message.trim()),
    onSuccess: async () => {
      setMessage("");
      await refreshConversation();
    },
  });
  const stop = useMutation({
    mutationFn: () => runtimeApi.stopConversation(conversationId),
    onSuccess: refreshConversation,
  });
  const replay = useMutation({
    mutationFn: () =>
      runtimeApi.v2ReplayTask(
        conversation.data?.latest_execution?.task_id ?? "",
      ),
    onSuccess: refreshConversation,
  });
  const retry = useMutation({
    mutationFn: () =>
      runtimeApi.v2RetryTask(
        conversation.data?.latest_execution?.task_id ?? "",
      ),
    onSuccess: refreshConversation,
  });
  const retryFailed = useMutation({
    mutationFn: () =>
      runtimeApi.v2RetryFailedSteps(
        conversation.data?.latest_execution?.task_id ?? "",
      ),
    onSuccess: refreshConversation,
  });
  const acceptPartial = useMutation({
    mutationFn: () =>
      runtimeApi.v2AcceptPartialResult(
        conversation.data?.latest_execution?.task_id ?? "",
      ),
    onSuccess: refreshConversation,
  });
  const loadOlderMessages = useMutation({
    mutationFn: () => {
      const firstCursor = Math.min(
        ...(historicalMessages.length
          ? historicalMessages
          : (messages.data?.messages ?? [])
        ).map((item) => item.cursor),
      );
      return runtimeApi.conversationMessages(
        conversationId,
        0,
        Number.isFinite(firstCursor) ? firstCursor : undefined,
        200,
      );
    },
    onSuccess: (page) => {
      setHistoricalMessages((currentMessages) => {
        const byId = new Map(
          [...page.messages, ...currentMessages].map((item) => [
            item.message_id,
            item,
          ]),
        );
        return [...byId.values()].sort(
          (left, right) => left.cursor - right.cursor,
        );
      });
      setHasOlderMessages(page.messages.length === 200);
    },
  });

  useEffect(() => {
    setHistoricalMessages([]);
    setHasOlderMessages(true);
  }, [conversationId]);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  useEffect(() => {
    const nextCursor = Math.max(
      0,
      ...(messages.data?.messages.map((item) => item.cursor) ?? [0]),
    );
    cursorRef.current = Math.max(cursorRef.current, nextCursor);
  }, [messages.data]);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setStreamState("unsupported");
      return;
    }
    setStreamState("connecting");
    const source = new EventSource(
      conversationEventStreamHref(conversationId, cursorRef.current),
    );
    source.onopen = () => setStreamState("connected");
    const receiveMessage = (event: MessageEvent<string>) => {
      try {
        const projected = JSON.parse(event.data) as ConversationMessage;
        cursorRef.current = Math.max(cursorRef.current, projected.cursor);
      } catch {
        // A malformed event cannot invalidate the durable HTTP projection.
      }
      void refreshConversation();
    };
    source.onmessage = receiveMessage;
    source.addEventListener?.(
      "conversation.message",
      receiveMessage as EventListener,
    );
    source.onerror = () => setStreamState("reconnecting");
    return () => source.close();
    // Query invalidation is intentionally keyed only by the conversation id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    const latest = canvas.data?.latest_execution?.execution_id;
    if (!selectedExecutionId && latest) {
      setSelectedExecutionId(latest);
    }
  }, [canvas.data?.latest_execution?.execution_id, selectedExecutionId]);

  useEffect(() => {
    if (!routeEntityId) return;
    window.requestAnimationFrame(() => {
      document
        .getElementById(`canvas-entity-${routeEntityId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [routeEntityId, selectedExecutionId, canvasTab]);

  const current = conversation.data;
  const visibleMessages = [
    ...historicalMessages,
    ...(messages.data?.messages ?? []),
  ]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) => candidate.message_id === item.message_id,
        ) === index,
    )
    .sort((left, right) => left.cursor - right.cursor);
  const executions = canvas.data?.executions ?? [];
  const selectedExecution =
    executions.find(
      (execution) => execution.execution_id === selectedExecutionId,
    ) ??
    canvas.data?.latest_execution ??
    null;
  const active = current?.status === "active";
  const waitingForUser = current?.status === "waiting_user";
  const failed = current?.status === "failed";
  const hasPartialArtifacts = Boolean(
    canvas.data?.latest_execution?.artifacts.length,
  );

  const submitFollowUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (message.trim() && online) {
      sendMessage.mutate();
    }
  };
  const openCanvas = (tab: ConversationCanvasTab, entityId?: string) => {
    if (entityId) {
      void navigate({
        to: "/conversations/$conversationId/canvas/$canvasTab/$entityId",
        params: { conversationId, canvasTab: tab, entityId },
      });
    } else {
      void navigate({
        to: "/conversations/$conversationId/canvas/$canvasTab",
        params: { conversationId, canvasTab: tab },
      });
    }
    if (window.innerWidth < 1280) {
      window.requestAnimationFrame(() =>
        contextCanvasRef.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        }),
      );
    }
  };

  const locateChatEntity = (entityId: string) => {
    const message = document.getElementById(`chat-entity-${entityId}`);
    message?.scrollIntoView({ behavior: "smooth", block: "center" });
    message?.focus();
  };

  return (
    <div className="grid min-h-screen min-w-0 grid-rows-[56px_minmax(0,1fr)] overflow-x-hidden">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-14 md:px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {current?.title ?? "正在加载会话"}
          </h1>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>agent-flow</span>
            {current ? (
              <StatusBadge
                status={current.status}
                label={statusLabel(current.status)}
              />
            ) : null}
            <span aria-label="实时连接状态" title={`实时连接：${streamState}`}>
              {streamState === "connected" ? "实时" : "同步中"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label="重新执行"
            disabled={retry.isPending || active || !current?.latest_execution}
            size="sm"
            variant="ghost"
            onClick={() => retry.mutate()}
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">重试</span>
          </Button>
          <Button
            aria-label="保存回放"
            disabled={replay.isPending || !current?.latest_execution}
            size="sm"
            variant="ghost"
            onClick={() => replay.mutate()}
          >
            <Clock3 className="h-4 w-4" />
            <span className="hidden sm:inline">快照</span>
          </Button>
        </div>
      </header>

      {!online ? (
        <div className="fixed inset-x-0 top-14 z-40 flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-xs text-warning-foreground md:left-[272px]">
          <AlertTriangle className="h-3.5 w-3.5" />
          当前离线。会话仍保留在远端，恢复连接后会自动同步。
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(460px,1fr)_minmax(360px,42%)]">
        <main className="relative flex min-h-0 min-w-0 flex-col xl:border-r xl:border-border">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-3xl gap-4 px-5 pb-36 pt-7 sm:px-8">
              {conversation.isError || messages.isError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
                  <div className="font-medium">暂时无法加载这个会话</div>
                  <p className="mt-1 text-muted-foreground">
                    请检查网络连接后重试。远端执行不会因此中断。
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    onClick={() => void refreshConversation()}
                  >
                    <RefreshCw className="h-4 w-4" /> 重新同步
                  </Button>
                </div>
              ) : null}

              {hasOlderMessages &&
              (messages.data?.messages.length ?? 0) === 200 ? (
                <div className="flex justify-center">
                  <Button
                    disabled={loadOlderMessages.isPending}
                    size="sm"
                    onClick={() => loadOlderMessages.mutate()}
                  >
                    {loadOlderMessages.isPending ? "正在加载" : "加载更早消息"}
                  </Button>
                </div>
              ) : null}

              <ConversationMessageList
                messages={visibleMessages}
                onOpenCanvas={openCanvas}
              />

              {!messages.isPending &&
              !(messages.data?.messages ?? []).length ? (
                <EmptyState title="会话正在准备中" />
              ) : null}

              {waitingForUser ? (
                <Link
                  className="grid w-full gap-1 rounded-lg border border-warning/40 bg-warning/10 p-4 text-left"
                  to="/approvals"
                >
                  <span className="text-sm font-medium">需要你的决定</span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    Agent 已停在安全边界。查看意图、证据和影响面后再决定。
                  </span>
                </Link>
              ) : null}

              {failed ? (
                <div
                  role="alert"
                  className="grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
                >
                  <div>
                    <h2 className="text-sm font-semibold">
                      这次执行没有全部完成
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      已完成步骤和产物会保留。你可以只重试失败及未执行步骤、修改目标后继续，或接受已有结果。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={retryFailed.isPending || !online}
                      onClick={() => retryFailed.mutate()}
                    >
                      <RefreshCw className="h-4 w-4" /> 仅重试失败步骤
                    </Button>
                    <Button
                      onClick={() =>
                        document
                          .querySelector<HTMLTextAreaElement>(
                            'textarea[aria-label="继续对话"]',
                          )
                          ?.focus()
                      }
                    >
                      <Pencil className="h-4 w-4" /> 修改目标后继续
                    </Button>
                    <Button
                      disabled={
                        !hasPartialArtifacts ||
                        acceptPartial.isPending ||
                        !online
                      }
                      onClick={() => acceptPartial.mutate()}
                    >
                      <CheckCircle2 className="h-4 w-4" /> 接受已有结果
                    </Button>
                  </div>
                  {retryFailed.isError || acceptPartial.isError ? (
                    <p className="text-xs text-destructive">
                      恢复操作未生效，状态可能已在其他设备变化。请重新同步后再试。
                    </p>
                  ) : null}
                  {!hasPartialArtifacts ? (
                    <p className="text-xs text-muted-foreground">
                      当前没有通过验证的部分产物，因此不能接受部分结果。
                    </p>
                  ) : null}
                </div>
              ) : null}

              {active ? (
                <div className="flex items-center gap-3 border-t border-border py-4 text-sm text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
                  Agent 正在后台继续工作，你可以安全切换到其他会话。
                </div>
              ) : null}
            </div>
          </div>

          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 md:absolute md:z-auto">
            <form
              className="pointer-events-auto mx-auto mb-4 w-[calc(100%-2rem)] max-w-3xl rounded-2xl border border-border bg-card p-3 shadow-xl"
              onSubmit={submitFollowUp}
            >
              <Textarea
                aria-label="继续对话"
                className="min-h-20 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus:ring-0"
                disabled={!online}
                placeholder={
                  current && !active
                    ? "继续追问会创建一次新的执行……"
                    : "补充要求、上下文或下一步指令……"
                }
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {current && !active
                    ? "新执行仍保留完整会话上下文"
                    : "消息会进入当前执行"}
                </span>
                <Button
                  aria-label="发送消息"
                  disabled={!online || !message.trim() || sendMessage.isPending}
                  size="icon"
                  type="submit"
                  variant="primary"
                >
                  {sendMessage.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {sendMessage.isError ? (
                <p className="mt-2 text-xs text-destructive">
                  消息未发送。内容仍保留在输入框中，请重试。
                </p>
              ) : null}
            </form>
          </div>
        </main>

        <aside
          id="context-canvas"
          ref={contextCanvasRef}
          className="min-h-screen min-w-0 scroll-mt-12 border-t border-border bg-card/30 xl:min-h-0 xl:border-t-0"
        >
          <nav
            aria-label="Canvas 视图"
            className="sticky top-0 z-10 flex min-h-12 items-center gap-1 overflow-x-auto border-b border-border bg-background/95 px-3 backdrop-blur"
          >
            {conversationCanvasTabs.map((tab) => (
              <CanvasTab
                key={tab.id}
                active={canvasTab === tab.id}
                label={tab.label}
                onClick={() => openCanvas(tab.id)}
              />
            ))}
          </nav>
          <div className="grid gap-4 p-4 pb-40 lg:p-5 xl:pb-5">
            {executions.length > 1 ? (
              <Field label="查看历史执行">
                <Select
                  aria-label="选择执行"
                  value={selectedExecution?.execution_id ?? ""}
                  onChange={(event) =>
                    setSelectedExecutionId(event.target.value)
                  }
                >
                  {executions.map((execution) => (
                    <option
                      key={execution.execution_id}
                      value={execution.execution_id}
                    >
                      第 {execution.sequence} 次 ·{" "}
                      {statusLabel(execution.status)} ·{" "}
                      {execution.trigger_message}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {canvasTab === "plan" ? (
              <section
                id={
                  selectedExecution?.plan
                    ? `canvas-entity-${selectedExecution.plan.plan_id}`
                    : undefined
                }
                className="grid scroll-mt-16 gap-3"
              >
                <CanvasHeading
                  title="执行计划"
                  detail="目标、阶段与依赖来自服务端结构化计划。"
                />
                <PlanOverview plan={selectedExecution?.plan ?? null} />
              </section>
            ) : null}

            {canvasTab === "agents" ? (
              <section className="grid gap-3">
                <CanvasHeading
                  title="Agent 协作"
                  detail="系统自动组织工作；选择节点可回到相关会话简报。"
                />
                <AgentDag
                  agents={selectedExecution?.plan?.agent_tasks ?? []}
                  highlightedAgentId={routeEntityId}
                  onLocateChat={locateChatEntity}
                />
              </section>
            ) : null}

            {canvasTab === "diff" ? (
              <section className="grid gap-3">
                <CanvasHeading
                  title="文件变更"
                  detail="只展示执行器明确返回的结构化 Diff，不从自然语言猜测。"
                />
                <DiffArtifactList
                  artifacts={selectedExecution?.artifacts ?? []}
                />
              </section>
            ) : null}

            {canvasTab === "files" ? (
              <section className="grid gap-3">
                <CanvasHeading
                  title="文件与引用"
                  detail="展示本次执行产生或引用的文件；不会向移动端同步完整工作区。"
                />
                <FileReferenceList
                  artifacts={selectedExecution?.artifacts ?? []}
                />
              </section>
            ) : null}

            {canvasTab === "artifacts" ? (
              <section
                id={
                  selectedExecution
                    ? `canvas-entity-${selectedExecution.task_id}`
                    : undefined
                }
                className="grid scroll-mt-16 gap-3"
              >
                <CanvasHeading
                  title="任务产物"
                  detail="每次执行的结果独立保存，可回看和比较。"
                />
                <ArtifactList artifacts={selectedExecution?.artifacts ?? []} />
              </section>
            ) : null}

            {canvasTab === "workflow" ? (
              <section className="grid gap-3">
                <CanvasHeading
                  title="工作流程"
                  detail="确定性阶段、依赖顺序和重试状态。"
                />
                <WorkflowSteps
                  steps={selectedExecution?.workflow.steps ?? []}
                />
              </section>
            ) : null}

            {canvasTab === "evaluation" ? (
              <section className="grid gap-3">
                <CanvasHeading
                  title="验收结果"
                  detail="验收条件、证据和失败原因来自结构化评估。"
                />
                <EvaluationList
                  evaluations={selectedExecution?.evaluations ?? []}
                />
              </section>
            ) : null}

            {canvasTab === "activity" ? (
              <>
                <section className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">当前微状态</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        只展示行动摘要；调试细节默认降噪。
                      </p>
                    </div>
                    <StatusBadge
                      status={activity.data?.status ?? "loading"}
                      label={statusLabel(activity.data?.status ?? "loading")}
                    />
                  </div>
                  {activity.data?.active_agent ? (
                    <div className="rounded-lg border border-border bg-card p-3 text-sm">
                      <div className="font-medium">
                        {activity.data.active_agent.role} ·{" "}
                        {activity.data.active_agent.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {activity.data.progress?.percent ?? 0}% 完成
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="没有正在运行的 Agent" />
                  )}
                </section>
                <section className="grid gap-3 border-t border-border pt-4">
                  <h2 className="text-sm font-semibold">执行历史</h2>
                  <ExecutionHistory executions={executions} />
                </section>
                <section className="grid gap-3 border-t border-border pt-4">
                  <div>
                    <h2 className="text-sm font-semibold">调试事件</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      原始事件默认折叠，仅用于排查与审计。
                    </p>
                  </div>
                  <details className="rounded-lg border border-border bg-card">
                    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium sm:min-h-9 sm:py-2">
                      展开原始事件
                    </summary>
                    <div className="border-t border-border p-3">
                      <EventTimeline events={selectedExecution?.events ?? []} />
                    </div>
                  </details>
                </section>
                <section className="grid gap-3 border-t border-border pt-4">
                  <h2 className="text-sm font-semibold">历史快照</h2>
                  <ReplayList replays={selectedExecution?.replays ?? []} />
                </section>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {active ? (
        <ActivityCapsule
          lifted
          label={
            activity.data?.active_agent
              ? `${activity.data.active_agent.role} · ${activity.data.active_agent.title}`
              : "Agent 正在后台执行"
          }
          pending={stop.isPending}
          onStop={() => stop.mutate()}
        />
      ) : null}
    </div>
  );
}

function normalizeCanvasTab(value?: string): ConversationCanvasTab {
  return conversationCanvasTabs.some((tab) => tab.id === value)
    ? (value as ConversationCanvasTab)
    : "plan";
}

function ConversationMessageList({
  messages,
  onOpenCanvas,
}: {
  messages: ConversationMessage[];
  onOpenCanvas: (tab: ConversationCanvasTab, entityId?: string) => void;
}) {
  let previousExecution = "";
  return (
    <section aria-label="会话消息" className="grid gap-4">
      {messages.map((message) => {
        const showExecution = previousExecution !== message.execution_id;
        const linkedEntity = message.content.find(
          (block) => block.type === "entity_ref",
        );
        previousExecution = message.execution_id;
        return (
          <div key={message.message_id} className="grid gap-3">
            {showExecution ? (
              <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                新的执行
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <article
              id={
                linkedEntity?.type === "entity_ref" && linkedEntity.entity_id
                  ? `chat-entity-${linkedEntity.entity_id}`
                  : undefined
              }
              tabIndex={linkedEntity ? -1 : undefined}
              className={
                message.role === "user"
                  ? "ml-auto grid max-w-[85%] gap-2 break-words rounded-2xl rounded-br-sm bg-muted px-4 py-3 text-sm leading-6"
                  : message.role === "system"
                    ? "grid gap-2 border-l-2 border-border py-1 pl-4 text-sm leading-6 text-muted-foreground"
                    : "grid max-w-3xl gap-2 text-sm leading-6"
              }
            >
              {message.role === "agent" ? (
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Bot className="h-3.5 w-3.5" /> AgentFlow
                </div>
              ) : null}
              {message.content.map((block, index) => (
                <ConversationContent
                  key={`${message.message_id}-${index}`}
                  block={block}
                  onOpenCanvas={onOpenCanvas}
                />
              ))}
            </article>
          </div>
        );
      })}
    </section>
  );
}

function ConversationContent({
  block,
  onOpenCanvas,
}: {
  block: ConversationContentBlock;
  onOpenCanvas: (tab: ConversationCanvasTab, entityId?: string) => void;
}) {
  const navigate = useNavigate();
  if (block.type === "text") {
    return <p className="whitespace-pre-wrap">{block.text}</p>;
  }
  if (block.type === "entity_ref") {
    if (block.entity_type === "approval") {
      return (
        <button
          className="flex min-h-11 w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted sm:min-h-9"
          onClick={() =>
            void navigate({
              to: block.entity_id ? "/approvals/$approvalId" : "/approvals",
              params: block.entity_id
                ? { approvalId: block.entity_id }
                : undefined,
            })
          }
        >
          <ShieldAlert className="h-3.5 w-3.5" /> {block.label}
        </button>
      );
    }
    const tab =
      block.entity_type === "plan"
        ? "plan"
        : block.entity_type === "agents"
          ? "agents"
          : block.entity_type === "artifacts"
            ? "artifacts"
            : block.entity_type === "evaluation"
              ? "evaluation"
              : block.entity_type === "workflow"
                ? "workflow"
                : "activity";
    return (
      <button
        className="flex min-h-11 w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted sm:min-h-9"
        onClick={() => onOpenCanvas(tab, block.entity_id || undefined)}
      >
        {block.entity_type === "plan" ? (
          <GitBranch className="h-3.5 w-3.5" />
        ) : (
          <Boxes className="h-3.5 w-3.5" />
        )}
        {block.label}
      </button>
    );
  }
  return (
    <a className="text-xs text-primary underline" href={block.href}>
      {block.name}
    </a>
  );
}

function ExecutionHistory({
  executions,
}: {
  executions: Array<{
    execution_id: string;
    sequence: number;
    status: string;
    trigger_message: string;
    created_at: string;
  }>;
}) {
  if (!executions.length) {
    return <EmptyState title="暂无执行记录" />;
  }
  return (
    <div className="grid gap-2">
      {[...executions].reverse().map((execution) => (
        <div
          key={execution.execution_id}
          className="grid gap-1 rounded-md border border-border bg-card p-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">第 {execution.sequence} 次执行</span>
            <StatusBadge
              status={execution.status}
              label={statusLabel(execution.status)}
            />
          </div>
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {execution.trigger_message}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ProductApprovalsPage() {
  const { approvalId } = useParams({ strict: false }) as {
    approvalId?: string;
  };
  const approvals = useQuery({
    queryKey: ["approvals", "all"],
    queryFn: () => runtimeApi.approvals("all"),
    refetchInterval: 5000,
  });
  const approval = useQuery({
    queryKey: ["approvals", approvalId],
    queryFn: () => runtimeApi.approval(approvalId ?? ""),
    enabled: Boolean(approvalId),
    refetchInterval: 5000,
  });
  const pending = (approvals.data?.approvals ?? []).filter(
    (item) => item.status === "pending",
  );
  const resolved = (approvals.data?.approvals ?? []).filter(
    (item) => item.status !== "pending",
  );

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border px-14 md:px-5">
        <div>
          <h1 className="text-sm font-semibold">待我处理</h1>
          <p className="text-xs text-muted-foreground">
            Agent 只会在权限边界和高风险节点打断你
          </p>
        </div>
        <Badge tone={pending.length ? "warn" : "ok"}>
          {pending.length ? `${pending.length} 项待决策` : "已清空"}
        </Badge>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-5 p-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <section aria-label="审批队列" className="grid content-start gap-4">
          {approvals.isError ? (
            <LoadFailure onRetry={() => void approvals.refetch()} />
          ) : null}
          {!approvals.isPending && !pending.length ? (
            <Card>
              <CardBody>
                <EmptyState title="目前没有待处理事项" />
              </CardBody>
            </Card>
          ) : null}
          {pending.map((item) => (
            <ApprovalQueueLink
              key={item.approval_id}
              active={approvalId === item.approval_id}
              approval={item}
            />
          ))}
          {resolved.length ? (
            <details className="rounded-lg border border-border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                最近已处理（{resolved.length}）
              </summary>
              <div className="grid gap-1 border-t border-border p-2">
                {resolved.slice(0, 10).map((item) => (
                  <ApprovalQueueLink
                    key={item.approval_id}
                    active={approvalId === item.approval_id}
                    approval={item}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <section aria-label="审批详情" className="min-w-0">
          {approvalId ? (
            approval.isError ? (
              <LoadFailure onRetry={() => void approval.refetch()} />
            ) : approval.data ? (
              <ApprovalDetail approval={approval.data} />
            ) : (
              <Card>
                <CardBody>
                  <EmptyState title="正在加载决策上下文" />
                </CardBody>
              </Card>
            )
          ) : pending[0] ? (
            <ApprovalDetail approval={pending[0]} />
          ) : (
            <Card>
              <CardBody className="grid min-h-64 place-items-center text-center">
                <div>
                  <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
                  <h2 className="mt-3 text-base font-semibold">无需处理</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    你可以离开此页面，远端任务会继续执行。
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}

function ApprovalQueueLink({
  active,
  approval,
}: {
  active: boolean;
  approval: ApprovalRequest;
}) {
  return (
    <Link
      className={`grid gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
        active ? "border-primary bg-muted" : "border-border bg-card"
      }`}
      params={{ approvalId: approval.approval_id }}
      to="/approvals/$approvalId"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="line-clamp-2 text-sm font-medium">
          {approval.intent}
        </span>
        <Badge tone={approval.impact.level === "high" ? "bad" : "warn"}>
          {impactLabel(approval.impact.level)}
        </Badge>
      </div>
      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {approval.impact.summary}
      </p>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <StatusBadge
          status={approval.status}
          label={approvalStatusLabel(approval.status)}
        />
        <span>{formatDateTime(approval.created_at)}</span>
      </div>
    </Link>
  );
}

function ApprovalDetail({ approval }: { approval: ApprovalRequest }) {
  const queryClient = useQueryClient();
  const online = useOnlineState();
  const approveTriggerRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const decide = useMutation({
    mutationFn: (payload: {
      action: "approve" | "reject" | "pause" | "revise";
      confirmed?: boolean;
    }) =>
      runtimeApi.decideApproval(approval.approval_id, {
        ...payload,
        version: approval.version,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-snapshot"] }),
      ]);
    },
  });
  const isPending = approval.status === "pending";
  const highRisk = approval.impact.level === "high";
  const needsReason = reason.trim().length > 0;

  const closeConfirmation = () => {
    approveTriggerRef.current?.focus();
    setConfirming(false);
  };

  const act = (action: "approve" | "reject" | "pause" | "revise") => {
    if (action === "approve" && highRisk) {
      setConfirming(true);
      return;
    }
    decide.mutate({ action });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            <CardTitle>决策详情</CardTitle>
            <StatusBadge
              status={approval.status}
              label={approvalStatusLabel(approval.status)}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            请求于 {formatDateTime(approval.created_at)} · 版本{" "}
            {approval.version}
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center text-xs text-primary hover:underline md:min-h-0"
          params={{ conversationId: approval.conversation_id }}
          to="/conversations/$conversationId"
        >
          返回会话
        </Link>
      </CardHeader>
      <CardBody className="grid gap-5">
        {!online ? (
          <div
            role="status"
            className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs leading-5"
          >
            当前离线。你仍可核对最近同步的内容，但恢复连接前不能提交决策，以免重复批准。
          </div>
        ) : null}
        <DecisionSection index="1" title="Agent 想做什么">
          <p className="text-sm leading-6">{approval.intent}</p>
        </DecisionSection>

        <DecisionSection index="2" title="关键证据">
          <div className="grid gap-2">
            {approval.evidence.length ? (
              approval.evidence.map((evidence, index) => (
                <div
                  key={`${evidence.type}-${index}`}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <FileText className="h-3.5 w-3.5" />
                    {evidence.label ?? evidence.type}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                    {evidence.summary ??
                      evidence.snippet ??
                      evidence.ref ??
                      "已由 Agent 提供证据引用"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                此请求没有附加证据，不建议直接批准。
              </p>
            )}
          </div>
        </DecisionSection>

        <DecisionSection index="3" title="影响面评估">
          <div className="rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={highRisk ? "bad" : "warn"}>
                {impactLabel(approval.impact.level)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {approval.impact.reversible ? "可回滚" : "不可自动回滚"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6">{approval.impact.summary}</p>
            {approval.impact.affected_resources.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                影响资源：{approval.impact.affected_resources.join("、")}
              </p>
            ) : null}
          </div>
        </DecisionSection>

        {isPending ? (
          <DecisionSection index="4" title="你的决定">
            <div className="grid gap-3">
              <Textarea
                aria-label="决策原因"
                className="min-h-20"
                placeholder="拒绝或要求修改时，请说明原因……"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {approval.allowed_actions.includes("approve") ? (
                  <Button
                    ref={approveTriggerRef}
                    className="min-h-11 sm:min-h-9"
                    disabled={decide.isPending || !online}
                    variant="primary"
                    onClick={() => act("approve")}
                  >
                    <CheckCircle2 className="h-4 w-4" /> 批准并继续
                  </Button>
                ) : null}
                {approval.allowed_actions.includes("revise") ? (
                  <Button
                    className="min-h-11 sm:min-h-9"
                    disabled={decide.isPending || !online || !needsReason}
                    onClick={() => act("revise")}
                  >
                    <Pencil className="h-4 w-4" /> 要求修改
                  </Button>
                ) : null}
                {approval.allowed_actions.includes("pause") ? (
                  <Button
                    className="min-h-11 sm:min-h-9"
                    disabled={decide.isPending || !online}
                    onClick={() => act("pause")}
                  >
                    <CirclePause className="h-4 w-4" /> 暂停
                  </Button>
                ) : null}
                {approval.allowed_actions.includes("reject") ? (
                  <Button
                    className="min-h-11 sm:min-h-9"
                    disabled={decide.isPending || !online || !needsReason}
                    variant="danger"
                    onClick={() => act("reject")}
                  >
                    拒绝并停止
                  </Button>
                ) : null}
              </div>
              {decide.isError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5"
                >
                  决策未提交，审批可能已在其他设备处理。已保留你的输入，请刷新确认最新状态。
                  <Button
                    className="ml-2"
                    size="sm"
                    onClick={() =>
                      void queryClient.invalidateQueries({
                        queryKey: ["approvals"],
                      })
                    }
                  >
                    刷新状态
                  </Button>
                </div>
              ) : null}
            </div>
          </DecisionSection>
        ) : (
          <div className="rounded-md border border-border bg-muted p-3 text-sm">
            此请求已{approvalStatusLabel(approval.status)}
            {approval.reason ? `：${approval.reason}` : "。"}
          </div>
        )}

        {confirming ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="high-risk-title"
            className="rounded-lg border-2 border-destructive bg-destructive/10 p-4"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeConfirmation();
              }
            }}
          >
            <h3 id="high-risk-title" className="font-semibold">
              再次确认高风险操作
            </h3>
            <p className="mt-2 text-sm leading-6">
              批准后 Agent 将立即继续执行“{approval.intent}
              ”。请确认你已经核对证据、影响资源和回滚条件。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="min-h-11 sm:min-h-9"
                disabled={decide.isPending || !online}
                variant="danger"
                onClick={() =>
                  decide.mutate({ action: "approve", confirmed: true })
                }
              >
                我已核对，批准执行
              </Button>
              <Button
                autoFocus
                className="min-h-11 sm:min-h-9"
                disabled={decide.isPending}
                onClick={closeConfirmation}
              >
                返回检查
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function DecisionSection({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px]">
          {index}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ProductMobileTriagePage() {
  const online = useOnlineState();
  const queryClient = useQueryClient();
  const [cachedSnapshot] = useState(readCachedMobileSnapshot);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const snapshot = useQuery({
    queryKey: ["mobile-snapshot"],
    queryFn: runtimeApi.mobileSnapshot,
    refetchInterval: 5000,
    initialData: cachedSnapshot ?? undefined,
    initialDataUpdatedAt: 0,
  });
  const data = snapshot.data;
  const notificationCursor = data?.notification_cursor;

  useEffect(() => {
    if (snapshot.data && !snapshot.isError) {
      localStorage.setItem(
        MOBILE_SNAPSHOT_CACHE_KEY,
        JSON.stringify(snapshot.data),
      );
    }
  }, [snapshot.data, snapshot.isError]);

  useEffect(() => {
    if (
      !online ||
      notificationCursor === undefined ||
      typeof EventSource === "undefined"
    )
      return;
    const source = new EventSource(
      mobileNotificationStreamHref(notificationCursor),
    );
    const receiveNotification = (event: MessageEvent<string>) => {
      try {
        const notification = JSON.parse(event.data) as MobileNotification;
        void queryClient.invalidateQueries({ queryKey: ["mobile-snapshot"] });
        void queryClient.invalidateQueries({ queryKey: ["approvals"] });
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          const systemNotification = new Notification(notification.title, {
            body: notification.body,
            tag: notification.notification_id,
          });
          systemNotification.onclick = () => {
            window.focus();
            window.location.hash = `#${notification.action_path}`;
            systemNotification.close();
          };
        }
      } catch {
        // The durable snapshot remains authoritative if a relay frame is malformed.
      }
    };
    source.addEventListener?.(
      "mobile.notification",
      receiveNotification as EventListener,
    );
    source.onmessage = receiveNotification;
    return () => source.close();
  }, [notificationCursor, online, queryClient]);

  const enableSystemNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/95 px-14 backdrop-blur md:px-5">
        <div>
          <h1 className="text-sm font-semibold">移动决策台</h1>
          <p className="text-[11px] text-muted-foreground">
            只同步状态快照与审批请求
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {data ? formatDateTime(data.generated_at) : "同步中"}
        </span>
      </header>

      <main className="grid gap-6 p-4 pb-12">
        {!online ? (
          <div
            role="status"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-5"
          >
            当前离线，正在显示最近同步的状态快照。远端任务可能仍在运行；恢复连接前请勿重复决策。
          </div>
        ) : null}
        {snapshot.isError ? (
          <LoadFailure onRetry={() => void snapshot.refetch()} />
        ) : null}
        {notificationPermission === "default" ? (
          <Button
            className="min-h-11 justify-center"
            onClick={() => void enableSystemNotifications()}
          >
            <BellRing className="h-4 w-4" /> 开启审批通知
          </Button>
        ) : notificationPermission === "denied" ? (
          <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            系统通知已被浏览器关闭；你仍可在此查看所有待决策事项。
          </p>
        ) : null}
        <section className="grid grid-cols-3 gap-2" aria-label="远端状态">
          <TriageMetric
            value={data?.counts.pending_approvals ?? 0}
            label="待决策"
            tone="warn"
          />
          <TriageMetric
            value={data?.counts.active ?? 0}
            label="执行中"
            tone="active"
          />
          <TriageMetric
            value={data?.recent_conversations.length ?? 0}
            label="最近完成"
            tone="ok"
          />
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">等待我处理</h2>
            <Badge tone={data?.approvals.length ? "warn" : "ok"}>
              {data?.approvals.length ?? 0}
            </Badge>
          </div>
          {data && !data.approvals.length ? (
            <Card>
              <CardBody>
                <EmptyState title="没有待处理决策" />
              </CardBody>
            </Card>
          ) : null}
          {data?.approvals.map((approval) => (
            <Link
              key={approval.approval_id}
              className="grid gap-3 rounded-xl border border-warning/40 bg-card p-4 shadow-sm active:scale-[0.99]"
              params={{ approvalId: approval.approval_id }}
              to="/approvals/$approvalId"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-warning">
                    需要你的决定
                  </p>
                  <h3 className="mt-1 text-sm font-semibold leading-5">
                    {approval.intent}
                  </h3>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-2 text-xs leading-5">
                <span className="text-muted-foreground">证据</span>
                <span className="line-clamp-2">
                  {approval.evidence[0]?.summary ??
                    approval.evidence[0]?.snippet ??
                    "未附加证据"}
                </span>
                <span className="text-muted-foreground">影响</span>
                <span className="line-clamp-2">{approval.impact.summary}</span>
              </div>
              <div className="text-center text-[11px] text-muted-foreground">
                点击查看详情并安全决策
              </div>
            </Link>
          ))}
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">远端正在执行</h2>
          {data && !data.active_conversations.length ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              没有正在执行的任务
            </p>
          ) : null}
          {data?.active_conversations.map((conversation) => (
            <Link
              key={conversation.conversation_id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              params={{ conversationId: conversation.conversation_id }}
              to="/conversations/$conversationId"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-success/30">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {conversation.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {conversation.status === "waiting_user"
                    ? "等待你的决定"
                    : "Agent 正在后台推进"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">最近完成</h2>
          {data?.recent_conversations.map((conversation) => (
            <Link
              key={conversation.conversation_id}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
              params={{ conversationId: conversation.conversation_id }}
              to="/conversations/$conversationId"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {conversation.title}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatDateTime(conversation.updated_at)}
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}

function TriageMetric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "warn" | "active" | "ok";
}) {
  const color =
    tone === "warn"
      ? "text-warning"
      : tone === "active"
        ? "text-primary"
        : "text-success";
  return (
    <div className="grid justify-items-center rounded-lg border border-border bg-card px-2 py-3 text-center">
      <span className={`text-xl font-semibold ${color}`}>{value}</span>
      <span className="mt-1 text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function LoadFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm"
    >
      暂时无法同步，请检查连接后重试。
      <Button className="ml-2" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" /> 重试
      </Button>
    </div>
  );
}

function impactLabel(level: ApprovalRequest["impact"]["level"]) {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}

function approvalStatusLabel(status: ApprovalRequest["status"]) {
  return (
    {
      pending: "等待处理",
      approved: "批准",
      rejected: "拒绝",
      expired: "过期",
      cancelled: "取消",
      paused: "暂停",
      revision_requested: "退回修改",
    } as const
  )[status];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

const MOBILE_SNAPSHOT_CACHE_KEY = "agentflow-mobile-snapshot-v1";

function readCachedMobileSnapshot(): MobileSnapshot | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(MOBILE_SNAPSHOT_CACHE_KEY) ?? "null",
    ) as MobileSnapshot | null;
    return parsed?.snapshot_version === 1 && parsed.stateless === true
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export const __productTestUtils = {
  modeLabel,
  adapterLabel,
  channelStatus,
  impactLabel,
  approvalStatusLabel,
  formatDateTime,
  readCachedMobileSnapshot,
  normalizeCanvasTab,
  artifactStructuredText,
  tenantSlug,
};

function useOnlineState() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);
  return online;
}

export function ProductTaskPage() {
  const { taskId } = useParams({ strict: false }) as { taskId: string };
  const navigate = useNavigate();
  const conversation = useQuery({
    queryKey: ["v2", "tasks", taskId, "conversation"],
    queryFn: () => runtimeApi.conversationForTask(taskId),
    retry: 1,
  });

  useEffect(() => {
    if (!conversation.data?.conversation_id) return;
    void navigate({
      to: "/conversations/$conversationId",
      params: { conversationId: conversation.data.conversation_id },
      replace: true,
    });
  }, [conversation.data?.conversation_id, navigate]);

  if (conversation.isError) {
    const missing =
      conversation.error instanceof ApiError &&
      conversation.error.status === 404;
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold">
            {missing ? "这个旧任务链接已失效" : "暂时无法加载这个会话"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {missing
              ? "任务可能已被删除或迁移记录不存在。你可以返回会话列表继续工作。"
              : "请检查网络连接后重试。远端任务可能仍在运行。"}
          </p>
          {missing ? (
            <Button className="mt-4" onClick={() => void navigate({ to: "/" })}>
              返回会话列表
            </Button>
          ) : (
            <Button
              className="mt-4"
              onClick={() => void conversation.refetch()}
            >
              <RefreshCw className="h-4 w-4" /> 重新同步
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <RefreshCw className="mx-auto h-6 w-6 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">
          正在将旧任务链接迁移到持续会话……
        </p>
      </div>
    </div>
  );
}

function CanvasTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={
        active
          ? "min-h-11 shrink-0 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground sm:min-h-9"
          : "min-h-11 shrink-0 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-9"
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function CanvasHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function PlanOverview({ plan }: { plan: V2Plan | null }) {
  if (!plan) {
    return <EmptyState title="尚未生成执行计划" />;
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm">
        <span>{plan.graph.nodes.length} 个工作方向</span>
        <Badge tone="info">{plan.strategy}</Badge>
      </div>
      {plan.graph.nodes.map((node, index) => (
        <div
          key={node.id}
          className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm"
        >
          <div className="font-medium">
            {index + 1}. {node.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {node.depends_on.length
              ? `依赖：${node.depends_on.join("、")}`
              : "起始阶段，无前置依赖"}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffArtifactList({ artifacts }: { artifacts: V2Artifact[] }) {
  const diffs = artifacts.filter((artifact) =>
    /diff|patch/i.test(`${artifact.kind} ${artifact.name}`),
  );
  if (!diffs.length) {
    return (
      <EmptyState
        title="本次执行没有结构化文件变更"
        detail="Agent 未返回 Diff 时，这里不会从回答文本中猜测修改内容。"
      />
    );
  }
  return (
    <div className="grid gap-3">
      {diffs.map((artifact) => (
        <div
          key={artifact.artifact_id}
          className="grid gap-2 rounded-md border border-border bg-card p-3"
        >
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{artifact.name}</span>
            <Badge tone="warn">需要核对</Badge>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
            {artifactStructuredText(artifact)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function FileReferenceList({ artifacts }: { artifacts: V2Artifact[] }) {
  if (!artifacts.length) {
    return (
      <EmptyState
        title="本次执行没有文件引用"
        detail="工作区不会被自动复制到客户端。"
      />
    );
  }
  return (
    <div className="grid gap-2">
      {artifacts.map((artifact) => (
        <div
          key={artifact.artifact_id}
          className="flex min-w-0 items-start gap-3 rounded-md border border-border bg-card p-3"
        >
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{artifact.name}</div>
            <div className="break-all text-xs text-muted-foreground">
              {artifact.ref}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function artifactStructuredText(artifact: V2Artifact) {
  const content = artifact.content;
  for (const key of ["diff", "patch", "text", "content"]) {
    if (typeof content[key] === "string") return content[key] as string;
  }
  return JSON.stringify(content, null, 2);
}

function WorkflowSteps({ steps }: { steps: V2WorkflowStep[] }) {
  if (!steps.length) {
    return <EmptyState title="暂无工作流步骤" />;
  }
  return (
    <div className="grid gap-3">
      {steps.map((step) => (
        <div
          key={step.step_id}
          className="grid gap-2 rounded-md border border-border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {step.order_index + 1}. {step.role}
            </span>
            <StatusBadge
              status={step.status}
              label={statusLabel(step.status)}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{adapterLabel(step.adapter)}</span>
            <span>{step.agent_task_id}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: V2Artifact[] }) {
  if (!artifacts.length) {
    return <EmptyState title="暂无产物" />;
  }
  return (
    <div className="grid gap-3">
      {artifacts.map((artifact) => (
        <div
          key={artifact.artifact_id}
          className="grid gap-2 rounded-md border border-border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{artifact.name}</span>
            <StatusBadge
              status={artifact.status}
              label={statusLabel(artifact.status)}
            />
          </div>
          <div className="break-all text-xs text-muted-foreground">
            {artifact.kind} · {artifact.ref}
          </div>
        </div>
      ))}
    </div>
  );
}

function EvaluationList({ evaluations }: { evaluations: V2Evaluation[] }) {
  if (!evaluations.length) {
    return <EmptyState title="暂无验收结果" />;
  }
  return (
    <div className="grid gap-3">
      {evaluations.map((evaluation) => (
        <div
          key={evaluation.evaluation_id}
          className="grid gap-2 rounded-md border border-border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{evaluation.kind}</span>
            <StatusBadge
              status={evaluation.status}
              label={statusLabel(evaluation.status)}
            />
          </div>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(evaluation.details, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function ReplayList({ replays }: { replays: V2Replay[] }) {
  if (!replays.length) {
    return <EmptyState title="暂无回放快照" />;
  }
  return (
    <div className="grid gap-3">
      {replays.map((replay) => (
        <div
          key={replay.replay_id}
          className="grid gap-2 rounded-md border border-border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{replay.replay_id}</span>
            <StatusBadge
              status={replay.status}
              label={statusLabel(replay.status)}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {replay.requested_by} ·{" "}
            {new Date(replay.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductAdminPage() {
  const queryClient = useQueryClient();
  const [channelPlatform, setChannelPlatform] = useState("feishu");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [callbackToken, setCallbackToken] = useState("");
  const [outboundText, setOutboundText] = useState("AgentFlow channel test");
  const [tenantName, setTenantName] = useState("");
  const [tenantUserEmail, setTenantUserEmail] = useState("");
  const overview = useQuery({
    queryKey: ["v2", "admin", "overview"],
    queryFn: runtimeApi.v2AdminOverview,
    refetchInterval: 3000,
  });
  const channelMessages = useQuery({
    queryKey: ["v2", "admin", "channel-messages"],
    queryFn: runtimeApi.v2ChannelMessages,
    refetchInterval: 5000,
  });
  const configureChannel = useMutation({
    mutationFn: () =>
      runtimeApi.v2ConfigureChannel(channelPlatform, {
        webhook_url: webhookUrl,
        callback_token: callbackToken,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["v2", "admin"] });
    },
  });
  const sendChannel = useMutation({
    mutationFn: () =>
      runtimeApi.v2SendChannelMessage(channelPlatform, {
        message: outboundText,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["v2", "admin", "channel-messages"],
      });
    },
  });
  const createTenant = useMutation({
    mutationFn: () =>
      runtimeApi.v2UpsertTenant({
        tenant_id: tenantSlug(tenantName),
        name: tenantName,
      }),
    onSuccess: async () => {
      setTenantName("");
      await queryClient.invalidateQueries({ queryKey: ["v2", "admin"] });
    },
  });
  const addTenantUser = useMutation({
    mutationFn: () =>
      runtimeApi.v2UpsertTenantUser("tenant_default", {
        email: tenantUserEmail,
        roles: ["member"],
      }),
    onSuccess: async () => {
      setTenantUserEmail("");
      await queryClient.invalidateQueries({ queryKey: ["v2", "admin"] });
    },
  });
  const discoverUnits = useMutation({
    mutationFn: runtimeApi.v2DiscoverExecutionUnits,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["v2", "admin"] });
    },
  });
  const data = overview.data;
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-primary">AgentFlow</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">
            Admin Control Plane
          </h1>
        </div>
        <Link
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          to="/"
        >
          Client
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Tasks" value={data?.tasks.total ?? 0} />
        <Metric label="Agent Tasks" value={data?.agent_tasks.total ?? 0} />
        <Metric
          label="Execution Units"
          value={data?.execution_units.length ?? 0}
        />
        <Metric label="Tenants" value={data?.tenants.length ?? 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminStatusCard overview={data} />
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <CardTitle>Execution Units</CardTitle>
              </div>
              <Button
                className="h-8 px-3 text-xs"
                onClick={() => discoverUnits.mutate()}
                disabled={discoverUnits.isPending}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Discover
              </Button>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3">
            {(data?.execution_units ?? []).map((unit) => (
              <div
                key={unit.unit_id}
                className="grid gap-2 rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{unit.unit_id}</span>
                  <StatusBadge status={unit.status} />
                </div>
                <div className="text-muted-foreground">
                  {unit.kind} · {unit.adapters.join(", ")}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HaStatusCard overview={data} />
        <TenantAdminCard
          tenants={data?.tenants ?? []}
          tenantName={tenantName}
          tenantUserEmail={tenantUserEmail}
          onTenantName={setTenantName}
          onTenantUserEmail={setTenantUserEmail}
          onCreateTenant={() => createTenant.mutate()}
          onAddTenantUser={() => addTenantUser.mutate()}
          busy={createTenant.isPending || addTenantUser.isPending}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            <CardTitle>Channels</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="grid gap-4">
          <ChannelConfigPanel
            channels={data?.channels ?? []}
            messages={channelMessages.data?.messages ?? []}
            platform={channelPlatform}
            webhookUrl={webhookUrl}
            callbackToken={callbackToken}
            outboundText={outboundText}
            onPlatform={setChannelPlatform}
            onWebhookUrl={setWebhookUrl}
            onCallbackToken={setCallbackToken}
            onOutboundText={setOutboundText}
            onConfigure={() => configureChannel.mutate()}
            onSend={() => sendChannel.mutate()}
            busy={configureChannel.isPending || sendChannel.isPending}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function AgentDag({
  agents,
  highlightedAgentId,
  onLocateChat,
}: {
  agents: V2AgentTask[];
  highlightedAgentId?: string;
  onLocateChat?: (agentTaskId: string) => void;
}) {
  if (!agents.length) {
    return <EmptyState title="暂无执行计划" />;
  }
  return (
    <div className="grid gap-3">
      {agents.map((agent) => (
        <div
          key={agent.agent_task_id}
          id={`canvas-entity-${agent.agent_task_id}`}
          className={`grid scroll-mt-16 gap-2 rounded-md border p-3 transition-colors ${
            highlightedAgentId === agent.agent_task_id
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <Badge tone="info">{agent.role}</Badge>
            <StatusBadge
              status={agent.status}
              label={statusLabel(agent.status)}
            />
          </div>
          <div className="font-medium">{agent.title}</div>
          <div className="text-sm text-muted-foreground">{agent.goal}</div>
          <div className="text-xs text-muted-foreground">
            依赖：
            {agent.depends_on.length ? agent.depends_on.join("、") : "无"}
          </div>
          {onLocateChat ? (
            <button
              className="min-h-11 w-fit text-left text-xs font-medium text-primary hover:underline sm:min-h-9"
              onClick={() => onLocateChat(agent.agent_task_id)}
            >
              在 Chat 中定位相关简报
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EventTimeline({ events }: { events: V2Event[] }) {
  if (!events.length) {
    return <EmptyState title="暂无活动记录" />;
  }
  return (
    <div className="grid gap-3">
      {events.map((event) => (
        <div
          key={event.event_id}
          className="grid grid-cols-[28px_minmax(0,1fr)] gap-3"
        >
          <div className="grid h-7 w-7 place-items-center rounded-full border border-border">
            <Clock3 className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{event.type}</div>
              <Badge tone="neutral">{event.actor}</Badge>
            </div>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminStatusCard({ overview }: { overview?: V2AdminOverview }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" />
          <CardTitle>Reliability Spine</CardTitle>
        </div>
      </CardHeader>
      <CardBody className="grid gap-3">
        {Object.entries(overview?.reliability ?? {}).map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">{key}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function HaStatusCard({ overview }: { overview?: V2AdminOverview }) {
  const ha = overview?.ha;
  const workflow = ha?.workflow;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <CardTitle>HA Runtime</CardTitle>
        </div>
      </CardHeader>
      <CardBody className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Profile" value={String(ha?.profile ?? "local")} />
          <Metric
            label="Database"
            value={String(ha?.database?.driver ?? "sqlite")}
            detail={ha?.database?.configured ? "configured" : "local"}
          />
          <Metric
            label="Queue"
            value={String(ha?.queue?.driver ?? "sqlite")}
            detail={ha?.queue?.configured ? "configured" : "local"}
          />
        </div>
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Workflow Engine</span>
            <Badge tone="info">
              {String(workflow?.active_engine ?? "local")}
            </Badge>
          </div>
          <div className="mt-2 grid gap-2">
            {(workflow?.engines ?? []).map((engine) => (
              <div
                key={String(engine.engine)}
                className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
              >
                <span>{String(engine.engine)}</span>
                <StatusBadge status={String(engine.status)} />
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function TenantAdminCard({
  tenants,
  tenantName,
  tenantUserEmail,
  onTenantName,
  onTenantUserEmail,
  onCreateTenant,
  onAddTenantUser,
  busy,
}: {
  tenants: V2Tenant[];
  tenantName: string;
  tenantUserEmail: string;
  onTenantName: (value: string) => void;
  onTenantUserEmail: (value: string) => void;
  onCreateTenant: () => void;
  onAddTenantUser: () => void;
  busy: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <CardTitle>Tenant Admin</CardTitle>
        </div>
      </CardHeader>
      <CardBody className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Tenant name">
            <Input
              value={tenantName}
              onChange={(event) => onTenantName(event.target.value)}
              placeholder="Acme"
            />
          </Field>
          <Button
            className="self-end"
            onClick={onCreateTenant}
            disabled={busy || !tenantName.trim()}
          >
            <KeyRound className="h-4 w-4" />
            Create
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Default tenant user">
            <Input
              value={tenantUserEmail}
              onChange={(event) => onTenantUserEmail(event.target.value)}
              placeholder="member@example.com"
            />
          </Field>
          <Button
            className="self-end"
            onClick={onAddTenantUser}
            disabled={busy || !tenantUserEmail.trim()}
          >
            <Users className="h-4 w-4" />
            Add
          </Button>
        </div>
        <div className="grid gap-2">
          {tenants.map((tenant) => (
            <div
              key={tenant.tenant_id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="font-medium">{tenant.name}</span>
              <StatusBadge status={tenant.status} />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ChannelConfigPanel({
  channels,
  messages,
  platform,
  webhookUrl,
  callbackToken,
  outboundText,
  onPlatform,
  onWebhookUrl,
  onCallbackToken,
  onOutboundText,
  onConfigure,
  onSend,
  busy,
}: {
  channels: V2Channel[];
  messages: V2ChannelMessage[];
  platform: string;
  webhookUrl: string;
  callbackToken: string;
  outboundText: string;
  onPlatform: (value: string) => void;
  onWebhookUrl: (value: string) => void;
  onCallbackToken: (value: string) => void;
  onOutboundText: (value: string) => void;
  onConfigure: () => void;
  onSend: () => void;
  busy: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-5">
        {channelOptions.map((option) => (
          <button
            key={option.value}
            className={`grid gap-2 rounded-md border p-3 text-left text-sm ${
              platform === option.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted"
            }`}
            onClick={() => onPlatform(option.value)}
          >
            <span className="font-medium">{option.label}</span>
            <StatusBadge status={channelStatus(channels, option.value)} />
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <Field label="Webhook URL">
          <Input
            value={webhookUrl}
            onChange={(event) => onWebhookUrl(event.target.value)}
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
          />
        </Field>
        <Field label="Callback token">
          <Input
            value={callbackToken}
            onChange={(event) => onCallbackToken(event.target.value)}
            placeholder="shared callback token"
          />
        </Field>
        <Button className="self-end" onClick={onConfigure} disabled={busy}>
          <ShieldCheck className="h-4 w-4" />
          Configure
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <Field label="Outbound test">
          <Input
            value={outboundText}
            onChange={(event) => onOutboundText(event.target.value)}
          />
        </Field>
        <Button className="self-end" onClick={onSend} disabled={busy}>
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>
      <div className="grid gap-2">
        {messages.slice(0, 6).map((message) => (
          <div
            key={message.message_id}
            className="grid gap-1 rounded-md border border-border px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {message.platform} · {message.direction}
              </span>
              <StatusBadge status={message.status} />
            </div>
            <div className="text-xs text-muted-foreground">
              {message.task_id ?? message.external_message_id}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tenantSlug(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `tenant_${slug}` : "tenant_new";
}
