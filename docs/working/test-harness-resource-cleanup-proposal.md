# Test-harness resource cleanup

Proposal for independent re-review, revised 2026-10-27 following Josh's scope decisions. Owner: rose. Branch: `thopter/test-harness-resource-cleanup`, draft PR #12, originally based on `b5477211`. Current `origin/main` was inspected at `a8e73fbf`; it has not yet been integrated into this branch. The supervisor arranges independent review of the proposal, specs, proofs, and implementation; Josh reviews every spec delta at PR time. No production behavior changes are proposed.

## Problem and intended result

In the investigated runs, repeated unbundled application loads consumed several GiB of Chromium response-buffer memory. Persistent Blaxel workers also retain temporary test runtimes across runs, reducing the memory and filesystem capacity available to browsers. The [investigation](chromium-insufficient-resources.md) establishes renderer OOM kills and reproduces `ERR_INSUFFICIENT_RESOURCES`; the exact failing allocation syscall remains unobserved.

The fixes have different effects. The historical theme-reset walk added roughly 3.2 GB of shared memory in a passing run that reached about 0.55 GB available RAM. Built loading removes hundreds of development-module requests per load, but those historical numbers cannot predict its incremental saving after the Vite response correction described below. By comparison, the two leaked runtime prefixes occupied 1.16 GB on the worst worker inspected and 0.079 GB on the other. All of `/tmp` occupied 1.20 GB and 0.16 GB respectively. Cleanup recovers accumulated capacity; it does not guarantee browser headroom. The original worker also retained roughly 1.4 GiB of checkout/dependencies, 0.9 GiB of browser installations, and other intentional caches. Those are outside this cleanup.

This contribution fixes the cached runtime lifetimes, runs suitable product acceptances against the built application, and retains compact resource evidence when an acceptance fails. It also makes the worker reservation cover preparation, execution, process teardown, and result download. After taking that lock and confirming the worker is idle, each run removes the two known leaked-runtime prefixes and stale run scratch. This repeatedly reclaims residue from older test revisions as well as newer ones. Cleanup preserves active jobs, provider services, deliberate dependency caches, and undownloaded reports.

PR #9 merged as `f81a2465` on 2026-10-01 and owns the built-application conversion of **“executable theme reset reloads connected Chromium documents under confirmed state.”** Reuse that change when integrating main; do not duplicate it. Main also includes `982e564d` (PR #32), making registry Vite services answer conditional requests in full. Its runner spec records Chromium 145 retaining about 2 MB per 304 response, roughly 465 MB per application reload. That newer mitigation changes the baseline for future measurements. The investigation numbers above describe the historical runs, not current main's residual memory cost; neither the helper leak nor the lock/download gaps is repaired by the Vite response change.

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

## Worker exclusion, result retrieval, and safe `/tmp` cleanup

Josh has selected routine cleanup under an exclusive worker lock. There is no pool drain-and-recreate plan or outstanding rollout choice. Before each run, remove only the two known legacy prefixes and stale scratch in the dedicated runner namespace; after execution, remove that attempt's scratch only after its processes stop and its evidence has been finalized outside scratch. Never delete all of `/tmp` or use age alone as proof of disuse.

### What the existing code establishes

The canonical coordinator intends one shard job per sandbox. [`acquireAny()` and `lockCommand()`](../../scripts/run-blaxel-testshards.mjs) acquire `/tmp/tv-testshard.lock`; another coordinator skips an unexpired lock. Within a shard, surface tasks execute sequentially, but a surface can have several test workers and many child processes. This does not prove that a worker never has overlapping jobs:

