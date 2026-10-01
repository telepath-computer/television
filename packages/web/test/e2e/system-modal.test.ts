import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/system-modal.html";

interface SystemModalFixtureWindow {
  __fixtureReady?: boolean;
  __disconnectCalls: number;
  __poseSystemModal(state: unknown): Promise<void>;
}

async function setup(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(
    () => (window as unknown as SystemModalFixtureWindow).__fixtureReady === true,
  );
}

async function pose(page: Page, state: unknown): Promise<void> {
  await page.evaluate(
    (nextState) =>
      (window as unknown as SystemModalFixtureWindow).__poseSystemModal(nextState),
    state,
  );
}

async function expectNativeModal(page: Page): Promise<void> {
  const dialogs = page.locator("dialog");
  await expect(dialogs).toHaveCount(1);
  await expect(dialogs).toBeVisible();
  expect(await dialogs.evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
}

test.describe("application system modal", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("connection dialogs resist Escape and backdrop input until the owner withdraws them (^sm-ac-blocking)", async ({ page }) => {
    for (const state of [
      { kind: "connecting" },
      { kind: "disconnected", nextRetryAt: null },
      { kind: "unauthorized" },
      { kind: "error", serverURL: "https://server.example", nextRetryAt: null },
    ]) {
      await pose(page, state);
      await expectNativeModal(page);
      await page.keyboard.press("Escape");
      await expectNativeModal(page);
      await page.mouse.click(5, 5);
      await expectNativeModal(page);
      expect(await page.evaluate(() => (window as unknown as SystemModalFixtureWindow).__disconnectCalls)).toBe(0);
      await pose(page, null);
      await expect(page.locator("dialog")).toHaveCount(0);
    }
  });

});
