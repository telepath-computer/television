import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/update-notification-view.html";
const PROMPT = "Upgrade Television following https://television.run/install.md";

interface NoticeState {
  presented: boolean;
  copied: boolean;
  dismissals: number;
  presentations: number;
  copies: number;
  restarts: number;
  renderCount: number;
  scheduledTaskCount: number;
  toggles: string[];
}

const panel = (page: Page) => page.locator("#update-popover");
const bell = (page: Page) => page.locator("#mount > .update-bell");
const later = (page: Page) => page.locator("#update-popover .update-later");
const copy = (page: Page) => page.locator("#update-popover .copy-button");
const restart = (page: Page) => page.locator("#update-popover .update-restart");

async function gotoFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
}

async function present(page: Page, prompt?: string, restartState?: "ready"): Promise<void> {
  await page.evaluate(({ value, restartValue }) => {
    (window as unknown as {
      __presentNotice(options?: { prompt?: string; restart?: "ready" }): void;
    }).__presentNotice({ prompt: value, restart: restartValue });
  }, { value: prompt, restartValue: restartState });
  await expect(panel(page)).toBeVisible();
  await expect.poll(async () => (await noticeState(page)).toggles).toContain(
    "after:closed->open",
  );
}

async function clearRecords(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __clearNoticeRecords(): void }).__clearNoticeRecords();
  });
}

async function noticeState(page: Page): Promise<NoticeState> {
  return page.evaluate(() =>
    (window as unknown as { __noticeState(): NoticeState }).__noticeState()
  );
}

