import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHTTPServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { Server } from "@telepath-computer/television-server";
import { APPEARANCE_CACHE_KEY } from "../../src/appearance.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";
import { waitForApplicationShell } from "./helpers.ts";

const WEB_DIST = path.resolve(import.meta.dirname, "../../dist");
const CANONICAL_DIST = path.resolve(import.meta.dirname, "../../../canonical/dist/canonical");
const BUNDLED_THEMES = path.resolve(import.meta.dirname, "../../../server/assets/themes");
const MARKDOWN_VIEW_DIST = path.resolve(import.meta.dirname, "../../../view-markdown/dist");
const HIND_FONT = path.resolve(
  import.meta.dirname,
  "../../../canonical/styles/canonical/v2/foundation/fonts/Hind-Variable.woff2",
);
const THEME_A_LIGHT = "rgb(1, 2, 3)";
const THEME_A_DARK = "rgb(4, 5, 6)";
const THEME_B_LIGHT = "rgb(7, 8, 9)";
const THEME_B_EDITED = "rgb(10, 11, 12)";
const CANONICAL_PROBE = "rgb(21, 22, 23)";
const THEME_PROBE_FONT = "ThemeProbe";
const HTTP_NO_CONTENT = 204;

interface FirstFrameRecord {
  readonly theme: string | null;
  readonly colorScheme: string;
}

interface ConnectedMountRecord {
  readonly theme: string | null;
  readonly cachedInput: string | null;
}

interface ThemeLinkWindow extends Window {
  __trackedThemeLink?: HTMLLinkElement;
}

function createStoragePath(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-appearance-delivery-"));
}

function createCanonicalBaseline(
  css = "body { background: rgb(12, 34, 56); }\n",
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "television-clouds-canonical-"));
  const versionDir = path.join(root, "v2");
  mkdirSync(versionDir);
  writeFileSync(path.join(versionDir, "styles.css"), css, "utf8");
  return root;
}

async function unavailableServerURL(): Promise<string> {
  const server = createHTTPServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("unavailable-server fixture did not bind a TCP port");
  }
  const url = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return url;
}

async function installFirstFrameRecorder(
  context: BrowserContext,
  cachedValue: string | null,
  storageReadFailure = false,
  storageWriteFailure = false,
): Promise<void> {
  await context.addInitScript(
    ({ cacheKey, cachedValue, storageReadFailure, storageWriteFailure }) => {
      if (window.top !== window) return;
      try {
        if (cachedValue === null) {
          window.localStorage.removeItem(cacheKey);
        } else {
          window.localStorage.setItem(cacheKey, cachedValue);
        }
        if (storageReadFailure) {
          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function getItem(key: string): string | null {
            if (key === cacheKey) throw new Error("fixture storage read failure");
            return originalGetItem.call(this, key);
          };
        }
        if (storageWriteFailure) {
          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function setItem(key: string, value: string): void {
            if (key === cacheKey) throw new Error("fixture storage write failure");
            originalSetItem.call(this, key, value);
          };
        }
      } catch {
        // The navigation's origin is available when this init script runs.
      }
      const renderCompleteCallbacks = new Set<(state: string) => void>();
      let connectedMountRecorded = false;
      renderCompleteCallbacks.add((state) => {
        if (
          connectedMountRecorded ||
          (state !== "connected" &&
            state !== "no-channel" &&
            state !== "empty-channel")
        ) return;
        connectedMountRecorded = true;
        Object.assign(window, {
          __appearanceConnectedMount: {
            theme: document.documentElement.dataset.theme ?? null,
            cachedInput: window.localStorage.getItem(cacheKey),
          },
        });
      });
      Object.assign(window, { __telepath: { renderCompleteCallbacks } });
      window.requestAnimationFrame(() => {
        const root = document.documentElement;
        Object.assign(window, {
          __appearanceFirstFrame: {
            theme: root.dataset.theme ?? null,
            colorScheme: getComputedStyle(root).colorScheme,
          },
        });
      });
    },
    {
      cacheKey: APPEARANCE_CACHE_KEY,
      cachedValue,
      storageReadFailure,
      storageWriteFailure,
    },
  );
}

