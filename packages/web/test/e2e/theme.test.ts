import type { Page } from "@playwright/test";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";
import { waitForApplicationShell } from "./helpers.ts";

const THEMED_BACKGROUND = "rgb(0, 255, 0)";
const HOT_RELOADED_BACKGROUNDS = [
  "rgb(255, 0, 255)",
  "rgb(0, 0, 255)",
  "rgb(255, 255, 0)",
] as const;
const FIRST_ARTIFACT_THEME_BACKGROUND = "rgb(17, 34, 51)";
const SECOND_ARTIFACT_THEME_BACKGROUND = "rgb(68, 85, 102)";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const HIND_FONT_PATH = path.join(
  REPO_ROOT,
  "canonical/styles/canonical/fonts/Hind-Variable.woff2",
);

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-theme-e2e-"));
}

function createCanonicalDirWithFont(): string {
  const canonicalDir = mkdtempSync(path.join(os.tmpdir(), "television-font-canonical-e2e-"));
  const versionDir = path.join(canonicalDir, "v2");
  const fontsDir = path.join(versionDir, "fonts");
  mkdirSync(fontsDir, { recursive: true });
  copyFileSync(HIND_FONT_PATH, path.join(fontsDir, "Hind-Variable.woff2"));
  writeFileSync(
    path.join(versionDir, "styles.css"),
    `@font-face {
  font-family: "TVProbeFont";
  src: url(/canonical/v2/fonts/Hind-Variable.woff2) format("woff2-variations");
  font-weight: 300 700;
  font-style: normal;
}
body { font-family: "TVProbeFont", serif; }
`,
    "utf8",
  );
  return canonicalDir;
}

function seedTheme(
  storagePath: string,
  name: string,
  css = ":root { --app-wallpaper: rgb(0, 255, 0); }\n",
): void {
  seedThemePackage(storagePath, name, css);
}

function writeThemeBackground(themePath: string, background: string): void {
  writeFileSync(themePath, `:root { --app-wallpaper: ${background}; }\n`, "utf8");
}

