import { type ElectronApplication, type Page } from "@playwright/test";
import { FLAKY_TEST_RETRIES } from "../../../../test/flaky-retries.js";
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import path from "node:path";
import { createApplicationProtocolHandler } from "../../../../test/helpers/application-protocol-handler.ts";
import { createUserDataDir, desktopE2EOrigin, launchDesktop } from "./helpers.ts";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";

type NavigationRecord = { entries: Array<{ url: string }>; cursor: number } | null;

const desktopViteBaseURL = desktopE2EOrigin();

async function launchApp(
  server: ProductServer,
  options: { userDataDir?: string; env?: Record<string, string> } = {},
): Promise<{ app: ElectronApplication; page: Page; appURL: string }> {
  const appURL = await server.appURL(desktopViteBaseURL);
  // desktopAppVersion sits above any published requirement: the product
  // server is a STAMPED build whose baked REQUIRED_DESKTOP_VERSION can name
  // the next release (desktop-upgrade-gate.md ^ops-first-gate), and an
  // electron-mode page declaring no shell version would — correctly — halt
  // at the upgrade gate instead of booting the artifact UI under test.
  const { app, page } = await launchDesktop({
    fixture: `${appURL}/packages/web/src/index.html?mode=electron&desktopAppVersion=9.9.9`,
    userDataDir: options.userDataDir,
    env: options.env,
  });
  return { app, page, appURL };
}

async function defaultChannelID(server: ProductServer): Promise<string> {
  const channelsResponse = await fetch(`${server.serverURL}/channels`);
  expect(channelsResponse.status).toBe(200);
  const { channels } = (await channelsResponse.json()) as { channels: Array<{ id: string }> };
  const channelID = channels[0]?.id;
  if (!channelID) throw new Error("Product server did not create a default channel");
  return channelID;
}

async function createPathArtifact(
  server: ProductServer,
  filePath: string,
  title = "Path Artifact",
): Promise<string> {
  const channelID = await defaultChannelID(server);
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "path", title, path: filePath, channelID: channelID }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { artifact: { id: string } };
  return body.artifact.id;
}

async function createURLArtifact(server: ProductServer, url: string, title = "URL Artifact"): Promise<string> {
  const channelID = await defaultChannelID(server);
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "url", title, url, channelID: channelID }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { artifact: { id: string } };
  return body.artifact.id;
}

async function updatePathArtifact(
  server: ProductServer,
  artifactID: string,
  fields: { title?: string; path?: string },
): Promise<void> {
  const response = await fetch(`${server.serverURL}/artifacts/${encodeURIComponent(artifactID)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  expect(response.status).toBe(200);
}

async function startURLSite(routes: Record<string, string>): Promise<{ server: HTTPServer; baseURL: string }> {
  const externalServer = createHTTPServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const body = routes[pathname] ?? "<!doctype html><html><body><h1>Not found</h1></body></html>";
    response.writeHead(routes[pathname] ? 200 : 404, { "Content-Type": "text/html" });
    response.end(body);
  });
  await new Promise<void>((resolve) => externalServer.listen(0, "127.0.0.1", resolve));
  const address = externalServer.address();
  if (!address || typeof address === "string") throw new Error("External test server did not bind a TCP port");
  return { server: externalServer, baseURL: `http://127.0.0.1:${address.port}` };
}

async function startExternalSite(): Promise<{ server: HTTPServer; url: string }> {
  const externalServer = createHTTPServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><html><body><h1>External</h1></body></html>");
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

async function webviewHasSelector(app: ElectronApplication, selector: string): Promise<boolean> {
  return await app.evaluate(async ({ webContents }, targetSelector) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript(`document.querySelector(${JSON.stringify(targetSelector)}) !== null`);
  }, selector);
}

interface MissingWebviewState {
  id: number;
  url: string;
  title: string;
  path: string | null;
}

async function missingWebviewState(app: ElectronApplication): Promise<MissingWebviewState | null> {
  return await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) return null;
    const state = await contents.executeJavaScript(`({
      title: document.title,
      path: document.querySelector('#missing-path')?.textContent ?? null,
    })`) as { title: string; path: string | null };
    return { id: contents.id, url: contents.getURL(), ...state };
  });
}

async function installHostMessageRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    await contents.executeJavaScript(`(() => {
      window.__televisionHostMessageCount = 0;
      window.__televisionContentBridge.onHostMessage(() => { window.__televisionHostMessageCount += 1; });
    })()`);
  });
}

async function recordedHostMessageCount(app: ElectronApplication): Promise<number> {
  return await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript("window.__televisionHostMessageCount ?? 0") as number;
  });
}

async function clickInWebview(app: ElectronApplication, selector: string): Promise<void> {
  await app.evaluate(async ({ webContents }, targetSelector) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    await contents.executeJavaScript(`document.querySelector(${JSON.stringify(targetSelector)})?.click()`);
  }, selector);
}

