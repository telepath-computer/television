import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { appearanceResolverScriptSource } from "@telepath-computer/television-artifact/browser";

const FIXTURE = "/packages/web/test/e2e/fixtures/markdown-editor-integration.html";
const V1_FIXTURE = "/packages/web/test/e2e/fixtures/markdown-v1-integration.html";

// Trust has no public presentation state; this helper is reserved for lifecycle-adoption evidence.
async function artifactTrustGuid(page: Page): Promise<string | null> {
  return page.locator(".artifact-view").evaluate((view) => (
    view as unknown as { _trustedChannel?: { currentGuid: string | null } }
  )._trustedChannel?.currentGuid ?? null);
}

test.describe("markdown editor integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/views/markdown/", async (route) => {
      const body = readFileSync(new URL("../../../view-markdown/src/index.html", import.meta.url), "utf8")
        .replace(
          "<head>",
          `<head><script>${appearanceResolverScriptSource('"system"')}</script>`,
        )
        .replace(
          "<body data-television-markdown-hosted>",
          '<body data-television-markdown-hosted data-television-markdown-test-hook>',
        )
        .replace('src="./main.ts"', 'src="/packages/view-markdown/src/main.ts"');
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body,
      });
    });
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-shared-assets
  test("the v1 files add only the editor API and editor-scoped styles", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);

    expect(await page.evaluate(() => window.__v1AddedGlobals)).toEqual([
      "TelevisionMarkdownEditor",
    ]);
    expect(await page.locator("#editor > .cm-editor")).toHaveCount(0);
    const script = await page.evaluate(async () => (
      await fetch("/packages/view-markdown/dist/v1/editor.js")
    ).text());
    expect(script).not.toContain("modulepreload");
    expect(script).not.toContain("data-television-markdown-hosted");
    expect(script).not.toContain("The view never transforms the source");

    const rules = await page.evaluate(() => {
      const sheet = [...document.styleSheets].find(
        candidate => candidate.href?.endsWith("/packages/view-markdown/dist/v1/editor.css"),
      );
      if (!sheet) throw new Error("missing v1 editor stylesheet");
      return [...sheet.cssRules].map(rule => ({
        type: rule.type,
        selector: rule instanceof CSSStyleRule ? rule.selectorText : null,
      }));
    });
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.type).toBe(1);
      for (const selector of rule.selector!.split(",")) {
        expect(selector.trim()).toMatch(/^#editor(?:\s|>)/);
      }
    }
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-shared-assets
  test("the v1 mount exposes only document controls and no production editor test hook", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);

    const keys = await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      const handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Stored document",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
        },
      });
      window.__v1Saves = [];
      window.__v1Handle = handle;
      return Object.keys(handle).sort();
    });

    expect(keys).toEqual(["dispose", "focus", "setEditable", "setValue"]);
    expect(await page.evaluate(() => "__cmView" in window)).toBe(false);
    await expect(page.locator(".cm-content")).toContainText("Stored document");

    await page.evaluate(() => window.__v1Handle!.setValue("Agent replacement"));
    await expect(page.locator(".cm-content")).toContainText("Agent replacement");
    expect(await page.evaluate(() => window.__v1Saves)).toEqual([]);

    await page.evaluate(() => window.__v1Handle!.focus());
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.evaluate(() => window.__v1Handle!.setEditable(false));
    await page.locator(".cm-content").press("ControlOrMeta+A");
    await page.keyboard.type("blocked");
    await expect(page.locator(".cm-content")).toContainText("Agent replacement");
    expect(await page.evaluate(() => window.__v1Saves)).toEqual([]);

    await page.evaluate(() => window.__v1Handle!.setEditable(true));
    await page.locator(".cm-content").press("ControlOrMeta+End");
    await page.locator(".cm-content").pressSequentially(" pending save");
    await page.evaluate(() => window.__v1Handle!.dispose());
    await expect(page.locator("#editor > .cm-editor")).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__v1Saves)).toEqual([]);
  });

  test("a matching authoritative value remains after its save promise rejects", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      let handle: MarkdownEditorV1Handle;
      handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Stored document",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          handle.setValue(value);
          throw Object.assign(new Error("acknowledgement lost"), { code: "disconnected" });
        },
      });
      window.__v1Handle = handle;
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Confirmed replacement");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Confirmed replacement"]);
    await expect(editor).toContainText("Confirmed replacement");
  });

  test("an older save confirmation preserves a newer local edit", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      window.__resolveFirstV1Save = undefined;
      const firstSave = new Promise<void>((resolve) => {
        window.__resolveFirstV1Save = resolve;
      });
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Stored document",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          if (window.__v1Saves!.length === 1) await firstSave;
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("First saved string");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["First saved string"]);
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Newer pending string");
    await page.evaluate(() => window.__v1Handle!.setValue("First saved string"));
    await expect(editor).toContainText("Newer pending string");
    await page.evaluate(() => window.__resolveFirstV1Save!());
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual([
      "First saved string",
      "Newer pending string",
    ]);
  });

  test("a later authoritative value is not mistaken for an earlier save confirmation", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      const pendingSave = new Promise<void>(() => {});
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Stored document",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          await pendingSave;
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Saved A");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Saved A"]);

    await page.evaluate(() => window.__v1Handle!.setValue("Authoritative B"));
    await expect(editor).toContainText("Authoritative B");
    await page.evaluate(() => window.__v1Handle!.setValue("Saved A"));
    await expect(editor).toContainText("Saved A");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-markdown-bridge-seam
  test("loads markdown bytes after lifecycle adoption, saves edits, and treats script source as text", async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const iframe = page.locator("iframe[src='/views/markdown/']");
    await expect.poll(() => artifactTrustGuid(page)).not.toBeNull();
    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect(frame.locator(".cm-content")).toContainText("Hello");
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Hello\n\n<script>window.__pwned = true</script>\n");
    await expect(frame.locator(".cm-content")).toContainText("<script>window.__pwned = true</script>");
    await expect(page.locator("iframe[src='/views/markdown/']")).not.toHaveAttribute("sandbox", /.*/);
    await expect.poll(() => page.evaluate(() => window.__pwned)).toBeUndefined();

    await frame.locator(".cm-content").click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type("# Saved markdown");

    await expect.poll(async () => page.evaluate(() => window.__savedMarkdown)).toEqual([
      { artifactID: "md", content: "# Saved markdown" },
    ]);
  });

  test("loads markdown when the iframe ready message arrives before the application is attached", async ({ page }) => {
    await page.goto(`${FIXTURE}?deferApplication=1`);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect(frame.locator(".cm-content")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__contentReadyBeforeApplication)).toBe(true);

    await page.evaluate(() => window.__attachApplication());
    await expect.poll(() => page.evaluate(() => window.__lastGet)).toEqual({ artifactID: "md" });

    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Hello\n\n<script>window.__pwned = true</script>\n");
  });

  test("keeps the markdown host latched when contentURL changes after iframe ready", async ({ page }) => {
    await page.goto(`${FIXTURE}?deferMarkdownGet=1`);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect(frame.locator(".cm-content")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__contentReadyMessages)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__markdownGetCalls)).toBe(1);

    await page.evaluate(() => {
      window.__setContentURL("http://television.test/markdown/md");
      window.__markdownContent = "# Loaded after content URL change";
      window.__resolveMarkdownGets();
    });

    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Loaded after content URL change");
    await expect.poll(() => page.evaluate(() => window.__markdownGetCalls)).toBe(1);
  });

  test("does not redeliver previous markdown content after an artifact document switch", async ({ page }) => {
    await page.goto(`${FIXTURE}?deferMarkdownGet=1`);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect.poll(() => page.evaluate(() => window.__markdownGetCalls)).toBe(1);
    await page.evaluate(() => window.__resolveMarkdownGets());
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Hello\n\n<script>window.__pwned = true</script>\n");

    await page.evaluate(() => {
      window.__markdownContents.md2 = "# Second artifact";
      window.__setArtifact({ id: "md2", title: "Second", path: "/tmp/second.md" });
    });
    await expect.poll(() => page.evaluate(() => window.__markdownGetCalls)).toBe(2);

    const readyBeforeReload = await page.evaluate(() => window.__contentReadyMessages ?? 0);
    await page.evaluate(() => window.__reloadMarkdownFrame());
    await expect.poll(() => page.evaluate(() => window.__contentReadyMessages)).toBeGreaterThan(readyBeforeReload);
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("");

    await page.evaluate(() => window.__resolveMarkdownGets());
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Second artifact");
  });

  test("reparents a loaded markdown artifact and re-applies the latched content", async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Hello\n\n<script>window.__pwned = true</script>\n");

    const readyBeforeReparent = await page.evaluate(() => window.__contentReadyMessages ?? 0);
    await page.evaluate(() => window.__reparentView());
    await expect.poll(() => page.evaluate(() => window.__contentReadyMessages)).toBeGreaterThan(readyBeforeReparent);
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Hello\n\n<script>window.__pwned = true</script>\n");
  });

  test("delivers a deferred markdown fetch to the recreated host after reparent", async ({ page }) => {
    await page.goto(`${FIXTURE}?deferMarkdownGet=1`);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect(frame.locator(".cm-content")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__markdownGetCalls)).toBe(1);

    const readyBeforeReparent = await page.evaluate(() => window.__contentReadyMessages ?? 0);
    await page.evaluate(() => window.__reparentView());
    await expect.poll(() => page.evaluate(() => window.__contentReadyMessages)).toBeGreaterThan(readyBeforeReparent);

    await page.evaluate(() => {
      window.__markdownContent = "# Delivered after reparent";
      window.__resolveMarkdownGets();
    });
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Delivered after reparent");
  });

  test("keeps markdown state while only theme changes refresh canonical", async ({ page }) => {
    const styleRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/canonical/v2/styles.css" || url.pathname === "/theme/theme.css") {
        styleRequests.push(`${url.pathname}${url.search}`);
      }
    });
    await page.route("**/canonical/v2/styles.css*", (route) => route.fulfill({
      contentType: "text/css",
      body: '@import url("/theme/theme.css");',
    }));
    await page.route("**/theme/theme.css*", (route) => route.fulfill({
      contentType: "text/css",
      body: '[data-theme="dark"] #editor { color: rgb(4, 5, 6); }',
    }));
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__fixtureReady === true);
    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect(frame.locator(".cm-content")).toContainText("Hello");
    await expect.poll(() => styleRequests).toEqual(expect.arrayContaining([
      "/canonical/v2/styles.css",
      "/theme/theme.css",
    ]));

    const initialCanonicalHref = await frame.locator(
      'link[data-television-style="canonical"]',
    ).getAttribute("href");
    await frame.locator("body").evaluate(() => {
      Object.assign(window, {
        __themeStyleState: {
          editor: document.querySelector(".cm-editor"),
          loadID: crypto.randomUUID(),
        },
      });
    });
    const initialRequestCount = styleRequests.length;

    await page.evaluate(() => window.__emitAppearanceChanged());
    expect(styleRequests).toHaveLength(initialRequestCount);
    await expect(frame.locator('link[data-television-style="canonical"]'))
      .toHaveAttribute("href", initialCanonicalHref ?? "/canonical/v2/styles.css");

    await page.evaluate(() => window.__emitThemeChanged());
    await expect.poll(async () => frame.locator(
      'link[data-television-style="canonical"]',
    ).getAttribute("href")).not.toBe(initialCanonicalHref);
    await expect.poll(() => styleRequests.length).toBeGreaterThan(initialRequestCount);
    expect(await frame.locator("body").evaluate(() => {
      const owner = window as unknown as {
        __themeStyleState: { editor: Element | null; loadID: string };
        __cmView?: { state: { doc: { toString(): string } } };
      };
      return {
        sameEditor: owner.__themeStyleState.editor === document.querySelector(".cm-editor"),
        loadID: owner.__themeStyleState.loadID,
        content: owner.__cmView?.state.doc.toString(),
      };
    })).toMatchObject({
      sameEditor: true,
      loadID: expect.any(String),
      content: "# Hello\n\n<script>window.__pwned = true</script>\n",
    });
  });

  test("refetches markdown content when the artifact content changes", async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__fixtureReady === true);
    const frame = page.frameLocator("iframe[src='/views/markdown/']");
    await expect(frame.locator(".cm-content")).toContainText("Hello");

    await page.evaluate(() => {
      window.__markdownContent = "# Changed remotely";
      window.__emitArtifactChanged();
    });

    await expect(frame.locator(".cm-content")).toContainText("Changed remotely");
    await expect.poll(async () => frame.locator("body").evaluate(() => window.__cmView?.state.doc.toString())).toBe("# Changed remotely");
  });

});

