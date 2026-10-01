import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { desktopE2EURL, launchDesktop } from "./helpers.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const bundledViewsPath = path.join(repoRoot, "packages/web/dist/views");

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-electron-path-reload-e2e-"));
}

async function firstWebviewText(app: ElectronApplication, selector: string): Promise<string | null> {
  return await app.evaluate(async ({ webContents }, targetSelector) => {
    const webviews = webContents.getAllWebContents().filter((candidate) => candidate.getType() === "webview");
    for (const contents of webviews) {
      const text = await contents.executeJavaScript(`document.querySelector(${JSON.stringify(targetSelector)})?.textContent ?? null`);
      if (text !== null) return text;
    }
    return null;
  }, selector);
}

async function firstWebviewStyle(
  app: ElectronApplication,
  selector: string,
  property: string,
): Promise<string | null> {
  return await app.evaluate(async ({ webContents }, target) => {
    const webviews = webContents.getAllWebContents().filter((candidate) => candidate.getType() === "webview");
    for (const contents of webviews) {
      const value = await contents.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(target.selector)});
        return element === null
          ? null
          : getComputedStyle(element).getPropertyValue(${JSON.stringify(target.property)});
      })()`);
      if (value !== null) return value;
    }
    return null;
  }, { selector, property });
}


test.describe("Electron path artifact webview content reload", () => {
  let storagePath: string;
  let server: Server;
  let store: ServerStore;

  test.beforeEach(async () => {
    storagePath = createDataDir();
    store = createServingStore(storagePath, { bundledViewsPath });
    server = new Server({ store, port: 0, staticDir: path.join(repoRoot, "packages/web/dist") });
    await server.start();
  });

  test.afterEach(async () => {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("renders and recovers missing markdown and HTML artifacts in Electron", async () => {
    const serverURL = server.getBaseURL();
    const token = server.getAuthToken();
    const channelID = store.listChannels()[0]!.id;
    const markdownPath = path.join(storagePath, "note.md");
    const htmlPath = path.join(storagePath, "standalone.html");
    writeFileSync(markdownPath, "# Electron markdown", "utf8");
    writeFileSync(htmlPath, `<!doctype html><html><body><main id="probe">electron html</main></body></html>`, "utf8");

    store.createArtifact({ kind: "path", title: "Markdown", path: markdownPath, channelID: channelID });
    store.createArtifact({ kind: "path", title: "Standalone HTML", path: htmlPath, channelID: channelID });

    const { app, page } = await launchDesktop({
      fixture: desktopE2EURL(`/packages/web/src/index.html?mode=electron&serverURL=${encodeURIComponent(serverURL)}&token=${token}`),
    });
    try {
      await fetch(`${serverURL}/display`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ activeChannelID: channelID }),
      });

      const markdownCard = page.locator(".artifact-view").filter({ hasText: "Markdown" });
      const htmlCard = page.locator(".artifact-view").filter({ hasText: "Standalone HTML" });
      await expect(markdownCard.locator("webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });
      await expect(htmlCard.locator("webview.artifact-content")).toBeVisible({ timeout: 15_000 });

      unlinkSync(markdownPath);
      await expect(markdownCard).toContainText("Artifact file not found", { timeout: 15_000 });
      await expect(markdownCard).toContainText(markdownPath);

      unlinkSync(htmlPath);
      await expect.poll(() => firstWebviewText(app, "body"), { timeout: 15_000 }).toContain("Artifact file not found");
      await expect.poll(() => firstWebviewText(app, "body"), { timeout: 15_000 }).toContain(htmlPath);

      writeFileSync(markdownPath, "# Electron markdown restored", "utf8");
      await expect(markdownCard.locator("webview.artifact-content[data-content-url]")).toBeVisible({ timeout: 15_000 });

      writeFileSync(htmlPath, `<!doctype html><html><body><main id="probe">electron html restored</main></body></html>`, "utf8");
      await expect.poll(() => firstWebviewText(app, "#probe"), { timeout: 15_000 }).toBe("electron html restored");
    } finally {
      await app.close();
    }
  });

  test("reloads a folder artifact when a subdirectory stylesheet changes (^af-ac-folder-source)", async () => {
    const serverURL = server.getBaseURL();
    const token = server.getAuthToken();
    const channelID = store.listChannels()[0]!.id;
    const artifactPath = path.join(storagePath, "nested-style-dir");
    const stylesPath = path.join(artifactPath, "assets", "styles");
    const indexPath = path.join(artifactPath, "index.html");
    const stylesheetPath = path.join(stylesPath, "artifact.css");
    mkdirSync(stylesPath, { recursive: true });
    writeFileSync(
      indexPath,
      '<!doctype html><html><head><link rel="stylesheet" href="assets/styles/artifact.css"></head><body><main id="probe">Nested stylesheet</main></body></html>',
      "utf8",
    );
    writeFileSync(stylesheetPath, "#probe { color: rgb(17, 34, 51); }\n", "utf8");
    const indexBytes = readFileSync(indexPath);
    const createResponse = await fetch(`${serverURL}/artifacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "path", title: "Nested Stylesheet", path: artifactPath, channelID }),
    });
    expect(createResponse.status).toBe(201);

    const { app, page } = await launchDesktop({
      fixture: desktopE2EURL(`/packages/web/src/index.html?mode=electron&serverURL=${encodeURIComponent(serverURL)}&token=${token}`),
    });
    try {
      await fetch(`${serverURL}/display`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ activeChannelID: channelID }),
      });

      const artifactCard = page.locator(".artifact-view").filter({ hasText: "Nested Stylesheet" });
      await expect(artifactCard.locator("webview.artifact-content")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => firstWebviewStyle(app, "#probe", "color"), { timeout: 15_000 })
        .toBe("rgb(17, 34, 51)");

      writeFileSync(stylesheetPath, "#probe { color: rgb(68, 85, 102); }\n", "utf8");
      expect(readFileSync(indexPath).equals(indexBytes)).toBe(true);

      await expect.poll(() => firstWebviewStyle(app, "#probe", "color"), { timeout: 15_000 })
        .toBe("rgb(68, 85, 102)");
    } finally {
      await app.close();
    }
  });

  test("reloads a standalone HTML path artifact webview when the file changes on disk", async () => {
    const serverURL = server.getBaseURL();
    const token = server.getAuthToken();
    const channelID = store.listChannels()[0]!.id;
    const artifactPath = path.join(storagePath, "standalone.html");
    writeFileSync(
      artifactPath,
      `<!doctype html><html><body><main id="probe">before content</main></body></html>`,
      "utf8",
    );

    store.createArtifact({
      kind: "path",
      title: "Standalone HTML",
      path: artifactPath,
      channelID: channelID,
    });

    const { app, page } = await launchDesktop({
      fixture: desktopE2EURL(`/packages/web/src/index.html?mode=electron&serverURL=${encodeURIComponent(serverURL)}&token=${token}`),
    });
    try {
      await fetch(`${serverURL}/display`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ activeChannelID: channelID }),
      });

      await expect(page.locator(".artifact-view webview.artifact-content").first()).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => firstWebviewText(app, "#probe"), { timeout: 15_000 }).toBe("before content");

      writeFileSync(
        artifactPath,
        `<!doctype html><html><body><main id="probe">after content</main></body></html>`,
        "utf8",
      );

      await expect.poll(() => firstWebviewText(app, "#probe"), { timeout: 15_000 }).toBe("after content");
    } finally {
      await app.close();
    }
  });
})
