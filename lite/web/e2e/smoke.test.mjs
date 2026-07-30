// End-to-end smoke test for the aflow-lite web app.
//
// Runs against a *running* runtime (default http://127.0.0.1:8765). The runtime
// must be started with auth credentials exported so this script can log in:
//
//   AFLOW_AUTH_EMAIL=admin@aflow.local AFLOW_AUTH_PASSWORD=... \
//     python -m lite.runtime --port 8765
//
// Then:  npm run test:e2e        (in lite/web, after `npx playwright install`)
//
// The script verifies the auth gate (login screen), a successful login that
// reveals the WebShell, and that the PWA assets (manifest/icons/service worker)
// are served. It exits non-zero on any failed assertion.

import { chromium } from "playwright";

const BASE = process.env.AFLOW_BASE || "http://127.0.0.1:8765";
const EMAIL = process.env.AFLOW_AUTH_EMAIL || "admin@aflow.local";
const PASSWORD = process.env.AFLOW_AUTH_PASSWORD || "";

if (!PASSWORD) {
  console.error("AFLOW_AUTH_PASSWORD is required for the e2e smoke test");
  process.exit(2);
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? "  ok  " : " FAIL ") + msg);
  if (!cond) failures++;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));

try {
  // PWA assets are public.
  let r = await page.request.get(`${BASE}/manifest.json`);
  const manifest = await r.json();
  check(r.status() === 200 && Array.isArray(manifest.icons) && manifest.icons.length >= 3, "manifest + icons");
  r = await page.request.get(`${BASE}/sw.js`);
  check(r.status() === 200 && (await r.text()).includes("addEventListener"), "service worker served");
  r = await page.request.get(`${BASE}/icon-512.png`);
  check(r.status() === 200 && (r.headers()["content-type"] || "").includes("image"), "icon-512 image");

  // Unauthenticated -> branded login screen.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check((await page.locator("text=登录以继续").count()) > 0, "login screen when unauthenticated");

  // Login.
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const shell =
    (await page.locator(".aflow-welcome").count()) +
    (await page.locator("text=欢迎使用").count()) +
    (await page.locator("text=AFlow").count());
  check(shell > 0, "login reveals WebShell / brand");
  await page.screenshot({ path: "e2e/smoke.png" });

  // Authenticated cookie reaches the daemon proxy.
  r = await page.request.get(`${BASE}/daemon/capabilities`);
  check(r.status() === 200 && !!(await r.json()).qwenCodeVersion, "cookie authenticates /daemon proxy");

  check(pageErrors.length === 0, "no page errors");
} catch (e) {
  console.error("e2e crashed:", e);
  failures++;
} finally {
  await browser.close();
}

console.log(`\nFAILS: ${failures}`);
process.exit(failures ? 1 : 0);
