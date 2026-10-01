import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import fixtureConfig from "./fixtures/test-runner/shard-worker/config.mjs";
import { compareAssignedAndCollected, validateVitestFilters } from "../../scripts/test/planned-shard-worker.mjs";
import { normalizeProviderShardSurfaces } from "../../scripts/test/provider-normalization.mjs";
import { runnerEnv } from "../../scripts/test/runner-env.mjs";
import { createShardPlan } from "../../scripts/test/shard-plan.mjs";
import { serializeTimingBaseline } from "../../scripts/test/timing-baseline.mjs";
import type { TimingProvider } from "../../scripts/test/timing-events.mjs";

const root = "test/repo/fixtures/test-runner/shard-worker";
const timingProvider = "local-linux-x64-4cpu";
const emptyBaseline = { schemaVersion: 1 as const, sourceThrough: null, files: {} };

describe("planned shard worker", () => {
  test("runner child environment preserves layered values and removes color controls", () => {
    const defaults = runnerEnv({ PATH: "base-bin", BASE_ONLY: "base" });
    expect(defaults).toMatchObject({
      PATH: `${path.join(process.cwd(), "node_modules", ".bin")}${path.delimiter}base-bin`,
      FLAKY_TEST_RETRIES: "5",
      BASE_ONLY: "base",
    });

    const layered = runnerEnv(
      { PATH: "base-bin", FLAKY_TEST_RETRIES: "2", FORCE_COLOR: "base", PRECEDENCE: "base" },
      { PATH: "task-bin", NO_COLOR: "task", PRECEDENCE: "task", TASK_ONLY: "task" },
      { FLAKY_TEST_RETRIES: "7", FORCE_COLOR: "service", PRECEDENCE: "service", SERVICE_ONLY: "service" },
    );
    expect(layered).toMatchObject({ PATH: "task-bin", FLAKY_TEST_RETRIES: "7", PRECEDENCE: "service", TASK_ONLY: "task", SERVICE_ONLY: "service" });
    expect(Object.hasOwn(layered, "FORCE_COLOR")).toBe(false);
    expect(Object.hasOwn(layered, "NO_COLOR")).toBe(false);
  });

  test("runs exact files from two Vitest projects in one process", { timeout: 20_000 }, () => {
    const fixture = workerFixture(["fixture:vitest-one", "fixture:vitest-two"], [
      inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest"),
      inventory("vitest-two.fixture.ts", "fixture:vitest-two", "vitest"),
    ]);
    try {
      const result = runWorker(fixture, { TV_SHARD_RETRY_FIXTURE: "1" });
      expect(result.status, result.stderr).toBe(0);
      const summary = shardSummary(fixture);
      expect(summary.preflights).toEqual([
        expect.objectContaining({ name: "process-lifecycle", status: "passed", finalOwnerCount: 0 }),
        expect.objectContaining({ name: "stale-owner-cleanup", status: "passed", processLeaks: [], liveOwners: expect.any(Array) }),
      ]);
      expect(summary.tasks.every((task: any) => task.processLeaks.length === 0)).toBe(true);
      expect(summary.tasks.map((task: any) => [task.surfaceId, task.status, task.assignedFiles, task.collectedFiles])).toEqual([
        ["fixture:vitest-one", "passed", [`${root}/vitest-one.fixture.ts`], [`${root}/vitest-one.fixture.ts`]],
        ["fixture:vitest-two", "passed", [`${root}/vitest-two.fixture.ts`], [`${root}/vitest-two.fixture.ts`]],
      ]);
      expect(summary.tasks.every((task: any) => existsSync(task.nativeResultPath))).toBe(true);
      expect(summary.tasks.every((task: any) => existsSync(task.attemptResultPath))).toBe(true);
      expect(summary.tasks.every((task: any) => task.generatedInputPaths.length === 1 && existsSync(task.generatedInputPaths[0]))).toBe(true);
      expect(summary.tasks.every((task: any) => existsSync(task.workspaceNativeResultPath))).toBe(true);
      const attempts = readFileSync(summary.tasks[0].attemptResultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      for (const [file, expected] of [
        ["vitest-one.fixture.ts", [[0, "passed"]]],
        ["vitest-two.fixture.ts", [[0, "failed"], [1, "passed"]]],
      ] as const) {
        expect(attempts.filter((attempt: any) => attempt.file.endsWith(file)).map((attempt: any) => [attempt.attemptIndex, attempt.status])).toEqual(expected);
      }
      const normalized = normalizeProviderShardSurfaces({
        provider: "blaxel",
        providerSummary: { status: "passed", shards: [summary] },
        outputDir: fixture.resultsDir,
        surfaces: fixtureConfig.surfaces.filter((surface) => ["fixture:vitest-one", "fixture:vitest-two"].includes(surface.id)) as any,
        delegatedCommand: [process.execPath, "scripts/run-test-shard.mjs"],
        exitCode: 0,
        coordinatorLogPath: path.join(fixture.resultsDir, "coordinator.log"),
      });
      expect(normalized.find((surface) => surface.id === "fixture:vitest-one")?.counts.testsFlakyRecovered).toBe(0);
      expect(normalized.find((surface) => surface.id === "fixture:vitest-two")?.counts.testsFlakyRecovered).toBe(1);
    } finally { fixture.cleanup(); }
  });

  test("removes color controls from the planned runner child environment", { timeout: 20_000 }, () => {
    const fixture = workerFixture(["fixture:vitest-one"], [inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest")]);
    const output = path.join(fixture.dir, "planned-runner-env.json");
    try {
      const result = runWorker(fixture, { RUNNER_CHILD_ENV_OUTPUT: output, FORCE_COLOR: "1", NO_COLOR: "1" });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ hasForceColor: false, hasNoColor: false });
    } finally { fixture.cleanup(); }
  });

  test("writes a retryable infrastructure summary when transferred plan validation fails", () => {
    const fixture = workerFixture(["fixture:vitest-one"], [inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest")]);
    try {
      const plan = JSON.parse(readFileSync(fixture.planPath, "utf8"));
      plan.testedTree = "0".repeat(40);
      writeFileSync(fixture.planPath, `${JSON.stringify(plan, null, 2)}\n`);
      const result = runWorker(fixture);
      expect(result.status).toBe(2);
      expect(shardSummary(fixture)).toMatchObject({ status: "infra-failed", failureKind: "plan-validation", failureStep: "plan-validation", shardIndex: 1, shardTotal: 1 });
      expect(existsSync(path.join(fixture.resultsDir, "native-fixture-vitest-one-shard-1.json"))).toBe(false);
    } finally { fixture.cleanup(); }
  });

  test("rejects an ambiguous Vitest substring before runner startup", () => {
    const surfaces = fixtureConfig.surfaces.filter((surface) => surface.id === "fixture:vitest-one");
    expect(() => validateVitestFilters({
      surfaces,
      assignedBySurface: new Map([["fixture:vitest-one", [`${root}/vitest-one.fixture.ts`]]]),
      completeInventory: [`${root}/vitest-one.fixture.ts`, `${root}/vitest-one.fixture.ts-extra`],
    })).toThrow("ambiguous Vitest file filter");
  });

  test("runs exact Playwright list files including punctuation and excludes unassigned files", { timeout: 30_000 }, () => {
    const fixture = workerFixture(["fixture:playwright"], [
      inventory("playwright-one.fixture.ts", "fixture:playwright", "playwright"),
      inventory("playwright-[literal].fixture.ts", "fixture:playwright", "playwright"),
    ]);
    try {
      const emptyBrowserPath = path.join(fixture.dir, "empty-playwright-browsers");
      mkdirSync(emptyBrowserPath);
      const result = runWorker(fixture, { SHARD_SENTINEL: fixture.sentinel, PLAYWRIGHT_BROWSERS_PATH: emptyBrowserPath });
      if (result.status !== 0) throw new Error(`planned Playwright worker failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      const summary = shardSummary(fixture);
      expect(summary.runDir).toBeUndefined();
      const task = summary.tasks[0];
      expect(task.assignedFiles).toEqual([`${root}/playwright-[literal].fixture.ts`, `${root}/playwright-one.fixture.ts`]);
      expect(task.collectedFiles).toEqual(task.assignedFiles);
      expect(readFileSync(fixture.sentinel, "utf8")).toBe("ran");
      const native = readFileSync(task.nativeResultPath, "utf8");
      expect(native).toContain("treats punctuation as a literal file path");
      expect(native).toContain("runs first assigned Playwright file");
      expect(native).not.toContain("must remain unassigned");
      expect(task.generatedInputPaths).toHaveLength(1);
      expect(readFileSync(task.generatedInputPaths[0], "utf8")).toContain("playwright-[literal].fixture.ts");
    } finally { fixture.cleanup(); }
  });

  test("skips empty surfaces and honors both skip-pre-command inputs", { timeout: 30_000 }, () => {
    const onlySecond = workerFixture(["fixture:vitest-one", "fixture:vitest-two"], [inventory("vitest-two.fixture.ts", "fixture:vitest-two", "vitest")]);
    try {
      const result = runWorker(onlySecond, { SHARD_SENTINEL: onlySecond.sentinel });
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(onlySecond.sentinel)).toBe(false);
      expect(shardSummary(onlySecond).tasks.find((task: any) => task.surfaceId === "fixture:vitest-one")).toMatchObject({ status: "not-assigned", assignedFiles: [], collectedFiles: [] });
    } finally { onlySecond.cleanup(); }

    for (const mode of ["flag", "env"] as const) {
      const fixture = workerFixture(["fixture:vitest-one"], [inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest")]);
      try {
        const result = runWorker(fixture, { SHARD_SENTINEL: fixture.sentinel }, mode === "flag" ? ["--skip-pre-commands"] : [], mode === "env" ? { TEST_SHARD_SKIP_PRECOMMANDS: "1" } : {});
        expect(result.status, result.stderr).toBe(0);
        expect(existsSync(fixture.sentinel)).toBe(false);
        expect(shardSummary(fixture).tasks[0]).toMatchObject({ status: "passed", preCommandsSkipped: true });
      } finally { fixture.cleanup(); }
    }
  });

  test("does not fall back to a build when a prebuilt output is missing", { timeout: 20_000 }, () => {
    const fixture = workerFixture(["fixture:vitest-one"], [inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest")]);
    const missing = path.join(fixture.dir, "missing/prebuilt.txt");
    try {
      const result = runWorker(fixture, { REQUIRE_PREBUILT: "1", PREBUILT_PATH: missing }, ["--skip-pre-commands"]);
      expect(result.status).toBe(1);
      expect(existsSync(missing)).toBe(false);
      expect(shardSummary(fixture).tasks[0]).toMatchObject({ status: "failed", preCommandsSkipped: true });
    } finally { fixture.cleanup(); }
  });

  test("records assigned tasks skipped after fail-fast and preserves them through provider normalization", { timeout: 20_000 }, () => {
    const fixture = workerFixture(["fixture:vitest-one", "fixture:playwright"], [
      inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest"),
      inventory("playwright-one.fixture.ts", "fixture:playwright", "playwright"),
    ]);
    const missing = path.join(fixture.dir, "missing/prebuilt.txt");
    try {
      const result = runWorker(fixture, { REQUIRE_PREBUILT: "1", PREBUILT_PATH: missing }, ["--skip-pre-commands", "--fail-fast"]);
      expect(result.status).toBe(1);
      const summary = shardSummary(fixture);
      const failed = summary.tasks.find((task: any) => task.surfaceId === "fixture:vitest-one");
      const skipped = summary.tasks.find((task: any) => task.surfaceId === "fixture:playwright");
      expect(summary).toMatchObject({ status: "failed", failFast: true, stoppedForFailFast: true });
      expect(failed).toMatchObject({ status: "failed", assignedFiles: [`${root}/vitest-one.fixture.ts`] });
      expect(skipped).toMatchObject({
        status: "skipped",
        skipReason: "fail-fast",
        exitCode: null,
        durationMs: 0,
        assignedFiles: [`${root}/playwright-one.fixture.ts`],
        collectedFiles: [],
        nativeResultPath: null,
        generatedInputPaths: [],
      });
      expect(summary.assignedFiles).toEqual([`${root}/playwright-one.fixture.ts`, `${root}/vitest-one.fixture.ts`]);
      expect(summary.collectedFiles).toEqual([`${root}/vitest-one.fixture.ts`]);

      const normalized = normalizeProviderShardSurfaces({
        provider: "blaxel",
        providerSummary: { status: "failed", shards: [summary] },
        outputDir: fixture.resultsDir,
        surfaces: fixtureConfig.surfaces.filter((surface) => ["fixture:vitest-one", "fixture:playwright"].includes(surface.id)) as any,
        delegatedCommand: [process.execPath, "scripts/run-test-shard.mjs"],
        exitCode: 1,
        coordinatorLogPath: path.join(fixture.resultsDir, "coordinator.log"),
      });
      expect(normalized.find((surface) => surface.id === "fixture:playwright")).toMatchObject({
        status: "skipped",
        infraStatus: "completed",
        skipReason: "fail-fast",
        assignedFiles: [`${root}/playwright-one.fixture.ts`],
        collectedFiles: [],
        failedTests: [],
      });
    } finally { fixture.cleanup(); }
  });

  test("detects assigned-versus-collected omissions, broadening, and duplicates", () => {
    expect(compareAssignedAndCollected(["a", "b"], ["a", "b"])).toEqual({ matches: true, missing: [], extra: [], duplicates: [] });
    expect(compareAssignedAndCollected(["a", "b"], ["a"])).toMatchObject({ matches: false, missing: ["b"] });
    expect(compareAssignedAndCollected(["a"], ["a", "b"])).toMatchObject({ matches: false, extra: ["b"] });
    expect(compareAssignedAndCollected(["a"], ["a", "a"])).toMatchObject({ matches: false, duplicates: ["a"] });
  });

  test("retains the direct GitHub shard summary and plan in its complete run directory", { timeout: 20_000 }, () => {
    const githubProvider = "github-playwright-noble-x64-2vcpu";
    const fixture = workerFixture(["fixture:vitest-one"], [inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest")], githubProvider);
    let runDir: string | null = null;
    try {
      const result = runWorker(fixture, {}, [], { GITHUB_ACTIONS: "true" });
      expect(result.status, result.stderr).toBe(0);
      const summary = shardSummary(fixture);
      runDir = path.resolve(summary.runDir);
      for (const file of ["summary.json", "results.json", "events.ndjson"]) expect(existsSync(path.join(runDir, file)), file).toBe(true);
      const results = JSON.parse(readFileSync(path.join(runDir, "results.json"), "utf8"));
      const durableNativePath = path.resolve(results.surfaces[0].nativeResultPath);
      expect(durableNativePath.startsWith(path.join(runDir, "native") + path.sep)).toBe(true);
      expect(existsSync(durableNativePath)).toBe(true);
      const durableLogPath = path.resolve(results.surfaces[0].logPath);
      expect(durableLogPath.startsWith(path.join(runDir, "logs") + path.sep)).toBe(true);
      expect(existsSync(durableLogPath)).toBe(true);
      const retained = JSON.parse(readFileSync(path.join(runDir, "provider/github/shard-1.json"), "utf8"));
      expect(retained).toMatchObject({ planId: summary.planId, shardIndex: 1, assignedFiles: summary.assignedFiles, collectedFiles: summary.collectedFiles });
      expect(JSON.parse(readFileSync(path.join(runDir, "provider/github/shard-plan.json"), "utf8"))).toMatchObject({ planId: summary.planId, timingProvider: githubProvider });
      expect(existsSync(retained.tasks[0].nativeResultPath)).toBe(true);
      expect(existsSync(retained.tasks[0].attemptResultPath)).toBe(true);
      expect(retained.tasks[0].generatedInputPaths.every((file: string) => existsSync(file))).toBe(true);
    } finally {
      if (runDir) rmSync(runDir, { recursive: true, force: true });
      fixture.cleanup();
    }
  });

  test("guards the alternate registry module as a self-test-only seam", () => {
    const fixture = workerFixture(["fixture:vitest-one"], [inventory("vitest-one.fixture.ts", "fixture:vitest-one", "vitest")]);
    try {
      const result = runWorker(fixture, {}, [], { TV_TEST_RUNNER_SELFTEST: "0" });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("TEST_SHARD_CONFIG_MODULE is a self-test seam");
      expect(existsSync(path.join(fixture.resultsDir, "native-fixture-vitest-one-shard-1.json"))).toBe(false);
    } finally { fixture.cleanup(); }
  });
});

function workerFixture(surfaceIds: string[], files: Array<{ path: string; surfaceId: string; runner: "vitest" | "playwright" }>, planTimingProvider: TimingProvider = timingProvider) {
  const parent = path.join(process.cwd(), ".test-runs");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, "shard-worker-"));
  const resultsDir = path.join(dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const surfaces = fixtureConfig.surfaces.filter((surface) => surfaceIds.includes(surface.id));
  const plan = createShardPlan({
    inventory: files, surfaces: surfaces as any, baseline: emptyBaseline, baselineBytes: serializeTimingBaseline(emptyBaseline), timingProvider: planTimingProvider,
    testedCommit: git("rev-parse", "HEAD"), testedTree: git("rev-parse", "HEAD^{tree}"), shardTotal: 1,
  });
  const planPath = path.join(dir, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return { dir, resultsDir, planPath, timingProvider: planTimingProvider, sentinel: path.join(dir, "sentinel"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runWorker(fixture: ReturnType<typeof workerFixture>, fixtureEnv: Record<string, string> = {}, extraArgs: string[] = [], controlEnv: Record<string, string> = {}) {
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.GITHUB_ACTIONS;
  delete inheritedEnv.TV_TEST_TIMING_PROVIDER;
  return spawnSync(process.execPath, ["scripts/run-test-shard.mjs", "--plan", fixture.planPath, "--shard", "1", "--results-dir", fixture.resultsDir, ...extraArgs], {
    cwd: process.cwd(), encoding: "utf8", timeout: 25_000,
    env: {
      ...inheritedEnv, FORCE_COLOR: "0", NO_COLOR: "1", TV_TEST_TIMING_PROVIDER: fixture.timingProvider,
      TV_TEST_RUNNER_SELFTEST: "1", TEST_SHARD_CONFIG_MODULE: path.join(process.cwd(), `${root}/config.mjs`),
      ...fixtureEnv, ...controlEnv,
    },
  });
}

function shardSummary(fixture: ReturnType<typeof workerFixture>) {
  return JSON.parse(readFileSync(path.join(fixture.resultsDir, "shard-1.json"), "utf8"));
}

function inventory(name: string, surfaceId: string, runner: "vitest" | "playwright") {
  return { path: `${root}/${name}`, surfaceId, runner };
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
