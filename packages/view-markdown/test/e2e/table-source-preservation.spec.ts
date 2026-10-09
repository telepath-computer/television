import { expect, test, type Page } from "@playwright/test";

// proofs/arch/artifact-frame/markdown-tables-buffer.md#^mt-t-passive-source
// proofs/arch/artifact-frame/markdown-tables-buffer.md#^mt-t-intentional-source
// proofs/arch/artifact-frame/markdown-tables-buffer.md#^mt-t-structural-source
// proofs/arch/artifact-frame/markdown-tables-buffer.md#^mt-t-discovery
// proofs/ui/markdown-editor/index.md#^md-table-t-edge-navigation

const RAW = "8. Before\n\n|A|B|\n|---|---|\n|1|two|\n \n12. After";
interface HostView { state: { doc: { toString(): string }; selection: { main: { head: number } } }; dispatch(spec: unknown): void; focus(): void }
interface Host extends Window {
  __cmView?: HostView;
  __sourceSaves?: string[];
  __sendSource?: (content: string) => void;
  __rootFocuses?: number;
  __televisionContentBridge?: { postToHost(message: unknown): void; onHostMessage(callback: (message: unknown) => void): () => void };
}
async function load(page: Page, content: string, reject = false): Promise<void> {
  await page.addInitScript(({ content, reject }) => {
    const host = window as Host;
    const listeners: Array<(message: unknown) => void> = [];
    host.__sourceSaves = [];
    host.__sendSource = (source) => listeners.forEach((listener) => listener({ type: "content-updated", content: source }));
    host.__televisionContentBridge = {
      postToHost(message) {
        const payload = message as { type: string; id?: string; content?: string };
        if (payload.type === "ready") setTimeout(() => host.__sendSource?.(content), 0);
        if (payload.type === "update-content") {
          host.__sourceSaves?.push(payload.content ?? "");
          setTimeout(() => listeners.forEach((listener) => listener(reject ? { type: "response", id: payload.id, error: { message: "Not writable" } } : { type: "response", id: payload.id, result: {} })), 0);
        }
      },
      onHostMessage(callback) { listeners.push(callback); return () => {}; },
    };
  }, { content, reject });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible();
}
async function source(page: Page): Promise<string> {
  return page.evaluate(() => (window as Host).__cmView?.state.doc.toString() ?? "");
}
async function saves(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Host).__sourceSaves ?? []);
}
async function rootCaret(page: Page, at = 0): Promise<void> {
  await page.evaluate((anchor) => { const view = (window as Host).__cmView; view?.dispatch({ selection: { anchor } }); view?.focus(); }, at);
}

