import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { desktopE2EOrigin, launchDesktop } from "./helpers.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const VITE_BASE_URL = desktopE2EOrigin();
const TEST_ARTIFACT_POLL_CADENCE = { normalMs: 250, slowMs: 750 } as const;

interface Harness {
  producerStorage: string;
  consumerStorage: string;
  producerStore: ServerStore;
  consumerStore: ServerStore;
  producer: Server;
  consumer: Server;
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function createHarness(): Promise<Harness> {
  const producerStorage = tempDir("television-desktop-guerilla-producer-");
  const consumerStorage = tempDir("television-desktop-guerilla-consumer-");
  const producerStore = createServingStore(producerStorage);
  const consumerStore = createServingStore(consumerStorage);
  const producer = new Server({
    store: producerStore,
    port: 0,
    testArtifactPollCadence: TEST_ARTIFACT_POLL_CADENCE,
  });
  const consumer = new Server({ store: consumerStore, port: 0 });
  await producer.start();
  await consumer.start();
  return { producerStorage, consumerStorage, producerStore, consumerStore, producer, consumer };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.producer.dispose();
  await harness.consumer.dispose();
  rmSync(harness.producerStorage, { recursive: true, force: true });
  rmSync(harness.consumerStorage, { recursive: true, force: true });
}

function writeArtifactFile(storagePath: string, name: string, content: string, extension: "html" | "md"): string {
  const dir = path.join(storagePath, "files");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.${extension}`);
  writeFileSync(filePath, content, { encoding: "utf8", flag: "w" });
  return filePath;
}

function proxyURL(server: Server, artifactID: string, filePath: string): string {
  return `${server.getBaseURL()}/artifact/${artifactID}/${encodeURIComponent(path.basename(filePath))}`;
}

async function openConsumerDesktop(harness: Harness): Promise<{ app: ElectronApplication; page: Page }> {
  const fixture = `${await appURLForServer(harness.consumer.getBaseURL(), VITE_BASE_URL)}/packages/web/src/index.html?token=${encodeURIComponent(harness.consumer.getAuthToken())}&mode=electron`;
  const launched = await launchDesktop({
    fixture,
    env: {
      TV_TEST_ARTIFACT_POLL_NORMAL_MS: String(TEST_ARTIFACT_POLL_CADENCE.normalMs),
      TV_TEST_ARTIFACT_POLL_SLOW_MS: String(TEST_ARTIFACT_POLL_CADENCE.slowMs),
    },
  });
  await expect(launched.page.locator("#app .stage")).toBeVisible({ timeout: 15_000 });
  await expect(launched.page.locator(".artifact-view webview.artifact-content").first()).toBeVisible({ timeout: 15_000 });
  return launched;
}

// Trust has no public presentation state; this helper is reserved for real-webview adoption evidence.
async function artifactTrustGuid(page: Page): Promise<string | null> {
  return page.locator(".artifact-view").evaluate((view) => (
    view as unknown as { _trustedChannel: { currentGuid: string | null } }
  )._trustedChannel.currentGuid);
}

async function webviewText(app: ElectronApplication, selector: string): Promise<string> {
  return await app.evaluate(async ({ webContents }, targetSelector) => {
    const wc = webContents.getAllWebContents().find((c) => c.getType() === "webview");
    if (!wc) throw new Error("no webview WebContents found");
    return await wc.executeJavaScript(`document.querySelector(${JSON.stringify(targetSelector)})?.textContent ?? ""`);
  }, selector);
}

async function webviewRootTheme(app: ElectronApplication): Promise<string | null> {
  return await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((c) => c.getType() === "webview");
    if (!wc) throw new Error("no webview WebContents found");
    return await wc.executeJavaScript("document.documentElement.dataset.theme ?? null");
  });
}

function trackArtifactHeadRequests(server: Server, artifactID: string): {
  all: () => number;
  successful: () => number;
} {
  let all = 0;
  let successful = 0;
  const prefix = `/artifact/${artifactID}/`;
  server.httpServer.prependListener("request", (request, response) => {
    if (request.method !== "HEAD" || !request.url?.startsWith(prefix)) return;
    all += 1;
    response.once("finish", () => {
      if ((response.statusCode >= 200 && response.statusCode < 300) || response.statusCode === 304) {
        successful += 1;
      }
    });
  });
  return { all: () => all, successful: () => successful };
}

test.describe("Electron artifact bridge lifecycle", () => {
  test("adopts preload readiness before a fast webview load and rotates GUID after navigation", async () => {
    const h = await createHarness();
    let app: ElectronApplication | null = null;
    try {
      const artifactDirectory = path.join(h.producerStorage, "files", "lifecycle");
      mkdirSync(artifactDirectory, { recursive: true });
      writeFileSync(
        path.join(artifactDirectory, "index.html"),
        "<!doctype html><h1 id='msg'>one</h1><a id='next' href='./next.html'>Next</a>",
      );
      writeFileSync(path.join(artifactDirectory, "next.html"), "<!doctype html><h1 id='msg'>two</h1>");

      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({
        channelID: producerChannel.id,
        kind: "path",
        title: "Lifecycle",
        path: artifactDirectory,
      });
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({
        channelID: consumerChannel.id,
        kind: "url",
        title: "Remote lifecycle",
        url: proxyURL(h.producer, producerArtifact.id, path.join(artifactDirectory, "index.html")),
      });

      const launched = await openConsumerDesktop(h);
      app = launched.app;
      await expect.poll(() => webviewText(launched.app, "#msg"), { timeout: 15_000 }).toBe("one");
      let initialGuid: string | null = null;
      await expect.poll(async () => {
        initialGuid = await artifactTrustGuid(launched.page);
        return initialGuid;
      }, { timeout: 15_000 }).not.toBeNull();

      await launched.app.evaluate(async ({ webContents }) => {
        const guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview");
        if (!guest) throw new Error("no webview WebContents found");
        await guest.executeJavaScript("document.getElementById('next').click()");
      });

      await expect.poll(() => webviewText(launched.app, "#msg"), { timeout: 15_000 }).toBe("two");
      await expect.poll(async () => {
        const replacementGuid = await artifactTrustGuid(launched.page);
        return replacementGuid !== null && replacementGuid !== initialGuid ? replacementGuid : null;
      }, { timeout: 15_000 }).not.toBeNull();
    } finally {
      if (app) await app.close();
      await disposeHarness(h);
    }
  });
});

test.describe("Electron artifact freshness", () => {
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-content-poll-electron
  test("renders and live-reloads shared HTML artifacts through the webview preload", async () => {
    const h = await createHarness();
    let app: ElectronApplication | null = null;
    try {
      const htmlPath = writeArtifactFile(h.producerStorage, "shared", "<!doctype html><h1 id='msg'>one</h1>", "html");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Shared", path: htmlPath });
      const headRequests = trackArtifactHeadRequests(h.producer, producerArtifact.id);
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote", url: proxyURL(h.producer, producerArtifact.id, htmlPath) });

      const launched = await openConsumerDesktop(h);
      app = launched.app;
      await expect.poll(() => artifactTrustGuid(launched.page), { timeout: 15_000 }).not.toBeNull();
      await expect.poll(() => webviewText(launched.app, "#msg"), { timeout: 15_000 }).toBe("one");
      await expect.poll(headRequests.successful, { timeout: 15_000 }).toBeGreaterThan(0);

      writeFileSync(htmlPath, "<!doctype html><h1 id='msg'>two changed</h1>", "utf8");
      await expect.poll(() => webviewText(launched.app, "#msg"), {
        timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4,
      }).toBe("two changed");
    } finally {
      if (app) await app.close();
      await disposeHarness(h);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-electron
  test("retains the last shared document through an outage and reloads after recovery", async () => {
    const h = await createHarness();
    let app: ElectronApplication | null = null;
    try {
      const htmlPath = writeArtifactFile(h.producerStorage, "offline", "<!doctype html><h1 id='msg'>online</h1>", "html");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Offline", path: htmlPath });
      const headRequests = trackArtifactHeadRequests(h.producer, producerArtifact.id);
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote offline", url: proxyURL(h.producer, producerArtifact.id, htmlPath) });

      const launched = await openConsumerDesktop(h);
      app = launched.app;
      await expect.poll(() => webviewText(launched.app, "#msg"), { timeout: 15_000 }).toBe("online");
      await expect.poll(headRequests.successful, { timeout: 15_000 }).toBeGreaterThan(0);
      const baselineRequests = headRequests.all();

      rmSync(htmlPath);
      await expect.poll(headRequests.all, { timeout: 15_000 }).toBeGreaterThan(baselineRequests);
      await expect.poll(() => webviewText(launched.app, "#msg")).toBe("online");

      writeFileSync(htmlPath, "<!doctype html><h1 id='msg'>back and changed</h1>", "utf8");
      await expect.poll(() => webviewText(launched.app, "#msg"), {
        timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4,
      }).toBe("back and changed");
    } finally {
      if (app) await app.close();
      await disposeHarness(h);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-raw-electron
  test("preload polling recovers a shared raw artifact route after an outage", async () => {
    const h = await createHarness();
    let app: ElectronApplication | null = null;
    try {
      const rawDirectory = path.join(h.producerStorage, "files", "raw");
      mkdirSync(rawDirectory, { recursive: true });
      writeFileSync(path.join(rawDirectory, "index.html"), "<!doctype html><h1>Raw fixture</h1>", "utf8");
      const textPath = path.join(rawDirectory, "content.txt");
      writeFileSync(textPath, "raw one", "utf8");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Raw", path: rawDirectory });
      const headRequests = trackArtifactHeadRequests(h.producer, producerArtifact.id);
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote raw", url: proxyURL(h.producer, producerArtifact.id, textPath) });

      const launched = await openConsumerDesktop(h);
      app = launched.app;
      await expect.poll(() => webviewText(launched.app, "body"), { timeout: 15_000 }).toContain("raw one");
      await expect.poll(headRequests.successful, { timeout: 15_000 }).toBeGreaterThan(0);
      const baselineRequests = headRequests.all();

      rmSync(textPath);
      await expect.poll(headRequests.all, { timeout: 15_000 }).toBeGreaterThan(baselineRequests);
      await expect.poll(() => webviewText(launched.app, "body")).toContain("raw one");

      writeFileSync(textPath, "raw two changed", "utf8");
      await expect.poll(() => webviewText(launched.app, "body"), {
        timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4,
      }).toContain("raw two changed");
    } finally {
      if (app) await app.close();
      await disposeHarness(h);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-csp-electron
  test("does not auto-recover when document CSP blocks preload polling", async () => {
    const h = await createHarness();
    let app: ElectronApplication | null = null;
    try {
      const csp = `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; script-src 'none'">`;
      const htmlPath = writeArtifactFile(h.producerStorage, "csp", `<!doctype html>${csp}<h1 id='msg'>csp one</h1>`, "html");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "CSP", path: htmlPath });
      const headRequests = trackArtifactHeadRequests(h.producer, producerArtifact.id);
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote CSP", url: proxyURL(h.producer, producerArtifact.id, htmlPath) });

      const launched = await openConsumerDesktop(h);
      app = launched.app;
      await expect.poll(() => webviewText(launched.app, "#msg"), { timeout: 15_000 }).toBe("csp one");
      expect(await webviewRootTheme(launched.app)).toBeNull();
      await expect.poll(headRequests.successful, { timeout: 15_000 }).toBeGreaterThan(0);
      const initialHeads = headRequests.all();
      await launched.page.waitForTimeout(TEST_ARTIFACT_POLL_CADENCE.normalMs * 3);
      expect(headRequests.all()).toBe(initialHeads);

      rmSync(htmlPath);
      await launched.page.waitForTimeout(TEST_ARTIFACT_POLL_CADENCE.normalMs * 3);
      expect(await webviewText(launched.app, "#msg")).toBe("csp one");
      expect(headRequests.all()).toBe(initialHeads);

      writeFileSync(htmlPath, `<!doctype html>${csp}<h1 id='msg'>csp two changed</h1>`, "utf8");
      await launched.page.waitForTimeout(TEST_ARTIFACT_POLL_CADENCE.normalMs * 3);
      expect(await webviewText(launched.app, "#msg")).toBe("csp one");
      expect(headRequests.all()).toBe(initialHeads);
    } finally {
      if (app) await app.close();
      await disposeHarness(h);
    }
  });
});
