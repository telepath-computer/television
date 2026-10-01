import { expect, test, type Locator, type Page } from "@playwright/test";
import { retryWhenNavigationInterrupts } from "../../../../test/helpers/application-readiness.ts";

const SHELL_FIXTURE = "/packages/web/test/e2e/fixtures/app-shell.html";
const SELECTION_FIXTURE = "/packages/web/test/e2e/fixtures/app-selection.html";

async function waitForFixture(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
}

async function dragAcross(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Expected selection target box");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

test.describe("application root containment (^ap-ac-root-contained)", () => {
  test("contains overflowing child bands at desktop window widths", async ({ page }) => {
    for (const width of [520, 900]) {
      await page.setViewportSize({ width, height: 600 });
      await page.goto(SHELL_FIXTURE);
      const result = await retryWhenNavigationInterrupts(page, 5_000, async () => {
        await waitForFixture(page);
        return page.evaluate(async () => {
          const app = document.querySelector("#app")!;
          const sidebar = app.querySelector(".app-sidebar")!;
          const main = app.querySelector(".app-main")!;
          const topOverflow = app.querySelector(".top-overflow")!;
          const stageOverflow = app.querySelector(".stage-overflow")!;

          await new Promise<void>((resolve) => {
            const observer = new ResizeObserver(() => undefined);
            observer.observe(app);
            requestAnimationFrame(() => requestAnimationFrame(() => {
              observer.disconnect();
              resolve();
            }));
          });

          window.scrollTo({ left: 200, behavior: "instant" });
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

          return {
            state: app.getAttribute("data-app-state"),
            documentRange: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            scrollX: window.scrollX,
            rootScrollEvents: (window as unknown as { __rootScrollEvents: number }).__rootScrollEvents,
            sidebarWidth: sidebar.getBoundingClientRect().width,
            mainRight: main.getBoundingClientRect().right,
            viewportWidth: document.documentElement.clientWidth,
            topOverflowWidth: topOverflow.getBoundingClientRect().width,
            stageOverflowWidth: stageOverflow.getBoundingClientRect().width,
          };
        });
      });

      expect(result).toMatchObject({
        state: "connected",
        documentRange: 0,
        scrollX: 0,
        rootScrollEvents: 0,
        sidebarWidth: 260,
        mainRight: result.viewportWidth,
        topOverflowWidth: 2200,
        stageOverflowWidth: 2200,
      });
    }
  });
});

test.describe("application selection boundary (^ap-ac-selection)", () => {
  test("ordinary interface text is inert while a readable region remains selectable", async ({ page }) => {
    await page.goto(SELECTION_FIXTURE);
    await waitForFixture(page);

    const ordinary = page.locator("#ordinary");
    await dragAcross(page, ordinary);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

    await clearSelection(page);
    await ordinary.dblclick();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

    await clearSelection(page);
    await dragAcross(page, page.locator("#readable"));
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("READABLE text can be selected");

    await page.locator("#panel-trigger").click();
    await expect(page.locator("tv-popover")).toHaveAttribute("open", "");
    await clearSelection(page);
    await dragAcross(page, page.locator("#panel-ordinary"));
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await page.locator("#panel-ordinary").dblclick({ position: { x: 24, y: 24 } });
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await dragAcross(page, page.locator("#panel-readable"));
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("READABLE floating text can be selected");
  });
});

declare global {
  interface Window {
    __fixtureReady?: boolean;
  }
}
