import { expect, test, type Page } from "@playwright/test";
import type { ArtifactTemplateScan } from "@telepath-computer/television-shared";
import { configureTestMotion } from "./helpers.ts";

type Fixture = { actions: string[]; holdAction: boolean; finishAction(): void; set(scan: ArtifactTemplateScan | null, icons?: [string, string][]): void };
const items = Array.from({ length: 24 }, (_, index) => ({ id: `id-${index}`, name: `Item ${String(index).padStart(2, "0")}`, description: "Description only", version: "1.0.0", path: `/templates/id-${index}`, hasIcon: false }));
async function set(page: Page, templates = items, errors: ArtifactTemplateScan["errors"] = []) {
  await page.evaluate(scan => (window as unknown as { toolbox: Fixture }).toolbox.set(scan), { templates, errors, watching: true });
}
async function actions(page: Page) {
  return page.evaluate(() => (window as unknown as { toolbox: Fixture }).toolbox.actions);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/packages/web/test/e2e/fixtures/toolbox.html");
  await expect(page.getByRole("button", { name: "Toolbox", exact: true })).toBeVisible();
  await configureTestMotion(page);
});

// proofs/ui/app/toolbox.md#^toolbox-t-browser-input
test("real search, cursor keys, pointer, updates and scrolling preserve input focus", async ({ page }) => {
  await set(page);
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  const rows = page.getByRole("option");
  await expect(search).toBeFocused();
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.press("Enter");
  expect(await actions(page)).toEqual([]);
  await search.fill("description");
  await expect(rows).toHaveCount(0);
  await expect(search).not.toHaveAttribute("aria-controls");
  await search.fill("  ITEM 0  ");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowLeft");
  expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(9);
  await search.press("ArrowRight");
  expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(10);
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search.fill("");
  await search.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await set(page, [items[1]!, items[0]!, ...items.slice(2)]);
  await expect(rows.first()).toHaveAccessibleName("Item 01");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await set(page, items.slice(2));
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(search).toBeFocused();
  await rows.nth(2).hover();
  await expect(rows.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.mouse.down();
  await expect(rows.nth(2)).toHaveAttribute("data-pressed", "");
  await expect(search).toBeFocused();
  await search.hover();
  await page.mouse.up();
  await expect(rows.nth(2)).not.toHaveAttribute("data-pressed");
  for (let index = 0; index < items.length; index++) await search.press("ArrowDown");
  await expect(rows.last()).toHaveAttribute("aria-selected", "true");
  await expect(rows.last()).toBeInViewport();
  for (const target of [rows.last(), rows.last().locator(".toolbox-name"), rows.last().locator(".toolbox-icon")]) {
    await expect(target).toHaveCSS("user-select", "none");
    expect(await target.evaluate(element => (element as HTMLElement).draggable)).toBe(false);
  }
  await search.press("Escape");
  expect(await actions(page)).toEqual([]);
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.fill("Item 23");
  await page.evaluate(() => { (window as unknown as { toolbox: Fixture }).toolbox.holdAction = true; });
  await search.press("Enter");
  await expect.poll(() => actions(page)).toEqual(["id-23"]);
  await expect(page.getByRole("region", { name: "Toolbox" })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { toolbox: Fixture }).toolbox.finishAction(); });
  await expect(page.getByRole("region", { name: "Toolbox" })).not.toBeVisible();
});

// proofs/ui/app/toolbox.md#^toolbox-t-messages
test("pending, empty, unmatched and error messages stay plain and non-activatable", async ({ page }) => {
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  const body = page.locator(".toolbox-body");
  await expect(search).toBeFocused();
  await expect(body).toHaveText("");
  await expect(search).not.toHaveAttribute("aria-controls");
  await set(page, []);
  await expect(body).toHaveText("Nothing here yet. Ask your agent to add an artifact template.");
  await search.fill('<img src=x>');
  await expect(body).toHaveText('Nothing matches “<img src=x>”.');
  await expect(body.locator("img")).toHaveCount(0);
  await set(page, [], [{ folder: "private-folder", error: "Bad" }]);
  await expect(page.getByRole("note")).toHaveText("1 template had errorsAsk your agent to read the Television skill and fix it.");
  await expect(body).not.toContainText("private-folder");
  await expect(body.locator("hr")).toHaveCount(1);
  await search.fill("");
  await expect(body.locator("hr")).toHaveCount(0);
  await expect(body).not.toContainText("Nothing here");
  await set(page, items.slice(0, 1), [{ folder: "one", error: "Bad" }, { folder: "two", error: "Bad" }]);
  await expect(page.getByRole("note")).toContainText("2 templates had errors");
  await expect(page.getByRole("note")).toContainText("fix them.");
  await expect(body.locator("hr")).toHaveCount(1);
  await page.getByRole("note").click();
  expect(await actions(page)).toEqual([]);
  await set(page, [], [{ folder: null, error: "EACCES: <private-path>" }]);
  await expect(body).toHaveText("Could not read the templates folder.EACCES: <private-path>");
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(search).not.toHaveAttribute("aria-controls");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(body.locator("private-path")).toHaveCount(0);
});
