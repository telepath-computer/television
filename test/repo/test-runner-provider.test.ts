import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { combineAttemptReports, compactProviderSummary, failedTasksFromShards, formatShardLogs, infrastructureRetryShardIndices, providerCommandExitCode, readShardSummaries, runInfrastructureAttempts, summarizeInfrastructureAttempts, writeProviderReports, type AttemptReport } from "../../scripts/test/provider-outputs.mjs";
import { classifyBlaxelCoordinatorFailure, classifyBlaxelShardStatus, classifyDownloadedShardStatus, validateDownloadedShardSummary } from "../../scripts/test/blaxel-classification.mjs";
import { acquireShardLeases, excludeSandboxesByName, leaseAcquisitionFailureShards } from "../../scripts/test/blaxel-lease-acquisition.mjs";
import { normalizeBlaxelSurfaces, normalizeProviderShardSurfaces, normalizeProviderTimingShards, resolveProviderRunGit } from "../../scripts/test/provider-normalization.mjs";
import { loadTestConfig, selectSurfaces } from "../../scripts/test/config.mjs";
import { normalizeProcessLeak } from "../../scripts/test/timing-events.mjs";
import { transferShardInputs } from "../../scripts/test/blaxel-shard-dispatch.mjs";
import { buildInterruptedAttemptReport, finishInterruptedRun } from "../../scripts/test/blaxel-interruption.mjs";

const config = loadTestConfig();
const surface = config.surfaces.find((candidate) => candidate.id === "unit:root")!;

function writeVitestNative(file: string, total: number) {
  writeFileSync(file, JSON.stringify({
    numTotalTests: total,
    numPassedTests: total,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [],
  }, null, 2));
}

