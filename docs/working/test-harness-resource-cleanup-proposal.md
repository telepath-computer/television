# Test-harness resource cleanup

Proposal for independent review. Owner: rose. Base: `origin/main` at `b5477211`. Branch: `thopter/test-harness-resource-cleanup`. The supervisor arranges independent review of the proposal, specs, proofs, and implementation; Josh reviews every spec delta at PR time. No production behavior changes are proposed.

## Problem and intended result

Repeated unbundled application loads can consume several GiB of Chromium response-buffer memory. Persistent Blaxel workers also retain temporary test runtimes across runs, reducing the memory and filesystem capacity available to browsers. The [investigation](chromium-insufficient-resources.md) establishes renderer OOM kills and reproduces `ERR_INSUFFICIENT_RESOURCES`; the exact failing allocation syscall remains unobserved.

This contribution gives generated test files an owner and a cleanup boundary, runs suitable product acceptances against the built application, and retains compact resource evidence when an acceptance attempt fails. A worker should start its next shard without accumulating the preceding shard's disposable files. Cleanup must preserve active jobs, provider services, deliberate dependency caches, and the evidence still being retrieved by a coordinator.

PR #9 owns the built-application conversion of **“executable theme reset reloads connected Chromium documents under confirmed state.”** This branch leaves that test body to PR #9. Its existing failure is useful investigation evidence, not an obligation to duplicate that fix here.

## Evidence available before implementation

The investigation report and its evidence were copied from `33ad4184`. Additional read-only inspections on 2026-10-01 observed:

| Observation | `poc-131`, the original failing worker | `poc-03`, the GC experiment's worker |
| --- | ---: | ---: |
| Source-CLI runtime directories | 267 | 17 |
| Source-CLI runtimes, allocated bytes | 1,059,090,432 | 55,930,880 |
| Versioned web-bundle directories | 146 | 27 |
| Versioned web bundles, allocated bytes | 104,255,488 | 22,622,208 |
| Total `/tmp`, allocated bytes | 1,197,846,528 | 156,442,624 |
| Root filesystem available bytes at inventory | 2,137,575,424 | 3,700,719,616 |
| Active shard lock / test owner tokens | None observed | None observed |

The [poc-131 inventory](test-harness-resource-cleanup-evidence/tv-testshard-x64-poc-131.json), [poc-03 inventory](test-harness-resource-cleanup-evidence/tv-testshard-x64-poc-03.json), and their [poc-131 sizes](test-harness-resource-cleanup-evidence/tv-testshard-x64-poc-131-sizes.json) / [poc-03 sizes](test-harness-resource-cleanup-evidence/tv-testshard-x64-poc-03-sizes.json) retain the measurements and collection methods. These are later snapshots, not reconstructions of the failed run. Inventory read filenames, process identities, relevant ownership tokens, and `/tmp` descriptor targets; it did not read fixture credentials or arbitrary process environments into artifacts. Size measurements used `du -B1 --max-depth=1 /tmp`. An earlier `du -x` attempt omitted file storage on this sandbox mount and was discarded.

There are two proven helper leaks:

- [`getSourceCLIEntry()`](../../test/helpers/product-server.ts) caches a path in module state after creating `television-source-cli-e2e-*`. Its cache is assigned before the build succeeds. `disposeAllProductServers()` removes per-launch homes and bundled copies, but has no cleanup for this shared runtime.
- [`buildVersionedWebBundle()`](../../test/helpers/versioned-web-bundle.ts) caches one promise per version and creates `television-web-bundle-*`, with no removal on worker completion or build failure. This is additional evidence supporting run-owned scratch space. Its worker cleanup belongs in the same contribution: it is another concrete cached test build, not a hypothetical extension.

Other `/tmp` entries include Playwright artifacts and transform caches, Node's compile cache, `tsx` caches, Chromium temporary files, X11 state, an `xvfb-run` authority directory, the Git askpass helper, hundreds of uploaded shard scripts, test-runner fixtures, and `multipart-uploads`. The idle process tables include Blaxel's `sandbox-api`, `ukp-fs`, and entrypoint processes. The precise owner of every miscellaneous entry was not established; in particular, the upload directory must be treated as outside Television's disposal ownership. Neither idle snapshot had an open `/tmp` descriptor or cwd reference, which establishes only those instants.

