import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import {
  configureTestMotion,
  createArtifactFile,
  waitForApplicationShell,
} from "./helpers.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";

// Reconnect convergence (specs/arch/channel-state/index.md#^cs-converge):
// watcher events emitted while the real /events socket is severed are lost,
// so a successful automatic reconnect must refresh retained path artifacts
// from server truth. Server-side socket termination is the assertion's
// declared transport hook; HTTP, websocket retry, application state, frame
// reload, and markdown delivery remain production mechanisms.

interface EventStreamInternals {
  wsServer: { clients: Set<{ terminate(): void }> };
  getConnectedClientCount(): number;
}

function eventStream(server: Server): EventStreamInternals {
  return (server as unknown as { events: EventStreamInternals }).events;
}

function terminateEventSockets(server: Server): void {
  for (const socket of eventStream(server).wsServer.clients) {
    socket.terminate();
  }
}

async function expectEventClientsConnected(server: Server, timeout: number): Promise<void> {
  await expect
    .poll(() => eventStream(server).getConnectedClientCount(), { timeout })
    .toBeGreaterThan(0);
}

async function expectEventClientsGone(server: Server, timeout: number): Promise<void> {
  await expect
    .poll(() => eventStream(server).getConnectedClientCount(), { timeout })
    .toBe(0);
}

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-reload-after-reconnect-e2e-"));
}

async function openApp(page: Page, baseURL: string | undefined, server: Server): Promise<void> {
  if (!baseURL) {
    throw new Error("Expected Playwright baseURL");
  }
  const serverURL = server.getBaseURL();
  const token = server.getAuthToken();
  await page.goto(
    `${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&token=${encodeURIComponent(token)}`,
  );
  // Generous timeout: first load may pay cold Vite transforms, and the app
  // auto-retries its initial /events connect on a 1s backoff under load.
  await waitForApplicationShell(page);
  await configureTestMotion(page);
}

/**
 * Sever the /events socket, complete a server-side mutation while no client is
 * connected, then wait for the production client's automatic reconnect.
 */
async function mutateWhileDisconnected(
  server: Server,
  mutate: () => void | Promise<void>,
): Promise<void> {
  await expectEventClientsConnected(server, 10_000);
  terminateEventSockets(server);
  await expectEventClientsGone(server, 5_000);

  await mutate();
  expect(eventStream(server).getConnectedClientCount()).toBe(0);

  await expectEventClientsConnected(server, 15_000);
}

function waitForArtifactContentChange(
  store: ReturnType<typeof createServingStore>,
  artifactID: string,
): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: { artifactID: string }): void => {
      if (event.artifactID !== artifactID) return;
      store.removeEventListener("artifact-content-changed", listener);
      resolve();
    };
    store.addEventListener("artifact-content-changed", listener);
  });
}

function waitForThemeChange(
  store: ReturnType<typeof createServingStore>,
): Promise<void> {
  return new Promise((resolve) => {
    const listener = (): void => {
      store.removeEventListener("theme-changed", listener);
      resolve();
    };
    store.addEventListener("theme-changed", listener);
  });
}

