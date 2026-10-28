/** Real browser acceptance for the copied editable Table and its JSON store. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 760, height: 770 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

/** A stored column; saved width and unrelated fields are read through the index signature. */
type Column = { order: number; [key: string]: JSONValue };
type Row = { order: number; cells: Record<string, string | number | boolean>; [key: string]: JSONValue };
/** The stored table; `headerRow` is optional and read through the index signature. */
type TableData = {
  columns: Record<string, Column>;
  rows: Record<string, Row>;
  [key: string]: JSONValue;
};

const fixture = (): TableData => ({
  headerRow: true,
  columns: {
    c1: { order: 1 }, c2: { order: 2 }, c3: { order: 3 }, c4: { order: 4 },
  },
  rows: {
    r1: { order: 1, cells: { c1: "Park", c2: "State", c3: "Open", c4: "Rating" } },
    r2: { order: 2, cells: { c1: "Acadia", c2: "Maine", c3: true, c4: 4.9 } },
    r3: { order: 3, cells: { c1: "Arches", c2: "Utah", c3: true, c4: 4.8 } },
    r4: { order: 4, cells: { c1: "Everglades", c2: "Florida", c3: false, c4: 4.6 } },
    r5: { order: 5, cells: { c1: "Olympic", c2: "Washington", c3: true, c4: 4.8 } },
    r6: { order: 6, cells: { c1: "Yosemite", c2: "California", c3: true, c4: 4.9 } },
    r7: { order: 7, cells: { c1: "Zion", c2: "Utah", c3: true } },
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
const rowButton = (page: Page | Frame, row: number): Locator => page.getByRole("button", { name: `Select row ${row + 1}`, exact: true });
const columnButton = (page: Page | Frame, column: string): Locator => page.getByRole("button", { name: `Select column ${column}`, exact: true });
const editor = (page: Page | Frame): Locator => page.locator(".table-input");
const status = (page: Page | Frame): Locator => page.locator(".table-status");

type ScreenshotPoint = { x: number; y: number };
type TouchResizeProbe = { pointerType: string; trusted: boolean; captured: boolean };

async function screenshotPixels(page: Page, points: Record<string, ScreenshotPoint>): Promise<Record<string, number[]>> {
  const screenshot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ imageData, samplePoints }) => {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("Could not decode browser screenshot")), { once: true });
    });
    image.src = `data:image/png;base64,${imageData}`;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create screenshot canvas");
    context.drawImage(image, 0, 0);
    return Object.fromEntries(Object.entries(samplePoints).map(([name, point]) => {
      const x = Math.floor(point.x * window.devicePixelRatio);
      const y = Math.floor(point.y * window.devicePixelRatio);
      return [name, [...context.getImageData(x, y, 1, 1).data]];
    }));
  }, { imageData: screenshot, samplePoints: points });
}

async function navigationChord(page: Page, arrow: "ArrowLeft" | "ArrowRight"): Promise<void> {
  const platform = await page.evaluate(() => navigator.platform);
  if (platform.length === 0) throw new Error("Browser exposed no platform identity");
  await page.keyboard.press(`${/^(Mac|iPhone|iPad|iPod)/i.test(platform) ? "Alt" : "Control"}+${arrow}`);
}

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

async function startResize(page: Page, axis: "column" | "row", index: number): Promise<{ x: number; y: number }> {
  const handle = page.locator(`.table-${axis}-resize-handle`).nth(index);
  await expect(handle).toBeVisible();
  await expect.poll(async () => {
    try {
      await handle.scrollIntoViewIfNeeded();
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("not attached")) throw error;
      return false;
    }
  }).toBe(true);
  let box = await handle.boundingBox();
  await expect.poll(async () => {
    box = await handle.boundingBox();
    return box !== null;
  }).toBe(true);
  if (!box) throw new Error(`Table ${axis} resize handle ${index} has no bounds`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}

async function dragResize(page: Page, axis: "column" | "row", index: number, delta: number): Promise<void> {
  const point = await startResize(page, axis, index);
  await page.mouse.move(
    point.x + (axis === "column" ? delta : 0),
    point.y + (axis === "row" ? delta : 0),
    { steps: 2 },
  );
  await page.mouse.up();
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
  await expect(frame.getByRole("columnheader")).toHaveCount(0);
  await expect(grid(frame)).not.toBeFocused();
  await expect(frame.locator(":focus")).toHaveCount(0);
  await expect(frame.getByRole("button", { name: /^Select row / })).toHaveCount(4);
  await expect(frame.getByRole("button", { name: /^Select column / })).toHaveCount(4);
  await expect(frame.getByRole("button", { name: "Add row at end" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "Add column at end" })).toBeVisible();
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
    ["constructor", { order: 1 }],
    ["toString", { order: 2 }],
    ["__proto__", { order: 3 }],
  ]);
  const cells = Object.fromEntries([["__proto__", "own prototype cell"]]);
  await open(page, { headerRow: true, columns, rows: { r1: { order: 1, cells } } });

  await expect(page.getByRole("columnheader")).toHaveCount(4);
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "4");
  await expect(grid(page)).toHaveAttribute("aria-colcount", "4");
  await expect(page.locator('[data-column-key="constructor"]')).toHaveCount(4);
  await expect(page.locator('[data-column-key="__proto__"]')).toHaveCount(4);
  await expect(page.locator("[data-column-key]")).toHaveCount(12);
  await expect(page.locator("[data-row-key]")).toHaveCount(4);
  await expect(cell(page, 0, 0)).toHaveText("");
  await expect(cell(page, 0, 1)).toHaveText("");
  await expect(cell(page, 0, 2)).toHaveText("own prototype cell");
});

