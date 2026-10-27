# Proposal review, round 2: test-harness resource cleanup (draft PR #12, d3570bf4)

**Verdict: FAIL, on one blocker.** The proposal now follows Josh's decisions, its evidence still holds, and its scope is much closer to its benefit. What remains is a hole in the lock design it was asked to make correct: it says how a worker becomes locked but not how a worker locked by a dead coordinator ever becomes usable again. Four refinements follow, one of them a decision for Josh.

- Reviewed: `docs/working/test-harness-resource-cleanup-proposal.md`, the review response and the unchanged investigation report at `d3570bf4`, against the reviewer checklist, Josh's decisions as the response records them, the code at the branch base `b5477211`, and current `origin/main` (`a8e73fbf`), including PR #32.
- I ran nothing. Every check is a read of files in the checkout or of main's history.

## What the revision gets right

- **Round 1's blockers are resolved as Josh decided.** The lock work is now Josh's requested correction, not a redesign presented as a prerequisite. Old branches are handled by removing the two known prefixes on every run under the lock, which I checked against the old runner: it reclaims a lock only when `expiresAt` is positive and past (`scripts/run-blaxel-testshards.mjs:406`), so a new lock written with `expiresAt: 0` is left alone, as the proposal says.
- **The relative benefit is stated** (round 1 refinement 1): the historical 3.2 GB test cost against 1.16 GB and 0.079 GB of leaked prefixes on the two inspected workers, with the other 2 to 3 GB of baseline named as out of scope.
- **Diagnostics are reduced to the minimum** that would have identified the incident, with the sampler and descriptor inventories made optional (refinement 3).
- **The infrastructure is named**: a private two-worker pool for experiments and a coordinator sandbox for the final gate, never the shared `poc` pool for experiments (refinement 4).
- **Remaining exposure is listed** with per-file behaviour (refinement 5). I spot-checked four of those claims at `b5477211` and all hold: the telemetry walk's two tabs and reload, the artifact-navigation `beforeEach` reload, the silent-reconnect reload in `auth.02`, and the reconnect test's count of top-level navigations.
- **The PR #32 assessment is honest.** It stops claiming the conversions repair the measured leak, and it requires any resource comparison to use a baseline containing #32.
- **Factual claims check out**: PR #9 is `f81a2465` on main; the pool script deletes through the provider API (`scripts/manage-blaxel-testshards.mjs:76`) and inspects through `process.exec` (lines 94, 115); the download race is unchanged on main, whose coordinator diff since the base only moves the checkout and dependency scripts into a module.

## Blocker: recovery of a locked worker is not defined

Josh asked for a lock that is correct for our own runner and pool scripts. The proposal removes time-based reclamation and holds the lock through teardown and download. That is right as far as it goes. It then says (lines 70 and 72):

- "A coordinator crash can leave a lock indefinitely."
- "Once the original coordinator is confirmed ended, recovery reuses the same stop/audit, download, and matching-lock release steps."
- "If execution status, process teardown, or retrieval cannot be confirmed, leave the lock held and report the specific reason. No timer or blind `rm -rf` is a recovery procedure."
- An expired legacy lock "is not reclaimed merely because of its age; uncertain ownership needs the same recovery checks."

What is missing:

1. **No entry point.** Nothing says what runs recovery: a runner command, a pool-script command, or a person following a procedure. Spec derivation would have to invent it.
2. **"Confirmed ended" has no method.** The lock records the coordinator's host and PID (`lockCommand`, line 396). A recovery run on the same host can check that PID; most coordinators do run on this host, so that covers most crashes. From any other host there is no way to confirm it. The proposal should say which evidence suffices: a dead coordinator PID on the same host, or an operator's assertion otherwise.
3. **Undownloaded results of a dead coordinator are never released.** The results exist to be downloaded by the coordinator that asked for them. If it is gone, recovery can retrieve them to a run directory nobody will read, or discard them. Either is fine; the proposal has to choose, because "until results have been downloaded" otherwise means forever.
4. **The cost is stated but not sized.** Every coordinator killed without its signal handler running (`kill -9`, a host reboot, a lost session) removes a worker from the shared pool until someone runs recovery. With many agents sharing one pool, that is a steady drain. The old design healed this in twenty minutes; the new one heals it never, by itself.

