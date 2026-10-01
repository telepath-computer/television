import fs from "node:fs";
import path from "node:path";

export function buildInterruptedAttemptReport({
  signal,
  attempt,
  runId,
  suite,
  target,
  shardTotal,
  shardIndices,
  pool,
  arch,
  commit,
  timeoutProfile,
  plan,
  outputDir,
  startedAt,
  completedAt = new Date().toISOString(),
  completedResults = new Map(),
  partialResults = new Map(),
  leases = new Map(),
  executionRequested = new Set(),
  executionStarted = new Set(),
  shardStartedAt = new Map(),
}) {
  const completedMs = Date.parse(completedAt);
  const shards = shardIndices.map((shardIndex) => {
    const completed = completedResults.get(shardIndex);
    if (completed) return completed;
    const partial = partialResults.get(shardIndex) ?? null;
    const lease = leases.get(shardIndex) ?? null;
    const requested = executionRequested.has(shardIndex);
    const started = executionStarted.has(shardIndex);
    const startedMs = shardStartedAt.get(shardIndex) ?? Date.parse(startedAt);
    const plannedShard = plan?.shards?.[shardIndex - 1];
    const assignedFiles = plannedShard?.surfaces?.flatMap((surface) => surface.files.map((file) => file.path)).sort() ?? [];
    const sandbox = lease?.sandbox?.metadata?.name ?? null;
    const retainedLogPath = path.join(outputDir, `shard-${shardIndex}.log`);
    const resultStartedMs = Number.isFinite(Date.parse(partial?.startedAt)) ? Date.parse(partial.startedAt) : startedMs;
    const state = partial
      ? `worker execution had started${sandbox ? ` on ${sandbox}` : ""}, and an incomplete shard result had been retained`
      : started
        ? `worker execution had started${sandbox ? ` on ${sandbox}` : ""}, but no shard result had been retained`
        : requested
          ? `worker execution had been requested${sandbox ? ` on ${sandbox}` : ""}, but its start had not been confirmed`
          : lease
            ? `the lease on ${sandbox ?? "a worker"} had been acquired, but worker execution had not been requested`
            : "lease acquisition had not completed and worker execution had not been requested";
    return {
      ...partial,
      shardIndex,
      shardTotal,
      shard: `${shardIndex}/${shardTotal}`,
      sandbox: partial?.sandbox ?? sandbox,
      outputDir,
      status: "infra-failed",
      exitCode: partial?.exitCode ?? null,
      startedAt: partial?.startedAt ?? new Date(startedMs).toISOString(),
      completedAt,
      durationMs: Number.isFinite(completedMs) ? Math.max(0, completedMs - resultStartedMs) : 0,
      summaryPath: partial?.summaryPath ?? null,
      nativeResultPath: partial?.nativeResultPath ?? null,
      logPath: partial?.logPath ?? (fs.existsSync(retainedLogPath) ? retainedLogPath : null),
      planId: partial?.planId ?? plan?.planId,
      timingProvider: partial?.timingProvider ?? plan?.timingProvider,
      testedCommit: partial?.testedCommit ?? plan?.testedCommit,
      testedTree: partial?.testedTree ?? plan?.testedTree,
      predictedDurationMs: partial?.predictedDurationMs ?? plannedShard?.predictedDurationMs,
      assignedFiles: partial?.assignedFiles ?? assignedFiles,
      collectedFiles: partial?.collectedFiles ?? [],
      leaseAcquired: Boolean(lease),
      executionStarted: started ? true : requested ? undefined : false,
      failureKind: "interrupted",
      failureStep: "coordinator-interruption",
      failureMessage: `Received ${signal} while shard ${shardIndex}/${shardTotal} was active: ${state}.`,
      tasks: partial?.tasks ?? [],
    };
  });

  return {
    backend: "blaxel",
    status: "failed",
    interruptedBy: signal,
    attempt: attempt + 1,
    runId,
    suite,
    target,
    shardTotal,
    shardIndices,
    pool,
    arch,
    commit,
    timeoutProfile,
    plan,
    outputDir,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    shards: shards.sort((left, right) => left.shardIndex - right.shardIndex),
  };
}

export async function finishInterruptedRun({ preserveReport, releaseLeases, finalizeReport = () => {} }) {
  let reportError = null;
  let releaseError = null;
  let finalizeError = null;
  try {
    await preserveReport();
  } catch (error) {
    reportError = error;
  }
  try {
    await releaseLeases();
  } catch (error) {
    releaseError = error;
  }
  try {
    await finalizeReport();
  } catch (error) {
    finalizeError = error;
  }
  return { reportError, releaseError, finalizeError };
}