// proofs/arch/templates/table.md#^templates-table-t-write-scope
// proofs/ui/templates/table.md#^table-ac-rows
// proofs/ui/templates/table.md#^table-ac-editing
// proofs/ui/templates/table.md#^table-ac-selection
// proofs/ui/templates/table.md#^table-ac-keyboard
test("stored values and header row render in order", async ({ page }) => {
  const value = fixture();
  for (let index = 5; index <= 8; index += 1) {
    value.columns[`c${index}`] = { order: index };
  }
  Object.assign(value.rows.r1!.cells, { c5: "Notes", c7: "Column 7", c8: "Column 8" });
  value.rows.r2!.cells.c5 = "First\nsecond";
  value.rows.r2!.cells.c8 = "A cell value long enough to overflow its fixed-width column";
  value.columns.c1!.width = 230;
  value.rows.r1!.height = 52;
  value.rows.r7!.height = 28;
  for (let index = 8; index <= 41; index += 1) {
    value.rows[`r${index}`] = { order: index, cells: { c1: `Park ${index}`, c2: "Somewhere", c8: "Wide" } };
  }
  const id = await open(page, value);

  await expect(page.getByRole("columnheader")).toHaveCount(8);
  expect(await page.getByRole("columnheader").allTextContents()).toEqual([
    "Park", "State", "Open", "Rating", "Notes", "", "Column 7", "Column 8",
  ]);
  await expect(cell(page, 0, 5)).toHaveAccessibleName("");
  await expect(cell(page, 1, 2)).toHaveText("true");
  await expect(cell(page, 3, 2)).toHaveText("false");
  await expect(cell(page, 1, 3)).toHaveText("4.9");
  await expect(cell(page, 1, 4)).toHaveText("First second");
  await expect(cell(page, 6, 3)).toHaveText("");
  await expect(cell(page, 1, 7)).toHaveCSS("text-overflow", "ellipsis");
  await expect(cell(page, 1, 7)).toHaveCSS("white-space", "nowrap");
  await expect.poll(() => cell(page, 1, 7).locator("span").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "41");
  await expect(grid(page)).toHaveAttribute("aria-colcount", "8");
  await expect(cell(page, 0, 0)).toHaveAccessibleName("Park");
  await expect(cell(page, 0, 0)).toHaveAttribute("role", "columnheader");
  await expect(cell(page, 1, 0)).toHaveAttribute("role", "gridcell");
  const [headerCellBox, headerTextBox] = await Promise.all([
    cell(page, 0, 0).boundingBox(),
    cell(page, 0, 0).locator("span").boundingBox(),
  ]);
  expect(headerTextBox!.y - headerCellBox!.y).toBe(9);
  await expect(columnButton(page, "A")).toHaveAttribute("aria-description", /230 pixels wide/);
  await expect(rowButton(page, 0)).toHaveAttribute("aria-description", /52 pixels tall/);
  await expect(page.getByRole("group", { name: "Column references" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Row references" })).toBeVisible();
  await expect(columnButton(page, "A")).toHaveAttribute("aria-expanded", "false");
  await expect(rowButton(page, 0)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".table-column-resize-handle")).toHaveCount(8);
  await expect(page.locator(".table-row-resize-handle")).toHaveCount(41);
  expect(await page.locator(".table-column-resize-handle, .table-row-resize-handle")
    .evaluateAll(elements => elements.every(element => (element as HTMLElement).tabIndex === -1))).toBe(true);
  await expect(page.locator('[data-action="add-row"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-action="add-column"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-row-select][data-row-index="0"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-column-select][data-column-index="0"]')).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
  const scroll = page.locator(".table-scroll");
  await scroll.evaluate(element => element.scrollTo(0, 0));
  const beforeTabEntry = await scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  await page.keyboard.press("Tab");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(beforeTabEntry);
  await expect(cell(page, 0, 0)).toBeFocused();
  await expect(cell(page, 0, 0)).toHaveAttribute("aria-selected", "true");
  await expect(cell(page, 0, 0).locator("xpath=..")).toHaveAttribute("aria-rowindex", "1");
  await expect(cell(page, 0, 0)).toHaveAttribute("aria-colindex", "1");
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true);
  await scroll.evaluate(element => element.scrollTo(0, 0));
  const [headerBefore, rowOneBefore] = await Promise.all([
    page.getByRole("columnheader").first().boundingBox(),
    rowButton(page, 0).locator("..").boundingBox(),
  ]);
  const gridBefore = await grid(page).boundingBox();
  await scroll.evaluate(element => element.scrollTo(200, 300));
  await expect.poll(() => scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
    .toEqual({ left: 200, top: 300 });
  const [headerAfter, rowOneAfter] = await Promise.all([
    page.getByRole("columnheader").first().boundingBox(),
    rowButton(page, 0).locator("..").boundingBox(),
  ]);
  const stripAfter = await page.locator(".table-column-strip").boundingBox();
  expect(headerBefore!.y).toBeCloseTo(gridBefore!.y, 0);
  expect(stripAfter!.y).toBeCloseTo((await scroll.boundingBox())!.y, 0);
  expect(headerAfter!.y).toBeCloseTo(stripAfter!.y + stripAfter!.height + 8, 0);
  expect(rowOneBefore!.y).toBeCloseTo(headerBefore!.y, 0);
  expect(rowOneAfter!.y).toBeCloseTo(headerAfter!.y, 0);
  expect(rowOneAfter!.height).toBeCloseTo(headerAfter!.height, 0);
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

  await cell(page, 2, 1).dblclick();
  await expect(editor(page)).toHaveValue("Utah");
  await expect(editor(page)).toHaveAccessibleName("Row 3, column B");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Utah".length);
  await editor(page).press("ArrowLeft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Utah".length - 1);
  await editor(page).press("Escape");

  await cell(page, 4, 1).click();
  await expect(cell(page, 4, 1)).toHaveAttribute("data-selection", "cell");
  await page.keyboard.type("C");
  await expect(editor(page)).toHaveValue("C");
  await editor(page).press("Escape");
  await expect(cell(page, 4, 1)).toHaveText("Washington");
  await expect(cell(page, 4, 1)).toHaveAttribute("data-selection", "cell");

  await page.keyboard.press("F2");
  await expect(editor(page)).toHaveValue("Washington");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Washington".length);
  await editor(page).fill("Washington state");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r5/cells/c2")).toBe("Washington state");
  await expect(cell(page, 5, 1)).toHaveAttribute("data-selection", "cell");
  expect(writes().at(-1)).toMatchObject({ kind: "set", path: "rows/r5/cells/c2" });

  await cell(page, 0, 1).click();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 1, 1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(cell(page, 0, 1)).toBeFocused();
  await cell(page, 0, 1).press("Enter");
  await expect(editor(page)).toHaveAccessibleName("Row 1, column B");
  await editor(page).fill("Region");
  const beforeHeaderEdit = writes().length;
  await editor(page).press("Tab");
  await expect.poll(() => h.read(id, "rows/r1/cells/c2")).toBe("Region");
  expect(writes().slice(beforeHeaderEdit)).toContainEqual(expect.objectContaining({ kind: "set", path: "rows/r1/cells/c2" }));
  await expect(cell(page, 0, 2)).toHaveAttribute("data-selection", "cell");

  const beforeHeaderClear = writes().length;
  await cell(page, 0, 2).press("Delete");
  await expect.poll(() => h.read(id, "rows/r1/cells/c3")).toBeUndefined();
  expect(writes().slice(beforeHeaderClear)).toContainEqual(expect.objectContaining({ kind: "remove", path: "rows/r1/cells/c3" }));
  await expect(cell(page, 0, 2)).toHaveAttribute("data-selection", "cell");

  await cell(page, 1, 4).click();
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
  await expect.poll(() => h.read(id, "rows/r2/cells/c5")).toBe("Pasted\nline");
  await expect(cell(page, 1, 4)).toHaveText("Pasted line");

  await cell(page, 0, 0).click();
  await page.keyboard.type("Coast");
  await cell(page, 0, 1).click();
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Coast");
  await expect(cell(page, 0, 1)).toHaveAttribute("data-selection", "cell");

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
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();

  await cell(page, 0, 0).click();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, 0, 1)).toBeFocused();
  await page.keyboard.press("Shift+Space");
  await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  await rowButton(page, 2).click({ modifiers: ["Shift"] });
  await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  for (const key of ["Enter", "F2", "x", "Space"]) {
    await page.keyboard.press(key);
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
    await expect(rowButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  }
  for (const key of ["Control+Enter", "Alt+F2", "Control+Space"]) {
    await page.keyboard.press(key);
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
    await expect(rowButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  }
  expect(await rowButton(page, 2).evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "x", ctrlKey: true, bubbles: true, cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await cell(page, 1, 1).click();
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
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 0, 0)).toBeFocused();
});

// proofs/ui/templates/table.md#^table-ac-keyboard
test("Tab enters from the artifact and Television shell without leaving A1 hidden", async ({ page }) => {
  const value = fixture();
  for (let index = 5; index <= 8; index += 1) value.columns[`c${index}`] = { order: index };
  for (let index = 8; index <= 24; index += 1) {
    value.rows[`r${index}`] = { order: index, cells: { c1: `Park ${index}`, c8: `Last ${index}` } };
  }
  const id = await open(page, value);
  const directScroll = page.locator(".table-scroll");
  await directScroll.evaluate(element => element.scrollTo(360, 180));
  await expect.poll(() => directScroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
    .toEqual({ left: 360, top: 180 });
  await page.keyboard.press("Tab");
  await expect(cell(page, 0, 0)).toBeFocused();
  const [directCellBox, directRowStripBox, directColumnStripBox] = await Promise.all([
    cell(page, 0, 0).boundingBox(),
    page.locator(".table-row-strip").boundingBox(),
    page.locator(".table-column-strip").boundingBox(),
  ]);
  expect(directCellBox!.x).toBeGreaterThanOrEqual(directRowStripBox!.x + directRowStripBox!.width + 8);
  expect(directCellBox!.y).toBeGreaterThanOrEqual(directColumnStripBox!.y + directColumnStripBox!.height + 8);

  await h.openApp(page);
  await page.locator(`.tab-strip > .tab[data-artifact-id="${id}"]`).click();
  const frame = await h.frame(page, id);
  const shellScroll = frame.locator(".table-scroll");
  await shellScroll.evaluate(element => element.scrollTo(0, 0));
  await expect.poll(() => shellScroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
    .toEqual({ left: 0, top: 0 });
  const toolbox = page.getByRole("button", { name: "Toolbox", exact: true });
  await toolbox.focus();
  let enteredArtifact = false;
  for (let presses = 0; presses < 20 && !enteredArtifact; presses += 1) {
    await page.keyboard.press("Tab");
    enteredArtifact = await cell(frame, 0, 0).evaluate(element => element === element.ownerDocument.activeElement);
  }
  expect(enteredArtifact).toBe(true);
  expect(await shellScroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
    .toEqual({ left: 0, top: 0 });
  const [shellCellBox, shellRowStripBox, shellColumnStripBox] = await Promise.all([
    cell(frame, 0, 0).boundingBox(),
    frame.locator(".table-row-strip").boundingBox(),
    frame.locator(".table-column-strip").boundingBox(),
  ]);
  expect(shellCellBox!.x).toBeGreaterThanOrEqual(shellRowStripBox!.x + shellRowStripBox!.width + 8);
  expect(shellCellBox!.y).toBeGreaterThanOrEqual(shellColumnStripBox!.y + shellColumnStripBox!.height + 8);
});

// proofs/ui/templates/table.md#^table-ac-rows
test("a selected frozen header keeps its solid surface and top border", async ({ page }) => {
  const value = fixture();
  for (let index = 8; index <= 24; index += 1) {
    value.rows[`r${index}`] = { order: index, cells: { c1: `Park ${index}`, c2: `State ${index}` } };
  }
  await open(page, value);
  const headerSurface = await cell(page, 0, 1).evaluate(element => getComputedStyle(element).backgroundColor);
  const scroll = page.locator(".table-scroll");
  await scroll.evaluate(element => element.scrollTo(0, 180));
  await columnButton(page, "B").click();
  const selectedHeaderStyle = await cell(page, 0, 1).evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopWidth: style.borderTopWidth,
    };
  });
  expect(selectedHeaderStyle.backgroundColor).toBe(headerSurface);
  expect(selectedHeaderStyle.backgroundImage).not.toBe("none");
  expect(selectedHeaderStyle.borderTopWidth).toBe("1px");
});

// proofs/ui/templates/table.md#^table-ac-rows
test("strip outlines remain rounded above their solid gap backing", async ({ page }) => {
  await open(page);
  const columnStrip = (await page.locator(".table-column-strip").boundingBox())!;
  const rowStrip = (await page.locator(".table-row-strip").boundingBox())!;
  const firstColumn = (await page.locator(".table-column-reference-item").first().boundingBox())!;
  const firstRow = (await page.locator(".table-row-reference-item").first().boundingBox())!;
  const pixels = await screenshotPixels(page, {
    surface: { x: 1, y: 1 },
    columnDivider: { x: firstColumn.x + firstColumn.width, y: columnStrip.y + columnStrip.height / 2 },
    columnLeft: { x: columnStrip.x, y: columnStrip.y + columnStrip.height / 2 },
    columnRight: { x: columnStrip.x + columnStrip.width - 1, y: columnStrip.y + columnStrip.height / 2 },
    rowDivider: { x: rowStrip.x + rowStrip.width / 2, y: firstRow.y + firstRow.height - 1 },
    rowLeft: { x: rowStrip.x, y: firstRow.y + firstRow.height / 2 },
    rowRight: { x: rowStrip.x + rowStrip.width - 1, y: firstRow.y + firstRow.height / 2 },
    rowTop: { x: rowStrip.x + rowStrip.width / 2, y: rowStrip.y },
    rowBottom: { x: rowStrip.x + rowStrip.width / 2, y: rowStrip.y + rowStrip.height - 1 },
    rowTopRound: { x: rowStrip.x + 2, y: rowStrip.y },
    rowBottomRound: { x: rowStrip.x + 2, y: rowStrip.y + rowStrip.height - 1 },
  });
  expect(pixels.columnLeft).toEqual(pixels.columnDivider);
  expect(pixels.columnRight).toEqual(pixels.columnDivider);
  expect(pixels.rowLeft).toEqual(pixels.rowDivider);
  expect(pixels.rowRight).toEqual(pixels.rowDivider);
  expect(pixels.rowTop).toEqual(pixels.rowDivider);
  expect(pixels.rowBottom).toEqual(pixels.rowDivider);
  expect(pixels.rowTopRound).toEqual(pixels.surface);
  expect(pixels.rowBottomRound).toEqual(pixels.surface);

  await rowButton(page, 0).click({ button: "right" });
  const selectedFirstRow = (await rowButton(page, 0).locator("..").boundingBox())!;
  const selectedEndPixels = await screenshotPixels(page, {
    surface: { x: 1, y: 1 },
    topLeft: { x: selectedFirstRow.x + 1, y: selectedFirstRow.y + 1 },
    topRight: { x: selectedFirstRow.x + selectedFirstRow.width - 2, y: selectedFirstRow.y + 1 },
  });
  for (const pixel of [selectedEndPixels.topLeft, selectedEndPixels.topRight]) {
    const greatestDifference = Math.max(...pixel.slice(0, 3).map((channel, index) => (
      Math.abs(channel - selectedEndPixels.surface[index])
    )));
    expect(greatestDifference).toBeLessThan(8);
  }
});

// proofs/ui/templates/table.md#^table-ac-rows
// proofs/ui/templates/table.md#^table-ac-keyboard
test("the full-edge table scroll keeps strips, header row and selection visible", async ({ page }) => {
  const widths = [230, 130, 96, 112, 180, 144, 160];
  const columns = Object.fromEntries(widths.map((width, index) => [`c${index + 1}`, { order: index + 1, width }]));
  const rows = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`r${index + 1}`, {
    order: index + 1,
    ...(index === 0 || index === 9 ? { height: 28 } : index === 1 ? { height: 52 } : {}),
    cells: Object.fromEntries(widths.map((_, columnIndex) => [
      `c${columnIndex + 1}`,
      index === 0 ? `Heading ${columnIndex + 1}` : `R${index + 1} C${columnIndex + 1}`,
    ])),
  }]));
  const id = await open(page, { headerRow: true, columns, rows });
  const frame = page.locator(".table-frame");
  const tablePage = page.locator(".table-page");
  const scroll = page.locator(".table-scroll");
  const sheet = page.locator(".table-sheet");
  const [pageBox, frameBox, scrollBox, sheetBox] = await Promise.all([
    tablePage.boundingBox(), frame.boundingBox(), scroll.boundingBox(), sheet.boundingBox(),
  ]);
  expect(scrollBox).toEqual(frameBox);
  expect(scrollBox).toEqual(pageBox);
  expect(sheetBox!.x - scrollBox!.x).toBe(0);
  expect(sheetBox!.y - scrollBox!.y).toBe(0);
  await expect(scroll).toHaveCSS("overflow-x", "auto");
  await expect(scroll).toHaveCSS("overflow-y", "auto");
  await expect.poll(() => scroll.evaluate(element => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight,
  }))).toEqual({ horizontal: true, vertical: true });
  await expect(sheet).toHaveCSS("padding-left", "16px");

  const topStrip = page.locator(".table-column-strip");
  const sideStrip = page.locator(".table-row-strip");
  await expect(topStrip).toHaveCSS("height", "26px");
  await expect(sideStrip).toHaveCSS("width", "33px");
  await expect(sheet).toHaveCSS("--table-row-reference-digits", "2");
  const gridBorders = await grid(page).evaluate(element => {
    const style = getComputedStyle(element);
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
  });
  expect(gridBorders).toEqual(["0px", "1px", "0px", "1px"]);
  await expect(cell(page, 23, 6)).toHaveCSS("border-bottom-width", "1px");
  await expect(cell(page, 0, 0)).toHaveCSS("vertical-align", "top");
  expect((await cell(page, 0, 0).boundingBox())!.height).toBe(28);
  expect((await rowButton(page, 0).locator("..").boundingBox())!.height).toBe(28);
  expect((await cell(page, 0, 0).locator("span").boundingBox())!.y
    - (await cell(page, 0, 0).boundingBox())!.y).toBe(9);
  expect((await cell(page, 1, 0).boundingBox())!.height).toBe(52);
  expect((await rowButton(page, 1).locator("..").boundingBox())!.height).toBe(52);
  expect((await cell(page, 9, 0).boundingBox())!.height).toBe(28);
  expect((await rowButton(page, 9).locator("..").boundingBox())!.height).toBe(28);
  const [shortCellBox, shortTextBox] = await Promise.all([
    cell(page, 9, 0).boundingBox(), cell(page, 9, 0).locator("span").boundingBox(),
  ]);
  expect(shortTextBox!.y).toBeGreaterThanOrEqual(shortCellBox!.y);
  expect(shortTextBox!.y + shortTextBox!.height).toBeLessThanOrEqual(shortCellBox!.y + shortCellBox!.height);
  for (const rowIndex of [0, 1, 9]) {
    const [cellBox, referenceBox] = await Promise.all([
      cell(page, rowIndex, 0).boundingBox(), rowButton(page, rowIndex).locator("..").boundingBox(),
    ]);
    expect(referenceBox!.y).toBeCloseTo(cellBox!.y, 0);
    expect(referenceBox!.height).toBeCloseTo(cellBox!.height, 0);
    await expect(rowButton(page, rowIndex).locator("..")).toHaveCSS("border-bottom-width", "1px");
    await expect(rowButton(page, rowIndex).locator("..")).toHaveCSS("border-top-width", rowIndex === 0 ? "1px" : "0px");
  }

  const before = {
    top: await topStrip.boundingBox(), side: await sideStrip.boundingBox(),
    header: await cell(page, 0, 0).boundingBox(), rowOne: await rowButton(page, 0).locator("..").boundingBox(),
  };
  await scroll.evaluate(element => element.scrollTo(360, 180));
  await expect.poll(() => scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
    .toEqual({ left: 360, top: 180 });
  const after = {
    top: await topStrip.boundingBox(), side: await sideStrip.boundingBox(),
    header: await cell(page, 0, 0).boundingBox(), rowOne: await rowButton(page, 0).locator("..").boundingBox(),
  };
  expect(after.top!.y).toBeCloseTo(scrollBox!.y, 0);
  expect(after.side!.x).toBeCloseTo(scrollBox!.x, 0);
  expect(after.header!.y).toBeCloseTo(after.top!.y + after.top!.height + 8, 0);
  expect(after.rowOne!.y).toBeCloseTo(after.header!.y, 0);
  const scrolledOutlinePixels = await screenshotPixels(page, {
    surface: { x: scrollBox!.x + scrollBox!.width - 2, y: scrollBox!.y + scrollBox!.height - 2 },
    top: { x: scrollBox!.x + scrollBox!.width / 2, y: after.top!.y },
    side: { x: after.side!.x, y: scrollBox!.y + scrollBox!.height / 2 },
  });
  expect(scrolledOutlinePixels.top).not.toEqual(scrolledOutlinePixels.surface);
  expect(scrolledOutlinePixels.side).not.toEqual(scrolledOutlinePixels.surface);
  const coveringBands = await page.evaluate(() => {
    const band = (selector: string, pseudo: "::before" | "::after", axis: "x" | "y") => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element, pseudo);
      const origin = axis === "x" ? box.left + element.clientLeft : box.top + element.clientTop;
      const offset = Number.parseFloat(axis === "x" ? style.left : style.top);
      const thickness = Number.parseFloat(axis === "x" ? style.width : style.height);
      return {
        start: origin + offset,
        thickness,
        background: style.backgroundColor,
        surface: getComputedStyle(element).backgroundColor,
      };
    };
    return {
      cornerBelow: band(".table-reference-corner", "::after", "y"),
      cornerRight: band(".table-reference-corner", "::before", "x"),
      stripBelow: band(".table-column-strip", "::after", "y"),
      stripRight: band(".table-row-strip", "::before", "x"),
    };
  });
  for (const band of Object.values(coveringBands)) {
    expect(band.thickness).toBe(8);
    expect(band.background).toBe(band.surface);
  }
  expect(coveringBands.cornerBelow.start).toBeCloseTo(after.top!.y + after.top!.height, 0);
  expect(coveringBands.stripBelow.start).toBeCloseTo(after.top!.y + after.top!.height, 0);
  expect(coveringBands.cornerRight.start).toBeCloseTo(after.side!.x + after.side!.width, 0);
  expect(coveringBands.stripRight.start).toBeCloseTo(after.side!.x + after.side!.width, 0);

  await scroll.evaluate(element => element.scrollTo(360, 180));
  await cell(page, 5, 2).click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  const selectedBox = await page.locator('[data-selection="cell"]').boundingBox();
  const topBox = await topStrip.boundingBox();
  const sideBox = await sideStrip.boundingBox();
  const headerBox = await cell(page, 0, 0).boundingBox();
  expect(selectedBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  expect(selectedBox!.x).toBeGreaterThanOrEqual(sideBox!.x + sideBox!.width + 8);

  await scroll.evaluate(element => element.scrollTo(0, 180));
  await rowButton(page, 5).click();
  await page.keyboard.press("ArrowUp");
  const selectedRowBox = await rowButton(page, 4).boundingBox();
  expect(selectedRowBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  expect(selectedRowBox!.y + selectedRowBox!.height).toBeLessThanOrEqual(scrollBox!.y + scrollBox!.height);

  await scroll.evaluate(element => element.scrollTo(360, 180));
  await columnButton(page, "C").click();
  await page.keyboard.press("ArrowLeft");
  const selectedColumnBox = await columnButton(page, "B").boundingBox();
  expect(selectedColumnBox!.x).toBeGreaterThanOrEqual(sideBox!.x + sideBox!.width + 8);
  expect(selectedColumnBox!.x + selectedColumnBox!.width).toBeLessThanOrEqual(scrollBox!.x + scrollBox!.width);

  await scroll.evaluate(element => element.scrollTo(element.scrollWidth, element.scrollHeight));
  const [sheetEndBox, topStripEndBox, sideStripEndBox] = await Promise.all([
    sheet.boundingBox(), topStrip.boundingBox(), sideStrip.boundingBox(),
  ]);
  expect(sheetEndBox!.x + sheetEndBox!.width - (topStripEndBox!.x + topStripEndBox!.width)).toBeCloseTo(16, 0);
  expect(sheetEndBox!.y + sheetEndBox!.height - (sideStripEndBox!.y + sideStripEndBox!.height)).toBeCloseTo(16, 0);

  await h.set(id, false, "headerRow");
  await expect(grid(page)).toHaveCSS("border-top-width", "0px");
  await expect(cell(page, 0, 0)).toHaveCSS("border-top-width", "1px");
  await scroll.evaluate(element => element.scrollTo(0, 0));
  for (const rowIndex of [0, 1, 9]) {
    const [cellBox, referenceBox] = await Promise.all([
      cell(page, rowIndex, 0).boundingBox(), rowButton(page, rowIndex).locator("..").boundingBox(),
    ]);
    expect(referenceBox!.y).toBeCloseTo(cellBox!.y, 0);
    expect(referenceBox!.height).toBeCloseTo(cellBox!.height, 0);
  }
  expect((await cell(page, 0, 0).locator("span").boundingBox())!.y
    - (await cell(page, 0, 0).boundingBox())!.y).toBe(9);
  const [rowOneAtOrigin, rowOneNumberAtOrigin] = await Promise.all([
    cell(page, 0, 0).boundingBox(), rowButton(page, 0).locator("..").boundingBox(),
  ]);
  await scroll.evaluate(element => element.scrollTo(0, 180));
  const headerOffScrollTop = await scroll.evaluate(element => element.scrollTop);
  await expect.poll(async () => (await cell(page, 0, 0).boundingBox())!.y)
    .toBeCloseTo(rowOneAtOrigin!.y - headerOffScrollTop, 0);
  const rowOneNumberAfterScroll = await rowButton(page, 0).locator("..").boundingBox();
  expect(rowOneNumberAfterScroll!.y).toBeCloseTo(rowOneNumberAtOrigin!.y - headerOffScrollTop, 0);
  expect(rowOneNumberAfterScroll!.y).toBeCloseTo((await cell(page, 0, 0).boundingBox())!.y, 0);
});