## Can we clean `/tmp` safely?

**Yes, for temporary files whose ownership and lifetime the runner establishes. A blanket deletion of `/tmp` is unsafe.** The worker lease itself lives there, as do provider and display infrastructure. Name prefixes or age alone do not establish that a file is unused.

### Concurrency and the present lease boundary

The canonical coordinator intends one shard job per sandbox. [`acquireAny()` and `lockCommand()`](../../scripts/run-blaxel-testshards.mjs) acquire `/tmp/tv-testshard.lock`; another coordinator skips an unexpired lock. A normal broad run uses separate workers for its shards. Within a shard, surface tasks execute sequentially, but a surface can have several test workers and many child processes. For example, the browser-app surface uses two Playwright workers on CI; browser-app-real-stack uses one.

This is not evidence that a sandbox can never have overlapping jobs:

1. Lock expiry currently allows reclamation based on time alone. The lock records the coordinator's host/PID, not the remote shard supervisor's live identity. Setup processes are not all covered by surface owner tokens. The stale-owner reaper deliberately leaves live-supervisor tokens alone and can exit successfully with `liveOwners` present.
2. The shard shell's `EXIT` trap releases its lock before `runShard()` downloads results from the fixed `/workspace/television/.testshards/results` directory. A following job can reset those files while the prior coordinator reads them.
3. Direct Blaxel process API calls are not serialized by this repository lock. The read-only inventory itself used that API. The inspection found no overlapping test jobs, but does not establish a history-wide absence of overlap.

The proposal therefore extends the existing lease boundary as part of cleanup. The coordinator retains its lease through result retrieval and disposal, and the worker does not independently unlock at shell exit. Lease reclamation and remote dispatch must confirm ownership and the absence of a live prior shard supervisor using process start identity, including setup. An expired timestamp alone cannot authorize deleting that job's files or starting a second checkout. Acquisition/reclamation/release must preserve exclusive ownership under racing coordinators. An ambiguous owner or failed process inspection keeps the worker unavailable and reports infrastructure failure. Existing stale-process attribution and TERM/KILL cleanup remain the mechanism for abandoned descendants.

This is a narrowly required correction to worker ownership, not a redesign of shard scheduling or a change to retry budgets. No observed Chromium failure has been attributed to these lease races.

### A directory for each shard attempt

Give every leased shard **attempt** a fresh, short, private directory beneath a runner-owned root, for example `/tmp/tv-testshards/<random-id>/`. Record its run, shard, attempt, lease identity, and remote supervisor PID/start identity outside its disposable `tmp/` child. Use a short path because browser and Electron processes can create Unix sockets with limited pathname length.

Export an absolute `TMPDIR` pointing to that child before running preparation and test commands. Keep scripts, plans, askpass, and setup sidecars within the attempt directory as well. Preserve `TMPDIR` through child environments. Continue to keep deliberately persistent npm, Electron, browser-download, and dependency-hash caches at their existing locations outside scratch space. Playwright's transform cache may become attempt-local initially; measure any resulting setup cost before deciding it deserves a separately bounded persistent cache.

The mechanism is supported by both source and installed dependencies:

