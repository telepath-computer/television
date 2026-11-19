import { expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { activeFixture, evidence } from "./support.ts";

test("bounded active owned process", activeFixture);
test("Node and Chromium place real temporary files under the shard attempt", async () => {
  const tmp = os.tmpdir();
  expect(tmp).toMatch(/^\/tmp\/tv-testshards\/[^/]+\/tmp$/);
  const nodeDir = mkdtempSync(path.join(tmp, "node-placement-"));
  writeFileSync(path.join(nodeDir, "created"), "node temporary file");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas width="1024" height="1024"></canvas><script>const c=document.querySelector("canvas");const x=c.getContext("2d");x.fillStyle="red";x.fillRect(0,0,c.width,c.height);</script>');
    await page.screenshot();
    const descriptors: Array<{pid: number; fd: string; path: string}> = [];
    for (const pid of readdirSync("/proc").filter(value => /^\d+$/.test(value))) {
      try {
        const env = readFileSync(`/proc/${pid}/environ`, "utf8");
        const exe = readlinkSync(`/proc/${pid}/exe`);
        if (!env.split("\0").includes(`TV_TEST_SHARD_OWNER=${process.env.TV_TEST_SHARD_OWNER}`) || !/chrome|chromium/.test(exe)) continue;
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try { const target = readlinkSync(`/proc/${pid}/fd/${fd}`); if (target.startsWith(tmp + "/")) descriptors.push({pid: Number(pid), fd, path: target}); } catch {}
        }
      } catch {}
    }
    evidence("temporary-placement.json", { tmp, nodeDir, browserVersion: browser.version(), executable: chromium.executablePath(), token: process.env.TV_TEST_SHARD_OWNER, surface: process.env.TV_TEST_SURFACE_OWNER, descriptors });
    expect(descriptors.some(entry => entry.path.includes("Chromium") && entry.path.endsWith(" (deleted)"))).toBe(true);
  } finally { await browser.close(); rmSync(nodeDir, {recursive: true, force: true}); }
});
