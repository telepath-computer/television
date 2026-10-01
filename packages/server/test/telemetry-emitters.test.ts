import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type TabPage,
} from "@telepath-computer/television-shared";
import { NO_THEME_SETTINGS } from "../../../test/helpers/telemetry-settings.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const INITIAL_CONTENT_TOTALS = {
  total_screens: 1,
  total_artifacts: 0,
  median_artifacts_per_screen: 0,
  average_artifacts_per_screen: 0,
};

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
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function page(artifactIds: string[], fullScreen = false): TabPage {
  return {
    artifactIds,
    geometry: fullScreen
      ? { kind: "single", full_screen: true }
      : { ...DEFAULT_PAGE_GEOMETRY },
    size: { ...DEFAULT_PAGE_SIZE },
  };
}

describe("server telemetry emitters", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0).reverse()) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
      rmSync(harness.targetPath, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<Harness> {
    const storagePath = tempDir("television-telemetry-store-");
    const targetPath = tempDir("television-telemetry-target-");
    const store = createServingStore(storagePath);
    const sink = new RecordingTelemetrySink();
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: true,
      telemetry: { env: TEST_TELEMETRY_ENV, sink, version: TEST_VERSION, launchMode: "cli" },
    });
    await server.start();
    sink.clear();
    const harness = { storagePath, targetPath, store, server, sink };
    harnesses.push(harness);
    return harness;
  }

  function writeTargetFile(harness: Harness, name: string): string {
    const filePath = path.join(harness.targetPath, name);
    writeFileSync(filePath, "# private content\n", "utf8");
    return filePath;
  }

  it("emits artifact create/update/delete events with classification, deletion cause, and content totals", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    const markdownPath = writeTargetFile(h, "alice-roadmap.md");

    const artifact = h.store.createArtifact({ kind: "path", title: "Alice Roadmap", channelID: channel.id, path: markdownPath });
    expect(h.sink.events).toHaveLength(1);
    expect(h.sink.events[0]).toMatchObject({
      name: "artifact_created",
      properties: {
        artifact_kind: "path",
        path_kind: "file",
        path_file_type: "markdown",
        total_screens: 1,
        total_artifacts: 1,
        median_artifacts_per_screen: 1,
        average_artifacts_per_screen: 1,
        $set: {
          total_screens: 1,
          total_artifacts: 1,
          median_artifacts_per_screen: 1,
          average_artifacts_per_screen: 1,
        },
      },
    });

    h.store.updateArtifact({ artifactID: artifact.id, fields: { title: "Private Rename" } });
    expect(h.sink.events[1]).toMatchObject({
      name: "artifact_updated",
      properties: { artifact_kind: "path", path_kind: "file", path_file_type: "markdown" },
    });
    expect(h.sink.events[1]?.properties).not.toHaveProperty("total_artifacts");

    h.store.deleteArtifact(artifact.id);
    expect(h.sink.events[2]).toMatchObject({
      name: "artifact_deleted",
      properties: {
        artifact_kind: "path",
        path_kind: "file",
        path_file_type: "markdown",
        deletion_cause: "direct",
        ...INITIAL_CONTENT_TOTALS,
        $set: INITIAL_CONTENT_TOTALS,
      },
    });
    expect(h.sink.events.map((event) => event.name)).not.toContain("layout_changed");
  });

  it("emits channel create/update/delete events and only aggregate content totals", async () => {
    const h = await setup();

    const created = h.store.createChannel({ id: "screen-private", name: "Private Screen" });
    expect(h.sink.events[0]).toMatchObject({
      name: "screen_created",
      properties: {
        total_screens: 2,
        total_artifacts: 0,
        median_artifacts_per_screen: 0,
        average_artifacts_per_screen: 0,
        $set: {
          total_screens: 2,
          total_artifacts: 0,
          median_artifacts_per_screen: 0,
          average_artifacts_per_screen: 0,
        },
      },
    });
    expect(Object.keys(h.sink.events[0]!.properties).sort()).toEqual([
      "$set",
      "average_artifacts_per_screen",
      "distinct_id",
      "median_artifacts_per_screen",
      "total_artifacts",
      "total_screens",
    ]);

    h.store.updateChannel({ channelID: created.id, fields: { name: "Private Rename" } });
    expect(h.sink.events[1]).toMatchObject({ name: "screen_updated" });
    expect(h.sink.events[1]?.properties).not.toHaveProperty("total_screens");

    h.store.removeChannel(created.id);
    expect(h.sink.events[2]).toMatchObject({ name: "screen_deleted", properties: INITIAL_CONTENT_TOTALS });
  });

  it("does not emit artifact or channel updates for same-value metadata patches", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    const markdownPath = writeTargetFile(h, "same-value.md");
    const artifact = h.store.createArtifact({
      kind: "path",
      title: "Same value",
      channelID: channel.id,
      path: markdownPath,
    });
    h.sink.clear();

    h.store.updateArtifact({
      artifactID: artifact.id,
      fields: { title: artifact.title, path: `  ${markdownPath}  ` },
    });
    h.store.updateChannel({ channelID: channel.id, fields: { name: channel.name } });
    expect(h.sink.events).toEqual([]);

    h.store.updateArtifact({ artifactID: artifact.id, fields: { title: "Changed value" } });
    h.store.updateChannel({ channelID: channel.id, fields: { name: "Changed channel" } });
    expect(h.sink.events.map((event) => event.name)).toEqual([
      "artifact_updated",
      "screen_updated",
    ]);
  });

  it("distinguishes direct artifact deletion from channel cleanup", async () => {
    const h = await setup();
    const firstChannel = h.store.listChannels()[0]!;
    const secondChannel = h.store.createChannel({ name: "Cleanup channel" });
    const direct = h.store.createArtifact({
      kind: "path",
      title: "Direct",
      channelID: firstChannel.id,
      path: writeTargetFile(h, "direct.md"),
    });
    h.store.createArtifact({
      kind: "path",
      title: "Cascade",
      channelID: secondChannel.id,
      path: writeTargetFile(h, "cascade.md"),
    });
    h.sink.clear();

    h.store.deleteArtifact(direct.id);
    h.store.removeChannel(secondChannel.id);

    expect(h.sink.events.map((event) => event.name)).toEqual([
      "artifact_deleted",
      "artifact_deleted",
      "screen_deleted",
    ]);
    expect(h.sink.events[0]).toMatchObject({
      name: "artifact_deleted",
      properties: { deletion_cause: "direct" },
    });
    expect(h.sink.events[1]).toMatchObject({
      name: "artifact_deleted",
      properties: { deletion_cause: "channel_deleted" },
    });
  });

  it("computes aggregate content totals across channels without per-channel counts", async () => {
    const h = await setup();
    const firstChannel = h.store.listChannels()[0]!;
    const secondChannel = h.store.createChannel({ name: "Second Private Screen" });
    h.sink.clear();

    h.store.createArtifact({ kind: "path", title: "First Private", channelID: firstChannel.id, path: writeTargetFile(h, "first.md") });
    h.store.createArtifact({ kind: "path", title: "Second Private", channelID: firstChannel.id, path: writeTargetFile(h, "second.md") });
    h.store.createArtifact({ kind: "path", title: "Third Private", channelID: secondChannel.id, path: writeTargetFile(h, "third.md") });

    expect(h.sink.events[2]).toMatchObject({
      name: "artifact_created",
      properties: {
        total_screens: 2,
        total_artifacts: 3,
        median_artifacts_per_screen: 1.5,
        average_artifacts_per_screen: 1.5,
        $set: {
          total_screens: 2,
          total_artifacts: 3,
          median_artifacts_per_screen: 1.5,
          average_artifacts_per_screen: 1.5,
        },
      },
    });
    expect(Object.keys(h.sink.events[2]!.properties)).not.toContain("artifact_count_for_channel");
  });

  it("ignores page-size-only commits and emits tab reorder and full-screen transitions independently", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    const first = h.store.createArtifact({ kind: "path", title: "First Private", channelID: channel.id, path: writeTargetFile(h, "first.html") });
    const second = h.store.createArtifact({ kind: "path", title: "Second Private", channelID: channel.id, path: writeTargetFile(h, "second.html") });
    h.sink.clear();

    h.store.updateChannel({
      channelID: channel.id,
      fields: {
        layout: [
          {
            ...page([first.id]),
            size: { ...DEFAULT_PAGE_SIZE, width: DEFAULT_PAGE_SIZE.width + 1 },
          },
          page([second.id]),
        ],
      },
    });
    expect(h.sink.events).toEqual([]);

    h.store.updateChannel({
      channelID: channel.id,
      fields: { layout: [page([first.id], true), page([second.id])] },
    });
    expect(h.sink.events).toHaveLength(1);
    expect(h.sink.events[0]).toMatchObject({
      name: "tab_page_full_screen_changed",
      properties: { full_screen: true },
    });

    h.sink.clear();
    h.store.updateChannel({
      channelID: channel.id,
      fields: {
        name: "Renamed with layout",
        layout: [page([second.id], true), page([first.id])],
      },
    });
    expect(h.sink.events).toHaveLength(4);
    expect(h.sink.events[0]).toMatchObject({ name: "screen_updated" });
    expect(h.sink.events[1]).toMatchObject({
      name: "layout_changed",
      properties: { change_type: "tab_reorder" },
    });
    expect(h.sink.events.slice(2)).toMatchObject([
      { name: "tab_page_full_screen_changed", properties: { full_screen: true } },
      { name: "tab_page_full_screen_changed", properties: { full_screen: false } },
    ]);

    h.sink.clear();
    const added = h.store.createArtifact({ kind: "path", title: "Third Private", channelID: channel.id, path: writeTargetFile(h, "third.html") });
    h.store.deleteArtifact(added.id);
    expect(h.sink.events.map((event) => event.name)).toEqual(["artifact_created", "artifact_deleted"]);
  });

  it("classifies explicit pin-list commits and ignores no-ops and deletion pruning", async () => {
    const h = await setup();
    const first = h.store.listChannels()[0]!;
    const second = h.store.createChannel({ name: "Second" });
    const third = h.store.createChannel({ name: "Third" });
    h.sink.clear();

    h.store.patchDisplay({ pinnedChannelIds: [first.id] });
    h.store.patchDisplay({ pinnedChannelIds: [first.id, second.id] });
    h.store.patchDisplay({ pinnedChannelIds: [second.id, first.id] });
    h.store.patchDisplay({ pinnedChannelIds: [second.id] });
    h.store.patchDisplay({ pinnedChannelIds: [third.id] });
    h.store.patchDisplay({ pinnedChannelIds: [third.id] });

    expect(h.sink.events.map((event) => ({
      name: event.name,
      pin_change_type: event.properties.pin_change_type,
      pinned_channel_count: event.properties.pinned_channel_count,
    }))).toEqual([
      { name: "channel_pins_changed", pin_change_type: "pin", pinned_channel_count: 1 },
      { name: "channel_pins_changed", pin_change_type: "pin", pinned_channel_count: 2 },
      { name: "channel_pins_changed", pin_change_type: "reorder", pinned_channel_count: 2 },
      { name: "channel_pins_changed", pin_change_type: "unpin", pinned_channel_count: 1 },
      { name: "channel_pins_changed", pin_change_type: "replace", pinned_channel_count: 1 },
    ]);

    h.sink.clear();
    h.store.removeChannel(third.id);
    expect(h.sink.events.map((event) => event.name)).toEqual(["screen_deleted"]);
  });

  it("TV-755 emits theme changes with registry count but no theme package data", async () => {
    const h = await setup();
    const themeName = "alice-secret-theme";
    const invalidThemeName = "alice-invalid-theme";
    const privateScriptContents = [
      "globalThis.aliceSecretThemeBehavior = true;",
      "globalThis.aliceSecretBackground = true;",
      "globalThis.aliceSecretOverlay = true;",
    ] as const;
    const privateConsentedThemeID = "alice-other-consented-theme";
    seedThemePackage(h.storagePath, themeName, ":root { color-scheme: dark; }", {
      enableMainJS: true,
      enableIframeBackgroundJS: false,
      enableIframeOverlayJS: true,
      mainJS: privateScriptContents[0],
      iframeBackgroundJS: privateScriptContents[1],
      iframeOverlayJS: privateScriptContents[2],
    });
    const invalidThemeDir = seedThemePackage(h.storagePath, invalidThemeName);
    writeFileSync(
      path.join(invalidThemeDir, "manifest.json"),
      `${JSON.stringify({ name: "Alice Invalid", version: "invalid" })}\n`,
      "utf8",
    );
    h.store.refreshThemeRegistry();
    expect(h.store.getThemeRegistry().themes).toContainEqual({
      id: themeName,
      name: themeName,
      version: "1.0.0",
      colorScheme: "light dark",
      enableMainJS: true,
      enableIframeBackgroundJS: false,
      enableIframeOverlayJS: true,
    });
    const unscannedThemeName = "alice-unscanned-theme";
    seedThemePackage(h.storagePath, unscannedThemeName);

    h.store.patchDisplay({ themeJavaScriptConsentIds: [privateConsentedThemeID] });
    expect(h.sink.events).toEqual([]);
    h.store.patchDisplay({
      activeThemeName: themeName,
      themeJavaScriptConsentIds: [privateConsentedThemeID, themeName],
    });

    const event = h.sink.events[0]!;
    expect(event).toEqual({
      name: "theme_changed",
      distinctId: event.distinctId,
      properties: {
        distinct_id: event.distinctId,
        theme_state: "custom",
        theme_main_js_declared: true,
        theme_main_js_enabled: true,
        theme_iframe_background_enabled: false,
        theme_iframe_overlay_enabled: true,
        theme_count: 1,
        theme_change_reason: "selection",
        $set: {
          ...NO_THEME_SETTINGS,
          theme_state: "custom",
          theme_main_js_declared: true,
          theme_main_js_enabled: true,
          theme_iframe_overlay_enabled: true,
        },
      },
    });
    const emitted = JSON.stringify(event);
    expect(emitted).not.toContain(themeName);
    expect(emitted).not.toContain(invalidThemeName);
    expect(emitted).not.toContain(unscannedThemeName);
    expect(emitted).not.toContain("Alice Invalid");
    for (const declaration of [
      "enableMainJS",
      "enableIframeBackgroundJS",
      "enableIframeOverlayJS",
    ]) {
      expect(emitted).not.toContain(declaration);
    }
    for (const scriptContent of privateScriptContents) {
      expect(emitted).not.toContain(scriptContent);
    }
    expect(emitted).not.toContain("themeJavaScriptConsentIds");
    expect(emitted).not.toContain(privateConsentedThemeID);
  });

  // Seam: proofs/arch/telemetry/emitters.md#^t-theme-settings-actions.
  // Real store and packages; recording sink forfeits only PostHog delivery.
  it("TV-755 emits each committed setting once and ignores unchanged or rejected patches", async () => {
    const h = await setup();
    const themeID = "private-combined-theme";
    seedThemePackage(h.storagePath, themeID, "/* private */", { enableMainJS: true, mainJS: "/* private script */" });
    h.store.refreshThemeRegistry();
    const patch = { activeThemeName: themeID, appearanceMode: "dark" as const, themeJavaScriptConsentIds: [themeID] };
    h.store.patchDisplay(patch);
    h.store.patchDisplay(patch);
    expect(() => h.store.patchDisplay({ activeThemeName: "unregistered-private-theme", appearanceMode: "light" })).toThrow();
    expect(h.store.getDisplayState()).toMatchObject(patch);
    const committed = [...h.sink.events];
    h.store.createChannel({ name: "Private unrelated action" });

    expect.soft(committed.map(({ name }) => name)).toEqual(["theme_changed", "appearance_mode_changed"]);
    const settings = { ...NO_THEME_SETTINGS, theme_state: "custom", theme_main_js_declared: true, theme_main_js_enabled: true, appearance_mode: "dark" };
    expect.soft(committed[0]?.properties).toEqual({
      distinct_id: committed[0]?.distinctId,
      theme_state: "custom",
      theme_main_js_declared: true,
      theme_main_js_enabled: true,
      theme_iframe_background_enabled: false,
      theme_iframe_overlay_enabled: false,
      theme_count: 1,
      theme_change_reason: "selection",
      $set: settings,
    });
    expect.soft(committed[1]?.properties).toEqual({ distinct_id: committed[0]?.distinctId, appearance_mode: "dark", $set: settings });
    expect(h.sink.events.at(-1)?.properties.$set).toMatchObject(settings);
  });

  it("TV-755 distinguishes custom switches, explicit None, and registry fallback", async () => {
    const h = await setup();
    const first = "private-first-theme";
    const second = "private-second-theme";
    const firstDir = seedThemePackage(h.storagePath, first);
    seedThemePackage(h.storagePath, second);
    h.store.refreshThemeRegistry();
    for (const activeThemeName of [first, second, null, first]) h.store.patchDisplay({ activeThemeName });
    rmSync(firstDir, { recursive: true });
    h.store.refreshThemeRegistry();
    expect(h.store.getActiveThemeName()).toBeNull();
    expect(h.sink.events).toHaveLength(5);
    expect(h.sink.events.map(({ name, properties }) => ({
      name,
      theme_state: properties.theme_state,
      reason: properties.theme_change_reason,
      count: properties.theme_count,
    }))).toEqual([
      { name: "theme_changed", theme_state: "custom", reason: "selection", count: 2 },
      { name: "theme_changed", theme_state: "custom", reason: "selection", count: 2 },
      { name: "theme_changed", theme_state: "none", reason: "selection", count: 2 },
      { name: "theme_changed", theme_state: "custom", reason: "selection", count: 2 },
      { name: "theme_changed", theme_state: "none", reason: "fallback", count: 1 },
    ]);
    expect(h.sink.events.at(-1)?.properties.$set).toEqual(NO_THEME_SETTINGS);
  });

  it("keeps Phase 3 server events session-less", async () => {
    const h = await setup();
    h.store.createChannel({ name: "Private Screen" });

    expect(h.sink.events).not.toHaveLength(0);
    for (const event of h.sink.events) {
      expect(event.properties).not.toHaveProperty("$session_id");
    }
  });
});
