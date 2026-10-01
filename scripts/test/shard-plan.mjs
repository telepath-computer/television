import crypto from "node:crypto";
import { canonicalize, validateTimingProvider } from "./timing-events.mjs";
import { BASELINE_TIMING_PROVIDER, validateTimingBaseline } from "./timing-baseline.mjs";

export function createShardPlan({ inventory, surfaces, baseline, baselineBytes, timingProvider, testedCommit, testedTree, shardTotal }) {
  validateTimingProvider(timingProvider);
  validateTimingBaseline(baseline);
  requirePositiveInteger(shardTotal, "shardTotal");
  requireObjectId(testedCommit, "testedCommit");
  requireObjectId(testedTree, "testedTree");
  const selectedSurfaceIds = surfaces.map((surface) => surface.id);
  if (new Set(selectedSurfaceIds).size !== selectedSurfaceIds.length) throw new Error("selected surfaces contain duplicate IDs");
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const knownBySurface = new Map(selectedSurfaceIds.map((id) => [id, []]));
  // Every plan weighs files by the baseline's Blaxel measurements, whatever
  // substrate executes it (specs/arch/test-runner/sharded-execution.md#Provider weights and unknown files).
  const knownBaselineWide = [];
  for (const entry of Object.values(baseline.files)) {
    const timing = entry.providers[BASELINE_TIMING_PROVIDER];
    knownBySurface.get(entry.surfaceId)?.push(timing.medianDurationMs);
    knownBaselineWide.push(timing.medianDurationMs);
  }
  for (const values of knownBySurface.values()) values.sort((left, right) => left - right);
  knownBaselineWide.sort((left, right) => left - right);

  const seen = new Set();
  const weighted = inventory.map((file) => {
    if (seen.has(file.path)) throw new Error(`inventory contains duplicate path: ${file.path}`);
    seen.add(file.path);
    const surface = surfaceById.get(file.surfaceId);
    if (!surface || surface.runner !== file.runner) throw new Error(`inventory owner is not selected or runner disagrees: ${file.path}`);
    const entry = baseline.files[file.path];
    const timing = entry?.surfaceId === file.surfaceId ? entry.providers[BASELINE_TIMING_PROVIDER] : null;
    if (timing) return { ...file, weightMs: Math.max(1, timing.medianDurationMs), weightSource: "baseline", baselineSampleCount: timing.sampleCount };
    const surfaceP90 = nearestRankP90(knownBySurface.get(file.surfaceId) ?? []);
    const p90 = surfaceP90 ?? nearestRankP90(knownBaselineWide);
    return {
      ...file,
      weightMs: p90 == null ? 60_000 : Math.max(30_000, Math.ceil(1.5 * p90)),
      weightSource: p90 == null ? "unknown-timing-provider" : "unknown-surface",
    };
  }).sort((left, right) => right.weightMs - left.weightMs || left.surfaceId.localeCompare(right.surfaceId) || left.path.localeCompare(right.path));

  const bins = Array.from({ length: shardTotal }, (_, index) => ({ index: index + 1, predictedDurationMs: 0, files: [] }));
  for (const file of weighted) {
    const bin = bins.reduce((best, candidate) => candidate.predictedDurationMs < best.predictedDurationMs || (candidate.predictedDurationMs === best.predictedDurationMs && candidate.index < best.index) ? candidate : best, bins[0]);
    bin.files.push(file);
    bin.predictedDurationMs += file.weightMs;
  }
  const body = {
    schemaVersion: 1,
    timingProvider,
    testedCommit,
    testedTree,
    shardTotal,
    selectedSurfaceIds,
    timingBaselinePath: "test/timing-baseline.json",
    timingBaselineDigest: sha256(baselineBytes),
    shards: bins.map((bin) => ({
      index: bin.index,
      total: shardTotal,
      predictedDurationMs: bin.predictedDurationMs,
      surfaces: surfaces.map((surface) => ({
        surfaceId: surface.id,
        runner: surface.runner,
        files: bin.files.filter((file) => file.surfaceId === surface.id).sort((left, right) => left.path.localeCompare(right.path)).map(({ path, weightMs, weightSource, baselineSampleCount }) => ({ path, weightMs, weightSource, ...(baselineSampleCount == null ? {} : { baselineSampleCount }) })),
      })),
    })),
  };
  const plan = { ...body, planId: sha256(Buffer.from(canonicalize(body))) };
  validateShardPlan(plan, { inventory });
  return plan;
}

