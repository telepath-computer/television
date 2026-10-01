import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { marked } from "marked";
import { MARKDOWN_DOC_CSS } from "../../src/markdown-doc-style.ts";

// Real-browser checks for the server's read-only Markdown styling
// (`MARKDOWN_DOC_CSS`, inlined after the canonical <link> by the artifact
// proxy's `markdownDocument()`). The hard part — bullets, ordered numbers, and
// task checkboxes all centred in one marker column with their text starting at
// one shared x across tight AND loose lists — only resolves under a real layout
// engine, so every assertion reads `getComputedStyle` / `getBoundingClientRect`
// in Chromium.
//
// The canonical design tokens (`--space-*`, `--font-*`, `--text-base`, …) that
// MARKDOWN_DOC_CSS references live in the built canonical bundle; we read it
// off disk and inline it ahead of the doc sheet, mirroring the real document
// the proxy serves.

const CANONICAL_CSS = readFileSync(
  fileURLToPath(
    new URL("../../dist/canonical/v2/styles.css", import.meta.url),
  ),
  "utf8",
);

function render(markdown: string): string {
  const body = marked.parse(markdown, { async: false });
  return [
    "<!doctype html>",
    "<html><head>",
    `<style>${CANONICAL_CSS}</style>`,
    `<style>${MARKDOWN_DOC_CSS}</style>`,
    "</head>",
    `<body>${body}</body></html>`,
  ].join("");
}

async function load(page: Page, markdown: string): Promise<void> {
  await page.setContent(render(markdown), { waitUntil: "load" });
}

async function loadDarkTheme(
  page: Page,
  markdown: string,
  tokens: { muted: string; border: string },
): Promise<void> {
  const body = marked.parse(markdown, { async: false });
  const html = [
    "<!doctype html>",
    '<html data-theme="dark"><head>',
    `<style>${CANONICAL_CSS}</style>`,
    `<style>${MARKDOWN_DOC_CSS}</style>`,
    `<style>[data-theme="dark"] {
      --color-text-muted: ${tokens.muted};
      --color-border: ${tokens.border};
    }</style>`,
    "</head>",
    `<body>${body}</body></html>`,
  ].join("");
  await page.setContent(html, { waitUntil: "load" });
}

// As `load`, but forces a non-default body line-height. The canonical sheet
// pins `--leading-base: 1.5`; this overrides it so the first text line's box is
// far taller than at the default. A checkbox centred with a fixed-em offset
// (half a 1.5 line box) would drift well off centre here, while one centred on
// the real computed line-height (`0.5lh`) stays put.
async function loadWithLineHeight(
  page: Page,
  markdown: string,
  lineHeight: number,
): Promise<void> {
  const body = marked.parse(markdown, { async: false });
  const html = [
    "<!doctype html>",
    "<html><head>",
    `<style>${CANONICAL_CSS}</style>`,
    `<style>${MARKDOWN_DOC_CSS}</style>`,
    `<style>body { line-height: ${lineHeight}; }</style>`,
    "</head>",
    `<body>${body}</body></html>`,
  ].join("");
  await page.setContent(html, { waitUntil: "load" });
}

// Left x of the first non-whitespace text character inside `li`, measured with
// a one-character Range over the first text node — the only reliable way to
// find where the content actually begins (the <li> box, an inline <p>, and the
// marker each have their own geometry).
function firstCharLeft(li: Locator): Promise<number> {
  return li.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = (node.textContent ?? "").search(/\S/);
      if (offset === -1) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().left;
    }
    throw new Error("no text node found in <li>");
  });
}

// Vertical centre of the first text line inside `li`, measured the same way.
function firstLineVCenter(li: Locator): Promise<number> {
  return li.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = (node.textContent ?? "").search(/\S/);
      if (offset === -1) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const r = range.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    }
    throw new Error("no text node found in <li>");
  });
}

// Horizontal centre of the hand-drawn ::before marker. The marker is an
// inline-block of the full gutter width pulled into the gutter with a negative
// left margin, so its box is [li content-edge + marginLeft, + width]. A pseudo
// can't be ranged, so we reconstruct its box from the li's content edge and the
// computed ::before width/margin.
function markerCenter(li: Locator): Promise<number> {
  return li.evaluate((el) => {
    const before = getComputedStyle(el, "::before");
    const liCS = getComputedStyle(el);
    const liRect = el.getBoundingClientRect();
    const contentLeft =
      liRect.left +
      parseFloat(liCS.borderLeftWidth) +
      parseFloat(liCS.paddingLeft);
    const beforeLeft = contentLeft + parseFloat(before.marginLeft);
    return beforeLeft + parseFloat(before.width) / 2;
  });
}

// Geometry of a task item's checkbox.
function checkboxBox(
  li: Locator,
): Promise<{ left: number; right: number; center: number; vcenter: number }> {
  return li.locator("input[type=checkbox]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      center: (r.left + r.right) / 2,
      vcenter: (r.top + r.bottom) / 2,
    };
  });
}

