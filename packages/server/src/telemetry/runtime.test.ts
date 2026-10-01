import { setTelemetryOptedOut } from "./identity.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_THEME_SETTINGS } from "../../../../test/helpers/telemetry-settings.ts";
import { createTelemetryRuntime, type TelemetryRuntimeSink } from "./runtime.ts";
import { telemetryVersion } from "./types.ts";

const TEST_TELEMETRY_ENV = {
  TV_TELEMETRY_TEST: "1",
} as const;

describe("telemetry runtime shutdown", () => {
  const storagePaths: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const storagePath of storagePaths.splice(0)) rmSync(storagePath, { recursive: true, force: true });
  });

  it("absorbs an injected sink shutdown rejection", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-runtime-shutdown-"));
    storagePaths.push(storagePath);
    let shutdownCalls = 0;
    const sink: TelemetryRuntimeSink = {
      enqueue(): void {},
      shutdown: async () => {
        shutdownCalls += 1;
        throw new Error("shutdown failed");
      },
    };
    const runtime = await createTelemetryRuntime({
      readThemeSettings: () => NO_THEME_SETTINGS,
      storagePath,
      version: telemetryVersion("0.1.206"),
      env: TEST_TELEMETRY_ENV,
      sink,
      dataDirCreated: true,
      developerHost: false,
    });

    await expect(runtime.shutdown()).resolves.toBeUndefined();
    expect(shutdownCalls).toBe(1);
  });
  // proofs/arch/telemetry/sink.md#^t-enable-after-optedout-boot
  it("enables delivery after an opted-out boot without restarting", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-enable-boot-"));
    storagePaths.push(storagePath);
    const sent: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 200 });
    });
    const options = { storagePath, version: telemetryVersion("1.2.3"), env: TEST_TELEMETRY_ENV, developerHost: true, dataDirCreated: true, readThemeSettings: () => NO_THEME_SETTINGS };
    const initial = await createTelemetryRuntime(options);
    const identity = initial.state!.userId;
    await setTelemetryOptedOut(storagePath, initial.state!, true);
    await initial.shutdown();
    const runtime = await createTelemetryRuntime({ ...options, dataDirCreated: false });
    expect(runtime.status().state).toBe("opted-out");
    runtime.capture({ name: "server_started" });
    await runtime.shutdown();
    expect(sent).toEqual([]);
    await runtime.enable();
    runtime.capture({ name: "server_started" });
    await runtime.shutdown();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ event: "server_started", distinct_id: identity, properties: { $set: { telemetry_opted_out: false } } });
  });
});