1. Lock expiry allows reclamation based on time alone. The record identifies the coordinator host/PID, not the remote shard supervisor. Setup is not fully covered by surface owner tokens. The configured TTL is 900/1200 seconds against a 240/480-second worker timeout, but provider timeout is not evidence that every descendant has stopped. The current spec explicitly uses TTL as the final availability bound for uncertain cleanup.
2. The shard shell's `EXIT` trap releases the lock before `runShard()` downloads results from `/workspace/television/.testshards/results`. A following checkout clears that fixed tree. This leaves an unprotected interval in which the previous job's evidence can disappear or be replaced. Report identity checks can detect some mismatches but cannot restore deleted files. This source-level race is present at both the branch base and inspected main; no collision was observed during the Chromium investigation.
3. Direct Blaxel process API calls bypass this repository lock. The inventory used that API. `manage-blaxel-testshards.mjs` also provisions and checks workers through `process.exec`, and deletes them through the provider API. The idle snapshots establish neither provider serialization nor a history-wide absence of overlap.

These are demonstrated protocol gaps, not demonstrated causes of the Chromium failures. The download-race follow-up is incorporated here; both its correction and the removal of time-based reclamation belong in PR #12.

### One lock through process teardown and download

Josh's calibration is that only our runner and pool scripts touch these workers. Correct those code paths using the existing lock; do not add a worker controller, persistent compatibility fence, access-control system, or defenses against hypothetical API callers.

Retain the worker lock until both conditions hold: **all execution for the attempt is stopped, and its results are downloaded and validated at the coordinator.** Keep atomic directory acquisition and the existing `lockId` ownership check. Write new held locks with `expiresAt: 0`: the inspected older runner reclaims only a positive timestamp in the past, so it also leaves these locks alone. Remove the new runner's age-only reclamation. Timeouts still bound execution and trigger cleanup, but they never authorize another run to overwrite a live attempt or its undownloaded results. The directory is removed on confirmed release, as it is today; it does not become a permanent worker installation.

The runner's order becomes:

1. Acquire the lock, then confirm the worker has no prior test/shard work before removing known leftovers. Extend the existing owner-token attribution to the outer shard, including checkout and setup children. Record the remote process name and PID/start identity so recovery can distinguish the run from PID reuse; the coordinator's host/PID alone is insufficient.
2. Prepare and execute the shard under that lock. Keep the existing all-shards-acquired barrier, sequential surfaces, and attempt/retry behavior. Record that dispatch was requested before making the API call. If its outcome is unknown, retain the lock until execution status and cleanup are confirmed.
3. On success, failure, timeout, or interruption, stop and audit the run's attributed processes, including descendants of an exited shell. Reuse the existing owner audit and TERM/KILL cleanup. A shell exit or successful kill API response alone is insufficient. The shell finalizes reports but no longer releases the lock in its `EXIT` trap.
4. Download the existing summary, native reports, logs, setup/cleanup evidence, and new diagnostic sidecars to the coordinator's run directory. Validate the existing run/attempt identities and required files. Missing or corrupt evidence remains an infrastructure failure; an early setup failure records which reports were never produced and retrieves what is available.
5. Release the matching lock only after teardown and retrieval complete. Keep the fixed checked results tree: protecting it through download closes the checkout-reset race without a separate artifact archive. Release unused locks after acquisition/upload failures only when execution was never requested and there are no pending writes or produced results to retain.

All runner exit paths must follow that order, including acquisition rollback, architecture rejection, both signal paths, retry, and exception cleanup. An interrupted download retains the lock; retry retrieval without repeating the tests. A failed teardown or uncertain dispatch excludes that worker from retries. Keep the default retry budget.

### Recovery, old branches, and pool operations

A coordinator crash can leave a lock indefinitely. Report the worker, lock/run identity, last phase, and paths needed for recovery. Once the original coordinator is confirmed ended, recovery reuses the same stop/audit, download, and matching-lock release steps. If execution status, process teardown, or retrieval cannot be confirmed, leave the lock held and report the specific reason. No timer or blind `rm -rf` is a recovery procedure. This availability cost is explicit; no heartbeat service or general ownership-transfer protocol is proposed.

Older branches matter in two concrete ways. Their helpers still leave the two known directory prefixes, which every updated run removes. Their coordinators also unlock at shell exit and use timestamp expiry. New non-expiring locks stop the inspected old acquisition code from taking an updated run's worker, but cannot correct an old coordinator's own early release. Carry the small lock lifecycle correction into branches still dispatching to the shared pool, and let already-started old runs finish their downloads before relying on the corrected behavior. There is no permanent old-client exclusion mechanism or separate controller/test-revision architecture. An existing legacy lock, even expired, is not reclaimed merely because of its age; uncertain ownership needs the same recovery checks. No pool drain/recreation is required to reclaim test residue.

