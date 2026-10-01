import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import request from "supertest";
import { once } from "node:events";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";
import { NO_THEME_SETTINGS } from "../../../test/helpers/telemetry-settings.ts";
import { Server } from "../src/server.ts";
import {
  createTelemetrySessionManager,
  isUUIDv7,
  telemetryVersion,
  type BuiltTelemetryEvent,
  type TelemetryCaptureSink,
  type TelemetryEnv,
} from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const CLIENT_ID = "client-event-stream";
const CHROME_LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const ACTIVITY_MESSAGE_TYPE = "telemetry-activity";

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
}

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-telemetry-event-stream-"));
}

describe("telemetry event stream activity", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0).reverse()) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<Harness> {
    const storagePath = tempDir();
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
    const harness = { storagePath, server, sink };
    harnesses.push(harness);
    return harness;
  }

  function eventsURL(harness: Harness, input: { includeTelemetryMeta: boolean }): string {
    const url = new URL("/events", harness.server.getBaseURL());
    url.protocol = "ws:";
    if (input.includeTelemetryMeta) {
      url.searchParams.set("clientId", CLIENT_ID);
      url.searchParams.set("clientApp", "browser");
      url.searchParams.set("userAgent", CHROME_LINUX_UA);
    }
    return url.toString();
  }

  async function openSocket(url: string): Promise<WebSocket> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return socket;
  }

  async function closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
    });
  }

  it("emits a content-free session_activity event from an activity signal", async () => {
    const h = await setup();
    const socket = await openSocket(eventsURL(h, { includeTelemetryMeta: true }));
    try {
      socket.send(JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, clientId: CLIENT_ID }));
      await expect.poll(() => h.sink.events.find((event) => event.name === "session_activity") ?? null).not.toBeNull();

      const activity = h.sink.events.find((event) => event.name === "session_activity")!;
      expect(activity.properties.$session_id).toEqual(expect.any(String));
      expect(activity.properties).toMatchObject({
        server_version: TEST_VERSION,
        client_app: "browser",
        client_platform: "linux",
        browser_vendor: "chrome",
        browser_major_version: 123,
      });
      const serialized = JSON.stringify(activity);
      expect(serialized).not.toContain(CHROME_LINUX_UA);
      expect(serialized).not.toContain("/events");
      expect(serialized).not.toContain(CLIENT_ID);
    } finally {
      await closeSocket(socket);
    }
  });

  // proofs/product/telemetry.md#^ac-private-metadata
  it("reduces private desktop metadata before session telemetry leaves the server", async () => {
    const h = await setup();
    const url = new URL(eventsURL(h, { includeTelemetryMeta: true }));
    url.searchParams.set("clientApp", "desktop");
    url.searchParams.set("desktopAppVersion", "2.3.4-alice+private-host");
    const socket = await openSocket(url.toString());
    try {
      socket.send(JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, clientId: CLIENT_ID }));
      await expect.poll(() => h.sink.events.find((event) => event.name === "session_activity")).toBeDefined();
      expect(h.sink.events.find((event) => event.name === "session_activity")?.properties).toMatchObject({ client_app: "desktop", desktop_app_version: "2.3.4" });
      expect(JSON.stringify(h.sink.events)).not.toMatch(/alice|private-host/);
    } finally { await closeSocket(socket); }
  });

  // Seam: proofs/arch/telemetry/emitters.md#^t-theme-settings-refresh.
  // Real HTTP, websocket and temporary package files; only delivery is replaced.
  it("TV-755 reads fresh consent and registry settings on activity without switch events", async () => {
    const h = await setup();
    const themeID = "private-live-settings";
    const seed = (background: boolean, overlay: boolean) => seedThemePackage(h.storagePath, themeID, "/* private */", {
      enableMainJS: true, mainJS: "/* private main */",
      enableIframeBackgroundJS: background, iframeBackgroundJS: "/* private background */",
      enableIframeOverlayJS: overlay, iframeOverlayJS: "/* private overlay */",
    });
    seed(true, false);
    await request(h.server.httpServer).post("/themes/refresh").expect(200);
    await request(h.server.httpServer).patch("/display").send({ activeThemeName: themeID }).expect(204);
    const socket = await openSocket(eventsURL(h, { includeTelemetryMeta: true }));
    const recordActivity = async () => {
      const count = h.sink.events.filter(({ name }) => name === "session_activity").length;
      socket.send(JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, clientId: CLIENT_ID }));
      await expect.poll(() => h.sink.events.filter(({ name }) => name === "session_activity").length).toBe(count + 1);
      return h.sink.events.filter(({ name }) => name === "session_activity").at(-1)!;
    };
    try {
      h.sink.clear();
      await request(h.server.httpServer).patch("/display").send({ themeJavaScriptConsentIds: [themeID] }).expect(204);
      await request(h.server.httpServer).post("/channels").send({ name: "Private unrelated action" }).expect(201);
      const unrelated = h.sink.events[0]!;
      const consented = await recordActivity();
      const original = JSON.stringify(consented);
      await request(h.server.httpServer).patch("/display").send({ themeJavaScriptConsentIds: [] }).expect(204);
      const revoked = await recordActivity();
      seed(false, true);
      await request(h.server.httpServer).post("/themes/refresh").expect(200);
      const refreshed = await recordActivity();
      expect(h.sink.events.map(({ name }) => name)).toEqual(["screen_created", "session_activity", "session_activity", "session_activity"]);

      const base = { ...NO_THEME_SETTINGS, theme_state: "custom", theme_main_js_declared: true, theme_iframe_background_enabled: true };
      expect.soft(unrelated.properties.$set).toMatchObject({ ...base, theme_main_js_enabled: true });
      for (const [event, settings] of [
        [consented, { ...base, theme_main_js_enabled: true }],
        [revoked, base],
        [refreshed, { ...base, theme_iframe_background_enabled: false, theme_iframe_overlay_enabled: true }],
      ] as const) {
        expect.soft(event.properties).toEqual({
          ...settings, distinct_id: event.distinctId, $session_id: expect.any(String),
          server_version: TEST_VERSION, client_app: "browser", client_platform: "linux",
          browser_vendor: "chrome", browser_major_version: 123, $set: settings,
        });
      }
      expect(JSON.stringify(consented)).toBe(original);
      expect(JSON.stringify(h.sink.events)).not.toContain(themeID);

      await request(h.server.httpServer).post("/telemetry/disable").expect(200);
      const countAfterOptOut = h.sink.events.length;
      socket.send(JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, clientId: CLIENT_ID }));
      const pong = once(socket, "pong");
      socket.ping();
      await pong; // Server processed the preceding activity frame; no elapsed-time guess.
      expect(h.sink.events).toHaveLength(countAfterOptOut);
    } finally {
      await closeSocket(socket);
    }
  });

  it("does not emit session activity for a socket that never sends activity", async () => {
    const h = await setup();
    const socket = await openSocket(eventsURL(h, { includeTelemetryMeta: true }));
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.sink.events).toEqual([]);
    } finally {
      await closeSocket(socket);
    }
  });

  it.each([
    ["a socket without client telemetry metadata", false, { type: ACTIVITY_MESSAGE_TYPE, clientId: CLIENT_ID }],
    ["a mismatched client id", true, { type: ACTIVITY_MESSAGE_TYPE, clientId: "different-client" }],
    ["an extra payload field", true, { type: ACTIVITY_MESSAGE_TYPE, clientId: CLIENT_ID, extra: true }],
  ] as const)("ignores activity from %s", async (_name, includeTelemetryMeta, message) => {
    const h = await setup();
    const socket = await openSocket(eventsURL(h, { includeTelemetryMeta }));
    try {
      socket.send(JSON.stringify(message));
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.sink.events).toEqual([]);
    } finally {
      await closeSocket(socket);
    }
  });
});

