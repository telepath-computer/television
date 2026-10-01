*The run directory, normalized reports, timing events, and CI run artifacts every test run produces.*

# Reporting

Every test run leaves a compact result for people and agents, detailed files for debugging, and machine-readable timing records. The timing records that Blaxel runs leave in their run directories are the input for balancing future test runs across parallel machines.

This spec is authoritative for the *run directory*, the *normalized surface result* model, the per-run timing event stream, compact-summary discipline, status accounting, and the run artifacts GitHub Actions jobs upload. Local runs, regular GitHub CI jobs, and Blaxel runs all produce this model; Blaxel provider results are translated into it by [sharded-execution.md](./sharded-execution.md). The runner that drives reporting is [test-runner.md](./test-runner.md); the testing discipline behind the honesty of these reports is [testing-policy.md](../testing-policy.md). Duration rollups and shard planning are owned by [sharded-execution.md](./sharded-execution.md).

## Run directory

Each run gets a *run directory* at `.test-runs/<run-id>/`. Its exact run ID is `<safe-start>-p<pid>-r<random>`, where `safe-start` is `new Date().toISOString().replace(/[:.]/g, "-")`, `pid` is the unsigned decimal process ID, and `random` is 8 random bytes encoded as 16 lowercase hexadecimal characters. Example: `2026-07-16T04-22-32-979Z-p4095823-r0123456789abcdef`. The random suffix prevents concurrent processes and separate hosts with the same clock and process ID from colliding.

```
.test-runs/<run-id>/
  summary.json       compact run summary
  results.json       per-surface normalized results
  events.ndjson      normalized timing event stream
  logs/              raw runner logs, per surface
  native/            native Vitest/Playwright reports
  provider/          provider-specific outputs for remote runs, including the shard plan
```

`summary.json` carries an `outputs` pointer block naming `results.json`, `events.ndjson`, `logs/`, `native/`, and `provider/` when present. Files are written atomically through a sibling temporary file followed by rename. A run that exits before native test output exists still writes all three top-level report files with the infrastructure failure it reached.

The process that owns the test invocation owns its run directory:

- `scripts/test/cli.mjs` produces it for direct local runs, including unit and desktop commands invoked inside GitHub CI.
- `scripts/run-test-shard.mjs` produces it for each regular GitHub CI matrix shard that invokes the worker directly; its existing `.testshards/results/shard-<index>.json` is an input retained under `provider/`, not the final report.
- The canonical runner's Blaxel coordinator finalizer produces one combined run directory after downloading shard fragments. Blaxel workers produce fragments only.

Regular GitHub matrix jobs therefore have distinct run IDs and one-shard event streams. Their required join validates plan agreement under [sharded-execution.md](./sharded-execution.md); it does not rewrite those job runs into a synthetic run.

A caller that must retain this invocation's directory passes `--run-dir-output <file>`. The owning runner atomically writes its absolute run-directory path to that caller-owned file immediately after creation. Orchestration uses this identity instead of enumerating `.test-runs/`: repository tests deliberately create sibling run directories while exercising retry capture and real CLI boundaries, so directory count and modification time do not identify the outer run.

## Normalized surface result

A *normalized surface result* is one surface's outcome, shaped the same regardless of runner or provider.

