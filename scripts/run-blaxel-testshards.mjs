#!/usr/bin/env node
import { listBlaxelPoolSandboxes } from "./test/blaxel-pool.mjs";
import { RECOMMENDED_TEST_SHARD_COUNT } from "./testshard-constants.mjs";
import { combineAttemptReports, failedTasksFromShards, formatShardLogs, runInfrastructureAttempts, summarizeInfrastructureAttempts, writeProviderReports } from "./test/provider-outputs.mjs";
import { classifyBlaxelCoordinatorFailure, classifyDownloadedShardStatus, validateDownloadedShardSummary } from "./test/blaxel-classification.mjs";
import { acquireShardLeases, excludeSandboxesByName, leaseAcquisitionFailureShards } from "./test/blaxel-lease-acquisition.mjs";
import { buildInterruptedAttemptReport, finishInterruptedRun } from "./test/blaxel-interruption.mjs";
import { BLAXEL_GITHUB_TOKEN_ENV, BLAXEL_GITHUB_TOKEN_FILE, readBlaxelGithubToken } from "./test/blaxel-github-token.mjs";
import { blaxelCheckoutScript, blaxelDependencyScript, resolveBlaxelRepositoryUrl } from "./test/blaxel-repository.mjs";
import { transferShardInputs } from "./test/blaxel-shard-dispatch.mjs";
import { buildLinuxStaleOwnerAuditInvocation, parseLinuxStaleOwnerAuditOutput } from "./test/blaxel-stale-owner-audit.mjs";
import { normalizeSetupTimingStatus, normalizeTimingPhase } from "./test/phase-metrics.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const options = parseArgs(process.argv.slice(2));
const auditStaleOwners = Boolean(options["audit-stale-owners"]);
const suite = options.suite ?? "all";
const selectedSurfaceIds = options.surfaces ?? null;
const shardTotal = Number.parseInt(options.shards ?? options.total ?? String(RECOMMENDED_TEST_SHARD_COUNT), 10);
const shardIndices = parseShardIndices(options["shard-indices"] ?? options.shard ?? "", shardTotal);
const pool = options.pool ?? "default";
const arch = options.arch ?? "x64";
const testRetries = parseNonNegativeInt(options["test-retries"] ?? "0", "--test-retries");
if (arch !== "x64") fail("Blaxel testshards currently support only verified x64/linux sandboxes. Omit --arch or use --arch x64.");
const target = options.commit ?? "HEAD";
const outputDir = path.resolve(options["output-dir"] ?? path.join(".blaxel-testshards", "latest"));
let shardPlanPath = null;
let shardPlanRaw = null;
let shardPlan = null;
const coordinatorPhases = [];
const allowDirty = Boolean(options["allow-dirty"]);
const retryInfra = Number.parseInt(options["retry-infra"] ?? "0", 10);
const timeoutProfile = options["timeout-profile"] ?? "normal";
const timeouts = resolveTimeouts(timeoutProfile, options);
const playwrightBrowsersPath = options["playwright-browsers-path"] ?? "/home/playwright/.cache/ms-playwright";
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const activeLeases = new Map();
const attempts = [];
let finalReport = null;
let activeAttempt = null;
let shutdownPromise = null;
const MAX_PARALLEL_LEASE_ACQUISITIONS = 32;
let shuttingDown = false;
installSignalHandlers({ killProcesses: !auditStaleOwners });

if (auditStaleOwners) {
  validateStaleOwnerAuditOptions(options);
  await exitAfterShutdown(await runStaleOwnerAudit());
}

const blaxelGithubToken = readBlaxelGithubToken();
if (!["all", "unit", "e2e", "target", "selection"].includes(suite)) fail("--suite must be one of: all, unit, e2e, target, selection");
if (suite === "selection" && !selectedSurfaceIds) fail("--suite selection requires --surfaces <surface-id[,surface-id...]>");
if (suite === "target" && !options["target-workspace"] && !options["target-runner"]) fail("--suite target requires either --target-workspace or --target-runner.");
if (!Number.isInteger(shardTotal) || shardTotal < 1) fail("--shards must be a positive integer");
if (suite !== "target" && shardTotal !== RECOMMENDED_TEST_SHARD_COUNT && options["allow-shard-count-override"] !== "1") {
  fail(`Blaxel testshards use ${RECOMMENDED_TEST_SHARD_COUNT} shards by default so concurrent runs pack cleanly into the shared pool. Pass --allow-shard-count-override only for explicit experiments.`);
}
if (!Number.isInteger(retryInfra) || retryInfra < 0) fail("--retry-infra must be a non-negative integer");
if (!["normal", "cold", "repair"].includes(timeoutProfile)) fail("--timeout-profile must be one of: normal, cold, repair");
if (!blaxelGithubToken) fail(`${BLAXEL_GITHUB_TOKEN_FILE} or ${BLAXEL_GITHUB_TOKEN_ENV} must contain a GitHub token so Blaxel workers can fetch the repository without persisting credentials.`);
const repoUrl = selectedRepositoryUrl();

if (!allowDirty) {
  const status = git(["status", "--short"]);
  if (status.stdout.trim()) {
    fail(["Working tree is dirty. Commit or stash changes before running remote Blaxel test shards.", "Use --allow-dirty only when intentionally testing the specified committed SHA.", "", status.stdout.trimEnd()].join("\n"));
  }
}

