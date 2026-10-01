import { type ElectronApplication, type Page } from "@playwright/test";
import { FLAKY_TEST_RETRIES } from "../../../../test/flaky-retries.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import path from "node:path";
import { createApplicationProtocolHandler } from "../../../../test/helpers/application-protocol-handler.ts";
import { desktopE2EOrigin, launchDesktop } from "./helpers.ts";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";

type NavigationRecord = { entries: Array<{ url: string }>; cursor: number } | null;

const desktopViteBaseURL = desktopE2EOrigin();

async function launchApp(
  server: ProductServer,
  options: { env?: Record<string, string> } = {},
): Promise<{ app: ElectronApplication; page: Page; appURL: string }> {
  const appURL = await server.appURL(desktopViteBaseURL);
  // desktopAppVersion sits above any published requirement: the product
  // server is a STAMPED build whose baked REQUIRED_DESKTOP_VERSION can name
  // the next release (desktop-upgrade-gate.md ^ops-first-gate), and an
  // electron-mode page declaring no shell version would — correctly — halt
  // at the upgrade gate instead of booting the artifact UI under test.
  const { app, page } = await launchDesktop({
    fixture: `${appURL}/packages/web/src/index.html?mode=electron&desktopAppVersion=9.9.9&serverURL=${encodeURIComponent(appURL)}`,
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

async function webviewText(app: ElectronApplication, selector: string): Promise<string | null> {
  return await app.evaluate(async ({ webContents }, targetSelector) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript(`document.querySelector(${JSON.stringify(targetSelector)})?.textContent ?? null`);
  }, selector);
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

  test("path artifact renders in a webview, records internal navigation, supports back, and routes Cmd/Ctrl-click externally", async () => {
    if (!server) throw new Error("Product server was not started");
    const siteDir = path.join(server.home, "site");
    const external = await startExternalSite();
    externalServer = external.server;
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(path.join(siteDir, "page2.html"), "<!doctype html><html><body><h1>Page 2</h1></body></html>");
    writeFileSync(path.join(siteDir, "index.html"), `<!doctype html><html><body>
      <a id="internal-link" href="./page2.html">Page 2</a>
      <a id="external-link" href="${external.url}" target="_blank">External</a>
    </body></html>`);
    const artifactID = await createPathArtifact(server, path.join(siteDir, "index.html"));
    const appURL = await server.appURL(desktopViteBaseURL);
    const startURL = `${appURL}/artifact/${artifactID}/index.html`;
    const page2Path = `/artifact/${artifactID}/page2.html`;
    const page2URL = `${appURL}${page2Path}`;

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveCount(0);
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(startURL);

      await clickInWebview(app, "#internal-link");
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(page2URL);
      await expect.poll(() => navigationRecord(page, artifactID)).toMatchObject({
        entries: [{ url: page2Path }],
        cursor: 0,
      });

      await page.locator(".artifact-view button[aria-label='Back']").click();
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(startURL);

      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });
      await expect.poll(async () => {
        const log = await app.evaluate(() => {
          return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
        });
        if (!log.includes(external.url)) await cmdOrCtrlClickInWebview(app, "#external-link");
        return log;
      }, { timeout: 15_000 }).toContain(external.url);
      expect(await webviewURL(app)).toBe(startURL);
    } finally {
      await app.close();
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-electron-seam
  test("local HTML application handoff requires activation and preserves subframes", async () => {
    if (!server) throw new Error("Product server was not started");
    const filePath = path.join(server.home, "application-link.html");
    const applicationURL = "example-app://open/from-html";
    const scriptedApplicationURL = "example-app://open/from-html-script";
    writeFileSync(filePath, `<!doctype html><html><body>
      <a id="application-link" href="${applicationURL}">Open application</a>
      <button id="scripted-application-link">Open application from script</button>
      <a id="script-link" href="javascript:void(document.body.dataset.scriptActivated='true')">Run local script</a>
      <a id="file-link" href="file:///tmp/television-application-link-test">Local file</a>
      <a id="blob-download" download="artifact.csv">Download CSV</a>
      <iframe id="srcdoc-frame" srcdoc="<p id='nested-content'>Nested frame</p>"></iframe>
      <script>
        document.querySelector("#blob-download").href = URL.createObjectURL(
          new Blob(["name,value\\ntelevision,1\\n"], { type: "text/csv" }),
        );
        document.querySelector("#scripted-application-link").addEventListener("click", () => {
          window.__televisionContentBridge.openApplicationLink(${JSON.stringify(scriptedApplicationURL)});
        });
      </script>
    </body></html>`);
    const artifactID = await createPathArtifact(server, filePath, "Application Link");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toContain(`/artifact/${artifactID}/`);
      const initialURL = await webviewURL(app);
      await expect.poll(() => app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        return await contents.executeJavaScript(
          `document.querySelector("#srcdoc-frame")?.contentDocument?.querySelector("#nested-content")?.textContent ?? null`,
        );
      }), { timeout: 15_000 }).toBe("Nested frame");
      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });

      await clickInWebview(app, "#application-link");
      await app.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        await contents.executeJavaScript(`window.open(${JSON.stringify(url)}, "_blank")`);
        await contents.executeJavaScript(`window.location.href = ${JSON.stringify(url)}`).catch(() => undefined);
      }, applicationURL);
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([]);
      expect(await webviewURL(app)).toBe(initialURL);

      await realClickInWebview(app, "#application-link");
      await realClickInWebview(app, "#scripted-application-link");
      await realClickInWebview(app, "#application-link", "middle");
      await expect.poll(() => app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      }), { timeout: 15_000 }).toEqual([
        applicationURL,
        scriptedApplicationURL,
        applicationURL,
      ]);

      expect(await webviewURL(app)).toBe(initialURL);
      expect((await navigationRecord(page, artifactID))?.entries ?? []).toEqual([]);

      await realClickInWebview(app, "#script-link");
      await expect.poll(() => app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        return await contents.executeJavaScript("document.body.dataset.scriptActivated ?? null");
      }), { timeout: 15_000 }).toBe("true");
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([applicationURL, scriptedApplicationURL, applicationURL]);

      await app.evaluate(({ session }) => {
        const main = globalThis as typeof globalThis & {
          __televisionDownloadLog?: Array<{ filename: string; url: string }>;
        };
        main.__televisionDownloadLog = [];
        session.defaultSession.once("will-download", (event, item) => {
          main.__televisionDownloadLog?.push({
            filename: item.getFilename(),
            url: item.getURL(),
          });
          event.preventDefault();
        });
      });
      await realClickInWebview(app, "#blob-download");
      await expect.poll(() => app.evaluate(() => {
        return (globalThis as typeof globalThis & {
          __televisionDownloadLog?: Array<{ filename: string; url: string }>;
        }).__televisionDownloadLog ?? [];
      }), { timeout: 15_000 }).toEqual([{
        filename: "artifact.csv",
        url: expect.stringMatching(/^blob:/),
      }]);
      expect(await webviewURL(app)).toBe(initialURL);

      await app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        await contents.executeJavaScript(`document.querySelector("#file-link").addEventListener("click", () => { document.body.dataset.fileClicked = "true"; })`);
      });
      await realClickInWebview(app, "#file-link");
      await expect.poll(() => app.evaluate(async ({ webContents }) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
        if (!contents) throw new Error("No webview found");
        return await contents.executeJavaScript("document.body.dataset.fileClicked ?? null");
      }), { timeout: 15_000 }).toBe("true");
      expect(await webviewURL(app)).toBe(initialURL);
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([applicationURL, scriptedApplicationURL, applicationURL]);
    } finally {
      await app.close();
    }
  });

  // spec: proofs/product/artifact-navigation.md#^ac-application-links-electron
  test("HTML application links cross the real Linux operating-system handler", async () => {
    test.skip(process.platform !== "linux", "temporary protocol-handler fixture uses Linux gio");
    if (!server) throw new Error("Product server was not started");
    const handler = createApplicationProtocolHandler();
    const filePath = path.join(server.home, "real-application-link.html");
    const applicationURL = "example-app://open/from-html-real-handler";
    writeFileSync(filePath, `<!doctype html><html><body>
      <a id="application-link" href="${applicationURL}">Open application</a>
    </body></html>`);
    const artifactID = await createPathArtifact(server, filePath, "Real Application Link");

    let app: ElectronApplication | null = null;
    try {
      const launched = await launchApp(server, {
        env: { ...handler.env, TV_TEST_MODE: "false" },
      });
      const runningApp = launched.app;
      app = runningApp;
      const page = launched.page;
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewURL(runningApp), { timeout: 15_000 }).toContain(`/artifact/${artifactID}/`);
      const initialURL = await webviewURL(runningApp);

      await realClickInWebview(runningApp, "#application-link");
      await realClickInWebview(runningApp, "#application-link", "middle");

      await expect.poll(() => handler.readInvocations(), { timeout: 15_000 }).toEqual([
        applicationURL,
        applicationURL,
      ]);
      expect(await webviewURL(runningApp)).toBe(initialURL);
      expect((await navigationRecord(page, artifactID))?.entries ?? []).toEqual([]);
      expect(await runningApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    } finally {
      await app?.close();
      handler.dispose();
    }
  });

  test.describe("flaky: URL artifact canonical load", () => {
    test.describe.configure({ retries: FLAKY_TEST_RETRIES, timeout: 60_000 });

  test("URL artifact canonical load uses the real product server and Electron webview", async () => {
    if (!server) throw new Error("Product server was not started");
    const site = await startURLSite({
      "/start.html": "<!doctype html><html><body><h1>URL Start</h1></body></html>",
    });
    externalServer = site.server;
    const startURL = `${site.baseURL}/start.html`;
    await createURLArtifact(server, startURL, "URL Start");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveCount(0);
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(startURL);
      await expect.poll(() => webviewText(app, "h1"), { timeout: 15_000 }).toBe("URL Start");
    } finally {
      await app.close();
    }
  });
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-electron-seam
  test("third-party URL artifacts cannot request application handoff", async () => {
    if (!server) throw new Error("Product server was not started");
    const anchorURL = "example-app://open/from-third-party-anchor";
    const scriptedURL = "example-app://open/from-third-party-script";
    const site = await startURLSite({
      "/start.html": `<!doctype html><html><body>
        <a id="application-link" href="${anchorURL}">Open application</a>
        <button id="scripted-application-link">Open application from script</button>
        <script>
          document.querySelector("#scripted-application-link").addEventListener("click", () => {
            window.__televisionContentBridge.openApplicationLink(${JSON.stringify(scriptedURL)});
          });
        </script>
      </body></html>`,
    });
    externalServer = site.server;
    const startURL = `${site.baseURL}/start.html`;
    await createURLArtifact(server, startURL, "Untrusted application links");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(startURL);
      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });

      await realClickInWebview(app, "#application-link");
      await realClickInWebview(app, "#scripted-application-link");

      await page.waitForTimeout(250);
      expect(await app.evaluate(() => {
        return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
      })).toEqual([]);
      expect(await webviewURL(app)).toBe(startURL);
    } finally {
      await app.close();
    }
  });

  test("URL artifact Cmd/Ctrl-click opens externally without changing webview history", async () => {
    if (!server) throw new Error("Product server was not started");
    const site = await startURLSite({
      "/start.html": `<!doctype html><html><body>
        <h1>URL Start</h1>
        <a id="external-link" href="https://example.com/from-url-artifact" target="_blank">External</a>
      </body></html>`,
    });
    externalServer = site.server;
    const startURL = `${site.baseURL}/start.html`;
    const externalURL = "https://example.com/from-url-artifact";
    const artifactID = await createURLArtifact(server, startURL, "URL External");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewURL(app), { timeout: 15_000 }).toBe(startURL);
      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });

      await expect.poll(async () => {
        const log = await app.evaluate(() => {
          return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
        });
        if (!log.includes(externalURL)) await cmdOrCtrlClickInWebview(app, "#external-link");
        return log;
      }, { timeout: 15_000 }).toContain(externalURL);

      expect(await webviewURL(app)).toBe(startURL);
      expect((await navigationRecord(page, artifactID))?.entries ?? []).toEqual([]);
    } finally {
      await app.close();
    }
  });
})
