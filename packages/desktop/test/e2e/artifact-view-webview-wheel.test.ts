import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import {
  configureTestMotion,
  createArtifactFile,
} from "../../../web/test/e2e/helpers.ts";
import {
  desktopE2EOrigin,
  expectPermanentApplicationShell,
  launchDesktop,
} from "./helpers.ts";

const desktopViteBaseURL = desktopE2EOrigin();

interface ElectronFrameHarness {
  readonly storagePath: string;
  readonly server: Server;
  readonly client: TelevisionClient;
  readonly channelID: string;
}

interface SeededArtifact {
  readonly id: string;
  readonly title: string;
}

interface WebviewLayoutMetrics {
  readonly main: { height: number };
  readonly stage: { height: number };
  readonly page: { height: number };
  readonly frameView: DOMRectSnapshot;
  readonly titleBar: DOMRectSnapshot;
  readonly availableDocumentArea: DOMRectSnapshot;
  readonly webview: DOMRectSnapshot;
  readonly webviewDocument: {
    readonly innerWidth: number;
    readonly innerHeight: number;
  } | null;
}

interface GuestDocumentSnapshot {
  readonly webContentsId: number;
  readonly marker: string | null;
  readonly documentToken: string | null;
  readonly inputValue: string | null;
  readonly inputRect: DOMRectSnapshot | null;
  readonly startRect: DOMRectSnapshot | null;
  readonly scrollY: number;
  readonly counter: number;
}

interface DOMRectSnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function startHarness(name: string): Promise<ElectronFrameHarness> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-frame-5-"));
  const server = new Server({
    store: createServingStore(storagePath),
    port: 0,
  });
  try {
    await server.start();
    const client = new TelevisionClient(server.getBaseURL(), {
      token: server.getAuthToken(),
    });
    const { channel } = await client.channels.create({ name });
    await client.display.patch({ focusedChannelId: channel.id });
    return { storagePath, server, client, channelID: channel.id };
  } catch (error) {
    await server.dispose().catch(() => undefined);
    rmSync(storagePath, { recursive: true, force: true });
    throw error;
  }
}

async function disposeHarness(harness: ElectronFrameHarness): Promise<void> {
  try {
    await harness.server.dispose();
  } finally {
    rmSync(harness.storagePath, { recursive: true, force: true });
  }
}

async function applicationURL(harness: ElectronFrameHarness): Promise<string> {
  const appURL = await appURLForServer(harness.server.getBaseURL(), desktopViteBaseURL);
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("mode", "electron");
  url.searchParams.set("token", harness.server.getAuthToken());
  url.searchParams.set("desktopAppVersion", "9.9.9");
  return url.href;
}

async function openApplication(harness: ElectronFrameHarness): Promise<{
  readonly app: ElectronApplication;
  readonly page: Page;
}> {
  const launched = await launchDesktop({ fixture: await applicationURL(harness) });
  try {
    await expectPermanentApplicationShell(launched.page);
    await configureTestMotion(launched.page);
    await expect(launched.page.locator("#app")).toHaveAttribute(
      "data-app-state",
      "connected",
    );
    return launched;
  } catch (error) {
    await launched.app.close().catch(() => undefined);
    throw error;
  }
}

async function createURLArtifact(
  harness: ElectronFrameHarness,
  title: string,
  url: string,
): Promise<SeededArtifact> {
  const { artifact } = await harness.client.artifacts.create({
    channelID: harness.channelID,
    kind: "url",
    title,
    url,
  });
  return { id: artifact.id, title: artifact.title };
}

async function createPathArtifact(
  harness: ElectronFrameHarness,
  title: string,
  artifactPath: string,
): Promise<SeededArtifact> {
  const { artifact } = await harness.client.artifacts.create({
    channelID: harness.channelID,
    kind: "path",
    title,
    path: artifactPath,
  });
  return { id: artifact.id, title: artifact.title };
}

function tabFor(page: Page, artifactID: string) {
  return page.locator(`.tab-strip > .tab[data-artifact-id="${artifactID}"]`);
}

function pageFor(page: Page, artifactID: string) {
  return page.locator(`.stage .page[data-page-key="${artifactID}"]`);
}

function webviewFor(page: Page, artifactID: string) {
  return pageFor(page, artifactID).locator(".artifact-view webview.artifact-content");
}

async function selectArtifact(page: Page, artifactID: string): Promise<void> {
  const tab = tabFor(page, artifactID);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(pageFor(page, artifactID)).toHaveAttribute("selected", "");
}

