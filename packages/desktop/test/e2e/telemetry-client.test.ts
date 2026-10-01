import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "@telepath-computer/television-server";
import { CLIENT_ID_KEY } from "../../../web/src/services/telemetry-client.ts";
import { createUserDataDir, expectConnectedPage, launchDesktopConnectScreen } from "./helpers.ts";
import { configureTestMotion } from "../../../web/test/e2e/helpers.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, "../../../web/dist");
const DESKTOP_PACKAGE_JSON = path.resolve(HERE, "..", "..", "package.json");
const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const ACTIVITY_CLICK_POINT = { x: 500, y: 500 };

class RecordingTelemetrySink implements TelemetryCaptureSink {
  readonly events: BuiltTelemetryEvent[] = [];
  enqueue(event: BuiltTelemetryEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}

interface Harness {
  storagePath: string;
  staticDir: string;
  server: Server;
  sink: RecordingTelemetrySink;
  serverURL: string;
  token: string;
}

async function startHarness(): Promise<Harness> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-desktop-telemetry-e2e-"));
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-desktop-telemetry-static-"));
  cpSync(WEB_DIST, staticDir, { recursive: true });
  const store = createServingStore(storagePath);
  const sink = new RecordingTelemetrySink();
  const server = new Server({
    store,
    host: LOOPBACK_HOST,
    port: EPHEMERAL_PORT,
    auth: true,
    staticDir,
    telemetry: { env: TEST_TELEMETRY_ENV, sink, version: TEST_VERSION, launchMode: "cli" },
  });
  await server.start();
  sink.clear();
  return { storagePath, staticDir, server, sink, serverURL: server.getBaseURL(), token: server.getAuthToken() };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.server.dispose();
  rmSync(harness.storagePath, { recursive: true, force: true });
  rmSync(harness.staticDir, { recursive: true, force: true });
}

async function waitForApp(page: Page): Promise<void> {
  await expectConnectedPage(page);
  await configureTestMotion(page);
  await expect.poll(() => page.evaluate(() => {
    return (window as Window & { __telepath?: { connectionOwner?: { connection: { status: string } } } }).__telepath?.connectionOwner?.connection.status ?? null;
  })).toBe("connected");
}

async function clientId(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), CLIENT_ID_KEY);
}

async function connectElectron(page: Page, harness: Harness): Promise<void> {
  await page.locator("#serverURL").fill(harness.serverURL);
  await page.locator("#token").fill(harness.token);
  await page.locator("#serverURL").press("Enter");
  await waitForApp(page);
}

async function sendActivity(page: Page): Promise<void> {
  await page.mouse.click(ACTIVITY_CLICK_POINT.x, ACTIVITY_CLICK_POINT.y);
}

async function waitForActivity(harness: Harness, afterEventCount = 0): Promise<BuiltTelemetryEvent> {
  await expect.poll(() => harness.sink.events.slice(afterEventCount).find((event) => event.name === "session_activity") ?? null).not.toBeNull();
  return harness.sink.events.slice(afterEventCount).find((event) => event.name === "session_activity")!;
}


test.describe("desktop telemetry", () => {

  test("desktop telemetry uses a persistent desktop client id with app version and differs from browser", async () => {
  const harness = await startHarness();
  const userDataDir = createUserDataDir("television-desktop-telemetry-profile-");
  let browserContext: BrowserContext | null = null;
  const browserUserDataDir = mkdtempSync(path.join(os.tmpdir(), "television-browser-vs-desktop-profile-"));
  try {
    const firstLaunch = await launchDesktopConnectScreen({
      userDataDir,
      env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
    });
    await connectElectron(firstLaunch.page, harness);
    const electronClientId = await clientId(firstLaunch.page);
    expect(electronClientId).toEqual(expect.any(String));

    const beforeDesktopActivity = harness.sink.events.length;
    await firstLaunch.page.reload();
    await waitForApp(firstLaunch.page);
    await sendActivity(firstLaunch.page);
    const activity = await waitForActivity(harness, beforeDesktopActivity);
    const desktopSessionId = activity.properties.$session_id;
    const desktopVersion = (JSON.parse(readFileSync(DESKTOP_PACKAGE_JSON, "utf8")) as { version: string }).version;
    expect(desktopSessionId).toEqual(expect.any(String));
    expect(activity.properties).toMatchObject({
      server_version: TEST_VERSION,
      client_app: "desktop",
      client_platform: process.platform === "darwin" ? "macos" : "linux",
      browser_vendor: "chrome",
      desktop_app_version: desktopVersion,
    });
    const serializedDesktopActivity = JSON.stringify(activity);
    expect(serializedDesktopActivity).not.toContain(harness.serverURL);
    expect(serializedDesktopActivity).not.toContain(electronClientId!);
    await firstLaunch.app.close();

    const secondLaunch = await launchDesktopConnectScreen({
      userDataDir,
      env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
    });
    await waitForApp(secondLaunch.page);
    expect(await clientId(secondLaunch.page)).toBe(electronClientId);
    await secondLaunch.app.close();

    browserContext = await chromium.launchPersistentContext(browserUserDataDir);
    const browserPage = await browserContext.newPage();
    await browserPage.goto(`${harness.serverURL}/?token=${encodeURIComponent(harness.token)}`);
    await waitForApplicationRender(browserPage, ["connected", "no-channel", "empty-channel"], 15_000);
    await configureTestMotion(browserPage);
    const browserClientId = await clientId(browserPage);
    expect(browserClientId).toEqual(expect.any(String));
    expect(browserClientId).not.toBe(electronClientId);

    const beforeBrowserActivity = harness.sink.events.length;
    await sendActivity(browserPage);
    const browserActivity = await waitForActivity(harness, beforeBrowserActivity);
    expect(browserActivity.properties).toMatchObject({
      server_version: TEST_VERSION,
      client_app: "browser",
      client_platform: process.platform === "darwin" ? "macos" : "linux",
      browser_vendor: "chrome",
    });
    expect(browserActivity.properties).not.toHaveProperty("desktop_app_version");
    expect(browserActivity.properties.$session_id).toEqual(expect.any(String));
    expect(browserActivity.properties.$session_id).not.toBe(desktopSessionId);
    const serializedBrowserActivity = JSON.stringify(browserActivity);
    expect(serializedBrowserActivity).not.toContain(harness.serverURL);
    expect(serializedBrowserActivity).not.toContain(browserClientId!);
  } finally {
    await browserContext?.close();
    await disposeHarness(harness);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(browserUserDataDir, { recursive: true, force: true });
  }
  });
})