`manage-blaxel-testshards.mjs` is the other actual API caller to correct. Its mutation commands must respect the same lock: obtain locks on the affected existing workers before deletion and refuse busy workers, releasing unused locks if acquisition fails. Fresh provisioning runs with dispatch to that pool stopped until setup and architecture verification finish. Listing/status is read-only. This covers our pool script without adding a generic API gateway or maintenance framework; manual pool operations use the same drained-pool discipline.

### A directory for each shard attempt

Give every locked shard **attempt** a fresh, short, private directory beneath a runner-owned root, for example `/tmp/tv-testshards/<random-id>/`. Record its run, shard, attempt, lock identity, and remote supervisor identity outside its disposable `tmp/` child. Record ownership before using scratch; a pre-dispatch directory must not be mistaken for an abandoned run. Upload/dispatch failure removes only this attempt's directory when execution is known not to have started and pending requests have settled. An unknown outcome leaves the lock and scratch for recovery. Use a short path because browser and Electron processes can create Unix sockets with limited pathname length.

Export an absolute `TMPDIR` pointing to that child before running preparation and test commands. Keep scripts, plans, askpass, and setup sidecars within the attempt directory as well. Preserve `TMPDIR` through child environments. Continue to keep deliberately persistent npm, Electron, browser-download, and dependency-hash caches at their existing locations outside scratch space. Playwright's transform cache may become attempt-local initially; measure any resulting setup cost before deciding it deserves a separately bounded persistent cache.

The mechanism is supported by both source and installed dependencies:

