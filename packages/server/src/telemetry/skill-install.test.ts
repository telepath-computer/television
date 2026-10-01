import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitSkillInstalledTelemetry, type TelemetryRuntimeSink } from "./runtime.ts";
import { loadOrMintTelemetryState, readTelemetryState, writeTelemetryState } from "./identity.ts";
import { telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "./index.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const SKILL_INSTALL_TIMEOUT_MS = 500;

class RecordingTelemetrySink implements TelemetryCaptureSink {
  readonly events: BuiltTelemetryEvent[] = [];
  enqueue(event: BuiltTelemetryEvent): void {
    this.events.push(event);
  }
}

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-skill-install-telemetry-"));
}

describe("skill install telemetry emitter", () => {
  const storagePaths: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const storagePath of storagePaths.splice(0)) rmSync(storagePath, { recursive: true, force: true });
  });

  it("mints pre-first-boot identity and emits a session-less skill_installed event", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();

    await emitSkillInstalledTelemetry({
      storagePath,
      version: TEST_VERSION,
      agentType: "openclaw",
      installedByAgent: "  Claude Code  ",
      env: TEST_TELEMETRY_ENV,
      sink,
    });

    const state = await readTelemetryState(storagePath);
    expect(state?.userId).toEqual(expect.any(String));
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "skill_installed",
      distinctId: state!.userId,
      properties: {
        distinct_id: state!.userId,
        server_version: TEST_VERSION,
        agent_type: "openclaw",
        installed_by_agent: "claude code",
      },
    });
    expect(sink.events[0]?.properties).not.toHaveProperty("$session_id");
  });

  it("uses the existing opted-out state to suppress skill install telemetry", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const loaded = await loadOrMintTelemetryState(storagePath, { lastVersion: TEST_VERSION });
    await writeTelemetryState(storagePath, { ...loaded.state, optedOut: true });
    const sink = new RecordingTelemetrySink();

    await emitSkillInstalledTelemetry({
      storagePath,
      version: TEST_VERSION,
      agentType: "claude",
      installedByAgent: "claude",
      env: TEST_TELEMETRY_ENV,
      sink,
    });

    expect(sink.events).toEqual([]);
    expect(await readTelemetryState(storagePath)).toMatchObject({ userId: loaded.state.userId, optedOut: true });
  });

  it("still mints identity but sends nothing when environment suppression is active", async () => {
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const sink = new RecordingTelemetrySink();

    await emitSkillInstalledTelemetry({
      storagePath,
      version: TEST_VERSION,
      agentType: "other",
      env: { ...TEST_TELEMETRY_ENV, DO_NOT_TRACK: "1" },
      sink,
    });

    expect((await readTelemetryState(storagePath))?.userId).toEqual(expect.any(String));
    expect(sink.events).toEqual([]);
  });

  it("returns at the 500ms bound when sink shutdown never settles", async () => {
    vi.useFakeTimers();
    const storagePath = tempDir();
    storagePaths.push(storagePath);
    const events: BuiltTelemetryEvent[] = [];
    let markShutdownStarted!: () => void;
    const shutdownStarted = new Promise<void>((resolve) => {
      markShutdownStarted = resolve;
    });
    const sink: TelemetryRuntimeSink = {
      enqueue(event): void {
        events.push(event);
      },
      shutdown(): Promise<void> {
        markShutdownStarted();
        return new Promise(() => {});
      },
    };

    const emission = emitSkillInstalledTelemetry({
      storagePath,
      version: TEST_VERSION,
      agentType: "claude",
      env: TEST_TELEMETRY_ENV,
      sink,
    });
    let settled = false;
    void emission.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await shutdownStarted;

    await vi.advanceTimersByTimeAsync(SKILL_INSTALL_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(emission).resolves.toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("skill_installed");
  });
});
