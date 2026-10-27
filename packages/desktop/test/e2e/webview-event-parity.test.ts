import { type ElectronApplication, type Page } from "@playwright/test";
import { FLAKY_TEST_RETRIES } from "../../../../test/flaky-retries.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import {
  createUserDataDir,
  desktopE2EOrigin,
  desktopE2EURL,
  expectConnectedPage,
  launchDesktop,
  launchDesktopConnectScreen,
} from "./helpers.ts";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { appURLForServer, launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";

const desktopViteBaseURL = desktopE2EOrigin();
const APPEARANCE_LIGHT = "rgb(1, 2, 3)";
const APPEARANCE_DARK = "rgb(4, 5, 6)";
const APPEARANCE_THEME_CSS = `[data-theme="light"] .electron-appearance-probe { color: ${APPEARANCE_LIGHT}; }
[data-theme="dark"] .electron-appearance-probe { color: ${APPEARANCE_DARK}; }
`;

async function launchApp(
  server: ProductServer,
  userDataDir?: string,
): Promise<{ app: ElectronApplication; page: Page; appURL: string }> {
  const appURL = await server.appURL(desktopViteBaseURL);
  // desktopAppVersion sits above any published requirement: the product
  // server is a STAMPED build whose baked REQUIRED_DESKTOP_VERSION can name
  // the next release (desktop-upgrade-gate.md ^ops-first-gate), and an
  // electron-mode page declaring no shell version would — correctly — halt
  // at the upgrade gate instead of booting the artifact UI under test.
  const { app, page } = await launchDesktop({
    fixture: `${appURL}/packages/web/src/index.html?mode=electron&desktopAppVersion=9.9.9`,
    ...(userDataDir === undefined ? {} : { userDataDir }),
  });
  return { app, page, appURL };
}

async function defaultChannelID(server: ProductServer): Promise<string> {
  const response = await fetch(`${server.serverURL}/channels`);
  expect(response.status).toBe(200);
  const { channels } = (await response.json()) as { channels: Array<{ id: string }> };
  const channelID = channels[0]?.id;
  if (!channelID) throw new Error("Product server did not create a default channel");
  return channelID;
}

async function createPathArtifact(server: ProductServer, filePath: string, title = "Path Artifact"): Promise<string> {
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

async function markdownDoc(app: ElectronApplication): Promise<string> {
  return await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript("window.__cmView?.state.doc.toString() ?? null");
  });
}