```ts
interface Counts {
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  testsFlakyRecovered: number;
}

interface ProcessLeakSocket {
  protocol: "tcp";
  family: "ipv4" | "ipv6" | "unknown";
  host: string;
  port: number;
}

interface NormalizedProcessLeak {
  leakId: string;
  ownerToken: string;
  owningSurfaceIds: string[];
  pid: number;
  parentPid: number | null;
  processGroupId: number | null;
  processStartedAt: string;
  detectedAt: string;
  command: string;
  listeningSockets: ProcessLeakSocket[];
  cleanup: {
    termSent: boolean;
    killSent: boolean;
    outcome: "terminated" | "killed" | "already-exited" | "survived" | "unknown";
  };
}

interface NormalizedSurfaceResult {
  id: string;
  runner: string;
  status: "passed" | "failed" | "skipped";
  infraStatus?: "completed" | "incomplete";
  command: string[];
  exitCode?: number | null;
  durationMs: number;
  durationSource: "surface-wall" | "owned-file-sum" | "task-wall" | "unknown";
  logPath: string | null;
  nativeResultPath?: string | null;
  nativeResultPaths?: string[];
  counts: Counts;
  failedTests: Array<Record<string, unknown>>;
  flakyRecoveredTests: Array<Record<string, unknown>>;
  processLeaks: NormalizedProcessLeak[];
  skipReason?: string | null;
  assignedFiles?: string[];
  collectedFiles?: string[];
  // lifecycle and provider infrastructure failures also carry:
  failureKind?: string | null;
  failureStep?: string | null;
  failureMessage?: string | null;
  infraFailedShards?: number[];
}
```

`normalizeSurfaceResult` reads the surface's native report and classifies tests. For Vitest, a failed assertion is a failure, while recovered flakes come from the attempt-recorder sidecar: a test is recovered when its recorded attempts include a failure and the final recorded attempt passed. Aggregate Vitest failure messages never establish a recovery. For Playwright, a `flaky` test status is a recovered flake. A missing or malformed native report is infrastructure-incomplete result evidence; normalization preserves the read or parse cause and does not invent a failed test.

A standalone surface uses its process wall for `durationMs`. A surface that ran inside the combined Vitest run uses the sum of its owned file walls and `durationSource: "owned-file-sum"`; the combined process wall is recorded once as the shard phase `execution-group:unit:workspaces`. The group wall is never copied onto every member surface. Provider-normalized standalone task parts use `task-wall`.

## Reports

`TimingProvider` is the execution-substrate identity defined by [sharded-execution.md](./sharded-execution.md); it is independent of the command provider. `buildReports` writes `summary.json` and `results.json`.

```ts
interface ReportSummary {
  schemaVersion: 1;
  run: {
    id: string;
    commandProvider: "local" | "blaxel" | null;
    timingProvider: TimingProvider;
    status: "passed" | "failed" | "incomplete";
    infraStatus: "completed" | "incomplete";
    testStatus: "passed" | "failed" | "unknown";
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  selection: Record<string, unknown>;
  git: Record<string, unknown> | null;
  preflights: Array<Record<string, unknown>>;
  counts: {
    surfacesSelected: number;
    surfacesRun: number;
    surfaces: number;
    surfacesPassed: number;
    surfacesFailed: number;
    surfacesSkipped: number;
    testsFailed: number;
    testsFlakyRecovered: number;
    processLeaks: number;
    infraFailures: number;
  };
  failedSurfaces: Array<Record<string, unknown>>;
  skippedSurfaces: Array<Record<string, unknown>>;
  failedTests: Array<Record<string, unknown>>;
  flakyRecoveredTests: Array<Record<string, unknown>>;
  processLeaks: NormalizedProcessLeak[];
  phaseMetrics: {
    schemaVersion: 1;
    run: {
      durationMs: number;
      observedStartedAt?: string;
      observedCompletedAt?: string;
      observedWallDurationMs?: number;
      phases: TimingPhase[];
    };
    shards: Array<{
      index: number;
      total: number;
      status: EventStatus;
      durationMs?: number;
      phases: TimingPhase[];
      surfaces: Array<{ surfaceId: string; status: EventStatus; durationMs?: number; durationSource: string; phases: TimingPhase[] }>;
    }>;
  };
  outputs: {
    results: string;
    events: string;
    logsDir: string;
    nativeDir: string;
    providerDir?: string;
  };
}

interface ReportResults {
  schemaVersion: 1;
  run: ReportSummary["run"];
  selection: Record<string, unknown>;
  git: Record<string, unknown> | null;
  preflights: Array<Record<string, unknown>>;
  counts: {
    surfacesSelected: number;
    surfacesRun: number;
    surfacesSkipped: number;
  };
  surfaces: NormalizedSurfaceResult[];
  infraFailures: Array<Record<string, unknown>>;
}
```

