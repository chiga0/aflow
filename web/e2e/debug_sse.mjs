// Debug SSE in a real browser against production.
import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findChromium() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  try {
    const dirs = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort();
    for (const d of dirs.reverse()) {
      const bin = join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  } catch { /* default */ }
  return undefined;
}

const BASE = process.env.AFLOW_BASE || "https://aflow.dev";
const EMAIL = process.env.AFLOW_AUTH_EMAIL;
const PASSWORD = process.env.AFLOW_AUTH_PASSWORD;

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 160)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
page.on("response", (r) => {
  if (r.url().includes("/api/")) {
    console.log("[resp]", r.status(), r.request().method(), r.url().replace(BASE, ""),
      r.headers()["content-type"] || "");
  }
});
page.on("requestfailed", (r) => console.log("[reqfail]", r.url().replace(BASE, ""), r.failure()?.errorText));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-testid=\"shell\"], .aflow-auth", { timeout: 15000 });

const hasLogin = await page.$(".aflow-auth-form");
if (hasLogin) {
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click(".aflow-auth-submit");
  await page.waitForSelector('[data-testid=\"shell\"]', { timeout: 15000 });
}
console.log("[ui] shell up");

await page.fill('[data-testid=\"composer-input\"]', "回复两个字：收到");
await page.click('[data-testid=\"composer-send\"]');
await page.waitForTimeout(25000);

const text = await page.evaluate(() => document.querySelector('[data-testid=\"scroll\"]')?.innerText || "");
console.log("[scroll text]", JSON.stringify(text.slice(0, 300)));
const detail = await page.evaluate(async () => {
  const sid = "__probe__";
  return null;
});
await browser.close();
