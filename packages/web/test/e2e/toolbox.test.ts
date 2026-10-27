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
test("real search, grid keys, pointer, updates and scrolling preserve input focus", async ({ page }) => {
  await set(page);
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  const grid = page.getByRole("grid", { name: "Toolbox" });
  const rows = grid.getByRole("row");
  const tiles = grid.getByRole("gridcell");
  const body = page.locator(".toolbox-body");
  const footer = page.locator(".toolbox-footer");
  const searchBox = (await search.boundingBox())!;
  expect((await body.boundingBox())!.y).toBeCloseTo(searchBox.y + searchBox.height);
  expect((await tiles.first().boundingBox())!.y).toBeGreaterThan(searchBox.y + searchBox.height);
  await expect(footer).toBeVisible();
  const footerPaddingDifference = async () => {
    const footerHeight = (await footer.boundingBox())!.height;
    const padding = await body.evaluate(element => Number.parseFloat(getComputedStyle(element).paddingBottom));
    return Math.abs(footerHeight - padding);
  };
  await expect.poll(footerPaddingDifference).toBeLessThan(1);
  await footer.evaluate(element => { element.style.fontSize = "24px"; });
  await expect.poll(footerPaddingDifference).toBeLessThan(1);
  await footer.evaluate(element => { element.style.removeProperty("font-size"); });
  await expect.poll(footerPaddingDifference).toBeLessThan(1);
  const footerBox = (await footer.boundingBox())!;
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("aria-haspopup", "grid");
  await expect(search).toHaveAttribute("aria-autocomplete", "list");
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect(search).toHaveAttribute("aria-controls", "toolbox-grid");
  await expect(rows).toHaveCount(8);
  await expect(rows.first().getByRole("gridcell")).toHaveCount(3);
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.press("Enter");
  expect(await actions(page)).toEqual([]);
  await search.fill("description");
  await expect(tiles).toHaveCount(0);
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(search).not.toHaveAttribute("aria-controls");
  await search.fill("  ITEM 0  ");
  await expect(tiles).toHaveCount(10);
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    for (const modifier of ["shiftKey", "altKey", "metaKey", "ctrlKey"] as const) {
      const claimed = await search.evaluate((input, options) => {
        const event = new KeyboardEvent("keydown", { key: options.key, [options.modifier]: true, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      }, { key, modifier });
      expect(claimed).toBe(false);
      await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
    }
    const claimedDuringComposition = await search.evaluate((input, composedKey) => {
      const event = new KeyboardEvent("keydown", { key: composedKey, isComposing: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    }, key);
    expect(claimedDuringComposition).toBe(false);
    await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  }
  const queryEnd = await search.evaluate((input: HTMLInputElement) => {
    input.setSelectionRange(input.value.length, input.value.length);
    return input.value.length;
  });
  await search.press("Shift+ArrowLeft");
  expect(await search.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([queryEnd - 1, queryEnd]);
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  const firstEndpointClaimed = await search.evaluate(input => {
    const event = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(firstEndpointClaimed).toBe(true);
  await search.press("ArrowLeft");
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowRight");
  await expect(tiles.nth(1)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowRight");
  await expect(tiles.nth(2)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowRight");
  await expect(tiles.nth(3)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowLeft");
  await expect(tiles.nth(2)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowUp");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.evaluate((input: HTMLInputElement) => input.setSelectionRange(5, 5));
  await search.press("ArrowLeft");
  expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(4);
  await search.press("ArrowRight");
  expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(5);
  await search.press("ArrowDown");
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowDown");
  await expect(tiles.nth(3)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowRight");
  await expect(tiles.nth(4)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowLeft");
  await expect(tiles.nth(3)).toHaveAttribute("aria-selected", "true");
  for (let index = 0; index < 10; index++) await search.press("ArrowRight");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  const lastEndpointClaimed = await search.evaluate(input => {
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(lastEndpointClaimed).toBe(true);
  await search.fill("");
  await search.press("ArrowUp");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.press("ArrowDown");
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  await set(page, [items[1]!, items[0]!, ...items.slice(2)]);
  await expect(tiles.first()).toHaveAccessibleName("Item 01");
  await expect(tiles.nth(1)).toHaveAttribute("aria-selected", "true");
  await set(page, items.slice(2));
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(search).toBeFocused();
  const partlyCoveredTile = tiles.nth(19);
  await body.evaluate((element, index) => {
    const tile = element.querySelectorAll<HTMLElement>('[role="gridcell"]')[index]!;
    const footerElement = document.querySelector<HTMLElement>(".toolbox-footer")!;
    element.scrollTop += tile.getBoundingClientRect().bottom - footerElement.getBoundingClientRect().top - 12;
  }, 19);
  const coveredTileBox = (await partlyCoveredTile.boundingBox())!;
  const coveredFooterBox = (await footer.boundingBox())!;
  expect(coveredTileBox.y).toBeLessThan(coveredFooterBox.y);
  expect(coveredTileBox.y + coveredTileBox.height).toBeGreaterThan(coveredFooterBox.y);
  const scrollBeforeHover = await body.evaluate(element => element.scrollTop);
  await page.mouse.move(coveredTileBox.x + coveredTileBox.width / 2, coveredFooterBox.y - 2);
  await expect(tiles.nth(19)).toHaveAttribute("aria-selected", "true");
  expect(await body.evaluate(element => element.scrollTop)).toBe(scrollBeforeHover);
  await page.mouse.click(coveredTileBox.x + coveredTileBox.width / 2, coveredFooterBox.y + 2);
  expect(await actions(page)).toEqual([]);
  await search.press("ArrowDown");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  await tiles.nth(2).hover();
  await expect(tiles.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.mouse.down();
  await expect(tiles.nth(2)).toHaveAttribute("data-pressed", "");
  await expect(search).toBeFocused();
  await search.hover();
  await page.mouse.up();
  await expect(tiles.nth(2)).not.toHaveAttribute("data-pressed");
  for (let index = 0; index < items.length; index++) await search.press("ArrowDown");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  await expect(tiles.last()).toBeInViewport();
  expect((await tiles.last().boundingBox())!.y + (await tiles.last().boundingBox())!.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
  expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await tiles.first().boundingBox())!.y).toBeLessThan(searchBox.y + searchBox.height);
  expect(await search.boundingBox()).toEqual(searchBox);
  expect(await footer.boundingBox()).toEqual(footerBox);
  for (const target of [tiles.last(), tiles.last().locator(".toolbox-name"), tiles.last().locator(".toolbox-icon")]) {
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
  const footer = page.locator(".toolbox-footer");
  await expect(search).toBeFocused();
  await expect(body).toHaveText("");
  await expect(footer).toBeVisible();
  await expect(search).not.toHaveAttribute("aria-controls");
  await set(page, []);
  await expect(body).toHaveText("Nothing here yet.");
  await expect(footer).toBeVisible();
  await search.fill('<img src=x>');
  await expect(body).toHaveText('Nothing matches “<img src=x>”.');
  await expect(footer).toHaveText("Saved artifacts, ready to reuse anywhere. Ask your agent to add one.");
  await expect(body.locator("img")).toHaveCount(0);
  await set(page, [], [{ folder: "private-folder", error: "Bad" }]);
  await expect(page.getByRole("note")).toHaveText("1 template had errorsAsk your agent to read the Television skill and fix it.");
  await expect(body).not.toContainText("private-folder");
  await expect(body.locator("hr")).toHaveCount(1);
  await expect(footer).toBeVisible();
  await search.fill("");
  await expect(body.locator("hr")).toHaveCount(0);
  await expect(body).not.toContainText("Nothing here");
  await expect(footer).toBeVisible();
  await set(page, items.slice(0, 1), [{ folder: "one", error: "Bad" }, { folder: "two", error: "Bad" }]);
  await expect(page.getByRole("note")).toContainText("2 templates had errors");
  await expect(page.getByRole("note")).toContainText("fix them.");
  await expect(body.locator("hr")).toHaveCount(1);
  await expect(footer).toBeVisible();
  await search.fill("no matches");
  await expect(page.getByRole("gridcell")).toHaveCount(0);
  await expect(footer).toBeVisible();
  await page.getByRole("note").click();
  expect(await actions(page)).toEqual([]);
  await set(page, [], [{ folder: null, error: "EACCES: <private-path>" }]);
  await expect(body).toHaveText("Could not read the templates folder.EACCES: <private-path>");
  await expect(footer).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(search).not.toHaveAttribute("aria-controls");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(body.locator("private-path")).toHaveCount(0);
});
