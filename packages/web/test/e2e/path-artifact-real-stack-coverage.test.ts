import { type Locator, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import {
  APPLICATION_SHELL_STATES,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion } from "./helpers.ts";

function html(body: string, head = ""): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function encodedArtifactPathPattern(artifactID: string, basename: string): RegExp {
  return new RegExp(`/artifact/${escapeRegExp(artifactID)}/${escapeRegExp(encodeURIComponent(basename))}(?:\\?.*)?$`);
}

function createTempStorage(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-path-artifact-e2e-"));
}

async function disposeServer(server: ProductServer | null): Promise<void> {
  await server?.dispose();
}


test.describe("path artifact real-stack coverage", () => {
  test("live file watcher updates markdown, HTML file, and directory artifacts in the browser", async ({ page, baseURL }) => {
    let server: ProductServer | null = await launchProductServer();

    try {
      const markdownPath = path.join(server.home, "live-note.md");
      const htmlPath = path.join(server.home, "live-page.html");
      const dirPath = path.join(server.home, "live-dir");
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(markdownPath, "# Markdown version one", "utf8");
      writeFileSync(htmlPath, html('<h1 id="msg">HTML version one</h1>'), "utf8");
      writeFileSync(path.join(dirPath, "index.html"), html('<h1 id="msg">Directory version one</h1>'), "utf8");

      await createPathArtifact(server, markdownPath, "Live Markdown");
      await createPathArtifact(server, htmlPath, "Live HTML");
      await createPathArtifact(server, dirPath, "Live Directory");

      await openApp(page, server, baseURL);

      const markdownEditor = artifactCard(page, "Live Markdown").locator("iframe.artifact-content").contentFrame().locator(".cm-content");
      const htmlFrame = artifactCard(page, "Live HTML").locator("iframe.artifact-content").contentFrame();
      const dirFrame = artifactCard(page, "Live Directory").locator("iframe.artifact-content").contentFrame();

      await expect(markdownEditor).toContainText("Markdown version one", { timeout: 15_000 });
      writeFileSync(markdownPath, "# Markdown version two", "utf8");
      await expect(markdownEditor).toContainText("Markdown version two", { timeout: 15_000 });

      await expect(htmlFrame.locator("#msg")).toHaveText("HTML version one");
      writeFileSync(htmlPath, html('<h1 id="msg">HTML version two</h1>'), "utf8");
      await expect(htmlFrame.locator("#msg")).toHaveText("HTML version two", { timeout: 15_000 });

      await expect(dirFrame.locator("#msg")).toHaveText("Directory version one");
      writeFileSync(path.join(dirPath, "index.html"), html('<h1 id="msg">Directory version two</h1>'), "utf8");
      await expect(dirFrame.locator("#msg")).toHaveText("Directory version two", { timeout: 15_000 });

      unlinkSync(path.join(dirPath, "index.html"));
      await expect(dirFrame.locator("body")).toContainText("Artifact file not found", { timeout: 15_000 });
      await expect(dirFrame.locator("body")).toContainText(`${dirPath}${path.sep}`);

      writeFileSync(path.join(dirPath, "index.html"), html('<h1 id="msg">Directory recovered</h1>'), "utf8");
      await expect(dirFrame.locator("#msg")).toHaveText("Directory recovered", { timeout: 20_000 });
    } finally {
      await disposeServer(server);
      server = null;
    }
  });

  test("reloads a folder artifact when a subdirectory stylesheet changes (^af-ac-folder-source)", async ({ page }) => {
    let server: ProductServer | null = await launchProductServer();

    try {
      const dirPath = path.join(server.home, "nested-style-dir");
      const stylesPath = path.join(dirPath, "assets", "styles");
      const indexPath = path.join(dirPath, "index.html");
      const stylesheetPath = path.join(stylesPath, "artifact.css");
      mkdirSync(stylesPath, { recursive: true });
      writeFileSync(
        indexPath,
        html('<main id="probe">Nested stylesheet</main>', '<link rel="stylesheet" href="assets/styles/artifact.css">'),
        "utf8",
      );
      writeFileSync(stylesheetPath, "#probe { color: rgb(17, 34, 51); }\n", "utf8");
      const indexBytes = readFileSync(indexPath);
      await createPathArtifact(server, dirPath, "Nested Stylesheet");

      await page.goto(server.serverURL);
      await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);

      const probe = artifactCard(page, "Nested Stylesheet")
        .locator("iframe.artifact-content")
        .contentFrame()
        .locator("#probe");
      await expect(probe).toHaveCSS("color", "rgb(17, 34, 51)", { timeout: 15_000 });

      writeFileSync(stylesheetPath, "#probe { color: rgb(68, 85, 102); }\n", "utf8");
      expect(readFileSync(indexPath).equals(indexBytes)).toBe(true);

      await expect(probe).toHaveCSS("color", "rgb(68, 85, 102)", { timeout: 15_000 });
    } finally {
      await disposeServer(server);
      server = null;
    }
  });

  test("edge-case basenames and uppercase extensions resolve through the real proxy and browser", async ({ page, baseURL }) => {
    let server: ProductServer | null = await launchProductServer();

    try {
      const cases = [
        { basename: "space name.html", title: "Space Basename", text: "space basename" },
        { basename: "unicodé-雪.html", title: "Unicode Basename", text: "unicode basename" },
        { basename: "percent%.html", title: "Percent Basename", text: "percent basename" },
        { basename: "hash#.html", title: "Hash Basename", text: "hash basename" },
        { basename: "question?.html", title: "Question Basename", text: "question basename" },
        { basename: "UPPER.HTML", title: "Uppercase HTML", text: "uppercase html" },
      ];
      const created: Array<{ id: string; basename: string; title: string; text: string }> = [];
      for (const item of cases) {
        const filePath = path.join(server.home, item.basename);
        writeFileSync(filePath, html(`<h1>${item.text}</h1>`), "utf8");
        const artifact = await createPathArtifact(server, filePath, item.title);
        created.push({ ...item, id: artifact.id });
      }

      const uppercaseMarkdownPath = path.join(server.home, "LOUD.MD");
      writeFileSync(uppercaseMarkdownPath, "# Uppercase markdown", "utf8");
      await createPathArtifact(server, uppercaseMarkdownPath, "Uppercase Markdown");

      const dottedDirectoryPath = path.join(server.home, "notes.md");
      mkdirSync(dottedDirectoryPath, { recursive: true });
      writeFileSync(path.join(dottedDirectoryPath, "index.html"), html("<h1>directory named notes.md</h1>"), "utf8");
      const dottedDirectory = await createPathArtifact(server, dottedDirectoryPath, "Directory Named Notes MD");
      expect(dottedDirectory.path).toBe(`${dottedDirectoryPath}${path.sep}`);

      await openApp(page, server, baseURL);

      for (const item of created) {
        const card = artifactCard(page, item.title);
        await expect(card.locator("iframe.artifact-content")).toHaveAttribute(
          "src",
          encodedArtifactPathPattern(item.id, item.basename),
        );
        await expect(card.locator("iframe.artifact-content").contentFrame().locator("h1")).toHaveText(item.text);
      }

      const markdownCard = artifactCard(page, "Uppercase Markdown");
      await expect(markdownCard.locator("iframe.artifact-content")).toHaveAttribute("src", "/views/markdown/");
      await expect(markdownCard.locator("iframe.artifact-content").contentFrame().locator(".cm-content")).toContainText(
        "Uppercase markdown",
      );

      const directoryCard = artifactCard(page, "Directory Named Notes MD");
      await expect(directoryCard.locator("iframe.artifact-content")).toHaveAttribute(
        "src",
        new RegExp(`/artifact/${escapeRegExp(dottedDirectory.id)}/$`),
      );
      await expect(directoryCard.locator("iframe.artifact-content").contentFrame().locator("h1")).toHaveText(
        "directory named notes.md",
      );
    } finally {
      await disposeServer(server);
      server = null;
    }
  });

  test("path artifacts render after a server restart and watchers still fire", async ({ page, baseURL }) => {
    const storagePath = createTempStorage();
    let server: ProductServer | null = null;

    try {
      server = await launchProductServer({ home: storagePath, cleanupHome: false });
      const markdownPath = path.join(storagePath, "restart-note.md");
      const htmlPath = path.join(storagePath, "restart-page.html");
      const dirPath = path.join(storagePath, "restart-dir");
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(markdownPath, "# Markdown before restart", "utf8");
      writeFileSync(htmlPath, html("<h1>HTML before restart</h1>"), "utf8");
      writeFileSync(path.join(dirPath, "index.html"), html("<h1>Directory before restart</h1>"), "utf8");

      await createPathArtifact(server, markdownPath, "Restart Markdown");
      await createPathArtifact(server, htmlPath, "Restart HTML");
      await createPathArtifact(server, dirPath, "Restart Directory");

      await server.dispose();
      server = await launchProductServer({ home: storagePath, cleanupHome: false });
      await openApp(page, server, baseURL);

      await expect(
        artifactCard(page, "Restart Markdown").locator("iframe.artifact-content").contentFrame().locator(".cm-content"),
      ).toContainText("Markdown before restart", { timeout: 15_000 });
      await expect(
        artifactCard(page, "Restart HTML").locator("iframe.artifact-content").contentFrame().locator("h1"),
      ).toHaveText("HTML before restart");
      await expect(
        artifactCard(page, "Restart Directory").locator("iframe.artifact-content").contentFrame().locator("h1"),
      ).toHaveText("Directory before restart");

      const htmlFrame = artifactCard(page, "Restart HTML").locator("iframe.artifact-content").contentFrame();
      writeFileSync(htmlPath, html("<h1>HTML after restart watcher</h1>"), "utf8");
      await expect(htmlFrame.locator("h1")).toHaveText("HTML after restart watcher", { timeout: 15_000 });
    } finally {
      await disposeServer(server);
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("pre-redesign server and browser records upgrade together into the rendered application", async ({ page }) => {
    const storagePath = createTempStorage();
    let server: ProductServer | null = null;

    try {
      const statePath = path.join(storagePath, "state");
      const screensPath = path.join(statePath, "screens");
      const artifactsPath = path.join(statePath, "artifacts");
      mkdirSync(screensPath, { recursive: true });
      mkdirSync(artifactsPath, { recursive: true });

      const htmlPath = path.join(storagePath, "legacy-file.html");
      const dirPath = path.join(storagePath, "legacy-dir");
      writeFileSync(htmlPath, html("<h1>Legacy file</h1>"), "utf8");
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(path.join(dirPath, "index.html"), html("<h1>Legacy directory</h1>"), "utf8");

      const fileArtifactID = "legacy-file-artifact";
      const dirArtifactID = "legacy-dir-artifact";
      const screenID = "legacy-screen";
      writeFileSync(
        path.join(artifactsPath, `${fileArtifactID}.json`),
        JSON.stringify({ id: fileArtifactID, kind: "path", title: "Legacy File", path: htmlPath }, null, 2),
        "utf8",
      );
      writeFileSync(
        path.join(artifactsPath, `${dirArtifactID}.json`),
        JSON.stringify({ id: dirArtifactID, kind: "path", title: "Legacy Directory", path: `${dirPath}${path.sep}` }, null, 2),
        "utf8",
      );
      writeFileSync(
        path.join(screensPath, `${screenID}.json`),
        JSON.stringify({
          id: screenID,
          name: "Legacy Screen",
          layout: [
            { type: "card", artifactID: fileArtifactID, width: 4, height: 6 },
            { type: "card", artifactID: dirArtifactID, width: 4, height: 6 },
          ],
        }, null, 2),
        "utf8",
      );
      writeFileSync(path.join(statePath, "display.json"), JSON.stringify({ activeScreenID: screenID, activeThemeName: null }, null, 2), "utf8");

      server = await launchProductServer({ home: storagePath, cleanupHome: false, auth: true });
      const appBaseURL = server.serverURL;
      const retiredRecord = {
        servers: [
          { url: "http://retired.invalid", name: "Retired" },
          { url: appBaseURL, name: "Persisted server" },
        ],
        activeServerURL: appBaseURL,
        activeScreenID: "retired-browser-screen",
        screens: {
          "retired-browser-screen": { scrollPosition: 400, lastActivatedAt: 9_999 },
        },
        tabs: { [appBaseURL]: ["retired-browser-screen"] },
        promotedOnboardingScreens: { retired: ["calendar"] },
        authTokens: { [appBaseURL]: server.token },
      };
      await page.addInitScript(
        ({ key, value }) => window.localStorage.setItem(key, value),
        { key: "store-television-browser", value: JSON.stringify(retiredRecord) },
      );
      await page.goto(appBaseURL);
      await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
      await configureTestMotion(page);

      await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
      await expect(page.locator(".channel[aria-selected='true']")).toHaveText("Legacy Screen");
      await expect(page.locator(".top-bar .tab-strip > .tab")).toHaveText([
        "Legacy File",
        "Legacy Directory",
      ]);
      await expect(page.locator('.top-bar .tab[data-artifact-id="legacy-file-artifact"]'))
        .toHaveAttribute("aria-selected", "true");
      await expect(
        artifactCard(page, "Legacy File").locator("iframe.artifact-content").contentFrame().locator("h1"),
      ).toHaveText("Legacy file", { timeout: 15_000 });
      await expect(
        artifactCard(page, "Legacy Directory").locator("iframe.artifact-content").contentFrame().locator("h1"),
      ).toHaveText("Legacy directory", { timeout: 15_000 });
      expect(await page.evaluate(() => (
        window as unknown as { __telepath: { connectionOwner: { storedAuthToken: string | null } } }
      ).__telepath.connectionOwner.storedAuthToken)).toBe(server.token);
      expect(JSON.parse(readFileSync(path.join(statePath, "channels", `${screenID}.json`), "utf8")))
        .toMatchObject({
          id: screenID,
          name: "Legacy Screen",
          layoutVersion: 2,
          layout: [
            {
              artifactIds: [fileArtifactID],
              geometry: { kind: "single", full_screen: false },
              size: { width: 560, height: 740 },
            },
            {
              artifactIds: [dirArtifactID],
              geometry: { kind: "single", full_screen: false },
              size: { width: 560, height: 740 },
            },
          ],
        });
    } finally {
      await disposeServer(server);
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
