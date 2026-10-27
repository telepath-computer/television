import { type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";

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

async function createPathArtifact(server: ProductServer, filePath: string, title: string): Promise<string> {
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "path", title, path: filePath, channelID: await defaultChannelID(server) }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { artifact: { id: string; path: string } };
  return body.artifact.id;
}

async function updateArtifactPath(server: ProductServer, artifactID: string, newPath: string): Promise<void> {
  const response = await fetch(`${server.serverURL}/artifacts/${encodeURIComponent(artifactID)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: newPath }),
  });
  expect(response.status).toBe(200);
}

async function registeredPath(server: ProductServer, artifactID: string): Promise<string> {
  const response = await fetch(`${server.serverURL}/artifacts/${encodeURIComponent(artifactID)}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { artifact: { path: string } };
  return body.artifact.path;
}

async function openApp(page: Page, server: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appBaseURL = await server.appURL(baseURL);
  await page.goto(`${appBaseURL}/packages/web/src/index.html`);
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
}


test.describe("path artifact mutation saga", () => {

  let server: ProductServer | null;

  test.beforeEach(async () => {
    server = await launchProductServer();
  });

  test.afterEach(async () => {
    await server?.dispose();
    server = null;
  });

  test("one artifact mutates file -> directory -> markdown and the browser renders each, both slash forms exercised", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");

    const canonicalResponses: Array<{ status: number; contentType: string }> = [];
    const markdownSourceRequests: string[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/canonical/v2/styles.css") {
        canonicalResponses.push({
          status: response.status(),
          contentType: response.headers()["content-type"] ?? "",
        });
      }
    });
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname === "/views/markdown/main.ts" ||
        pathname.startsWith("/packages/view-markdown/") ||
        pathname.includes("/node_modules/.vite/deps/@codemirror")
      ) {
        markdownSourceRequests.push(pathname);
      }
    });

    // Content on disk for all three lives of the artifact.
    const htmlFilePath = path.join(server.home, "report.html");
    writeFileSync(htmlFilePath, html("<h1>Quarterly report</h1>"));

    const dirPath = path.join(server.home, "dashboard");
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(path.join(dirPath, "styles.css"), "h1 { color: rgb(0, 128, 0); }");
    writeFileSync(path.join(dirPath, "index.html"), html(
      "<h1>Dashboard home</h1>",
      '<link rel="stylesheet" href="./styles.css" />',
    ));

    const markdownPath = path.join(server.home, "notes.md");
    writeFileSync(markdownPath, "# Notes from disk");

    // Life 1: HTML file artifact.
    const artifactID = await createPathArtifact(server, htmlFilePath, "Saga");
    await openApp(page, server, baseURL);
    const iframe = page.locator(".artifact-view iframe.artifact-content");
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
    await expect(iframe).toHaveAttribute("src", new RegExp(`/artifact/${artifactID}/report\\.html$`));
    await expect(frame.locator("h1")).toHaveText("Quarterly report");

    // Life 2: directory artifact, registered WITHOUT a trailing slash.
    await updateArtifactPath(server, artifactID, dirPath);
    expect(await registeredPath(server, artifactID)).toBe(`${dirPath}${path.sep}`);
    await expect(iframe).toHaveAttribute("src", new RegExp(`/artifact/${artifactID}/$`), { timeout: 15_000 });
    await expect(frame.locator("h1")).toHaveText("Dashboard home");
    // The stylesheet is a sibling asset resolved through the real proxy.
    await expect(frame.locator("h1")).toHaveCSS("color", "rgb(0, 128, 0)");

    // Life 3: markdown file artifact, registered WITH a trailing slash.
    await updateArtifactPath(server, artifactID, `${markdownPath}${path.sep}`);
    expect(await registeredPath(server, artifactID)).toBe(markdownPath);
    await expect(iframe).toHaveAttribute("src", "/views/markdown/", { timeout: 15_000 });
    await expect(frame.locator(".cm-content")).toContainText("Notes from disk", { timeout: 15_000 });
    expect(canonicalResponses).toEqual(expect.arrayContaining([{
      status: 200,
      contentType: expect.stringMatching(/^text\/css/),
    }]));
    expect(markdownSourceRequests).toEqual([]);
  });
})
