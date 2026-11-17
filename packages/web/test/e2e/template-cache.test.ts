import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { Server } from "@telepath-computer/television-server";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { defaultWatchContentFile } from "../../../server/src/file-watcher.ts";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore, type ServingStoreOverrides } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion, waitForApplicationShell } from "./helpers.ts";

test.setTimeout(90_000);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function template(home: string, name: string, color = "red") {
  const folder = path.join(home, "templates", "Space #One");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name, description: "Site", version: "1.0.0", url: "https://example.com", icons: [{ src: "icon.svg" }] }));
  writeFileSync(path.join(folder, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect id="template-svg-content" width="20" height="20" fill="${color}"/></svg>`);
}
async function start(overrides: ServingStoreOverrides = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "tv-template-cache-browser-"));
  template(home, "First");
  const store = createServingStore(home, overrides);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  await server.start();
  return { home, store, server, client: new TelevisionClient(server.getBaseURL(), { token: store.authToken }), async dispose() {
    await server.dispose(); rmSync(home, { recursive: true, force: true });
  } };
}
async function openApp(page: Page, baseURL: string | undefined, product: Awaited<ReturnType<typeof start>>) {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const url = new URL("/packages/web/src/index.html", await appURLForServer(product.server.getBaseURL(), baseURL));
  url.searchParams.set("token", product.store.authToken);
  await page.goto(url.toString());
  await waitForApplicationShell(page);
  await configureTestMotion(page);
}
async function toggle(page: Page, open: boolean) {
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  if (open) await expect(page.locator(".toolbox-popover")).toHaveAttribute("open", "");
  else await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
}
async function iconText(page: Page) {
  return page.locator(".toolbox-tile img").evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text());
}
function recordRequests(page: Page) {
  const requests: { path: string; token: string | undefined }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/templates")) requests.push({ path: url.pathname + url.search, token: request.headers().authorization });
  });
  return requests;
}

test("preloads authenticated icons, opens from cache, observes closed edits and reloads after missed events (^templates-t-app-cache-seam)", async ({ page, baseURL }) => {
  const product = await start();
  const requests = recordRequests(page);
  try {
    const preload = page.waitForResponse((response) => response.url().endsWith("/icon"));
    await openApp(page, baseURL, product); await preload;
    const before = requests.length;
    await toggle(page, true);
    await expect(page.locator(".toolbox-name")).toHaveText("First");
    await expect.poll(() => iconText(page)).toContain('fill="red"');
    expect(requests.length).toBe(before);
    expect(requests.every(({ token }) => token === `Bearer ${product.store.authToken}`)).toBe(true);
    expect(requests.filter(({ path }) => path.endsWith("/icon"))).toHaveLength(1);
    await expect(page.locator("#template-svg-content")).toHaveCount(0);
    await expect(page.locator(".toolbox-tile img")).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => page.locator(".toolbox-tile img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(20);
    await toggle(page, false);
    const editedIcon = page.waitForResponse((response) => response.url().endsWith("/icon"));
    template(product.home, "Closed edit", "blue");
    await editedIcon;
    await toggle(page, true);
    await expect(page.locator(".toolbox-name")).toHaveText("Closed edit");
    await expect.poll(() => iconText(page)).toContain('fill="blue"');
    await toggle(page, false);
    const events = (product.server as unknown as { events: { wsServer: { clients: Set<{ terminate(): void }> }; getConnectedClientCount(): number } }).events;
    for (const socket of events.wsServer.clients) socket.terminate();
    template(product.home, "Missed edit", "green");
    product.store.templateCache!.get(true);
    expect(events.getConnectedClientCount()).toBe(0);
    const reconnectIcon = page.waitForResponse((response) => response.url().endsWith("/icon"));
    await expect.poll(() => events.getConnectedClientCount()).toBeGreaterThan(0);
    await reconnectIcon;
    const reloaded = requests.length;
    await toggle(page, true);
    await expect(page.locator(".toolbox-name")).toHaveText("Missed edit");
    await expect.poll(() => iconText(page)).toContain('fill="green"');
    expect(requests.length).toBe(reloaded);
    expect(await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => new URL(entry.name).hostname === "example.com"))).toBe(false);
  } finally { await product.dispose(); }
});

test("discards delayed real list and icon responses after newer pushes (^templates-t-app-cache-seam)", async ({ page, baseURL }) => {
  const product = await start();
  const heldList = deferred(), releaseList = deferred(), heldIcon = deferred(), releaseIcon = deferred();
  let firstList = true, firstIcon = true;
  await page.route("**/templates", async (route) => {
    if (!firstList) { await route.continue(); return; }
    firstList = false;
    const response = await route.fetch(); heldList.resolve();
    await releaseList.promise; await route.fulfill({ response });
  });
  await page.route("**/templates/*/icon", async (route) => {
    if (!firstIcon) { await route.continue(); return; }
    firstIcon = false;
    const response = await route.fetch(); heldIcon.resolve();
    await releaseIcon.promise; await route.fulfill({ response });
  });
  try {
    await openApp(page, baseURL, product); await heldList.promise;
    template(product.home, "Pushed", "blue");
    await product.client.templates.list({ fresh: true });
    await heldIcon.promise;
    template(product.home, "Newest", "green");
    await product.client.templates.list({ fresh: true });
    await toggle(page, true);
    await expect(page.locator(".toolbox-name")).toHaveText("Newest");
    await expect.poll(() => iconText(page)).toContain('fill="green"');
    const oldListFinished = page.waitForResponse((response) => new URL(response.url()).pathname === "/templates").then((response) => response.finished());
    const oldIconFinished = page.waitForResponse((response) => response.url().endsWith("/icon")).then((response) => response.finished());
    releaseList.resolve(); releaseIcon.resolve();
    await Promise.all([oldListFinished, oldIconFinished]);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.locator(".toolbox-name")).toHaveText("Newest");
    await expect.poll(() => iconText(page)).toContain('fill="green"');
  } finally { releaseList.resolve(); releaseIcon.resolve(); await product.dispose(); }
});

test("retries initial load and refreshes on watcher failure without clearing prior items or looping (^templates-ac-cache-fallback)", async ({ page, baseURL }) => {
  let fail = false;
  let failWatcher = () => {};
  const product = await start({ watchContentFile: (file, change, options) => {
    if (fail) throw new Error("Test watcher unavailable");
    const watcher = defaultWatchContentFile(file, change, options);
    failWatcher = () => (watcher as unknown as { emit(type: string, error: Error): void }).emit("error", new Error("Test watcher failure"));
    return watcher;
  } });
  const requests = recordRequests(page);
  let abortInitial = true;
  await page.route("**/templates", async (route) => {
    if (abortInitial) { abortInitial = false; await route.abort(); } else await route.continue();
  });
  const refreshStarted = deferred(), releaseRefresh = deferred();
  const holdRefresh = async (route: Route) => { refreshStarted.resolve(); await releaseRefresh.promise; await route.continue(); };
  try {
    await openApp(page, baseURL, product);
    await toggle(page, true);
    await expect(page.locator(".toolbox-name")).toHaveText("First");
    expect(requests.filter(({ path }) => path === "/templates")).toHaveLength(2);
    await page.route("**/templates?fresh=true", holdRefresh);
    fail = true;
    template(product.home, "Fallback", "blue");
    failWatcher();
    await refreshStarted.promise;
    await expect(page.locator(".toolbox-name")).toHaveText("First");
    releaseRefresh.resolve();
    await expect(page.locator(".toolbox-name")).toHaveText("Fallback");
    await page.unroute("**/templates?fresh=true", holdRefresh);
    expect(requests.filter(({ path }) => path === "/templates?fresh=true")).toHaveLength(1);
    await expect(page.locator(".toolbox-invalid, .toolbox-folder-error")).toHaveCount(0);
    await toggle(page, false);
    template(product.home, "Next opening", "green");
    await toggle(page, true);
    await expect(page.locator(".toolbox-name")).toHaveText("Next opening");
    expect(requests.filter(({ path }) => path === "/templates?fresh=true")).toHaveLength(2);
    fail = false;
    await product.client.templates.list({ fresh: true });
    await expect.poll(() => iconText(page)).toContain('fill="green"');
    await toggle(page, false);
    const before = requests.length;
    await toggle(page, true);
    expect(requests.length).toBe(before);
  } finally { releaseRefresh.resolve(); await product.dispose(); }
});