declare global {
  interface MarkdownEditorV1Handle {
    setValue(value: string): void;
    setEditable(editable: boolean): void;
    focus(): void;
    dispose(): void;
  }

  interface Window {
    __fixtureReady?: boolean;
    __markdownContent: string;
    __markdownContents: Record<string, string>;
    __savedMarkdown: Array<{ artifactID: string; content: string }>;
    __lastGet?: { artifactID: string };
    __markdownGetCalls?: number;
    __contentReadyBeforeApplication?: boolean;
    __contentReadyMessages?: number;
    __attachApplication(): void;
    __setContentURL(contentURL: string): void;
    __setArtifact(artifact: { id: string; title?: string; path?: string }): void;
    __reloadMarkdownFrame(): Promise<void>;
    __reparentView(): void;
    __resolveMarkdownGets(): void;
    __emitArtifactChanged(): void;
    __emitThemeChanged(): void;
    __emitAppearanceChanged(): void;
    __pwned?: boolean;
    __cmView?: { state: { doc: { toString(): string } } };
    TelevisionMarkdownEditor?: {
      mount(options: {
        parent: HTMLElement;
        value: string;
        editable: boolean;
        onSave(value: string): Promise<void>;
      }): MarkdownEditorV1Handle;
    };
    __v1Handle?: MarkdownEditorV1Handle;
    __v1Saves?: string[];
    __resolveFirstV1Save?: () => void;
    __v1GlobalsBefore: string[];
    __v1AddedGlobals: string[];
    __v1Ready?: boolean;
  }
}
