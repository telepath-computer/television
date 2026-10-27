/** Real browser acceptance for the copied editable Table and its JSON store. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 760, height: 770 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

type Column = { order: number; name?: string; [key: string]: JSONValue };
type Row = { order: number; cells: Record<string, string | number | boolean>; [key: string]: JSONValue };
type TableData = {
  showHeader?: boolean;
  columns: Record<string, Column>;
  rows: Record<string, Row>;
  [key: string]: JSONValue;
};

const fixture = (): TableData => ({
  showHeader: true,
  columns: {
    c1: { order: 1, name: "Park" }, c2: { order: 2, name: "State" },
    c3: { order: 3, name: "Open" }, c4: { order: 4, name: "Rating" },
  },
  rows: {
    r1: { order: 1, cells: { c1: "Acadia", c2: "Maine", c3: true, c4: 4.9 } },
    r2: { order: 2, cells: { c1: "Arches", c2: "Utah", c3: true, c4: 4.8 } },
    r3: { order: 3, cells: { c1: "Everglades", c2: "Florida", c3: false, c4: 4.6 } },
    r4: { order: 4, cells: { c1: "Olympic", c2: "Washington", c3: true, c4: 4.8 } },
    r5: { order: 5, cells: { c1: "Yosemite", c2: "California", c3: true, c4: 4.9 } },
    r6: { order: 6, cells: { c1: "Zion", c2: "Utah", c3: true } },
  },
});

let h: TemplateHarness;
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("Table page error:", error));
  h = await TemplateHarness.start({ id: "table", name: "Table" });
});
test.afterEach(async () => { await h?.cleanup(); });

const grid = (page: Page | Frame): Locator => page.getByRole("grid", { name: "Table" });
const cell = (page: Page | Frame, row: number, column: number): Locator =>
  page.locator(`[data-cell][data-row-index="${row}"][data-column-index="${column}"]`);
const header = (page: Page | Frame, column: number): Locator =>
  page.locator(`[data-header-text][data-column-index="${column}"]`);
const rowButton = (page: Page | Frame, row: number): Locator => page.getByRole("button", { name: `Select row ${row + 1}`, exact: true });
const columnButton = (page: Page | Frame, column: string): Locator => page.getByRole("button", { name: `Select column ${column}`, exact: true });
const editor = (page: Page | Frame): Locator => page.locator(".table-input");
const status = (page: Page | Frame): Locator => page.locator(".table-status");

async function open(page: Page, value: TableData = fixture()): Promise<string> {
  const id = await h.createStored(value);
  await h.open(page, id);
  await expect(grid(page)).toBeVisible();
  return id;
}

function writes(): Record<string, unknown>[] {
  return h.proxy.messages.filter(({ message }) => message.type === "write")
    .map(({ message }) => message.write as Record<string, unknown>);
}

function updateKeys(write: Record<string, unknown>): string[] {
  return (write.entries as Array<{ key: string }>).map(entry => entry.key).sort();
}

async function blankAreaBelowGrid(page: Page): Promise<{ x: number; y: number }> {
  const tableBox = await grid(page).boundingBox();
  const frameBox = await page.locator(".table-frame").boundingBox();
  if (!tableBox || !frameBox) throw new Error("Table has no rendered bounds");
  const y = Math.min(frameBox.y + frameBox.height - 12, tableBox.y + tableBox.height + 24);
  if (y <= tableBox.y + tableBox.height) throw new Error("Table has no blank area below the grid");
  return { x: frameBox.x + frameBox.width - 24, y };
}

// proofs/ui/templates/table.md#^table-ac-new
// proofs/ui/templates/table.md#^table-ac-selection
// proofs/ui/templates/table.md#^table-ac-keyboard
// proofs/arch/templates/table.md#^templates-table-t-assets
// proofs/product/templates.md delegates the bundled creation journey to table-ac-new.
test("a new Table draws four by four without writing, then its independent copy edits", async ({ page }) => {
  const responses: { url: string; body: Buffer; ok: boolean }[] = [];
  const bodies: Promise<void>[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/(styles\.css|components\.js)|sdk\/v1\/resources\.js|\/(styles\.css|page\.js|model\.js|selection-model\.js)$/.test(response.url())) {
      bodies.push(response.body().then(body => { responses.push({ url: response.url(), body, ok: response.ok() }); }));
    }
  });
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));

  const { artifactID: id, frame } = await h.create(page);
  await expect(grid(frame)).toHaveAttribute("aria-rowcount", "4");
  await expect(grid(frame)).toHaveAttribute("aria-colcount", "4");
  await expect(frame.getByRole("gridcell")).toHaveCount(16);
  await expect(grid(frame)).not.toBeFocused();
  await expect(frame.locator(":focus")).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "Add row at end" })).toHaveCount(0);
  expect(await h.read(id)).toEqual({ columns: {}, rows: {} });
  expect(writes()).toEqual([]);

  const layout = (await h.client.channels.get({ channelID: h.channelID })).channel.layout;
  expect(layout[0]).toMatchObject({ size: { width: 760, height: 770 }, geometry: { kind: "single", full_screen: false } });
  await Promise.all(bodies);
  expect(responses.every(response => response.ok)).toBe(true);
  for (const name of ["styles.css", "page.js", "model.js", "selection-model.js"]) {
    expect(responses.find(response => response.url.endsWith(`/artifact/${id}/${name}`))?.body)
      .toEqual(readFileSync(path.resolve(import.meta.dirname, `../../../server/assets/templates/table/${name}`)));
  }
  expect(responses.some(response => response.url.includes("/canonical/v2/components.js"))).toBe(true);
  expect(responses.some(response => response.url.includes("/canonical/v2/styles.css"))).toBe(true);
  expect(responses.some(response => response.url.includes("/sdk/v1/resources.js"))).toBe(true);
  expect(requests.some(url => /storybook|\/specs\//.test(url))).toBe(false);

  renameSync(path.join(h.home, "templates/table"), path.join(h.home, "table-outside-discovery"));
  await page.reload();
  const copy = await h.frame(page, id);
  await cell(copy, 2, 1).click();
  await page.keyboard.type("First");
  await editor(copy).press("Enter");
  await expect.poll(async () => {
    const value = await h.read<TableData>(id);
    const row = Object.values(value!.rows).sort((left, right) => left.order - right.order)[2];
    const columnKey = Object.entries(value!.columns).sort((left, right) => left[1].order - right[1].order)[1]?.[0];
    return { columns: Object.keys(value!.columns).length, rows: Object.keys(value!.rows).length, text: row?.cells[columnKey!] };
  }).toEqual({ columns: 2, rows: 3, text: "First" });
  await expect(cell(copy, 3, 1)).toHaveAttribute("data-selection", "cell");
  await expect(grid(copy)).toHaveAttribute("aria-rowcount", "4");
  await expect(grid(copy)).toHaveAttribute("aria-colcount", "4");
  await cell(copy, 3, 3).click();
  await page.keyboard.press("Enter");
  await editor(copy).press("Tab");
  await expect(page.locator(`.stage .page[data-page-key="${id}"] iframe`)).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cell(copy, 3, 3)).toBeFocused();

  await cell(copy, 0, 0).click();
  await page.keyboard.press("Enter");
  await expect(cell(copy, 0, 0)).toHaveAttribute("tabindex", "-1");
  await editor(copy).press("Shift+Tab");
  await expect(page.locator(`.stage .page[data-page-key="${id}"] iframe`)).not.toBeFocused();
  await page.reload();
  const reloaded = await h.frame(page, id);
  await expect(cell(reloaded, 2, 1)).toHaveText("First");
});

test("object-property column keys render as ordinary columns", async ({ page }) => {
  const columns = Object.fromEntries([
    ["constructor", { order: 1, name: "Constructor" }],
    ["toString", { order: 2, name: "Stringer" }],
    ["__proto__", { order: 3, name: "Prototype" }],
  ]);
  const cells = Object.fromEntries([["__proto__", "own prototype cell"]]);
  await open(page, { showHeader: true, columns, rows: { r1: { order: 1, cells } } });

  await expect(page.getByRole("columnheader")).toHaveCount(4);
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "5");
  await expect(grid(page)).toHaveAttribute("aria-colcount", "4");
  await expect(page.locator('[data-column-key="constructor"]')).toHaveCount(4);
  await expect(page.locator('[data-column-key="__proto__"]')).toHaveCount(4);
  await expect(page.locator("[data-column-key]")).toHaveCount(12);
  await expect(page.locator("[data-row-key]")).toHaveCount(4);
  await expect(cell(page, 0, 0)).toHaveText("");
  await expect(cell(page, 0, 1)).toHaveText("");
  await expect(cell(page, 0, 2)).toHaveText("own prototype cell");
});

// proofs/ui/templates/table.md#^table-ac-rows
// proofs/ui/templates/table.md#^table-ac-editing
// proofs/ui/templates/table.md#^table-ac-selection
// proofs/ui/templates/table.md#^table-ac-keyboard
test("stored values render in order and spreadsheet editing follows pointer and keyboard", async ({ page }) => {
  const value = fixture();
  for (let index = 5; index <= 8; index += 1) {
    value.columns[`c${index}`] = index === 6 ? { order: index } : { order: index, name: index === 5 ? "Notes" : `Column ${index}` };
  }
  value.rows.r1!.cells.c5 = "First\nsecond";
  value.rows.r1!.cells.c8 = "A cell value long enough to overflow its fixed-width column";
  for (let index = 7; index <= 40; index += 1) {
    value.rows[`r${index}`] = { order: index, cells: { c1: `Park ${index}`, c2: "Somewhere", c8: "Wide" } };
  }
  const id = await open(page, value);

  await expect(page.getByRole("columnheader")).toHaveCount(8);
  expect(await page.getByRole("columnheader").allTextContents()).toEqual([
    "Park", "State", "Open", "Rating", "Notes", "", "Column 7", "Column 8",
  ]);
  await expect(header(page, 5)).toHaveAccessibleName("Column F");
  await expect(cell(page, 0, 2)).toHaveText("true");
  await expect(cell(page, 2, 2)).toHaveText("false");
  await expect(cell(page, 0, 3)).toHaveText("4.9");
  await expect(cell(page, 0, 4)).toHaveText("First second");
  await expect(cell(page, 5, 3)).toHaveText("");
  await expect(cell(page, 0, 7)).toHaveCSS("text-overflow", "ellipsis");
  await expect(cell(page, 0, 7)).toHaveCSS("white-space", "nowrap");
  await expect.poll(() => cell(page, 0, 7).locator("span").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "41");
  await expect(grid(page)).toHaveAttribute("aria-colcount", "8");
  await expect(cell(page, 0, 0)).toHaveAccessibleName("Acadia");
  await expect(page.locator('[data-action="add-row"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-action="add-column"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-row-select][data-row-index="0"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-column-select][data-column-index="0"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(cell(page, 0, 0)).toBeFocused();
  await expect(cell(page, 0, 0)).toHaveAttribute("aria-selected", "true");
  await expect(cell(page, 0, 0).locator("xpath=..")).toHaveAttribute("aria-rowindex", "2");
  await expect(cell(page, 0, 0)).toHaveAttribute("aria-colindex", "1");
  const scroll = page.locator(".table-scroll");
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true);
  const headerBefore = await page.getByRole("columnheader").first().boundingBox();
  await cell(page, 0, 0).click();
  const stripBefore = await columnButton(page, "A").boundingBox();
  await scroll.hover();
  await page.mouse.wheel(200, 300);
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft > 0 && element.scrollTop > 0)).toBe(true);
  const headerAfter = await page.getByRole("columnheader").first().boundingBox();
  const stripAfter = await columnButton(page, "A").boundingBox();
  expect(Math.abs((headerAfter?.y ?? 0) - (headerBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((stripAfter?.y ?? 0) - (stripBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  await scroll.evaluate(element => element.scrollTo(0, 0));

  await cell(page, 0, 0).click();
  await expect(rowButton(page, 0)).toHaveAttribute("data-emphasis", "related");
  await expect(columnButton(page, "A")).toHaveAttribute("data-emphasis", "related");
  for (let index = 0; index < 25; index += 1) await page.keyboard.press("ArrowDown");
  await expect.poll(() => scroll.evaluate(element => element.scrollTop > 0)).toBe(true);
  const focusedCellBox = await page.locator('[data-cell][data-selection="cell"]').boundingBox();
  const scrollBox = await scroll.boundingBox();
  expect(focusedCellBox!.y + focusedCellBox!.height).toBeLessThanOrEqual(scrollBox!.y + scrollBox!.height);
  await scroll.evaluate(element => element.scrollTo(0, 0));

  await cell(page, 1, 1).dblclick();
  await expect(editor(page)).toHaveValue("Utah");
  await expect(editor(page)).toHaveAccessibleName("Row 2, column B");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Utah".length);
  await editor(page).press("ArrowLeft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Utah".length - 1);
  await editor(page).press("Escape");

  await cell(page, 3, 1).click();
  await expect(cell(page, 3, 1)).toHaveAttribute("data-selection", "cell");
  await page.keyboard.type("C");
  await expect(editor(page)).toHaveValue("C");
  await editor(page).press("Escape");
  await expect(cell(page, 3, 1)).toHaveText("Washington");
  await expect(cell(page, 3, 1)).toHaveAttribute("data-selection", "cell");

  await page.keyboard.press("F2");
  await expect(editor(page)).toHaveValue("Washington");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Washington".length);
  await editor(page).fill("Washington state");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r4/cells/c2")).toBe("Washington state");
  await expect(cell(page, 4, 1)).toHaveAttribute("data-selection", "cell");
  expect(writes().at(-1)).toMatchObject({ kind: "set", path: "rows/r4/cells/c2" });

  await header(page, 1).click();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 0, 1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(header(page, 1)).toBeFocused();
  await header(page, 1).press("Enter");
  await expect(editor(page)).toHaveAccessibleName("Column B name");
  await editor(page).fill("Region");
  const beforeHeaderEdit = writes().length;
  await editor(page).press("Tab");
  await expect.poll(() => h.read(id, "columns/c2/name")).toBe("Region");
  expect(writes().slice(beforeHeaderEdit)).toContainEqual(expect.objectContaining({ kind: "set", path: "columns/c2/name" }));
  await expect(header(page, 2)).toHaveAttribute("data-selection", "header");

  const beforeHeaderClear = writes().length;
  await header(page, 2).press("Delete");
  await expect.poll(() => h.read(id, "columns/c3/name")).toBeUndefined();
  expect(writes().slice(beforeHeaderClear)).toContainEqual(expect.objectContaining({ kind: "remove", path: "columns/c3/name" }));
  await expect(header(page, 2)).toHaveAttribute("data-selection", "header");

  await cell(page, 0, 4).click();
  await page.keyboard.press("Enter");
  await editor(page).press("ControlOrMeta+A");
  await editor(page).press("ControlOrMeta+C");
  expect(await h.readClipboard(page)).toBe("First\nsecond");
  await h.clipboard(page, "Pasted\nline", "<b>ignored</b>");
  await editor(page).focus();
  await editor(page).press("ControlOrMeta+A");
  await editor(page).press("ControlOrMeta+V");
  await expect(editor(page)).toHaveValue("Pasted\nline");
  await editor(page).pressSequentially(" changed");
  await editor(page).press("ControlOrMeta+Z");
  await expect(editor(page)).toHaveValue("Pasted\nline");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c5")).toBe("Pasted\nline");
  await expect(cell(page, 0, 4)).toHaveText("Pasted line");

  await cell(page, 0, 0).click();
  await page.keyboard.type("Coast");
  await header(page, 0).click();
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Coast");
  await expect(header(page, 0)).toHaveAttribute("data-selection", "header");

  const columnCount = Object.keys((await h.read<TableData>(id))!.columns).length;
  await cell(page, 0, 7).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Edge");
  await editor(page).press("Tab");
  await expect.poll(() => h.read(id, "rows/r1/cells/c8")).toBe("Edge");
  await expect(editor(page)).toHaveCount(0);
  expect(Object.keys((await h.read<TableData>(id))!.columns)).toHaveLength(columnCount);
  await expect(cell(page, 0, 7)).toHaveAttribute("data-selection", "cell");
  await expect(cell(page, 0, 7)).not.toBeFocused();

  await cell(page, 1, 0).click();
  await page.keyboard.type("Outside");
  await page.mouse.click(1, 1);
  await expect.poll(() => h.read(id, "rows/r2/cells/c1")).toBe("Outside");
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();

  await cell(page, 0, 0).click();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, 0, 1)).toBeFocused();
  await page.keyboard.press("Shift+Space");
  await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  for (const key of ["Enter", "F2", "x", "Space"]) {
    await page.keyboard.press(key);
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  }
  await cell(page, 0, 1).click();
  await page.keyboard.press("Control+Shift+Space");
  await expect(columnButton(page, "B")).toHaveAttribute("aria-pressed", "true");
  for (const key of ["Enter", "F2", "x", "Space"]) {
    await page.keyboard.press(key);
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(columnButton(page, "B")).toHaveAttribute("aria-pressed", "true");
  }
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Column actions" })).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Column actions" })).toHaveCount(0);
  await expect(columnButton(page, "B")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 0, 0)).toBeFocused();
});

// proofs/ui/templates/table.md#^table-ac-editing
// proofs/ui/templates/table.md#^table-ac-keyboard
test("editing covers reverse movement, edges, cancellation and editor keys", async ({ page }) => {
  const id = await open(page);

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveValue("Utah");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Utah".length);
  await editor(page).press("Shift+Space");
  await editor(page).press("Control+Shift+Space");
  await expect(editor(page)).toHaveValue("Utah ");
  await expect(editor(page)).toBeFocused();
  await editor(page).press("Escape");
  await expect(cell(page, 1, 1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(grid(page)).toBeFocused();
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Moved up");
  await editor(page).press("Shift+Enter");
  await expect.poll(() => h.read(id, "rows/r2/cells/c2")).toBe("Moved up");
  await expect(cell(page, 0, 1)).toBeFocused();

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Moved left");
  await editor(page).press("Shift+Tab");
  await expect.poll(() => h.read(id, "rows/r2/cells/c2")).toBe("Moved left");
  await expect(cell(page, 1, 0)).toBeFocused();

  await cell(page, 0, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Moved to header");
  await editor(page).press("Shift+Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c2")).toBe("Moved to header");
  await expect(header(page, 1)).toBeFocused();

  await header(page, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Region");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "columns/c2/name")).toBe("Region");
  await expect(cell(page, 0, 1)).toBeFocused();

  await header(page, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Park name");
  await editor(page).press("Shift+Enter");
  await expect.poll(() => h.read(id, "columns/c1/name")).toBe("Park name");
  await expect(header(page, 0)).toBeFocused();

  const rowCount = Object.keys((await h.read<TableData>(id))!.rows).length;
  await cell(page, 5, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Last row");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r6/cells/c2")).toBe("Last row");
  expect(Object.keys((await h.read<TableData>(id))!.rows)).toHaveLength(rowCount);
  await expect(cell(page, 5, 1)).toBeFocused();

  const columnCount = Object.keys((await h.read<TableData>(id))!.columns).length;
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("First column");
  await editor(page).press("Shift+Tab");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("First column");
  expect(Object.keys((await h.read<TableData>(id))!.columns)).toHaveLength(columnCount);
  await expect(cell(page, 0, 0)).not.toBeFocused();

  await cell(page, 0, 0).click();
  await page.keyboard.type("Committed");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Committed");
  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Committed");
  await expect(page.getByRole("button", { name: /undo/i })).toHaveCount(0);

  await cell(page, 0, 1).click();
  await page.keyboard.press("Alt+o");
  await expect(editor(page)).toHaveValue("o");
  await editor(page).press("Escape");
  await page.keyboard.press("Control+Alt+q");
  await expect(editor(page)).toHaveValue("q");
  await editor(page).press("Escape");
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Process", code: "Process", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229,
  });
  await expect(editor(page)).toBeFocused();
  await session.detach();
});

// proofs/ui/templates/table.md#^table-ac-selection
test("a press in blank page space clears selection and page menu state", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await page.keyboard.type("Blank area commit");
  const firstBlank = await blankAreaBelowGrid(page);
  await page.mouse.click(firstBlank.x, firstBlank.y);
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Blank area commit");
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();

  await cell(page, 0, 0).click();
  await rowButton(page, 0).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  const blank = await blankAreaBelowGrid(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveCount(0);
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await h.set(id, "After menu close", "rows/r2/cells/c1");
  await expect(cell(page, 1, 0)).toHaveText("After menu close");
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveCount(0);

  await cell(page, 0, 0).click();
  await rowButton(page, 0).click({ button: "right" });
  await expect(page.locator("tv-menu[open]")).toHaveCount(1);
  await page.locator(".table-reference-corner").click({ position: { x: 2, y: 2 } });
  await expect(page.locator("tv-menu[open]")).toHaveCount(0);
  await h.set(id, "After canonical close", "rows/r2/cells/c1");
  await expect(cell(page, 1, 0)).toHaveText("After canonical close");
  await expect(page.locator("tv-menu[open]")).toHaveCount(0);
});

// proofs/ui/templates/table.md#^table-ac-structure
test("right-button presses on body and header cells keep the editor focused", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Right-button draft");
  await cell(page, 1, 1).click({ button: "right" });
  await expect(editor(page)).toBeFocused();
  await header(page, 1).click({ button: "right" });
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Right-button draft");
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Acadia");
});

// proofs/ui/templates/table.md#^table-ac-editing
test("moving focus to another artifact frame commits and keeps selection", async ({ page }) => {
  const id = await h.createStored(fixture());
  const otherID = await h.createStored(fixture());
  const firstTab = page.locator(`.tab-strip > .tab[data-artifact-id="${id}"]`);
  const otherTab = page.locator(`.tab-strip > .tab[data-artifact-id="${otherID}"]`);
  await h.openApp(page);
  await firstTab.click();
  await expect(page.locator(`.stage .page[data-page-key="${id}"]`)).toHaveAttribute("selected", "");
  const firstFrame = await h.frame(page, id);
  const otherFrame = await h.frame(page, otherID);
  await cell(firstFrame, 1, 0).click();
  await page.keyboard.press("Enter");
  await editor(firstFrame).fill("Committed on frame leave");
  await otherTab.click();
  await expect(page.locator(`.stage .page[data-page-key="${otherID}"]`)).toHaveAttribute("selected", "");
  await expect.poll(() => h.read(id, "rows/r2/cells/c1")).toBe("Committed on frame leave");
  await expect(cell(firstFrame, 1, 0)).toHaveAttribute("data-selection", "cell");
  const firstConnection = h.proxy.messages.find(({ message }) => message.type === "write"
    && (message.write as { path?: string }).path === "rows/r2/cells/c1")!.connection;

  await firstTab.click();
  await cell(firstFrame, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(firstFrame).fill("Offline draft");
  h.proxy.refuse(true);
  h.proxy.severConnection(firstConnection);
  await expect(status(firstFrame)).toHaveText("Reconnecting…");
  await otherTab.click();
  await cell(otherFrame, 0, 0).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
  const otherArtifactKeptFocusWhileDisconnected = await cell(otherFrame, 0, 0)
    .evaluate(element => element === element.ownerDocument.activeElement);
  await expect(editor(firstFrame)).toHaveValue("Offline draft");
  const disconnectedTableEditorTookFocus = await editor(firstFrame)
    .evaluate(element => element === element.ownerDocument.activeElement);

  h.proxy.refuse(false);
  await expect(firstFrame.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await firstTab.click();
  await cell(firstFrame, 1, 1).click();
  await expect(cell(firstFrame, 1, 1)).toBeFocused();
  const toolbox = page.getByRole("button", { name: "Toolbox", exact: true });
  await toolbox.focus();
  await expect(toolbox).toBeFocused();
  await h.set(id, "Agent update after frame leave", "rows/r3/cells/c3");
  await expect(cell(firstFrame, 2, 2)).toHaveText("Agent update after frame leave");
  const televisionShellKeptFocusAfterAgentWrite = await toolbox.evaluate(element => element === document.activeElement);
  const tableSelectionTookFocusAfterAgentWrite = await cell(firstFrame, 1, 1)
    .evaluate(element => element === element.ownerDocument.activeElement);

  expect({
    otherArtifactKeptFocusWhileDisconnected,
    disconnectedTableEditorTookFocus,
    televisionShellKeptFocusAfterAgentWrite,
    tableSelectionTookFocusAfterAgentWrite,
  }).toEqual({
    otherArtifactKeptFocusWhileDisconnected: true,
    disconnectedTableEditorTookFocus: false,
    televisionShellKeptFocusAfterAgentWrite: true,
    tableSelectionTookFocusAfterAgentWrite: false,
  });
});

// proofs/ui/templates/table.md#^table-ac-editing
test("an editor survives redraw and a pending Return accepts the next edit", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await h.set(id, "Grid redraw", "rows/r2/cells/c2");
  await expect(cell(page, 0, 0)).toBeFocused();

  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Local draft");
  await editor(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 3));
  await h.set(id, "Unrelated redraw", "rows/r2/cells/c2");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Local draft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(3);
  await editor(page).press("Escape");

  h.proxy.holdWrites();
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("First save");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(cell(page, 1, 0)).toBeFocused();
  await page.keyboard.type("N");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("N");
  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("First save");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("N");
});

// proofs/ui/templates/table.md#^table-ac-editing
test("a click acts on its target after the previous edit applies locally", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await page.keyboard.type("First save");

  h.proxy.holdWrites();
  await cell(page, 1, 1).click();
  await page.keyboard.type("N");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("N");

  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("First save");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("N");
});

// proofs/ui/templates/table.md#^table-ac-new
// proofs/ui/templates/table.md#^table-ac-editing
test("a held first commit in a blank Table keeps drawn-cell entry continuous", async ({ page }) => {
  const id = await open(page, { columns: {}, rows: {} });
  h.proxy.holdWrites();
  await cell(page, 2, 1).click();
  await page.keyboard.type("Alice");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(cell(page, 3, 1)).toBeFocused();
  await page.keyboard.type("Bob");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Bob");

  h.proxy.releaseWrites();
  await expect.poll(async () => {
    const table = await h.read<TableData>(id);
    const rows = Object.values(table!.rows).sort((left, right) => left.order - right.order);
    const column = Object.entries(table!.columns).sort((left, right) => left[1].order - right[1].order)[1]?.[0];
    return rows[2]?.cells[column!];
  }).toBe("Alice");
  await editor(page).press("Enter");
  await expect.poll(async () => {
    const table = await h.read<TableData>(id);
    const rows = Object.values(table!.rows).sort((left, right) => left.order - right.order);
    const column = Object.entries(table!.columns).sort((left, right) => left[1].order - right[1].order)[1]?.[0];
    return rows[3]?.cells[column!];
  }).toBe("Bob");
});

// proofs/ui/templates/table.md#^table-ac-editing
test("a click during renumbering acts when the transaction applies locally", async ({ page }) => {
  const id = await open(page, {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: 0, cells: {} } },
  });
  await cell(page, 0, 1).click();
  await page.keyboard.type("Renumbered");

  h.proxy.holdWrites();
  await cell(page, 0, 0).click();
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await page.keyboard.type("N");
  await expect(cell(page, 0, 0).locator(".table-input")).toBeFocused();
  await expect(editor(page)).toHaveValue("N");

  h.proxy.releaseWrites();
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.rows.r1!.cells)).toContain("Renumbered");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("N");
});

// proofs/ui/templates/table.md#^table-ac-selection
// proofs/ui/templates/table.md#^table-ac-structure
// proofs/arch/templates/table.md#^templates-table-t-write-scope
test("row and column selections clear, insert, add, delete and toggle through canonical menus", async ({ page }) => {
  const value = fixture();
  value.extra = "root field";
  value.columns.c4!.extra = "column field";
  value.rows.r6!.extra = "row field";
  const id = await open(page, value);
  await cell(page, 0, 3).click();
  await page.keyboard.press("Delete");
  await expect.poll(() => h.read(id, "rows/r1/cells/c4")).toBeUndefined();
  await expect(cell(page, 0, 3)).toHaveAttribute("data-selection", "cell");

  await cell(page, 1, 1).click();
  await rowButton(page, 1).click();
  await rowButton(page, 3).click({ modifiers: ["Shift"] });
  await expect(rowButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 3)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 2)).toHaveAttribute("data-emphasis", "selected");
  await expect(cell(page, 2, 0)).toHaveAttribute("data-selection", "range");
  await expect(rowButton(page, 1)).toHaveAttribute("tabindex", "0");
  await expect(rowButton(page, 2)).toHaveAttribute("tabindex", "-1");
  await expect(rowButton(page, 3)).toHaveAttribute("tabindex", "-1");
  const beforeRowClear = writes().length;
  await page.keyboard.press("Backspace");
  await expect.poll(() => h.read(id, "rows/r2/cells")).toEqual({});
  await expect.poll(() => h.read(id, "rows/r4/cells")).toEqual({});
  const rowClear = writes().slice(beforeRowClear).find(write => write.kind === "update");
  expect(updateKeys(rowClear!)).toEqual([
    "rows/r2/cells/c1", "rows/r2/cells/c2", "rows/r2/cells/c3", "rows/r2/cells/c4",
    "rows/r3/cells/c1", "rows/r3/cells/c2", "rows/r3/cells/c3", "rows/r3/cells/c4",
    "rows/r4/cells/c1", "rows/r4/cells/c2", "rows/r4/cells/c3", "rows/r4/cells/c4",
  ]);

  await rowButton(page, 1).click({ button: "right" });
  const rowMenu = page.getByRole("menu", { name: "Row actions" });
  await expect(rowMenu).toHaveAttribute("open", "");
  await expect(rowMenu.getByText("Delete rows", { exact: true })).toBeVisible();
  const rowsBeforeInsert = Object.keys((await h.read<TableData>(id))!.rows);
  const beforeRowInsert = writes().length;
  await rowMenu.getByText("Insert row below", { exact: true }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(7);
  const insertedRowKey = Object.keys((await h.read<TableData>(id))!.rows).find(key => !rowsBeforeInsert.includes(key));
  expect(insertedRowKey).toBeDefined();
  expect(writes().slice(beforeRowInsert)).toContainEqual(expect.objectContaining({ kind: "set", path: `rows/${insertedRowKey}` }));
  await expect(rowButton(page, 4)).toHaveAttribute("aria-pressed", "true");

  const rowsBeforeAdd = Object.keys((await h.read<TableData>(id))!.rows);
  const beforeRowAdd = writes().length;
  await page.getByRole("button", { name: "Add row at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(8);
  const addedRowKey = Object.keys((await h.read<TableData>(id))!.rows).find(key => !rowsBeforeAdd.includes(key));
  expect(addedRowKey).toBeDefined();
  expect(writes().slice(beforeRowAdd)).toContainEqual(expect.objectContaining({ kind: "set", path: `rows/${addedRowKey}` }));
  await expect(cell(page, 7, 0)).toBeFocused();

  await columnButton(page, "A").click();
  const beforeColumnClear = writes().length;
  await page.keyboard.press("Delete");
  await expect.poll(() => h.read(id, "columns/c1/name")).toBe("Park");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBeUndefined();
  await expect(columnButton(page, "A")).toHaveAttribute("aria-pressed", "true");
  const columnClear = writes().slice(beforeColumnClear).find(write => write.kind === "update");
  expect(updateKeys(columnClear!)).toEqual([
    "rows/r1/cells/c1", "rows/r5/cells/c1", "rows/r6/cells/c1",
  ]);

  await columnButton(page, "A").click({ button: "right" });
  const columnsBeforeInsert = Object.keys((await h.read<TableData>(id))!.columns);
  const beforeColumnInsert = writes().length;
  await page.getByRole("menu", { name: "Column actions" }).getByText("Insert column right", { exact: true }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(5);
  await expect(page.locator('.table-reference-item[aria-pressed="true"]')).toHaveText("B");
  const insertedColumnKey = Object.keys((await h.read<TableData>(id))!.columns)
    .find(key => !["c1", "c2", "c3", "c4"].includes(key));
  expect(insertedColumnKey).toBeDefined();
  expect(columnsBeforeInsert).not.toContain(insertedColumnKey);
  expect(writes().slice(beforeColumnInsert)).toContainEqual(expect.objectContaining({ kind: "set", path: `columns/${insertedColumnKey}` }));
  expect(["Park", "State", "Open", "Rating"]).not.toContain(insertedColumnKey);

  const columnsBeforeAdd = Object.keys((await h.read<TableData>(id))!.columns);
  const beforeColumnAdd = writes().length;
  await page.getByRole("button", { name: "Add column at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(6);
  const addedColumnKey = Object.keys((await h.read<TableData>(id))!.columns).find(key => !columnsBeforeAdd.includes(key));
  expect(addedColumnKey).toBeDefined();
  expect(writes().slice(beforeColumnAdd)).toContainEqual(expect.objectContaining({ kind: "set", path: `columns/${addedColumnKey}` }));
  await expect(cell(page, 0, 5)).toBeFocused();

  await columnButton(page, "A").click({ button: "right" });
  const columnMenu = page.getByRole("menu", { name: "Column actions" });
  await columnMenu.getByText("Hide header row", { exact: true }).click();
  await expect.poll(() => h.read(id, "showHeader")).toBe(false);
  await expect(page.getByRole("columnheader")).toHaveCount(0);

  await columnButton(page, "B").click({ button: "right" });
  await page.getByRole("menu", { name: "Column actions" }).getByText("Delete column", { exact: true }).click();
  await expect.poll(() => h.read(id, `columns/${insertedColumnKey}`)).toBeUndefined();
  await page.getByRole("button", { name: "Add column at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(6);
  expect(Object.keys((await h.read<TableData>(id))!.columns)).not.toContain(insertedColumnKey);

  await columnButton(page, "B").click({ button: "right" });
  await page.getByRole("menu", { name: "Column actions" }).getByText("Delete column", { exact: true }).click();
  await expect.poll(() => h.read(id, "columns/c2")).toBeUndefined();
  await expect(columnButton(page, "B")).toHaveAttribute("aria-pressed", "true");

  await rowButton(page, 0).click({ button: "right" });
  await page.getByRole("menu", { name: "Row actions" }).getByText("Delete row", { exact: true }).click();
  await expect.poll(() => h.read(id, "rows/r1")).toBeUndefined();
  await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");

  expect(await h.read(id, "extra")).toBe("root field");
  expect(await h.read(id, "columns/c4/extra")).toBe("column field");
  expect(await h.read(id, "rows/r6/extra")).toBe("row field");

  expect(writes().some(write => write.kind === "update" && write.path === "")).toBe(true);
  expect(writes().some(write => write.kind === "set" && write.path === "showHeader")).toBe(true);
  expect(writes().some(write => write.kind === "remove" && write.path === "columns/c2")).toBe(true);
  expect(writes().some(write => write.kind === "remove" && write.path === "rows/r1")).toBe(true);

  await h.set(id, { columns: {}, rows: {} });
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "4");
  await cell(page, 0, 0).click();
  const beforeDrawnAdd = writes().length;
  await page.getByRole("button", { name: "Add row at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(5);
  const drawnAddWrites = writes().slice(beforeDrawnAdd);
  expect(drawnAddWrites).toHaveLength(1);
  expect(drawnAddWrites[0]).toMatchObject({ kind: "update", path: "" });
  expect(updateKeys(drawnAddWrites[0]!)).toHaveLength(5);
  expect(updateKeys(drawnAddWrites[0]!).every(path => path.startsWith("rows/"))).toBe(true);
});

// proofs/ui/templates/table.md#^table-ac-structure
test("menus preserve ranges, expose applicable actions and stay out of an active editor", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await rowButton(page, 1).click();
  await rowButton(page, 3).click({ modifiers: ["Shift"] });
  await rowButton(page, 1).click({ button: "right" });
  let menu = page.getByRole("menu", { name: "Row actions" });
  await expect(menu.locator("tv-menu-item")).toHaveText([
    "Insert row above", "Insert row below", "Delete rows", "Hide header row",
  ]);
  await expect(menu.getByText("Delete rows", { exact: true }).locator(".." )).toHaveAttribute("intent", "danger");
  await expect(rowButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 3)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await header(page, 2).click();
  await page.keyboard.press("Shift+F10");
  let keyboardMenu = page.getByRole("menu", { name: "Column actions" });
  await expect(keyboardMenu).toBeVisible();
  await expect(keyboardMenu.locator("tv-menu-item").first()).toBeFocused();
  await page.keyboard.press("Escape");

  await cell(page, 2, 1).click();
  await page.keyboard.press("Shift+F10");
  keyboardMenu = page.getByRole("menu", { name: "Row actions" });
  await expect(keyboardMenu).toBeVisible();
  await expect(rowButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await cell(page, 2, 1).click();
  await rowButton(page, 2).click();
  await page.keyboard.press("ContextMenu");
  keyboardMenu = page.getByRole("menu", { name: "Row actions" });
  await expect(keyboardMenu).toBeVisible();
  await expect(keyboardMenu.locator("tv-menu-item").first()).toBeFocused();
  await page.keyboard.press("Escape");

  await h.set(id, {
    columns: { c1: { order: 1, name: "Only" } },
    rows: { r1: { order: 1, cells: { c1: "One" } } },
  });
  await expect(cell(page, 2, 0)).toBeVisible();
  await cell(page, 0, 0).click();
  await rowButton(page, 2).click({ button: "right" });
  menu = page.getByRole("menu", { name: "Row actions" });
  await expect(menu.getByText(/^Delete/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await rowButton(page, 0).click();
  await rowButton(page, 2).click({ modifiers: ["Shift"] });
  await rowButton(page, 1).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" }).getByText("Delete row", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Draft");
  await editor(page).click({ button: "right" });
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ContextMenu");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(editor(page)).toHaveValue("Draft");
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("One");

  await rowButton(page, 0).click({ button: "right" });
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Draft");
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
});

// proofs/ui/templates/table.md#^table-ac-structure
test("an open menu isolates destructive keys and closes before keyboard movement", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 1).click();
  await columnButton(page, "B").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Column actions" });
  await expect(menu).toBeVisible();
  const before = await h.read(id, "rows/r1/cells/c2");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(menu).toBeVisible();
  expect(await h.read(id, "rows/r1/cells/c2")).toBe(before);
  await page.keyboard.press("ArrowRight");
  await expect(menu).toHaveCount(0);
  await expect(columnButton(page, "C")).toHaveAttribute("aria-pressed", "true");
});

// proofs/ui/templates/table.md#^table-ac-editing
test("a grid key returns focus to an editor stranded by another button press", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Uncommitted draft");
  await page.getByRole("button", { name: "Add row at end" }).click({ button: "right" });
  await page.keyboard.type("Z");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Uncommitted draft");
  await page.getByRole("button", { name: "Add row at end" }).click({ button: "right" });
  await page.keyboard.press("Backspace");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Uncommitted draft");
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Acadia");
});

// proofs/arch/templates/table.md#^templates-table-t-write-scope
// proofs/arch/templates/table.md#^templates-table-t-transaction
test("late descendant writes stay ignored and renumbering retries before deferred writes", async ({ page }) => {
  const id = await open(page);
  h.proxy.holdWrites();
  await cell(page, 0, 0).click();
  await page.keyboard.type("Late");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.remove(id, "rows/r1");
  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "rows/r1")).toEqual({ cells: { c1: "Late" } });
  await expect(page.locator('[data-row-key="r1"]')).toHaveCount(0);
  await expect(grid(page)).toBeVisible();
  await expect(page.locator('[data-row-key="r2"]')).toHaveCount(4);
  await expect(cell(page, 0, 0)).toHaveText("Arches");

  const renumbered = {
    columns: { c1: { order: 0, name: "A" } },
    rows: {
      a: { order: 0, cells: {}, retained: "first" },
      b: { order: Number.MAX_VALUE, cells: {}, retained: "last" },
      ignored: { cells: {}, retained: "ignored" },
    },
  } as unknown as TableData;
  await h.set(id, renumbered);
  await expect(cell(page, 1, 0)).toBeVisible();
  await cell(page, 1, 0).click();
  await rowButton(page, 1).click({ button: "right" });
  h.proxy.holdWrites();
  await page.getByRole("menu", { name: "Row actions" }).getByText("Insert row below", { exact: true }).click();
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, { order: 7, cells: {}, agent: true }, "rows/agent");
  h.proxy.releaseWrites();
  await expect.poll(async () => {
    const rows = (await h.read<TableData>(id))!.rows;
    return Object.keys(rows).find(key => !["a", "agent", "b", "ignored"].includes(key));
  }).toBeTruthy();
  const retriedRows = (await h.read<TableData>(id))!.rows;
  const insertedKey = Object.keys(retriedRows).find(key => !["a", "agent", "b", "ignored"].includes(key));
  expect(insertedKey).toBeDefined();
  expect(retriedRows).toMatchObject({
    a: { order: 0, retained: "first" },
    agent: { order: 1, agent: true },
    b: { order: 2, retained: "last" },
    [insertedKey!]: { order: 3 },
  });
  expect(retriedRows.ignored).toEqual({ cells: {}, retained: "ignored" });
  await expect(rowButton(page, 3)).toHaveAttribute("aria-pressed", "true");
  expect(writes().filter(write => write.kind === "compare-and-set" && write.path === "rows").length).toBeGreaterThanOrEqual(2);

  const append: TableData = {
    columns: { c1: { order: 0 } },
    rows: { r1: { order: Number.MAX_VALUE, cells: {} } },
  };
  const transactionsBeforeAppend = writes().filter(write => write.kind === "compare-and-set" && write.path === "rows").length;
  await h.set(id, append);
  await expect(cell(page, 0, 0)).toBeVisible();
  await cell(page, 0, 0).click();
  await page.getByRole("button", { name: "Add row at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(5);
  await expect(cell(page, 4, 0)).toBeFocused();
  expect(writes().filter(write => write.kind === "compare-and-set" && write.path === "rows").length)
    .toBeGreaterThan(transactionsBeforeAppend);

  const drawn: TableData = {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: 0, cells: {} } },
  };
  await h.set(id, drawn);
  await expect(cell(page, 0, 1)).toBeVisible();
  const beforeDeferred = writes().length;
  h.proxy.holdWrites();
  await cell(page, 0, 1).click();
  await page.keyboard.type("Deferred");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await page.waitForTimeout(100);
  expect(h.proxy.heldWriteCount).toBe(1);
  expect(writes().slice(beforeDeferred)).toHaveLength(0);
  expect(await h.read(id, "rows/r1/cells")).toEqual({});
  h.proxy.releaseWrites();
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.rows.r1!.cells)).toContain("Deferred");
  const finalWrites = writes();
  const transactionIndex = finalWrites.findLastIndex(write => write.kind === "compare-and-set" && write.path === "columns");
  const cellWriteIndex = finalWrites.findLastIndex(write => write.kind === "set" && String(write.path).startsWith("rows/r1/cells/"));
  expect(transactionIndex).toBeGreaterThanOrEqual(0);
  expect(cellWriteIndex).toBeGreaterThan(transactionIndex);

  await h.set(id, drawn);
  await expect(cell(page, 0, 1)).toBeVisible();
  const beforeUnreadableAxis = writes().length;
  h.proxy.holdWrites();
  await cell(page, 0, 1).click();
  await page.keyboard.type("Must not repair");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, "not an axis", "rows");
  await expect(page.getByRole("alert")).toBeVisible();
  h.proxy.releaseWrites();
  await expect.poll(() => h.proxy.heldWriteCount).toBe(0);
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.columns)
    .map(column => column.order).sort((left, right) => left - right)).toEqual([0, 1]);
  await h.set(id, drawn);
  await expect(grid(page)).toBeVisible();
  const guardedWrites = writes().slice(beforeUnreadableAxis);
  expect(guardedWrites).toHaveLength(1);
  expect(guardedWrites[0]).toMatchObject({ kind: "compare-and-set", path: "columns" });

  await h.set(id, drawn);
  await expect(cell(page, 0, 1)).toBeVisible();
  const beforeAbort = writes().length;
  h.proxy.holdWrites();
  await cell(page, 0, 1).click();
  await page.keyboard.type("Aborted");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, "not an axis", "columns");
  h.proxy.releaseWrites();
  await expect.poll(() => h.proxy.heldWriteCount).toBe(0);
  await page.waitForTimeout(100);
  const abortedWrites = writes().slice(beforeAbort);
  expect(abortedWrites).toHaveLength(1);
  expect(abortedWrites[0]).toMatchObject({ kind: "compare-and-set", path: "columns" });
  expect(await h.read(id, "rows/r1/cells")).toEqual({});
  await expect(status(page)).toHaveText("Couldn't save that change.");
});

// proofs/ui/templates/table.md#^table-ac-live
test("agent commands and a second viewer update live while stored-key edits stay attached", async ({ page, context }) => {
  const id = await open(page);
  const other = await context.newPage();
  await h.open(other, id);

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Local draft");
  await editor(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5));
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "columns/c1/name", '"Place"']);
  await expect(header(page, 0)).toHaveText("Place");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Local draft");

  await h.set(id, -1, "rows/r2/order");
  await expect(page.locator('[data-row-key="r2"][data-column-key="c2"] .table-input')).toBeFocused();
  await expect(editor(page)).toHaveValue("Local draft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);

  await h.set(id, "Agent same field", "rows/r2/cells/c2");
  await expect(editor(page)).toHaveValue("Local draft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r2/cells/c2")).toBe("Local draft");

  await page.locator('[data-row-key="r2"][data-column-key="c2"]').click();
  await page.keyboard.press("Enter");
  const beforeUnchangedCommit = writes().length;
  await h.set(id, "Latest agent value", "rows/r2/cells/c2");
  await expect(editor(page)).toHaveValue("Local draft");
  await editor(page).press("Enter");
  await expect(page.locator('[data-row-key="r2"][data-column-key="c2"]')).toHaveText("Latest agent value");
  expect(writes()).toHaveLength(beforeUnchangedCommit);

  await page.locator('[data-row-key="r2"][data-column-key="c2"]').click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Cancelled local draft");
  const beforeCancelledDraft = writes().length;
  await h.set(id, "Agent value after cancel", "rows/r2/cells/c2");
  await expect(editor(page)).toHaveValue("Cancelled local draft");
  await editor(page).press("Escape");
  await expect(page.locator('[data-row-key="r2"][data-column-key="c2"]')).toHaveText("Agent value after cancel");
  expect(writes()).toHaveLength(beforeCancelledDraft);

  await cell(other, 1, 0).click();
  await other.keyboard.type("Other viewer");
  await editor(other).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Other viewer");
  await expect(cell(page, 1, 0)).toHaveText("Other viewer");

  await page.locator('[data-row-key="r2"][data-column-key="c2"]').click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Removed draft");
  const beforeRemoval = writes().length;
  h.product.runCLI(["resource", "json", "remove", "--artifact", id, "rows/r2"]);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('[data-row-key="r2"]')).toHaveCount(0);
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await expect(grid(page)).toBeFocused();
  expect(writes()).toHaveLength(beforeRemoval);

  await header(page, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Header draft");
  const beforeHeaderHidden = writes().length;
  await h.set(id, false, "showHeader");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("columnheader")).toHaveCount(0);
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await expect(grid(page)).toBeFocused();
  expect(writes()).toHaveLength(beforeHeaderHidden);

  await h.set(id, { columns: { c1: { order: 1 } }, rows: { r1: { order: 1, cells: {} } } });
  await cell(page, 2, 2).click();
  await page.keyboard.type("Drawn draft");
  const beforeIdentityChange = writes().length;
  await h.set(id, { order: 2, cells: {} }, "rows/agent-row");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await expect(grid(page)).toBeFocused();
  expect(writes()).toHaveLength(beforeIdentityChange);

  await cell(page, 0, 0).click();
  await page.keyboard.type("Person");
  await h.set(id, "Agent", "rows/agent-row/cells/c1");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Person");
  expect(await h.read(id, "rows/agent-row/cells/c1")).toBe("Agent");
  await other.close();
});

// proofs/ui/templates/table.md#^table-ac-live
// proofs/ui/templates/table.md#^table-ac-selection
test("an agent write preserves an empty selection and focused grid", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).press("Escape");
  await page.keyboard.press("Escape");
  await expect(grid(page)).toBeFocused();
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();

  await h.set(id, "Agent update", "rows/r2/cells/c2");
  await expect(grid(page)).toBeFocused();
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 0, 0)).toBeFocused();
});

// proofs/ui/templates/table.md#^table-ac-live
test("live selection follows stored keys and closes with its menu when the key is removed", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await rowButton(page, 0).click();
  await rowButton(page, 2).click({ modifiers: ["Shift"] });
  await rowButton(page, 2).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveAttribute("trigger", "table-rows-reference-3");
  await h.set(id, -1, "rows/r3/order");
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveAttribute("trigger", "table-rows-reference-1");
  await page.keyboard.press("Escape");

  await h.set(id, fixture());
  await cell(page, 1, 1).click();
  await h.set(id, -1, "rows/r2/order");
  await expect(page.locator('[data-row-key="r2"][data-column-key="c2"]')).toHaveAttribute("data-selection", "cell");

  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Insert row above" })).toBeFocused();
  await h.set(id, "Destination", "columns/c1/name");
  await expect(page.getByRole("menuitem", { name: "Insert row above" })).toBeFocused();
  await h.remove(id, "rows/r2");
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveCount(0);
  await expect(page.locator('.table-frame[data-reference-visible="hidden"]')).toBeVisible();
  await expect(grid(page)).toBeFocused();
});

// proofs/ui/templates/table.md#^table-ac-access
test("real share access changes preserve a navigable read-only table and close write UI", async ({ page }) => {
  const id = await h.createStored(fixture());
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect(grid(page)).toBeVisible();
  await cell(page, 1, 1).click();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, 1, 2)).toBeFocused();
  await page.keyboard.type("Ignored");
  await page.keyboard.press("Delete");
  await rowButton(page, 1).click({ button: "right" });
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add row at end" })).toHaveCount(0);
  expect(await h.read(id, "rows/r2/cells/c3")).toBe(true);
  await h.set(id, "Agent update", "rows/r2/cells/c3");
  await expect(cell(page, 1, 2)).toHaveText("Agent update");

  await h.set(id, { columns: {}, rows: {} });
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "4");
  await expect(grid(page)).toHaveAttribute("aria-colcount", "4");
  const beforeEmptyReadOnlyActions = writes().length;
  await cell(page, 1, 1).click();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, 1, 2)).toBeFocused();
  await page.keyboard.type("Ignored empty edit");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: "Add row at end" })).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeEmptyReadOnlyActions);
  expect(await h.read(id)).toEqual({ columns: {}, rows: {} });
  await h.set(id, fixture());
  await expect(cell(page, 1, 2)).toHaveText("true");

  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await cell(page, 1, 2).click();
  await page.keyboard.type("Shared edit");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r2/cells/c3")).toBe("Shared edit");

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Discarded draft");
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(editor(page)).toHaveCount(0);
  await expect(cell(page, 1, 1)).toBeFocused();
  expect(await h.read(id, "rows/r2/cells/c2")).toBe("Utah");

  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await cell(page, 1, 1).click();
  await page.keyboard.type("Fresh after restore");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r2/cells/c2")).toBe("Fresh after restore");

  await cell(page, 0, 0).click();
  await rowButton(page, 0).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(page.getByRole("menu")).toHaveCount(0);

  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Revoked draft");
  await h.client.resources.unshare({ artifactID: id });
  await expect(editor(page)).toHaveCount(0);
  await expect(grid(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add row at end" })).toHaveCount(0);

  const unreadID = await h.createStored(fixture());
  const unreadShare = await h.client.resources.share({ artifactID: unreadID, access: "read" });
  h.proxy.hold("to-browser");
  await h.open(page, unreadID, unreadShare.shareID);
  await expect(page.locator(".table-loading")).toBeVisible();
  await h.proxy.waitFor(() => h.proxy.openWebSockets > 0);
  h.proxy.refuse(true);
  h.proxy.sever();
  await h.client.resources.unshare({ artifactID: unreadID });
  h.proxy.release("to-browser");
  h.proxy.refuse(false);
  await expect(page.getByRole("alert")).toContainText("This table can't be shown");
});

// proofs/ui/templates/table.md#^table-ac-loading
test("first load keeps one status region through disconnection and recovery", async ({ page }) => {
  const id = await h.createStored(fixture());
  h.proxy.hold("to-browser");
  await h.open(page, id);
  await expect(page.locator(".table-loading")).toBeVisible();
  await page.evaluate(() => Object.assign(window, { tableStatusRegion: document.querySelector(".table-status") }));
  await h.proxy.waitFor(() => h.proxy.openWebSockets > 0);
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(page.locator(".table-loading")).toBeVisible();
  expect(await page.evaluate(() => document.querySelector(".table-status") === (window as unknown as { tableStatusRegion: Element }).tableStatusRegion)).toBe(true);
  h.proxy.release("to-browser");
  h.proxy.refuse(false);
  await expect(grid(page)).toBeVisible();
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await expect(status(page)).toHaveText("");
});

// proofs/ui/templates/table.md#^table-ac-disconnection
test("disconnection keeps an open editor, blocks commits and rolls back an unacknowledged save", async ({ page }) => {
  const id = await open(page);
  await page.evaluate(() => Object.assign(window, { tableStatusRegion: document.querySelector(".table-status") }));

  await cell(page, 0, 0).click();
  await rowButton(page, 0).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(status(page)).toHaveText("Reconnecting…");
  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();

  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Offline draft");
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(editor(page)).toHaveValue("Offline draft");
  await expect(page.getByRole("button", { name: "Add row at end" })).toHaveCount(0);
  await editor(page).press("Enter");
  await editor(page).press("Tab");
  await cell(page, 1, 1).click();
  await expect(editor(page)).toHaveValue("Offline draft");
  await expect(editor(page)).toBeFocused();
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Acadia");
  await editor(page).press("Escape");
  await expect(cell(page, 0, 0)).toHaveAttribute("data-selection", "cell");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveCount(0);

  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector(".table-status") === (window as unknown as { tableStatusRegion: Element }).tableStatusRegion)).toBe(true);

  await cell(page, 0, 0).click();
  await page.keyboard.type("Confirmed online");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Confirmed online");

  h.proxy.holdWrites();
  await cell(page, 0, 0).click();
  await page.keyboard.type("Unconfirmed");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(cell(page, 0, 0)).toHaveText("Unconfirmed");
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(cell(page, 0, 0)).toHaveText("Confirmed online");
  await expect(editor(page)).toHaveCount(0);
  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();
  await expect(status(page)).toHaveText("");
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Confirmed online");
});

// proofs/ui/templates/table.md#^table-ac-save-failure
test("a refused save and aborted renumbering use the established failure status", async ({ page }) => {
  const id = await h.createStored(fixture());
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID);
  await expect(grid(page)).toBeVisible();
  await page.evaluate(() => Object.assign(window, { tableStatusRegion: document.querySelector(".table-status") }));
  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdWrites();
  h.proxy.holdServerMessages(connection, message => message.type === "access");
  await cell(page, 3, 1).click();
  await page.keyboard.type("Refused");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.client.resources.share({ artifactID: id, access: "read" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) > 0);
  h.proxy.releaseWrites();
  await expect(status(page)).toHaveText("Couldn't save that change.");
  await expect(cell(page, 3, 1)).toHaveText("Washington");
  expect(await page.evaluate(() => document.querySelector(".table-status") === (window as unknown as { tableStatusRegion: Element }).tableStatusRegion)).toBe(true);
  h.proxy.releaseServerMessages(connection);
  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();
  await expect(status(page)).toHaveText("", { timeout: 10_000 });
  await cell(page, 3, 1).click();
  await page.keyboard.type("Allowed");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r4/cells/c2")).toBe("Allowed");

  await h.set(id, {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: 0, cells: {} } },
  });
  await expect(status(page)).toHaveText("", { timeout: 10_000 });
  await expect(cell(page, 0, 1)).toBeVisible();
  h.proxy.holdWrites();
  h.proxy.holdServerMessages(connection, message => message.type === "applied");
  await cell(page, 0, 1).click();
  await page.keyboard.type("Held after renumber");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  h.proxy.releaseWrites();
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.columns)
    .map(column => column.order).sort((left, right) => left - right)).toEqual([0, 1]);
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "false");
  h.proxy.releaseServerMessages(connection);
  await expect(status(page)).toHaveText("Couldn't save that change.");
  expect(await h.read(id, "rows/r1/cells")).toEqual({});
  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await expect(status(page)).toHaveText("", { timeout: 10_000 });

  await h.set(id, {
    columns: { c1: { order: 0 } },
    rows: { a: { order: 0, cells: {} }, b: { order: Number.MAX_VALUE, cells: {} } },
  });
  await cell(page, 1, 0).click();
  await rowButton(page, 1).click({ button: "right" });
  h.proxy.holdWrites();
  await page.getByRole("menu", { name: "Row actions" }).getByText("Insert row below", { exact: true }).click();
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.remove(id, "rows/b");
  h.proxy.releaseWrites();
  await expect.poll(() => h.proxy.heldWriteCount).toBe(0);
  await expect(status(page)).toHaveText("Couldn't save that change.");
  expect(Object.keys((await h.read<TableData>(id))!.rows)).toEqual(["a"]);

  await expect(status(page)).toHaveText("", { timeout: 10_000 });
  await h.set(id, {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: Number.MAX_VALUE, cells: {} } },
  });
  await cell(page, 1, 1).click();
  await page.keyboard.type("Two axes");
  await editor(page).press("Enter");
  await expect(status(page)).toHaveText("Couldn't save that change.");
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
});

// proofs/arch/templates/table.md#^templates-table-t-invalid-guard
// proofs/ui/templates/table.md#^table-ac-unreadable
test("unreadable data closes active UI, guards actions and recovers without replay", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Unsent draft");
  const beforeUnreadableDraft = writes().length;
  await h.set(id, "not rows", "rows");
  await expect(page.getByRole("alert")).toContainText("This table can't be shown");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("grid")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add row at end" })).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeUnreadableDraft);
  await h.set(id, fixture());
  await expect(grid(page)).toBeVisible();
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Acadia");

  h.proxy.holdWrites();
  await cell(page, 0, 0).click();
  await page.keyboard.type("Already sent");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, [], "columns");
  await expect(page.getByRole("alert")).toBeVisible();
  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Already sent");
  await h.set(id, fixture().columns, "columns");
  await expect(grid(page)).toBeVisible();
  await expect(cell(page, 0, 0)).toHaveText("Already sent");

  await cell(page, 0, 0).click();
  await rowButton(page, 0).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  await h.set(id, [], "columns");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);

  const beforeMissingRoot = writes().length;
  await h.remove(id);
  await expect(grid(page)).toBeVisible();
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "4");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeMissingRoot);
  await h.set(id, { rows: { r1: { order: 1, cells: {} } } });
  await expect(grid(page)).toBeVisible();
  await expect(page.locator('[data-row-key="r1"]')).toHaveCount(4);
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeMissingRoot);
});

// proofs/ui/templates/table.md#^table-ac-unreadable
test("unreadable and unavailable states survive disconnection and recover", async ({ page }) => {
  const id = await open(page);
  await h.set(id, { columns: { broken: { name: "Ignored" } }, rows: { r1: { order: 1, cells: { missing: "Ignored" } } } });
  await expect(grid(page)).toBeVisible();
  await expect(page.locator('[data-row-key="r1"]')).toHaveCount(4);

  await h.set(id, null);
  await expect(page.getByRole("alert")).toContainText("Television can't read the saved table data");
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(page.getByRole("alert")).toBeVisible();
  h.proxy.refuse(false);
  await h.set(id, fixture());
  await expect(grid(page)).toBeVisible();

  const file = h.contentFile(id);
  const original = readFileSync(file);
  await h.restart(() => writeFileSync(file, "{not json"));
  await expect(page.getByRole("alert")).toContainText("This table can't be shown", { timeout: 20_000 });
  expect(readFileSync(file, "utf8")).toBe("{not json");
  await h.restart(() => writeFileSync(file, original));
  await expect(grid(page)).toBeVisible({ timeout: 20_000 });
  await cell(page, 0, 0).click();
  await page.keyboard.type("Recovered");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Recovered");
});
