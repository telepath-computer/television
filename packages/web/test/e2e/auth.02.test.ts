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

      await waitForApplicationShell(page);
      await expect(page).toHaveURL(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&mode=electron`);
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
})

test.describe("web authentication integration", () => {
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
      await page.goto(`${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(server.getBaseURL())}&token=${encodeURIComponent(server.getAuthToken())}`);
      await waitForApplicationShell(page);
      await configureTestMotion(page);
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
