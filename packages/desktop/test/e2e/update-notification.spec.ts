import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { Server } from "@telepath-computer/television-server";
import {
  expectConnectedPage,
  launchDesktop,
  launchDesktopConnectScreen,
  SIMULATE_UPDATE_AVAILABLE,
} from "./helpers.ts";
import { startUpdateChannelFixture } from "../../../../test/helpers/update-channel-fixture.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

// Desktop parity acceptance for the update notification
// (specs/product/update-notifications.md ^ac-toast-desktop): in the REAL
// Electron app, one combined walk of the essential mechanics — the notice
// shows for a newer channel version, its links route through the desktop
// external-open handling, dismissal survives a profile restart, the bell
// re-opens the notice, and the copy button places the prompt on the system
// clipboard. Per-behavior breadth
// lives in the browser criteria (packages/web/test/e2e/update-notification.01.spec.ts
// and packages/web/test/e2e/update-notification.02.spec.ts).
//
// Staging per ^ac-declaration: a really-running Television server (spawned
// in-process, connected to via the slice-1 connect harness), a test-authored
// channel document over real HTTP via TV_UPDATE_CHANNEL_URL, the server
// version staged with TV_TEST_VERSION. The served bundle is the dev build
// (0.0.0 — reload-exempt per arch/updates/index.md ^updates-dev-version), so
// the version-staged server triggers no auto-reload; the toast is driven
// purely by the relayed update state.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, "../../../web/dist");

const SERVER_VERSION = "1.0.0";
const CHANNEL_VERSION = "1.5.0";
const NOTES_URL = "https://television.run/notes-1.5.0";
const PROMPT = "Please upgrade my Television server following https://television.run/install.md";
// A release of the npm package, below the recommendation (1.4.0).
const NPM_SHELL_VERSION = "1.3.2";
// The production floor (1.5.0) gates every npm-installed shell, so the
// recommendation reaches no client of a production server. The
// recommendation walks give their server this requirement through the
// declared TV_TEST_REQUIRED_DESKTOP_VERSION hook, so the npm shell passes.
const NPM_ADMITTING_REQUIREMENT = "1.3.1";
// Restated from specs/ui/app/update-notification/content.yml#desktop_upgrade_recommendation.
const RECOMMENDATION_DOWNLOAD_URL = "https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64";
const SILENCE_WINDOW_MS = 2_000;

const ENV_KEYS = ["TV_TEST_VERSION", "TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS"] as const;

