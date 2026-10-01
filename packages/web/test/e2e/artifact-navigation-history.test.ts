import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { artifactNavigationStorageKey } from "../../src/services/artifact-navigation-state.ts";
import {
  APPLICATION_SHELL_STATES,
  retryWhenNavigationInterrupts,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

const EXTERNAL_URL = "https://example.com/external";

type NavigationRecord = {
  v: 1;
  entries: Array<{ url: string }>;
  cursor: number;
  lastWritten: number;
};

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-artifact-navigation-e2e-"));
}

function html(body: string): string {
  return `<!doctype html><html><head><style>
    body { font-family: sans-serif; margin: 0; padding: 16px; }
    .spacer { height: 1200px; }
  </style></head><body>${body}</body></html>`;
}

async function waitForApp(page: Page): Promise<void> {
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  const view = page.locator(".artifact-view").first();
  await expect(view.locator("iframe.artifact-content")).toBeVisible({ timeout: 15_000 });
  await expect(view).toHaveAttribute("data-embed-loaded", "", { timeout: 15_000 });
}

async function frameURL(page: Page): Promise<string> {
  const handle = await page.locator(".artifact-view iframe.artifact-content").first().elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("Expected artifact iframe");
  return frame.url();
}

async function navigationRecord(page: Page, artifactID: string): Promise<NavigationRecord | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, artifactNavigationStorageKey(artifactID));
}

async function historyURLs(page: Page, artifactID: string): Promise<string[]> {
  return (await navigationRecord(page, artifactID))?.entries.map((entry) => entry.url) ?? [];
}

async function clickBackButton(page: Page): Promise<void> {
  await page.locator(".artifact-view button[aria-label='Back']").click();
}


test.describe("artifact iframe navigation history", () => {
  let storagePath: string;
  let server: Server;
  let store: ServerStore;
  let serverURL: string;
  let token: string;
  let artifactID: string;
  let artifactDir: string;

  test.beforeEach(async ({ page, baseURL }) => {
    storagePath = createDataDir();
    artifactDir = path.join(storagePath, "site");
    mkdirSync(artifactDir, { recursive: true });
    store = createServingStore(storagePath);
    server = new Server({ store, port: 0 });
    const channelID = store.listChannels()[0]!.id;

    writeFileSync(
      path.join(artifactDir, "index.html"),
      html(`
        <h1>Index</h1>
        <a id="page1" href="page1.html">Page 1</a>
        <a id="fragment" href="#section">Section</a>
        <a id="external" href="${EXTERNAL_URL}">External</a>
        <div class="spacer"></div><h2 id="section">Section</h2>
      `),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page1.html"),
      html(`
        <h1>Page 1</h1>
        <a id="page2" href="page2.html">Page 2</a>
        <a id="external" href="${EXTERNAL_URL}">External</a>
        <a id="canonical" href="./">Index</a>
        <a id="cmd-external" href="${EXTERNAL_URL}">External tab</a>
        <button id="replace" onclick="history.replaceState({}, '', 'replace-state.html')">Replace</button>
        <script>
          setTimeout(() => {
            window.navigation?.addEventListener("navigate", (event) => {
              parent.postMessage({
                type: "test-default-prevented",
                value: event.defaultPrevented,
                url: event.destination.url,
              }, "*");
            });
          });
        </script>
      `),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page2.html"),
      html(`<h1>Page 2</h1><a id="page3" href="page3.html">Page 3</a>`),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page3.html"),
      html(`<h1>Page 3</h1>`),
      "utf8",
    );

    const artifact = store.createArtifact({
      kind: "path",
      title: "Navigation fixture",
      path: `${artifactDir}${path.sep}`,
      channelID: channelID,
    });
    artifactID = artifact.id;
    await server.start();
    serverURL = server.getBaseURL();
    token = server.getAuthToken();

    await page.goto(
      `${baseURL ?? ""}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&token=${token}`,
    );
    await retryWhenNavigationInterrupts(page, 15_000, () =>
      page.evaluate(() => localStorage.clear())
    );
    await page.reload();
    await waitForApp(page);
  });

  test.afterEach(async () => {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("fragment navigation records same-document URL and back restores the pre-fragment URL", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();

    await frame.locator("#fragment").click();
    await expect.poll(() => frame.locator("html").evaluate((el) => el.ownerDocument.defaultView?.scrollY ?? 0)).toBeGreaterThan(0);
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([`/artifact/${artifactID}/#section`]);
    expect(await frameURL(page)).toContain(`#section`);

    await clickBackButton(page);
    await expect(frame.locator("h1")).toHaveText("Index");
    await expect.poll(() => frameURL(page)).not.toContain("#section");
  });

  test("host-driven loads and unsupported page silence do not create duplicate entries", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();

    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await frame.locator("#external").click();
    await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveAttribute("src", "/views/url-unsupported/");
    await page.waitForTimeout(300);
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([
      `/artifact/${artifactID}/page1.html`,
      EXTERNAL_URL,
    ]);

    await clickBackButton(page);
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await page.waitForTimeout(300);
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([
      `/artifact/${artifactID}/page1.html`,
      EXTERNAL_URL,
    ]);
  });

  test("replaceState replaces the current history entry", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();

    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await frame.locator("#replace").click();

    await expect.poll(() => historyURLs(page, artifactID)).toEqual([
      `/artifact/${artifactID}/replace-state.html`,
    ]);
    const record = await navigationRecord(page, artifactID);
    expect(record?.cursor).toBe(0);
  });

  test("hot reload preserves forward history without recording a reload entry", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();

    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await frame.locator("#page2").click();
    await expect(frame.locator("h1")).toHaveText("Page 2");
    await clickBackButton(page);
    await expect(frame.locator("h1")).toHaveText("Page 1");

    writeFileSync(
      path.join(artifactDir, "index.html"),
      html(`<h1>Index reloaded</h1><a id="page1" href="page1.html">Page 1</a>`),
      "utf8",
    );

    await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveAttribute(
      "src",
      new RegExp(`/artifact/${artifactID}/page1\\.html\\?tv-reload=1$`),
    );
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
      entries: [
        { url: `/artifact/${artifactID}/page1.html` },
        { url: `/artifact/${artifactID}/page2.html` },
      ],
      cursor: 0,
    });
  });
})
