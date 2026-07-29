import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUp, Clock, MessageSquarePlus, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, Select, StatusBadge } from "./components/ui";
import { runtimeApi, type V2Task } from "./lib/api";
import { useI18n } from "./lib/i18n";

const RUNNING_STATUSES = new Set(["running", "queued", "starting", "waiting"]);
const COMPLETED_STATUSES = new Set(["completed"]);
const FAILED_STATUSES = new Set(["failed", "cancelled"]);

type TaskFilter = "all" | "running" | "completed" | "failed";

function statusGroup(status: string): TaskFilter | "other" {
  if (RUNNING_STATUSES.has(status)) return "running";
  if (COMPLETED_STATUSES.has(status)) return "completed";
  if (FAILED_STATUSES.has(status)) return "failed";
  return "other";
}

function formatElapsed(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function ClientHome() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState("auto");
  const [adapter, setAdapter] = useState("qwen");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const tasks = useQuery({
    queryKey: ["v2", "tasks"],
    queryFn: runtimeApi.v2Tasks,
    refetchInterval: 3000,
  });
  const capabilities = useQuery({
    queryKey: ["v2", "capabilities"],
    queryFn: runtimeApi.v2Capabilities,
    staleTime: 30_000,
  });
  const createTask = useMutation({
    mutationFn: runtimeApi.v2CreateTask,
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ["v2", "tasks"] });
      await navigate({
        to: "/tasks/$taskId",
        params: { taskId: task.task_id },
      });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal.trim()) return;
    createTask.mutate({
      goal: goal.trim(),
      mode,
      adapter,
      channel: "web",
      metadata: { product_surface: "webshell" },
    });
  };
  const agentOptions = capabilities.data?.adapters.filter(
    (item) => item.adapter !== "fake",
  );
  const selectedCapability = agentOptions?.find(
    (item) => item.adapter === adapter,
  );
  const selectedUnavailable = Boolean(
    agentOptions &&
    adapter !== "auto" &&
    selectedCapability?.status !== "available",
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl">
          {(tasks.data?.tasks.length ?? 0) > 0 ? (
            <TaskList
              filter={filter}
              onFilterChange={setFilter}
              tasks={tasks.data?.tasks ?? []}
            />
          ) : (
            <EmptyState onPick={(text) => setGoal(text)} />
          )}
        </div>
      </div>

      {/* Bottom input bar — webshell style */}
      <div className="border-t border-border bg-muted/30 px-4 py-3">
        <form
          aria-label="New conversation"
          className="mx-auto max-w-3xl"
          onSubmit={submit}
        >
          <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-sm transition-shadow focus-within:shadow-md">
            <textarea
              autoFocus
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
              placeholder={t("home.placeholder")}
              rows={1}
              value={goal}
              onChange={(event) => {
                setGoal(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button
              aria-label="Start conversation"
              className="h-8 w-8 shrink-0 rounded-lg"
              disabled={
                !goal.trim() || createTask.isPending || selectedUnavailable
              }
              size="icon"
              type="submit"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Settings2 className="h-3.5 w-3.5" />
                {selectedCapability?.label ?? adapter}
              </summary>
              <div className="absolute bottom-full left-0 z-20 mb-2 grid w-56 gap-3 rounded-lg border border-border bg-card p-3 shadow-xl">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("home.agentMode")}
                  <Select
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                  >
                    <option value="auto">{t("home.auto")}</option>
                    <option value="single">{t("home.singleAgent")}</option>
                    <option value="multi-agent">{t("home.multiAgent")}</option>
                  </Select>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("home.executeAgent")}
                  <Select
                    value={adapter}
                    onChange={(event) => setAdapter(event.target.value)}
                  >
                    <option value="auto">{t("home.autoSelect")}</option>
                    {(
                      agentOptions ?? [
                        { adapter: "qwen", label: "qwen-code", status: "available" },
                        { adapter: "codex", label: "codex cli", status: "available" },
                        { adapter: "opencode", label: "opencode", status: "available" },
                      ]
                    ).map((item) => (
                      <option
                        key={item.adapter}
                        disabled={item.status !== "available"}
                        value={item.adapter}
                      >
                        {item.label}
                        {item.status === "available"
                          ? ` · ${t("home.available")}`
                          : ` · ${t("home.notRegistered")}`}
                      </option>
                    ))}
                  </Select>
                  {capabilities.isError ? (
                    <span className="text-amber-600">
                      {t("home.cannotDetect")}
                    </span>
                  ) : selectedCapability ? (
                    <span>
                      {selectedCapability.status === "available"
                        ? `${t("home.ready")} · ${selectedCapability.execution}`
                        : t("home.noUnits")}
                    </span>
                  ) : null}
                </label>
              </div>
            </details>
            {createTask.isError ? (
              <span className="text-xs text-destructive">
                {t("home.cannotStart")}
              </span>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskList({
  filter,
  onFilterChange,
  tasks,
}: {
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  tasks: V2Task[];
}) {
  const { t } = useI18n();
  const counts = {
    all: tasks.length,
    running: tasks.filter((task) => statusGroup(task.status) === "running")
      .length,
    completed: tasks.filter((task) => statusGroup(task.status) === "completed")
      .length,
    failed: tasks.filter((task) => statusGroup(task.status) === "failed")
      .length,
  };
  const filters: Array<{ id: TaskFilter; label: string; count: number }> = [
    { id: "all", label: t("home.filterAll"), count: counts.all },
    { id: "running", label: t("home.filterRunning"), count: counts.running },
    {
      id: "completed",
      label: t("home.filterCompleted"),
      count: counts.completed,
    },
    { id: "failed", label: t("home.filterFailed"), count: counts.failed },
  ];
  const visible =
    filter === "all"
      ? tasks
      : tasks.filter((task) => statusGroup(task.status) === filter);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquarePlus className="h-4 w-4" />
          {t("home.recentChats")}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === item.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              type="button"
              onClick={() => onFilterChange(item.id)}
            >
              {item.label} · {item.count}
            </button>
          ))}
        </div>
      </div>
      {visible.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.slice(0, 8).map((task) => (
            <TaskCard key={task.task_id} task={task} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("home.noTasksYet")}
        </p>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: V2Task }) {
  const isRunning = statusGroup(task.status) === "running";
  const percent = task.progress?.percent;
  const hasProgress = typeof percent === "number" && percent > 0;
  const elapsed = formatElapsed(task.created_at);

  return (
    <Link
      className="grid gap-2 rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/30 hover:bg-muted hover:shadow-sm"
      params={{ taskId: task.task_id }}
      to="/tasks/$taskId"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {isRunning ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
          ) : null}
          <StatusBadge status={task.status} />
        </span>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{task.goal}</p>
      {isRunning ? (
        <div className="grid gap-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            {hasProgress ? (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            ) : (
              <div className="h-full w-2/5 animate-pulse rounded-full bg-primary/60" />
            )}
          </div>
          {elapsed ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {elapsed}
            </div>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  const examples = [
    "home.exampleAudit",
    "home.examplePlan",
    "home.exampleResearch",
    "home.exampleReview",
  ] as const;

  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h2 className="text-lg font-medium text-foreground">
          {t("home.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("home.subtitle")}
        </p>
      </div>
      <div className="grid w-full max-w-md gap-2 sm:grid-cols-2">
        {examples.map((key) => (
          <button
            key={key}
            className="rounded-lg border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
            type="button"
            onClick={() => {
              onPick(t(key));
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