async function firstFrame(page: Page): Promise<FirstFrameRecord> {
  await page.waitForFunction(() =>
    "__appearanceFirstFrame" in window
  );
  return page.evaluate(() =>
    (window as unknown as { __appearanceFirstFrame: FirstFrameRecord })
      .__appearanceFirstFrame
  );
}

async function connectedMount(page: Page): Promise<ConnectedMountRecord> {
  await page.waitForFunction(() => "__appearanceConnectedMount" in window);
  return page.evaluate(() =>
    (window as unknown as { __appearanceConnectedMount: ConnectedMountRecord })
      .__appearanceConnectedMount
  );
}

function assertBuiltHeadOrder(): void {
  const html = readFileSync(path.join(WEB_DIST, "index.html"), "utf8");
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1];
  if (!head) throw new Error("built shell is missing its head");
  const trimmed = head.trimStart();
  expect(trimmed.startsWith("<script>")).toBe(true);
  expect(trimmed.indexOf(APPEARANCE_CACHE_KEY)).toBeGreaterThan(-1);
  expect(trimmed.indexOf('<link rel="stylesheet"')).toBeGreaterThan(
    trimmed.indexOf("</script>"),
  );

  for (const entry of ["artifact-missing", "url-unsupported"]) {
    const documentHTML = readFileSync(
      path.join(WEB_DIST, "views", entry, "index.html"),
      "utf8",
    );
    const documentHead = /<head>([\s\S]*?)<\/head>/.exec(documentHTML)?.[1];
    if (!documentHead) throw new Error(`built ${entry} document is missing its head`);
    const first = documentHead.trimStart();
    const resolverEnd = first.indexOf("</script>");
    const canonicalAt = first.indexOf('/canonical/v2/styles.css');
    const viewStyleAt = first.indexOf("<style>");
    expect(first.startsWith("<script>")).toBe(true);
    expect(first).toContain("__televisionAppearanceResolver");
    expect(canonicalAt).toBeGreaterThan(resolverEnd);
    expect(viewStyleAt).toBeGreaterThan(canonicalAt);
  }
}

async function openBuiltShell(
  browser: Browser,
  shellURL: string,
  serverURL: string,
  options: {
    colorScheme: "light" | "dark";
    cachedValue: string | null;
    storageReadFailure?: boolean;
    storageWriteFailure?: boolean;
  },
): Promise<{ context: BrowserContext; page: Page; responseContentType: string | undefined }> {
  const context = await browser.newContext({ colorScheme: options.colorScheme });
  await installFirstFrameRecorder(
    context,
    options.cachedValue,
    options.storageReadFailure,
    options.storageWriteFailure,
  );
  const page = await context.newPage();
  const response = await page.goto(
    `${shellURL}/?serverURL=${encodeURIComponent(serverURL)}`,
  );
  return {
    context,
    page,
    responseContentType: response?.headers()["content-type"],
  };
}

