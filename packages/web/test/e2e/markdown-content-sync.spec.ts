import { type BrowserContext, type Locator, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";

async function defaultChannelID(server: ProductServer): Promise<string> {
  const response = await fetch(`${server.serverURL}/channels`);
  expect(response.status).toBe(200);
  const { channels } = (await response.json()) as { channels: Array<{ id: string }> };
  const channel = channels[0];
  if (!channel) throw new Error("Product server did not create a default channel");
  return channel.id;
}

async function createPathArtifact(
  server: ProductServer,
  filePath: string,
  title: string,
): Promise<{ id: string; path: string }> {
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "path", title, path: filePath, channelID: await defaultChannelID(server) }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { artifact: { id: string; path: string } };
  return body.artifact;
}

async function openApp(page: Page, server: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appBaseURL = await server.appURL(baseURL);
  await page.goto(`${appBaseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(appBaseURL)}`);
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
}

function artifactCard(page: Page, title: string): Locator {
  return page.locator(".artifact-view", { has: page.locator(".artifact-title", { hasText: title }) }).first();
}

function markdownEditor(page: Page, title: string): Locator {
  return artifactCard(page, title).locator("iframe.artifact-content").contentFrame().locator(".cm-content");
}

function createTempStorage(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-md-sync-e2e-"));
}

async function closePage(page: Page | null): Promise<void> {
  if (page && !page.isClosed()) await page.close();
}

async function closeContext(context: BrowserContext | null): Promise<void> {
  await context?.close();
}

async function disposeServer(server: ProductServer | null): Promise<void> {
  await server?.dispose();
}


test.describe("markdown content sync black-box acceptance", () => {
  test("syncs browser edits, restart persistence, and external file edits through real UI and disk", async ({ browser, baseURL }) => {

    const title = "Sync Note";
    const initialContent = "initial sync content";
    const browserEditedContent = "browser saved content";
    const externalContent = "external writer content";
    const storagePath = createTempStorage();
    const markdownPath = path.join(storagePath, "sync-note.md");

    let server: ProductServer | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      server = await launchProductServer({ home: storagePath, cleanupHome: false });
      writeFileSync(markdownPath, initialContent, "utf8");
      await createPathArtifact(server, markdownPath, title);

      context = await browser.newContext();
      page = await context.newPage();
      await openApp(page, server, baseURL);

      let editor = markdownEditor(page, title);
      await expect(editor).toContainText(initialContent, { timeout: 15_000 });

      await editor.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.type(browserEditedContent);

      await expect.poll(() => readFileSync(markdownPath, "utf8"), { timeout: 15_000 }).toBe(browserEditedContent);

      await closePage(page);
      page = null;
      await closeContext(context);
      context = null;
      await disposeServer(server);
      server = null;

      server = await launchProductServer({ home: storagePath, cleanupHome: false });
      context = await browser.newContext();
      page = await context.newPage();
      await openApp(page, server, baseURL);

      editor = markdownEditor(page, title);
      await expect(async () => {
        await expect(editor).toContainText(browserEditedContent);
        expect(readFileSync(markdownPath, "utf8")).toBe(browserEditedContent);
      }).toPass({ timeout: 15_000 });

      writeFileSync(markdownPath, externalContent, "utf8");

      await expect(async () => {
        await expect(editor).toContainText(externalContent);
        await expect(editor).not.toContainText(browserEditedContent);
        expect(readFileSync(markdownPath, "utf8")).toBe(externalContent);
      }).toPass({ timeout: 20_000 });
    } finally {
      await closePage(page);
      await closeContext(context);
      await disposeServer(server);
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
})
