import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildReports, normalizeSurfaceResult, type NormalizedSurfaceResult } from "../../scripts/test/reporting.mjs";
import { createRunContext, createRunId, finalizeRun, readRunDirectoryIdentity, resolveTimingProvider } from "../../scripts/test/run-context.mjs";
import { isQualifyingRun } from "../../scripts/test/publication-eligibility.mjs";
import { buildTimingEvents, canonicalize, normalizeProcessLeak, processLeakIdentity, serializeTimingEvents, testIdentity } from "../../scripts/test/timing-events.mjs";
import { recordPhaseMetricBestEffort, summarizePhaseMetrics } from "../../scripts/test/phase-metrics.mjs";
import { mergeSurfaceParts } from "../../scripts/test/provider-normalization.mjs";

const vitestSurface = { id: "unit:probe", runner: "vitest" } as const;
const playwrightSurface = { id: "e2e:probe", runner: "playwright" } as const;

describe("test runner reporting", () => {
  test("native failure finalization fixture", () => {
    if (process.env.TV_TEST_FINALIZATION_FAIL === "1") throw new Error("intentional native-runner failure");
    expect(true).toBe(true);
  });

  test("normalizes Vitest failures without enumerating passed tests in summary", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const nativePath = path.join(dir, "vitest.json");
    writeFileSync(nativePath, JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [{
        name: path.join(process.cwd(), "test/repo/fail.test.ts"),
        assertionResults: [
          { ancestorTitles: ["group"], title: "passes", status: "passed", duration: 1, failureMessages: [] },
          { ancestorTitles: ["group"], title: "fails", status: "failed", duration: 2, failureMessages: ["expected 1 to be 2"] },
        ],
      }],
    }));

    const surface = normalizeSurfaceResult({ surface: vitestSurface, command: ["vitest"], exitCode: 1, durationMs: 10, logPath: "raw.log", nativeResultPath: nativePath });
    const { summary } = buildReports({ runId: "run", provider: "local", runDir: dir, selection: { surfaces: ["unit:probe"] }, surfaces: [surface], preflights: [], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" });

    expect(summary.counts.testsFailed).toBe(1);
    expect(summary.failedTests).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain("passes");
  });

  test("reports missing and malformed native results as infrastructure evidence failures", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-result-"));
    const missing = normalizeSurfaceResult({
      surface: vitestSurface,
      command: ["vitest"],
      exitCode: 1,
      durationMs: 10,
      logPath: "raw.log",
      nativeResultPath: path.join(dir, "missing.json"),
    });
    expect(missing).toMatchObject({
      status: "failed",
      infraStatus: "incomplete",
      failureKind: "result-report",
      failureStep: "native-report-read",
      failedTests: [],
    });
    expect(missing.failureMessage).toContain("runner exit=1");

    const malformedPath = path.join(dir, "malformed.json");
    writeFileSync(malformedPath, "{ not json");
    const malformed = normalizeSurfaceResult({
      surface: vitestSurface,
      command: ["vitest"],
      exitCode: 0,
      durationMs: 10,
      logPath: "raw.log",
      nativeResultPath: malformedPath,
    });
    expect(malformed).toMatchObject({
      status: "failed",
      infraStatus: "incomplete",
      failureKind: "result-report",
      failureStep: "native-report-parse",
      failedTests: [],
    });
    expect(malformed.failureMessage).toContain("runner exit=0");
  });

  test("does not invent Vitest retry attempts from aggregate failure messages", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const nativePath = path.join(dir, "vitest.json");
    writeFileSync(nativePath, JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [{
        name: path.join(process.cwd(), "test/node/retry.test.ts"),
        assertionResults: [{
          ancestorTitles: ["e2e group"],
          title: "recovers after retry",
          status: "passed",
          duration: 4,
          failureMessages: ["first attempt failed"],
        }],
      }],
    }));

    const surface = normalizeSurfaceResult({ surface: { id: "e2e:node", runner: "vitest" }, command: ["vitest", "--retry=2"], exitCode: 0, durationMs: 10, logPath: "raw.log", nativeResultPath: nativePath });
    expect(surface.status).toBe("passed");
    expect(surface.counts.testsFlakyRecovered).toBe(0);
    expect(surface.flakyRecoveredTests).toEqual([]);
    expect(surface.files).toEqual([expect.objectContaining({ complete: false, attempts: [], retryCount: 0 })]);
    expect(surface.failedTests).toEqual([]);
  });

  test("normalizes Playwright flaky recovered tests", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const nativePath = path.join(dir, "playwright.json");
    writeFileSync(nativePath, JSON.stringify({
      suites: [{
        title: "spec.ts",
        specs: [],
        suites: [{
          title: "flaky: probe",
          suites: [],
          specs: [{
            title: "recovers",
            file: "spec.ts",
            line: 7,
            tests: [{
              status: "flaky",
              results: [
                { status: "failed", duration: 5, error: { message: "first failure", location: { file: path.join(process.cwd(), "spec.ts"), line: 9 } } },
                { status: "passed", duration: 3 },
              ],
            }],
          }],
        }],
      }],
    }));

    const surface = normalizeSurfaceResult({ surface: playwrightSurface, command: ["playwright"], exitCode: 0, durationMs: 10, logPath: "raw.log", nativeResultPath: nativePath });
    expect(surface.status).toBe("passed");
    expect(surface.counts.testsFlakyRecovered).toBe(1);
    expect(surface.flakyRecoveredTests).toHaveLength(1);
    expect(surface.failedTests).toEqual([]);
  });

  test("accounts for skipped surfaces distinctly from passed and failed surfaces", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const skippedSurface = {
      id: "e2e:desktop",
      runner: "playwright",
      status: "skipped",
      infraStatus: "completed",
      durationMs: 10,
      durationSource: "surface-wall" as const,
      command: ["playwright"],
      counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
      failedTests: [],
      flakyRecoveredTests: [],
      logPath: "raw.log",
      nativeResultPath: null,
      nativeResultPaths: [],
      processLeaks: [],
      files: [],
      skipReason: "SKIP_ELECTRON_E2E=1",
    };

    const { summary, results } = buildReports({ runId: "run", provider: "local", runDir: dir, selection: { surfaces: ["e2e:desktop"] }, surfaces: [skippedSurface], preflights: [], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" });

    expect(summary.run.status).toBe("passed");
    expect(summary.counts.surfacesPassed).toBe(0);
    expect(summary.counts.surfacesFailed).toBe(0);
    expect(summary.counts.surfacesSkipped).toBe(1);
    expect(summary.counts.surfacesRun).toBe(0);
    expect(summary.skippedSurfaces).toEqual([{ id: "e2e:desktop", runner: "playwright", durationMs: 10, reason: "SKIP_ELECTRON_E2E=1", logPath: "raw.log", resultPath: "results.json" }]);
    expect(results.counts.surfacesSkipped).toBe(1);
    expect(results.counts.surfacesRun).toBe(0);
    expect(results.surfaces[0]?.skipReason).toBe("SKIP_ELECTRON_E2E=1");
  });

  test("counts a partially executed fail-fast surface as run without claiming its remaining assignment passed", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const base = {
      id: "e2e:probe",
      runner: "playwright",
      infraStatus: "completed",
      durationSource: "task-wall" as const,
      command: ["playwright"],
      failedTests: [],
      flakyRecoveredTests: [],
      processLeaks: [],
      logPath: "raw.log",
      nativeResultPath: null,
      nativeResultPaths: [],
      phases: [],
      files: [],
    };
    const [partiallyExecuted] = mergeSurfaceParts([
      { ...base, status: "passed", durationMs: 100, counts: { testsTotal: 10, testsPassed: 10, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 }, assignedFiles: ["a.test.ts"], collectedFiles: ["a.test.ts"] },
      { ...base, status: "skipped", skipReason: "fail-fast", durationMs: 0, counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 }, assignedFiles: ["b.test.ts"], collectedFiles: [] },
    ]);

    const { summary, results } = buildReports({ runId: "run", provider: "blaxel", runDir: dir, selection: { surfaces: ["e2e:probe"] }, surfaces: [partiallyExecuted], preflights: [], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" });

    expect(partiallyExecuted).toMatchObject({ status: "skipped", durationMs: 100, counts: { testsPassed: 10 }, assignedFiles: ["a.test.ts", "b.test.ts"], collectedFiles: ["a.test.ts"] });
    expect(summary.counts.surfacesRun).toBe(1);
    expect(summary.counts.surfacesSkipped).toBe(0);
    expect(summary.skippedSurfaces).toEqual([]);
    expect(results.counts).toMatchObject({ surfacesRun: 1, surfacesSkipped: 0 });
    expect(results.surfaces[0]).toMatchObject({ status: "skipped", assignedFiles: ["a.test.ts", "b.test.ts"], collectedFiles: ["a.test.ts"] });
  });

  test("includes provider infrastructure failure details in top-level reports", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const providerSurface = {
      id: "provider:blaxel",
      runner: "blaxel",
      status: "failed",
      infraStatus: "incomplete",
      durationMs: 10,
      durationSource: "task-wall" as const,
      command: ["node", "scripts/run-blaxel-testshards.mjs"],
      counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
      failedTests: [],
      flakyRecoveredTests: [],
      failureKind: "checkout",
      failureStep: "checkout",
      failureMessage: "Repository checkout failed on the Blaxel worker.",
      infraFailedShards: [1, 2],
      logPath: "provider/blaxel/shard-1.log",
      nativeResultPath: null,
      processLeaks: [],
      files: [],
    };

    const { summary, results } = buildReports({ runId: "run", provider: "blaxel", runDir: dir, selection: { surfaces: ["unit:root"] }, surfaces: [providerSurface], preflights: [], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" });

    expect(summary.failedSurfaces[0]).toMatchObject({ id: "provider:blaxel", failureKind: "checkout", failureStep: "checkout", failureMessage: "Repository checkout failed on the Blaxel worker.", infraFailedShards: [1, 2] });
    expect(summary.counts).toMatchObject({ surfacesSelected: 1, surfacesRun: 0 });
    expect(results.counts.surfacesRun).toBe(0);
    expect(results.infraFailures[0]).toMatchObject({ surfaceId: "provider:blaxel", failureKind: "checkout", failureMessage: "Repository checkout failed on the Blaxel worker." });
  });

  test("does not count a selected surface blocked by stale startup ownership as run", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const blockedSurface = {
      id: "unit:probe",
      runner: "vitest",
      status: "failed",
      infraStatus: "incomplete",
      durationMs: 10,
      durationSource: "task-wall" as const,
      command: ["vitest"],
      counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
      failedTests: [],
      flakyRecoveredTests: [],
      processLeaks: [],
      files: [],
      failureKind: "stale-owner",
      failureStep: "startup-owner-cleanup",
      failureMessage: "stale owner blocked startup",
      logPath: "raw.log",
      nativeResultPath: null,
    };

    const { summary, results } = buildReports({ runId: "run", provider: "blaxel", runDir: dir, selection: { surfaces: ["unit:probe"] }, surfaces: [blockedSurface], preflights: [], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" });
    expect(summary.counts.surfacesRun).toBe(0);
    expect(summary.failedSurfaces).toEqual([expect.objectContaining({ id: "unit:probe", failureKind: "stale-owner" })]);
    expect(results.counts.surfacesRun).toBe(0);
  });

  test("marks preflight failure as infrastructure incomplete and records selected vs run surfaces", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const { summary, results } = buildReports({
      runId: "run",
      provider: "local",
      runDir: dir,
      selection: { surfaces: ["e2e:probe"] },
      surfaces: [],
      preflights: [{ name: "playwright-chromium", status: "failed", message: "missing browser" }],
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(summary.run.infraStatus).toBe("incomplete");
    expect(summary.counts.surfacesSelected).toBe(1);
    expect(summary.counts.surfacesRun).toBe(0);
    expect(results.infraFailures).toEqual([{ preflight: "playwright-chromium", message: "missing browser" }]);
  });

  test("creates collision-resistant run IDs and enforces hosted timing providers", () => {
    const runId = createRunId({ now: new Date("2026-01-01T00:00:00.123Z"), pid: 42, randomBytes: () => Buffer.from("0123456789abcdef", "hex") });
    expect(runId).toBe("2026-01-01T00-00-00-123Z-p42-r0123456789abcdef");
    expect(resolveTimingProvider({ env: {}, platform: "linux", arch: "x64", logicalCpuCount: 6 })).toBe("local-linux-x64-6cpu");
    expect(() => resolveTimingProvider({ env: { GITHUB_ACTIONS: "true" } })).toThrow("TV_TEST_TIMING_PROVIDER is required");
    expect(() => resolveTimingProvider({ env: { GITHUB_ACTIONS: "true", TV_TEST_TIMING_PROVIDER: "local-linux-x64-2cpu" } })).toThrow("not local-*");
    expect(resolveTimingProvider({ env: { GITHUB_ACTIONS: "true", TV_TEST_TIMING_PROVIDER: "github-ubuntu-24.04-x64-2vcpu-vm" } })).toBe("github-ubuntu-24.04-x64-2vcpu-vm");
  });

  test("applies hosted provider rules to an explicitly supplied run-context timing provider", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-test-run-context-"));
    try {
      expect(() => createRunContext(null, {
        root,
        timingProvider: "local-linux-x64-2cpu",
        env: { GITHUB_ACTIONS: "true" },
      })).toThrow("not local-*");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("normalizes Playwright retries into deterministic timing events", () => {
    const fixture = path.join(process.cwd(), "test/repo/fixtures/test-runner/playwright-retry.json");
    const surface = normalizeSurfaceResult({
      surface: { ...playwrightSurface, cwd: ".", roots: ["test/repo/fixtures/test-runner"] },
      command: ["playwright"],
      exitCode: 0,
      durationMs: 25,
      logPath: "raw.log",
      nativeResultPath: fixture,
    });
    expect(surface.files).toEqual([expect.objectContaining({
      path: "test/repo/fixtures/test-runner/probe.test.ts",
      durationMs: 16,
      planningDurationMs: 11,
      retryCount: 1,
      recoveredFlakeCount: 1,
      complete: true,
    })]);

    const events = buildTimingEvents({
      run: fixtureRun(),
      shards: [{ index: 1, total: 1, status: "passed", durationMs: 25, phases: [], surfaces: [surface] }],
    });
    expect(events.map((event) => event.kind)).toEqual(["run", "shard", "surface", "file", "test-attempt", "test-attempt"]);
    expect(events.filter((event) => event.kind === "test-attempt")).toEqual([
      expect.objectContaining({ attemptIndex: 0, durationMs: 11, retry: false, recoveredFlake: true, status: "failed" }),
      expect.objectContaining({ attemptIndex: 1, durationMs: 5, retry: true, recoveredFlake: true, status: "passed" }),
    ]);
    const bytes = serializeTimingEvents(events);
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes).toBe(serializeTimingEvents(buildTimingEvents({ run: fixtureRun(), shards: [{ index: 1, total: 1, status: "passed", durationMs: 25, phases: [], surfaces: [surface] }] })));
  });

  test("degrades in-process side-channel phase appends to warnings", () => {
    const warnings: string[] = [];
    const original = console.error;
    console.error = (...values: unknown[]) => warnings.push(values.join(" "));
    try {
      expect(recordPhaseMetricBestEffort("append run summary", () => { throw new Error("read-only summary"); })).toBeNull();
    } finally {
      console.error = original;
    }
    expect(warnings).toEqual([expect.stringContaining("append run summary: read-only summary")]);
  });

  test("omits unavailable side-channel phase metrics without failing the caller", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-phase-side-channel-"));
    try {
      const output = path.join(dir, "phases.ndjson");
      const result = spawnSync(process.execPath, [
        "scripts/record-test-phase.mjs",
        "--file", output,
        "--github-job-name", "not-visible",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, GITHUB_REPOSITORY: "", GITHUB_RUN_ID: "", GH_TOKEN: "", GITHUB_TOKEN: "" },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("phase metric omitted");
      expect(() => readFileSync(output, "utf8")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("makes phase timing and cache outcomes first-class in events and summaries", () => {
    const events = buildTimingEvents({
      run: { ...fixtureRun(), phases: [{ name: "dependencies", status: "passed", durationMs: 20, cacheStatus: "hit" }] },
      shards: [{
        index: 1, total: 1, status: "passed", durationMs: 30,
        phases: [{ name: "setup:checkout", status: "passed", durationMs: 5 }],
        surfaces: [{ id: "unit:probe", runner: "vitest", status: "passed", durationMs: 25, durationSource: "task-wall", retryBudget: 0, files: [], processLeaks: [], phases: [{ name: "runner", status: "passed", durationMs: 25 }] }],
      }],
    });
    expect(events[0].phases).toEqual([{ name: "dependencies", category: "dependencies", status: "passed", durationMs: 20, cacheStatus: "hit" }]);
    expect(events.find((event) => event.kind === "shard")?.phases).toEqual([{ name: "setup:checkout", category: "checkout", status: "passed", durationMs: 5 }]);
    expect(events.find((event) => event.kind === "surface")?.phases).toEqual([{ name: "runner", category: "test", status: "passed", durationMs: 25 }]);
    expect(summarizePhaseMetrics(events)).toMatchObject({
      schemaVersion: 1,
      run: { durationMs: 25, phases: [{ category: "dependencies", cacheStatus: "hit" }] },
      shards: [{ index: 1, phases: [{ category: "checkout" }], surfaces: [{ surfaceId: "unit:probe", durationMs: 25, phases: [{ category: "test" }] }] }],
    });
  });

  test("normalizes failed-test paths from the remote workspace before timing identity", () => {
    const remotePath = "/workspace/television/test/repo/remote-failure.test.ts";
    const surface = {
      id: "unit:remote", runner: "vitest", status: "failed", durationMs: 10, durationSource: "task-wall", retryBudget: 0,
      phases: [], processLeaks: [], files: [{
        path: remotePath, status: "failed", complete: true, durationMs: 10, planningDurationMs: 10, durationSource: "file-wall",
        testsTotal: 1, retryCount: 0, recoveredFlakeCount: 0,
        attempts: [{ attemptIndex: 0, titlePath: ["remote failure"], status: "failed", durationMs: 10 }],
      }],
    };
    const events = buildTimingEvents({
      run: { ...fixtureRun(), status: "failed" },
      shards: [{ index: 1, total: 1, status: "failed", durationMs: 10, phases: [], surfaces: [surface] }],
    });
    const expectedPath = "test/repo/remote-failure.test.ts";
    expect(events.find((event) => event.kind === "file")).toMatchObject({ path: expectedPath, status: "failed" });
    expect(events.find((event) => event.kind === "test-attempt")).toMatchObject({
      path: expectedPath,
      testId: testIdentity({ surfaceId: "unit:remote", path: expectedPath, titlePath: ["remote failure"] }),
      status: "failed",
    });
    expect(() => testIdentity({ surfaceId: "unit:remote", path: "/tmp/outside-repository.test.ts", titlePath: ["escape"] })).toThrow("path must be repo-relative");
  });

  test("keeps durable timing payloads on the secret-safe allowlist", () => {
    const fixture = path.join(process.cwd(), "test/repo/fixtures/test-runner/playwright-retry.json");
    const surface = normalizeSurfaceResult({
      surface: { ...playwrightSurface, cwd: ".", roots: ["test/repo/fixtures/test-runner"] },
      command: ["playwright", "--token=super-secret"],
      exitCode: 0,
      durationMs: 25,
      logPath: "raw.log",
      nativeResultPath: fixture,
    });
    const run = fixtureRun() as ReturnType<typeof fixtureRun> & { environment: Record<string, unknown> };
    run.environment = { ...run.environment, SECRET_TOKEN: "super-secret", REMOTE_URL: "https://secret.example" };
    const events = buildTimingEvents({
      run,
      shards: [{
        index: 1, total: 1, status: "passed", durationMs: 25, phases: [],
        surfaces: [{ ...surface, failureMessage: "stderr super-secret", attachments: [{ body: "super-secret" }] }],
      }],
    });
    const serialized = serializeTimingEvents(events);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("secret.example");
    expect(serialized).not.toContain("--token");
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) { keys.add(key); visit(child); }
    };
    events.forEach(visit);
    for (const forbidden of ["argv", "args", "error", "errors", "errorSummary", "stdout", "stderr", "attachment", "attachments", "env", "environmentVariables", "remoteUrl"]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    expect(Object.keys(events[0].environment as Record<string, unknown>)).toEqual(["ci", "os", "arch", "node", "logicalCpuCount"]);
  });

  test("keeps combined-workspace member durations separate from the group wall", () => {
    const member = (id: string, durationMs: number) => ({
      id, runner: "vitest", status: "passed", durationMs, durationSource: "owned-file-sum", retryBudget: 0,
      phases: [], processLeaks: [], files: [],
    });
    const events = buildTimingEvents({
      run: fixtureRun(),
      shards: [{
        index: 1, total: 1, status: "passed", durationMs: 90,
        phases: [{ name: "execution-group:unit:workspaces", status: "passed", durationMs: 90 }],
        surfaces: [member("unit:one", 20), member("unit:two", 30)],
      }],
    });
    expect(events.filter((event) => event.kind === "surface").map((event) => [event.surfaceId, event.durationMs, event.durationSource])).toEqual([
      ["unit:one", 20, "owned-file-sum"],
      ["unit:two", 30, "owned-file-sum"],
    ]);
    expect(events.find((event) => event.kind === "shard")?.phases).toEqual([{ name: "execution-group:unit:workspaces", category: "test", status: "passed", durationMs: 90 }]);
    expect(() => buildTimingEvents({ run: fixtureRun(), shards: [{ index: 1, total: 1, status: "passed", phases: [], surfaces: [member("unit:one", 1), member("unit:one", 2)] }] })).toThrow("duplicate surface IDs");
  });

  test("records real Vitest retry attempts through the worker lifecycle adapter", { timeout: 20_000 }, () => {
    const parent = path.join(process.cwd(), ".test-runs");
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(path.join(parent, "vitest-attempt-"));
    const source = path.join(process.cwd(), "test/repo/fixtures/test-runner/vitest-retry.fixture.ts");
    const testFile = path.join(dir, "retry.test.ts");
    const config = path.join(dir, "vitest.config.mts");
    const native = path.join(dir, "native.json");
    const attempts = path.join(dir, "attempts.ndjson");
    try {
      copyFileSync(source, testFile);
      writeFileSync(config, `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["retry.test.ts"], retry: 1, maxWorkers: 1, fileParallelism: false, runner: ${JSON.stringify(path.join(process.cwd(), "scripts/test/vitest-attempt-reporter.mjs"))} } });\n`);
      execFileSync(path.join(process.cwd(), "node_modules/.bin/vitest"), [
        "run", "--config", config,
        "--reporter=json", "--outputFile", native,
      ], { cwd: dir, env: { ...process.env, TV_VITEST_ATTEMPT_FILE: attempts, NO_COLOR: "1" }, stdio: "pipe" });

      const nativeJson = JSON.parse(readFileSync(native, "utf8"));
      expect(nativeJson.testResults[0].assertionResults[0]).toMatchObject({ status: "passed", failureMessages: [expect.stringContaining("intentional first attempt")] });
      const recorded = readFileSync(attempts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(recorded).toHaveLength(2);
      expect(recorded.map((entry) => [entry.attemptIndex, entry.status])).toEqual([[0, "failed"], [1, "passed"]]);
      expect(recorded.every((entry) => Number.isInteger(entry.durationMs) && entry.durationMs >= 0)).toBe(true);

      const root = path.relative(process.cwd(), dir).replaceAll("\\", "/");
      const surface = normalizeSurfaceResult({
        surface: { ...vitestSurface, cwd: root, roots: [root] },
        command: ["vitest"], exitCode: 0, durationMs: 50, logPath: "raw.log", nativeResultPath: native, attemptResultPath: attempts,
      });
      expect(surface.counts.testsFlakyRecovered).toBe(1);
      expect(surface.files).toEqual([expect.objectContaining({ complete: true, retryCount: 1, recoveredFlakeCount: 1, durationSource: "file-wall" })]);
      expect(surface.files[0].attempts.map((entry: any) => [entry.attemptIndex, entry.status, entry.recoveredFlake])).toEqual([[0, "failed", true], [1, "passed", true]]);
      expect(surface.files[0].planningDurationMs).toBeLessThanOrEqual(surface.files[0].durationMs);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the real CLI finalizes all top-level files for success, native failure, and preflight failure", { timeout: 30_000 }, () => {
    const cases = [
      { args: ["local", "--file", "test/repo/test-runner-reporting.test.ts", "--grep", "marks preflight failure"], env: {}, status: 0, runStatus: "passed" },
      { args: ["local", "--file", "test/repo/test-runner-reporting.test.ts", "--grep", "native failure finalization fixture"], env: { TV_TEST_FINALIZATION_FAIL: "1" }, status: 1, runStatus: "failed" },
      { args: ["local", "--file", "test/repo/test-runner-reporting.test.ts"], env: { TV_TEST_RUNNER_SELFTEST: "1", TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:preflight stopped before native output" }, status: 1, runStatus: "incomplete" },
    ];
    for (const fixture of cases) {
      const result = execFileSyncResult(process.execPath, ["scripts/test/cli.mjs", ...fixture.args], fixture.env);
      expect(result.status, result.stderr).toBe(fixture.status);
      const match = /summary: (\.test-runs\/[A-Za-z0-9._/-]+\/summary\.json)/.exec(`${result.stdout}\n${result.stderr}`);
      expect(match).not.toBeNull();
      const runDir = path.dirname(match![1]);
      try {
        for (const file of ["summary.json", "results.json", "events.ndjson"]) expect(readFileSync(path.join(runDir, file), "utf8").length).toBeGreaterThan(0);
        expect(JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8")).run.status).toBe(fixture.runStatus);
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    }
  });

  test("qualifies only complete unfiltered Blaxel executions for publication", () => {
    const full = { suite: "all" };
    expect(isQualifyingRun({ provider: "blaxel", selectionOptions: {} })).toBe(true);
    expect(isQualifyingRun({ provider: "blaxel", selectionOptions: full })).toBe(true);
    expect(isQualifyingRun({ provider: "blaxel", selectionOptions: { all: "1" } })).toBe(true);
    expect(isQualifyingRun({ provider: "blaxel", selectionOptions: { ...full, shards: "24" } })).toBe(true);
    expect(isQualifyingRun({ provider: "local", selectionOptions: full })).toBe(false);
    expect(isQualifyingRun({ provider: null, selectionOptions: full })).toBe(false);
    expect(isQualifyingRun({ provider: "blaxel", selectionOptions: { suite: "unit" } })).toBe(false);
    for (const key of ["surface", "package", "file", "grep", "runner", "tag", "shard-indices"]) {
      expect(isQualifyingRun({ provider: "blaxel", selectionOptions: { ...full, [key]: "selected" } }), key).toBe(false);
    }
  });

  test("writes its run directory identity without inspecting sibling run directories", { timeout: 20_000 }, () => {
    const parent = path.join(process.cwd(), ".test-runs");
    mkdirSync(parent, { recursive: true });
    const sibling = mkdtempSync(path.join(parent, "vitest-attempt-sibling-"));
    const outputRoot = mkdtempSync(path.join(os.tmpdir(), "tv-run-dir-output-"));
    const outputFile = path.join(outputRoot, "run-dir.txt");
    let runDir: string | null = null;
    try {
      const result = execFileSyncResult(process.execPath, [
        "scripts/test/cli.mjs", "local", "--file", "test/repo/test-runner-reporting.test.ts", "--grep", "marks preflight failure", "--run-dir-output", outputFile,
      ], {});
      expect(result.status, result.stderr).toBe(0);
      runDir = readFileSync(outputFile, "utf8").trim();
      expect(runDir.startsWith(path.join(process.cwd(), ".test-runs") + path.sep)).toBe(true);
      expect(runDir).not.toBe(path.resolve(sibling));
      expect(readFileSync(path.join(runDir, "summary.json"), "utf8").length).toBeGreaterThan(0);
    } finally {
      if (runDir) rmSync(runDir, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("accepts a run identity only for a direct child of this checkout's run root", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-run-identity-root-"));
    const identityFile = path.join(root, "identity.txt");
    const runRoot = path.join(root, ".test-runs");
    const validRunDir = path.join(runRoot, "valid-run");
    const nestedRunDir = path.join(validRunDir, "nested");
    const outsideRunDir = path.join(root, "outside-run");
    mkdirSync(nestedRunDir, { recursive: true });
    mkdirSync(outsideRunDir, { recursive: true });
    try {
      writeFileSync(identityFile, `${validRunDir}\n`);
      expect(readRunDirectoryIdentity(identityFile, { root })).toBe(validRunDir);

      for (const invalid of [runRoot, nestedRunDir, outsideRunDir, path.relative(root, validRunDir)]) {
        writeFileSync(identityFile, `${invalid}\n`);
        expect(() => readRunDirectoryIdentity(identityFile, { root })).toThrow(/direct child/);
      }

      writeFileSync(identityFile, `${path.join(runRoot, "missing-run")}\n`);
      expect(() => readRunDirectoryIdentity(identityFile, { root })).toThrow(/existing directory/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finalizes one combined timing stream with every provider shard", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-combined-run-"));
    const runContext = createRunContext("blaxel", { root, now: new Date("2026-01-01T00:00:00.000Z"), pid: 8, randomBytes: () => Buffer.from("0123456789abcdef", "hex"), timingProvider: "blaxel-playwright-x64-4vcpu" });
    try {
      const completedAt = "2026-01-01T00:00:02.000Z";
      const { events } = finalizeRun({
        runContext, selection: { surfaces: ["e2e:probe"] }, git: { commit: "a".repeat(40), tree: "b".repeat(40), dirty: false },
        surfaces: [{ id: "provider:blaxel", runner: "blaxel", status: "failed", infraStatus: "incomplete", durationMs: 2000, durationSource: "task-wall", command: ["blaxel"], counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 }, failedTests: [], flakyRecoveredTests: [], processLeaks: [], files: [], logPath: "blaxel.log", nativeResultPath: null }],
        startedAt: "2026-01-01T00:00:00.000Z", completedAt,
        shard: { planId: "plan-a", timingBaselineDigest: "c".repeat(64) },
        shards: [
          { index: 1, total: 2, status: "passed", durationMs: 1000, predictedDurationMs: 60_000, phases: [], surfaces: [{ id: "e2e:probe", runner: "playwright", status: "not-assigned", durationMs: 0, durationSource: "unknown", phases: [], files: [], processLeaks: [] }] },
          { index: 2, total: 2, status: "incomplete", durationMs: 2000, predictedDurationMs: 60_000, phases: [{ name: "setup:checkout", status: "failed", durationMs: 5 }], surfaces: [] },
        ],
      });
      expect(events[0]).toMatchObject({ kind: "run", commandProvider: "blaxel", shardPlanId: "plan-a", timingBaselineDigest: "c".repeat(64) });
      expect(events.filter((event) => event.kind === "shard")).toEqual([
        expect.objectContaining({ index: 1, total: 2, status: "passed", predictedDurationMs: 60_000 }),
        expect.objectContaining({ index: 2, total: 2, status: "incomplete", phases: [expect.objectContaining({ name: "setup:checkout" })] }),
      ]);
      expect(events).toContainEqual(expect.objectContaining({ kind: "surface", surfaceId: "e2e:probe", status: "not-assigned" }));
      const summary = JSON.parse(readFileSync(path.join(runContext.absoluteRunDir, "summary.json"), "utf8"));
      expect(summary.phaseMetrics).toMatchObject({
        schemaVersion: 1,
        run: { phases: expect.arrayContaining([expect.objectContaining({ name: "report-finalization", category: "report", status: "passed" })]) },
        shards: [
          { index: 1, total: 2, surfaces: [{ surfaceId: "e2e:probe", durationMs: 0 }] },
          { index: 2, total: 2, phases: [expect.objectContaining({ name: "setup:checkout", category: "checkout", status: "failed", durationMs: 5 })] },
        ],
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("canonicalizes identities and deduplicates process leaks without losing surface failures", () => {
    expect(canonicalize({ z: null, a: ["x", 1, true] })).toBe('{"a":["x",1,true],"z":null}');
    const identity = testIdentity({ surfaceId: "unit:one", path: "test/a.test.ts", project: null, titlePath: ["group", "case"], line: 4, column: null });
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    const rawLeak = JSON.parse(readFileSync(path.join(process.cwd(), "test/repo/fixtures/test-runner/process-leak.json"), "utf8"));
    const leak = normalizeProcessLeak(rawLeak);
    expect(leak.leakId).toBe(processLeakIdentity(leak));
    expect(leak.owningSurfaceIds).toEqual(["unit:one", "unit:two"]);
    expect(leak.listeningSockets.map((socket) => socket.port)).toEqual([4811, 4812]);

    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-test-report-"));
    const base = (id: string, processLeaks: any[]): NormalizedSurfaceResult => ({
      id, runner: "vitest", status: "passed", infraStatus: "completed", durationMs: 5, durationSource: "owned-file-sum",
      command: ["vitest"], counts: { testsTotal: 1, testsPassed: 1, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
      failedTests: id === "unit:one" ? [{ title: "native failure" }] : [], flakyRecoveredTests: id === "unit:one" ? [{ title: "recovered flake" }] : [], processLeaks, files: [], logPath: "raw.log", nativeResultPath: null,
    });
    const { summary, results } = buildReports({ runId: "run", provider: "local", runDir: dir, selection: { surfaces: ["unit:one", "unit:two"] }, surfaces: [base("unit:one", [rawLeak, rawLeak]), base("unit:two", [])], preflights: [], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" });
    expect(summary.counts.processLeaks).toBe(1);
    expect(summary.processLeaks).toHaveLength(1);
    expect(summary.run.status).toBe("incomplete");
    expect(summary.failedTests).toEqual([expect.objectContaining({ title: "native failure" })]);
    expect(summary.flakyRecoveredTests).toEqual([expect.objectContaining({ title: "recovered flake" })]);
    expect(results.surfaces).toEqual([
      expect.objectContaining({ id: "unit:one", status: "failed", infraStatus: "incomplete", failureKind: "process-leak", processLeaks: [leak] }),
      expect.objectContaining({ id: "unit:two", status: "failed", infraStatus: "incomplete", failureKind: "process-leak", processLeaks: [leak] }),
    ]);
  });
});

function execFileSyncResult(command: string, args: string[], env: Record<string, string | undefined>) {
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.GITHUB_ACTIONS;
  delete inheritedEnv.TV_TEST_TIMING_PROVIDER;
  return spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", env: { ...inheritedEnv, FORCE_COLOR: "0", NO_COLOR: "1", ...env }, timeout: 20_000 });
}

function fixtureRun() {
  return {
    runId: "2026-01-01T00-00-00-000Z-p1-r0123456789abcdef",
    commandProvider: "local",
    timingProvider: "local-linux-x64-4cpu",
    status: "passed",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.025Z",
    durationMs: 25,
    selection: { surfaces: ["e2e:probe"] },
    git: { commit: null, tree: null, dirty: false },
    environment: { ci: false, os: "linux", arch: "x64", node: "22.0.0", logicalCpuCount: 4 },
  };
}