async function patchDisplay(
  page: Page,
  serverURL: string,
  patch: { appearanceMode?: "system" | "light" | "dark"; activeThemeName?: string | null },
): Promise<void> {
  const status = await page.evaluate(
    async ({ serverURL, patch }) => {
      const response = await fetch(`${serverURL}/display`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      return response.status;
    },
    { serverURL, patch },
  );
  expect(status).toBe(HTTP_NO_CONTENT);
}

function seedProbeThemes(storagePath: string): { themeBPath: string } {
  const themeAPath = seedThemePackage(
    storagePath,
    "probe-a",
    `@import url("./nested/palette.css");
@font-face {
  font-family: "${THEME_PROBE_FONT}";
  src: url("./assets/probe.woff2") format("woff2-variations");
  font-weight: 300 700;
}
#theme-probe {
  font-family: "${THEME_PROBE_FONT}", sans-serif;
  background-image: url("./assets/probe.svg");
}
`,
  );
  mkdirSync(path.join(themeAPath, "nested"), { recursive: true });
  mkdirSync(path.join(themeAPath, "assets"), { recursive: true });
  writeFileSync(
    path.join(themeAPath, "nested/palette.css"),
    `[data-theme="light"] :is(#theme-probe, #artifact-probe, .cm-content) { color: ${THEME_A_LIGHT}; }
[data-theme="dark"] :is(#theme-probe, #artifact-probe, .cm-content) { color: ${THEME_A_DARK}; }
`,
    "utf8",
  );
  copyFileSync(HIND_FONT, path.join(themeAPath, "assets/probe.woff2"));
  writeFileSync(
    path.join(themeAPath, "assets/probe.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>\n',
    "utf8",
  );
  const themeBPath = seedThemePackage(
    storagePath,
    "probe-b",
    `[data-theme="light"] :is(#theme-probe, #artifact-probe, .cm-content) { color: ${THEME_B_LIGHT}; }
[data-theme="dark"] :is(#theme-probe, #artifact-probe, .cm-content) { color: ${THEME_B_LIGHT}; }
`,
  );
  return { themeBPath };
}

function artifactCard(page: Page, title: string): Locator {
  return page.locator(".artifact-view").filter({ hasText: title }).first();
}

async function probeColor(page: Page): Promise<string> {
  return page.locator("#theme-probe").evaluate((element) =>
    getComputedStyle(element).color
  );
}

async function expectFinalThemeLink(page: Page): Promise<void> {
  expect(await page.evaluate(() => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="television-active-theme"]',
    );
    const styles = [...document.head.querySelectorAll("link[rel=stylesheet], style")];
    return link !== null && styles.at(-1) === link;
  })).toBe(true);
}

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-first-paint
test("built shell resolves cached and fallback first paint before styles, then accepts confirmed state", async ({
  browser,
}) => {
  assertBuiltHeadOrder();
  const storagePath = createStoragePath();
  seedThemePackage(
    storagePath,
    "fixed-dark",
    ":root { --first-paint-probe: dark; }\n",
    { colorScheme: "dark" },
  );
  const store = createServingStore(storagePath);
  store.patchDisplay({ activeThemeName: "fixed-dark", appearanceMode: "light" });
  const server = new Server({
    store,
    port: 0,
    staticDir: WEB_DIST,
  });
  const unavailableURL = await unavailableServerURL();

  try {
    await server.start();
    const shellURL = server.getBaseURL();

    const cached = await openBuiltShell(browser, shellURL, unavailableURL, {
      colorScheme: "light",
      cachedValue: "dark",
    });
    try {
      expect(cached.responseContentType).toMatch(/^text\/html;\s*charset=utf-8$/i);
      expect(await firstFrame(cached.page)).toMatchObject({
        theme: "dark",
        colorScheme: "dark",
      });
    } finally {
      await cached.context.close();
    }

    for (const cachedValue of [null, "sepia"] as const) {
      const fallback = await openBuiltShell(browser, shellURL, unavailableURL, {
        colorScheme: "dark",
        cachedValue,
      });
      try {
        expect(await firstFrame(fallback.page)).toMatchObject({
          theme: "dark",
          colorScheme: "dark",
        });
      } finally {
        await fallback.context.close();
      }
    }

    const failedRead = await openBuiltShell(browser, shellURL, unavailableURL, {
      colorScheme: "dark",
      cachedValue: "light",
      storageReadFailure: true,
    });
    try {
      expect(await firstFrame(failedRead.page)).toMatchObject({
        theme: "dark",
        colorScheme: "dark",
      });
    } finally {
      await failedRead.context.close();
    }

    const confirmed = await openBuiltShell(browser, shellURL, shellURL, {
      colorScheme: "light",
      cachedValue: "light",
    });
    try {
      expect(await firstFrame(confirmed.page)).toMatchObject({
        theme: "light",
        colorScheme: "light",
      });
      await waitForApplicationShell(confirmed.page);
      await expect(confirmed.page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await connectedMount(confirmed.page)).toEqual({
        theme: "dark",
        cachedInput: "dark",
      });
      expect(await confirmed.page.evaluate((cacheKey) =>
        window.localStorage.getItem(cacheKey), APPEARANCE_CACHE_KEY
      )).toBe("dark");
    } finally {
      await confirmed.context.close();
    }

    const failedWrite = await openBuiltShell(browser, shellURL, shellURL, {
      colorScheme: "light",
      cachedValue: "light",
      storageWriteFailure: true,
    });
    try {
      await waitForApplicationShell(failedWrite.page);
      await expect(failedWrite.page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await connectedMount(failedWrite.page)).toEqual({
        theme: "dark",
        cachedInput: "light",
      });
      expect(await failedWrite.page.evaluate((cacheKey) =>
        window.localStorage.getItem(cacheKey), APPEARANCE_CACHE_KEY
      )).toBe("light");
    } finally {
      await failedWrite.context.close();
    }
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-theme-color-scheme
test("manifest color schemes select foundation and theme modes in app and live canonical documents", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: null });
  const page = await context.newPage();
  const storagePath = createStoragePath();
  const artifactTitle = "Theme scheme probe";
  const artifactPath = path.join(storagePath, "theme-scheme-probe.html");
  writeFileSync(artifactPath, `<!doctype html>
<html>
  <head><link rel="stylesheet" href="/canonical/v2/styles.css"></head>
  <body><div id="theme-scheme-artifact-probe">Theme scheme probe</div></body>
</html>
`, "utf8");
  const fixtureCSS = {
    fixedLight: ":root { --scheme-probe: rgb(1, 2, 3); }\n:is(#theme-scheme-app-probe, #theme-scheme-artifact-probe) { color: var(--scheme-probe); }\n",
    fixedDark: ":root { --scheme-probe: rgb(4, 5, 6); }\n:is(#theme-scheme-app-probe, #theme-scheme-artifact-probe) { color: var(--scheme-probe); }\n",
    adaptive: `[data-theme="light"] { --scheme-probe: rgb(7, 8, 9); }
[data-theme="dark"] { --scheme-probe: rgb(10, 11, 12); }
:is(#theme-scheme-app-probe, #theme-scheme-artifact-probe) { color: var(--scheme-probe); }
`,
  };
  seedThemePackage(storagePath, "fixed-light", fixtureCSS.fixedLight, {
    colorScheme: "light",
  });
  seedThemePackage(storagePath, "fixed-dark", fixtureCSS.fixedDark, {
    colorScheme: "dark",
  });
  seedThemePackage(storagePath, "adaptive", fixtureCSS.adaptive, {
    colorScheme: "light dark",
  });
  for (const css of Object.values(fixtureCSS)) expect(css).not.toContain("color-scheme");

  const store = createServingStore(storagePath);
  const channel = store.listChannels()[0]!;
  store.createArtifact({
    kind: "path",
    title: artifactTitle,
    path: artifactPath,
    channelID: channel.id,
  });
  store.patchDisplay({ activeThemeName: "fixed-dark", appearanceMode: "light" });
  const server = new Server({
    store,
    port: 0,
    staticDir: WEB_DIST,
    canonicalDir: CANONICAL_DIST,
  });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    await page.goto(`${serverURL}/?serverURL=${encodeURIComponent(serverURL)}`);
    await waitForApplicationShell(page);
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "theme-scheme-app-probe";
      document.documentElement.append(probe);
    });
    const artifactFrame = artifactCard(page, artifactTitle)
      .locator("iframe.artifact-content")
      .contentFrame();
    const appRoot = page.locator("html");
    const artifactRoot = artifactFrame.locator("html");
    const appProbe = page.locator("#theme-scheme-app-probe");
    const artifactProbe = artifactFrame.locator("#theme-scheme-artifact-probe");

    const expectMode = async (
      mode: "light" | "dark",
      color: string,
      alphaActive: "8%" | "12%",
    ): Promise<void> => {
      await expect(appRoot).toHaveAttribute("data-theme", mode);
      await expect(artifactRoot).toHaveAttribute("data-theme", mode);
      await expect(appRoot).toHaveCSS("color-scheme", mode);
      await expect(artifactRoot).toHaveCSS("color-scheme", mode);
      await expect(appProbe).toHaveCSS("color", color);
      await expect(artifactProbe).toHaveCSS("color", color);
      expect(await Promise.all([appRoot, artifactRoot].map((root) =>
        root.evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--alpha-active").trim()
        )
      ))).toEqual([alphaActive, alphaActive]);
    };

    await expectMode("dark", "rgb(4, 5, 6)", "12%");
    await patchDisplay(page, serverURL, { appearanceMode: "system" });
    await expectMode("dark", "rgb(4, 5, 6)", "12%");

    await patchDisplay(page, serverURL, { activeThemeName: "fixed-light" });
    await expectMode("light", "rgb(1, 2, 3)", "8%");
    await patchDisplay(page, serverURL, { appearanceMode: "dark" });
    await expectMode("light", "rgb(1, 2, 3)", "8%");

    await patchDisplay(page, serverURL, {
      activeThemeName: "adaptive",
      appearanceMode: "light",
    });
    await expectMode("light", "rgb(7, 8, 9)", "8%");
    await patchDisplay(page, serverURL, { appearanceMode: "dark" });
    await expectMode("dark", "rgb(10, 11, 12)", "12%");
    await patchDisplay(page, serverURL, { appearanceMode: "system" });
    await expectMode("light", "rgb(7, 8, 9)", "8%");
  } finally {
    await context.close();
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

test("built standalone artifact documents resolve system appearance before canonical and theme styles", async ({
  browser,
}) => {
  assertBuiltHeadOrder();
  const storagePath = createStoragePath();
  seedProbeThemes(storagePath);
  const canonicalDir = createCanonicalBaseline();
  const store = createServingStore(storagePath);
  store.patchDisplay({ activeThemeName: "probe-a" });
  const server = new Server({ store, port: 0, staticDir: WEB_DIST, canonicalDir });
  const context = await browser.newContext({ colorScheme: "dark" });
  await context.addInitScript(() => {
    requestAnimationFrame(() => {
      Object.assign(window, {
        __artifactDocumentFirstFrame: document.documentElement.dataset.theme ?? null,
      });
    });
  });
  const page = await context.newPage();

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    for (const route of ["/views/artifact-missing/", "/views/url-unsupported/"]) {
      const requests: string[] = [];
      const recordRequest = (request: { url(): string }): void => {
        requests.push(new URL(request.url()).pathname);
      };
      page.on("request", recordRequest);
      await page.goto(`${serverURL}${route}`);
      await page.waitForFunction(() => "__artifactDocumentFirstFrame" in window);
      expect(await page.evaluate(() =>
        (window as unknown as { __artifactDocumentFirstFrame: string | null })
          .__artifactDocumentFirstFrame
      )).toBe("dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await page.evaluate(() =>
        "__televisionAppearanceResolver" in window
      )).toBe(true);
      await expect.poll(() => requests).toEqual(expect.arrayContaining([
        "/canonical/v2/styles.css",
        "/theme/theme.css",
      ]));
      page.off("request", recordRequest);
    }
  } finally {
    await context.close();
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(canonicalDir, { recursive: true, force: true });
  }
});

