import { normalizeSetupTimingStatus } from "./phase-metrics.mjs";

export function classifyDownloadedShardStatus({ identityError = null, ...evidence }) {
  return identityError ? "infra-failed" : classifyBlaxelShardStatus(evidence);
}

export function classifyBlaxelShardStatus({ shardSummary, exitCode, setupTimings = [] }) {
  if (exitCode !== 0 && setupFailedBeforeTestRun(setupTimings)) return "infra-failed";
  if (!shardSummary) return "infra-failed";
  if (shardSummary.status === "passed") {
    if (exitCode === 0) return "passed";
    return Number.isInteger(exitCode) ? "failed" : "infra-failed";
  }
  if (shardSummary.status === "failed") return "failed";
  return "infra-failed";
}

export function classifyBlaxelCoordinatorFailure({ failureStep, message }) {
  const failureKind = failureStep === "worker-execution" && /did not finish in time/i.test(message) ? "timeout" : "transport";
  return { failureKind, failureStep };
}

export function validateDownloadedShardSummary(summary, plan, shardIndex) {
  const expected = {
    planId: plan.planId,
    timingProvider: plan.timingProvider,
    testedCommit: plan.testedCommit,
    testedTree: plan.testedTree,
    shardIndex,
    shardTotal: plan.shardTotal,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (summary[field] !== value) return `downloaded shard ${shardIndex} ${field} mismatch: expected ${value}, received ${summary[field] ?? "missing"}`;
  }
  const expectedFiles = plan.shards[shardIndex - 1].surfaces.flatMap((surface) => surface.files.map((file) => file.path)).sort();
  const assignedFiles = [...(summary.assignedFiles ?? [])].sort();
  const collectedFiles = [...(summary.collectedFiles ?? [])].sort();
  if (JSON.stringify(assignedFiles) !== JSON.stringify(expectedFiles)) return `downloaded shard ${shardIndex} assigned files disagree with its plan`;
  if (summary.failureKind === "stale-owner" && collectedFiles.length === 0 && (summary.tasks ?? []).length === 0) return null;
  const taskAssignedFiles = (summary.tasks ?? []).flatMap((task) => task.assignedFiles ?? []).sort();
  const taskCollectedFiles = (summary.tasks ?? []).flatMap((task) => task.collectedFiles ?? []).sort();
  if (JSON.stringify(taskAssignedFiles) !== JSON.stringify(expectedFiles)) return `downloaded shard ${shardIndex} task assignments disagree with its plan`;
  if (JSON.stringify(collectedFiles) !== JSON.stringify(taskCollectedFiles)) return `downloaded shard ${shardIndex} collected-file summary disagrees with its tasks`;
  for (const task of summary.tasks ?? []) {
    if (!["passed", "failed", "skipped", "not-assigned"].includes(task.status)) return `downloaded shard ${shardIndex} task ${task.surfaceId ?? task.name ?? "unknown"} has invalid status ${JSON.stringify(task.status)}`;
    const taskAssigned = [...(task.assignedFiles ?? [])].sort();
    const taskCollected = [...(task.collectedFiles ?? [])].sort();
    if (task.status === "skipped") {
      if (task.skipReason !== "fail-fast" || taskCollected.length > 0) return `downloaded shard ${shardIndex} has an invalid skipped task ${task.surfaceId ?? task.name ?? "unknown"}`;
    } else if (task.status === "not-assigned") {
      if (taskAssigned.length > 0 || taskCollected.length > 0) return `downloaded shard ${shardIndex} has files on a not-assigned task ${task.surfaceId ?? task.name ?? "unknown"}`;
    } else if (task.infraStatus !== "incomplete" && JSON.stringify(taskAssigned) !== JSON.stringify(taskCollected)) {
      return `downloaded shard ${shardIndex} task ${task.surfaceId ?? task.name ?? "unknown"} did not collect its complete assignment`;
    }
  }
  if (summary.status === "passed" && (summary.tasks ?? []).some((task) => task.status === "skipped")) return `downloaded shard ${shardIndex} reports passed with a skipped assigned task`;
  return null;
}

function setupFailedBeforeTestRun(setupTimings) {
  for (const timing of setupTimings ?? []) {
    if (timing?.name === "test-run") return false;
    if (timing?.status != null && normalizeSetupTimingStatus(timing.status) === "failed") return true;
  }
  return false;
}
