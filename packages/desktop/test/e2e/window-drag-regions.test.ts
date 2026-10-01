import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { startConnectTestServer } from "./connect-server.ts";
import { expectConnectedPage, launchDesktop } from "./helpers.ts";
import { configureTestMotion } from "../../../web/test/e2e/helpers.ts";

interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly appRegion: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const X11_WINDOW_DRAG_DRIVER = path.join(HERE, "x11-window-drag-driver.py");
const NATIVE_DRAG_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

async function windowBounds(app: ElectronApplication): Promise<WindowBounds> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("BrowserWindow missing");
    return window.getBounds();
  });
}

async function armWindowMove(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const owner = globalThis as typeof globalThis & {
      __app4WindowMove?: { moved: boolean; dispose(): void };
    };
    if (owner.__app4WindowMove !== undefined) {
      throw new Error("window move observation already armed");
    }
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("BrowserWindow missing");
    const state = {
      moved: false,
      dispose: () => window.removeListener("move", onMove),
    };
    const onMove = (): void => {
      state.moved = true;
    };
    window.on("move", onMove);
    owner.__app4WindowMove = state;
  });
}

async function movedWindowBounds(app: ElectronApplication): Promise<WindowBounds> {
  return app.evaluate(({ BrowserWindow }) => {
    const owner = globalThis as typeof globalThis & {
      __app4WindowMove?: { moved: boolean; dispose(): void };
    };
    const movement = owner.__app4WindowMove;
    if (movement === undefined) throw new Error("window move observation is not armed");
    movement.dispose();
    delete owner.__app4WindowMove;
    if (!movement.moved) throw new Error("BrowserWindow emitted no move event");
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("BrowserWindow missing");
    return window.getBounds();
  });
}

async function emptyGround(page: Page, selector: string): Promise<Point> {
  return page.locator(selector).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const y = bounds.top + bounds.height / 2;
    const appRegion = getComputedStyle(element).getPropertyValue("-webkit-app-region");
    const middle = bounds.left + bounds.width / 2;
    for (let offset = 0; offset < bounds.width / 2 - 2; offset += 2) {
      for (const x of offset === 0 ? [middle] : [middle - offset, middle + offset]) {
        if (document.elementFromPoint(x, y) === element) return { x, y, appRegion };
      }
    }
    throw new Error(`No empty ground found in ${selector}`);
  });
}

async function dragNativeWindow(
  app: ElectronApplication,
  start: Point,
): Promise<{ before: WindowBounds; after: WindowBounds }> {
  const before = await windowBounds(app);
  await armWindowMove(app);
  const screenStart = await app.evaluate(({ BrowserWindow }, { start }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("BrowserWindow missing");
    const content = window.getContentBounds();
    return {
      x: Math.round(content.x + start.x),
      y: Math.round(content.y + start.y),
    };
  }, { start });
  await execFileAsync("python3", [
    X11_WINDOW_DRAG_DRIVER,
    String(screenStart.x),
    String(screenStart.y),
    "96",
    "48",
    "8",
  ], { timeout: NATIVE_DRAG_TIMEOUT_MS, killSignal: "SIGTERM" });
  return { before, after: await movedWindowBounds(app) };
}

function expectWindowMoved({ before, after }: { before: WindowBounds; after: WindowBounds }): void {
  expect(after.x !== before.x || after.y !== before.y).toBe(true);
}

async function seedOverflowingTabs(
  server: Awaited<ReturnType<typeof startConnectTestServer>>,
): Promise<void> {
  const client = new TelevisionClient(server.serverURL, { token: server.token });
  const { channel } = await client.channels.create({ name: "Overflowing tabs" });
  await client.display.patch({ focusedChannelId: channel.id });
  const artifactPath = path.join(server.storagePath, "window-drag-fixture.html");
  writeFileSync(artifactPath, "<!doctype html><title>Window drag fixture</title>");
  for (let index = 0; index < 12; index += 1) {
    await client.artifacts.create({
      channelID: channel.id,
      kind: "path",
      title: `Overflow tab ${index + 1} with a long title`,
      path: artifactPath,
    });
  }
}

test("dragging the empty sidebar titlebar and top-bar ground moves the native window", async () => {
  test.skip(process.platform !== "linux", "Native drag driver requires Linux/X11");
  const server = await startConnectTestServer();
  await seedOverflowingTabs(server);
  let launched: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    launched = await launchDesktop({
      connectTo: { serverURL: server.serverURL, token: server.token },
    });
    const { app, page } = launched;
    await expectConnectedPage(page);
    await configureTestMotion(page);

    // Xvfb's display and the BrowserWindow have the same width. With an
    // overflowing strip, the empty top-bar ground is near the right edge, so
    // exercise it before the sidebar drag shifts its starting point offscreen.
    await test.step("empty top-bar ground moves BrowserWindow bounds", async () => {
      const topBar = await emptyGround(page, ".top-bar");
      expect(topBar.appRegion).toBe("drag");
      expectWindowMoved(await dragNativeWindow(app, topBar));
    });

    const strip = page.locator(".tab-strip");
    await expect(strip).toHaveAttribute("data-overflow", "");
    const scrollLeft = await strip.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft;
    });
    expect(scrollLeft).toBeGreaterThan(0);
    await expect.poll(() => strip.evaluate((element) =>
      Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft),
    )).toBeLessThanOrEqual(1);

    await test.step("empty sidebar titlebar moves BrowserWindow bounds beside right-scrolled overflow", async () => {
      const sidebarTitlebar = await emptyGround(page, ".sidebar-titlebar");
      expect(sidebarTitlebar.appRegion).toBe("drag");
      expectWindowMoved(await dragNativeWindow(app, sidebarTitlebar));
    });
  } finally {
    await launched?.app.close().catch(() => undefined);
    if (launched?.userDataDir !== undefined) {
      rmSync(launched.userDataDir, { recursive: true, force: true });
    }
    await server.dispose();
  }
});
