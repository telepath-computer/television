# Test-harness resource cleanup

Proposal for independent review. Owner: rose. Base: `origin/main` at `b5477211`. Branch: `thopter/test-harness-resource-cleanup`. The supervisor arranges independent review of the proposal, specs, proofs, and implementation; Josh reviews every spec delta at PR time. No production behavior changes are proposed.

## Problem and intended result

Repeated unbundled application loads can consume several GiB of Chromium response-buffer memory. Persistent Blaxel workers also retain temporary test runtimes across runs, reducing the memory and filesystem capacity available to browsers. The [investigation](chromium-insufficient-resources.md) establishes renderer OOM kills and reproduces `ERR_INSUFFICIENT_RESOURCES`; the exact failing allocation syscall remains unobserved.

The fixes have different effects. The theme-reset walk added roughly 3.2 GB of shared memory in a passing run that reached about 0.55 GB available RAM. Switching that walk to the built application removes its hundreds of development-module requests per load; the expected memory saving is large, but still needs a post-change measurement. By comparison, the two leaked runtime prefixes occupied 1.16 GB on the worst worker inspected and 0.079 GB on the other. All of `/tmp` occupied 1.20 GB and 0.16 GB respectively. Cleanup recovers accumulated capacity; it does not make repeated unbundled loading cheap or guarantee enough headroom. The original worker also retained roughly 1.4 GiB of checkout/dependencies, 0.9 GiB of browser installations, and other intentional caches. Those are outside this cleanup.

This contribution fixes the cached runtime lifetimes, runs suitable product acceptances against the built application, and retains compact resource evidence when an acceptance fails. For runs using the updated harness, owned disposable files should be removed after confirmed process teardown, with orphan cleanup on a later run when teardown could not finish. Older branches will continue to leave unowned files until updated. Cleanup must preserve active jobs, provider services, deliberate dependency caches, and reports outside scratch space.

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

**After a run:** yes, remove that run's own scratch after its processes stop and before the existing exit path releases the worker. **Before a run:** yes, reclaim owned scratch only when its recorded supervisor and descendants are confirmed gone. **Existing unowned files:** require a separate rollout decision from Josh, described below. Never delete all of `/tmp`: the worker lease itself lives there, as do provider and display infrastructure. Name prefixes or age alone do not establish that a file is unused.

### Concurrency and the present lease boundary

The canonical coordinator intends one shard job per sandbox. [`acquireAny()` and `lockCommand()`](../../scripts/run-blaxel-testshards.mjs) acquire `/tmp/tv-testshard.lock`; another coordinator skips an unexpired lock. A normal broad run uses separate workers for its shards. Within a shard, surface tasks execute sequentially, but a surface can have several test workers and many child processes. For example, the browser-app surface uses two Playwright workers on CI; browser-app-real-stack uses one.

This is not evidence that a sandbox can never have overlapping jobs:

1. Lock expiry currently allows reclamation based on time alone. The lock records the coordinator's host/PID, not the remote shard supervisor's live identity. Setup processes are not all covered by surface owner tokens. The stale-owner reaper deliberately leaves live-supervisor tokens alone and can exit successfully with `liveOwners` present. However, the configured TTL is 900/1200 seconds against a 240/480-second worker timeout. Expiry is deliberately the spec's final availability bound when cleanup cannot be confirmed. Whether the provider can leave a job alive past that bound was not established.
2. The shard shell's `EXIT` trap releases its lock before `runShard()` downloads results from the fixed `/workspace/television/.testshards/results` directory. A following job can reset those files while the prior coordinator reads them.
3. Direct Blaxel process API calls are not serialized by this repository lock. The read-only inventory itself used that API. The inspection found no overlapping test jobs, but does not establish a history-wide absence of overlap.

**The existing lease protocol, TTL, and result location remain unchanged in this contribution.** Safe scratch cleanup uses a fresh private directory and that directory's process ownership, independently of whether the lease has changed hands. A live or uncertain owner prevents removal of that directory; it does not add a permanent worker quarantine. Existing stale-process attribution and TERM/KILL cleanup remain in force. Cleanup cannot make overlapping checkouts safe and does not claim to do so.

The result-download race is recorded as a [separate follow-up](blaxel-results-download-race.md). Resolving it, or replacing TTL recovery with operator intervention, needs its own scope and consequences assessed, including compatibility with older coordinators. Neither is required for this scratch cleanup. No observed Chromium failure has been attributed to these lease weaknesses.

### A directory for each shard attempt

