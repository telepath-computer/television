# Spec review, round 1: test-harness resource cleanup (PR #12, cd8aa453)

**Verdict: PASS.** Every decision in the converged proposal is in a spec, in the owner the proposal named, and the affected tree reads consistently: the Blaxel spec's lifecycle, the reporting contract, the shared execution model, the runner's owner rules and the testing policy agree with each other and with the unchanged specs around them. Nothing in another spec still promises the mechanism this change replaces. Eight refinements follow; the first two are worth making before Josh reads the deltas, and the rest are trims that keep the specs as simple as the proposal intends.

- Reviewed: `git diff origin/main...cd8aa453 -- specs` (five specs and the regenerated index), against the proposal and response at `cd8aa453`, the reviewer checklist, main's rewritten spec policy, the unchanged specs and proofs that cite the replaced mechanism, and the code the specs describe.
- Branch state: the branch contains `origin/main` (`a8e73fbf`); the merge `74d22941` changes nothing outside `docs/working/` relative to main and nothing in `docs/working/` relative to the branch. The copied round 3 review is identical to mine.
- I ran nothing. Every check is a read of files in the checkout or of git history.

## The proposal's decisions, located

| Decision | Spec | Checked |
| --- | --- | --- |
| One lease through teardown and download; shell never unlocks | `blaxel-testshards.md:45-47` `^blaxel-release` | Matches proposal order 1-5. |
| Coordinator-only renewal; 20-minute interval via `--lock-ttl-seconds`, independent of the execution timeout | `:41`, options table `:126`, profiles `:135` | 1200 s and "20 minutes" agree; the old TTL rows are gone. |
| Automatic recovery: one sequence for quiet and active leftovers, kill by token, discard orphan reports, receipt | `:51-57` `^blaxel-recovery`; receipt contract `reporting.md:224` | Receipt shares the 8 MiB attempt budget; no separate cap. |
| Attempt owner token preserved beside the surface token; registration before checkout | `:43`; `test-runner.md:222` | Consistent with the one-variable token the supervisor replaces today (`scripts/test/surface-supervisor.mjs:62`). |
| Legacy records: `expiresAt: 0`, respect TTL, skip live legacy work | `:61` | Matches the old reclaim test (`run-blaxel-testshards.mjs:406`) and the matching-ID trap (`:773-775`). |
| Deletion may destroy an expired worker that failed cleanup; dispatch eligibility removed first | `:63` | The SDK can change labels on a live sandbox (`@blaxel/core` `SandboxInstance.updateMetadata`). |
| Labels published after provisioning; no silent reuse; `ensure` does not refill | `:33` | Same SDK call. |
| `--audit-stale-owners` reserves without recovery | `:65`, table `:133` | |
| Per-attempt scratch, `TMPDIR`, exact two-prefix cleanup, every non-current attempt directory | `:69-80` `^blaxel-scratch`, `^blaxel-known-leftovers` | Caches, lock, guard, uploads and X11 preserved. |
| Minimum diagnostics, retention rules, 64 KiB / 128 KiB / 8 MiB bounds, honesty about what the numbers mean | `reporting.md:214-226` `^resource-diagnostics`, `^resource-diagnostic-bounds`; fields in `reporting.md:85` and `sharded-execution.md:255` | |
| Worker-owned reusable builds | `testing-policy.md:210` `^worker-build-lifetime` | See refinement 4. |
| Built application by default for `ProductServer` acceptances, scoped | `testing-policy.md:212` `^product-acceptance-built-app` | Excludes `appURLForServer()`, fixtures and Electron seams, as converged. |

Other checks: the nine new anchors are unique in the tree; every new link resolves to an existing heading (`Resource diagnostics`, `Abandoned-run recovery`, `Locking`, `Temporary files`, `Destructive fixture placement`, `Pool`); the index's line counts match the files; `preflight.md:47`, `test-runner.md:153` and `sharded-execution.md:321` still describe the stale-owner exception correctly; the test-runner proof's "retains the lease until TTL" (`proofs/arch/test-runner/blaxel-testshards.md:57`) is the expected proof-stage follow-up, which the response defers on purpose.

## Refinements (none blocking)

1. **One word for the thing the coordinator holds.** The Blaxel spec now says *reservation* 17 times, *lease* 14 and *lock* 14 for the same object, and `test-runner.md:153` and `sharded-execution.md` still say *lease*. A cold reader will look for a distinction that does not exist. Keep *lease* (the established term) for what the coordinator holds and *lock* for the directory that records it, and drop *reservation*. The same applies to *attempt*: `terms.md:124` defines it as one execution of the shard set, while the new text uses it for one shard's execution (`attempt directory`, `attempt owner token`, `incoming attempt`). Say *shard attempt* where that is meant, as `reporting.md:218` already does.

