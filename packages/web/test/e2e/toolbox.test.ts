import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ArtifactTemplateScan } from "@telepath-computer/television-shared";
import { configureTestMotion } from "./helpers.ts";

type Fixture = { actions: string[]; holdAction: boolean; finishAction(): void; set(scan: ArtifactTemplateScan | null, icons?: [string, string][]): void };
const items = Array.from({ length: 24 }, (_, index) => ({ id: `id-${index}`, name: `Item ${String(index).padStart(2, "0")}`, description: "Description only", version: "1.0.0", path: `/templates/id-${index}`, hasIcon: false }));
async function set(page: Page, templates = items, errors: ArtifactTemplateScan["errors"] = [], icons?: [string, string][]) {
  await page.evaluate(({ scan, icons }) => (window as unknown as { toolbox: Fixture }).toolbox.set(scan, icons), {
    scan: { templates, errors, watching: true },
    icons,
  });
}
async function actions(page: Page) {
  return page.evaluate(() => (window as unknown as { toolbox: Fixture }).toolbox.actions);
}

type KeyCapture = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  isTrusted: boolean;
  defaultPrevented: boolean | null;
};

type CapturingInput = HTMLInputElement & { __toolboxKeyCaptures?: KeyCapture[] };

async function captureKeys(search: Locator) {
  await search.evaluate((input: CapturingInput) => {
    input.__toolboxKeyCaptures = [];
    input.addEventListener("keydown", event => {
      const capture: KeyCapture = {
        key: event.key,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        isComposing: event.isComposing,
        isTrusted: event.isTrusted,
        defaultPrevented: null,
      };
      input.__toolboxKeyCaptures!.push(capture);
      setTimeout(() => { capture.defaultPrevented = event.defaultPrevented; });
    }, { capture: true });
  });
}