- On non-Windows systems, [Node's `os.tmpdir()`](https://nodejs.org/api/os.html#ostmpdir) checks `TMPDIR` before `TMP`, `TEMP`, and `/tmp`. Both cached build helpers use `os.tmpdir()`.
- [Chromium 148's `GetShmemTempDir()` and `GetTempDir()`](https://github.com/chromium/chromium/blob/148.0.7778.96/base/files/file_util_posix.cc#L1283-L1302) select the temporary directory when `--disable-dev-shm-usage` is present; `GetTempDir()` reads `TMPDIR`. The investigation observed this flag in the actual browser launch.
- Installed Playwright 1.58.2 uses `os.tmpdir()` for browser profiles and artifact directories in `playwright-core/lib/server/browserType.js`, inherits the parent environment by default, and includes that Chromium flag. Its transform cache also defaults to `os.tmpdir()`.

This establishes the intended wiring; a live Blaxel test must still observe Node-created paths and actual Chromium shared-memory descriptor paths under the attempt directory. We have not run that check at the proposal stage. Setting `TMPDIR` cannot relocate hard-coded `/tmp` paths or X11's global socket directory; the runner's explicit temporary paths must be moved deliberately, and external infrastructure remains untouched. Chromium also unlinks shared-memory files while holding them open, so directory deletion cannot substitute for stopping the owning processes.

Cleanup follows three ownership boundaries:

1. **Before an attempt:** after exclusive ownership and the process audit are established, reclaim earlier runner-owned attempt directories whose recorded supervisors and descendants are gone. Revalidate ownership before removal, reject unexpected directory/symlink layouts, and stay inside the dedicated namespace. Keep live or uncertain owners untouched. Create this attempt's directory fresh instead of deleting a guessed path in advance.
2. **After execution:** finalize resource evidence outside disposable scratch, complete process teardown, then remove that attempt's scratch. Failure, timeout, and interruption use the same ordering. The coordinator's existing unconfirmed-execution path must confirm process cleanup before it removes scratch or releases the lease.
3. **After retrieval:** remove retained worker reports only after download completes, then release the matching lease. Keep artifact paths specific to the attempt so a lost lease cannot make a coordinator read a different job's report. A killed coordinator can leave a directory; the next safe lease reclaims it through the same ownership check. It does not need a separate cleanup daemon.

Runner reports should use an attempt-specific directory that survives checkout reset. The coordinator already validates artifact roots; extend that check to the exact root it allocated, rather than accepting arbitrary paths advertised by a worker. This removes the fixed-results-directory race while retaining current normalized report identities.

### Files that predate ownership metadata

Existing `television-source-cli-e2e-*` and `television-web-bundle-*` directories lack a reliable recorded owner. Routine new-run cleanup will not infer one from a prefix. For the initial rollout, use a **drained worker under an exclusive maintenance lease**, with no executing shard or other consumer, to inventory and remove only these verified generated runtime trees. Check directory type, owner, and expected runtime/build layout; preserve unrelated `/tmp` entries and deliberate caches. A worker that cannot be established idle is skipped. Where a worker's contents or active owners cannot be established, drain and reprovision it through the existing pool procedure instead of widening deletion.

This one-time operation needs coordination with whoever is dispatching runs, since older coordinators still use the present lease protocol. It should be performed after the new protocol has converged and old jobs have drained. This proposal authorizes no immediate deletion on the shared pool; none has been done. The normal before/after cleanup covers future runs regardless of which helper created their temporary files.

## Worker lifetime for cached runtimes

Keep one lazily built source-CLI runtime per test worker and reuse it across launches and test cases. Publish the cached entry only after the build and asset installation succeed. A partial build removes its own directory and leaves the cache retryable. Apply the equivalent ownership rule to the cached versioned web bundles, retaining their per-version reuse.

Test cleanup continues to stop each case's product servers promptly. Worker teardown then stops any remaining servers and removes the shared cached runtime and versioned bundles. Cleanup is idempotent and waits for pending builds before removing their outputs. The worker teardown must cover both the shared Playwright registration helper and the Vitest callers; a per-test deletion would discard reuse and add unnecessary builds. A failed server teardown cannot justify removing files beneath a surviving server. The outer shard's process ownership and scratch cleanup provide the backstop when a worker is killed and cannot execute its own teardown.

The relevant entry points are `test/helpers/playwright.ts`, the two cached build helpers, and the Node/Vitest callers of those helpers. The design should use the runners' existing teardown facilities rather than a general-purpose cleanup registry. Failure during a per-launch runtime copy must also dispose that copy and its newly created home: the current bundle preparation occurs before the launch disposer is registered.

## Built application for product acceptances

Use the already-built web application served by `ProductServer`. Existing registry pre-commands build the web and artifact documents before both browser-app surfaces, and `installProductRuntimeAssets()` already copies the application index and assets. Preserve the tests' assertions, real browser behavior, CSS-motion declarations, authentication, and server lifecycle.

The proposed conversion set is the browser product walks using `ProductServer.appURL()`:

| Tests under `packages/web/test/e2e/` | Reason and boundary |
| --- | --- |
| `channel-product.test.ts`, `channel-crud.test.ts`, `channel-sidebar-remote.test.ts`, `channel-switcher-context-menu.test.ts` | Real channel actions, shared state, drag behavior, and document continuity; no claim about Vite modules. |
| `tab-pages.test.ts`, `keyboard-navigation-product.test.ts`, `artifact-view-wheel.test.ts` | Browser product behavior and real artifact frames. |
| Product-server walks in `top-bar.test.ts` and `auth.01.test.ts` | Built-shell selection, creation, and token behavior. Keep their component fixtures and separate endpoint tests in their current harnesses. |
| `browser-demo-mode.test.ts` | Real server marker and artifact navigation; built loading preserves the behavior being asserted. |
| `markdown-content-sync.spec.ts`, `path-artifact-saga.test.ts`, `path-artifact-real-stack-coverage.test.ts`, `navigable-history-real-stack.01.test.ts`, `navigable-history-real-stack.02.test.ts` | File watching, persistence, editing, and navigation through real product boundaries. A test title saying “source-served” is not itself a requirement for Vite; reconcile its proof citation. |
| `onboarding-browser.test.ts` | Real boot/restart and browser-visible onboarding. Preserve the stable browser origin while the backend binds a new port. |
| The settings-persistence and executable-theme-lifecycle cases in `theme-product-acceptance.test.ts` | Both exercise real server restart, and the executable lifecycle loads two pages repeatedly. Preserve those transitions through a stable origin serving built assets. Leave the theme-reset case to PR #9. |

A server URL is sufficient where a backend stays up. Where restart is part of the walk, reuse the existing [`startStableFrontProxy()`](../../test/helpers/stable-front-proxy.ts) to serve the built document and retarget HTTP/WebSocket traffic after restart. Do not weaken a reconnect test by navigating to a replacement origin or clearing browser state. Keep development loading available explicitly for module and fixture seams; avoid changing every `appURL()` caller implicitly, including PR #9's test and the Electron dispatcher seams.

The product runtime also needs the built `views/url-unsupported` assets for the existing external-navigation walk, which currently obtains that view from Vite. Add the missing test-runtime asset copy, not a production routing change. This is a prerequisite for preserving that assertion honestly.

Other suites that construct an in-process `Server`, component fixtures, and Electron-specific module/dispatcher seams are outside this initial conversion set. They are not asserted to require Vite forever. Converting this concrete set addresses the identified product walks without refactoring every browser harness. Existing built-app acceptances remain built-app acceptances.

## Failure diagnostics and retention

Collect small resource observations in the parent surface process so that a browser or test-worker crash cannot destroy all the evidence. Cover the canonical planned shard and target paths, including their preparation and teardown failures. The shared browser helper supplements those observations with attempt identity and browser failures. The parent data remains useful if the attempt helper never finishes.

Retain the following for failed attempts, including attempts that later recover on retry:

- Timestamped available memory and shared memory, available bytes/inodes for the effective temporary filesystem and `/dev/shm`, and initial/peak/final observations from a modest periodic sampler.
- The Linux `oom_kill` counter before and after execution; available cgroup memory-limit/OOM counters; a bounded kernel OOM excerpt when readable. Unavailable probes are explicit, not fabricated zeroes. A system counter increase alone is not attribution to a particular browser.
- Browser version, expected Playwright browser revision, browser crash/disconnect and failed-request error names, and the failed attempt's file/title/project/retry identity. Omit credentials, request query strings, response bodies, and arbitrary process environments.
- On failure, owned process identities and memory/descriptor summaries sufficient to compare with a descriptor limit and correlate kernel PID evidence. Avoid continuous full descriptor scans or permanent NetLog capture.

Prefer one resource sidecar per surface plus small attempt records over a separate monitoring service. Keep it incrementally readable, with explicit truncation/drop counts, and expose retained paths through the normal task/provider reporting. Download the sidecars through the same checked artifact path as native reports. Probe failure produces an observability warning and preserves the original test result. It must neither hide a failure nor create a passing result from missing test evidence.

The proposed bound is **1 MiB per surface resource sidecar and 8 MiB total resource diagnostics per shard attempt**, retaining initial state, extrema, OOM deltas, and recent failure context when the history is truncated. This cap applies while recording, not only at teardown. Do not add default videos, heap snapshots, or full network logs. Existing trace policy remains unchanged.

On a completed download, the coordinator retains the evidence in its canonical run directory and removes the worker copy. If retrieval is interrupted, bounded diagnostics remain with the stopped attempt until the next safe lease; that lease may replace them after recording that leftover evidence was reclaimed. Ambiguous/live owners prevent reclamation and new dispatch. Thus idle persistent workers do not accumulate an unbounded sequence of diagnostic runs. Coordinator-side `.test-runs/` retention is unchanged.

## Authority and derivation

After proposal convergence, derive the smallest changes in the existing owners:

- [`testing-policy.md`](../../specs/arch/testing-policy.md): built application as the default for product browser acceptance when development-module behavior is not under test; worker-owned reusable test runtimes and cleanup expectations.
- [`test-runner.md`](../../specs/arch/test-runner/test-runner.md): resource observation attached to the surface lifecycle, with process teardown preceding disposal of owned temporary files.
- [`blaxel-testshards.md`](../../specs/arch/test-runner/blaxel-testshards.md): attempt temporary directories, exclusive leases across setup/execution/retrieval/cleanup, safe orphan reclamation, and persistent-worker retention.
- [`sharded-execution.md`](../../specs/arch/test-runner/sharded-execution.md) and [`reporting.md`](../../specs/arch/test-runner/reporting.md): resource artifact references, bounded content, unknown/unavailable evidence, and preservation across attempts and downloads. Touch [`preflight.md`](../../specs/arch/test-runner/preflight.md) only where ownership checks actually change its stated contract.

Update the mirrored proofs after independent spec convergence. Test setup changes may also require proof-only corrections to descriptions of the affected browser walks; they do not change their product promises. Do not prescribe a new framework or adopt unrelated harness internals into spec authority.

## Validation and contribution boundaries

All execution is on Blaxel at committed, pushed revisions. The shared development host performs file inspection, edits, Git operations, and lightweight remote coordination only. No tests, builds, browser launches, lint, or type checks have run for this proposal. Apply the test-iteration discipline: red/green at the narrowest relevant file, then affected surfaces, then full verification with the default retry budget.

The proofs should establish a small number of consequential boundaries: reuse and final disposal of real runtime files; partial-build cleanup; preservation of a live job's files while orphaned owned scratch is reclaimed; real environment propagation into Node and Chromium; the result-download/lease boundary; and retained, bounded failure evidence when an attempt fails or its worker exits. Contract coverage handles unavailable resource probes and retention limits. A live targeted Blaxel run and a live planned shard run establish the provider paths. Exercise interruption with disposable owned subprocesses on an isolated Blaxel worker, without intentionally exhausting memory or running repository fixtures restricted to isolated GitHub hosts.

Re-run the converted acceptances without weakening their user-visible assertions. A recorded built-page request inventory should show that they no longer load the unbundled application graph. Validate restart continuity and authenticated navigation directly. Repeated use of one isolated worker should leave no generated runtime directories after cleanup and no growing sequence of resource reports.

`npm run verify -- blaxel` still runs lint/type-check/package-manifest phases on the invoking machine. Run that command from a dedicated Blaxel coordinator host for the final gate; invoking it here would violate the host invariant. Record the exact tested revision, failures, recovered flakes, and any measurement limits. Ready-PR CI remains a merge requirement of the repository, not a substitute for the required Blaxel evidence.

Keep browser-version alignment, shard count, browser request limits, retries, and production memory behavior outside this contribution. Forced GC is an investigation tool, not a proposed mitigation. The demo-mode and drag flakes have not been proven to share the resource-exhaustion cause.

## Review status

Proposal: awaiting independent review. No spec, proof, test, or implementation edits yet. The supervisor will receive the pushed proposal commit and draft PR. Subsequent work waits for that review; Josh's spec acceptance remains due at PR time.
