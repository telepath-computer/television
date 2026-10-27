import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { createShardPlan } from "../../scripts/test/shard-plan.mjs";
import { serializeTimingBaseline } from "../../scripts/test/timing-baseline.mjs";
import { spawnOwnedProcess } from "../helpers/owned-process.ts";

const fixtureRoot = "test/fixtures/resource-diagnostics";
const sourceFile = `${fixtureRoot}/native.fixture.ts`;
const provider = "blaxel-playwright-x64-4vcpu";
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

for (const entry of ["planned", "targeted"] as const) {
  test(`${entry} parent retains real Linux observations around preparation, recovered native attempts and teardown`, { timeout: 30_000 }, () => {
    const fixture = createFixture(entry, "retry");
    try {
      const result = spawnSync(process.execPath, fixture.args, { encoding: "utf8", env: fixture.env, timeout: 25_000 });
      expect(result.status, result.stderr).toBe(0);
      const prepared = read(path.join(fixture.dir, "preparation.json"));
      expect(prepared.records).toHaveLength(1);
      expect(prepared.records[0].end.status).toBe("missing");
      const record = readDiagnostics(fixture.dir)[0];
      expect(record.identity).toMatchObject({ runId: "resource-parent-run", attemptId: "resource-parent-attempt", shardIndex: 1, surfaceId: "fixture:resources" });
      expect(Date.parse(record.start.observedAt)).toBeLessThanOrEqual(Date.parse(prepared.observedAt));
      expect(Date.parse(record.end.observedAt)).toBeGreaterThanOrEqual(Date.parse(read(path.join(fixture.dir, "teardown.json")).observedAt));
      expect(record.start.memoryAvailable).toMatchObject({ unit: "bytes", source: "/proc/meminfo:MemAvailable" });
      expect(record.start.sharedMemoryUsed).toMatchObject({ unit: "bytes", source: "/proc/meminfo:Shmem" });
      expect(record.start.temporaryFree).toMatchObject({ unit: "bytes", source: "statfs", path: fixture.dir });
      expect(record.start.oomKills).toMatchObject({ unit: "count", source: "/proc/vmstat:oom_kill" });
      for (const key of ["memoryAvailable", "sharedMemoryUsed", "temporaryFree", "oomKills"]) {
        const probe = record.start[key];
        if (probe.value === null) expect(probe.reason).toEqual(expect.any(String));
        else expect(probe.value).toBeGreaterThanOrEqual(0);
      }
      expect(record.nativeEvidence).toMatchObject({ status: "complete", failedAttempt: true, recovered: true });
      expect(["available", "unavailable"]).toContain(record.kernel.status);
      if (record.kernel.status === "unavailable") {
        // Expected host limitations stay unknown; malformed reader invocations
        // must not masquerade as a successful probe of this installed tool.
        const debug = record.kernel.reason === "unavailable" ? [
          ["--version"],
          ["--since", record.start.observedAt.slice(0, 19).replace("T", " ")],
          ["--since", record.start.observedAt.slice(0, -1).replace("T", " ")],
          ["--since", `@${Math.floor(Date.parse(record.start.observedAt) / 1000)}`],
        ].map((args) => {
          const probe = spawnSync("dmesg", args, { encoding: "utf8", env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 2000, maxBuffer: 128 * 1024 });
          return { args, status: probe.status, stderr: probe.stderr, version: args[0] === "--version" ? probe.stdout : undefined };
        }) : [];
        expect(["EPERM", "EACCES", "ENOENT", "ENOTSUP", "ETIMEDOUT", "ENOBUFS"], JSON.stringify(debug)).toContain(record.kernel.reason);
      }
      const resultRecord = entry === "planned" ? read(path.join(fixture.dir, "results/shard-1.json")).tasks[0] : read(path.join(fixture.dir, "results/lifecycle.json"));
      expect(resultRecord.resourceDiagnosticsPaths).toHaveLength(1);
      expect(existsSync(resultRecord.resourceDiagnosticsPaths[0])).toBe(true);
      expect(resultRecord.processLeaks).toEqual([]);
      const attemptPath = path.resolve(path.dirname(resultRecord.resourceDiagnosticsPaths[0]), record.nativeEvidence.attemptResultPath);
      const attempts = readFileSync(attemptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(attempts.map((row: any) => row.status)).toEqual(["failed", "passed"]);
    } finally { fixture.cleanup(); }
  });
}

test("targeted parent preserves a baseline after the installed native runner exits before its report", { timeout: 20_000 }, () => {
  const fixture = createFixture("targeted", "exit");
  try {
    const result = spawnSync(process.execPath, fixture.args, { encoding: "utf8", env: fixture.env, timeout: 15_000 });
    expect(result.status, result.stderr).toBe(17);
    expect(read(path.join(fixture.dir, "preparation.json")).records).toHaveLength(1);
    const record = readDiagnostics(fixture.dir)[0];
    expect(record).toMatchObject({ end: { status: "observed" }, nativeEvidence: { status: "missing" } });
    expect(existsSync(path.join(fixture.dir, "results/native.json"))).toBe(false);
  } finally { fixture.cleanup(); }
});

test("interrupted surface parent leaves an explicit missing final observation", { timeout: 20_000 }, async () => {
  const fixture = createFixture("targeted", "interrupt");
  const child = spawnOwnedProcess(process.execPath, fixture.args, { env: fixture.env, stdio: "ignore" });
  try {
    await expect.poll(() => existsSync(path.join(fixture.dir, "preparation.json")), { timeout: 10_000, interval: 20 }).toBe(true);
    await expect.poll(() => child.child.signalCode, { timeout: 5_000, interval: 20 }).toBe("SIGKILL");
    expect((await child.dispose()).outcome).not.toBe("survived");
    const records = readDiagnostics(fixture.dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ start: { status: "observed" }, end: { status: "missing", reason: "parent-did-not-finalize" } });
  } finally { await child.dispose(); fixture.cleanup(); }
});

