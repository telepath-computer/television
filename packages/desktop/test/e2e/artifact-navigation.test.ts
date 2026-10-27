import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { desktopE2EOrigin, desktopE2EURL, launchDesktop } from "./helpers.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const START_URL = desktopE2EURL("/packages/desktop/test/e2e/fixtures/electron-url-nav-start.html", { hostname: "localhost" });
const PAGE2_URL = desktopE2EURL("/packages/desktop/test/e2e/fixtures/electron-url-nav-page2.html", { hostname: "localhost" });

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
    fixture: `${await appURLForServer(server.getBaseURL(), desktopE2EOrigin())}/packages/web/src/index.html?mode=electron&token=${server.getAuthToken()}`,
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

  test.beforeEach(async () => {
    storagePath = createDataDir();
    store = createServingStore(storagePath);
    server = new Server({ store, port: 0 });
    await server.start();
    artifactID = await createURLArtifact(server, store);
    const external = await startExternalSite();
    externalServer = external.server;
  });

  test.afterEach(async () => {
    await stopExternalSite(externalServer);
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("loads the canonical URL artifact in a webview", async () => {
    const { app, page } = await launchNavigationApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(START_URL);
      expect(await navigationRecord(page, artifactID)).toBeNull();
    } finally {
      await app.close();
    }
  });

  // spec: proofs/product/artifact-navigation.md#^ac-back-to-home
  test("records same-origin webview navigations and host back returns to canonical without duplicates", async () => {
    const { app, page } = await launchNavigationApp(server);
    try {
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(START_URL);

      await clickInWebview(app, "#same-origin-link");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(PAGE2_URL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({ entries: [{ url: PAGE2_URL }], cursor: 0 });

      await page.locator(".artifact-view button[aria-label='Back']").click();
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(START_URL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({ entries: [{ url: PAGE2_URL }], cursor: -1 });
    } finally {
      await app.close();
    }
  });

})
