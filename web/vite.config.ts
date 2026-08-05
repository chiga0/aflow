import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Stamp a build id into sw.js so every deploy byte-changes the worker and
// browsers/PWAs pick it up (the update flow then reloads the new shell).
function stampServiceWorker(): Plugin {
  return {
    name: "stamp-sw",
    closeBundle() {
      const id = `aflow-${Date.now()}`;
      const sw = resolve(__dirname, "dist/sw.js");
      if (existsSync(sw)) {
        writeFileSync(sw, readFileSync(sw, "utf8").replace("__BUILD_ID__", id));
      }
      const html = resolve(__dirname, "dist/index.html");
      if (existsSync(html)) {
        writeFileSync(html, readFileSync(html, "utf8").replace("__BUILD_ID__", id));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/daemon": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
