*How the promises in Sharded Execution are proven.*

# Sharded Execution — proof

Proves [specs/arch/test-runner/sharded-execution.md](../../../specs/arch/test-runner/sharded-execution.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Test hooks


`resolveTimingProvider` accepts `env` to supply the process environment, `platform` to supply the operating system, `arch` to supply the CPU architecture, and `logicalCpuCount` to supply the host's logical-CPU count. Production uses `process.env`, `process.platform`, `process.arch`, and `os.availableParallelism()`.

`readTimingBaseline` accepts `repoRoot` to select the workspace containing the baseline. `updateTimingBaseline` accepts `repoRoot` to select the workspace whose `.test-runs/` directories feed the rollup and whose baseline it replaces. `enumerateTrackedPaths` and `enumerateTestInventory` accept `repoRoot` to select the Git inventory, while `loadRegistrySnapshotAtCommit` accepts it to select the repository containing the registry snapshot. Production uses the current repository.

`TEST_SHARD_CONFIG_MODULE` supplies an alternate `TestConfig` module to the planned shard worker so tests can exercise controlled surfaces. The worker honors it only with `TV_TEST_RUNNER_SELFTEST=1`, as defined by [test-runner.md's Test hooks](./test-runner.md#Test hooks). Production leaves `TEST_SHARD_CONFIG_MODULE` unset and loads the committed `test.config.mjs` registry.

`runInfrastructureAttempts` accepts `runAttempt` to execute the current shard subset, `onAttempt` to retain each `AttemptReport`, and `onRetry` to report the next retry subset. The production Blaxel coordinator supplies its remote attempt runner, report accumulator, and retry logger. Under the testing policy's [mocking policy](../../../specs/arch/testing-policy.md#Mocking policy), replacing `runAttempt` proves retry selection but not Blaxel dispatch; recording `onAttempt` and `onRetry` proves the callback order.

## Assertions

### Test assertions

Planner and baseline assertions are **contract tests** over temporary registries, temporary run directories, and native-report fixtures. Runner-adapter assertions are **seam tests** that launch the real installed Vitest or Playwright process with small committed fixture files. Provider dispatch remains an opt-in live integration boundary.

- Baseline update reads the temporary checkout's `.test-runs/` directories, uses only complete-`all` Blaxel runs while ignoring local, GitHub, and file-, grep-, or suite-narrowed Blaxel runs, calculates the specified medians and counters, drops unowned and deleted files, sets `sourceThrough` from the input runs, writes canonical byte-stable JSON under the Blaxel key, and leaves the file unchanged in `--dry-run` mode.
- Blaxel runs that keep the `all` label but narrowed their surfaces, ran a shard subset, ended `incomplete`, or skipped an assigned surface are not input runs: with only such runs present the update fails and the committed baseline, including files those runs never executed, stays byte-identical. A complete multi-shard run and a complete run whose tests failed still contribute.
- With no input runs, baseline update fails and leaves the committed baseline unchanged. The exact empty baseline remains valid planner input: planning over it gives every file the 60-second unknown weight, while a missing or malformed baseline fails.
- A GitHub CI process invoking the local command records the workflow-supplied GitHub timing provider; a missing or `local-*` timing-provider input fails initialization.
- An unreadable run event, a Blaxel `all` candidate whose event stream fails validation, and a baseline path whose current owner disagrees all fail without a partial write.
- The same inventory, baseline, timing provider, commit/tree, and shard count produce byte-identical plans and the same plan ID across repeated processes.
- LPT assignment follows the descending-weight, least-loaded-bin, and tie-break rules exactly; every selected file appears once, every selected surface appears in each shard, and predicted totals equal assigned weights.
- A plan for any timing provider weighs a known file by its Blaxel median, and a baseline entry keyed by another timing provider is rejected. Unknown files receive the exact p90-based or 60-second fallback with their source recorded.
- Inventory enumeration over a checked-out target and a temporary index loaded from that same target produces identical normalized paths. Canonical test files inside registered roots with zero or multiple registry owners fail planning; untracked files and files outside registered roots or selected owners are absent.
- Real Vitest and Playwright invocations collect every assigned path exactly once and no other path; config rejection, substring broadening, and normalized-identity mismatch fail the shard.
- A real combined Vitest invocation runs only two explicitly assigned files owned by different unit surfaces and reports both files. The shared `vitestProjectsArgs` handoff writes its `test.projects` config and builds the Vitest command prefix for both local and sharded runs. The fixture configs omit their own root, so collection depends on the generated project roots. Both projects record attempts, including two ordered attempts for a deliberate fail-then-pass case enabled for this run; normalization attributes one recovered flake to its owning surface and none to the other surface. This is a seam through the real generated config, installed Vitest and per-project recorder, with no mocks. A fixture whose path makes another positional filter ambiguous is rejected before Vitest starts. Proves [combined execution](../../../specs/arch/test-runner/test-runner.md#Surface process lifecycle), [attempt recording](../../../specs/arch/test-runner/reporting.md#^vitest-attempt-recording) and [explicit file execution](../../../specs/arch/test-runner/sharded-execution.md#Explicit file execution). Evidence: `test/repo/test-runner-shard-worker.test.ts`. ^combined-vitest-projects
- A real Playwright invocation using a generated `--test-list` runs all tests in two assigned files, including a fixture path containing regular-expression punctuation, and runs no unassigned file.
- Planned-worker command construction appends the generated Playwright test list unchanged to a registry-declared Playwright command. The committed real-runner seam covers the default Playwright command; invoking the Electron wrapper with a generated list remains a boundary gap.
- A shard with no assigned files for a surface does not execute its pre-command or runner; a real sentinel-writing pre-command proves the process boundary was not crossed.
- With assigned files, `--skip-pre-commands` and `TEST_SHARD_SKIP_PRECOMMANDS=1` each suppress a real sentinel-writing pre-command while the runner still executes; without either input, the pre-command executes. A missing prebuilt artifact fails in the runner and does not trigger a fallback build.
- A collected-file mismatch is infrastructure-incomplete and cannot report a passing empty shard.
- Fail-fast preserves every assigned-but-not-run task as skipped through the shard summary and provider normalization.
- Infrastructure retries preserve the plan ID and assignments; combining attempts rejects a changed plan.
- The GitHub join accepts one complete set of shard summaries with equal plan ID, timing provider, tested tree, and total; it rejects a changed plan, duplicate or missing index, and assigned-versus-collected mismatch even when every shard process exited zero.
- A shard task carrying a process leak remains a non-retryable failed shard, propagates the complete leak record to each owning normalized surface, and emits one durable process-leak event without dropping native failures or recovered flakes.
- Provider normalization merges assigned parts, ignores `not-assigned` parts for counts, durations, and leaks, and emits the complete timing-event hierarchy.
- Shard-count recommendations select the smallest simulated count under 120 seconds, obey the supplied capacity, and flag an atomic file over target. The baseline update reports only the Blaxel recommendation, simulated up to the Blaxel pool size.

**Boundary statement:** real local runner processes prove explicit file selection for Vitest and the default Playwright command, report shape, and join logic. They do not prove that the Electron wrapper consumes a generated Playwright list, that a Blaxel worker accepts the transferred plan, or that independently started GitHub matrix jobs derive the same plan on hosted machines. Live Electron, Blaxel, and GitHub runs must validate those execution boundaries before activation.

