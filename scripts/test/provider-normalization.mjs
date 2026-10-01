import fs from "node:fs";
import path from "node:path";
import { normalizeSetupTimingStatus } from "./phase-metrics.mjs";
import { normalizeSurfaceResult } from "./reporting.mjs";

export function normalizeProviderShardSurfaces({ provider, providerSummary, outputDir, surfaces, delegatedCommand, exitCode, coordinatorLogPath }) {
  const bySurface = new Map(surfaces.map((surface) => [surface.id, surface]));
  const normalizedParts = [];
  const providerFailures = [];
  for (const shard of providerSummary?.shards ?? []) {
    const taskExplainsFailure = (shard.tasks ?? []).some((task) => task.status === "failed" || task.infraStatus === "incomplete");
    const lifecycleExplainsFailure = (shard.processLeaks ?? []).length > 0;
    const contradictoryResult = shard.status === "failed" && shard.failureKind === "result-report";
    if (shard.status === "infra-failed" || contradictoryResult || (shard.status === "failed" && shard.failureKind && !taskExplainsFailure && !lifecycleExplainsFailure)) providerFailures.push(shard);
    let normalizedTask = false;
    for (const task of shard.tasks ?? []) {
      const surface = bySurface.get(task.surfaceId);
      if (!surface || task.status === "not-assigned") continue;
      normalizedParts.push(normalizeTaskPart({ task, surface, shard, outputDir, coordinatorLogPath }));
      normalizedTask = true;
    }
    for (const [surfaceId, processLeaks] of leaksByOwningSurface(shard.processLeaks ?? [])) {
      const surface = bySurface.get(surfaceId) ?? { id: surfaceId, runner: "lifecycle" };
      normalizedParts.push({
        ...normalizeSurfaceResult({
          surface: { ...surface, durationSource: "task-wall" },
          command: delegatedCommand,
          exitCode: 1,
          durationMs: shard.durationMs ?? 0,
          logPath: path.relative(process.cwd(), shard.logPath ?? coordinatorLogPath),
          nativeResultPath: null,
          processLeaks,
        }),
        counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
        failedTests: [],
        flakyRecoveredTests: [],
        files: [],
        infraStatus: "incomplete",
        failureKind: "stale-owner",
        failureStep: "startup-owner-cleanup",
        failureMessage: shard.failureMessage ?? `${processLeaks.length} stale owner process(es) blocked startup`,
      });
    }
    if (!normalizedTask && surfaces.length === 1 && shard.nativeResultPath && fs.existsSync(shard.nativeResultPath)) {
      normalizedParts.push(normalizeSurfaceResult({
        surface: surfaces[0],
        command: delegatedCommand,
        exitCode,
        durationMs: shard.durationMs ?? providerSummary.durationMs ?? 0,
        logPath: path.relative(process.cwd(), shard.logPath ?? coordinatorLogPath),
        nativeResultPath: path.relative(process.cwd(), shard.nativeResultPath),
      }));
    }
  }
  if (providerSummary?.interruptedBy && !providerFailures.some((failure) => failure.failureKind === "interrupted")) {
    providerFailures.push({
      status: "failed",
      durationMs: providerSummary.durationMs ?? 0,
      failureKind: "interrupted",
      failureStep: "coordinator-interruption",
      failureMessage: `The ${provider} coordinator received ${providerSummary.interruptedBy}.`,
    });
  }
  const normalized = normalizedParts.length ? mergeSurfaceParts(normalizedParts) : [];
  if (providerFailures.length) normalized.push(...providerFailureSurfaces({ provider, failures: providerFailures, delegatedCommand, coordinatorLogPath }));
  if (normalized.length) return normalized;
  const retainedTasks = (providerSummary?.shards ?? []).flatMap((shard) => shard.tasks ?? []);
  if (retainedTasks.length > 0 && retainedTasks.every((task) => task.status === "not-assigned") && providerSummary.shards.every((shard) => shard.status === "passed")) return [];

  return [{
    id: `provider:${provider}`,
    runner: provider,
    status: "failed",
    infraStatus: "incomplete",
    durationMs: providerSummary?.durationMs ?? 0,
    durationSource: "task-wall",
    command: delegatedCommand,
    counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
    failedTests: [],
    flakyRecoveredTests: [],
    processLeaks: [],
    files: [],
    failureKind: "result-report",
    failureStep: providerSummary ? "provider-evidence" : "summary-read",
    failureMessage: providerSummary
      ? `The ${provider} report contained no shard task or native result evidence.`
      : `The ${provider} coordinator produced no readable provider summary.`,
    logPath: retainedLogPath(coordinatorLogPath),
    nativeResultPath: providerSummary && fs.existsSync(path.join(outputDir, "summary.json")) ? path.relative(process.cwd(), path.join(outputDir, "summary.json")) : null,
  }];
}