async function twoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test.describe("update notification panel presentation", () => {
  // proofs/ui/app/update-notification/index.md#^un-ac-restart
  test("the restart button requests the restart once and leaves the notice open, restarting (^un-ac-restart)", async ({ page }) => {
    await gotoFixture(page);
    await present(page, undefined, "ready");
    await expect(restart(page)).toHaveText("Restart to update");
    await clearRecords(page);

    await restart(page).click();
    await expect(restart(page)).toBeDisabled();
    await expect(restart(page)).toHaveText("Restarting…");
    await restart(page).click({ force: true });
    await twoAnimationFrames(page);

    await expect(panel(page)).toBeVisible();
    expect(await noticeState(page)).toMatchObject({
      presented: true,
      restarts: 1,
      dismissals: 0,
      toggles: [],
    });
  });

  test("automatic presentation preserves focus, never times out, and resists outside press (^un-ac-closing)", async ({ page }) => {
    await gotoFixture(page);
    await page.evaluate(() => {
      (window as unknown as { __controlNoticeTimers(): void }).__controlNoticeTimers();
    });
    await page.locator("#working").focus();
    await present(page, PROMPT);
    await expect(page.locator("#working")).toBeFocused();
    expect((await noticeState(page)).scheduledTaskCount).toBe(0);

    await clearRecords(page);
    await page.evaluate(() => {
      (window as unknown as { __drainNoticeTasks(): void }).__drainNoticeTasks();
    });
    await twoAnimationFrames(page);
    await expect(panel(page)).toBeVisible();
    expect(await noticeState(page)).toMatchObject({
      presented: true,
      dismissals: 0,
      presentations: 0,
      scheduledTaskCount: 0,
      toggles: [],
    });

    await page.locator("#outside").click();
    await twoAnimationFrames(page);
    await expect(panel(page)).toBeVisible();
    expect(await noticeState(page)).toMatchObject({
      presented: true,
      dismissals: 0,
      toggles: [],
    });
  });

  test("Later, the open bell, and Escape dismiss once; the closed bell only presents (^un-ac-closing)", async ({ page }) => {
    await gotoFixture(page);
    await present(page, PROMPT);
    await clearRecords(page);

    await later(page).click();
    await expect(panel(page)).not.toBeVisible();
    await expect.poll(async () => (await noticeState(page)).dismissals).toBe(1);
    expect(await noticeState(page)).toMatchObject({
      presented: false,
      dismissals: 1,
      presentations: 0,
    });

    await clearRecords(page);
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(async () => (await noticeState(page)).presentations).toBe(1);
    expect(await noticeState(page)).toMatchObject({
      presented: true,
      dismissals: 0,
      presentations: 1,
    });

    await expect.poll(async () => (await noticeState(page)).toggles).toContain(
      "after:closed->open",
    );
    await clearRecords(page);
    await bell(page).click();
    await expect(panel(page)).not.toBeVisible();
    await expect.poll(async () => (await noticeState(page)).dismissals).toBe(1);
    expect(await noticeState(page)).toMatchObject({
      presented: false,
      dismissals: 1,
      presentations: 0,
    });

    await present(page, PROMPT);
    await clearRecords(page);
    await later(page).focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).not.toBeVisible();
    await expect.poll(async () => (await noticeState(page)).dismissals).toBe(1);
    expect(await noticeState(page)).toMatchObject({
      presented: false,
      dismissals: 1,
      presentations: 0,
    });
  });

  for (const kind of ["popover", "menu"] as const) {
    test(`Escape inside the notice dismisses it once without closing another ${kind} (^un-ac-closing)`, async ({ page }) => {
      await gotoFixture(page);
      if (kind === "menu") {
        await page.locator("#other-panel").evaluate(element => {
          const menu = document.createElement("tv-menu");
          menu.id = element.id;
          menu.setAttribute("trigger", "other-trigger");
          menu.innerHTML = "<tv-menu-item>Other action</tv-menu-item>";
          element.replaceWith(menu);
        });
      }
      await present(page, PROMPT);
      await page.locator("#other-trigger").click();
      await expect(page.locator("#other-panel")).toBeVisible();
      // Tab reaches the notice without an outside press dismissing the other panel.
      await page.keyboard.press("Tab");
      await expect(bell(page)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(later(page)).toBeFocused();
      await clearRecords(page);

      await page.keyboard.press("Escape");

      await expect(panel(page)).toBeHidden();
      await expect(bell(page)).toBeFocused();
      await expect(page.locator("#other-panel")).toBeVisible();
      expect(await noticeState(page)).toMatchObject({ presented: false, dismissals: 1 });
    });
  }

  test("an open select consumes Escape before the focused notice (^un-ac-closing)", async ({ page }) => {
    await gotoFixture(page);
    await panel(page).evaluate(element => {
      const trigger = document.createElement("button");
      trigger.id = "notice-select-trigger";
      const select = document.createElement("tv-select");
      select.id = "notice-select";
      select.setAttribute("trigger", trigger.id);
      select.innerHTML = '<tv-option value="a">Alpha</tv-option><tv-option value="b">Beta</tv-option>';
      element.append(trigger, select);
    });
    await present(page, PROMPT);
    await page.locator("#notice-select-trigger").click();
    await expect(page.locator("#notice-select")).toBeVisible();
    await later(page).focus();
    await clearRecords(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#notice-select")).toBeHidden();
    await expect(panel(page)).toBeVisible();
    expect(await noticeState(page)).toMatchObject({ presented: true, dismissals: 0 });
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    expect(await noticeState(page)).toMatchObject({ presented: false, dismissals: 1 });
  });

  test("automatic presentation hangs off the bell exactly as bell presentation does (^un-ac-anchor)", async ({ page }) => {
    await gotoFixture(page);
    // The fixture presents by script, the production auto-present path —
    // never through the bell's trigger action.
    await present(page, PROMPT);
    const bellBox = await bell(page).boundingBox();
    const autoBox = await panel(page).boundingBox();
    expect(bellBox).not.toBeNull();
    expect(autoBox).not.toBeNull();
    if (bellBox === null || autoBox === null) return;

    // The trailing-edge fixture flips horizontally, keeping the shared below seat.
    expect(autoBox.y).toBeGreaterThanOrEqual(bellBox.y + bellBox.height);
    expect(Math.abs(autoBox.x + autoBox.width - (bellBox.x + bellBox.width)))
      .toBeLessThanOrEqual(1);

    // And the same place the bell itself puts it.
    await later(page).click();
    await expect(panel(page)).not.toBeVisible();
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    const invokedBox = await panel(page).boundingBox();
    expect(invokedBox).not.toBeNull();
    if (invokedBox === null) return;
    expect(Math.abs(invokedBox.x - autoBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(invokedBox.y - autoBox.y)).toBeLessThanOrEqual(1);

    await later(page).click();
    await page.locator("#mount").evaluate(element => { element.style.justifyContent = "flex-start"; });
    await present(page, PROMPT);
    await twoAnimationFrames(page);
    const leadingBell = (await bell(page).boundingBox())!;
    const leadingPanel = (await panel(page).boundingBox())!;
    expect(Math.abs(leadingPanel.x - leadingBell.x)).toBeLessThanOrEqual(1);
    expect(leadingPanel.y).toBeGreaterThanOrEqual(leadingBell.y + leadingBell.height);
  });

  test("closing and reopening clears the composed copy confirmation (^un-ac-copy-confirm)", async ({ page }) => {
    await gotoFixture(page);
    await present(page, PROMPT);

    await copy(page).click();
    await expect(copy(page)).toHaveAttribute("copied", "");
    await expect(copy(page).locator(".copy-button-done")).toHaveText("Copied");
    expect(await noticeState(page)).toMatchObject({ copied: true, copies: 1 });

    await later(page).click();
    await expect(panel(page)).not.toBeVisible();
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(copy(page)).not.toHaveAttribute("copied", "");
    await expect(copy(page).locator(".copy-button-idle")).toHaveText(
      "Copy upgrade prompt",
    );
    expect(await noticeState(page)).toMatchObject({ copied: false });
  });
});