// Seam tests for the client telemetry signal
// (specs/arch/telemetry/client-signals.md), each crossed over a real /events
// websocket against a listening Server:
//   ^t-signal-forwarding — an accepted signal reaches the capture()
//     chokepoint exactly once, with the validated name and properties and the
//     client's current $session_id. Suppression is not re-proven here — it
//     composes across the chokepoint's own contract
//     (arch/telemetry/index.md ^t-capture-gate).
//   ^t-signal-activity — the same crossing bumps the client's session
//     lastActivityMs like any client-attributed request (sessions.md).
// Validation breadth lives in the validator's contract tests
// (src/telemetry/client-signals.test.ts ^t-signal-validation); one rejected
// probe rides here only to prove rejected signals produce no crossing at all.
describe("telemetry signal over the event stream", () => {
  const SIGNAL_MESSAGE_TYPE = "telemetry-signal";
  const START_MS = 1_750_000_000_000;
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0).reverse()) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
    }
  });

  interface SignalHarness extends Harness {
    sessions: ReturnType<typeof createTelemetrySessionManager>;
    tick(deltaMs: number): void;
  }

  async function setup(): Promise<SignalHarness> {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-signal-"));
    const store = createServingStore(storagePath);
    const sink = new RecordingTelemetrySink();
    // Injected session manager + clock make the ^t-signal-activity bump
    // directly observable (lastActivityMs) instead of inferred.
    const sessions = createTelemetrySessionManager();
    let nowMs = START_MS;
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: false,
      telemetry: {
        env: TEST_TELEMETRY_ENV,
        sink,
        version: TEST_VERSION,
        launchMode: "cli",
        sessions,
        nowMs: () => nowMs,
      },
    });
    await server.start();
    sink.clear();
    const harness: SignalHarness = { storagePath, server, sink, sessions, tick: (deltaMs) => { nowMs += deltaMs; } };
    harnesses.push(harness);
    return harness;
  }

  function signalURL(harness: Harness, input: { includeTelemetryMeta: boolean }): string {
    const url = new URL("/events", harness.server.getBaseURL());
    url.protocol = "ws:";
    if (input.includeTelemetryMeta) {
      url.searchParams.set("clientId", CLIENT_ID);
      url.searchParams.set("clientApp", "browser");
      url.searchParams.set("userAgent", CHROME_LINUX_UA);
    }
    return url.toString();
  }

  async function openSocket(url: string): Promise<WebSocket> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return socket;
  }

  async function closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
    });
  }

  it("forwards an accepted signal through capture() exactly once, session-stamped (^t-signal-forwarding)", async () => {
    const h = await setup();
    const socket = await openSocket(signalURL(h, { includeTelemetryMeta: true }));
    try {
      socket.send(JSON.stringify({
        type: SIGNAL_MESSAGE_TYPE,
        clientId: CLIENT_ID,
        event: "update_toast_shown",
        properties: { server_version: "1.2.3", channel_version: "1.2.4" },
      }));
      await expect.poll(() => h.sink.events.length).toBe(1);

      const event = h.sink.events[0]!;
      expect(event.name).toBe("update_toast_shown");
      expect(event.properties).toMatchObject({
        server_version: "1.2.3",
        channel_version: "1.2.4",
      });
      expect(isUUIDv7(event.properties.$session_id ?? "")).toBe(true);
      // Content-free belt: nothing about the connection rides the event.
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(CHROME_LINUX_UA);
      expect(serialized).not.toContain(CLIENT_ID);
      expect(serialized).not.toContain("/events");

      // Exactly once — no second crossing appears after the first.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.sink.events.length).toBe(1);
    } finally {
      await closeSocket(socket);
    }
  });

  it("bumps the client's session activity on the same crossing (^t-signal-activity)", async () => {
    const h = await setup();
    const socket = await openSocket(signalURL(h, { includeTelemetryMeta: true }));
    try {
      socket.send(JSON.stringify({
        type: SIGNAL_MESSAGE_TYPE,
        clientId: CLIENT_ID,
        event: "client_autoreloaded",
        properties: { from_version: "1.2.3", to_version: "1.2.4" },
      }));
      await expect.poll(() => h.sink.events.length).toBe(1);
      expect(h.sessions.get(CLIENT_ID)?.lastActivityMs).toBe(START_MS);

      const DELTA_MS = 5_000;
      h.tick(DELTA_MS);
      socket.send(JSON.stringify({
        type: SIGNAL_MESSAGE_TYPE,
        clientId: CLIENT_ID,
        event: "client_autoreloaded",
        properties: { from_version: "1.2.3", to_version: "1.2.4" },
      }));
      await expect.poll(() => h.sink.events.length).toBe(2);
      expect(h.sessions.get(CLIENT_ID)?.lastActivityMs).toBe(START_MS + DELTA_MS);
    } finally {
      await closeSocket(socket);
    }
  });

  it("drops a rejected signal silently — no capture, no session, no response", async () => {
    const h = await setup();
    const socket = await openSocket(signalURL(h, { includeTelemetryMeta: true }));
    // Every connection legitimately receives the server-status first message
    // (specs/arch/updates/version-advertisement.md ^events-version); "no
    // response" means nothing beyond that arrives for the rejected signal.
    const responses: { type?: string }[] = [];
    socket.on("message", (data) => responses.push(JSON.parse(String(data)) as { type?: string }));
    try {
      socket.send(JSON.stringify({
        type: SIGNAL_MESSAGE_TYPE,
        clientId: CLIENT_ID,
        event: "update_toast_shown",
        properties: { channel_version: "see https://example.com for the update" },
      }));
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.sink.events).toEqual([]);
      expect(h.sessions.get(CLIENT_ID)).toBeNull();
      expect(responses.filter((message) => message.type !== "server-status")).toEqual([]);
    } finally {
      await closeSocket(socket);
    }
  });

  it("ignores signals from sockets without client telemetry metadata", async () => {
    const h = await setup();
    const socket = await openSocket(signalURL(h, { includeTelemetryMeta: false }));
    try {
      socket.send(JSON.stringify({
        type: SIGNAL_MESSAGE_TYPE,
        clientId: CLIENT_ID,
        event: "update_toast_shown",
        properties: { server_version: "1.2.3" },
      }));
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.sink.events).toEqual([]);
    } finally {
      await closeSocket(socket);
    }
  });
});