export function normalizeBlaxelSurfaces(args) {
  return normalizeProviderShardSurfaces({ provider: "blaxel", ...args });
}

export function resolveProviderRunGit({ providerSummary, fallbackGit = {} }) {
  const plan = providerSummary?.plan;
  if (!plan) return fallbackGit;
  if (fallbackGit.commit && plan.testedCommit && fallbackGit.commit !== plan.testedCommit) {
    throw new Error(`provider plan commit ${plan.testedCommit} disagrees with preflight commit ${fallbackGit.commit}`);
  }
  return {
    ...fallbackGit,
    commit: plan.testedCommit ?? fallbackGit.commit ?? null,
    tree: plan.testedTree ?? fallbackGit.tree ?? null,
  };
}

export function normalizeProviderTimingShards({ providerSummary, outputDir, surfaces, coordinatorLogPath }) {
  const bySurface = new Map(surfaces.map((surface) => [surface.id, surface]));
  return (providerSummary?.shards ?? []).map((shard) => {
    const tasksBySurface = new Map((shard.tasks ?? []).map((task) => [task.surfaceId, task]));
    const normalizedSurfaces = [];
    for (const surface of surfaces) {
      const task = tasksBySurface.get(surface.id);
      if (!task) continue;
      if (task.status === "not-assigned") {
        normalizedSurfaces.push({
          id: surface.id, runner: surface.runner, status: "not-assigned", durationMs: 0, durationSource: "unknown", retryBudget: 0,
          phases: task.phases ?? [], processLeaks: [], files: [],
        });
        continue;
      }
      const normalized = normalizeTaskPart({ task, surface: bySurface.get(task.surfaceId), shard, outputDir, coordinatorLogPath });
      normalizedSurfaces.push({
        ...normalized,
        status: normalized.infraStatus === "incomplete" || normalized.processLeaks.length > 0 ? "incomplete" : normalized.status,
        retryBudget: retryBudget(task),
        phases: normalized.phases ?? [],
      });
    }
    const timingById = new Map(normalizedSurfaces.map((surface) => [surface.id, surface]));
    for (const [surfaceId, processLeaks] of leaksByOwningSurface(shard.processLeaks ?? [])) {
      const existing = timingById.get(surfaceId);
      if (existing) {
        existing.processLeaks = deduplicateLeaks([...(existing.processLeaks ?? []), ...processLeaks]);
        existing.status = "incomplete";
        continue;
      }
      const synthetic = {
        id: surfaceId,
        runner: bySurface.get(surfaceId)?.runner ?? "lifecycle",
        status: "incomplete",
        durationMs: 0,
        durationSource: "task-wall",
        retryBudget: 0,
        phases: [],
        processLeaks,
        files: [],
      };
      normalizedSurfaces.push(synthetic);
      timingById.set(surfaceId, synthetic);
    }
    return {
      index: shard.shardIndex,
      total: shard.shardTotal ?? providerSummary?.shardTotal,
      status: shard.status === "infra-failed" ? "incomplete" : shard.status,
      startedAt: shard.startedAt,
      completedAt: shard.completedAt,
      durationMs: shard.durationMs,
      predictedDurationMs: shard.predictedDurationMs,
      phases: [...setupPhases(shard.setupTimings), ...(shard.phases ?? [])],
      surfaces: normalizedSurfaces,
    };
  });
}

