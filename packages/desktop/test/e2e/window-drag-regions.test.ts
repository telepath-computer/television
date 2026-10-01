import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { startConnectTestServer } from "./connect-server.ts";
import { createUserDataDir, expectConnectedPage, launchDesktop, launchDesktopConnectScreen, waitForConnectScreen, SIMULATE_UPDATE_AVAILABLE } from "./helpers.ts";
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

async function emptyGround(page: Page, selector: string, backgroundChild?: string): Promise<Point> {
  return page.locator(selector).evaluate((element, { selector, backgroundChild }) => {
    const bounds = element.getBoundingClientRect();
    const y = bounds.top + bounds.height / 2;
    const appRegion = getComputedStyle(element).getPropertyValue("-webkit-app-region");
    const middle = bounds.left + bounds.width / 2;
    for (let offset = 0; offset < bounds.width / 2 - 2; offset += 2) {
      for (const x of offset === 0 ? [middle] : [middle - offset, middle + offset]) {
        const hit = document.elementFromPoint(x, y);
        if (hit === element || (backgroundChild && hit?.matches(backgroundChild) && element.contains(hit))) return { x, y, appRegion };
      }
    }
    throw new Error(`No empty ground found in ${selector}`);
  }, { selector, backgroundChild });
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

// ^sm-ac-drag-strip, served route: real Electron top-layer hit testing and
// movement. The X11 driver substitutes the window manager; version and update
// hooks select the gate and its actionable restart control.
test("the served gate keeps a native drag strip and usable dialog controls", async () => {
  test.skip(process.platform !== "linux", "Native drag driver requires Linux/X11");
  const savedEnv = new Map(["TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_TEST_VERSION", "TV_UPDATE_CHANNEL_URL"].map((key) => [key, process.env[key]]));
  process.env.TV_TEST_VERSION = "1.0.0";
  process.env.TV_UPDATE_CHANNEL_URL = "http://127.0.0.1:9/update-channel.json";
  process.env.TV_TEST_REQUIRED_DESKTOP_VERSION = "2.0.0";
  const server = await startConnectTestServer();
  let launched: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    launched = await launchDesktop({
      connectTo: { serverURL: server.serverURL, token: server.token },
      env: { TV_TEST_DESKTOP_APP_VERSION: "1.0.0" },
      args: [SIMULATE_UPDATE_AVAILABLE],
    });
    const { app, page } = launched;
    await expect(page.locator(".desktop-upgrade-gate")).toBeVisible();
    await configureTestMotion(page);
    expect(await page.locator("dialog").evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
    const strip = await emptyGround(page, ".window-drag-strip");
    expect(strip.appRegion).toBe("drag");
    expectWindowMoved(await dragNativeWindow(app, strip));
    await expect(page.locator("dialog")).toBeVisible();
    const beforeClick = await windowBounds(app);
    await page.getByRole("button", { name: "Restart to update", exact: true }).click();
    await expect(page.getByRole("button", { name: "Restarting…", exact: true })).toBeDisabled();
    expect(await windowBounds(app)).toEqual(beforeClick);
    await expect(page.locator("dialog")).toBeVisible();
  } finally {
    await launched?.app.close().catch(() => undefined);
    if (launched?.userDataDir) rmSync(launched.userDataDir, { recursive: true, force: true });
    await server.dispose();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ^setup-t-drag and ^sm-ac-drag-strip local route: native Electron hit testing
// and bounds, with the existing X11 window-manager substitute.
test("packaged setup and saved-error dialogs move the window while controls stay usable", async () => {
  test.skip(process.platform !== "linux", "Native drag driver requires Linux/X11");
  const userDataDir = createUserDataDir();
  let launched = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(launched.page);
    await configureTestMotion(launched.page);
    await test.step("setup ground moves and the card edits without moving", async () => {
      expectWindowMoved(await dragNativeWindow(launched.app, await emptyGround(launched.page, ".setup-screen", ".setup-wallpaper")));
      const before = await windowBounds(launched.app);
      const input = launched.page.getByRole("textbox", { name: "Link from your agent" });
      await input.click();
      await input.pressSequentially("not a link");
      await expect(input).toHaveValue("not a link");
      expect(await windowBounds(launched.app)).toEqual(before);
    });
    await launched.app.close();
    writeFileSync(path.join(userDataDir, "connection.json"), JSON.stringify({ serverURL: "http://127.0.0.1:9", token: "" }));
    launched = await launchDesktopConnectScreen({ userDataDir });
    await expect(launched.page.getByRole("heading", { name: "Can’t connect with server" })).toBeVisible();
    await configureTestMotion(launched.page);
    await test.step("the modal strip moves and Disconnect remains usable", async () => {
      expect(await launched.page.locator("dialog").evaluate(dialog => dialog.matches(":modal"))).toBe(true);
      const strip = await emptyGround(launched.page, ".window-drag-strip");
      expectWindowMoved(await dragNativeWindow(launched.app, strip));
      await expect(launched.page.locator("dialog")).toBeVisible();
      const before = await windowBounds(launched.app);
      await launched.page.getByRole("button", { name: "Disconnect from Server", exact: true }).click();
      await waitForConnectScreen(launched.page);
      expect(await windowBounds(launched.app)).toEqual(before);
    });
  } finally {
    await launched.app.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