async function patchDisplayTheme(
  page: Page,
  appURL: string,
  token: string,
  activeThemeName: string | null,
): Promise<number> {
  return page.evaluate(
    async (
      {
        appURL: url,
        token: auth,
        activeThemeName: themeName,
      }: { appURL: string; token: string; activeThemeName: string | null },
    ) => {
      const response = await fetch(`${url}/display`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${auth}`,
        },
        body: JSON.stringify({ activeThemeName: themeName }),
      });
      return response.status;
    },
    { appURL, token, activeThemeName },
  );
}


test.describe("connected theme outcomes", () => {

test("direct-render artifact iframes can load canonical font files", async ({ page, baseURL }) => {
  const storagePath = createDataDir();
  const canonicalDir = createCanonicalDirWithFont();
  const artifactPath = path.join(storagePath, "font-probe.html");
  writeFileSync(artifactPath, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/canonical/v2/styles.css">
  </head>
  <body><main id="font-probe">Font probe</main></body>
</html>
`, "utf8");
  const store = createServingStore(storagePath);
  const channel = store.listChannels()[0]!;
  store.createArtifact({ kind: "path", title: "Font probe", path: artifactPath, channelID: channel.id });
  const server = new Server({ store, port: 0, canonicalDir });

  try {
    await server.start();
    const appURL = await appURLForServer(server.getBaseURL(), baseURL!);
    const token = server.getAuthToken();

    await page.goto(
      `${appURL}/packages/web/src/index.html?token=${encodeURIComponent(token)}`,
    );

    const frame = page.frameLocator(".artifact-view iframe.artifact-content");
    await expect(frame.locator("#font-probe")).toHaveText("Font probe");
    await expect.poll(() => frame.locator("body").evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "TVProbeFont"');
    })).toBe(true);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(canonicalDir, { recursive: true, force: true });
  }
});

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-visible-app
test("PATCH /display activeThemeName re-skins the connected TV app and clears on null", async ({
  page,
  baseURL,
}) => {
  const storagePath = createDataDir();
  seedTheme(storagePath, "test-theme");
  const store = createServingStore(storagePath);
  store.patchDisplay({ activeThemeName: null });
  const server = new Server({
    store,
    port: 0,
  });

  try {
    await server.start();
    const appURL = await appURLForServer(server.getBaseURL(), baseURL!);
    const token = server.getAuthToken();

    await page.goto(
      `${appURL}/packages/web/src/index.html?token=${encodeURIComponent(token)}`,
    );
    await waitForApplicationShell(page);

    const application = page.locator(".app-main");
    await expect(application).toBeVisible();
    // Wait for the null-theme link to apply before recording its baseline.
    await expect.poll(() => page.evaluate(() => {
      const link = document.querySelector<HTMLLinkElement>('link[data-television-style="television-active-theme"]');
      return link?.sheet !== null && link?.sheet !== undefined;
    })).toBe(true);
    const initialBackground = await application.evaluate(
      element => getComputedStyle(element).backgroundColor,
    );
    expect(initialBackground).not.toBe(THEMED_BACKGROUND);

    expect(await patchDisplayTheme(page, appURL, token, "test-theme")).toBe(204);
    await expect
      .poll(() =>
        page.locator(".app-main").evaluate(element => getComputedStyle(element).backgroundColor),
      )
      .toBe(THEMED_BACKGROUND);

    expect(await patchDisplayTheme(page, appURL, token, null)).toBe(204);
    await expect
      .poll(() =>
        page.locator(".app-main").evaluate(element => getComputedStyle(element).backgroundColor),
      )
      .toBe(initialBackground);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-visible-app
test("editing the active theme.css on disk re-skins the connected TV app without another PATCH", async ({
  page,
  baseURL,
}) => {
  const storagePath = createDataDir();
  seedTheme(storagePath, "test-theme");
  const themePath = path.join(storagePath, "themes", "test-theme", "theme.css");
  const server = new Server({
    store: createServingStore(storagePath),
    port: 0,
  });

  try {
    await server.start();
    const appURL = await appURLForServer(server.getBaseURL(), baseURL!);
    const token = server.getAuthToken();

    await page.goto(
      `${appURL}/packages/web/src/index.html?token=${encodeURIComponent(token)}`,
    );
    await waitForApplicationShell(page);

    expect(await patchDisplayTheme(page, appURL, token, "test-theme")).toBe(204);
    await expect
      .poll(() =>
        page.locator(".app-main").evaluate(element => getComputedStyle(element).backgroundColor),
      )
      .toBe(THEMED_BACKGROUND);

    for (const background of HOT_RELOADED_BACKGROUNDS) {
      writeThemeBackground(themePath, background);

      await expect
        .poll(
          () => page.locator(".app-main").evaluate(element => getComputedStyle(element).backgroundColor),
        )
        .toBe(background);
    }
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

// spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-theme-browser
test("PATCH /display activeThemeName reloads mounted artifact iframes so canonical styles pick up the new theme", async ({
  page,
  baseURL,
}) => {
  const storagePath = createDataDir();
  const canonicalDir = createCanonicalDirWithFont();
  seedTheme(
    storagePath,
    "theme-a",
    `:root { --color-bg: ${FIRST_ARTIFACT_THEME_BACKGROUND}; }\n`,
  );
  seedTheme(
    storagePath,
    "theme-b",
    `:root { --color-bg: ${SECOND_ARTIFACT_THEME_BACKGROUND}; }\n`,
  );
  const artifactPath = path.join(storagePath, "theme-probe.html");
  writeFileSync(artifactPath, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/canonical/v2/styles.css">
    <style>
      body {
        margin: 0;
        background: var(--color-bg);
      }
    </style>
  </head>
  <body>
    <main id="theme-probe">Theme probe</main>
  </body>
</html>
`, "utf8");
  const store = createServingStore(storagePath);
  const channel = store.listChannels()[0]!;
  store.createArtifact({ kind: "path", title: "Theme probe", path: artifactPath, channelID: channel.id });
  const server = new Server({
    store,
    port: 0,
    canonicalDir,
  });

  try {
    await server.start();
    const appURL = await appURLForServer(server.getBaseURL(), baseURL!);
    const token = server.getAuthToken();
    await page.goto(
      `${appURL}/packages/web/src/index.html?token=${encodeURIComponent(token)}`,
    );

    const iframe = page.locator(".artifact-view iframe.artifact-content");
    const frame = page.frameLocator(".artifact-view iframe.artifact-content");
    await expect(iframe).toBeVisible();
    await expect(frame.locator("#theme-probe")).toHaveText("Theme probe");

    const initialSrc = await iframe.getAttribute("src");
    if (!initialSrc) throw new Error("Expected initial artifact frame src");

    expect(await patchDisplayTheme(page, appURL, token, "theme-a")).toBe(204);
    await expect
      .poll(() => frame.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor))
      .toBe(FIRST_ARTIFACT_THEME_BACKGROUND);

    const firstReloadSrc = await iframe.getAttribute("src");
    if (!firstReloadSrc) throw new Error("Expected first theme reload src");
    expect(firstReloadSrc).not.toBe(initialSrc);
    expect(new URL(firstReloadSrc, page.url()).searchParams.get("tv-reload")).toBe("1");

    expect(await patchDisplayTheme(page, appURL, token, "theme-b")).toBe(204);
    await expect
      .poll(() => frame.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor))
      .toBe(SECOND_ARTIFACT_THEME_BACKGROUND);

    const secondReloadSrc = await iframe.getAttribute("src");
    if (!secondReloadSrc) throw new Error("Expected second theme reload src");
    expect(secondReloadSrc).not.toBe(firstReloadSrc);
    expect(new URL(secondReloadSrc, page.url()).searchParams.get("tv-reload")).toBe("2");
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(canonicalDir, { recursive: true, force: true });
  }
});

// spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-theme-remote-browser
test("PATCH /display activeThemeName leaves remote Television URL artifact documents loaded", async ({
  page,
  baseURL,
}) => {
  const producerStorage = createDataDir();
  const consumerStorage = createDataDir();
  seedTheme(consumerStorage, "consumer-theme");
  const remotePath = path.join(producerStorage, "remote-theme-probe.html");
  writeFileSync(remotePath, `<!doctype html>
<html>
  <body>
    <main id="remote-theme-probe">Remote theme probe</main>
    <script>
      window.name = String(Number(window.name || "0") + 1);
      document.body.dataset.loadCount = window.name;
    </script>
  </body>
</html>
`, "utf8");
  const producerStore = createServingStore(producerStorage);
  const producerChannel = producerStore.listChannels()[0]!;
  const producerArtifact = producerStore.createArtifact({
    kind: "path",
    title: "Remote theme probe source",
    path: remotePath,
    channelID: producerChannel.id,
  });
  const producer = new Server({ store: producerStore, port: 0 });
  const consumerStore = createServingStore(consumerStorage);
  const consumerChannel = consumerStore.listChannels()[0]!;
  const consumer = new Server({ store: consumerStore, port: 0 });

  try {
    await producer.start();
    const remoteURL = `${producer.getBaseURL()}/artifact/${producerArtifact.id}/${encodeURIComponent(path.basename(remotePath))}`;
    const remoteArtifact = consumerStore.createArtifact({
      kind: "url",
      title: "Remote theme probe",
      url: remoteURL,
      channelID: consumerChannel.id,
    });
    await consumer.start();
    const appURL = await appURLForServer(consumer.getBaseURL(), baseURL!);
    const token = consumer.getAuthToken();
    await page.goto(
      `${appURL}/packages/web/src/index.html?token=${encodeURIComponent(token)}`,
    );

    const iframe = page.locator(`.stage .page[data-page-key="${remoteArtifact.id}"] iframe.artifact-content`);
    const frame = page.frameLocator(`.stage .page[data-page-key="${remoteArtifact.id}"] iframe.artifact-content`);
    await expect(iframe).toHaveAttribute("src", remoteURL);
    await expect(frame.locator("#remote-theme-probe")).toHaveText("Remote theme probe");
    await expect(frame.locator("body")).toHaveAttribute("data-load-count", "1");

    expect(await patchDisplayTheme(page, appURL, token, "consumer-theme")).toBe(204);
    await expect.poll(() => page.evaluate(() => {
      const application = (window as unknown as {
        __telepath: { applicationService: { snapshot: { display: { activeThemeName: string | null } } } };
      }).__telepath.applicationService;
      return application.snapshot.display.activeThemeName;
    })).toBe("consumer-theme");
    await expect(iframe).toHaveAttribute("src", remoteURL);
    await expect(frame.locator("body")).toHaveAttribute("data-load-count", "1");
  } finally {
    await consumer.dispose();
    await producer.dispose();
    rmSync(consumerStorage, { recursive: true, force: true });
    rmSync(producerStorage, { recursive: true, force: true });
  }
});

});
