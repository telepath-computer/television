import { expect, test as base } from "@playwright/test";
import { disposeAllProductServers } from "./product-server.ts";
import fs from "node:fs";
import { observeResources } from "./chromium-resources.ts";

export { expect };

/** Playwright test registration with per-test cleanup for product servers, including interrupted launches. */
export const test = base.extend<{ productServerCleanup: void; resourceProbe: void }>({
  launchOptions: [async ({ launchOptions }, use) => {
    const prefix = `/tmp/rose-chromium-${process.pid}`;
    console.log(`ROSE_BROWSER_LOG ${prefix}`);
    await use({ ...launchOptions, args: [...(launchOptions.args ?? []), `--log-net-log=${prefix}.netlog.json`, "--enable-logging", `--log-file=${prefix}.log`] });
    if (fs.existsSync(`${prefix}.log`)) console.log(`ROSE_BROWSER_STDERR ${fs.readFileSync(`${prefix}.log`, "utf8").slice(-20000)}`);
  }, { scope: "worker" }],
  resourceProbe: [async ({ context, browserName }, use, testInfo) => {
    const stop = browserName === "chromium" ? observeResources(context, `${testInfo.title} retry=${testInfo.retry}`) : () => {};
    try { await use(); } finally { stop(); }
  }, { auto: true }],
  productServerCleanup: [async ({}, use) => {
    try {
      await use();
    } finally {
      await disposeAllProductServers();
    }
  }, { auto: true }],
});