const commit = git(["rev-parse", "--verify", `${target}^{commit}`]).stdout.trim();
const fetchStarted = Date.now();
git(["fetch", "origin", "--prune"], { stdio: "inherit" });
coordinatorPhases.push({ name: "coordinator-fetch", category: "checkout", status: "passed", startedAt: new Date(fetchStarted).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - fetchStarted });
const containingRemotes = git(["branch", "-r", "--contains", commit]).stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("origin/"));
if (containingRemotes.length === 0) fail(`Commit ${commit} is not reachable from any origin/* branch. Push it first.`);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
if (suite !== "target") {
  const planStarted = Date.now();
  shardPlanPath = path.join(outputDir, "shard-plan.json");
  const planArgs = ["scripts/plan-test-shards.mjs", "--commit", commit, "--timing-provider", "blaxel-playwright-x64-4vcpu", "--shards", String(shardTotal), "--output", shardPlanPath];
  if (suite === "selection") planArgs.push("--surfaces", selectedSurfaceIds);
  else planArgs.push("--suite", suite);
  const planned = spawnSync(process.execPath, planArgs, { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  if (planned.status !== 0) fail(`shard planning failed: ${planned.stderr || planned.stdout}`);
  shardPlanRaw = fs.readFileSync(shardPlanPath, "utf8");
  shardPlan = JSON.parse(shardPlanRaw);
  coordinatorPhases.push({ name: "shard-plan", category: "plan", status: "passed", startedAt: new Date(planStarted).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - planStarted });
}
fs.writeFileSync(path.join(outputDir, "request.json"), `${JSON.stringify({ backend: "blaxel", runId, suite, selectedSurfaceIds, shardTotal, shardIndices, pool, arch, commit, repoUrl, playwrightBrowsersPath, timeoutProfile, timeouts, retryInfra, planId: shardPlan?.planId ?? null, target: targetOptions(), startedAt: new Date().toISOString() }, null, 2)}\n`);

await runInfrastructureAttempts({
  initialShardIndices: shardIndices,
  retryInfra,
  runAttempt: async ({ attempt, shardIndices: attemptShardIndices, excludedSandboxes }) => {
    const attemptDir = attempt === 0 ? outputDir : path.join(outputDir, `attempt-${attempt + 1}`);
    fs.mkdirSync(attemptDir, { recursive: true });
    if (shardPlanRaw) fs.writeFileSync(path.join(attemptDir, "shard-plan.json"), shardPlanRaw);
    return runAttempt({ attempt, shardIndices: attemptShardIndices, excludedSandboxes, outputDir: attemptDir });
  },
  onAttempt: (report) => {
    attempts.push(report);
    finalReport = report;
  },
  onRetry: ({ shardIndices: retryShards, completedAttempts }) => {
    console.log(`Retrying Blaxel infra-failed shard(s): ${retryShards.join(",")} (${completedAttempts}/${retryInfra})`);
  },
});

if (attempts.length > 0) {
  finalReport = combineAttemptReports(attempts, shardIndices, { shardTotal, outputDir });
  finalReport.phases = coordinatorPhases;
  finalReport.attempts = summarizeAttempts(attempts);
  writeProviderReports(outputDir, finalReport);
  printReport(finalReport);
}

await exitAfterShutdown(finalReport?.status === "passed" ? 0 : 1);

async function exitAfterShutdown(status) {
  if (shutdownPromise) await shutdownPromise;
  process.exit(status);
}

function summarizeAttempts(reports) {
  return summarizeInfrastructureAttempts(reports);
}

async function runStaleOwnerAudit() {
  const sandboxes = rotatePool(await listPoolSandboxes(), `${runId}:stale-owner-audit`, 1);
  if (sandboxes.length === 0) fail(`No deployed x64 Blaxel worker is available in pool ${pool}.`);
  const lease = await acquireAny(sandboxes, { shardIndex: 1, slot: 0, requestedWorkers: 1, verifyArchitecture: false });
  if (!lease) fail(`No available Blaxel worker in pool ${pool} for the read-only stale-owner audit.`);

  const { command, args } = buildLinuxStaleOwnerAuditInvocation();
  const processName = `tv-stale-owner-audit-${runId}`.replace(/[^a-zA-Z0-9-]/g, "-");
  lease.processName = processName;
  try {
    console.log(`acquired stale-owner audit lease: ${lease.sandbox.metadata.name}`);
    const setup = await runSystemDependencySetup(lease);
    lease.processName = processName;
    console.log(`read-only diagnostic command: ${[command, ...args].map(shellQuote).join(" ")}`);
    const proc = await lease.sandbox.process.exec({
      name: processName,
      command: [command, ...args].map(shellQuote).join(" "),
      waitForCompletion: true,
      timeout: 30,
    });
    const rawLogs = await lease.sandbox.process.logs(processName, "all").catch(() => proc.logs ?? "");
    const logs = chunkToText(rawLogs);
    if (proc.exitCode !== 0) throw new Error(`read-only stale-owner diagnostic exited ${proc.exitCode}: ${logs.trim()}`);
    const audit = parseLinuxStaleOwnerAuditOutput(logs);
    const staleOwnerCount = audit.owners.filter((entry) => entry.supervisorStatus === "stale").length;
    const liveOwnerCount = audit.owners.length - staleOwnerCount;
    const result = {
      audit: "blaxel-stale-owner",
      runId,
      pool,
      sandbox: lease.sandbox.metadata.name,
      setup,
      remoteCommand: [command, ...args],
      staleOwnerCount,
      liveOwnerCount,
      ...audit,
    };
    console.log(`${JSON.stringify(result, null, 2)}`);
    if (!audit.capabilities.procfs.readable || audit.processScan.status !== "ok") return 2;
    if (!audit.capabilities.ss.available || !audit.capabilities.ss.usable) return 2;
    if (staleOwnerCount > 0) return 3;
    if (liveOwnerCount > 0) return 4;
    return 0;
  } finally {
    await stopAndReleaseLease(lease, { killProcess: false });
    activeLeases.delete(lease.lockId);
  }
}

async function runSystemDependencySetup(lease) {
  const args = ["-lc", systemDependenciesCommand()];
  const processName = `tv-system-deps-${runId}`.replace(/[^a-zA-Z0-9-]/g, "-");
  lease.processName = processName;
  console.log(`system dependency setup: ${["bash", ...args].map(shellQuote).join(" ")}`);
  const proc = await lease.sandbox.process.exec({
    name: processName,
    command: ["bash", ...args].map(shellQuote).join(" "),
    waitForCompletion: true,
    timeout: timeouts.workerTimeoutSeconds,
  });
  const rawLogs = await lease.sandbox.process.logs(processName, "all").catch(() => proc.logs ?? "");
  const logs = chunkToText(rawLogs);
  if (logs.trim()) console.log(logs.trimEnd());
  if (proc.exitCode !== 0) throw new Error(`Blaxel system dependency setup exited ${proc.exitCode}: ${logs.trim()}`);
  return { name: "system-deps", command: ["bash", ...args], exitCode: proc.exitCode };
}

function validateStaleOwnerAuditOptions(parsed) {
  const allowed = new Set(["audit-stale-owners", "pool", "arch"]);
  const unexpected = Object.keys(parsed).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) fail(`--audit-stale-owners cannot be combined with: ${unexpected.map((key) => `--${key}`).join(", ")}`);
  if (parsed["audit-stale-owners"] !== "1") fail("--audit-stale-owners does not accept a value");
}

async function runAttempt({ attempt, shardIndices, excludedSandboxes = [], outputDir }) {
  const startedAt = Date.now();
  console.log(`Blaxel testshards attempt ${attempt + 1}: suite=${suite}${selectedSurfaceIds ? ` surfaces=${selectedSurfaceIds}` : ""} shards=${shardTotal} indices=${shardIndices.join(",")} pool=${pool}${excludedSandboxes.length > 0 ? ` excluded=${excludedSandboxes.join(",")}` : ""}`);
  let sandboxes = [];
  const acquired = [];
  const attemptState = {
    attempt,
    shardIndices: [...shardIndices],
    outputDir,
    startedAt: new Date(startedAt).toISOString(),
    completedResults: new Map(),
    partialResults: new Map(),
    leases: new Map(),
    executionRequested: new Set(),
    executionStarted: new Set(),
    shardStartedAt: new Map(),
  };
  activeAttempt = attemptState;
  try {
    let acquisitionOutcomes;
    try {
      sandboxes = rotatePool(excludeSandboxesByName(await listPoolSandboxes(), excludedSandboxes), `${runId}:${attempt}`, shardIndices.length);
      if (sandboxes.length < shardIndices.length) {
        const exclusionSuffix = excludedSandboxes.length > 0 ? ` after excluding contaminated sandbox(es): ${[...excludedSandboxes].sort().join(", ")}.` : ".";
        const error = new Error(`Not enough clean Blaxel workers in pool ${pool}: need ${shardIndices.length}, found ${sandboxes.length}${exclusionSuffix}`);
        acquisitionOutcomes = shardIndices.map((shardIndex, slot) => ({ shardIndex, slot, startedAt: Date.now(), lease: null, error }));
      } else {
        acquisitionOutcomes = await acquireShardLeases({
          shardIndices,
          maxConcurrency: MAX_PARALLEL_LEASE_ACQUISITIONS,
          acquire: async ({ shardIndex, slot }) => {
            attemptState.shardStartedAt.set(shardIndex, Date.now());
            const lease = await acquireAny(sandboxes, { shardIndex, slot, requestedWorkers: shardIndices.length });
            if (lease) attemptState.leases.set(shardIndex, lease);
            return lease;
          },
        });
      }
    } catch (error) {
      acquisitionOutcomes = shardIndices.map((shardIndex, slot) => ({ shardIndex, slot, startedAt: Date.now(), lease: null, error }));
    }
    for (const outcome of acquisitionOutcomes) {
      attemptState.shardStartedAt.set(outcome.shardIndex, outcome.startedAt);
      if (!outcome.lease) continue;
      outcome.lease.restorePhase = { name: "sandbox-restore-wake", status: "passed", startedAt: new Date(outcome.startedAt).toISOString() };
      attemptState.leases.set(outcome.shardIndex, outcome.lease);
      acquired.push(outcome.lease);
    }
    const acquisitionIncomplete = acquisitionOutcomes.some((outcome) => !outcome.lease);
    let results;
    if (acquisitionIncomplete) {
      const completedAt = new Date().toISOString();
      results = leaseAcquisitionFailureShards({ outcomes: acquisitionOutcomes, shardTotal, pool, plan: shardPlan, outputDir, completedAt });
      for (const result of results) attemptState.completedResults.set(result.shardIndex, result);
      console.error(`Lease acquisition incomplete; ${acquired.length}/${shardIndices.length} shard lease(s) acquired. No shard execution started for this attempt.`);
    } else {
      console.log(`acquired: ${formatShardLeases(acquired)}`);
      console.log(`starting: ${formatShardLeases(acquired)}`);
      results = await Promise.all(acquired.map(async (lease) => {
        const result = await runShard(lease, outputDir, {
          onExecutionRequested: () => attemptState.executionRequested.add(lease.shardIndex),
          onExecutionStarted: () => attemptState.executionStarted.add(lease.shardIndex),
          onResultProgress: (progress) => attemptState.partialResults.set(lease.shardIndex, progress),
        });
        attemptState.partialResults.delete(lease.shardIndex);
        attemptState.completedResults.set(lease.shardIndex, result);
        return result;
      }));
    }
    const status = results.every((result) => result.status === "passed") ? "passed" : "failed";
    const report = {
      backend: "blaxel",
      status,
      attempt: attempt + 1,
      runId,
      suite,
      target: targetOptions(),
      shardTotal,
      shardIndices,
      pool,
      arch,
      commit,
      timeoutProfile,
      excludedSandboxes,
      plan: shardPlan,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      shards: results.sort((a, b) => a.shardIndex - b.shardIndex),
    };
    writeProviderReports(outputDir, report);
    return report;
  } finally {
    await Promise.allSettled(acquired.map((lease) => stopAndReleaseLease(lease, {
      killProcess: lease.executionRequested === true && lease.executionCompletionConfirmed !== true,
    })));
    for (const lease of acquired) activeLeases.delete(lease.lockId);
    if (activeAttempt === attemptState) activeAttempt = null;
  }
}

function formatShardLeases(leases) {
  return leases
    .toSorted((a, b) => a.shardIndex - b.shardIndex)
    .map((lease) => `${lease.shardIndex}/${shardTotal}=${lease.sandbox.metadata.name}`)
    .join(" ");
}

function rotatePool(sandboxes, seed, requestedWorkers) {
  if (sandboxes.length < 2) return sandboxes;
  const groupSize = Math.max(1, Math.min(requestedWorkers, sandboxes.length));
  const groupCount = Math.max(1, Math.floor(sandboxes.length / groupSize));
  const start = (hashString(seed) % groupCount) * groupSize;
  return sandboxes.slice(start).concat(sandboxes.slice(0, start));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function acquireAny(sandboxes, { shardIndex, slot, requestedWorkers, verifyArchitecture = true }) {
  const lockId = `${runId}-shard-${shardIndex}`;
  const expiresAt = Math.floor(Date.now() / 1000) + timeouts.lockTtlSeconds;
  for (const sandbox of acquisitionOrder(sandboxes, { slot, requestedWorkers })) {
    if (sandbox.__leased) continue;
    const command = `bash -lc ${shellQuote(lockCommand({ lockId, shardIndex, expiresAt }))}`;
    const proc = await sandbox.process.exec({ name: `tv-lock-${lockId}`, command, waitForCompletion: true, timeout: 30 });
    if (proc.exitCode === 0) {
      let retainLock = false;
      try {
        if (verifyArchitecture && !(await verifySandboxArchitecture(sandbox))) {
          sandbox.__leased = true;
          continue;
        }
        sandbox.__leased = true;
        const lease = { sandbox, lockId, shardIndex, processName: null };
        activeLeases.set(lockId, lease);
        retainLock = true;
        return lease;
      } finally {
        if (!retainLock) await releaseLock(sandbox, lockId);
      }
    }
  }
  return null;
}

async function verifySandboxArchitecture(sandbox) {
  const check = [
    "set -euo pipefail",
    'export NVM_DIR="$HOME/.nvm"',
    '. "$NVM_DIR/nvm.sh"',
    "nvm use --silent default",
    "printf uname=; uname -m; printf node=; node -p process.arch",
  ].join("; ");
  const proc = await sandbox.process.exec({
    name: `tv-arch-check-${runId}`.replace(/[^a-zA-Z0-9-]/g, "-"),
    command: `bash -lc ${shellQuote(check)}`,
    waitForCompletion: true,
    timeout: 30,
  });
  const logs = proc.logs ?? "";
  if (proc.exitCode === 0 && logs.includes("uname=x86_64") && logs.includes("node=x64")) return true;
  console.error(`Skipping ${sandbox.metadata?.name}: expected a provisioned x64/linux sandbox, got:\n${logs}`);
  return false;
}

function acquisitionOrder(sandboxes, { slot, requestedWorkers }) {
  const groupSize = Math.max(1, Math.min(requestedWorkers, sandboxes.length));
  const ordered = [];
  const seen = new Set();
  const add = (index) => {
    if (index < 0 || index >= sandboxes.length || seen.has(index)) return;
    seen.add(index);
    ordered.push(sandboxes[index]);
  };

  for (let index = slot % groupSize; index < sandboxes.length; index += groupSize) add(index);
  for (let index = 0; index < sandboxes.length; index += 1) add(index);
  return ordered;
}

function lockCommand({ lockId, shardIndex, expiresAt }) {
  const owner = `${os.hostname()}:${process.pid}`;
  const freshJson = JSON.stringify({ lockId, runId, shard: `${shardIndex}/${shardTotal}`, owner, expiresAt });
  const reclaimedJson = JSON.stringify({ lockId, runId, shard: `${shardIndex}/${shardTotal}`, owner, expiresAt, reclaimed: true });
  return [
    "set -euo pipefail",
    "lock=/tmp/tv-testshard.lock",
    "now=$(date +%s)",
    `if mkdir "$lock" 2>/dev/null; then node -e ${shellQuote(`const fs=require("fs"); const data=${JSON.stringify(freshJson)}; const obj=JSON.parse(data); obj.acquiredAt=Number(process.env.now||${Date.now()}); fs.writeFileSync("/tmp/tv-testshard.lock/owner.json", JSON.stringify(obj));`)}; exit 0; fi`,
    "expires=0",
    "if [ -f \"$lock/owner.json\" ]; then expires=$(node -e 'try{console.log(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\")).expiresAt||0)}catch{console.log(0)}' \"$lock/owner.json\"); fi",
    `if [ "$expires" -gt 0 ] && [ "$expires" -lt "$now" ]; then rm -rf "$lock"; mkdir "$lock"; node -e ${shellQuote(`const fs=require("fs"); const data=${JSON.stringify(reclaimedJson)}; const obj=JSON.parse(data); obj.acquiredAt=Number(process.env.now||${Date.now()}); fs.writeFileSync("/tmp/tv-testshard.lock/owner.json", JSON.stringify(obj));`)}; exit 0; fi`,
    "exit 42",
  ].join("; ");
}

async function runShard(lease, outputDir, { onExecutionRequested = () => {}, onExecutionStarted = () => {}, onResultProgress = () => {} } = {}) {
  const { sandbox, shardIndex, lockId } = lease;
  const startedAt = Date.now();
  if (lease.restorePhase) {
    lease.restorePhase.completedAt = new Date(startedAt).toISOString();
    lease.restorePhase.durationMs = startedAt - Date.parse(lease.restorePhase.startedAt);
  }
  const overallStarted = lease.restorePhase ? Date.parse(lease.restorePhase.startedAt) : startedAt;
  const processName = `tv-testshard-${runId}-s${shardIndex}`.replace(/[^a-zA-Z0-9-]/g, "-");
  lease.processName = processName;
  const remoteScript = `/tmp/${processName}.sh`;
  const logPath = path.join(outputDir, `shard-${shardIndex}.log`);
  lease.logPath = logPath;
  const summaryPath = path.join(outputDir, `shard-${shardIndex}.json`);
  const planRemotePath = shardPlanRaw ? `/tmp/${processName}.plan.json` : null;
  const dispatch = await transferShardInputs({
    write: (remotePath, contents) => sandbox.fs.write(remotePath, contents),
    planRemotePath,
    planRaw: shardPlanRaw,
    remoteScript,
    remoteScriptContents: shardScript({ shardIndex, lockId, planRemotePath }),
  });
  if (!dispatch.ok) {
    appendLog(logPath, `\n[coordinator] ${dispatch.failureMessage}\n`);
    return dispatchFailureResult({ lease, outputDir, startedAt, logPath, dispatch });
  }
  const command = `bash ${remoteScript}`;
  let stream;
  let retainedResultProgress = null;
  let failureStep = "worker-execution";
  try {
    lease.executionRequested = true;
    onExecutionRequested();
    const proc = await sandbox.process.exec({
      name: processName,
      command,
      env: { GH_TOKEN: blaxelGithubToken },
      timeout: timeouts.workerTimeoutSeconds,
      keepAlive: true,
    });
    onExecutionStarted();
    stream = sandbox.process.streamLogs(processName, {
      onStdout: (chunk) => appendLog(logPath, chunk),
      onStderr: (chunk) => appendLog(logPath, chunk),
      onError: (error) => console.error(`Log stream failed for shard ${shardIndex}: ${error.message}`),
    });
    const completed = await sandbox.process.wait(processName, { maxWait: timeouts.workerTimeoutSeconds * 1000, interval: 5000 });
    lease.executionCompletionConfirmed = true;
    stream?.close?.();
    const logs = await sandbox.process.logs(processName, "all").catch(() => "");
    if (logs && !fs.existsSync(logPath)) fs.writeFileSync(logPath, logs);
    failureStep = "report-download";
    const reportStarted = Date.now();
    const exitCode = completed.exitCode ?? proc.exitCode ?? null;
    const plannedShard = shardPlan?.shards?.[shardIndex - 1];
    let shardSummary = null;
    let shardSummaryError = null;
    let nativeResultPath = null;
    let setupTimings = [lease.restorePhase].filter(Boolean);
    const tasks = [];
    const retainResultProgress = () => {
      retainedResultProgress = {
        shardIndex,
        shardTotal,
        shard: `${shardIndex}/${shardTotal}`,
        sandbox: sandbox.metadata.name,
        outputDir,
        status: "infra-failed",
        exitCode,
        startedAt: new Date(overallStarted).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - overallStarted,
        summaryPath: fs.existsSync(summaryPath) ? summaryPath : null,
        summaryError: shardSummaryError,
        nativeResultPath,
        logPath: fs.existsSync(logPath) ? logPath : null,
        setupTimings,
        planId: shardSummary?.planId ?? shardPlan?.planId,
        timingProvider: shardSummary?.timingProvider ?? shardPlan?.timingProvider,
        testedTree: shardSummary?.testedTree ?? shardPlan?.testedTree,
        testedCommit: shardSummary?.testedCommit ?? shardPlan?.testedCommit,
        predictedDurationMs: shardSummary?.predictedDurationMs ?? plannedShard?.predictedDurationMs,
        phases: shardSummary?.phases ?? [],
        assignedFiles: shardSummary?.assignedFiles ?? [],
        collectedFiles: shardSummary?.collectedFiles ?? [],
        processLeaks: shardSummary?.processLeaks ?? [],
        tasks: tasks.map((task) => ({ ...task, ...(Array.isArray(task.generatedInputPaths) ? { generatedInputPaths: [...task.generatedInputPaths] } : {}) })),
      };
      onResultProgress(retainedResultProgress);
    };
    try {
      const raw = await sandbox.fs.read(`/workspace/television/.testshards/results/shard-${shardIndex}.json`);
      fs.writeFileSync(summaryPath, raw.endsWith("\n") ? raw : `${raw}\n`);
      try {
        shardSummary = JSON.parse(raw);
        tasks.push(...(shardSummary.tasks ?? []).map(retainTaskWithoutRemoteArtifacts));
      } catch (error) {
        shardSummaryError = `Failed to parse shard summary: ${error.message}`;
        appendLog(logPath, `\n[coordinator] ${shardSummaryError}\n`);
      }
    } catch (error) {
      shardSummaryError = `Failed to read shard summary: ${error.message}`;
      appendLog(logPath, `\n[coordinator] ${shardSummaryError}\n`);
    }
    retainResultProgress();
    const remoteShardNativePath = `/workspace/television/.testshards/results/native-shard-${shardIndex}.json`;
    try {
      const nativeRaw = await sandbox.fs.read(remoteShardNativePath);
      const downloadedNativeResultPath = path.join(outputDir, `native-shard-${shardIndex}.json`);
      fs.writeFileSync(downloadedNativeResultPath, nativeRaw.endsWith("\n") ? nativeRaw : `${nativeRaw}\n`);
      nativeResultPath = downloadedNativeResultPath;
      for (const [taskIndex, task] of (shardSummary?.tasks ?? []).entries()) {
        if (task.nativeResultPath === remoteShardNativePath) tasks[taskIndex] = { ...tasks[taskIndex], nativeResultPath };
      }
    } catch {}
    retainResultProgress();
    const copiedArtifacts = new Map();
    for (const [taskIndex, task] of (shardSummary?.tasks ?? []).entries()) {
      const copiedTask = { ...tasks[taskIndex] };
      for (const field of ["nativeResultPath", "attemptResultPath", "workspaceNativeResultPath", "lifecycleResultPath", "processLeakResultPath"]) {
        if (!task[field]) continue;
        copiedTask[field] = await copyRemoteArtifact(sandbox, task[field], { outputDir, shardIndex, copiedArtifacts });
        tasks[taskIndex] = copiedTask;
        retainResultProgress();
      }
      if (Array.isArray(task.generatedInputPaths)) {
        copiedTask.generatedInputPaths = [];
        for (const remotePath of task.generatedInputPaths) {
          copiedTask.generatedInputPaths.push(await copyRemoteArtifact(sandbox, remotePath, { outputDir, shardIndex, copiedArtifacts }));
          tasks[taskIndex] = copiedTask;
          retainResultProgress();
        }
      }
      tasks[taskIndex] = copiedTask;
      retainResultProgress();
    }
    try {
      const setupRaw = await sandbox.fs.read(`/workspace/television/.testshards/results/setup-shard-${shardIndex}.json`);
      fs.writeFileSync(path.join(outputDir, `setup-shard-${shardIndex}.json`), setupRaw.endsWith("\n") ? setupRaw : `${setupRaw}\n`);
      setupTimings = [lease.restorePhase, ...JSON.parse(setupRaw)].filter(Boolean);
    } catch {
      setupTimings = [lease.restorePhase].filter(Boolean);
    }
    retainResultProgress();
    const identityError = shardPlan && shardSummary ? validateDownloadedShardSummary(shardSummary, shardPlan, shardIndex) : null;
    const resultError = downloadedResultError(shardSummary, exitCode, shardIndex);
    if (identityError || resultError) {
      shardSummaryError = identityError ?? resultError;
      appendLog(logPath, `\n[coordinator] ${shardSummaryError}\n`);
    }
    const hasSummaryFile = fs.existsSync(summaryPath);
    const status = classifyDownloadedShardStatus({ identityError, shardSummary, exitCode, hasSummaryFile, setupTimings });
    const completedAt = new Date().toISOString();
    const reportPhase = { name: "report-download", status: shardSummary ? "passed" : "failed", startedAt: new Date(reportStarted).toISOString(), completedAt, durationMs: Date.now() - reportStarted };
    const failedInfrastructureTask = tasks.find((task) => task.infraStatus === "incomplete");
    const missingSummaryFailure = !shardSummary ? {
      failureKind: "result-report",
      failureStep: hasSummaryFile ? "summary-parse" : "summary-read",
      failureMessage: shardSummaryError ?? `Shard ${shardIndex}/${shardTotal} produced no readable summary.`,
    } : null;
    return { shardIndex, shardTotal, shard: `${shardIndex}/${shardTotal}`, sandbox: sandbox.metadata.name, outputDir, status, exitCode, startedAt: new Date(overallStarted).toISOString(), completedAt, durationMs: Date.now() - overallStarted, summaryPath: fs.existsSync(summaryPath) ? summaryPath : null, summaryError: shardSummaryError, nativeResultPath, logPath, setupTimings, planId: shardSummary?.planId ?? shardPlan?.planId, timingProvider: shardSummary?.timingProvider ?? shardPlan?.timingProvider, testedTree: shardSummary?.testedTree ?? shardPlan?.testedTree, testedCommit: shardSummary?.testedCommit ?? shardPlan?.testedCommit, predictedDurationMs: shardSummary?.predictedDurationMs, phases: [...(shardSummary?.phases ?? []), reportPhase], assignedFiles: shardSummary?.assignedFiles ?? [], collectedFiles: shardSummary?.collectedFiles ?? [], failureKind: identityError ? "plan-validation" : resultError ? "result-report" : missingSummaryFailure?.failureKind ?? shardSummary?.failureKind ?? failedInfrastructureTask?.failureKind, failureStep: identityError ? "plan-validation" : resultError ? "summary-validation" : missingSummaryFailure?.failureStep ?? shardSummary?.failureStep ?? failedInfrastructureTask?.failureStep, failureMessage: identityError ?? resultError ?? missingSummaryFailure?.failureMessage ?? shardSummary?.failureMessage ?? failedInfrastructureTask?.failureMessage, processLeaks: shardSummary?.processLeaks ?? [], tasks };
  } catch (error) {
    stream?.close?.();
    appendLog(logPath, `\n[coordinator] ${error.stack || error.message}\n`);
    const completedAt = new Date().toISOString();
    const plannedShard = shardPlan?.shards?.[shardIndex - 1];
    const failure = classifyBlaxelCoordinatorFailure({ failureStep, message: error.message });
    return {
      ...retainedResultProgress,
      shardIndex,
      shardTotal,
      shard: `${shardIndex}/${shardTotal}`,
      sandbox: sandbox.metadata.name,
      outputDir,
      status: "infra-failed",
      error: error.message,
      ...failure,
      failureMessage: error.message,
      planId: retainedResultProgress?.planId ?? shardPlan?.planId,
      timingProvider: retainedResultProgress?.timingProvider ?? shardPlan?.timingProvider,
      testedCommit: retainedResultProgress?.testedCommit ?? shardPlan?.testedCommit,
      testedTree: retainedResultProgress?.testedTree ?? shardPlan?.testedTree,
      predictedDurationMs: retainedResultProgress?.predictedDurationMs ?? plannedShard?.predictedDurationMs,
      startedAt: retainedResultProgress?.startedAt ?? new Date(overallStarted).toISOString(),
      completedAt,
      durationMs: Date.now() - overallStarted,
      logPath,
      assignedFiles: retainedResultProgress?.assignedFiles ?? plannedShard?.surfaces?.flatMap((surface) => surface.files.map((file) => file.path)).sort() ?? [],
      collectedFiles: retainedResultProgress?.collectedFiles ?? [],
      tasks: retainedResultProgress?.tasks ?? [],
    };
  }
}

function dispatchFailureResult({ lease, outputDir, startedAt, logPath, dispatch }) {
  const { sandbox, shardIndex } = lease;
  const completedAt = new Date().toISOString();
  const overallStarted = lease.restorePhase ? Date.parse(lease.restorePhase.startedAt) : startedAt;
  const plannedShard = shardPlan?.shards?.[shardIndex - 1];
  const assignedFiles = plannedShard?.surfaces?.flatMap((surface) => surface.files.map((file) => file.path)).sort() ?? [];
  return {
    shardIndex,
    shardTotal,
    shard: `${shardIndex}/${shardTotal}`,
    sandbox: sandbox.metadata.name,
    outputDir,
    status: "infra-failed",
    exitCode: null,
    error: dispatch.failureMessage,
    startedAt: new Date(overallStarted).toISOString(),
    completedAt,
    durationMs: Date.now() - overallStarted,
    summaryPath: null,
    nativeResultPath: null,
    logPath,
    setupTimings: [lease.restorePhase].filter(Boolean),
    planId: shardPlan?.planId,
    timingProvider: shardPlan?.timingProvider,
    testedCommit: shardPlan?.testedCommit,
    testedTree: shardPlan?.testedTree,
    predictedDurationMs: plannedShard?.predictedDurationMs,
    assignedFiles,
    collectedFiles: [],
    leaseAcquired: true,
    executionStarted: false,
    failureKind: dispatch.failureKind,
    failureStep: dispatch.failureStep,
    failureMessage: dispatch.failureMessage,
    tasks: [],
  };
}

function retainTaskWithoutRemoteArtifacts(task) {
  const retained = { ...task };
  for (const field of ["nativeResultPath", "attemptResultPath", "workspaceNativeResultPath", "lifecycleResultPath", "processLeakResultPath"]) {
    if (retained[field]) retained[field] = null;
  }
  if (Array.isArray(retained.generatedInputPaths)) retained.generatedInputPaths = [];
  return retained;
}

async function copyRemoteArtifact(sandbox, remotePath, { outputDir, shardIndex, copiedArtifacts }) {
  const root = "/workspace/television/.testshards/results/";
  const normalized = path.posix.normalize(String(remotePath));
  if (!normalized.startsWith(root) || normalized === root.slice(0, -1)) throw new Error(`refusing worker artifact outside ${root}: ${remotePath}`);
  if (copiedArtifacts.has(normalized)) return copiedArtifacts.get(normalized);
  const relative = normalized.slice(root.length);
  const localPath = path.join(outputDir, "artifacts", `shard-${shardIndex}`, ...relative.split("/"));
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const raw = await sandbox.fs.read(normalized);
  fs.writeFileSync(localPath, raw);
  copiedArtifacts.set(normalized, localPath);
  return localPath;
}

function downloadedResultError(summary, exitCode, shardIndex) {
  if (!summary) return null;
  if (!["passed", "failed", "infra-failed"].includes(summary.status)) return `downloaded shard ${shardIndex} has invalid status ${JSON.stringify(summary.status)}`;
  if (summary.status === "passed" && exitCode !== 0) return `downloaded shard ${shardIndex} reports passed but the worker exited ${exitCode}`;
  return null;
}

function targetOptions() {
  if (suite !== "target") return null;
  return {
    surfaceId: options["target-surface-id"] ?? options["target-workspace"] ?? "target",
    workspace: options["target-workspace"] ?? null,
    runner: options["target-runner"] ?? null,
    config: options["target-config"] ?? null,
    cwd: options["target-cwd"] ?? ".",
    file: options["target-file"] ?? null,
    grep: options["target-grep"] ?? null,
    retries: options["target-retries"] ?? "5",
    command: parseTargetCommand(options["target-command-json"]),
    preCommand: parseTargetPreCommand(options["target-pre-command-json"]),
    services: parseTargetServices(options["target-services-json"]),
  };
}

function targetCommand() {
  const target = targetOptions();
  if (!target) return "";
  if (target.command) {
    if (target.runner !== "playwright") fail("--target-command-json currently supports Playwright surfaces only");
    const args = [
      "cd", shellQuote(target.cwd), "&&",
      'PLAYWRIGHT_JSON_OUTPUT_NAME="$TV_TARGET_NATIVE_RESULT"',
      ...target.command.map(shellQuote),
    ];
    if (target.file) args.push(shellQuote(target.file));
    if (target.grep) args.push("-g", shellQuote(target.grep));
    if (target.retries) args.push(`--retries=${target.retries}`);
    args.push("--reporter=json");
    return args.join(" ");
  }
  if (target.runner) {
    const args = ["cd", shellQuote(target.cwd), "&&"];
    if (target.runner === "vitest") {
      args.push("npx", "vitest", "run", "--config", shellQuote(target.config), "--reporter=json", '--outputFile "$TV_TARGET_NATIVE_RESULT"');
      if (target.file) args.push(shellQuote(target.file));
      if (target.grep) args.push("-t", shellQuote(target.grep));
      if (target.retries) args.push(`--retry=${target.retries}`);
    } else if (target.runner === "playwright") {
      args.push('PLAYWRIGHT_JSON_OUTPUT_NAME="$TV_TARGET_NATIVE_RESULT"', "npx", "playwright", "test", "--config", shellQuote(target.config), "--reporter=json");
      if (target.file) args.push(shellQuote(target.file));
      if (target.grep) args.push("-g", shellQuote(target.grep));
      if (target.retries) args.push(`--retries=${target.retries}`);
    } else {
      fail("--target-runner must be vitest or playwright");
    }
    return args.join(" ");
  }
  const args = [
    "npm",
    "--workspace",
    target.workspace,
    "run",
    "test:e2e",
    "--if-present",
    "--",
  ];
  if (target.file) args.push(target.file);
  if (target.grep) args.push("-g", target.grep);
  args.push(`--retries=${target.retries}`, "--reporter=list");
  return args.map(shellQuote).join(" ");
}

function parseTargetCommand(raw) {
  return parseTargetStringArray(raw, "--target-command-json");
}

function parseTargetPreCommand(raw) {
  return parseTargetStringArray(raw, "--target-pre-command-json");
}

function parseTargetStringArray(raw, option) {
  if (raw == null) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail(`${option} must be a JSON string array`); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((value) => typeof value !== "string" || value.length === 0)) {
    fail(`${option} must be a non-empty JSON string array`);
  }
  return parsed;
}

function parseTargetServices(raw) {
  if (raw == null) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail("--target-services-json must be a JSON array"); }
  if (!Array.isArray(parsed)) fail("--target-services-json must be a JSON array");
  return parsed;
}

