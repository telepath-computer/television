import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { artifactNavigationStorageKey } from "../../src/services/artifact-navigation-state.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

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

async function navigationRecord(page: Page, artifactID: string): Promise<NavigationRecord | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, artifactNavigationStorageKey(artifactID));
}

async function historyURLs(page: Page, artifactID: string): Promise<string[]> {
  return (await navigationRecord(page, artifactID))?.entries.map((entry) => entry.url) ?? [];
}

// Each artifact document reports its own URL to the host when it loads. A
// report that arrives after the next host navigation has started is taken as a
// new navigation, so history steps wait until the shown page's report arrives.
async function recordDocumentReports(page: Page): Promise<void> {
  await page.evaluate(() => {
    const reports: string[] = [];
    (window as unknown as { __documentReports: string[] }).__documentReports = reports;
    window.addEventListener("message", (event) => {
      const data = event.data as { type?: unknown; url?: unknown; native?: unknown; sameDocument?: unknown } | null;
      if (data?.type !== "navigation-request" || typeof data.url !== "string") return;
      if (data.native === true || data.sameDocument === true) return;
      reports.push(new URL(data.url).pathname);
    });
  });
}

async function expectReportedPage(page: Page, heading: string, pathname: string): Promise<void> {
  await expect(page.frameLocator(".artifact-view iframe.artifact-content").first().locator("h1")).toHaveText(heading);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __documentReports: string[] }).__documentReports.at(-1))).toBe(pathname);
}

async function clickBackButton(page: Page): Promise<void> {
  await page.locator(".artifact-view button[aria-label='Back']").click();
}

async function clickForwardButton(page: Page): Promise<void> {
  await page.locator(".artifact-view button[aria-label='Forward']").click();
}


test.describe("artifact iframe navigation", () => {
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
        <div class="spacer"></div><h2 id="section">Section</h2>
      `),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page1.html"),
      html(`
        <h1>Page 1</h1>
        <a id="page2" href="page2.html">Page 2</a>
        <a id="canonical" href="./">Index</a>
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
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitForApp(page);
  });

  test.afterEach(async () => {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("clicking relative links records history and host back restores earlier pages", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
    const back = page.locator(".artifact-view button[aria-label='Back']");
    const forward = page.locator(".artifact-view button[aria-label='Forward']");
    const pagePath = (name: string) => `/artifact/${artifactID}/${name}`;
    await recordDocumentReports(page);

    await frame.locator("#page1").click();
    await expectReportedPage(page, "Page 1", pagePath("page1.html"));
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([`/artifact/${artifactID}/page1.html`]);

    await frame.locator("#page2").click();
    await expectReportedPage(page, "Page 2", pagePath("page2.html"));
    await frame.locator("#page3").click();
    await expectReportedPage(page, "Page 3", pagePath("page3.html"));

    await clickBackButton(page);
    await expectReportedPage(page, "Page 2", pagePath("page2.html"));
    await clickBackButton(page);
    await expectReportedPage(page, "Page 1", pagePath("page1.html"));
    await clickBackButton(page);
    await expectReportedPage(page, "Index", pagePath(""));
    await expect(back).toBeDisabled();
    await expect(forward).toBeEnabled();
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
      entries: [
        { url: `/artifact/${artifactID}/page1.html` },
        { url: `/artifact/${artifactID}/page2.html` },
        { url: `/artifact/${artifactID}/page3.html` },
      ],
      cursor: -1,
    });

    await clickForwardButton(page);
    await expectReportedPage(page, "Page 1", pagePath("page1.html"));
    await clickForwardButton(page);
    await expectReportedPage(page, "Page 2", pagePath("page2.html"));
    await clickForwardButton(page);
    await expectReportedPage(page, "Page 3", pagePath("page3.html"));
    await expect(back).toBeEnabled();
    await expect(forward).toBeDisabled();
    await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({ cursor: 2 });
  });

  test("Navigation API same-origin cross-document navigation proceeds natively while host records history", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __defaultPreventedEvents: unknown[] }).__defaultPreventedEvents = [];
      window.addEventListener("message", (event) => {
        if (event.data?.type === "test-default-prevented") {
          (window as unknown as { __defaultPreventedEvents: unknown[] }).__defaultPreventedEvents.push(event.data);
        }
      });
    });
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();

    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await frame.locator("#page2").click();
    await expect(frame.locator("h1")).toHaveText("Page 2");

    await expect.poll(() => page.evaluate(() => {
      const events = (window as unknown as { __defaultPreventedEvents: Array<{ value: boolean }> }).__defaultPreventedEvents;
      return events.some((event) => event.value === false);
    })).toBe(true);
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([
      `/artifact/${artifactID}/page1.html`,
      `/artifact/${artifactID}/page2.html`,
    ]);
  });

})
