import { expect, test, type Page } from "@playwright/test";

// proofs/arch/artifact-frame/markdown-tables-buffer.md#^mt-t-structural-source

const TABLE_DOC = [
  "Before table",
  "",
  "| Name | Status |",
  "| ---- | ------ |",
  "| Ada  | Ready  |",
  "",
  "After table",
].join("\n");

const REMOTE_TABLE_DOC = [
  "Remote before",
  "",
  "| Name  | Status    |",
  "| ----- | --------- |",
  "| [Grace](https://example.com/grace) | Reviewing |",
  "",
  "Remote after",
].join("\n");

const PASTE_HOST_DOC = ["Paste here:", "", "Done"].join("\n");
const PASTED_TABLE = ["| A | B |", "| - | - |", "| 1 | 2 |"].join("\n");

interface CmDoc {
  length: number;
  toString(): string;
  lineAt(position: number): { text: string };
}

interface CmViewHandle {
  state: {
    doc: CmDoc;
    selection: { main: { head: number } };
  };
  dispatch(spec: unknown): void;
  focus(): void;
}

interface HostWindow extends Window {
  __cmView?: CmViewHandle;
  __updates?: string[];
  __sendContent?: (content: string) => void;
  __televisionContentBridge?: {
    postToHost(message: unknown): void;
    onHostMessage(callback: (message: unknown) => void): () => void;
  };
}

async function installBridgeCapture(page: Page, initialContent: string): Promise<void> {
  await page.addInitScript((content) => {
    const listeners: Array<(message: unknown) => void> = [];
    const host = window as HostWindow;
    host.__updates = [];
    host.__sendContent = (next: string) => {
      for (const listener of listeners) listener({ type: "content-updated", content: next });
    };
    host.__televisionContentBridge = {
      postToHost(message: unknown): void {
        const payload = message as { type?: string; id?: string; content?: string };
        if (payload.type === "ready") {
          setTimeout(() => host.__sendContent?.(content), 0);
        }
        if (payload.type === "update-content") {
          host.__updates?.push(payload.content ?? "");
          setTimeout(() => {
            for (const listener of listeners) {
              listener({ type: "response", id: payload.id, result: {} });
            }
          }, 0);
        }
      },
      onHostMessage(callback: (message: unknown) => void): () => void {
        listeners.push(callback);
        return () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    };
  }, initialContent);
}

async function loadStandalone(page: Page, doc: string = TABLE_DOC): Promise<void> {
  await page.goto("/");
  await page.locator(".cm-content").waitFor();
  await setDocument(page, doc);
}

async function loadWithBridge(page: Page, doc: string = TABLE_DOC): Promise<void> {
  await installBridgeCapture(page, doc);
  await page.goto("/");
  await page.locator(".cm-content").waitFor();
}

async function setDocument(page: Page, doc: string): Promise<void> {
  await page.evaluate((nextDoc) => {
    const view = (window as HostWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    view.focus();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
      selection: { anchor: 0 },
    });
  }, doc);
  await page.waitForTimeout(50);
}

async function documentText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (window as HostWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    return view.state.doc.toString();
  });
}

async function caretLineText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (window as HostWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    return view.state.doc.lineAt(view.state.selection.main.head).text;
  });
}

async function setCaretAtText(page: Page, needle: string, atEnd = false): Promise<void> {
  await page.evaluate(({ text, end }) => {
    const view = (window as HostWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    const position = view.state.doc.toString().indexOf(text);
    if (position < 0) throw new Error(`Text not found: ${text}`);
    view.focus();
    view.dispatch({ selection: { anchor: position + (end ? text.length : 0) } });
  }, { text: needle, end: atEnd });
}

async function appendToCell(page: Page, cellText: string, suffix: string): Promise<void> {
  const cell = page.locator(".tbl-cell", { hasText: cellText }).first();
  const box = await cell.boundingBox();
  if (!box) throw new Error(`Cell not visible: ${cellText}`);
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await page.keyboard.press("End");
  await page.keyboard.type(suffix);
}

interface ActiveTableCell {
  row: string | null;
  col: string | null;
  text: string;
  selected: boolean;
  editing: boolean;
}

async function activeTableCell(page: Page): Promise<ActiveTableCell | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const cell = active?.closest(".tbl-cell");
    if (!(cell instanceof HTMLElement)) return null;
    return {
      row: cell.dataset.row ?? null,
      col: cell.dataset.col ?? null,
      text: cell.querySelector(".tbl-cell-view")?.textContent?.trim() ?? cell.textContent?.trim() ?? "",
      selected: cell.hasAttribute("data-selected"),
      editing: Boolean(active?.closest(".tbl-cell-editor")),
    };
  });
}