export function mergeSurfaceParts(parts) {
  const groups = new Map();
  for (const part of parts) {
    const group = groups.get(part.id) ?? [];
    group.push(part);
    groups.set(part.id, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const counts = group.reduce((acc, part) => ({
      testsTotal: acc.testsTotal + (part.counts?.testsTotal ?? 0),
      testsPassed: acc.testsPassed + (part.counts?.testsPassed ?? 0),
      testsFailed: acc.testsFailed + (part.counts?.testsFailed ?? 0),
      testsSkipped: acc.testsSkipped + (part.counts?.testsSkipped ?? 0),
      testsFlakyRecovered: acc.testsFlakyRecovered + (part.counts?.testsFlakyRecovered ?? 0),
    }), { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 });
    const failedTests = group.flatMap((part) => part.failedTests ?? []);
    const flakyRecoveredTests = group.flatMap((part) => part.flakyRecoveredTests ?? []);
    const processLeaks = deduplicateLeaks(group.flatMap((part) => part.processLeaks ?? []));
    const infrastructureFailures = group.filter((part) => part.infraStatus === "incomplete");
    const firstInfrastructureFailure = infrastructureFailures[0];
    const skippedPart = group.find((part) => part.status === "skipped");
    return {
      ...first,
      status: group.some((part) => part.status === "failed") ? "failed" : skippedPart ? "skipped" : "passed",
      infraStatus: infrastructureFailures.length ? "incomplete" : "completed",
      durationMs: group.reduce((sum, part) => sum + (part.durationMs ?? 0), 0),
      counts,
      failedTests,
      flakyRecoveredTests,
      processLeaks,
      files: group.flatMap((part) => part.files ?? []),
      durationSource: "task-wall",
      nativeResultPath: group.map((part) => part.nativeResultPath).filter(Boolean)[0] ?? null,
      nativeResultPaths: group.map((part) => part.nativeResultPath).filter(Boolean),
      failureKind: firstInfrastructureFailure?.failureKind ?? first.failureKind,
      failureStep: firstInfrastructureFailure?.failureStep ?? first.failureStep,
      failureMessage: firstInfrastructureFailure?.failureMessage ?? first.failureMessage,
      skipReason: skippedPart?.skipReason ?? first.skipReason,
      assignedFiles: group.flatMap((part) => part.assignedFiles ?? []),
      collectedFiles: group.flatMap((part) => part.collectedFiles ?? []),
      infraFailedShards: [...new Set(infrastructureFailures.flatMap((part) => part.infraFailedShards ?? []))].sort((a, b) => a - b),
    };
  });
}

function normalizeTaskPart({ task, surface, shard, outputDir, coordinatorLogPath }) {
  if (task.status === "skipped") return {
    id: surface.id,
    runner: surface.runner,
    status: "skipped",
    infraStatus: "completed",
    durationMs: task.durationMs ?? 0,
    durationSource: "task-wall",
    command: task.command ? [task.command, ...(task.args ?? [])] : [],
    counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
    failedTests: [],
    flakyRecoveredTests: [],
    processLeaks: task.processLeaks ?? [],
    files: [],
    skipReason: task.skipReason ?? null,
    assignedFiles: task.assignedFiles ?? [],
    collectedFiles: task.collectedFiles ?? [],
    logPath: path.relative(process.cwd(), shard.logPath ?? coordinatorLogPath),
    nativeResultPath: null,
    nativeResultPaths: [],
    phases: task.phases ?? [],
    retryBudget: retryBudget(task),
    infraFailedShards: [],
  };
  const resolvedNativePath = resolveNativeResultPath(outputDir, task.nativeResultPath);
  const resolvedAttemptPath = resolveNativeResultPath(outputDir, task.attemptResultPath);
  const nativeResultPath = resolvedNativePath ? path.relative(process.cwd(), resolvedNativePath) : null;
  const attemptResultPath = resolvedAttemptPath ? path.relative(process.cwd(), resolvedAttemptPath) : null;
  const normalized = normalizeSurfaceResult({
    surface: { ...surface, durationSource: "task-wall" },
    command: [task.command, ...(task.args ?? [])],
    exitCode: task.exitCode ?? (task.status === "passed" ? 0 : 1),
    durationMs: task.durationMs ?? 0,
    logPath: path.relative(process.cwd(), shard.logPath ?? coordinatorLogPath),
    nativeResultPath,
    attemptResultPath,
    processLeaks: task.processLeaks ?? [],
  });
  const infraStatus = task.infraStatus === "incomplete" || normalized.infraStatus === "incomplete" ? "incomplete" : "completed";
  return {
    ...normalized,
    infraStatus,
    phases: withFirstTestStart(task.phases ?? [], normalized.files),
    retryBudget: retryBudget(task),
    failureKind: task.failureKind ?? normalized.failureKind,
    failureStep: task.failureStep ?? normalized.failureStep,
    failureMessage: task.failureMessage ?? normalized.failureMessage,
    infraFailedShards: infraStatus === "incomplete" && shard.shardIndex ? [shard.shardIndex] : [],
  };
}

