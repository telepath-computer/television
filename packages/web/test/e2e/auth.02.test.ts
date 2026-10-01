import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import {
  configureTestMotion,
  waitForApplicationShell,
} from "./helpers.ts";
import {
  observeApplicationPresentations,
  type ApplicationPresentationRecord,
} from "./application-presentation.helpers.ts";

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-auth-e2e-"));
}


test.describe("web auth modal integration", () => {
  test("electron mode with token query param skips the auth modal", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const server = new Server({
      store: createServingStore(storagePath),
      port: 0,
      auth: true,
    });

    try {
      await server.start();
      const serverURL = server.getBaseURL();
      const token = server.getAuthToken();

      await page.goto(
        `${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&mode=electron&token=${encodeURIComponent(token)}`,
      );

      await expect(page.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(page);
      await expect(page).toHaveURL(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&mode=electron`);
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
})

const SHELL_STATES = new Set(["connected", "no-channel", "empty-channel"]);

function expectSuccessfulAuthenticationHandoff(
  records: readonly ApplicationPresentationRecord[],
): void {
  const presentations = records.filter((record) => record.appState !== null);
  const firstUnauthorized = presentations.findIndex((record) =>
    record.appState === "unauthorized"
  );
  expect(firstUnauthorized).toBeGreaterThanOrEqual(0);
  expect(SHELL_STATES.has(presentations.at(-1)?.appState ?? "")).toBe(true);

  for (const record of presentations) {
    expect(
      record.appState === "connecting" ||
      record.appState === "unauthorized" ||
      SHELL_STATES.has(record.appState!),
    ).toBe(true);
    if (record.appState === "unauthorized") {
      expect(record).toMatchObject({
        shellRegionCount: 0,
        sidebarCount: 0,
        mainCount: 0,
        modalHostCount: 1,
        authFormCount: 1,
        gateCount: 0,
        connectingCount: 0,
        disconnectedCount: 0,
        errorCount: 0,
      });
    }
    if (SHELL_STATES.has(record.appState!)) {
      expect(record).toMatchObject({
        shellRegionCount: 2,
        sidebarCount: 1,
        mainCount: 1,
        modalHostCount: 0,
        authFormCount: 0,
        gateCount: 0,
      });
    }
  }
}

test.describe("web auth modal integration", () => {
  test("connecting with the auth modal token exits the auth gate", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const server = new Server({
      store: createServingStore(storagePath),
      port: 0,
      auth: true,
    });

    try {
      await server.start();
      const serverURL = server.getBaseURL();
      const token = server.getAuthToken();
      const presentation = await observeApplicationPresentations(page);

      await page.goto(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}`);

      const tokenInput = page.getByLabel("Access token");
      await expect(tokenInput).toBeVisible();
      await expect(page.locator("#app[data-app-state='unauthorized'] > .app-sidebar")).toHaveCount(0);
      await expect(page.locator("#app[data-app-state='unauthorized'] > .app-main")).toHaveCount(0);
      await expect(page.locator(".desktop-upgrade-gate")).toHaveCount(0);
      await configureTestMotion(page);

      await tokenInput.fill(token);
      await page.locator(".auth-form button", { hasText: "Connect" }).click();

      await expect(page.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(page);
      await expect(page.locator("#app > .app-sidebar")).toHaveCount(1);
      await expect(page.locator("#app > .app-main > .top-bar")).toHaveCount(1);
      await expect(page.locator("#app > .app-main > .stage")).toHaveCount(1);
      await presentation.settle();
      await presentation.stop();
      expectSuccessfulAuthenticationHandoff(presentation.records());
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("a server-rejected auth modal token shows rejection", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const server = new Server({
      store: createServingStore(storagePath),
      port: 0,
      auth: true,
    });

    try {
      await server.start();
      const serverURL = server.getBaseURL();
      await page.goto(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}`);

      const tokenInput = page.getByLabel("Access token");
      await expect(tokenInput).toBeVisible();
      await configureTestMotion(page);
      await tokenInput.fill(`${server.getAuthToken()}-rejected`);
      await page.locator(".auth-form button", { hasText: "Connect" }).click();

      const alert = page.locator('[role="alert"]');
      await expect(alert).toHaveText("The previous token was rejected. Try again.");
      await expect(tokenInput).toHaveAttribute("aria-invalid", "true");
      await expect(alert).toHaveAttribute("id", "auth-token-error");
      await expect(tokenInput).toHaveAttribute("aria-describedby", "auth-token-error");
      await expect(tokenInput).toHaveValue("");
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("a server-accepted auth modal token never shows rejection", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const server = new Server({
      store: createServingStore(storagePath),
      port: 0,
      auth: true,
    });

    try {
      await server.start();
      const serverURL = server.getBaseURL();
      await page.goto(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}`);

      const tokenInput = page.getByLabel("Access token");
      await expect(tokenInput).toBeVisible();
      await configureTestMotion(page);
      await page.evaluate(() => {
        document.documentElement.dataset.authRejectionSeen = "false";
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (
                node instanceof Element &&
                (node.matches('[role="alert"]') || node.querySelector('[role="alert"]'))
              ) {
                document.documentElement.dataset.authRejectionSeen = "true";
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });

      await tokenInput.fill(server.getAuthToken());
      await page.locator(".auth-form button", { hasText: "Connect" }).click();

      expect(await page.evaluate(() =>
        document.querySelector('[role="alert"]')?.textContent ?? null
      )).toBeNull();
      await expect(page.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(page);
      await expect(page.locator("html")).toHaveAttribute("data-auth-rejection-seen", "false");
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("artifacts remain visible after reload without switching channels", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const artifactPath = path.join(storagePath, "startup-artifact.html");
    writeFileSync(artifactPath, "<!doctype html><h1>Should be visible after reload</h1>");
    const store = createServingStore(storagePath);
    const channel = store.listChannels()[0]!;
    store.createChannel({ name: "Other channel" });
    const artifact = store.createArtifact({
      channelID: channel.id,
      title: "Startup artifact",
      kind: "path",
      path: artifactPath,
    });
    store.patchDisplay({ focusedChannelId: channel.id });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    const displayWrites: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/display" && request.method() === "PATCH") {
        displayWrites.push(request.url());
      }
    });

    try {
      await server.start();
      const presentation = await observeApplicationPresentations(page);
      await page.goto(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(server.getBaseURL())}`);
      const tokenInput = page.getByLabel("Access token");
      await expect(tokenInput).toBeVisible();
      await configureTestMotion(page);
      await tokenInput.fill(server.getAuthToken());
      await page.locator(".auth-form button", { hasText: "Connect" }).click();

      await waitForApplicationShell(page);
      await presentation.settle();
      await presentation.stop();
      expectSuccessfulAuthenticationHandoff(presentation.records());
      await expect(
        page.locator(`.channel-row[data-channel-id="${channel.id}"] .channel`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator(`.tab-strip .tab[data-artifact-id="${artifact.id}"]`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator(`.stage .page[data-page-key="${artifact.id}"] .artifact-view`),
      ).toHaveCount(1);
      await expect(page.frameLocator(".artifact-view iframe").locator("h1")).toHaveText("Should be visible after reload");

      await page.reload();

      await waitForApplicationShell(page);
      await expect(
        page.locator(`.channel-row[data-channel-id="${channel.id}"] .channel`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator(`.tab-strip .tab[data-artifact-id="${artifact.id}"]`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator(`.stage .page[data-page-key="${artifact.id}"] .artifact-view`),
      ).toHaveCount(1);
      await expect(page.frameLocator(".artifact-view iframe").locator("h1")).toHaveText("Should be visible after reload");
      expect(displayWrites).toEqual([]);
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