function countArtifactDocumentLoads(server: Server, artifactID: string): () => number {
  let loads = 0;
  const prefix = `/artifact/${artifactID}/`;
  server.httpServer.prependListener("request", (request) => {
    if (request.method === "GET" && request.url?.startsWith(prefix)) loads += 1;
  });
  return () => loads;
}

async function measureWebviewLayout(
  page: Page,
  app: ElectronApplication,
  artifactID: string,
  guestURLMarker: string,
): Promise<WebviewLayoutMetrics> {
  const hostMetrics = await pageFor(page, artifactID).locator(".artifact-view")
    .evaluate((frameView): Omit<WebviewLayoutMetrics, "webviewDocument"> => {
      const rectOf = (element: Element | null): DOMRectSnapshot => {
        if (!element) throw new Error("Expected permanent frame element while measuring webview layout");
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      };
      const frameViewRect = rectOf(frameView);
      const titleBar = rectOf(frameView.querySelector(".artifact-title-bar"));
      const style = getComputedStyle(frameView);
      const pixels = (property: string): number => Number.parseFloat(style.getPropertyValue(property)) || 0;
      const borderLeft = pixels("border-left-width");
      const borderRight = pixels("border-right-width");
      const borderTop = pixels("border-top-width");
      const borderBottom = pixels("border-bottom-width");
      const paddingLeft = pixels("padding-left");
      const paddingRight = pixels("padding-right");
      const paddingTop = pixels("padding-top");
      const paddingBottom = pixels("padding-bottom");
      return {
        main: { height: rectOf(document.querySelector("#app > .app-main")).height },
        stage: { height: rectOf(document.querySelector(".app-main > .stage")).height },
        page: { height: rectOf(frameView.closest(".page")).height },
        frameView: frameViewRect,
        titleBar,
        availableDocumentArea: {
          x: frameViewRect.x + borderLeft + paddingLeft,
          y: frameViewRect.y + borderTop + paddingTop,
          width: frameViewRect.width - borderLeft - borderRight - paddingLeft - paddingRight,
          height: frameViewRect.height - borderTop - borderBottom - paddingTop - paddingBottom - titleBar.height,
        },
        webview: rectOf(frameView.querySelector("webview.artifact-content")),
      };
    });
  const webviewDocument = await app.evaluate(async ({ webContents }, urlMarker) => {
    const contents = webContents.getAllWebContents().find((candidate) =>
      candidate.getType() === "webview" && candidate.getURL().includes(urlMarker)
    );
    if (!contents) return null;
    return contents.executeJavaScript("({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })");
  }, guestURLMarker);
  return { ...hostMetrics, webviewDocument };
}

async function guestSnapshot(
  app: ElectronApplication,
  marker: string,
): Promise<GuestDocumentSnapshot | null> {
  return app.evaluate(async ({ webContents }, expectedMarker) => {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() !== "webview") continue;
      try {
        const snapshot = await contents.executeJavaScript(`(() => {
          if (document.documentElement.dataset.continuityMarker !== ${JSON.stringify(expectedMarker)}) return null;
          const input = document.querySelector('#continuity-input');
          const inputRect = input?.getBoundingClientRect() ?? null;
          const start = document.querySelector('#continuity-start');
          const startRect = start?.getBoundingClientRect() ?? null;
          const rect = (value) => value ? {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
          } : null;
          return {
            marker: document.documentElement.dataset.continuityMarker ?? null,
            documentToken: globalThis.__frame5DocumentToken ?? null,
            inputValue: input?.value ?? null,
            inputRect: rect(inputRect),
            startRect: rect(startRect),
            scrollY: window.scrollY,
            counter: globalThis.__frame5Counter ?? -1,
          };
        })()`);
        if (snapshot?.marker === expectedMarker) {
          return { ...snapshot, webContentsId: contents.id };
        }
      } catch {
        // Another guest can be between documents while this one becomes ready.
      }
    }
    return null;
  }, marker);
}

async function sendGuestClick(
  app: ElectronApplication,
  marker: string,
  rect: DOMRectSnapshot,
  text = "",
): Promise<void> {
  await app.evaluate(async ({ webContents }, input) => {
    let guest: Electron.WebContents | undefined;
    for (const candidate of webContents.getAllWebContents()) {
      if (candidate.getType() !== "webview") continue;
      const marker = await candidate.executeJavaScript(
        "document.documentElement.dataset.continuityMarker ?? null",
      ).catch(() => null);
      if (marker === input.marker) {
        guest = candidate;
        break;
      }
    }
    if (!guest) throw new Error(`Expected Electron guest ${input.marker}`);
    guest.focus();
    const x = Math.round(input.rect.x + input.rect.width / 2);
    const y = Math.round(input.rect.y + input.rect.height / 2);
    guest.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    guest.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    for (const character of input.text) {
      guest.sendInputEvent({ type: "char", keyCode: character });
    }
  }, { marker, rect, text });
}

