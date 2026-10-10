import type { Page } from "@playwright/test";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
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
// A sandboxed page also reports each link it follows with the destination's
// URL, so a document's own report is the one just before its bridge says it
// is ready.
async function recordDocumentReports(page: Page): Promise<void> {
  await page.evaluate(() => {
    const reports: string[] = [];
    let lastReport: string | null = null;
    (window as unknown as { __documentReports: string[] }).__documentReports = reports;
    window.addEventListener("message", (event) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === "navigation-request" && typeof data.url === "string") lastReport = new URL(data.url).pathname;
      if (data?.type === "bridge-ready" && lastReport !== null) reports.push(lastReport);
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
        <a id="handled" href="page2.html">Handled by the page</a>
        <button id="push" onclick="history.pushState({}, '', 'pushed.html')">Push</button>
        <form id="search" action="results.html">
          <input name="q" value="cats"><input type="hidden" name="action" value="search">
          <button id="submit-search">Search</button>
        </form>
        <script>
          document.getElementById("handled").addEventListener("click", (event) => {
            event.preventDefault();
            document.body.dataset.handled = "yes";
          });
        </script>
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
    writeFileSync(
      path.join(artifactDir, "results.html"),
      html(`<h1>Results</h1><p id="query"></p><a id="page1" href="page1.html">Page 1</a>
        <script>document.getElementById("query").textContent = location.search;</script>`),
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
    const appURL = await appURLForServer(serverURL, baseURL!);

    await page.goto(`${appURL}/packages/web/src/index.html?token=${token}`);
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

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-sandboxed-recording-seam
  test("a sandboxed frame records links, pushState, fragments and GET forms, and not a click the page handled", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
    const frameDocument = () => page.frames().find((candidate) => candidate.url().includes(`/artifact/${artifactID}/`))!;
    await expect.poll(() => frameDocument()?.evaluate(() => window.origin)).toBe("null");

    await frame.locator("#handled").click();
    await expect(frame.locator("body")).toHaveAttribute("data-handled", "yes");
    await expect(frame.locator("h1")).toHaveText("Index");

    await frame.locator("#fragment").click();
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([`/artifact/${artifactID}/#section`]);
    await expect.poll(() => frameDocument().evaluate(() => location.hash)).toBe("#section");

    await frame.locator("#push").click();
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([
      `/artifact/${artifactID}/#section`,
      `/artifact/${artifactID}/pushed.html`,
    ]);
    await expect.poll(() => frameDocument().evaluate(() => location.pathname)).toBe(`/artifact/${artifactID}/pushed.html`);

    await frame.locator("#submit-search").click();
    await expect(frame.locator("h1")).toHaveText("Results");
    await expect(frame.locator("#query")).toHaveText("?q=cats&action=search");

    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await expect.poll(() => historyURLs(page, artifactID)).toEqual([
      `/artifact/${artifactID}/#section`,
      `/artifact/${artifactID}/pushed.html`,
      `/artifact/${artifactID}/results.html?q=cats&action=search`,
      `/artifact/${artifactID}/page1.html`,
    ]);
  });

})
