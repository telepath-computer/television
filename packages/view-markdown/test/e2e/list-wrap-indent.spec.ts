import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  caretLineText,
  getDocumentSelection,
  lineWithText,
  placeCaretAfter,
  placeCaretAtColumn0,
  placeCaretAtPosition,
  placeCaretInLine,
  placeSelectionFromLineStart,
  placeSelectionFromListPrefixToLineStart,
  primaryCaretLeft,
  setDocument,
} from "./markers.helpers.ts";

const LONG_BODY =
  "continues with enough plain text to wrap across several visual rows while keeping every continuation aligned with the first word beside its marker, and repeats the sentence so the browser must wrap it again at this viewport width";
const OUTSIDE_LINE = "Outside paragraph for the rendered state.";
const SCREENSHOT_DIR = process.env.TV_MARKDOWN_LIST_SCREENSHOT_DIR;
const SCREENSHOT_LABEL = process.env.TV_MARKDOWN_LIST_SCREENSHOT_LABEL;
const MAX_ALIGNMENT_ERROR_PX = 1;
const MAX_POSITION_DELTA_PX = 1.5;
const MAX_ROW_HEIGHT_DELTA_PX = 0.5;
const NAVIGATION_LINE_ABOVE = "Navigation line above the wrapped list.";
const NAVIGATION_LINE_BELOW = "Navigation line below the wrapped list.";

interface ListCase {
  name: string;
  sourceLine: string;
  bodyText: string;
  prefixColumn: number;
  marker: "bullet" | "number" | "task";
  markerText: string;
}

const cases: readonly ListCase[] = [
  listCase("bullet", "- ", "Bullet item"),
  listCase("one-digit number", "1. ", "One digit item", "number", "1."),
  listCase("two-digit number", "10. ", "Two digit item", "number", "10."),
  listCase("task", "- [ ] ", "Task item", "task"),
  listCase("numbered task", "10. [ ] ", "Numbered task item", "task", "10."),
  listCase("nested bullet", "  - ", "Nested bullet item"),
  listCase("nested number", "  1. ", "Nested number item", "number", "1."),
  listCase("spaced bullet", "-   ", "Spaced bullet item"),
  {
    name: "hidden markup body",
    sourceLine: `- **Hidden markup item** ${LONG_BODY}`,
    bodyText: "Hidden markup item",
    // Keep the caret inside the list mark. Putting it after `- ` also
    // touches the adjacent strong-emphasis range and reveals `**`.
    prefixColumn: 1,
    marker: "bullet",
    markerText: "-",
  },
];

const quotedBullet = listCase("quoted bullet", "> - ", "Quoted bullet item");

interface NavigationCase {
  name: string;
  item: ListCase;
  initialMarkerState: "rendered" | "source";
}

const navigationCases: readonly NavigationCase[] = [
  {
    name: "numbered item",
    item: listCase("navigation number", "1. ", "Numbered navigation item", "number", "1."),
    initialMarkerState: "rendered",
  },
  {
    name: "rendered bullet",
    item: listCase("navigation rendered bullet", "- ", "Rendered bullet navigation item"),
    initialMarkerState: "rendered",
  },
  {
    name: "rendered task",
    item: listCase("navigation rendered task", "- [ ] ", "Rendered task navigation item", "task"),
    initialMarkerState: "rendered",
  },
  {
    name: "source-revealed bullet",
    item: listCase("navigation source bullet", "- ", "Source bullet navigation item"),
    initialMarkerState: "source",
  },
];

const documentSource = [
  cases[0].sourceLine,
  "",
  cases[1].sourceLine,
  "",
  cases[2].sourceLine,
  "",
  cases[3].sourceLine,
  "",
  cases[4].sourceLine,
  "",
  "- Nested bullet parent",
  cases[5].sourceLine,
  "",
  "1. Nested number parent",
  cases[6].sourceLine,
  "",
  cases[7].sourceLine,
  "",
  cases[8].sourceLine,
  "",
  OUTSIDE_LINE,
].join("\n");

interface VisualRow {
  left: number;
  top: number;
  height: number;
  firstCharWidth: number;
  expectedHead: number;
  lastHead: number;
}

interface ListLayout {
  markerLeft: number;
  bodyLeft: number;
  rows: VisualRow[];
}

