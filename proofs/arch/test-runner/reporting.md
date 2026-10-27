*How the promises in Reporting are proven.*

# Reporting — proof

Proves [specs/arch/test-runner/reporting.md](../../../specs/arch/test-runner/reporting.md).

## Coverage model

Native-report contracts carry normalization breadth; real native-runner and CLI crossings carry attempt capture and final output. The existing declarations below name those boundaries.

Resource diagnostics compose a bounded writer contract, a real Linux probe/parent-lifecycle seam, and the dedicated Blaxel acceptances owned by [the provider proof](blaxel-testshards.md#Lease, recovery, and scratch). A small native failure and a recovered retry establish retained evidence; they do not reproduce resource exhaustion. Authored unavailable/reset/oversized probe inputs cover uncommon diagnostic failures without filling a disk or causing an OOM kill. Those mocks forfeit kernel reading and transport to the real seams.

Planned and targeted execution both cross parent capture and download. The same sidecars pass through provider normalization and attempt history; a recovered infrastructure attempt must not replace earlier evidence. Recovery receipts are observed in the provider's crash acceptance, not a duplicate crash here. No test claims start/end samples measure a peak or that an unavailable kernel log excludes OOM. The new resource assertions remain pending until implemented and run.

## Test hooks


`createRunId` accepts `now` to supply the start time, `pid` to supply the process ID, and `randomBytes` to supply the random suffix; `createRunContext` forwards those controls and accepts `root` to select the run-directory parent and `env` to supply the environment the timing-provider rule reads ([sharded-execution.md](../../../specs/arch/test-runner/sharded-execution.md)). Production uses the current time, process ID, cryptographic random bytes, repository root, and `process.env`. `readRunDirectoryIdentity` accepts `root` to select the workspace whose `.test-runs/` directory the identity file must name a direct child of; production uses the current workspace.

`TV_VITEST_ATTEMPT_FILE` supplies the NDJSON output path to the production Vitest attempt recorder. The canonical runner and the planned shard worker set it to the current native run's attempt-result path. A Vitest invocation that configures the recorder outside those entrypoints must set it; the recorder fails without it.

The resource collector accepts a probe reader and clock; contract tests provide authored readings/errors and times, while production reads Linux counters, memory information and filesystem statistics at the current time. The writer accepts an output root and write operation; tests use disposable directories and may inject a write failure, while production writes into the current results tree. Local parent/child seam fixtures use the runner’s existing guarded registry hook, not a replacement reporter or fabricated native result. That hook is not forwarded to Blaxel workers.

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

### Resource diagnostics

- **Contract — bounded, honest observations.** The collector/writer consumes authored start/end memory, filesystem, OOM-counter and kernel-line readings, including unavailable probes, a counter reset and over-budget excerpts, and writes real files in a temporary results root. Under [resource diagnostics](../../../specs/arch/test-runner/reporting.md#^resource-diagnostics) and [bounds](../../../specs/arch/test-runner/reporting.md#^resource-diagnostic-bounds), values keep units/time, unknowns keep reasons rather than zero, and resets produce no negative OOM delta. A failed native attempt, even if later recovered, or incomplete execution requests the interval's kernel evidence. The bounded reader/writer retains at most 64 KiB of kernel lines and 128 KiB per sidecar, and 8 MiB total per shard attempt including receipts; compact start/end evidence survives before optional excerpts, with explicit truncation. Only allowed fields are serialized: supplied credential, query/body, environment and argument sentinels do not appear. Injected probe and write failures warn without changing the original native outcome. Mock readings/write failures forfeit OS reading to the parent seam and actual download to the live assertion below. (test to be written) ^reporting-t-resource-bounds

- **Seam — parent capture survives the child.** The production surface parent crosses real Linux procfs/filesystem probes and an installed native runner's child-process boundary in a disposable results root. Authored tiny native fixture tests produce a failure/retry and an exit before native output; both planned-worker and targeted execution wiring are exercised. The retained baseline exists before preparation begins and the final observation follows teardown; a terminated child cannot erase the baseline. A separate interrupted-parent fixture leaves the baseline with an explicitly missing final observation rather than invented zeroes. Real probe values are checked for their source/units and availability reasons, not exact memory totals. No kernel OOM is manufactured; inaccessible kernel evidence must remain unknown. No mechanisms are mocked. This proves the capture boundary in [resource diagnostics](../../../specs/arch/test-runner/reporting.md#^resource-diagnostics); the live assertion carries remote retrieval. (test to be written) ^reporting-t-resource-parent

- **Contract — retained links and attempt history.** Provider normalization and infrastructure-attempt aggregation consume authored shard/task envelopes referring to real temporary sidecar files, with recorded native failed/recovered fixtures. Under [normalized results](../../../specs/arch/test-runner/reporting.md#Normalized surface result) and [resource diagnostics](../../../specs/arch/test-runner/reporting.md#Resource diagnostics), each advertised `resourceDiagnosticsPaths` entry exists relative to the final run directory; earlier attempt evidence survives a later successful infrastructure attempt. Missing native output remains incomplete and cannot manufacture a selected-surface result. Samples and kernel excerpts appear in neither compact console output nor timing events. Mocked provider envelopes forfeit remote creation/download to the live assertion; recorded native inputs forfeit attempt capture to the real parent seam and existing native-recorder assertions above. (test to be written) ^reporting-t-resource-links

- **Acceptance — evidence reaches the caller.** Share the dedicated-pool canonical CLI runs in [the provider retrieval acceptance](blaxel-testshards.md#^blaxel-t-retrieval), with a committed fail-once native fixture that recovers under the default retry budget and a fixture that fails all attempts. Planned and targeted runs retain the native outcomes and their start/end sidecars after worker scratch is removed; every normalized diagnostic link opens a downloaded file with the correct run/shard/surface identity and native-attempt references. The failed run still fails, the recovered case retains both attempts, and any inaccessible kernel evidence says so. The provider's [crash acceptance](blaxel-testshards.md#^blaxel-t-recovery-live) supplies the downloaded recovery receipt and its disclosed report loss. Boundary: real CLI, Blaxel API, native runners and report files, with the provider proof's scheduling hook and no mocks. This proves [resource retention](../../../specs/arch/test-runner/reporting.md#Resource diagnostics) end to end without a resource-exhaustion experiment. (test to be written) ^reporting-t-resource-live
