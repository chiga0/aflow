// State-matrix screenshots for the mobile-first ChatApp.
//
// Run via scripts/ui_matrix.py, which boots the runtime backed by a
// fake pi binary (deterministic frames + delay) and then invokes:
//
//   AFLOW_BASE=http://127.0.0.1:<port> node e2e/ui_screenshots.mjs
//
// Captures: welcome / streaming / completed (tools + code fence) / error /
// session drawer, in both a mobile (iPhone-like) and desktop viewport.

import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.AFLOW_BASE || "http://127.0.0.1:8910";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
mkdirSync(OUT, { recursive: true });

// Reuse whatever headless chromium is already in the playwright cache so the
// script works offline (CDN downloads are flaky in some sandboxes).
function findChromium() {
  if (process.env.AFLOW_CHROMIUM && existsSync(process.env.AFLOW_CHROMIUM)) {
    return process.env.AFLOW_CHROMIUM;
  }
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  try {
    const dirs = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort();
    for (const d of dirs.reverse()) {
      const bin = join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  } catch {
    /* fall through to playwright default */
  }
  return undefined;
}

const DONE_MARKER = "已完成";

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  console.log("  shot", name);
}

async function sendPrompt(page, text) {
  await page.fill(".ac-input", text);
  await page.click(".ac-btn--send");
}

async function waitForTurn(page) {
  await page.waitForFunction(
    (marker) => document.querySelector(".ac-scroll")?.textContent.includes(marker),
    DONE_MARKER,
    { timeout: 30000 },
  );
}

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const pageErrors = [];

async function runDevice(name, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${String(e.message).slice(0, 160)}`));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".ac-shell", { timeout: 10000 });

  // 1. welcome (empty state)
  await shot(page, `${name}-1-welcome`);

  // 2. streaming mid-turn (fake pi delays 1.2s before emitting)
  await sendPrompt(page, "帮我检查项目里的文件并给一个示例");
  await page.waitForSelector(".ac-thinking, .ac-tool, .ac-bubble--assistant", { timeout: 10000 });
  await page.waitForTimeout(350);
  await shot(page, `${name}-2-streaming`);

  // 3. completed: tool cards + code fence + status
  await waitForTurn(page);
  await page.waitForTimeout(300);
  await shot(page, `${name}-3-completed`);

  // 4. error state
  await sendPrompt(page, "FORCE_FAIL 触发一个错误");
  await page.waitForSelector(".ac-error", { timeout: 15000 });
  await shot(page, `${name}-4-error`);

  // 5. session drawer with history (2 sessions now)
  await page.click('.ac-iconbtn[aria-label="会话列表"]');
  await page.waitForSelector(".ac-drawer", { timeout: 5000 });
  await shot(page, `${name}-5-drawer`);
  await page.click(".ac-drawer-bg", { position: { x: 5, y: 5 }, force: true }).catch(() => {});

  await context.close();
}

console.log("screenshots →", OUT);
await runDevice("mobile", {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
await runDevice("desktop", { viewport: { width: 1280, height: 800 } });

await browser.close();

if (pageErrors.length) {
  console.error("page errors:");
  for (const e of pageErrors) console.error(" -", e);
  process.exit(1);
}
console.log("OK: state matrix captured");
