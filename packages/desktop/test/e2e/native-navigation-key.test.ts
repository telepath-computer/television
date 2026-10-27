import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import {
  desktopE2EOrigin,
  launchDesktop,
} from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const VITE_BASE_URL = desktopE2EOrigin();
const TEST_ARROW = "ArrowRight";
const RAW_IMAGE_MARKER = "/raw-image.png";
const THIRD_PARTY_MARKER = "/third-party.html";
const PDF_MARKER = "/focused.pdf";

interface NativeKeyHarness {
  storagePath: string;
  store: ServerStore;
  server: Server;
  fixtureServer: HTTPServer;
  channelID: string;
  rawImageID: string;
  thirdPartyID: string;
  pdfID: string;
}

function minimalPdf(): Buffer {
  const stream = "BT /F1 18 Tf 72 720 Td (Television native key fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

async function createHarness(): Promise<NativeKeyHarness> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-native-key-"));
  const store = createServingStore(storagePath);
  const server = new Server({ store, port: 0 });
  const image = readFileSync(path.join(REPO_ROOT, "packages", "desktop", "assets", "icon.png"));
  const pdf = minimalPdf();
  const fixtureServer = createHTTPServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === RAW_IMAGE_MARKER) {
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.byteLength });
      response.end(image);
      return;
    }
    if (pathname === PDF_MARKER) {
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.byteLength });
      response.end(pdf);
      return;
    }
    if (pathname === THIRD_PARTY_MARKER) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Third party</title><input autofocus value='native key fixture'>");
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  await server.start();
  const address = fixtureServer.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  const fixtureOrigin = `http://127.0.0.1:${address.port}`;

  const channel = store.listChannels()[0]!;
  const rawImage = store.createArtifact({
    channelID: channel.id,
    kind: "url",
    title: "Raw image",
    url: `${fixtureOrigin}${RAW_IMAGE_MARKER}`,
  });
  const thirdParty = store.createArtifact({
    channelID: channel.id,
    kind: "url",
    title: "Third-party page",
    url: `${fixtureOrigin}${THIRD_PARTY_MARKER}`,
  });
  const pdfArtifact = store.createArtifact({
    channelID: channel.id,
    kind: "url",
    title: "Focused PDF",
    url: `${fixtureOrigin}${PDF_MARKER}`,
  });

  return {
    storagePath,
    store,
    server,
    fixtureServer,
    channelID: channel.id,
    rawImageID: rawImage.id,
    thirdPartyID: thirdParty.id,
    pdfID: pdfArtifact.id,
  };
}

async function disposeHarness(harness: NativeKeyHarness): Promise<void> {
  await harness.server.dispose();
  await new Promise<void>((resolve, reject) => {
    harness.fixtureServer.close((error) => error ? reject(error) : resolve());
  });
  rmSync(harness.storagePath, { recursive: true, force: true });
}

async function openDesktop(harness: NativeKeyHarness): Promise<{ app: ElectronApplication; page: Page }> {
  const fixture = `${await appURLForServer(harness.server.getBaseURL(), VITE_BASE_URL)}/packages/web/src/index.html?token=${encodeURIComponent(harness.server.getAuthToken())}&mode=electron`;
  const launched = await launchDesktop({ fixture });
  await expect(launched.page.locator("#app .stage")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => launched.page.locator(".artifact-view webview.artifact-content").count(), {
    timeout: 15_000,
  }).toBe(3);
  return launched;
}

async function installApplicationObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __nativeNavigationKeys?: string[];
      __telepath?: {
        applicationService: {
          handleNavigationKey(key: string): void;
        };
      };
    };
    const application = target.__telepath?.applicationService;
    if (!application) throw new Error("application service seam missing");
    const original = application.handleNavigationKey.bind(application);
    target.__nativeNavigationKeys = [];
    application.handleNavigationKey = (key: string): void => {
      target.__nativeNavigationKeys!.push(key);
      original(key);
    };
  });
}

async function observedApplicationKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => (
    (globalThis as typeof globalThis & { __nativeNavigationKeys?: string[] })
      .__nativeNavigationKeys ?? []
  ));
}

async function clearApplicationKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __nativeNavigationKeys?: string[] })
      .__nativeNavigationKeys = [];
  });
}

async function selectArtifact(page: Page, channelID: string, artifactID: string): Promise<void> {
  await page.evaluate(({ selectedChannelID, selectedArtifactID }) => {
    const target = globalThis as typeof globalThis & {
      __telepath?: {
        applicationService: {
          selectPage(channelID: string, artifactID: string): void;
        };
      };
    };
    target.__telepath?.applicationService.selectPage(selectedChannelID, selectedArtifactID);
  }, { selectedChannelID: channelID, selectedArtifactID: artifactID });
  await expect.poll(() => page.locator(".page[selected]").getAttribute("data-page-key"))
    .toBe(artifactID);
}

async function findGuestURL(app: ElectronApplication, marker: string): Promise<string | null> {
  return app.evaluate(({ webContents }, expectedMarker) => (
    webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker))
      ?.getURL() ?? null
  ), marker);
}

