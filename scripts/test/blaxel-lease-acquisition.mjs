export function excludeSandboxesByName(sandboxes, excludedNames) {
  const excluded = new Set(excludedNames);
  return sandboxes.filter((sandbox) => !excluded.has(sandbox?.metadata?.name));
}

export function leaseAcquisitionFailureShards({ outcomes, shardTotal, pool, plan = null, outputDir = null, completedAt = new Date().toISOString() }) {
  const unavailable = outcomes.filter((outcome) => !outcome.lease);
  if (unavailable.length === 0) throw new Error("lease acquisition failure results require at least one unavailable shard");
  const blockerSummary = unavailable.map((outcome) => `shard ${outcome.shardIndex}: ${outcome.error ? errorMessage(outcome.error) : "no worker available"}`).join("; ");
  const completedMs = Date.parse(completedAt);

  return outcomes.map((outcome) => {
    const plannedShard = plan?.shards?.[outcome.shardIndex - 1];
    const assignedFiles = plannedShard?.surfaces?.flatMap((surface) => surface.files.map((file) => file.path)).sort() ?? [];
    const sandbox = outcome.lease?.sandbox?.metadata?.name ?? null;
    const acquiredButBlocked = Boolean(outcome.lease);
    const failureMessage = acquiredButBlocked
      ? `Acquired ${sandbox ?? "a worker"} for shard ${outcome.shardIndex}/${shardTotal}, but execution did not start because the attempt could not acquire every requested shard (${blockerSummary}).`
      : outcome.error
        ? `Could not acquire a worker for shard ${outcome.shardIndex}/${shardTotal}: ${errorMessage(outcome.error)}`
        : `No worker was available in pool ${pool} for shard ${outcome.shardIndex}/${shardTotal}.`;

    return {
      shardIndex: outcome.shardIndex,
      shardTotal,
      shard: `${outcome.shardIndex}/${shardTotal}`,
      sandbox,
      outputDir,
      status: "infra-failed",
      exitCode: null,
      startedAt: new Date(outcome.startedAt).toISOString(),
      completedAt,
      durationMs: Number.isFinite(completedMs) ? Math.max(0, completedMs - outcome.startedAt) : 0,
      summaryPath: null,
      nativeResultPath: null,
      logPath: null,
      planId: plan?.planId,
      timingProvider: plan?.timingProvider,
      testedTree: plan?.testedTree,
      testedCommit: plan?.testedCommit,
      predictedDurationMs: plannedShard?.predictedDurationMs,
      assignedFiles,
      collectedFiles: [],
      leaseAcquired: acquiredButBlocked,
      executionStarted: false,
      failureKind: "lease-acquisition",
      failureStep: acquiredButBlocked ? "execution-barrier" : "lease-acquisition",
      failureMessage,
      tasks: [],
    };
  });
}

export async function acquireShardLeases({ shardIndices, maxConcurrency, acquire }) {
  if (!Array.isArray(shardIndices)) throw new Error("shardIndices must be an array");
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error("maxConcurrency must be a positive integer");
  if (typeof acquire !== "function") throw new Error("acquire must be a function");
  if (shardIndices.length === 0) return [];

  const outcomes = new Array(shardIndices.length);
  let nextSlot = 0;
  const workerCount = Math.min(maxConcurrency, shardIndices.length);

  async function acquireNext() {
    while (nextSlot < shardIndices.length) {
      const slot = nextSlot;
      nextSlot += 1;
      const shardIndex = shardIndices[slot];
      const startedAt = Date.now();
      try {
        const lease = await acquire({ shardIndex, slot });
        outcomes[slot] = { shardIndex, slot, startedAt, lease: lease ?? null, error: null };
      } catch (error) {
        outcomes[slot] = { shardIndex, slot, startedAt, lease: null, error };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => acquireNext()));
  return outcomes;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