test.describe("reload after reconnect (real server)", () => {

  test("path artifact content changed while disconnected is reloaded after reconnect", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0 });

    try {
      const channel = store.listChannels()[0]!;
      const htmlPath = createArtifactFile(
        storagePath,
        "reload-content",
        "<!doctype html><html><body><p id=\"msg\">version one</p></body></html>",
        "html",
      );
      const artifact = store.createArtifact({
        channelID: channel.id,
        title: "Reload",
        kind: "path",
        path: htmlPath,
      });

      await server.start();
      await openApp(page, baseURL, server);

      const frameElement = page.locator(".artifact-view iframe.artifact-content");
      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("#msg")).toHaveText("version one");

      // Isolate reconnect delivery from BRIDGE-4's independent HEAD polling.
      // The poll contract remains proved by its own real producer/consumer
      // seams; this route hook blocks only matching HEAD requests and leaves
      // the reconnect-triggered document GET and frame load real.
      const frameURL = new URL(await frameElement.evaluate(
        (element) => (element as HTMLIFrameElement).src,
      ));
      await page.route("**/*", async (route) => {
        const request = route.request();
        const requestURL = new URL(request.url());
        if (
          request.method() === "HEAD" &&
          requestURL.origin === frameURL.origin &&
          requestURL.pathname === frameURL.pathname
        ) {
          await route.abort();
          return;
        }
        await route.continue();
      });

      await mutateWhileDisconnected(server, async () => {
        const changed = waitForArtifactContentChange(store, artifact.id);
        writeFileSync(
          htmlPath,
          "<!doctype html><html><body><p id=\"msg\">version two</p></body></html>",
          "utf8",
        );
        await changed;
      });

      // The lost artifact-content-changed event is repaired by the reconnect
      // content-refresh pass, which reloads the proxy frame.
      await expect(frame.locator("#msg")).toHaveText("version two", { timeout: 10_000 });
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("theme changed while disconnected re-themes path artifact frames after reconnect", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    // Artifact frames consume the theme through /canonical/v2/styles.css,
    // whose public wrapper imports the canonical base and stable active-theme
    // route. Tests provide their own minimal canonical base, mirroring
    // theme.test.ts.
    const canonicalDir = mkdtempSync(path.join(os.tmpdir(), "television-reload-canonical-e2e-"));
    const versionDir = path.join(canonicalDir, "v2");
    mkdirSync(versionDir);
    writeFileSync(
      path.join(versionDir, "styles.css"),
      "body { background-color: var(--color-bg, rgb(1, 2, 3)); }\n",
      "utf8",
    );
    const themeDir = seedThemePackage(
      storagePath,
      "retheme",
      ":root { --color-bg: rgb(255, 0, 0); }\n",
    );
    const themeCSSPath = path.join(themeDir, "theme.css");

    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0, canonicalDir });

    try {
      const channel = store.listChannels()[0]!;
      const htmlPath = createArtifactFile(
        storagePath,
        "reload-theme",
        "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/canonical/v2/styles.css\"></head>" +
          "<body><p id=\"msg\">themed</p></body></html>",
        "html",
      );
      store.createArtifact({ channelID: channel.id, title: "Themed", kind: "path", path: htmlPath });
      store.patchDisplay({ activeThemeName: "retheme" });

      await server.start();
      await openApp(page, baseURL, server);

      const frameBody = page.frameLocator(".artifact-view iframe.artifact-content").locator("body");
      await expect(frameBody).toBeVisible();
      await expect(frameBody).toHaveCSS("background-color", "rgb(255, 0, 0)");

      await mutateWhileDisconnected(server, async () => {
        const changed = waitForThemeChange(store);
        writeFileSync(themeCSSPath, ":root { --color-bg: rgb(0, 0, 255); }\n", "utf8");
        await changed;
      });

      // Theme freshness rides the reconnect content-refresh pass: the frame
      // reload re-requests /canonical/v2/styles.css with the edited theme.
      await expect(frameBody).toHaveCSS("background-color", "rgb(0, 0, 255)", { timeout: 10_000 });
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(canonicalDir, { recursive: true, force: true });
    }
  });

  test("markdown content re-syncs after reconnect", async ({ page, baseURL }) => {
    const storagePath = createDataDir();
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0 });

    try {
      const channel = store.listChannels()[0]!;
      const markdownPath = createArtifactFile(storagePath, "reload-markdown", "server draft one", "md");
      const artifact = store.createArtifact({
        channelID: channel.id,
        title: "Notes",
        kind: "path",
        path: markdownPath,
      });

      await server.start();
      await openApp(page, baseURL, server);

      // The real markdown view (CodeMirror) served at /views/markdown/.
      const editor = page.frameLocator(".artifact-view iframe.artifact-content").locator(".cm-content");
      await expect(editor).toContainText("server draft one");

      await mutateWhileDisconnected(server, async () => {
        const changed = waitForArtifactContentChange(store, artifact.id);
        writeFileSync(markdownPath, "server draft two", "utf8");
        await changed;
      });

      // Markdown re-syncs unconditionally on reconnect: the content-refresh
      // pass refetches /markdown/:id and applies it through the same path as
      // live artifact-content-changed handling.
      await expect(editor).toContainText("server draft two", { timeout: 10_000 });
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