// proofs/ui/templates/table.md#^table-ac-editing
test("clicks in all frozen strip gaps preserve the active editor", async ({ page }) => {
  const columns = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`c${index + 1}`, { order: index + 1 }]));
  const rows = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`r${index + 1}`, {
    order: index + 1,
    cells: { c1: index === 0 ? "Heading" : `Row ${index + 1}` },
  }]));
  await open(page, { headerRow: true, columns, rows });
  await cell(page, 0, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Origin gap draft");
  const originWrites = writes().length;
  const [originCorner, originTopStrip, originSideStrip] = await Promise.all([
    page.locator(".table-reference-corner").boundingBox(),
    page.locator(".table-column-strip").boundingBox(),
    page.locator(".table-row-strip").boundingBox(),
  ]);
  const originCornerGap = {
    x: (originCorner!.x + originCorner!.width + originTopStrip!.x) / 2,
    y: (originCorner!.y + originCorner!.height + originSideStrip!.y) / 2,
  };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? null, originCornerGap))
    .toBe("table-reference-corner");
  await page.mouse.click(originCornerGap.x, originCornerGap.y);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Origin gap draft");
  expect(writes()).toHaveLength(originWrites);
  await editor(page).press("Escape");

  await page.locator(".table-scroll").evaluate(element => element.scrollTo(0, 180));
  await cell(page, 6, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Uncommitted draft");
  const beforeGapClicks = writes().length;
  const [corner, topStrip, sideStrip] = await Promise.all([
    page.locator(".table-reference-corner").boundingBox(),
    page.locator(".table-column-strip").boundingBox(),
    page.locator(".table-row-strip").boundingBox(),
  ]);
  const gapPoints = [
    ["below corner", { x: corner!.x + corner!.width / 2, y: corner!.y + corner!.height + 4 }],
    ["right of corner", { x: corner!.x + corner!.width + 4, y: corner!.y + corner!.height / 2 }],
    ["below column strip", { x: topStrip!.x + 40, y: topStrip!.y + topStrip!.height + 4 }],
    ["right of row strip", { x: sideStrip!.x + sideStrip!.width + 4, y: Math.max(sideStrip!.y, 0) + 80 }],
  ] as const;
  expect(await page.evaluate(points => points.map(([, { x, y }]) =>
    document.elementFromPoint(x, y)?.className ?? null), gapPoints)).toEqual([
    "table-reference-corner",
    "table-reference-corner",
    "table-column-strip table-reference-strip",
    "table-row-strip table-reference-strip",
  ]);
  for (const [name, point] of gapPoints) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(editor(page), `${name} pointer down`).toBeFocused();
    await page.mouse.up();
    await expect(editor(page), `${name} click`).toBeFocused();
    await expect(editor(page)).toHaveValue("Uncommitted draft");
    await expect(cell(page, 6, 1)).toHaveAttribute("data-selection", "cell");
    expect(writes()).toHaveLength(beforeGapClicks);
  }
});

