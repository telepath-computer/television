import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server, telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "@telepath-computer/television-server";
import { CLIENT_ID_KEY } from "../../src/services/telemetry-client.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion, waitForApplicationShell } from "./helpers.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const PRIVATE_CHANNEL_NAME = "Alice Private Session Screen";

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
  server: Server;
  sink: RecordingTelemetrySink;
  appURL: string;
}

async function startHarness(viteBaseURL: string): Promise<Harness> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-browser-telemetry-e2e-"));
  const store = createServingStore(storagePath);
  const sink = new RecordingTelemetrySink();
  const server = new Server({
    store,
    host: LOOPBACK_HOST,
    port: EPHEMERAL_PORT,
    auth: false,
    telemetry: { env: TEST_TELEMETRY_ENV, sink, version: TEST_VERSION, launchMode: "cli" },
  });
  await server.start();
  sink.clear();
  const url = new URL("/packages/web/src/index.html", await appURLForServer(server.getBaseURL(), viteBaseURL));
  return { storagePath, server, sink, appURL: url.toString() };
}

async function disposeHarness(harness: Harness): Promise<void> {
  await harness.server.dispose();
  rmSync(harness.storagePath, { recursive: true, force: true });
}

async function waitForApp(page: Page): Promise<void> {
  await waitForApplicationShell(page);
  await configureTestMotion(page);
  await expect.poll(() => page.evaluate(() => {
    return (window as Window & { __telepath?: { connectionOwner?: { connection: { status: string } } } }).__telepath?.connectionOwner?.connection.status ?? null;
  })).toBe("connected");
}

async function clientId(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), CLIENT_ID_KEY);
}

const ACTIVITY_CLICK_POINT = { x: 500, y: 500 };

async function sendActivity(page: Page): Promise<void> {
  await page.mouse.click(ACTIVITY_CLICK_POINT.x, ACTIVITY_CLICK_POINT.y);
}

async function waitForTelemetryEvent(
  harness: Harness,
  eventName: string,
  afterEventCount = 0,
): Promise<BuiltTelemetryEvent> {
  await expect.poll(() => harness.sink.events.slice(afterEventCount).find((event) => event.name === eventName) ?? null).not.toBeNull();
  return harness.sink.events.slice(afterEventCount).find((event) => event.name === eventName)!;
}

async function openApp(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await waitForApp(page);
  return page;
}


test.describe("browser telemetry sessions", () => {
  test("persists client id across reload, sends session activity, and stamps API actions with the same session", async ({ page, baseURL }) => {
    const harness = await startHarness(baseURL!);
    try {
      await page.goto(harness.appURL);
      await waitForApp(page);
      const firstClientId = await clientId(page);
      expect(firstClientId).toEqual(expect.any(String));

      const beforeFirstActivity = harness.sink.events.length;
      await sendActivity(page);
      const firstActivity = await waitForTelemetryEvent(harness, "session_activity", beforeFirstActivity);
      const sessionId = firstActivity.properties.$session_id;
      expect(sessionId).toEqual(expect.any(String));

      const beforeReloadEventCount = harness.sink.events.length;
      await page.reload();
      await waitForApp(page);
      expect(await clientId(page)).toBe(firstClientId);
      const activeTelemetryMeta = await page.evaluate(() => {
        return (window as Window & { __telepath?: { connectionOwner?: { connection: { telemetryMeta?: { clientId: string } | null } } } }).__telepath?.connectionOwner?.connection.telemetryMeta ?? null;
      });
      expect(activeTelemetryMeta?.clientId).toBe(firstClientId);

      await sendActivity(page);
      const activity = await waitForTelemetryEvent(harness, "session_activity", beforeReloadEventCount);
      expect(activity.properties.$session_id).toBe(sessionId);
      expect(activity.properties).toMatchObject({
        server_version: TEST_VERSION,
        client_app: "browser",
        client_platform: process.platform === "darwin" ? "macos" : "linux",
        browser_vendor: "chrome",
      });
      expect(activity.properties.browser_major_version).toEqual(expect.any(Number));
      for (const emittedActivity of [firstActivity, activity]) {
        const serializedActivity = JSON.stringify(emittedActivity);
        expect(serializedActivity).not.toContain(harness.appURL);
        expect(serializedActivity).not.toContain(firstClientId!);
        expect(serializedActivity).not.toContain(PRIVATE_CHANNEL_NAME);
      }

      await page.evaluate((name) => {
        const owner = (window as Window & { __telepath?: { connectionOwner?: { connection: { client: { channels: { create(input: { name: string }): Promise<unknown> } } } } } }).__telepath?.connectionOwner;
        if (!owner?.connection) throw new Error("missing connection");
        return owner.connection.client.channels.create({ name });
      }, PRIVATE_CHANNEL_NAME);
      const channelCreated = await waitForTelemetryEvent(harness, "screen_created");
      expect(channelCreated.properties.$session_id).toBe(activity.properties.$session_id);
      expect(JSON.stringify(channelCreated)).not.toContain(PRIVATE_CHANNEL_NAME);
    } finally {
      await disposeHarness(harness);
    }
  });

  test("uses one browser client id for two tabs and across a persistent browser restart", async ({ baseURL }) => {
    const harness = await startHarness(baseURL!);
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), "television-browser-telemetry-profile-"));
    try {
      let context = await chromium.launchPersistentContext(userDataDir);
      const first = await openApp(context, harness.appURL);
      const second = await openApp(context, harness.appURL);
      const firstId = await clientId(first);
      expect(firstId).toEqual(expect.any(String));
      expect(await clientId(second)).toBe(firstId);

      const beforeFirstTabActivity = harness.sink.events.length;
      await first.bringToFront();
      await sendActivity(first);
      const firstActivity = await waitForTelemetryEvent(harness, "session_activity", beforeFirstTabActivity);
      const beforeSecondTabActivity = harness.sink.events.length;
      await second.bringToFront();
      await sendActivity(second);
      const secondActivity = await waitForTelemetryEvent(harness, "session_activity", beforeSecondTabActivity);
      expect(firstActivity.properties.$session_id).toEqual(expect.any(String));
      expect(secondActivity.properties.$session_id).toBe(firstActivity.properties.$session_id);
      for (const activity of [firstActivity, secondActivity]) {
        const serializedActivity = JSON.stringify(activity);
        expect(serializedActivity).not.toContain(harness.appURL);
        expect(serializedActivity).not.toContain(firstId!);
      }
      await context.close();

      context = await chromium.launchPersistentContext(userDataDir);
      const restarted = await openApp(context, harness.appURL);
      expect(await clientId(restarted)).toBe(firstId);
      await context.close();
    } finally {
      await disposeHarness(harness);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
})
