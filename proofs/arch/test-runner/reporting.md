*How the promises in Reporting are proven.*

# Reporting — proof

Proves [specs/arch/test-runner/reporting.md](../../../specs/arch/test-runner/reporting.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Test hooks


`createRunId` accepts `now` to supply the start time, `pid` to supply the process ID, and `randomBytes` to supply the random suffix; `createRunContext` forwards those controls and accepts `root` to select the run-directory parent and `env` to supply the environment the timing-provider rule reads ([sharded-execution.md](../../../specs/arch/test-runner/sharded-execution.md)). Production uses the current time, process ID, cryptographic random bytes, repository root, and `process.env`. `readRunDirectoryIdentity` accepts `root` to select the workspace whose `.test-runs/` directory the identity file must name a direct child of; production uses the current workspace.

`TV_VITEST_ATTEMPT_FILE` supplies the NDJSON output path to the production Vitest attempt recorder. The canonical runner and the planned shard worker set it to the current native run's attempt-result path. A Vitest invocation that configures the recorder outside those entrypoints must set it; the recorder fails without it.

## Assertions

### Test assertions

The event-normalization assertions are **contract tests** over recorded native-report fixtures. The command assertions are **acceptance tests** that spawn the real test CLI.

- A recorded Vitest report and a recorded Playwright report normalize to the full run → shard → surface → file → test-attempt hierarchy with contiguous sequence numbers, normalized paths, and exact attempt durations.
- Run, shard, and surface phases carry stable categories; dependency phases preserve cache hit/miss; `summary.json.phaseMetrics` mirrors the event hierarchy and includes report finalization while retaining each surface's compute duration.
- Workflow contract assertions require regular GitHub test jobs to record VM schedule, checkout, dependencies, readiness, and planning into the canonical runner's phase file, and require the agreement join to publish machine-readable and Actions-summary timing.
- Blaxel provider normalization preserves restore/wake, setup cache outcome, test, and report-download phases per shard; the compact provider summary exposes the same rows without log parsing.
- A missing GitHub token/job or an unwritable post-finalization summary/sidecar emits a warning and leaves the underlying green or red result unchanged; wrapped failed commands still exit with their original failure status.
- A failed test path rooted at the Blaxel worker's `/workspace/television/` checkout becomes the same repository-relative file and test identity the coordinator would produce locally; it does not fail event finalization or retain the worker-absolute prefix.
- Combined Vitest run members use their owned-file sums for surface duration while the combined process wall appears once on the shard; the group wall is not duplicated across members.
- The [combined-project seam](sharded-execution.md#^combined-vitest-projects) proves that the recorder is active on each generated project entry, including a recovered retry.
- A real Vitest fail-then-pass fixture proves the custom runner-lifecycle recorder records two ordered attempts with separate durations even though built-in JSON contains one passed assertion; normalization uses the sidecar records rather than inferring attempts from failure messages.
- A fail-then-pass test produces every attempt, marks retries and the recovered flake on each attempt, increments file retry and recovered-flake counts, and excludes retry duration from `planningDurationMs`.
- A surface-end process leak is preserved with exact owning surfaces, process identity, executable, sockets, and cleanup outcome. It leaves native failures and recovered flakes intact, makes each owning surface infrastructure-incomplete, and increments the run's unique leak count once.
- A leak from a combined Vitest run appears once in `events.ndjson`, references every owning surface event, and is deduplicated by `leakId` when attached to each surface result.
- An interrupted native report marks its file incomplete and does not synthesize missing attempts.
- Re-normalizing identical inputs produces byte-identical `events.ndjson`.
- The event stream contains no raw output, command arguments, errors, attachments, or environment-variable data; only the allowlisted runtime facts appear.
- The spawned CLI writes summary, results, and events files for a passing run, a native test failure, and an early preflight failure, with the matching run status.
- A planned shard worker running under GitHub Actions finalizes its own run directory and retains its shard summary, plan, native results, and logs inside it.
- A repository workflow assertion pins full run-directory artifact upload on success and failure and a 30-day artifact retention period.

