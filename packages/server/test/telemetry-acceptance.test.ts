import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import WebSocket from "ws";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { NO_THEME_SETTINGS } from "../../../test/helpers/telemetry-settings.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
} from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;

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
  store: ServerStore;
  server: Server;
  sink: RecordingTelemetrySink;
  token: string;
}

interface DrivenActionSources {
  pathArtifactPath: string;
  pathArtifactTitle: string;
  urlArtifactUrl: string;
  urlArtifactTitle: string;
  channelName: string;
  artifactRename: string;
  channelRename: string;
  themeName: string;
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function auth(harness: Harness): Record<string, string> {
  return { Authorization: `Bearer ${harness.token}` };
}

describe("server telemetry acceptance", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0).reverse()) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
      rmSync(harness.targetPath, { recursive: true, force: true });
    }
  });

  async function setup(env: TelemetryEnv = TEST_TELEMETRY_ENV, bundledThemesPath?: string): Promise<Harness> {
    const storagePath = tempDir("television-telemetry-acceptance-");
    const targetPath = tempDir("television-telemetry-sources-");
    const store = createServingStore(storagePath, { bundledThemesPath });
    const sink = new RecordingTelemetrySink();
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: true,
      telemetry: { env, sink, version: TEST_VERSION, launchMode: "cli" },
    });
    await server.start();
    const harness = { storagePath, targetPath, store, server, sink, token: store.authToken };
    harnesses.push(harness);
    return harness;
  }

  async function driveTelemetryActions(h: Harness): Promise<DrivenActionSources> {
    const channel = h.store.listChannels()[0]!;
    const pathArtifactPath = path.join(h.targetPath, "alice-private-roadmap.md");
    const pathArtifactTitle = "Alice Private Roadmap";
    const urlArtifactUrl = "https://example.com/customer/alice?screen=roadmap";
    const urlArtifactTitle = "Alice Private URL";
    const channelName = "Alice Private Screen";
    const artifactRename = "Alice Private Rename";
    const channelRename = "Alice Secret Rename";
    const themeName = "alice-secret-theme";
    writeFileSync(pathArtifactPath, "# private content\n", "utf8");
    seedThemePackage(h.storagePath, themeName, ":root { color-scheme: dark; }");
    h.store.refreshThemeRegistry();

    const createdPathArtifact = await request(h.server.httpServer)
      .post("/artifacts")
      .set(auth(h))
      .send({ kind: "path", title: pathArtifactTitle, channelID: channel.id, path: pathArtifactPath })
      .expect(HTTP_CREATED);
    const pathArtifactID = createdPathArtifact.body.artifact.id as string;

    const createdUrlArtifact = await request(h.server.httpServer)
      .post("/artifacts")
      .set(auth(h))
      .send({ kind: "url", title: urlArtifactTitle, channelID: channel.id, url: urlArtifactUrl })
      .expect(HTTP_CREATED);
    const urlArtifactID = createdUrlArtifact.body.artifact.id as string;

    await request(h.server.httpServer)
      .patch(`/artifacts/${encodeURIComponent(pathArtifactID)}`)
      .set(auth(h))
      .send({ title: artifactRename })
      .expect(HTTP_OK);

    const createdChannel = await request(h.server.httpServer)
      .post("/channels")
      .set(auth(h))
      .send({ name: channelName })
      .expect(HTTP_CREATED);
    const channelID = createdChannel.body.channel.id as string;

    await request(h.server.httpServer)
      .patch(`/channels/${encodeURIComponent(channelID)}`)
      .set(auth(h))
      .send({ name: channelRename })
      .expect(HTTP_OK);

    await request(h.server.httpServer)
      .patch(`/channels/${encodeURIComponent(channel.id)}`)
      .set(auth(h))
      .send({
        layout: [
          {
            artifactIds: [urlArtifactID],
            geometry: DEFAULT_PAGE_GEOMETRY,
            size: DEFAULT_PAGE_SIZE,
          },
          {
            artifactIds: [pathArtifactID],
            geometry: DEFAULT_PAGE_GEOMETRY,
            size: DEFAULT_PAGE_SIZE,
          },
        ],
      })
      .expect(HTTP_OK);

    await request(h.server.httpServer)
      .patch("/display")
      .set(auth(h))
      .send({ activeThemeName: themeName })
      .expect(HTTP_NO_CONTENT);

    await request(h.server.httpServer)
      .delete(`/artifacts/${encodeURIComponent(pathArtifactID)}`)
      .set(auth(h))
      .expect(HTTP_OK);

    await request(h.server.httpServer)
      .delete(`/channels/${encodeURIComponent(channelID)}`)
      .set(auth(h))
      .expect(HTTP_OK);

    return { pathArtifactPath, pathArtifactTitle, urlArtifactUrl, urlArtifactTitle, channelName, artifactRename, channelRename, themeName };
  }

  it("emits action telemetry from real HTTP mutations without user-generated strings", async () => {
    const h = await setup();
    h.sink.clear();

    const sources = await driveTelemetryActions(h);

    expect(h.sink.events.map((event) => event.name)).toEqual([
      "artifact_created",
      "artifact_created",
      "artifact_updated",
      "screen_created",
      "screen_updated",
      "layout_changed",
      "theme_changed",
      "artifact_deleted",
      "screen_deleted",
    ]);
    expect(h.sink.events[0]).toMatchObject({
      name: "artifact_created",
      properties: { artifact_kind: "path", path_kind: "file", path_file_type: "markdown", total_screens: 1, total_artifacts: 1 },
    });
    expect(h.sink.events[1]).toMatchObject({
      name: "artifact_created",
      properties: { artifact_kind: "url", url_host: "third-party", url_is_artifact_proxy: false, total_screens: 1, total_artifacts: 2 },
    });
    expect(h.sink.events[2]).toMatchObject({
      name: "artifact_updated",
      properties: { artifact_kind: "path", path_kind: "file", path_file_type: "markdown" },
    });
    expect(h.sink.events[3]).toMatchObject({
      name: "screen_created",
      properties: { total_screens: 2, total_artifacts: 2, median_artifacts_per_screen: 1, average_artifacts_per_screen: 1 },
    });
    expect(h.sink.events[4]).toMatchObject({ name: "screen_updated" });
    expect(h.sink.events[5]).toMatchObject({ name: "layout_changed", properties: { change_type: "tab_reorder" } });
    expect(h.sink.events[6]).toMatchObject({ name: "theme_changed", properties: { theme_state: "custom", theme_count: 1 } });
    expect(h.sink.events[7]).toMatchObject({
      name: "artifact_deleted",
      properties: { artifact_kind: "path", path_kind: "file", path_file_type: "markdown", deletion_cause: "direct", total_screens: 2, total_artifacts: 1 },
    });
    expect(h.sink.events[8]).toMatchObject({
      name: "screen_deleted",
      properties: { total_screens: 1, total_artifacts: 1, median_artifacts_per_screen: 1, average_artifacts_per_screen: 1 },
    });

    const forbiddenStrings = Object.values(sources);
    for (const event of h.sink.events) {
      const serialized = JSON.stringify(event);
      for (const source of forbiddenStrings) expect(serialized).not.toContain(source);
    }
  });

  // Acceptance: proofs/product/telemetry.md#^ac-theme.
  // Real authenticated HTTP and package files; recording sink forfeits PostHog delivery only.
  it("TV-755 classifies theme selections and fallback without private package data", async () => {
    const h = await setup();
    const customThemeID = "alice-secret-theme";
    const bundledDisplayName = "Alice Edited Clouds";
    const script = "globalThis.alicePrivateScript = true;";
    const customDir = seedThemePackage(h.storagePath, customThemeID, "/* private custom CSS */", {
      name: "Alice Secret Theme", enableMainJS: true, mainJS: script,
      enableIframeBackgroundJS: true, iframeBackgroundJS: script,
    });
    seedThemePackage(h.storagePath, "clouds", "/* private edited Clouds CSS */", { name: bundledDisplayName });
    await request(h.server.httpServer).post("/themes/refresh").set(auth(h)).expect(HTTP_OK);
    h.sink.clear();
    for (const activeThemeName of [customThemeID, "clouds", null, customThemeID]) {
      await request(h.server.httpServer).patch("/display").set(auth(h)).send({ activeThemeName }).expect(HTTP_NO_CONTENT);
    }
    rmSync(customDir, { recursive: true });
    await request(h.server.httpServer).post("/themes/refresh").set(auth(h)).expect(HTTP_OK);

    expect(h.sink.events).toHaveLength(5);
    const expected = [
      ["custom", true, "selection", 2], ["clouds", false, "selection", 2],
      ["none", false, "selection", 2], ["custom", true, "selection", 2], ["none", false, "fallback", 1],
    ] as const;
    for (const [index, [state, declaresJS, reason, count]] of expected.entries()) {
      const event = h.sink.events[index]!;
      const flags = { theme_main_js_declared: declaresJS, theme_main_js_enabled: false, theme_iframe_background_enabled: declaresJS, theme_iframe_overlay_enabled: false };
      expect.soft(event).toEqual({
        name: "theme_changed", distinctId: event.distinctId,
        properties: { distinct_id: event.distinctId, theme_state: state, ...flags, theme_count: count, theme_change_reason: reason,
          $set: { theme_state: state, ...flags, appearance_mode: "system" } },
      });
    }
    for (const privateValue of [customThemeID, bundledDisplayName, "Alice Secret Theme", script, h.storagePath, "themeJavaScriptConsentIds"]) {
      expect(JSON.stringify(h.sink.events)).not.toContain(privateValue);
    }
  });

  // Acceptance: proofs/product/telemetry.md#^ac-theme-adoption.
  // Real boot, HTTP writes and metadata-bearing websocket activity; no mocked store/client.
  it("TV-755 preserves adoption snapshots across consent, appearance, and later selection", async () => {
    const h = await setup(TEST_TELEMETRY_ENV, fileURLToPath(new URL("../assets/themes/", import.meta.url)));
    const boot = [...h.sink.events];
    const themeID = "private-adoption-theme";
    seedThemePackage(h.storagePath, themeID, "/* private */", {
      enableMainJS: true, mainJS: "/* private */", enableIframeOverlayJS: true, iframeOverlayJS: "/* private */",
    });
    await request(h.server.httpServer).post("/themes/refresh").set(auth(h)).expect(HTTP_OK);
    const url = new URL("/events", h.server.getBaseURL());
    url.protocol = "ws:";
    url.searchParams.set("token", h.token);
    url.searchParams.set("clientId", "theme-adoption-client");
    url.searchParams.set("clientApp", "browser");
    const socket = new WebSocket(url);
    try {
      await once(socket, "open");
      h.sink.clear();
      await request(h.server.httpServer).patch("/display").set(auth(h)).send({ activeThemeName: themeID }).expect(HTTP_NO_CONTENT);
      const selection = h.sink.events[0]!;
      await request(h.server.httpServer).patch("/display").set(auth(h)).send({ themeJavaScriptConsentIds: [themeID] }).expect(HTTP_NO_CONTENT);
      await request(h.server.httpServer).patch("/display").set(auth(h)).send({ appearanceMode: "dark" }).expect(HTTP_NO_CONTENT);
      const activity = async (count: number) => {
        socket.send(JSON.stringify({ type: "telemetry-activity", clientId: "theme-adoption-client" }));
        await expect.poll(() => h.sink.events.filter(({ name }) => name === "session_activity").length).toBe(count);
        return h.sink.events.filter(({ name }) => name === "session_activity").at(-1)!;
      };
      const firstActivity = await activity(1);
      const frozenFirst = JSON.stringify(firstActivity);
      await request(h.server.httpServer).patch("/display").set(auth(h)).send({ activeThemeName: null }).expect(HTTP_NO_CONTENT);
      const secondActivity = await activity(2);
      const active = { ...NO_THEME_SETTINGS, theme_state: "custom", theme_main_js_declared: true, theme_main_js_enabled: true, theme_iframe_overlay_enabled: true, appearance_mode: "dark" };
      const none = { ...NO_THEME_SETTINGS, appearance_mode: "dark" };

      expect.soft(boot.map(({ name }) => name)).toEqual(["server_installed", "server_started"]);
      for (const event of boot) expect.soft(event.properties.$set).toMatchObject({ ...NO_THEME_SETTINGS, theme_state: "clouds" });
      expect.soft(h.sink.events.map(({ name }) => name)).toEqual(["theme_changed", "appearance_mode_changed", "session_activity", "theme_changed", "session_activity"]);
      expect.soft(selection.properties).toMatchObject({ theme_main_js_declared: true, theme_main_js_enabled: false });
      expect.soft(selection.properties.$set).toEqual({ ...active, theme_main_js_enabled: false, appearance_mode: "system" });
      expect.soft(h.sink.events.find(({ name }) => name === "appearance_mode_changed")?.properties).toEqual({ distinct_id: selection.distinctId, appearance_mode: "dark", $set: active });
      expect.soft(firstActivity.properties).toMatchObject({ ...active, $set: active, $session_id: expect.any(String) });
      expect.soft(secondActivity.properties).toMatchObject({ ...none, $set: none, $session_id: firstActivity.properties.$session_id });
      expect(JSON.stringify(firstActivity)).toBe(frozenFirst);
      for (const privateValue of [themeID, h.token, "theme-adoption-client", "themeJavaScriptConsentIds"]) {
        expect(JSON.stringify(h.sink.events)).not.toContain(privateValue);
      }
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) {
        const closed = once(socket, "close");
        socket.close();
        await closed;
      }
    }
  });

  it.each([
    ["DO_NOT_TRACK", { ...TEST_TELEMETRY_ENV, DO_NOT_TRACK: "1" }],
    ["CI", { ...TEST_TELEMETRY_ENV, CI: "true" }],
    ["development build", {}],
  ] satisfies Array<[string, TelemetryEnv]>)('suppresses all real server telemetry when %s is active', async (_label, env) => {
    const h = await setup(env);

    await driveTelemetryActions(h);

    expect(h.sink.events).toEqual([]);
  });
});
