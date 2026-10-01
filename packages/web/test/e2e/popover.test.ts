import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/popover.html";

type PanelId = "contained-panel" | "manual-panel" | "script-panel" | "second-panel";

interface PopoverSnapshot {
  activeId: string;
  containedActionPresses: number;
  focus: string[];
  open: Record<PanelId, boolean>;
  states: Record<PanelId, string[]>;
}

declare global {
  interface Window {
    __fixtureReady?: boolean;
    __popoverFixture: {
      presentByScript(): void;
      settle(): Promise<void>;
      snapshot(): PopoverSnapshot;
    };
  }
}

async function snapshot(page: Page): Promise<PopoverSnapshot> {
  return page.evaluate(() => window.__popoverFixture.snapshot());
}

async function settle(page: Page): Promise<PopoverSnapshot> {
  await page.evaluate(() => window.__popoverFixture.settle());
  return snapshot(page);
}

async function expectOpen(page: Page, panel: PanelId, state: boolean, states: string[]): Promise<void> {
  await expect
    .poll(async () => {
      const result = await snapshot(page);
      return { open: result.open[panel], states: result.states[panel] };
    })
    .toEqual({ open: state, states });
}

test("shared popover behavior (^po-ac-lifecycle)", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);

  const containedTrigger = page.locator("#contained-trigger");
  await containedTrigger.click();
  await expectOpen(page, "contained-panel", true, ["open"]);
  let result = await settle(page);
  await expect(containedTrigger).toBeFocused();
  expect(result.activeId).toBe("contained-trigger");
  expect(result.focus).toEqual(["contained-trigger"]);

  await expect(page.locator("#container > #contained-panel")).toBeVisible();

  await page.locator("#contained-action").click();
  result = await settle(page);
  expect(result.containedActionPresses).toBe(1);
  expect(result.open["contained-panel"]).toBe(true);

  await page.locator("#outside").click();
  await expectOpen(page, "contained-panel", false, ["open", "closed"]);

  await containedTrigger.click();
  await expectOpen(page, "contained-panel", true, ["open", "closed", "open"]);
  await page.keyboard.press("Escape");
  await expectOpen(page, "contained-panel", false, ["open", "closed", "open", "closed"]);

  await containedTrigger.click();
  await expectOpen(page, "contained-panel", true, ["open", "closed", "open", "closed", "open"]);
  await containedTrigger.click();
  await expectOpen(page, "contained-panel", false, ["open", "closed", "open", "closed", "open", "closed"]);

  await containedTrigger.click();
  await expectOpen(page, "contained-panel", true, ["open", "closed", "open", "closed", "open", "closed", "open"]);
  await page.locator("#second-trigger").click();
  await expectOpen(page, "contained-panel", false, ["open", "closed", "open", "closed", "open", "closed", "open", "closed"]);
  await expectOpen(page, "second-panel", true, ["open"]);

  await page.keyboard.press("Escape");
  await expectOpen(page, "second-panel", false, ["open", "closed"]);

  await page.locator("#manual-trigger").click();
  await expectOpen(page, "manual-panel", true, ["open"]);
  result = await snapshot(page);

  await page.locator("#outside").click();
  result = await settle(page);
  expect(result.open["manual-panel"]).toBe(true);

  await page.keyboard.press("Escape");
  result = await settle(page);
  expect(result.open["manual-panel"]).toBe(true);
  expect(result.states["manual-panel"]).toEqual(["open"]);

  await page.locator("#manual-trigger").click();
  await expectOpen(page, "manual-panel", false, ["open", "closed"]);
  result = await snapshot(page);
  expect(result.states["manual-panel"]).toEqual(["open", "closed"]);
});

test("a script presentation on the trigger's behalf anchors as the trigger press does (^po-ac-placement)", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);

  const trigger = page.locator("#script-trigger");
  const panel = page.locator("#script-panel");

  await trigger.click();
  await expectOpen(page, "script-panel", true, ["open"]);
  const triggerBox = await trigger.boundingBox();
  const pressedBox = await panel.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(pressedBox).not.toBeNull();
  if (triggerBox === null || pressedBox === null) return;

  await trigger.click();
  await expectOpen(page, "script-panel", false, ["open", "closed"]);

  await page.evaluate(() => window.__popoverFixture.presentByScript());
  await expectOpen(page, "script-panel", true, ["open", "closed", "open"]);
  const scriptBox = await panel.boundingBox();
  expect(scriptBox).not.toBeNull();
  if (scriptBox === null) return;

  // Preferred seat: below the trigger, leading edges aligned …
  expect(scriptBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  expect(Math.abs(scriptBox.x - triggerBox.x))
    .toBeLessThanOrEqual(1);
  // … in the same place the press put it.
  expect(Math.abs(scriptBox.x - pressedBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(scriptBox.y - pressedBox.y)).toBeLessThanOrEqual(1);
});
