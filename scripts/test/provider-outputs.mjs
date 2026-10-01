import fs from "node:fs";
import path from "node:path";
import { normalizeSetupTimingStatus, normalizeTimingPhase } from "./phase-metrics.mjs";

export function providerCommandExitCode({ delegatedExitCode, reportStatus }) {
  if (delegatedExitCode !== 0) return delegatedExitCode || 1;
  return reportStatus === "passed" ? 0 : 1;
}

export function writeProviderReports(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true });
  if (report.plan) fs.writeFileSync(path.join(outputDir, "shard-plan.json"), `${JSON.stringify(report.plan, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(compactProviderSummary(report, { outputDir }), null, 2)}\n`);
}

export function compactProviderSummary(report, { outputDir = null } = {}) {
  const shards = report.shards ?? [];
  const failedTasks = report.failedTasks ?? failedTasksFromShards(shards, { shardTotal: report.shardTotal });
  const infraFailedShards = report.infraFailedShards ?? shards.filter((shard) => shard.status === "infra-failed").map((shard) => shard.shardIndex);
  return pruneNullish({
    schemaVersion: 1,
    backend: report.backend,
    status: report.status,
    interruptedBy: report.interruptedBy,
    runId: report.runId,
    run: report.run ? pruneNullish({ id: report.run.id, url: report.run.url, status: report.run.status, conclusion: report.run.conclusion, headBranch: report.run.headBranch, headSha: report.run.headSha }) : undefined,
    suite: report.suite,
    target: report.target,
    shardTotal: report.shardTotal,
    shardIndices: report.shardIndices ?? report.requestedShardIndices,
    pool: report.pool,
    arch: report.arch,
    commit: report.commit,
    timeoutProfile: report.timeoutProfile,
    planId: report.plan?.planId ?? report.planId,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    durationMs: report.durationMs,
    phases: (report.phases ?? []).map(normalizeTimingPhase),
    timings: report.timings ? pruneNullish({ localTotalMs: report.timings.localTotalMs, remoteRunMs: report.timings.remoteRunMs, outputDownloadMs: report.timings.outputDownloadMs, stepTimings: report.timings.stepTimings }) : undefined,
    counts: {
      shards: shards.length,
      shardsPassed: shards.filter((shard) => shard.status === "passed").length,
      shardsFailed: shards.filter((shard) => shard.status === "failed").length,
      shardsInfraFailed: infraFailedShards.length,
      failedTasks: failedTasks.length,
    },
    shards: shards.map((shard) => pruneNullish({
      shardIndex: shard.shardIndex,
      shard: shard.shard,
      status: shard.status,
      sandbox: shard.sandbox,
      leaseAcquired: shard.leaseAcquired,
      executionStarted: shard.executionStarted,
      exitCode: shard.exitCode,
      durationMs: shard.durationMs,
      phases: providerShardPhases(shard),
      surfaces: (shard.tasks ?? []).map((task) => pruneNullish({ surfaceId: task.surfaceId, status: task.status, skipReason: task.skipReason, durationMs: task.durationMs, phases: (task.phases ?? []).map(normalizeTimingPhase) })),
      failureKind: shard.failureKind,
      failureStep: shard.failureStep,
      failureMessage: shard.failureMessage,
      logPath: shard.logPath,
      summaryPath: shard.summaryPath,
      outputDir: shard.outputDir,
    })),
    failedTasks,
    infraFailedShards,
    attempts: (report.attempts ?? []).map((attempt) => pruneNullish({
      attempt: attempt.attempt,
      run: attempt.run ? pruneNullish({ id: attempt.run.id, url: attempt.run.url, conclusion: attempt.run.conclusion }) : undefined,
      status: attempt.status,
      interruptedBy: attempt.interruptedBy,
      shardIndices: attempt.shardIndices,
      excludedSandboxes: attempt.excludedSandboxes,
      planId: attempt.planId ?? attempt.plan?.planId,
      infraFailedShards: attempt.infraFailedShards,
      failedTasks: attempt.failedTasks,
      shards: attempt.shards,
    })),
    outputs: { report: "report.json", ...(outputDir && fs.existsSync(path.join(outputDir, "request.json")) ? { request: "request.json" } : {}), ...(report.plan ? { plan: "shard-plan.json" } : {}) },
  });
}

function providerShardPhases(shard) {
  const setup = (shard.setupTimings ?? []).map((phase) => ({ ...phase, name: `setup:${phase.name}`, status: normalizeSetupTimingStatus(phase.status) }));
  return [...setup, ...(shard.phases ?? [])].map(normalizeTimingPhase);
}

function canonicalValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
}

function pruneNullish(value) {
  if (Array.isArray(value)) return value.map(pruneNullish);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null).map(([key, item]) => [key, pruneNullish(item)]));
}