2. **An unreadable lock record is treated two ways.** `blaxel-testshards.md:57` lets ordinary acquisition reclaim an acquisition interrupted before registration after a clean worker audit, since execution cannot precede registration. `:63` says that for deletion "an unreadable ownership record is not proof of expiry", so the pool script would refuse a worker a test run may take. One rule serves both: a record that cannot be read is reclaimed, by acquisition or deletion, only after a clean worker audit, and held otherwise. Say it once, in the recovery section, and let the deletion paragraph refer to it.

3. **Deletion of a worker that cannot run commands is undefined.** Deletion "checks the same identity and deadline under the guard", which needs a worker that answers `process.exec`. A sandbox that is not `DEPLOYED` cannot be leased (`:25`), so nothing can be running on it and it can be deleted without a guard; a `DEPLOYED` worker whose commands fail is the provider failure the spec sends to an operator, and deletion is that operator's tool. One sentence closes this: a worker no coordinator can lease may be deleted without a reservation.

4. **`^worker-build-lifetime` says more than the rule.** The need is one sentence: a reusable build a helper creates belongs to the worker that created it, is published only after it succeeds, and is removed at worker teardown rather than per test case. The rest, waiting for pending builds, stopping consumers, Playwright and Vitest both, the per-launch copy and home, idempotence, is what a competent implementer does without being told, and each clause is a line every future helper change is reviewed against. Trim to the rule and the backstop link.

5. **Consequences for the unchanged operations text.** `:158` still says to provision `poc` by deleting the complete pool, which under `:63` now refuses any worker with a live lease. Say that recreation needs an idle pool, or that refused workers are reported and the command exits non-zero. Relatedly, the `Output` section (`:141`) lists what a shard download adds but not where resource sidecars and recovery receipts land; one clause (under `artifacts/shard-<i>/`, with the task artifacts, as `sharded-execution.md:228` implies) saves an implementer a guess, and the shard lifecycle's step list (`:86`) should name the cleanup step if its counts and free-space figures are recorded as a setup timing, as `:76` requires.

6. **Mark the legacy paragraph transitional and drop its non-requirements.** `:61` is a mixed-version rule that ends when every branch has integrated this change. Saying so lets a later change delete it with confidence. Its last sentence, "No pool-wide drain or simultaneous branch update is required", and `:63`'s "Read-only pool listing needs no reservation" state what the spec does not require, which spec policy leaves to silence.

7. **Two items in the Blaxel `Testing` section fail the testing-guidance test.** "Existing `isolated-github-only` fixtures retain their placement restriction" restates a rule that applies regardless (`test-runner.md:191`); removing it changes no derivation. Recording the launched browser version and executable is investigation hygiene for interpreting measurements, not something a proof needs to prove `^blaxel-scratch`; keep the `TMPDIR` observation, which a test author would miss, and move the browser-version note to the proposal's validation plan where it already lives.

8. **Small wording.** `:69` says setup sidecars "use the attempt directory" and `:78` removes that directory before download; the two agree only through "finalize evidence outside scratch" between them. Say that setup sidecars are written in the attempt directory and finalized into the results tree before it is removed. `:76`'s last sentence ("Do not equate allocated bytes removed with free-space change…") is a caution about reading the numbers, not a requirement; the proposal can keep it.

## Reviewer checklist

- **Slop-free / authority.** The deltas stay in the owners the proposal named; the Blaxel spec's opening line and paragraph now claim recovery and temporary files, and reporting's opening claims resource diagnostics. The TTL escape and shell-exit unlock are replaced, not left beside the new rule.
- **Altitude and contract vs. implementation.** The TypeScript fields are the only type change and match on both sides. The Blaxel spec is where the lifecycle detail belongs; the testing policy is one place where the detail outruns the rule (refinement 4).
- **Writing and terminology.** Refinement 1. Otherwise plain, with rationale kept short.
- **Testing guidance.** Refinement 7. The new testing-policy default is a default, not a prohibition, and is honored by test design rather than asserted by tests.
- **References.** All new links and anchors resolve; nothing links to the removed sentences.
- **Size.** The Blaxel spec grows from 131 to 174 lines, in proportion to what it now decides; it is not a decomposition candidate.
- **Status.** The specs promise behavior the coordinator does not yet have, which is the workflow's normal state between spec and implementation. The one transitional rule is in refinement 6.
- **Proof coverage and mocking.** Not at this stage; the response is right that proofs follow spec convergence.

## Evidence and limits

- Read the full spec diff and the full Blaxel spec at `cd8aa453`; the proposal and response diffs since `57a701d0`; the merge commit and its content relative to both parents; spec policy's testing-guidance and transitional-status rules; `terms.md`; the preflight, test-runner, sharded-execution and reporting passages that cite leases or stale owners; the test-runner proof line that cites TTL; and the SDK's sandbox update methods.
- Not established: whether Blaxel accepts a label change on a `DEPLOYED` sandbox in practice (the SDK exposes the call); whether recovery fits inside the coordinator's current 30-second acquisition command timeout (an implementation choice the spec does not constrain).

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness. The response records Primitive output in the author's session; I have not seen it and do not assess it.
