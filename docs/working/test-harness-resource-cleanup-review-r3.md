# Proposal review, round 3: test-harness resource cleanup (draft PR #12, 57a701d0)

**Verdict: PASS.** Round 2's blocker is resolved: the proposal now says what recovers a worker whose coordinator has gone, on what evidence, what happens to its reports, and what it costs, and the design follows Josh's decisions. The recovery design is close to as simple as it can safely be. Four refinements follow; the first two are worth doing before spec derivation, and none changes the verdict.

- Reviewed: `docs/working/test-harness-resource-cleanup-proposal.md`, the review response and the copied round 2 review (identical to mine) at `57a701d0`, against Josh's round 2 decisions as the assignment and the response record them, the reviewer checklist, the code at the branch base `b5477211`, and current `origin/main` (`a8e73fbf`).
- I ran nothing. Every check is a read of files in the checkout or of git history.

## The blocker is resolved

| Round 2 asked for | The proposal now says | Checked |
| --- | --- | --- |
| An entry point | The canonical runner's `acquireAny()` recovers on finding an expired `recoverAfter`; the pool script's mutations reuse the same helper. | Consistent with `acquireAny` at `scripts/run-blaxel-testshards.mjs:333-358` (base), the only acquisition path. |
| Evidence that the coordinator is gone | The coordinator renews once a minute; the deadline is worker-local time of the last renewal plus the configured worker timeout plus 15 minutes; renewal cannot revive an expired reservation; only the coordinator renews. | Worker-local time avoids clock skew. Coordinator-only renewal is right: a shard that renewed for itself could hold a worker forever after its coordinator died. |
| A decision on undownloaded reports | Discarded when recovery runs, recorded in a receipt with the incoming attempt's setup sidecars; loss never becomes a passing result. | Resolves the "forever" reading of download-before-release. |
| The cost | 19 or 23 minutes after the last renewal, then one acquisition and bounded cleanup; quiet and active leftovers wait the same interval. | Sized and stated. |

Code claims the design rests on, all verified:

- A new lock written with `expiresAt: 0` is left alone by the old runner, which reclaims only a positive past timestamp (`run-blaxel-testshards.mjs:405-406`, base).
- An old shard's exit trap releases only a lock carrying its own `lockId` (`release_lock`, lines 773-775), so an old shard ending cannot remove a new owner's lock. The proposal could say this; it is why the legacy case is a skip, not a hazard (refinement 3).
- The owner token lives in one variable, `TV_TEST_SURFACE_OWNER`, and a surface supervisor replaces it for its children (`scripts/test/surface-supervisor.mjs:62`, main). A second attempt-level token that nested supervisors do not replace is therefore needed, as the proposal says.
- The existing reaper leaves processes with live supervisors untouched (`scripts/test/stale-owner-reaper.mjs:24, 96`). Recovery has to stop the abandoned run's live supervisor as well, which the proposal states without weakening the reaper for other owners.
- The worker timeout is the bound on the shard process itself: `process.exec({ timeout })` and `process.wait({ maxWait })` at lines 448 and 457. The spec's TTL and "final bound" sentences the proposal replaces are at `specs/arch/test-runner/blaxel-testshards.md:27-31`.

## Is the recovery design as simple as it can safely be? Nearly

What is simple and right:

- One sequence for a quiet worker and for a still-active run, with no second liveness test and no report-age clock. That is the shape Josh asked for.
- One renewal, from the coordinator only, with the reason given.
- One guard (`flock` on a fixed file) for all worker-local lock changes. This is justified by a race in our own code: a renewal that read the lock before recovery replaced it would otherwise overwrite the new owner's record and fail the new run. It is one line of shell and is released by the kernel when a process dies.
- Orphaned reports are discarded, not archived; recovery is repeatable if it dies midway; a coordinator that finds its identity gone stops and reports.

What can go without losing safety is in refinements 1 and 3. The one gap in the simple story is refinement 2.

## Refinements (none blocking)

1. **Use one fixed recovery interval, not "worker timeout plus 15 minutes".** Renewal is a timer, so the shard's execution bound has no bearing on how long a healthy coordinator can go without renewing: it renews every minute whatever the timeout. The timeout term adds a field recorded at acquisition, a custom-timeout case in the contract coverage, and two derived numbers to keep in step with the profiles. One interval does the same job. Reuse the existing `--lock-ttl-seconds` option (`blaxel-testshards.md:76`) as its override, which also lets the live recovery check on the private workers use a short interval instead of waiting at least 15 minutes per case. The renewal cadence is a free choice too: once a minute is 36 API calls a minute for a full run; a longer cadence with the same deadline costs nothing in safety.