// proofs/ui/templates/table.md#^table-ac-rows
test("strip gap pixels stay solid during one-axis scrolling and in read-only tables", async ({ page }) => {
  const columns = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`c${index + 1}`, { order: index + 1 }]));
  const manyRows = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`r${index + 1}`, {
    order: index + 1,
    cells: { c1: index === 0 ? "Heading" : `Row ${index + 1}` },
  }]));
  await open(page, { headerRow: true, columns, rows: manyRows });
  const verticalScroll = page.locator(".table-scroll");
  await verticalScroll.evaluate(element => element.scrollTo(0, 180));
  const verticalTopStrip = (await page.locator(".table-column-strip").boundingBox())!;
  const verticalPixels = await screenshotPixels(page, {
    surface: { x: 1, y: 1 },
    gapStart: { x: verticalTopStrip.x, y: verticalTopStrip.y + verticalTopStrip.height + 4 },
    gapEnd: { x: verticalTopStrip.x + verticalTopStrip.width - 1, y: verticalTopStrip.y + verticalTopStrip.height + 4 },
  });
  expect(verticalPixels.gapStart).toEqual(verticalPixels.surface);
  expect(verticalPixels.gapEnd).toEqual(verticalPixels.surface);

  const manyColumns = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`c${index + 1}`, { order: index + 1 }]));
  const fewRows = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`r${index + 1}`, {
    order: index + 1,
    cells: { c1: index === 0 ? "Heading" : `Row ${index + 1}` },
  }]));
  await open(page, { headerRow: true, columns: manyColumns, rows: fewRows });
  const horizontalScroll = page.locator(".table-scroll");
  await horizontalScroll.evaluate(element => element.scrollTo(180, 0));
  const horizontalSideStrip = (await page.locator(".table-row-strip").boundingBox())!;
  const horizontalPixels = await screenshotPixels(page, {
    surface: { x: 1, y: 1 },
    gapStart: { x: horizontalSideStrip.x + horizontalSideStrip.width + 4, y: horizontalSideStrip.y },
    gapEnd: { x: horizontalSideStrip.x + horizontalSideStrip.width + 4, y: horizontalSideStrip.y + horizontalSideStrip.height - 1 },
  });
  expect(horizontalPixels.gapStart).toEqual(horizontalPixels.surface);
  expect(horizontalPixels.gapEnd).toEqual(horizontalPixels.surface);

  const readOnlyID = await h.createStored({ headerRow: true, columns, rows: manyRows });
  const share = await h.client.resources.share({ artifactID: readOnlyID, access: "read" });
  await h.open(page, readOnlyID, share.shareID);
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "false");
  await expect(columnButton(page, "A")).not.toHaveAttribute("aria-expanded");
  await expect(rowButton(page, 0)).not.toHaveAttribute("aria-expanded");
  const readOnlyScroll = page.locator(".table-scroll");
  await readOnlyScroll.evaluate(element => element.scrollTo(0, 180));
  const readOnlyTopStrip = (await page.locator(".table-column-strip").boundingBox())!;
  const readOnlyGrid = (await grid(page).boundingBox())!;
  expect(readOnlyGrid.width).toBe(readOnlyTopStrip.width);
  const readOnlyPixels = await screenshotPixels(page, {
    surface: { x: 1, y: 1 },
    gapStart: { x: readOnlyTopStrip.x, y: readOnlyTopStrip.y + readOnlyTopStrip.height + 4 },
    gapEnd: { x: readOnlyGrid.x + readOnlyGrid.width - 1, y: readOnlyTopStrip.y + readOnlyTopStrip.height + 4 },
  });
  expect(readOnlyPixels.gapStart).toEqual(readOnlyPixels.surface);
  expect(readOnlyPixels.gapEnd).toEqual(readOnlyPixels.surface);
});

