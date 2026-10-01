import { expect, test } from "@playwright/test";
import {
  lineWithText,
  clickAwayFromMarkers,
  placeCaretAfter,
  setDocument,
  getDocument,
  getDocumentSelection,
  pressMod,
  fontWeightForText,
  selectSourceRange,
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

  test("TV-400 Mod-B wraps and unwraps selected text", async ({ page }) => {
    await setDocument(page, "make bold text");
    await selectSourceRange(page, "bold", "bold");

    await pressMod(page, "B");
    await expect.poll(() => getDocument(page)).toBe("make **bold** text");
    await expect.poll(async () => (await getDocumentSelection(page)).selectedText).toBe("bold");

    await pressMod(page, "B");
    await expect.poll(() => getDocument(page)).toBe("make bold text");
    await expect.poll(async () => (await getDocumentSelection(page)).selectedText).toBe("bold");
  });

  test("TV-400 Mod-I wraps and unwraps selected text", async ({ page }) => {
    await setDocument(page, "make italic text");
    await selectSourceRange(page, "italic", "italic");

    await pressMod(page, "I");
    await expect.poll(() => getDocument(page)).toBe("make *italic* text");
    await expect.poll(async () => (await getDocumentSelection(page)).selectedText).toBe("italic");

    await pressMod(page, "I");
    await expect.poll(() => getDocument(page)).toBe("make italic text");
    await expect.poll(async () => (await getDocumentSelection(page)).selectedText).toBe("italic");
  });

  test("TV-400 caret-only Mod-B and Mod-I insert delimiter pairs with the caret between", async ({ page }) => {
    await setDocument(page, "");
    await pressMod(page, "B");
    await expect.poll(() => getDocument(page)).toBe("****");
    await expect.poll(async () => (await getDocumentSelection(page)).head).toBe(2);
    expect((await getDocumentSelection(page)).selectedText).toBe("");

    await setDocument(page, "");
    await pressMod(page, "I");
    await expect.poll(() => getDocument(page)).toBe("**");
    await expect.poll(async () => (await getDocumentSelection(page)).head).toBe(1);
    expect((await getDocumentSelection(page)).selectedText).toBe("");
  });

  test("TV-400 Mod-I inserts italic delimiters instead of selecting the parent syntax node", async ({ page }) => {
    await setDocument(page, "- item");
    await placeCaretAfter(page, "it");

    await pressMod(page, "I");

    await expect.poll(() => getDocument(page)).toBe("- it**em");
    const selection = await getDocumentSelection(page);
    expect(selection.from).toBe(selection.to);
    expect(selection.head).toBe("- it*".length);
    expect(selection.selectedText).toBe("");
  });

  test("TV-398 prose hashtags render as token pills without changing source", async ({ page }) => {
    const doc = "Tags #project #todo/urgent #a/";
    await setDocument(page, doc);

    const tags = page.locator(".cm-md-tag");
    await expect(tags).toHaveCount(3);
    expect(await tags.allTextContents()).toEqual(["#project", "#todo/urgent", "#a"]);
    expect(await getDocument(page)).toBe(doc);

    const style = await tags.first().evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return {
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        color: computed.color,
        fontWeight: computed.fontWeight,
      };
    });
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.borderRadius).not.toBe("0px");
    expect(Number.parseInt(style.fontWeight, 10)).toBeGreaterThanOrEqual(600);
  });

  test("TV-398 ignores numeric tags, code, links, URLs, and heading markers", async ({ page }) => {
    const doc = [
      "# Heading",
      "Numeric #123",
      "Inline `note #code`",
      "```",
      "#fenced",
      "```",
      "[label #label]( #frag )",
    ].join("\n");
    await setDocument(page, doc);

    await expect(page.locator(".cm-md-tag")).toHaveCount(0);
    expect(await getDocument(page)).toBe(doc);
  });

  test("blockquote lines carry cm-md-blockquote-line", async ({ page }) => {
    const lineA = lineWithText(page, "This is a block quote");
    const lineB = lineWithText(page, "Continued on the next line");
    await expect(lineA).toHaveClass(/cm-md-blockquote-line/);
    await expect(lineB).toHaveClass(/cm-md-blockquote-line/);
  });

  test("fenced code lines carry cm-md-fenced-line", async ({ page }) => {
    // Wait for at least one fenced-line decoration to land — lezer-markdown
    // may parse the fence in a later pass than the initial decorations
    // (which only need a HeaderMark to satisfy beforeEach's wait).
    await page.locator(".cm-md-fenced-line").first().waitFor();

    const bodyLine = lineWithText(page, "function hello");
    await expect(bodyLine).toHaveClass(/cm-md-fenced-line/);

    // The fence in the seed has 5 lines: opening ```, three body lines,
    // closing ```. All five carry the class. Counting decorated lines
    // avoids regex-against-backticks shenanigans in Playwright's locator
    // string parser.
    const expectedFencedLines = 5;
    await expect(page.locator(".cm-md-fenced-line")).toHaveCount(expectedFencedLines);
  });

  test("horizontal rule renders as an <hr> widget", async ({ page }) => {
    const hr = page.locator("hr.cm-md-hr");
    await expect(hr).toHaveCount(1);
    // Source bytes are preserved — the doc still contains `---`.
    const docText = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(docText).toMatch(/^---$/m);
  });

  test("TV-393 dash-space below a paragraph does not style the paragraph as a setext heading", async ({ page }) => {
    await setDocument(page, "foo\n- ");

    const fooLine = lineWithText(page, "foo");
    await expect(fooLine).not.toHaveClass(/cm-md-heading-/);
    await expect.poll(() => fontWeightForText(page, "foo")).toBeLessThan(600);
  });

  test("TV-393 unordered and 1-dot ordered lines below a paragraph render as lists", async ({ page }) => {
    await setDocument(page, "foo\n- item");
    await expect(lineWithText(page, "item")).toHaveClass(/cm-md-list-item/);
    await expect(lineWithText(page, "item")).toHaveClass(/cm-md-list-bullet/);

    await setDocument(page, "foo\n1. item");
    await expect(lineWithText(page, "item")).toHaveClass(/cm-md-list-item/);
    await expect(lineWithText(page, "item").locator(".cm-md-mark").filter({ hasText: /^1\.$/ })).toHaveCount(1);
  });

  test("TV-393 triple dash below a paragraph renders as a horizontal rule", async ({ page }) => {
    await setDocument(page, "foo\n---");

    await expect(lineWithText(page, "foo")).not.toHaveClass(/cm-md-heading-/);
    await expect(page.locator("hr.cm-md-hr")).toHaveCount(1);
    expect(await getDocument(page)).toBe("foo\n---");
  });

  test("task checkbox toggles source `[ ]` ↔ `[x]` on click", async ({ page }) => {
    const open = lineWithText(page, "Open task");
    const checkbox = open.locator("input.cm-md-task-checkbox[type='checkbox']");
    await expect(checkbox).toHaveCount(1);
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(checkbox).toBeChecked();
    const afterCheck = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(afterCheck).toMatch(/^- \[x\] Open task$/m);

    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    const afterUncheck = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(afterUncheck).toMatch(/^- \[ \] Open task$/m);
  });

  test("completed task checkbox renders checked", async ({ page }) => {
    const done = lineWithText(page, "Completed task");
    const checkbox = done.locator("input.cm-md-task-checkbox[type='checkbox']");
    await expect(checkbox).toHaveCount(1);
    await expect(checkbox).toBeChecked();
  });

  test("unordered list `-` swap is gated on caret proximity to the marker, not the whole line", async ({ page }) => {
    // Obsidian-style behavior: `•` and the source `-` swap only when
    // the caret is adjacent to (or selecting) the `- ` ListMark range
    // itself. A caret elsewhere on the line — e.g. in the middle of
    // "Unordered item one" — should leave the bullet rendered.
    await clickAwayFromMarkers(page);
    const item = lineWithText(page, "Unordered item one");
    // Caret away → `•` rendered, source `- ` hidden via Decoration.replace
    // (no `.cm-md-mark` span on this line for the bullet marker).
    await expect(item).toHaveClass(/cm-md-list-bullet/);
    await expect(item.locator(".cm-md-mark").filter({ hasText: /^- $/ })).toHaveCount(0);

    // Caret in body — not adjacent to `- `. Bullet stays rendered;
    // marker stays hidden.
    await placeCaretAfter(page, "Unordered item");
    await expect(item).toHaveClass(/cm-md-list-bullet/);
    await expect(item.locator(".cm-md-mark").filter({ hasText: /^- $/ })).toHaveCount(0);

    // Caret right after `- ` — adjacent to the marker. `•` rendering
    // drops; source `- ` reveals as a `.cm-md-mark` span.
    await placeCaretAfter(page, "- ");
    await expect(item).not.toHaveClass(/cm-md-list-bullet/);
    await expect(item.locator(".cm-md-mark").filter({ hasText: /^- $/ })).toHaveCount(1);
  });

  test("ordered list `N.` stays visible always (tinted muted grey)", async ({ page }) => {
    await clickAwayFromMarkers(page);
    const item = page
      .locator(".cm-line", { hasText: /^1\. Ordered item one$/ })
      .first();
    // Always rendered as `.cm-md-mark` (mono + grey) so the marker
    // reads consistently with other revealed source.
    await expect(item.locator(".cm-md-mark").filter({ hasText: /^1\.$/ })).toHaveCount(1);
  });

  test("task line is in exactly one of two states — full source OR checkbox-only — never `-` without `[ ]`", async ({ page }) => {
    // Contract: a task line shows EITHER the full source `- [ ] Open task`
    // (raw mode, when caret is adjacent to / inside the `- [ ] ` prefix)
    // OR just the rendered checkbox + body (no `-`, when caret is in
    // body or away from the line). There is no valid intermediate
    // state where `-` is visible without `[ ]` (or vice versa).
    const open = lineWithText(page, "Open task");

    // ── 1. Caret away from the line: checkbox-only mode ──
    // The leading `- ` is hidden via Decoration.replace (no DOM, no
    // mark span). The `[ ]` is replaced by the checkbox widget.
    await clickAwayFromMarkers(page);
    await expect(open.locator("input.cm-md-task-checkbox")).toHaveCount(1);
    await expect(
      open.locator(".cm-md-mark").filter({ hasText: /^- $/ }),
    ).toHaveCount(0);

    // ── 2. Caret in body of "Open task" (NOT adjacent to marker):
    //       still checkbox-only mode (NOT the buggy intermediate state) ──
    await placeCaretAfter(page, "Open ");
    await expect(open.locator("input.cm-md-task-checkbox")).toHaveCount(1);
    await expect(
      open.locator(".cm-md-mark").filter({ hasText: /^- $/ }),
    ).toHaveCount(0);

    // ── 3. Caret right after `- [ ] ` (adjacent to marker):
    //       full raw mode — no checkbox; both `- ` and `[ ]` show as
    //       `.cm-md-mark` source spans.
    await placeCaretAfter(page, "- [ ] ");
    await expect(open.locator("input.cm-md-task-checkbox")).toHaveCount(0);
    await expect(open.locator(".cm-md-mark").filter({ hasText: /^- $/ })).toHaveCount(1);
    await expect(open.locator(".cm-md-mark").filter({ hasText: /^\[ \]$/ })).toHaveCount(1);

    // ── 4. Caret right after the leading `- ` (still adjacent to marker
    //       since `- [ ]` overall is the prefix): full raw mode ──
    // Use the EditorView API to place caret at exact column 2 of the
    // task line (between `- ` and `[`).
    await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: {
          state: { doc: { toString(): string } };
          dispatch: (s: unknown) => void;
          focus: () => void;
        };
      };
      const view = (window as ViewWindow).__cmView;
      if (!view) throw new Error("no view");
      const start = view.state.doc.toString().indexOf("- [ ] Open task");
      view.focus();
      view.dispatch({ selection: { anchor: start + 2 } });
    });
    await expect(open.locator("input.cm-md-task-checkbox")).toHaveCount(0);
    await expect(open.locator(".cm-md-mark").filter({ hasText: /^- $/ })).toHaveCount(1);
    await expect(open.locator(".cm-md-mark").filter({ hasText: /^\[ \]$/ })).toHaveCount(1);
  });

  test("task checkbox reverts to `[ ]` source when caret is adjacent to the marker", async ({ page }) => {
    await clickAwayFromMarkers(page);
    const open = lineWithText(page, "Open task");
    await expect(open.locator("input.cm-md-task-checkbox")).toHaveCount(1);

    // Place caret right after the `[ ]` of the first task — the
    // selection now overlaps the TaskMarker range; the widget should
    // not apply, and the source `[ ]` text becomes visible/editable.
    await placeCaretAfter(page, "[ ]");
    await expect(open.locator("input.cm-md-task-checkbox")).toHaveCount(0);
  });

  test("horizontal rule reverts to `---` source when caret is on the line", async ({ page }) => {
    await clickAwayFromMarkers(page);
    await expect(page.locator("hr.cm-md-hr")).toHaveCount(1);

    // Place caret on the `---` line — the HR widget should not apply
    // and the source `---` text is shown for editing.
    await placeCaretAfter(page, "---");
    await expect(page.locator("hr.cm-md-hr")).toHaveCount(0);
  });

  test("headings have no underline (no text-decoration)", async ({ page }) => {
    // Regression: defaultHighlightStyle underlines headings; we replaced
    // it with our own monochrome highlight that has no underline rule.
    const h1 = lineWithText(page, "Heading 1");
    const decorations = await h1.evaluate((line) => {
      // Walk through every element on the line and pick up any
      // `text-decoration-line` it sets via the highlighter's injected
      // style. Plain text nodes don't add decoration, so any non-`none`
      // result must come from a styled span.
      const out: string[] = [];
      const walk = (el: Element): void => {
        const cs = getComputedStyle(el);
        if (cs.textDecorationLine && cs.textDecorationLine !== "none") {
          out.push(`${el.tagName}.${el.className}: ${cs.textDecorationLine}`);
        }
        for (const child of Array.from(el.children)) walk(child);
      };
      walk(line);
      return out;
    });
    expect(decorations).toEqual([]);
  });

  test("clicking at the end of an unordered list line does not shift the body text", async ({ page }) => {
    // The user-visible goal: text doesn't jump when you click the end
    // of a `-` dotpoint line. End-of-line is far from the `- ` marker,
    // so the bullet stays rendered (no swap to source `-`), no padding
    // change, and the body text "Unordered item one" sits at the same
    // X coordinate before and after the click.
    await clickAwayFromMarkers(page);
    const item = lineWithText(page, "Unordered item one");

    // X coordinate of the first character of the body text "Unordered".
    // Walk text nodes (skipping the hidden `- ` and the `::before`
    // pseudo-element, which is not in the DOM tree) and pick the one
    // that contains the body.
    const bodyCharLeft = (loc: typeof item) =>
      loc.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = (node as Text).data ?? "";
          const offset = text.indexOf("Unordered");
          if (offset >= 0) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            return range.getBoundingClientRect().left;
          }
        }
        return null;
      });

    const xBefore = await bodyCharLeft(item);
    expect(xBefore).not.toBeNull();

    // Place the caret at the end of "Unordered item one" — far from
    // the leading `- ` marker.
    await placeCaretAfter(page, "Unordered item one");

    // Bullet is still rendered (not swapped to source `-`); the `- `
    // source stays hidden via Decoration.replace.
    await expect(item).toHaveClass(/cm-md-list-bullet/);
    await expect(item.locator(".cm-md-mark").filter({ hasText: /^- $/ })).toHaveCount(0);

    const xAfter = await bodyCharLeft(item);
    expect(Math.abs((xAfter ?? 0) - (xBefore ?? 0))).toBeLessThan(2);
  });

  test("Backspace at body-start of an ordered list item deletes just the trailing space — line dedents", async ({ page }) => {
    // Uniform rule: at body-start of ANY list item (ordered, unordered,
    // task), Backspace removes just the trailing space (1 char). The
    // marker glyphs stay in source as plain text but lezer no longer
    // parses the line as a list item, so the line dedents to flush
    // left. Remaining items renumber so the list isn't destroyed.
    //
    //   1. one          ←  caret right after `1. ` then Backspace
    //   2. two
    //   3. three
    //
    //   →
    //
    //   1.one           ← marker text intact, no longer parsed as list
    //   1. two          ← was `2.`, renumbered to keep list alive
    //   2. three        ← was `3.`, renumbered

    await placeCaretAfter(page, "1. ");
    await page.keyboard.press("Backspace");
    const doc = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(doc).toContain("\n1.Ordered item one\n");
    expect(doc).toContain("\n1. Ordered item two\n");
    expect(doc).toMatch(/\n2\. Ordered item three with \*italic\* inside\n/);

    // Demoted line is plain text — no `cm-md-list-item`.
    await expect(
      page.locator(".cm-line", { hasText: /^1\.Ordered item one$/ }).first(),
    ).not.toHaveClass(/cm-md-list-item/);

    // Renumbered items are still list items.
    await expect(
      page.locator(".cm-line", { hasText: /^1\. Ordered item two$/ }).first(),
    ).toHaveClass(/cm-md-list-item/);
    await expect(
      page.locator(".cm-line", { hasText: /^2\. Ordered item three/ }).first(),
    ).toHaveClass(/cm-md-list-item/);
  });

  test("Backspace at body-start of an unordered list item deletes just the trailing space", async ({ page }) => {
    // Same rule applied to `- ` lists.
    await placeCaretAfter(page, "- ");
    await page.keyboard.press("Backspace");
    const doc = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(doc).toContain("\n-Unordered item one\n");
    // The remaining unordered items stay as a list.
    expect(doc).toContain("\n- Unordered item two with **bold** inside\n");
    expect(doc).toContain("\n- Unordered item three\n");

    // Demoted line is plain text.
    await expect(
      page.locator(".cm-line", { hasText: /^-Unordered item one$/ }).first(),
    ).not.toHaveClass(/cm-md-list-item/);
  });

  test("undo restores the original ordered list in one Cmd+Z, including the renumber", async ({ page }) => {
    // After deleting `1.`'s trailing space, the doc is
    // `1.one\n1. two\n2. three` (renumber kept the list). One Cmd+Z
    // must restore the original `1. one\n2. two\n3. three` — the
    // renumber rides inside the user's transaction (via
    // `transactionFilter` composition), so it's a single undo step.
    await placeCaretAfter(page, "1. ");
    await page.keyboard.press("Backspace");

    // Sanity: post-edit doc has the renumber.
    const afterEdit = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(afterEdit).toContain("\n1.Ordered item one\n");
    expect(afterEdit).toContain("\n1. Ordered item two\n");

    // One Cmd+Z — full revert.
    const undoKey = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    await page.keyboard.press(undoKey);

    const afterUndo = await page.evaluate(() => {
      type ViewWindow = Window & {
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return (window as ViewWindow).__cmView?.state.doc.toString() ?? "";
    });
    expect(afterUndo).toContain("\n1. Ordered item one\n");
    expect(afterUndo).toContain("\n2. Ordered item two\n");
    expect(afterUndo).toMatch(/\n3\. Ordered item three with \*italic\* inside\n/);
  });

});
