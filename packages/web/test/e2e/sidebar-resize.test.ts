import { expect, test } from "../../../../test/helpers/playwright.ts";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type Locator, type Page } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import {
  launchProductServer,
  type ProductServer,
} from "../../../../test/helpers/product-server.ts";
import { configureTestMotion, createArtifactFile } from "./helpers.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SIDEBAR_WIDTH_KEY = "tv-channel-sidebar-width";
const MIN_WIDTH_PX = 160;
const MAX_WIDTH_PX = 350;
const DEFAULT_WIDTH_PX = 260;

interface ShellGeometry {
  readonly propertyWidth: number;
  readonly appWidth: number;
  readonly sidebarWidth: number;
  readonly sidebarRight: number;
  readonly mainLeft: number;
  readonly mainWidth: number;
  readonly mainRight: number;
  readonly appRight: number;
}

interface HeldDrag {
  readonly handle: Locator;
  readonly pointerId: number;
  readonly startX: number;
  readonly y: number;
}

function createStoragePath(): string {
  const parent = path.join(REPO_ROOT, "tmp", "sidebar-resize-e2e");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "run-"));
}

async function focusedChannelID(client: TelevisionClient): Promise<string> {
  const display = await client.display.get();
  if (display.focusedChannelId) return display.focusedChannelId;
  const channels = (await client.channels.list()).channels;
  if (channels[0]) {
    await client.display.patch({ focusedChannelId: channels[0].id });
    return channels[0].id;
  }
  const { channel } = await client.channels.create({ name: "Resize acceptance" });
  await client.display.patch({ focusedChannelId: channel.id });
  return channel.id;
}

async function openApp(page: Page, product: ProductServer): Promise<void> {
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.goto(product.serverURL);
  await configureTestMotion(page);
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
  await expect(page.locator(".app-sidebar-resize")).toBeVisible();
}

async function shellGeometry(page: Page): Promise<ShellGeometry> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>("#app");
    const sidebar = app?.querySelector<HTMLElement>(".app-sidebar");
    const main = app?.querySelector<HTMLElement>(".app-main");
    if (!app || !sidebar || !main) throw new Error("Application shell is not mounted");
    const appBox = app.getBoundingClientRect();
    const sidebarBox = sidebar.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      propertyWidth: Number.parseFloat(app.style.getPropertyValue("--sidebar-width")),
      appWidth: appBox.width,
      sidebarWidth: sidebarBox.width,
      sidebarRight: sidebarBox.right,
      mainLeft: mainBox.left,
      mainWidth: mainBox.width,
      mainRight: mainBox.right,
      appRight: appBox.right,
    };
  });
}

async function expectShellWidth(page: Page, width: number): Promise<void> {
  const geometry = await shellGeometry(page);
  expect(geometry.propertyWidth).toBeCloseTo(width, 5);
  expect(geometry.sidebarWidth).toBeCloseTo(width, 5);
  expect(geometry.sidebarRight).toBeCloseTo(geometry.mainLeft, 5);
  expect(geometry.mainRight).toBeCloseTo(geometry.appRight, 5);
  expect(geometry.sidebarWidth + geometry.mainWidth).toBeCloseTo(
    geometry.appWidth,
    5,
  );
}

async function storedWidth(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SIDEBAR_WIDTH_KEY);
}

async function beginDrag(page: Page, y: number): Promise<HeldDrag> {
  const handle = page.locator(".app-sidebar-resize");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Resize band has no browser box");
  await handle.evaluate((element) => {
    const owner = window as unknown as {
      __sidebarResizePointerId?: number;
      __sidebarResizeCaptureLosses?: number;
    };
    owner.__sidebarResizePointerId = undefined;
    owner.__sidebarResizeCaptureLosses = 0;
    element.addEventListener("pointerdown", (event) => {
      owner.__sidebarResizePointerId = (event as PointerEvent).pointerId;
    }, { once: true });
    element.addEventListener("lostpointercapture", () => {
      owner.__sidebarResizeCaptureLosses = (owner.__sidebarResizeCaptureLosses ?? 0) + 1;
    });
  });
  const startX = box.x + box.width / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const pointerId = await expect.poll(() => handle.evaluate((element) => {
    const owner = window as unknown as { __sidebarResizePointerId?: number };
    const id = owner.__sidebarResizePointerId;
    return id !== undefined && element.hasPointerCapture(id) ? id : null;
  })).not.toBeNull().then(() =>
    handle.evaluate(() =>
      (window as unknown as { __sidebarResizePointerId: number }).__sidebarResizePointerId
    )
  );
  return { handle, pointerId, startX, y };
}

async function captureLossCount(handle: Locator): Promise<number> {
  return handle.evaluate(() =>
    (window as unknown as { __sidebarResizeCaptureLosses?: number })
      .__sidebarResizeCaptureLosses ?? 0
  );
}

async function bootWithStoredWidth(
  browser: Browser,
  product: ProductServer,
  rawWidth: string,
): Promise<{ readonly page: Page; readonly close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(({ key, value }) => {
    if (window.top !== window) return;
    localStorage.setItem(key, value);
  }, { key: SIDEBAR_WIDTH_KEY, value: rawWidth });
  await openApp(page, product);
  return { page, close: () => context.close() };
}

