import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

interface CmViewHandle {
  state: { doc: { length: number; toString(): string } };
  dispatch(spec: unknown): void;
  focus(): void;
}

interface HostWindow extends Window {
  __cmView?: CmViewHandle;
}

const REVIEW_DOC = [
  "# Focused heading",
  "",
  "Rendered paragraph with **bold**, *italic*, `inline code`, an [editor link](https://example.com), and #theme-tag.",
  "",
  "| Name | Status | Notes |",
  "| ---- | ------ | ----- |",
  "| Ada | Ready | Selected and editing states |",
  "| Grace | Reviewing | Hover and menu states |",
  "",
  "- Unordered item",
  "1. Ordered item",
  "- [ ] Open task",
  "- [x] Completed task",
  "",
  "> Quoted text with a structural border.",
  "",
  "```ts",
  "const appearance = 'token-driven';",
  "```",
  "",
  "---",
  "",
  "Plain text after the rule.",
].join("\n");

const OUTPUT = process.env.TV_MD_EDITOR_VISUAL_REVIEW_DIR;
const VIEWPORT = { width: 1280, height: 1100 } as const;

const PROFILES = [
  { name: "light", colorScheme: "light" as const, theme: "" },
  { name: "dark", colorScheme: "dark" as const, theme: "" },
  {
    name: "light-primary-theme",
    colorScheme: "dark" as const,
    theme: `:root {
      --color-surface: rgb(31, 25, 43);
      --color-surface-muted: rgb(52, 43, 68);
      --color-text: rgb(246, 241, 252);
      --color-text-muted: rgb(190, 174, 207);
      --color-border: rgb(132, 111, 153);
      --color-primary: rgb(248, 222, 104);
      --color-link: rgb(220, 165, 248);
      --option-background-highlighted: rgb(77, 61, 96);
      --checkbox-color: rgb(193, 111, 231);
    }`,
  },
] as const;

async function setDocument(page: Page): Promise<void> {
  await page.evaluate((doc) => {
    const view = (window as HostWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    view.focus();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
  }, REVIEW_DOC);
  await expect(page.locator(".tbl-table-widget")).toHaveCount(1);
}

async function focusInlineSource(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = (window as HostWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    const start = view.state.doc.toString().indexOf("inline code");
    view.focus();
    view.dispatch({ selection: { anchor: start + 3 } });
  });
  await expect(page.locator(".cm-md-mark").filter({ hasText: "`" })).toHaveCount(2);
}