async function expectActiveTableCell(page: Page, expected: { row: number; col: number; text: string }): Promise<void> {
  await expect
    .poll(() => activeTableCell(page), { timeout: 2_000, intervals: [25, 50, 100] })
    .toMatchObject({
      row: String(expected.row),
      col: String(expected.col),
      text: expected.text,
      selected: true,
      editing: true,
    });
}

async function stableDocumentText(page: Page): Promise<string> {
  let stable = "";
  await expect
    .poll(
      async () => {
        const before = await documentText(page);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const after = await documentText(page);
        stable = after;
        return before === after;
      },
      { timeout: 2_000, intervals: [25, 50, 100] },
    )
    .toBe(true);
  return stable;
}

async function capturedUpdates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as HostWindow).__updates ?? []);
}

async function clearCapturedUpdates(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as HostWindow).__updates = [];
  });
}

async function sendRemoteContent(page: Page, content: string): Promise<void> {
  await page.evaluate((next) => {
    const send = (window as HostWindow).__sendContent;
    if (!send) throw new Error("Host send helper missing");
    send(next);
  }, content);
}

async function clickHeaderMenuItem(page: Page, location: "row" | "col", itemText: string): Promise<void> {
  const handles = page.locator(`.tbl-handle[data-type='header'][data-location='${location}']`);
  const handle = location === "row" ? handles.last() : handles.first();
  await handle.click({ force: true });
  await expect(page.locator(".tbl-menu")).toContainText(itemText);
  await page.locator(".tbl-menu-item", { hasText: itemText }).click({ force: true });
}

function platformModifier(): "Control" | "Meta" {
  return process.platform === "darwin" ? "Meta" : "Control";
}