`ReportSummary` declares `failedSurfaces` once. Any generated type declaration must match that shape. `surfacesRun` counts selected surfaces with execution evidence: a wholly skipped surface is excluded, while an aggregate that retains passed tests, normalized files, or collected files from one shard remains counted when another shard was skipped by fail-fast. `surfacesSkipped` counts only wholly skipped selected surfaces. Infrastructure-only `provider:<name>` records remain visible as failures but are not selected test work and do not contribute to `surfacesRun`.

`selection` is the complete requested scope. `results.surfaces` contains normalized selected-surface outcomes only where task or native-result evidence exists, plus explicit provider/lifecycle failure records. When provider evidence is absent, the report does not synthesize one failed or passed result per selected surface; the selection remains visible, `surfacesRun` stays zero for work not observed, and an infrastructure-incomplete provider result carries the reporting cause. A shard containing only `not-assigned` tasks is known idle work, not missing provider evidence. Such a shard may pass as one participant in a valid plan because other shards own the files; [sharded-execution.md](./sharded-execution.md) requires at least one file across the complete plan.

### Status and evidence claims

Three run fields answer separate questions:

- `infraStatus` is `incomplete` when a preflight failed or any result needed to account for the selection is infrastructure-incomplete; otherwise it is `completed`.
- `testStatus` is `unknown` whenever `infraStatus` is `incomplete`. With complete infrastructure evidence, it is `failed` when any surface failed and `passed` otherwise.
- `status` is `incomplete` whenever `infraStatus` is `incomplete`; otherwise it equals `testStatus`.

An incomplete run may report outcomes that have direct evidence: completed surface results, native failed tests, recovered flakes, skipped assignments, and partial task observations from an incomplete shard. It may not infer an outcome for missing work, count an unstarted selected surface as run, turn an unreadable result into a failed test, or claim that the complete selection passed or failed. Known failures remain visible even though the run-level `testStatus` is `unknown`; unknown describes the unresolved complete selection, not the absence of all observations.

`failedSurfaces` contains failed or infrastructure-incomplete results. `skippedSurfaces` contains only wholly skipped selected surfaces and carries each reason. A partially executed aggregate retains `status: "skipped"` because its complete assignment did not finish. Its assigned and collected files remain explicit in `results.json`, and it counts as run rather than wholly skipped. Aggregate `status` describes completion of the whole assigned surface; `surfacesRun` records whether any selected work executed.

An interrupted provider run is infrastructure-incomplete even when every shard happened to complete before the signal was handled. Results completed before interruption remain unchanged. A running shard retains any summary, native result, task artifact, assignment, collection, and log evidence already downloaded, and its unfinished shard outcome records the interruption. Pending work has no synthetic task outcome. The report therefore preserves known failures and passes without inventing outcomes for unobserved work.

A completed shard whose passed summary conflicts with a known nonzero worker exit produces a `result-report/summary-validation` provider failure. The shard is non-retryable, but the provider failure is infrastructure-incomplete in the normalized report, so the run has `status: "incomplete"` and `testStatus: "unknown"`. No failed test is synthesized from the contradictory exit.

A process leak makes every surface named by `owningSurfaceIds` failed with `infraStatus: "incomplete"`, `failureKind: "process-leak"`, and `failureStep: "surface-cleanup"`. Native failures and recovered flakes remain present. A stale owner found before test execution retains the original `owningSurfaceIds` and is represented by incomplete synthetic lifecycle surfaces when those owners are outside the current selection; its failure fields are `stale-owner` / `startup-owner-cleanup`, no selected test surface starts, and a selected owning surface does not contribute to `surfacesRun`. The report counts unique `leakId` values, because one leak from a combined Vitest run can be attached to several surface results. Lifecycle failures are not runner retries; [flaky-tests.md](./flaky-tests.md) owns that retry boundary, and [test-runner.md](./test-runner.md) owns detection and cleanup.

### Compact discipline