async function requireGuestSnapshot(
  app: ElectronApplication,
  marker: string,
): Promise<GuestDocumentSnapshot> {
  try {
    await expect.poll(async () => {
      const snapshot = await guestSnapshot(app, marker);
      return snapshot?.documentToken ? snapshot.marker : null;
    }, { timeout: 15_000 }).toBe(marker);
  } catch (cause) {
    const guests = await app.evaluate(async ({ webContents }) =>
      Promise.all(webContents.getAllWebContents()
        .filter((contents) => contents.getType() === "webview")
        .map(async (contents) => ({
          id: contents.id,
          url: contents.getURL(),
          marker: await contents.executeJavaScript(
            "document.documentElement.dataset.continuityMarker ?? null",
          ).catch(() => null),
        })))
    );
    throw new Error(`Expected Electron guest ${marker}; observed ${JSON.stringify(guests)}`, { cause });
  }
  const snapshot = await guestSnapshot(app, marker);
  if (!snapshot) throw new Error(`Expected Electron guest ${marker}`);
  return snapshot;
}

const FIRST_DOCUMENT = `<!doctype html>
  <html data-continuity-marker="frame5-first">
    <head>
      <meta charset="utf-8">
      <style>
        body { margin: 0; min-height: 2800px; padding: 24px; }
        input { display: block; width: 320px; height: 36px; font: 18px sans-serif; }
        button, output { display: block; margin-top: 16px; }
      </style>
    </head>
    <body>
      <input id="continuity-input" value="">
      <button id="continuity-start" type="button">Start counter</button>
      <output id="continuity-counter">0</output>
      <script>
        globalThis.__frame5DocumentToken = crypto.randomUUID();
        globalThis.__frame5Counter = 0;
        document.querySelector('#continuity-start').addEventListener('click', () => {
          if (globalThis.__frame5CounterTimer) return;
          globalThis.__frame5CounterTimer = setInterval(() => {
            globalThis.__frame5Counter += 1;
            document.querySelector('#continuity-counter').textContent =
              String(globalThis.__frame5Counter);
          }, 16);
        });
      </script>
    </body>
  </html>`;

const SECOND_DOCUMENT = `<!doctype html>
  <html data-continuity-marker="frame5-second">
    <body>
      <h1>Second live Electron document</h1>
      <script>globalThis.__frame5DocumentToken = crypto.randomUUID();</script>
    </body>
  </html>`;