test.describe("markdown tables", () => {
  test("renders a table widget without stealing surrounding markdown", async ({ page }) => {
    await loadStandalone(page);

    const table = page.locator(".tbl-table-widget");
    await expect(table).toHaveCount(1);
    await expect(page.getByText("Before table")).toBeVisible();
    await expect(page.getByText("After table")).toBeVisible();
    await expect(table.locator(".cm-md-hidden, .cm-md-mark, .cm-md-tag, a.cm-md-link")).toHaveCount(0);
    await expect(table.locator(".tbl-cell")).toHaveCount(4);

    await setCaretAtText(page, "Before table");
    expect(await caretLineText(page)).toBe("Before table");
    await setCaretAtText(page, "After table");
    expect(await caretLineText(page)).toBe("After table");
  });

  test("applies the token-mapped table theme in the editor", async ({ page }) => {
    await loadStandalone(page);

    const editorAttrs = await page.locator(".cm-editor").evaluate((editor) => ({
      handlePosition: editor.getAttribute("data-tbl-handle-position"),
      lineWrapping: editor.getAttribute("data-tbl-line-wrapping"),
      selectionType: editor.getAttribute("data-tbl-selection-type"),
      themeMode: editor.getAttribute("data-tbl-theme-mode"),
    }));
    expect(editorAttrs).toEqual({
      handlePosition: "outside",
      lineWrapping: "wrap",
      selectionType: "native",
      themeMode: "light",
    });

    const tableStyle = await page.locator(".tbl-table-widget").evaluate((element) => {
      const header = element.querySelector("th.tbl-header-cell");
      const cell = element.querySelector("td.tbl-cell");
      const headerStyle = header ? window.getComputedStyle(header) : null;
      const cellStyle = cell ? window.getComputedStyle(cell) : null;
      return {
        borderColor: cellStyle?.borderTopColor ?? "",
        fontFamily: cellStyle?.fontFamily ?? "",
        headerBackground: headerStyle?.backgroundColor ?? "",
        headerFontWeight: headerStyle?.fontWeight ?? "",
        headerTextAlign: headerStyle?.textAlign ?? "",
        cellTextAlign: cellStyle?.textAlign ?? "",
      };
    });
    expect(tableStyle.borderColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(tableStyle.fontFamily).toContain("Hind");
    expect(tableStyle.headerBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(tableStyle.headerFontWeight).toBe("600");
    expect(tableStyle.headerTextAlign).toBe("left");
    expect(tableStyle.cellTextAlign).toBe("start");
  });

  test("cell edits format the pipe table and debounce exactly one save", async ({ page }) => {
    await loadWithBridge(page);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    await page.waitForTimeout(700);
    expect(await capturedUpdates(page)).toEqual([]);
    await clearCapturedUpdates(page);

    await appendToCell(page, "Ada", " Lovelace");
    await expect.poll(() => documentText(page)).toMatch(/\| Ada Lovelace\s+\| Ready\s+\|/);
    await expect.poll(() => capturedUpdates(page)).toHaveLength(1);
    await page.waitForTimeout(700);

    const updates = await capturedUpdates(page);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("Ada Lovelace");
  });

  test("in-cell undo delegates to the root history and keeps the widget", async ({ page }) => {
    await loadStandalone(page);
    await appendToCell(page, "Ada", " Lovelace");
    await expect.poll(() => documentText(page)).toContain("Ada Lovelace");

    await page.keyboard.press(`${platformModifier()}+Z`);

    await expect.poll(() => documentText(page)).not.toContain("Ada Lovelace");
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
  });

  test("Tab ownership stays split between root markdown and table cells", async ({ page }) => {
    await loadStandalone(page);

    await page.locator(".tbl-cell", { hasText: "Name" }).first().click();
    await page.keyboard.press("End");
    await expectActiveTableCell(page, { row: 0, col: 0, text: "Name" });
    const beforeInsideTab = await stableDocumentText(page);

    await page.keyboard.press("Tab");
    await expectActiveTableCell(page, { row: 0, col: 1, text: "Status" });
    expect(await documentText(page)).toBe(beforeInsideTab);

    await page.keyboard.press("Shift+Tab");
    await expectActiveTableCell(page, { row: 0, col: 0, text: "Name" });
    expect(await documentText(page)).toBe(beforeInsideTab);

    await page.keyboard.press("Enter");
    await expectActiveTableCell(page, { row: 1, col: 0, text: "Ada" });
    expect(await documentText(page)).toBe(beforeInsideTab);

    await setCaretAtText(page, "After table");
    await page.keyboard.press("Tab");
    await expect.poll(() => documentText(page)).toContain("  After table");

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => documentText(page)).toContain("\nAfter table");
    expect(await documentText(page)).not.toContain("  After table");
  });

  test("row and column menu changes save the updated source", async ({ page }) => {
    await loadWithBridge(page);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    await page.waitForTimeout(700);
    await clearCapturedUpdates(page);

    await clickHeaderMenuItem(page, "col", "Add column after");

    await expect.poll(() => documentText(page)).toContain("| Name |   | Status |");
    await expect.poll(() => capturedUpdates(page)).toHaveLength(1);
    await page.waitForTimeout(700);
    let updates = await capturedUpdates(page);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("| Name |   | Status |");
    expect(updates[0].startsWith("Before table\n\n")).toBe(true);
    expect(updates[0].endsWith("\n\nAfter table")).toBe(true);
    expect(updates[0]).toContain("| ---- | - | ------ |");

    await clearCapturedUpdates(page);
    await clickHeaderMenuItem(page, "row", "Delete row");

    await expect.poll(() => documentText(page)).not.toContain("Ada");
    await expect.poll(() => capturedUpdates(page)).toHaveLength(1);
    await page.waitForTimeout(700);
    updates = await capturedUpdates(page);
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toContain("Ada");
    expect(updates[0]).toContain("| Name |   | Status |");
    expect(updates[0].startsWith("Before table\n\n")).toBe(true);
    expect(updates[0].endsWith("\n\nAfter table")).toBe(true);
  });

  test("pasting markdown table source renders a table widget", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await loadStandalone(page, PASTE_HOST_DOC);
    await setCaretAtText(page, "Done");

    await page.evaluate((text) => navigator.clipboard.writeText(text), `${PASTED_TABLE}\n\n`);
    await page.keyboard.press(`${platformModifier()}+V`);

    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    await expect(page.locator(".tbl-cell", { hasText: "1" })).toBeVisible();
    await expect.poll(() => documentText(page)).toContain(PASTED_TABLE);
    await expect(page.getByText("Done")).toBeVisible();
  });

  test("remote replacement while a cell is focused rebuilds the widget", async ({ page }) => {
    await loadWithBridge(page);
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);

    await page.locator(".tbl-cell", { hasText: "Ada" }).click();
    await expect(page.locator(".tbl-table-widget .cm-editor")).toHaveCount(1);

    await sendRemoteContent(page, REMOTE_TABLE_DOC);

    await expect.poll(() => documentText(page)).toContain("Grace");
    await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
    await expect(page.locator(".tbl-cell", { hasText: "Grace" })).toBeVisible();
    await expect(page.locator('.tbl-cell-view a.cm-md-link[data-href="https://example.com/grace"]')).toHaveText("Grace");
    await expect(page.locator(".tbl-cell", { hasText: "Ada" })).toHaveCount(0);
    await expect(page.locator(".tbl-table-widget .cm-editor")).toHaveCount(0);
  });
});
