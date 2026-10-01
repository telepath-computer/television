import { expect, test } from "@playwright/test";
import {
  MARK,
  MIN_RENDERED_NESTING_DELTA_PX,
  lineWithText,
  clickAwayFromMarkers,
  placeCaretAfter,
  placeCaretInLine,
  setDocument,
  getDocument,
  unorderedBulletMetrics,
  visibleTextMetrics,
  taskCheckboxMetrics,
  wrappedListLineMetrics,
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

  test("page mounts with seed content", async ({ page }) => {
    await expect(page.locator(".cm-editor")).toBeVisible();
    await expect(lineWithText(page, "Heading 1")).toBeVisible();
  });

  test("bold markers hide when caret is elsewhere, reveal when caret is in the bold span", async ({ page }) => {
    await clickAwayFromMarkers(page);

    const inlineLine = lineWithText(page, "Some paragraph text");
    // Caret away → markers hidden via Decoration.replace, no DOM, 0 mark spans.
    const boldStars = inlineLine.locator(`.${MARK}`).filter({ hasText: "**" });
    await expect(boldStars).toHaveCount(0);

    await inlineLine.getByText("bold", { exact: true }).first().click();
    // Caret on bold → 2 mark spans (open and close `**`).
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: "**" })).toHaveCount(2);

    await clickAwayFromMarkers(page);
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: "**" })).toHaveCount(0);
  });

  test("italic markers reveal independently of bold", async ({ page }) => {
    await clickAwayFromMarkers(page);

    const inlineLine = lineWithText(page, "Some paragraph text");
    // Caret away → no mark spans for either `*italic*` or `**bold**`.
    const single = inlineLine.locator(`.${MARK}`).filter({ hasText: /^\*$/ });
    const double = inlineLine.locator(`.${MARK}`).filter({ hasText: /^\*\*$/ });
    await expect(single).toHaveCount(0);
    await expect(double).toHaveCount(0);

    await inlineLine.getByText("italic", { exact: true }).first().click();
    // Italic revealed → 2 single-star mark spans. Bold stays hidden.
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: /^\*$/ })).toHaveCount(2);
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: /^\*\*$/ })).toHaveCount(0);
  });

  test("inline code backticks hide and reveal", async ({ page }) => {
    await clickAwayFromMarkers(page);

    const inlineLine = lineWithText(page, "Some paragraph text");
    const ticks = inlineLine.locator(`.${MARK}`).filter({ hasText: "`" });
    await expect(ticks).toHaveCount(0);

    await placeCaretAfter(page, "inline");
    await expect(inlineLine.locator(`.${MARK}`).filter({ hasText: "`" })).toHaveCount(2);
  });

  test("link brackets and URL hide and reveal as one span", async ({ page }) => {
    await clickAwayFromMarkers(page);

    const inlineLine = lineWithText(page, "Some paragraph text");
    // The link is `[inline link](https://example.com)` — markers `[`, `]`,
    // `(`, `)` plus the URL itself. Without highlight styling on
    // `tags.link`, the link body has no wrapping span to click; place
    // the caret programmatically inside the link body instead.
    await placeCaretAfter(page, "inline link");
    // Selection overlaps the parent `Link` node → all four link markers
    // (`[`, `]`, `(`, `)`) reveal as `.cm-md-mark` spans.
    const revealed = inlineLine.locator(`.${MARK}`).filter({ hasText: /^[\[\]\(\)]$/ });
    await expect(revealed).toHaveCount(4);
  });

  test("heading marker hides when off the line, reveals when on the line", async ({ page }) => {
    await clickAwayFromMarkers(page);

    const h1 = lineWithText(page, "Heading 1");
    // Caret away → no mark span; the `# ` source is removed from DOM.
    await expect(h1.locator(`.${MARK}`).filter({ hasText: /^# $/ })).toHaveCount(0);

    await h1.getByText("Heading 1").click();
    // Caret on the heading line → revealed `# ` shows as a mark span.
    await expect(h1.locator(`.${MARK}`).filter({ hasText: /^# $/ })).toHaveCount(1);

    await clickAwayFromMarkers(page);
    await expect(h1.locator(`.${MARK}`).filter({ hasText: /^# $/ })).toHaveCount(0);
  });

  test("blockquote `>` reveals per-line, not per-block", async ({ page }) => {
    await clickAwayFromMarkers(page);

    const lineA = lineWithText(page, "This is a block quote");
    const lineB = lineWithText(page, "Continued on the next line");
    // Caret away → both lines' `> ` source is removed from DOM.
    await expect(lineA.locator(`.${MARK}`).filter({ hasText: ">" })).toHaveCount(0);
    await expect(lineB.locator(`.${MARK}`).filter({ hasText: ">" })).toHaveCount(0);

    await lineA.getByText("This is a block quote").click();
    // Caret on lineA → its `> ` revealed as mark; lineB stays hidden.
    await expect(lineA.locator(`.${MARK}`).filter({ hasText: ">" })).toHaveCount(1);
    await expect(lineB.locator(`.${MARK}`).filter({ hasText: ">" })).toHaveCount(0);

    await lineB.getByText("Continued on the next line").click();
    await expect(lineA.locator(`.${MARK}`).filter({ hasText: ">" })).toHaveCount(0);
    await expect(lineB.locator(`.${MARK}`).filter({ hasText: ">" })).toHaveCount(1);
  });

  // Note: list-mark / task-mark behavior is covered by the per-variant
  // tests further down ("unordered list `-` hides when caret is off the
  // line", "ordered list `N.` stays visible always", "task list `- `
  // ListMark hides when caret is off the line", and the checkbox-revert
  // test). The earlier umbrella tests that asserted "no hidden markers
  // on any list line" were superseded by the variant-specific behavior.

  test("horizontal rule stays visible regardless of caret position", async ({ page }) => {
    // Hiding the `---` collapses the line to ~0 height — the rule
    // disappears entirely. Iter 03's theme will replace the text with a
    // visual rule; for now keep `---` visible so the divider is at
    // least there.
    await clickAwayFromMarkers(page);
    const hrLine = page.locator(".cm-line").filter({ hasText: /^---$/ }).first();
    await expect(hrLine.locator(`.${MARK}`)).toHaveCount(0);
  });

  test("inline code body styles with cm-md-inline-code", async ({ page }) => {
    await clickAwayFromMarkers(page);
    const inlineLine = lineWithText(page, "Some paragraph text");
    const styled = inlineLine.locator(".cm-md-inline-code");
    await expect(styled).toHaveCount(1);
    await expect(styled).toHaveText("inline code");
  });

  test("list item lines carry cm-md-list-item", async ({ page }) => {
    const unordered = lineWithText(page, "Unordered item one");
    const ordered = lineWithText(page, "Ordered item one");
    const task = lineWithText(page, "Open task");
    await expect(unordered).toHaveClass(/cm-md-list-item/);
    await expect(ordered).toHaveClass(/cm-md-list-item/);
    await expect(task).toHaveClass(/cm-md-list-item/);
  });

  test("Tab and Shift-Tab indent a bullet line and render it nested", async ({ page }) => {
    const initialDoc = "- parent\n- child\n- sibling";
    const indentedDoc = "- parent\n  - child\n- sibling";
    await setDocument(page, initialDoc);

    await placeCaretAfter(page, "- child");
    await page.keyboard.press("Tab");
    await expect.poll(() => getDocument(page)).toBe(indentedDoc);

    const child = lineWithText(page, "child");
    await expect(child).toHaveClass(/cm-md-list-item/);

    const bodyLefts = await page.evaluate(() => {
      function bodyLeftFor(text: string): number | null {
        const line = Array.from(document.querySelectorAll(".cm-line")).find((el) =>
          (el as HTMLElement).innerText.includes(text),
        );
        if (!line) return null;
        const range = document.createRange();
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const data = (node as Text).data;
          const index = data.indexOf(text);
          if (index >= 0) {
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            return range.getBoundingClientRect().left;
          }
        }
        return null;
      }
      return {
        parent: bodyLeftFor("parent"),
        child: bodyLeftFor("child"),
      };
    });
    expect(bodyLefts.parent).not.toBeNull();
    expect(bodyLefts.child).not.toBeNull();
    expect(bodyLefts.child! - bodyLefts.parent!).toBeGreaterThan(4);

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => getDocument(page)).toBe(initialDoc);
  });

  test("nested unordered bullets indent the rendered bullet and keep the body gap tight", async ({
    page,
  }) => {
    await setDocument(
      page,
      [
        "- parent",
        "  - child",
        "    - grandchild",
        "",
        "plain paragraph",
      ].join("\n"),
    );
    await placeCaretAfter(page, "plain paragraph");

    const parent = await unorderedBulletMetrics(page, "parent");
    const child = await unorderedBulletMetrics(page, "child");
    const grandchild = await unorderedBulletMetrics(page, "grandchild");

    expect(child.bulletLeft - parent.bulletLeft).toBeGreaterThanOrEqual(MIN_RENDERED_NESTING_DELTA_PX);
    expect(grandchild.bulletLeft - child.bulletLeft).toBeGreaterThanOrEqual(MIN_RENDERED_NESTING_DELTA_PX);
    expect(child.textLeft - parent.textLeft).toBeGreaterThanOrEqual(MIN_RENDERED_NESTING_DELTA_PX);
    expect(grandchild.textLeft - child.textLeft).toBeGreaterThanOrEqual(MIN_RENDERED_NESTING_DELTA_PX);
    expect(Math.abs(child.gap - parent.gap)).toBeLessThan(3);
    expect(Math.abs(grandchild.gap - parent.gap)).toBeLessThan(3);
  });

  test("nested unordered bullet source reveal keeps marker and body aligned with rendered mode", async ({
    page,
  }) => {
    await setDocument(
      page,
      [
        "- parent",
        "  - child",
        "    - grandchild",
        "",
        "plain paragraph",
      ].join("\n"),
    );
    await placeCaretAfter(page, "plain paragraph");

    const renderedParent = await unorderedBulletMetrics(page, "parent");
    const renderedChild = await unorderedBulletMetrics(page, "child");
    const renderedGrandchild = await unorderedBulletMetrics(page, "grandchild");

    await placeCaretInLine(page, "- parent", 2);
    const revealedParent = await visibleTextMetrics(page, "parent", "-");
    expect(Math.abs(renderedParent.bulletLeft - revealedParent.markerLeft)).toBeLessThan(3);
    expect(Math.abs(renderedParent.textLeft - revealedParent.bodyLeft)).toBeLessThan(3);

    await placeCaretInLine(page, "  - child", 4);
    const child = lineWithText(page, "child");
    await expect(child).not.toHaveClass(/cm-md-list-bullet/);
    const revealedChild = await visibleTextMetrics(page, "child", "-");
    expect(Math.abs(renderedChild.bulletLeft - revealedChild.markerLeft)).toBeLessThan(3);
    expect(Math.abs(renderedChild.textLeft - revealedChild.bodyLeft)).toBeLessThan(3);
    expect(Math.abs(renderedGrandchild.bulletLeft - revealedChild.markerLeft)).toBeGreaterThan(5);

    await placeCaretInLine(page, "    - grandchild", 6);
    const revealedGrandchild = await visibleTextMetrics(page, "grandchild", "-");
    expect(Math.abs(renderedGrandchild.bulletLeft - revealedGrandchild.markerLeft)).toBeLessThan(3);
    expect(Math.abs(renderedGrandchild.textLeft - revealedGrandchild.bodyLeft)).toBeLessThan(3);
  });

  test("nested ordered and task prefixes do not double-indent when revealed", async ({ page }) => {
    await setDocument(
      page,
      [
        "1. ordered parent",
        "  1. ordered child",
        "",
        "- [ ] task parent",
        "  - [ ] task child",
        "",
        "plain paragraph",
      ].join("\n"),
    );
    await placeCaretAfter(page, "plain paragraph");

    const renderedOrdered = await visibleTextMetrics(page, "ordered child", "1.");
    const renderedTask = await taskCheckboxMetrics(page, "task child");

    await placeCaretInLine(page, "  1. ordered child", 5);
    const revealedOrdered = await visibleTextMetrics(page, "ordered child", "1.");
    expect(Math.abs(renderedOrdered.markerLeft - revealedOrdered.markerLeft)).toBeLessThan(3);
    expect(Math.abs(renderedOrdered.bodyLeft - revealedOrdered.bodyLeft)).toBeLessThan(3);

    await placeCaretInLine(page, "  - [ ] task child", 8);
    const revealedTask = await visibleTextMetrics(page, "task child", "-");
    expect(Math.abs(renderedTask.checkboxLeft - revealedTask.markerLeft)).toBeLessThan(3);
    expect(revealedTask.markerLeft - renderedTask.checkboxLeft).toBeLessThan(3);
  });

  test("nested unordered wrapped lines align with the body column", async ({ page }) => {
    await setDocument(
      page,
      [
        "- parent",
        "  - nested item with a really long body that should wrap across multiple visual lines so we can test that the wrap continuation aligns with the nested body content rather than with the nested bullet marker — repeated again to make sure this line is forced to wrap onto a second visual line. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "",
        "plain paragraph",
      ].join("\n"),
    );
    await placeCaretAfter(page, "plain paragraph");

    const result = await wrappedListLineMetrics(page, "nested item");

    expect(result).not.toBeNull();
    expect(result!.bodyLeft).not.toBeNull();
    expect(result!.visualLines.length).toBeGreaterThan(1);
    const wrapLeft = result!.visualLines[1];
    expect(Math.abs(wrapLeft - result!.bodyLeft!)).toBeLessThan(5);
  });

  test("Tab and Shift-Tab indent every selected line by two spaces", async ({ page }) => {
    const initialDoc = "alpha\nbeta\ngamma";
    await setDocument(page, initialDoc);
    await selectSourceRange(page, "alpha", "beta");

    await page.keyboard.press("Tab");
    await expect.poll(() => getDocument(page)).toBe("  alpha\n  beta\ngamma");

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => getDocument(page)).toBe(initialDoc);
  });

  test("Tab indents in the editor without focusing task checkboxes", async ({ page }) => {
    await setDocument(page, "- [ ] task\nplain");
    await placeCaretAfter(page, "plain");
    const checkbox = lineWithText(page, "task").locator("input.cm-md-task-checkbox");
    await expect(checkbox).toHaveCount(1);

    await page.keyboard.press("Tab");
    await expect.poll(() => getDocument(page)).toBe("- [ ] task\n  plain");

    const focusState = await page.evaluate(() => {
      const active = document.activeElement;
      const checkbox = document.querySelector("input.cm-md-task-checkbox") as HTMLInputElement | null;
      return {
        checkboxTabIndex: checkbox?.tabIndex ?? null,
        activeIsCheckbox: active instanceof Element && active.matches("input.cm-md-task-checkbox"),
        activeInsideEditor: active instanceof Element && active.closest(".cm-editor") !== null,
      };
    });
    expect(focusState.checkboxTabIndex).toBe(-1);
    expect(focusState.activeIsCheckbox).toBe(false);
    expect(focusState.activeInsideEditor).toBe(true);
  });

  test("TV-396 Enter on an empty second bullet exits the list without making it loose", async ({ page }) => {
    await setDocument(page, "- one\n- ");
    await placeCaretAfter(page, "- one\n- ");

    await page.keyboard.press("Enter");

    await expect.poll(() => getDocument(page)).toBe("- one\n");
    expect(await getDocument(page)).not.toContain("\n\n- ");
  });

  test("TV-396 Enter continues unordered, ordered, and task list markup", async ({ page }) => {
    await setDocument(page, "- one");
    await placeCaretAfter(page, "- one");
    await page.keyboard.press("Enter");
    await expect.poll(() => getDocument(page)).toBe("- one\n- ");

    await setDocument(page, "1. one");
    await placeCaretAfter(page, "1. one");
    await page.keyboard.press("Enter");
    await expect.poll(() => getDocument(page)).toBe("1. one\n2. ");

    await setDocument(page, "- [ ] one");
    await placeCaretAfter(page, "- [ ] one");
    await page.keyboard.press("Enter");
    await expect.poll(() => getDocument(page)).toBe("- [ ] one\n- [ ] ");
  });

  test("TV-396 Enter between empty brackets still uses CodeMirror bracket explode", async ({ page }) => {
    await setDocument(page, "[]()");
    await placeCaretAfter(page, "[");

    await page.keyboard.press("Enter");

    await expect.poll(() => getDocument(page)).toBe("[\n\n]()");
  });

});