export function infrastructureRetryShardIndices(report, { attempt, retryInfra }) {
  if (report.status === "passed" || attempt >= retryInfra) return [];
  return (report.shards ?? [])
    .filter((shard) => shard.status === "infra-failed")
    .filter((shard) => shard.failureKind !== "stale-owner" || sandboxName(shard) !== null)
    .map((shard) => shard.shardIndex);
}

export async function runInfrastructureAttempts({ initialShardIndices, retryInfra, runAttempt, onAttempt = () => {}, onRetry = () => {} }) {
  const reports = [];
  const excludedSandboxes = new Set();
  let pending = [...initialShardIndices];
  for (let attempt = 0; attempt <= retryInfra && pending.length > 0; attempt += 1) {
    const report = await runAttempt({ attempt, shardIndices: pending, excludedSandboxes: [...excludedSandboxes].sort() });
    reports.push(report);
    onAttempt(report);
    for (const shard of report.shards ?? []) {
      if (shard.status !== "infra-failed" || shard.failureKind !== "stale-owner") continue;
      const sandbox = sandboxName(shard);
      if (sandbox) excludedSandboxes.add(sandbox);
    }
    const retryableShards = infrastructureRetryShardIndices(report, { attempt, retryInfra });
    if (retryableShards.length === 0) break;
    pending = retryableShards;
    onRetry({ shardIndices: pending, completedAttempts: attempt + 1, retryInfra, excludedSandboxes: [...excludedSandboxes].sort() });
  }
  return reports;
}

export function summarizeInfrastructureAttempts(reports) {
  return reports.map((report, index) => pruneNullish({
    attempt: index + 1,
    status: report.status,
    interruptedBy: report.interruptedBy,
    shardIndices: report.shardIndices,
    excludedSandboxes: report.excludedSandboxes,
    planId: report.plan?.planId,
    infraFailedShards: (report.shards ?? []).filter((shard) => shard.status === "infra-failed").map((shard) => shard.shardIndex),
    shards: (report.shards ?? []).map((shard) => pruneNullish({
      shardIndex: shard.shardIndex,
      status: shard.status,
      sandbox: shard.sandbox,
      leaseAcquired: shard.leaseAcquired,
      executionStarted: shard.executionStarted,
      failureKind: shard.failureKind,
      failureStep: shard.failureStep,
      failureMessage: shard.failureMessage,
      processLeaks: shard.processLeaks,
      logPath: shard.logPath,
      summaryPath: shard.summaryPath,
      outputDir: shard.outputDir,
    })),
  }));
}

function sandboxName(shard) {
  return typeof shard.sandbox === "string" && shard.sandbox.length > 0 ? shard.sandbox : null;
}

export function combineAttemptReports(attempts, expectedShardIndices, { shardTotal, outputDir }) {
  const plannedAttempts = attempts.filter((attempt) => attempt.plan != null);
  if (plannedAttempts.length > 0) {
    if (plannedAttempts.length !== attempts.length) throw new Error("missing shard plan on infrastructure retry attempt");
    const expectedPlan = canonicalValue(plannedAttempts[0].plan);
    const expectedPlanId = plannedAttempts[0].plan?.planId;
    if (typeof expectedPlanId !== "string" || expectedPlanId.length === 0) throw new Error("missing shard plan ID on infrastructure retry attempt");
    for (const attempt of plannedAttempts.slice(1)) {
      if (attempt.plan?.planId !== expectedPlanId || canonicalValue(attempt.plan) !== expectedPlan) throw new Error(`changed shard plan across infrastructure retries: expected ${expectedPlanId}, received ${attempt.plan?.planId ?? "missing"}`);
    }
  }
  const latestByShard = new Map();
  for (const [attemptIndex, attempt] of attempts.entries()) {
    const attemptShards = attempt.shards ?? [];
    const returnedIndices = new Set(attemptShards.map((shard) => shard.shardIndex));
    for (const shardIndex of attempt.shardIndices ?? []) {
      if (returnedIndices.has(shardIndex)) continue;
      const missing = missingShardResult(shardIndex, shardTotal, {
        outputDir: attempt.outputDir ?? outputDir,
        message: `Infrastructure attempt ${attemptIndex + 1} returned no result for shard ${shardIndex}/${shardTotal}.`,
      });
      latestByShard.set(shardIndex, missing);
    }
    for (const shard of attemptShards) latestByShard.set(shard.shardIndex, shard);
  }
  for (const shardIndex of expectedShardIndices) {
    if (!latestByShard.has(shardIndex)) latestByShard.set(shardIndex, missingShardResult(shardIndex, shardTotal, {
      outputDir,
      message: `No infrastructure attempt returned a result for shard ${shardIndex}/${shardTotal}.`,
    }));
  }
  const shards = expectedShardIndices.map((shardIndex) => latestByShard.get(shardIndex)).sort((a, b) => a.shardIndex - b.shardIndex);
  const last = attempts.at(-1);
  const failedTasks = failedTasksFromShards(shards, { shardTotal, outputDir });
  const startedAt = attempts[0]?.startedAt ?? attempts[0]?.run?.createdAt ?? new Date().toISOString();
  const completedAt = last?.completedAt ?? last?.run?.updatedAt ?? new Date().toISOString();
  return {
    ...last,
    status: shards.every((shard) => shard.status === "passed") && failedTasks.length === 0 ? "passed" : "failed",
    shardIndices: [...expectedShardIndices],
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    shards,
    failedTasks,
    infraFailedShards: shards.filter((shard) => shard.status === "infra-failed").map((shard) => shard.shardIndex),
  };
}