// proofs/ui/templates/table.md#^table-ac-editing
// proofs/ui/templates/table.md#^table-ac-keyboard
test("editing covers reverse movement, edges, cancellation and editor keys", async ({ page }) => {
  const id = await open(page);
  const expectEditorFillsCellWithoutChangingRowHeight = async (rowIndex: number, columnIndex: number) => {
    const editedCell = cell(page, rowIndex, columnIndex);
    const [cellBox, cellPaddingBox, rowBox, referenceBox, editorBox] = await Promise.all([
      editedCell.boundingBox(),
      editedCell.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.x + element.clientLeft,
          y: bounds.y + element.clientTop,
          width: element.clientWidth,
          height: element.clientHeight,
        };
      }),
      editedCell.locator("xpath=..").boundingBox(),
      rowButton(page, rowIndex).locator("..").boundingBox(),
      editor(page).boundingBox(),
    ]);
    expect(cellBox!.height).toBe(referenceBox!.height);
    expect(rowBox!.height).toBe(referenceBox!.height);
    expect(editorBox).toEqual(cellPaddingBox);
  };

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveValue("Maine");
  await expectEditorFillsCellWithoutChangingRowHeight(1, 1);
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe("Maine".length);
  await editor(page).press("Shift+Space");
  await editor(page).press("Control+Shift+Space");
  await expect(editor(page)).toHaveValue("Maine ");
  await expect(editor(page)).toBeFocused();
  await editor(page).press("Escape");
  await expect(cell(page, 1, 1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(grid(page)).toBeFocused();
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();

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

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Moved to header");
  await editor(page).press("Shift+Enter");
  await expect.poll(() => h.read(id, "rows/r2/cells/c2")).toBe("Moved to header");
  await expect(cell(page, 0, 1)).toBeFocused();

  await cell(page, 0, 1).click();
  await page.keyboard.press("Enter");
  await expectEditorFillsCellWithoutChangingRowHeight(0, 1);
  await editor(page).fill("Region");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c2")).toBe("Region");
  await expect(cell(page, 1, 1)).toBeFocused();

  await cell(page, 0, 0).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Park name");
  await editor(page).press("Shift+Enter");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBe("Park name");
  await expect(cell(page, 0, 0)).toBeFocused();

  const rowCount = Object.keys((await h.read<TableData>(id))!.rows).length;
  await cell(page, 6, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Last row");
  await editor(page).press("Enter");
  await expect.poll(() => h.read(id, "rows/r7/cells/c2")).toBe("Last row");
  expect(Object.keys((await h.read<TableData>(id))!.rows)).toHaveLength(rowCount);
  await expect(cell(page, 6, 1)).toBeFocused();

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
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();

  await cell(page, 0, 0).click();
  await rowButton(page, 0).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  const blank = await blankAreaBelowGrid(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveCount(0);
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
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
  await cell(page, 0, 1).click({ button: "right" });
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Right-button draft");
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Park");
});

// proofs/ui/templates/table.md#^table-ac-disconnection
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
  await expect(page.locator(`.stage .page[data-page-key="${id}"]`)).toHaveAttribute("selected", "");
  const toolbox = page.getByRole("button", { name: "Toolbox", exact: true });
  await toolbox.focus();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
  const televisionShellKeptFocusWhileDisconnected = await toolbox.evaluate(element => element === document.activeElement);
  await expect(editor(firstFrame)).toHaveValue("Offline draft");
  const disconnectedTableEditorTookFocus = await editor(firstFrame)
    .evaluate(element => element === element.ownerDocument.activeElement);

  h.proxy.refuse(false);
  await expect(firstFrame.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await firstTab.click();
  await cell(firstFrame, 1, 1).click();
  await expect(cell(firstFrame, 1, 1)).toBeFocused();
  await toolbox.focus();
  await expect(toolbox).toBeFocused();
  await h.set(id, "Agent update after frame leave", "rows/r3/cells/c3");
  await expect(cell(firstFrame, 2, 2)).toHaveText("Agent update after frame leave");
  const televisionShellKeptFocusAfterAgentWrite = await toolbox.evaluate(element => element === document.activeElement);
  const tableSelectionTookFocusAfterAgentWrite = await cell(firstFrame, 1, 1)
    .evaluate(element => element === element.ownerDocument.activeElement);

  expect({
    televisionShellKeptFocusWhileDisconnected,
    disconnectedTableEditorTookFocus,
    televisionShellKeptFocusAfterAgentWrite,
    tableSelectionTookFocusAfterAgentWrite,
  }).toEqual({
    televisionShellKeptFocusWhileDisconnected: true,
    disconnectedTableEditorTookFocus: false,
    televisionShellKeptFocusAfterAgentWrite: true,
    tableSelectionTookFocusAfterAgentWrite: false,
  });
});

// proofs/ui/templates/table.md#^table-ac-keyboard
test("the application navigation chord does not also move the Table selection", async ({ page }) => {
  const id = await h.createStored(fixture());
  const otherID = await h.createStored(fixture());
  await h.openApp(page);
  await page.locator(`.tab-strip > .tab[data-artifact-id="${id}"]`).click();
  const table = await h.frame(page, id);
  await cell(table, 0, 0).click();

  await navigationChord(page, "ArrowRight");

  await expect(page.locator(`.stage .page[data-page-key="${otherID}"]`)).toHaveAttribute("selected", "");
  await expect(cell(table, 0, 0)).toHaveAttribute("data-selection", "cell");
  await expect(cell(table, 0, 1)).not.toHaveAttribute("data-selection", "cell");
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
  await expect(rowButton(page, 1)).toHaveAttribute("aria-expanded", "true");
  await expect(rowMenu.getByText("Delete rows", { exact: true })).toBeVisible();
  const rowsBeforeInsert = Object.keys((await h.read<TableData>(id))!.rows);
  const beforeRowInsert = writes().length;
  await rowMenu.getByText("Insert row below", { exact: true }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(8);
  const insertedRowKey = Object.keys((await h.read<TableData>(id))!.rows).find(key => !rowsBeforeInsert.includes(key));
  expect(insertedRowKey).toBeDefined();
  expect(writes().slice(beforeRowInsert)).toContainEqual(expect.objectContaining({ kind: "set", path: `rows/${insertedRowKey}` }));
  await expect(rowButton(page, 4)).toHaveAttribute("aria-pressed", "true");

  const rowsBeforeAdd = Object.keys((await h.read<TableData>(id))!.rows);
  const beforeRowAdd = writes().length;
  await page.getByRole("button", { name: "Add row at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(9);
  const addedRowKey = Object.keys((await h.read<TableData>(id))!.rows).find(key => !rowsBeforeAdd.includes(key));
  expect(addedRowKey).toBeDefined();
  expect(writes().slice(beforeRowAdd)).toContainEqual(expect.objectContaining({ kind: "set", path: `rows/${addedRowKey}` }));
  await expect(cell(page, 8, 0)).toBeFocused();

  await columnButton(page, "A").click();
  const beforeColumnClear = writes().length;
  await page.keyboard.press("Delete");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBeUndefined();
  await expect(columnButton(page, "A")).toHaveAttribute("aria-pressed", "true");
  const columnClear = writes().slice(beforeColumnClear).find(write => write.kind === "update");
  expect(updateKeys(columnClear!)).toEqual([
    "rows/r1/cells/c1", "rows/r5/cells/c1", "rows/r6/cells/c1", "rows/r7/cells/c1",
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
  await expect(columnMenu.getByText(/header row/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await rowButton(page, 1).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Row actions" }).getByText(/header row/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await rowButton(page, 0).click({ button: "right" });
  const mutedHeaderSurface = await cell(page, 0, 0).evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByRole("menu", { name: "Row actions" }).getByText("Remove header row", { exact: true }).click();
  await expect.poll(() => h.read(id, "headerRow")).toBe(false);
  await expect(page.getByRole("columnheader")).toHaveCount(0);
  expect(await cell(page, 0, 0).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(mutedHeaderSurface);
  await expect(rowButton(page, 0)).toHaveText("1");
  const firstRowCells = await h.read(id, "rows/r1/cells");
  await rowButton(page, 0).click({ button: "right" });
  await page.getByRole("menu", { name: "Row actions" }).getByText("Make header row", { exact: true }).click();
  await expect.poll(() => h.read(id, "headerRow")).toBe(true);
  await expect(cell(page, 0, 0)).toHaveAttribute("role", "columnheader");
  expect(await cell(page, 0, 0).evaluate(element => getComputedStyle(element).backgroundColor)).toBe(mutedHeaderSurface);
  await expect(rowButton(page, 0)).toHaveText("1");
  expect(await h.read(id, "rows/r1/cells")).toEqual(firstRowCells);

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

  const firstRowBeforeInsert = Object.keys((await h.read<TableData>(id))!.rows);
  await rowButton(page, 0).click({ button: "right" });
  await page.getByRole("menu", { name: "Row actions" }).getByText("Insert row above", { exact: true }).click();
  await expect(cell(page, 0, 0)).toHaveAttribute("role", "columnheader");
  await expect(cell(page, 0, 0)).toHaveText("");
  await expect(rowButton(page, 1)).toHaveText("2");
  await expect(page.locator('[data-row-key="r1"][data-column-key="c3"]')).toHaveAttribute("role", "gridcell");
  await expect(page.locator('[data-row-key="r1"][data-column-key="c3"]')).toHaveText("Open");
  const insertedFirstRow = Object.keys((await h.read<TableData>(id))!.rows).find(key => !firstRowBeforeInsert.includes(key));
  expect(insertedFirstRow).toBeDefined();
  await rowButton(page, 0).click({ button: "right" });
  await page.getByRole("menu", { name: "Row actions" }).getByText("Delete row", { exact: true }).click();
  await expect.poll(() => h.read(id, `rows/${insertedFirstRow}`)).toBeUndefined();
  await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(cell(page, 0, 0)).toHaveAttribute("role", "columnheader");

  expect(await h.read(id, "extra")).toBe("root field");
  expect(await h.read(id, "columns/c4/extra")).toBe("column field");
  expect(await h.read(id, "rows/r6/extra")).toBe("row field");

  expect(writes().some(write => write.kind === "update" && write.path === "")).toBe(true);
  expect(writes().some(write => write.kind === "set" && write.path === "headerRow")).toBe(true);
  expect(writes().some(write => write.kind === "remove" && write.path === "columns/c2")).toBe(true);
  expect(writes().some(write => write.kind === "remove" && write.path === `rows/${insertedFirstRow}`)).toBe(true);

  await h.set(id, { columns: {}, rows: {} });
  await expect(page.locator("[data-column-key], [data-row-key]")).toHaveCount(0);
  await rowButton(page, 0).click({ button: "right" });
  await page.getByRole("menu", { name: "Row actions" }).getByText("Make header row", { exact: true }).click();
  await expect.poll(() => h.read(id, "headerRow")).toBe(true);
  expect(await h.read(id, "rows")).toEqual({});
  await expect(page.getByRole("columnheader")).toHaveCount(4);
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
    "Insert row above", "Insert row below", "Delete rows",
  ]);
  await expect(menu.getByText("Delete rows", { exact: true }).locator(".." )).toHaveAttribute("intent", "danger");
  await expect(rowButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 3)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await cell(page, 0, 2).click();
  await page.keyboard.press("Shift+F10");
  let keyboardMenu = page.getByRole("menu", { name: "Row actions" });
  await expect(keyboardMenu).toBeVisible();
  await expect(keyboardMenu.locator("tv-menu-item").first()).toBeFocused();
  await expect(keyboardMenu.getByText("Remove header row", { exact: true })).toBeVisible();
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
    columns: { c1: { order: 1 } },
    rows: { r1: { order: 1, cells: { c1: "One" } } },
  });
  await expect(cell(page, 0, 0)).toHaveText("One");
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
  const beforeMenuKeys = writes().length;
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("+");
  await page.keyboard.press("-");
  await expect(menu).toBeVisible();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeMenuKeys);
  expect(await h.read(id, "rows/r1/cells/c2")).toBe(before);
  expect(await h.read(id, "columns/c2/width")).toBeUndefined();
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
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Park");
});

// proofs/ui/templates/table.md#^table-ac-resizing
// proofs/arch/templates/table.md#^templates-table-t-write-scope
test("pointer and keyboard resizing save scoped clamped sizes", async ({ page }) => {
  const id = await open(page);
  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Committed before resize");
  const columnStart = await startResize(page, "column", 0);
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(() => h.read(id, "rows/r2/cells/c2")).toBe("Committed before resize");
  await page.mouse.move(columnStart.x + 70, columnStart.y, { steps: 2 });
  expect((await cell(page, 1, 0).boundingBox())!.width).toBeCloseTo(230, 0);
  await expect(cell(page, 1, 1)).toHaveAttribute("data-selection", "cell");
  const beforeStoredColumnResize = writes().length;
  await page.mouse.up();
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(230);
  expect(writes().slice(beforeStoredColumnResize)).toEqual([
    expect.objectContaining({ kind: "set", path: "columns/c1/width" }),
  ]);

  const beforeUnchangedRelease = writes().length;
  await startResize(page, "column", 0);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeUnchangedRelease);

  const touchHandle = page.locator(".table-column-resize-handle").nth(1);
  await touchHandle.scrollIntoViewIfNeeded();
  const touchBox = await touchHandle.boundingBox();
  if (!touchBox) throw new Error("Table column resize handle 1 has no bounds");
  const touchPoint = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
  await page.locator(".table-page").evaluate(element => {
    const owner = window as Window & { tableTouchResizeProbe?: TouchResizeProbe | null };
    const main = element as HTMLElement;
    owner.tableTouchResizeProbe = null;
    main.addEventListener("pointerdown", event => {
      owner.tableTouchResizeProbe = {
        pointerType: event.pointerType,
        trusted: event.isTrusted,
        captured: main.hasPointerCapture(event.pointerId),
      };
    }, { once: true });
  });
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const beforeTouchResize = writes().length;
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...touchPoint, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
  });
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { tableTouchResizeProbe?: TouchResizeProbe | null }).tableTouchResizeProbe ?? null,
  )).toEqual({ pointerType: "touch", trusted: true, captured: true });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchPoint.x + 40, y: touchPoint.y, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
  });
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touchSession.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await touchSession.detach();
  await expect.poll(() => h.read(id, "columns/c2/width")).toBe(200);
  expect(writes().slice(beforeTouchResize)).toEqual([
    expect.objectContaining({ kind: "set", path: "columns/c2/width" }),
  ]);

  await dragResize(page, "column", 3, -120);
  await expect.poll(() => h.read(id, "columns/c4/width")).toBe(64);
  const beforeStoredHeaderResize = writes().length;
  await dragResize(page, "row", 0, 14);
  await expect.poll(() => h.read(id, "rows/r1/height")).toBe(52);
  expect(writes().slice(beforeStoredHeaderResize)).toContainEqual(expect.objectContaining({
    kind: "set", path: "rows/r1/height",
  }));
  await dragResize(page, "row", 6, 300);
  await expect.poll(() => h.read(id, "rows/r7/height")).toBe(240);

  await columnButton(page, "A").click();
  const beforeColumnKey = writes().length;
  await page.keyboard.press("+");
  await expect.poll(() => h.read<number>(id, "columns/c1/width")).toBe(238);
  expect(writes()).toHaveLength(beforeColumnKey + 1);
  expect(writes().at(-1)).toMatchObject({ kind: "set", path: "columns/c1/width" });
  await expect(columnButton(page, "A")).toHaveAttribute(
    "aria-description",
    "238 pixels wide. Select this column, then use plus or minus to resize.",
  );
  const announcement = page.getByRole("status").filter({ hasText: "Column A, 238 pixels wide" });
  await expect(announcement).toHaveText("Column A, 238 pixels wide");
  const announcementGeometry = await announcement.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: rect.width, height: rect.height, clip: style.clip, clipPath: style.clipPath };
  });
  expect(announcementGeometry.width).toBeGreaterThan(0);
  expect(announcementGeometry.width).toBeLessThanOrEqual(1);
  expect(announcementGeometry.height).toBeGreaterThan(0);
  expect(announcementGeometry.height).toBeLessThanOrEqual(1);
  expect(announcementGeometry.clip).not.toBe("auto");
  expect(announcementGeometry.clipPath).toBe("inset(50%)");
  const beforeColumnMinus = writes().length;
  await page.keyboard.press("-");
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(230);
  expect(writes().slice(beforeColumnMinus)).toEqual([
    expect.objectContaining({ kind: "set", path: "columns/c1/width" }),
  ]);
  const beforeBrowserZoom = writes().length;
  await page.keyboard.press("Control+-");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeBrowserZoom);
  expect(await h.read(id, "columns/c1/width")).toBe(230);

  await h.set(id, 28, "rows/r1/height");
  await expect(rowButton(page, 0)).toHaveAttribute("aria-description", /28 pixels tall/);
  await rowButton(page, 0).click();
  const beforeMinimumKey = writes().length;
  await page.keyboard.press("-");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeMinimumKey);

  await rowButton(page, 1).click();
  await rowButton(page, 2).click({ modifiers: ["Shift"] });
  const beforeRangeKey = writes().length;
  await page.keyboard.press("+");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeRangeKey);

  await h.set(id, { columns: {}, rows: {} });
  await expect(page.locator("[data-column-key], [data-row-key]")).toHaveCount(0);
  await columnButton(page, "D").click();
  const beforeDrawnColumn = writes().length;
  await dragResize(page, "column", 2, 60);
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(3);
  const drawnColumns = (await h.read<TableData>(id))!.columns;
  const resizedColumn = Object.entries(drawnColumns).find(([, column]) => column.width === 220);
  expect(resizedColumn).toBeDefined();
  await expect(columnButton(page, "D")).toHaveAttribute("aria-pressed", "true");
  const drawnColumnWrites = writes().slice(beforeDrawnColumn);
  expect(drawnColumnWrites).toHaveLength(1);
  expect(updateKeys(drawnColumnWrites[0]!)).toEqual(Object.keys(drawnColumns).map(key => `columns/${key}`).sort());

  await rowButton(page, 2).click();
  const beforeDrawnRow = writes().length;
  await page.keyboard.press("+");
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(3);
  await expect(rowButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  const drawnRows = (await h.read<TableData>(id))!.rows;
  const drawnRowWrites = writes().slice(beforeDrawnRow);
  expect(drawnRowWrites).toHaveLength(1);
  expect(updateKeys(drawnRowWrites[0]!)).toEqual(Object.keys(drawnRows).map(key => `rows/${key}`).sort());
  const storedRowKey = Object.entries(drawnRows)
    .find(([, row]) => row.height !== undefined)?.[0];
  expect(storedRowKey).toBeDefined();
  const firstHeight = await h.read<number>(id, `rows/${storedRowKey}/height`);
  await page.keyboard.press("+");
  await expect.poll(() => h.read<number>(id, `rows/${storedRowKey}/height`)).toBeGreaterThan(firstHeight!);
  await expect(rowButton(page, 2)).toHaveAttribute("aria-pressed", "true");
});