function withFirstTestStart(phases, files) {
  const result = [...phases];
  const runner = result.find((phase) => phase.name === "runner" && phase.startedAt);
  const firstTest = files.flatMap((file) => file.attempts ?? []).map((attempt) => attempt.startedAt).filter(Boolean).sort()[0];
  if (!runner || !firstTest || Date.parse(firstTest) < Date.parse(runner.startedAt)) return result;
  result.push({ name: "first-test-start", status: "passed", startedAt: runner.startedAt, completedAt: firstTest, durationMs: Date.parse(firstTest) - Date.parse(runner.startedAt) });
  return result;
}

function retryBudget(task) {
  if (Number.isSafeInteger(task.retryBudget) && task.retryBudget >= 0) return task.retryBudget;
  const argument = (task.args ?? []).find((value) => /^--(?:retry|retries)=\d+$/.test(value));
  return argument ? Number(argument.split("=").at(-1)) : 0;
}

function setupPhases(timings = []) {
  return timings.map((timing) => ({
    name: `setup:${timing.name}`,
    status: normalizeSetupTimingStatus(timing.status),
    startedAt: timing.startedAt,
    completedAt: timing.completedAt,
    durationMs: timing.durationMs,
    cacheStatus: timing.cacheStatus,
  }));
}

export function resolveNativeResultPath(outputDir, nativeResultPath) {
  if (!nativeResultPath) return null;
  if (fs.existsSync(nativeResultPath)) return nativeResultPath;
  const basename = path.basename(nativeResultPath);
  return findFile(outputDir, basename);
}

function retainedLogPath(...candidates) {
  const retained = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  return retained ? path.relative(process.cwd(), retained) : null;
}

function findFile(root, basename) {
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, basename);
      if (found) return found;
    } else if (entry.name === basename) {
      return fullPath;
    }
  }
  return null;
}

function leaksByOwningSurface(leaks) {
  const bySurface = new Map();
  for (const leak of deduplicateLeaks(leaks)) {
    for (const surfaceId of leak.owningSurfaceIds) {
      const owned = bySurface.get(surfaceId) ?? [];
      owned.push(leak);
      bySurface.set(surfaceId, owned);
    }
  }
  return [...bySurface.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function deduplicateLeaks(leaks) {
  const byId = new Map();
  for (const leak of leaks) {
    const previous = byId.get(leak.leakId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(leak)) throw new Error(`Conflicting process leak ${leak.leakId}`);
    byId.set(leak.leakId, leak);
  }
  return [...byId.values()].sort((left, right) => left.leakId.localeCompare(right.leakId));
}

function providerFailureSurfaces({ provider, failures, delegatedCommand, coordinatorLogPath }) {
  return failures.map((failure) => ({
    id: failures.length === 1 ? `provider:${provider}` : `provider:${provider}:shard-${failure.shardIndex ?? "unknown"}`,
    runner: provider,
    status: "failed",
    infraStatus: "incomplete",
    durationMs: failure.durationMs ?? 0,
    durationSource: "task-wall",
    command: delegatedCommand,
    counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
    failedTests: [],
    flakyRecoveredTests: [],
    processLeaks: [],
    files: [],
    failureKind: failure.failureKind ?? null,
    failureStep: failure.failureStep ?? null,
    failureMessage: failure.failureMessage ?? null,
    infraFailedShards: failure.status === "infra-failed" && failure.shardIndex ? [failure.shardIndex] : [],
    logPath: retainedLogPath(failure.logPath, coordinatorLogPath),
    nativeResultPath: null,
  }));
}
