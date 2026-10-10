import { type Locator, type Page } from "@playwright/test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";
import { waitForApplicationShell } from "./helpers.ts";
import {
  APPLICATION_SHELL_STATES,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";

const BASE_COLOR = "rgb(20, 21, 22)";
const THEME_A = {
  light: "rgb(31, 32, 33)",
  dark: "rgb(34, 35, 36)",
} as const;
const THEME_B = {
  light: "rgb(41, 42, 43)",
  dark: "rgb(44, 45, 46)",
} as const;
const THEME_B_EDITED_LIGHT = "rgb(45, 46, 47)";
const THEME_B_EDITED_DARK = "rgb(47, 48, 49)";
const FIREFOX_FIXED_DARK = "rgb(28, 29, 30)";
const FIREFOX_LIGHT = "rgb(238, 239, 240)";
const FIXED_DARK = "rgb(51, 52, 53)";
const BUNDLED_THEMES_PATH = path.resolve(
  import.meta.dirname,
  "../../../server/assets/themes",
);

interface ProbeSet {
  readonly app: Locator;
  readonly html: Locator;
  readonly markdown: Locator;
}

function themeCSS(
  light: string,
  dark: string,
  probeAssetPath = "./probe.svg",
): string {
  return `[data-theme="light"] .e2e-theme-probe {
  color: ${light};
  background-image: url("${probeAssetPath}");
}
[data-theme="dark"] .e2e-theme-probe {
  color: ${dark};
  background-image: url("${probeAssetPath}");
}
`;
}

function fixedThemeCSS(color: string): string {
  return `:root {
  --firefox-theme-probe: ${color};
}
.app-main,
.cm-content {
  color: var(--firefox-theme-probe) !important;
}
`;
}

async function defaultChannelID(server: ProductServer): Promise<string> {
  const response = await fetch(`${server.serverURL}/channels`);
  expect(response.status).toBe(200);
  const { channels } = await response.json() as { channels: Array<{ id: string }> };
  const channelID = channels[0]?.id;
  if (!channelID) throw new Error("Product server did not create a default channel");
  return channelID;
}

async function createPathArtifact(
  server: ProductServer,
  channelID: string,
  title: string,
  filePath: string,
): Promise<void> {
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "path", title, path: filePath, channelID }),
  });
  expect(response.status).toBe(201);
}

async function createURLArtifact(
  server: ProductServer,
  channelID: string,
  title: string,
  url: string,
): Promise<void> {
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "url", title, url, channelID }),
  });
  expect(response.status).toBe(201);
}

function artifactCard(page: Page, title: string): Locator {
  return page.locator(".artifact-view", {
    has: page.locator(".artifact-title", { hasText: title }),
  }).first();
}

async function openSettings(page: Page): Promise<void> {
  const panel = page.locator(".settings-popover");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForApplicationShell(page);
    const documentMarker = `settings-${Date.now()}-${attempt}`;
    await page.evaluate((marker) => {
      (window as Window & { __settingsOpenDocument?: string })
        .__settingsOpenDocument = marker;
    }, documentMarker);
    if (await panel.isVisible()) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    try {
      await expect(panel).toBeVisible();
      return;
    } catch (error) {
      const sameDocument = await page.evaluate((marker) =>
        (window as Window & { __settingsOpenDocument?: string })
          .__settingsOpenDocument === marker,
      documentMarker).catch(() => false);
      if (sameDocument || attempt === 1) throw error;
    }
  }
}

async function installProbes(page: Page): Promise<ProbeSet> {
  await page.evaluate((baseColor) => {
    const style = document.createElement("style");
    style.dataset.acceptanceProbe = "";
    style.textContent = `.e2e-theme-probe { color: ${baseColor}; width: 1px; height: 1px; }`;
    document.head.append(style);
    const probe = document.createElement("div");
    probe.className = "e2e-theme-probe";
    probe.dataset.acceptanceProbe = "app";
    document.documentElement.append(probe);
  }, BASE_COLOR);

  const htmlFrame = artifactCard(page, "Theme HTML").locator("iframe.artifact-content").contentFrame();
  const markdownFrame = artifactCard(page, "Theme Markdown").locator("iframe.artifact-content").contentFrame();
  await expect(htmlFrame.locator(".e2e-theme-probe")).toBeVisible();
  await expect(markdownFrame.locator(".cm-content")).toContainText("Theme markdown");
  await markdownFrame.locator("body").evaluate((body, baseColor) => {
    const style = document.createElement("style");
    style.dataset.acceptanceProbe = "";
    style.textContent = `.e2e-theme-probe { color: ${baseColor}; }`;
    body.append(style);
    const probe = document.createElement("div");
    probe.className = "e2e-theme-probe";
    probe.dataset.acceptanceProbe = "markdown";
    body.append(probe);
  }, BASE_COLOR);

  return {
    app: page.locator('[data-acceptance-probe="app"]'),
    html: htmlFrame.locator(".e2e-theme-probe"),
    markdown: markdownFrame.locator('[data-acceptance-probe="markdown"]'),
  };
}

async function expectProbeColor(
  probes: ProbeSet,
  color: string,
): Promise<void> {
  await Promise.all([
    expect(probes.app).toHaveCSS("color", color),
    expect(probes.html).toHaveCSS("color", color),
    expect(probes.markdown).toHaveCSS("color", color),
  ]);
}

async function expectActivePackageProbeColor(
  probes: ProbeSet,
  color: string,
): Promise<void> {
  await Promise.all([
    expect(probes.app).toHaveCSS("color", color),
    expect(probes.html).toHaveCSS("color", color),
  ]);
}

async function clickSelectOption(page: Page, select: Locator, value: string): Promise<void> {
  const triggerID = await select.getAttribute("trigger");
  await page.locator(`#${triggerID}`).click();
  await select.locator(`tv-option[value="${value}"]`).click();
}

async function selectTheme(page: Page, value: string): Promise<void> {
  const select = page.locator('tv-select[name="theme"]');
  await clickSelectOption(page, select, value);
  await expect(select).toHaveJSProperty("value", value);
}

async function selectAppearance(page: Page, value: "system" | "light" | "dark"): Promise<void> {
  const select = page.locator('tv-select[name="appearance-mode"]');
  await clickSelectOption(page, select, value);
  await expect(select).toHaveJSProperty("value", value);
}

async function expectExecutableRuns(
  pages: readonly Page[],
  expected: number,
): Promise<void> {
  await Promise.all(pages.map((applicationPage) =>
    expect.poll(() => applicationPage.evaluate(() =>
      Number(document.documentElement.dataset.executableThemeRuns ?? "0")
    )).toBe(expected)
  ));
}

type SandboxFrameKind = "background" | "overlay";

type PointerMessage = {
  type: string;
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
};

interface SandboxFrameState {
  kind: SandboxFrameKind;
  instance: string;
  appearance: string | null;
  origin: string;
  parentDOMAccess: "allowed" | "denied";
  scriptURL: string;
  asset: string | null;
  loadFailureContained: boolean;
  focusCount: number;
  pointers: PointerMessage[];
  hostMessages: unknown[];
}

const sandboxFrameSelector = (kind: SandboxFrameKind): string =>
  kind === "background" ? "#theme-iframe-background" : "#theme-iframe-overlay";

function sandboxFrameScript(kind: SandboxFrameKind): string {
  return `(() => {
  const scriptURL = document.currentScript?.src ?? "";
  let parentDOMAccess = "allowed";
  try {
    void parent.document.documentElement;
  } catch {
    parentDOMAccess = "denied";
  }
  const pointerTypes = new Set([
    "television-theme-pointer-move",
    "television-theme-pointer-down",
    "television-theme-pointer-up",
    "television-theme-pointer-cancel",
    "television-theme-pointer-click",
  ]);
  const state = window.__sandboxThemeState = {
    kind: ${JSON.stringify(kind)},
    instance: crypto.randomUUID(),
    appearance: document.documentElement.dataset.theme ?? null,
    origin: window.origin,
    parentDOMAccess,
    scriptURL,
    asset: null,
    loadFailureContained: false,
    focusCount: 0,
    pointers: [],
    hostMessages: [],
  };
  const focusStealer = document.createElement("button");
  focusStealer.id = "theme-focus-stealer";
  focusStealer.textContent = "Theme focus probe";
  focusStealer.addEventListener("focus", () => { state.focusCount += 1; });
  document.body.append(focusStealer);
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source === parent && pointerTypes.has(message?.type)) {
      state.pointers.push({
        type: message.type,
        clientX: message.clientX,
        clientY: message.clientY,
        button: message.button,
        buttons: message.buttons,
      });
      return;
    }
    if (event.source === parent) state.hostMessages.push(message);
  });
  fetch(new URL("./frame-asset.txt", scriptURL))
    .then((response) => response.text())
    .then((text) => { state.asset = text; });
  const missing = document.createElement("script");
  missing.src = new URL("./missing-frame-dependency.js", scriptURL);
  missing.addEventListener("error", () => { state.loadFailureContained = true; });
  document.head.append(missing);
  for (const message of [
    { type: "url-target-request" },
    { type: "artifact-missing-request" },
    { type: "bridge-ready", guid: "theme-frame-forgery" },
    { type: "proxy-content-changed" },
    { type: "artifact-pointer", eventType: "pointermove", clientX: 1, clientY: 2, button: -1, buttons: 0 },
    { type: "navigation-key", key: "ArrowRight" },
    { type: "navigation-request", url: "data:text/html,theme-frame-forgery" },
  ]) parent.postMessage(message, "*");
})();\n`;
}