function systemDependenciesCommand() {
  return 'if ! command -v python3 >/dev/null 2>&1 || ! command -v xauth >/dev/null 2>&1 || ! command -v ss >/dev/null 2>&1 || ! ldconfig -p 2>/dev/null | grep -q "libgtk-3.so.0" || ! ldconfig -p 2>/dev/null | grep -q "libXtst.so.6"; then apt-get update && apt-get install -y --no-install-recommends python3 xauth libgtk-3-0 libxtst6 iproute2; fi';
}

function shardScript({ shardIndex, lockId, planRemotePath }) {
  return `#!/usr/bin/env bash
set -euo pipefail
lock=/tmp/tv-testshard.lock
shard_plan=${shellQuote(planRemotePath ?? "")}
release_lock() {
  if [ -f "$lock/owner.json" ] && grep -q '"lockId":"${lockId}"' "$lock/owner.json"; then rm -rf "$lock"; fi
}
export CI=1
export SKIP_ACP_TESTS=1
export NVM_DIR="\${NVM_DIR:-$HOME/.nvm}"
export npm_config_cache=/cache/npm
export npm_config_audit=false
export npm_config_fund=false
export PLAYWRIGHT_BROWSERS_PATH=${playwrightBrowsersPath}
export TEST_RETRIES=${testRetries}
export TV_TEST_TIMING_PROVIDER=blaxel-playwright-x64-4vcpu
mkdir -p /workspace /cache/npm
if [ -z "\${GH_TOKEN:-}" ]; then echo "GH_TOKEN missing" >&2; exit 2; fi
setup_metrics=/tmp/tv-testshard-setup-${shardIndex}.jsonl
deps_cache_status=/tmp/tv-testshard-deps-cache-${shardIndex}.txt
owner_report=/tmp/tv-stale-owner-${shardIndex}.json
: > "$setup_metrics"
: > "$deps_cache_status"
export TV_TEST_DEPS_CACHE_STATUS_FILE="$deps_cache_status"
record_metric() {
  node - "$setup_metrics" "$1" "$2" "$3" "$4" <<'METRIC_NODE'
const fs = require('fs');
const [file, name, startRaw, endRaw, statusRaw] = process.argv.slice(2);
const startMs = Number(startRaw);
const endMs = Number(endRaw);
fs.appendFileSync(file, JSON.stringify({ name, status: Number(statusRaw), startedAt: new Date(startMs).toISOString(), completedAt: new Date(endMs).toISOString(), durationMs: endMs - startMs }) + "\\n");
METRIC_NODE
}
run_step() {
  local name="$1"
  shift
  local started
  local completed
  local status
  local restore_errexit=0
  case "$-" in *e*) restore_errexit=1 ;; esac
  started=$(date +%s%3N)
  set +e
  "$@"
  status=$?
  if [ "$restore_errexit" -eq 1 ]; then set -e; else set +e; fi
  completed=$(date +%s%3N)
  record_metric "$name" "$started" "$completed" "$status"
  return "$status"
}
activate_runtime() {
  . "$NVM_DIR/nvm.sh"
  nvm use --silent
}
runtime_versions() {
  node --version
  npm --version
}
write_setup_metrics() {
  mkdir -p /workspace/television/.testshards/results 2>/dev/null || true
  node - "$setup_metrics" "/workspace/television/.testshards/results/setup-shard-${shardIndex}.json" "/workspace/television/.testshards/results/shard-${shardIndex}.json" "$deps_cache_status" <<'METRICS_NODE'
const fs = require('fs');
const [input, setupOutput, shardOutput, depsCacheStatusFile] = process.argv.slice(2);
const depsCacheStatus = fs.existsSync(depsCacheStatusFile) ? fs.readFileSync(depsCacheStatusFile, 'utf8').trim() : '';
const rows = (fs.existsSync(input) ? fs.readFileSync(input, 'utf8').split(/\\n/).filter(Boolean).map((line) => JSON.parse(line)) : [])
  .map((row) => row.name === 'deps' && ['hit', 'miss'].includes(depsCacheStatus) ? { ...row, cacheStatus: depsCacheStatus } : row);
fs.writeFileSync(setupOutput, JSON.stringify(rows, null, 2) + "\\n");
if (!fs.existsSync(shardOutput)) {
  const failed = rows.find((row) => row.status && row.status !== 0);
  if (failed) {
    const summary = {
      status: 'infra-failed',
      failureKind: failed.name === 'checkout' ? 'checkout' : 'setup',
      failureStep: failed.name,
      failureMessage: failed.name === 'checkout' ? 'Repository checkout failed on the Blaxel worker. Check GitHub token validity and repository access from the sandbox.' : 'Setup step ' + failed.name + ' failed before tests ran.',
      suite: ${JSON.stringify(suite)},
      shardIndex: ${shardIndex},
      shardTotal: ${shardTotal},
      shard: '${shardIndex}/${shardTotal}',
      startedAt: rows[0]?.startedAt || new Date().toISOString(),
      completedAt: failed.completedAt || new Date().toISOString(),
      durationMs: rows.reduce((sum, row) => sum + (row.durationMs || 0), 0),
      setupTimings: rows,
      tasks: [],
    };
    fs.writeFileSync(shardOutput, JSON.stringify(summary, null, 2) + "\\n");
  }
}
METRICS_NODE
}
trap 'write_setup_metrics; rm -f "$owner_report" "$deps_cache_status"; if [ -n "$shard_plan" ]; then rm -f "$shard_plan"; fi; release_lock' EXIT
rm -rf /workspace/television/.testshards 2>/dev/null || true
cat > /tmp/tv-git-askpass.sh <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) echo x-access-token ;;
  *) echo "$GH_TOKEN" ;;
esac
ASKPASS
chmod 700 /tmp/tv-git-askpass.sh
export GIT_ASKPASS=/tmp/tv-git-askpass.sh
export GIT_TERMINAL_PROMPT=0
run_step checkout bash -lc ${shellQuote(blaxelCheckoutScript({ repoUrl, commit }))}
cd /workspace/television
run_step runtime-activation activate_runtime
run_step runtime-versions runtime_versions
run_step deps bash -c ${shellQuote(blaxelDependencyScript())}
run_step system-deps bash -lc ${shellQuote(systemDependenciesCommand())}
if run_step owner-lifecycle node scripts/test/stale-owner-reaper-cli.mjs --output "$owner_report"; then
  owner_status=0
else
  owner_status=$?
fi
if [ "$owner_status" -ne 0 ]; then
  mkdir -p /workspace/television/.testshards/results
  node - "$owner_report" "/workspace/television/.testshards/results/shard-${shardIndex}.json" "$shard_plan" <<'OWNER_SUMMARY_NODE'
const fs = require('fs');
const [reportPath, summaryPath, planPath] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const plan = planPath && fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : null;
const plannedShard = plan?.shards?.[${shardIndex - 1}] ?? null;
const assignedFiles = plannedShard?.surfaces?.flatMap((surface) => surface.files.map((file) => file.path)).sort() ?? [];
const now = new Date().toISOString();
const summary = {
  schemaVersion: 1,
  status: 'infra-failed',
  suite: ${JSON.stringify(suite)},
  shardIndex: ${shardIndex},
  shardTotal: ${shardTotal},
  shard: '${shardIndex}/${shardTotal}',
  planId: plan?.planId ?? null,
  timingProvider: plan?.timingProvider ?? process.env.TV_TEST_TIMING_PROVIDER ?? null,
  testedCommit: plan?.testedCommit ?? null,
  testedTree: plan?.testedTree ?? null,
  timingBaselineDigest: plan?.timingBaselineDigest ?? null,
  predictedDurationMs: plannedShard?.predictedDurationMs ?? null,
  failureKind: 'stale-owner',
  failureStep: 'owner-lifecycle',
  failureMessage: report.message,
  startedAt: now,
  completedAt: now,
  durationMs: 0,
  assignedFiles,
  collectedFiles: [],
  phases: [],
  processLeaks: report.processLeaks,
  tasks: [],
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\\n');
OWNER_SUMMARY_NODE
  write_setup_metrics
  exit "$owner_status"
fi
run_step playwright-cache bash -lc 'if [ -d "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1223" ] && [ ! -e "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1208" ]; then ln -s chromium_headless_shell-1223 "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1208"; fi; if [ -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-1223" ] && [ ! -e "$PLAYWRIGHT_BROWSERS_PATH/chromium-1208" ]; then ln -s chromium-1223 "$PLAYWRIGHT_BROWSERS_PATH/chromium-1208"; fi'
run_step electron-repair bash -c ${shellQuote(`electron_config_cache=/cache/electron node node_modules/electron/install.js`)}
set +e
if [ -n "$shard_plan" ]; then
  run_step test-run node scripts/run-test-shard.mjs --plan "$shard_plan" --shard ${shardIndex} --total ${shardTotal} --results-dir .testshards/results --test-retries ${testRetries}
elif [ ${shellQuote(suite)} = target ]; then
  mkdir -p .testshards/results
  export TV_TARGET_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  export TV_TARGET_SHARD_INDEX=${shardIndex}
  export TV_TARGET_SHARD_TOTAL=${shardTotal}
  export TV_TARGET_SURFACE_ID=${shellQuote(targetOptions()?.surfaceId ?? "target")}
  export TV_TARGET_RUN_ID=${shellQuote(`${runId}:${shardIndex}`)}
  export TV_TARGET_NAME=${shellQuote(`${targetOptions()?.workspace ?? "target"} ${targetOptions()?.file ?? ""} ${targetOptions()?.grep ?? ""}`)}
  export TV_TARGET_RUNNER=${shellQuote(targetOptions()?.runner ?? "target")}
  export TV_TARGET_COMMAND=${shellQuote(targetCommand())}
  export TV_TARGET_LIFECYCLE_RESULT="/workspace/television/.testshards/results/target-lifecycle-${shardIndex}.json"
  export TV_TARGET_NATIVE_RESULT="/workspace/television/.testshards/results/native-shard-${shardIndex}.json"
  run_step test-run node scripts/test/supervised-command.mjs --run-id "$TV_TARGET_RUN_ID" --surface "$TV_TARGET_SURFACE_ID" --result "$TV_TARGET_LIFECYCLE_RESULT" ${targetOptions()?.preCommand ? `--pre-command-json ${shellQuote(JSON.stringify(targetOptions().preCommand))}` : ""} ${targetOptions()?.services?.length ? `--services-json ${shellQuote(JSON.stringify(targetOptions().services))}` : ""} -- bash -c "$TV_TARGET_COMMAND"
else
  run_step test-run node scripts/run-test-shard.mjs --suite ${suite} ${selectedSurfaceIds ? `--surfaces ${shellQuote(selectedSurfaceIds)}` : ""} --shard ${shardIndex} --total ${shardTotal} --test-retries ${testRetries}
fi
test_status=$?
export TV_TARGET_STATUS="$test_status"
set -e
if [ ${shellQuote(suite)} = target ]; then
  mkdir -p .testshards/results
  node - <<'TARGET_SUMMARY'
const fs = require('fs');
const status = Number(process.env.TV_TARGET_STATUS || '1');
const shardIndex = Number(process.env.TV_TARGET_SHARD_INDEX || '1');
const shardTotal = Number(process.env.TV_TARGET_SHARD_TOTAL || '1');
const startedAt = process.env.TV_TARGET_STARTED_AT || new Date().toISOString();
const completedAt = new Date().toISOString();
const lifecycle = JSON.parse(fs.readFileSync(process.env.TV_TARGET_LIFECYCLE_RESULT, 'utf8'));
const processLeaks = lifecycle.processLeaks || [];
const task = {
  surfaceId: process.env.TV_TARGET_SURFACE_ID || 'target',
  suite: 'target',
  runner: process.env.TV_TARGET_RUNNER || 'target',
  name: process.env.TV_TARGET_NAME || 'target',
  command: 'bash',
  args: ['-lc', process.env.TV_TARGET_COMMAND || ''],
  shard: shardIndex + '/' + shardTotal,
  status: status === 0 && processLeaks.length === 0 ? 'passed' : 'failed',
  exitCode: status,
  startedAt,
  completedAt,
  durationMs: Date.now() - Date.parse(startedAt),
  nativeResultPath: fs.existsSync(process.env.TV_TARGET_NATIVE_RESULT) ? process.env.TV_TARGET_NATIVE_RESULT : null,
  lifecycleResultPath: process.env.TV_TARGET_LIFECYCLE_RESULT,
  processLeaks,
  failureKind: lifecycle.failureKind || null,
  failureStep: lifecycle.failureStep || null,
  failureMessage: lifecycle.failureMessage || null,
};
const summary = {
  status: task.status,
  suite: 'target',
  shardIndex,
  shardTotal,
  shard: shardIndex + '/' + shardTotal,
  startedAt,
  completedAt,
  durationMs: task.durationMs,
  selectedTaskCount: 1,
  assignedTaskCount: 1,
  shardingModel: 'Targeted Blaxel run.',
  tasks: [task],
};
fs.writeFileSync('.testshards/results/shard-' + shardIndex + '.json', JSON.stringify(summary, null, 2) + '\\n');
TARGET_SUMMARY
fi
write_setup_metrics
exit "$test_status"
`;
}