async function webviewStyle(app: ElectronApplication, selector: string, property: string): Promise<string | null> {
  return await app.evaluate(async ({ webContents }, args) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === "webview");
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(args.selector)});
      return element ? getComputedStyle(element).getPropertyValue(${JSON.stringify(args.property)}) : null;
    })()`);
  }, { selector, property });
}

async function webviewExecutableThemeRan(app: ElectronApplication): Promise<boolean> {
  return await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find(
      (candidate) => candidate.getType() === "webview",
    );
    if (!contents) throw new Error("No webview found");
    return await contents.executeJavaScript(
      'typeof window.__electronExecutableTheme !== "undefined" || ' +
      'typeof window.__electronThemeFrame !== "undefined"',
    );
  });
}

async function electronThemeFrameInstance(
  page: Page,
  kind: "background" | "overlay",
): Promise<string | null> {
  const selector = kind === "background"
    ? "#theme-iframe-background"
    : "#theme-iframe-overlay";
  const host = page.locator(selector);
  if (await host.count() === 0) return null;
  return await host.contentFrame().locator("html").getAttribute(
    "data-electron-theme-frame-instance",
  );
}

async function expectElectronThemeFrames(page: Page): Promise<[string, string]> {
  let instances: [string | null, string | null] = [null, null];
  await expect.poll(async () => {
    instances = [
      await electronThemeFrameInstance(page, "background"),
      await electronThemeFrameInstance(page, "overlay"),
    ];
    return instances;
  }).toEqual([expect.any(String), expect.any(String)]);
  return instances as [string, string];
}

interface ElectronThemePointerMessage {
  type: string;
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
}

async function electronThemePointerRecords(
  page: Page,
  kind: "background" | "overlay",
): Promise<ElectronThemePointerMessage[]> {
  const selector = kind === "background"
    ? "#theme-iframe-background"
    : "#theme-iframe-overlay";
  return await page.locator(selector).contentFrame().locator("html").evaluate(() =>
    (window as Window & { __electronThemePointerMessages?: ElectronThemePointerMessage[] })
      .__electronThemePointerMessages ?? []
  );
}

async function clearElectronThemePointerRecords(page: Page): Promise<void> {
  await Promise.all((["background", "overlay"] as const).map(async (kind) => {
    const selector = kind === "background"
      ? "#theme-iframe-background"
      : "#theme-iframe-overlay";
    await page.locator(selector).contentFrame().locator("html").evaluate(() => {
      (window as Window & { __electronThemePointerMessages?: ElectronThemePointerMessage[] })
        .__electronThemePointerMessages = [];
    });
  }));
}

async function rendererExposure(page: Page): Promise<{
  requireType: string;
  processType: string;
  moduleType: string;
  bridgeKeys: string[];
}> {
  return await page.evaluate(() => {
    const renderer = window as Window & {
      require?: unknown;
      process?: unknown;
      module?: unknown;
      __televisionNativeBridge?: object;
    };
    return {
      requireType: typeof renderer.require,
      processType: typeof renderer.process,
      moduleType: typeof renderer.module,
      bridgeKeys: Object.keys(renderer.__televisionNativeBridge ?? {}).sort(),
    };
  });
}

async function rendererThemeState(page: Page): Promise<{
  activeThemeName: string | null;
  themeJavaScriptConsentIds: string[];
} | undefined> {
  return await page.evaluate(() => {
    const service = (window as Window & {
      __telepath?: {
        applicationService?: {
          snapshot: {
            display: {
              activeThemeName: string | null;
              themeJavaScriptConsentIds: string[];
            };
          };
        };
      };
    }).__telepath?.applicationService;
    return service?.snapshot.display;
  });
}

async function patchDisplay(
  serverURL: string,
  patch: Record<string, unknown>,
  token?: string,
): Promise<void> {
  const response = await fetch(`${serverURL}/display`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(204);
}

async function activateTheme(serverURL: string, themeName: string, token?: string): Promise<void> {
  await patchDisplay(serverURL, { activeThemeName: themeName }, token);
}

async function nativeAppearance(app: ElectronApplication): Promise<{
  themeSource: string;
  shouldUseDarkColors: boolean;
}> {
  return await app.evaluate(({ nativeTheme }) => ({
    themeSource: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  }));
}

async function webviewAppearance(
  app: ElectronApplication,
  urlFragment: string,
): Promise<{
  currentDark: boolean;
  dataTheme: string | null;
  probeColor: string;
  loadID: string;
}> {
  return await app.evaluate(async ({ webContents }, expectedURLFragment) => {
    const contents = webContents.getAllWebContents().find(
      (candidate) => candidate.getType() === "webview" &&
        candidate.getURL().includes(expectedURLFragment),
    );
    if (!contents) throw new Error(`No webview found for ${expectedURLFragment}`);
    return await contents.executeJavaScript(`({
      currentDark: matchMedia("(prefers-color-scheme: dark)").matches,
      dataTheme: document.documentElement.dataset.theme ?? null,
      probeColor: getComputedStyle(document.querySelector("#appearance-probe")).color,
      loadID: window.__loadID,
    })`);
  }, urlFragment);
}

async function applicationAppearance(page: Page): Promise<{
  currentDark: boolean;
  dataTheme: string | null;
  probeColor: string;
  loadID: string;
}> {
  return await page.evaluate(() => ({
    currentDark: matchMedia("(prefers-color-scheme: dark)").matches,
    dataTheme: document.documentElement.dataset.theme ?? null,
    probeColor: getComputedStyle(document.querySelector("#appearance-probe")!).color,
    loadID: (window as Window & { __electronAppearanceLoadID?: string })
      .__electronAppearanceLoadID ?? "",
  }));
}

async function startAppearanceURLProbe(): Promise<{
  server: HTTPServer;
  url: string;
}> {
  const server = createHTTPServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><style>
      #appearance-probe { color: ${APPEARANCE_LIGHT}; }
      @media (prefers-color-scheme: dark) {
        #appearance-probe { color: ${APPEARANCE_DARK}; }
      }
    </style><script>window.__loadID = crypto.randomUUID();</script></head>
    <body><main id="appearance-probe">Third-party appearance probe</main></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Appearance URL probe did not bind a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/appearance.html` };
}