async function realClickInWebview(
  app: ElectronApplication,
  selector: string,
  button: "left" | "middle" = "left",
): Promise<void> {
  await app.evaluate(async ({ webContents }, { targetSelector, button }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    const point = (await contents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(targetSelector)});
      if (!element) throw new Error("Target not found");
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`)) as { x: number; y: number };
    contents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    contents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button, clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button, clickCount: 1 });
  }, { targetSelector: selector, button });
}

async function cmdOrCtrlClickInWebview(app: ElectronApplication, selector: string): Promise<void> {
  await app.evaluate(async ({ webContents }, targetSelector) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    const point = (await contents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(targetSelector)});
      if (!element) throw new Error("Target not found");
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`)) as { x: number; y: number };
    const modifiers: Array<"meta" | "control"> = process.platform === "darwin" ? ["meta"] : ["control"];
    contents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y, modifiers });
    contents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
    contents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
  }, selector);
}

async function markdownDoc(app: ElectronApplication): Promise<string> {
  return await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript("window.__cmView?.state.doc.toString() ?? null");
  });
}

async function replaceMarkdownDoc(app: ElectronApplication, content: string): Promise<void> {
  await app.evaluate(async ({ webContents }, nextContent) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    await contents.executeJavaScript(`{
      const view = window.__cmView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(nextContent)} } });
    }`);
  }, content);
}

async function navigationRecord(page: Page, artifactID: string): Promise<NavigationRecord> {
  return await page.evaluate((id) => {
    const raw = localStorage.getItem(`tv-nav:${id}`);
    return raw ? JSON.parse(raw) : null;
  }, artifactID);
}