test.describe("wrapped list indentation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").waitFor();
    await setDocument(page, documentSource);
    await expect(page.locator(".cm-md-list-item").first()).toBeAttached();
  });

  test("continuation rows hang under list text and remain clickable in rendered and source states", async ({ page }) => {
    await captureScreenshots(page);

    for (const item of cases) {
      await placeCaretAfter(page, OUTSIDE_LINE);
      const rendered = await listLayout(page, item);
      assertWrappedRows(item, "rendered", rendered);
      await clickFirstContinuation(page, item, "rendered", rendered);

      await placeCaretInLine(page, item.sourceLine, item.prefixColumn);
      const source = await listLayout(page, item);
      assertWrappedRows(item, "source", source);
      await clickFirstContinuation(page, item, "source", source);

      expect.soft(
        Math.abs(rendered.markerLeft - source.markerLeft),
        `${item.name}: marker must not move when its source is revealed`,
      ).toBeLessThanOrEqual(MAX_POSITION_DELTA_PX);
      expect.soft(
        Math.abs(rendered.bodyLeft - source.bodyLeft),
        `${item.name}: body must not jump when its source is revealed`,
      ).toBeLessThanOrEqual(MAX_POSITION_DELTA_PX);
    }

    await placeCaretAfter(page, OUTSIDE_LINE);
    const oneDigit = await listLayout(page, cases[1]);
    const twoDigit = await listLayout(page, cases[2]);
    expect.soft(
      twoDigit.bodyLeft - twoDigit.markerLeft,
      "a two-digit ordered marker must reserve its actual wider prefix",
    ).toBeGreaterThan(oneDigit.bodyLeft - oneDigit.markerLeft + 3);

    const bulletTask = await listLayout(page, cases[3]);
    const numberedTask = await listLayout(page, cases[4]);
    expect.soft(
      numberedTask.bodyLeft - numberedTask.markerLeft,
      "a numbered task must reserve its full marker and checkbox prefix",
    ).toBeGreaterThan(bulletTask.bodyLeft - bulletTask.markerLeft + 3);

    await placeCaretInLine(page, cases[7].sourceLine, cases[7].prefixColumn);
    const spacedBullet = await listLayout(page, cases[7]);
    const spacedPrefixRight = await sourcePrefixRight(page, cases[7]);
    expect.soft(
      spacedPrefixRight - spacedBullet.bodyLeft,
      "a source bullet followed by several spaces must not overlap its body text",
    ).toBeLessThanOrEqual(0.5);
  });

  test("Home, left-edge clicks, and ArrowDown preserve visual row two", async ({ page }) => {
    for (const navigationCase of navigationCases) {
      await test.step(`${navigationCase.name}: Home stays on row two`, async () => {
        const initial = await loadNavigationFixture(page, navigationCase);
        assertExactlyTwoRows(navigationCase, "initial Home layout", initial);

        const initialInsideSecondRow = positionInsideRow(initial.rows[1]);
        if (navigationCase.initialMarkerState === "source") {
          // Keep the prefix revealed with a selection whose anchor touches
          // the list mark and whose head sits inside visual row two. Home
          // moves from the head, so this exercises the source DOM rather than
          // silently switching back to the rendered bullet first.
          await placeSelectionFromLineStart(
            page,
            navigationCase.item.sourceLine,
            initialInsideSecondRow,
          );
          await assertInitialMarkerState(page, navigationCase);
        } else {
          await placeCaretAtPosition(page, initialInsideSecondRow);
        }
        const active = await listLayout(page, navigationCase.item);
        assertExactlyTwoRows(navigationCase, "active Home layout", active);
        const secondRow = active.rows[1];
        const insideSecondRow = positionInsideRow(secondRow);
        expect(
          insideSecondRow,
          `${navigationCase.name}: Home must begin inside visual row two`,
        ).toBeGreaterThan(secondRow.expectedHead);
        if (navigationCase.initialMarkerState === "source") {
          expect(
            (await getDocumentSelection(page)).head,
            `${navigationCase.name}: source selection head must remain on visual row two`,
          ).toBe(initialInsideSecondRow);
        } else {
          await placeCaretAtPosition(page, insideSecondRow);
        }

        await page.keyboard.press("Home");
        expect(
          (await getDocumentSelection(page)).head,
          `${navigationCase.name}: Home from row two must land at row two's start`,
        ).toBe(secondRow.expectedHead);
      });

      await test.step(`${navigationCase.name}: click left of row two stays on row two`, async () => {
        const layout = await loadNavigationFixture(page, navigationCase);
        assertExactlyTwoRows(navigationCase, "click layout", layout);
        const secondRow = layout.rows[1];

        await page.mouse.click(secondRow.left - 4, secondRow.top + secondRow.height / 2);
        expect(
          (await getDocumentSelection(page)).head,
          `${navigationCase.name}: clicking just left of row two must land at row two's start`,
        ).toBe(secondRow.expectedHead);
      });

      await test.step(`${navigationCase.name}: ArrowDown visits row two`, async () => {
        const initial = await loadNavigationFixture(page, navigationCase);
        assertExactlyTwoRows(navigationCase, "initial ArrowDown layout", initial);

        // Keep the source prefix revealed with the selection anchor while its
        // head establishes goal x=0 on the preceding line. ArrowDown moves
        // from the head, so the first vertical mapping uses the source DOM.
        if (navigationCase.initialMarkerState === "source") {
          await placeSelectionFromListPrefixToLineStart(
            page,
            navigationCase.item.sourceLine,
            NAVIGATION_LINE_ABOVE,
          );
          await assertInitialMarkerState(page, navigationCase);
        } else {
          await placeCaretAtColumn0(page, NAVIGATION_LINE_ABOVE);
        }
        const beforeArrowDown = await listLayout(page, navigationCase.item);
        assertExactlyTwoRows(navigationCase, "ArrowDown layout", beforeArrowDown);

        await page.keyboard.press("ArrowDown");
        expect(
          await caretLineText(page),
          `${navigationCase.name}: first ArrowDown must enter the list item`,
        ).toBe(navigationCase.item.sourceLine);

        const entered = await listLayout(page, navigationCase.item);
        assertExactlyTwoRows(navigationCase, "entered ArrowDown layout", entered);
        await page.keyboard.press("ArrowDown");
        expect(
          (await getDocumentSelection(page)).head,
          `${navigationCase.name}: second ArrowDown must land at row two's start`,
        ).toBe(entered.rows[1].expectedHead);

        await page.keyboard.press("ArrowDown");
        expect(
          await caretLineText(page),
          `${navigationCase.name}: third ArrowDown must leave the two-row item`,
        ).toBe(NAVIGATION_LINE_BELOW);
      });
    }
  });

  test("lays out revealed nesting source before its list marker", async ({ page }) => {
    const nestedItem = listCase("revealed nested bullet", "  - ", "Nested source item");
    await setDocument(
      page,
      [
        "- Parent item",
        nestedItem.sourceLine,
        "",
        OUTSIDE_LINE,
      ].join("\n"),
    );

    for (const headColumn of [0, 1]) {
      await placeCaretInLine(page, nestedItem.sourceLine, headColumn);
      const line = lineWithText(page, nestedItem.bodyText);
      await expect(line.locator(".cm-md-list-prefix")).toContainText("-");

      const marker = await textRect(page, nestedItem.bodyText, "-");
      const caretLeft = await primaryCaretLeft(page);
      expect(
        caretLeft,
        `${nestedItem.name}: caret at column ${headColumn} (${caretLeft}px) must be left of the marker (${marker.left}px)`,
      ).toBeLessThan(marker.left);
    }
  });

  test("keeps a revealed quote and list marker separate with aligned wraps", async ({ page }) => {
    await setDocument(page, [quotedBullet.sourceLine, "", OUTSIDE_LINE].join("\n"));
    await placeCaretInLine(page, quotedBullet.sourceLine, quotedBullet.prefixColumn - 1);

    const line = lineWithText(page, quotedBullet.bodyText);
    await expect(line.locator(".cm-md-mark").filter({ hasText: ">" })).toHaveCount(1);
    await expect(line.locator(".cm-md-list-prefix")).toContainText("-");

    const quote = await textRect(page, quotedBullet.bodyText, ">");
    const marker = await textRect(page, quotedBullet.bodyText, "-");
    expect(
      marker.left,
      `quoted source: marker at ${marker.left}px must not overlap quote ending at ${quote.right}px`,
    ).toBeGreaterThanOrEqual(quote.right);

    const layout = await listLayout(page, quotedBullet);
    assertWrappedRows(quotedBullet, "source", layout);
  });

  test("keeps a rendered task at its main and source task row heights", async ({ page }) => {
    const referenceLine = "Reference text row";
    const taskLine = "- [ ] Height comparison task";
    await setDocument(page, [referenceLine, taskLine, OUTSIDE_LINE].join("\n"));
    await placeCaretAfter(page, OUTSIDE_LINE);

    const referenceHeight = await lineHeight(page, referenceLine);
    const renderedHeight = await lineHeight(page, "Height comparison task");
    const mainHeight = await mainTaskLineHeight(page, referenceLine, "Height comparison task");

    await placeCaretInLine(page, taskLine, 3);
    await expect(lineWithText(page, "Height comparison task").locator(".cm-md-list-prefix"))
      .toContainText("[ ]");
    const sourceHeight = await lineHeight(page, "Height comparison task");

    if (SCREENSHOT_LABEL) {
      console.log(
        `[task-row-height:${SCREENSHOT_LABEL}] main=${mainHeight.toFixed(2)}px rendered=${renderedHeight.toFixed(2)}px source=${sourceHeight.toFixed(2)}px`,
      );
    }

    expect(
      Math.abs(renderedHeight - mainHeight),
      `rendered task row ${renderedHeight}px must match main's direct-checkbox row ${mainHeight}px`,
    ).toBeLessThanOrEqual(MAX_ROW_HEIGHT_DELTA_PX);
    expect(
      Math.abs(sourceHeight - referenceHeight),
      `source task row ${sourceHeight}px must match the normal row ${referenceHeight}px`,
    ).toBeLessThanOrEqual(MAX_ROW_HEIGHT_DELTA_PX);
  });
});

