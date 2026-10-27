import { type Frame, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion, pickChannelByName } from "./helpers.ts";

// Browser demo mode (specs/product/artifacts.md#^af-demo-mode), proven in
// Chromium against a running server whose home directory is test-owned.

const MARKER = ".tv-mozfest-demo";
const RETURN_LABEL = "Return to the original page";

function page(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
}

/** A local site on an origin other than the Television server's. */
async function startExternalSite(): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const pages: Record<string, string> = {
      "/one": page("Fixture page one", `<a id="next" href="/two">Next</a>`),
      "/two": page("Fixture page two", `<a id="back-home" href="/one">Home</a>`),
    };
    const body = pages[request.url ?? ""];
    response.writeHead(body ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body ?? "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    // The page is still open when cleanup runs, and the browser may hold a
    // connection that has not sent a request; close() alone waits for it.
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function channels(server: ProductServer): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${server.serverURL}/channels`);
  return ((await response.json()) as { channels: Array<{ id: string; name: string }> }).channels;
}

async function createChannel(server: ProductServer, name: string): Promise<void> {
  const response = await fetch(`${server.serverURL}/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
}

async function createURLArtifact(
  server: ProductServer,
  url: string,
  channelID: string,
  title = "External page",
): Promise<string> {
  const response = await fetch(`${server.serverURL}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "url", title, url, channelID }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { artifact: { id: string } }).artifact.id;
}

async function openApp(page: Page, server: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appBaseURL = await server.appURL(baseURL);
  await page.goto(`${appBaseURL}/packages/web/src/index.html`);
  await waitForApp(page);
}

async function waitForApp(page: Page): Promise<void> {
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
}

function artifactFrame(page: Page) {
  return page.locator(".artifact-view iframe.artifact-content").first();
}

function frameHeading(page: Page) {
  return page.frameLocator(".artifact-view iframe.artifact-content").first().locator("h1");
}

async function expectNoHistoryControls(page: Page): Promise<void> {
  await expect(page.locator(".artifact-view button[aria-label='Back']")).toHaveCount(0);
  await expect(page.locator(".artifact-view button[aria-label='Forward']")).toHaveCount(0);
}

async function followNext(page: Page): Promise<void> {
  await page.frameLocator(".artifact-view iframe.artifact-content").first().locator("#next").click();
  await expect(frameHeading(page)).toHaveText("Fixture page two");
}

test.describe("browser demo mode", () => {
  let home: string;
  let site: Awaited<ReturnType<typeof startExternalSite>>;
  let server: ProductServer | null = null;

  test.beforeEach(async () => {
    home = mkdtempSync(path.join(os.tmpdir(), "television-demo-home-"));
    site = await startExternalSite();
    server = await launchProductServer({
      // Keep the invoking developer's telemetry marker in effect.
      env: { HOME: home, TELEVISION_DEVELOPER_HOME: os.homedir() },
    });
  });

  test.afterEach(async () => {
    await server?.dispose();
    server = null;
    await site.close();
    rmSync(home, { recursive: true, force: true });
  });

  // spec: proofs/product/artifacts.md#^af-ac-demo-mode
  test("the home-directory marker turns direct external pages on and off at app load (^af-ac-demo-mode)", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");
    const [channel] = await channels(server);
    if (!channel) throw new Error("Expected a default channel");
    const pageURL = `${site.origin}/one`;
    await createURLArtifact(server, pageURL, channel.id);
    const returnButton = page.getByRole("button", { name: RETURN_LABEL });

    await openApp(page, server, baseURL);
    await expect(artifactFrame(page)).toHaveAttribute("src", /\/views\/url-unsupported\//);
    await expect(returnButton).toHaveCount(0);

    writeFileSync(path.join(home, MARKER), "");
    await page.reload();
    await waitForApp(page);
    await expect(artifactFrame(page)).toHaveAttribute("src", pageURL);
    await expect(frameHeading(page)).toHaveText("Fixture page one");
    await expectNoHistoryControls(page);
    await expect(returnButton).toBeVisible();

    unlinkSync(path.join(home, MARKER));
    await page.reload();
    await waitForApp(page);
    await expect(artifactFrame(page)).toHaveAttribute("src", /\/views\/url-unsupported\//);
    await expect(returnButton).toHaveCount(0);
  });

  // spec: proofs/product/artifacts.md#^af-ac-demo-return
  test("the artifact icon, an app reload, and a channel round trip each return to the original page (^af-ac-demo-return)", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");
    writeFileSync(path.join(home, MARKER), "");
    const [channel] = await channels(server);
    if (!channel) throw new Error("Expected a default channel");
    await createChannel(server, "Elsewhere");
    await createURLArtifact(server, `${site.origin}/one`, channel.id);

    await openApp(page, server, baseURL);
    await expect(frameHeading(page)).toHaveText("Fixture page one");

    await followNext(page);
    await expectNoHistoryControls(page);
    await page.getByRole("button", { name: RETURN_LABEL }).click();
    await expect(frameHeading(page)).toHaveText("Fixture page one");

    await followNext(page);
    await page.reload();
    await waitForApp(page);
    await expect(frameHeading(page)).toHaveText("Fixture page one");

    await followNext(page);
    await pickChannelByName(page, "Elsewhere");
    await pickChannelByName(page, channel.name);
    await expect(frameHeading(page)).toHaveText("Fixture page one");
    await expectNoHistoryControls(page);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-demo-inert-seam
  test("bridge-shaped messages from a demo-mode page change nothing (^ab-ac-demo-inert-seam)", async ({ page, baseURL }) => {
    if (!server) throw new Error("Product server was not started");
    writeFileSync(path.join(home, MARKER), "");
    const [channel] = await channels(server);
    if (!channel) throw new Error("Expected a default channel");
    await createChannel(server, "Elsewhere");
    const pageURL = `${site.origin}/one`;
    await createURLArtifact(server, pageURL, channel.id);
    await createURLArtifact(server, `${site.origin}/two`, channel.id, "Second page");

    await openApp(page, server, baseURL);
    const selected = page.getByRole("option", { name: channel.name, exact: true });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    const tabs = page.locator(".top-bar .tab");
    await expect(tabs).toHaveCount(2);
    const selectedTab = page.locator(".top-bar .tab[aria-selected='true']");
    await expect(selectedTab).toHaveCount(1);
    const selectedArtifact = await selectedTab.getAttribute("data-artifact-id");
    const firstArtifact = await tabs.first().getAttribute("data-artifact-id");
    // Movement stops at the ends, so step toward the other tab.
    const horizontal = selectedArtifact === firstArtifact ? "ArrowRight" : "ArrowLeft";

    await expect.poll(() => page.frames().some((candidate: Frame) => candidate.url() === pageURL)).toBe(true);
    const external = page.frames().find((candidate: Frame) => candidate.url() === pageURL);
    if (!external) throw new Error("Expected the external page's frame");
    // The page's own script posts bridge-shaped messages, then a sentinel; the
    // host dispatches messages in order, so the sentinel's arrival means every
    // earlier message has been dispatched.
    const sentinel = page.evaluate(() => new Promise<void>((resolve) => {
      window.addEventListener("message", function listen(event) {
        if ((event.data as { type?: unknown } | null)?.type !== "demo-sentinel") return;
        window.removeEventListener("message", listen);
        resolve();
      });
    }));
    await external.evaluate(({ target, horizontal }) => {
      const messages = [
        { type: "bridge-ready", guid: "demo-guid" },
        { type: "navigation-key", key: horizontal },
        // Unpinned channels list newest first, so "up" would leave the default channel.
        { type: "navigation-key", key: "ArrowUp" },
        { type: "navigation-request", url: target },
        { type: "artifact-pointer", eventType: "pointermove", clientX: 5, clientY: 5, button: 0, buttons: 0 },
        { type: "demo-sentinel" },
      ];
      for (const message of messages) window.parent.postMessage(message, "*");
    }, { target: `${new URL(pageURL).origin}/three`, horizontal });
    await sentinel;

    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selectedTab).toHaveAttribute("data-artifact-id", selectedArtifact ?? "");
    await expect(page.locator(`.artifact-view iframe.artifact-content[src="${pageURL}"]`)).toHaveCount(1);
    await expectNoHistoryControls(page);
  });
});