async function closeHTTPServer(server: HTTPServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function createDataDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}


test.describe("Electron webview parity for server events", () => {

  let server: ProductServer | null;

  test.beforeEach(async () => {
    server = await launchProductServer();
  });

  test.afterEach(async () => {
    await server?.dispose();
    server = null;
  });

  test.describe("flaky: markdown webview file change", () => {
    test.describe.configure({ retries: FLAKY_TEST_RETRIES, timeout: 60_000 });

  test("updates a markdown webview when the backing file changes on disk", async () => {
    if (!server) throw new Error("Product server was not started");
    const markdownPath = path.join(server.home, "note.md");
    writeFileSync(markdownPath, "# Before from disk", "utf8");
    await createPathArtifact(server, markdownPath, "Markdown");

    const { app, page } = await launchApp(server);
    try {
      await expect(page.locator(".artifact-view webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => markdownDoc(app), { timeout: 15_000 }).toBe("# Before from disk");

      writeFileSync(markdownPath, "# After from disk", "utf8");

      await expect.poll(() => markdownDoc(app), { timeout: 15_000 }).toBe("# After from disk");
    } finally {
      await app.close();
    }
  });
  });

  // proofs/arch/desktop/appearance.md#^desktop-appearance-t-electron
  // proofs/product/themes-and-appearance.md#^theme-ac-appearance-electron
  test("applies manifest-resolved appearance to Electron and retained webviews", async () => {
    const storagePath = createDataDir("television-electron-appearance-");
    const canonicalDir = createDataDir("television-electron-appearance-canonical-");
    const canonicalVersionDir = path.join(canonicalDir, "v2");
    mkdirSync(canonicalVersionDir);
    writeFileSync(path.join(canonicalVersionDir, "styles.css"), ":root {}\n", "utf8");
    const store = createServingStore(storagePath);
    seedThemePackage(storagePath, "electron-adaptive", APPEARANCE_THEME_CSS, {
      name: "Electron adaptive",
      colorScheme: "light dark",
    });
    seedThemePackage(storagePath, "electron-fixed-dark", APPEARANCE_THEME_CSS, {
      name: "Electron fixed dark",
      colorScheme: "dark",
    });
    store.refreshThemeRegistry();
    const directServer = new Server({ store, port: 0, canonicalDir });
    let app: ElectronApplication | null = null;
    let urlProbe: Awaited<ReturnType<typeof startAppearanceURLProbe>> | null = null;
    try {
      await directServer.start();
      urlProbe = await startAppearanceURLProbe();
      const serverURL = directServer.getBaseURL();
      const token = directServer.getAuthToken();
      const artifactPath = path.join(storagePath, "appearance-probe.html");
      writeFileSync(
        artifactPath,
        `<!doctype html><html><head>
          <link rel="stylesheet" href="/canonical/v2/styles.css">
          <script>window.__loadID = crypto.randomUUID();</script>
        </head><body><main id="appearance-probe" class="electron-appearance-probe">Managed appearance probe</main></body></html>`,
        "utf8",
      );
      const channelID = store.listChannels()[0]!.id;
      await patchDisplay(serverURL, {
        activeThemeName: "electron-adaptive",
        appearanceMode: "dark",
      }, token);

      const launched = await launchDesktop({
        fixture: `${await appURLForServer(serverURL, desktopE2EOrigin())}/packages/web/src/index.html?mode=electron&token=${token}`,
      });
      app = launched.app;
      await expect.poll(() => nativeAppearance(launched.app)).toMatchObject({
        themeSource: "dark",
        shouldUseDarkColors: true,
      });
      await launched.page.evaluate(() => {
        (window as Window & { __electronAppearanceLoadID?: string })
          .__electronAppearanceLoadID = crypto.randomUUID();
        const probe = document.createElement("div");
        probe.id = "appearance-probe";
        probe.className = "electron-appearance-probe";
        probe.textContent = "Application appearance probe";
        document.documentElement.append(probe);
      });

      // Create the first artifacts only after main has applied the connected
      // display input, proving assignment precedes webview attachment.
      const managedArtifact = store.createArtifact({
        kind: "path",
        title: "Managed appearance probe",
        path: artifactPath,
        channelID,
      });
      store.createArtifact({
        kind: "url",
        title: "Third-party appearance probe",
        url: urlProbe.url,
        channelID,
      });
      await expect(launched.page.locator(
        ".artifact-view webview.artifact-content",
      )).toHaveCount(2, { timeout: 15_000 });

      const managedURLFragment = `/artifact/${managedArtifact.id}/`;
      const expectAppearance = async (
        source: "system" | "light" | "dark",
        dark: boolean,
        loadIDs?: { app: string; managed: string; url: string },
      ): Promise<void> => {
        const appearance = dark ? "dark" : "light";
        const probeColor = dark ? APPEARANCE_DARK : APPEARANCE_LIGHT;
        await expect(async () => {
          expect({
            native: await nativeAppearance(launched.app),
            application: await applicationAppearance(launched.page),
            managed: await webviewAppearance(launched.app, managedURLFragment),
            url: await webviewAppearance(launched.app, urlProbe!.url),
          }).toMatchObject({
            native: { themeSource: source, shouldUseDarkColors: dark },
            application: {
              currentDark: dark,
              dataTheme: appearance,
              probeColor,
              ...(loadIDs ? { loadID: loadIDs.app } : { loadID: expect.any(String) }),
            },
            managed: {
              currentDark: dark,
              dataTheme: appearance,
              probeColor,
              ...(loadIDs ? { loadID: loadIDs.managed } : { loadID: expect.any(String) }),
            },
            url: {
              currentDark: dark,
              dataTheme: null,
              probeColor,
              ...(loadIDs ? { loadID: loadIDs.url } : { loadID: expect.any(String) }),
            },
          });
        }).toPass({ timeout: 15_000 });
      };

      await expectAppearance("dark", true);
      const initialLoadIDs = {
        app: (await applicationAppearance(launched.page)).loadID,
        managed: (await webviewAppearance(launched.app, managedURLFragment)).loadID,
        url: (await webviewAppearance(launched.app, urlProbe.url)).loadID,
      };

      await patchDisplay(serverURL, { appearanceMode: "system" }, token);
      await expect.poll(() => nativeAppearance(launched.app)).toMatchObject({
        themeSource: "system",
      });
      const systemDark = (await nativeAppearance(launched.app)).shouldUseDarkColors;
      await expectAppearance("system", systemDark, initialLoadIDs);

      await patchDisplay(serverURL, { appearanceMode: "light" }, token);
      await expectAppearance("light", false, initialLoadIDs);
      await patchDisplay(serverURL, { appearanceMode: "dark" }, token);
      await expectAppearance("dark", true, initialLoadIDs);

      await activateTheme(serverURL, "electron-fixed-dark", token);
      await expect(async () => {
        const appearance = await webviewAppearance(launched.app, managedURLFragment);
        expect(appearance.loadID).toEqual(expect.any(String));
        expect(appearance.loadID).not.toBe(initialLoadIDs.managed);
      }).toPass({ timeout: 15_000 });
      const fixedLoadIDs = {
        app: initialLoadIDs.app,
        managed: (await webviewAppearance(launched.app, managedURLFragment)).loadID,
        url: initialLoadIDs.url,
      };
      await expectAppearance("dark", true, fixedLoadIDs);

      await patchDisplay(serverURL, { appearanceMode: "light" }, token);
      await expectAppearance("dark", true, fixedLoadIDs);
      const displayResponse = await fetch(`${serverURL}/display`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(displayResponse.status).toBe(200);
      await expect(displayResponse.json()).resolves.toMatchObject({
        activeThemeName: "electron-fixed-dark",
        activeThemeColorScheme: "dark",
        appearanceMode: "light",
      });

      await activateTheme(serverURL, "electron-adaptive", token);
      await expect(async () => {
        const appearance = await webviewAppearance(launched.app, managedURLFragment);
        expect(appearance.loadID).toEqual(expect.any(String));
        expect(appearance.loadID).not.toBe(fixedLoadIDs.managed);
      }).toPass({ timeout: 15_000 });
      const adaptiveLoadIDs = {
        app: initialLoadIDs.app,
        managed: (await webviewAppearance(launched.app, managedURLFragment)).loadID,
        url: initialLoadIDs.url,
      };
      await expectAppearance("light", false, adaptiveLoadIDs);
    } finally {
      await app?.close();
      if (urlProbe) await closeHTTPServer(urlProbe.server);
      await directServer.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(canonicalDir, { recursive: true, force: true });
    }
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-app-link-electron-startup
  // proofs/product/themes-and-appearance.md#^theme-ac-selection-electron
  test("renders the persisted app theme after quitting and relaunching", async () => {
    if (!server) throw new Error("Product server was not started");
    const themeColor = "rgb(12, 34, 56)";
    seedThemePackage(
      server.home,
      "persisted-theme",
      `:root[data-television-document="app"] .app-main { background-color: ${themeColor}; }\n`,
    );
    const refreshResponse = await fetch(`${server.serverURL}/themes/refresh`, {
      method: "POST",
    });
    expect(refreshResponse.status).toBe(200);

    const userDataDir = createUserDataDir("television-theme-relaunch-e2e-");
    let launched = await launchDesktop({
      connectTo: { serverURL: server.serverURL, token: server.token },
      userDataDir,
    });
    try {
      await expectConnectedPage(launched.page);
      await activateTheme(server.serverURL, "persisted-theme");
      await expect(launched.page.locator(".app-main")).toHaveCSS(
        "background-color",
        themeColor,
      );
      await launched.app.close();

      launched = await launchDesktopConnectScreen({ userDataDir });
      await expectConnectedPage(launched.page);
      await expect(launched.page.locator(".app-main")).toHaveCSS(
        "background-color",
        themeColor,
      );
    } finally {
      await launched.app.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  // proofs/product/themes-and-appearance.md#^theme-ac-executable-electron
  test("executes an executable theme in Electron and resets on remote consent and selection changes", async () => {
    if (!server) throw new Error("Product server was not started");
    seedThemePackage(server.home, "electron-executable", ":root {}\n", {
      name: "Electron executable",
      enableMainJS: true,
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
      mainJS: `(() => {
  window.__electronExecutableTheme = {
    runtimeReady: Boolean(window.__telepath?.applicationService),
    requireType: typeof require,
    processType: typeof process,
    moduleType: typeof module,
  };
  const overlay = document.createElement("div");
  overlay.dataset.electronExecutableOverlay = "active";
  document.body.append(overlay);
})();\n`,
      iframeBackgroundJS: `window.__electronThemeFrame = "background";
document.documentElement.dataset.electronThemeFrameInstance = crypto.randomUUID();
window.__electronThemePointerMessages = [];
window.addEventListener("message", (event) => {
  if (event.source === parent && String(event.data?.type).startsWith("television-theme-pointer-")) {
    window.__electronThemePointerMessages.push(event.data);
  }
});\n`,
      iframeOverlayJS: `window.__electronThemeFrame = "overlay";
document.documentElement.dataset.electronThemeFrameInstance = crypto.randomUUID();
window.__electronThemePointerMessages = [];
window.addEventListener("message", (event) => {
  if (event.source === parent && String(event.data?.type).startsWith("television-theme-pointer-")) {
    window.__electronThemePointerMessages.push(event.data);
  }
});\n`,
    });
    seedThemePackage(server.home, "electron-other", ":root {}\n", {
      name: "Electron other",
    });
    const refresh = await fetch(`${server.serverURL}/themes/refresh`, { method: "POST" });
    expect(refresh.status).toBe(200);

    const artifactPath = path.join(server.home, "electron-executable-artifact.html");
    writeFileSync(
      artifactPath,
      `<!doctype html><html><body>
<button id="artifact-probe" type="button">Artifact</button>
<script>
document.querySelector("#artifact-probe").addEventListener("click", () => {
  document.documentElement.dataset.artifactClicks = String(
    Number(document.documentElement.dataset.artifactClicks ?? "0") + 1
  );
});
</script>
</body></html>`,
      "utf8",
    );
    await createPathArtifact(server, artifactPath, "Executable Theme Artifact");

    const userDataDir = createUserDataDir("television-executable-theme-e2e-");
    let launched = await launchApp(server, userDataDir);
    const expectApplicationReset = async (
      action: () => Promise<void>,
    ): Promise<void> => {
      const marker = `electron-reset-${Date.now()}`;
      await launched.page.evaluate((value) => {
        (window as Window & { __electronDocumentMarker?: string })
          .__electronDocumentMarker = value;
      }, marker);
      const documentRequest = launched.page.waitForRequest((request) =>
        request.resourceType() === "document" &&
        request.frame() === launched.page.mainFrame()
      );
      await action();
      await documentRequest;
      await expectConnectedPage(launched.page);
      await expect.poll(() => launched.page.evaluate((value) =>
        (window as Window & { __electronDocumentMarker?: string })
          .__electronDocumentMarker !== value,
      marker).catch(() => false)).toBe(true);
    };

    try {
      await expect(launched.page.locator(
        ".artifact-view webview.artifact-content",
      )).toBeVisible({ timeout: 15_000 });
      const before = await rendererExposure(launched.page);
      expect(await webviewExecutableThemeRan(launched.app)).toBe(false);
      await expect(launched.page.locator(
        'script[data-television-script="television-active-theme"]',
      )).toHaveCount(0);
      await expect(launched.page.locator("#theme-iframe-background")).toHaveCount(0);
      await expect(launched.page.locator("#theme-iframe-overlay")).toHaveCount(0);

      await launched.page.getByRole("button", { name: "Settings" }).click();
      await expect(launched.page.locator("#settings-popover[open]"))
        .toBeVisible();
      const theme = launched.page.locator('tv-select[name="theme"]');
      await expect(theme.locator("tv-option")).toContainText([
        "None",
        "Electron executable",
        "Electron other",
      ]);
      await launched.page.locator("#settings-theme").click();
      await theme.locator('tv-option[value="electron-executable"]').click();
      await expect(theme).toHaveJSProperty("value", "electron-executable");
      await expect(launched.page.locator(
        'script[data-television-script="television-active-theme"]',
      )).toHaveCount(0);
      const preConsentFrameInstances = await expectElectronThemeFrames(launched.page);
      expect(preConsentFrameInstances).toEqual([expect.any(String), expect.any(String)]);
      expect(await webviewExecutableThemeRan(launched.app)).toBe(false);

      // proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-pointer-electron
      await clearElectronThemePointerRecords(launched.page);
      const artifactPointer = await launched.app.evaluate(async ({ webContents }) => {
        const guest = webContents.getAllWebContents().find(
          (candidate) => candidate.getType() === "webview",
        );
        if (!guest) throw new Error("No artifact webview found");
        const point = await guest.executeJavaScript(`(() => {
          const rect = document.querySelector("#artifact-probe")?.getBoundingClientRect();
          if (!rect) return null;
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        })()`);
        if (!point) throw new Error("Artifact pointer probe did not load");
        guest.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
        guest.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
        guest.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
        return point as { x: number; y: number };
      });
      const artifactFrameGeometry = await launched.page.locator(
        ".artifact-view webview.artifact-content",
      ).evaluate((frame) => {
        const rect = frame.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          clientWidth: frame.clientWidth,
          clientHeight: frame.clientHeight,
        };
      });
      const applicationPointer = {
        x: artifactFrameGeometry.left +
          artifactPointer.x * artifactFrameGeometry.width / artifactFrameGeometry.clientWidth,
        y: artifactFrameGeometry.top +
          artifactPointer.y * artifactFrameGeometry.height / artifactFrameGeometry.clientHeight,
      };
      const expectedPointerRecords = [
        { type: "television-theme-pointer-move", clientX: applicationPointer.x, clientY: applicationPointer.y, button: -1, buttons: 0 },
        { type: "television-theme-pointer-down", clientX: applicationPointer.x, clientY: applicationPointer.y, button: 0, buttons: 1 },
        { type: "television-theme-pointer-up", clientX: applicationPointer.x, clientY: applicationPointer.y, button: 0, buttons: 0 },
        { type: "television-theme-pointer-click", clientX: applicationPointer.x, clientY: applicationPointer.y, button: 0, buttons: 0 },
      ];
      await expect.poll(() => electronThemePointerRecords(launched.page, "background"))
        .toEqual(expectedPointerRecords);
      expect(await electronThemePointerRecords(launched.page, "overlay"))
        .toEqual(expectedPointerRecords);
      await expect.poll(() => launched.app.evaluate(async ({ webContents }) => {
        const guest = webContents.getAllWebContents().find(
          (candidate) => candidate.getType() === "webview",
        );
        if (!guest) return null;
        return await guest.executeJavaScript(
          'document.documentElement.dataset.artifactClicks ?? null',
        );
      })).toBe("1");

      const consent = launched.page.getByRole("switch", {
        name: "Enable experimental javascript for this theme",
      });
      await expect(consent).not.toBeChecked();
      await consent.click();
      await expect.poll(() => launched.page.evaluate(() =>
        (window as Window & {
          __electronExecutableTheme?: { runtimeReady: boolean };
        }).__electronExecutableTheme?.runtimeReady
      )).toBe(true);

      const scriptState = await launched.page.evaluate(() => {
        const state = (window as Window & {
          __electronExecutableTheme?: {
            runtimeReady: boolean;
            requireType: string;
            processType: string;
            moduleType: string;
          };
        }).__electronExecutableTheme;
        if (state === undefined) throw new Error("Executable theme did not run");
        return state;
      });
      expect(scriptState).toEqual({
        runtimeReady: true,
        requireType: before.requireType,
        processType: before.processType,
        moduleType: before.moduleType,
      });
      expect(await rendererExposure(launched.page)).toEqual(before);
      await expect.poll(() => webviewExecutableThemeRan(launched.app)).toBe(false);

      await launched.app.close();
      launched = await launchApp(server, userDataDir);
      await expectConnectedPage(launched.page);
      await expect.poll(() => launched.page.evaluate(() =>
        (window as Window & {
          __electronExecutableTheme?: { runtimeReady: boolean };
        }).__electronExecutableTheme?.runtimeReady
      )).toBe(true);
      expect(await rendererExposure(launched.page)).toEqual(before);
      await expect.poll(() => webviewExecutableThemeRan(launched.app)).toBe(false);
      let frameInstances = await expectElectronThemeFrames(launched.page);

      const sameDocumentMarker = `electron-frame-refresh-${Date.now()}`;
      await launched.page.evaluate((marker) => {
        (window as Window & { __electronFrameRefreshDocument?: string })
          .__electronFrameRefreshDocument = marker;
      }, sameDocumentMarker);
      writeFileSync(
        path.join(server.home, "themes", "electron-executable", "unrelated.txt"),
        "refresh sandbox frames",
        "utf8",
      );
      await expect.poll(async () => [
        await electronThemeFrameInstance(launched.page, "background"),
        await electronThemeFrameInstance(launched.page, "overlay"),
      ]).not.toEqual(frameInstances);
      frameInstances = await expectElectronThemeFrames(launched.page);
      expect(frameInstances).toEqual([expect.any(String), expect.any(String)]);
      expect(await launched.page.evaluate(() =>
        (window as Window & { __electronFrameRefreshDocument?: string })
          .__electronFrameRefreshDocument
      )).toBe(sameDocumentMarker);
      expect(await rendererExposure(launched.page)).toEqual(before);
      await expect.poll(() => webviewExecutableThemeRan(launched.app)).toBe(false);

      await expectApplicationReset(() => patchDisplay(server!.serverURL, {
        themeJavaScriptConsentIds: [],
      }));
      expect(await launched.page.evaluate(() => ({
        state: (window as Window & { __electronExecutableTheme?: unknown })
          .__electronExecutableTheme,
        overlay: document.querySelector("[data-electron-executable-overlay]") !== null,
      }))).toEqual({ state: undefined, overlay: false });
      await expect(launched.page.locator(
        'script[data-television-script="television-active-theme"]',
      )).toHaveCount(0);
      await expect.poll(() => rendererThemeState(launched.page)).toMatchObject({
        activeThemeName: "electron-executable",
        themeJavaScriptConsentIds: [],
      });

      await patchDisplay(server.serverURL, {
        themeJavaScriptConsentIds: ["electron-executable"],
      });
      await expect.poll(() => launched.page.evaluate(() =>
        (window as Window & { __electronExecutableTheme?: unknown })
          .__electronExecutableTheme !== undefined
      )).toBe(true);

      await expectApplicationReset(() =>
        activateTheme(server!.serverURL, "electron-other")
      );
      expect(await launched.page.evaluate(() => ({
        state: (window as Window & { __electronExecutableTheme?: unknown })
          .__electronExecutableTheme,
        overlay: document.querySelector("[data-electron-executable-overlay]") !== null,
      }))).toEqual({ state: undefined, overlay: false });
      await expect(launched.page.locator(
        'script[data-television-script="television-active-theme"]',
      )).toHaveCount(0);
      await expect.poll(() => rendererThemeState(launched.page)).toMatchObject({
        activeThemeName: "electron-other",
        themeJavaScriptConsentIds: ["electron-executable"],
      });
      await expect(launched.page.locator("#theme-iframe-background")).toHaveCount(0);
      await expect(launched.page.locator("#theme-iframe-overlay")).toHaveCount(0);
      await expect.poll(() => webviewExecutableThemeRan(launched.app)).toBe(false);
    } finally {
      await launched.app.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("reloads a path webview when the active theme changes", async () => {
    const storagePath = createDataDir("television-electron-theme-parity-");
    const canonicalDir = createDataDir("television-electron-theme-canonical-");
    const canonicalVersionDir = path.join(canonicalDir, "v2");
    mkdirSync(canonicalVersionDir);
    writeFileSync(path.join(canonicalVersionDir, "styles.css"), `:root { --theme-probe-bg: transparent; }\n`, "utf8");
    const store = createServingStore(storagePath);
    const directServer = new Server({ store, port: 0, canonicalDir });
    await directServer.start();
    let app: ElectronApplication | null = null;
    try {
      seedThemePackage(storagePath, "theme-a", `:root { --theme-probe-bg: rgb(11, 22, 33); }\n`);
      seedThemePackage(storagePath, "theme-b", `:root { --theme-probe-bg: rgb(44, 55, 66); }\n`);
      store.refreshThemeRegistry();

      const channelID = store.listChannels()[0]!.id;
      const artifactPath = path.join(storagePath, "theme-probe.html");
      writeFileSync(
        artifactPath,
        `<!doctype html><html><head>
          <link rel="stylesheet" href="/canonical/v2/styles.css">
          <style>#theme-probe { background: var(--theme-probe-bg, transparent); width: 40px; height: 40px; }</style>
        </head><body><main id="theme-probe">Theme probe</main></body></html>`,
        "utf8",
      );
      store.createArtifact({ kind: "path", title: "Theme probe", path: artifactPath, channelID: channelID });
      await activateTheme(directServer.getBaseURL(), "theme-a", directServer.getAuthToken());

      const launched = await launchDesktop({
        fixture: `${await appURLForServer(directServer.getBaseURL(), desktopE2EOrigin())}/packages/web/src/index.html?mode=electron&token=${directServer.getAuthToken()}`,
      });
      app = launched.app;
      await fetch(`${directServer.getBaseURL()}/display`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${directServer.getAuthToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ activeChannelID: channelID }),
      });

      await expect(launched.page.locator(".artifact-view webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => webviewStyle(launched.app, "#theme-probe", "background-color"), { timeout: 15_000 }).toBe("rgb(11, 22, 33)");

      await activateTheme(directServer.getBaseURL(), "theme-b", directServer.getAuthToken());

      await expect.poll(() => webviewStyle(launched.app, "#theme-probe", "background-color"), { timeout: 15_000 }).toBe("rgb(44, 55, 66)");
    } finally {
      await app?.close();
      await directServer.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(canonicalDir, { recursive: true, force: true });
    }
  });
})
