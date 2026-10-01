import type { Locator, Page } from "@playwright/test";

// Disappearing-markers Playwright suite.
//
// The test runner publishes the Vite service URL consumed by
// playwright.config.ts. The seed fixture (fixtures/seed.md, mounted as the
// editor's initial document) is the canonical doc these tests drive.
//
// Strategy: locate `.cm-line` elements by their text content, click on visible
// plain-text within them to position the caret, and assert the
// `cm-md-hidden` class on inner marker spans. Hidden marker spans are 1px
// wide — never a click target; only a class-state assertion target.

// Iter 03: hidden markers use Decoration.replace (no DOM, no class).
// Revealed markers carry `.cm-md-mark`. Most existing tests located
// the legacy `.cm-md-hidden` to assert state — they're updated to
// locate `.cm-md-mark` with inverted counts (caret-on → markers
// present as mark spans; caret-off → 0 mark spans because the chars
// are gone from the DOM entirely).
export const MARK = "cm-md-mark";
export const PLAIN_BODY_LINE = "A second paragraph";
export const MIN_RENDERED_NESTING_DELTA_PX = 14;

export function lineWithText(page: Page, text: string): Locator {
  return page.locator(".cm-line", { hasText: text }).first();
}

export async function clickAwayFromMarkers(page: Page): Promise<void> {
  // PLAIN_BODY_LINE is plain prose with no inline or block markers.
  // Caret here keeps every marker in the document hidden.
  await lineWithText(page, PLAIN_BODY_LINE).click();
}

/**
 * Place the editor's selection at the document position right after the
 * given anchor substring. Used for ranges whose body text isn't wrapped
 * in a styled element (e.g. inline-code body, where lang-markdown's
 * `tags.monospace` has no rule in our `markdownHighlight`), making
 * Playwright's text-based locators unable to identify a click target.
 *
 * Resolves the position via the EditorView exposed at `window.__cmView`
 * by `src/main.ts`.
 */
export async function placeCaretAfter(page: Page, anchor: string): Promise<void> {
  await page.evaluate((needle) => {
    type ViewWindow = Window & {
      __cmView?: { state: { doc: { toString(): string } }; dispatch: (spec: unknown) => void; focus: () => void };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    const doc = view.state.doc.toString();
    const start = doc.indexOf(needle);
    if (start < 0) throw new Error(`Anchor not found in doc: ${needle}`);
    const pos = start + needle.length;
    view.focus();
    view.dispatch({ selection: { anchor: pos } });
  }, anchor);
}

/**
 * Place caret at column 0 of the line whose source text matches
 * `lineText`. Lets tests establish a known goal-X-of-0 before pressing
 * ArrowDown / ArrowUp.
 */
export async function placeCaretAtColumn0(page: Page, lineText: string): Promise<void> {
  await page.evaluate((needle) => {
    type V = Window & {
      __cmView?: {
        state: { doc: { lines: number; line(n: number): { from: number; text: string } } };
        dispatch: (s: unknown) => void;
        focus: () => void;
      };
    };
    const v = (window as V).__cmView!;
    for (let i = 1; i <= v.state.doc.lines; i += 1) {
      const line = v.state.doc.line(i);
      if (line.text === needle) {
        v.focus();
        v.dispatch({ selection: { anchor: line.from } });
        return;
      }
    }
    throw new Error(`Line not found: ${needle}`);
  }, lineText);
}

export async function placeCaretInLine(page: Page, lineText: string, column: number): Promise<void> {
  await page.evaluate(({ lineText: needle, column: offset }) => {
    type V = Window & {
      __cmView?: {
        state: { doc: { lines: number; line(n: number): { from: number; text: string } } };
        dispatch: (s: unknown) => void;
        focus: () => void;
      };
    };
    const view = (window as V).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    for (let i = 1; i <= view.state.doc.lines; i += 1) {
      const line = view.state.doc.line(i);
      if (line.text === needle) {
        view.focus();
        view.dispatch({ selection: { anchor: line.from + offset } });
        return;
      }
    }
    throw new Error(`Line not found: ${needle}`);
  }, { lineText, column });
}

/** Read the line text the caret currently sits on. */
export async function caretLineText(page: Page): Promise<string> {
  return page.evaluate(() => {
    type ViewWindow = Window & {
      __cmView?: {
        state: {
          selection: { main: { head: number } };
          doc: { lineAt(pos: number): { text: string } };
        };
      };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    const head = view.state.selection.main.head;
    return view.state.doc.lineAt(head).text;
  });
}

export async function setDocument(page: Page, doc: string): Promise<void> {
  await page.evaluate((nextDoc) => {
    type ViewWindow = Window & {
      __cmView?: {
        state: { doc: { length: number } };
        dispatch: (spec: unknown) => void;
        focus: () => void;
      };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    view.focus();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
      selection: { anchor: 0 },
    });
  }, doc);
  await page.waitForTimeout(50);
}

export async function getDocument(page: Page): Promise<string> {
  return page.evaluate(() => {
    type ViewWindow = Window & {
      __cmView?: { state: { doc: { toString(): string } } };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    return view.state.doc.toString();
  });
}

export async function unorderedBulletMetrics(page: Page, text: string): Promise<{
  bulletLeft: number;
  textLeft: number;
  gap: number;
}> {
  return page.evaluate((needle) => {
    const lines = Array.from(
      document.querySelectorAll<HTMLElement>(".cm-line.cm-md-list-bullet"),
    );
    const line = lines.find((el) => el.innerText.includes(needle));
    if (!line) throw new Error(`Rendered bullet line not found: ${needle}`);

    const lineRect = line.getBoundingClientRect();
    const lineStyle = getComputedStyle(line);
    const beforeStyle = getComputedStyle(line, "::before");
    const contentLeft =
      lineRect.left +
      Number.parseFloat(lineStyle.borderLeftWidth) +
      Number.parseFloat(lineStyle.paddingLeft);
    const bulletLeft = contentLeft + Number.parseFloat(beforeStyle.marginLeft);

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const data = (node as Text).data;
      const index = data.indexOf(needle);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const textLeft = range.getBoundingClientRect().left;
      return { bulletLeft, textLeft, gap: textLeft - bulletLeft };
    }
    throw new Error(`Text node not found: ${needle}`);
  }, text);
}

export async function visibleTextMetrics(page: Page, bodyText: string, markerText: string): Promise<{
  markerLeft: number;
  bodyLeft: number;
}> {
  return page.evaluate(({ bodyText: bodyNeedle, markerText: markerNeedle }) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((el) => el.innerText.includes(bodyNeedle));
    if (!line) throw new Error(`Line not found: ${bodyNeedle}`);
    const targetLine: Node = line;

    function textLeft(needle: string): number {
      const walker = document.createTreeWalker(targetLine, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const data = (node as Text).data;
        const index = data.indexOf(needle);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect().left;
      }
      throw new Error(`Text node not found: ${needle}`);
    }

    return {
      markerLeft: textLeft(markerNeedle),
      bodyLeft: textLeft(bodyNeedle),
    };
  }, { bodyText, markerText });
}