- On non-Windows systems, [Node's `os.tmpdir()`](https://nodejs.org/api/os.html#ostmpdir) checks `TMPDIR` before `TMP`, `TEMP`, and `/tmp`. Both cached build helpers use `os.tmpdir()`.
- [Chromium 148's `GetShmemTempDir()` and `GetTempDir()`](https://github.com/chromium/chromium/blob/148.0.7778.96/base/files/file_util_posix.cc#L1283-L1302) select the temporary directory when `--disable-dev-shm-usage` is present; `GetTempDir()` reads `TMPDIR`. The investigation observed this flag in the actual browser launch.
- Installed Playwright 1.58.2 uses `os.tmpdir()` for browser profiles and artifact directories in `playwright-core/lib/server/browserType.js`, inherits the parent environment by default, and includes that Chromium flag. Its transform cache also defaults to `os.tmpdir()`.

This establishes the intended wiring; a live Blaxel test must still observe Node-created paths and actual Chromium shared-memory descriptor paths under the attempt directory. We have not run that check at the proposal stage. Setting `TMPDIR` cannot relocate hard-coded `/tmp` paths or X11's global socket directory; the runner's explicit temporary paths must be moved deliberately, and external infrastructure remains untouched. Chromium also unlinks shared-memory files while holding them open, so directory deletion cannot substitute for stopping the owning processes.

### Exact deletion scope and order

Before preparation for **every run**, while holding the worker reservation and after confirming no prior execution or retrieval remains, remove:

- Real directories directly under `/tmp` whose basenames match `television-source-cli-e2e-*` or `television-web-bundle-*`. The helper source and inventories establish these as leaked test builds; Josh has authorized their recurring removal. Missing per-directory metadata on these legacy copies is expected. The whole-worker exclusion and idle check supply the disuse evidence that the prefix alone cannot supply.
- Stale attempt directories beneath the dedicated `/tmp/tv-testshards/` root, identified by runner metadata and confirmed completed/recovered ownership. Exclude the current reservation's staging directory. A dead supervisor alone does not prove that descendants or delayed dispatch are gone. Missing or inconsistent metadata needs recovery, not an age-based guess.

Revalidate directory identity immediately before deletion; reject symlink roots, unexpected mount boundaries, or paths escaping the exact allowed parent. Recursive removal must not follow nested links to another tree. Preserve the lock directory, provider uploads, X11 state, unrelated temporary files, checkouts, deliberate caches, and every undownloaded report. Do not broaden the legacy patterns to other Television-looking names. Report per-prefix counts, allocated bytes removed, filesystem free space before/after, and skips or errors; those two space measurements need not be equal when files remain open or the filesystem accounts storage differently.

After execution, finalize evidence outside scratch, stop all attributed processes, then remove this attempt's scratch while the reservation remains held through download. Setup failure, acceptance failure, timeout, and interruption use the same ownership rule. If teardown is uncertain, preserve scratch and keep the worker reserved. If deletion fails after confirmed teardown, preserve the original test outcome and add cleanup failure evidence; the worker cannot start another test until pre-run cleanup succeeds. Evidence must still be downloaded. A partial deletion must never be reported as reclaimed capacity for the whole directory.

Unknown ownership or a live consumer means skip deletion **and exclude that worker from test dispatch**, with a recoverable infrastructure failure. There is no promise that every abandoned byte is automatically reclaimable, nor a fallback to deleting unrelated files to obtain headroom. Known residue left by old test revisions is removed on subsequent updated runs without recreating workers or losing their caches. This proposal revision performs no worker cleanup or configuration changes.

## Worker lifetime for cached runtimes

Keep one lazily built source-CLI runtime per test worker and reuse it across launches and test cases. Publish the cached entry only after the build and asset installation succeed. A partial build removes its own directory and leaves the cache retryable. Apply the equivalent ownership rule to the cached versioned web bundles, retaining their per-version reuse.

Test cleanup continues to stop each case's product servers promptly. Worker teardown then stops any remaining servers and removes the shared cached runtime and versioned bundles. Cleanup is idempotent and waits for pending builds before removing their outputs. The worker teardown must cover both the shared Playwright registration helper and the Vitest callers; a per-test deletion would discard reuse and add unnecessary builds. A failed server teardown cannot justify removing files beneath a surviving server. The outer shard's process ownership and scratch cleanup provide the backstop when a worker is killed and cannot execute its own teardown.

The relevant entry points are `test/helpers/playwright.ts`, the two cached build helpers, and the Node/Vitest callers of those helpers. The design should use the runners' existing teardown facilities rather than a general-purpose cleanup registry. Failure during a per-launch runtime copy must also dispose that copy and its newly created home: the current bundle preparation occurs before the launch disposer is registered.

The helper fix matters even with shard scratch: it releases files between test workers within a shard and protects callers on hosts without the Blaxel shard script, including ordinary CI and developer environments. The reviewer independently counted 1,388 source-CLI and 727 versioned-bundle directories on this development host; that is reviewer evidence, not a new inspection by this contributor. Cleaning those existing host files is the host owner's decision and outside this contribution. The helper fix prevents new leakage on updated branches; it does not retrospectively remove unowned files.

## Built application for product acceptances

### Assessment after PR #32

**Keep the conversion set below, for product fidelity and fewer application-module requests; do not present it as necessary to repair the measured 304-buffer leak.** PR #32 (`982e564d`, merged 2026-10-09) removes conditional request headers at the registry Vite service boundary, so those services return full responses. Its recorded Chromium 145 evidence identifies the 2 MB buffer retained per 304 until context closure. That change directly addresses the repeated-reload mechanism for tests using those services, including tests that remain on Vite. Merely counting unbundled modules no longer establishes that the same accumulation persists on current main.

The listed acceptances assert shipped product behavior and already use a real `ProductServer` with built assets available. Loading those assets exercises the packaged application, asset routing, and authentication/reconnect behavior users receive; a development-module page can miss packaging and delivery mistakes. It also avoids hundreds of module requests per application load, including in multi-page/restart walks. Fewer requests is a concrete change, but its incremental memory and time benefit after #32 is unmeasured. Do not claim a specific reduction, that #32 is insufficient, or that all remaining Vite tests are resource-unsafe.

The conversion cost stays limited to this existing product-server set and the stable-origin restart helper. Preserve the assertions and #9's merged theme-reset conversion. Keep #32 for the remaining Vite services and keep development loading for module/fixture seams. Converting the in-process-server and Electron suites would require broader harness work and is still deferred. Validate the converted paths functionally and confirm their request inventory; any before/after resource comparison must use a baseline containing #32. This is a recommendation based on the tests' intended boundary and source inspection, not a post-#32 memory experiment.

### Conversion boundaries

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
| Web `auth.02.test.ts` | The silent reconnect case explicitly reloads the app. Other cases inject authentication failures into an in-process server. Reconcile this base-revision inventory against PR #9's merged changes before implementation. |
| Web `reload-after-reconnect.01/.02.test.ts`, `guerilla-artifact-sharing.test.ts`, `guerilla-artifact-sharing-resilience.test.ts` | These open one application page and reload/recover artifact documents or reconnect the event socket. The reconnect continuity case explicitly expects no top-level navigation. They control server internals/producer-consumer seams; an artifact reload is not evidence of a full application graph reload. |
| Web `settings.test.ts`, `platform-marker.test.ts`, `artifact-navigation.02.test.ts`, `appearance-delivery.test.ts`, `theme.test.ts`, `artifact-full-screen.test.ts` | The inspected source-app cases use one application page. Other cases in these files use fixtures or built assets. Retain their in-process server, platform, appearance, and navigation boundaries for this contribution; no claim that development modules are inherently necessary. |
| Desktop `all-webview-dispatcher.01/.02.test.ts`, `webview-event-parity.test.ts` | The executable-theme parity walk explicitly waits for a top-level document reset and later closes/relaunches Electron. The navigation-history walk quits and relaunches. These remain exposed; application resets, fresh Electron processes, and guest-webview reloads must be distinguished in any follow-up conversion. |
| Desktop `artifact-view-webview-wheel.test.ts`, `guerilla-artifact-sharing.test.ts`, `path-webview-content-reload.test.ts`, `artifact-navigation.test.ts`, `native-navigation-key.test.ts`, `artifact-navigation-external.test.ts` | Launch the development application in Electron; several reload or navigate guest documents. Native input, preload, and webview seams are outside this browser-product conversion. No measurement establishes their peak memory. |

Thus this contribution moves suitable product walks onto shipped assets and reduces their module requests; it does not establish a post-#32 memory saving, eliminate unbundled loading, or certify every remaining test's headroom. Preserve the remaining walks in full validation and use the new diagnostics if they fail. The proposed testing directive is a default for new or changed product acceptances, not a false assertion that all existing tests already comply.

### Reconciliation with current main

PR #9 has merged. Integrate current main before deriving the affected spec/proof changes and implementation; preserve its theme-reset conversion and reconcile the other theme cases, authentication walks, and stable-front proxy with the actual merged API. The inventory above is explicitly tied to `b5477211`, not a claim that all listed lines remain on today's main. Do not convert an already converted case again.

Main also now owns full responses from registry Vite services and selection of a contributor's origin repository for remote checkout. Preserve both. Measure built-app memory savings against this new baseline rather than attributing PR #32's benefit to PR #12.

## Failure diagnostics and retention

The minimum that would have identified this incident is **available RAM, shared memory, free bytes on the effective temporary filesystem, and the Linux OOM-kill counter at surface start and end, plus kernel OOM lines when failure occurs**. Commit to that small set. Read it from the parent surface process so a browser or test-worker crash does not destroy the initial observation. Include the surface preparation/teardown interval in both planned and targeted paths; retain the start record immediately, and mark a missing final observation as unknown after interruption.

Keep one resource sidecar per surface execution, linked to the native attempt evidence already recording file/title/project/retry and failures. Retain it when a test attempt fails even if a later retry passes. When available, the shared browser failure hook can add a snapshot at the failed attempt boundary; this is an enhancement, not the minimum contract. Start/end samples provide context and an OOM delta, not a peak or exact allocation-time measurement. A system OOM-counter increase alone cannot attribute a kill to a browser; readable kernel lines provide process identities. If native results are missing, retain the sidecar without inventing an acceptance result.

Read kernel output through a bounded capture and retain at most **64 KiB of relevant OOM lines** for the execution interval, with explicit truncation and unavailable-probe reasons. The two snapshots and bounded excerpt produce at most **128 KiB per surface sidecar and 8 MiB of resource diagnostics per shard attempt**. Enforce these limits when writing; a cap is necessary for bounded retention, but a continuous sampler/ring-buffer framework is not. Retain each surface's small start/end record before using the remaining budget for excerpts. Omit credentials, request query strings, bodies, and arbitrary process environments. Probe failure adds an observability warning and preserves the original test outcome.

Periodic sampling, per-process descriptor inventories, cgroup probes, detailed browser/request event records, and browser-revision comparison remain optional investigation tools. They are not new merge obligations or spec requirements in this contribution. Do not add default videos, heap snapshots, or NetLogs. Existing native retry evidence and trace policy remain unchanged.

Write sidecars under the existing checked `.testshards/results` tree, outside disposable scratch, and download them with the other reports. Keep at most one attempt's bounded resource diagnostics per worker. A failed download leaves that attempt locked; it does not start a growing queue of retained runs on the same worker. The next run's results reset is allowed only after retrieval completes and the lock is released. Coordinator-side `.test-runs/` retention is unchanged. This bounds worker storage without expiring undownloaded evidence. No new cross-run archive or retention daemon is needed.

## Authority and derivation

After proposal convergence, derive the smallest changes in the existing owners:

- [`testing-policy.md`](../../specs/arch/testing-policy.md): built application as the default for product browser acceptance when development-module behavior is not under test; worker-owned reusable test runtimes and cleanup expectations.
- [`blaxel-testshards.md`](../../specs/arch/test-runner/blaxel-testshards.md): exclusive worker lock through setup, process teardown and result retrieval; no time-based reclamation of uncertain work; recovery and capacity consequences; the actual older-runner behavior; pool-script locking; attempt temporary directories, recurring exact-prefix cleanup and bounded worker retention. Replace its TTL availability escape and shell-exit unlock expectations rather than leaving conflicting requirements.
- [`reporting.md`](../../specs/arch/test-runner/reporting.md): minimum resource observations and artifact references, bounded content, unavailable evidence, and retention alongside failed/recovered native attempts.

Use existing lifecycle and reporting contracts in `test-runner.md` and `sharded-execution.md`, adding only the cross-references or ownership corrections required by the outer Blaxel lock. Existing isolated-GitHub-only lifecycle fixtures keep their placement. No `preflight.md` delta is planned. Optional investigation instrumentation remains optional.

Update the mirrored proofs after independent spec convergence. Test setup changes may also require proof-only corrections to descriptions of the affected browser walks; they do not change their product promises. Do not prescribe a new framework or adopt unrelated harness internals into spec authority.

## Validation and contribution boundaries

All execution is on Blaxel at committed, pushed revisions. The shared development host performs file inspection, edits, Git operations, and lightweight remote coordination only. No tests, builds, browser launches, lint, or type checks have run for this proposal. Apply the test-iteration discipline: red/green at the narrowest relevant file, then affected surfaces, then full verification with the default retry budget.

Derive proofs for the principal paths without a combinatorial fault matrix:

- One run excludes a competing coordinator through preparation, teardown, and a deliberately delayed result download. Passing the former TTL never admits a second run while processes or retrieval remain. Exercise both targeted and planned dispatch through the real provider.
- A lost coordinator, ambiguous dispatch, or failed retrieval keeps the lock held. Recovery after the coordinator has ended stops only attributed processes, retrieves the available evidence, and then permits reuse. Contract tests cover error handling; real seam coverage must include dispatch and retrieval, not just mocked API responses.
- The inspected older runner does not reclaim a new non-expiring held lock. Legacy helper residue is removed on the next updated run. Pool-script mutation respects the same lock. An unexplained test process or ownership record prevents cleanup/dispatch rather than authorizing deletion.
- Exact-prefix and stale-scratch cleanup preserves unrelated files and live consumers. Real runtime builds demonstrate once-per-worker reuse, final disposal, and partial-build cleanup. A Blaxel observation verifies Node temporary paths and Chromium shared-memory descriptors under the attempt's `TMPDIR`.
- A failed or recovered acceptance retains bounded start/end/OOM evidence through retrieval, including when its worker exits. Contract coverage handles unavailable probes, unchanged original test outcomes, truncation, and limits.

The live recovery checks use small, disposable, owned processes on private workers. No deliberate OOM, process storm, or invocation of the repository's isolated-GitHub-only destructive fixtures is authorized. If a required assertion cannot be proven safely within Blaxel-only execution, report that specific blocker at proof review; do not silently substitute local or GitHub execution.

Use a dedicated two-worker pool named **`rose-cleanup`**, with workers `tv-testshard-x64-rose-cleanup-01` and `-02`, for cleanup, orphan, and interruption experiments. Explicitly pass `--pool rose-cleanup` through the canonical runner; reduced planned runs also need the documented shard-count override. Exercise interruption with disposable owned subprocesses there, without intentionally exhausting memory or running repository fixtures restricted to isolated GitHub hosts. Never run those experiments on shared `poc` workers. Two workers permit a distinct replacement after a contaminated attempt; they do not guarantee capacity for every retry after repeated contamination, which remains an infrastructure failure with the default retry budget intact.

Re-run the converted acceptances without weakening their user-visible assertions. A recorded built-page request inventory should show that they no longer load the unbundled application graph. Validate restart continuity and authenticated navigation directly. Repeated use of one isolated worker should leave no generated runtime directories after cleanup and no growing sequence of resource reports.

For the final gate, provision a separate sandbox named **`tv-cleanup-coordinator-rose`**, excluded from testshard pool labels. It will fetch the committed, pushed branch and run `npm run verify -- blaxel`, so the invoking machine's lint/type-check/package-manifest phases also execute on Blaxel. The two experimental workers and coordinator are a plan, not currently provisioned capacity. Provision and verify their identities before starting validation; if unavailable, report blocked rather than run anything on this host or silently substitute GitHub execution. The user has already authorized outside-pool Blaxel hosts.

The experiment plan adds at most three sandboxes. The spec's pool-size and tier examples are not a current capacity inventory: inspect actual workspace usage and provider limits before provisioning/dispatch. Do not claim slots are reserved or alter shared workers to obtain them. Delete this contribution's experiment workers through the pool script after retrieving their reports and before final standard 36-shard verify, leaving only its coordinator. That final run uses the normal `poc` path without intentional contamination or interruption, after old in-flight runs have finished and active coordinators carry the lock correction. Archive its reports before disposing the coordinator. Record the exact tested revision, failures, recovered flakes, and any measurement limits. Ready-PR CI remains the repository's merge requirement; the contribution's execution evidence stays on Blaxel as instructed.

Keep browser-version alignment, shard count, browser request limits, retries, and production memory behavior outside this contribution. Forced GC is an investigation tool, not a proposed mitigation. The demo-mode and drag flakes have not been proven to share the resource-exhaustion cause.

## Review status

Proposal round 1 at `1652787e`: FAIL on lease scope and mixed-version consequences. The response at `99b7ed93` narrowed the proposal while those human scope decisions were pending. Josh's 2026-10-27 instruction brings lock correction and recurring legacy cleanup into this PR and removes the pool-recreation choice. The [review response](test-harness-resource-cleanup-review-response.md) records the current dispositions without changing the independent review's historical verdict.

Revised proposal: awaiting independent re-review. No spec, proof, test, or implementation edits yet. No tests, builds, remote experiments, or worker operations were performed for this revision. Unknowns are live provider behavior during failed dispatch/recovery, actual `TMPDIR` placement and post-mitigation memory savings, current capacity, and the availability impact of locks retained after failures. Josh's calibration limits lock work to our runner and pool scripts. His spec acceptance remains due at PR time; there is no pending shared-pool cleanup rollout decision.
