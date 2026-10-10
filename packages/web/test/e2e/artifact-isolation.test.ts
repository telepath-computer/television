import type { Frame, Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { writeLoadingFixture, type LoadingResults } from "../../../../test/helpers/sandboxed-artifact-fixture.ts";
import { expectIsolationEnforced, INACCESSIBLE_WINDOW, launchIsolationServer, writeIsolationFixture, type IsolationResults } from "../../../../test/helpers/artifact-isolation-fixture.ts";
import { configureTestMotion } from "./helpers.ts";

// Artifact isolation in a real browser against a really-running product
// server (proofs/arch/artifact-frame/isolation.md). Artifacts are authored
// fixtures registered through the production API; the default CSS-motion
// override is the only mock.

const ALLOWED_FEATURES = ["clipboard-write", "fullscreen", "autoplay", "picture-in-picture", "web-share", "encrypted-media"];
const REFUSED_FEATURES = ["geolocation", "camera", "microphone", "clipboard-read", "midi"];

async function openApp(page: Page, product: ProductServer, baseURL: string | undefined): Promise<string> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appURL = await product.appURL(baseURL);
  await page.goto(new URL("/packages/web/src/index.html", appURL).toString());
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  return appURL;
}

/** Registers a path artifact in the focused channel through the production API. */
async function createPathArtifact(product: Pick<ProductServer, "serverURL" | "token">, title: string, artifactPath: string): Promise<string> {
  const client = new TelevisionClient(product.serverURL, { token: product.token });
  const display = await client.display.get();
  const channelID = display.focusedChannelId ?? (await client.channels.list()).channels[0]!.id;
  const { artifact } = await client.artifacts.create({ channelID, kind: "path", title, path: artifactPath });
  return artifact.id;
}

async function createURLArtifact(product: ProductServer, title: string, url: string): Promise<string> {
  const client = new TelevisionClient(product.serverURL, { token: product.token });
  const display = await client.display.get();
  const channelID = display.focusedChannelId ?? (await client.channels.list()).channels[0]!.id;
  const { artifact } = await client.artifacts.create({ channelID, kind: "url", title, url });
  return artifact.id;
}

/** The document the selected artifact frame shows. */
async function artifactDocument(page: Page): Promise<Frame> {
  const iframe = await page.locator(".stage .page[selected] .artifact-view iframe.artifact-content").elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error("Expected the artifact frame's document");
  return frame;
}

async function frameOrigin(page: Page): Promise<string> {
  return (await artifactDocument(page)).evaluate(() => String(self.origin));
}

