import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/keyboard-navigation.html";

type NavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface FixtureReport {
  platform: string;
  selectedArtifactId: string | null;
  activeElementId: string | null;
  operations: {
    handler: NavigationKey[];
    selectPage: Array<{ channelId: string; artifactId: string }>;
    focusChannel: string[];
    serverFocus: string[];
    shellEvents: Array<{ key: string; defaultPrevented: boolean }>;
  };
}

interface KeyboardNavigationFixture {
  constants: {
    focusedChannelId: string;
    newestChannelId: string;
    oldestChannelId: string;
    danglingPinnedChannelId: string;
    firstArtifactId: string;
    secondArtifactId: string;
  };
  clearOperations(): void;
  resetPage(): void;
  dispatchMatch(
    key: NavigationKey,
    targetKind?: "field" | "tab" | "body",
    overrides?: Partial<KeyboardEventInit>,
  ): {
    defaultPrevented: boolean;
    nativeResult: boolean;
    activeElementId: string | null;
  };
  report(): FixtureReport;
}

declare global {
  interface Window {
    __fixtureReady?: boolean;
    __keyboardNavigationFixture: KeyboardNavigationFixture;
  }
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);
}

async function report(page: Page): Promise<FixtureReport> {
  return page.evaluate(() => window.__keyboardNavigationFixture.report());
}

async function evaluateFixtureTransaction<T>(
  page: Page,
  transaction: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForFunction(() => window.__fixtureReady === true);
    try {
      return await transaction();
    } catch (error) {
      const fixtureReloaded = error instanceof Error &&
        error.message.includes("Execution context was destroyed");
      if (!fixtureReloaded || attempt === 2) throw error;
      console.warn(`Vite replaced the keyboard fixture document; retrying transaction ${attempt + 1}/2`);
    }
  }
  throw new Error("Unreachable fixture transaction retry state");
}

test.describe("shell navigation door (^kbn-ac-platform-seam, ^kbn-ac-shell-door)", () => {
  test("uses the real platform chord in a focused chrome field, continues from body focus, and leaves a non-match native", async ({ page }) => {
    await openFixture(page);
    // The fixture service is a Vite development server and may replace its
    // document while cold dependencies are optimized. Keep the synchronous
    // policy walk atomic and retry only that harness reload, never an
    // assertion or product outcome.
    const { constants, unmatched, unmatchedReport, matched, matchedReport } =
      await evaluateFixtureTransaction(page, () => page.evaluate(() => {
        const fixture = window.__keyboardNavigationFixture;
        fixture.resetPage();
        const unmatchedResult = fixture.dispatchMatch(
          "ArrowRight",
          "field",
          { shiftKey: true },
        );
        const unmatchedState = fixture.report();
        fixture.clearOperations();
        const matchedResult = fixture.dispatchMatch(
          "ArrowRight",
          "field",
          { repeat: true },
        );
        return {
          constants: fixture.constants,
          unmatched: unmatchedResult,
          unmatchedReport: unmatchedState,
          matched: matchedResult,
          matchedReport: fixture.report(),
        };
      }));

    expect(unmatched).toEqual({
      defaultPrevented: false,
      nativeResult: true,
      activeElementId: "keyboard-field",
    });
    expect(unmatchedReport.platform).not.toBe("");
    expect(unmatchedReport.operations.handler).toEqual([]);
    expect(unmatchedReport.operations.selectPage).toEqual([]);
    expect(unmatchedReport.operations.shellEvents).toEqual([
      { key: "ArrowRight", defaultPrevented: false },
    ]);

    expect(matched.defaultPrevented).toBe(true);
    expect(matched.nativeResult).toBe(false);
    expect(matched.activeElementId).not.toBe("keyboard-field");
    expect(matchedReport.operations.handler).toEqual(["ArrowRight"]);
    expect(matchedReport.operations.selectPage).toEqual([{
      channelId: constants.focusedChannelId,
      artifactId: constants.secondArtifactId,
    }]);
    expect(matchedReport.operations.shellEvents).toEqual([
      { key: "ArrowRight", defaultPrevented: true },
    ]);

    await page.evaluate(() => window.__keyboardNavigationFixture.clearOperations());
    const bodyFocusMatch = await page.evaluate(() =>
      window.__keyboardNavigationFixture.dispatchMatch("ArrowLeft", "body")
    );
    expect(bodyFocusMatch.activeElementId).toBe("");
    expect(bodyFocusMatch.defaultPrevented).toBe(true);
    const bodyFocusReport = await report(page);
    expect(bodyFocusReport.operations.handler).toEqual(["ArrowLeft"]);
    expect(bodyFocusReport.operations.selectPage).toEqual([{
      channelId: constants.focusedChannelId,
      artifactId: constants.firstArtifactId,
    }]);
  });
});