async function pressAndCapture(search: Locator, chord: string): Promise<KeyCapture> {
  const index = await search.evaluate((input: CapturingInput) => input.__toolboxKeyCaptures?.length ?? 0);
  const key = chord.split("+").at(-1)!;
  await search.press(chord);
  await expect.poll(() => search.evaluate((input: CapturingInput, options) =>
    input.__toolboxKeyCaptures?.slice(options.index).find(capture => capture.key === options.key)?.defaultPrevented ?? null,
  { index, key })).not.toBeNull();
  return search.evaluate((input: CapturingInput, options) =>
    input.__toolboxKeyCaptures!.slice(options.index).find(capture => capture.key === options.key)!, { index, key });
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
  await captureKeys(search);
  const searchBox = (await search.boundingBox())!;
  expect((await body.boundingBox())!.y).toBeCloseTo(searchBox.y + searchBox.height);
  expect((await tiles.first().boundingBox())!.y).toBeGreaterThan(searchBox.y + searchBox.height);
  await expect(footer).toBeVisible();
  const footerBox = (await footer.boundingBox())!;
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("aria-haspopup", "grid");
  await expect(search).toHaveAttribute("aria-autocomplete", "list");
  await expect(search).toHaveAttribute("aria-expanded", "true");
  const gridID = await grid.getAttribute("id");
  expect(gridID).toBeTruthy();
  await expect(search).toHaveAttribute("aria-controls", gridID!);
  await expect(page.locator(`[id="${gridID}"]`)).toHaveAttribute("role", "grid");
  await expect(rows).toHaveCount(8);
  await expect(rows.first().getByRole("gridcell")).toHaveCount(3);
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.press("Enter");
  expect(await actions(page)).toEqual([]);
  await search.fill("description");
  await expect(tiles).toHaveCount(0);
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(search).not.toHaveAttribute("aria-controls");
  for (const key of ["ArrowUp", "ArrowDown"]) {
    expect(await pressAndCapture(search, key)).toMatchObject({ key, defaultPrevented: false });
  }
  await search.fill("  ITEM 0  ");
  await expect(tiles).toHaveCount(10);
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  // Keep Chromium's Alt+Left and Alt+Right defaults inside this document.
  await page.evaluate(() => history.pushState(null, "", `${location.pathname}${location.search}#toolbox-modifiers`));
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    for (const [modifier, property] of [["Shift", "shiftKey"], ["Alt", "altKey"], ["Meta", "metaKey"], ["Control", "ctrlKey"]] as const) {
      const captured = await pressAndCapture(search, `${modifier}+${key}`);
      expect(captured).toMatchObject({ key, [property]: true, defaultPrevented: false });
      await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
    }
  }
  const queryEnd = await search.evaluate((input: HTMLInputElement) => {
    input.setSelectionRange(input.value.length, input.value.length);
    return input.value.length;
  });
  await search.press("Shift+ArrowLeft");
  expect(await search.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([queryEnd - 1, queryEnd]);
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  expect(await pressAndCapture(search, "ArrowLeft")).toMatchObject({ key: "ArrowLeft", defaultPrevented: true });
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
  expect(await pressAndCapture(search, "ArrowRight")).toMatchObject({ key: "ArrowRight", defaultPrevented: true });
  await search.fill("");
  expect(await pressAndCapture(search, "ArrowUp")).toMatchObject({ key: "ArrowUp", defaultPrevented: true });
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.press("ArrowDown");
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  await set(page, [items[1]!, items[0]!, ...items.slice(2)]);
  await expect(tiles.first()).toHaveAccessibleName("Item 01");
  await expect(tiles.nth(1)).toHaveAttribute("aria-selected", "true");
  await set(page, [...items.slice(1), items[0]!]);
  await expect(tiles.last()).toHaveAccessibleName("Item 00");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  expect((await tiles.last().boundingBox())!.y + (await tiles.last().boundingBox())!.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
  expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
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
  const updatedIcon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="blue"/></svg>');
  await set(page, items.slice(2), [], [["id-21", updatedIcon]]);
  await expect(tiles.nth(19).locator("img")).toBeVisible();
  expect(await body.evaluate(element => element.scrollTop)).toBe(scrollBeforeHover);
  const coveredNeighbour = tiles.nth(20);
  const coveredNeighbourBox = (await coveredNeighbour.boundingBox())!;
  await page.mouse.move(coveredNeighbourBox.x + coveredNeighbourBox.width / 2, coveredFooterBox.y + 2);
  await expect(tiles.nth(19)).toHaveAttribute("aria-selected", "true");
  await expect(coveredNeighbour).toHaveAttribute("aria-selected", "false");
  await page.mouse.click(coveredNeighbourBox.x + coveredNeighbourBox.width / 2, coveredFooterBox.y + 2);
  expect(await actions(page)).toEqual([]);
  await body.evaluate(element => { element.scrollTop = 0; });
  const scrollBeforeFooterWheel = await body.evaluate(element => element.scrollTop);
  const wheelFooterBox = (await footer.boundingBox())!;
  await page.mouse.move(wheelFooterBox.x + wheelFooterBox.width / 2, wheelFooterBox.y + wheelFooterBox.height / 2);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollBeforeFooterWheel);
  expect(await footer.boundingBox()).toEqual(footerBox);
  await search.press("ArrowDown");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  expect(await pressAndCapture(search, "ArrowDown")).toMatchObject({ key: "ArrowDown", defaultPrevented: true });
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
  expect(await footer.evaluate(element => element.parentElement?.classList.contains("toolbox-body") === true
    && element.parentElement.lastElementChild === element)).toBe(true);
  for (const target of [tiles.last(), tiles.last().locator(".toolbox-name"), tiles.last().locator(".toolbox-icon")]) {
    await expect(target).toHaveCSS("user-select", "none");
  }
  await search.press("Escape");
  expect(await actions(page)).toEqual([]);
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await search.fill("Item 23");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => { (window as unknown as { toolbox: Fixture }).toolbox.holdAction = true; });
  await search.press("Enter");
  await expect.poll(() => actions(page)).toEqual(["id-23"]);
  await expect(page.getByRole("region", { name: "Toolbox" })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { toolbox: Fixture }).toolbox.finishAction(); });
  await expect(page.getByRole("region", { name: "Toolbox" })).not.toBeVisible();
});

// proofs/ui/app/toolbox.md#^toolbox-t-browser-input
test("CDP composition passes trusted arrows and Return through the search field", async ({ page }) => {
  await set(page);
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  const tiles = page.getByRole("gridcell");
  await captureKeys(search);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", { text: "Item", selectionStart: 4, selectionEnd: 4 });
    await expect(search).toHaveValue("Item");
    await expect(tiles).toHaveCount(items.length);
    await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(await pressAndCapture(search, key)).toMatchObject({
        key,
        isComposing: true,
        isTrusted: true,
        defaultPrevented: false,
      });
      await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
    }
    expect(await pressAndCapture(search, "Enter")).toMatchObject({
      key: "Enter",
      isComposing: true,
      isTrusted: true,
      defaultPrevented: false,
    });
    expect(await actions(page)).toEqual([]);
    await expect(search).toBeFocused();
  } finally {
    await cdp.detach();
  }
});