test("drags, clamps, restores, persists, and clears the production sidebar width (^ap-ac-sidebar-resize)", async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  const storagePath = createStoragePath();
  const product = await launchProductServer({ home: storagePath, cleanupHome: true });

  try {
    const client = new TelevisionClient(product.serverURL);
    const channelID = await focusedChannelID(client);
    const artifactPath = createArtifactFile(
      product.home,
      "sidebar-resize-crossing",
      `<!doctype html>
        <style>html, body { min-height: 100%; margin: 0; }</style>
        <main id="resize-crossing">Live artifact document</main>`,
      "html",
    );
    await client.artifacts.create({
      channelID,
      kind: "path",
      title: "Sidebar resize crossing",
      path: artifactPath,
    });

    await openApp(page, product);
    await expect(page.frameLocator("iframe.artifact-content").locator("#resize-crossing"))
      .toHaveText("Live artifact document");
    await expectShellWidth(page, DEFAULT_WIDTH_PX);
    expect(await storedWidth(page)).toBeNull();

    const artifactFrame = page.locator("iframe.artifact-content").first();
    const initialFrameBox = await artifactFrame.boundingBox();
    if (!initialFrameBox) throw new Error("Live artifact frame has no browser box");
    const dragY = initialFrameBox.y + initialFrameBox.height / 2;
    let drag = await beginDrag(page, dragY);
    const frameCrossingX = initialFrameBox.x + initialFrameBox.width / 2;
    await page.mouse.move(frameCrossingX, dragY, { steps: 12 });
    const movedFrameBox = await artifactFrame.boundingBox();
    if (!movedFrameBox) throw new Error("Live artifact frame disappeared during resize");
    expect(frameCrossingX).toBeGreaterThan(movedFrameBox.x);
    expect(frameCrossingX).toBeLessThan(movedFrameBox.x + movedFrameBox.width);
    await expectShellWidth(page, MAX_WIDTH_PX);
    expect(await storedWidth(page)).toBeNull();

    const returnX = drag.startX + 45;
    await page.mouse.move(returnX, dragY, { steps: 8 });
    await expectShellWidth(page, DEFAULT_WIDTH_PX + 45);
    expect(await storedWidth(page)).toBeNull();
    await page.mouse.up();
    await expect.poll(() => captureLossCount(drag.handle)).toBeGreaterThan(0);
    expect(await storedWidth(page)).toBe(String(DEFAULT_WIDTH_PX + 45));
    await expectShellWidth(page, DEFAULT_WIDTH_PX + 45);

    await page.reload();
    await configureTestMotion(page);
    await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
    await expect(page.locator(".app-sidebar-resize")).toBeVisible();
    await expectShellWidth(page, DEFAULT_WIDTH_PX + 45);

    drag = await beginDrag(page, dragY);
    await page.mouse.move(1, dragY, { steps: 8 });
    await expectShellWidth(page, MIN_WIDTH_PX);
    expect(await storedWidth(page)).toBe(String(DEFAULT_WIDTH_PX + 45));
    await page.mouse.up();
    expect(await storedWidth(page)).toBe(String(MIN_WIDTH_PX));
    await expectShellWidth(page, MIN_WIDTH_PX);

    drag = await beginDrag(page, dragY);
    await page.mouse.move(1_199, dragY, { steps: 8 });
    await expectShellWidth(page, MAX_WIDTH_PX);
    expect(await storedWidth(page)).toBe(String(MIN_WIDTH_PX));
    await page.mouse.up();
    expect(await storedWidth(page)).toBe(String(MAX_WIDTH_PX));
    await expectShellWidth(page, MAX_WIDTH_PX);

    drag = await beginDrag(page, dragY);
    await page.mouse.move(drag.startX - 45, dragY, { steps: 4 });
    await expectShellWidth(page, MAX_WIDTH_PX - 45);
    await page.keyboard.press("Escape");
    await expectShellWidth(page, MAX_WIDTH_PX);
    expect(await storedWidth(page)).toBe(String(MAX_WIDTH_PX));
    await page.mouse.up();

    drag = await beginDrag(page, dragY);
    await page.mouse.move(drag.startX - 45, dragY, { steps: 4 });
    await drag.handle.evaluate((element, pointerId) => {
      element.dispatchEvent(new PointerEvent("pointercancel", {
        bubbles: true,
        pointerId,
      }));
    }, drag.pointerId);
    await expectShellWidth(page, MAX_WIDTH_PX);
    expect(await storedWidth(page)).toBe(String(MAX_WIDTH_PX));
    await page.mouse.up();

    drag = await beginDrag(page, dragY);
    await page.mouse.move(drag.startX - 45, dragY, { steps: 4 });
    await drag.handle.evaluate((element, pointerId) => {
      element.releasePointerCapture(pointerId);
    }, drag.pointerId);
    await page.mouse.move(drag.startX - 44, dragY);
    await expectShellWidth(page, MAX_WIDTH_PX);
    expect(await storedWidth(page)).toBe(String(MAX_WIDTH_PX));
    await page.mouse.up();

    await page.locator(".app-sidebar-resize").dblclick({ position: { x: 3, y: dragY } });
    await expectShellWidth(page, DEFAULT_WIDTH_PX);
    expect(await storedWidth(page)).toBeNull();
    await page.reload();
    await configureTestMotion(page);
    await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
    await expect(page.locator(".app-sidebar-resize")).toBeVisible();
    await expectShellWidth(page, DEFAULT_WIDTH_PX);
    expect(await storedWidth(page)).toBeNull();

    for (const [stored, expected] of [
      ["100", MIN_WIDTH_PX],
      ["400", MAX_WIDTH_PX],
    ] as const) {
      const storedBoot = await bootWithStoredWidth(browser, product, stored);
      try {
        await expectShellWidth(storedBoot.page, expected);
        expect(await storedWidth(storedBoot.page)).toBe(stored);
      } finally {
        await storedBoot.close();
      }
    }
  } finally {
    await product.dispose();
  }
});