test("canonical HTML and markdown follow appearance live and refresh theme without losing markdown state", async ({
  browser,
}) => {
  const storagePath = createStoragePath();
  seedProbeThemes(storagePath);
  const canonicalDir = createCanonicalBaseline(
    `#artifact-probe, .cm-content { color: ${CANONICAL_PROBE}; }\n`,
  );
  const htmlPath = path.join(storagePath, "appearance-probe.html");
  const markdownPath = path.join(storagePath, "appearance-probe.md");
  writeFileSync(htmlPath, `<!doctype html>
<html><head>
  <link rel="stylesheet" href="/canonical/v2/styles.css">
  <script>window.__artifactLoadID = crypto.randomUUID();</script>
</head><body><main id="artifact-probe">HTML appearance probe</main></body></html>`, "utf8");
  writeFileSync(markdownPath, "# Markdown appearance probe\n", "utf8");
  const bundledViewsPath = mkdtempSync(path.join(os.tmpdir(), "television-appearance-views-"));
  cpSync(MARKDOWN_VIEW_DIST, path.join(bundledViewsPath, "markdown"), { recursive: true });
  const store = createServingStore(storagePath, { bundledViewsPath });
  const channel = store.listChannels()[0]!;
  store.createArtifact({ kind: "path", title: "Theme HTML", path: htmlPath, channelID: channel.id });
  store.createArtifact({ kind: "path", title: "Theme Markdown", path: markdownPath, channelID: channel.id });
  store.patchDisplay({ activeThemeName: "probe-a", appearanceMode: "light" });
  const server = new Server({ store, port: 0, staticDir: WEB_DIST, canonicalDir });
  const context = await browser.newContext({ colorScheme: null });
  const page = await context.newPage();
  const styleRequests: string[] = [];
  page.on("request", (request) => {
    const requestURL = new URL(request.url());
    if (requestURL.pathname === "/canonical/v2/styles.css" || requestURL.pathname === "/theme/theme.css") {
      styleRequests.push(`${requestURL.pathname}${requestURL.search}`);
    }
  });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    await page.goto(`${serverURL}/?serverURL=${encodeURIComponent(serverURL)}`);
    await waitForApplicationShell(page);
    const htmlFrame = artifactCard(page, "Theme HTML").locator("iframe.artifact-content").contentFrame();
    const markdownFrame = artifactCard(page, "Theme Markdown").locator("iframe.artifact-content").contentFrame();
    const htmlProbe = htmlFrame.locator("#artifact-probe");
    const markdownProbe = markdownFrame.locator(".cm-content");
    await expect(markdownProbe).toContainText("Markdown appearance probe");
    await expect(htmlFrame.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(markdownFrame.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => htmlProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(THEME_A_LIGHT);
    await expect.poll(() => markdownProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(THEME_A_LIGHT);
    const initialHTMLLoad = await htmlFrame.locator("body").evaluate(() =>
      (window as unknown as { __artifactLoadID: string }).__artifactLoadID
    );
    const initialMarkdownHref = await markdownFrame.locator(
      'link[data-television-style="canonical"]',
    ).getAttribute("href");
    const markdownMarker = await markdownFrame.locator("body").evaluate(() => {
      const marker = crypto.randomUUID();
      Object.assign(window, { __appearanceAcceptanceMarker: marker });
      return marker;
    });
    const initialStyleRequests = styleRequests.length;

    await patchDisplay(page, serverURL, { appearanceMode: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(htmlFrame.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(markdownFrame.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(htmlProbe).toHaveCSS("color", THEME_A_DARK);
    await expect(markdownProbe).toHaveCSS("color", THEME_A_DARK);
    expect(styleRequests).toHaveLength(initialStyleRequests);
    expect(await htmlFrame.locator("body").evaluate(() =>
      (window as unknown as { __artifactLoadID: string }).__artifactLoadID
    )).toBe(initialHTMLLoad);
    expect(await markdownFrame.locator("body").evaluate(() =>
      (window as unknown as { __appearanceAcceptanceMarker: string })
        .__appearanceAcceptanceMarker
    )).toBe(markdownMarker);

    await patchDisplay(page, serverURL, { appearanceMode: "system" });
    await expect(htmlFrame.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(markdownFrame.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => htmlProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(THEME_A_LIGHT);
    expect(styleRequests).toHaveLength(initialStyleRequests);

    await patchDisplay(page, serverURL, { activeThemeName: "probe-b" });
    await expect.poll(() => htmlProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(THEME_B_LIGHT);
    await expect.poll(() => markdownProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(THEME_B_LIGHT);
    await expect.poll(async () => htmlFrame.locator("body").evaluate(() =>
      (window as unknown as { __artifactLoadID: string }).__artifactLoadID
    )).not.toBe(initialHTMLLoad);
    await expect.poll(async () => markdownFrame.locator(
      'link[data-television-style="canonical"]',
    ).getAttribute("href")).not.toBe(initialMarkdownHref);
    expect(await markdownFrame.locator("body").evaluate(() =>
      (window as unknown as { __appearanceAcceptanceMarker: string })
        .__appearanceAcceptanceMarker
    )).toBe(markdownMarker);
    await expect(markdownProbe).toContainText("Markdown appearance probe");

    await patchDisplay(page, serverURL, { activeThemeName: null });
    await expect.poll(() => htmlProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(CANONICAL_PROBE);
    await expect.poll(() => markdownProbe.evaluate((element) => getComputedStyle(element).color))
      .toBe(CANONICAL_PROBE);
    expect(CANONICAL_PROBE).not.toBe(THEME_B_LIGHT);
  } finally {
    await context.close();
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(canonicalDir, { recursive: true, force: true });
    rmSync(bundledViewsPath, { recursive: true, force: true });
  }
});

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-app-document
test("Clouds targets the marked app without painting canonical artifacts", async ({ page }) => {
  const themeRequests: Array<{ path: string; document: "app" | "artifact" }> = [];
  page.on("request", (request) => {
    const requestPath = new URL(request.url()).pathname;
    if (!requestPath.startsWith("/theme/")) return;
    themeRequests.push({
      path: requestPath,
      document: request.frame() === page.mainFrame() ? "app" : "artifact",
    });
  });
  const storagePath = createStoragePath();
  const canonicalDir = createCanonicalBaseline();
  const artifactPath = path.join(storagePath, "clouds-scope.html");
  writeFileSync(artifactPath, `<!doctype html>
<html>
  <head><link rel="stylesheet" href="/canonical/v2/styles.css"></head>
  <body><main id="clouds-scope">Canonical baseline</main></body>
</html>
`, "utf8");
  const store = createServingStore(storagePath, { bundledThemesPath: BUNDLED_THEMES });
  const channel = store.listChannels()[0]!;
  store.createArtifact({ kind: "path", title: "Clouds scope", path: artifactPath, channelID: channel.id });
  const server = new Server({ store, port: 0, staticDir: WEB_DIST, canonicalDir });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    await page.goto(`${serverURL}/?serverURL=${encodeURIComponent(serverURL)}`);
    await waitForApplicationShell(page);

    await expect(page.locator("html")).toHaveAttribute("data-television-document", "app");
    await expect.poll(() => page.locator(".app-main").evaluate((element) =>
      getComputedStyle(element).backgroundImage
    )).toContain("/theme/wallpaper.webp");

    const artifact = page.frameLocator(".artifact-view iframe.artifact-content");
    await expect(artifact.locator("#clouds-scope")).toHaveText("Canonical baseline");
    expect(await artifact.locator("body").evaluate((body) => ({
      image: getComputedStyle(body).backgroundImage,
      color: getComputedStyle(body).backgroundColor,
    }))).toEqual({ image: "none", color: "rgb(12, 34, 56)" });
    await expect.poll(() => themeRequests).toEqual(expect.arrayContaining([
      { path: "/theme/theme.css", document: "app" },
      { path: "/theme/theme.css", document: "artifact" },
      { path: "/theme/wallpaper.webp", document: "app" },
    ]));
    expect(themeRequests).not.toContainEqual({
      path: "/theme/wallpaper.webp",
      document: "artifact",
    });

    await patchDisplay(page, serverURL, { activeThemeName: null });
    await expect.poll(() => page.locator(".app-main").evaluate((element) =>
      getComputedStyle(element).backgroundImage
    )).toMatch(/^none(?:,\s*none)*$/);
    await expect(artifact.locator("#clouds-scope")).toHaveText("Canonical baseline");
    expect(await artifact.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor))
      .toBe("rgb(12, 34, 56)");
    const themeResponse = await page.request.get(`${serverURL}/theme/theme.css`);
    expect(themeResponse.status()).toBe(200);
    expect(await themeResponse.text()).toBe("");
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(canonicalDir, { recursive: true, force: true });
  }
});

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-app-link
test("cross-origin theme link stays final and mode changes reuse its nested resources", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("theme-link browser fixture requires baseURL");
  const storagePath = createStoragePath();
  const { themeBPath } = seedProbeThemes(storagePath);
  const store = createServingStore(storagePath);
  store.patchDisplay({ activeThemeName: "probe-a" });
  const server = new Server({ store, port: 0 });
  const themeRequests: string[] = [];
  page.on("request", (request) => {
    const requestURL = new URL(request.url());
    if (requestURL.pathname.startsWith("/theme/")) {
      themeRequests.push(requestURL.pathname);
    }
  });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(
      `${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}`,
    );
    await waitForApplicationShell(page);

    const themeLink = page.locator(
      'link[data-television-style="television-active-theme"]',
    );
    const initialThemeHref = await themeLink.getAttribute("href");
    if (!initialThemeHref) throw new Error("Expected the application theme link");
    const initialThemeURL = new URL(initialThemeHref);
    expect(initialThemeURL.origin).toBe(serverURL);
    expect(initialThemeURL.pathname).toBe("/theme/theme.css");
    expect(initialThemeURL.searchParams.get("tv-theme")).toBeTruthy();
    await expectFinalThemeLink(page);
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "theme-probe";
      probe.textContent = "Theme probe";
      document.body.append(probe);
      (window as ThemeLinkWindow).__trackedThemeLink =
        document.querySelector<HTMLLinkElement>(
          'link[data-television-style="television-active-theme"]',
        ) ?? undefined;
    });
    await expect.poll(() => probeColor(page)).toBe(THEME_A_LIGHT);
    await page.evaluate(async (font) => {
      await document.fonts.load(`16px "${font}"`);
      await document.fonts.ready;
    }, THEME_PROBE_FONT);
    await expect.poll(() => themeRequests).toEqual(expect.arrayContaining([
      "/theme/theme.css",
      "/theme/nested/palette.css",
      "/theme/assets/probe.woff2",
      "/theme/assets/probe.svg",
    ]));
    const appearanceRequestCount = themeRequests.length;

    await patchDisplay(page, serverURL, { appearanceMode: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => probeColor(page)).toBe(THEME_A_LIGHT);
    expect(await page.evaluate(() =>
      window.matchMedia("(prefers-color-scheme: dark)").matches
    )).toBe(true);

    await patchDisplay(page, serverURL, { appearanceMode: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => probeColor(page)).toBe(THEME_A_DARK);
    expect(await page.evaluate(() =>
      window.matchMedia("(prefers-color-scheme: dark)").matches
    )).toBe(false);

    await patchDisplay(page, serverURL, { appearanceMode: "system" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => probeColor(page)).toBe(THEME_A_DARK);
    expect(themeRequests).toHaveLength(appearanceRequestCount);
    expect(await page.evaluate(() => {
      const owner = window as ThemeLinkWindow;
      return owner.__trackedThemeLink === document.querySelector(
        'link[data-television-style="television-active-theme"]',
      );
    })).toBe(true);

    await patchDisplay(page, serverURL, { activeThemeName: "probe-b" });
    await expect.poll(() => probeColor(page)).toBe(THEME_B_LIGHT);
    expect(await page.evaluate(() => {
      const owner = window as ThemeLinkWindow;
      return owner.__trackedThemeLink !== document.querySelector(
        'link[data-television-style="television-active-theme"]',
      ) && owner.__trackedThemeLink?.isConnected === false;
    })).toBe(true);
    await expectFinalThemeLink(page);

    await page.evaluate(() => {
      (window as ThemeLinkWindow).__trackedThemeLink =
        document.querySelector<HTMLLinkElement>(
          'link[data-television-style="television-active-theme"]',
        ) ?? undefined;
    });
    writeFileSync(
      path.join(themeBPath, "theme.css"),
      `[data-theme="light"] #theme-probe { color: ${THEME_B_EDITED}; }
[data-theme="dark"] #theme-probe { color: ${THEME_B_EDITED}; }
`,
      "utf8",
    );
    await expect.poll(() => probeColor(page)).toBe(THEME_B_EDITED);
    expect(await page.evaluate(() => {
      const owner = window as ThemeLinkWindow;
      return owner.__trackedThemeLink !== document.querySelector(
        'link[data-television-style="television-active-theme"]',
      ) && owner.__trackedThemeLink?.isConnected === false;
    })).toBe(true);
    await expectFinalThemeLink(page);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});