2. **The pool script must be able to delete the worker that needs repair.** The proposal has `delete` acquire each worker's lock and refuse busy ones, and names "operator repair" as the way out when a process cannot be stopped. Those two rules meet badly: the worker that cannot be cleaned is exactly the one the script would refuse to delete. Deleting a sandbox is the cleanup, so `delete` should refuse only a reservation that is still being renewed and proceed on one past its deadline, including one held because cleanup failed. Say also that a deleted worker is not re-added until the pool is recreated, since `ensure` is fresh-only (`scripts/manage-blaxel-testshards.mjs:41-47`); that is the status quo, and one sentence keeps an operator from expecting otherwise.

3. **An expired legacy lock with live work is a skip, not a repair.** The proposal says to "keep and report" such a lock and, in its status section, that "unidentifiable legacy work still needs repair". Because the old shard's trap removes its own lock when it ends, an updated runner only has to skip that worker in this acquisition, as it already does for an unexpired lock; the worker frees itself. The only stuck case is an old shard that never exits, which is the status quo and ends when branches take main. Dropping the repair language removes a case from the design and from the spec.

4. **Three sentences to trim or fix.**
   - The 128 KiB cap on the recovery receipt. A receipt is a few hundred bytes of identities and outcomes, and the attempt's 8 MiB diagnostic budget already bounds it.
   - "Fresh provisioning runs with dispatch to that pool stopped until setup and architecture verification finish." Nothing stops dispatch to a shared pool. If the intent is that `ensure` holds each new worker's lock until provisioning is verified, say so; otherwise rely on the architecture check that already skips an unprovisioned worker (`verifySandboxArchitecture`, lines 360-380, base) and drop the sentence.
   - "Manual pool operations use the same drained-pool discipline." No such discipline is defined now that recreation is out of scope.

## The rest of the proposal

- **Built-application conversion.** Five cases in two files is a defensible judgment on the post-#32 evidence, and the proposal's facts hold on main: both files use a `ProductServer` through `appURL()` (`browser-demo-mode.test.ts:75-79`; `theme-product-acceptance.test.ts:694-695, 1065-1068`); the two theme cases restart the server (lines 845, 1785), and `restart()` boots a new port-0 backend (`test/helpers/product-server.ts:26-32`), so the stable front proxy is required for them, as the proposal says; `views/url-unsupported` is built (`packages/web/vite.config.ts:178`), served from Vite under `appURL()` (`shouldProxyToVite`, `product-server.ts:393-400`), and not copied by `installProductRuntimeAssets()` (lines 103-132), so the asset copy is a real prerequisite. The product proof calls the persistence walk "production shell modules through the test Vite server" at line 42 and the same walks "built application" at lines 44 and 51; the delivery proof does the same at lines 61 and 74-75. That is the description change the proposal anticipates. The testing directive is now scoped to `ProductServer` acceptances and excludes `appURLForServer()` walks, which settles round 2's refinement 1.
- **Round 2 refinements 2 to 4** are applied as proposed: every non-current attempt directory is removed after a clean audit; the old-branch preconditions are gone; the Chromium 148/145 discrepancy is stated and the build alias is still on main (`run-blaxel-testshards.mjs:923`); the credential path is supported by the code: the SDK reads `BL_API_KEY` and `BL_WORKSPACE` from the environment (`@blaxel/core` `common/settings.js:16-24`, `authentication/index.js:9-11`), `readBlaxelGithubToken()` reads the file and then `BLAXEL_TV_GH_TOKEN` (`scripts/test/blaxel-github-token.mjs:7-18`), and the runner passes only `GH_TOKEN` to workers (line 448).
- **Exposure table.** The three `appURL()` users found in round 2 are now listed; the reload in web `artifact-isolation.test.ts:149` and the second page in `artifact-move.test.ts:54` are as described.

## Reviewer checklist

- **Authority.** The derivation list names the right owners and says the Blaxel spec's TTL escape and shell-exit unlock are replaced. Add the fate of `--lock-ttl-seconds` (refinement 1) so the option table is not left describing a removed mechanism.
- **Testing directives.** The one directive is scoped and phrased as a default, not a prohibition.
- **Proportionality.** The lock and cleanup sections are long because Josh asked for those decisions here; the diagnostics commitment is the minimum; the conversion is two files. The length is in proportion to what is decided.
- **Status.** Accurate: ready for re-review, not converged; no spec, test or code edited; nothing run.

## Evidence and limits

- Read the proposal, the response and the copied review in full and diffed them against `d3570bf4`; read the base coordinator's lock, dispatch, wait, trap and timeout code, main's reaper, supervisor, token reader and pool script, the SDK's credential code, the two conversion targets, the three exposure-table files, both theme proofs, and the Blaxel spec's locking section.
- Not established: whether Blaxel's process `timeout` ends descendants (the proposal assumes not, which is the safe side); any rate limit on renewal calls; whether the provider can deliver a dispatch after a recovery interval (the shard-start lock check is cheap either way).

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness.