function listCase(
  name: string,
  prefix: string,
  bodyText: string,
  marker: ListCase["marker"] = "bullet",
  markerText = "-",
): ListCase {
  return {
    name,
    sourceLine: `${prefix}${bodyText} ${LONG_BODY}`,
    bodyText,
    prefixColumn: prefix.length,
    marker,
    markerText,
  };
}

function assertWrappedRows(item: ListCase, state: string, layout: ListLayout): void {
  expect.soft(
    layout.rows.length,
    `${item.name} (${state}): fixture must wrap onto continuation rows`,
  ).toBeGreaterThan(1);
  for (const [index, row] of layout.rows.slice(1).entries()) {
    expect.soft(
      Math.abs(row.left - layout.bodyLeft),
      `${item.name} (${state}) continuation ${index + 1} must start under the body text`,
    ).toBeLessThanOrEqual(MAX_ALIGNMENT_ERROR_PX);
  }
}

function assertExactlyTwoRows(
  navigationCase: NavigationCase,
  state: string,
  layout: ListLayout,
): void {
  expect(
    layout.rows,
    `${navigationCase.name} (${state}): navigation fixture must wrap to exactly two rows`,
  ).toHaveLength(2);
}

function positionInsideRow(row: VisualRow): number {
  return Math.min(row.expectedHead + 4, row.lastHead);
}

