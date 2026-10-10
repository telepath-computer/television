import type { Locator, Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";
import { waitForApplicationShell } from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/settings.html";

async function openFixture(page: Page, appURL: string): Promise<void> {
  await page.goto(`${appURL}${FIXTURE}`);
  await page.waitForFunction(() =>
    (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true
  );
  await page.waitForFunction(() => {
    const application = (window as unknown as {
      __settingsApplication?: { snapshot: { ready: boolean; connection: { status: string } } };
    }).__settingsApplication;
    return application?.snapshot.ready === true &&
      application.snapshot.connection.status === "connected";
  });
}

async function choose(page: Page, trigger: Locator, value: string): Promise<void> {
  const triggerID = await trigger.getAttribute("id");
  await trigger.click();
  await page.locator(`tv-select[trigger="${triggerID}"]`).locator(`tv-option[value="${value}"]`).click();
  await expect(page.locator("#settings-popover[open]")).toBeVisible();
}

function popoverOpen(page: Page, selector: string) {
  return page.locator(`${selector}[open]`);
}

// proofs/ui/app/settings/index.md#^settings-ac-browser
test("settings controls cross the registry and confirmed display state", async ({ page, baseURL }) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-settings-component-"));
  seedThemePackage(storagePath, "cobalt", "/* cobalt */\n", { name: "Cobalt" });
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const otherClient = new TelevisionClient(serverURL);
    await otherClient.display.patch({ appearanceMode: "light" });
    await openFixture(page, appURL);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(popoverOpen(page, "#settings-popover")).toBeVisible();
    const appearance = page.getByLabel("Light/dark mode");
    const theme = page.getByLabel("Theme", { exact: true });
    await expect(appearance).toHaveText("Light");
    await expect(page.locator('tv-select[trigger="settings-theme"] tv-option')).toHaveText(["None", "Cobalt"]);

    await choose(page, appearance, "dark");
    await expect.poll(async () => (await otherClient.display.get()).appearanceMode).toBe("dark");
    await expect(appearance).toHaveText("Dark");

    await choose(page, theme, "cobalt");
    await expect.poll(async () => (await otherClient.display.get()).activeThemeName).toBe("cobalt");
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as {
        __settingsApplication: { snapshot: { display: { activeThemeName: string | null } } };
      }).__settingsApplication.snapshot.display.activeThemeName
    )).toBe("cobalt");
    await expect(theme).toHaveText("Cobalt");

    seedThemePackage(storagePath, "amber", "/* amber */\n", { name: "Amber" });
    seedThemePackage(storagePath, ".hidden-valid", "/* hidden */\n", { name: "Hidden valid" });
    const broken = path.join(storagePath, "themes", "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(path.join(broken, "theme.css"), "/* broken */\n", "utf8");
    const hiddenBroken = path.join(storagePath, "themes", ".hidden-broken");
    mkdirSync(hiddenBroken, { recursive: true });
    writeFileSync(path.join(hiddenBroken, "theme.css"), "/* hidden broken */\n", "utf8");

    await page.getByRole("button", { name: "Refresh themes" }).click();
    await expect(page.locator('tv-select[trigger="settings-theme"] tv-option')).toHaveText(["None", "Amber", "Cobalt"]);
    await expect(page.locator(".settings-errors")).toContainText(
      "broken: cannot read manifest.json",
    );
    await expect(page.locator(".settings-errors")).not.toContainText("hidden");

    await otherClient.display.patch({ activeThemeName: "amber" });
    await expect(theme).toHaveText("Amber");
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

// proofs/ui/app/settings/index.md#^settings-ac-javascript-consent
test("settings provides confirmed executable-theme JavaScript consent", async ({
  page,
  baseURL,
}) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-settings-consent-"));
  seedThemePackage(storagePath, "Executable.ID", "/* executable */\n", {
    name: "Executable",
    enableMainJS: true,
    mainJS: "document.documentElement.dataset.settingsFixtureScript = 'ran';\n",
  });
  seedThemePackage(storagePath, "iframe-only", "/* iframe only */\n", {
    name: "Iframe only",
    enableIframeBackgroundJS: true,
    iframeBackgroundJS: "document.documentElement.dataset.iframeOnly = 'ran';\n",
  });
  seedThemePackage(storagePath, "main-disabled", "/* main disabled */\n", {
    name: "Main disabled",
    enableMainJS: false,
    mainJS: "document.documentElement.dataset.disabledMain = 'ran';\n",
  });
  seedThemePackage(storagePath, "main-unflagged", "/* main unflagged */\n", {
    name: "Main unflagged",
    mainJS: "document.documentElement.dataset.unflaggedMain = 'ran';\n",
  });
  seedThemePackage(storagePath, "ordinary", "/* ordinary */\n", {
    name: "Ordinary",
  });
  const store = createServingStore(storagePath);
  const originalPatchDisplay = store.patchDisplay.bind(store);
  let failConsentWrite = false;
  store.patchDisplay = ((input, telemetryContext) => {
    if (failConsentWrite && input.themeJavaScriptConsentIds !== undefined) {
      throw new Error("forced consent failure");
    }
    return originalPatchDisplay(input, telemetryContext);
  }) as typeof store.patchDisplay;
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const otherClient = new TelevisionClient(serverURL);
    await otherClient.display.patch({ activeThemeName: "Executable.ID" });
    await openFixture(page, appURL);

    expect(await page.locator(".settings-javascript-consent").count()).toBe(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(popoverOpen(page, "#settings-popover")).toBeVisible();

    const disclosure = page.locator(".settings-javascript-disclosure");
    await expect(disclosure).toHaveText(
      "This theme uses experimental JavaScript. JavaScript can access your Television content, so only enable for themes you trust or have had your agent inspect.",
    );
    const consent = page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    });
    await expect(consent).toHaveValue("Executable.ID");
    await expect(consent).not.toBeChecked();
    const geometry = await consent.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        radius: Number.parseFloat(style.borderRadius),
      };
    });
    expect(geometry).toMatchObject({ width: 32, height: 18 });
    expect(geometry.radius).toBeGreaterThanOrEqual(geometry.height / 2);

    await consent.click();
    await expect.poll(async () =>
      (await otherClient.display.get()).themeJavaScriptConsentIds
    ).toEqual(["Executable.ID"]);
    await expect(consent).toBeChecked();

    await consent.focus();
    await page.keyboard.press("Space");
    await expect.poll(async () =>
      (await otherClient.display.get()).themeJavaScriptConsentIds
    ).toEqual([]);
    await expect(consent).not.toBeChecked();

    await otherClient.display.patch({
      themeJavaScriptConsentIds: ["Executable.ID"],
    });
    await expect(consent).toBeChecked();

    failConsentWrite = true;
    await consent.click();
    await expect(page.getByRole("alert")).toContainText(
      "Unable to change theme JavaScript consent: Internal Server Error",
    );
    await expect(consent).toBeChecked();
    expect((await otherClient.display.get()).themeJavaScriptConsentIds)
      .toEqual(["Executable.ID"]);
    failConsentWrite = false;

    for (const activeThemeName of [
      "iframe-only",
      "main-disabled",
      "main-unflagged",
      "ordinary",
    ]) {
      await otherClient.display.patch({ activeThemeName });
      await expect(page.locator(".settings-javascript-consent")).toHaveCount(0);
    }
    await otherClient.display.patch({ activeThemeName: null });
    await expect(page.locator(".settings-javascript-consent")).toHaveCount(0);

    await otherClient.display.patch({ activeThemeName: "Executable.ID" });
    await expect(consent).toBeChecked();
    await page.locator("#outside").click();
    await expect(popoverOpen(page, "#settings-popover")).toHaveCount(0);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(consent).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(popoverOpen(page, "#settings-popover")).toHaveCount(0);
    expect((await otherClient.display.get()).themeJavaScriptConsentIds)
      .toEqual(["Executable.ID"]);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