async function prepareGuest(app: ElectronApplication, marker: string): Promise<void> {
  await expect.poll(() => findGuestURL(app, marker), { timeout: 15_000 }).not.toBeNull();
  await app.evaluate(async ({ webContents }, expectedMarker) => {
    const guest = webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker));
    if (!guest) throw new Error(`webview missing for ${expectedMarker}`);
    await guest.executeJavaScript(`
      globalThis.__nativeKeydowns = [];
      globalThis.addEventListener("keydown", (event) => {
        globalThis.__nativeKeydowns.push(event.key);
      }, { capture: true });
    `);
    guest.focus();
    guest.sendInputEvent({ type: "mouseDown", x: 100, y: 100, button: "left", clickCount: 1 });
    guest.sendInputEvent({ type: "mouseUp", x: 100, y: 100, button: "left", clickCount: 1 });
  }, marker);
}

async function observedGuestKeys(app: ElectronApplication, marker: string): Promise<string[]> {
  return app.evaluate(async ({ webContents }, expectedMarker) => {
    const guest = webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker));
    if (!guest) throw new Error(`webview missing for ${expectedMarker}`);
    return await guest.executeJavaScript("globalThis.__nativeKeydowns ?? []");
  }, marker);
}

async function sendArrow(app: ElectronApplication, marker: string, matching: boolean): Promise<void> {
  await app.evaluate(({ webContents }, { expectedMarker, matches }) => {
    const guest = webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker));
    if (!guest) throw new Error(`webview missing for ${expectedMarker}`);
    const modifiers: Array<"alt" | "control"> = matches
      ? process.platform === "darwin" ? ["alt"] : ["control"]
      : [];
    guest.focus();
    guest.sendInputEvent({ type: "keyDown", keyCode: "Right", modifiers });
    guest.sendInputEvent({ type: "keyUp", keyCode: "Right", modifiers });
  }, { expectedMarker: marker, matches: matching });
}

async function sendNativeArrowFromFocusedWebContents(
  app: ElectronApplication,
  direction: "Left" | "Right",
): Promise<void> {
  await app.evaluate(({ webContents }, keyCode) => {
    const focused = webContents.getFocusedWebContents();
    if (!focused) throw new Error("No focused web contents for native navigation");
    const modifiers: Array<"alt" | "control"> = process.platform === "darwin"
      ? ["alt"]
      : ["control"];
    focused.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    focused.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  }, direction);
}

async function expectSelectedArtifactDocument(
  page: Page,
  artifactID: string,
): Promise<void> {
  await expect(page.locator(`.top-bar .tab[data-artifact-id="${artifactID}"]`))
    .toHaveAttribute("aria-selected", "true");
  const selectedPage = page.locator(`.page[data-page-key="${artifactID}"][selected]`);
  const view = selectedPage.locator(".artifact-view");
  await expect(view).toHaveAttribute("data-embed-loaded", "");
  await expect.poll(() => view.evaluate((element) => (
    (element as unknown as { _trustedChannel?: { currentGuid?: string | null } })
      ._trustedChannel?.currentGuid ?? null
  ))).not.toBeNull();
  await expect.poll(() => view.locator("webview.artifact-content").getAttribute("src"))
    .toContain(`/artifact/${artifactID}/`);
}

async function focusSelectedWebview(
  app: ElectronApplication,
  page: Page,
  artifactID: string,
): Promise<void> {
  const src = await page.locator(
    `.page[data-page-key="${artifactID}"][selected] webview.artifact-content`,
  ).getAttribute("src");
  if (!src) throw new Error(`Selected webview ${artifactID} has no source`);
  await app.evaluate(({ webContents }, expectedURL) => {
    const guest = webContents.getAllWebContents().find((candidate) =>
      candidate.getType() === "webview" && candidate.getURL() === expectedURL
    );
    if (!guest) throw new Error(`Selected webview missing for ${expectedURL}`);
    guest.focus();
    guest.sendInputEvent({ type: "mouseDown", x: 100, y: 100, button: "left", clickCount: 1 });
    guest.sendInputEvent({ type: "mouseUp", x: 100, y: 100, button: "left", clickCount: 1 });
  }, src);
}

async function clickShellRegion(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click({ position: { x: 4, y: 4 } });
}

