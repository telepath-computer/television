import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { desktopE2EURL, launchDesktop } from "./helpers.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const START_URL = desktopE2EURL("/packages/desktop/test/e2e/fixtures/electron-url-nav-start.html", { hostname: "localhost" });
const PAGE2_URL = desktopE2EURL("/packages/desktop/test/e2e/fixtures/electron-url-nav-page2.html", { hostname: "localhost" });
const SUBFRAME_URL = desktopE2EURL("/packages/desktop/test/e2e/fixtures/electron-url-nav-subframe.html", { hostname: "localhost" });

type NavigationRecord = { entries: Array<{ url: string }>; cursor: number } | null;

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-electron-navigation-e2e-"));
}

async function createURLArtifact(server: Server, store: ServerStore): Promise<string> {
  const response = await fetch(`${server.getBaseURL()}/artifacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${server.getAuthToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: "url",
      title: "Navigation Fixture",
      url: START_URL,
      channelID: store.listChannels()[0]!.id,
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { artifact: { id: string } };
  return body.artifact.id;
}

async function launchNavigationApp(server: Server): Promise<{ app: ElectronApplication; page: Page }> {
  return await launchDesktop({
    fixture: desktopE2EURL(`/packages/web/src/index.html?mode=electron&serverURL=${encodeURIComponent(server.getBaseURL())}&token=${server.getAuthToken()}`),
  });
}

async function startExternalSite(): Promise<{ server: HTTPServer; url: string }> {
  const externalServer = createHTTPServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><html><body><h1 id='page-title'>External</h1></body></html>");
  });
  await new Promise<void>((resolve) => externalServer.listen(0, "127.0.0.1", resolve));
  const address = externalServer.address();
  if (!address || typeof address === "string") throw new Error("External test server did not bind a TCP port");
  return { server: externalServer, url: `http://127.0.0.1:${address.port}/external.html` };
}

async function stopExternalSite(server: HTTPServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function webviewURL(app: ElectronApplication): Promise<string | null> {
  return await app.evaluate(({ webContents }) => {
    return webContents.getAllWebContents().find((contents) => contents.getType() === "webview")?.getURL() ?? null;
  });
}

async function clickInWebview(app: ElectronApplication, selector: string): Promise<void> {
  await app.evaluate(async ({ webContents }, targetSelector) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    await contents.executeJavaScript(`document.querySelector(${JSON.stringify(targetSelector)})?.click()`);
  }, selector);
}

async function setWebviewHref(app: ElectronApplication, selector: string, url: string): Promise<void> {
  await app.evaluate(async ({ webContents }, payload) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    await contents.executeJavaScript(`document.querySelector(${JSON.stringify(payload.selector)}).href = ${JSON.stringify(payload.url)}`);
  }, { selector, url });
}

async function webviewFrameURL(app: ElectronApplication, selector: string): Promise<string | null> {
  return await app.evaluate(async ({ webContents }, targetSelector) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript(
      `document.querySelector(${JSON.stringify(targetSelector)})?.contentWindow?.location.href ?? null`,
    );
  }, selector);
}

async function clickInWebviewFrame(
  app: ElectronApplication,
  frameSelector: string,
  selector: string,
): Promise<void> {
  await app.evaluate(async ({ webContents }, target) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    await contents.executeJavaScript(
      `document.querySelector(${JSON.stringify(target.frameSelector)})?.contentDocument?.querySelector(${JSON.stringify(target.selector)})?.click()`,
    );
  }, { frameSelector, selector });
}

async function navigationRecord(page: Page, artifactID: string): Promise<NavigationRecord> {
  return await page.evaluate((id) => {
    const raw = localStorage.getItem(`tv-nav:${id}`);
    return raw ? JSON.parse(raw) : null;
  }, artifactID);
}


test.describe("Electron URL artifact navigation", () => {
  let storagePath: string;
  let server: Server;
  let store: ServerStore;
  let artifactID: string;
  let externalServer: HTTPServer;
  let externalURL: string;

  test.beforeEach(async () => {
    storagePath = createDataDir();
    store = createServingStore(storagePath);
    server = new Server({ store, port: 0 });
    await server.start();
    artifactID = await createURLArtifact(server, store);
    const external = await startExternalSite();
    externalServer = external.server;
    externalURL = external.url;
  });

  test.afterEach(async () => {
    await stopExternalSite(externalServer);
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("records navigation to a different external site and host back returns to the previous page", async () => {
    const { app, page } = await launchNavigationApp(server);
    try {
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(START_URL);
      await clickInWebview(app, "#same-origin-link");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(PAGE2_URL);

      await setWebviewHref(app, "#external-link", externalURL);
      await clickInWebview(app, "#external-link");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(externalURL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: PAGE2_URL }, { url: externalURL }],
        cursor: 1,
      });

      await page.locator(".artifact-view button[aria-label='Back']").click();
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(PAGE2_URL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: PAGE2_URL }, { url: externalURL }],
        cursor: 0,
      });
    } finally {
      await app.close();
    }
  });

  test("records did-navigate-in-page fragment and pushState navigations", async () => {
    const { app, page } = await launchNavigationApp(server);
    try {
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(START_URL);

      await clickInWebview(app, "#fragment-link");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(`${START_URL}#section-two`);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: `${START_URL}#section-two` }],
        cursor: 0,
      });

      await clickInWebview(app, "#push-state");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(`${START_URL}?spa=1`);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: `${START_URL}#section-two` }, { url: `${START_URL}?spa=1` }],
        cursor: 1,
      });
    } finally {
      await app.close();
    }
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-electron-subframe-navigation
  test("does not record child-frame in-page navigation as artifact history", async () => {
    const { app, page } = await launchNavigationApp(server);
    try {
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(START_URL);
      await expect.poll(() => webviewFrameURL(app, "#navigation-subframe"), { timeout: 15_000 }).toBe(SUBFRAME_URL);
      const webview = page.locator("webview.artifact-content");
      await webview.evaluate((element) => {
        element.addEventListener("did-navigate-in-page", (event) => {
          const navigation = event as Event & { isMainFrame?: unknown; url?: unknown };
          if (navigation.isMainFrame === false && typeof navigation.url === "string") {
            element.setAttribute("data-subframe-navigation-url", navigation.url);
          }
        });
      });

      await clickInWebviewFrame(app, "#navigation-subframe", "#fragment-link");
      await expect(webview).toHaveAttribute(
        "data-subframe-navigation-url",
        `${SUBFRAME_URL}#section-two`,
      );

      await expect.poll(() => webviewURL(app)).toBe(START_URL);
      await expect.poll(() => navigationRecord(page, artifactID)).toBeNull();
      await expect(page.locator(".artifact-view button[aria-label='Back']")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
})
