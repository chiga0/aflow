import { StandaloneWebShell } from "@qwen-code/web-shell";

export function App() {
  return (
    <StandaloneWebShell
      baseUrl="/daemon"
      language="zh"
      style={{ height: "100vh", width: "100vw" }}
      hiddenSlashCommands={[
        "agents",
        "auth",
        "bug",
        "docs",
        "extensions",
        "mcp",
        "memory",
        "release",
        "settings",
      ]}
      sidebar={{
        enabled: true,
        branding: {
          render: () => (
            <div className="min-w-0 px-1">
              <div className="text-sm font-semibold">aflow</div>
              <div className="truncate text-xs opacity-70">lite</div>
            </div>
          ),
        },
        footer: false,
      }}
    />
  );
}