A correct and simple design within Josh's calibration is available and worth putting to him as the decision it is: reclaim a held lock automatically when worker-local evidence shows the run is over (the recorded shard supervisor is dead by PID and start time, the owner audit finds no live or stale owners, and results are either marked downloaded or older than a generous grace period), and otherwise hold and report. That uses only our own records, keeps the pool self-healing, and loses nothing but the reports of a coordinator that died before reading them. If Josh prefers manual recovery, the proposal can say so, with the entry point and evidence above.

## Refinements (none blocking)

1. **The built-application conversion needs a decision from Josh, with the post-#32 picture in front of him.**
   - PR #32 removes the mechanism the investigation measured: Vite services no longer answer `304`, so a reload no longer holds about 465 MB. The proposal says so and keeps the 17-file conversion on two other grounds, product fidelity and fewer requests, while admitting their benefit is unmeasured.
   - Main has moved the other way for in-process servers. Twenty-one test files and a shared helper now reach the application through the new `appURLForServer()` function, which puts a test's own server behind the Vite proxy on purpose (`test/helpers/product-server.ts`, main). The proposed testing-policy directive, built application by default for product browser acceptance, would read as contradicting that unless it is scoped to `ProductServer` walks.
   - Josh said to keep "suitable" built-app acceptances. The proposal should offer him the choice plainly: the full set on the fidelity argument, or the walks whose proofs name the built application or that reload several pages, with the rest left to a later contribution. Either way, scope the directive.
   - The conversion table is a base-revision inventory. On main, `artifact-isolation.test.ts` and `artifact-move.test.ts` in the web suite and `artifact-isolation.test.ts` in the desktop suite also use `appURL()`. The proposal defers reconciliation to implementation, which is acceptable, but it inspected main at `a8e73fbf` and could name them now.

2. **The runner's own scratch is treated more cautiously than the legacy prefixes.** Legacy `television-*` directories are removed on the strength of the lock and the idle check. The runner's own `/tmp/tv-testshards/<id>` directories, which are more certainly ours, additionally need intact metadata and "confirmed completed/recovered ownership", and "missing or inconsistent metadata needs recovery". A crashed run with half-written metadata therefore leaves its scratch until the manual recovery above. Josh's decision covers "stale per-run scratch". Under the lock, after the owner audit confirms no live or stale owners, remove every attempt directory except the current one. That is what "no adversarial design" allows.

3. **Two statements about old coordinators ask for more than is needed.**
   - "Carry the small lock lifecycle correction into branches still dispatching to the shared pool" and the final verify's precondition that "active coordinators carry the lock correction". Branches take the correction when they take main; nothing can make that happen sooner, and nothing requires it. A new run's non-expiring lock already keeps old coordinators off its worker. The only effect of an old coordinator on a new run is that its workers may show expired legacy locks the new runner will not reclaim, which costs capacity, not correctness, and is another reason to settle the blocker.
   - "After old in-flight runs have finished" as a precondition for the final run cannot be known on a shared pool. Drop it.

4. **Two smaller points.**
   - The investigation says the workers run Chromium 148 through the coordinator's build alias; PR #32's spec attributes the `304` behaviour to Chromium 145 and says other versions may differ. Both documents are in the tree. Say which version the workers actually run, or that it is unknown, so the proofs measure the right thing. Browser-version alignment itself can stay out of scope.
   - The final gate runs `npm run verify -- blaxel` from a coordinator sandbox inside Blaxel. That sandbox needs the Blaxel credentials and the GitHub token the runner reads; the proposal should say how they get there without being persisted.

## Reviewer checklist

The proposal changes no spec yet. On the items that apply now:

- **Authority.** The derivation section names the right owners, and now says the Blaxel spec's TTL escape and shell-exit unlock are replaced rather than left in conflict. Good.
- **Testing directives.** The one proposed directive is the place where refinement 1's scoping belongs.
- **Writing.** The document is long for a proposal, but the length is in the lock and cleanup sections that Josh asked to be decided here. The remaining-exposure table is the right shape: per file, what was seen and why it is deferred.
- **Status.** The review-status section is accurate and does not claim convergence.

## Evidence and limits

- Read the proposal, the response and the investigation in full; diffed the copied round 1 review against mine (identical) and the investigation against its round 1 version (unchanged).
- Read the lock, trap and timeout code at the base and main's coordinator diff; the pool script; main's `product-server.ts` and `playwright.ts` changes; PR #32's commit, spec and proof text; and the four spot-checked tests at `b5477211`.
- Not established: whether Blaxel kills a shard process at its timeout; which Chromium build the workers run today; main's current count of development-page loaders beyond the `appURL()` and `appURLForServer()` lists.

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness.
