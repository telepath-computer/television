import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/menu.html";

interface MenuSnapshot {
  actions: Record<"rename" | "pin" | "delete", number>;
  activeId: string;
  clicks: string[];
  focus: string[];
  signals: string[];
}

declare global {
  interface Window {
    __fixtureReady?: boolean;
    __menuFixture: {
      snapshot(): MenuSnapshot;
    };
  }
}

async function snapshot(page: Page): Promise<MenuSnapshot> {
  return page.evaluate(() => window.__menuFixture.snapshot());
}

test("command menu keyboard walk (^mn-ac-keyboard)", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);

  await page.locator(".menu-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("tv-menu")).toHaveAttribute("open", "");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({
      activeId: "rename",
      focus: ["rename"],
      signals: ["focus:rename"],
    });

  await page.keyboard.press("ArrowDown");
  let result = await snapshot(page);
  expect(result.activeId).toBe("pin");
  expect(result.focus).toEqual(["rename", "pin"]);

  await page.keyboard.press("ArrowUp");
  result = await snapshot(page);
  expect(result.activeId).toBe("rename");
  expect(result.focus).toEqual(["rename", "pin", "rename"]);

  await page.keyboard.press("ArrowUp");
  result = await snapshot(page);
  expect(result.activeId).toBe("rename");
  expect(result.focus).toEqual(["rename", "pin", "rename"]);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  result = await snapshot(page);
  expect(result.activeId).toBe("delete");
  expect(result.focus).toEqual(["rename", "pin", "rename", "pin", "delete"]);

  await page.keyboard.press("ArrowDown");
  result = await snapshot(page);
  expect(result.activeId).toBe("delete");
  expect(result.focus).toEqual(["rename", "pin", "rename", "pin", "delete"]);

  await page.keyboard.press("Enter");
  result = await snapshot(page);
  await expect(page.locator("tv-menu")).not.toHaveAttribute("open");
  await expect(page.locator(".menu-trigger")).toBeFocused();
  expect(result.clicks).toEqual(["delete"]);
  expect(result.actions).toEqual({ rename: 0, pin: 0, delete: 1 });
});
