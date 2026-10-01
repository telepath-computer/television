import { expect, test, type Locator, type Page } from "@playwright/test";
import { startMotionObservation } from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/artifact-menu-placement.html";

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface Placement {
  button: Rect;
  menu: Rect;
  viewport: { width: number; height: number };
  gap: number;
}

interface StagePosition {
  centerOffset: number;
  inlineTranslate: string;
  computedTranslate: string;
  scrollLeft: number;
}

declare global {
  interface Window {
    __artifactMenuDocumentsReady?: Set<string>;
    __artifactMenuFixture: {
      artifactIDs: string[];
      settle(): Promise<void>;
    };
    __fixtureReady?: boolean;
  }
}

function selectedTrigger(page: Page): Locator {
  return page.locator(".page[selected] .artifact-menu-trigger");
}

function selectedMenu(page: Page): Locator {
  return page.locator('.page[selected] tv-menu[open]');
}

async function placement(page: Page): Promise<Placement> {
  return page.locator(".page[selected]").evaluate((selectedPage) => {
    const button = selectedPage.querySelector<HTMLElement>(".artifact-menu-trigger");
    const menu = selectedPage.querySelector<HTMLElement>('tv-menu[open]');
    if (!button || !menu) throw new Error("Expected selected artifact menu");
    const rect = (element: HTMLElement): Rect => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    return { button: rect(button), menu: rect(menu),
      viewport: { width: innerWidth, height: innerHeight },
      gap: Number.parseFloat(getComputedStyle(menu).getPropertyValue("--popover-distance")),
    };
  });
}

async function stagePosition(page: Page): Promise<StagePosition> {
  return page.locator(".stage").evaluate((stage) => {
    const filmstrip = stage.querySelector<HTMLElement>(".filmstrip");
    const inner = stage.querySelector<HTMLElement>(".filmstrip-inner");
    const selectedPage = stage.querySelector<HTMLElement>(".page[selected]");
    if (!filmstrip || !inner || !selectedPage) throw new Error("Expected selected Stage page");
    const stripBox = filmstrip.getBoundingClientRect();
    const pageBox = selectedPage.getBoundingClientRect();
    return {
      centerOffset: pageBox.left + pageBox.width / 2 -
        (stripBox.left + stripBox.width / 2),
      inlineTranslate: inner.style.translate,
      computedTranslate: getComputedStyle(inner).translate,
      scrollLeft: filmstrip.scrollLeft,
    };
  });
}

function expectAnchored(value: Placement): void {
  const roomBelow = value.viewport.height - value.gap - value.button.bottom;
  const roomRight = value.viewport.width - value.gap - value.button.left;
  if (value.menu.width <= roomRight) {
    expect(Math.abs(value.menu.left - value.button.left), JSON.stringify(value)).toBeLessThan(2);
  } else {
    expect(Math.abs(value.menu.right - value.button.right), JSON.stringify(value)).toBeLessThan(2);
  }
  if (value.menu.height <= roomBelow) {
    expect(Math.abs(value.menu.top - value.button.bottom - value.gap), JSON.stringify(value)).toBeLessThan(2);
  } else {
    expect(Math.abs(value.button.top - value.menu.bottom - value.gap), JSON.stringify(value)).toBeLessThan(2);
  }
}

async function openMenu(page: Page): Promise<Placement> {
  const box = await selectedTrigger(page).boundingBox();
  if (!box) throw new Error("Expected selected artifact menu trigger geometry");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(selectedMenu(page)).toBeVisible();
  return placement(page);
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() =>
    window.__fixtureReady === true &&
    window.__artifactMenuFixture.artifactIDs.every((artifactID) =>
      window.__artifactMenuDocumentsReady?.has(artifactID)
    )
  );
  await page.evaluate(() => window.__artifactMenuFixture.settle());
}

test("fresh-channel centring uses scroll position without a persistent transform", async ({ page }) => {
  await openFixture(page);
  const value = await stagePosition(page);
  expect(value.inlineTranslate).toBe("");
  expect(value.computedTranslate).toBe("none");
  expect(value.scrollLeft).toBeGreaterThan(0);
  expect(Math.abs(value.centerOffset)).toBeLessThan(1);
});

test("initial and full-screen menus hang from their invoker", async ({ page }) => {
  await openFixture(page);
  expectAnchored(await openMenu(page));
  await page.keyboard.press("Escape");

  const observation = await startMotionObservation(page, ".stage");
  const titleBar = page.locator(".page[selected] .artifact-title-bar");
  const box = await titleBar.boundingBox();
  if (!box) throw new Error("Expected selected artifact title bar geometry");
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await observation.settle({ requireMotion: true });

  expectAnchored(await openMenu(page));
});