// proofs/ui/app/toolbox.md#^toolbox-t-browser-input
test("keyboard and search reveal highlights at both scrolling edges", async ({ page }) => {
  await set(page);
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  const tiles = page.getByRole("gridcell");
  const body = page.locator(".toolbox-body");
  const footer = page.locator(".toolbox-footer");

  for (let index = 0; index < 9; index++) await search.press("ArrowDown");
  await expect(tiles.last()).toHaveAttribute("aria-selected", "true");
  const bodyBox = (await body.boundingBox())!;
  expect((await tiles.first().boundingBox())!.y).toBeLessThan(bodyBox.y);

  for (let index = 0; index < 7; index++) await search.press("ArrowUp");
  await expect(tiles.nth(2)).toHaveAttribute("aria-selected", "true");
  const topTileBox = (await tiles.nth(2).boundingBox())!;
  expect(topTileBox.y).toBeGreaterThanOrEqual(bodyBox.y - 1);
  expect(topTileBox.y + topTileBox.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);

  for (let index = 0; index < 7; index++) await search.press("ArrowDown");
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const scrollBeforeSearch = await body.evaluate(element => element.scrollTop);
  expect(scrollBeforeSearch).toBeGreaterThan(0);
  expect((await tiles.first().boundingBox())!.y).toBeLessThan(bodyBox.y);
  await search.fill("Item");
  await expect(tiles).toHaveCount(items.length);
  await expect(tiles.first()).toHaveAttribute("aria-selected", "true");
  const searchedTileBox = (await tiles.first().boundingBox())!;
  expect(searchedTileBox.y).toBeGreaterThanOrEqual(bodyBox.y - 1);
  expect(searchedTileBox.y + searchedTileBox.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
  expect(await body.evaluate(element => element.scrollTop)).toBeLessThan(scrollBeforeSearch);
});

// proofs/ui/app/toolbox.md#^toolbox-t-browser-input
test("real scroll bar remains usable beside the sticky footer", async ({ browser, baseURL }) => {
  const visibleScrollbars = await browser.browserType().launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await visibleScrollbars.newPage({ baseURL, viewport: { width: 640, height: 800 } });
  try {
    await page.goto("/packages/web/test/e2e/fixtures/toolbox.html");
    await expect(page.getByRole("button", { name: "Toolbox", exact: true })).toBeVisible();
    await configureTestMotion(page);
    await set(page);
    await page.getByRole("button", { name: "Toolbox", exact: true }).click();
    const body = page.locator(".toolbox-body");
    const footer = page.locator(".toolbox-footer");
    const layout = await body.evaluate(element => {
      const bodyBounds = element.getBoundingClientRect();
      const footerBounds = element.querySelector<HTMLElement>(".toolbox-footer")!.getBoundingClientRect();
      return {
        gutterWidth: element.offsetWidth - element.clientWidth,
        scrollbarLeft: bodyBounds.left + element.clientLeft + element.clientWidth,
        footerRight: footerBounds.right,
      };
    });
    expect(layout.gutterWidth).toBeGreaterThan(0);
    expect(Math.abs(layout.footerRight - layout.scrollbarLeft)).toBeLessThanOrEqual(1);

    const bodyBox = (await body.boundingBox())!;
    const footerBox = (await footer.boundingBox())!;
    await page.mouse.click(
      bodyBox.x + bodyBox.width - layout.gutterWidth / 2,
      footerBox.y + footerBox.height / 2,
    );
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  } finally {
    await visibleScrollbars.close();
  }
});

// proofs/ui/app/toolbox.md#^toolbox-t-messages
test("pending, empty, unmatched and error messages stay plain and non-activatable", async ({ page }) => {
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  const body = page.locator(".toolbox-body");
  const content = page.locator(".toolbox-scroll-content");
  const footer = page.locator(".toolbox-footer");
  await expect(search).toBeFocused();
  await expect(content).toHaveText("");
  await expect(footer).toBeVisible();
  await expect(search).not.toHaveAttribute("aria-controls");
  await set(page, []);
  await expect(content).toHaveText("Nothing here yet.");
  await expect(footer).toBeVisible();
  await search.fill('<img src=x>');
  await expect(content).toHaveText('Nothing matches “<img src=x>”.');
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
  await expect(content).toHaveText("Could not read the templates folder.EACCES: <private-path>");
  await expect(footer).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await expect(search).not.toHaveAttribute("aria-controls");
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(body.locator("private-path")).toHaveCount(0);
});
