# Plan review, round 1: test-harness resource cleanup (PR #12, 70f27ccb)

**Verdict: FAIL, on one item.** The three slices are coherent, every one of the 31 pending proof obligations has a slice, the red/green criteria and intermediate baselines are honest, the scope stays inside the converged specs, and nothing in the plan runs on the shared development host. The blocker is the final gate. The plan moves full verification from the shared `poc` pool, where the converged proposal put it, to the two private workers with `--shards 2`. The repository's own timing baseline says each of those two shards would carry about 441 seconds of measured test compute before any setup, against the 480-second worker timeout the canonical runner cannot raise, on a tier that cannot hold a larger private pool. The gate as planned will not complete, and the plan's contingency is to stop and report at the end of the work rather than decide now. Returning the gate to `poc` at the standard shard count, run from the dedicated coordinator sandbox, clears it in a sentence. Four refinements follow, none blocking.

- Reviewed: `docs/working/test-harness-resource-cleanup-plan.md` at `70f27ccb` against the workflow's Planning and slices section, the testing policy's iteration and verification rules, the runner spec's publication-qualification and verify rules, the reviewer checklist, the proof obligations at this revision, the runner's option forwarding, and the committed timing baseline. Also the bounded proof binding and two spec clauses since `3fa15d47`.
- Branch state: contains `origin/main` (`a8e73fbf`); the copied round 2 proof review is identical to mine.
- I ran nothing. I read `test/timing-baseline.json` with a small script that sums its recorded medians; nothing was built, tested or changed.

## The binding since round 2 stayed in scope

The shared live declaration now names both surfaces, the coordinator host rule and both selection commands, the coverage model names the placement, and the registry proof carries one source-level selection contract (`^registry-t-blaxel-harness-selection`). The runner spec gained the `Selectors` clause and the guardrail cross-reference I asked for. Nothing else moved. The one unrelated pending anchor in the tree (`proofs/arch/cli/startup-bind-failure.md`) predates this branch.

## Slices, obligations, baselines

| Slice | Obligations placed | Baseline stated |
| --- | --- | --- |
| 1: worker-owned builds and the five built-application walks | `^testing-t-build-lifetime`, `^testing-t-build-worker-seam`; the eleven theme, delivery, artifact and bridge citations graded "built-application boundary: test to be written" | Green for its obligations; killed-worker backstop assigned to slice 3 (`plan.md:37`). |
| 2: bounded diagnostics and report transport | `^reporting-t-resource-bounds`, `-parent`, `-links` | Explicit: `^reporting-t-resource-live` pending, lease/download race still present, checkpoint not safe for concurrent reuse (`:51`). |
| 3: exclusive lifecycle, scratch, pool mutation, live qualification | `^blaxel-t-lease-decisions`, `-lease-order`, `-worker-guard`, `-scratch-cleanup`, `-scratch-errors`, `-pool-order`, the `^blaxel-pool-pagination` extension, `^registry-t-blaxel-harness-selection`, and the five live assertions including `^reporting-t-resource-live` | Resolves every earlier baseline (`:74`). |

The slice judgment is sound: helper ownership and shipped-asset loading have no dependence on the coordinator; diagnostics have their own native-runner boundary; and the lease, dispatch, recovery, scratch and pool rules are one safety argument that should not be reviewed in halves. Three slices is the right count. The order lets the live runs prove the composition once. Each slice's red/green discipline is the policy's (narrow red first, widen after green, a failed import is not red), the existing TTL assertions are replaced rather than left endorsing superseded behavior, and the plan keeps the retry defaults, shard default and browser version out of scope.

Execution placement is right throughout: edit, commit and push on the shared host; every run on Blaxel through the canonical runner from `tv-cleanup-coordinator-rose`; the driver as `npm test -- local --surface experiment:blaxel-harness` on that sandbox; private pool `rose-cleanup` for everything that touches workers; the pool deleted and re-provisioned around the fresh-provisioning acceptance because `ensure` is fresh-only.

## Blocker: the final gate cannot complete as planned

`plan.md:80-88` runs `npm run verify -- blaxel --pool rose-cleanup --shards 2 --allow-shard-count-override 1` on the two private workers and says this "replaces the proposal's earlier shared-`poc` final-run plan", with no reason given. It qualifies under the runner spec (`--shards` repartitions without narrowing, `test-runner.md:76`) and `verify` forwards `--pool`, `--shards` and the override (`scripts/test/cli.mjs:284`). It is still the wrong gate:

- **Compute.** `test/timing-baseline.json` records Blaxel medians for 311 files totalling about 883 seconds, which is the 25-second mean per shard at 36 shards the Blaxel spec quotes. Two shards carry about 441 seconds each before checkout, dependency, pre-command builds, readiness and any e2e retry. `e2e:browser-app` alone is 376 seconds.
- **Ceiling.** The coordinator bounds each shard's process at the worker timeout: 480 seconds under the `cold` profile the canonical runner always passes (`run-blaxel-testshards.mjs`, `process.exec` timeout and `process.wait` maxWait). `verify` forwards no `--worker-timeout-seconds`, and neither the runner spec nor the plan proposes to add it.
- **No room to grow.** The tier's hard limit is 75 concurrent shards and `poc` holds 72 (`blaxel-testshards.md:25`), so a private pool cannot reach the standard count.

The plan half-knows this: "two workers will be slower… and may expose a timeout/capacity limit; inspect the real plan/timings on Blaxel before the gate… report that blocker" (`:86`). The numbers are in the repository now; deferring the decision to the end of slice 3 puts the stall where it costs most.

**To clear it:** run the final gate on `poc` at the standard 36 shards, from `tv-cleanup-coordinator-rose`, after the private pool's deletion acceptance has run and its sandboxes are gone. That is the converged proposal's arrangement, it is what the proposal's round 3 passed, it keeps Josh's rule (the ban is on the shared host, not the shared pool), and it is the ordinary production condition the new coordinator must work in: shared workers, other branches' runners, legacy locks and known leftovers. The private pool stays for the experiments that contaminate or kill things. If the author has a reason to avoid `poc` for the gate, the plan should state it so it can be weighed; none is visible to me.

## Refinements (none blocking)

1. **Whole-surface expansion on the private pool has the same ceiling.** `:19` sends surface expansion through `--pool rose-cleanup`; `--surface` takes the targeted path, one shard on one worker, so `e2e:browser-app` at 376 seconds plus setup is at the limit even on `poc`. For the large surfaces, expand with the planned selection path (`--package` or `--tag` with `--shards 2`) or leave whole-surface coverage to the gate; say which.
2. **`--lock-ttl-seconds` forwarding is a small runner change the plan should name as such.** `:19` says to ensure the canonical CLI forwards it for the driver. The runner spec enumerates no pass-through list, so this is code-governed and needs no spec line, but it is production runner code touched by slice 3 and belongs in that slice's implementation area with a sentence saying ordinary runs are unchanged.
3. **Slice 1 should say where the request inventory comes from.** "Retain a request inventory showing the built page" (`:35`) is the right observation; name the mechanism (Playwright's request events in the existing walk) so it is not read as a new harness.
4. **Record the tier arithmetic once.** Three private sandboxes beside `poc`'s 72 reach the 75-shard limit exactly; another agent's verify during the experiments would contend. The proposal already says to inspect actual usage before provisioning; the plan's execution section should repeat the one line so the implementer does not provision into a full tier.

## Reviewer checklist

- **Derivation.** Every slice points at proof anchors and spec sections, not at files alone; the implementation areas are named as areas, with the specs and proofs kept as the requirements.
- **Verification criteria and baselines.** Honest per slice; the final-gate criterion is the blocker above.
- **Placement.** No test, build, lint, type check, browser or server on the shared host; no shared `poc` workers for experiments; isolated-GitHub fixtures untouched.
- **Scope.** Proportionate: no sampler, archive, service or framework; production behavior untouched.
- **Status.** Accurate: no tests or implementation exist; unknowns listed (`:90-92`).

## Evidence and limits

- Read the plan in full, the proof and spec diffs since `3fa15d47`, the workflow's planning section, the policy's iteration and verification sections, the runner spec's qualification, verify and selector rules, and the runner's forwarding code; mapped each pending anchor to a slice.
- The timing figures are the baseline's recorded medians at 36 shards; they exclude setup phases and retries, so the two-shard estimate is a floor.
- Not established: the coordinator sandbox's local preflight capabilities for the driver surface; current tier occupancy.

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel beyond a script that summed a committed JSON file into the scratchpad. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness.