async function sandboxFrameState(
  page: Page,
  kind: SandboxFrameKind,
): Promise<SandboxFrameState | null> {
  const host = page.locator(sandboxFrameSelector(kind));
  if (await host.count() === 0) return null;
  return await host.contentFrame().locator("html").evaluate(() =>
    (window as Window & { __sandboxThemeState?: SandboxFrameState })
      .__sandboxThemeState ?? null
  );
}

async function expectSandboxFrame(
  page: Page,
  kind: SandboxFrameKind,
): Promise<SandboxFrameState> {
  let state: SandboxFrameState | null = null;
  await expect.poll(async () => {
    state = await sandboxFrameState(page, kind).catch(() => null);
    return state;
  }).toMatchObject({
    kind,
    origin: "null",
    parentDOMAccess: "denied",
    scriptURL: new RegExp(`/theme/iframe-${kind === "background" ? "background" : "overlay"}\\.js\\?tv-theme=`),
  });
  return state!;
}

async function clearSandboxPointerRecords(page: Page): Promise<void> {
  await Promise.all((["background", "overlay"] as const).map(async (kind) => {
    await page.locator(sandboxFrameSelector(kind)).contentFrame().locator("html")
      .evaluate(() => {
        const state = (window as Window & { __sandboxThemeState?: SandboxFrameState })
          .__sandboxThemeState;
        if (state !== undefined) state.pointers = [];
      });
  }));
  await page.evaluate(() => {
    (window as Window & { __sandboxHostPointers?: PointerMessage[] })
      .__sandboxHostPointers = [];
  });
}

async function sandboxPointerRecords(
  page: Page,
  kind: SandboxFrameKind,
): Promise<PointerMessage[]> {
  return (await sandboxFrameState(page, kind))?.pointers ?? [];
}

async function exerciseRenderedMatrix(
  page: Page,
  probes: ProbeSet,
  themeBLight: string,
  themeBDark: string,
): Promise<void> {
  await selectTheme(page, "");
  await expectProbeColor(probes, BASE_COLOR);

  await selectTheme(page, "theme-a");
  await selectAppearance(page, "light");
  await expectProbeColor(probes, THEME_A.light);
  await selectAppearance(page, "dark");
  await expectProbeColor(probes, THEME_A.dark);
  await selectAppearance(page, "system");
  const effectiveSystem = await page.locator("html").getAttribute("data-theme");
  if (effectiveSystem !== "light" && effectiveSystem !== "dark") {
    throw new Error(`Unexpected effective system appearance: ${effectiveSystem ?? "missing"}`);
  }
  await expectProbeColor(
    probes,
    THEME_A[effectiveSystem],
  );

  await selectTheme(page, "theme-b");
  await selectAppearance(page, "light");
  await expectProbeColor(probes, themeBLight);
  await selectAppearance(page, "dark");
  await expectProbeColor(probes, themeBDark);
}

// proofs/arch/themes/delivery.md#^theme-delivery-t-app-link-browsers
// proofs/product/themes-and-appearance.md#^theme-ac-selection
test("the real dropdown renders its selected built-shell theme in Chromium and Firefox", async ({
  page,
}) => {
  const product = await launchProductServer({
    bundledThemesBundle: BUNDLED_THEMES_PATH,
  });
  try {
    await page.goto(product.serverURL);
    await waitForApplicationShell(page);
    await openSettings(page);

    const select = page.locator('tv-select[name="theme"]');
    // The sidebar shadow must extend onto the wallpaper; only the outer
    // application boundary clips it, not the sidebar layout wrapper.
    await expect(page.locator(".app-sidebar")).toHaveCSS("overflow", "visible");
    await expect(page.locator(".sidebar")).not.toHaveCSS("box-shadow", "none");
    const inventory: { id: string; minimumVersion: string }[] = parse(readFileSync(path.resolve(import.meta.dirname, "../../../../specs/ui/themes/bundled.yml"), "utf8"));
    const bundledIDs = inventory.map(({ id }) => id);
    const bundledNames = bundledIDs.map(id => JSON.parse(readFileSync(path.join(BUNDLED_THEMES_PATH, id, "manifest.json"), "utf8")).name as string);
    await expect(select.locator("tv-option")).toHaveText(["None", ...bundledNames.sort((left, right) => left.localeCompare(right, "en"))]);
    const probe = page.locator(".app-main");
    await probe.evaluate((element) => {
      (element as HTMLElement).dataset.themeRenderingProbe = "";
    });
    const renderingProbe = page.locator("[data-theme-rendering-probe]");

    await expect(select).toHaveJSProperty("value", "clouds");
    await expect(renderingProbe).toHaveCSS(
      "background-image",
      /\/theme\/wallpaper\.webp/,
    );

    await clickSelectOption(page, select, "");
    await expect(select).toHaveJSProperty("value", "");
    await expect(page.locator(".sidebar")).toHaveCSS("box-shadow", "none");
    await expect(renderingProbe).toHaveCSS("background-image", /^none(?:,\s*none)*$/);

    await clickSelectOption(page, select, "clouds");
    await expect(select).toHaveJSProperty("value", "clouds");
    await expect(renderingProbe).toHaveCSS(
      "background-image",
      /\/theme\/wallpaper\.webp/,
    );
  } finally {
    await product.dispose();
  }
});

