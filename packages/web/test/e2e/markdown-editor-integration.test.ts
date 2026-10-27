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
        .replace('src="./main.ts"', 'src="/packages/view-markdown/src/main.ts"');
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body,
      });
    });
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-delivery
  test("the v1 files add only the editor API and editor-scoped styles", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);

    expect(await page.evaluate(() => window.__v1AddedGlobals)).toEqual([
      "TelevisionMarkdownEditor",
    ]);
    expect(await page.evaluate(() => window.__v1TrustedPolicyCreates)).toEqual([]);
    expect(await page.evaluate(() => document.head.innerHTML)).toBe(
      await page.evaluate(() => window.__v1HeadBefore),
    );
    expect(await page.locator("#editor > .cm-editor")).toHaveCount(0);
    const script = await page.evaluate(async () => (
      await fetch("/packages/view-markdown/dist/v1/editor.js")
    ).text());
    expect(script).not.toContain("modulepreload");
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
    expect(await page.locator("#outside-editor").evaluate(element => ({
      display: getComputedStyle(element).display,
      position: getComputedStyle(element).position,
    }))).toEqual({ display: "block", position: "static" });
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
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
      return Reflect.ownKeys(handle).map(String).sort();
    });

    expect(keys).toEqual(["dispose", "focus", "setEditable", "setValue"]);
    expect(await page.evaluate(() => "__cmView" in window)).toBe(false);
    await expect(page.locator("#editor > .cm-editor")).toHaveCount(1);
    await expect(page.locator(".cm-content")).toContainText("Stored document");

    await page.evaluate(() => window.__v1Handle!.setValue("Agent replacement"));
    await expect(page.locator(".cm-content")).toContainText("Agent replacement");
    expect(await page.evaluate(() => window.__v1Saves)).toEqual([]);

    await page.locator(".cm-content").press("ControlOrMeta+End");
    await page.keyboard.insertText(" edited");
    await page.locator(".cm-content").press("ControlOrMeta+Z");
    await expect(page.locator(".cm-content")).toHaveText("Agent replacement");

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

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("an equal authoritative value records the current text without replacing it", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Initial stored value",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          throw new Error("save refused");
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Current local string");
    await editor.press("ArrowLeft");
    const sameValue = await page.evaluate(async () => {
      const content = document.querySelector<HTMLElement>(".cm-content");
      if (!content) throw new Error("missing editor content");
      const before = window.getSelection()?.anchorOffset;
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(content, { childList: true, characterData: true, subtree: true });
      window.__v1Handle!.setValue("Current local string");
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      observer.disconnect();
      return {
        active: document.activeElement === content,
        before,
        after: window.getSelection()?.anchorOffset,
        mutations,
      };
    });
    expect(sameValue).toEqual({ active: true, before: 19, after: 19, mutations: 0 });
    expect(await page.evaluate(() => window.__v1Saves)).toEqual([]);

    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Refused later save");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Refused later save"]);
    await expect(editor).toHaveText("Current local string");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a matching authoritative value remains after its save promise rejects", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      const pendingSave = new Promise<void>((_resolve, reject) => {
        window.__rejectV1Save = reject;
      });
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Stored document",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          window.__v1Handle!.setValue(value);
          await pendingSave;
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText("Confirmed replacement");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Confirmed replacement"]);
    await editor.press("ControlOrMeta+End");
    await page.keyboard.insertText(" with newer typing");
    await page.evaluate(() => window.__rejectV1Save!(
      Object.assign(new Error("acknowledgement lost"), { code: "disconnected" }),
    ));
    await expect(editor).toHaveText("Confirmed replacement with newer typing");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual([
      "Confirmed replacement",
      "Confirmed replacement with newer typing",
    ]);
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
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

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a value received during a save disqualifies its later completed-save echo", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      const pendingSave = new Promise<void>((resolve) => {
        window.__resolveFirstV1Save = resolve;
      });
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
    await page.evaluate(() => window.__resolveFirstV1Save!());
    await page.waitForTimeout(0);
    await page.evaluate(() => window.__v1Handle!.setValue("Saved A"));
    await expect(editor).toContainText("Saved A");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a completed save does not replace a newer authoritative rollback baseline", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      const firstSave = new Promise<void>((resolve) => {
        window.__resolveFirstV1Save = resolve;
      });
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Initially stored",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          if (window.__v1Saves!.length === 1) {
            await firstSave;
            window.__firstV1SaveFinished = true;
            return;
          }
          throw new Error("later save refused");
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText("Saved A");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Saved A"]);

    await page.evaluate(() => window.__v1Handle!.setValue("Authoritative B"));
    await expect(editor).toHaveText("Authoritative B");
    await page.evaluate(() => window.__resolveFirstV1Save!());
    await page.waitForFunction(() => window.__firstV1SaveFinished === true);

    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText("Refused C");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual([
      "Saved A",
      "Refused C",
    ]);
    await expect(editor).toHaveText("Authoritative B");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("disabling editing cancels a local change waiting for its save pause", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Stored document",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+End");
    await page.keyboard.insertText(" unsent draft");
    await page.evaluate(() => window.__v1Handle!.setEditable(false));
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__v1Saves)).toEqual([]);
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("setValue replaces a newer draft after editing is disabled", async ({ page }) => {
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
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially("x");
    await editor.press("Backspace");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Stored document"]);

    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially(" newer draft");
    await page.evaluate(() => {
      window.__v1Handle!.setEditable(false);
      window.__v1Handle!.setValue("Stored document");
    });
    await expect(editor).toHaveText("Stored document");
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__v1Saves)).toEqual(["Stored document"]);
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a temporary disabled interval does not forget a save still in progress", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
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
    await page.keyboard.insertText("Saved string");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Saved string"]);

    await page.evaluate(() => {
      window.__v1Handle!.setEditable(false);
      window.__v1Handle!.setEditable(true);
    });
    await editor.press("ControlOrMeta+End");
    await page.keyboard.insertText(" with newer typing");
    await page.evaluate(() => window.__v1Handle!.setValue("Saved string"));
    await expect(editor).toHaveText("Saved string with newer typing");
    await page.evaluate(() => window.__resolveFirstV1Save!());
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual([
      "Saved string",
      "Saved string with newer typing",
    ]);
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a refused save does not replace a newer authoritative value", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      const pendingSave = new Promise<void>((_resolve, reject) => {
        window.__rejectV1Save = reject;
      });
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
    await editor.pressSequentially("Person save");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Person save"]);
    await page.evaluate(() => {
      window.__v1Handle!.setValue("Newer stored value");
      window.__rejectV1Save!(new Error("save refused"));
    });
    await expect(editor).toHaveText("Newer stored value");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a completed save becomes the rollback baseline", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Initial stored value",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
          if (window.__v1Saves!.length > 1) throw new Error("save refused");
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Completed save");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Completed save"]);
    await page.waitForTimeout(0);

    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Refused later save");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual([
      "Completed save",
      "Refused later save",
    ]);
    await expect(editor).toHaveText("Completed save");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-v1-interface
  test("a repeated completed save preserves newer typing and its pending save", async ({ page }) => {
    await page.goto(V1_FIXTURE);
    await page.waitForFunction(() => window.__v1Ready === true);
    await page.evaluate(() => {
      const parent = document.querySelector<HTMLElement>("#editor");
      if (!parent) throw new Error("missing editor parent");
      window.__v1Saves = [];
      window.__v1Handle = window.TelevisionMarkdownEditor!.mount({
        parent,
        value: "Initial stored value",
        editable: true,
        async onSave(value) {
          window.__v1Saves!.push(value);
        },
      });
    });

    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText("Completed save");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual(["Completed save"]);
    await page.waitForTimeout(0);

    await editor.press("ControlOrMeta+End");
    await page.keyboard.insertText(" with newer typing");
    expect(await page.evaluate(() => window.__v1Saves)).toEqual(["Completed save"]);
    await page.evaluate(() => window.__v1Handle!.setValue("Completed save"));
    await expect(editor).toHaveText("Completed save with newer typing");
    await expect.poll(() => page.evaluate(() => window.__v1Saves)).toEqual([
      "Completed save",
      "Completed save with newer typing",
    ]);
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

  test("file editor keeps newer typing when the watcher repeats a completed save", async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__fixtureReady === true);

    const editor = page.frameLocator("iframe[src='/views/markdown/']").locator(".cm-content");
    await expect(editor).toContainText("Hello");
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.insertText("First saved text");
    await expect.poll(() => page.evaluate(() => window.__savedMarkdown)).toEqual([
      { artifactID: "md", content: "First saved text" },
    ]);
    // Let the save response and its first content echo finish before posing the
    // later file-watcher delivery.
    await page.waitForTimeout(50);

    await editor.press("ControlOrMeta+End");
    await page.keyboard.insertText(" with newer typing");
    await expect(editor).toHaveText("First saved text with newer typing");
    expect(await page.evaluate(() => window.__savedMarkdown)).toEqual([
      { artifactID: "md", content: "First saved text" },
    ]);
    await page.evaluate(() => window.__emitArtifactChanged());
    await page.waitForTimeout(50);
    await expect(editor).toHaveText("First saved text with newer typing");
    expect(await page.evaluate(() => window.__savedMarkdown)).toEqual([
      { artifactID: "md", content: "First saved text" },
    ]);
    await expect.poll(() => page.evaluate(() => window.__savedMarkdown)).toEqual([
      { artifactID: "md", content: "First saved text" },
      { artifactID: "md", content: "First saved text with newer typing" },
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
    __firstV1SaveFinished?: boolean;
    __rejectV1Save?: (reason?: unknown) => void;
    __v1GlobalsBefore: string[];
    __v1AddedGlobals: string[];
    __v1HeadBefore: string;
    __v1TrustedPolicyCreates: string[];
    __v1Ready?: boolean;
  }
}