async function releaseLock(sandbox, lockId) {
  const command = `bash -lc ${shellQuote(`lock=/tmp/tv-testshard.lock; if [ -f "$lock/owner.json" ] && grep -q '\"lockId\":\"${lockId}\"' "$lock/owner.json"; then rm -rf "$lock"; fi`)}`;
  await sandbox.process.exec({ name: `tv-release-${lockId}`, command, waitForCompletion: true, timeout: 30 }).catch(() => {});
}

async function stopAndReleaseLease(lease, { killProcess }) {
  if (killProcess && lease.processName) {
    await lease.sandbox.process.kill(lease.processName).catch(() => {});
    try {
      await reapUnconfirmedShardOwners(lease);
    } catch (error) {
      if (lease.logPath) appendLog(lease.logPath, `\n[coordinator] Owner cleanup was not confirmed; retaining lease ${lease.lockId} until TTL: ${error.stack || error.message}\n`);
      throw error;
    }
  }
  await releaseLock(lease.sandbox, lease.lockId);
}

async function reapUnconfirmedShardOwners(lease) {
  const processName = `tv-owner-cleanup-${lease.lockId}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const reportPath = `/tmp/${processName}.json`;
  const script = [
    "set -eo pipefail",
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '. "$NVM_DIR/nvm.sh"',
    "nvm use --silent default",
    "set -u",
    "cd /workspace/television",
    "status=0",
    `node scripts/test/stale-owner-reaper-cli.mjs --output ${shellQuote(reportPath)} || status=$?`,
    `cat ${shellQuote(reportPath)}`,
    'exit "$status"',
  ].join("; ");
  const completed = await lease.sandbox.process.exec({
    name: processName,
    command: `bash -lc ${shellQuote(script)}`,
    waitForCompletion: true,
    timeout: 30,
  });
  const raw = await lease.sandbox.fs.read(reportPath);
  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unconfirmed shard owner cleanup returned invalid JSON: ${error.message}`);
  }
  const validExit = completed.exitCode === 0 || completed.exitCode === 1;
  const consistentExit = completed.exitCode === (report.staleDetected ? 1 : 0);
  const cleanupConfirmed = report.cleanupConfirmed === true &&
    Array.isArray(report.liveOwners) && report.liveOwners.length === 0 &&
    Array.isArray(report.remainingStaleOwners) && report.remainingStaleOwners.length === 0 &&
    Array.isArray(report.processLeaks);
  if (!validExit || !consistentExit || !cleanupConfirmed) {
    throw new Error(`Unconfirmed shard owner cleanup failed closed (exit=${completed.exitCode}, staleDetected=${report.staleDetected}, cleanupConfirmed=${report.cleanupConfirmed}, liveOwners=${report.liveOwners?.length ?? "invalid"}, remainingStaleOwners=${report.remainingStaleOwners?.length ?? "invalid"})`);
  }
  if (lease.logPath) appendLog(lease.logPath, `\n[coordinator] unconfirmed execution owner cleanup: ${JSON.stringify(report)}\n`);
  return report;
}