export function validateShardPlan(plan, { inventory = null, timingProvider = null, testedCommit = null, testedTree = null, shardIndex = null, shardTotal = null } = {}) {
  if (plan?.schemaVersion !== 1) throw new Error("shard plan has unsupported schema");
  const { planId, ...body } = plan;
  const expected = sha256(Buffer.from(canonicalize(body)));
  if (planId !== expected) throw new Error(`shard plan digest mismatch: expected ${expected}, got ${planId}`);
  validateTimingProvider(plan.timingProvider);
  if (timingProvider && plan.timingProvider !== timingProvider) throw new Error("shard plan timing provider mismatch");
  if (testedCommit && plan.testedCommit !== testedCommit) throw new Error("shard plan tested commit mismatch");
  if (testedTree && plan.testedTree !== testedTree) throw new Error("shard plan tested tree mismatch");
  if (shardTotal && plan.shardTotal !== shardTotal) throw new Error("shard plan total mismatch");
  if (plan.shards.length !== plan.shardTotal) throw new Error("shard plan does not materialize every shard");
  const indices = plan.shards.map((shard) => shard.index);
  if (indices.some((index, position) => index !== position + 1)) throw new Error("shard plan indices must be contiguous and one-based");
  const paths = [];
  for (const shard of plan.shards) {
    if (shard.total !== plan.shardTotal) throw new Error(`shard ${shard.index} total mismatch`);
    if (shard.surfaces.map((surface) => surface.surfaceId).join("\0") !== plan.selectedSurfaceIds.join("\0")) throw new Error(`shard ${shard.index} surface order mismatch`);
    let predicted = 0;
    for (const surface of shard.surfaces) {
      const sorted = surface.files.map((file) => file.path).toSorted();
      if (surface.files.map((file) => file.path).join("\0") !== sorted.join("\0")) throw new Error(`shard ${shard.index}/${surface.surfaceId} file order mismatch`);
      for (const file of surface.files) {
        paths.push(file.path);
        predicted += file.weightMs;
      }
    }
    if (predicted !== shard.predictedDurationMs) throw new Error(`shard ${shard.index} predicted duration mismatch`);
  }
  if (new Set(paths).size !== paths.length) throw new Error("shard plan assigns a file more than once");
  if (paths.length === 0) throw new Error("shard plan assigns no test files");
  if (inventory) {
    const expectedPaths = inventory.map((file) => file.path).toSorted();
    if (paths.toSorted().join("\0") !== expectedPaths.join("\0")) throw new Error("shard plan does not assign every inventory file exactly once");
  }
  if (shardIndex != null && !plan.shards[shardIndex - 1]) throw new Error(`shard plan does not contain index ${shardIndex}`);
  return plan;
}

export function recommendShardCount({ inventory, surfaces, baseline, baselineBytes, timingProvider, testedCommit, testedTree, capacity, targetMs = 120_000, currentCount = null }) {
  requirePositiveInteger(capacity, "capacity");
  const simulations = [];
  for (let count = 1; count <= capacity; count += 1) {
    const plan = createShardPlan({ inventory, surfaces, baseline, baselineBytes, timingProvider, testedCommit, testedTree, shardTotal: count });
    simulations.push({ count, maximumPredictedDurationMs: Math.max(...plan.shards.map((shard) => shard.predictedDurationMs), 0), plan });
  }
  const selected = simulations.find((entry) => entry.maximumPredictedDurationMs <= targetMs) ?? simulations.at(-1);
  const weights = simulations[0]?.plan.shards[0].surfaces.flatMap((surface) => surface.files.map((file) => file.weightMs)) ?? [];
  const totalPredictedFileWorkMs = weights.reduce((sum, weight) => sum + weight, 0);
  const heaviestAtomicFileMs = Math.max(...weights, 0);
  const current = currentCount == null ? null : simulations.find((entry) => entry.count === currentCount);
  return {
    timingProvider,
    capacity,
    recommendedCount: selected.count,
    recommendedMaximumPredictedDurationMs: selected.maximumPredictedDurationMs,
    currentCount,
    currentMaximumPredictedDurationMs: current?.maximumPredictedDurationMs ?? null,
    totalPredictedFileWorkMs,
    heaviestAtomicFileMs,
    arithmeticLowerBoundMs: Math.max(heaviestAtomicFileMs, Math.ceil(totalPredictedFileWorkMs / selected.count)),
    atomicFileExceedsTarget: heaviestAtomicFileMs > targetMs,
  };
}

export function assignedFilesForShard(plan, shardIndex) {
  validateShardPlan(plan, { shardIndex });
  return plan.shards[shardIndex - 1].surfaces.flatMap((surface) => surface.files.map((file) => ({ ...file, surfaceId: surface.surfaceId, runner: surface.runner })));
}

export function nearestRankP90(values) {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => left - right)[Math.ceil(0.9 * values.length) - 1];
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function requireObjectId(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/.test(value)) throw new Error(`${name} must be a Git object ID`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