function readDiagnostics(dir: string) {
  const root = path.join(dir, "results/resources");
  return existsSync(root) ? readdirSync(root).filter((name) => name.endsWith(".json")).map((name) => read(path.join(root, name))) : [];
}

function createFixture(entry: "planned" | "targeted", mode: string) {
  mkdirSync(".test-runs", { recursive: true });
  const dir = mkdtempSync(path.join(process.cwd(), ".test-runs/resource-parent-"));
  const results = path.join(dir, "results");
  mkdirSync(results);
  const nativeConfig = path.join(dir, "native.config.mjs");
  writeFileSync(nativeConfig, `export default ${JSON.stringify({ test: { include: [path.resolve(sourceFile)], globalSetup: [path.resolve(`${fixtureRoot}/setup.mjs`)], pool: "forks", maxWorkers: 1, retry: 2 } })};\n`);
  const preCommand = [process.execPath, path.resolve(`${fixtureRoot}/prepare.mjs`)];
  const surface = { id: "fixture:resources", runner: "vitest", kind: "e2e", package: null, config: nativeConfig, absoluteConfig: nativeConfig, roots: [sourceFile], excludeRoots: [], cwd: ".", supports: ["file"], preflight: [], tags: [], agent: false, preCommand, command: null, executionGroup: { id: "fixture:resources", name: "resource fixture", order: 1 } };
  const registryPath = path.join(dir, "registry.mjs");
  writeFileSync(registryPath, `export default ${JSON.stringify({ suites: { all: { include: ["kind:e2e"] } }, surfaces: [surface] })};\n`);
  const plan = createShardPlan({ inventory: [{ path: sourceFile, surfaceId: surface.id, runner: "vitest" }], surfaces: [surface] as any, baseline: { schemaVersion: 1, sourceThrough: null, files: {} }, baselineBytes: serializeTimingBaseline({ schemaVersion: 1, sourceThrough: null, files: {} }), timingProvider: provider, testedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), testedTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(), shardTotal: 1 });
  const planPath = path.join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan));
  const env = { ...process.env, GITHUB_ACTIONS: "false", TV_TEST_RUNNER_SELFTEST: "1", TEST_SHARD_CONFIG_MODULE: registryPath, TV_TEST_TIMING_PROVIDER: provider, TV_TEST_RUN_ID: "resource-parent-run", TV_TEST_SHARD_INDEX: "1", TV_TEST_SHARD_ATTEMPT: "resource-parent-attempt", RESOURCE_FIXTURE_ROOT: dir, RESOURCE_FIXTURE_MODE: mode, TMPDIR: dir, TV_TARGET_RUNNER: "vitest", TV_TARGET_CONFIG: nativeConfig, TV_TARGET_NATIVE_RESULT: path.join(results, "native.json"), TV_VITEST_ATTEMPT_FILE: path.join(results, "native.attempts.ndjson") };
  const args = entry === "planned" ? ["scripts/run-test-shard.mjs", "--plan", planPath, "--shard", "1", "--results-dir", results, "--test-retries", "2"] : ["scripts/test/supervised-command.mjs", "--run-id", "resource-parent-run", "--surface", surface.id, "--result", path.join(results, "lifecycle.json"), "--pre-command-json", JSON.stringify(preCommand), "--", "bash", "-c", 'exec node node_modules/vitest/vitest.mjs run --config "${TV_TARGET_VITEST_CONFIG:-$TV_TARGET_CONFIG}" --reporter=json --outputFile "$TV_TARGET_NATIVE_RESULT"' ];
  return { dir, args, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
