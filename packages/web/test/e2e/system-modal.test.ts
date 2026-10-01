import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/system-modal.html";

interface SystemModalFixtureWindow {
  __fixtureReady?: boolean;
  __authenticationCalls: string[];
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

  test("presents the production authorization form through a native modal dialog", async ({ page }) => {
    await expectNativeModal(page);
    const input = page.getByLabel("Access token");
    await expect(input).toBeFocused();

    await input.fill("   ");
    await page.getByRole("button", { name: "Connect" }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as SystemModalFixtureWindow).__authenticationCalls,
      ),
    ).toEqual([]);

    await input.fill("  browser-token  ");
    await page.getByRole("button", { name: "Connect" }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as SystemModalFixtureWindow).__authenticationCalls,
      ),
    ).toEqual(["browser-token"]);
  });

  test("switches between the routed upgrade gate and the standard dialog without stacking", async ({ page }) => {
    await pose(page, {
      kind: "needs-upgrade",
      instructions: { upgradeMarkdown: "# Upgrade this desktop\n\nUse the channel instructions." },
    });

    await expect(page.locator(".desktop-upgrade-gate")).toContainText("Upgrade this desktop");
    await expect(page.locator(".system-modal")).toHaveCount(0);
    await expectNativeModal(page);

    await pose(page, { kind: "connecting" });

    await expect(page.locator(".desktop-upgrade-gate")).toHaveCount(0);
    await expect(page.locator(".system-modal h2")).toHaveText("Connecting");
    await expectNativeModal(page);
  });
});
