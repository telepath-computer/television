import { expect, test, type Page } from "@playwright/test";
import { launchDesktop } from "./helpers.ts";

const HOST_FIXTURE = "/packages/desktop/test/e2e/fixtures/markdown-webview-host.html?mode=electron";
const STANDALONE_MARKDOWN = "/packages/view-markdown/src/index.html";

interface MarkdownWebviewWindow {
  __fixtureReady?: boolean;
  __markdownSaves: Array<{ artifactID: string; content: string }>;
  __failNextSave: boolean;
  __readEditor(): Promise<string>;
  __replaceEditor(content: string): Promise<void>;
  __hasContentBridge(): Promise<boolean>;
  __pushMarkdownContent(content: string): void;
  __fireContentChanged(content: string): void;
  __reloadMarkdownWebview(): Promise<void>;
  __disposeMarkdownHost(): void;
  __postUpdateFromWebview(content: string): Promise<void>;
}

async function launchMarkdownHost(): Promise<{ app: Awaited<ReturnType<typeof launchDesktop>>["app"]; page: Page }> {
  const { app, page } = await launchDesktop({ fixture: HOST_FIXTURE });
  await page.waitForFunction(() => (window as unknown as MarkdownWebviewWindow).__fixtureReady === true);
  await expect.poll(() => readEditor(page)).toBe("# Initial content");
  return { app, page };
}

async function readEditor(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__readEditor());
}

async function replaceEditor(page: Page, content: string): Promise<void> {
  await page.evaluate((value) => (window as unknown as MarkdownWebviewWindow).__replaceEditor(value), content);
}

async function saves(page: Page): Promise<Array<{ artifactID: string; content: string }>> {
  return page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__markdownSaves.slice());
}

test.describe("markdown webview content IPC", () => {
  test("receives initial content, exposes the content bridge, accepts host pushes, and saves edits", async () => {
    const { app, page } = await launchMarkdownHost();
    try {
      await expect.poll(() => page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__hasContentBridge())).toBe(true);

      await page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__pushMarkdownContent("# Host push"));
      await expect.poll(() => readEditor(page)).toBe("# Host push");

      await replaceEditor(page, "# Saved from webview");
      await expect.poll(() => saves(page)).toContainEqual({
        artifactID: "md-webview",
        content: "# Saved from webview",
      });
    } finally {
      await app.close();
    }
  });

  test("propagates save errors without corrupting the editor and allows retry", async () => {
    const { app, page } = await launchMarkdownHost();
    try {
      await page.evaluate(() => {
        (window as unknown as MarkdownWebviewWindow).__failNextSave = true;
      });
      await replaceEditor(page, "# Rejected save");
      await expect.poll(() => readEditor(page)).toBe("# Initial content");

      await replaceEditor(page, "# Retry save");
      await expect.poll(() => saves(page)).toContainEqual({
        artifactID: "md-webview",
        content: "# Retry save",
      });
      await expect.poll(() => readEditor(page)).toBe("# Retry save");
    } finally {
      await app.close();
    }
  });

  test("redelivers latched content after webview reload", async () => {
    const { app, page } = await launchMarkdownHost();
    try {
      await page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__pushMarkdownContent("# Survives reload"));
      await expect.poll(() => readEditor(page)).toBe("# Survives reload");

      await page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__reloadMarkdownWebview());
      await expect.poll(() => readEditor(page)).toBe("# Survives reload");
    } finally {
      await app.close();
    }
  });

  test("stops receiving update-content messages after host runtime dispose", async () => {
    const { app, page } = await launchMarkdownHost();
    try {
      const before = await saves(page);
      await page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__disposeMarkdownHost());
      await page.evaluate(() => (window as unknown as MarkdownWebviewWindow).__postUpdateFromWebview("# After dispose"));
      await page.waitForTimeout(200);
      expect(await saves(page)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  test("standalone markdown view without the webview bridge loads the fixture seed", async () => {
    const { app, page } = await launchDesktop({ fixture: STANDALONE_MARKDOWN });
    try {
      await expect.poll(() => page.evaluate(() =>
        (window as Window & { __cmView?: { state: { doc: { toString(): string } } } }).__cmView?.state.doc.toString() ?? "",
      )).toContain("# Heading 1");
      await expect(page.locator(".cm-content")).toContainText("Some paragraph text");
    } finally {
      await app.close();
    }
  });
});
