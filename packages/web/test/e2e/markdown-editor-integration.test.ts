import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { appearanceResolverScriptSource } from "@telepath-computer/television-artifact/browser";

const FIXTURE = "/packages/web/test/e2e/fixtures/markdown-editor-integration.html";

// Trust has no public presentation state; this helper is reserved for lifecycle-adoption evidence.
async function artifactTrustGuid(page: Page): Promise<string | null> {
  return page.locator(".artifact-view").evaluate((view) => (
    view as unknown as { _trustedChannel?: { currentGuid: string | null } }
  )._trustedChannel?.currentGuid ?? null);
}

test.describe("markdown editor integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/views/markdown/", async (route) => {
      const body = readFileSync("../view-markdown/src/index.html", "utf8")
        .replace(
          "<head>",
          `<head><script>${appearanceResolverScriptSource('"system"')}</script>`,
        )
        .replace('src="./main.ts"', 'src="/packages/view-markdown/src/main.ts"');
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body,
      });
    });
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
  }
}
