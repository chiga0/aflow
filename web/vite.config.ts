import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Opt-in dev proxy to a local runtime (VITE_DEV_PROXY=1). Disabled by default
// so the Playwright E2E suite (which mocks the API in-browser and starts the
// dev server itself) is not affected by proxying to an absent backend.
const devProxyTarget = "http://127.0.0.1:8765";
const devProxy =
  process.env.VITE_DEV_PROXY === "1"
    ? Object.fromEntries(
        [
          "/health",
          "/capabilities",
          "/auth",
          "/runs",
          "/tasks",
          "/session",
          "/workers",
          "/executors",
          "/missions",
          "/profiles",
          "/permissions",
          "/queue",
          "/metrics",
          "/cost",
          "/ops",
          "/access",
          "/v2",
          "/a2a",
          "/acp",
          "/p5",
        ].map((path) => [path, devProxyTarget]),
      )
    : undefined;

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: devProxy,
  },
  build: {
    outDir: "../runtime/cloud_agents_runtime/static",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("@qwen-code")) return "qwen-code";
          return undefined;
        },
      },
    },
  },
});