function buildInterruptedReportSnapshot(signal) {
  if (!activeAttempt) {
    if (attempts.length === 0) return null;
    const combined = combineAttemptReports(attempts, shardIndices, { shardTotal, outputDir });
    combined.status = "failed";
    combined.interruptedBy = signal;
    combined.phases = coordinatorPhases;
    combined.attempts = summarizeAttempts(attempts);
    return { attemptOutputDir: null, interruptedAttempt: null, combined };
  }
  for (const lease of activeLeases.values()) {
    if (activeAttempt.shardIndices.includes(lease.shardIndex)) activeAttempt.leases.set(lease.shardIndex, lease);
  }
  const attemptOutputDir = activeAttempt.outputDir;
  const interruptedAttempt = buildInterruptedAttemptReport({
    signal,
    attempt: activeAttempt.attempt,
    runId,
    suite,
    target: targetOptions(),
    shardTotal,
    shardIndices: activeAttempt.shardIndices,
    pool,
    arch,
    commit,
    timeoutProfile,
    plan: shardPlan,
    outputDir: attemptOutputDir,
    startedAt: activeAttempt.startedAt,
    completedResults: activeAttempt.completedResults,
    partialResults: activeAttempt.partialResults,
    leases: activeAttempt.leases,
    executionRequested: activeAttempt.executionRequested,
    executionStarted: activeAttempt.executionStarted,
    shardStartedAt: activeAttempt.shardStartedAt,
  });
  const interruptedAttempts = [...attempts, interruptedAttempt];
  const combined = combineAttemptReports(interruptedAttempts, shardIndices, { shardTotal, outputDir });
  combined.status = "failed";
  combined.interruptedBy = signal;
  combined.phases = coordinatorPhases;
  combined.attempts = summarizeAttempts(interruptedAttempts);
  return { attemptOutputDir, interruptedAttempt, combined };
}

function writeInterruptedReportSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.interruptedAttempt) writeProviderReports(snapshot.attemptOutputDir, snapshot.interruptedAttempt);
  writeProviderReports(outputDir, snapshot.combined);
}

function installSignalHandlers({ killProcesses }) {
  const handle = (signal) => {
    if (shuttingDown) {
      console.error(`Received ${signal} again; exiting immediately. Remote locks will expire by TTL if cleanup is interrupted.`);
      process.exit(130);
    }
    shuttingDown = true;
    const leases = [...activeLeases.values()];
    console.error(`Received ${signal}; preserving the interrupted attempt, then ${killProcesses ? "stopping remote processes and " : ""}releasing ${leases.length} Blaxel lease(s)...`);
    shutdownPromise = (async () => {
      let interruptedSnapshot = null;
      const { reportError, releaseError, finalizeError } = await finishInterruptedRun({
        preserveReport: () => {
          interruptedSnapshot = buildInterruptedReportSnapshot(signal);
          writeInterruptedReportSnapshot(interruptedSnapshot);
        },
        releaseLeases: async () => {
          await Promise.allSettled(leases.map((lease) => stopAndReleaseLease(lease, { killProcess: killProcesses })));
          for (const lease of leases) activeLeases.delete(lease.lockId);
        },
        finalizeReport: () => writeInterruptedReportSnapshot(interruptedSnapshot),
      });
      if (reportError) console.error(`Failed to preserve interrupted Blaxel report: ${reportError.stack || reportError.message || reportError}`);
      if (releaseError) console.error(`Blaxel shard cleanup failed: ${releaseError.stack || releaseError.message || releaseError}`);
      if (finalizeError) console.error(`Failed to finalize interrupted Blaxel report: ${finalizeError.stack || finalizeError.message || finalizeError}`);
      if (!releaseError) console.error("Blaxel shard cleanup complete.");
      process.exit(130);
    })();
  };
  process.once("SIGINT", handle);
  process.once("SIGTERM", handle);
}