export function formatShardLogs(shards) {
  const withLogs = shards.filter((shard) => shard.logPath);
  if (withLogs.length === 0) return "none";
  const dirs = [...new Set(withLogs.map((shard) => path.dirname(shard.logPath)))];
  const usesShardFilenames = withLogs.every((shard) => path.basename(shard.logPath) === `shard-${shard.shardIndex}.log`);
  if (withLogs.length === shards.length && dirs.length === 1 && usesShardFilenames) return `${dirs[0]}/shard-<n>.log`;
  return withLogs.map((shard) => `${shard.shard}=${shard.logPath}`).join(" | ");
}

export function failedTasksFromShards(shards, { shardTotal, outputDir = null } = {}) {
  return (shards ?? []).flatMap((shard) =>
    (shard.tasks ?? []).filter((task) => task.status === "failed").map((task) => ({
      shard: `${shard.shardIndex}/${shard.shardTotal ?? shardTotal ?? "?"}`,
      suite: task.suite,
      name: task.name,
      exitCode: task.exitCode,
      durationMs: task.durationMs,
      infraStatus: task.infraStatus,
      failureKind: task.failureKind,
      failureStep: task.failureStep,
      failureMessage: task.failureMessage,
      logPath: shard.logPath ?? (outputDir ? findShardLog(shard.outputDir ?? outputDir, shard) : null),
    })),
  );
}

function missingShardResult(shardIndex, shardTotal, { outputDir, message }) {
  return {
    shardIndex,
    shardTotal,
    shard: `${shardIndex}/${shardTotal}`,
    status: "infra-failed",
    durationMs: 0,
    outputDir,
    failureKind: "missing-result",
    failureStep: "attempt-aggregation",
    failureMessage: message,
    tasks: [],
  };
}

export function annotateShardOutputs(shard, outputDir) {
  const logPath = findShardLog(outputDir, shard);
  return {
    ...shard,
    outputDir: outputDir,
    logPath,
    tasks: (shard.tasks ?? []).map((task) => ({
      ...task,
      nativeResultPath: resolveDownloadedOutput(outputDir, task.nativeResultPath),
    })),
  };
}

export function resolveDownloadedOutput(outputDir, nativeResultPath) {
  if (!nativeResultPath) return null;
  if (fs.existsSync(nativeResultPath)) return nativeResultPath;
  return findFiles(outputDir, new RegExp(`^${escapeRegExp(path.basename(nativeResultPath))}$`))[0] ?? nativeResultPath;
}

export function readShardSummaries(outputDir) {
  const summaries = [];
  for (const file of findFiles(outputDir, /^shard-\d+\.json$/)) {
    try {
      summaries.push(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error) {
      console.error(`Failed to parse shard summary ${file}: ${error.message}`);
      const shardIndex = parseShardIndex(file);
      summaries.push({
        shardIndex,
        shardTotal: null,
        status: "infra-failed",
        durationMs: 0,
        parseError: error.message,
        summaryPath: file,
        failureKind: "result-report",
        failureStep: "summary-parse",
        failureMessage: `Failed to parse shard summary ${path.basename(file)}: ${error.message}`,
        tasks: [],
      });
    }
  }
  return summaries.sort((a, b) => a.shardIndex - b.shardIndex);
}

export function findShardLog(outputDir, shard) {
  return findFiles(outputDir, new RegExp(`^shard-${shard.shardIndex}\\.log$`))[0] ?? null;
}

export function findFiles(root, pattern) {
  const results = [];
  if (!fs.existsSync(root)) return results;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(fullPath, pattern));
    else if (pattern.test(entry.name)) results.push(fullPath);
  }
  return results;
}

function parseShardIndex(file) {
  const match = /shard-(\d+)\.json$/.exec(path.basename(file));
  return match ? Number.parseInt(match[1], 10) : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