// spec: proofs/product/keyboard-navigation.md#^tp-ac-chord-focus-continuity-electron
// spec: proofs/product/keyboard-navigation.md#^tp-ac-chord-focused-tab-electron
test("continues repeated page traversal across artifact, focused tab, shell background, and sidebar focus (^tp-ac-chord-focus-continuity-electron, ^tp-ac-chord-focused-tab-electron)", async () => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-native-navigation-product-"));
  const store = createServingStore(storagePath);
  const channel = store.listChannels()[0]!;
  const artifactIDs: string[] = [];
  for (const index of [1, 2, 3]) {
    const filePath = path.join(storagePath, `native-navigation-${index}.html`);
    writeFileSync(
      filePath,
      `<!doctype html><title>Native navigation ${index}</title><button id="artifact-focus">Native navigation ${index}</button>`,
      "utf8",
    );
    artifactIDs.push(store.createArtifact({
      channelID: channel.id,
      kind: "path",
      title: `Native navigation ${index}`,
      path: filePath,
    }).id);
  }
  const server = new Server({ store, port: 0 });
  let app: ElectronApplication | null = null;
  try {
    await server.start();
    const fixture = `${await appURLForServer(server.getBaseURL(), VITE_BASE_URL)}/packages/web/src/index.html?token=${encodeURIComponent(server.getAuthToken())}&mode=electron`;
    const launched = await launchDesktop({ fixture });
    app = launched.app;
    await expect(launched.page.locator("#app .stage")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => launched.page.locator(".artifact-view webview.artifact-content").count(), {
      timeout: 15_000,
    }).toBe(3);

    const [first, second, third] = artifactIDs;
    if (!first || !second || !third) throw new Error("Expected three native navigation artifacts");
    for (const artifactID of artifactIDs) {
      const view = launched.page.locator(
        `.page[data-page-key="${artifactID}"] .artifact-view`,
      );
      await expect(view).toHaveAttribute("data-embed-loaded", "");
      await expect.poll(() => view.evaluate((element) => (
        (element as unknown as { _trustedChannel?: { currentGuid?: string | null } })
          ._trustedChannel?.currentGuid ?? null
      ))).not.toBeNull();
    }

    const traverseBothWays = async (): Promise<void> => {
      await sendNativeArrowFromFocusedWebContents(launched.app, "Right");
      await expectSelectedArtifactDocument(launched.page, second);
      await expect(launched.page.locator("body")).toBeFocused();
      await sendNativeArrowFromFocusedWebContents(launched.app, "Right");
      await expectSelectedArtifactDocument(launched.page, third);
      await sendNativeArrowFromFocusedWebContents(launched.app, "Left");
      await expectSelectedArtifactDocument(launched.page, second);
      await sendNativeArrowFromFocusedWebContents(launched.app, "Left");
      await expectSelectedArtifactDocument(launched.page, first);
    };

    await expectSelectedArtifactDocument(launched.page, first);
    await focusSelectedWebview(launched.app, launched.page, first);
    await traverseBothWays();

    const firstTab = launched.page.locator(
      `.top-bar .tab[data-artifact-id="${first}"]`,
    );
    await firstTab.click();
    await expect(firstTab).toBeFocused();
    await traverseBothWays();

    await clickShellRegion(launched.page, ".stage");
    await traverseBothWays();

    await clickShellRegion(launched.page, ".sidebar-titlebar");
    await traverseBothWays();
  } finally {
    if (app) await app.close();
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

// spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-key-seam
test("uses the real host platform for matching and non-matching native webview input", async () => {
  const harness = await createHarness();
  let app: ElectronApplication | null = null;
  try {
    const launched = await openDesktop(harness);
    app = launched.app;
    await installApplicationObserver(launched.page);
    await selectArtifact(launched.page, harness.channelID, harness.thirdPartyID);
    await prepareGuest(launched.app, THIRD_PARTY_MARKER);

    await sendArrow(launched.app, THIRD_PARTY_MARKER, false);
    await expect.poll(() => observedGuestKeys(launched.app, THIRD_PARTY_MARKER)).toEqual([TEST_ARROW]);
    expect(await observedApplicationKeys(launched.page)).toEqual([]);

    await prepareGuest(launched.app, THIRD_PARTY_MARKER);
    await sendArrow(launched.app, THIRD_PARTY_MARKER, true);
    await expect.poll(() => observedApplicationKeys(launched.page)).toEqual([TEST_ARROW]);
    expect(await observedGuestKeys(launched.app, THIRD_PARTY_MARKER)).toEqual([]);
  } finally {
    if (app) await app.close();
    await disposeHarness(harness);
  }
});

// spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-keys
test("delivers consumed native chords once over a raw image, third-party page, and focused PDF", async () => {
  const harness = await createHarness();
  let app: ElectronApplication | null = null;
  try {
    const launched = await openDesktop(harness);
    app = launched.app;
    await installApplicationObserver(launched.page);
    for (const fixture of [
      { artifactID: harness.rawImageID, marker: RAW_IMAGE_MARKER },
      { artifactID: harness.thirdPartyID, marker: THIRD_PARTY_MARKER },
      { artifactID: harness.pdfID, marker: PDF_MARKER },
    ]) {
      await selectArtifact(launched.page, harness.channelID, fixture.artifactID);
      await prepareGuest(launched.app, fixture.marker);
      await clearApplicationKeys(launched.page);

      await sendArrow(launched.app, fixture.marker, true);

      await expect.poll(() => observedApplicationKeys(launched.page)).toEqual([TEST_ARROW]);
      expect(await observedGuestKeys(launched.app, fixture.marker)).toEqual([]);
    }
  } finally {
    if (app) await app.close();
    await disposeHarness(harness);
  }
});
