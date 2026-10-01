*The shared remote execution model: deterministic duration-aware plans, per-worker execution, provider reports, retries, and normalization.*

# Sharded Execution

Remote test runs divide the repository's test files among parallel workers and combine their outcomes into one report. A committed baseline of file durations measured on Blaxel keeps those workers balanced while an explicit plan makes every assignment reproducible and skips runner startup where a shard has no work.

This spec is authoritative for shared sharded execution: the committed file-duration baseline, manual baseline update, shard-plan contract and algorithm, shard-count recommendation, the shard worker used by Blaxel and regular GitHub CI, Blaxel provider report shape, retry-attempt combination, the *infrastructure-failure*-versus-*test-failure* distinction, and normalization into [reporting.md](./reporting.md). The Blaxel coordinator extends this model in [blaxel-testshards.md](./blaxel-testshards.md); provider git safety and authentication are owned by [preflight.md](./preflight.md). Regular GitHub CI invokes the worker directly as matrix jobs and has no dispatch coordinator. Test surfaces, file ownership, and execution-group order come from [test-registry.md](./test-registry.md).

## Duration baseline

The repository contains exactly one committed duration rollup:

```
test/timing-baseline.json
```

It is a file-level planning input, not a pass attestation and not a substitute for the per-run event stream. Its measurements come only from Blaxel runs, where broad verification normally runs on uniform persistent sandboxes. Every shard plan weighs files by these measurements, whichever substrate executes it ([#Provider weights and unknown files](#Provider weights and unknown files)).

```ts
type TimingProvider =
  | `local-${"linux" | "darwin"}-${"x64" | "arm64"}-${number}cpu`
  | "blaxel-playwright-x64-4vcpu"
  | "github-ubuntu-24.04-x64-2vcpu-vm"
  | "github-playwright-noble-x64-2vcpu";

interface ProviderFileTiming {
  medianDurationMs: number;
  sampleCount: number;
  retryCount: number;
  recoveredFlakeCount: number;
  lastUpdated: string;
}

interface BaselineFileTiming {
  surfaceId: string;
  providers: { "blaxel-playwright-x64-4vcpu": ProviderFileTiming };
}

interface TimingBaseline {
  schemaVersion: 1;
  sourceThrough: string | null;
  files: Record<string, BaselineFileTiming>; // repo-relative POSIX path
}
```

The `providers` map names the timing provider that produced each measurement. It holds exactly one entry, for the Blaxel timing provider; an entry with any other key makes the baseline invalid.

Before any run history is available, the committed file is the canonical empty baseline:

```json
{
  "schemaVersion": 1,
  "sourceThrough": null,
  "files": {}
}
```

`sourceThrough: null` means no run has been examined. The planner requires the committed file and rejects a missing or malformed baseline; the empty baseline is valid input, has a stable raw-byte digest, and gives every planned file the 60,000 ms no-history weight.

A *timing provider* identifies the execution substrate that determines duration, not the command used to reach it. Every run event records one ([reporting.md](./reporting.md)), and every shard plan names the substrate that executes it. A local ID records operating system, architecture, and positive decimal logical-CPU count, for example `local-linux-x64-16cpu`, so materially different local hosts do not share an identity. The Blaxel ID pins its current architecture and CPU tier. Regular GitHub CI records `github-ubuntu-24.04-x64-2vcpu-vm` for jobs on the plain hosted VM, including the direct 16-worker e2e matrix. Unit and desktop CI jobs that invoke `npm test -- local` therefore record command provider `local` and the GitHub VM timing provider, never a `local-*` timing provider. Direct e2e matrix workers have no command provider and record the same GitHub VM timing provider. `github-playwright-noble-x64-2vcpu` is reserved for the deferred pinned Playwright-container substrate and receives no active workflow measurements. A future substrate gets a distinct reviewed ID when provider, image family, architecture, or CPU tier changes materially. An ID outside the listed literals or local pattern is invalid; local CPU counts must be positive base-10 integers.

The execution host receives its ID as `TV_TEST_TIMING_PROVIDER`. Blaxel coordinator requests and regular GitHub workflows set it explicitly. A non-CI direct local run defaults it to `local-${process.platform}-${process.arch}-${availableParallelism()}cpu`. A process with `GITHUB_ACTIONS=true` fails reporting initialization when its timing provider is absent or begins with `local-`, including when a transferred plan supplies the provider directly to the run context. It never guesses from the `local` command path, so a hosted run never records a developer-host substrate.

`medianDurationMs` is the median of the file events' `planningDurationMs` values from [reporting.md](./reporting.md). Eligible duration samples are complete files whose final status is `passed`, including recovered flakes because retry time has already been removed. `sampleCount` is the number of those samples. `retryCount` is the number of attempts after attempt zero, and `recoveredFlakeCount` is the number of tests that failed and then passed, summed across all complete observations for that file in the input runs. `lastUpdated` is the latest completion time among those observations. `sourceThrough` is the latest completion time among the input runs, including runs that contributed no eligible duration sample.

For an odd sample count, the median is the middle value after numeric sort. For an even count, it is the arithmetic mean of the two middle values rounded to the nearest integer, with `.5` rounded up. Durations are non-negative integer milliseconds, sample counts are positive integers, timestamps are UTC ISO-8601, paths are normalized repo-relative POSIX paths, and each path's `surfaceId` must match current registry ownership. Deleted and currently unowned paths are omitted.

Keys are written in lexicographic path order. The complete value is serialized as `JSON.stringify(value, null, 2)` plus one LF byte. Given the same input runs and checkout, baseline generation produces identical bytes.

### Manual update

The only writer is:

```bash
npm test -- baseline update
```

The command reads the checkout's `.test-runs/` directory. Each direct child directory containing `events.ndjson` is a candidate. A candidate is an *input run* when it is the complete run a Blaxel `verify` produces:

- its run event records command provider `blaxel`, the `blaxel-playwright-x64-4vcpu` timing provider, and a selection of the `all` suite with no file or grep filter;
- its selected surfaces include every surface the current registry places in the `all` suite;
- its shard events cover every index of one shard total;
- its run status is not `incomplete`, and every surface event ended `passed`, `failed`, or `not-assigned`.

The `all` label alone is not evidence of a complete run: surface, package, runner, and tag filters and shard subsets keep it, and so does a run that stopped early. Because the update carries nothing forward, such a run would otherwise replace the measurements of every file it did not execute. Local, GitHub, narrowed, and unfinished runs are ignored. The command validates, under [reporting.md](./reporting.md), the complete event stream of each candidate whose run event meets the first condition, recomputes the complete rollup from the input runs, and atomically replaces `test/timing-baseline.json`. It prints added, removed, and changed file entries plus the shard-count recommendation described below. `--dry-run` performs the same validation and calculation without changing the file.

A candidate whose run event cannot be read, or a Blaxel `all` candidate whose event stream fails validation, aborts the update without changing the baseline and names the directory. With no input runs, the command fails without changing the baseline, so running it in a checkout without Blaxel history cannot erase the committed measurements. The command does not commit or push its result. Test runs and CI never edit the baseline automatically; a person runs the command in a checkout that holds recent Blaxel run directories, reviews the diff, and commits the one rollup file.

A baseline entry is derived only from runs the command actually read. Existing values are not carried forward, so a file that no input run measured receives the unknown-file weight in later plans.

## Shard plan

A *shard plan* assigns every selected test file to exactly one of `N` shards. Files are atomic: a plan never divides tests within one file. The plan contains all selected surfaces, including an empty file list when a shard has no assignment for a surface.

```ts
type PlanWeightSource = "baseline" | "unknown-surface" | "unknown-timing-provider";

interface PlannedFile {
  path: string;
  weightMs: number;
  weightSource: PlanWeightSource;
  baselineSampleCount?: number;
}

interface PlannedSurface {
  surfaceId: string;
  runner: "vitest" | "playwright";
  files: PlannedFile[];
}

interface PlannedShard {
  index: number; // one-based
  total: number;
  predictedDurationMs: number;
  surfaces: PlannedSurface[];
}

interface ShardPlan {
  schemaVersion: 1;
  planId: string;
  timingProvider: TimingProvider;
  testedCommit: string;
  testedTree: string;
  shardTotal: number;
  selectedSurfaceIds: string[];
  timingBaselinePath: "test/timing-baseline.json";
  timingBaselineDigest: string;
  shards: PlannedShard[];
}
```

A valid plan assigns at least one test file across the complete run. Individual surfaces and individual machines may still receive empty file lists; those per-shard idle assignments are represented as `not-assigned` and are normal outcomes of splitting a smaller category across more machines.

`selectedSurfaceIds` and every per-shard surface array follow registry execution order; file arrays are lexicographic. Canonical JSON means the RFC 8785 JSON Canonicalization Scheme encoded as UTF-8. `planId` is the lowercase hexadecimal SHA-256 digest of the canonical plan with `planId` omitted. `timingBaselineDigest` is the lowercase hexadecimal SHA-256 digest of the committed baseline file's raw UTF-8 bytes, including its final newline. Plans contain no generation time, machine-local path, random value, or mutable remote input. The plan is retained under the run directory's `provider/` output and its ID is copied into provider reports and timing events.

### File inventory

The planner derives its inventory from tracked paths and registry ownership in the tested tree. It enumerates the target index with `git ls-files --cached -z`; a coordinator planning a commit other than its checkout first loads that commit into a temporary `GIT_INDEX_FILE` with `git read-tree`, uses the same enumeration command, and removes the temporary index. Untracked caller files and the coordinator's checked-out revision cannot affect the result.

A tracked path inside at least one registered `root` is a candidate test file when it matches `/(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]s)x?$/`. Each candidate must have exactly one owner across the registry's normalized `roots` and `excludeRoots`; canonical test files outside every registered root are outside the test runner's inventory. The selected inventory contains candidates whose owner is a selected surface; paths and owners are normalized and sorted before weighting. A missing config, duplicate path, zero or multiple owners, path outside the tested tree, or disagreement between assignment and worker collection is a configuration failure, never an empty passing shard. The registry and filename convention are the planning authority; planner processes do not import runner configs or test modules.

Workers load the owning Vitest or Playwright config only when executing their assigned files. The assigned-versus-collected comparison is the runner-aware guard: it catches a config that rejects an assigned path, broadens a substring filter, or reports a different normalized identity. This split keeps independent GitHub jobs deterministic without weakening the execution boundary.

### Provider weights and unknown files

A file uses its baseline `medianDurationMs` when the baseline entry's `surfaceId` matches the file's registry owner, whatever timing provider the plan names. A GitHub CI plan therefore balances its matrix with Blaxel measurements. Balancing depends on the files' relative costs, which Blaxel measurements approximate for other substrates; the plan's predicted durations are in Blaxel time and do not predict wall time on another substrate.

A file is *unknown* when the baseline has no entry for its path or its registry owner differs from the entry's `surfaceId`. Its weight is intentionally generous:

1. Take the nearest-rank p90 of known file medians for the same surface. If the surface has no known medians, take the nearest-rank p90 across the baseline.
2. When a p90 exists, use `max(30_000, ceil(1.5 × p90))` milliseconds.
3. When the baseline has no known medians, use `60_000` milliseconds.

Nearest-rank p90 selects sorted element `ceil(0.9 × count)`, using one-based indexing. A known baseline duration uses `max(1, medianDurationMs)`. A known file records `weightSource: "baseline"`. An unknown file records `"unknown-surface"` when either the same-surface p90 or baseline-wide p90 supplies its weight, and `"unknown-timing-provider"` when the baseline has no medians and the 60-second fallback applies. Unknown files are therefore spread as expensive work rather than collected on a shard that appears cheap.

### LPT assignment

The planner applies longest-processing-time-first scheduling globally across all selected surfaces:

1. Sort files by descending `weightMs`; break ties by `surfaceId`, then path, both ascending.
2. Start `N` bins with predicted duration zero.
3. Assign each file to the bin with the lowest predicted duration; break bin ties by lower one-based shard index.
4. Add the file weight to that bin and continue until every file is assigned.
5. Materialize every selected surface in every shard, sorting its assigned files by path.

This algorithm prevents independently heavy surface slices from accumulating on the same worker. `predictedDurationMs` is the sum of assigned file weights. It is a comparable planning estimate, not a promise of wall time: runner worker counts, setup, and host contention can make observed wall time differ.

The plan is static for the run. Workers do not pull from a queue, and infrastructure retries reuse the same plan and shard assignment. This preserves reproducibility and avoids repeating process and web-server startup for small dynamic batches.

### Stage-one cost-model boundary

The first planner deliberately uses additive file medians only. It does not divide a surface's assigned weight by its runner worker count and does not charge a fixed cost when the first file activates a surface on a shard. This keeps the committed rollup to the ratified per-file format and avoids encoding guessed setup constants before normalized phase events exist.

The tradeoff is explicit: a two-worker browser surface can have its shard wall overestimated by about 2×, and global LPT may spread a small surface across more shards and forfeit part of empty-surface skipping. Existing empty-surface startup observations reach 24 seconds on one shard, so predicted durations are advisory and shard count must not be raised from this model alone.

The model must be revised before any shard-count increase, or earlier when three consecutive successful broad runs on one timing provider show either (a) fixed surface phases above 10 seconds or 10% of the critical shard, whichever threshold is lower, or (b) an observed surface wall differing from its additive assigned-file weight by more than 25%. That revision adds provider-and-surface fixed-cost and effective-worker terms from recorded run events, bumps the plan schema, and replays the same captured inventories before adoption. This spec owns that back pressure; it is not an untracked implementation improvement.

### Determinism and GitHub plan agreement

Every regular GitHub CI matrix job invokes the shard worker directly and computes the complete plan in-job from the checked-out commit, selected surfaces, timing-provider ID, shard count, and committed baseline. Before execution, a job recomputes the digest from the canonical plan body and rejects an internally inconsistent `planId`. No job consults a mutable timing source while planning.

Internal digest verification does not establish cross-job agreement. Every shard summary carries `planId`, `timingProvider`, tested tree, shard index/total, assigned files, and collected files. The required GitHub CI `e2e-required` join downloads every shard summary and fails unless: indices `1..N` appear exactly once; all plan IDs, timing providers, tested trees, and totals are equal; and each summary's assigned and collected files agree. [github-ci.md](./github-ci.md) is authoritative for that join and its branch-protection result. This consensus check detects environment-dependent inventory or planning that could otherwise duplicate or omit files while individual jobs pass.

The Blaxel coordinator computes the complete plan once from the target commit before leasing workers, places the plan in each worker request, and tells each worker which shard index to execute. A worker validates the plan digest, tested commit/tree, timing provider, index, and total before starting a surface.

## Explicit file execution

A planned worker invokes runners with the assigned files and does not pass native `--shard` flags.

- Vitest receives absolute file paths resolved from the normalized repo-relative assignments. Vitest treats positional filters as substrings, so the worker first uses `String.includes` against the complete planned inventory and requires every repo-relative filter to match exactly one file: itself. An ambiguous filter fails plan validation before Vitest starts. The post-collection assigned-versus-collected check remains mandatory as a second boundary. The `unit:workspaces` execution group remains one combined Vitest process for all unit files assigned to that shard.
- Playwright receives a generated `--test-list` file containing one config-root-relative file path per line. A line with only the file path selects every test in that file without treating path characters as a regular expression. Custom Playwright commands, including the Electron wrapper, forward this option unchanged.
- Generated Playwright list files and combined Vitest config files live under the shard output directory and are retained with provider output.

The worker verifies after collection that every assigned file was collected by its owning surface and that no unassigned file ran. A mismatch fails the surface as infrastructure-incomplete with the plan and observed lists preserved.

When a planned surface has no files on a shard, the worker records it as `not-assigned` and skips its pre-command, runner process, web server, global setup, and cleanup hooks. When an entire execution group has no assigned files, the worker skips the group process. At aggregation, a surface is selected and run when at least one shard owns one of its files; per-shard `not-assigned` records do not turn that aggregate surface into a skipped surface.

A caller that has supplied all prebuilt artifacts may pass `--skip-pre-commands` or set `TEST_SHARD_SKIP_PRECOMMANDS=1`. The worker then skips every assigned surface's registry `preCommand`, records that phase as skipped with reason `prebuilt-artifact`, and still runs the configured test command, web server, global setup, and cleanup. The flag never makes the worker infer whether artifacts are sufficient and never falls back to a build: the caller owns artifact completeness, and a missing artifact must fail through the real test command. Without the flag, assigned surfaces retain their registry pre-commands.

This planned execution contract is an explicit exception to native per-runner sharding. Native `--shard=<index>/<total>` remains available to targeted diagnostics outside a provider plan, but shared remote suite execution uses only the explicit plan.

## Shard-count scaling

Planning accepts an explicit shard count from the Blaxel invocation or GitHub workflow. The committed count remains a reviewed coordinator/workflow setting; a run never changes its own matrix or pool demand.

A manual baseline update reports a recommendation for the Blaxel shard count. For candidate counts from 1 through the Blaxel pool size ([blaxel-testshards.md](./blaxel-testshards.md)), it plans the `all` suite with the exact LPT algorithm and chooses the smallest count whose maximum predicted shard duration is at most **120,000 ms**. This target keeps planned file work near the program's two-minute test budget while avoiding unbounded worker growth; provider setup time and internal runner parallelism remain visible beside the estimate. The command also reports:

- the current configured count and its predicted maximum;
- the provider's configured recommendation capacity;
- total predicted file work;
- the heaviest atomic file;
- the arithmetic lower bound `max(heaviest file, ceil(total weight / shard count))`;
- an explicit “split or optimize this file” warning when the heaviest file alone exceeds 120,000 ms.

Blaxel capacity is owned by [blaxel-testshards.md](./blaxel-testshards.md). A recommendation never overrides Blaxel pool constraints or concurrency limits. A person changes the committed count after reviewing the recommendation and available capacity. This gives suite growth a measurable scaling path without automatic infrastructure expansion. The GitHub matrix count is a measured setting owned by [github-ci.md](./github-ci.md#CI worker counts); because the baseline holds Blaxel time, the update makes no GitHub recommendation.

## Shared shard worker

Blaxel workers and regular GitHub CI matrix jobs run `scripts/run-test-shard.mjs`.

- Selection comes from the plan file passed as `--plan <path>` or `TEST_SHARD_PLAN=<path>`; `--plan` always requires a file and has no diagnostic or dry-run meaning. Surfaces are grouped by execution group ([test-registry.md](./test-registry.md)) and run in order, with the `unit:workspaces` group run as one Vitest process when it has assigned files, using the combined configuration described in [test-runner.md](./test-runner.md#Surface process lifecycle).
- `--test-retries <n>` applies `--retries` or `--retry` to non-unit surfaces only; unit surfaces never retry. The worker injects `FLAKY_TEST_RETRIES` for child runners (see [flaky-tests.md](./flaky-tests.md)).
- The runner-child environment starts with the host environment, the retry default, and the repository's `node_modules/.bin` prepended to the host `PATH`. Surface task values and declared-service values apply in that order. Immediately before launch, the worker removes both `FORCE_COLOR` and `NO_COLOR` from the completed environment.
- `--skip-pre-commands` or `TEST_SHARD_SKIP_PRECOMMANDS=1` applies the prebuilt-artifact contract from [#Explicit file execution](#Explicit file execution).
- `--fail-fast` stops the shard after the first failed group or task. Every later task that had files assigned by the plan remains in the shard summary with `status: "skipped"`, `skipReason: "fail-fast"`, its assigned files, and no collected files or runner artifacts.
- The worker writes `shard-<index>.json` into its results directory, default `.testshards/results`, and exits non-zero if any task failed or plan validation failed.

## Blaxel provider report shape

The Blaxel coordinator collects the plan and per-shard summaries into a provider report. Regular GitHub CI retains each direct worker's shard summary and timing stream as job artifacts; the required agreement join is owned by [github-ci.md](./github-ci.md) under the invariants above.

```ts
interface ProviderTask {
  surfaceId?: string;
  runner?: string;
  command?: string;
  args?: string[];
  status: "passed" | "failed" | "skipped" | "not-assigned";
  skipReason?: string | null;
  suite?: string;
  name?: string;
  exitCode?: number | null;
  durationMs?: number;
  infraStatus?: "completed" | "incomplete";
  predictedDurationMs?: number;
  assignedFiles?: string[];
  collectedFiles?: string[];
  preCommandsSkipped?: boolean;
  failureKind?: string | null;
  failureStep?: string | null;
  processLeaks?: NormalizedProcessLeak[];
  nativeResultPath?: string | null;
  [key: string]: unknown;
}

interface ProviderShard {
  shardIndex: number;
  shardTotal?: number | null;
  planId?: string;
  timingProvider?: TimingProvider;
  testedTree?: string;
  status: "passed" | "failed" | "infra-failed";
  durationMs?: number;
  predictedDurationMs?: number;
  tasks?: ProviderTask[];
  logPath?: string | null;
  leaseAcquired?: boolean;
  executionStarted?: boolean;
  outputDir?: string;
  nativeResultPath?: string | null;
  [key: string]: unknown; // sandbox, failureKind, failureStep, failureMessage, setupTimings, ...
}

interface AttemptReport {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  interruptedBy?: "SIGINT" | "SIGTERM";
  plan?: ShardPlan;
  run?: { createdAt?: string; updatedAt?: string; [key: string]: unknown };
  shardIndices?: number[];
  shards?: ProviderShard[];
  [key: string]: unknown;
}

interface CombinedReport extends AttemptReport {
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  plan?: ShardPlan;
  shards: ProviderShard[];
  failedTasks: Array<Record<string, unknown>>;
  infraFailedShards: number[];
}
```

`NormalizedProcessLeak` is defined by [reporting.md](./reporting.md). Generated TypeScript declarations must preserve these status unions.

## Infrastructure failure vs test failure

A shard's status is `passed`, `failed`, or `infra-failed`. The status describes whether the shard completed before it describes any individual test observation.

- `infra-failed` means the shard's execution or result evidence is incomplete. Setup, plan or collection validation, transport, interruption, and an unavailable completion result are infrastructure failures. Reaching the test command or retaining some task observations does not establish that the shard completed.
- A *test failure* is a completed shard with usable native or task evidence that reports a failed test. It is `failed` and is not eligible for an infrastructure retry.
- A passed summary and a known nonzero worker exit are contradictory completed evidence. The shard is `failed` and non-retryable, but the contradiction is reported as `result-report/summary-validation` with no invented failed test. A passed summary with no known worker exit is `infra-failed` because completion is unconfirmed.
- A process leak is a completed lifecycle failure. Its task and shard are `failed` and are not retried as infrastructure; its normalized surfaces remain infrastructure-incomplete because cleanup was not confirmed. Native test failures and recovered flakes remain visible beside the lifecycle cause.
- An unreadable or unparseable summary is `infra-failed`. The read or parse cause is retained without creating a test or failed-task record.

An infrastructure-failed shard may retain known passed, failed, skipped, or not-assigned task observations. Those observations describe only the evidence recovered from that attempt. They do not change the overall run from unknown to passed or failed while the shard remains incomplete.

The Blaxel coordinator classifies provider shards as owned by [blaxel-testshards.md](./blaxel-testshards.md). Regular GitHub CI receives the worker's exit and shard summary directly. This spec owns the shared vocabulary and report fields.

## Report files, retries, and final results

Each provider attempt writes a full `report.json` and compact `summary.json`. Planned attempts also retain `shard-plan.json`. An unreadable shard summary becomes an infrastructure-failed shard with its read or parse cause and no synthetic test task.

The shard retry condition and supersession rule are owned by [test-runner.md#Retries](./test-runner.md#Retries). `stale-owner` is the provider-specific exception defined by [blaxel-testshards.md](./blaxel-testshards.md). Regular GitHub CI has no provider retry coordinator; an infrastructure-failed matrix shard fails its job and the required join.

Attempt history and retained per-attempt files remain available for diagnosis. The combined report takes the result returned by the latest attempt that requested each shard and retains the existing result for shards outside that retry subset. A retry that returns no result contributes a `missing-result/attempt-aggregation` infrastructure result. A requested shard missing from every attempt receives the same infrastructure classification. Every planned attempt must carry the same complete plan and plan ID; disagreement invalidates aggregation.

The combined report keeps the original requested shard set, while attempt history records the subset requested in each attempt. Its failed-task list is rebuilt from the retained final shard results. Only tasks whose status is exactly `failed` appear there or in the coordinator's `Failed task` output. `skipped` and `not-assigned` tasks remain visible in shard and surface results but are not reported as failures. Failed-task observations from a superseded infrastructure attempt remain in that attempt's artifacts and do not enter the combined failure list. If the final retained shard is still infrastructure-failed, any task observations recovered from it remain diagnostic evidence while the normalized run's test status is unknown. The combined provider report passes only when every retained shard passed and its rebuilt failed-task list is empty; every other provider outcome is failed.

Provider tasks are normalized by selected surface. Counts, failed tests, recovered flakes, assignments, and collected files are combined across retained shard parts; process leaks are deduplicated by `leakId` and attached to every owning surface. A `not-assigned` part contributes no execution duration, test count, or leak. A fail-fast `skipped` part contributes its assignment but no test count. When another part of that surface ran, the aggregate is counted as run and retains both assigned and collected files, while its skipped status records that the complete assignment did not finish.

Each retained infrastructure-failed shard produces its own provider failure record so its cause remains attributable. Contradictory completed evidence also produces an infrastructure-incomplete provider record: the shard is non-retryable, while the normalized run remains `incomplete` with `testStatus: "unknown"`. When no task or native-result evidence exists, one infrastructure-incomplete `provider:<name>` result reports the missing evidence with zero test failures; no selected surface is substituted. An individual passed shard containing only `not-assigned` tasks is a known idle assignment within a nonempty plan, not missing evidence.

Provider and native results also produce the timing hierarchy from [reporting.md](./reporting.md), including retained plan identity, predicted durations, setup phases, file durations, native retry attempts, and one process-leak event per unique `leakId`. Output links name only files retained in the directory that owns the report; an attempt directory does not claim the root request file.

## Testing

Under the testing policy's [rule for platform-dependent behavior](../testing-policy.md#^platform-breadth), coverage for `resolveTimingProvider` must include its platform-dependent outcomes. A seam must also show that the production sources named in [#Test hooks](../../../proofs/arch/test-runner/sharded-execution.md#Test hooks) supply the values used to choose the timing provider.

Under the testing policy's [compositional coverage rule](../testing-policy.md#Compositional coverage across clean seams), seams for explicit file assignment must launch the installed Vitest and Playwright processes. Each seam must show that its runner collects exactly the files assigned to it. The Vitest seam must launch the installed runner with the generated combined config for the `unit:workspaces` execution group. The Playwright seam must launch the default Playwright command with the generated `--test-list` file.

A seam must also pass the generated `--test-list` file through the real Electron wrapper process. The default Playwright command cannot prove that the custom command declared in the registry forwards the list unchanged.

Under the testing policy's [rule for integration against paid services or complex host dependencies](../testing-policy.md#integration-against-paid-services-or-complex-host-dependencies-is-important), a live planned Blaxel suite run must cross the real Blaxel API and the real transport to the remote process. The run must show that the worker validates and executes the `ShardPlan` it receives. A `--suite target` run carries no provider plan, so it cannot prove this handoff.

Live GitHub evidence follows the [isolated CI requirements in github-ci.md](./github-ci.md#Testing). The evidence must show that independently started matrix jobs derive the same valid plan from their shared inputs. The strict join must validate the jobs' summaries and exact file assignments.

