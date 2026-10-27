# Plan review, round 2: test-harness resource cleanup (PR #12, 04a6b275)

**Verdict: PASS.** The final gate is back where it can complete: `npm run verify -- blaxel --pool poc` at the standard 36 shards, invoked from the dedicated coordinator sandbox after the private workers are qualified and deleted, with the private pool kept for every experiment that interrupts, contaminates or deletes anything. The four round 1 refinements are applied. Read as a whole, the plan still has three coherent slices, every pending proof obligation assigned, honest intermediate baselines, scope inside the converged specs, and no execution on the shared development host. Two small refinements follow, neither blocking.

- Reviewed: the whole plan at `04a6b275`, the diff since `70f27ccb` for the plan, proposal and response, the copied round 1 review (identical to mine), and the runner code the plan's new statements rest on. No spec or proof changed in this revision.
- Branch state: contains `origin/main` (`a8e73fbf`).
- I ran nothing. Every check is a read of files in the checkout or of git history.

## The blocker is cleared

| Round 1 asked for | The plan now says | Checked |
| --- | --- | --- |
| A gate that can complete | `npm run verify -- blaxel --pool poc`, standard 36 shards, from `tv-cleanup-coordinator-rose`, after private qualification and deletion of both private workers (`plan.md:82-88`) | Publication-qualifying shape; `verify` forwards `--pool`; the coordinator sandbox is outside pool labels, so Josh's host rule holds. After the two private workers are gone, the tier holds `poc`'s 72 plus the coordinator. |
| A stated reason for leaving `poc`, or a return to it | The arithmetic is recorded (`:90`): 882.5 seconds of file medians, about 441 seconds per worker over two, against the 480-second cold worker timeout the canonical runner does not raise; no timeout control or private capacity is added for this contribution | Matches my own sum of `test/timing-baseline.json`; the response owns the earlier choice as an over-broad reading of the experiment restriction rather than a requirement. |
| `poc` used only for ordinary verification | "No deliberate interruption, contamination, pool deletion or provisioning targets `poc`… Unavailable leases remain an infrastructure failure, not permission to steal a lock or alter the pool" (`:88`) | This is the production condition the new coordinator must work in: shared workers, other branches' runners, legacy locks, known leftovers. The spec's transitional rule keeps other runs safe from it, and it from them. |

## The refinements are applied

1. **Large-surface expansion** (`:19`, `:37`): focused files and directly affected helper callers on the private pool; whole large surfaces, `e2e:browser-app` named, wait for the standard-shard gate. The new statement that `--surface` always takes the one-worker targeted path even with `--shards` is true: the targeted branch forces `--shards 1` (`scripts/test/cli.mjs:497`).
2. **`--lock-ttl-seconds` forwarding** is now in slice 3's implementation area as a runner change with ordinary invocations unchanged and no worker-timeout forwarding (`:59`). See refinement 1 below on its stated coverage.
3. **Request inventory** names Playwright request events inside the five existing walks (`:35`).
4. **Tier arithmetic** is in the execution section with the instruction to inspect occupancy before provisioning and to report rather than touch shared workers (`:17`).

## The whole plan, re-read

- **Slices.** Unchanged and still right: helpers and the five built-application walks; bounded diagnostics; the lease, dispatch, recovery, scratch, pool and live-qualification lifecycle kept together because it is one safety argument.
- **Obligations.** All 31 pending anchors assigned as in round 1; nothing moved.
- **Baselines.** Slice 1 green for its obligations with the killed-worker backstop assigned to slice 3; slice 2 explicit that the live diagnostics evidence and the lease/download race stay open; slice 3 resolves everything before completion (`:76`).
- **Sequencing on the private pool.** Slices 1 and 2 run focused tests on `rose-cleanup` under the existing coordinator; before slice 3's fresh-provisioning acceptance the idle pool is deleted through the manager so the driver's `^blaxel-t-pool-live` can create it fresh (`:21`); after the driver's deletion case nothing is re-provisioned and the gate moves to `poc`. The order is consistent with `ensure` being fresh-only.
- **Placement.** Edit, commit and push on the shared host; everything else on Blaxel from the coordinator sandbox; the driver as `npm test -- local --surface experiment:blaxel-harness` there; no isolated-GitHub fixtures; no experiment suite as a whole.
- **Evidence.** Red and green commit IDs, commands, run-directory paths and recovered retries retained per slice; the final gate reports the revision actually tested; docs prep deferred to after integrated validation; Josh's spec acceptance and required checks named as merge obligations, not claimed.
- **Limits.** Accurate (`:96`): the implemented tree's gate duration, coordinator capabilities and current tier occupancy are unmeasured and carried into the slices that can measure them.

## Refinements (none blocking)

1. **The forwarding's stated coverage overstates what exists.** `:59` says the `--lock-ttl-seconds` forwarding is "covered by the existing CLI delegation contracts". The existing coordinator tests in `test/repo/test-runner-provider.test.ts` and its neighbours read `run-blaxel-testshards.mjs` as source; none asserts the argument list `scripts/test/cli.mjs` hands the coordinator. The live recovery run shows the override arriving but cannot show that an ordinary invocation omits it. Slice 3 should add one small contract: an explicit `--lock-ttl-seconds` appears in the delegated arguments and is absent by default. It is a few lines beside the existing source assertions.
2. **Say what "the tier" counts.** `:17` treats the 75-shard hard limit as a sandbox count (72 + 3). The Blaxel spec phrases it as concurrent shards, and whether idle sandboxes count against it is not established. The sentence already tells the implementer to inspect actual occupancy and limits; adding "whether idle sandboxes count is unknown" keeps the first provisioning attempt from assuming either answer.

## Reviewer checklist

- **Derivation.** Slices point at proof anchors and spec sections; implementation areas are named as areas.
- **Verification criteria and baselines.** Honest per slice, and the final criterion is now achievable with the standard runner and pool.
- **Placement.** Nothing on the shared host; `poc` sees only ordinary verification; experiments private.
- **Scope.** Proportionate: no timeout controls, private capacity, sampler, archive, service or framework added; production behavior, retry defaults, shard default and browser version untouched.
- **Status.** Accurate: no tests or implementation exist; nothing has been executed.

## Evidence and limits

- Read the full plan, the three working-document diffs, and the runner code for the targeted path and verify pass-through; re-mapped the pending anchors; compared the copied review.
- Not established: current tier occupancy; the coordinator sandbox's local preflight capabilities for the driver surface.

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness.