async function startDesktopNotificationServer(channelDocument: unknown, requiredDesktopVersion?: string): Promise<{
  server: Server;
  dispose(): Promise<void>;
}> {
  const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
  const fixture = await startUpdateChannelFixture(channelDocument);
  process.env.TV_TEST_VERSION = SERVER_VERSION;
  // The server advertises the production required desktop version unless
  // the walk names another.
  if (requiredDesktopVersion === undefined) delete process.env.TV_TEST_REQUIRED_DESKTOP_VERSION;
  else process.env.TV_TEST_REQUIRED_DESKTOP_VERSION = requiredDesktopVersion;
  process.env.TV_UPDATE_CHANNEL_URL = fixture.url;
  delete process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS;

  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-desktop-recommendation-server-"));
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-desktop-recommendation-static-"));
  cpSync(WEB_DIST, staticDir, { recursive: true });
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, staticDir });
  await server.start();

  return {
    server,
    async dispose() {
      await server.dispose();
      await fixture.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(staticDir, { recursive: true, force: true });
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}


test.describe("desktop update notification", () => {

  test("^ac-toast-desktop: notice, external link, persistent dismissal, bell re-open, and clipboard copy in the real Electron app", async () => {
  const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
  const tempDirs: string[] = [];

  const fixture = await startUpdateChannelFixture({
    schemaVersion: 1,
    version: CHANNEL_VERSION,
    toast: {
      markdown: `**Television ${CHANNEL_VERSION}** is available — [release notes](${NOTES_URL}).`,
      prompt: PROMPT,
    },
  });

  process.env.TV_TEST_VERSION = SERVER_VERSION;
  process.env.TV_UPDATE_CHANNEL_URL = fixture.url;
  delete process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS;

  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-update-notification-desktop-server-"));
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-update-notification-desktop-static-"));
  tempDirs.push(storagePath, staticDir);
  cpSync(WEB_DIST, staticDir, { recursive: true });
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, staticDir });
  await server.start();

  let launched: Awaited<ReturnType<typeof launchDesktop>> | null = null;
  try {
    // The shell declares a version above any published requirement (via the
    // declared TV_TEST_DESKTOP_APP_VERSION mock of app.getVersion(),
    // desktop-upgrade-gate.md ^hook-shell-version): the server's baked
    // required desktop version is non-null (^ops-first-gate), and a shell
    // below it would — correctly — halt at the gate, superseding the toast
    // under test.
    launched = await launchDesktop({
      connectTo: { serverURL: server.getBaseURL(), token: server.getAuthToken() },
      env: { TV_TEST_DESKTOP_APP_VERSION: "9.9.9" },
    });
    const { app, page } = launched;
    const userDataDir = launched.userDataDir;
    if (userDataDir === undefined) throw new Error("connected Electron launch did not provide its isolated profile");
    tempDirs.push(userDataDir);
    await expectConnectedPage(page);

    const toastPanel = page.locator(".top-bar-controls > .update-popover");
    const bell = page.locator(".top-bar-controls > .update-bell");
    const dismissButton = toastPanel.locator(".update-later");

    // The notice shows for the newer channel version, markdown rendered.
    await expect(toastPanel).toBeVisible({ timeout: 30_000 });
    await expect(toastPanel.locator("strong")).toHaveText(`Television ${CHANNEL_VERSION}`);

    // Links route through the desktop external-open handling (^toast-render;
    // the TV_TEST_MODE seam records instead of launching a browser).
    await app.evaluate(() => {
      (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
    });
    const link = toastPanel.locator("a");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await link.click();
    await expect.poll(async () =>
      app.evaluate(() =>
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [],
      ), { timeout: 15_000 }).toContain(NOTES_URL);

    // Dismiss, close the app, then relaunch the exact isolated profile. The
    // visible bell proves update state arrived before absence is asserted.
    await dismissButton.click();
    await expect(toastPanel).not.toBeVisible();
    await expect(bell).toBeVisible();
    await app.close();
    launched = null;

    launched = await launchDesktopConnectScreen({ userDataDir });
    const { app: relaunchedApp, page: relaunchedPage } = launched;
    await expectConnectedPage(relaunchedPage);
    const relaunchedPanel = relaunchedPage.locator(".top-bar-controls > .update-popover");
    const relaunchedBell = relaunchedPage.locator(".top-bar-controls > .update-bell");
    await expect(relaunchedBell).toBeVisible({ timeout: 30_000 });
    await relaunchedPage.waitForTimeout(SILENCE_WINDOW_MS);
    await expect(relaunchedPanel).not.toBeVisible();

    // The bell restores the complete dismissed notice after the profile
    // restart, including its authored link and working copy prompt.
    await relaunchedBell.click();
    await expect(relaunchedPanel).toBeVisible();
    await expect(relaunchedPanel.locator("strong")).toHaveText(`Television ${CHANNEL_VERSION}`);
    await expect(relaunchedPanel.locator("a")).toHaveAttribute("href", NOTES_URL);

    // The copy button places the prompt on the SYSTEM clipboard — read back
    // through Electron's main-process clipboard module.
    await relaunchedApp.evaluate(({ clipboard }) => clipboard.writeText(""));
    await relaunchedPanel.locator(".copy-button").click();
    await expect.poll(async () => relaunchedApp.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 15_000 }).toBe(PROMPT);
  } finally {
    if (launched) await launched.app.close();
    await server.dispose();
    await fixture.dispose();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  });

  test("^ac-desktop-rec: an npm-installed shell gets the recommendation with its download link, persistent dismissal and bell re-open", async () => {
    const running = await startDesktopNotificationServer({
      schemaVersion: 1,
      version: SERVER_VERSION,
      toast: { markdown: "This equal-version server notice does not apply." },
    }, NPM_ADMITTING_REQUIREMENT);
    const tempDirs: string[] = [];
    let launched: Awaited<ReturnType<typeof launchDesktop>> | null = null;

    try {
      launched = await launchDesktop({
        connectTo: {
          serverURL: running.server.getBaseURL(),
          token: running.server.getAuthToken(),
        },
        env: { TV_TEST_DESKTOP_APP_VERSION: NPM_SHELL_VERSION },
      });
      const userDataDir = launched.userDataDir;
      if (userDataDir === undefined) {
        throw new Error("connected Electron launch did not provide its isolated profile");
      }
      tempDirs.push(userDataDir);
      await expectConnectedPage(launched.page);

      const panel = launched.page.locator(".top-bar-controls > .update-popover");
      const bell = launched.page.locator(".top-bar-controls > .update-bell");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.locator("h3")).toHaveText("Recommended desktop upgrade available");
      await expect(panel).toContainText(
        "This copy was installed with npm and receives no more updates.",
      );
      await expect(panel.locator("ol > li")).toHaveCount(3);

      // The download link routes through the desktop external-open handling
      // (the TV_TEST_MODE seam records instead of launching a browser).
      await launched.app.evaluate(() => {
        (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog = [];
      });
      await panel.locator("ol a", { hasText: "Download Television for Mac" }).click();
      await expect.poll(async () =>
        launched!.app.evaluate(() =>
          (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [],
        ), { timeout: 15_000 }).toContain(RECOMMENDATION_DOWNLOAD_URL);

      // No agent prompt: Later is the only action.
      await expect(panel.locator(".copy-button")).toHaveCount(0);
      await expect(panel.locator(".update-actions > *")).toHaveCount(1);

      await panel.locator(".update-later").click();
      await expect(panel).not.toBeVisible();
      await expect(bell).toBeVisible();
      await launched.app.close();
      launched = null;

      launched = await launchDesktopConnectScreen({
        userDataDir,
        env: { TV_TEST_DESKTOP_APP_VERSION: NPM_SHELL_VERSION },
      });
      await expectConnectedPage(launched.page);
      const relaunchedPanel = launched.page.locator(".top-bar-controls > .update-popover");
      const relaunchedBell = launched.page.locator(".top-bar-controls > .update-bell");
      await expect(relaunchedBell).toBeVisible({ timeout: 30_000 });
      await launched.page.waitForTimeout(SILENCE_WINDOW_MS);
      await expect(relaunchedPanel).not.toBeVisible();

      await relaunchedBell.click();
      await expect(relaunchedPanel).toBeVisible();
      await expect(relaunchedPanel.locator("h3")).toHaveText(
        "Recommended desktop upgrade available",
      );
      await expect(relaunchedPanel.locator(".copy-button")).toHaveCount(0);
    } finally {
      if (launched) await launched.app.close();
      await running.dispose();
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("^ac-desktop-rec-precedence: a dismissed server notice keeps the bell and never reveals the recommendation", async () => {
    const running = await startDesktopNotificationServer({
      schemaVersion: 1,
      version: CHANNEL_VERSION,
      toast: {
        markdown: `**Television ${CHANNEL_VERSION}** is available.`,
        prompt: PROMPT,
      },
    }, NPM_ADMITTING_REQUIREMENT);
    const tempDirs: string[] = [];
    let launched: Awaited<ReturnType<typeof launchDesktop>> | null = null;

    try {
      launched = await launchDesktop({
        connectTo: {
          serverURL: running.server.getBaseURL(),
          token: running.server.getAuthToken(),
        },
        env: { TV_TEST_DESKTOP_APP_VERSION: NPM_SHELL_VERSION },
      });
      if (launched.userDataDir) tempDirs.push(launched.userDataDir);
      await expectConnectedPage(launched.page);

      const panel = launched.page.locator(".top-bar-controls > .update-popover");
      const bell = launched.page.locator(".top-bar-controls > .update-bell");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.locator("strong")).toHaveText(`Television ${CHANNEL_VERSION}`);
      await expect(panel.locator("h3", { hasText: "Recommended desktop upgrade available" })).toHaveCount(0);
      await expect(panel.locator(".copy-button")).toHaveCount(1);

      await panel.locator(".update-later").click();
      await expect(panel).not.toBeVisible();
      await expect(bell).toBeVisible();
      await launched.page.waitForTimeout(SILENCE_WINDOW_MS);
      await expect(panel).not.toBeVisible();

      await bell.click();
      await expect(panel).toBeVisible();
      await expect(panel.locator("strong")).toHaveText(`Television ${CHANNEL_VERSION}`);
      await expect(panel.locator(".copy-button")).toHaveCount(1);
      await expect(panel.locator("h3", { hasText: "Recommended desktop upgrade available" })).toHaveCount(0);
    } finally {
      if (launched) await launched.app.close();
      await running.dispose();
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    }
  });

  // proofs/product/update-notifications.md#^ac-desktop-self-update-notice
  test("^ac-desktop-self-update-notice: the runtime's downloaded update presents the notice before and after a reload, and Restart to update reaches the main process", async () => {
    const running = await startDesktopNotificationServer({
      schemaVersion: 1,
      version: SERVER_VERSION,
      toast: { markdown: "This equal-version server notice does not apply." },
    });
    const tempDirs: string[] = [];
    let launched: Awaited<ReturnType<typeof launchDesktop>> | null = null;

    try {
      // The harness's default shell version passes the gate and receives no
      // recommendation; the runtime's simulation reports the download.
      launched = await launchDesktop({
        connectTo: {
          serverURL: running.server.getBaseURL(),
          token: running.server.getAuthToken(),
        },
        args: [SIMULATE_UPDATE_AVAILABLE],
      });
      if (launched.userDataDir) tempDirs.push(launched.userDataDir);
      const { app, page } = launched;
      await expectConnectedPage(page);
      const simulatedVersion = `${await app.evaluate(({ app: electronApp }) => electronApp.getVersion())}-simulated`;

      const panel = page.locator(".top-bar-controls > .update-popover");
      const bell = page.locator(".top-bar-controls > .update-bell");
      const restart = panel.locator(".update-actions > .update-restart");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.locator("h3")).toHaveText("Desktop app update ready");
      await expect(panel).toContainText(`Version ${simulatedVersion} has downloaded`);
      await expect(bell).toBeVisible();
      await expect(panel.locator(".copy-button")).toHaveCount(0);
      await expect(restart).toHaveText("Restart to update");

      // A page loaded after the download learns of it.
      await page.reload();
      await expectConnectedPage(page);
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText(`Version ${simulatedVersion} has downloaded`);

      await restart.click();
      await expect(restart).toBeDisabled();
      await expect(restart).toHaveText("Restarting…");
      await expect(panel).toBeVisible();
      await expect.poll(async () =>
        app.evaluate(() =>
          (globalThis as typeof globalThis & { __televisionRestartToInstallLog?: string[] }).__televisionRestartToInstallLog ?? [],
        ), { timeout: 15_000 }).toEqual([simulatedVersion]);
    } finally {
      if (launched) await launched.app.close();
      await running.dispose();
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    }
  });
})