`summary.json` enumerates failed tests, recovered flakes, and process leaks but never enumerates passed test cases; counts represent observed passes. Each enumerated test is compacted to file, line, title, attempts, `flakyAnnotated`, status, and an `errorSummary` truncated to 800 characters with ANSI codes stripped. A leak is already compact and is preserved in full because PID, command, owning surfaces, and sockets are the evidence needed to identify the leaking harness. `results.json` enumerates each selected surface for which an outcome was retained and its leak records, while `selection` remains the authority for the complete requested set. Work with no evidence receives no per-surface pass or failure.

`events.ndjson` is an explicit exception to compact-summary discipline. It enumerates every test attempt because its purpose is machine analysis; it is not printed into agent context as a normal command result.

## Timing event stream

`events.ndjson` is UTF-8 newline-delimited JSON. Each event is serialized with RFC 8785 JSON canonicalization followed by one LF byte; the file also ends in LF. Each line is one `TimingEvent`. The stream is complete only after the run has finished; it is produced from native reports and provider output, not treated as a live progress protocol.

Test execution events form the hierarchy **run → shard → surface → file → test attempt** through parent IDs. Surface-end process-leak events are additional shard descendants that reference every owning surface event, because a leak from a combined Vitest run can belong to several surfaces. An unsharded local process has one synthetic shard with index and total `1`. A provider failure before task assignment may stop at the run or shard level, with descendants absent. Once a plan assigns a task, planned fail-fast preserves an assigned-but-not-started surface event as `skipped` with no file or leak descendants. A selected surface with no files assigned by a shard plan gets a surface event with status `not-assigned` and no file or leak descendants.

```ts
type EventStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "timed-out"
  | "interrupted"
  | "not-assigned"
  | "incomplete"
  | "unknown";

interface TimingPhase {
  name: string;
  category:
    | "schedule"
    | "checkout"
    | "dependencies"
    | "readiness"
    | "plan"
    | "join"
    | "test"
    | "report"
    | "publication"
    | "verification"
    | "other";
  status: "passed" | "failed" | "skipped" | "unknown";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  cacheStatus?: "hit" | "miss" | "not-applicable" | "unknown";
}

interface TimingEventBase {
  schemaVersion: 1;
  sequence: number;
  kind: "run" | "shard" | "surface" | "file" | "test-attempt" | "process-leak";
  runId: string;
}

interface RunTimingEvent extends TimingEventBase {
  kind: "run";
  commandProvider: "local" | "blaxel" | null;
  timingProvider: TimingProvider;
  status: "passed" | "failed" | "incomplete";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  selection: Record<string, unknown>;
  git: {
    commit: string | null;
    tree: string | null;
    dirty: boolean;
  };
  environment: {
    ci: boolean;
    os: string;
    arch: string;
    node: string;
    vitest?: string;
    playwright?: string;
    logicalCpuCount?: number;
    runnerImage?: string;
  };
  shardPlanId?: string;
  timingBaselineDigest?: string;
  phases: TimingPhase[];
}

interface ShardTimingEvent extends TimingEventBase {
  kind: "shard";
  shardId: string;
  index: number;
  total: number;
  status: EventStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  predictedDurationMs?: number;
  phases: TimingPhase[];
}

interface SurfaceTimingEvent extends TimingEventBase {
  kind: "surface";
  shardId: string;
  surfaceEventId: string;
  surfaceId: string;
  runner: "vitest" | "playwright";
  status: EventStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  durationSource: "surface-wall" | "owned-file-sum" | "task-wall" | "unknown";
  workerCount?: number;
  retryBudget: number;
  phases: TimingPhase[];
}

interface FileTimingEvent extends TimingEventBase {
  kind: "file";
  shardId: string;
  surfaceEventId: string;
  fileEventId: string;
  path: string;
  status: EventStatus;
  complete: boolean;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  planningDurationMs: number;
  durationSource: "file-wall" | "attempt-sum" | "runner-total" | "unknown";
  testsTotal: number;
  retryCount: number;
  recoveredFlakeCount: number;
}

interface TestAttemptTimingEvent extends TimingEventBase {
  kind: "test-attempt";
  shardId: string;
  surfaceEventId: string;
  fileEventId: string;
  testId: string;
  attemptIndex: number; // zero-based
  path: string;
  line?: number;
  column?: number;
  project?: string;
  titlePath: string[];
  status: EventStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  retry: boolean;
  recoveredFlake: boolean;
  flakyAnnotated: boolean;
}

interface ProcessLeakTimingEvent extends TimingEventBase {
  kind: "process-leak";
  shardId: string;
  surfaceEventIds: string[];
  leak: NormalizedProcessLeak;
}

type TimingEvent =
  | RunTimingEvent
  | ShardTimingEvent
  | SurfaceTimingEvent
  | FileTimingEvent
  | TestAttemptTimingEvent
  | ProcessLeakTimingEvent;
```

