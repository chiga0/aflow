import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUp, MessageSquarePlus, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, Select, StatusBadge, Textarea } from "./components/ui";
import { runtimeApi } from "./lib/api";
import { useI18n } from "./lib/i18n";

export function ClientHome() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState("auto");
  const [adapter, setAdapter] = useState("auto");
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
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-4xl flex-col justify-center gap-10 py-8">
      <div className="grid gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("home.title")}
        </h1>
        <p className="text-muted-foreground">{t("home.subtitle")}</p>
      </div>

      <form
        aria-label="New conversation"
        className="rounded-2xl border border-border bg-card p-3 shadow-sm"
        onSubmit={submit}
      >
        <Textarea
          autoFocus
          className="min-h-32 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
          placeholder={t("home.placeholder")}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <Settings2 className="h-4 w-4" />
              {t("home.settings")}
            </summary>
            <div className="absolute z-20 mt-2 grid w-64 gap-3 rounded-lg border border-border bg-card p-3 shadow-xl">
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
                      {
                        adapter: "qwen",
                        label: "qwen-code",
                        status: "available",
                      },
                      {
                        adapter: "codex",
                        label: "codex cli",
                        status: "available",
                      },
                      {
                        adapter: "opencode",
                        label: "opencode",
                        status: "available",
                      },
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
          <Button
            aria-label="Start conversation"
            disabled={
              !goal.trim() || createTask.isPending || selectedUnavailable
            }
            size="icon"
            type="submit"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {createTask.isError ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <div className="font-medium">{t("home.cannotStart")}</div>
          <div className="mt-1 text-xs">{String(createTask.error)}</div>
          <Button
            className="mt-3"
            disabled={!goal.trim() || selectedUnavailable}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              createTask.mutate({
                goal: goal.trim(),
                mode,
                adapter,
                channel: "web",
                metadata: { product_surface: "webshell" },
              })
            }
          >
            {t("home.retry")}
          </Button>
        </div>
      ) : null}

      {(tasks.data?.tasks.length ?? 0) > 0 ? (
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquarePlus className="h-4 w-4" />
            {t("home.recentChats")}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {tasks.data?.tasks.slice(0, 6).map((task) => (
              <Link
                key={task.task_id}
                className="grid gap-2 rounded-lg border border-border bg-card p-3 hover:bg-muted"
                params={{ taskId: task.task_id }}
                to="/tasks/$taskId"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {task.title}
                  </span>
                  <StatusBadge status={task.status} />
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {task.goal}
                </p>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