// proofs/ui/templates/table.md#^table-ac-disconnection
// proofs/ui/templates/table.md#^table-ac-resizing
// proofs/ui/templates/table.md#^table-ac-live
test("resizing reconciles concurrent, access and disconnected changes", async ({ page }) => {
  const id = await open(page);
  await cell(page, 1, 1).click();
  const sameField = await startResize(page, "column", 0);
  await page.mouse.move(sameField.x + 40, sameField.y, { steps: 2 });
  await h.set(id, 300, "columns/c1/width");
  await h.set(id, "Agent saw same-field resize", "rows/r2/cells/c2");
  await expect(cell(page, 1, 1)).toHaveText("Agent saw same-field resize");
  expect((await cell(page, 1, 0).boundingBox())!.width).toBeCloseTo(200, 0);
  await page.mouse.up();
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(200);
  await expect(cell(page, 1, 1)).toHaveAttribute("data-selection", "cell");

  const unrelated = await startResize(page, "column", 0);
  await page.mouse.move(unrelated.x + 24, unrelated.y, { steps: 2 });
  await h.set(id, 280, "columns/c2/width");
  await expect.poll(async () => (await cell(page, 1, 1).boundingBox())!.width).toBeCloseTo(280, 0);
  await page.mouse.up();
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(224);
  expect(await h.read(id, "columns/c2/width")).toBe(280);
  await expect.poll(async () => (await cell(page, 1, 0).boundingBox())?.width ?? null).toBe(224);

  const beforeRemovedTarget = writes().length;
  const removed = await startResize(page, "row", 1);
  await page.mouse.move(removed.x, removed.y + 20);
  await h.remove(id, "rows/r2");
  await expect(page.locator('[data-row-key="r2"]')).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeRemovedTarget);

  await h.set(id, {
    columns: { c1: { order: 1 } },
    rows: { r1: { order: 1, cells: { c1: "Drawn identity base" } } },
  });
  await expect(cell(page, 0, 0)).toHaveText("Drawn identity base");
  await expect(page.locator('[data-row-key="r1"]')).toHaveCount(4);
  const beforeDrawnIdentity = writes().length;
  const drawn = await startResize(page, "row", 2);
  await page.mouse.move(drawn.x, drawn.y + 20);
  await h.set(id, { order: 2, cells: { c1: "Agent row" } }, "rows/agent-row");
  await expect(cell(page, 1, 0)).toHaveText("Agent row");
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeDrawnIdentity);

  const beforeDisconnected = writes().length;
  const disconnected = await startResize(page, "column", 0);
  await page.mouse.move(disconnected.x + 30, disconnected.y);
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect.poll(async () => (await cell(page, 0, 0).boundingBox())!.width).toBeCloseTo(160, 0);
  await page.mouse.up();
  expect(writes()).toHaveLength(beforeDisconnected);
  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();
  await dragResize(page, "column", 0, 24);
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(184);
});

