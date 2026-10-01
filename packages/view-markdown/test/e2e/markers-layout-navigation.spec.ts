import { expect, test } from "@playwright/test";
import {
  MARK,
  lineWithText,
  clickAwayFromMarkers,
  placeCaretAfter,
  placeCaretAtColumn0,
  caretLineText,
} from "./markers.helpers.ts";

test.describe("disappearing markers", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").waitFor();
    // Wait for the parser to populate the syntax tree — line decorations
    // (`cm-md-list-item`) only land once lang-markdown has parsed the
    // doc and the plugin has computed its DecorationSet.
    await expect(page.locator(".cm-md-list-item").first()).toBeAttached();
  });

  test("caret in body of fenced code reveals the ``` markers (whole-block proximity)", async ({ page }) => {
    // ``` markers should reveal whenever the caret is anywhere inside
    // the fenced block, not just on the same line as the marker.
    // Caret on a body line ("function hello") should reveal both the
    // opening AND closing ``` lines.
    await page.locator(".cm-md-fenced-line").first().waitFor();
    const fenceLines = page.locator(".cm-md-fenced-line");

    await clickAwayFromMarkers(page);
    // Caret away → both fence ``` markers are hidden via Decoration.replace
    // (no DOM, no `.cm-md-mark` spans).
    const fenceMarks = fenceLines.locator(".cm-md-mark");
    await expect(fenceMarks).toHaveCount(0);

    // Caret in body of fenced code → both ``` markers reveal as
    // mark spans.
    await placeCaretAfter(page, "function hello");
    await expect(fenceLines.locator(".cm-md-mark")).toHaveCount(2);
  });

  test("unclosed fenced code keeps the lone ``` source visible (no empty styled line)", async ({ page }) => {
    // For an unclosed fence (just ``` on one line, no closer), the
    // ``` source must stay visible regardless of caret position —
    // otherwise the line is just an empty styled block with no hint
    // of what it is.
    await page.locator(".cm-md-fenced-line").first().waitFor();

    // Strip the closing ``` so the fence is unclosed.
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string } };
          dispatch: (s: unknown) => void;
        };
      };
      const view = (window as ViewWindow).__cmView!;
      const doc = view.state.doc.toString();
      const closeIdx = doc.indexOf("}\n```\n");
      if (closeIdx < 0) throw new Error("expected closing fence");
      view.dispatch({
        changes: { from: closeIdx + 1, to: closeIdx + 5, insert: "" },
      });
    });
    await page.waitForTimeout(50);

    await clickAwayFromMarkers(page);

    // The lone opening ``` line must keep the source visible — it
    // shows as a `.cm-md-mark` span (caret-off doesn't hide it
    // because hiding would leave the line empty).
    const fenceLine = page.locator(".cm-md-fenced-line").first();
    await expect(fenceLine.locator(".cm-md-mark")).toHaveCount(1);
  });

  test("unclosed fenced code only styles the opening fence line", async ({ page }) => {
    // Source: a single ``` with no closing ``` — lezer treats the
    // FencedCode node as extending to end of doc, but visually only
    // the line containing the actual fence marker should be styled
    // as code. Lines beyond it should look normal.
    await page.locator(".cm-md-fenced-line").first().waitFor();

    // Strip the closing ``` (last 4 chars of the original fence range
    // including its trailing newline) so the fence is now unclosed.
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string; length: number } };
          dispatch: (s: unknown) => void;
        };
      };
      const view = (window as ViewWindow).__cmView!;
      const doc = view.state.doc.toString();
      // Find the *closing* fence — last `\`\`\`` in the doc that's on
      // its own line preceded by `}`.
      const closeIdx = doc.indexOf("}\n```\n");
      if (closeIdx < 0) throw new Error("expected closing fence sequence");
      // Delete from the `\n` before the closing ``` through the `\n`
      // after it, leaving the body content intact.
      view.dispatch({
        changes: { from: closeIdx + 1, to: closeIdx + 5, insert: "" },
      });
    });

    // Wait for parser to settle.
    await page.waitForTimeout(50);

    // Only the opening ``` line gets `cm-md-fenced-line`. The body
    // lines that used to be inside the (now-unclosed) fence should
    // NOT carry the class.
    const fencedLines = page.locator(".cm-md-fenced-line");
    await expect(fencedLines).toHaveCount(1);

    // The "## Horizontal rule" heading later in the doc must not
    // accidentally get fenced-line styling.
    const heading = lineWithText(page, "## Horizontal rule");
    await expect(heading).not.toHaveClass(/cm-md-fenced-line/);
  });

  test("blockquote wrapped lines align with the body when `>` is rendered (caret-off)", async ({ page }) => {
    // Caret-off state: source `>` is hidden via `cm-md-hidden` (zero
    // width). Wrap continuation must still align with body of line 1
    // — otherwise wrap appears further to the right of body.
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string } };
          dispatch: (s: unknown) => void;
        };
      };
      const view = (window as ViewWindow).__cmView!;
      const doc = view.state.doc.toString();
      const idx = doc.indexOf("This is a block quote.");
      if (idx < 0) throw new Error("expected blockquote opener");
      view.dispatch({
        changes: {
          from: idx,
          to: idx + "This is a block quote.".length,
          insert:
            "This is a block quote with an unusually long body so that it wraps across multiple visual lines and we can verify the wrap continuation aligns with the body content rather than with the leading marker.",
        },
      });
    });
    await page.waitForTimeout(50);
    await clickAwayFromMarkers(page);

    const result = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll(".cm-line"));
      const line = lines.find((el) =>
        (el as HTMLElement).innerText.includes("This is a block quote"),
      ) as HTMLElement | undefined;
      if (!line) return null;
      const range = document.createRange();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let bodyLeft: number | null = null;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node as Text).data ?? "";
        const idx = text.indexOf("This");
        if (idx >= 0) {
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          bodyLeft = range.getBoundingClientRect().left;
          break;
        }
      }
      range.selectNodeContents(line);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const byTop = new Map<number, number>();
      for (const r of rects) {
        const cur = byTop.get(r.top);
        if (cur === undefined || r.left < cur) byTop.set(r.top, r.left);
      }
      const visualLines = Array.from(byTop.entries())
        .sort(([a], [b]) => a - b)
        .map(([, left]) => left);
      return { bodyLeft, visualLines };
    });

    expect(result).not.toBeNull();
    expect(result!.visualLines.length).toBeGreaterThan(1);
    const wrapLeft = result!.visualLines[1];
    expect(Math.abs(wrapLeft - (result!.bodyLeft ?? 0))).toBeLessThan(5);
  });

  test("blockquote wrapped lines align with the marker column (line 1's left edge)", async ({ page }) => {
    // Iter 03: hanging-indent dropped — wrap continuation aligns with
    // line 1's left edge (the marker column / padding edge), not with
    // the body of line 1. When caret is on, the visible `> ` sits at
    // padding; body of line 1 is at padding + 2chars; wrap is at
    // padding. Test asserts wrap == line 1's leftmost X.

    // Inject a longer blockquote body so the line definitely wraps.
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string } };
          dispatch: (s: unknown) => void;
        };
      };
      const view = (window as ViewWindow).__cmView!;
      const doc = view.state.doc.toString();
      const idx = doc.indexOf("This is a block quote.");
      if (idx < 0) throw new Error("expected blockquote opener");
      view.dispatch({
        changes: {
          from: idx,
          to: idx + "This is a block quote.".length,
          insert:
            "This is a block quote with an unusually long body so that it wraps across multiple visual lines and we can verify the wrap continuation aligns with the body content rather than with the leading marker.",
        },
      });
    });
    await page.waitForTimeout(50);
    await placeCaretAfter(page, "This is a block quote");

    const result = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll(".cm-line"));
      const line = lines.find((el) =>
        (el as HTMLElement).innerText.includes("This is a block quote"),
      ) as HTMLElement | undefined;
      if (!line) return null;

      // X of "T" — the first body char after `> `.
      const range = document.createRange();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let bodyLeft: number | null = null;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node as Text).data ?? "";
        const idx = text.indexOf("This");
        if (idx >= 0) {
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          bodyLeft = range.getBoundingClientRect().left;
          break;
        }
      }

      // Group line rects by top; leftmost non-zero rect per group is
      // each visual line's start.
      range.selectNodeContents(line);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const byTop = new Map<number, number>();
      for (const r of rects) {
        const cur = byTop.get(r.top);
        if (cur === undefined || r.left < cur) byTop.set(r.top, r.left);
      }
      const visualLines = Array.from(byTop.entries())
        .sort(([a], [b]) => a - b)
        .map(([, left]) => left);
      return { bodyLeft, visualLines };
    });

    expect(result).not.toBeNull();
    expect(result!.visualLines.length).toBeGreaterThan(1);
    const firstLineLeft = result!.visualLines[0];
    const wrapLeft = result!.visualLines[1];
    // Tolerant threshold — `cm-md-mark` uses a slightly smaller mono
    // font, so `getClientRects` may report the marker glyph and the
    // body glyph at marginally different X positions even though
    // they share the same line-content edge.
    expect(Math.abs(wrapLeft - firstLineLeft)).toBeLessThan(20);
  });

  test("unordered list wrapped lines align with the body column", async ({ page }) => {
    // Inject a long enough item to force wrap. Caret stays away from
    // the marker so the source `- ` is replaced by the rendered bullet;
    // this is the common reading state where the hanging indent applies.
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string } };
          dispatch: (s: unknown) => void;
        };
      };
      const view = (window as ViewWindow).__cmView!;
      const doc = view.state.doc.toString();
      const idx = doc.indexOf("- Unordered item one");
      if (idx < 0) throw new Error("expected unordered item one");
      view.dispatch({
        changes: {
          from: idx,
          to: idx + "- Unordered item one".length,
          insert:
            "- Unordered item one with a really long body that should wrap across multiple visual lines so we can test that the wrap continuation aligns with the body content rather than with the bullet marker — repeated again to make sure even with a wider viewport and a narrower proportional font this line is forced to wrap onto a second visual line. And again, doubled, to be defensive against typography changes that narrow the average glyph width and might otherwise let this fit on one line. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        },
      });
    });
    await page.waitForTimeout(50);
    await clickAwayFromMarkers(page);

    const result = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll(".cm-line"));
      const line = lines.find((el) =>
        (el as HTMLElement).innerText.includes("Unordered item one"),
      ) as HTMLElement | undefined;
      if (!line) return null;
      const range = document.createRange();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let bodyLeft: number | null = null;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node as Text).data ?? "";
        const idx = text.indexOf("Unordered");
        if (idx >= 0) {
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          bodyLeft = range.getBoundingClientRect().left;
          break;
        }
      }
      range.selectNodeContents(line);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const byTop = new Map<number, number>();
      for (const r of rects) {
        const cur = byTop.get(r.top);
        if (cur === undefined || r.left < cur) byTop.set(r.top, r.left);
      }
      const visualLines = Array.from(byTop.entries())
        .sort(([a], [b]) => a - b)
        .map(([, left]) => left);
      return { bodyLeft, visualLines };
    });

    expect(result).not.toBeNull();
    expect(result!.bodyLeft).not.toBeNull();
    expect(result!.visualLines.length).toBeGreaterThan(1);
    const wrapLeft = result!.visualLines[1];
    expect(Math.abs(wrapLeft - result!.bodyLeft!)).toBeLessThan(5);
  });

  test("fenced code wrapped lines align with the code body", async ({ page }) => {
    // Replace the body of the fenced block with a single very long
    // line so it wraps.
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string } };
          dispatch: (s: unknown) => void;
        };
      };
      const view = (window as ViewWindow).__cmView!;
      const doc = view.state.doc.toString();
      const idx = doc.indexOf("function hello(name) {");
      if (idx < 0) throw new Error("expected fenced body line");
      view.dispatch({
        changes: {
          from: idx,
          to: idx + "function hello(name) {".length,
          insert:
            "function hello(name) { console.log('this is a really long single-line statement that we make extra long with extra padding text so that the wrap is forced across the viewport at 1280px width even with a monospace font setting in this fenced code line'); }",
        },
      });
    });
    await page.waitForTimeout(50);

    const result = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll(".cm-line"));
      const line = lines.find((el) =>
        (el as HTMLElement).innerText.includes("function hello"),
      ) as HTMLElement | undefined;
      if (!line) return null;
      const range = document.createRange();
      range.selectNodeContents(line);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const byTop = new Map<number, number>();
      for (const r of rects) {
        const cur = byTop.get(r.top);
        if (cur === undefined || r.left < cur) byTop.set(r.top, r.left);
      }
      const visualLines = Array.from(byTop.entries())
        .sort(([a], [b]) => a - b)
        .map(([, left]) => left);
      return { visualLines };
    });

    expect(result).not.toBeNull();
    expect(result!.visualLines.length).toBeGreaterThan(1);
    // Code lines have no marker prefix — every visual line starts
    // at the same X (within sub-pixel tolerance).
    const first = result!.visualLines[0];
    for (const left of result!.visualLines) {
      expect(Math.abs(left - first)).toBeLessThan(2);
    }
  });

  test("HR widget has same vertical footprint as source `---` — no doc jump", async ({ page }) => {
    // When the caret swaps the HR line between widget mode and source
    // mode, surrounding lines must not move vertically. Capture the Y
    // position of "Below the rule." in both states and assert it's
    // unchanged (sub-pixel tolerance).
    const below = lineWithText(page, "Below the rule.");

    await clickAwayFromMarkers(page);
    const yWidget = await below.evaluate(
      (el) => el.getBoundingClientRect().top,
    );

    await placeCaretAfter(page, "---");
    const ySource = await below.evaluate(
      (el) => el.getBoundingClientRect().top,
    );

    expect(Math.abs(yWidget - ySource)).toBeLessThan(2);
  });

  test("ArrowDown lands on the horizontal-rule line, doesn't skip it", async ({ page }) => {
    // Click on the line just above the rule so the caret starts on a
    // known line. The HR widget is currently active (caret away from
    // its line), making the `---` source range atomic. Pressing ↓ once
    // should land on the empty line below; ↓ again should land on the
    // HR line itself, where the source `---` reveals for editing —
    // not skip past the line because of an atomic replace range.
    await lineWithText(page, "Above the rule.").click();
    expect(await caretLineText(page)).toBe("Above the rule.");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("---");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("Below the rule.");
  });

  test("ArrowUp lands on the horizontal-rule line, doesn't skip it", async ({ page }) => {
    // Mirror of the ArrowDown case — vertical navigation should walk
    // through every line on the way back up too.
    await lineWithText(page, "Below the rule.").click();
    expect(await caretLineText(page)).toBe("Below the rule.");

    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("");

    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("---");

    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("");

    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("Above the rule.");
  });

  test("Arrow keys walk into and through the fenced code block line by line", async ({ page }) => {
    // Fenced code blocks render as styled lines (no atomic widgets), so
    // vertical navigation should see every line: the opening fence, each
    // body line, and the closing fence.
    // The `## ` of the H2 is replaced out of the rendered DOM, so
    // Playwright's text locator can't match the source text. Match the
    // visible body and click that instead.
    await lineWithText(page, "Fenced code").click();

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("```");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("function hello(name) {");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe('  return "hi, " + name;');

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("}");

    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("```");
  });

  // -----------------------------------------------------------------
  // Iter 03 — replace-hide and mark-reveal (TV-73)
  // -----------------------------------------------------------------
  // The hidden state is implemented as `Decoration.replace({})` (no
  // widget) — markers are removed from rendered DOM entirely. The
  // revealed state uses `Decoration.mark` with class `cm-md-mark` and
  // a muted-grey color rule. The two states are mutually exclusive,
  // and the legacy `cm-md-hidden` class no longer exists.

  test("hidden markers leave no DOM (no `cm-md-hidden` spans, source chars not in rendered text)", async ({ page }) => {
    await clickAwayFromMarkers(page);
    // No spans carry the legacy hidden class.
    await expect(page.locator(".cm-md-hidden")).toHaveCount(0);
    // The only `.cm-md-mark` spans on a caret-away doc are the
    // always-visible ordered-list `N.` markers (the seed has 3).
    await expect(
      page.locator(".cm-md-mark").filter({ hasText: /^\d+\.$/ }),
    ).toHaveCount(3);
    // No other `.cm-md-mark` spans are present when caret is away.
    const nonOrdered = page
      .locator(".cm-md-mark")
      .filter({ hasNotText: /^\d+\.$/ });
    await expect(nonOrdered).toHaveCount(0);

    // Headings: rendered line text omits the leading `# `.
    const h1 = lineWithText(page, "Heading 1");
    expect(await h1.evaluate((el) => (el as HTMLElement).innerText)).toBe("Heading 1");

    // Bold: rendered text on the inline paragraph omits `**` around bold.
    const inlineLine = lineWithText(page, "Some paragraph text");
    const inlineRendered = await inlineLine.evaluate((el) => (el as HTMLElement).innerText);
    expect(inlineRendered).not.toContain("**");

    // Blockquote: leading `> ` not in rendered text.
    const quote = lineWithText(page, "This is a block quote");
    const quoteRendered = await quote.evaluate((el) => (el as HTMLElement).innerText);
    expect(quoteRendered.startsWith(">")).toBe(false);

    // Fenced code: leading ``` not in rendered text of the opening fence
    // line (caret-off).
    const fencedOpen = page.locator(".cm-line.cm-md-fenced-line").first();
    const fencedRendered = await fencedOpen.evaluate((el) => (el as HTMLElement).innerText);
    expect(fencedRendered).not.toContain("```");
  });

  test("revealed marker on a heading line carries `cm-md-mark`", async ({ page }) => {
    const heading = lineWithText(page, "Heading 1");
    await heading.click();
    const markSpan = heading.locator(".cm-md-mark").first();
    await expect(markSpan).toHaveText("# ");
  });

  test("revealed marker on a blockquote line carries `cm-md-mark`", async ({ page }) => {
    await placeCaretAfter(page, "Continued on the next line.");
    const quote = lineWithText(page, "Continued on the next line.");
    const markSpan = quote.locator(".cm-md-mark").first();
    await expect(markSpan).toHaveText("> ");
  });

  test("ArrowUp from empty line below a multi-line blockquote lands on the last blockquote line", async ({ page }) => {
    await placeCaretAfter(page, "Continued on the next line.");
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("> Continued on the next line.");
  });

  test("ArrowUp from empty line below an unordered list lands on the last list item", async ({ page }) => {
    await placeCaretAfter(page, "Unordered item three");
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("- Unordered item three");
  });

  test("ArrowUp from empty line below an ordered list lands on the last list item", async ({ page }) => {
    await placeCaretAfter(page, "3. Ordered item three with *italic* inside");
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowUp");
    expect(await caretLineText(page)).toBe("3. Ordered item three with *italic* inside");
  });

  test("ArrowDown from empty line above an unordered list lands at the start of rendered content", async ({ page }) => {
    // Same browser quirk as headings/blockquote: with `- ` replaced
    // and the line carrying a small `padding-left`, geometric caret
    // hit-test lands at either col 0 or col 2 (= length of `- `) —
    // both visually identical (caret at the start of "Unordered").
    await placeCaretAtColumn0(page, "## Lists");
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowDown");
    const head = await page.evaluate(() => {
      type V = Window & { __cmView?: { state: { selection: { main: { head: number } }; doc: { lineAt(p: number): { from: number; text: string } } } } };
      const v = (window as V).__cmView!;
      const line = v.state.doc.lineAt(v.state.selection.main.head);
      return { col: v.state.selection.main.head - line.from, text: line.text };
    });
    expect(head.text).toBe("- Unordered item one");
    expect([0, 2]).toContain(head.col);
  });

  test("ArrowDown from empty line above a blockquote lands at the start of rendered content", async ({ page }) => {
    // Same browser quirk as headings: with `> ` replaced out of layout,
    // geometric caret hit-test at x=0 lands either at source col 0
    // (before the replaced range) or col 2 (after) — both visually
    // identical (caret at the start of "This"). Accept either.
    await placeCaretAtColumn0(page, "## Block quote");
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowDown");
    const head = await page.evaluate(() => {
      type V = Window & { __cmView?: { state: { selection: { main: { head: number } }; doc: { lineAt(p: number): { from: number; text: string } } } } };
      const v = (window as V).__cmView!;
      const line = v.state.doc.lineAt(v.state.selection.main.head);
      return { col: v.state.selection.main.head - line.from, text: line.text };
    });
    expect(head.text.startsWith("> This is a block quote")).toBe(true);
    expect([0, 2]).toContain(head.col);
  });

  test("ArrowDown from empty line above a heading lands at the start of rendered content", async ({ page }) => {
    // Goal X 0 onto a heading line. The `## ` source is removed from
    // the rendered DOM via Decoration.replace, so visually the line
    // starts with "Heading 2" at x=0. Browsers' geometric caret hit
    // test at (0, y) lands at the FIRST rendered character — either at
    // source col 0 (before the replaced range) or col 3 (after). Both
    // are visually identical (caret sits before "H"); accept either.
    await placeCaretAtColumn0(
      page,
      "A line with an [external link](https://example.com).",
    );
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowDown");
    const head = await page.evaluate(() => {
      type V = Window & { __cmView?: { state: { selection: { main: { head: number } }; doc: { lineAt(p: number): { from: number; text: string } } } } };
      const v = (window as V).__cmView!;
      const line = v.state.doc.lineAt(v.state.selection.main.head);
      return { col: v.state.selection.main.head - line.from, text: line.text };
    });
    expect(head.text).toBe("## Heading 2");
    expect([0, 3]).toContain(head.col);
  });

  test("ArrowDown from empty line above a fenced code block lands at column 0 of the opening fence", async ({ page }) => {
    await placeCaretAtColumn0(page, "## Fenced code");
    await page.keyboard.press("ArrowDown");
    expect(await caretLineText(page)).toBe("");
    await page.keyboard.press("ArrowDown");
    const head = await page.evaluate(() => {
      type V = Window & { __cmView?: { state: { selection: { main: { head: number } }; doc: { lineAt(p: number): { from: number; text: string } } } } };
      const v = (window as V).__cmView!;
      const line = v.state.doc.lineAt(v.state.selection.main.head);
      return { col: v.state.selection.main.head - line.from, text: line.text };
    });
    expect(head.text).toBe("```");
    expect(head.col).toBe(0);
  });

  test("typing re-decorates without reverting reveal state", async ({ page }) => {
    const inlineLine = lineWithText(page, "Some paragraph text");
    await inlineLine.getByText("bold", { exact: true }).first().click();
    // Caret in bold → 2 mark spans for `**`.
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: "**" })).toHaveCount(2);

    // Type a character inside the bold span — `**boXld**` after.
    await page.keyboard.type("X");
    // Caret is still inside the (now larger) bold run; markers stay revealed.
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: "**" })).toHaveCount(2);

    // Source bytes round-trip — pressing cmd+z restores prior content and
    // selection; markers re-decorate accordingly. Caret-away clears
    // mark spans entirely.
    const undoKey = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    await page.keyboard.press(undoKey);
    await clickAwayFromMarkers(page);
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: "**" })).toHaveCount(0);
  });
});