export async function taskCheckboxMetrics(page: Page, bodyText: string): Promise<{
  checkboxLeft: number;
  bodyLeft: number;
}> {
  return page.evaluate((bodyNeedle) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
      .find((el) => el.innerText.includes(bodyNeedle));
    if (!line) throw new Error(`Line not found: ${bodyNeedle}`);
    const checkbox = line.querySelector<HTMLElement>("input.cm-md-task-checkbox");
    if (!checkbox) throw new Error(`Checkbox not found: ${bodyNeedle}`);

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const data = (node as Text).data;
      const index = data.indexOf(bodyNeedle);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return {
        checkboxLeft: checkbox.getBoundingClientRect().left,
        bodyLeft: range.getBoundingClientRect().left,
      };
    }
    throw new Error(`Text node not found: ${bodyNeedle}`);
  }, bodyText);
}

export async function wrappedListLineMetrics(page: Page, text: string): Promise<{
  bodyLeft: number | null;
  visualLines: number[];
} | null> {
  return page.evaluate((needle) => {
    const line = Array.from(document.querySelectorAll(".cm-line"))
      .find((el) => (el as HTMLElement).innerText.includes(needle)) as HTMLElement | undefined;
    if (!line) return null;
    const range = document.createRange();
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let bodyLeft: number | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node as Text).data ?? "";
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        range.setStart(node, idx);
        range.setEnd(node, idx + 1);
        bodyLeft = range.getBoundingClientRect().left;
        break;
      }
    }
    range.selectNodeContents(line);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
    const byTop = new Map<number, number>();
    for (const rect of rects) {
      const cur = byTop.get(rect.top);
      if (cur === undefined || rect.left < cur) byTop.set(rect.top, rect.left);
    }
    const visualLines = Array.from(byTop.entries())
      .sort(([a], [b]) => a - b)
      .map(([, left]) => left);
    return { bodyLeft, visualLines };
  }, text);
}

export async function getDocumentSelection(page: Page): Promise<{
  doc: string;
  anchor: number;
  head: number;
  from: number;
  to: number;
  selectedText: string;
}> {
  return page.evaluate(() => {
    type ViewWindow = Window & {
      __cmView?: {
        state: {
          doc: { toString(): string };
          selection: { main: { anchor: number; head: number } };
        };
      };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    const doc = view.state.doc.toString();
    const { anchor, head } = view.state.selection.main;
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    return { doc, anchor, head, from, to, selectedText: doc.slice(from, to) };
  });
}

export async function pressMod(page: Page, key: string): Promise<void> {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+${key}`);
}

export async function fontWeightForText(page: Page, text: string): Promise<number> {
  return page.evaluate((needle) => {
    const line = Array.from(document.querySelectorAll(".cm-line")).find((el) =>
      (el as HTMLElement).innerText.includes(needle),
    );
    if (!line) throw new Error(`Line not found: ${needle}`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const data = (node as Text).data;
      if (!data.includes(needle)) continue;
      const element = node.parentElement ?? (line as HTMLElement);
      const weight = window.getComputedStyle(element).fontWeight;
      return Number.parseInt(weight, 10);
    }
    throw new Error(`Text node not found: ${needle}`);
  }, text);
}

export async function selectSourceRange(
  page: Page,
  anchorNeedle: string,
  headNeedle: string,
): Promise<void> {
  await page.evaluate(({ anchorNeedle: anchor, headNeedle: head }) => {
    type ViewWindow = Window & {
      __cmView?: {
        state: { doc: { toString(): string } };
        dispatch: (spec: unknown) => void;
        focus: () => void;
      };
    };
    const view = (window as ViewWindow).__cmView;
    if (!view) throw new Error("EditorView not exposed on window.__cmView");
    const doc = view.state.doc.toString();
    const anchorPos = doc.indexOf(anchor);
    const headStart = doc.indexOf(head);
    if (anchorPos < 0) throw new Error(`Anchor not found in doc: ${anchor}`);
    if (headStart < 0) throw new Error(`Head not found in doc: ${head}`);
    view.focus();
    view.dispatch({
      selection: { anchor: anchorPos, head: headStart + head.length },
    });
  }, { anchorNeedle, headNeedle });
}