test.describe("read-only markdown list markers", () => {
  test("list item content aligns across every list type, tight and loose", async ({
    page,
  }) => {
    // The crux requirement: the TEXT of every list item must start at the same
    // x, regardless of marker width — bullet, ordered (incl. multi-digit),
    // task, tight AND loose. The two-column mechanism puts every marker in a
    // fixed-width gutter and starts all content at one shared edge.
    await load(
      page,
      [
        "- tight bullet",
        "",
        "1. tight number",
        "",
        "- [ ] tight task",
        "",
        "9. nine",
        "10. ten",
        "",
        "- loose bullet alpha",
        "",
        "- loose bullet beta",
        "",
        "- [ ] loose task alpha",
        "",
        "- [x] loose task beta",
        "",
      ].join("\n"),
    );

    const byText = (text: string) =>
      firstCharLeft(page.locator("li").filter({ hasText: text }).first());

    const lefts = {
      tightBullet: await byText("tight bullet"),
      tightNumber: await byText("tight number"),
      tightTask: await byText("tight task"),
      nine: await byText("nine"),
      ten: await byText("ten"),
      looseBullet: await byText("loose bullet alpha"),
      looseTask: await byText("loose task alpha"),
    };

    const values = Object.values(lefts);
    const spread = Math.max(...values) - Math.min(...values);
    // Every list item's text starts within ~2px of every other's.
    expect(spread, JSON.stringify(lefts, null, 2)).toBeLessThanOrEqual(2);
  });

  test("markers and checkbox are centred in one shared marker column", async ({
    page,
  }) => {
    // The new guarantee: bullet, ordered number (single AND multi-digit) and
    // the task checkbox all sit HORIZONTALLY CENTRED within the fixed-width
    // gutter, so their centres form one clean column regardless of glyph width.
    await load(
      page,
      [
        "- bullet item",
        "",
        "1. one",
        "",
        "9. nine",
        "10. ten",
        "",
        "- [ ] tight task",
        "",
        "- [x] loose task",
        "",
      ].join("\n"),
    );

    const byText = (text: string) =>
      page.locator("li").filter({ hasText: text }).first();

    const centers = {
      bullet: await markerCenter(byText("bullet item")),
      one: await markerCenter(byText("one")),
      nine: await markerCenter(byText("nine")),
      ten: await markerCenter(byText("ten")),
      tightTask: (await checkboxBox(byText("tight task"))).center,
      looseTask: (await checkboxBox(byText("loose task"))).center,
    };

    const values = Object.values(centers);
    const spread = Math.max(...values) - Math.min(...values);
    // Bullet, number and checkbox centres coincide within ~2px.
    expect(spread, JSON.stringify(centers, null, 2)).toBeLessThanOrEqual(2);
  });

  test("task checkbox is vertically centred on its first text line, tight and loose", async ({
    page,
  }) => {
    // The checkbox is a replaced element taken out of flow; it must still sit
    // vertically centred on the first line of its text (a regression the prior
    // absolute-positioned mechanism lost).
    await load(page, "- [ ] tight task\n\n- [x] loose task\n");

    const tight = page.locator("li").filter({ hasText: "tight task" }).first();
    const loose = page.locator("li").filter({ hasText: "loose task" }).first();

    const tightDelta = Math.abs(
      (await checkboxBox(tight)).vcenter - (await firstLineVCenter(tight)),
    );
    const looseDelta = Math.abs(
      (await checkboxBox(loose)).vcenter - (await firstLineVCenter(loose)),
    );

    expect(tightDelta, `tight delta ${tightDelta}`).toBeLessThanOrEqual(2);
    expect(looseDelta, `loose delta ${looseDelta}`).toBeLessThanOrEqual(2);
  });

  test("task checkbox stays vertically centred when the line-height changes", async ({
    page,
  }) => {
    // The checkbox's vertical anchor must track the ACTUAL line-height, not a
    // hard-coded half-line-box guess for the canonical 1.5. Force a line-height
    // far from the default (3) and the checkbox must still land on the centre of
    // its first text line. With a fixed `top: 0.75em` the checkbox sits near the
    // top of the now-much-taller line box and is mis-centred; with `top: 0.5lh`
    // (half the real line box) it stays centred.
    await loadWithLineHeight(page, "- [ ] tight task\n\n- [x] loose task\n", 3);

    const tight = page.locator("li").filter({ hasText: "tight task" }).first();
    const loose = page.locator("li").filter({ hasText: "loose task" }).first();

    const tightDelta = Math.abs(
      (await checkboxBox(tight)).vcenter - (await firstLineVCenter(tight)),
    );
    const looseDelta = Math.abs(
      (await checkboxBox(loose)).vcenter - (await firstLineVCenter(loose)),
    );

    expect(tightDelta, `tight delta ${tightDelta}`).toBeLessThanOrEqual(2);
    expect(looseDelta, `loose delta ${looseDelta}`).toBeLessThanOrEqual(2);
  });

  test("ordered list renders sequential numbers via the ::before counter", async ({
    page,
  }) => {
    await load(page, "1. one\n2. two\n3. three\n");

    const items = page.locator("ol > li");
    await expect(items).toHaveCount(3);

    // Numbering comes from a CSS counter on ::before, not native ::marker:
    // native markers are suppressed and each item's ::before is the counter.
    const listStyleType = await page
      .locator("ol")
      .evaluate((el) => getComputedStyle(el).listStyleType);
    expect(listStyleType).toBe("none");
    const counterReset = await page
      .locator("ol")
      .evaluate((el) => getComputedStyle(el).counterReset);
    expect(counterReset).toContain("md-ol");

    for (let i = 0; i < 3; i += 1) {
      const content = await items
        .nth(i)
        .evaluate((el) => getComputedStyle(el, "::before").content);
      // Chromium reports computed `content` with the counter() unresolved, so
      // assert the counter expression is wired on every item.
      expect(content).toContain("counter(md-ol)");
    }

    // The counter actually resolves to distinct, incrementing glyphs (1. 2. 3.):
    // fingerprint each item's marker-gutter crop; the three must differ.
    const rows = await items.evaluateAll((lis) =>
      lis.map((li) => {
        const r = li.getBoundingClientRect();
        return { top: r.top, left: r.left, height: r.height };
      }),
    );
    const fingerprints: number[] = [];
    for (const row of rows) {
      const crop = await page.screenshot({
        clip: { x: row.left, y: row.top, width: 28, height: row.height },
      });
      let sum = 0;
      for (const byte of crop) sum = (sum + byte) >>> 0;
      fingerprints.push(sum);
    }
    expect(new Set(fingerprints).size, JSON.stringify(fingerprints)).toBe(3);
  });

  test("task list shows the checkbox and no marker glyph, tight and loose", async ({
    page,
  }) => {
    for (const markdown of ["- [ ] a\n- [x] b\n", "- [ ] a\n\n- [x] b\n"]) {
      await load(page, markdown);
      const items = page.locator("li");
      await expect(items).toHaveCount(2);
      for (let i = 0; i < 2; i += 1) {
        const li = items.nth(i);
        await expect(li.locator("input[type=checkbox]")).toHaveCount(1);
        // Native marker suppressed.
        const listStyleType = await li.evaluate(
          (el) => getComputedStyle(el).listStyleType,
        );
        expect(listStyleType).toBe("none");
        // Hand-drawn ::before glyph suppressed on task items.
        const beforeContent = await li.evaluate(
          (el) => getComputedStyle(el, "::before").content,
        );
        expect(beforeContent === "none" || beforeContent === "normal").toBe(
          true,
        );
      }
    }
  });

  test("loose bullet list keeps the marker on the same line as its text", async ({
    page,
  }) => {
    await load(page, "- alpha\n\n- beta\n");

    // The first item's text sits in a <p> (loose list). Its top must line up
    // with the marker, i.e. the marker is NOT pushed onto its own line above
    // the text (a bug the inline-block ::before could otherwise reintroduce).
    const li = page.locator("li").first();
    const markerTop = await li.evaluate(
      (el) => (el as HTMLElement).getBoundingClientRect().top,
    );
    const textTop = await li
      .locator("p")
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().top;
      });
    // Marker glyph and first text line share a row: their tops are within a
    // line-height of each other (a marker on its own line would be a full line
    // above, ~20px+ at this font size).
    expect(Math.abs(textTop - markerTop)).toBeLessThan(8);
  });

  test("list markers and blockquotes use dark-theme text and border tokens", async ({ page }) => {
    const tokens = {
      muted: "rgb(121, 132, 143)",
      border: "rgb(71, 82, 93)",
    };
    await loadDarkTheme(page, "- list item\n\n> quoted text\n", tokens);

    const markerColor = await page.locator("li").first().evaluate(
      (el) => getComputedStyle(el, "::before").color,
    );
    const quoteColors = await page.locator("blockquote").evaluate((el) => {
      const style = getComputedStyle(el);
      return { text: style.color, border: style.borderLeftColor };
    });
    expect(markerColor).toBe(tokens.muted);
    expect(quoteColors).toEqual({ text: tokens.muted, border: tokens.border });
  });
});

test.describe("read-only markdown core parity", () => {
  test("links render muted grey + underlined", async ({ page }) => {
    await load(page, "[label](https://example.com)\n");
    const a = page.locator("a").first();
    const style = await a.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, decoration: cs.textDecorationLine };
    });
    expect(style.color).toBe("rgba(0, 0, 0, 0.55)");
    expect(style.decoration).toContain("underline");
  });

  test("strong text is weight 600", async ({ page }) => {
    await load(page, "**bold**\n");
    const weight = await page
      .locator("strong")
      .first()
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weight).toBe("600");
  });

  test("inline code carries the light wash background", async ({ page }) => {
    await load(page, "text with `code` inline\n");
    const bg = await page
      .locator("code")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0.06)");
  });

  test("body uses the editor document padding", async ({ page }) => {
    await load(page, "text\n");
    const padding = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { top: cs.paddingTop, right: cs.paddingRight };
    });
    // 1.5rem / 1rem against the canonical root font-size resolve to 24px / 16px.
    expect(padding.top).toBe("24px");
    expect(padding.right).toBe("16px");
  });
});
