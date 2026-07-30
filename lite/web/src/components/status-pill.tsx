const STATUS_STYLES: Record<string, string> = {
  idle: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-500/20 text-blue-400 animate-pulse",
  completed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-zinc-600/30 text-zinc-400",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.idle}`}
    >
      {status === "running" && (
        <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