/** A plain HTTP server on another origin, answering every path with `body`. */
async function startSite(body: string): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-escalation-browser
test("artifact storage and authority stay isolated in the browser", async ({ page, context }) => {
  const product = await launchIsolationServer();
  try {
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    expect((await fetch(`${product.serverURL}/channels`)).status).toBe(401);

    const appURL = product.serverURL;
    // Connect as a user does: the app consumes the query token and saves it.
    const connectURL = new URL("/", appURL);
    connectURL.searchParams.set("token", product.token);
    const posts: number[] = [];
    context.on("response", (response) => {
      if (new URL(response.url()).pathname === "/channels" && response.request().method() === "POST") posts.push(response.status());
    });
    await page.goto(connectURL.href);
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    await configureTestMotion(page);
    const appLocation = page.url();
    const storedToken = () => page.evaluate(() => localStorage.getItem("store-television-browser"));
    const tokenBefore = await storedToken();
    expect(JSON.parse(tokenBefore!)).toEqual({ authTokens: { [new URL(appURL).origin]: product.token } });
    expect(new URL(appLocation).searchParams.has("token")).toBe(false);

    const sentinel = randomUUID();
    await page.evaluate((value) => localStorage.setItem("artifact-isolation-sentinel", value), sentinel);
    const folder = writeIsolationFixture(path.join(product.home, "isolation-fixture"));
    const artifactID = await createPathArtifact(product, "Isolation fixture", folder);
    const before = { channels: await client.channels.list(), artifacts: await client.artifacts.list() };

    const frame = page.frameLocator(".stage .page[selected] .artifact-view iframe.artifact-content");
    for (const phase of ["load", "click"] as const) {
      if (phase === "click") await frame.locator("#check").click();
      await expect(frame.locator(`#${phase}`)).not.toBeEmpty();
      const results = JSON.parse((await frame.locator(`#${phase}`).textContent())!) as IsolationResults;
      expectIsolationEnforced(results, artifactID, phase === "click");
      expect(results.parent).toEqual(INACCESSIBLE_WINDOW);
      expect(results.appFrame).toEqual(INACCESSIBLE_WINDOW);
      expect(results.topNavigation).toBe("SecurityError");
    }

    // Use separate real clicks: Firefox permits only one popup per activation.
    const appPopupPromise = context.waitForEvent("page");
    await frame.locator("#open-app").click();
    const appPopup = await appPopupPromise;
    await appPopup.waitForURL(`${new URL(appURL).origin}/`);
    await appPopup.waitForLoadState("domcontentloaded");
    await frame.locator("#read-app").click();
    expect(JSON.parse((await frame.locator("#app-window").textContent())!)).toEqual(INACCESSIBLE_WINDOW);
    await appPopup.close();

    const ownPopupPromise = context.waitForEvent("page");
    await frame.locator("#open-self").click();
    const ownPopup = await ownPopupPromise;
    await ownPopup.waitForURL(/popup=1/);
    // No embedding iframe exists here: only the response header can deny
    // storage. Removing that header must fail this assertion.
    for (const phase of ["load", "click"] as const) {
      if (phase === "click") await ownPopup.locator("#check").click();
      await expect(ownPopup.locator(`#${phase}`)).not.toBeEmpty();
      expectIsolationEnforced(JSON.parse((await ownPopup.locator(`#${phase}`).textContent())!) as IsolationResults, artifactID, phase === "click");
    }
    await ownPopup.close();

    // The app popup also renders the selected artifact, running its load
    // attempts. Count all completed attempts, and reject any accepted POST.
    expect(posts.length).toBeGreaterThanOrEqual(4);
    expect(new Set(posts)).toEqual(new Set([401]));
    expect(await storedToken()).toBe(tokenBefore);
    expect(await page.evaluate(() => localStorage.getItem("artifact-isolation-sentinel"))).toBe(sentinel);
    expect(page.url()).toBe(appLocation);
    expect({ channels: await client.channels.list(), artifacts: await client.artifacts.list() }).toEqual(before);
    // The app still makes a successful authenticated request after reload,
    // now using its saved token rather than a connect URL.
    const authenticated = page.waitForResponse((response) => new URL(response.url()).pathname === "/channels" && [200, 304].includes(response.status()));
    await page.reload();
    await authenticated;
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    expect(await storedToken()).toBe(tokenBefore);
  } finally {
    await Promise.all(context.pages().filter((open) => open !== page).map((open) => open.close()));
    await product.dispose();
  }
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-artifacts-load
test("a sandboxed artifact loads its own files, the canonical bundle, its store and the missing-file page", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const folder = writeLoadingFixture(path.join(product.home, "loading-fixture"));
    const artifactID = await createPathArtifact(product, "Loading fixture", `${folder}${path.sep}`);
    await openApp(page, product, baseURL);

    const frame = page.frameLocator(".stage .page[selected] .artifact-view iframe.artifact-content");
    await expect(frame.locator("#results")).not.toBeEmpty({ timeout: 15_000 });
    const results = JSON.parse(await frame.locator("#results").textContent() ?? "{}") as LoadingResults;
    expect(results).toEqual({
      origin: "null",
      module: "module ran",
      json: 42,
      font: true,
      canonicalStyle: true,
      canonicalElement: true,
      store: "round-trip",
    });
    expect(JSON.parse(product.runCLI(["resource", "json", "get", "--artifact", artifactID, "probe"]))).toEqual({ exists: true, value: "round-trip" });

    // With its index gone, the app reloads the frame, which shows the
    // missing-file page the proxy serves, running its own script.
    rmSync(path.join(folder, "index.html"));
    await expect(frame.locator("#missing-title")).toHaveText("Artifact file not found", { timeout: 15_000 });
    await expect(frame.locator("#missing-path")).toHaveText(`${folder}${path.sep}`);
    expect(await (await artifactDocument(page)).evaluate(() => document.title)).toBe("Loading fixture");
    await expect(frame.locator(".artifact-error")).not.toHaveCSS("padding-top", "0px");
    expect(await frameOrigin(page)).toBe("null");
  } finally {
    await product.dispose();
  }
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-reused-frame
test("one artifact frame sandboxes the artifact's pages and a shared artifact's, and not the placeholder between them", async ({ page, baseURL }) => {
  const external = await startSite("<!doctype html><title>External</title><h1>External page</h1>");
  const producer = await startSite("<!doctype html><title>Shared</title><h1>Shared without a header</h1>");
  const product = await launchProductServer();
  try {
    const folder = path.join(product.home, "linking-fixture");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), `<!doctype html><h1>Artifact page</h1><a id="external" href="${external.origin}/page.html">External</a>`);
    await createPathArtifact(product, "Linking fixture", `${folder}${path.sep}`);
    const appURL = await openApp(page, product, baseURL);

    const frame = page.frameLocator(".stage .page[selected] .artifact-view iframe.artifact-content");
    const iframe = page.locator(".stage .page[selected] .artifact-view iframe.artifact-content");
    await expect(frame.locator("h1")).toHaveText("Artifact page");
    await iframe.evaluate((element) => element.setAttribute("data-original-frame", ""));
    expect(await frameOrigin(page)).toBe("null");

    await frame.locator("#external").click();
    await expect(iframe).toHaveAttribute("src", "/views/url-unsupported/");
    await expect.poll(() => frameOrigin(page)).toBe(new URL(appURL).origin);

    await page.locator(".stage .page[selected] .artifact-view button[aria-label='Back']").click();
    await expect(frame.locator("h1")).toHaveText("Artifact page");
    await expect(iframe).toHaveAttribute("data-original-frame", "");
    expect(await frameOrigin(page)).toBe("null");

    const sharedID = await createURLArtifact(product, "Shared fixture", `${producer.origin}/artifact/01J00000000000000000000000/index.html`);
    const sharedFrame = page.frameLocator(`.stage .page[data-page-key="${sharedID}"] .artifact-view iframe.artifact-content`);
    await page.locator(`.tab-strip > .tab[data-artifact-id="${sharedID}"]`).click();
    await expect(sharedFrame.locator("h1")).toHaveText("Shared without a header");
    expect(await sharedFrame.locator("html").evaluate(() => String(self.origin))).toBe("null");
  } finally {
    await product.dispose();
    await external.close();
    await producer.close();
  }
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-features
test("a sandboxed artifact is granted the six browser features and no others, and enters fullscreen from a click", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const folder = path.join(product.home, "features-fixture");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), `<!doctype html>
      <button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Fullscreen</button>`);
    await createPathArtifact(product, "Features fixture", `${folder}${path.sep}`);
    await openApp(page, product, baseURL);

    const frame = page.frameLocator(".stage .page[selected] .artifact-view iframe.artifact-content");
    await expect(frame.locator("#fullscreen")).toBeVisible();
    const artifact = await artifactDocument(page);
    expect(await artifact.evaluate(() => String(self.origin))).toBe("null");
    // The browser reports only the features it implements; Chromium on Linux
    // does not implement Web Share.
    const allowed = await artifact.evaluate((features) => {
      const policy = (document as Document & { featurePolicy: { allowsFeature(feature: string): boolean; features(): string[] } }).featurePolicy;
      const implemented = new Set(policy.features());
      return Object.fromEntries(features.filter((feature) => implemented.has(feature)).map((feature) => [feature, policy.allowsFeature(feature)]));
    }, [...ALLOWED_FEATURES, ...REFUSED_FEATURES]);
    expect([...ALLOWED_FEATURES, ...REFUSED_FEATURES].filter((feature) => !(feature in allowed)))
      .toEqual(process.platform === "linux" ? ["web-share"] : []);
    expect(allowed).toEqual(Object.fromEntries([
      ...ALLOWED_FEATURES.filter((feature) => feature in allowed).map((feature) => [feature, true]),
      ...REFUSED_FEATURES.map((feature) => [feature, false]),
    ]));

    await frame.locator("#fullscreen").click();
    await expect.poll(() => artifact.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  } finally {
    await product.dispose();
  }
});
