import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  getDocumentSelection,
  lineWithText,
  placeCaretAfter,
  placeCaretInLine,
  setDocument,
} from "./markers.helpers.ts";

const LONG_BODY =
  "continues with enough plain text to wrap across several visual rows while keeping every continuation aligned with the first word beside its marker, and repeats the sentence so the browser must wrap it again at this viewport width";
const OUTSIDE_LINE = "Outside paragraph for the rendered state.";
const SCREENSHOT_DIR = process.env.TV_MARKDOWN_LIST_SCREENSHOT_DIR;
const SCREENSHOT_LABEL = process.env.TV_MARKDOWN_LIST_SCREENSHOT_LABEL;
const MAX_ALIGNMENT_ERROR_PX = 1;
const MAX_POSITION_DELTA_PX = 2;

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
  OUTSIDE_LINE,
].join("\n");

interface VisualRow {
  left: number;
  top: number;
  height: number;
  firstCharWidth: number;
  expectedHead: number;
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
  });

  test("keeps a multiline link inside the list body layout box", async ({ page }) => {
    await setDocument(
      page,
      [
        "- Before [linked label",
        "  continued](https://example.com) after the link.",
        "",
        OUTSIDE_LINE,
      ].join("\n"),
    );
    await placeCaretAfter(page, OUTSIDE_LINE);

    const markerLine = lineWithText(page, "Before");
    await expect(markerLine.locator(".cm-md-list-body a.cm-md-link")).toHaveCount(1);
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
        const current = rows.get(topKey);
        if (current && current.left <= rect.left) continue;
        rows.set(topKey, {
          left: rect.left,
          top: rect.top,
          height: rect.height,
          firstCharWidth: rect.width,
          expectedHead: view.posAtDOM(node, offset),
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
      const beforeStyle = getComputedStyle(line, "::before");
      markerLeft =
        lineRect.left +
        Number.parseFloat(lineStyle.borderLeftWidth) +
        Number.parseFloat(lineStyle.paddingLeft) +
        Number.parseFloat(beforeStyle.marginLeft);
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

async function captureScreenshots(page: Page): Promise<void> {
  if (!SCREENSHOT_DIR || !SCREENSHOT_LABEL) return;

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
}

async function screenshotLine(line: Locator, path: string): Promise<void> {
  await line.screenshot({ path, animations: "disabled" });
}
