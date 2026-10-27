import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { lineWithText, setDocument } from "./markers.helpers.ts";

interface FirstFrameWindow extends Window {
  __markdownFirstFrame?: string | null;
}

test("resolves appearance before canonical and view styles", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("markdown appearance test requires baseURL");
  const built = readFileSync(new URL("../../dist/index.html", import.meta.url), "utf8");
  const builtHead = /<head>([\s\S]*?)<\/head>/.exec(built)?.[1]?.trimStart();
  expect(builtHead?.startsWith("<script>")).toBe(true);
  expect(builtHead?.indexOf("__televisionAppearanceResolver")).toBeGreaterThan(-1);
  const builtCanonicalAt = builtHead?.indexOf('/canonical/v2/styles.css') ?? -1;
  expect(builtCanonicalAt).toBeGreaterThan(
    builtHead?.indexOf("</script>") ?? Number.MAX_SAFE_INTEGER,
  );
  expect(builtHead?.lastIndexOf("<style>")).toBeGreaterThan(builtCanonicalAt);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.route("**/canonical/v2/styles.css", (route) => route.fulfill({
    contentType: "text/css",
    body: '@import url("/theme/theme.css");',
  }));
  await page.route("**/theme/theme.css", (route) => route.fulfill({
    contentType: "text/css",
    body: '[data-theme="dark"] #editor { color: rgb(4, 5, 6); }',
  }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      (window as FirstFrameWindow).__markdownFirstFrame =
        document.documentElement.dataset.theme ?? null;
    });
  });

  await page.goto(baseURL);
  await page.waitForFunction(() => "__markdownFirstFrame" in window);

  expect(await page.evaluate(() =>
    (window as FirstFrameWindow).__markdownFirstFrame
  )).toBe("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => {
    const children = [...document.head.children];
    const resolver = children.findIndex((element) =>
      element.tagName === "SCRIPT" &&
      element.textContent?.includes("__televisionAppearanceResolver") === true
    );
    const canonical = children.findIndex((element) =>
      element instanceof HTMLLinkElement &&
      element.dataset.televisionStyle === "canonical"
    );
    return {
      resolver,
      canonical,
      hasController: "__televisionAppearanceResolver" in window,
    };
  })).toMatchObject({
    resolver: expect.any(Number),
    canonical: expect.any(Number),
    hasController: true,
  });
  const order = await page.evaluate(() => {
    const children = [...document.head.children];
    return {
      resolver: children.findIndex((element) => element.tagName === "SCRIPT"),
      canonical: children.findIndex((element) =>
        element instanceof HTMLLinkElement && element.dataset.televisionStyle === "canonical"
      ),
    };
  });
  expect(order.resolver).toBeGreaterThanOrEqual(0);
  expect(order.canonical).toBeGreaterThan(order.resolver);
  await expect.poll(() => requests).toEqual(expect.arrayContaining([
    "/canonical/v2/styles.css",
    "/theme/theme.css",
  ]));
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-shared-source
test("uses one shared editor implementation in both source entries", () => {
  const main = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  const editorEntry = readFileSync(new URL("../../src/editor-entry.ts", import.meta.url), "utf8");
  expect(main).toMatch(/from ["']\.\/editor\.ts["']/);
  expect(editorEntry).toMatch(/from ["']\.\/editor\.ts["']/);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-editor-build
test("builds a self-contained file view and narrow packaged editor files", () => {
  const fileView = readFileSync(new URL("../../dist/index.html", import.meta.url), "utf8");
  expect(fileView).not.toMatch(/<script\b[^>]*\bsrc=/i);
  expect(fileView).not.toMatch(/<link\b[^>]*\brel=["']modulepreload["']/i);
  expect(fileView).toContain("The view never transforms the source");

  expect(fileView).toContain("__cmView");
  const packagedScript = readFileSync(new URL("../../../server/assets/templates/markdown/editor.js", import.meta.url), "utf8");
  const packagedStyle = readFileSync(new URL("../../../server/assets/templates/markdown/editor.css", import.meta.url), "utf8");
  expect(packagedScript).toMatch(/^\(\(\) => \{/);
  expect(packagedScript).not.toMatch(/^\s*(?:import|export)\b/m);
  expect(packagedScript).toContain("TelevisionMarkdownEditor");
  expect(packagedScript).not.toContain("The view never transforms the source");
  expect(packagedScript).not.toContain("modulepreload");
  expect(packagedStyle.length).toBeGreaterThan(0);
});

// proofs/ui/markdown-editor/index.md#^md-editor-t-build-order
test("ships the authoritative colour sheet after each implementation layout", () => {
  const main = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  const layoutImportAt = main.indexOf('import "./styles.css";');
  const editorImportAt = main.indexOf('import "./editor.css";');
  const colorImportAt = main.indexOf('import "./colors.css";');
  expect.soft(layoutImportAt).toBeGreaterThanOrEqual(0);
  expect.soft(editorImportAt).toBeGreaterThan(layoutImportAt);
  expect.soft(colorImportAt).toBeGreaterThan(editorImportAt);

  const built = readFileSync(new URL("../../dist/index.html", import.meta.url), "utf8");
  const inlinedStyles = [...built.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1] ?? "");
  expect.soft(inlinedStyles).toHaveLength(1);
  const builtStyle = inlinedStyles.at(-1) ?? "";
  const builtLayoutAt = builtStyle.indexOf("overscroll-behavior-x:contain");
  const builtEditorAt = builtStyle.indexOf("#editor>.cm-editor{height:100%}");
  const builtColorsAt = builtStyle.indexOf("--tbl-theme-row-background:");
  expect.soft(builtLayoutAt).toBeGreaterThanOrEqual(0);
  expect.soft(builtEditorAt).toBeGreaterThan(builtLayoutAt);
  expect.soft(builtColorsAt).toBeGreaterThan(builtEditorAt);

  const editorEntry = readFileSync(new URL("../../src/editor-entry.ts", import.meta.url), "utf8");
  const sharedEditorAt = editorEntry.indexOf('import "./editor.css";');
  const sharedColorsAt = editorEntry.indexOf('import "./colors.css";');
  expect.soft(sharedEditorAt).toBeGreaterThanOrEqual(0);
  expect.soft(sharedColorsAt).toBeGreaterThan(sharedEditorAt);

  const sharedBuiltStyle = readFileSync(new URL("../../../server/assets/templates/markdown/editor.css", import.meta.url), "utf8");
  const sharedBuiltEditorAt = sharedBuiltStyle.indexOf("#editor>.cm-editor{height:100%}");
  const sharedBuiltColorsAt = sharedBuiltStyle.indexOf("--tbl-theme-row-background:");
  expect.soft(sharedBuiltEditorAt).toBeGreaterThanOrEqual(0);
  expect.soft(sharedBuiltColorsAt).toBeGreaterThan(sharedBuiltEditorAt);
});

test("uses a custom theme's text color for native and CodeMirror cursors", async ({ page }) => {
  const themeTextColor = "rgb(238, 239, 240)";
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/theme/theme.css", (route) => route.fulfill({
    contentType: "text/css",
    body: `:root { --color-text: ${themeTextColor}; }`,
  }));

  await page.goto("/");
  const content = page.locator(".cm-content");
  await content.click();

  const colors = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    const content = editor?.querySelector<HTMLElement>(".cm-content");
    if (!editor || !content) throw new Error("CodeMirror editor not rendered");

    // The root editor currently uses its native caret. These probes also
    // exercise CodeMirror's transient drawn and drag-and-drop cursors.
    const cursor = document.createElement("div");
    cursor.className = "cm-cursor";
    editor.append(cursor);

    const dropCursor = document.createElement("div");
    dropCursor.className = "cm-dropCursor";
    editor.append(dropCursor);

    return {
      editor: getComputedStyle(editor).color,
      nativeCaret: getComputedStyle(content).caretColor,
      cursor: getComputedStyle(cursor).borderLeftColor,
      dropCursor: getComputedStyle(dropCursor).borderLeftColor,
    };
  });

  expect(colors).toEqual({
    editor: themeTextColor,
    nativeCaret: themeTextColor,
    cursor: themeTextColor,
    dropCursor: themeTextColor,
  });
});

test("uses dark-theme tokens for markers, bullets, and blockquotes", async ({ page }) => {
  const muted = "rgb(121, 132, 143)";
  const border = "rgb(71, 82, 93)";
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/theme/theme.css", (route) => route.fulfill({
    contentType: "text/css",
    body: `[data-theme="dark"] {
      --color-text-muted: ${muted};
      --color-border: ${border};
    }`,
  }));

  await page.goto("/");
  await setDocument(page, "# Source marker\n\n- Rendered bullet\n\n> Quoted text");

  const heading = lineWithText(page, "Source marker");
  await heading.click();
  const marker = heading.locator(".cm-md-mark").first();
  await expect(marker).toHaveText("# ");

  const bullet = lineWithText(page, "Rendered bullet");
  const quote = lineWithText(page, "Quoted text");
  const colors = await page.evaluate(({ muted, border }) => {
    const marker = document.querySelector<HTMLElement>(".cm-md-mark");
    const bullet = document.querySelector<HTMLElement>(".cm-md-list-bullet");
    const quote = document.querySelector<HTMLElement>(".cm-md-blockquote-line");
    if (!marker || !bullet || !quote) throw new Error("expected rendered Markdown decorations");
    return {
      expected: { muted, border },
      marker: getComputedStyle(marker).color,
      bullet: getComputedStyle(bullet, "::before").color,
      quote: getComputedStyle(quote).color,
      quoteBorder: getComputedStyle(quote).borderLeftColor,
    };
  }, { muted, border });

  await expect(bullet).toBeVisible();
  await expect(quote).toBeVisible();
  expect(colors).toEqual({
    expected: { muted, border },
    marker: muted,
    bullet: muted,
    quote: muted,
    quoteBorder: border,
  });
});
