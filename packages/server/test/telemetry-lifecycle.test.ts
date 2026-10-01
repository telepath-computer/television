import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";
import { NO_THEME_SETTINGS } from "../../../test/helpers/telemetry-settings.ts";
import path from "node:path";
import request from "supertest";
import { getTelemetryStatePath } from "../src/artifact-paths.ts";
import { Server } from "../src/server.ts";
import { POSTHOG_PRODUCTION_PROJECT, POSTHOG_TEST_PROJECT, readTelemetryState, telemetryVersion, type BuiltTelemetryEvent, type LaunchMode, type PostHogProjectConfig, type TelemetryCaptureSink, type TelemetryEnv } from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const FIRST_VERSION = telemetryVersion("0.1.170");
const NEXT_VERSION = telemetryVersion("0.1.171");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const INSTALLED_BY_AGENT = "  Claude Code  ";

class RecordingTelemetrySink implements TelemetryCaptureSink {
  readonly events: BuiltTelemetryEvent[] = [];
  enqueue(event: BuiltTelemetryEvent): void {
    this.events.push(event);
  }
}

type CapturedPostHogRequest = { url: string; body: { api_key?: string; event?: string } };

function tempDir(prefix = "television-telemetry-lifecycle-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("server telemetry lifecycle", () => {
  const storagePaths: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0).reverse()) await server.dispose();
    for (const storagePath of storagePaths.splice(0)) rmSync(storagePath, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  async function startServer(input: {
    storagePath: string;
    sink: RecordingTelemetrySink;
    version: ReturnType<typeof telemetryVersion>;
    env?: TelemetryEnv;
    launchMode?: LaunchMode;
    bundledThemesPath?: string;
  }): Promise<Server> {
    const store = createServingStore(input.storagePath, { bundledThemesPath: input.bundledThemesPath });
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: true,
      telemetry: {
        env: input.env ?? TEST_TELEMETRY_ENV,
        sink: input.sink,
        version: input.version,
        launchMode: input.launchMode ?? "cli",
        installedByAgent: INSTALLED_BY_AGENT,
      },
    });
    await server.start();
    servers.push(server);
    return server;
  }

  async function captureDefaultTelemetryBootRequests(env: TelemetryEnv, developerHost?: boolean): Promise<CapturedPostHogRequest[]> {
    const storagePath = tempDir("television-telemetry-project-");
    storagePaths.push(storagePath);
    const requests: CapturedPostHogRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as CapturedPostHogRequest["body"] });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const store = createServingStore(storagePath);
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: true,
      telemetry: {
        env,
        version: FIRST_VERSION,
        launchMode: "cli",
        ...(developerHost === undefined ? {} : { developerHost }),
      },
    });
    try {
      await server.start();
      await server.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
    return requests;
  }

  // Seam: proofs/arch/telemetry/emitters.md#^t-theme-settings-refresh.
  // Real serving boots, packaged Clouds, persisted display and theme files; sink only is mocked.
  it("TV-755 initializes default, persisted, and normalized fallback settings on boot", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();
    const boot = { storagePath, sink, version: FIRST_VERSION, bundledThemesPath: fileURLToPath(new URL("../assets/themes/", import.meta.url)) };
    const first = await startServer(boot);
    const defaultEvents = [...sink.events];
    const themeID = "private-restarted-theme";
    const themeDir = seedThemePackage(storagePath, themeID, "/* private */", {
      enableMainJS: true, mainJS: "/* private main */",
      enableIframeOverlayJS: true, iframeOverlayJS: "/* private overlay */",
    });
    const headers = { Authorization: `Bearer ${first.getAuthToken()}` };
    await request(first.httpServer).post("/themes/refresh").set(headers).expect(200);
    await request(first.httpServer).patch("/display").set(headers).send({ activeThemeName: themeID, themeJavaScriptConsentIds: [themeID], appearanceMode: "dark" }).expect(204);
    await first.dispose();
    servers.splice(servers.indexOf(first), 1);
    sink.events.length = 0;

    const second = await startServer(boot);
    const persistedEvents = [...sink.events];
    await second.dispose();
    servers.splice(servers.indexOf(second), 1);
    rmSync(themeDir, { recursive: true });
    sink.events.length = 0;
    await startServer(boot);

    expect.soft(defaultEvents.map(({ name }) => name)).toEqual(["server_installed", "server_started"]);
    for (const event of defaultEvents) expect.soft(event.properties.$set).toMatchObject({ ...NO_THEME_SETTINGS, theme_state: "clouds" });
    expect.soft(persistedEvents.map(({ name }) => name)).toEqual(["server_started"]);
    expect.soft(persistedEvents[0]?.properties.$set).toMatchObject({
      ...NO_THEME_SETTINGS, theme_state: "custom", theme_main_js_declared: true,
      theme_main_js_enabled: true, theme_iframe_overlay_enabled: true, appearance_mode: "dark",
    });
    expect(sink.events.map(({ name }) => name)).toEqual(["server_started"]);
    expect(sink.events[0]?.properties.$set).toMatchObject({ ...NO_THEME_SETTINGS, appearance_mode: "dark" });
  });

  it("emits install once, start on each boot, and upgrade with old/new versions", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();

    const first = await startServer({ storagePath, sink, version: FIRST_VERSION });
    await first.dispose();
    servers.splice(servers.indexOf(first), 1);
    expect(sink.events.map((event) => event.name)).toEqual(["server_installed", "server_started"]);
    expect(sink.events[0]?.properties.$set).toEqual({ ...NO_THEME_SETTINGS, pre_telemetry: false });
    expect(sink.events[0]?.properties).not.toHaveProperty("pre_telemetry");

    const second = await startServer({ storagePath, sink, version: FIRST_VERSION });
    await second.dispose();
    servers.splice(servers.indexOf(second), 1);
    expect(sink.events.map((event) => event.name)).toEqual(["server_installed", "server_started", "server_started"]);

    const upgraded = await startServer({ storagePath, sink, version: NEXT_VERSION });
    await upgraded.dispose();
    servers.splice(servers.indexOf(upgraded), 1);
    expect(sink.events.map((event) => event.name)).toEqual([
      "server_installed",
      "server_started",
      "server_started",
      "server_upgraded",
      "server_started",
    ]);
    const upgrade = sink.events.find((event) => event.name === "server_upgraded");
    expect(upgrade?.properties).toMatchObject({ old_version: FIRST_VERSION, new_version: NEXT_VERSION });
    expect(upgrade?.properties).not.toHaveProperty("pre_telemetry");
    expect(upgrade?.properties.$set).toEqual(NO_THEME_SETTINGS);
    expect(await readTelemetryState(storagePath)).toMatchObject({ lastVersion: NEXT_VERSION });

    await startServer({ storagePath, sink, version: FIRST_VERSION });
    expect(sink.events.map((event) => event.name)).toEqual([
      "server_installed",
      "server_started",
      "server_started",
      "server_upgraded",
      "server_started",
      "server_started",
    ]);
    expect(sink.events.filter((event) => event.name === "server_upgraded")).toHaveLength(1);
    expect(await readTelemetryState(storagePath)).toMatchObject({ lastVersion: FIRST_VERSION });
  });

  it("emits upgrade, not install, when an existing data dir has no telemetry version", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const preTelemetryStore = createServingStore(storagePath);
    expect(preTelemetryStore.dataDirCreated).toBe(true);
    preTelemetryStore.dispose();
    const sink = new RecordingTelemetrySink();

    await startServer({ storagePath, sink, version: FIRST_VERSION });

    expect(sink.events.map((event) => event.name)).toEqual(["server_upgraded", "server_started"]);
    expect(sink.events[0]?.properties).toMatchObject({ new_version: FIRST_VERSION, pre_telemetry: true });
    expect(sink.events[0]?.properties.$set).toEqual({ ...NO_THEME_SETTINGS, pre_telemetry: true });
    expect(await readTelemetryState(storagePath)).toMatchObject({ lastVersion: FIRST_VERSION });
  });

  it("reports daemon launch mode in the server_started config payload", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();

    await startServer({ storagePath, sink, version: FIRST_VERSION, launchMode: "daemon" });

    const started = sink.events.find((event) => event.name === "server_started");
    expect(started?.properties.launch_mode).toBe("daemon");
    expect(started?.properties.$set?.launch_mode).toBe("daemon");
  });

  it.each([
    ["production build without TV_TELEMETRY_TEST", "production", {}, false, POSTHOG_PRODUCTION_PROJECT],
    ["development build with TV_TELEMETRY_TEST", "development", TEST_TELEMETRY_ENV, false, POSTHOG_TEST_PROJECT],
    ["production build with TV_TELEMETRY_TEST", "production", TEST_TELEMETRY_ENV, false, POSTHOG_TEST_PROJECT],
    ["developer host production build", "production", {}, true, null],
    ["developer host with TV_TELEMETRY_TEST", "production", TEST_TELEMETRY_ENV, true, POSTHOG_TEST_PROJECT],
  ] satisfies Array<[string, string, TelemetryEnv, boolean, PostHogProjectConfig | null]>)("routes default boot telemetry to the %s project", async (_name, build, env, developerHost, expectedProject) => {
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", build);
    const requests = await captureDefaultTelemetryBootRequests(env, developerHost);

    if (!expectedProject) { expect(requests).toEqual([]); return; }
    expect(requests.length).toBeGreaterThan(0);
    expect(new Set(requests.map((request) => request.url))).toEqual(new Set([new URL("/capture/", expectedProject.ingestionHost).toString()]));
    expect(new Set(requests.map((request) => request.body.api_key))).toEqual(new Set([expectedProject.projectToken]));
  });

  it("uses the captured telemetry developer home for daemon project selection", async () => {
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", "production");
    const markedHome = tempDir("television-developer-home-");
    const otherHome = tempDir("television-other-home-");
    storagePaths.push(markedHome, otherHome);
    writeFileSync(path.join(markedHome, ".tv-developer"), "", "utf8");

    const markedRequests = await captureDefaultTelemetryBootRequests({
      TELEVISION_DEVELOPER_HOME: markedHome,
    });
    const unmarkedRequests = await captureDefaultTelemetryBootRequests({
      TELEVISION_DEVELOPER_HOME: otherHome,
    });

    expect(markedRequests).toEqual([]);
    rmSync(path.join(markedHome, ".tv-developer"));
    const restartedRequests = await captureDefaultTelemetryBootRequests({ TELEVISION_DEVELOPER_HOME: markedHome });
    expect(restartedRequests.length).toBeGreaterThan(0);
    expect(new Set(restartedRequests.map((request) => request.body.api_key))).toEqual(new Set([POSTHOG_PRODUCTION_PROJECT.projectToken]));
    expect(unmarkedRequests.length).toBeGreaterThan(0);
    expect(new Set(unmarkedRequests.map((request) => request.body.api_key))).toEqual(new Set([POSTHOG_PRODUCTION_PROJECT.projectToken]));
  });

  it("keeps development-build suppression active on a developer host", async () => {
    const requests = await captureDefaultTelemetryBootRequests({}, true);

    expect(requests).toEqual([]);
  });

  // proofs/product/telemetry.md#^ac-private-metadata
  it("keeps private boot data local while classifying event and person properties", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();
    const version = telemetryVersion("1.2.3-alice+private-host");
    const server = new Server({ store: createServingStore(storagePath), host: LOOPBACK_HOST, port: EPHEMERAL_PORT, auth: false,
      telemetry: { env: TEST_TELEMETRY_ENV, sink, version, installedByAgent: "  Novel Harness  " } });
    servers.push(server);
    await server.start();
    const started = sink.events.find((event) => event.name === "server_started");
    expect(started?.properties).toMatchObject({ server_version: "1.2.3", installed_by_agent: "novel harness", $set: { server_version: "1.2.3", installed_by_agent: "novel harness" } });
    expect(JSON.stringify(sink.events)).not.toMatch(/alice|Alice|private-host/);
    expect((await readTelemetryState(storagePath))?.lastVersion).toBe(version);
  });

  it("attaches config and version to server_started as event properties and $set person properties", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();

    await startServer({ storagePath, sink, version: FIRST_VERSION });

    const started = sink.events.find((event) => event.name === "server_started");
    expect(started?.properties).toMatchObject({
      server_version: FIRST_VERSION,
      auth_mode: "auth",
      binds_loopback: true,
      binds_all_interfaces: false,
      binds_tailnet: false,
      binds_other_specific: false,
      port: "custom",
      storage_path: "custom",
      launch_mode: "cli",
      installed_by_agent: "claude code",
    });
    expect(started?.properties.$set).toEqual({
      ...NO_THEME_SETTINGS,
      server_version: FIRST_VERSION,
      auth_mode: "auth",
      binds_loopback: true,
      binds_all_interfaces: false,
      binds_tailnet: false,
      binds_other_specific: false,
      port: "custom",
      storage_path: "custom",
      launch_mode: "cli",
      installed_by_agent: "claude code",
      telemetry_opted_out: false,
    });
    expect(started?.properties).not.toHaveProperty("$session_id");
  });

  it("disables telemetry instead of crashing boot when state I/O unexpectedly fails", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    mkdirSync(getTelemetryStatePath(storagePath), { recursive: true });
    const sink = new RecordingTelemetrySink();

    const server = await startServer({ storagePath, sink, version: FIRST_VERSION });

    expect(sink.events).toEqual([]);
    await request(server.httpServer)
      .get("/telemetry")
      .set({ Authorization: `Bearer ${server.getAuthToken()}` })
      .expect(200)
      .expect({ state: "unavailable", reason: null, guidPresent: false, region: "us" });
  });
});