function listPoolSandboxes() {
  return listBlaxelPoolSandboxes({ pool, arch, deployedOnly: true });
}

function resolveTimeouts(profile, overrides) {
  const profiles = {
    normal: { workerTimeoutSeconds: 240, lockTtlSeconds: 900 },
    cold: { workerTimeoutSeconds: 480, lockTtlSeconds: 1200 },
    repair: { workerTimeoutSeconds: 480, lockTtlSeconds: 1200 },
  };
  const selected = { ...profiles[profile] };
  if (overrides["worker-timeout-seconds"]) selected.workerTimeoutSeconds = Number.parseInt(overrides["worker-timeout-seconds"], 10);
  if (overrides["lock-ttl-seconds"]) selected.lockTtlSeconds = Number.parseInt(overrides["lock-ttl-seconds"], 10);
  return selected;
}

function appendLog(file, chunk) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = chunkToText(chunk);
  if (!text) return;
  fs.appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function chunkToText(chunk) {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  if (chunk && typeof chunk === "object") {
    if (typeof chunk.data === "string") return chunk.data;
    if (Buffer.isBuffer(chunk.data)) return chunk.data.toString("utf8");
    if (typeof chunk.stdout === "string") return chunk.stdout;
    if (typeof chunk.stderr === "string") return chunk.stderr;
  }
  return JSON.stringify(chunk);
}