async function clickFirstContinuation(
  page: Page,
  item: ListCase,
  state: string,
  layout: ListLayout,
): Promise<void> {
  const row = layout.rows[1];
  expect.soft(row, `${item.name} (${state}): continuation row must exist`).toBeDefined();
  if (!row) return;

  await page.mouse.click(
    row.left + Math.min(1, row.firstCharWidth / 4),
    row.top + row.height / 2,
  );
  expect.soft(
    (await getDocumentSelection(page)).head,
    `${item.name} (${state}): clicking the continuation start must place the caret there`,
  ).toBe(row.expectedHead);
}

async function listLayout(page: Page, item: ListCase): Promise<ListLayout> {
  return page.evaluate(({ bodyNeedle, marker, markerNeedle }) => {
    type ViewWindow = Window & {
      __cmView?: {
        posAtDOM(node: Node, offset?: number): number;
      };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");

    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((element) => element.innerText.includes(bodyNeedle));
    if (!line) throw new Error(`List line not found: ${bodyNeedle}`);

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let bodyNode: Text | null = null;
    let bodyOffset = -1;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = (node as Text).data.indexOf(bodyNeedle);
      if (offset < 0) continue;
      bodyNode = node as Text;
      bodyOffset = offset;
      break;
    }
    if (!bodyNode) throw new Error(`Body text node not found: ${bodyNeedle}`);

    const rows = new Map<number, VisualRow>();
    let reachedBody = false;
    const bodyWalker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while ((node = bodyWalker.nextNode())) {
      if (node === bodyNode) reachedBody = true;
      if (!reachedBody) continue;
      const text = (node as Text).data;
      const start = node === bodyNode ? bodyOffset : 0;
      for (let offset = start; offset < text.length; offset += 1) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = Array.from(range.getClientRects()).find(
          (candidate) => candidate.width > 0 && candidate.height > 0,
        );
        if (!rect) continue;
        const topKey = Math.round(rect.top * 10) / 10;
        const expectedHead = view.posAtDOM(node, offset);
        const current = rows.get(topKey);
        if (current) current.lastHead = Math.max(current.lastHead, expectedHead);
        if (current && current.left <= rect.left) continue;
        rows.set(topKey, {
          left: rect.left,
          top: rect.top,
          height: rect.height,
          firstCharWidth: rect.width,
          expectedHead,
          lastHead: Math.max(current?.lastHead ?? expectedHead, expectedHead),
        });
      }
    }

    const visualRows = Array.from(rows.values()).sort((a, b) => a.top - b.top);
    const bodyLeft = visualRows[0]?.left;
    if (bodyLeft === undefined) throw new Error(`Body rows not found: ${bodyNeedle}`);

    let markerLeft: number;
    if (marker === "bullet" && line.classList.contains("cm-md-list-bullet")) {
      const lineRect = line.getBoundingClientRect();
      const lineStyle = getComputedStyle(line);
      const bulletStyle = getComputedStyle(line, "::before");
      markerLeft =
        lineRect.left +
        Number.parseFloat(lineStyle.borderLeftWidth) +
        Number.parseFloat(lineStyle.paddingLeft) +
        Number.parseFloat(bulletStyle.marginLeft);
    } else if (marker === "task") {
      const checkbox = line.querySelector<HTMLElement>("input.cm-md-task-checkbox");
      if (checkbox) {
        markerLeft = checkbox.getBoundingClientRect().left;
      } else {
        markerLeft = textLeft(line, markerNeedle);
      }
    } else {
      markerLeft = textLeft(line, markerNeedle);
    }

    return { markerLeft, bodyLeft, rows: visualRows };

    function textLeft(container: HTMLElement, needle: string): number {
      const textWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let textNode: Node | null;
      while ((textNode = textWalker.nextNode())) {
        const offset = (textNode as Text).data.indexOf(needle);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset + 1);
        return range.getBoundingClientRect().left;
      }
      throw new Error(`Marker text node not found: ${needle}`);
    }
  }, { bodyNeedle: item.bodyText, marker: item.marker, markerNeedle: item.markerText });
}

