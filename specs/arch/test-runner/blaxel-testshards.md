*The Blaxel shard coordinator: leasing a persistent sandbox pool, selecting the repository workers fetch, sourcing a GitHub token, preparing and locking workers, running shards with dependency-hash caching, and classifying Blaxel shard outcomes.*

# Blaxel Test Shards

Blaxel is the recommended way for agents and humans to run broad validation during development. It cuts the time a full run takes substantially — usually under three minutes, sometimes under two — which is the whole point. It works by keeping a pool of machines on hot standby, preconfigured so a run pays none of the usual setup cost: copying the container image, installing Playwright browsers, and the like. Routing runs to infrastructure like this, for speed and reliability, is also the principal reason Television has a single centralized test runner.

This spec is authoritative for the Blaxel coordinator: how it leases a persistent sandbox pool, selects the repository workers fetch and sources the GitHub token they fetch it with, prepares and locks each worker, runs the shard, caches dependencies by hash, classifies a Blaxel shard's outcome, and its options and output layout. The selected Node/npm values and `.nvmrc` authority are owned by [arch/node-versions.md](../node-versions.md). It extends the shared model in [sharded-execution.md](./sharded-execution.md); the git-safety and auth checks before dispatch are [preflight.md](./preflight.md); the canonical command surface that invokes it is [test-runner.md](./test-runner.md).

Blaxel is the only remote provider. `npm test -- blaxel <selection>` runs the coordinator `scripts/run-blaxel-testshards.mjs`; `npm test -- pool blaxel <list|ensure|delete>` manages the pool through `scripts/manage-blaxel-testshards.mjs`.

## Repository

