import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { readTelemetryState, telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "../src/telemetry/index.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";
import { NO_THEME_SETTINGS } from "../../../test/helpers/telemetry-settings.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_UNAUTHORIZED = 401;

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
  targetPath: string;
  server: Server;
  store: ServerStore;
  sink: RecordingTelemetrySink;
  token: string;
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function auth(harness: Harness): Record<string, string> {
  return { Authorization: `Bearer ${harness.token}` };
}

describe("server telemetry control routes", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const harness of harnesses.splice(0).reverse()) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
      rmSync(harness.targetPath, { recursive: true, force: true });
    }
  });

  async function setup(env: TelemetryEnv = TEST_TELEMETRY_ENV, defaultSink = false, developerHost = false): Promise<Harness> {
    const storagePath = tempDir("television-telemetry-control-");
    const targetPath = tempDir("television-telemetry-control-target-");
    const store = createServingStore(storagePath);
    const sink = new RecordingTelemetrySink();
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: true,
      telemetry: { env, ...(defaultSink ? {} : { sink }), developerHost, version: TEST_VERSION, launchMode: "cli" },
    });
    await server.start();
    const harness = { storagePath, targetPath, server, store, sink, token: store.authToken };
    harnesses.push(harness);
    return harness;
  }

  async function createPathArtifact(harness: Harness, filename: string): Promise<void> {
    const channel = harness.store.listChannels()[0]!;
    const artifactPath = path.join(harness.targetPath, filename);
    writeFileSync(artifactPath, "# private\n", "utf8");
    await request(harness.server.httpServer)
      .post("/artifacts")
      .set(auth(harness))
      .send({ kind: "path", title: "Private", channelID: channel.id, path: artifactPath })
      .expect(HTTP_CREATED);
  }

  it("rejects unauthenticated telemetry controls without changing state, the runtime gate, or emitted events", async () => {
    const h = await setup();
    const initialState = await readTelemetryState(h.storagePath);
    expect(initialState).toMatchObject({
      userId: expect.any(String),
      optedOut: false,
    });
    const initialEvents = structuredClone(h.sink.events);

    await request(h.server.httpServer)
      .get("/telemetry")
      .expect(HTTP_UNAUTHORIZED)
      .expect({ error: "Unauthorized" });
    await request(h.server.httpServer)
      .post("/telemetry/enable")
      .expect(HTTP_UNAUTHORIZED)
      .expect({ error: "Unauthorized" });
    await request(h.server.httpServer)
      .post("/telemetry/disable")
      .expect(HTTP_UNAUTHORIZED)
      .expect({ error: "Unauthorized" });

    expect(await readTelemetryState(h.storagePath)).toEqual(initialState);
    expect(h.sink.events).toEqual(initialEvents);
    expect(h.sink.events.some((event) => event.name === "telemetry_opted_out")).toBe(false);

    await createPathArtifact(h, "after-rejected-controls.md");
    expect(h.sink.events.slice(initialEvents.length).map((event) => event.name)).toEqual(["artifact_created"]);
  });

  it("disables with exactly one final opt-out event, preserves the GUID, and re-enables by updating current-state properties on the next event", async () => {
    const h = await setup();
    const initialState = await readTelemetryState(h.storagePath);
    expect(initialState?.userId).toEqual(expect.any(String));
    h.sink.clear();

    await request(h.server.httpServer)
      .get("/telemetry")
      .set(auth(h))
      .expect(HTTP_OK)
      .expect(({ body }) => {
        expect(body).toEqual({ state: "active", reason: null, guidPresent: true, region: "us" });
      });

    await request(h.server.httpServer)
      .post("/telemetry/disable")
      .set(auth(h))
      .expect(HTTP_OK)
      .expect(({ body }) => {
        expect(body).toEqual({ state: "opted-out", reason: null, guidPresent: true, region: "us" });
      });

    const disabledState = await readTelemetryState(h.storagePath);
    expect(disabledState).toMatchObject({ userId: initialState!.userId, optedOut: true });
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out"]);
    expect(h.sink.events[0]?.properties).toMatchObject({
      distinct_id: initialState!.userId,
      $set: { telemetry_opted_out: true },
    });
    expect(h.sink.events[0]?.properties).not.toHaveProperty("$session_id");

    await request(h.server.httpServer).post("/telemetry/disable").set(auth(h)).expect(HTTP_OK);
    await createPathArtifact(h, "after-disable.md");
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out"]);

    await request(h.server.httpServer)
      .post("/telemetry/enable")
      .set(auth(h))
      .expect(HTTP_OK)
      .expect(({ body }) => {
        expect(body).toEqual({ state: "active", reason: null, guidPresent: true, region: "us" });
      });
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out"]);

    const enabledState = await readTelemetryState(h.storagePath);
    expect(enabledState).toMatchObject({ userId: initialState!.userId, optedOut: false });
    await createPathArtifact(h, "after-enable.md");
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out", "artifact_created"]);
    expect(h.sink.events[1]?.distinctId).toBe(initialState!.userId);
    expect(h.sink.events[1]?.properties.$set).toMatchObject({ telemetry_opted_out: false });
  });

  // Seam: proofs/arch/telemetry/emitters.md#^t-theme-settings-refresh.
  // Real authenticated HTTP, persistence, store and runtime; recording sink replaces delivery only.
  it("TV-755 publishes fresh settings after re-enable without replaying suppressed changes", async () => {
    const h = await setup();
    const identity = await readTelemetryState(h.storagePath);
    const themeID = "private-opted-out-theme";
    seedThemePackage(h.storagePath, themeID, "/* private */", {
      enableMainJS: true, mainJS: "/* private */",
      enableIframeBackgroundJS: true, iframeBackgroundJS: "/* private */",
    });
    await request(h.server.httpServer).post("/themes/refresh").set(auth(h)).expect(HTTP_OK);
    h.sink.clear();
    await request(h.server.httpServer).post("/telemetry/disable").set(auth(h)).expect(HTTP_OK);
    await request(h.server.httpServer).patch("/display").set(auth(h)).send({ activeThemeName: themeID, appearanceMode: "light", themeJavaScriptConsentIds: [themeID] }).expect(204);
    await createPathArtifact(h, "during-opt-out.md");
    expect(h.sink.events.map(({ name }) => name)).toEqual(["telemetry_opted_out"]);
    await request(h.server.httpServer).post("/telemetry/enable").set(auth(h)).expect(HTTP_OK);
    expect(h.sink.events.map(({ name }) => name)).toEqual(["telemetry_opted_out"]);
    await createPathArtifact(h, "after-settings-re-enable.md");
    expect(h.sink.events.map(({ name }) => name)).toEqual(["telemetry_opted_out", "artifact_created"]);
    expect(h.sink.events[1]?.distinctId).toBe(identity?.userId);
    expect(h.sink.events[1]?.properties.$set).toMatchObject({
      ...NO_THEME_SETTINGS,
      theme_state: "custom",
      theme_main_js_declared: true,
      theme_main_js_enabled: true,
      theme_iframe_background_enabled: true,
      appearance_mode: "light",
      telemetry_opted_out: false,
    });
    expect(JSON.stringify(h.sink.events)).not.toContain(themeID);
  });

  it("reconciles the opt-out person property on restart after re-enable without intervening telemetry", async () => {
    const h = await setup();
    const initialState = await readTelemetryState(h.storagePath);
    h.sink.clear();

    await request(h.server.httpServer).post("/telemetry/disable").set(auth(h)).expect(HTTP_OK);
    await request(h.server.httpServer).post("/telemetry/enable").set(auth(h)).expect(HTTP_OK);
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out"]);

    await h.server.dispose();
    const restartedStore = createServingStore(h.storagePath);
    const restarted = new Server({
      store: restartedStore,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: true,
      telemetry: { env: TEST_TELEMETRY_ENV, sink: h.sink, version: TEST_VERSION, launchMode: "cli" },
    });
    await restarted.start();
    harnesses.push({ ...h, server: restarted, store: restartedStore, token: restartedStore.authToken });

    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out", "server_started"]);
    expect(h.sink.events[1]?.distinctId).toBe(initialState!.userId);
    expect(h.sink.events[1]?.properties.$set).toMatchObject({ telemetry_opted_out: false });
  });

  it.each([
    ["DO_NOT_TRACK", { ...TEST_TELEMETRY_ENV, DO_NOT_TRACK: "1" }, { state: "suppressed", reason: "do-not-track", guidPresent: true, region: "us" }],
    ["CI", { ...TEST_TELEMETRY_ENV, CI: "true" }, { state: "suppressed", reason: "ci", guidPresent: true, region: "us" }],
    ["development build", { NODE_ENV: "production", TELEVISION_TELEMETRY_BUILD: "development" }, { state: "suppressed", reason: "development", guidPresent: true, region: "us" }],
  ] satisfies Array<[string, TelemetryEnv, Record<string, unknown>]>)('reports telemetry status when %s suppresses telemetry', async (_label, env, expected) => {
    const h = await setup(env);

    await request(h.server.httpServer)
      .get("/telemetry")
      .set(auth(h))
      .expect(HTTP_OK)
      .expect(({ body }) => {
        expect(body).toEqual(expected);
      });
  });
  // proofs/product/telemetry.md#^t-status-precedence
  it.each([
    [true, { DO_NOT_TRACK: "1" }, false, "suppressed", "do-not-track"],
    [true, { CI: "1" }, false, "suppressed", "ci"],
    [false, { DO_NOT_TRACK: "1", CI: "1" }, false, "suppressed", "do-not-track"],
    [false, {}, true, "suppressed", "developer-host"],
    [false, { TV_TELEMETRY_TEST: "1" }, true, "active", null],
  ] as const)("reports status precedence through HTTP: %j %j", async (optOut, env, marker, state, reason) => {
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", "production");
    const h = await setup(env, false, marker);
    if (optOut) await request(h.server.httpServer).post("/telemetry/disable").set(auth(h)).expect(200);
    await request(h.server.httpServer).get("/telemetry").set(auth(h)).expect(200)
      .expect({ state, reason, guidPresent: true, region: "us" });
  });

  // proofs/arch/telemetry/sink.md#^t-optout-buffer
  it("delivers queued telemetry and the final opt-out event through HTTP disable", async () => {
    let online = false;
    const delivered: string[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      if (!online) throw new Error("offline");
      delivered.push(JSON.parse(String(init.body)).event);
      return new Response(null, { status: 200 });
    });
    const h = await setup(TEST_TELEMETRY_ENV, true);
    await createPathArtifact(h, "queued.md");
    await request(h.server.httpServer).post("/telemetry/disable").set(auth(h)).expect(200);
    await createPathArtifact(h, "suppressed.md");
    expect(delivered).toEqual([]);
    online = true;
    await h.server.dispose();
    expect(delivered).toEqual(["server_installed", "server_started", "artifact_created", "telemetry_opted_out"]);
  });
});
