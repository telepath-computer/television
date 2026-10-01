import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTelemetryStatePath } from "../artifact-paths.ts";
import { deriveBootTelemetry, loadOrMintTelemetryState, telemetryEnabled, telemetryStatus, telemetryEnvironmentSuppressionReason, type TelemetryEnv } from "./identity.ts";

const tempDirs: string[] = [];

async function makeStoragePath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "television-telemetry-identity-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  vi.unstubAllGlobals();
});

describe("telemetry identity state", () => {
  it("mints a telemetry GUID once and reuses it across a real filesystem restart", async () => {
    const storagePath = await makeStoragePath();

    const first = await loadOrMintTelemetryState(storagePath, { lastVersion: "0.1.170" });
    const second = await loadOrMintTelemetryState(storagePath, { lastVersion: "0.1.170" });
    const persisted = JSON.parse(await readFile(getTelemetryStatePath(storagePath), "utf8")) as unknown;

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.state.userId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second.state.userId).toBe(first.state.userId);
    expect(persisted).toEqual({
      schemaVersion: 1,
      userId: first.state.userId,
      optedOut: false,
      lastVersion: "0.1.170",
    });
  });

  it("derives install, start, upgrade, and downgrade events across real boot state", async () => {
    const storagePath = await makeStoragePath();

    const fresh = await deriveBootTelemetry(storagePath, "0.1.170", { dataDirCreated: true });
    const restart = await deriveBootTelemetry(storagePath, "0.1.170", { dataDirCreated: false });
    const upgraded = await deriveBootTelemetry(storagePath, "0.1.171", { dataDirCreated: false });
    const downgraded = await deriveBootTelemetry(storagePath, "0.1.170", { dataDirCreated: false });
    const persisted = JSON.parse(await readFile(getTelemetryStatePath(storagePath), "utf8")) as { lastVersion: string };

    expect(fresh.events).toEqual([
      { name: "server_installed", personProperties: { pre_telemetry: false } },
      { name: "server_started" },
    ]);
    expect(restart.events.map((event) => event.name)).toEqual(["server_started"]);
    expect(upgraded.events).toEqual([
      {
        name: "server_upgraded",
        properties: {
          old_version: "0.1.170",
          new_version: "0.1.171",
        },
      },
      { name: "server_started" },
    ]);
    expect(upgraded.events[0]).not.toHaveProperty("personProperties");
    expect(downgraded.events).toEqual([{ name: "server_started" }]);
    expect(upgraded.state.userId).toBe(fresh.state.userId);
    expect(downgraded.state.userId).toBe(fresh.state.userId);
    expect(persisted.lastVersion).toBe("0.1.170");
  });

  it("treats a newly minted telemetry state on an existing data dir as an upgrade", async () => {
    const storagePath = await makeStoragePath();

    const adopted = await deriveBootTelemetry(storagePath, "0.1.170", { dataDirCreated: false });
    const persisted = JSON.parse(await readFile(getTelemetryStatePath(storagePath), "utf8")) as { lastVersion: string };

    expect(adopted.installed).toBe(false);
    expect(adopted.upgraded).toBe(true);
    expect(adopted.previousVersion).toBeNull();
    expect(adopted.events).toEqual([
      {
        name: "server_upgraded",
        properties: {
          new_version: "0.1.170",
          pre_telemetry: true,
        },
        personProperties: {
          pre_telemetry: true,
        },
      },
      { name: "server_started" },
    ]);
    expect(persisted.lastVersion).toBe("0.1.170");
  });

  it("uses semantic version order instead of string inequality for upgrade detection", async () => {
    const numericUpgradePath = await makeStoragePath();
    await deriveBootTelemetry(numericUpgradePath, "0.1.2", { dataDirCreated: true });
    const numericUpgrade = await deriveBootTelemetry(numericUpgradePath, "0.1.10", { dataDirCreated: false });
    expect(numericUpgrade.events.map((event) => event.name)).toEqual(["server_upgraded", "server_started"]);

    const numericDowngradePath = await makeStoragePath();
    await deriveBootTelemetry(numericDowngradePath, "0.1.10", { dataDirCreated: true });
    const numericDowngrade = await deriveBootTelemetry(numericDowngradePath, "0.1.2", { dataDirCreated: false });
    expect(numericDowngrade.events.map((event) => event.name)).toEqual(["server_started"]);

    const prereleasePath = await makeStoragePath();
    await deriveBootTelemetry(prereleasePath, "0.1.171-beta.1", { dataDirCreated: true });
    const stableRelease = await deriveBootTelemetry(prereleasePath, "0.1.171", { dataDirCreated: false });
    expect(stableRelease.events.map((event) => event.name)).toEqual(["server_upgraded", "server_started"]);

    const unparseablePath = await makeStoragePath();
    await deriveBootTelemetry(unparseablePath, "development-a", { dataDirCreated: true });
    const unparseableChange = await deriveBootTelemetry(unparseablePath, "development-b", { dataDirCreated: false });
    const unparseablePersisted = JSON.parse(await readFile(getTelemetryStatePath(unparseablePath), "utf8")) as { lastVersion: string };
    expect(unparseableChange.events.map((event) => event.name)).toEqual(["server_started"]);
    expect(unparseablePersisted.lastVersion).toBe("development-b");
  });

  it.each([
    ["malformed JSON", "{ this is not json"],
    ["schema-invalid JSON", JSON.stringify({ schemaVersion: 2, userId: "existing-user", optedOut: false, lastVersion: "0.1.169" })],
  ])("recovers from %s telemetry state by minting fresh boot state", async (_name, contents) => {
    const storagePath = await makeStoragePath();
    const statePath = getTelemetryStatePath(storagePath);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, contents, "utf8");

    const recovered = await deriveBootTelemetry(storagePath, "0.1.170", { dataDirCreated: true });
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as { userId: string; lastVersion: string };

    expect(recovered.events.map((event) => event.name)).toEqual(["server_installed", "server_started"]);
    expect(recovered.state.userId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(persisted.userId).toBe(recovered.state.userId);
    expect(persisted.lastVersion).toBe("0.1.170");
  });

  // proofs/arch/telemetry/identity.md#^t-suppression
  it("applies the four-rule cascade to every control combination", () => {
    for (const production of [false, true]) for (const developerHost of [false, true])
    for (const testMode of [false, true]) for (const optedOut of [false, true])
    for (const dnt of [false, true]) for (const ci of [false, true]) {
      vi.stubGlobal("__TV_TELEMETRY_BUILD__", production ? "production" : "development");
      const env = { TV_TELEMETRY_TEST: testMode ? "1" : "0", DO_NOT_TRACK: dnt ? "1" : "0", CI: ci ? "1" : "0" };
      const state = { schemaVersion: 1 as const, userId: "fixture", lastVersion: "1.2.3", optedOut };
      const enabled = !optedOut && !dnt && !ci && (testMode || (production && !developerHost));
      expect(telemetryEnabled(env, state, developerHost)).toBe(enabled);
      const reason = dnt ? "do-not-track" : ci ? "ci" : testMode ? null : !production ? "development" : developerHost ? "developer-host" : null;
      expect(telemetryStatus(env, state, developerHost)).toMatchObject({
        state: reason ? "suppressed" : optedOut ? "opted-out" : "active", reason,
      });
    }
  });

  it("ignores runtime build overrides and developer mode", () => {
    for (const production of [false, true]) {
      vi.stubGlobal("__TV_TELEMETRY_BUILD__", production ? "production" : undefined);
      for (const env of [{}, { NODE_ENV: "production" }, { TELEVISION_TELEMETRY_BUILD: "production" }, { TELEVISION_TELEMETRY_BUILD: "development" }, { TV_NPM_RELEASE: "1" }, { TV_TELEMETRY_DEV: "1" }]) {
        expect(telemetryEnabled(env, { optedOut: false }, false)).toBe(production);
      }
    }
  });

  it("normalizes only the three runtime boolean flags", () => {
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", undefined);
    for (const value of ["1", "true", "yes", " TRUE ", " Yes "]) {
      expect(telemetryEnabled({ TV_TELEMETRY_TEST: value }, { optedOut: false }, true)).toBe(true);
      for (const key of ["CI", "DO_NOT_TRACK"]) expect(telemetryEnabled({ TV_TELEMETRY_TEST: "1", [key]: value }, { optedOut: false }, true)).toBe(false);
    }
    for (const value of [undefined, "", "0", "false", "on"]) expect(telemetryEnabled({ TV_TELEMETRY_TEST: value }, { optedOut: false }, false)).toBe(false);
  });
});