// proofs/arch/templates/table.md#^templates-table-t-invalid-guard
// proofs/arch/templates/table.md#^templates-table-t-write-scope
// proofs/arch/templates/table.md#^templates-table-t-transaction
// proofs/ui/templates/table.md#^table-ac-save-failure
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
  await expect(cell(page, 0, 0)).toHaveText("Acadia");

  const renumbered = {
    columns: { c1: { order: 0, retained: "column" } },
    rows: {
      a: { order: 0, cells: { c1: "Renumber first" }, retained: "first" },
      b: { order: Number.MAX_VALUE, cells: { c1: "Renumber last" }, retained: "last" },
      ignored: { cells: {}, retained: "ignored" },
    },
  } as unknown as TableData;
  await h.set(id, renumbered);
  await expect(cell(page, 1, 0)).toHaveText("Renumber last");
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
    rows: { r1: { order: Number.MAX_VALUE, cells: { c1: "Append base" } } },
  };
  const transactionsBeforeAppend = writes().filter(write => write.kind === "compare-and-set" && write.path === "rows").length;
  await h.set(id, append);
  await expect(cell(page, 0, 0)).toHaveText("Append base");
  await cell(page, 0, 0).click();
  await page.getByRole("button", { name: "Add row at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(5);
  await expect(cell(page, 4, 0)).toBeFocused();
  expect(writes().filter(write => write.kind === "compare-and-set" && write.path === "rows").length)
    .toBeGreaterThan(transactionsBeforeAppend);

  const resizeRenumber: TableData = {
    columns: { c1: { order: Number.MAX_VALUE, retained: "column" } },
    rows: { r1: { order: 0, cells: { c1: "Resize transaction base" } } },
  };
  await h.set(id, resizeRenumber);
  await expect(cell(page, 0, 0)).toHaveText("Resize transaction base");
  const beforeResizeTransaction = writes().length;
  h.proxy.holdWrites();
  await dragResize(page, "column", 1, 40);
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, { order: 7, width: 111, agent: true }, "columns/agent");
  h.proxy.releaseWrites();
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.columns)
    .some(column => column.width === 200)).toBe(true);
  const resizeColumns = (await h.read<TableData>(id))!.columns;
  expect(resizeColumns.c1).toMatchObject({ order: 1, retained: "column" });
  expect(resizeColumns.agent).toMatchObject({ order: 0, width: 111, agent: true });
  expect(Object.values(resizeColumns).find(column => column.width === 200)).toMatchObject({ order: 2, width: 200 });
  const resizeWrites = writes().slice(beforeResizeTransaction);
  expect(resizeWrites.length).toBeGreaterThanOrEqual(2);
  expect(resizeWrites.every(write => write.kind === "compare-and-set" && write.path === "columns")).toBe(true);

  const drawn: TableData = {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: 0, cells: { c1: "Drawn transaction base" } } },
  };
  await h.set(id, drawn);
  await expect(cell(page, 0, 0)).toHaveText("Drawn transaction base");
  const beforeDeferred = writes().length;
  h.proxy.holdWrites();
  await cell(page, 0, 1).click();
  await page.keyboard.type("Deferred");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await page.waitForTimeout(100);
  expect(h.proxy.heldWriteCount).toBe(1);
  expect(writes().slice(beforeDeferred)).toHaveLength(0);
  expect(await h.read(id, "rows/r1/cells")).toEqual({ c1: "Drawn transaction base" });
  h.proxy.releaseWrites();
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.rows.r1!.cells)).toContain("Deferred");
  const finalWrites = writes();
  const transactionIndex = lastIndexWhere(finalWrites, write => write.kind === "compare-and-set" && write.path === "columns");
  const cellWriteIndex = lastIndexWhere(finalWrites, write => write.kind === "set" && String(write.path).startsWith("rows/r1/cells/"));
  expect(transactionIndex).toBeGreaterThanOrEqual(0);
  expect(cellWriteIndex).toBeGreaterThan(transactionIndex);

  await h.set(id, drawn);
  await expect(cell(page, 0, 0)).toHaveText("Drawn transaction base");
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
  await expect(status(page)).toHaveText("Couldn't save that change.");
  await h.set(id, drawn);
  await expect(cell(page, 0, 0)).toHaveText("Drawn transaction base");
  const guardedWrites = writes().slice(beforeUnreadableAxis);
  expect(guardedWrites).toHaveLength(1);
  expect(guardedWrites[0]).toMatchObject({ kind: "compare-and-set", path: "columns" });

  await expect(status(page)).toHaveText("", { timeout: 10_000 });
  await h.set(id, drawn);
  await expect(cell(page, 0, 0)).toHaveText("Drawn transaction base");
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
  expect(await h.read(id, "rows/r1/cells")).toEqual({ c1: "Drawn transaction base" });
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
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "rows/r1/cells/c1", '"Place"']);
  await expect(cell(page, 0, 0)).toHaveText("Place");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Local draft");

  await h.set(id, -1, "rows/r2/order");
  await expect(page.locator('[data-row-key="r2"][data-column-key="c2"] .table-input')).toBeFocused();
  await expect(editor(page)).toHaveValue("Local draft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);

  await h.set(id, "Agent same field", "rows/r2/cells/c2");
  await expect(editor(page)).toHaveValue("Local draft");
  expect(await editor(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);
  await h.set(id, 210, "columns/c1/width");
  await h.set(id, 60, "rows/r1/height");
  await expect(columnButton(page, "A")).toHaveAttribute("aria-description", /210 pixels wide/);
  await expect(rowButton(page, 1)).toHaveAttribute("aria-description", /60 pixels tall/);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Local draft");
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
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();
  await expect(grid(page)).toBeFocused();
  expect(writes()).toHaveLength(beforeRemoval);

  await cell(page, 0, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Header draft");
  const beforeHeaderChange = writes().length;
  await h.set(id, false, "headerRow");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Header draft");
  await expect(page.getByRole("columnheader")).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();
  expect(writes()).toHaveLength(beforeHeaderChange);
  await editor(page).press("Escape");

  await h.set(id, { columns: { c1: { order: 1 } }, rows: { r1: { order: 1, cells: {} } } });
  await expect(page.locator('[data-row-key="r4"]')).toHaveCount(0);
  await cell(page, 2, 2).click();
  await page.keyboard.type("Drawn draft");
  await expect(editor(page)).toHaveValue("Drawn draft");
  const beforeIdentityChange = writes().length;
  await h.set(id, { order: 2, cells: {} }, "rows/agent-row");
  await expect(editor(page)).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();
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
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();

  await h.set(id, "Agent update", "rows/r2/cells/c2");
  await expect(grid(page)).toBeFocused();
  await expect(page.locator('[data-selection="cell"]')).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();
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
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveAttribute("trigger", "table-row-reference-3");
  await h.set(id, -1, "rows/r3/order");
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveAttribute("trigger", "table-row-reference-1");
  await page.keyboard.press("Escape");

  await h.set(id, fixture());
  await expect(cell(page, 1, 1)).toHaveText("Maine");
  await cell(page, 1, 1).click();
  await h.set(id, -1, "rows/r2/order");
  await expect(page.locator('[data-row-key="r2"][data-column-key="c2"]')).toHaveAttribute("data-selection", "cell");

  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Insert row above" })).toBeFocused();
  await h.set(id, 181, "columns/c1/width");
  await expect(page.getByRole("menuitem", { name: "Insert row above" })).toBeFocused();
  await h.remove(id, "rows/r2");
  await expect(page.getByRole("menu", { name: "Row actions" })).toHaveCount(0);
  await expect(rowButton(page, 0)).toBeVisible();
  await expect(columnButton(page, "A")).toBeVisible();
  await expect(grid(page)).toBeFocused();
});

// proofs/ui/templates/table.md#^table-ac-access
// proofs/ui/templates/table.md#^table-ac-unreadable
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
  await expect(page.locator(".table-column-resize-handle, .table-row-resize-handle")).toHaveCount(0);
  await expect(columnButton(page, "A")).toHaveAttribute("aria-description", "160 pixels wide.");
  const beforeReadOnlyResize = writes().length;
  await columnButton(page, "A").click();
  await page.keyboard.press("+");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeReadOnlyResize);
  expect(await h.read(id, "rows/r2/cells/c3")).toBe(true);
  await h.set(id, "Agent update", "rows/r2/cells/c3");
  await expect(cell(page, 1, 2)).toHaveText("Agent update");

  await h.set(id, { columns: {}, rows: {} });
  await expect(page.locator("[data-column-key], [data-row-key]")).toHaveCount(0);
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

  const beforeLostAccessResize = writes().length;
  const accessResize = await startResize(page, "column", 0);
  await page.mouse.move(accessResize.x + 32, accessResize.y);
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(page.locator(".table-column-resize-handle")).toHaveCount(0);
  await expect.poll(async () => (await cell(page, 1, 0).boundingBox())!.width).toBeCloseTo(160, 0);
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeLostAccessResize);
  expect(await h.read(id, "columns/c1/width")).toBeUndefined();

  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await dragResize(page, "column", 0, 24);
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(184);

  await cell(page, 1, 1).click();
  await page.keyboard.press("Enter");
  await editor(page).fill("Discarded draft");
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(editor(page)).toHaveCount(0);
  await expect(cell(page, 1, 1)).toBeFocused();
  await expect(cell(page, 1, 1)).toHaveText("Maine");
  expect(await h.read(id, "rows/r2/cells/c2")).toBe("Maine");

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
  await expect(cell(page, 0, 0)).toHaveText("Park");
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
test("first load keeps one status region through disconnection and recovery", async ({ page, context }) => {
  const id = await h.createStored(fixture());
  const blankID = await h.createStored({ columns: {}, rows: {} });
  const reference = await context.newPage();
  await h.open(reference, id);
  await expect(grid(reference)).toBeVisible();
  const populatedGridBox = (await grid(reference).boundingBox())!;
  await h.open(reference, blankID);
  await expect(grid(reference)).toBeVisible();
  const blankGridBox = (await grid(reference).boundingBox())!;
  expect({ x: populatedGridBox.x, y: populatedGridBox.y }).toEqual({ x: blankGridBox.x, y: blankGridBox.y });
  await reference.close();
  h.proxy.hold("to-browser");
  await h.open(page, id);
  await expect(page.locator(".table-loading")).toBeVisible();
  const loadingBox = (await page.locator(".table-loading").boundingBox())!;
  expect({ x: loadingBox.x, y: loadingBox.y }).toEqual({ x: populatedGridBox.x, y: populatedGridBox.y });
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

  const beforeInterruptedResize = writes().length;
  const interruptedResize = await startResize(page, "column", 0);
  await page.mouse.move(interruptedResize.x + 30, interruptedResize.y);
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(page.locator(".table-column-resize-handle")).toHaveCount(0);
  await page.mouse.up();
  await columnButton(page, "A").click();
  await page.keyboard.press("+");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeInterruptedResize);
  expect(await h.read(id, "columns/c1/width")).toBeUndefined();
  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();
  await dragResize(page, "column", 0, 24);
  await expect.poll(() => h.read(id, "columns/c1/width")).toBe(184);

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
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Park");
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
  h.proxy.releaseWrites();
  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible();
  expect(await status(page).textContent()).toBe("");
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Confirmed online");

  await h.set(id, {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: 0, cells: { c1: "Disconnected follow-up base" } } },
  });
  await expect(cell(page, 0, 0)).toHaveText("Disconnected follow-up base");
  const connection = h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
  h.proxy.holdServerMessages(connection, message => message.type === "applied");
  await cell(page, 0, 1).click();
  await page.keyboard.type("Held follow-up");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(2);
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  h.proxy.releaseServerMessages(connection);
  expect(await h.read(id, "rows/r1/cells")).toEqual({ c1: "Disconnected follow-up base" });
  await page.waitForTimeout(6_500);
  await expect(status(page)).toHaveText("Reconnecting…");
  h.proxy.refuse(false);
  await expect(page.getByRole("button", { name: "Add row at end" })).toBeVisible({ timeout: 30_000 });
  await expect(status(page)).toHaveText("Couldn't save that change.");
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
  await expect(cell(page, 3, 1)).toHaveText("Florida");
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
    rows: { r1: { order: 0, cells: { c1: "Held follow-up base" } } },
  });
  await expect(status(page)).toHaveText("", { timeout: 10_000 });
  await expect(cell(page, 0, 0)).toHaveText("Held follow-up base");
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
  expect(await h.read(id, "rows/r1/cells")).toEqual({ c1: "Held follow-up base" });
  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(page.locator(".table-page")).toHaveAttribute("data-editable", "true");
  await expect(status(page)).toHaveText("", { timeout: 10_000 });

  await h.set(id, {
    columns: { c1: { order: 0 } },
    rows: {
      a: { order: 0, cells: { c1: "Insert abort first" } },
      b: { order: Number.MAX_VALUE, cells: { c1: "Insert abort target" } },
    },
  });
  await expect(cell(page, 1, 0)).toHaveText("Insert abort target");
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
    rows: { r1: { order: 0, cells: { c1: "Aborted resize base" } } },
  });
  await expect(cell(page, 0, 0)).toHaveText("Aborted resize base");
  const beforeAbortedResize = writes().length;
  h.proxy.holdWrites();
  await dragResize(page, "column", 1, 40);
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, "not an axis", "columns");
  h.proxy.releaseWrites();
  await expect.poll(() => h.proxy.heldWriteCount).toBe(0);
  await expect(status(page)).toHaveText("Couldn't save that change.");
  const abortedResizeWrites = writes().slice(beforeAbortedResize);
  expect(abortedResizeWrites).toHaveLength(1);
  expect(abortedResizeWrites[0]).toMatchObject({ kind: "compare-and-set", path: "columns" });

  await expect(status(page)).toHaveText("", { timeout: 10_000 });
  await h.set(id, {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: Number.MAX_VALUE, cells: { c1: "Two axes base" } } },
  });
  await expect(cell(page, 0, 0)).toHaveText("Two axes base");
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
  expect(await h.read(id, "rows/r1/cells/c1")).toBe("Park");
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeUnreadableDraft);

  await h.set(id, 212, "columns/c1/width");
  await h.set(id, 52, "rows/r1/height");
  await expect(columnButton(page, "A")).toHaveAttribute("aria-description", /212 pixels wide/);
  await expect(rowButton(page, 0)).toHaveAttribute("aria-description", /52 pixels tall/);
  await h.set(id, 0, "columns/c1/width");
  await h.set(id, -1, "rows/r1/height");
  await expect(columnButton(page, "A")).toHaveAttribute("aria-description", /160 pixels wide/);
  await expect(rowButton(page, 0)).toHaveAttribute("aria-description", /38 pixels tall/);
  const beforeUnreadableResize = writes().length;
  const unreadableResize = await startResize(page, "row", 0);
  await page.mouse.move(unreadableResize.x, unreadableResize.y + 30);
  await h.set(id, "not rows", "rows");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeUnreadableResize);
  await h.set(id, fixture().rows, "rows");
  await expect(grid(page)).toBeVisible();
  await page.waitForTimeout(100);
  expect(writes()).toHaveLength(beforeUnreadableResize);

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

// proofs/ui/templates/table.md#^table-ac-disconnection
// proofs/ui/templates/table.md#^table-ac-unreadable
test("unreadable and unavailable states survive disconnection and recover", async ({ page }) => {
  const id = await open(page);
  await h.set(id, { columns: { broken: { ignored: "value" } }, rows: { r1: { order: 1, cells: { missing: "Ignored" } } } });
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

function lastIndexWhere<T>(items: readonly T[], matches: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (matches(items[index]!)) return index;
  }
  return -1;
}