for (const edge of ["start", "end", "both", "only"]) {
  test(`root select-all across tables at document ${edge} preserves valid selection and source`, async ({ page }) => {
    const table = "|A|B|\n|---|---|\n|one|two|";
    const raw = edge === "start" ? `${table}\n\nProse` : edge === "end" ? `Prose\n\n${table}` : edge === "only" ? table : `${table}\n\nProse\n\n${table}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await load(page, raw);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(edge === "both" ? 2 : 1);
    if (edge === "only") {
      await page.evaluate(() => { const view = (window as Host).__cmView; view?.dispatch({ selection: { anchor: 0, head: view.state.doc.toString().length } }); });
    } else {
      await rootCaret(page, raw.indexOf("Prose") + "Prose".length);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
    }
    await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(raw.length);
    await page.evaluate(() => { const view = (window as Host).__cmView; view?.dispatch({ selection: { anchor: 0, head: view.state.doc.toString().indexOf("Prose") + 3 } }); });
    await page.waitForTimeout(650);
    expect(await source(page)).toBe(raw);
    expect(await saves(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const fixture of [
  { name: "escaped pipes", table: "| A | B |\n| :- | -: |\n| left\\|right | tail |", cell: 2, end: "left\\|right" },
  { name: "empty cells", table: "|A|B|C|\n|---|---|---|\n|one||three|", cell: 4, end: "|one|" },
  { name: "missing cells", table: "|A|B|C|\n|---|---|---|\n|one|", cell: 5, end: "|one|" },
  { name: "extra cells", table: "|A|B|\n|---|---|\n|one|two|unowned|", cell: 3, end: "two" },
  { name: "unbordered rows", table: "A | B\n--- | ---\none | two", cell: 3, end: "two" },
  { name: "br and whitespace", table: "|A|B|\n|---|---|\n| <br>one<br>two<br> | tail |", cell: 2, end: "one<br>two" },
]) {
  test(`raw ${fixture.name} retain source and map cell caret to its original span`, async ({ page }) => {
    const raw = `Before\n \n${fixture.table}\n\t\nAfter`;
    await load(page, raw);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    const point = await page.locator(".tbl-cell").nth(fixture.cell).locator(".tbl-cell-view").evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let last: Node | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent) last = node;
      const range = document.createRange();
      if (last) { range.setStart(last, last.textContent?.length ?? 0); range.collapse(true); }
      const rect = last ? range.getBoundingClientRect() : element.getBoundingClientRect();
      return { x: rect.x + 1, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
    const position = raw.indexOf(fixture.end) + fixture.end.length;
    await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(position);
    await rootCaret(page);
    await page.waitForTimeout(650);
    expect(await source(page)).toBe(raw);
    expect(await saves(page)).toEqual([]);
  });
}

test("ordinary cell edits retain overflow cells and edge breaks in other cells", async ({ page }) => {
  const raw = "Before\n\n|A|B|\n|---|---|\n|<br>one<br>|two|overflow|\n \nAfter";
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.locator(".tbl-cell").nth(3).click();
  await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(raw.indexOf("two") + 3);
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toBe(raw.replace("two", "twoX"));
  await expect.poll(() => saves(page)).toHaveLength(1);
});

test("editing a missing cell inserts its delimiters without replacing other source", async ({ page }) => {
  const raw = "Before\n\n|A|B|C|\n|---|---|---|\n|one|\n\nAfter";
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.locator(".tbl-cell").nth(5).click();
  await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(raw.indexOf("|one|") + 5);
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toBe(raw.replace("|one|", "|one||X|"));
  await expect.poll(() => saves(page)).toHaveLength(1);
});

for (const bordered of [false, true]) {
  test(`editing missing cell after escaped trailing pipe (${bordered ? "bordered" : "unbordered"}) preserves source and saves`, async ({ page }) => {
    const raw = bordered ? "|A|B|\n|---|---|\n|one\\|" : "A | B\n--- | ---\none\\|";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await load(page, raw);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    await page.locator(".tbl-cell").nth(3).click();
    await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(raw.length);
    await page.keyboard.type("X");
    await expect.poll(() => source(page)).toBe(raw + "|X|");
    await expect.poll(() => saves(page)).toEqual([raw + "|X|"]);
    expect(errors).toEqual([]);
  });
}

test("editing the first of multiple missing cells retains the clicked column", async ({ page }) => {
  const raw = "|A|B|C|\n|---|---|---|\n|one|";
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.locator(".tbl-cell").nth(4).click();
  await expect(page.locator(".tbl-cell").nth(4).locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toBe(raw + "X|");
  await expect.poll(() => saves(page)).toEqual([raw + "X|"]);
});

test("ordinary edits immediately above and below a table preserve its boundaries", async ({ page }) => {
  const raw = "Before\n|A|B|\n|---|---|\n|one|two|\n\nAfter";
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await rootCaret(page, "Before".length);
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toBe(raw.replace("Before", "BeforeX"));
  await rootCaret(page, raw.length + 1);
  await page.keyboard.type("Y");
  await expect.poll(() => source(page)).toBe(raw.replace("Before", "BeforeX") + "Y");
});

test("structural undo and redo restore source mapping before editing the restored third column", async ({ page }) => {
  const raw = "Before\n\n|A|B|\n|---|---|\n|one|two|\n\nAfter";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.locator(".tbl-handle[data-type='header'][data-location='col']").first().click({ force: true });
  await page.locator(".tbl-menu-item", { hasText: "Add column after" }).click({ force: true });
  await expect(page.locator(".tbl-cell")).toHaveCount(6);
  const expanded = await source(page);
  expect(expanded.startsWith("Before\n\n")).toBe(true);
  expect(expanded.endsWith("\n\nAfter")).toBe(true);
  await expect.poll(() => saves(page)).toHaveLength(1);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => source(page)).toBe(raw);
  await expect(page.locator(".tbl-cell")).toHaveCount(4);
  await expect.poll(() => saves(page)).toHaveLength(2);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
  await expect.poll(() => source(page)).toBe(expanded);
  await expect(page.locator(".tbl-cell")).toHaveCount(6);
  await expect.poll(() => saves(page)).toHaveLength(3);
  await page.locator(".tbl-cell").nth(5).click();
  await expect(page.locator(".tbl-cell").nth(5).locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(expanded.indexOf("two") + 3);
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toBe(expanded.replace("two", "twoX"));
  await expect.poll(() => saves(page)).toHaveLength(4);
  expect(errors).toEqual([]);
});

for (const bordered of [false, true]) {
  test(`first raw header edits keep cell focus (${bordered ? "compact Home" : "unbordered click"})`, async ({ page }) => {
    const table = bordered ? "|A|B|\n|---|---|\n|one|two|" : "A | B\n--- | ---\none | two";
    const raw = `Before\n\n${table}\n\nAfter`;
    await load(page, raw);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    const view = page.locator(".tbl-cell").first().locator(".tbl-cell-view");
    const point = await view.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let last: Node | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent) last = node;
      if (!last) throw new Error("Header has no display text");
      const range = document.createRange();
      range.setStart(last, last.textContent?.length ?? 0); range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 1, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".tbl-cell").first().locator(".tbl-cell-editor .cm-content")).toBeFocused();
    if (bordered) {
      await page.keyboard.press("Home");
      await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(raw.indexOf("|A|") + 1);
      await expect(page.locator(".tbl-cell").first().locator(".tbl-cell-editor .cm-content")).toBeFocused();
    }
    await page.keyboard.type("X");
    const expected = bordered ? raw.replace("|A|", "|XA|") : raw.replace("A |", "AX |");
    await expect.poll(() => source(page)).toBe(expected);
    await expect.poll(() => saves(page)).toEqual([expected]);
  });
}

test("scrolling to a lazily parsed table after an earlier edit renders without formatting or saving it", async ({ page }) => {
  const raw = "Opening paragraph\n\n" + "A paragraph well before the target table with ordinary text.\n\n".repeat(6000) + "|A|B|\n|---|---|\n|one|two|\n";
  await load(page, raw);
  await expect.poll(() => source(page)).toBe(raw);
  await rootCaret(page);
  await page.keyboard.type("X");
  const edited = "X" + raw;
  await expect.poll(() => source(page)).toBe(edited);
  await expect.poll(() => saves(page)).toHaveLength(1);
  await page.locator(".cm-scroller").first().evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.waitForTimeout(650);
  expect(await source(page)).toBe(edited);
  expect(await saves(page)).toHaveLength(1);
});

test("viewing and remote replacement render noncanonical tables without changing or saving source", async ({ page }) => {
  await load(page, RAW);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.waitForTimeout(650);
  expect(await source(page)).toBe(RAW);
  expect(await saves(page)).toEqual([]);
  await page.locator(".tbl-cell").first().click();
  await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await rootCaret(page);
  const remote = "Before\n  \n| H |\n| --- |\n| <br> value <br> |\n\nAfter";
  await page.evaluate((content) => (window as Host).__sendSource?.(content), remote);
  await expect.poll(() => source(page)).toBe(remote);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.waitForTimeout(650);
  expect(await source(page)).toBe(remote);
  expect(await saves(page)).toEqual([]);
});

test("edge keys leave a table with surrounding text without changing source or saving", async ({ page }) => {
  const raw = "Before\n\n|A|B|\n|---|---|\n|1|two|\n\nAfter";
  const from = raw.indexOf("|A|");
  const to = raw.indexOf("two|") + "two|".length;
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  for (const gesture of [{ cell: "last", key: "Tab" }, { cell: "first", key: "Shift+Tab" }, { cell: "last", key: "Enter" }]) {
    const cell = gesture.cell === "first" ? page.locator(".tbl-cell").first() : page.locator(".tbl-cell").last();
    await cell.click();
    await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
    await page.keyboard.press(gesture.key);
    await expect(page.locator(".tbl-cell-editor")).toHaveCount(0);
    await expect(page.locator(".cm-content").first()).toBeFocused();
    const head = await page.evaluate(() => (window as Host).__cmView?.state.selection.main.head ?? -1);
    if (gesture.cell === "first") expect(head).toBeLessThan(from);
    else expect(head).toBeGreaterThan(to);
    expect(await source(page)).toBe(raw);
  }
  await expect(page.locator(".tbl-cell")).toHaveCount(4);
  await page.waitForTimeout(650);
  await expect(page.locator(".cm-content").first()).toBeFocused();
  expect(await source(page)).toBe(raw);
  expect(await saves(page)).toEqual([]);
});

test("edge keys at document edges keep the caret in the edge cell without changing source or saving", async ({ page }) => {
  const raw = "|A|B|\n|---|---|\n|1|two|";
  await load(page, raw);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.evaluate(() => {
    const host = window as Host;
    document.querySelector(".cm-content")?.addEventListener("focus", () => { host.__rootFocuses = (host.__rootFocuses ?? 0) + 1; });
  });
  for (const gesture of [{ cell: "last", key: "Tab", text: "two" }, { cell: "first", key: "Shift+Tab", text: "A" }, { cell: "last", key: "Enter", text: "two" }]) {
    const cell = gesture.cell === "first" ? page.locator(".tbl-cell").first() : page.locator(".tbl-cell").last();
    const editor = cell.locator(".tbl-cell-editor .cm-content");
    await cell.click();
    await expect(editor).toBeFocused();
    await page.evaluate(() => { (window as Host).__rootFocuses = 0; });
    await page.keyboard.press(gesture.key);
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => (window as Host).__rootFocuses)).toBe(0);
    const head = await page.evaluate(() => (window as Host).__cmView?.state.selection.main.head ?? -1);
    expect(head).toBeGreaterThanOrEqual(raw.indexOf(gesture.text));
    expect(head).toBeLessThanOrEqual(raw.indexOf(gesture.text) + gesture.text.length);
    expect(await source(page)).toBe(raw);
  }
  await expect(page.locator(".tbl-cell")).toHaveCount(4);
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => (window as Host).__rootFocuses)).toBe(0);
  await expect(page.locator(".tbl-cell").last().locator(".tbl-cell-editor .cm-content")).toBeFocused();
  expect(await source(page)).toBe(raw);
  expect(await saves(page)).toEqual([]);
});

test("intentional cell edits replace only the table and undo remains byte preserving after selection", async ({ page }) => {
  await load(page, RAW);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.locator(".tbl-cell", { hasText: "two" }).click();
  await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(RAW.indexOf("two") + "two".length);
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toContain("twoX");
  expect((await source(page)).startsWith("8. Before\n\n")).toBe(true);
  expect((await source(page)).endsWith("\n \n12. After")).toBe(true);
  await expect.poll(() => saves(page)).toHaveLength(1);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => source(page)).toBe(RAW);
  await rootCaret(page);
  await page.waitForTimeout(650);
  expect(await source(page)).toBe(RAW);
  expect(await saves(page)).toHaveLength(2);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
  await expect.poll(() => source(page)).toBe(RAW.replace("two", "twoX"));
  await rootCaret(page);
  await page.waitForTimeout(650);
  expect(await source(page)).toBe(RAW.replace("two", "twoX"));
  expect(await saves(page)).toHaveLength(3);
});

test("rejected intentional edits roll back once and remain idle without autonomous save attempts", async ({ page }) => {
  await load(page, RAW, true);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  await page.waitForTimeout(1100);
  expect(await source(page)).toBe(RAW);
  expect(await saves(page)).toEqual([]);
  await page.locator(".tbl-cell", { hasText: "two" }).click();
  await expect(page.locator(".tbl-cell-editor .cm-content")).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => (window as Host).__cmView?.state.selection.main.head)).toBe(RAW.indexOf("two") + "two".length);
  await page.keyboard.type("X");
  await expect.poll(() => saves(page)).toHaveLength(1);
  await expect.poll(() => source(page)).toBe(RAW);
  await rootCaret(page);
  await page.waitForTimeout(1100);
  expect(await source(page)).toBe(RAW);
  expect(await saves(page)).toHaveLength(1);
});
