import { type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { artifactNavigationStorageKey } from "../../src/services/artifact-navigation-state.ts";
import { configureTestMotion } from "./helpers.ts";

const EXTERNAL_URL = "https://example.com/external";
const staleHistoryAgeMs = 31 * 24 * 60 * 60 * 1000;

type NavigationRecord = {
  v: 1;
  entries: Array<{ url: string }>;
  cursor: number;
  lastWritten: number;
};

function html(body: string): string {
  return `<!doctype html><html><head><style>
    body { font-family: sans-serif; margin: 0; padding: 16px; }
  </style></head><body>${body}</body></html>`;
}

async function defaultChannel(server: ProductServer): Promise<{ id: string; name: string }> {
  const response = await fetch(`${server.serverURL}/channels`);
  expect(response.status).toBe(200);
  const { channels } = (await response.json()) as { channels: Array<{ id: string; name: string }> };
  const channel = channels[0];
  if (!channel) throw new Error("Product server did not create a default channel");
  return channel;
}

async function channelID(server: ProductServer): Promise<string> {
  return (await defaultChannel(server)).id;
}

async function createPathArtifact(server: ProductServer, filePath: string, title = "Artifact", targetChannelID?: string): Promise<string> {
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "path", title, path: filePath, channelID: targetChannelID ?? await channelID(server) }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { artifact: { id: string } };
  return body.artifact.id;
}

async function waitForApp(page: Page): Promise<void> {
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
}

async function openApp(page: Page, server: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appBaseURL = await server.appURL(baseURL);
  await page.goto(`${appBaseURL}/packages/web/src/index.html`);
  await waitForApp(page);
}

async function navigationRecord(page: Page, artifactID: string): Promise<NavigationRecord | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, artifactNavigationStorageKey(artifactID));
}

async function activateFrameLink(page: Page, selector: string): Promise<void> {
  await page.frameLocator(".artifact-view iframe.artifact-content").first().locator(selector).click();
}


test.describe("real-stack browser navigable history", () => {
  let server: ProductServer | null;

  test.beforeEach(async () => {
    server = await launchProductServer();
  });

  test.afterEach(async () => {
    await server?.dispose();
    server = null;
  });

  test("server connect cleans stale navigation history through the real browser app lifecycle", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");
    const staleKey = artifactNavigationStorageKey("nonexistent-artifact");
    const staleRecord = {
      v: 1,
      entries: [{ url: "/artifact/nonexistent-artifact/page.html" }],
      cursor: 0,
      lastWritten: Date.now() - staleHistoryAgeMs,
    } satisfies NavigationRecord;

    await page.addInitScript(
      ({ key, record }) => localStorage.setItem(key, JSON.stringify(record)),
      { key: staleKey, record: staleRecord },
    );

    await openApp(page, server, baseURL);

    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), staleKey)).toBeNull();
  });

  test.describe("path artifact history", () => {

  test("path artifact history works through the real product server and browser iframe", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");
    const siteDir = path.join(server.home, "site");
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(path.join(siteDir, "index.html"), html(`
      <h1>Index</h1>
      <a id="page1" href="page1.html">Page 1</a>
    `));
    writeFileSync(path.join(siteDir, "page1.html"), html(`
      <h1>Page 1</h1>
      <a id="page2" href="page2.html">Page 2</a>
      <a id="external" href="${EXTERNAL_URL}">External</a>
    `));
    writeFileSync(path.join(siteDir, "page2.html"), html(`<h1>Page 2</h1>`));
    const artifactID = await createPathArtifact(server, `${siteDir}${path.sep}`, "Site");

    await openApp(page, server, baseURL);
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
    const back = page.locator(".artifact-view button[aria-label='Back']");
    const forward = page.locator(".artifact-view button[aria-label='Forward']");
    await expect(frame.locator("h1")).toHaveText("Index");

    await activateFrameLink(page, "#page1");
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await activateFrameLink(page, "#page2");
    await expect(frame.locator("h1")).toHaveText("Page 2");
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
      entries: [
        { url: `/artifact/${artifactID}/page1.html` },
        { url: `/artifact/${artifactID}/page2.html` },
      ],
      cursor: 1,
    });
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();

    await back.click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({ cursor: 0 });
    await expect(forward).toBeEnabled();

    await page.reload();
    await waitForApp(page);
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
      entries: [
        { url: `/artifact/${artifactID}/page1.html` },
        { url: `/artifact/${artifactID}/page2.html` },
      ],
      cursor: 0,
    });

    await forward.click();
    await expect(frame.locator("h1")).toHaveText("Page 2");
    await back.click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await back.click();
    await expect(frame.locator("h1")).toHaveText("Index");
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({ cursor: -1 });
  });
  });

  test("back then new browser iframe navigation clears forward history entries", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");
    const siteDir = path.join(server.home, "forward-clear-site");
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(path.join(siteDir, "index.html"), html(`
      <h1>Index</h1>
      <a id="page-b" href="b.html">B</a>
    `));
    writeFileSync(path.join(siteDir, "b.html"), html(`
      <h1>B</h1>
      <a id="page-c" href="c.html">C</a>
      <a id="page-d" href="d.html">D</a>
    `));
    writeFileSync(path.join(siteDir, "c.html"), html(`<h1>C</h1>`));
    writeFileSync(path.join(siteDir, "d.html"), html(`<h1>D</h1>`));
    const artifactID = await createPathArtifact(server, `${siteDir}${path.sep}`, "Forward Clear Site");

    await openApp(page, server, baseURL);
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
    await expect(frame.locator("h1")).toHaveText("Index");

    await activateFrameLink(page, "#page-b");
    await expect(frame.locator("h1")).toHaveText("B");
    await activateFrameLink(page, "#page-c");
    await expect(frame.locator("h1")).toHaveText("C");
    await page.locator(".artifact-view button[aria-label='Back']").click();
    await expect(frame.locator("h1")).toHaveText("B");
    await expect(page.locator(".artifact-view button[aria-label='Forward']")).toBeEnabled();
    await activateFrameLink(page, "#page-d");
    await expect(frame.locator("h1")).toHaveText("D");
    await expect(page.locator(".artifact-view button[aria-label='Forward']")).toBeDisabled();

    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
      entries: [
        { url: `/artifact/${artifactID}/b.html` },
        { url: `/artifact/${artifactID}/d.html` },
      ],
      cursor: 1,
    });
  });
})