### Phase metrics

Phase metrics are standing run output, not an ad-hoc performance probe. Every canonical run writes normalized phases into `events.ndjson` and mirrors them under `summary.json.phaseMetrics`, where the run, every shard, and every surface remain individually addressable. The CLI prints run and shard phases plus the slowest surface-compute rows. `observedWallDurationMs` spans the earliest recorded setup phase through the latest recorded run phase; `run.durationMs` remains the test invocation's own wall.

The stable `category` values let dashboards compare different execution paths without depending on provider-specific phase names. Every step capable of costing tens of seconds is represented where it applies: schedule/restore-wake, checkout/fetch, dependencies, browser or application readiness, planning, test compute, report collection/finalization, and verification phases. Dependency and browser phases record `cacheStatus` as `hit` or `miss` when the execution substrate exposes it. Provider-specific detail remains in `name`: for example, Blaxel keeps `setup:deps`, `setup:playwright-cache`, and `report-download`, while regular GitHub shards keep `dependencies`, `browser-readiness`, and `shard-plan`.

Regular GitHub jobs query their own Actions run after checkout to measure schedule delay from workflow creation—or from the completed build prerequisite for shard jobs—to VM job start. Workflow setup phases are appended to a caller-owned NDJSON file and ingested by the canonical runner, so they survive in the same run event and summary as test compute. The required agreement job runs after shard artifacts are immutable; it therefore uploads its join phase as a distinct `test-phase-metrics-<run-id>-join` artifact and writes the same value to the Actions step summary rather than rewriting shard evidence from another job.

Blaxel records sandbox acquisition/restore, checkout, dependency cache outcome, system prerequisites, owner cleanup, browser/Electron readiness, test execution, and result download per shard. Surface phases include service/application readiness, runner wall, and time from runner start to the first native test attempt when the runner reports that timestamp. A developer-machine `verify` passes its lint, type-check, package-manifest, and test-phase metrics into the resulting canonical run summary.

Report finalization is measured while constructing the artifact. The enclosing `verify:tests` and `verify:total` phases are recorded after the child run exits and `events.ndjson` is sealed, so they are appended to `summary.json.phaseMetrics` only; the sealed event bytes are never rewritten.

Attaching `phaseMetrics` while finalizing `summary.json` is part of producing a valid run artifact and remains load-bearing. Every later metrics append and every workflow-only sidecar is best-effort observability: a write, GitHub API lookup, parse, or upload failure emits a warning and omits that phase, but never changes the command, test, or agreement result. A wrapper that measures a real command always re-raises that command's original status after attempting the metric, so observability can neither turn green red nor mask red as green.

All durations are non-negative integer milliseconds; fractional native durations are converted with `Math.round`. Paths are normalized repo-relative POSIX paths. A native result downloaded from a remote worker may carry an absolute path rooted at `/workspace/television/`; event construction removes that remote workspace root before validating and hashing the path, rather than interpreting it relative to the coordinator's checkout. IDs are deterministic within a run. `testId` is the lowercase hexadecimal SHA-256 digest of the UTF-8 RFC 8785 serialization of this exact array:

```ts
["test-id-v1", surfaceId, path, project ?? null, titlePath, line ?? null, column ?? null]
```