test.describe("one application navigation operation", () => {
  test("tab release and horizontal chord enter selectPage once with the same target (^kbn-ac-one-operation)", async ({ page }) => {
    await openFixture(page);
    const constants = await page.evaluate(() => window.__keyboardNavigationFixture.constants);

    await page.evaluate(() => window.__keyboardNavigationFixture.resetPage());
    await page.locator(`[data-artifact-id="${constants.secondArtifactId}"]`).click();
    await expect.poll(async () => (await report(page)).selectedArtifactId)
      .toBe(constants.secondArtifactId);
    expect((await report(page)).operations.selectPage).toEqual([{
      channelId: constants.focusedChannelId,
      artifactId: constants.secondArtifactId,
    }]);

    await page.evaluate(() => window.__keyboardNavigationFixture.resetPage());
    const matched = await page.evaluate(() =>
      window.__keyboardNavigationFixture.dispatchMatch("ArrowRight", "tab")
    );
    expect(matched.defaultPrevented).toBe(true);
    const keyboard = await report(page);
    expect(keyboard.operations.handler).toEqual(["ArrowRight"]);
    expect(keyboard.operations.selectPage).toEqual([{
      channelId: constants.focusedChannelId,
      artifactId: constants.secondArtifactId,
    }]);
    expect(keyboard.selectedArtifactId).toBe(constants.secondArtifactId);
  });

  test("channel-row release and vertical chord enter focusChannel once with the same target (^kbn-ac-one-operation-focus)", async ({ page }) => {
    await openFixture(page);
    const constants = await page.evaluate(() => window.__keyboardNavigationFixture.constants);

    const channelRows = page.locator(".channel-row");
    await expect(channelRows).toHaveCount(3);
    const renderedOrder = await channelRows.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-channel-id"))
    );
    expect(renderedOrder).toEqual([
      constants.focusedChannelId,
      constants.newestChannelId,
      constants.oldestChannelId,
    ]);
    expect(renderedOrder).not.toContain(constants.danglingPinnedChannelId);
    const nextRenderedChannelId = renderedOrder[1];
    if (nextRenderedChannelId === null || nextRenderedChannelId === undefined) {
      throw new Error("Missing the rendered channel after the focused row");
    }

    await page.evaluate(() => window.__keyboardNavigationFixture.clearOperations());
    await channelRows.nth(1).getByRole("option").click();
    await expect.poll(async () => (await report(page)).operations.focusChannel)
      .toEqual([nextRenderedChannelId]);
    let pointer = await report(page);
    expect(pointer.operations.serverFocus).toEqual([nextRenderedChannelId]);

    await page.evaluate(() => window.__keyboardNavigationFixture.clearOperations());
    const matched = await page.evaluate(() =>
      window.__keyboardNavigationFixture.dispatchMatch("ArrowDown", "field")
    );
    expect(matched.defaultPrevented).toBe(true);
    pointer = await report(page);
    expect(pointer.operations.handler).toEqual(["ArrowDown"]);
    expect(pointer.operations.focusChannel).toEqual([nextRenderedChannelId]);
    expect(pointer.operations.serverFocus).toEqual([nextRenderedChannelId]);
  });
});