test.describe("Electron all-webview dispatcher", () => {

  let server: ProductServer | null;
  let externalServer: HTTPServer | null;

  test.beforeEach(async () => {
    server = await launchProductServer();
    externalServer = null;
  });

  test.afterEach(async () => {
    if (externalServer) await stopExternalSite(externalServer);
    await server?.dispose();
    server = null;
  });

  test.describe("flaky: URL artifact in-page navigation", () => {
    test.describe.configure({ retries: FLAKY_TEST_RETRIES, timeout: 60_000 });

  test("URL artifact in-page fragment and pushState navigations are recorded from the real webview", async () => {
    if (!server) throw new Error("Product server was not started");
    const site = await startURLSite({
      "/start.html": `<!doctype html><html><body>
        <h1>URL Start</h1>
        <a id="fragment-link" href="#section">Section</a>
        <button id="push-state" onclick="history.pushState({}, '', '/pushed.html')">Push state</button>
        <div style="height: 1200px"></div>
        <h2 id="section">Section</h2>
      </body></html>`,
      "/pushed.html": "<!doctype html><html><body><h1>Pushed</h1></body></html>",
    });
    externalServer = site.server;
    const startURL = `${site.baseURL}/start.html`;
    const fragmentURL = `${startURL}#section`;
    const pushedURL = `${site.baseURL}/pushed.html`;
    const artifactID = await createURLArtifact(server, startURL, "URL In-Page");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(startURL);

      await clickInWebview(app, "#fragment-link");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(fragmentURL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: fragmentURL }],
        cursor: 0,
      });

      await clickInWebview(app, "#push-state");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(pushedURL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: fragmentURL }, { url: pushedURL }],
        cursor: 1,
      });
    } finally {
      await app.close();
    }
  });
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-missing-electron-seam
  test("missing path webview receives current metadata over preload IPC", async () => {
    if (!server) throw new Error("Product server was not started");
    const initialPath = path.join(server.home, "missing-status.html");
    writeFileSync(initialPath, "<!doctype html><h1>Temporary source</h1>");
    const artifactID = await createPathArtifact(server, initialPath, "Initial missing title");
    unlinkSync(initialPath);
    const appURL = await server.appURL(desktopViteBaseURL);
    const missingURL = `${appURL}/artifact/${artifactID}/missing-status.html`;

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => missingWebviewState(app), { timeout: 15_000 }).toMatchObject({
        url: missingURL,
        title: "Initial missing title",
        path: initialPath,
      });
      const initial = await missingWebviewState(app);
      if (!initial) throw new Error("Missing artifact webview did not load");

      await updatePathArtifact(server, artifactID, { title: "Updated missing title" });

      await expect.poll(() => missingWebviewState(app), { timeout: 15_000 }).toEqual({
        id: initial.id,
        url: missingURL,
        title: "Updated missing title",
        path: initialPath,
      });

      await app.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        void contents.loadURL(url).catch(() => {});
      }, `${appURL}/packages/desktop/test/e2e/fixtures/electron-url-nav-start.html`);
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toContain("electron-url-nav-start.html");
      await installHostMessageRecorder(app);

      await updatePathArtifact(server, artifactID, { title: "Retitled while ordinary content is loaded" });

      await expect.poll(() => recordedHostMessageCount(app), { timeout: 5_000 }).toBe(0);
    } finally {
      await app.close();
    }
  });

  test.describe("flaky: markdown artifact webview editing", () => {
    test.describe.configure({ retries: FLAKY_TEST_RETRIES, timeout: 60_000 });

  test("markdown artifact renders in a webview, loads content, and saves edits over IPC", async () => {
    if (!server) throw new Error("Product server was not started");
    const markdownPath = path.join(server.home, "note.md");
    writeFileSync(markdownPath, "# Markdown from disk");
    await createPathArtifact(server, markdownPath, "Markdown");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveCount(0);
      await expect.poll(() => markdownDoc(app), { timeout: 15_000 }).toBe("# Markdown from disk");

      await replaceMarkdownDoc(app, "# Saved through webview");
      await expect.poll(() => readFileSync(markdownPath, "utf8"), { timeout: 15_000 }).toBe("# Saved through webview");
    } finally {
      await app.close();
    }
  });
  });

  test("markdown Cmd/Ctrl-click opens an external link without navigating the webview", async () => {
    if (!server) throw new Error("Product server was not started");
    const external = await startExternalSite();
    externalServer = external.server;
    const markdownPath = path.join(server.home, "linked-note.md");
    writeFileSync(markdownPath, `# Linked note\n\n[External](${external.url})`);
    const artifactID = await createPathArtifact(server, markdownPath, "Markdown Link");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveCount(0);
      await expect.poll(() => markdownDoc(app), { timeout: 15_000 }).toBe(`# Linked note\n\n[External](${external.url})`);
      const linkSelector = `a.cm-md-link[data-href="${external.url}"]`;
      await expect.poll(() => webviewHasSelector(app, linkSelector), { timeout: 15_000 }).toBe(true);
      const initialWebviewURL = await webviewURL(app);
      expect(initialWebviewURL).toContain("/views/markdown/");

      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });
      await expect.poll(async () => {
        const log = await app.evaluate(() => {
          return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
        });
        if (!log.includes(external.url)) await cmdOrCtrlClickInWebview(app, linkSelector);
        return log;
      }, { timeout: 15_000 }).toContain(external.url);

      expect(await webviewURL(app)).toBe(initialWebviewURL);
      expect(await navigationRecord(page, artifactID)).toBeNull();
    } finally {
      await app.close();
    }
  });
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-electron-seam
  test("markdown application links require real user activation and leave navigation unchanged", async () => {
    if (!server) throw new Error("Product server was not started");
    const applicationURL = "example-app://open/from-markdown";
    const markdownPath = path.join(server.home, "application-link.md");
    const markdownContent = `[Open application](${applicationURL})\n\n[Do not run](javascript:document.body.dataset.scriptActivated='true')\n\n[Do not open file](file:///tmp/television-application-link-test)`;
    writeFileSync(markdownPath, markdownContent);
    const artifactID = await createPathArtifact(server, markdownPath, "Markdown Application Link");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => markdownDoc(app), { timeout: 15_000 }).toBe(markdownContent);
      const linkSelector = `a.cm-md-link[data-href="${applicationURL}"]`;
      await expect.poll(() => webviewHasSelector(app, linkSelector), { timeout: 15_000 }).toBe(true);
      const initialURL = await webviewURL(app);
      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });

      await clickInWebview(app, linkSelector);
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([]);

      await realClickInWebview(app, linkSelector);
      await expect.poll(() => app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      }), { timeout: 15_000 }).toEqual([applicationURL]);

      expect(await webviewURL(app)).toBe(initialURL);
      await expect(navigationRecord(page, artifactID)).resolves.toBeNull();

      const scriptSelector = `a.cm-md-link[data-href^="javascript:"]`;
      await expect.poll(() => webviewHasSelector(app, scriptSelector), { timeout: 15_000 }).toBe(true);
      await app.evaluate(async ({ webContents }, selector) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        await contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).addEventListener("click", () => { document.body.dataset.scriptLinkClicked = "true"; })`);
      }, scriptSelector);
      await realClickInWebview(app, scriptSelector);
      await expect.poll(() => app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        return await contents.executeJavaScript("document.body.dataset.scriptLinkClicked ?? null");
      }), { timeout: 15_000 }).toBe("true");
      expect(await app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        return await contents.executeJavaScript("document.body.dataset.scriptActivated ?? null");
      })).toBeNull();
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([applicationURL]);

      const fileSelector = `a.cm-md-link[data-href^="file:"]`;
      await expect.poll(() => webviewHasSelector(app, fileSelector), { timeout: 15_000 }).toBe(true);
      await app.evaluate(async ({ webContents }, selector) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        await contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).addEventListener("click", () => { document.body.dataset.fileLinkClicked = "true"; })`);
      }, fileSelector);
      await realClickInWebview(app, fileSelector);
      await expect.poll(() => app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        return await contents.executeJavaScript("document.body.dataset.fileLinkClicked ?? null");
      }), { timeout: 15_000 }).toBe("true");
      expect(await webviewURL(app)).toBe(initialURL);
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([applicationURL]);
    } finally {
      await app.close();
    }
  });

  // spec: proofs/product/artifact-navigation.md#^ac-application-links-electron
  test("markdown application links cross the real Linux operating-system handler", async () => {
    test.skip(process.platform !== "linux", "temporary protocol-handler fixture uses Linux gio");
    if (!server) throw new Error("Product server was not started");
    const handler = createApplicationProtocolHandler();
    const applicationURL = "example-app://open/from-markdown-real-handler";
    const markdownPath = path.join(server.home, "real-application-link.md");
    writeFileSync(markdownPath, `[Open application](${applicationURL})`);
    const artifactID = await createPathArtifact(server, markdownPath, "Real Markdown Application Link");

    let app: ElectronApplication | null = null;
    try {
      const launched = await launchApp(server, {
        env: { ...handler.env, TV_TEST_MODE: "false" },
      });
      const runningApp = launched.app;
      app = runningApp;
      const page = launched.page;
      await expect(page.locator(".artifact-view webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => markdownDoc(runningApp), { timeout: 15_000 }).toBe(`[Open application](${applicationURL})`);
      const linkSelector = `a.cm-md-link[data-href="${applicationURL}"]`;
      await expect.poll(() => webviewHasSelector(runningApp, linkSelector), { timeout: 15_000 }).toBe(true);
      const initialURL = await webviewURL(runningApp);

      await realClickInWebview(runningApp, linkSelector);
      await realClickInWebview(runningApp, linkSelector, "middle");

      await expect.poll(() => handler.readInvocations(), { timeout: 15_000 }).toEqual([
        applicationURL,
        applicationURL,
      ]);
      expect(await webviewURL(runningApp)).toBe(initialURL);
      await expect(navigationRecord(page, artifactID)).resolves.toBeNull();
      expect(await runningApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    } finally {
      await app?.close();
      handler.dispose();
    }
  });

  test.describe("flaky: quit and relaunch navigation history", () => {
    test.describe.configure({ retries: FLAKY_TEST_RETRIES, timeout: 60_000 });

    // spec: proofs/product/artifact-navigation.md#^ac-persisted
    // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-persist-electron
    test("quit and relaunch restores path webview navigation history", async () => {
      if (!server) throw new Error("Product server was not started");
      const siteDir = path.join(server.home, "restart-site");
      mkdirSync(siteDir, { recursive: true });
      writeFileSync(path.join(siteDir, "page2.html"), "<!doctype html><html><body><h1>Page 2</h1></body></html>");
      writeFileSync(path.join(siteDir, "index.html"), `<!doctype html><html><body>
        <h1>Index</h1>
        <a id="internal-link" href="./page2.html">Page 2</a>
      </body></html>`);
      const artifactID = await createPathArtifact(server, path.join(siteDir, "index.html"), "Restart Site");
      const appURL = await server.appURL(desktopViteBaseURL);
      const startURL = `${appURL}/artifact/${artifactID}/index.html`;
      const page2URL = `${appURL}/artifact/${artifactID}/page2.html`;
      const userDataDir = createUserDataDir("television-navigation-relaunch-e2e-");

      try {
        const firstLaunch = await launchApp(server, { userDataDir });
        try {
          await expect(firstLaunch.page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
          await expect.poll(() => webviewURL(firstLaunch.app), { timeout: 15_000 }).toBe(startURL);
          await clickInWebview(firstLaunch.app, "#internal-link");
          await expect.poll(() => webviewURL(firstLaunch.app), { timeout: 15_000 }).toBe(page2URL);
          await expect.poll(() => navigationRecord(firstLaunch.page, artifactID)).toMatchObject({
            entries: [{ url: `/artifact/${artifactID}/page2.html` }],
            cursor: 0,
          });
        } finally {
          await firstLaunch.app.close();
        }

        const secondLaunch = await launchApp(server, { userDataDir });
        try {
          await expect(secondLaunch.page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
          await expect.poll(() => webviewURL(secondLaunch.app), { timeout: 15_000 }).toBe(page2URL);
          await secondLaunch.page.locator(".artifact-view button[aria-label='Back']").click();
          await expect.poll(() => webviewURL(secondLaunch.app), { timeout: 15_000 }).toBe(startURL);
        } finally {
          await secondLaunch.app.close();
        }
      } finally {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

})