// proofs/ui/app/settings/index.md#^settings-ac-javascript-consent
test("theme consent opt-out reload restores open Settings once", async ({
  page,
  baseURL,
}) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-settings-reset-"));
  seedThemePackage(storagePath, "executable", "/* executable */\n", {
    name: "Executable",
    enableMainJS: true,
    mainJS: `document.documentElement.dataset.settingsExecutableRuns = String(
  Number(document.documentElement.dataset.settingsExecutableRuns ?? "0") + 1
);\n`,
  });
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const client = new TelevisionClient(serverURL);
    await client.display.patch({ activeThemeName: "executable" });
    await page.goto(
      `${appURL}/packages/web/src/index.html`,
    );
    await waitForApplicationShell(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const panel = popoverOpen(page, "#settings-popover");
    await expect(panel).toBeVisible();
    const consent = page.getByRole("switch", {
      name: "Enable experimental javascript for this theme",
    });
    await consent.click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-settings-executable-runs",
      "1",
    );
    await expect(consent).toBeChecked();

    const documentMarker = `before-reset-${Date.now()}`;
    await page.evaluate((marker) => {
      document.documentElement.dataset.settingsResetDocument = marker;
    }, documentMarker);
    let mainDocumentRequests = 0;
    page.on("request", (request) => {
      if (
        request.resourceType() === "document" &&
        request.frame() === page.mainFrame()
      ) mainDocumentRequests += 1;
    });
    const reloadRequest = page.waitForRequest((request) =>
      request.resourceType() === "document" &&
      request.frame() === page.mainFrame()
    );

    await consent.click();
    await reloadRequest;
    await waitForApplicationShell(page);
    await expect.poll(() => page.evaluate((marker) =>
      document.documentElement.dataset.settingsResetDocument !== marker,
    documentMarker).catch(() => false)).toBe(true);
    await expect(popoverOpen(page, "#settings-popover")).toBeVisible();
    expect(new URL(page.url()).searchParams.has("reopenSettings")).toBe(false);
    await expect(page.locator(
      'script[data-television-script="television-active-theme"]',
    )).toHaveCount(0);
    expect((await client.display.get()).themeJavaScriptConsentIds).toEqual([]);
    expect(mainDocumentRequests).toBe(1);
    expect(dialogs).toEqual([]);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

test("settings and skills retain native light dismissal", async ({ page, baseURL }) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-settings-dismissal-"));
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const client = new TelevisionClient(serverURL);
    await openFixture(page, appURL);
    const before = await client.display.get();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(popoverOpen(page, "#settings-popover")).toBeVisible();
    await page.getByRole("button", { name: "Artifact skills" }).click();
    await expect(popoverOpen(page, "#settings-popover")).toHaveCount(0);
    await expect(popoverOpen(page, "#skills-popover")).toBeVisible();

    await page.locator("#outside").click();
    await expect(popoverOpen(page, "#skills-popover")).toHaveCount(0);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(popoverOpen(page, "#settings-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popoverOpen(page, "#settings-popover")).toHaveCount(0);

    const after = await client.display.get();
    expect(after.activeThemeName).toBe(before.activeThemeName);
    expect(after.appearanceMode).toBe(before.appearanceMode);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});
