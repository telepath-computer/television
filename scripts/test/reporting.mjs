import fs from "node:fs";
import path from "node:path";
import { normalizeProcessLeak } from "./timing-events.mjs";

export function safeSurfaceName(id) {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function buildReports({ runId, provider = null, commandProvider = provider, timingProvider = defaultTimingProvider(provider), runDir, selection, git = null, preflights = [], surfaces, startedAt, completedAt }) {
  surfaces = attachProcessLeakFailures(surfaces);
  const processLeaks = deduplicateProcessLeaks(surfaces.flatMap((surface) => surface.processLeaks ?? []));
  const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
  const preflightFailed = preflights.some((preflight) => preflight.status !== "passed");
  const infraStatus = preflightFailed || surfaces.some((s) => s.infraStatus === "incomplete") ? "incomplete" : "completed";
  const failedSurfaces = surfaces.filter((surface) => surface.status === "failed" || surface.infraStatus === "incomplete");
  const selectedSurfaceIds = Array.isArray(selection.surfaces) ? new Set(selection.surfaces) : null;
  const selectedSurfaceResults = surfaces.filter((surface) => selectedSurfaceIds ? selectedSurfaceIds.has(surface.id) : !surface.id.startsWith("provider:"));
  const partiallyExecutedSkippedSurfaces = selectedSurfaceResults.filter((surface) => surface.status === "skipped" && hasExecutionEvidence(surface));
  const skippedSurfaces = selectedSurfaceResults.filter((surface) => surface.status === "skipped" && !hasExecutionEvidence(surface));
  const surfacesRun = selectedSurfaceResults.filter((surface) => surface.status !== "skipped" && !failedBeforeSurfaceStart(surface)).length + partiallyExecutedSkippedSurfaces.length;
  const failedTests = surfaces.flatMap((surface) => surface.failedTests.map((test) => ({ surfaceId: surface.id, ...compactTest(test, surface.logPath) })));
  const flakyRecoveredTests = surfaces.flatMap((surface) => surface.flakyRecoveredTests.map((test) => ({ surfaceId: surface.id, ...compactTest(test, surface.logPath) })));
  const testStatus = infraStatus === "incomplete" ? "unknown" : failedSurfaces.length ? "failed" : "passed";
  const status = infraStatus === "incomplete" ? "incomplete" : testStatus;
  const summary = {
    schemaVersion: 1,
    run: { id: runId, commandProvider, timingProvider, status, infraStatus, testStatus, startedAt, completedAt, durationMs },
    selection,
    git,
    preflights,
    counts: {
      surfacesSelected: selection.surfaces?.length ?? surfaces.length,
      surfacesRun,
      surfaces: surfaces.length,
      surfacesPassed: surfaces.filter((surface) => surface.status === "passed").length,
      surfacesFailed: failedSurfaces.length,
      surfacesSkipped: skippedSurfaces.length,
      testsFailed: failedTests.length,
      testsFlakyRecovered: flakyRecoveredTests.length,
      processLeaks: processLeaks.length,
      infraFailures: surfaces.filter((surface) => surface.infraStatus === "incomplete").length + (preflightFailed ? 1 : 0),
    },
    failedSurfaces: failedSurfaces.map((surface) => compactSurfaceFailure(surface)),
    skippedSurfaces: skippedSurfaces.map((surface) => ({ id: surface.id, runner: surface.runner, durationMs: surface.durationMs, reason: surface.skipReason ?? null, logPath: surface.logPath, resultPath: "results.json" })),
    failedTests,
    flakyRecoveredTests,
    processLeaks,
    outputs: { results: "results.json", events: "events.ndjson", logsDir: "logs/", nativeDir: "native/", providerDir: "provider/" },
  };
  const results = {
    schemaVersion: 1,
    run: summary.run,
    selection,
    git,
    preflights,
    counts: {
      surfacesSelected: selection.surfaces?.length ?? surfaces.length,
      surfacesRun,
      surfacesSkipped: skippedSurfaces.length,
    },
    surfaces: surfaces.map((surface) => ({
      id: surface.id,
      runner: surface.runner,
      status: surface.status,
      infraStatus: surface.infraStatus ?? "completed",
      durationMs: surface.durationMs,
      command: surface.command,
      counts: surface.counts,
      failedTests: surface.failedTests,
      flakyRecoveredTests: surface.flakyRecoveredTests,
      processLeaks: surface.processLeaks ?? [],
      files: surface.files ?? [],
      durationSource: surface.durationSource ?? "unknown",
      retryBudget: surface.retryBudget ?? 0,
      phases: surface.phases ?? [],
      skipReason: surface.skipReason ?? null,
      assignedFiles: surface.assignedFiles ?? [],
      collectedFiles: surface.collectedFiles ?? [],
      logPath: surface.logPath,
      nativeResultPath: Array.isArray(surface.nativeResultPath) ? (surface.nativeResultPath[0] ?? null) : surface.nativeResultPath,
      nativeResultPaths: surface.nativeResultPaths ?? (Array.isArray(surface.nativeResultPath) ? surface.nativeResultPath : [surface.nativeResultPath].filter(Boolean)),
      failureKind: surface.failureKind ?? null,
      failureStep: surface.failureStep ?? null,
      failureMessage: surface.failureMessage ?? null,
      infraFailedShards: surface.infraFailedShards ?? [],
    })),
    infraFailures: [
      ...preflights.filter((preflight) => preflight.status !== "passed").map((preflight) => ({ preflight: preflight.name, message: preflight.message ?? null })),
      ...surfaces.filter((surface) => surface.infraStatus === "incomplete").map((surface) => compactInfraFailure(surface)),
    ],
  };
  writeAtomic(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeAtomic(path.join(runDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  return { summary, results };
}

function failedBeforeSurfaceStart(surface) {
  return surface.failureKind === "stale-owner" && surface.failureStep === "startup-owner-cleanup";
}

function hasExecutionEvidence(surface) {
  return (surface.collectedFiles?.length ?? 0) > 0
    || (surface.files?.length ?? 0) > 0
    || (surface.counts?.testsTotal ?? 0) > 0
    || (surface.counts?.testsPassed ?? 0) > 0
    || (surface.counts?.testsFailed ?? 0) > 0;
}

function compactSurfaceFailure(surface) {
  return compactObject({
    id: surface.id,
    runner: surface.runner,
    durationMs: surface.durationMs,
    failureKind: surface.failureKind,
    failureStep: surface.failureStep,
    failureMessage: surface.failureMessage,
    infraFailedShards: surface.infraFailedShards,
    logPath: surface.logPath,
    resultPath: "results.json",
  });
}

function compactInfraFailure(surface) {
  return compactObject({
    surfaceId: surface.id,
    failureKind: surface.failureKind,
    failureStep: surface.failureStep,
    failureMessage: surface.failureMessage,
    infraFailedShards: surface.infraFailedShards,
    logPath: surface.logPath,
  });
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

export function normalizeSurfaceResult({ surface, command, exitCode, durationMs, logPath, nativeResultPath, attemptResultPath = null, processLeaks = [] }) {
  const nativeReport = readJsonResult(nativeResultPath);
  const native = nativeReport.value;
  const base = {
    id: surface.id,
    runner: surface.runner,
    command,
    exitCode,
    durationMs,
    durationSource: surface.durationSource ?? "surface-wall",
    logPath,
    nativeResultPath,
    attemptResultPath,
    infraStatus: "completed",
    processLeaks: deduplicateProcessLeaks(processLeaks),
  };
  if (!native) {
    return {
      ...base,
      status: "failed",
      infraStatus: "incomplete",
      counts: emptyCounts(),
      failedTests: [],
      flakyRecoveredTests: [],
      files: [],
      failureKind: "result-report",
      failureStep: nativeReport.failureStep,
      failureMessage: `${nativeReport.failureMessage}; runner exit=${exitCode ?? "unknown"}`,
    };
  }
  if (surface.runner === "playwright") return { ...base, ...normalizePlaywright(native, exitCode, surface) };
  if (surface.runner === "vitest") return { ...base, ...normalizeVitest(native, exitCode, surface, readNdjson(attemptResultPath)) };
  return { ...base, status: exitCode === 0 ? "passed" : "failed", counts: emptyCounts(), failedTests: [], flakyRecoveredTests: [], files: [] };
}

function normalizePlaywright(native, exitCode, surface) {
  const tests = [];
  collectPlaywrightSpecs(native.suites ?? [], tests, [], surface);
  const failed = tests.filter((test) => ["failed", "timedOut", "interrupted", "unexpected"].includes(test.status));
  const flaky = tests.filter((test) => test.status === "flaky");
  return {
    status: exitCode === 0 ? "passed" : "failed",
    counts: {
      testsTotal: tests.length,
      testsPassed: tests.filter((test) => ["passed", "expected", "flaky"].includes(test.status)).length,
      testsFailed: failed.length,
      testsSkipped: tests.filter((test) => test.status === "skipped").length,
      testsFlakyRecovered: flaky.length,
    },
    failedTests: failed,
    flakyRecoveredTests: flaky,
    files: groupFileObservations(tests.flatMap((test) => test.attemptRecords), { runner: "playwright" }),
  };
}

function collectPlaywrightSpecs(suites, out, parents = [], surface) {
  for (const suite of suites) {
    const nextParents = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results.at(-1) ?? {};
        const file = normalizeNativeFile(spec.file ?? suite.file, surface);
        const titlePath = [...nextParents, spec.title].filter(Boolean);
        const recoveredFlake = test.status === "flaky" && results.some((result) => result.status === "failed") && results.some((result) => result.status === "passed");
        const line = spec.line ?? results.find((result) => result.error?.location?.line || result.errors?.[0]?.location?.line)?.error?.location?.line ?? null;
        const column = spec.column ?? results.find((result) => result.error?.location?.column || result.errors?.[0]?.location?.column)?.error?.location?.column ?? null;
        const attemptRecords = results.map((result, index) => {
          const durationMs = Math.round(result.duration ?? 0);
          const startedAt = validTimestamp(result.startTime) ? result.startTime : undefined;
          return compactObject({
            file,
            project: test.projectName || test.projectId || undefined,
            titlePath,
            line,
            column,
            attemptIndex: Number.isSafeInteger(result.retry) ? result.retry : index,
            status: nativeStatus(result.status),
            startedAt,
            completedAt: startedAt ? new Date(Date.parse(startedAt) + durationMs).toISOString() : undefined,
            durationMs,
            recoveredFlake,
            flakyAnnotated: nextParents.some((title) => /^flaky:/i.test(title)),
          });
        });
        out.push({
          file,
          line,
          title: spec.title,
          titlePath,
          status: test.status,
          durationMs: results.reduce((sum, result) => sum + Math.round(result.duration ?? 0), 0),
          attempts: results.length || 1,
          flakyAnnotated: nextParents.some((title) => /^flaky:/i.test(title)),
          errorSummary: cleanText(last.error?.message ?? last.errors?.[0]?.message ?? null),
          errors: results.flatMap((result) => result.error ? [result.error] : (result.errors ?? [])),
          attemptRecords,
        });
      }
    }
    collectPlaywrightSpecs(suite.suites ?? [], out, nextParents, surface);
  }
}

function normalizeVitest(native, exitCode, surface, recordedAttempts) {
  const assertionResults = [];
  const nativePaths = new Set((native.testResults ?? []).map((file) => normalizeNativeFile(file.name, surface)));
  const attempts = recordedAttempts.map((attempt) => normalizeVitestAttempt(attempt, surface)).filter((attempt) => nativePaths.has(attempt.file));
  const attemptsByTest = groupAttemptsByTest(attempts);
  const filesWithMissingAttempts = new Set();
  for (const file of native.testResults ?? []) {
    const normalizedFile = normalizeNativeFile(file.name, surface);
    for (const assertion of file.assertionResults ?? []) {
      const titlePath = assertion.ancestorTitles ? [...assertion.ancestorTitles, assertion.title] : [assertion.title];
      const key = attemptKey({ file: normalizedFile, project: assertion.projectName, titlePath, line: assertion.location?.line, column: assertion.location?.column });
      const matches = attemptsByTest.get(key) ?? attempts.filter((attempt) => attempt.file === normalizedFile && JSON.stringify(attempt.titlePath) === JSON.stringify(titlePath));
      if (matches.length === 0) {
        if ((assertion.failureMessages?.length ?? 0) > 0) filesWithMissingAttempts.add(normalizedFile);
        else attempts.push({ file: normalizedFile, project: assertion.projectName, titlePath, line: assertion.location?.line, column: assertion.location?.column, attemptIndex: 0, status: nativeStatus(assertion.status), durationMs: Math.round(assertion.duration ?? 0), recoveredFlake: false, flakyAnnotated: flakyTitle(titlePath) });
      }
      assertionResults.push({ file: normalizedFile, assertion, matches });
    }
  }
  markRecoveredFlakes(attempts);
  const failed = assertionResults.filter(({ assertion }) => assertion.status === "failed").map(({ file, assertion }) => vitestCompactTest(file, assertion, "failed", attempts));
  const flaky = assertionResults.filter(({ file, assertion }) => attempts.some((attempt) => attempt.file === file && sameTitle(attempt.titlePath, [...(assertion.ancestorTitles ?? []), assertion.title]) && attempt.recoveredFlake)).map(({ file, assertion }) => vitestCompactTest(file, assertion, "flaky", attempts));
  return {
    status: exitCode === 0 ? "passed" : "failed",
    counts: {
      testsTotal: native.numTotalTests ?? assertionResults.length,
      testsPassed: native.numPassedTests ?? assertionResults.filter(({ assertion }) => assertion.status === "passed").length,
      testsFailed: native.numFailedTests ?? failed.length,
      testsSkipped: native.numPendingTests ?? 0,
      testsFlakyRecovered: flaky.length,
    },
    failedTests: failed,
    flakyRecoveredTests: flaky,
    files: groupFileObservations(attempts, { runner: "vitest", nativeFiles: native.testResults ?? [], surface, filesWithMissingAttempts }),
  };
}

function normalizeVitestAttempt(attempt, surface) {
  if (attempt?.schemaVersion !== 1) throw new Error("Vitest attempt sidecar has unsupported schema");
  return {
    file: normalizeNativeFile(attempt.file, surface),
    project: attempt.project || undefined,
    titlePath: attempt.titlePath,
    line: attempt.line,
    column: attempt.column,
    attemptIndex: attempt.attemptIndex,
    status: nativeStatus(attempt.status),
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    durationMs: Math.round(attempt.durationMs),
    recoveredFlake: false,
    flakyAnnotated: flakyTitle(attempt.titlePath),
  };
}

function groupFileObservations(attempts, { runner, nativeFiles = [], surface = null, filesWithMissingAttempts = new Set() }) {
  const groups = new Map();
  for (const attempt of attempts) {
    const group = groups.get(attempt.file) ?? [];
    group.push(attempt);
    groups.set(attempt.file, group);
  }
  if (runner === "vitest") for (const file of nativeFiles) if (!groups.has(normalizeNativeFile(file.name, surface))) groups.set(normalizeNativeFile(file.name, surface), []);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([file, fileAttempts]) => {
    fileAttempts.sort((left, right) => (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER) || JSON.stringify(left.titlePath).localeCompare(JSON.stringify(right.titlePath)) || left.attemptIndex - right.attemptIndex);
    const nativeFile = runner === "vitest" ? nativeFiles.find((candidate) => normalizeNativeFile(candidate.name, surface) === file) : null;
    const nativeDuration = nativeFile && Number.isFinite(nativeFile.startTime) && Number.isFinite(nativeFile.endTime) ? Math.max(0, Math.round(nativeFile.endTime - nativeFile.startTime)) : null;
    const attemptSum = fileAttempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
    const retryDuration = fileAttempts.filter((attempt) => attempt.attemptIndex > 0).reduce((sum, attempt) => sum + attempt.durationMs, 0);
    const complete = !filesWithMissingAttempts.has(file) && fileAttempts.every((attempt) => attempt.status !== "unknown") && (fileAttempts.length > 0 || (nativeFile?.assertionResults?.length ?? 0) === 0);
    return {
      path: file,
      status: complete ? fileStatus(fileAttempts, nativeFile?.status) : "unknown",
      complete,
      startedAt: runner === "vitest" && Number.isFinite(nativeFile?.startTime) ? new Date(nativeFile.startTime).toISOString() : earliestTimestamp(fileAttempts, "startedAt"),
      completedAt: runner === "vitest" && Number.isFinite(nativeFile?.endTime) ? new Date(nativeFile.endTime).toISOString() : latestTimestamp(fileAttempts, "completedAt"),
      durationMs: nativeDuration ?? attemptSum,
      planningDurationMs: Math.max(0, (nativeDuration ?? attemptSum) - retryDuration),
      durationSource: nativeDuration == null ? "attempt-sum" : "file-wall",
      testsTotal: new Set(fileAttempts.map((attempt) => attemptKey(attempt))).size || (nativeFile?.assertionResults?.length ?? 0),
      retryCount: fileAttempts.filter((attempt) => attempt.attemptIndex > 0).length,
      recoveredFlakeCount: new Set(fileAttempts.filter((attempt) => attempt.recoveredFlake).map((attempt) => attemptKey(attempt))).size,
      attempts: fileAttempts.map(({ file: _file, ...attempt }) => attempt),
    };
  });
}

function vitestCompactTest(file, assertion, status, attempts) {
  const titlePath = [...(assertion.ancestorTitles ?? []), assertion.title];
  const matching = attempts.filter((attempt) => attempt.file === file && sameTitle(attempt.titlePath, titlePath));
  return {
    file,
    title: assertion.title,
    titlePath,
    status,
    durationMs: matching.reduce((sum, attempt) => sum + attempt.durationMs, 0) || Math.round(assertion.duration ?? 0),
    attempts: matching.length || 1,
    flakyAnnotated: flakyTitle(titlePath),
    errorSummary: cleanText(assertion.failureMessages?.[0] ?? null),
    errors: (assertion.failureMessages ?? []).map((message) => ({ message })),
  };
}

function markRecoveredFlakes(attempts) {
  for (const group of groupAttemptsByTest(attempts).values()) {
    const recovered = group.some((attempt) => attempt.status === "failed") && group.at(-1)?.status === "passed";
    if (recovered) for (const attempt of group) attempt.recoveredFlake = true;
  }
}

function groupAttemptsByTest(attempts) {
  const groups = new Map();
  for (const attempt of attempts) {
    const key = attemptKey(attempt);
    const group = groups.get(key) ?? [];
    group.push(attempt);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((left, right) => left.attemptIndex - right.attemptIndex);
  return groups;
}

function attemptKey(attempt) {
  return JSON.stringify([attempt.file, attempt.project ?? null, attempt.titlePath, attempt.line ?? null, attempt.column ?? null]);
}

function sameTitle(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flakyTitle(titlePath) {
  return titlePath.some((title) => /^flaky:/i.test(title));
}

function fileStatus(attempts, nativeStatusValue) {
  if (attempts.some((attempt) => attempt.status === "failed" && !attempt.recoveredFlake)) return "failed";
  if (attempts.some((attempt) => attempt.status === "unknown")) return "unknown";
  if (attempts.length > 0 && attempts.every((attempt) => attempt.status === "skipped")) return "skipped";
  return nativeStatus(nativeStatusValue ?? "passed");
}

function nativeStatus(status) {
  if (["passed", "pass", "expected", "flaky"].includes(status)) return "passed";
  if (["failed", "fail", "unexpected"].includes(status)) return "failed";
  if (["timedOut", "timed-out"].includes(status)) return "timed-out";
  if (status === "interrupted") return "interrupted";
  if (["skipped", "skip", "pending", "todo"].includes(status)) return "skipped";
  return "unknown";
}

function normalizeNativeFile(file, surface) {
  if (!file) return "unknown";
  if (path.isAbsolute(file)) {
    const remoteRepositoryPrefix = "/workspace/television/";
    if (file.startsWith(remoteRepositoryPrefix)) return file.slice(remoteRepositoryPrefix.length).replaceAll("\\", "/");
    return path.relative(process.cwd(), file).replaceAll("\\", "/");
  }
  const normalized = String(file).replaceAll("\\", "/").replace(/^\.\//, "");
  const roots = surface?.roots ?? [];
  if (roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) return normalized;
  const cwdCandidate = path.posix.join(surface?.cwd ?? ".", normalized).replace(/^\.\//, "");
  if (roots.some((root) => cwdCandidate === root || cwdCandidate.startsWith(`${root}/`))) return cwdCandidate;
  for (const root of roots) {
    const rootDir = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(root) ? path.posix.dirname(root) : root;
    const candidate = path.posix.join(rootDir, normalized);
    if (fs.existsSync(candidate) || roots.length === 1) return candidate;
  }
  return normalized;
}

function earliestTimestamp(attempts, key) {
  return attempts.map((attempt) => attempt[key]).filter(Boolean).sort()[0];
}

function latestTimestamp(attempts, key) {
  return attempts.map((attempt) => attempt[key]).filter(Boolean).sort().at(-1);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function readNdjson(file) {
  if (!file || !fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  return text.split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid Vitest attempt record at line ${index + 1}: ${error.message}`); }
  });
}

function deduplicateProcessLeaks(leaks) {
  const byId = new Map();
  for (const input of leaks) {
    const leak = normalizeProcessLeak(input);
    const previous = byId.get(leak.leakId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(leak)) throw new Error(`Conflicting process leak ${leak.leakId}`);
    byId.set(leak.leakId, leak);
  }
  return [...byId.values()].sort((left, right) => left.leakId.localeCompare(right.leakId));
}

function attachProcessLeakFailures(surfaces) {
  const leaks = deduplicateProcessLeaks(surfaces.flatMap((surface) => surface.processLeaks ?? []));
  return surfaces.map((surface) => {
    const processLeaks = leaks.filter((leak) => leak.owningSurfaceIds.includes(surface.id));
    if (processLeaks.length === 0) return { ...surface, processLeaks: [] };
    return {
      ...surface,
      status: "failed",
      infraStatus: "incomplete",
      failureKind: surface.failureKind ?? "process-leak",
      failureStep: surface.failureStep ?? "surface-cleanup",
      failureMessage: surface.failureMessage ?? `${processLeaks.length} owned process leak${processLeaks.length === 1 ? "" : "s"} survived surface cleanup`,
      processLeaks,
    };
  });
}

function compactTest(test, logPath) {
  return { file: relativeFile(test.file), line: test.line ?? null, title: test.title ?? test.titlePath?.join(" › ") ?? "unknown", attempts: test.attempts ?? 1, flakyAnnotated: Boolean(test.flakyAnnotated), status: test.status, errorSummary: truncate(cleanText(test.errorSummary), 800), logPath };
}

function relativeFile(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
}

function cleanText(value) {
  if (value == null) return null;
  return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

function truncate(value, max) {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function emptyCounts() {
  return { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 };
}

function readJsonResult(file) {
  if (!file) return { value: null, failureStep: "native-report-missing", failureMessage: "Native JSON report path was not recorded" };
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    return { value: null, failureStep: "native-report-read", failureMessage: `Native JSON report could not be read: ${error.message}` };
  }
  try {
    return { value: JSON.parse(raw), failureStep: null, failureMessage: null };
  } catch (error) {
    return { value: null, failureStep: "native-report-parse", failureMessage: `Native JSON report is malformed: ${error.message}` };
  }
}

function writeAtomic(file, contents) {
  const temporary = `${file}.tmp-p${process.pid}`;
  try {
    fs.writeFileSync(temporary, contents);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function defaultTimingProvider(provider) {
  if (provider === "blaxel") return "blaxel-playwright-x64-4vcpu";
  if (provider == null) return "github-playwright-noble-x64-2vcpu";
  return "local-linux-x64-1cpu";
}