`titlePath` remains a nested JSON array, so its entry count and boundaries are part of the input. `line` and `column` are non-negative JSON integers or `null`; `project` is a string or `null`. This makes absent values distinct from strings and title entries. The ID is an event identity, not the duration-baseline key; duration planning is file-based.

A leak record represents one surviving process captured at surface end that required a cleanup signal or remained after cleanup. A candidate that revalidation finds already exited before either cleanup signal is omitted rather than reported as a leak; `cleanup.outcome: "already-exited"` remains valid when an earlier signal was sent and the process exits before a later cleanup step. `leakId` uses the same digest and canonical UTF-8 rules over `["process-leak-id-v1", ownerToken, pid, processStartedAt]`, with `pid` encoded as a JSON integer. `owningSurfaceIds` and `surfaceEventIds` are non-empty, deduplicated, and lexicographically sorted; they contain several entries only for a shared execution scope such as the combined Vitest run. `processStartedAt` and `detectedAt` are UTC ISO-8601 timestamps. `command` is the executable path or executable name only, never argv. Socket records are captured before cleanup, use ports 1–65535, and sort by protocol, family, host, and port. `cleanup.outcome: "survived"` keeps the run incomplete after the final scan.

`durationMs` on a file is its observed elapsed wall when the native runner exposes one and otherwise the sum of its attempt durations. `planningDurationMs` subtracts the durations of retry attempts from that observed duration; when no file wall is available it is the sum of first attempts. This keeps setup and hook time where the runner exposes it while keeping retry time out of ordinary shard weights. A file is `complete: false` when the native data is insufficient to enumerate every attempt or the runner stopped during that file; incomplete files never feed the duration rollup.

Every native attempt becomes exactly one `test-attempt` event. For a test that failed and then passed, every attempt carries `recoveredFlake: true`; `retry` is true when `attemptIndex > 0`. A final failure after retries carries `recoveredFlake: false`. The normalizer must preserve an unknown value as `status: "unknown"` or mark the file incomplete; it must not invent a passing attempt from aggregate counts.

Playwright 1.58 JSON contains ordered result records with retry indices and durations and is sufficient input. Vitest's built-in JSON supplies final assertion outcomes, not the complete ordered attempt record needed here. Reporter callbacks likewise lack each retry attempt's duration. Vitest execution attaches a custom runner-lifecycle recorder through each generated project or standalone run config's `test.runner`; it records each attempt's identity, index, status, and duration alongside the built-in file report while delegating ordinary behavior to `VitestTestRunner`. The normalizer joins those records by test identity. It never derives attempt count, order, or duration from `failureMessages`. ^vitest-attempt-recording

Events are ordered deterministically: run first; then shards by index; within a shard, surfaces in registry execution order; files by path; tests by declared location and title path; attempts by index; then surface-end process leaks by owning-surface list, PID, and process start time. `sequence` starts at zero and increases by one with no gaps. This ordering makes a stream byte-stable for the same normalized input.

The event stream contains no environment-variable names or values, stdout, stderr, command arguments, error messages, attachments, or source contents. `RunTimingEvent.environment` is an allowlist of non-secret runtime facts produced directly by the runner, not a copy of `process.env`. A process-leak `command` is limited to the executable identity defined above and excludes arguments. Raw process-table and socket-tool output remains elsewhere in the run directory. This boundary keeps the event stream a compact, secret-free record for machine analysis.

## GitHub Actions artifacts

Every GitHub Actions test job uploads its full `.test-runs/<run-id>/` directory as `test-run-<run-id>` with `if: always()`, `if-no-files-found: error`, and 30-day retention. Matrix jobs use distinct run IDs and artifact names. Artifacts contain the native reports and logs needed for diagnosis. Credentials are never copied into a run directory or event.

## Testing

A seam must exercise the handoff from the installed Vitest runner's lifecycle to the production attempt recorder. It must preserve separate failed and passed attempts and their durations. Under the testing policy's [compositional coverage rule](../testing-policy.md#Compositional coverage across clean seams), fixtures made from recorded native reports may cover the other normalization cases.