Workers fetch the commit under test from a GitHub repository. By default it is the repository the invoking checkout calls `origin`: the remote whose branches the [remote preflight](./preflight.md#Blaxel remote preflight) requires to contain that commit. `--repo-url` names a different repository instead; it does not change the coordinator's checks against `origin`. The coordinator converts the selected URL, whether a GitHub HTTPS, `git@github.com:`, or `ssh://git@github.com/` URL, to `https://github.com/<owner>/<repository>.git` and drops any credentials embedded in it. A missing `origin`, or a selected URL that does not name a GitHub repository, fails the run before dispatch. A checkout of public Television therefore runs against the public repository, and a checkout of a private development repository runs against that repository, with no repository option.

One pool serves every repository, in any order. Each worker keeps one persistent checkout at `/workspace/television`, and the `checkout` step points that checkout's `origin` at the run's repository before fetching the commit into it. A worker that last ran another repository keeps its clone and its installed dependencies; Git transfers only the objects the checkout lacks. Dependency reuse depends only on the dependency declarations ([#Dependency-hash caching](#Dependency-hash caching)), so changing repositories reinstalls dependencies only when those declarations differ.

Repositories that share a pool share a trust boundary. A run's code can read the Git objects and ignored files that earlier runs of other repositories left in the worker's checkout, as well as the token in its own environment.

## GitHub token

Workers fetch the repository with a GitHub token, sourced from the `.blaxel-gh-token` file in the repository root first (trimmed), then the `BLAXEL_TV_GH_TOKEN` environment variable (trimmed), else none. A missing token fails the run. The token is passed to each worker as `GH_TOKEN` and consumed through `GIT_ASKPASS`; it is never written into repository files or persistent git config.

## Pool

Workers are persistent sandboxes labelled `project=television`, `purpose=testshards`, `pool=<name>`, `arch=x64`. The coordinator leases only sandboxes in the `DEPLOYED` state for the requested pool and architecture, and fails if fewer workers exist than requested shards. The shared pool size is 72 sandboxes (`DEFAULT_BLAXEL_POOL_SIZE`) and the standard run is 36 shards (`RECOMMENDED_TEST_SHARD_COUNT`), allowing two standard runs to pack exactly within the Blaxel tier's hard limit of 75 concurrent shards. Non-target runs reject any other shard count unless `--allow-shard-count-override 1` is passed. Only verified x64/Linux sandboxes are supported; a worker is verified with `uname -m` and `process.arch` before use, and any non-`x64` `--arch` is rejected.

The 36-shard default reduces the file-atomic plan's mean baseline work from 42.957 seconds at 18 shards to 21.479 seconds. Its 30-second modeled maximum is the heaviest atomic file weight rather than insufficient shard capacity. The unchanged 72-worker pool provides two independent verify lanes (`2 × 36 = 72 ≤ 75`) without oversubscribing the tier.

The pool manager `ensure` creates sandboxes named `tv-testshard-<arch>-<pool>-NN` (default pool `default`, size 72, image `blaxel/playwright-chromium:latest`, memory 8192 MB). The base image supplies the browser and system environment; its ambient Node is not part of the toolchain contract. Each fresh sandbox installs nvm from pinned release tag `v0.40.3`, installs the Node selected by the manager's repository `.nvmrc`, makes that runtime the nvm default, and verifies x64/Linux under it.

Provisioning requires an absent pool: delete the target pool before `ensure`, then let `ensure` create and provision every worker. Blaxel's `createIfNotExists` applies a creation specification only when a sandbox is absent; it does not reconcile provisioning commands or runtime state inside an existing sandbox. `ensure` therefore refuses a populated target pool, keeping provisioning fresh-only instead of carrying convergence logic for unknown nvm/Node state.

## Locking

The coordinator leases one worker per shard through an in-sandbox lock directory `/tmp/tv-testshard.lock` with an `owner.json` recording `lockId`, `runId`, shard, owner, `expiresAt`, and `acquiredAt`. Normal runs use a bounded worker pool with at most 32 concurrent lease acquisitions (`MAX_PARALLEL_LEASE_ACQUISITIONS`); the pool starts another acquisition as each active attempt settles. Each attempt retains its unique shard lock ID, validates `uname -m` and `process.arch`, and records a lease as soon as it succeeds. The coordinator waits for every requested lease before starting any shard process. If pool discovery fails, the deployed pool is undersized, or acquisition is incomplete, no shard process starts. The attempt records one infrastructure-failed result per requested shard, including whether a lease was acquired, `executionStarted: false`, the assignment, and the exact discovery, acquisition, or barrier cause. Every successful partial lease is released, and the incomplete shards remain eligible for infrastructure retry. A lock whose `expiresAt` has passed may be reclaimed.

Ordinary attempt cleanup stops a dispatched remote process when completion was not confirmed, then runs the existing owner-lifecycle reaper while retaining the lease. Its remote shell activates nvm before enabling nounset because nvm activation is not nounset-safe; strict error, pipe, and unset-variable handling remains active for the reaper body. Named Blaxel process stop is not a process-tree guarantee: the reaper uses owner tokens and revalidated process identity/group signalling to remove detached descendants. Cleanup releases the lease only when the reaper confirms no live or stale owner-token processes remain; an unreadable, inconsistent, or contaminated report fails closed and leaves the exact lock to its TTL rather than exposing a dirty worker. The reaper report is appended to the shard log as lifecycle evidence. A process whose wait completed successfully is not stopped or reaped again, preserving the normal completed-process path; a lease whose execution was never requested is only released. This ordering prevents a timed-out or transport-failed process or descendant from continuing in an unlocked persistent sandbox while keeping completed and pre-dispatch cleanup unchanged.

On `SIGINT` or `SIGTERM` while an attempt exists, the attempt becomes interrupted even if its shard promises have all just completed. Completed shard results remain intact. An unfinished shard retains downloaded summaries, native results, task artifacts, parsed task evidence, assignments, collections, and logs, and records `interrupted/coordinator-interruption` plus its known lease and execution state. A pending shard has no synthetic task result. A dispatched process whose start is unconfirmed omits `executionStarted`; absence means unknown, while `false` means execution was not requested. The coordinator makes this interrupted snapshot authoritative before cleanup, stops running shard processes, applies the same owner-confirmation boundary before releasing each known lease, and ensures cleanup cannot replace it with an ordinary completion report. A report-write failure does not suppress lease and process cleanup. A cleanup that cannot confirm zero owners retains its lock until TTL. The first signal exits 130 after cleanup; a second signal exits immediately, with lock expiry as the final bound. A signal handled before the first attempt has no shard result to preserve; the canonical runner treats the absent provider evidence as incomplete when it receives the coordinator exit. Console summaries name only retained log files.

## Shard lifecycle

After acquiring the complete batch, the coordinator uploads each shard's plan and worker script before starting its remote process. A rejected upload returns an infrastructure-failed shard result with the sandbox, assignment, and `transport/worker-dispatch` cause; it cannot reject the whole attempt without a report.

Each shard runs a script on its worker whose steps are recorded as setup timings: `checkout` (clone if the worker has no checkout, point `origin` at the run's repository, then fetch and hard-reset to the commit), `runtime-activation`, `runtime-versions`, `deps`, `system-deps` (`xauth`, `libgtk-3-0`, and `iproute2` for `ss`), `owner-lifecycle`, `playwright-cache`, `electron-repair`, then `test-run`. The `electron-repair` phase invokes the installed Electron package's own `install.js` with `/cache/electron` as its archive cache. Electron's installer reuses a complete runtime or prepares an absent one; the phase carries no separate download/extraction implementation and does not delete runtime files. ^blaxel-electron-repair After checkout, `runtime-activation` loads the provisioned nvm and runs `nvm use` from the checked-out `.nvmrc`; it does not run a second version checker or install/repair a runtime. All dependency, repair, and test commands inherit the activated Node/npm path. The `system-deps` step asserts these tools on every lease and installs the package set when any prerequisite is absent. `owner-lifecycle` leaves live-supervisor tokens untouched, reaps stale token-bearing groups with revalidated TERM/KILL, and fails before `test-run` whenever it found contamination. That sandbox is excluded from every later attempt by the coordinator. A configured infrastructure retry may run the shard on a different sandbox, whose own lease and owner audit must pass before `test-run`; without an exact contaminated-sandbox identity or enough distinct clean capacity, the shard remains infrastructure-failed. The test run is `scripts/run-test-shard.mjs` ([sharded-execution.md](./sharded-execution.md)) for suite and selection runs, or a single targeted command for a `target` run. A target executes its registry-declared `preCommand` and then its registry `command` when one is declared, otherwise its native runner, inside one surface process scope carrying the selected surface ID and owner token. Selectors, retry arguments, and the native JSON reporter are forwarded through a declared command, so wrappers such as the headless-Linux Electron launcher remain active remotely. It always writes a target shard summary after `test-run`, including native results and any normalized process leaks, so a native test failure is classified as `failed` rather than a setup failure. The worker exports `CI=1` and `TEST_RETRIES`, so child runners see the `FLAKY_TEST_RETRIES` default ([flaky-tests.md](./flaky-tests.md)).

If a setup step fails before the test run and no shard summary was produced, the worker synthesizes an `infra-failed` shard summary naming the failed step (`checkout` failures are reported distinctly). Native result paths rooted at the worker checkout (`/workspace/television`) are normalized to repository-relative paths after download.

### Dependency-hash caching

The `deps` step hashes the tracked root `.nvmrc`, `package-lock.json`, root `package.json`, and workspace `*/package.json` files into a marker `/cache/blaxel-testshards/deps-<hash>.ok`. `.nvmrc` carries the Node selector, while the root manifest carries the declared Node/npm ranges; changing either toolchain declaration therefore invalidates dependency state. With the marker present and `node_modules` in place the step is a cache hit; otherwise it runs `npm ci --prefer-offline --no-audit --fund=false` under the activated runtime and rewrites the marker.

## Classification

A Blaxel shard is classified `passed`, `failed`, or `infra-failed` from its worker exit, readable shard summary, and recorded setup timings:

- A known nonzero exit whose setup timings show a failed step *before* `test-run` is `infra-failed`.
- No readable shard summary is `infra-failed`, even when setup timings show that `test-run` was reached. Reaching the command does not establish a test result.
- A summary with `status: "passed"` and worker exit `0` is `passed`.
- A summary with `status: "passed"` and a known nonzero worker exit is a self-contradictory `failed` result. It is not retried. Its `result-report/summary-validation` provider result is infrastructure-incomplete after normalization, making the run incomplete and its test status unknown without inventing a failed test.
- A summary with `status: "passed"` but no known worker exit is `infra-failed` because completion is unconfirmed.
- A summary declaring `status: "failed"` is `failed`; a summary declaring `status: "infra-failed"` or an unsupported status is `infra-failed`.

This realizes the infrastructure-vs-test distinction from [sharded-execution.md](./sharded-execution.md) for Blaxel. After download, the coordinator also validates the summary's plan ID, timing provider, tested commit/tree, index/total, and assigned/collected files against the provider plan. Any identity disagreement overrides the classifier result to `infra-failed` with `failureKind` and `failureStep` set to `plan-validation`.

The coordinator attributes failures through remote wait and final log capture to `worker-execution`; a matching worker deadline is `timeout` and other coordinator errors are `transport`. After report retrieval begins, failures while retaining the summary and artifacts are `transport/report-download`. Either path preserves any result progress already downloaded before the failure.

`stale-owner` fails closed at the sandbox boundary. The contaminated sandbox runs no selected test, is excluded from every later attempt by that coordinator, and retains its failed-attempt evidence. A configured infrastructure retry may use a different sandbox only after that sandbox acquires its own lease and passes its owner audit. If no distinct clean sandbox is available, the shard remains infrastructure-failed. Attempt files and final provider-report construction preserve the contaminated attempt and follow [sharded-execution.md](./sharded-execution.md).

## Options

The coordinator's option set, with code-true defaults. The canonical runner ([test-runner.md](./test-runner.md)) overrides some of these, noted inline.

| Option | Default | Notes |
|---|---|---|
| `--suite` | `all` | `all` \| `unit` \| `e2e` \| `target` \| `selection`. |
| `--surfaces` | — | required for `--suite selection`. |
| `--shards` | `36` | other counts rejected unless `--allow-shard-count-override 1` (non-target). |
| `--shard-indices` | all | run a subset while preserving the total. |
| `--pool` | `default` | the canonical runner passes `poc`. |
| `--arch` | `x64` | other values rejected. |
| `--commit` | `HEAD` | the committed revision to test. |
| `--timeout-profile` | `normal` | the canonical runner passes `cold`. See drift note below. |
| `--worker-timeout-seconds`, `--lock-ttl-seconds` | per profile | override the profile values. |
| `--retry-infra` | `0` | the canonical runner passes `2`. |
| `--allow-dirty` | off | dispatch from a dirty tree, ignoring local edits. The canonical runner's `--ignore-uncommitted` is translated to this. |
| `--test-retries` | `0` | non-unit retry count passed to the worker. |
| `--repo-url` | the checkout's `origin` as a GitHub HTTPS URL | repository fetched in the sandbox ([#Repository](#Repository)). |
| `--playwright-browsers-path` | `/home/playwright/.cache/ms-playwright` | browser cache path. |
| `--output-dir` | `.blaxel-testshards/latest` | run output location. |
| `--audit-stale-owners` | off | lease one worker, install/check system prerequisites, run the read-only stale-owner diagnostic, print its JSON result, and release the lease without dispatching tests. It may be combined only with `--pool` and `--arch`. |

Timeout profiles (code-true): `normal` = worker 240 s, lock TTL 900 s; `cold` = worker 480 s, lock TTL 1200 s; `repair` = worker 480 s, lock TTL 1200 s.

**Default profile.** The coordinator's own default timeout profile is `normal`, but the canonical runner invokes Blaxel with `--timeout-profile cold`, so a `npm test -- blaxel` run uses `cold` unless overridden.

## Output

The run output directory (default `.blaxel-testshards/latest`) contains `request.json`, combined `report.json`, compact `summary.json`, and any retained per-shard `shard-<i>.log` and `shard-<i>.json` files ([sharded-execution.md](./sharded-execution.md)). A path is exposed only after its local file is retained; shards that never produced a log or result do not advertise an inferred filename. Planned suite runs also contain `shard-plan.json`. Completed shard downloads add `setup-shard-<i>.json` and, when the worker produced it, top-level `native-shard-<i>.json`. Per-surface native reports, Vitest attempt sidecars, lifecycle results, process-leak results, and generated runner inputs are downloaded under `artifacts/shard-<i>/`, preserving their worker-relative paths. Infrastructure retries write `attempt-<n>/` subdirectories with the same applicable layout. Each shard summary exposes normalized restore/wake, checkout, dependency cache hit/miss, system setup, readiness, test-compute, and report-download phases; the coordinator prints those rows and passes them into the canonical run events and summary. Ordinary completion exits `0` only for a passed combined report and `1` for a failed report. A handled `SIGINT` or `SIGTERM` exits `130`; when an attempt exists it writes the interrupted provider report first. When the canonical runner receives that coordinator exit, it finalizes the normalized incomplete run and propagates `130`.

## Operations

### Local setup

Running Blaxel shards requires a Blaxel account with the CLI logged in:

```bash
brew install blaxel
bl login
```

The GitHub token the workers use is obtained from the corporate 1Password item **“Television Blaxel sharded test runner github PAT”**. The token supplied for a run must be able to read that run's repository, so a token shared by checkouts of several repositories needs access to each of them. Make it available either by exporting `BLAXEL_TV_GH_TOKEN` (which works across all worktrees) or by writing it to a `.blaxel-gh-token` file in the repository root; the runner's read precedence is in [#GitHub token](#GitHub token). Creating `~/.tvdev-use-blaxel` opts into Blaxel-preferred broad verification ([test-runner.md](./test-runner.md)).

### Pool provisioning

The canonical runner uses pool `poc`. Provision it by deleting the complete pool with `npm test -- pool blaxel delete --pool poc`, then recreating all 72 fresh workers with `npm test -- pool blaxel ensure --pool poc` ([#Pool](#Pool)). Use `list --pool poc` only for inspection. `ensure` refuses a populated pool and intentionally does not reconcile existing runtime state. A bare command targets the manager's `default` pool, which the canonical runner does not use.

### Opt-in local suite exclusions

The `telemetry-posthog-roundtrip` and `daemon-acceptance` suites are excluded from `all`, so Blaxel broad verification (`npm run verify -- blaxel`, which delegates `--suite all`) runs neither. Blaxel workers do not receive the PostHog test read key; run the local telemetry PostHog roundtrip suite when validating telemetry delivery changes, using [its authoritative setup](../telemetry/sink.md#real-posthog-integration-test-surface). The daemon acceptance suite deliberately replaces a host's active global `tv` package and literal production user service, so it runs only on an explicitly acknowledged designated developer host under [its local-suite contract](./test-runner.md#production-daemon-acceptance-suite), never as remote broad verification.

## Testing

Under the testing policy's [rule for integration against paid services or complex host dependencies](../testing-policy.md#integration-against-paid-services-or-complex-host-dependencies-is-important), a change that could affect the Blaxel coordinator's remote operations requires evidence from a live Blaxel run before it reaches main. One targeted shard run (`--suite target`) is sufficient. The run must call the real Blaxel API and communicate with the remote process through the real transport. It must exercise worker leasing, the lock protocol, and architecture validation. It must also exercise checkout, runtime and dependency setup, streaming logs, and result download. Recorded responses cannot replace this live evidence.

`--suite target` is not sufficient for a change that affects plan transfer; [sharded-execution.md's Testing section](./sharded-execution.md#Testing) defines the required evidence.

A change to pool provisioning or runtime selection requires the live run to use freshly recreated `poc` workers, since `ensure` refuses a populated pool ([#Pool](#Pool)).

A change to repository selection, or to how a worker's checkout moves between repositories, requires live runs from checkouts of two repositories on the same pool, including a run on workers whose checkout last served the other repository.

