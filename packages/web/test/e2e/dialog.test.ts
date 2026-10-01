import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/dialog.html";

interface DialogPhase {
  animationCount: number;
  label: string;
  modal: boolean;
  open: boolean;
}

interface DialogSnapshot {
  activeId: string;
  animationEvents: string[];
  backgroundClicks: number;
  backgroundContainsFocus: boolean;
  backgroundPointerDowns: number;
  closeEvents: number;
  dialogContainsFocus: boolean;
  dialogRect: { left: number; top: number; right: number; bottom: number };
  dismissals: string[];
  focus: string[];
  insideClicks: number;
  modal: boolean;
  open: boolean;
  panelPaddingClicks: number;
  phases: DialogPhase[];
  popoverOpen: boolean;
  popoverToggles: string[];
  transitionEvents: string[];
}

declare global {
  interface Window {
    __dialogFixture: {
      openPopoverAndPresent(panelID?: string): Promise<void>;
      presentAgain(): Promise<void>;
      settle(label: string): Promise<void>;
      snapshot(): DialogSnapshot;
    };
    __fixtureReady?: boolean;
  }
}

async function snapshot(page: Page): Promise<DialogSnapshot> {
  return page.evaluate(() => window.__dialogFixture.snapshot());
}

function expectNoPresentationMotion(result: DialogSnapshot): void {
  expect(result.animationEvents).toEqual([]);
  expect(result.transitionEvents).toEqual([]);
  expect(result.phases.every((phase) => phase.animationCount === 0)).toBe(true);
}

test("native dialog modal behavior and dismissal (^dg-ac-modal-behaviour)", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);

  await page.evaluate(() => window.__dialogFixture.openPopoverAndPresent());
  let result = await snapshot(page);

  expect(result.popoverOpen).toBe(false);
  expect(result.popoverToggles).toContain("closed");
  expect(result.activeId).toBe("cancel");
  expect(result.dialogContainsFocus).toBe(true);
  expect(result.open).toBe(true);
  expect(result.modal).toBe(true);
  expect(result.closeEvents).toBe(0);
  expect(result.phases.slice(0, 4)).toEqual([
    { animationCount: 0, label: "entry:before", modal: false, open: true },
    { animationCount: 0, label: "entry:after-present", modal: true, open: true },
    { animationCount: 0, label: "entry:frame-1", modal: true, open: true },
    { animationCount: 0, label: "entry:frame-2", modal: true, open: true },
  ]);
  expectNoPresentationMotion(result);

  await page.mouse.click(
    result.dialogRect.left + 6,
    (result.dialogRect.top + result.dialogRect.bottom) / 2,
  );
  result = await snapshot(page);
  expect(result.panelPaddingClicks).toBe(1);
  expect(result.dismissals).toEqual([]);
  expect(result.open).toBe(true);
  expect(result.modal).toBe(true);

  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Tab");
    expect((await snapshot(page)).backgroundContainsFocus).toBe(false);
  }
  await page.evaluate(() => document.querySelector<HTMLElement>("#background-action")?.focus());
  result = await snapshot(page);
  expect(result.backgroundContainsFocus).toBe(false);

  const background = await page.locator("#background-action").boundingBox();
  if (!background) throw new Error("Expected background action bounds");
  await page.mouse.move(background.x + background.width / 2, background.y + background.height / 2);
  await page.mouse.down();
  result = await snapshot(page);
  expect(result.backgroundPointerDowns).toBe(0);
  expect(result.backgroundClicks).toBe(0);
  await page.mouse.move(result.dialogRect.left + 8, result.dialogRect.top + 8);
  await page.mouse.up();

  await page.locator("#inside-action").click();
  result = await snapshot(page);
  expect(result.insideClicks).toBe(1);
  expect(result.dismissals).toEqual([]);
  expect(result.open).toBe(true);
  expect(result.modal).toBe(true);

  await page.mouse.click(4, 4);
  await page.evaluate(() => window.__dialogFixture.settle("backdrop"));
  result = await snapshot(page);
  expect(result.dismissals).toEqual(["backdrop"]);
  expect(result.open).toBe(false);
  expect(result.modal).toBe(false);
  expect(result.closeEvents).toBe(1);
  expect(result.phases).toContainEqual({
    animationCount: 0,
    label: "backdrop:before-withdraw",
    modal: true,
    open: true,
  });
  expect(result.phases).toContainEqual({
    animationCount: 0,
    label: "backdrop:after-withdraw",
    modal: false,
    open: false,
  });
  expectNoPresentationMotion(result);

  await page.evaluate(() => window.__dialogFixture.presentAgain());
  result = await snapshot(page);
  expect(result.activeId).toBe("cancel");
  expect(result.open).toBe(true);
  expect(result.modal).toBe(true);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__dialogFixture.settle("escape"));
  result = await snapshot(page);
  expect(result.dismissals).toEqual(["backdrop", "escape"]);
  expect(result.open).toBe(false);
  expect(result.modal).toBe(false);
  expect(result.closeEvents).toBe(2);
  expect(result.phases).toContainEqual({
    animationCount: 0,
    label: "escape:before-withdraw",
    modal: true,
    open: true,
  });
  expect(result.phases).toContainEqual({
    animationCount: 0,
    label: "escape:after-withdraw",
    modal: false,
    open: false,
  });
  expectNoPresentationMotion(result);
});


for (const panelID of ["floating-normal", "floating-menu", "floating-select"]) {
  test(`dialog entry closes ${panelID} (^dg-ac-modal-behaviour)`, async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__fixtureReady === true);
    await page.evaluate(id => window.__dialogFixture.openPopoverAndPresent(id), panelID);
    expect((await snapshot(page)).popoverOpen).toBe(false);
    await expect(page.locator("dialog")).toBeVisible();
  });
}
