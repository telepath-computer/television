/** Real browser acceptance for the copied editable Table and its JSON store. */
import { readFileSync, renameSync } from "node:fs";
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

// proofs/ui/templates/table.md#^table-ac-new
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
  await page.keyboard.press("Tab");
  await expect(cell(copy, 3, 3)).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cell(copy, 3, 3)).toBeFocused();
  await page.reload();
  const reloaded = await h.frame(page, id);
  await expect(cell(reloaded, 2, 1)).toHaveText("First");
});

// proofs/ui/templates/table.md#^table-ac-rows
// proofs/ui/templates/table.md#^table-ac-editing
// proofs/ui/templates/table.md#^table-ac-keyboard
test("stored values render in order and spreadsheet editing follows pointer and keyboard", async ({ page }) => {
  const value = fixture();
  for (let index = 5; index <= 8; index += 1) value.columns[`c${index}`] = { order: index, name: index === 5 ? "Notes" : `Column ${index}` };
  value.rows.r1!.cells.c5 = "First\nsecond";
  for (let index = 7; index <= 40; index += 1) {
    value.rows[`r${index}`] = { order: index, cells: { c1: `Park ${index}`, c2: "Somewhere", c8: "Wide" } };
  }
  const id = await open(page, value);

  await expect(page.getByRole("columnheader")).toHaveCount(8);
  expect(await page.getByRole("columnheader").allTextContents()).toEqual([
    "Park", "State", "Open", "Rating", "Notes", "Column 6", "Column 7", "Column 8",
  ]);
  await expect(cell(page, 0, 2)).toHaveText("true");
  await expect(cell(page, 2, 2)).toHaveText("false");
  await expect(cell(page, 0, 3)).toHaveText("4.9");
  await expect(cell(page, 0, 4)).toHaveText("First second");
  await expect(grid(page)).toHaveAttribute("aria-rowcount", "41");
  await expect(grid(page)).toHaveAttribute("aria-colcount", "8");
  await expect(cell(page, 0, 0)).toHaveAccessibleName("Acadia");
  await expect(page.getByRole("button", { name: "Add row at end" })).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("button", { name: "Add column at end" })).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
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

  await cell(page, 1, 1).dblclick();
  await expect(editor(page)).toHaveValue("Utah");
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
  await header(page, 1).press("Enter");
  await editor(page).fill("Region");
  await editor(page).press("Tab");
  await expect.poll(() => h.read(id, "columns/c2/name")).toBe("Region");
  await expect(header(page, 2)).toHaveAttribute("data-selection", "header");

  await header(page, 2).press("Delete");
  await expect.poll(() => h.read(id, "columns/c3/name")).toBeUndefined();
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
    await expect(rowButton(page, 0)).toHaveAttribute("aria-pressed", "true");
  }
  await cell(page, 0, 1).click();
  await page.keyboard.press("Control+Shift+Space");
  await expect(columnButton(page, "B")).toHaveAttribute("aria-pressed", "true");
  for (const key of ["Enter", "F2", "x", "Space"]) {
    await page.keyboard.press(key);
    await expect(editor(page)).toHaveCount(0);
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

// proofs/ui/templates/table.md#^table-ac-selection
// proofs/ui/templates/table.md#^table-ac-structure
// proofs/arch/templates/table.md#^templates-table-t-write-scope
test("row and column selections clear, insert, add, delete and toggle through canonical menus", async ({ page }) => {
  const id = await open(page);
  await cell(page, 0, 3).click();
  await page.keyboard.press("Delete");
  await expect.poll(() => h.read(id, "rows/r1/cells/c4")).toBeUndefined();
  await expect(cell(page, 0, 3)).toHaveAttribute("data-selection", "cell");

  await cell(page, 1, 1).click();
  await rowButton(page, 1).click();
  await rowButton(page, 3).click({ modifiers: ["Shift"] });
  await expect(rowButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, 3)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Backspace");
  await expect.poll(() => h.read(id, "rows/r2/cells")).toEqual({});
  await expect.poll(() => h.read(id, "rows/r4/cells")).toEqual({});

  await rowButton(page, 1).click({ button: "right" });
  const rowMenu = page.getByRole("menu", { name: "Row actions" });
  await expect(rowMenu).toHaveAttribute("open", "");
  await expect(rowMenu.getByText("Delete rows", { exact: true })).toBeVisible();
  await rowMenu.getByText("Insert row below", { exact: true }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(7);
  await expect(page.locator('.table-reference-item[aria-pressed="true"]')).toHaveText(/\d/);

  await page.getByRole("button", { name: "Add row at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(8);
  await expect(page.locator('[data-cell][data-selection="cell"]')).toBeFocused();

  await columnButton(page, "A").click();
  await page.keyboard.press("Delete");
  await expect.poll(() => h.read(id, "columns/c1/name")).toBe("Park");
  await expect.poll(() => h.read(id, "rows/r1/cells/c1")).toBeUndefined();

  await columnButton(page, "A").click({ button: "right" });
  await page.getByRole("menu", { name: "Column actions" }).getByText("Insert column right", { exact: true }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(5);
  await expect(page.locator('.table-reference-item[aria-pressed="true"]')).toHaveText("B");
  const insertedColumnKey = Object.keys((await h.read<TableData>(id))!.columns)
    .find(key => !["c1", "c2", "c3", "c4"].includes(key));
  expect(insertedColumnKey).toBeDefined();
  expect(["Park", "State", "Open", "Rating"]).not.toContain(insertedColumnKey);

  await page.getByRole("button", { name: "Add column at end" }).click();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.columns).length).toBe(6);
  await expect(page.locator('[data-cell][data-selection="cell"]')).toBeFocused();

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

  expect(writes().some(write => write.kind === "update" && write.path === "")).toBe(true);
  expect(writes().some(write => write.kind === "set" && write.path === "showHeader")).toBe(true);
  expect(writes().some(write => write.kind === "remove" && write.path === "columns/c2")).toBe(true);
  expect(writes().some(write => write.kind === "remove" && write.path === "rows/r1")).toBe(true);
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

  await cell(page, 2, 1).click();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Row actions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await header(page, 2).click();
  await page.keyboard.press("ContextMenu");
  await expect(page.getByRole("menu", { name: "Column actions" })).toBeVisible();
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

  const renumbered: TableData = {
    columns: { c1: { order: 0, name: "A" } },
    rows: { a: { order: 0, cells: {} }, b: { order: Number.MAX_VALUE, cells: {} } },
  };
  await h.set(id, renumbered);
  await expect(cell(page, 1, 0)).toBeVisible();
  await cell(page, 1, 0).click();
  await rowButton(page, 1).click({ button: "right" });
  h.proxy.holdWrites();
  await page.getByRole("menu", { name: "Row actions" }).getByText("Insert row below", { exact: true }).click();
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, { order: 7, cells: {}, agent: true }, "rows/agent");
  h.proxy.releaseWrites();
  await expect.poll(async () => Object.keys((await h.read<TableData>(id))!.rows).length).toBe(4);
  expect(await h.read(id, "rows/agent/agent")).toBe(true);
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
  await expect(page.locator('[data-cell][data-selection="cell"]')).toBeFocused();
  expect(writes().filter(write => write.kind === "compare-and-set" && write.path === "rows").length)
    .toBeGreaterThan(transactionsBeforeAppend);

  const drawn: TableData = {
    columns: { c1: { order: Number.MAX_VALUE } },
    rows: { r1: { order: 0, cells: {} } },
  };
  await h.set(id, drawn);
  await expect(cell(page, 0, 1)).toBeVisible();
  h.proxy.holdWrites();
  await cell(page, 0, 1).click();
  await page.keyboard.type("Deferred");
  await editor(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  expect(await h.read(id, "rows/r1/cells")).toEqual({});
  h.proxy.releaseWrites();
  await expect.poll(async () => Object.values((await h.read<TableData>(id))!.rows.r1!.cells)).toContain("Deferred");
  const finalWrites = writes();
  const transactionIndex = finalWrites.findLastIndex(write => write.kind === "compare-and-set" && write.path === "columns");
  const cellWriteIndex = finalWrites.findLastIndex(write => write.kind === "set" && String(write.path).startsWith("rows/r1/cells/"));
  expect(transactionIndex).toBeGreaterThanOrEqual(0);
  expect(cellWriteIndex).toBeGreaterThan(transactionIndex);
});