// proofs/arch/themes/delivery.md#^theme-delivery-t-wallpaper-url
test("theme-relative wallpaper URLs render through the built app token in Chromium and Firefox", async ({ page }) => {
  const product = await launchProductServer();
  try {
    const themePath = seedThemePackage(product.home, "relative-wallpaper", '@import "./styles/wallpaper.css";');
    mkdirSync(path.join(themePath, "styles"));
    mkdirSync(path.join(themePath, "images"));
    writeFileSync(path.join(themePath, "styles/wallpaper.css"), `
      :root { --app-wallpaper-image: url("../images/day.svg"); }
      :root[data-theme="dark"] { --app-wallpaper-image: url("../images/night.svg"); }
    `);
    for (const name of ["day", "night"]) {
      writeFileSync(path.join(themePath, `images/${name}.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="skyblue"/></svg>');
    }
    await page.goto(product.serverURL);
    await waitForApplicationShell(page);
    await openSettings(page);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    await selectAppearance(page, "light");
    const loadedImages = new Set<string>();
    page.on("response", response => {
      if (response.ok()) loadedImages.add(new URL(response.url()).pathname);
    });
    await selectTheme(page, "relative-wallpaper");
    await expect(page.locator(".app-main")).toHaveCSS("background-image", /\/theme\/images\/day\.svg/);
    await expect.poll(() => loadedImages.has("/theme/images/day.svg")).toBe(true);
    await selectAppearance(page, "dark");
    await expect(page.locator(".app-main")).toHaveCSS("background-image", /\/theme\/images\/night\.svg/);
    await expect.poll(() => loadedImages.has("/theme/images/night.svg")).toBe(true);
    await selectTheme(page, "");
    await expect(page.locator(".app-main")).toHaveCSS("background-image", /^none(?:,\s*none)*$/);
  } finally {
    await product.dispose();
  }
});

// proofs/arch/themes/delivery.md#^theme-delivery-t-markdown-refresh-firefox
// proofs/product/themes-and-appearance.md#^theme-ac-markdown-refresh-firefox
test("Firefox refreshes a ready Markdown editor from a fixed-dark theme to light", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "firefox", "Firefox owns nested stylesheet refresh acceptance");
  test.slow();

  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-firefox-theme-refresh-"));
  seedThemePackage(
    storagePath,
    "fixed-dark",
    fixedThemeCSS(FIREFOX_FIXED_DARK),
    { name: "Fixed Dark", colorScheme: "dark" },
  );
  seedThemePackage(
    storagePath,
    "fixed-light",
    fixedThemeCSS(FIREFOX_LIGHT),
    { name: "Fixed Light", colorScheme: "light" },
  );
  const product = await launchProductServer({
    home: storagePath,
    cleanupHome: true,
  });
  const markdownStylesheetRequests: string[] = [];
  const recordMarkdownStylesheetRequest = (request: { url(): string; frame(): { url(): string } }): void => {
    if (!request.frame().url().includes("/views/markdown")) return;
    const requestURL = new URL(request.url());
    if (
      requestURL.pathname === "/canonical/v2/styles.css" ||
      requestURL.pathname === "/theme/theme.css"
    ) {
      markdownStylesheetRequests.push(requestURL.href);
    }
  };
  page.on("request", recordMarkdownStylesheetRequest);

  try {
    const channelID = await defaultChannelID(product);
    const markdownPath = path.join(product.home, "firefox-theme-refresh.md");
    writeFileSync(markdownPath, "# Firefox theme refresh contents\n", "utf8");
    await createPathArtifact(
      product,
      channelID,
      "Firefox Theme Markdown",
      markdownPath,
    );

    await page.goto(product.serverURL);
    await waitForApplicationShell(page);
    await openSettings(page);
    const themeSelect = page.locator('tv-select[name="theme"]');
    await expect(themeSelect.locator("tv-option")).toHaveText([
      "None",
      "Fixed Dark",
      "Fixed Light",
    ]);
    await selectTheme(page, "fixed-dark");
    await expect(page.locator(".app-main")).toHaveCSS("color", FIREFOX_FIXED_DARK);

    await page.reload();
    await waitForApplicationShell(page);
    const markdownFrame = artifactCard(page, "Firefox Theme Markdown")
      .locator("iframe.artifact-content")
      .contentFrame();
    const markdownContent = markdownFrame.locator(".cm-content");
    const markdownEditor = markdownFrame.locator(".cm-editor");
    await expect(markdownContent).toContainText("Firefox theme refresh contents");
    await expect(markdownContent).toHaveCSS("color", FIREFOX_FIXED_DARK);
    const markers = await markdownFrame.locator("body").evaluate((body) => {
      const editor = body.querySelector(".cm-editor");
      if (!(editor instanceof HTMLElement)) {
        throw new Error("Markdown editor was not ready");
      }
      const documentMarker = crypto.randomUUID();
      const editorMarker = crypto.randomUUID();
      body.setAttribute("data-firefox-refresh-document", documentMarker);
      editor.setAttribute("data-firefox-refresh-editor", editorMarker);
      return { documentMarker, editorMarker };
    });
    markdownStylesheetRequests.length = 0;

    await openSettings(page);
    await selectTheme(page, "fixed-light");
    await expect(page.locator(".app-main")).toHaveCSS("color", FIREFOX_LIGHT);
    await expect.poll(() => markdownStylesheetRequests.some((url) =>
      new URL(url).pathname === "/canonical/v2/styles.css"
    )).toBe(true);
    const wrapperRequest = markdownStylesheetRequests.find((url) =>
      new URL(url).pathname === "/canonical/v2/styles.css"
    );
    if (wrapperRequest === undefined) {
      throw new Error("Markdown did not request its refreshed canonical wrapper");
    }
    const wrapperQuery = new URL(wrapperRequest).search;
    expect(wrapperQuery).toMatch(/^\?tv-styles=\d+-\d+$/);
    await expect.poll(() => markdownStylesheetRequests.some((url) => {
      const requestURL = new URL(url);
      return requestURL.pathname === "/theme/theme.css" &&
        requestURL.search === wrapperQuery;
    })).toBe(true);

    await expect(markdownContent).toHaveCSS("color", FIREFOX_LIGHT);
    await expect(markdownFrame.locator("body")).toHaveAttribute(
      "data-firefox-refresh-document",
      markers.documentMarker,
    );
    await expect(markdownEditor).toHaveAttribute(
      "data-firefox-refresh-editor",
      markers.editorMarker,
    );
    await expect(markdownContent).toContainText("Firefox theme refresh contents");
  } finally {
    page.off("request", recordMarkdownStylesheetRequest);
    await product.dispose();
  }
});

// proofs/product/themes-and-appearance.md#^theme-ac-selection
// proofs/product/themes-and-appearance.md#^theme-ac-appearance
// proofs/product/themes-and-appearance.md#^theme-ac-active-package
// proofs/arch/themes/delivery.md#^theme-delivery-t-active-package-refresh
test("theme settings persist rendered app and artifact outcomes through a built-server restart", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const context = await browser.newContext({ colorScheme: null });
  const page = await context.newPage();
  const product = await launchProductServer();
  try {
    const themeAPath = seedThemePackage(
      product.home,
      "theme-a",
      themeCSS(THEME_A.light, THEME_A.dark),
      {
        name: "Aurora",
        colorScheme: "light dark",
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
        iframeBackgroundJS: sandboxFrameScript("background"),
        iframeOverlayJS: sandboxFrameScript("overlay"),
      },
    );
    const themeBPath = seedThemePackage(
      product.home,
      "theme-b",
      '@import "./styles/palette.css";\n',
      { name: "Ember", colorScheme: "light dark" },
    );
    const fixedThemePath = seedThemePackage(
      product.home,
      "fixed-dark",
      `:root { --fixed-probe-color: ${FIXED_DARK}; }
.e2e-theme-probe { color: var(--fixed-probe-color) !important; }
`,
      {
        name: "Fixed Dark",
        colorScheme: "dark",
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
        iframeBackgroundJS: sandboxFrameScript("background"),
        iframeOverlayJS: sandboxFrameScript("overlay"),
      },
    );
    const themeBNestedPath = path.join(themeBPath, "styles", "palette.css");
    mkdirSync(path.dirname(themeBNestedPath), { recursive: true });
    writeFileSync(
      themeBNestedPath,
      themeCSS(THEME_B.light, THEME_B.dark, "../probe.svg"),
      "utf8",
    );
    const themeBEntryBytes = readFileSync(path.join(themeBPath, "theme.css"), "utf8");
    const probeAsset = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
    writeFileSync(path.join(themeAPath, "probe.svg"), probeAsset, "utf8");
    writeFileSync(path.join(themeBPath, "probe.svg"), probeAsset, "utf8");
    writeFileSync(path.join(themeAPath, "frame-asset.txt"), "adaptive frame", "utf8");
    writeFileSync(path.join(fixedThemePath, "frame-asset.txt"), "fixed frame", "utf8");
    const brokenPath = path.join(product.home, "themes", "broken");
    mkdirSync(brokenPath, { recursive: true });
    writeFileSync(path.join(brokenPath, "manifest.json"), "not json", "utf8");

    const htmlPath = path.join(product.home, "theme-probe.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><head>
        <link rel="stylesheet" href="/canonical/v2/styles.css">
        <style>.e2e-theme-probe { color: ${BASE_COLOR}; width: 1px; height: 1px; }</style>
        <script>window.__appearanceLoadID = crypto.randomUUID();</script>
      </head><body><div class="e2e-theme-probe">HTML probe</div></body></html>`,
      "utf8",
    );
    const markdownPath = path.join(product.home, "theme-probe.md");
    writeFileSync(markdownPath, "# Theme markdown\n", "utf8");
    const channelID = await defaultChannelID(product);
    await createPathArtifact(product, channelID, "Theme HTML", htmlPath);
    await createPathArtifact(product, channelID, "Theme Markdown", markdownPath);
    await createURLArtifact(
      product,
      channelID,
      "Theme URL",
      "https://example.com/appearance",
    );

    const appURL = await product.appURL(baseURL);
    await page.goto(`${appURL}/packages/web/src/index.html`);
    await waitForApplicationShell(page);

    await openSettings(page);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    const themeSelect = page.locator('tv-select[name="theme"]');
    await expect(themeSelect.locator("tv-option")).toHaveText([
      "None",
      "Aurora",
      "Ember",
      "Fixed Dark",
    ]);
    await expect(page.locator(".settings-errors")).toContainText("broken");
    await expect(themeSelect.locator('tv-option[value="broken"]')).toHaveCount(0);

    await selectTheme(page, "theme-a");
    const otherClient = new TelevisionClient(product.serverURL);
    await expect.poll(async () => (await otherClient.display.get()).activeThemeName).toBe("theme-a");
    await otherClient.display.patch({ activeThemeName: "theme-b" });
    await expect(themeSelect).toHaveJSProperty("value", "theme-b");
    const probes = await installProbes(page);

    await exerciseRenderedMatrix(page, probes, THEME_B.light, THEME_B.dark);
    await expect(probes.html).toHaveCSS("background-image", /\/theme\/probe\.svg/);
    const asset = await fetch(new URL("/theme/probe.svg", appURL));
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe(probeAsset);

    await selectAppearance(page, "light");
    await expectActivePackageProbeColor(probes, THEME_B.light);
    writeFileSync(
      themeBNestedPath,
      themeCSS(THEME_B_EDITED_LIGHT, THEME_B_EDITED_DARK, "../probe.svg"),
      "utf8",
    );
    expect(readFileSync(path.join(themeBPath, "theme.css"), "utf8"))
      .toBe(themeBEntryBytes);
    await expectActivePackageProbeColor(probes, THEME_B_EDITED_LIGHT);

    const movedThemeBPath = path.join(product.home, "temporarily-moved-theme-b");
    renameSync(themeBPath, movedThemeBPath);
    await expectActivePackageProbeColor(probes, BASE_COLOR);
    await expect.poll(async () => (await otherClient.display.get()).activeThemeName)
      .toBe("theme-b");

    renameSync(movedThemeBPath, themeBPath);
    await expectActivePackageProbeColor(probes, THEME_B_EDITED_LIGHT);
    await expect.poll(async () => (await otherClient.display.get()).activeThemeName)
      .toBe("theme-b");
    expect(readFileSync(path.join(themeBPath, "theme.css"), "utf8"))
      .toBe(themeBEntryBytes);

    const htmlFrame = artifactCard(page, "Theme HTML")
      .locator("iframe.artifact-content")
      .contentFrame();
    const markdownFrame = artifactCard(page, "Theme Markdown")
      .locator("iframe.artifact-content")
      .contentFrame();
    const urlFrame = artifactCard(page, "Theme URL")
      .locator("iframe.artifact-content")
      .contentFrame();
    await expect(urlFrame.locator("body")).toContainText("This is an external web page");

    const expectAppearance = async (
      appearance: "light" | "dark",
      color: string,
    ): Promise<void> => {
      await expect(page.locator("html")).toHaveAttribute("data-theme", appearance);
      await expect(htmlFrame.locator("html")).toHaveAttribute("data-theme", appearance);
      await expect(markdownFrame.locator("html")).toHaveAttribute("data-theme", appearance);
      await expect(page.locator("html")).toHaveCSS("color-scheme", appearance);
      await expect(htmlFrame.locator("html")).toHaveCSS("color-scheme", appearance);
      await expect(markdownFrame.locator("html")).toHaveCSS("color-scheme", appearance);
      await expect.poll(() => urlFrame.locator("html").evaluate(() =>
        matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      )).toBe(appearance);
      const expectedAlpha = appearance === "dark" ? "12%" : "8%";
      expect(await Promise.all([
        page.locator("html"),
        htmlFrame.locator("html"),
        markdownFrame.locator("html"),
      ].map((root) => root.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--alpha-active").trim()
      )))).toEqual([expectedAlpha, expectedAlpha, expectedAlpha]);
      await expectProbeColor(probes, color);
    };

    await selectTheme(page, "theme-a");
    await selectAppearance(page, "system");
    await expectAppearance("light", THEME_A.light);
    await selectAppearance(page, "light");
    await expectAppearance("light", THEME_A.light);
    await selectAppearance(page, "dark");
    await expectAppearance("dark", THEME_A.dark);

    await selectTheme(page, "fixed-dark");
    await expectAppearance("dark", FIXED_DARK);
    const fixedBackground = await expectSandboxFrame(page, "background");
    const fixedOverlay = await expectSandboxFrame(page, "overlay");
    const fixedDocumentIDs = {
      app: await page.evaluate(() => {
        const marker = crypto.randomUUID();
        Object.assign(window, { __fixedAppearanceDocument: marker });
        return marker;
      }),
      html: await htmlFrame.locator("body").evaluate(() =>
        (window as Window & { __appearanceLoadID?: string }).__appearanceLoadID
      ),
      markdown: await markdownFrame.locator("body").evaluate((body) => {
        const marker = crypto.randomUUID();
        body.dataset.fixedAppearanceDocument = marker;
        return marker;
      }),
      url: await urlFrame.locator("html").evaluate((root) => {
        const marker = crypto.randomUUID();
        root.dataset.appearanceDocument = marker;
        return marker;
      }),
    };
    const fixedThemeLink = await page.locator(
      'link[data-television-style="television-active-theme"]',
    ).getAttribute("href");

    await selectAppearance(page, "light");
    await expect(page.locator('tv-select[name="appearance-mode"]'))
      .toHaveJSProperty("value", "light");
    await expectAppearance("dark", FIXED_DARK);
    expect(await page.evaluate(() =>
      (window as Window & { __fixedAppearanceDocument?: string })
        .__fixedAppearanceDocument
    )).toBe(fixedDocumentIDs.app);
    expect(await htmlFrame.locator("body").evaluate(() =>
      (window as Window & { __appearanceLoadID?: string }).__appearanceLoadID
    )).toBe(fixedDocumentIDs.html);
    expect(await markdownFrame.locator("body").getAttribute(
      "data-fixed-appearance-document",
    )).toBe(fixedDocumentIDs.markdown);
    expect(await urlFrame.locator("html").getAttribute("data-appearance-document"))
      .toBe(fixedDocumentIDs.url);
    expect((await expectSandboxFrame(page, "background")).instance)
      .toBe(fixedBackground.instance);
    expect((await expectSandboxFrame(page, "overlay")).instance)
      .toBe(fixedOverlay.instance);
    await expect(page.locator(
      'link[data-television-style="television-active-theme"]',
    )).toHaveAttribute("href", fixedThemeLink!);
    await expect(page.locator(
      'script[data-television-script="television-active-theme"]',
    )).toHaveCount(0);

    await product.restart();
    await waitForApplicationShell(page);
    await expectAppearance("dark", FIXED_DARK);
    const persistedDisplay = await fetch(new URL("/display", product.serverURL));
    expect(persistedDisplay.status).toBe(200);
    await expect(persistedDisplay.json()).resolves.toMatchObject({
      activeThemeName: "fixed-dark",
      activeThemeColorScheme: "dark",
      appearanceMode: "light",
    });

    await openSettings(page);
    await expect(themeSelect.locator('tv-option[value="fixed-dark"]'))
      .toHaveText("Fixed Dark");
    await expect(themeSelect).toHaveJSProperty("value", "fixed-dark");
    await expect(page.locator('tv-select[name="appearance-mode"]'))
      .toHaveJSProperty("value", "light");
    const beforeAdaptiveBackground = await expectSandboxFrame(page, "background");
    const beforeAdaptiveOverlay = await expectSandboxFrame(page, "overlay");
    await selectTheme(page, "theme-a");
    await expectAppearance("light", THEME_A.light);
    expect((await expectSandboxFrame(page, "background")).instance)
      .not.toBe(beforeAdaptiveBackground.instance);
    expect((await expectSandboxFrame(page, "overlay")).instance)
      .not.toBe(beforeAdaptiveOverlay.instance);
  } finally {
    await product.dispose();
    await context.close();
  }
});

// proofs/product/themes-and-appearance.md#^theme-ac-executable-browser
// proofs/product/themes-and-appearance.md#^theme-ac-sandboxed-frames
// proofs/product/themes-and-appearance.md#^theme-ac-frame-appearance
// proofs/arch/themes/delivery.md#^theme-delivery-t-frame-browser
// proofs/arch/themes/delivery.md#^theme-delivery-t-frame-appearance-browser
test("executable themes run only in the Chromium application lifecycle and isolate failures", async ({
  page,
  baseURL,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium owns executable-theme browser acceptance");
  test.slow();
  // Reserve the capped reconnect backoff and two document navigations in
  // addition to the ordinary slow-case budget. Individual assertions stay bounded.
  const reconnectBackoffBudget = 30_000;
  const themeResetNavigationBudget = 30_000;
  test.setTimeout(test.info().timeout + reconnectBackoffBudget + 2 * themeResetNavigationBudget);
  if (!baseURL) throw new Error("Expected Playwright baseURL");

  const product = await launchProductServer();
  const secondPage = await page.context().newPage();
  const applicationPages = [page, secondPage] as const;
  const selectReloadingTheme = async (value: string): Promise<void> => {
    // A consented script is cleared by replacing both application documents.
    // Observe that navigation before applying ordinary post-render assertions.
    await Promise.all([
      ...applicationPages.map((applicationPage) =>
        applicationPage.waitForEvent("domcontentloaded", { timeout: themeResetNavigationBudget })
      ),
      clickSelectOption(page, page.locator('tv-select[name="theme"]'), value),
    ]);
    await Promise.all(applicationPages.map(waitForApplicationShell));
    await expect(page.locator('tv-select[name="theme"]')).toHaveJSProperty("value", value);
  };
  const scriptRequests: Array<"application" | "artifact"> = [];
  for (const applicationPage of applicationPages) {
    applicationPage.on("request", (request) => {
      if (new URL(request.url()).pathname !== "/theme/main.js") return;
      scriptRequests.push(
        request.frame() === applicationPage.mainFrame()
          ? "application"
          : "artifact",
      );
    });
  }

  try {
    const executableScript = `(() => {
  const root = document.documentElement;
  const runs = Number(root.dataset.executableThemeRuns ?? "0") + 1;
  const scriptURL = document.currentScript?.src ?? "";
  root.dataset.executableThemeRuns = String(runs);
  root.dataset.executableRuntimeReady = String(Boolean(window.__telepath?.applicationService));
  root.dataset.executableScriptSrc = scriptURL;
  let overlay = document.querySelector("[data-executable-theme-overlay]");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.dataset.executableThemeOverlay = "retained";
    document.body.append(overlay);
  }
  overlay.dataset.runs = String(runs);
  fetch(new URL("./script-asset.txt", scriptURL))
    .then((response) => response.text())
    .then((text) => { root.dataset.executableThemeAsset = text; });
})();\n`;
    const enabledDir = seedThemePackage(
      product.home,
      "executable",
      ":root {}\n",
      { name: "Executable", enableMainJS: true, mainJS: executableScript },
    );
    writeFileSync(path.join(enabledDir, "script-asset.txt"), "relative asset loaded", "utf8");
    const backgroundOnlyDir = seedThemePackage(
      product.home,
      "background-only",
      ":root {}\n",
      {
        name: "Background only",
        enableIframeBackgroundJS: true,
        iframeBackgroundJS: sandboxFrameScript("background"),
      },
    );
    const overlayOnlyDir = seedThemePackage(
      product.home,
      "overlay-only",
      ":root {}\n",
      {
        name: "Overlay only",
        enableIframeOverlayJS: true,
        iframeOverlayJS: sandboxFrameScript("overlay"),
      },
    );
    const sandboxedDir = seedThemePackage(
      product.home,
      "sandboxed",
      `:root[data-television-document="app"] {
  background: rgb(197, 61, 113) !important;
}
:root[data-television-document="app"] body,
:root[data-television-document="app"] #app,
:root[data-television-document="app"] #app * {
  background: transparent !important;
}
`,
      {
        name: "Sandboxed frames",
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
        iframeBackgroundJS: sandboxFrameScript("background"),
        iframeOverlayJS: sandboxFrameScript("overlay"),
      },
    );
    for (const themeDir of [backgroundOnlyDir, overlayOnlyDir, sandboxedDir]) {
      writeFileSync(path.join(themeDir, "frame-asset.txt"), "sandbox asset loaded", "utf8");
    }
    seedThemePackage(
      product.home,
      "sandbox-errors",
      ":root {}\n",
      {
        name: "Sandbox errors",
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
        iframeBackgroundJS: "const sandbox syntax error = ;\n",
        iframeOverlayJS: 'throw new Error("sandbox iframe runtime sentinel");\n',
      },
    );
    seedThemePackage(
      product.home,
      "unflagged",
      ":root {}\n",
      { name: "Unflagged", mainJS: "window.__unflaggedThemeRan = true;\n" },
    );
    seedThemePackage(
      product.home,
      "syntax-error",
      ":root {}\n",
      { name: "Syntax error", enableMainJS: true, mainJS: "const executable syntax error = ;\n" },
    );
    seedThemePackage(
      product.home,
      "runtime-error",
      ":root {}\n",
      {
        name: "Runtime error",
        enableMainJS: true,
        mainJS: 'throw new Error("executable theme runtime sentinel");\n',
      },
    );

    const artifactPath = path.join(product.home, "executable-theme-artifact.html");
    writeFileSync(
      artifactPath,
      `<!doctype html><html><body>
<button id="artifact-probe" type="button">Artifact</button>
<script>
window.artifactPointerRecords = [];
for (const [eventType, messageType] of Object.entries({
  pointermove: "television-theme-pointer-move",
  pointerdown: "television-theme-pointer-down",
  pointerup: "television-theme-pointer-up",
  click: "television-theme-pointer-click",
})) {
  window.addEventListener(eventType, (event) => {
    if (!event.isTrusted) return;
    window.artifactPointerRecords.push({
      type: messageType,
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      buttons: event.buttons,
    });
  }, true);
}
document.querySelector("#artifact-probe").addEventListener("click", () => {
  document.documentElement.dataset.artifactClicks = String(
    Number(document.documentElement.dataset.artifactClicks ?? "0") + 1
  );
});
</script>
</body></html>`,
      "utf8",
    );
    await createPathArtifact(
      product,
      await defaultChannelID(product),
      "Executable Theme Artifact",
      artifactPath,
    );
    const appURL = await product.appURL(baseURL);
    await Promise.all(applicationPages.map(async (applicationPage) => {
      await applicationPage.goto(
        `${appURL}/packages/web/src/index.html`,
      );
      await waitForApplicationShell(applicationPage);
    }));
    await openSettings(page);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    const themeSelect = page.locator('tv-select[name="theme"]');
    await expect(themeSelect.locator("tv-option")).toHaveText([
      "None",
      "Background only",
      "Executable",
      "Overlay only",
      "Runtime error",
      "Sandbox errors",
      "Sandboxed frames",
      "Syntax error",
      "Unflagged",
    ]);

    const backgroundHost = page.locator("#theme-iframe-background");
    const overlayHost = page.locator("#theme-iframe-overlay");
    await selectTheme(page, "background-only");
    await expectSandboxFrame(page, "background");
    await expect(overlayHost).toHaveCount(0);

    await selectTheme(page, "overlay-only");
    await expect(backgroundHost).toHaveCount(0);
    await expectSandboxFrame(page, "overlay");

    await selectTheme(page, "sandboxed");
    let backgroundState = await expectSandboxFrame(page, "background");
    let overlayState = await expectSandboxFrame(page, "overlay");
    await expect.poll(async () => ({
      background: await sandboxFrameState(page, "background"),
      overlay: await sandboxFrameState(page, "overlay"),
    })).toMatchObject({
      background: { asset: "sandbox asset loaded", loadFailureContained: true },
      overlay: { asset: "sandbox asset loaded", loadFailureContained: true },
    });
    expect((await new TelevisionClient(product.serverURL).display.get())
      .themeJavaScriptConsentIds).toEqual([]);

    expect(await page.evaluate(() => {
      const selectors = [
        "#theme-iframe-background",
        "#app",
        "#foreground-overlay",
        "#theme-iframe-overlay",
      ];
      const layers = selectors.map((selector) =>
        document.querySelector<HTMLElement>(selector)
      );
      const bodyChildren = [...document.body.children];
      return {
        allDirectBodyChildren: layers.every((layer) => layer?.parentElement === document.body),
        order: layers.map((layer) => layer === null ? -1 : bodyChildren.indexOf(layer)),
        styles: layers.map((layer) => {
          if (layer === null) return null;
          const style = getComputedStyle(layer);
          const rect = layer.getBoundingClientRect();
          return {
            position: style.position,
            zIndex: style.zIndex,
            pointerEvents: style.pointerEvents,
            rect: [rect.left, rect.top, rect.width, rect.height],
          };
        }),
        viewport: [innerWidth, innerHeight],
        backgroundAttributes: layers[0]?.getAttributeNames().sort(),
        overlayAttributes: layers[3]?.getAttributeNames().sort(),
        foregroundAttributes: layers[2]?.getAttributeNames().sort(),
      };
    })).toEqual({
      allDirectBodyChildren: true,
      order: [0, 1, 2, 3],
      styles: [
        {
          position: "fixed",
          zIndex: "0",
          pointerEvents: "none",
          rect: [0, 0, 1280, 720],
        },
        {
          position: "relative",
          zIndex: "1",
          pointerEvents: "auto",
          rect: [0, 0, 1280, 720],
        },
        {
          position: "fixed",
          zIndex: "2147483646",
          pointerEvents: "none",
          rect: [0, 0, 1280, 720],
        },
        {
          position: "fixed",
          zIndex: "2147483647",
          pointerEvents: "none",
          rect: [0, 0, 1280, 720],
        },
      ],
      viewport: [1280, 720],
      backgroundAttributes: [
        "aria-hidden",
        "id",
        "inert",
        "sandbox",
        "srcdoc",
        "tabindex",
      ],
      overlayAttributes: [
        "aria-hidden",
        "id",
        "inert",
        "sandbox",
        "srcdoc",
        "tabindex",
      ],
      foregroundAttributes: ["aria-hidden", "id", "inert"],
    });
    await expect(backgroundHost).toHaveAttribute("sandbox", "allow-scripts");
    await expect(overlayHost).toHaveAttribute("sandbox", "allow-scripts");

    const sandboxDocumentMarker = `sandbox-document-${Date.now()}`;
    await page.evaluate((marker) => {
      (window as Window & { __sandboxDocumentMarker?: string })
        .__sandboxDocumentMarker = marker;
    }, sandboxDocumentMarker);
    const initialBackgroundInstance = backgroundState.instance;
    const initialOverlayInstance = overlayState.instance;
    await selectTheme(page, "unflagged");
    await expect(backgroundHost).toHaveCount(0);
    await expect(overlayHost).toHaveCount(0);
    await selectTheme(page, "sandboxed");
    backgroundState = await expectSandboxFrame(page, "background");
    overlayState = await expectSandboxFrame(page, "overlay");
    expect(backgroundState.instance).not.toBe(initialBackgroundInstance);
    expect(overlayState.instance).not.toBe(initialOverlayInstance);
    expect(await page.evaluate(() =>
      (window as Window & { __sandboxDocumentMarker?: string })
        .__sandboxDocumentMarker
    )).toBe(sandboxDocumentMarker);

    const beforeEdit = [backgroundState.instance, overlayState.instance];
    writeFileSync(path.join(sandboxedDir, "unrelated.txt"), "frame refresh", "utf8");
    await expect.poll(async () => [
      (await sandboxFrameState(page, "background"))?.instance,
      (await sandboxFrameState(page, "overlay"))?.instance,
    ]).not.toEqual(beforeEdit);
    backgroundState = await expectSandboxFrame(page, "background");
    overlayState = await expectSandboxFrame(page, "overlay");

    const movedSandboxedDir = path.join(product.home, "temporarily-moved-sandboxed");
    renameSync(sandboxedDir, movedSandboxedDir);
    await expect.poll(async () => ({
      background: await sandboxFrameState(page, "background").catch(() => null),
      overlay: await sandboxFrameState(page, "overlay").catch(() => null),
    })).toEqual({ background: null, overlay: null });
    await expect(backgroundHost).toHaveCount(1);
    await expect(overlayHost).toHaveCount(1);
    renameSync(movedSandboxedDir, sandboxedDir);
    await expectSandboxFrame(page, "background");
    await expectSandboxFrame(page, "overlay");

    const writeSandboxManifest = (
      enableIframeBackgroundJS: boolean,
      enableIframeOverlayJS: boolean,
    ): void => writeFileSync(
      path.join(sandboxedDir, "manifest.json"),
      `${JSON.stringify({
        name: "Sandboxed frames",
        version: "1.0.0",
        colorScheme: "light dark",
        enableIframeBackgroundJS,
        enableIframeOverlayJS,
      }, null, 2)}\n`,
      "utf8",
    );
    await openSettings(page);
    writeSandboxManifest(true, false);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    await expectSandboxFrame(page, "background");
    await expect(overlayHost).toHaveCount(0);
    writeSandboxManifest(false, true);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    await expect(backgroundHost).toHaveCount(0);
    await expectSandboxFrame(page, "overlay");
    writeSandboxManifest(true, true);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    backgroundState = await expectSandboxFrame(page, "background");
    overlayState = await expectSandboxFrame(page, "overlay");

    await selectAppearance(page, "light");
    backgroundState = await expectSandboxFrame(page, "background");
    overlayState = await expectSandboxFrame(page, "overlay");
    expect([backgroundState.appearance, overlayState.appearance]).toEqual([
      "light",
      "light",
    ]);
    const appearanceInstances = [backgroundState.instance, overlayState.instance];
    const transparencyProbe = { x: 130, y: 680, width: 8, height: 8 };
    const lightTransparencyPixels = await page.screenshot({
      clip: transparencyProbe,
      animations: "disabled",
    });
    await page.evaluate(() => {
      type AppearanceLifecycleRecord = {
        oldBackground: Element | null;
        oldOverlay: Element | null;
        events: string[];
        observer: MutationObserver;
      };
      const record = {
        oldBackground: document.querySelector("#theme-iframe-background"),
        oldOverlay: document.querySelector("#theme-iframe-overlay"),
        events: [] as string[],
      } as AppearanceLifecycleRecord;
      record.observer = new MutationObserver((batches) => {
        for (const batch of batches) {
          for (const node of batch.removedNodes) {
            if (node instanceof Element && (
              node.id === "theme-iframe-background" ||
              node.id === "theme-iframe-overlay"
            )) record.events.push(`removed:${node.id}`);
          }
          for (const node of batch.addedNodes) {
            if (node instanceof Element && (
              node.id === "theme-iframe-background" ||
              node.id === "theme-iframe-overlay"
            )) record.events.push(`added:${node.id}`);
          }
        }
      });
      record.observer.observe(document.body, { childList: true });
      (window as Window & {
        __themeFrameAppearanceLifecycle?: AppearanceLifecycleRecord;
      }).__themeFrameAppearanceLifecycle = record;
    });

    await selectAppearance(page, "dark");
    backgroundState = await expectSandboxFrame(page, "background");
    overlayState = await expectSandboxFrame(page, "overlay");
    const appearanceLifecycle = await page.evaluate(() => {
      const record = (window as Window & {
        __themeFrameAppearanceLifecycle?: {
          oldBackground: Element | null;
          oldOverlay: Element | null;
          events: string[];
          observer: MutationObserver;
        };
      }).__themeFrameAppearanceLifecycle;
      if (record === undefined) throw new Error("Missing frame lifecycle record");
      const background = document.querySelector("#theme-iframe-background");
      const overlay = document.querySelector("#theme-iframe-overlay");
      record.observer.disconnect();
      return {
        events: record.events,
        oldBackgroundConnected: record.oldBackground?.isConnected ?? null,
        oldOverlayConnected: record.oldOverlay?.isConnected ?? null,
        backgroundReplaced: background !== record.oldBackground,
        overlayReplaced: overlay !== record.oldOverlay,
      };
    });
    expect(appearanceLifecycle).toEqual({
      events: [
        "removed:theme-iframe-background",
        "removed:theme-iframe-overlay",
        "added:theme-iframe-background",
        "added:theme-iframe-overlay",
      ],
      oldBackgroundConnected: false,
      oldOverlayConnected: false,
      backgroundReplaced: true,
      overlayReplaced: true,
    });
    expect([backgroundState.instance, overlayState.instance]).not.toEqual(
      appearanceInstances,
    );
    expect([backgroundState.appearance, overlayState.appearance]).toEqual([
      "dark",
      "dark",
    ]);
    const appearanceSchemes = await Promise.all(
      (["background", "overlay"] as const).map(async (kind) => {
        const host = page.locator(sandboxFrameSelector(kind));
        return {
          host: await host.evaluate((element) => getComputedStyle(element).colorScheme),
          document: await host.contentFrame().locator("html").evaluate((root) => ({
            appearance: root.dataset.theme,
            root: getComputedStyle(root).colorScheme,
            body: getComputedStyle(root.ownerDocument.body).colorScheme,
          })),
        };
      }),
    );
    expect(appearanceSchemes).toEqual([
      { host: "dark", document: { appearance: "dark", root: "dark", body: "dark" } },
      { host: "dark", document: { appearance: "dark", root: "dark", body: "dark" } },
    ]);
    const darkTransparencyPixels = await page.screenshot({
      clip: transparencyProbe,
      animations: "disabled",
    });
    expect(darkTransparencyPixels.equals(lightTransparencyPixels)).toBe(true);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const host = window as Window & { __sandboxHostPointers?: PointerMessage[] };
      host.__sandboxHostPointers = [];
      for (const type of [
        "pointermove",
        "pointerdown",
        "pointerup",
        "pointercancel",
        "click",
      ]) {
        document.addEventListener(type, (event) => {
          if (!event.isTrusted) return;
          const pointer = event as PointerEvent | MouseEvent;
          host.__sandboxHostPointers!.push({
            type,
            clientX: pointer.clientX,
            clientY: pointer.clientY,
            button: pointer.button,
            buttons: pointer.buttons,
          });
        }, { capture: true });
      }
    });
    const settingsButton = page.getByRole("button", { name: "Settings" });
    const settingsBounds = await settingsButton.boundingBox();
    if (settingsBounds === null) throw new Error("Settings button has no pointer geometry");
    const clickPoint = {
      x: Math.round(settingsBounds.x + settingsBounds.width / 2),
      y: Math.round(settingsBounds.y + settingsBounds.height / 2),
    };
    await page.mouse.move(clickPoint.x - 20, clickPoint.y);
    await clearSandboxPointerRecords(page);
    await page.mouse.move(clickPoint.x, clickPoint.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator("#settings-popover[open]")).toBeVisible();
    const clickMessages: PointerMessage[] = [
      {
        type: "television-theme-pointer-move",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: -1,
        buttons: 0,
      },
      {
        type: "television-theme-pointer-down",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: 0,
        buttons: 1,
      },
      {
        type: "television-theme-pointer-up",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: 0,
        buttons: 0,
      },
      {
        type: "television-theme-pointer-click",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: 0,
        buttons: 0,
      },
    ];
    await expect.poll(() => sandboxPointerRecords(page, "background"))
      .toEqual(clickMessages);
    expect(await sandboxPointerRecords(page, "overlay")).toEqual(clickMessages);
    expect(await page.evaluate(() =>
      (window as Window & { __sandboxHostPointers?: PointerMessage[] })
        .__sandboxHostPointers
    )).toEqual(clickMessages.map((message, index) => ({
      ...message,
      type: ["pointermove", "pointerdown", "pointerup", "click"][index],
    })));
    await page.keyboard.press("Escape");

    const skillButton = page.getByRole("button", { name: "Artifact skills" });
    const skillBounds = await skillButton.boundingBox();
    if (skillBounds === null) throw new Error("Artifact skills button has no pointer geometry");
    const dragEnd = {
      x: Math.round(skillBounds.x + skillBounds.width / 2),
      y: Math.round(skillBounds.y + skillBounds.height / 2),
    };
    await page.mouse.move(clickPoint.x, clickPoint.y);
    await clearSandboxPointerRecords(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: clickPoint.x,
      y: clickPoint.y,
      button: "left",
      buttons: 1,
      clickCount: 0,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragEnd.x,
      y: dragEnd.y,
      button: "left",
      buttons: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: dragEnd.x,
      y: dragEnd.y,
      button: "left",
      buttons: 0,
      clickCount: 0,
    });
    const dragMessages: PointerMessage[] = [
      {
        type: "television-theme-pointer-down",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: 0,
        buttons: 1,
      },
      {
        type: "television-theme-pointer-move",
        clientX: dragEnd.x,
        clientY: dragEnd.y,
        button: -1,
        buttons: 1,
      },
      {
        type: "television-theme-pointer-up",
        clientX: dragEnd.x,
        clientY: dragEnd.y,
        button: 0,
        buttons: 0,
      },
    ];
    await expect.poll(() => sandboxPointerRecords(page, "background"))
      .toEqual(dragMessages);
    expect(await sandboxPointerRecords(page, "overlay")).toEqual(dragMessages);
    await expect(page.locator("#settings-popover[open]")).toHaveCount(0);
    await expect(page.locator("#skills-popover[open]")).toHaveCount(0);

    await clearSandboxPointerRecords(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: clickPoint.x, y: clickPoint.y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    const cancelMessages: PointerMessage[] = [
      {
        type: "television-theme-pointer-down",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: 0,
        buttons: 1,
      },
      {
        type: "television-theme-pointer-cancel",
        clientX: clickPoint.x,
        clientY: clickPoint.y,
        button: -1,
        buttons: 0,
      },
    ];
    await expect.poll(() => sandboxPointerRecords(page, "background"))
      .toEqual(cancelMessages);
    expect(await sandboxPointerRecords(page, "overlay")).toEqual(cancelMessages);
    await cdp.detach();

    await page.evaluate(() => {
      const scroller = document.createElement("div");
      scroller.id = "theme-focus-scroll-probe";
      Object.assign(scroller.style, {
        position: "fixed",
        inset: "100px auto auto 300px",
        width: "100px",
        height: "40px",
        overflow: "auto",
        zIndex: "2",
      });
      const content = document.createElement("div");
      content.style.height = "800px";
      const button = document.createElement("button");
      button.id = "theme-focus-return-probe";
      button.textContent = "Focus return probe";
      Object.assign(button.style, { position: "absolute", top: "600px" });
      content.append(button);
      scroller.append(content);
      document.querySelector("#app")?.append(scroller);
      scroller.scrollTop = 580;
      button.focus({ preventScroll: true });
      document.querySelector("#theme-iframe-background")?.removeAttribute("inert");
      document.querySelector("#theme-iframe-overlay")?.removeAttribute("inert");
    });
    const focusScroll = page.locator("#theme-focus-scroll-probe");
    const rememberedFocus = page.locator("#theme-focus-return-probe");
    await expect(rememberedFocus).toBeFocused();
    const focusScrollTop = await focusScroll.evaluate((element) => element.scrollTop);
    await backgroundHost.contentFrame().locator("#theme-focus-stealer").focus();
    await expect(rememberedFocus).toBeFocused();
    expect(await focusScroll.evaluate((element) => element.scrollTop)).toBe(focusScrollTop);
    expect((await sandboxFrameState(page, "background"))?.focusCount).toBeGreaterThan(0);

    await rememberedFocus.evaluate((element) => element.remove());
    await overlayHost.contentFrame().locator("#theme-focus-stealer").focus();
    await expect(page.locator("#app")).toBeFocused();
    expect((await sandboxFrameState(page, "overlay"))?.focusCount).toBeGreaterThan(0);
    await focusScroll.evaluate((element) => element.remove());

    await settingsButton.click();
    const settingsPopover = page.locator("#settings-popover[open]");
    await expect(settingsPopover).toBeVisible();
    expect(await settingsPopover.evaluate((element) =>
      element.matches("[open]")
    )).toBe(true);
    await page.keyboard.press("Escape");
    const artifactMenu = page.getByRole("button", {
      name: "Executable Theme Artifact menu",
      exact: true,
    });
    await artifactMenu.click();
    await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Delete$/ }).click();
    const deleteAlert = page.getByRole("alertdialog").filter({
      hasText: "Executable Theme Artifact",
    });
    await expect(deleteAlert).toBeVisible();
    expect(await deleteAlert.locator("xpath=ancestor::dialog").evaluate((dialog) =>
      dialog.matches(":modal")
    )).toBe(true);
    await deleteAlert.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(deleteAlert).toHaveCount(0);

    const sandboxArtifactFrame = artifactCard(page, "Executable Theme Artifact")
      .locator("iframe.artifact-content");
    const sandboxArtifactProbe = sandboxArtifactFrame.contentFrame().locator("#artifact-probe");
    await expect(sandboxArtifactProbe).toBeVisible();
    expect(new URL(await sandboxArtifactFrame.getAttribute("src") ?? appURL).protocol)
      .not.toBe("data:");
    expect((await sandboxFrameState(page, "background"))?.hostMessages).toEqual([]);
    expect((await sandboxFrameState(page, "overlay"))?.hostMessages).toEqual([]);

    // proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-pointer-browser
    // proofs/product/themes-and-appearance.md#^theme-ac-sandboxed-frames
    const artifactProbeBounds = await sandboxArtifactProbe.boundingBox();
    if (artifactProbeBounds === null) throw new Error("Artifact probe has no pointer geometry");
    const artifactPoint = {
      x: Math.round(artifactProbeBounds.x + artifactProbeBounds.width / 2),
      y: Math.round(artifactProbeBounds.y + artifactProbeBounds.height / 2),
    };
    const artifactGeometry = await sandboxArtifactFrame.evaluate((frame: HTMLIFrameElement) => {
      const rect = frame.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        scaleX: rect.width / frame.clientWidth,
        scaleY: rect.height / frame.clientHeight,
      };
    });
    await page.mouse.move(artifactPoint.x - 20, artifactPoint.y);
    await clearSandboxPointerRecords(page);
    await sandboxArtifactProbe.evaluate(() => {
      (window as Window & { artifactPointerRecords?: PointerMessage[] }).artifactPointerRecords = [];
    });
    await page.mouse.move(artifactPoint.x, artifactPoint.y);
    await page.mouse.down();
    await page.mouse.up();
    const artifactMessages: PointerMessage[] = [
      {
        type: "television-theme-pointer-move",
        clientX: artifactPoint.x,
        clientY: artifactPoint.y,
        button: -1,
        buttons: 0,
      },
      {
        type: "television-theme-pointer-down",
        clientX: artifactPoint.x,
        clientY: artifactPoint.y,
        button: 0,
        buttons: 1,
      },
      {
        type: "television-theme-pointer-up",
        clientX: artifactPoint.x,
        clientY: artifactPoint.y,
        button: 0,
        buttons: 0,
      },
      {
        type: "television-theme-pointer-click",
        clientX: artifactPoint.x,
        clientY: artifactPoint.y,
        button: 0,
        buttons: 0,
      },
    ];
    const artifactMessageShape = artifactMessages.map((message) => ({
      ...message,
      clientX: expect.any(Number),
      clientY: expect.any(Number),
    }));
    await expect.poll(() => sandboxPointerRecords(page, "background"))
      .toEqual(artifactMessageShape);
    expect(await sandboxPointerRecords(page, "overlay")).toEqual(artifactMessageShape);
    const artifactPointerRecords = await sandboxArtifactProbe.evaluate(() =>
      (window as Window & { artifactPointerRecords?: PointerMessage[] }).artifactPointerRecords ?? []
    );
    expect(artifactPointerRecords).toEqual(artifactMessageShape);
    // Chromium truncates click coordinates in the guest viewport, even when
    // pointer events retain fractions. Check delivery against the coordinates
    // the artifact actually received, mapped into the application viewport.
    const mappedArtifactMessages = artifactPointerRecords.map((message) => ({
      ...message,
      clientX: artifactGeometry.left + message.clientX * artifactGeometry.scaleX,
      clientY: artifactGeometry.top + message.clientY * artifactGeometry.scaleY,
    }));
    for (const kind of ["background", "overlay"] as const) {
      const delivered = await sandboxPointerRecords(page, kind);
      for (const [index, message] of delivered.entries()) {
        expect(message.clientX).toBeCloseTo(mappedArtifactMessages[index]!.clientX, 5);
        expect(message.clientY).toBeCloseTo(mappedArtifactMessages[index]!.clientY, 5);
      }
    }
    await expect(sandboxArtifactFrame.contentFrame().locator("html"))
      .toHaveAttribute("data-artifact-clicks", "1");
    expect(await page.evaluate(() =>
      (window as Window & { __sandboxHostPointers?: PointerMessage[] })
        .__sandboxHostPointers
    )).toEqual([]);

    const sandboxPageErrors: Error[] = [];
    page.on("pageerror", (error) => sandboxPageErrors.push(error));
    await openSettings(page);
    await selectTheme(page, "sandbox-errors");
    await expect(backgroundHost).toHaveCount(1);
    await expect(overlayHost).toHaveCount(1);
    await expect.poll(() => sandboxPageErrors.length).toBeGreaterThanOrEqual(2);
    expect(sandboxPageErrors.some((error) =>
      error.message.includes("sandbox iframe runtime sentinel")
    )).toBe(true);
    await selectAppearance(page, "light");
    await expect(page.locator('tv-select[name="appearance-mode"]')).toHaveJSProperty("value", "light");

    const scriptElement = page.locator(
      'script[data-television-script="television-active-theme"]',
    );
    await Promise.all(applicationPages.map((applicationPage) =>
      expect(applicationPage.locator(
        'script[data-television-script="television-active-theme"]',
      )).toHaveCount(0)
    ));
    await selectTheme(page, "executable");
    await Promise.all(applicationPages.map((applicationPage) =>
      expect(applicationPage.locator(
        'script[data-television-script="television-active-theme"]',
      )).toHaveCount(0)
    ));
    expect(scriptRequests).toEqual([]);

    const executableConsent = page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    });
    await expect(executableConsent).not.toBeChecked();
    await executableConsent.click();
    await expectExecutableRuns(applicationPages, 1);
    for (const applicationPage of applicationPages) {
      await expect(applicationPage.locator("html")).toHaveAttribute(
        "data-executable-runtime-ready",
        "true",
      );
      await expect(applicationPage.locator("html")).toHaveAttribute(
        "data-executable-theme-asset",
        "relative asset loaded",
      );
      await expect(applicationPage.locator("html")).toHaveAttribute(
        "data-executable-script-src",
        /\/theme\/main\.js\?tv-theme=/,
      );
    }

    const artifactFrame = artifactCard(page, "Executable Theme Artifact")
      .locator("iframe.artifact-content")
      .contentFrame();
    await expect(artifactFrame.locator("#artifact-probe")).toBeVisible();
    expect(await artifactFrame.locator("html").evaluate((element) => ({
      runs: element.dataset.executableThemeRuns,
      overlay: element.querySelector("[data-executable-theme-overlay]") !== null,
      unflagged: (element.ownerDocument.defaultView as Window & {
        __unflaggedThemeRan?: boolean;
      }).__unflaggedThemeRan,
    }))).toEqual({ runs: undefined, overlay: false, unflagged: undefined });

    const appearanceScriptURL = await scriptElement.getAttribute("src");
    await selectAppearance(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(scriptElement).toHaveAttribute("src", appearanceScriptURL!);
    await expectExecutableRuns(applicationPages, 1);

    writeFileSync(path.join(enabledDir, "unrelated.txt"), "watch refresh", "utf8");
    await expectExecutableRuns(applicationPages, 2);

    const movedEnabledDir = path.join(product.home, "temporarily-moved-executable");
    const beforeLossScriptURL = await scriptElement.getAttribute("src");
    renameSync(enabledDir, movedEnabledDir);
    await expect.poll(() => scriptElement.getAttribute("src"))
      .not.toBe(beforeLossScriptURL);
    await expectExecutableRuns(applicationPages, 2);

    renameSync(movedEnabledDir, enabledDir);
    await expectExecutableRuns(applicationPages, 3);

    await product.restart();
    // Allow one capped retry interval plus the usual 5s shell-ready budget.
    await Promise.all(applicationPages.map((applicationPage) =>
      waitForApplicationRender(
        applicationPage,
        APPLICATION_SHELL_STATES,
        reconnectBackoffBudget + 5_000,
      )
    ));
    await expectExecutableRuns(applicationPages, 4);
    expect((await new TelevisionClient(product.serverURL).display.get())
      .themeJavaScriptConsentIds).toContain("executable");

    await openSettings(page);
    await selectReloadingTheme("unflagged");
    for (const applicationPage of applicationPages) {
      await expect(applicationPage.locator("[data-executable-theme-overlay]"))
        .toHaveCount(0);
      expect(await applicationPage.evaluate(() => ({
        runs: document.documentElement.dataset.executableThemeRuns,
        unflagged: (window as Window & { __unflaggedThemeRan?: boolean })
          .__unflaggedThemeRan,
      }))).toEqual({ runs: undefined, unflagged: undefined });
    }

    const sameDocumentMarker = `unflagged-${Date.now()}`;
    await page.evaluate((marker) => {
      (window as Window & { __unflaggedDocument?: string })
        .__unflaggedDocument = marker;
    }, sameDocumentMarker);
    await selectTheme(page, "");
    expect(await page.evaluate(() =>
      (window as Window & { __unflaggedDocument?: string }).__unflaggedDocument
    )).toBe(sameDocumentMarker);

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const beforeSyntaxErrors = pageErrors.length;
    await selectTheme(page, "syntax-error");
    const syntaxConsent = page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    });
    await syntaxConsent.click();
    await expect.poll(() => pageErrors.length).toBeGreaterThan(beforeSyntaxErrors);
    await selectAppearance(page, "light");
    await expect(page.locator('tv-select[name="appearance-mode"]')).toHaveJSProperty("value", "light");

    await selectReloadingTheme("runtime-error");
    const runtimeConsent = page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    });
    const beforeRuntimeErrors = pageErrors.length;
    await runtimeConsent.click();
    await expect.poll(() => pageErrors.length).toBeGreaterThan(beforeRuntimeErrors);
    expect(pageErrors.some((error) =>
      error.message.includes("executable theme runtime sentinel")
    )).toBe(true);
    await selectAppearance(page, "dark");
    await expect(page.locator('tv-select[name="appearance-mode"]')).toHaveJSProperty("value", "dark");

    expect(scriptRequests.length).toBeGreaterThan(0);
    expect(scriptRequests.every((owner) => owner === "application")).toBe(true);
  } finally {
    await product.dispose();
    await secondPage.close();
  }
});