function printReport(report) {
  console.log("\n--- blaxel testshards summary ---");
  console.log(`Status: ${report.status}; duration=${formatDuration(report.durationMs)}; pool=${report.pool}; commit=${report.commit}`);
  console.log(`Shards: ${report.shards.map(formatShardSummary).join(" | ")}`);
  for (const shard of report.shards) {
    for (const phase of shardPhaseMetrics(shard)) console.log(`Phase shard ${shard.shard} ${phase.category}/${phase.name}=${formatDuration(phase.durationMs)} status=${phase.status}${phase.cacheStatus ? ` cache=${phase.cacheStatus}` : ""}`);
  }
  console.log(`Logs: ${formatShardLogs(report.shards)}`);
  for (const failure of compactInfraFailures(report.shards)) {
    console.log(`Infra failure: ${failure.failureKind ?? "unknown"}${failure.failureStep ? `/${failure.failureStep}` : ""} on shard(s) ${failure.shards.join(",")}: ${failure.failureMessage ?? "see shard logs"}`);
  }
  for (const task of failedTasksFromShards(report.shards, { shardTotal: report.shardTotal })) {
    console.log(`Failed task: shard ${task.shard} [${task.suite}] ${task.name} in ${formatDuration(task.durationMs)} exit=${task.exitCode}`);
  }
  console.log("--- end blaxel testshards summary ---\n");
}

function formatShardSummary(shard) {
  return `${shard.shard}=${shard.status}@${shard.sandbox}/${formatDuration(shard.durationMs)}${shard.exitCode === undefined ? "" : `/exit${shard.exitCode}`}`;
}

function shardPhaseMetrics(shard) {
  const setup = (shard.setupTimings ?? []).map((phase) => ({ ...phase, name: `setup:${phase.name}`, status: normalizeSetupTimingStatus(phase.status) }));
  return [...setup, ...(shard.phases ?? [])].map(normalizeTimingPhase);
}

function compactInfraFailures(shards) {
  const groups = new Map();
  for (const shard of shards) {
    if (shard.status !== "infra-failed") continue;
    const key = JSON.stringify([shard.failureKind ?? null, shard.failureStep ?? null, shard.failureMessage ?? null]);
    const group = groups.get(key) ?? { failureKind: shard.failureKind, failureStep: shard.failureStep, failureMessage: shard.failureMessage, shards: [] };
    group.shards.push(shard.shardIndex);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function parseShardIndices(raw, total) {
  if (!raw) return Array.from({ length: total }, (_, index) => index + 1);
  const values = raw.trim().startsWith("[") ? JSON.parse(raw) : raw.split(",").map((part) => part.trim()).filter(Boolean);
  return [...new Set(values.map((value) => Number.parseInt(String(value), 10)))].sort((a, b) => a - b);
}

function parseNonNegativeInt(raw, name) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) fail(`${name} must be a non-negative integer`);
  return value;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "1";
    }
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, { encoding: "utf8", env: process.env, ...options });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function selectedRepositoryUrl() {
  try {
    return resolveBlaxelRepositoryUrl({ repoUrl: options["repo-url"] });
  } catch (error) {
    fail(error.message);
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