async function capture(page: Page, profile: string, state: string): Promise<void> {
  if (!OUTPUT) throw new Error("TV_MD_EDITOR_VISUAL_REVIEW_DIR is required");
  await page.screenshot({
    path: path.join(OUTPUT, `${profile}-${state}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function styles(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const css = (selector: string, pseudo?: string): CSSStyleDeclaration | null => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element, pseudo) : null;
    };
    const pick = (style: CSSStyleDeclaration | null) =>
      style
        ? {
            color: style.color,
            background: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            border: style.borderColor,
            outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
            boxShadow: style.boxShadow,
            caret: style.caretColor,
            accent: style.accentColor,
            textDecoration: style.textDecorationLine,
          }
        : null;
    return {
      appearance: document.documentElement.dataset.theme,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      body: pick(css("body")),
      editor: pick(css("#editor > .cm-editor")),
      content: pick(css("#editor .cm-content")),
      cursor: pick(css("#editor .cm-cursor")),
      sourceMarker: pick(css(".cm-md-mark")),
      bullet: pick(css(".cm-md-list-bullet", "::before")),
      quote: pick(css(".cm-md-blockquote-line")),
      inlineCode: pick(css(".cm-md-inline-code")),
      fencedCode: pick(css(".cm-md-fenced-line")),
      tag: pick(css(".cm-md-tag")),
      rule: pick(css(".cm-md-hr")),
      link: pick(css("a.cm-md-link")),
      task: pick(css("input.cm-md-task-checkbox")),
      checkedTask: pick(css("input.cm-md-task-checkbox:checked")),
      tableHeader: pick(css(".tbl-header-cell")),
      tableCell: pick(css(".tbl-cell")),
      hoveredTableHandle: pick(css('.tbl-handle[data-type="header"]:hover')),
      hoveredTableHandleOverlay: pick(
        css('.tbl-handle[data-type="header"]:hover', "::after"),
      ),
      selectedTableCell: pick(css(".tbl-cell[data-selected]")),
      selectedTableCellOutline: pick(css(".tbl-cell[data-selected]", "::after")),
      tableCellEditor: pick(css(".tbl-cell-editor")),
      tableCellEditorContent: pick(css(".tbl-cell-editor .cm-content")),
      activeTableHandle: pick(css('.tbl-handle[data-type="header"][data-active]')),
      activeTableHandleOverlay: pick(
        css('.tbl-handle[data-type="header"][data-active]', "::after"),
      ),
      tooltip: pick(css(".cm-tooltip.tbl-menu-tooltip")),
      menu: pick(css(".tbl-menu")),
      hoveredMenuItem: pick(css(".tbl-menu-item:hover")),
      hoveredMenuItemOverlay: pick(css(".tbl-menu-item:hover", "::after")),
    };
  });
}

test.skip(!OUTPUT, "set TV_MD_EDITOR_VISUAL_REVIEW_DIR to generate review evidence");

test("captures the Markdown editor color-state review poses", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("visual review requires baseURL");
  if (!OUTPUT || !path.isAbsolute(OUTPUT)) {
    throw new Error("TV_MD_EDITOR_VISUAL_REVIEW_DIR must be an absolute path");
  }
  mkdirSync(OUTPUT, { recursive: true });
  const evidence: Record<string, unknown> = {};

  for (const profile of PROFILES) {
    const context = await browser.newContext({
      baseURL,
      colorScheme: profile.colorScheme,
      viewport: VIEWPORT,
    });
    const page = await context.newPage();
    await page.route("**/theme/theme.css*", (route) =>
      route.fulfill({
        contentType: "text/css",
        body: profile.theme,
      }),
    );
    await page.goto("/");
    await page.locator(".cm-content").waitFor();
    await setDocument(page);
    await focusInlineSource(page);
    await capture(page, profile.name, "overview-source-focus");
    const overview = await styles(page);

    // The production editor fills the viewport, so its unchanged outside
    // outline is clipped at the screenshot edge. Add only review-stage outer
    // space to make that same outline visible in a dedicated capture.
    const focusInset = await page.addStyleTag({ content: "body { padding: 12px; }" });
    await capture(page, profile.name, "focus-outline-inset");
    await focusInset.evaluate((element) => element.parentNode?.removeChild(element));

    const hoverHandle = page
      .locator('.tbl-handle[data-type="header"][data-location="col"]')
      .first();
    await hoverHandle.hover({ force: true });
    await capture(page, profile.name, "table-hover");
    const tableHover = await styles(page);

    const cell = page.locator(".tbl-cell", { hasText: "Ada" }).first();
    await cell.click();
    await page.keyboard.press("End");
    await expect(cell).toHaveAttribute("data-selected");
    await expect(page.locator(".tbl-cell-editor")).toHaveCount(1);
    await capture(page, profile.name, "table-selected-editing");
    const tableSelectedEditing = await styles(page);

    const menuHandle = page
      .locator('.tbl-handle[data-type="header"][data-location="col"]')
      .first();
    await menuHandle.click({ force: true });
    await expect(menuHandle).toHaveAttribute("data-active");
    await expect(page.locator(".tbl-menu")).toBeVisible();
    await page.locator(".tbl-menu-item").first().hover();
    await capture(page, profile.name, "table-active-menu");
    const tableActiveMenu = await styles(page);

    evidence[profile.name] = {
      overview,
      tableHover,
      tableSelectedEditing,
      tableActiveMenu,
    };
    await context.close();
  }

  writeFileSync(
    path.join(OUTPUT, "computed-styles.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
});