Give every leased shard **attempt** a fresh, short, private directory beneath a runner-owned root, for example `/tmp/tv-testshards/<random-id>/`. Record its run, shard, attempt, lease identity, and remote supervisor PID/start identity outside its disposable `tmp/` child. Record ownership before using scratch; the pre-dispatch directory must not be mistaken for a dead supervisor. Upload/dispatch failure removes only the directory this coordinator created when execution is known not to have started. An unknown dispatch outcome leaves it for confirmed recovery. Use a short path because browser and Electron processes can create Unix sockets with limited pathname length.

Export an absolute `TMPDIR` pointing to that child before running preparation and test commands. Keep scripts, plans, askpass, and setup sidecars within the attempt directory as well. Preserve `TMPDIR` through child environments. Continue to keep deliberately persistent npm, Electron, browser-download, and dependency-hash caches at their existing locations outside scratch space. Playwright's transform cache may become attempt-local initially; measure any resulting setup cost before deciding it deserves a separately bounded persistent cache.

The mechanism is supported by both source and installed dependencies:

- On non-Windows systems, [Node's `os.tmpdir()`](https://nodejs.org/api/os.html#ostmpdir) checks `TMPDIR` before `TMP`, `TEMP`, and `/tmp`. Both cached build helpers use `os.tmpdir()`.
- [Chromium 148's `GetShmemTempDir()` and `GetTempDir()`](https://github.com/chromium/chromium/blob/148.0.7778.96/base/files/file_util_posix.cc#L1283-L1302) select the temporary directory when `--disable-dev-shm-usage` is present; `GetTempDir()` reads `TMPDIR`. The investigation observed this flag in the actual browser launch.
- Installed Playwright 1.58.2 uses `os.tmpdir()` for browser profiles and artifact directories in `playwright-core/lib/server/browserType.js`, inherits the parent environment by default, and includes that Chromium flag. Its transform cache also defaults to `os.tmpdir()`.

This establishes the intended wiring; a live Blaxel test must still observe Node-created paths and actual Chromium shared-memory descriptor paths under the attempt directory. We have not run that check at the proposal stage. Setting `TMPDIR` cannot relocate hard-coded `/tmp` paths or X11's global socket directory; the runner's explicit temporary paths must be moved deliberately, and external infrastructure remains untouched. Chromium also unlinks shared-memory files while holding them open, so directory deletion cannot substitute for stopping the owning processes.

Cleanup has two paths:

1. **Before an attempt:** reclaim earlier directories in the dedicated namespace only when recorded PID/start identities are dead and no attributed descendants remain. Revalidate before removal and reject unexpected directory/symlink layouts. Missing metadata or unreadable process evidence means skip and report, not guess. A live supervisor protects its directory even if its lease has expired. Create the new attempt's directory fresh; never delete a guessed path to make room.
2. **After execution:** finalize evidence in the existing results directory outside scratch, complete process teardown, then remove this attempt's scratch from the existing exit path before it releases the lock. Setup failure, test failure, timeout, and interruption follow the same ownership rule. The coordinator's existing unconfirmed-execution path removes scratch only after its process cleanup is confirmed. Otherwise leave it for a later ownership-checked reclamation. Preserve the original outcome if cleanup itself fails, and report the leftover path.

The supervisor identity alone is not enough if detached descendants survived it. Reuse the existing owner-token audit and attach the attempt identity to setup children as needed for attribution; do not kill unrelated processes to make a directory reclaimable. A missing/uncertain owner can leave residual scratch requiring operator attention, but does not change lease availability. This is a disposal safety rule, not a promise that every abandoned byte can always be reclaimed automatically.

Reports stay under the current checked results root and are downloaded normally. Scratch cleanup does not remove them. This retains the known download race as an explicit limit instead of redesigning report storage inside this contribution.

### Mixed versions and existing unowned files: Josh's rollout decision

Every coordinator uploads the script from its own branch. Older branches keep creating `television-source-cli-e2e-*` and `television-web-bundle-*` directly under `/tmp`, bypass the new attempt directory, and will keep leaking them. One cleanup now cannot end that accumulation. The updated harness cleans files created under its own scratch, including helpers not individually repaired; it cannot make that claim for old-branch runs or hard-coded external paths.

**Recommendation for Josh's decision:** accept temporary residue while active branches take the change, then arrange a drained-pool recreation using the existing delete-then-ensure procedure. This needs a coordinated pause in dispatch and pays cold provisioning/dependency costs, but removes all old test residue with existing machinery. If capacity becomes a problem sooner, Josh can schedule an earlier recreation knowing that old branches can contaminate the fresh workers again. No date or shared-pool deletion is authorized by this proposal.

| Option | Benefit | Cost and consequence |
| --- | --- | --- |
| Accept residue during migration, then drain and recreate the pool (recommended) | No new legacy-deletion code; clears every worker and every old disposable prefix. | Temporary reduced headroom, a coordinated interruption, and cold caches. May need repetition if old branches continue running. |
| Operator removes the two known prefixes from explicitly drained workers | Preserves dependency and browser caches. | Must establish that no job or other consumer uses those files; only recovers these two prefixes; needs repetition during mixed versions. This would be an operator procedure, not routine prefix-based deletion in this PR. |
| Add routine legacy-prefix cleanup | Reclaims old-branch leaks repeatedly. | Adds deletion without recorded ownership, dependent on proving the whole worker idle despite mixed coordinators; disproportionate to this fix and not recommended. |

Josh must choose the shared-pool rollout option and timing. The contribution can be reviewed and implemented without doing that operation; it cannot claim the whole pool is clean until the decision is executed and old branches stop leaking. No shared-pool or development-host cleanup has been performed.

## Worker lifetime for cached runtimes

Keep one lazily built source-CLI runtime per test worker and reuse it across launches and test cases. Publish the cached entry only after the build and asset installation succeed. A partial build removes its own directory and leaves the cache retryable. Apply the equivalent ownership rule to the cached versioned web bundles, retaining their per-version reuse.

Test cleanup continues to stop each case's product servers promptly. Worker teardown then stops any remaining servers and removes the shared cached runtime and versioned bundles. Cleanup is idempotent and waits for pending builds before removing their outputs. The worker teardown must cover both the shared Playwright registration helper and the Vitest callers; a per-test deletion would discard reuse and add unnecessary builds. A failed server teardown cannot justify removing files beneath a surviving server. The outer shard's process ownership and scratch cleanup provide the backstop when a worker is killed and cannot execute its own teardown.

The relevant entry points are `test/helpers/playwright.ts`, the two cached build helpers, and the Node/Vitest callers of those helpers. The design should use the runners' existing teardown facilities rather than a general-purpose cleanup registry. Failure during a per-launch runtime copy must also dispose that copy and its newly created home: the current bundle preparation occurs before the launch disposer is registered.

The helper fix matters even with shard scratch: it releases files between test workers within a shard and protects callers on hosts without the Blaxel shard script, including ordinary CI and developer environments. The reviewer independently counted 1,388 source-CLI and 727 versioned-bundle directories on this development host; that is reviewer evidence, not a new inspection by this contributor. Cleaning those existing host files is the host owner's decision and outside this contribution. The helper fix prevents new leakage on updated branches; it does not retrospectively remove unowned files.

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

### Remaining development-page exposure

At `b5477211`, a read-only inventory finds 38 e2e test files with a literal `/packages/web/src/index.html` reference and two more using `guerilla-artifact-sharing.helpers.ts`: 40 test files, or 41 source-loading files when that helper is counted. Repository tests that inspect HTML as text are excluded. The proposed 17-file conversion set plus PR #9 leaves 23 of those test files, including the three desktop `appURL()` users. This count is a source inventory, not a measurement of concurrent pages or memory. Component fixtures importing individual modules are a separate exposure and are not counted as full application loads.

| Remaining tests | Observed reload/page behavior and why deferred |
| --- | --- |
| Web `telemetry-session.test.ts` | One case reloads the application; another opens two tabs in one persistent context, closes it, then opens a new context. This is a concrete remaining multi-page exposure. It uses an in-process server with an injected telemetry sink; converting that boundary needs its own proof review. |
| Web `artifact-navigation.01.test.ts`, `artifact-navigation-history.test.ts` | Their `beforeEach` loads the development app, clears storage, then reloads it: two full graph loads per case. They use directly controlled `Store`/`Server` instances. These are sensible next conversion candidates, not proven-safe exceptions. |
| Web `auth.02.test.ts` | The silent reconnect case explicitly reloads the app. Other cases inject authentication failures into an in-process server. PR #9 also changes this file, so reassess its final walks after that lands. |
| Web `reload-after-reconnect.01/.02.test.ts`, `guerilla-artifact-sharing.test.ts`, `guerilla-artifact-sharing-resilience.test.ts` | These open one application page and reload/recover artifact documents or reconnect the event socket. The reconnect continuity case explicitly expects no top-level navigation. They control server internals/producer-consumer seams; an artifact reload is not evidence of a full application graph reload. |
| Web `settings.test.ts`, `platform-marker.test.ts`, `artifact-navigation.02.test.ts`, `appearance-delivery.test.ts`, `theme.test.ts`, `artifact-full-screen.test.ts` | The inspected source-app cases use one application page. Other cases in these files use fixtures or built assets. Retain their in-process server, platform, appearance, and navigation boundaries for this contribution; no claim that development modules are inherently necessary. |
| Desktop `all-webview-dispatcher.01/.02.test.ts`, `webview-event-parity.test.ts` | The executable-theme parity walk explicitly waits for a top-level document reset and later closes/relaunches Electron. The navigation-history walk quits and relaunches. These remain exposed; application resets, fresh Electron processes, and guest-webview reloads must be distinguished in any follow-up conversion. |
| Desktop `artifact-view-webview-wheel.test.ts`, `guerilla-artifact-sharing.test.ts`, `path-webview-content-reload.test.ts`, `artifact-navigation.test.ts`, `native-navigation-key.test.ts`, `artifact-navigation-external.test.ts` | Launch the development application in Electron; several reload or navigate guest documents. Native input, preload, and webview seams are outside this browser-product conversion. No measurement establishes their peak memory. |

Thus this contribution reduces a measured high-cost path and other direct product walks; it does not eliminate unbundled loading or certify every remaining test's headroom. Preserve the remaining walks in full validation and use the new diagnostics if they fail. The proposed testing directive is a default for new or changed product acceptances, not a false assertion that all existing tests already comply.

### Sequencing with PR #9

Recommend PR #9 lands first, then integrate its merged main revision before this branch's final affected-file validation and ready review. This branch keeps the theme-reset body with PR #9 and reconciles both the other theme cases and `auth.01.test.ts` against its final implementation. The existing stable-front proxy is sufficient for the proposed restart walks; no new proxy API is assumed. PR #9's currently inspected head `4e85e733` does not list a change to `stable-front-proxy.ts`; if a hook lands there, reuse and review that final API rather than adding a competing one. Proposal/spec/proof work and nonconflicting helper work can proceed meanwhile. This is the recommended merge order for the supervisor to coordinate, not a claim that either PR has been approved to merge.

## Failure diagnostics and retention

The minimum that would have identified this incident is **available RAM, shared memory, free bytes on the effective temporary filesystem, and the Linux OOM-kill counter at surface start and end, plus kernel OOM lines when failure occurs**. Commit to that small set. Read it from the parent surface process so a browser or test-worker crash does not destroy the initial observation. Include the surface preparation/teardown interval in both planned and targeted paths; retain the start record immediately, and mark a missing final observation as unknown after interruption.

Keep one resource sidecar per surface execution, linked to the native attempt evidence already recording file/title/project/retry and failures. Retain it when a test attempt fails even if a later retry passes. When available, the shared browser failure hook can add a snapshot at the failed attempt boundary; this is an enhancement, not the minimum contract. Start/end samples provide context and an OOM delta, not a peak or exact allocation-time measurement. A system OOM-counter increase alone cannot attribute a kill to a browser; readable kernel lines provide process identities. If native results are missing, retain the sidecar without inventing an acceptance result.

Read kernel output through a bounded capture and retain at most **64 KiB of relevant OOM lines** for the execution interval, with explicit truncation and unavailable-probe reasons. The two snapshots and bounded excerpt produce at most **128 KiB per surface sidecar and 8 MiB of resource diagnostics per shard attempt**. Enforce these limits when writing; a cap is necessary for bounded retention, but a continuous sampler/ring-buffer framework is not. Retain each surface's small start/end record before using the remaining budget for excerpts. Omit credentials, request query strings, bodies, and arbitrary process environments. Probe failure adds an observability warning and preserves the original test outcome.

Periodic sampling, per-process descriptor inventories, cgroup probes, detailed browser/request event records, and browser-revision comparison remain optional investigation tools. They are not new merge obligations or spec requirements in this contribution. Do not add default videos, heap snapshots, or NetLogs. Existing native retry evidence and trace policy remain unchanged.

Write sidecars under the existing checked `.testshards/results` tree, outside disposable scratch, and download them through normal artifact reporting. The worker retains at most the current checkout's bounded resource diagnostics; the existing next-run results reset removes the preceding set, including after interrupted retrieval. Coordinator-side `.test-runs/` retention is unchanged. This does not repair the existing result-download race or promise evidence survives a concurrent checkout reset; that limitation is recorded in the separate follow-up. No new cross-run archive or retention daemon is needed.

## Authority and derivation

After proposal convergence, derive the smallest changes in the existing owners:

- [`testing-policy.md`](../../specs/arch/testing-policy.md): built application as the default for product browser acceptance when development-module behavior is not under test; worker-owned reusable test runtimes and cleanup expectations.
- [`blaxel-testshards.md`](../../specs/arch/test-runner/blaxel-testshards.md): attempt temporary directories, cleanup after process teardown, safe orphan reclamation, and bounded worker-side diagnostic retention. The lease/TTL contract stays intact.
- [`reporting.md`](../../specs/arch/test-runner/reporting.md): minimum resource observations and artifact references, bounded content, unavailable evidence, and retention alongside failed/recovered native attempts.

Use existing lifecycle and reporting contracts in `test-runner.md` and `sharded-execution.md`; add a cross-reference only if derivation reveals an actual ownership gap. No `preflight.md` delta is planned. Do not turn optional investigation instrumentation into requirements spread across five specs.

Update the mirrored proofs after independent spec convergence. Test setup changes may also require proof-only corrections to descriptions of the affected browser walks; they do not change their product promises. Do not prescribe a new framework or adopt unrelated harness internals into spec authority.

## Validation and contribution boundaries

All execution is on Blaxel at committed, pushed revisions. The shared development host performs file inspection, edits, Git operations, and lightweight remote coordination only. No tests, builds, browser launches, lint, or type checks have run for this proposal. Apply the test-iteration discipline: red/green at the narrowest relevant file, then affected surfaces, then full verification with the default retry budget.

The proofs should establish a small number of consequential boundaries: reuse and final disposal of real runtime files; partial-build cleanup; preservation of a live job's files while orphaned owned scratch is reclaimed; real environment propagation into Node and Chromium; and retained, bounded failure evidence when an attempt fails or its worker exits. Contract coverage handles unavailable probes, unchanged original outcomes, and retention limits. A live targeted Blaxel run and a live planned shard run establish the provider paths. Lease-redesign experiments and result-race repair tests are outside scope.

Use a dedicated two-worker pool named **`rose-cleanup`**, with workers `tv-testshard-x64-rose-cleanup-01` and `-02`, for cleanup, orphan, and interruption experiments. Explicitly pass `--pool rose-cleanup` through the canonical runner; reduced planned runs also need the documented shard-count override. Exercise interruption with disposable owned subprocesses there, without intentionally exhausting memory or running repository fixtures restricted to isolated GitHub hosts. Never run those experiments on shared `poc` workers. Two workers permit a distinct replacement after a contaminated attempt; they do not guarantee capacity for every retry after repeated contamination, which remains an infrastructure failure with the default retry budget intact.

Re-run the converted acceptances without weakening their user-visible assertions. A recorded built-page request inventory should show that they no longer load the unbundled application graph. Validate restart continuity and authenticated navigation directly. Repeated use of one isolated worker should leave no generated runtime directories after cleanup and no growing sequence of resource reports.

For the final gate, provision a separate sandbox named **`tv-cleanup-coordinator-rose`**, excluded from testshard pool labels. It will fetch the committed, pushed branch and run `npm run verify -- blaxel`, so the invoking machine's lint/type-check/package-manifest phases also execute on Blaxel. The two experimental workers and coordinator are a plan, not currently provisioned capacity. Provision and verify their identities before starting validation; if unavailable, report blocked rather than run anything on this host or silently substitute GitHub execution. The user has already authorized outside-pool Blaxel hosts.

The experiment allocation uses at most three concurrent sandbox slots beyond the shared 72: **72 + 2 + 1 = 75**. Check actual workspace usage before provisioning/dispatch because other work may already consume that spare capacity; do not claim those slots are reserved or alter shared workers to obtain them. Delete this contribution's experiment workers before the final standard 36-shard verify, leaving only its coordinator alongside the shared pool. That final run uses the normal `poc` lease path without intentional contamination or interruption. Archive its reports before disposing the coordinator. Record the exact tested revision, failures, recovered flakes, and any measurement limits. Ready-PR CI remains the repository's merge requirement; the contribution's execution evidence stays on Blaxel as instructed.

Keep browser-version alignment, shard count, browser request limits, retries, and production memory behavior outside this contribution. Forced GC is an investigation tool, not a proposed mitigation. The demo-mode and drag flakes have not been proven to share the resource-exhaustion cause.

## Review status

Proposal round 1 at `1652787e`: FAIL on lease scope and mixed-version consequences. The [review response](test-harness-resource-cleanup-review-response.md) records dispositions. Revised proposal: awaiting independent re-review. No spec, proof, test, or implementation edits yet. Josh's shared-pool rollout option/timing remains an explicit decision, separate from approval of the code contribution; his spec acceptance remains due at PR time.