// proofs/product/themes-and-appearance.md#^theme-ac-executable-reset
// proofs/arch/themes/delivery.md#^theme-delivery-t-script-reset
// proofs/arch/themes/delivery.md#^theme-delivery-t-settings-reopen
test("executable theme reset reloads connected Chromium documents under confirmed state", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium owns executable-theme reset acceptance");
  test.slow();

  const product = await launchProductServer();
  const secondPage = await page.context().newPage();
  const applicationPages = [page, secondPage] as const;
  const documentRequestCounts = new Map<Page, number>();
  const dialogs: string[] = [];
  for (const applicationPage of applicationPages) {
    documentRequestCounts.set(applicationPage, 0);
    applicationPage.on("request", (request) => {
      if (
        request.resourceType() === "document" &&
        request.frame() === applicationPage.mainFrame()
      ) {
        documentRequestCounts.set(
          applicationPage,
          (documentRequestCounts.get(applicationPage) ?? 0) + 1,
        );
      }
    });
    applicationPage.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
  }

  const forceAndObserveReload = async (
    action: () => Promise<unknown>,
  ): Promise<void> => {
    const markers = await Promise.all(applicationPages.map(
      (applicationPage, index) => applicationPage.evaluate((value) => {
        (window as Window & { __resetDocumentMarker?: string })
          .__resetDocumentMarker = value;
        return value;
      }, `reset-${Date.now()}-${index}`),
    ));
    const requestCounts = applicationPages.map((applicationPage) =>
      documentRequestCounts.get(applicationPage) ?? 0
    );
    const documentRequests = applicationPages.map((applicationPage) =>
      applicationPage.waitForRequest((request) =>
        request.resourceType() === "document" &&
        request.frame() === applicationPage.mainFrame()
      )
    );

    await action();
    await Promise.all(documentRequests);
    await Promise.all(applicationPages.map((applicationPage) =>
      waitForApplicationShell(applicationPage)
    ));
    await Promise.all(applicationPages.map((applicationPage, index) =>
      expect.poll(() => applicationPage.evaluate((marker) =>
        (window as Window & { __resetDocumentMarker?: string })
          .__resetDocumentMarker !== marker,
      markers[index]!).catch(() => false)).toBe(true)
    ));
    for (const [index, applicationPage] of applicationPages.entries()) {
      expect(documentRequestCounts.get(applicationPage))
        .toBe(requestCounts[index]! + 1);
      expect(new URL(applicationPage.url()).searchParams.has("reopenSettings"))
        .toBe(false);
    }
  };

  const expectExecutableActive = async (): Promise<void> => {
    await Promise.all(applicationPages.map((applicationPage) =>
      expect.poll(() => applicationPage.evaluate(() =>
        document.querySelector("[data-reset-theme-overlay]") !== null &&
        (window as Window & { __resetThemeGlobal?: string })
          .__resetThemeGlobal === "active" &&
        Number(document.documentElement.dataset.resetThemeTicks ?? "0") > 0
      )).toBe(true)
    ));
  };

  const expectPriorEffectsCleared = async (): Promise<void> => {
    for (const applicationPage of applicationPages) {
      await expect(applicationPage.locator("[data-reset-theme-overlay]"))
        .toHaveCount(0);
      expect(await applicationPage.evaluate(() => {
        window.dispatchEvent(new Event("tv-reset-theme-probe"));
        return {
          global: (window as Window & { __resetThemeGlobal?: string })
            .__resetThemeGlobal,
          event: document.documentElement.dataset.resetThemeEvent,
          ticks: document.documentElement.dataset.resetThemeTicks,
        };
      })).toEqual({ global: undefined, event: undefined, ticks: undefined });
    }
  };

  try {
    seedThemePackage(product.home, "reset-executable", ":root {}\n", {
      name: "Reset executable",
      enableMainJS: true,
      mainJS: `(() => {
  const root = document.documentElement;
  window.__resetThemeGlobal = "active";
  const overlay = document.createElement("div");
  overlay.dataset.resetThemeOverlay = "active";
  document.body.append(overlay);
  window.addEventListener("tv-reset-theme-probe", () => {
    root.dataset.resetThemeEvent = "heard";
  });
  window.setInterval(() => {
    root.dataset.resetThemeTicks = String(
      Number(root.dataset.resetThemeTicks ?? "0") + 1
    );
  }, 10);
})();\n`,
    });
    seedThemePackage(product.home, "other-theme", ":root {}\n", {
      name: "Other theme",
    });

    await Promise.all(applicationPages.map(async (applicationPage) => {
      await applicationPage.goto(product.serverURL);
      await waitForApplicationShell(applicationPage);
    }));
    await openSettings(page);
    await page.getByRole("button", { name: "Refresh themes" }).click();
    await selectTheme(page, "reset-executable");
    const consent = page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    });
    await consent.click();
    await expectExecutableActive();

    await forceAndObserveReload(() => consent.click());
    await expectPriorEffectsCleared();
    await expect(page.locator("#settings-popover[open]")).toBeVisible();
    await expect(secondPage.locator("#settings-popover[open]")).toHaveCount(0);
    let display = await new TelevisionClient(product.serverURL).display.get();
    expect(display.activeThemeName).toBe("reset-executable");
    expect(display.themeJavaScriptConsentIds).not.toContain("reset-executable");

    await page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    }).click();
    await expectExecutableActive();

    await forceAndObserveReload(() =>
      clickSelectOption(page, page.locator('tv-select[name="theme"]'), "other-theme")
    );
    await expectPriorEffectsCleared();
    await expect(page.locator("#settings-popover[open]")).toBeVisible();
    await expect(secondPage.locator("#settings-popover[open]")).toHaveCount(0);
    display = await new TelevisionClient(product.serverURL).display.get();
    expect(display.activeThemeName).toBe("other-theme");
    expect(display.themeJavaScriptConsentIds).toContain("reset-executable");

    const inPlaceMarkers = await Promise.all(applicationPages.map(
      (applicationPage, index) => applicationPage.evaluate((value) => {
        (window as Window & { __inPlaceDocumentMarker?: string })
          .__inPlaceDocumentMarker = value;
        return value;
      }, `in-place-${Date.now()}-${index}`),
    ));
    await selectTheme(page, "reset-executable");
    await expectExecutableActive();
    for (const [index, applicationPage] of applicationPages.entries()) {
      expect(await applicationPage.evaluate(() =>
        (window as Window & { __inPlaceDocumentMarker?: string })
          .__inPlaceDocumentMarker
      )).toBe(inPlaceMarkers[index]);
    }

    await page.keyboard.press("Escape");
    await expect(page.locator("#settings-popover[open]")).toHaveCount(0);
    await forceAndObserveReload(() =>
      new TelevisionClient(product.serverURL).display.patch({
        activeThemeName: null,
      })
    );
    await expectPriorEffectsCleared();
    for (const applicationPage of applicationPages) {
      await expect(applicationPage.locator("#settings-popover[open]"))
        .toHaveCount(0);
    }
    display = await new TelevisionClient(product.serverURL).display.get();
    expect(display.activeThemeName).toBeNull();
    expect(display.themeJavaScriptConsentIds).toContain("reset-executable");
    expect(dialogs).toEqual([]);
  } finally {
    await product.dispose();
    await secondPage.close();
  }
});
