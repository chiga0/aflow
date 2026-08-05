import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
(window as any).__AFLOW_MOUNTED__ = true;

// Register the offline app shell in production builds only (dev would fight HMR).
// Also drives the update flow: every deploy byte-changes sw.js (build stamp),
// the new worker activates via skipWaiting, and we surface a "new version"
// toast so installed PWAs can refresh into the new build.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      const hadController = Boolean(navigator.serviceWorker.controller);
      // When a newer SW takes over this (old) page, reload once so the new
      // shell + fresh asset URLs actually run instead of stale code.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController && !sessionStorage.getItem("aflow-cc")) {
          sessionStorage.setItem("aflow-cc", "1");
          location.reload();
        } else {
          sessionStorage.removeItem("aflow-cc");
        }
      });
      const reg = await navigator.serviceWorker.register("/sw.js", {
        // never let the HTTP cache throttle/serve stale worker scripts
        updateViaCache: "none",
      });
      // explicit update() on every load bypasses Chrome's 24h SW throttle
      reg.update().catch(() => undefined);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated" && hadController) {
            window.dispatchEvent(new CustomEvent("aflow:update-available"));
          }
        });
      });
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) check();
      });
      window.addEventListener("aflow:check-update", check);
    } catch {
      /* offline shell is best-effort; ignore registration errors */
    }
  });
}