// The exact-title sizing declaration is code-authoritative frame-core evidence;
// the continuity declaration is product acceptance for specs/product/artifacts.md.
// Both drive the permanent application and Stage in real Electron against a
// really running server. Authored documents enter through TelevisionClient.
// The fixture-launch hook selects only the app URL, and the standing CSS-motion
// override forfeits motion, which neither case claims.
test.describe("Electron artifact frame outcomes", () => {
  test("real app URL webview fills the artifact card content area", async () => {
    const harness = await startHarness("Electron frame sizing");
    let app: ElectronApplication | null = null;
    try {
      const guestURLMarker = "height-probe";
      const artifact = await createURLArtifact(
        harness,
        "Remote height probe",
        `${desktopViteBaseURL}/packages/desktop/test/e2e/fixtures/webview-bridge-embed.html?${guestURLMarker}`,
      );
      const launched = await openApplication(harness);
      app = launched.app;
      await expect(webviewFor(launched.page, artifact.id)).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () =>
        (await measureWebviewLayout(launched.page, launched.app, artifact.id, guestURLMarker))
          .webviewDocument
      ).not.toBeNull();

      const metrics = await measureWebviewLayout(
        launched.page,
        launched.app,
        artifact.id,
        guestURLMarker,
      );
      expect(metrics.main.height).toBeGreaterThan(500);
      expect(metrics.stage.height).toBeGreaterThan(400);
      expect(metrics.page.height).toBeGreaterThan(300);
      expect(metrics.frameView.height).toBeCloseTo(metrics.page.height, 0);
      expect(metrics.availableDocumentArea.height).toBeGreaterThan(250);
      expect(metrics.webview.x).toBeCloseTo(metrics.availableDocumentArea.x, 0);
      expect(metrics.webview.y).toBeCloseTo(metrics.availableDocumentArea.y, 0);
      expect(metrics.webview.width).toBeCloseTo(metrics.availableDocumentArea.width, 0);
      // The document extends one pixel beneath the chin to hide its raster edge during scaling.
      expect(metrics.webview.height).toBeCloseTo(metrics.availableDocumentArea.height + 1, 0);
      expect(metrics.titleBar.y).toBeCloseTo(metrics.webview.y + metrics.webview.height - 1, 0);
      expect(metrics.webviewDocument).not.toBeNull();
      expect(metrics.webviewDocument!.innerWidth).toBeGreaterThan(metrics.webview.width * 0.9);
      expect(metrics.webviewDocument!.innerHeight).toBeGreaterThan(metrics.webview.height * 0.9);
    } finally {
      await app?.close();
      await disposeHarness(harness);
    }
  });

  test("preserves typed, scrolled, and running webview state through a tab switch without another load (^af-ac-tab-continuity)", async () => {
    const harness = await startHarness("Electron continuity");
    let app: ElectronApplication | null = null;
    try {
      const firstPath = createArtifactFile(
        harness.storagePath,
        "continuity-first",
        FIRST_DOCUMENT,
        "html",
      );
      const secondPath = createArtifactFile(
        harness.storagePath,
        "continuity-second",
        SECOND_DOCUMENT,
        "html",
      );
      const first = await createPathArtifact(harness, "Continuity first", firstPath);
      const second = await createPathArtifact(harness, "Continuity second", secondPath);
      const firstDocumentLoads = countArtifactDocumentLoads(harness.server, first.id);
      const launched = await openApplication(harness);
      app = launched.app;
      const firstWebview = webviewFor(launched.page, first.id);
      await expect(firstWebview).toBeVisible({ timeout: 15_000 });
      const originalWebviewHandle = await firstWebview.elementHandle();
      if (!originalWebviewHandle) throw new Error("Expected first Electron webview element");

      const ready = await requireGuestSnapshot(launched.app, "frame5-first");
      if (!ready.inputRect || !ready.startRect) throw new Error("Expected continuity control bounds");
      const webviewBox = await firstWebview.boundingBox();
      if (!webviewBox) throw new Error("Expected first Electron webview bounds");
      const typedValue = "work survives Electron tab selection";
      await sendGuestClick(launched.app, "frame5-first", ready.inputRect, typedValue);
      await expect.poll(async () =>
        (await guestSnapshot(launched.app, "frame5-first"))?.inputValue
      ).toBe(typedValue);
      await sendGuestClick(launched.app, "frame5-first", ready.startRect);
      await expect.poll(async () =>
        (await guestSnapshot(launched.app, "frame5-first"))?.counter ?? -1
      ).toBeGreaterThan(0);

      await launched.page.mouse.move(
        webviewBox.x + webviewBox.width / 2,
        webviewBox.y + webviewBox.height / 2,
      );
      await launched.page.mouse.wheel(0, 700);
      await expect.poll(async () =>
        (await guestSnapshot(launched.app, "frame5-first"))?.scrollY ?? 0
      ).toBeGreaterThan(0);
      const beforeSwitch = await requireGuestSnapshot(launched.app, "frame5-first");
      expect(firstDocumentLoads()).toBe(1);

      await selectArtifact(launched.page, second.id);
      expect((await requireGuestSnapshot(launched.app, "frame5-second")).marker)
        .toBe("frame5-second");
      await expect(firstWebview).toBeAttached();
      await expect.poll(async () =>
        (await guestSnapshot(launched.app, "frame5-first"))?.counter ?? -1,
      { timeout: 15_000 }).toBeGreaterThan(beforeSwitch.counter);

      await selectArtifact(launched.page, first.id);
      const returnedWebviewHandle = await firstWebview.elementHandle();
      if (!returnedWebviewHandle) throw new Error("Expected returned Electron webview element");
      expect(await originalWebviewHandle.evaluate(
        (element, returned) => element === returned,
        returnedWebviewHandle,
      )).toBe(true);
      const afterReturn = await requireGuestSnapshot(launched.app, "frame5-first");
      expect(afterReturn.webContentsId).toBe(beforeSwitch.webContentsId);
      expect(afterReturn.documentToken).toBe(beforeSwitch.documentToken);
      expect(afterReturn.inputValue).toBe(typedValue);
      expect(afterReturn.scrollY).toBe(beforeSwitch.scrollY);
      expect(afterReturn.counter).toBeGreaterThan(beforeSwitch.counter);
      expect(firstDocumentLoads()).toBe(1);
    } finally {
      await app?.close();
      await disposeHarness(harness);
    }
  });
});