describe("provider result normalization", () => {
  test("constructs Blaxel restore/wake timing with a typed passed status", () => {
    const source = readFileSync("scripts/run-blaxel-testshards.mjs", "utf8");
    expect(source).toContain('restorePhase = { name: "sandbox-restore-wake", status: "passed"');
    expect(source).not.toContain('restorePhase = { name: "sandbox-restore-wake", status: 0');
  });

  test("uses the measured Blaxel defaults for runs and shard-count recommendations", () => {
    const constants = readFileSync(path.join(process.cwd(), "scripts/testshard-constants.mjs"), "utf8");
    const cli = readFileSync(path.join(process.cwd(), "scripts/test/cli.mjs"), "utf8");
    expect(constants).toContain("RECOMMENDED_TEST_SHARD_COUNT = 36");
    expect(constants).toContain("DEFAULT_BLAXEL_POOL_SIZE = 72");
    expect(cli).toContain("currentCount: RECOMMENDED_TEST_SHARD_COUNT");
    expect(cli).toContain("capacity: DEFAULT_BLAXEL_POOL_SIZE");
    expect(cli).toContain('[--size ${DEFAULT_BLAXEL_POOL_SIZE}]');
    expect(cli).not.toContain("[--size 64]");
  });

  test("provisions fresh Blaxel workers from .nvmrc through pinned nvm", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/manage-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain('NVM_RELEASE = "v0.40.3"');
    expect(source).toContain('readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim()');
    expect(source).toContain("raw.githubusercontent.com/nvm-sh/nvm/${NVM_RELEASE}/install.sh");
    expect(source).toContain("PROFILE=/dev/null");
    expect(source).toContain("nvm install ${shellQuote(nodeSelector)}");
    expect(source).toContain("nvm alias default ${shellQuote(nodeSelector)}");
    expect(source).toContain("Delete the pool before ensure so every provisioned worker is fresh.");
    expect(source.indexOf("const existing = await listPoolSandboxes()"))
      .toBeLessThan(source.indexOf("SandboxInstance.createIfNotExists"));
    expect(source.indexOf("await sandbox.wait()"))
      .toBeLessThan(source.indexOf("await provisionSandboxRuntime(sandbox)"));
    expect(source.indexOf("await provisionSandboxRuntime(sandbox)"))
      .toBeLessThan(source.indexOf("await verifySandboxArchitecture(sandbox)"));

    expect(source).toContain("options.size ?? String(DEFAULT_BLAXEL_POOL_SIZE)");
    expect(source).toContain('const memory = Number.parseInt(options.memory ?? "8192", 10)');
    expect(source).toContain('const image = options.image ?? "blaxel/playwright-chromium:latest"');
    expect(source).toContain('return `tv-testshard-${arch}-${pool}-${String(index).padStart(2, "0")}`');
    for (const label of ['project: "television"', 'purpose: "testshards"', "pool,", "arch,"]) {
      expect(source).toContain(label);
    }
  });

  test("activates the provisioned runtime on every shard lease and binds dependency caching to its declarations", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain('export NVM_DIR="\\${NVM_DIR:-$HOME/.nvm}"');
    expect(source).toContain('. "$NVM_DIR/nvm.sh"');
    expect(source).toContain("nvm use --silent");
    expect(source.indexOf("run_step checkout"))
      .toBeLessThan(source.indexOf("run_step runtime-activation"));
    expect(source.indexOf("run_step runtime-activation"))
      .toBeLessThan(source.indexOf("run_step runtime-versions"));
    expect(source.indexOf("run_step runtime-versions"))
      .toBeLessThan(source.indexOf("run_step deps"));
    expect(source).toContain("git ls-files '.nvmrc' 'package-lock.json' 'package.json' '*/package.json'");
    expect(source).toContain("run_step deps bash -c");
    expect(source).toContain('-- bash -c "$TV_TARGET_COMMAND"');
  });

  test("uses Electron's installer for the Blaxel runtime preparation phase", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    const phase = source.match(/run_step electron-repair[^\n]*\n(?:.*\n)*?set \+e/)?.[0] ?? "";

    expect(phase).toContain("electron_config_cache=/cache/electron");
    expect(phase).toContain("node node_modules/electron/install.js");
    expect(phase).not.toContain("@electron/get");
    expect(phase).not.toContain("unzip");
    expect(phase).not.toContain("rm -rf");
  });

  test("turns shard input-transfer rejection into a reportable dispatch failure", async () => {
    const writes: string[] = [];
    const result = await transferShardInputs({
      write: async (remotePath) => {
        writes.push(remotePath);
        if (remotePath.endsWith("worker.sh")) throw new Error("script upload disconnected");
      },
      planRemotePath: "/tmp/worker.plan.json",
      planRaw: "{}",
      remoteScript: "/tmp/worker.sh",
      remoteScriptContents: "exit 0",
    });

    expect(writes).toEqual(["/tmp/worker.plan.json", "/tmp/worker.sh"]);
    expect(result).toMatchObject({
      ok: false,
      failureKind: "transport",
      failureStep: "worker-dispatch",
      failureMessage: "script upload disconnected",
    });

    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain("const dispatch = await transferShardInputs({");
    expect(source).toContain("return dispatchFailureResult({ lease, outputDir, startedAt, logPath, dispatch });");
    expect(source.indexOf("const dispatch = await transferShardInputs({")).toBeLessThan(source.indexOf("sandbox.process.exec({", source.indexOf("async function runShard")));
  });

  test("preserves completed, running, and pending shard evidence before signal cleanup", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-interrupted-attempt-"));
    const completedShard = { shardIndex: 1, shardTotal: 3, shard: "1/3", status: "passed", durationMs: 50, tasks: [] };
    const partialSummaryPath = path.join(root, "shard-2.json");
    const partialNativePath = path.join(root, "native-shard-2.json");
    writeFileSync(path.join(root, "shard-2.log"), "worker started\n");
    writeFileSync(partialSummaryPath, "{}\n");
    writeFileSync(partialNativePath, "{}\n");
    const runningLease = { lockId: "lock-2", shardIndex: 2, sandbox: { metadata: { name: "worker-2" } } };
    const report = buildInterruptedAttemptReport({
      signal: "SIGTERM",
      attempt: 0,
      runId: "run-a",
      suite: "all",
      target: {},
      shardTotal: 3,
      shardIndices: [1, 2, 3],
      pool: "default",
      arch: "x64",
      commit: "a".repeat(40),
      timeoutProfile: "normal",
      outputDir: root,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      completedResults: new Map([[1, completedShard]]),
      partialResults: new Map([[2, {
        shardIndex: 2,
        shardTotal: 3,
        shard: "2/3",
        sandbox: "worker-2",
        status: "failed",
        exitCode: 1,
        startedAt: "2026-01-01T00:00:00.100Z",
        summaryPath: partialSummaryPath,
        nativeResultPath: partialNativePath,
        logPath: path.join(root, "shard-2.log"),
        assignedFiles: ["test/shard-2.test.ts"],
        collectedFiles: ["test/shard-2.test.ts"],
        tasks: [{ surfaceId: "unit:root", status: "failed", nativeResultPath: partialNativePath }],
      }]]),
      leases: new Map([[2, runningLease]]),
      executionStarted: new Set([2]),
      shardStartedAt: new Map([[2, Date.parse("2026-01-01T00:00:00.100Z")], [3, Date.parse("2026-01-01T00:00:00.200Z")]]),
      plan: {
        planId: "plan-a",
        timingProvider: "blaxel-playwright-x64-4vcpu",
        testedCommit: "a".repeat(40),
        testedTree: "b".repeat(40),
        shards: [1, 2, 3].map((index) => ({ predictedDurationMs: index * 100, surfaces: [{ files: [{ path: `test/shard-${index}.test.ts` }] }] })),
      },
    });

    expect(report).toMatchObject({ status: "failed", interruptedBy: "SIGTERM", shardIndices: [1, 2, 3] });
    expect(report.shards).toEqual([
      completedShard,
      expect.objectContaining({ shardIndex: 2, sandbox: "worker-2", status: "infra-failed", leaseAcquired: true, executionStarted: true, failureKind: "interrupted", failureStep: "coordinator-interruption", assignedFiles: ["test/shard-2.test.ts"], collectedFiles: ["test/shard-2.test.ts"], summaryPath: partialSummaryPath, nativeResultPath: partialNativePath, logPath: path.join(root, "shard-2.log"), tasks: [{ surfaceId: "unit:root", status: "failed", nativeResultPath: partialNativePath }] }),
      expect.objectContaining({ shardIndex: 3, sandbox: null, status: "infra-failed", leaseAcquired: false, executionStarted: false, failureKind: "interrupted", failureStep: "coordinator-interruption", assignedFiles: ["test/shard-3.test.ts"] }),
    ]);
    expect(report.shards[1].failureMessage).toContain("worker execution had started on worker-2");
    expect(report.shards[2].failureMessage).toContain("lease acquisition had not completed");

    const unconfirmedStart = buildInterruptedAttemptReport({
      signal: "SIGINT",
      attempt: 0,
      runId: "run-b",
      suite: "all",
      target: {},
      shardTotal: 1,
      shardIndices: [1],
      pool: "default",
      arch: "x64",
      commit: "a".repeat(40),
      timeoutProfile: "normal",
      outputDir: root,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      leases: new Map([[1, { lockId: "lock-1", shardIndex: 1, sandbox: { metadata: { name: "worker-1" } } }]]),
      executionRequested: new Set([1]),
    });
    expect(unconfirmedStart.shards[0].executionStarted).toBeUndefined();
    expect(unconfirmedStart.shards[0].failureMessage).toContain("worker execution had been requested on worker-1, but its start had not been confirmed");

    writeProviderReports(root, report);
    expect(JSON.parse(readFileSync(path.join(root, "summary.json"), "utf8"))).toMatchObject({
      interruptedBy: "SIGTERM",
      counts: { shards: 3, shardsPassed: 1, shardsInfraFailed: 2 },
      infraFailedShards: [2, 3],
    });

    const order: string[] = [];
    expect(await finishInterruptedRun({
      preserveReport: async () => { order.push("report"); },
      releaseLeases: async () => { order.push("release"); },
      finalizeReport: async () => { order.push("finalize"); },
    })).toEqual({ reportError: null, releaseError: null, finalizeError: null });
    expect(order).toEqual(["report", "release", "finalize"]);

    order.length = 0;
    const failedWrite = await finishInterruptedRun({
      preserveReport: async () => { order.push("report"); throw new Error("disk full"); },
      releaseLeases: async () => { order.push("release"); },
      finalizeReport: async () => { order.push("finalize"); },
    });
    expect(failedWrite.reportError).toMatchObject({ message: "disk full" });
    expect(failedWrite.releaseError).toBeNull();
    expect(failedWrite.finalizeError).toBeNull();
    expect(order).toEqual(["report", "release", "finalize"]);

    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain("interruptedSnapshot = buildInterruptedReportSnapshot(signal)");
    expect(source).toContain("releaseLeases: async () => {");
    expect(source).toContain("finalizeReport: () => writeInterruptedReportSnapshot(interruptedSnapshot)");
    expect(source).toContain("completedResults: activeAttempt.completedResults");
    expect(source).toContain("partialResults: activeAttempt.partialResults");
    expect(source).toContain("executionRequested: activeAttempt.executionRequested");
    expect(source).toContain("onExecutionRequested: () => attemptState.executionRequested.add");
    expect(source).toContain("onResultProgress: (progress) => attemptState.partialResults.set");
    expect(source).toContain("retainResultProgress();");
    expect(source).toContain("if (task.nativeResultPath === remoteShardNativePath) tasks[taskIndex] = { ...tasks[taskIndex], nativeResultPath };");
    expect(source).toContain("shutdownPromise = (async () => {");
    expect(source).toContain("if (shutdownPromise) await shutdownPromise;");
  });

  test("bounds parallel lease acquisition and preserves every partial outcome", async () => {
    const shardIndices = [1, 2, 3, 4, 5, 6, 7];
    const started: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const failure = new Error("lease transport failed");

    const outcomes = await acquireShardLeases({
      shardIndices,
      maxConcurrency: 3,
      acquire: async ({ shardIndex }) => {
        started.push(shardIndex);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (shardIndex === 5) throw failure;
        if (shardIndex === 6) return null;
        return { lockId: `lock-${shardIndex}` };
      },
    });

    expect(maximumActive).toBe(3);
    expect([...started].sort((a, b) => a - b)).toEqual(shardIndices);
    expect(outcomes.map((outcome) => outcome.shardIndex)).toEqual(shardIndices);
    expect(outcomes.map((outcome) => outcome.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(outcomes[0]).toMatchObject({ lease: { lockId: "lock-1" }, error: null });
    expect(outcomes[4]).toMatchObject({ lease: null, error: failure });
    expect(outcomes[5]).toMatchObject({ lease: null, error: null });
    expect(outcomes.every((outcome) => Number.isFinite(outcome.startedAt))).toBe(true);
  });

  test("turns partial lease acquisition into a complete provider report without starting shards", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-partial-leases-"));
    const startedAt = Date.parse("2026-01-01T00:00:00.000Z");
    const acquisitionError = new Error("lease transport failed");
    const shards = leaseAcquisitionFailureShards({
      outcomes: [
        { shardIndex: 1, slot: 0, startedAt, lease: { sandbox: { metadata: { name: "worker-1" } } }, error: null },
        { shardIndex: 2, slot: 1, startedAt, lease: null, error: acquisitionError },
        { shardIndex: 3, slot: 2, startedAt, lease: null, error: null },
      ],
      shardTotal: 3,
      pool: "default",
      outputDir: root,
      completedAt: "2026-01-01T00:00:01.000Z",
      plan: {
        planId: "plan-a",
        timingProvider: "blaxel-playwright-x64-4vcpu",
        testedCommit: "a".repeat(40),
        testedTree: "b".repeat(40),
        shards: [1, 2, 3].map((index) => ({ predictedDurationMs: index * 100, surfaces: [{ files: [{ path: `test/shard-${index}.test.ts` }] }] })),
      },
    });

    expect(shards).toEqual([
      expect.objectContaining({ shardIndex: 1, sandbox: "worker-1", status: "infra-failed", leaseAcquired: true, executionStarted: false, failureKind: "lease-acquisition", failureStep: "execution-barrier", assignedFiles: ["test/shard-1.test.ts"], collectedFiles: [], tasks: [] }),
      expect.objectContaining({ shardIndex: 2, sandbox: null, status: "infra-failed", leaseAcquired: false, executionStarted: false, failureKind: "lease-acquisition", failureStep: "lease-acquisition", failureMessage: expect.stringContaining("lease transport failed") }),
      expect.objectContaining({ shardIndex: 3, sandbox: null, status: "infra-failed", leaseAcquired: false, executionStarted: false, failureKind: "lease-acquisition", failureStep: "lease-acquisition", failureMessage: expect.stringContaining("No worker was available") }),
    ]);
    expect(shards[0]!.failureMessage).toContain("execution did not start");

    writeProviderReports(root, { backend: "blaxel", status: "failed", shardTotal: 3, shardIndices: [1, 2, 3], shards });
    expect(JSON.parse(readFileSync(path.join(root, "report.json"), "utf8")).shards).toHaveLength(3);
    expect(JSON.parse(readFileSync(path.join(root, "summary.json"), "utf8"))).toMatchObject({
      counts: { shards: 3, shardsInfraFailed: 3 },
      shards: [
        { shardIndex: 1, leaseAcquired: true, executionStarted: false, failureStep: "execution-barrier" },
        { shardIndex: 2, leaseAcquired: false, executionStarted: false, failureStep: "lease-acquisition" },
        { shardIndex: 3, leaseAcquired: false, executionStarted: false, failureStep: "lease-acquisition" },
      ],
      infraFailedShards: [1, 2, 3],
    });

    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).not.toContain("if (acquisitionError) throw acquisitionError");
    expect(source).not.toContain("if (sandboxes.length < shardIndices.length) fail(");
    expect(source).toContain("acquisitionOutcomes = shardIndices.map((shardIndex, slot)");
    expect(source).toContain("results = leaseAcquisitionFailureShards({ outcomes: acquisitionOutcomes");
    expect(source).toContain("No shard execution started for this attempt.");
  });

  test("wires bounded normal-lease acquisition into active tracking and final cleanup", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain("MAX_PARALLEL_LEASE_ACQUISITIONS = 32");
    expect(source).toContain("await acquireShardLeases({");
    expect(source).toContain("acquire: async ({ shardIndex, slot }) => {");
    expect(source).toContain("const lease = await acquireAny(sandboxes, { shardIndex, slot, requestedWorkers: shardIndices.length });");
    expect(source).toContain("const lockId = `${runId}-shard-${shardIndex}`");
    expect(source).toContain("activeLeases.set(lockId, lease)");
    expect(source).toContain("lease.executionRequested = true");
    expect(source).toContain("lease.executionCompletionConfirmed = true");
    expect(source).toContain("killProcess: lease.executionRequested === true && lease.executionCompletionConfirmed !== true");
    expect(source).not.toContain("acquired.map((lease) => stopAndReleaseLease(lease, { killProcess: false }))");
    expect(source).toContain("lease.logPath = logPath");
    const stopIndex = source.indexOf("await lease.sandbox.process.kill(lease.processName)");
    const ownerCleanupIndex = source.indexOf("await reapUnconfirmedShardOwners(lease)", stopIndex);
    const releaseIndex = source.indexOf("await releaseLock(lease.sandbox, lease.lockId)", ownerCleanupIndex);
    expect(stopIndex).toBeGreaterThan(0);
    expect(ownerCleanupIndex).toBeGreaterThan(stopIndex);
    expect(releaseIndex).toBeGreaterThan(ownerCleanupIndex);
    expect(source).toContain("node scripts/test/stale-owner-reaper-cli.mjs --output");
    const ownerCleanupStart = source.indexOf("async function reapUnconfirmedShardOwners");
    const ownerCleanupEnd = source.indexOf("function buildInterruptedReportSnapshot", ownerCleanupStart);
    const ownerCleanupSource = source.slice(ownerCleanupStart, ownerCleanupEnd);
    expect(ownerCleanupSource).toContain('"set -eo pipefail"');
    expect(ownerCleanupSource).not.toContain('"set -euo pipefail"');
    expect(ownerCleanupSource).toContain('"nvm use --silent default"');
    expect(ownerCleanupSource).not.toContain('    "nvm use --silent",');
    expect(ownerCleanupSource.indexOf('. "$NVM_DIR/nvm.sh"')).toBeLessThan(ownerCleanupSource.indexOf('"set -u"'));
    expect(ownerCleanupSource.indexOf('"set -u"')).toBeLessThan(ownerCleanupSource.indexOf("node scripts/test/stale-owner-reaper-cli.mjs --output"));

    const nvmFixture = mkdtempSync(path.join(os.tmpdir(), "tv-provider-nvm-nounset-"));
    const outsideRepository = path.join(nvmFixture, "outside-repository");
    try {
      mkdirSync(outsideRepository);
      writeFileSync(path.join(nvmFixture, "nvm.sh"), [
        'if [ -z "${VERSION}" ]; then :; fi',
        "nvm() {",
        '  [ "$1" = use ] && [ "$2" = --silent ] || return 96',
        '  if [ "${3-}" != default ]; then printf "explicit default selector required\\n" >&2; return 127; fi',
        "}",
        "",
      ].join("\n"));
      const environment: NodeJS.ProcessEnv = { ...process.env, NVM_DIR: nvmFixture };
      delete environment.BASH_ENV;
      delete environment.VERSION;
      const corrected = spawnSync("bash", ["-c", [
        "set -eo pipefail",
        '. "$NVM_DIR/nvm.sh"',
        "nvm use --silent default",
        "set -u",
        'case "$-" in *u*) exit 0 ;; *) exit 97 ;; esac',
      ].join("; ")], { encoding: "utf8", env: environment, cwd: outsideRepository });
      expect(corrected.status, corrected.stderr).toBe(0);

      const bareSelection = spawnSync("bash", ["-c", [
        "set -eo pipefail",
        '. "$NVM_DIR/nvm.sh"',
        "nvm use --silent",
      ].join("; ")], { encoding: "utf8", env: environment, cwd: outsideRepository });
      expect(bareSelection.status).toBe(127);
      expect(bareSelection.stderr).toContain("explicit default selector required");

      const priorOrdering = spawnSync("bash", ["-c", [
        "set -euo pipefail",
        '. "$NVM_DIR/nvm.sh"',
        "nvm use --silent default",
      ].join("; ")], { encoding: "utf8", env: environment, cwd: outsideRepository });
      expect(priorOrdering.status).not.toBe(0);
      expect(priorOrdering.stderr).toContain("VERSION: unbound variable");
    } finally {
      rmSync(nvmFixture, { recursive: true, force: true });
    }

    expect(source).toContain("report.cleanupConfirmed === true");
    expect(source).toContain("report.liveOwners.length === 0");
    expect(source).toContain("report.remainingStaleOwners.length === 0");
    expect(source).toContain("Owner cleanup was not confirmed; retaining lease");
  });

  test("plans before Blaxel leases and invokes the production explicit-file worker", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    const cliSource = readFileSync(path.join(process.cwd(), "scripts/test/cli.mjs"), "utf8");
    const workerSource = readFileSync(path.join(process.cwd(), "scripts/test/planned-shard-worker.mjs"), "utf8");
    expect(source.indexOf('"scripts/plan-test-shards.mjs"')).toBeGreaterThan(0);
    expect(source.indexOf('"scripts/plan-test-shards.mjs"')).toBeLessThan(source.indexOf("await runInfrastructureAttempts"));
    expect(source).toContain('node scripts/run-test-shard.mjs --plan "$shard_plan"');
    expect(source).toContain("export TV_TEST_TIMING_PROVIDER=blaxel-playwright-x64-4vcpu");
    expect(source).not.toContain("--lab-plan");
    expect(source).not.toContain("blaxel-plan-worker");
    expect(source).not.toContain("GITHUB_ACTIONS");
    expect(workerSource).toContain('if (env.GITHUB_ACTIONS === "true")');
    expect(workerSource.indexOf('if (env.GITHUB_ACTIONS === "true")')).toBeLessThan(workerSource.indexOf("createRunContext(null"));
    expect(source).not.toContain("cleanup_test_processes");
    expect(source).not.toContain("cleanup-servers.mjs");
    expect(source).toContain("run_step owner-lifecycle node scripts/test/stale-owner-reaper-cli.mjs");
    expect(source.indexOf("run_step owner-lifecycle")).toBeLessThan(source.indexOf("run_step test-run"));
    expect(cliSource).toContain('--target-command-json", JSON.stringify(surface.command)');
    expect(cliSource).toContain('"--target-cwd", surface.command ? "." : surface.cwd || "."');
    expect(cliSource).toContain('surface.command ? selectionOptions.file : relativeToCwd(surface, selectionOptions.file)');
    expect(cliSource).toContain('--target-pre-command-json", JSON.stringify(surface.preCommand)');
    expect(cliSource).toContain('--target-services-json", JSON.stringify(surface.services)');
    expect(cliSource).toContain('"--target-surface-id", surface.id');
    expect(source).toContain('command: parseTargetCommand(options["target-command-json"])');
    expect(source).toContain('...target.command.map(shellQuote)');
    expect(source).toContain('preCommand: parseTargetPreCommand(options["target-pre-command-json"])');
    expect(source).toContain('services: parseTargetServices(options["target-services-json"])');
    expect(source).toContain('--services-json ${shellQuote(JSON.stringify(targetOptions().services))}');
    expect(source).toContain('node scripts/test/supervised-command.mjs');
    expect(source).toContain('surfaceId: options["target-surface-id"]');
    expect(source).toContain('case "$-" in *e*) restore_errexit=1');
    expect(workerSource).toContain("services: surface.services ?? []");
    expect(workerSource).toContain("startSurfaceServices(task.services");
  });
  test("writes targeted native reports to the supervisor-declared absolute path", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain('PLAYWRIGHT_JSON_OUTPUT_NAME="$TV_TARGET_NATIVE_RESULT"');
    expect(source).toContain('--outputFile "$TV_TARGET_NATIVE_RESULT"');
    expect(source).not.toContain("nativePathFromCwd");
  });

  test("reports only tasks that actually failed", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain("failedTasksFromShards(report.shards");

    const failures = failedTasksFromShards([{
      shardIndex: 17,
      shardTotal: 36,
      status: "failed",
      tasks: [
        { suite: "unit", name: "unit:not-here", status: "not-assigned", exitCode: null, durationMs: 0 },
        { suite: "unit", name: "unit:passed", status: "passed", exitCode: 0, durationMs: 10 },
        { suite: "e2e", name: "e2e:browser-app", status: "failed", exitCode: 1, durationMs: 20 },
      ],
    }], { shardTotal: 36 });

    expect(failures).toEqual([expect.objectContaining({ shard: "17/36", suite: "e2e", name: "e2e:browser-app", exitCode: 1 })]);
  });

  test("fails the provider command when the normalized report is not passed", () => {
    expect(providerCommandExitCode({ delegatedExitCode: 0, reportStatus: "passed" })).toBe(0);
    expect(providerCommandExitCode({ delegatedExitCode: 0, reportStatus: "incomplete" })).toBe(1);
    expect(providerCommandExitCode({ delegatedExitCode: 0, reportStatus: "failed" })).toBe(1);
    expect(providerCommandExitCode({ delegatedExitCode: 7, reportStatus: "passed" })).toBe(7);
  });

  test("does not advertise log paths that no shard result retained", () => {
    const withoutLogs = [
      { shardIndex: 1, shardTotal: 2, shard: "1/2", status: "infra-failed" as const, logPath: null },
      { shardIndex: 2, shardTotal: 2, shard: "2/2", status: "infra-failed" as const },
    ];
    expect(formatShardLogs(withoutLogs)).toBe("none");
    expect(formatShardLogs([
      { ...withoutLogs[0], logPath: "/tmp/provider/shard-1.log" },
      withoutLogs[1],
    ])).toBe("1/2=/tmp/provider/shard-1.log");
    expect(formatShardLogs([
      { ...withoutLogs[0], logPath: "/tmp/provider/shard-1.log" },
      { ...withoutLogs[1], logPath: "/tmp/provider/shard-2.log" },
    ])).toBe("/tmp/provider/shard-<n>.log");
  });

  test("distinguishes worker execution timeouts from report download failures", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain('let failureStep = "worker-execution"');
    expect(source.indexOf('sandbox.process.wait(processName'))
      .toBeLessThan(source.indexOf('failureStep = "report-download"'));

    expect(classifyBlaxelCoordinatorFailure({ failureStep: "worker-execution", message: "Process did not finish in time" }))
      .toEqual({ failureKind: "timeout", failureStep: "worker-execution" });
    expect(classifyBlaxelCoordinatorFailure({ failureStep: "worker-execution", message: "Process did not finish in time (tv-shard-1); it may still be running" }))
      .toEqual({ failureKind: "timeout", failureStep: "worker-execution" });
    expect(classifyBlaxelCoordinatorFailure({ failureStep: "report-download", message: "Process did not finish in time" }))
      .toEqual({ failureKind: "transport", failureStep: "report-download" });
    expect(classifyBlaxelCoordinatorFailure({ failureStep: "worker-execution", message: "stream reset" }))
      .toEqual({ failureKind: "transport", failureStep: "worker-execution" });
  });

  test("uses the immutable provider plan tree in the coordinator run identity", () => {
    const fallbackGit = { commit: "a".repeat(40), tree: null, workingTreeDirty: true };
    const plan = { planId: "plan-a", testedCommit: "a".repeat(40), testedTree: "b".repeat(40) };
    expect(resolveProviderRunGit({ fallbackGit, providerSummary: { plan } })).toEqual({
      commit: "a".repeat(40), tree: "b".repeat(40), workingTreeDirty: true,
    });
    expect(() => resolveProviderRunGit({ fallbackGit, providerSummary: { plan: { ...plan, testedCommit: "c".repeat(40) } } })).toThrow("provider plan commit");
  });

  test("does not invent a selected-surface result when provider evidence is absent", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-empty-"));
    const normalize = (providerSummary: AttemptReport | null) => normalizeProviderShardSurfaces({
      provider: "blaxel",
      providerSummary,
      outputDir: root,
      surfaces: [surface],
      delegatedCommand: ["node", "runner"],
      exitCode: providerSummary ? 0 : 1,
      coordinatorLogPath: path.join(root, "coordinator.log"),
    });

    expect(normalize(null)).toEqual([expect.objectContaining({ id: "provider:blaxel", runner: "blaxel", status: "failed", infraStatus: "incomplete", failureKind: "result-report", failureStep: "summary-read", counts: expect.objectContaining({ testsFailed: 0 }), logPath: null, nativeResultPath: null })]);
    expect(normalize({ status: "passed", shards: [] })).toEqual([expect.objectContaining({ id: "provider:blaxel", status: "failed", infraStatus: "incomplete", failureKind: "result-report", failureStep: "provider-evidence", counts: expect.objectContaining({ testsFailed: 0 }), logPath: null, nativeResultPath: null })]);
    expect(normalize({ status: "passed", shards: [{ shardIndex: 1, status: "passed", tasks: [{ surfaceId: surface.id, status: "not-assigned" }] }] })).toEqual([]);
  });

  test("merges per-shard task results and appends infra failure surface", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-normalize-"));
    const native1 = path.join(root, "native-unit-root-shard-1.json");
    const native2 = path.join(root, "nested", "native-unit-root-shard-2.json");
    mkdirSync(path.dirname(native2), { recursive: true });
    writeVitestNative(native1, 2);
    writeVitestNative(native2, 3);

    const surfaces = normalizeProviderShardSurfaces({
      provider: "blaxel",
      outputDir: root,
      surfaces: [surface],
      delegatedCommand: ["node", "runner"],
      exitCode: 1,
      coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: {
        status: "failed",
        shards: [
          { shardIndex: 1, status: "passed", logPath: path.join(root, "shard-1.log"), tasks: [{ surfaceId: "unit:root", runner: "vitest", command: "npx", args: [], status: "passed", exitCode: 0, durationMs: 10, nativeResultPath: native1 }] },
          { shardIndex: 2, status: "passed", logPath: path.join(root, "shard-2.log"), tasks: [{ surfaceId: "unit:root", runner: "vitest", command: "npx", args: [], status: "passed", exitCode: 0, durationMs: 20, nativeResultPath: "/workspace/television/.testshards/results/native-unit-root-shard-2.json" }] },
          { shardIndex: 3, status: "infra-failed", durationMs: 5, failureKind: "checkout", failureStep: "checkout", failureMessage: "Repository checkout failed", logPath: path.join(root, "shard-3.log"), tasks: [] },
        ],
      },
    });

    expect(surfaces).toHaveLength(2);
    expect(surfaces[0].id).toBe("unit:root");
    expect(surfaces[0].counts).toMatchObject({ testsTotal: 5, testsPassed: 5, testsFailed: 0 });
    expect(surfaces[0].nativeResultPaths).toHaveLength(2);
    expect(surfaces[1]).toMatchObject({ id: "provider:blaxel", runner: "blaxel", infraStatus: "incomplete", status: "failed", failureKind: "checkout", failureMessage: "Repository checkout failed", infraFailedShards: [3] });
  });

  test("preserves shard timing phases and not-assigned surface parts", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-timing-shards-"));
    const native = path.join(root, "native-unit-root-shard-1.json");
    writeVitestNative(native, 1);
    const other = config.surfaces.find((candidate) => candidate.id === "unit:server")!;
    const shards = normalizeProviderTimingShards({
      outputDir: root, surfaces: [surface, other], coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: { shardTotal: 2, shards: [{
        shardIndex: 1, shardTotal: 2, status: "passed", predictedDurationMs: 60_000, durationMs: 20,
        setupTimings: [
          { name: "sandbox-restore-wake", status: "passed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.005Z", durationMs: 5 },
          { name: "checkout", status: 0, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.010Z", durationMs: 10, cacheStatus: "hit" },
        ],
        phases: [{ name: "execution-group:unit:workspaces", status: "passed", durationMs: 10 }],
        tasks: [
          { surfaceId: "unit:root", runner: "vitest", command: "npx", args: ["vitest"], status: "passed", exitCode: 0, durationMs: 10, nativeResultPath: native, phases: [{ name: "runner", status: "passed", durationMs: 10 }] },
          { surfaceId: "unit:server", runner: "vitest", status: "not-assigned", durationMs: 0, assignedFiles: [], collectedFiles: [] },
        ],
      }] },
    });
    expect(shards).toHaveLength(1);
    expect(shards[0]).toEqual(expect.objectContaining({ index: 1, total: 2, status: "passed", predictedDurationMs: 60_000 }));
    expect(shards[0].phases).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "setup:sandbox-restore-wake", status: "passed" }),
      expect.objectContaining({ name: "setup:checkout", status: "passed", cacheStatus: "hit" }),
      expect.objectContaining({ name: "execution-group:unit:workspaces" }),
    ]));
    expect(shards[0].surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "unit:root", status: "passed", phases: expect.arrayContaining([expect.objectContaining({ name: "runner" })]) }),
      expect.objectContaining({ id: "unit:server", status: "not-assigned" }),
    ]));
  });

  test("keeps distinct infrastructure shard causes independently attributable", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-distinct-infra-"));
    const surfaces = normalizeProviderShardSurfaces({
      provider: "blaxel",
      outputDir: root,
      surfaces: [surface],
      delegatedCommand: ["node", "runner"],
      exitCode: 1,
      coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: {
        status: "failed",
        shards: [
          { shardIndex: 12, status: "infra-failed", failureKind: "stale-owner", failureStep: "owner-lifecycle", failureMessage: "stale owner", tasks: [] },
          { shardIndex: 18, status: "infra-failed", failureKind: "timeout", failureStep: "worker-execution", failureMessage: "deadline", tasks: [] },
        ],
      },
    });

    expect(surfaces).toEqual([
      expect.objectContaining({ id: "provider:blaxel:shard-12", failureKind: "stale-owner", failureStep: "owner-lifecycle", failureMessage: "stale owner", infraFailedShards: [12] }),
      expect.objectContaining({ id: "provider:blaxel:shard-18", failureKind: "timeout", failureStep: "worker-execution", failureMessage: "deadline", infraFailedShards: [18] }),
    ]);
  });

  test("preserves task infrastructure failures while merging shard parts", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-task-infra-"));
    const native = path.join(root, "native-unit-root-shard-1.json");
    writeVitestNative(native, 1);
    const normalized = normalizeProviderShardSurfaces({
      provider: "blaxel",
      outputDir: root,
      surfaces: [surface],
      delegatedCommand: ["node", "runner"],
      exitCode: 1,
      coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: {
        status: "failed",
        shards: [
          { shardIndex: 1, status: "passed", tasks: [{ surfaceId: "unit:root", runner: "vitest", command: "npx", status: "passed", exitCode: 0, durationMs: 5, nativeResultPath: native }] },
          { shardIndex: 2, status: "infra-failed", failureKind: "surface-service", failureStep: "surface-service-start", failureMessage: "port unavailable", tasks: [{ surfaceId: "unit:root", runner: "vitest", command: "npx", status: "failed", infraStatus: "incomplete", failureKind: "surface-service", failureStep: "surface-service-start", failureMessage: "port unavailable", exitCode: 1, durationMs: 5, nativeResultPath: null }] },
        ],
      },
    });

    expect(normalized).toEqual([
      expect.objectContaining({ id: "unit:root", status: "failed", infraStatus: "incomplete", failureKind: "surface-service", failureStep: "surface-service-start", failureMessage: "port unavailable", infraFailedShards: [2], failedTests: [] }),
      expect.objectContaining({ id: "provider:blaxel", failureKind: "surface-service", infraFailedShards: [2] }),
    ]);
  });

  test("normalizes Blaxel through the provider wrapper", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-blaxel-wrapper-"));
    const native = path.join(root, "native-unit-root-shard-1.json");
    writeVitestNative(native, 1);
    const surfaces = normalizeBlaxelSurfaces({
      outputDir: root,
      surfaces: [surface],
      delegatedCommand: ["node", "runner"],
      exitCode: 0,
      coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: { status: "passed", shards: [{ shardIndex: 1, status: "passed", tasks: [{ surfaceId: "unit:root", runner: "vitest", command: "npx", args: [], status: "passed", exitCode: 0, durationMs: 1, nativeResultPath: native }] }] },
    });
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({ id: "unit:root", status: "passed", counts: { testsTotal: 1, testsPassed: 1, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 } });
  });

  test("normalizes absolute worker-native paths against the remote repository root", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-remote-native-"));
    const native = path.join(root, "native-unit-root-shard-1.json");
    writeFileSync(native, JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [{
        name: "/workspace/television/test/repo/example.test.ts",
        status: "passed",
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_000_010,
        assertionResults: [{ title: "passes remotely", ancestorTitles: ["worker"], status: "passed", duration: 10 }],
      }],
    }));
    const surfaces = normalizeBlaxelSurfaces({
      outputDir: root,
      surfaces: [surface],
      delegatedCommand: ["node", "runner"],
      exitCode: 0,
      coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: { status: "passed", shards: [{ shardIndex: 1, status: "passed", nativeResultPath: native, tasks: [{ surfaceId: "unit:root", runner: "vitest", command: "npx", args: [], status: "passed", exitCode: 0, durationMs: 10, nativeResultPath: native }] }] },
    });
    expect(surfaces[0].counts).toMatchObject({ testsTotal: 1, testsPassed: 1, testsFailed: 0 });
    expect(surfaces[0].files).toEqual([expect.objectContaining({ path: "test/repo/example.test.ts", status: "passed" })]);
  });

  test("propagates and deduplicates shared task lifecycle leaks", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-leak-"));
    const native = path.join(root, "native-unit-root-shard-1.json");
    writeVitestNative(native, 1);
    const leak = normalizeProcessLeak({
      ownerToken: "fixture-owner", owningSurfaceIds: ["unit:root"], pid: 4321, parentPid: 4000, processGroupId: 4321,
      processStartedAt: "2026-01-01T00:00:00.000Z", detectedAt: "2026-01-01T00:00:01.000Z", command: "/usr/bin/node",
      listeningSockets: [{ protocol: "tcp", family: "ipv4", host: "127.0.0.1", port: 4888 }],
      cleanup: { termSent: true, killSent: false, outcome: "terminated" },
    });
    const surfaces = normalizeBlaxelSurfaces({
      outputDir: root, surfaces: [surface], delegatedCommand: ["node", "runner"], exitCode: 1, coordinatorLogPath: path.join(root, "coordinator.log"),
      providerSummary: { status: "failed", shards: [
        { shardIndex: 1, status: "failed", tasks: [
          { surfaceId: "unit:root", runner: "vitest", command: "npx", args: [], status: "failed", exitCode: 1, durationMs: 5, nativeResultPath: native, processLeaks: [leak, leak] },
        ] },
      ] },
    });
    expect(surfaces).toEqual([expect.objectContaining({ id: "unit:root", durationSource: "task-wall", processLeaks: [leak] })]);
  });

  test("preserves stale startup owners that are outside the current selection", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-stale-owner-"));
    const leak = normalizeProcessLeak({
      ownerToken: "fixture-stale-owner", owningSurfaceIds: ["unit:previous-owner"], pid: 9876, parentPid: null, processGroupId: 9876,
      processStartedAt: "2026-01-01T00:00:00.000Z", detectedAt: "2026-01-01T00:00:01.000Z", command: "/usr/bin/node",
      listeningSockets: [], cleanup: { termSent: true, killSent: false, outcome: "terminated" },
    });
    const providerSummary: AttemptReport = {
      status: "failed",
      shardTotal: 1,
      shards: [{
        shardIndex: 1, shardTotal: 1, status: "infra-failed", durationMs: 5,
        failureKind: "stale-owner", failureStep: "owner-lifecycle", failureMessage: "stale owner blocked startup",
        processLeaks: [leak], tasks: [],
      }],
    };
    const normalized = normalizeProviderShardSurfaces({
      provider: "blaxel", providerSummary, outputDir: root, surfaces: [surface], delegatedCommand: ["node", "runner"], exitCode: 1, coordinatorLogPath: path.join(root, "coordinator.log"),
    });
    expect(normalized).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "unit:previous-owner", runner: "lifecycle", failureKind: "stale-owner", processLeaks: [leak] }),
      expect.objectContaining({ id: "provider:blaxel", failureKind: "stale-owner" }),
    ]));
    const timing = normalizeProviderTimingShards({ providerSummary, outputDir: root, surfaces: [surface], coordinatorLogPath: path.join(root, "coordinator.log") });
    expect((timing[0] as any).surfaces).toContainEqual(expect.objectContaining({ id: "unit:previous-owner", status: "incomplete", processLeaks: [leak] }));
  });

  test("combines retry attempts by latest shard and preserves output provenance", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-combine-"));
    const attempt1 = path.join(root, "attempt-1");
    const attempt2 = path.join(root, "attempt-2");
    mkdirSync(attempt1, { recursive: true });
    mkdirSync(attempt2, { recursive: true });
    const plan = { planId: "plan-a" };
    const attempts: AttemptReport[] = [
      {
        status: "failed",
        plan,
        shardIndices: [1, 2, 3, 4, 5, 6, 7, 8],
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:01:00.000Z",
        shards: Array.from({ length: 8 }, (_, index) => index + 1).map((shardIndex) => ({
          shardIndex,
          shardTotal: 8,
          status: shardIndex === 8 ? "infra-failed" : "passed",
          outputDir: attempt1,
          tasks: [],
        })),
      },
      {
        status: "passed",
        plan,
        shardIndices: [8],
        startedAt: "2026-01-01T00:02:00.000Z",
        completedAt: "2026-01-01T00:03:00.000Z",
        shards: [{ shardIndex: 8, shardTotal: 8, status: "passed", outputDir: attempt2, tasks: [] }],
      },
    ];

    const combined = combineAttemptReports(attempts, [1, 2, 3, 4, 5, 6, 7, 8], { shardTotal: 8, outputDir: root });
    expect(combined.status).toBe("passed");
    expect(combined.plan).toBe(plan);
    expect(combined.shardIndices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(compactProviderSummary(combined).shardIndices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(compactProviderSummary({ ...combined, attempts }).attempts).toEqual([
      expect.objectContaining({ shardIndices: [1, 2, 3, 4, 5, 6, 7, 8] }),
      expect.objectContaining({ shardIndices: [8] }),
    ]);
    expect(combined.shards).toHaveLength(8);
    expect(combined.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(combined.completedAt).toBe("2026-01-01T00:03:00.000Z");
    expect(combined.durationMs).toBe(180000);
    expect(combined.shards.find((shard) => shard.shardIndex === 8)?.outputDir).toBe(attempt2);
  });

  test("makes a missing retry result supersede the stale result from an earlier attempt", () => {
    const plan = { planId: "plan-a" };
    const combined = combineAttemptReports([
      {
        status: "failed", plan, shardIndices: [4], startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z",
        shards: [{ shardIndex: 4, shardTotal: 8, status: "infra-failed", failureKind: "timeout", tasks: [] }],
      },
      {
        status: "failed", plan, shardIndices: [4], startedAt: "2026-01-01T00:00:02.000Z", completedAt: "2026-01-01T00:00:03.000Z",
        shards: [],
      },
    ], [4], { shardTotal: 8, outputDir: "." });

    expect(combined.shards[0]).toMatchObject({
      shardIndex: 4,
      status: "infra-failed",
      failureKind: "missing-result",
      failureStep: "attempt-aggregation",
      failureMessage: "Infrastructure attempt 2 returned no result for shard 4/8.",
    });
  });

  test("executes every retryable infrastructure shard in a later attempt", async () => {
    const requests: Array<{ attempt: number; shardIndices: number[]; excludedSandboxes: string[] }> = [];
    const retries: number[][] = [];
    const reports: AttemptReport[] = [
      {
        status: "failed",
        shardIndices: [1, 2],
        shards: [
          { shardIndex: 1, shardTotal: 2, status: "infra-failed", failureKind: "transport", tasks: [] },
          { shardIndex: 2, shardTotal: 2, status: "failed", tasks: [{ surfaceId: "unit:server", status: "failed" }] },
        ],
      },
      { status: "passed", shardIndices: [1], shards: [{ shardIndex: 1, shardTotal: 2, status: "passed", tasks: [] }] },
    ];

    const attempts = await runInfrastructureAttempts({
      initialShardIndices: [1, 2],
      retryInfra: 2,
      runAttempt: async (request) => {
        requests.push({ attempt: request.attempt, shardIndices: [...request.shardIndices], excludedSandboxes: [...request.excludedSandboxes] });
        return reports[request.attempt]!;
      },
      onRetry: ({ shardIndices }) => retries.push([...shardIndices]),
    });

    expect(requests).toEqual([
      { attempt: 0, shardIndices: [1, 2], excludedSandboxes: [] },
      { attempt: 1, shardIndices: [1], excludedSandboxes: [] },
    ]);
    expect(retries).toEqual([[1]]);
    expect(attempts).toEqual(reports);
  });

  test("retries stale-owner failures only after excluding their contaminated sandboxes and preserves the failed attempt", async () => {
    const requests: Array<{ attempt: number; shardIndices: number[]; excludedSandboxes: string[] }> = [];
    const retries: Array<{ shardIndices: number[]; excludedSandboxes: string[] }> = [];
    const contaminatedOutput = "attempt-1";
    const cleanOutput = "attempt-2";
    const staleLeak = { ownerToken: "old-run:4", pid: 4321, cleanup: { outcome: "terminated" } };
    const reports: AttemptReport[] = [
      {
        status: "failed",
        shardIndices: [4],
        shards: [{
          shardIndex: 4, shardTotal: 8, status: "infra-failed", sandbox: "worker-dirty",
          failureKind: "stale-owner", failureStep: "owner-lifecycle", failureMessage: "stale owner blocked startup",
          executionStarted: false, processLeaks: [staleLeak], logPath: `${contaminatedOutput}/shard-4.log`,
          summaryPath: `${contaminatedOutput}/shard-4.json`, outputDir: contaminatedOutput, tasks: [],
        }],
      },
      {
        status: "passed",
        shardIndices: [4],
        excludedSandboxes: ["worker-dirty"],
        shards: [{ shardIndex: 4, shardTotal: 8, status: "passed", sandbox: "worker-clean", outputDir: cleanOutput, tasks: [] }],
      },
    ];

    const attempts = await runInfrastructureAttempts({
      initialShardIndices: [4],
      retryInfra: 1,
      runAttempt: async (request) => {
        requests.push({ attempt: request.attempt, shardIndices: [...request.shardIndices], excludedSandboxes: [...request.excludedSandboxes] });
        return reports[request.attempt]!;
      },
      onRetry: ({ shardIndices, excludedSandboxes }) => retries.push({ shardIndices: [...shardIndices], excludedSandboxes: [...excludedSandboxes] }),
    });

    expect(requests).toEqual([
      { attempt: 0, shardIndices: [4], excludedSandboxes: [] },
      { attempt: 1, shardIndices: [4], excludedSandboxes: ["worker-dirty"] },
    ]);
    expect(retries).toEqual([{ shardIndices: [4], excludedSandboxes: ["worker-dirty"] }]);
    expect(attempts).toEqual(reports);
    const summarized = summarizeInfrastructureAttempts(attempts);
    expect(summarized).toEqual([
      expect.objectContaining({
        attempt: 1,
        shards: [expect.objectContaining({
          shardIndex: 4, status: "infra-failed", sandbox: "worker-dirty", failureKind: "stale-owner",
          processLeaks: [staleLeak], logPath: `${contaminatedOutput}/shard-4.log`, summaryPath: `${contaminatedOutput}/shard-4.json`,
        })],
      }),
      expect.objectContaining({ attempt: 2, excludedSandboxes: ["worker-dirty"], shards: [expect.objectContaining({ sandbox: "worker-clean", status: "passed" })] }),
    ]);
    expect(compactProviderSummary({ status: "passed", shards: reports[1]!.shards, attempts: summarized }).attempts).toEqual([
      expect.objectContaining({ attempt: 1, shards: [expect.objectContaining({ sandbox: "worker-dirty", failureKind: "stale-owner", processLeaks: [staleLeak] })] }),
      expect.objectContaining({ attempt: 2, excludedSandboxes: ["worker-dirty"], shards: [expect.objectContaining({ sandbox: "worker-clean", status: "passed" })] }),
    ]);
  });

  test("does not retry stale-owner evidence without an exact sandbox to quarantine", () => {
    const report: AttemptReport = {
      status: "failed",
      shards: [{ shardIndex: 4, shardTotal: 8, status: "infra-failed", failureKind: "stale-owner", tasks: [] }],
    };
    expect(infrastructureRetryShardIndices(report, { attempt: 0, retryInfra: 2 })).toEqual([]);
  });

  test("keeps canonical stale-owner retry authority aligned with sandbox quarantine", () => {
    const authority = readFileSync(path.join(process.cwd(), "specs/arch/test-runner/test-runner.md"), "utf8");
    expect(authority).not.toContain("`stale-owner` is the safety exception defined by [[blaxel-testshards.md]] and is not retried.");
    expect(authority).toContain("the contaminated sandbox runs no selected test and is excluded from later attempts");
    expect(authority).toContain("a configured retry may run the unchanged shard assignment on a distinct sandbox only after that sandbox acquires its own lease and passes its owner audit");
  });

  test("excludes every named contaminated sandbox from retry candidates", () => {
    const clean = { metadata: { name: "worker-clean" } };
    const dirty = { metadata: { name: "worker-dirty" } };
    const dirtyAgain = { metadata: { name: "worker-dirty-again" } };
    const unnamed = { metadata: {} };
    const candidates = [dirty, clean, unnamed, dirtyAgain];

    expect(excludeSandboxesByName(candidates, ["worker-dirty", "worker-dirty-again", "worker-dirty"])).toEqual([clean, unnamed]);
    expect(excludeSandboxesByName(candidates, [])).toEqual(candidates);
    expect(candidates).toEqual([dirty, clean, unnamed, dirtyAgain]);
  });

  test("passes accumulated contaminated-sandbox names through the coordinator retry wiring", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain("runAttempt: async ({ attempt, shardIndices: attemptShardIndices, excludedSandboxes })");
    expect(source).toContain("return runAttempt({ attempt, shardIndices: attemptShardIndices, excludedSandboxes, outputDir: attemptDir })");
    expect(source).toContain("excludeSandboxesByName(await listPoolSandboxes(), excludedSandboxes)");
    expect(source.indexOf("excludeSandboxesByName(await listPoolSandboxes(), excludedSandboxes)"))
      .toBeLessThan(source.indexOf("acquireShardLeases({"));
  });

  test("replaces infrastructure-failed shards with their completed retries", () => {
    const firstAttempt: AttemptReport = {
      status: "failed",
      shardIndices: [1, 2, 3],
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      shards: [
        { shardIndex: 1, shardTotal: 3, status: "infra-failed", failureKind: "result-report", tasks: [{ surfaceId: "unit:web", suite: "unit", name: "unit:web", status: "failed", exitCode: 1 }] },
        { shardIndex: 2, shardTotal: 3, status: "infra-failed", failureKind: "transport", tasks: [] },
        { shardIndex: 3, shardTotal: 3, status: "failed", tasks: [{ surfaceId: "unit:server", suite: "unit", name: "unit:server", status: "failed", exitCode: 1 }] },
      ],
    };

    expect(infrastructureRetryShardIndices(firstAttempt, { attempt: 0, retryInfra: 2 })).toEqual([1, 2]);

    const retryAttempt: AttemptReport = {
      status: "passed",
      shardIndices: [1, 2],
      startedAt: "2026-01-01T00:00:02.000Z",
      completedAt: "2026-01-01T00:00:03.000Z",
      shards: [
        { shardIndex: 1, shardTotal: 3, status: "passed", tasks: [{ surfaceId: "unit:web", suite: "unit", name: "unit:web", status: "passed", exitCode: 0 }] },
        { shardIndex: 2, shardTotal: 3, status: "passed", tasks: [] },
      ],
    };
    const combined = combineAttemptReports([firstAttempt, retryAttempt], [1, 2, 3], { shardTotal: 3, outputDir: "." });
    expect(combined.shards.map((shard) => [shard.shardIndex, shard.status])).toEqual([[1, "passed"], [2, "passed"], [3, "failed"]]);
    expect(combined.failedTasks.map((task) => task.name)).toEqual(["unit:server"]);
  });

  test("rejects changed or missing plans across planned infrastructure retries", () => {
    const report = (plan?: AttemptReport["plan"]): AttemptReport => ({
      status: "failed", plan, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z",
      shards: [{ shardIndex: 1, shardTotal: 2, status: "infra-failed", tasks: [] }],
    });
    expect(() => combineAttemptReports([report({ planId: "plan-a" }), report({ planId: "plan-b" })], [1], { shardTotal: 2, outputDir: "." })).toThrow("changed shard plan");
    expect(() => combineAttemptReports([report({ planId: "plan-a" }), report()], [1], { shardTotal: 2, outputDir: "." })).toThrow("missing shard plan");
  });

  test("treats an unparseable shard summary as missing infrastructure evidence", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-corrupt-"));
    writeFileSync(path.join(root, "shard-4.json"), "{ not json");
    const summaries = readShardSummaries(root);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      shardIndex: 4,
      status: "infra-failed",
      failureKind: "result-report",
      failureStep: "summary-parse",
      tasks: [],
    });

    const combined = combineAttemptReports([{ status: "failed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", shards: summaries }], [4], { shardTotal: 8, outputDir: root });
    expect(combined.status).toBe("failed");
    expect(combined.infraFailedShards).toEqual([4]);
    expect(combined.failedTasks).toHaveLength(0);
  });

  test("accepts fail-fast skips without relaxing collection validation for completed tasks", () => {
    const plan = {
      planId: "plan-a",
      timingProvider: "blaxel-playwright-x64-4vcpu",
      testedCommit: "a".repeat(40),
      testedTree: "b".repeat(40),
      shardTotal: 1,
      shards: [{ surfaces: [{ files: [{ path: "test/failed.test.ts" }, { path: "test/skipped.test.ts" }] }] }],
    };
    const summary = {
      status: "failed",
      planId: plan.planId,
      timingProvider: plan.timingProvider,
      testedCommit: plan.testedCommit,
      testedTree: plan.testedTree,
      shardIndex: 1,
      shardTotal: 1,
      assignedFiles: ["test/failed.test.ts", "test/skipped.test.ts"],
      collectedFiles: ["test/failed.test.ts"],
      tasks: [
        { surfaceId: "unit:failed", status: "failed", assignedFiles: ["test/failed.test.ts"], collectedFiles: ["test/failed.test.ts"] },
        { surfaceId: "e2e:skipped", status: "skipped", skipReason: "fail-fast", assignedFiles: ["test/skipped.test.ts"], collectedFiles: [] },
      ],
    };

    expect(validateDownloadedShardSummary(summary, plan, 1)).toBeNull();
    expect(validateDownloadedShardSummary({ ...summary, status: "passed" }, plan, 1)).toContain("reports passed with a skipped assigned task");
    expect(validateDownloadedShardSummary({
      ...summary,
      collectedFiles: [],
      tasks: [
        { surfaceId: "unit:failed", status: "failed", assignedFiles: ["test/failed.test.ts"], collectedFiles: [] },
        summary.tasks[1],
      ],
    }, plan, 1)).toContain("did not collect its complete assignment");
  });

  test("classifies missing shard results as infrastructure rather than test failures", () => {
    expect(classifyBlaxelShardStatus({ shardSummary: null, exitCode: 1, hasSummaryFile: false, setupTimings: [{ name: "checkout", status: 1 }] })).toBe("infra-failed");
    expect(classifyBlaxelShardStatus({ shardSummary: null, exitCode: 1, hasSummaryFile: false, setupTimings: [{ name: "test-run", status: 1 }] })).toBe("infra-failed");
    expect(classifyBlaxelShardStatus({ shardSummary: null, exitCode: 1, hasSummaryFile: true, setupTimings: [{ name: "test-run", status: 1 }] })).toBe("infra-failed");
    expect(classifyBlaxelShardStatus({ shardSummary: { status: "failed" }, exitCode: 1, hasSummaryFile: true, setupTimings: [{ name: "test-run", status: 1 }] })).toBe("failed");
    expect(classifyBlaxelShardStatus({ shardSummary: { status: "passed" }, exitCode: 0, hasSummaryFile: true, setupTimings: [{ name: "test-run", status: 0 }] })).toBe("passed");
    expect(classifyBlaxelShardStatus({ shardSummary: { status: "passed" }, exitCode: 1, hasSummaryFile: true, setupTimings: [{ name: "test-run", status: 1 }] })).toBe("failed");
    expect(classifyDownloadedShardStatus({ identityError: null, shardSummary: { status: "passed" }, exitCode: 1, hasSummaryFile: true, setupTimings: [{ name: "test-run", status: 1 }] })).toBe("failed");
    expect(classifyDownloadedShardStatus({ identityError: null, shardSummary: { status: "passed" }, exitCode: null, hasSummaryFile: true })).toBe("infra-failed");
    expect(classifyDownloadedShardStatus({ identityError: "plan mismatch", shardSummary: { status: "passed" }, exitCode: 0, hasSummaryFile: true })).toBe("infra-failed");
    expect(classifyBlaxelShardStatus({ shardSummary: { status: "infra-failed", failureKind: "plan-validation" }, exitCode: 2, hasSummaryFile: true, setupTimings: [{ name: "test-run", status: 2 }] })).toBe("infra-failed");
  });

  test("keeps a passed-summary/nonzero-exit contradiction visible without making it retryable", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-contradiction-"));
    const native = path.join(root, "native.json");
    writeVitestNative(native, 1);
    const providerSummary: AttemptReport = {
      status: "failed",
      shardTotal: 1,
      shards: [{
        shardIndex: 1,
        shardTotal: 1,
        status: "failed",
        failureKind: "result-report",
        failureStep: "summary-validation",
        failureMessage: "downloaded shard 1 reports passed but the worker exited 1",
        tasks: [{ surfaceId: surface.id, runner: "vitest", command: "npx", args: [], status: "passed", exitCode: 0, nativeResultPath: native }],
      }],
    };

    expect(infrastructureRetryShardIndices(providerSummary, { attempt: 0, retryInfra: 2 })).toEqual([]);
    expect(normalizeProviderShardSurfaces({ provider: "blaxel", providerSummary, outputDir: root, surfaces: [surface], delegatedCommand: ["node", "runner"], exitCode: 1, coordinatorLogPath: path.join(root, "coordinator.log") })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: surface.id, status: "passed" }),
      expect.objectContaining({ id: "provider:blaxel", status: "failed", infraStatus: "incomplete", failureKind: "result-report", failureStep: "summary-validation" }),
    ]));
  });

  test("writes compact provider summary next to full provider report", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-provider-reports-"));
    const report = {
      backend: "blaxel",
      status: "failed",
      runId: "run-1",
      suite: "all",
      shardTotal: 8,
      shardIndices: [1],
      plan: { planId: "plan-a" },
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
      durationMs: 10000,
      shards: [{
        shardIndex: 1,
        shard: "1/8",
        status: "failed",
        sandbox: "worker-1",
        exitCode: 1,
        durationMs: 9000,
        setupTimings: [{ name: "sandbox-restore-wake", status: "passed", durationMs: 500 }],
        failureKind: "checkout",
        logPath: path.join(root, "shard-1.log"),
        tasks: [{ suite: "unit", name: "unit:root", status: "failed", exitCode: 1, durationMs: 1000, nativeResultPath: path.join(root, "native.json") }],
      }],
      failedTasks: [{ shard: "1/8", suite: "unit", name: "unit:root", exitCode: 1, durationMs: 1000, logPath: path.join(root, "shard-1.log") }],
      infraFailedShards: [],
    };

    expect(compactProviderSummary(report).outputs).toEqual({ report: "report.json", plan: "shard-plan.json" });
    writeFileSync(path.join(root, "request.json"), "{}\n");
    writeProviderReports(root, report);

    const summary = JSON.parse(readFileSync(path.join(root, "summary.json"), "utf8"));
    const full = JSON.parse(readFileSync(path.join(root, "report.json"), "utf8"));
    expect(full.shards[0].tasks).toHaveLength(1);
    expect(summary.shards[0].tasks).toBeUndefined();
    expect(summary.shards[0].failureKind).toBe("checkout");
    expect(summary.shards[0].phases).toContainEqual(expect.objectContaining({ name: "setup:sandbox-restore-wake", status: "passed" }));
    expect(summary.planId).toBe("plan-a");
    expect(summary.outputs).toEqual({ report: "report.json", request: "request.json", plan: "shard-plan.json" });
    expect(summary.failedTasks).toEqual(report.failedTasks);
  });

  test("selects package surfaces for Blaxel selection runs", () => {
    expect(selectSurfaces(config, { package: "@telepath-computer/television-web" }).map((candidate) => candidate.id).sort()).toEqual(["e2e:browser-app", "unit:browser-app"]);
  });
});
