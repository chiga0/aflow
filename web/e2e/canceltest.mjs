import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function findChromium(){const c=join(homedir(),"Library/Caches/ms-playwright");try{for(const d of readdirSync(c).filter(x=>x.startsWith("chromium_headless_shell")).sort().reverse()){const b=join(c,d,"chrome-headless-shell-mac-arm64","chrome-headless-shell");if(existsSync(b))return b;}}catch{}return undefined;}
const b = await chromium.launch({ headless: true, executablePath: findChromium() });
const p = await b.newPage();
await p.goto("http://127.0.0.1:8921", { waitUntil: "domcontentloaded" });
await p.waitForSelector('[data-testid="composer-input"]', { timeout: 10000 });
await p.fill('[data-testid="composer-input"]', "slow task");
await p.click('[data-testid="composer-send"]');
await p.waitForSelector('[data-testid="composer-stop"]', { timeout: 5000 });
console.log("stop visible, clicking...");
await p.click('[data-testid="composer-stop"]');
const gone = await p.waitForSelector('[data-testid="composer-stop"]', { state: "detached", timeout: 10000 }).then(() => true).catch(() => false);
console.log("stop detached after cancel:", gone);
await b.close();
process.exit(gone ? 0 : 1);