async function loadNavigationFixture(
  page: Page,
  navigationCase: NavigationCase,
): Promise<ListLayout> {
  await setDocument(
    page,
    [NAVIGATION_LINE_ABOVE, navigationCase.item.sourceLine, NAVIGATION_LINE_BELOW].join("\n"),
  );
  if (navigationCase.initialMarkerState === "source") {
    await placeCaretInLine(
      page,
      navigationCase.item.sourceLine,
      navigationCase.item.prefixColumn,
    );
  } else {
    await placeCaretAfter(page, NAVIGATION_LINE_BELOW);
  }
  await assertInitialMarkerState(page, navigationCase);
  return listLayout(page, navigationCase.item);
}

async function assertInitialMarkerState(
  page: Page,
  navigationCase: NavigationCase,
): Promise<void> {
  const line = lineWithText(page, navigationCase.item.bodyText);
  if (navigationCase.initialMarkerState === "source") {
    await expect(line).not.toHaveClass(/cm-md-list-bullet/);
    await expect(line.locator(".cm-md-list-prefix .cm-md-mark")).toContainText("-");
    return;
  }
  if (navigationCase.item.marker === "bullet") {
    await expect(line).toHaveClass(/cm-md-list-bullet/);
  } else if (navigationCase.item.marker === "task") {
    await expect(line.locator("input.cm-md-task-checkbox")).toBeAttached();
  }
}

async function sourcePrefixRight(page: Page, item: ListCase): Promise<number> {
  return page.evaluate((bodyNeedle) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((element) => element.innerText.includes(bodyNeedle));
    if (!line) throw new Error(`List line not found: ${bodyNeedle}`);
    const prefix = line.querySelector<HTMLElement>(".cm-md-list-prefix");
    if (!prefix) throw new Error(`List prefix not found: ${bodyNeedle}`);

    const range = document.createRange();
    range.selectNodeContents(prefix);
    const rightEdges = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.right);
    if (rightEdges.length === 0) throw new Error(`List prefix has no visible box: ${bodyNeedle}`);
    return Math.max(...rightEdges);
  }, item.bodyText);
}

