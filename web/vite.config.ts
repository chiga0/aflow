import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/health": "http://127.0.0.1:8765",
      "/capabilities": "http://127.0.0.1:8765",
      "/auth": "http://127.0.0.1:8765",
      "/runs": "http://127.0.0.1:8765",
      "/tasks": "http://127.0.0.1:8765",
      "/session": "http://127.0.0.1:8765",
      "/workers": "http://127.0.0.1:8765",
      "/executors": "http://127.0.0.1:8765",
      "/missions": "http://127.0.0.1:8765",
      "/profiles": "http://127.0.0.1:8765",
      "/permissions": "http://127.0.0.1:8765",
      "/queue": "http://127.0.0.1:8765",
      "/metrics": "http://127.0.0.1:8765",
      "/cost": "http://127.0.0.1:8765",
      "/ops": "http://127.0.0.1:8765",
      "/access": "http://127.0.0.1:8765",
      "/v2": "http://127.0.0.1:8765",
      "/a2a": "http://127.0.0.1:8765",
      "/acp": "http://127.0.0.1:8765",
      "/p5": "http://127.0.0.1:8765",
    },
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