async function captureScreenshots(page: Page): Promise<void> {
  if (!SCREENSHOT_DIR || !SCREENSHOT_LABEL) return;

  await placeCaretAfter(page, OUTSIDE_LINE);
  await screenshotLine(
    lineWithText(page, cases[0].bodyText),
    `${SCREENSHOT_DIR}/${SCREENSHOT_LABEL}-bullet-rendered.png`,
  );

  await placeCaretInLine(page, cases[0].sourceLine, cases[0].prefixColumn);
  await screenshotLine(
    lineWithText(page, cases[0].bodyText),
    `${SCREENSHOT_DIR}/${SCREENSHOT_LABEL}-bulleted.png`,
  );

  await placeCaretInLine(page, cases[2].sourceLine, cases[2].prefixColumn);
  await screenshotLine(
    lineWithText(page, cases[2].bodyText),
    `${SCREENSHOT_DIR}/${SCREENSHOT_LABEL}-numbered.png`,
  );

  await placeCaretAfter(page, OUTSIDE_LINE);
  await screenshotLine(
    lineWithText(page, cases[3].bodyText),
    `${SCREENSHOT_DIR}/${SCREENSHOT_LABEL}-task-rendered.png`,
  );
  await screenshotLine(
    lineWithText(page, cases[4].bodyText),
    `${SCREENSHOT_DIR}/${SCREENSHOT_LABEL}-numbered-task-rendered.png`,
  );

  const plainGap = await renderedTaskGap(page, cases[3]);
  const numberedGap = await renderedTaskGap(page, cases[4]);
  console.log(
    `[rendered-task-gap:${SCREENSHOT_LABEL}] plain=${plainGap.toFixed(2)}px numbered=${numberedGap.toFixed(2)}px`,
  );
}

async function screenshotLine(line: Locator, path: string): Promise<void> {
  await line.screenshot({ path, animations: "disabled" });
}

async function renderedTaskGap(page: Page, item: ListCase): Promise<number> {
  return page.evaluate((bodyNeedle) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((element) => element.innerText.includes(bodyNeedle));
    if (!line) throw new Error(`Task line not found: ${bodyNeedle}`);
    const checkbox = line.querySelector<HTMLElement>("input.cm-md-task-checkbox");
    if (!checkbox) throw new Error(`Task checkbox not found: ${bodyNeedle}`);

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = (node as Text).data.indexOf(bodyNeedle);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().left - checkbox.getBoundingClientRect().right;
    }
    throw new Error(`Task body text not found: ${bodyNeedle}`);
  }, item.bodyText);
}

async function textRect(
  page: Page,
  lineNeedle: string,
  textNeedle: string,
): Promise<{ left: number; right: number }> {
  return page.evaluate(({ lineNeedle, textNeedle }) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((element) => element.innerText.includes(lineNeedle));
    if (!line) throw new Error(`Line not found: ${lineNeedle}`);

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = (node as Text).data.indexOf(textNeedle);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + textNeedle.length);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }
    throw new Error(`Text not found on line: ${textNeedle}`);
  }, { lineNeedle, textNeedle });
}

async function lineHeight(page: Page, lineNeedle: string): Promise<number> {
  return lineWithText(page, lineNeedle).evaluate((line) => line.getBoundingClientRect().height);
}

async function mainTaskLineHeight(
  page: Page,
  referenceNeedle: string,
  taskNeedle: string,
): Promise<number> {
  return page.evaluate(({ referenceNeedle, taskNeedle }) => {
    const lines = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"));
    const reference = lines.find((line) => line.innerText.includes(referenceNeedle));
    const task = lines.find((line) => line.innerText.includes(taskNeedle));
    const checkbox = task?.querySelector<HTMLInputElement>("input.cm-md-task-checkbox");
    if (!reference || !checkbox) throw new Error("Task height fixture not found");

    // Main placed the widget directly in the line. A detached clone in the
    // reference line reproduces that inline formatting without changing the
    // editor document or relying on a platform-specific pixel constant.
    const clone = checkbox.cloneNode() as HTMLInputElement;
    clone.style.margin = "0 0.4em 0 0";
    clone.style.width = "auto";
    reference.prepend(clone);
    const height = reference.getBoundingClientRect().height;
    clone.remove();
    return height;
  }, { referenceNeedle, taskNeedle });
}
