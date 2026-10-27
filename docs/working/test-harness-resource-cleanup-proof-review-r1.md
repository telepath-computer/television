# Proof review, round 1: test-harness resource cleanup (PR #12, 9fd51f49)

**Verdict: FAIL, on one item.** The proofs cover every promise the touched specs make, at honest shapes, with every mock named and its forfeit placed, and at a cost in proportion to the risk. The spec refinements since `cd8aa453` change wording and resolve the two inconsistencies my spec review named; they change no converged promise. The one blocker: the live assertions and the deliberately failing fixture tests they run have no home. Which suite holds a test is spec authority (the registry's `kind` list and the runner's suite and exclusion rules), and the proofs decide it silently with "an explicit paid-service selection". That is the one thing a proof may not do, and the tests cannot be written until it is settled. The fix is a few sentences in two specs and one line in the proof, or a different framing that needs no spec change at all. Five refinements follow, none blocking.

- Reviewed: `git diff cd8aa453 9fd51f49 -- specs proofs docs/working`, the full Blaxel, reporting and testing-policy proofs at `9fd51f49`, the proof policy, the testing policy's mocking, composition, shape and cost rules, the reviewer checklist, and the code the hooks name.
- Branch state: contains `origin/main` (`a8e73fbf`); the copied spec review is identical to mine; product and theme specs are unchanged.
- I ran nothing. Every check is a read of files in the checkout or of git history.

## The spec refinements change no promise

| Change since `cd8aa453` | Effect |
| --- | --- |
| *reservation* → *lease*/*lock*; *shard attempt* where one shard is meant; `provider attempt` for the directory identity | Wording only. |
| One rule for unreadable or incomplete lock records: reclaim by acquisition or deletion only after a clean worker audit (`blaxel-testshards.md:57`) | Resolves the contradiction my spec review found; the proposal now says the same (`proposal.md:99`). |
| A never-published fresh worker may be deleted without a lease; a worker that cannot answer the ownership check is held (`:63`) | The narrow half of refinement 3, deliberately; the response explains why it declines the wider inference. Consistent. |
| Legacy paragraph marked transitional; two non-requirements dropped; `temporary-cleanup` named as a setup step; sidecars and receipts located under `artifacts/shard-<i>/`; idle-pool deletion stated in operations; setup sidecars finalized before scratch removal; two `Testing` items removed | All from the spec review; none adds or removes a promise. |
| `^worker-build-lifetime` trimmed to the rule | The dropped sentences were derivable detail; see refinement 4 for one proof assertion left pointing at nothing. |

## Coverage, shape by shape

**Blaxel spec.** The lifecycle is composed the way the testing policy asks: breadth at two contracts with authored records and recording callbacks (`^blaxel-t-lease-decisions`, `^blaxel-t-lease-order`), the real handoffs crossed once each with real processes, `flock`, procfs and signals (`^blaxel-t-worker-guard`) and a real filesystem (`^blaxel-t-scratch-cleanup`, with the lease and audit precondition declared as the mock), and the spine walked for real through the canonical CLI against Blaxel (`^blaxel-t-retrieval`, `^blaxel-t-recovery-live`, `^blaxel-t-pool-live`), with the temporary-directory directive honored by inspecting the launched browser's descriptors (`^blaxel-t-tmpdir-live`). I mapped every promise in Locking, Abandoned-run recovery, Older runners and pool operations, Temporary files, Pool, Output and Operations to an assertion; the only two without one are small and noted in refinement 5. The forfeits are honest and placed: mocked clock and audit to the guard seam and live recovery; the audit's token filter to live recovery; SDK substitutions to the pool acceptance. The superseded cleanup bullet (`proofs/arch/test-runner/blaxel-testshards.md:67`) correctly retires the TTL assertion that the existing `test/repo/test-runner-provider.test.ts` still encodes; that test changes with the code.

**Reporting spec.** Bounds, units, unknown-not-zero, counter resets, retention for failed and recovered attempts, attempt history, link validity, credential exclusion and the receipt's contents are all ordered, at the right price: a writer contract with authored readings, one real parent/child/procfs seam that manufactures no OOM, a normalization contract over real sidecar files, and retrieval shared with the provider's live runs rather than a second crash. The hooks (probe reader, clock, output root, write operation, the guarded registry hook for fixture selection) exist or are declared.

**Testing policy.** `^worker-build-lifetime` gets a filesystem contract with recording builders plus a real Playwright and Vitest worker seam that builds and serves real output, which is the honest crossing the rule needs. `^product-acceptance-built-app` is honored by the design of the five theme and demo-mode walks and ordered no compliance scan, which is right under `^testing-guidance-standing`.

**Shared execution, runner, themes, artifacts.** Cross-references only, pointing at the provider and reporting assertions; the five converted walks keep their product assertions and change only their loading boundary, which the proof policy allows a proof to do alone (`^proof-change`). All new anchors are unique, every link resolves, cited test files exist, the `TV_TEST_RUNNER_SELFTEST` gate matches its existing use (`scripts/test/cli.mjs:1074`, `planned-shard-worker.mjs:458`), and the proofs index matches the files.

## Blocker: the live assertions and their fixtures have no home

`^blaxel-t-retrieval`, `^blaxel-t-recovery-live`, `^blaxel-t-pool-live`, `^blaxel-t-tmpdir-live` and `^reporting-t-resource-live` are automated tests: they spawn the canonical CLI, provision a pool, kill a coordinator, and "a bounded test driver owns and finally cleans up its coordinators and private workers". They need Blaxel credentials, a dedicated pool and minutes of wall clock, and they run "committed native fixture tests" that fail once or always. The coverage model says only that they are "an explicit paid-service selection, not a recursive addition to every broad run" (`proofs/arch/test-runner/blaxel-testshards.md:15`).

- Which suite holds a surface is spec-owned: `test-registry.md:44` enumerates the kinds in use, `:95` says what `all` and the `experiment` suite contain and why, `test-runner.md:61, 92` name the opt-in suites, and `blaxel-testshards.md:162` lists the suites excluded from Blaxel broad verification. None of them admits a surface that drives Blaxel from inside a test, or fixture surfaces that fail by design.
- The fixtures have the same gap. A planned Blaxel run selects surfaces from the registry on the worker; a fail-once fixture inside `all` would break every broad run, and the reporting proof's registry hook (`TEST_SHARD_CONFIG_MODULE`) reaches a local parent, not a Blaxel worker, unless the coordinator forwards it, which would be a new hook the Blaxel proof does not declare.
- Where they run also matters here: the assignment and Josh's rule keep tests off the shared developer host, and the proposal names a credentialed Blaxel coordinator sandbox. The proof should say that these tests are run from such a host, never from a shared developer host or a Blaxel worker.

Two ways to clear it, either small:

1. **Register them.** Add an opt-in surface for the live harness tests and one for the fixture tests (an existing kind such as `experiment`, whose spec already carries one "runs only when selected" class, or a new kind), with the registry, runner and Blaxel specs updated to say so, and the proof's shared live declaration naming the surfaces and the host they run from. Josh sees the spec sentences at PR time with the rest.
2. **Or make them evidence, not tests.** The Blaxel spec's `Testing` section already requires operator-run live evidence for coordinator changes and says what it must exercise. The live scenarios could be ordered the same way: a recorded run from the credentialed coordinator host, with the receipts and run directories as the evidence, and only the fixture surfaces registered. That removes the test driver and its cleanup obligations at the cost of repeatability.

The proofs should raise this as a finding against the spec rather than choose; I am raising it for them. Everything else in the live assertions stands as written.

## Refinements (none blocking)

1. **Grade the five converted walks honestly at the assertion.** `^theme-ac-selection`, `^theme-ac-active-package`, `^theme-delivery-t-active-package-refresh` and the demo-mode shared declaration now describe the built application and cite the existing tests as "covered by", while the coverage models say the adaptation is "(test to be written)". A reader of the assertion alone sees policy-grade coverage of a boundary no test crosses yet. The pool-pagination assertion shows the right form: "(policy-grade test for the existing walk: …; built-application boundary: test to be written)". The theme lines should also name the stable-front proxy, which the coverage model declares but the assertions' "no mocks or test hooks" omits; it is harness transport, not a replaced mechanism, and belongs in the declaration.

2. **`^blaxel-t-worker-guard` should say where it runs.** "In a private fixture root on a dedicated worker" reads as a live requirement. Everything the seam uses, `flock`, procfs, signals, a filesystem, exists on any Linux CI host, so it should be an ordinary repository test on Linux, like the stale-owner audit's live cases. Say so; otherwise the cheapest real crossing in the proof is priced like an acceptance.

3. **State the worker-side fixture selection.** Once the blocker settles the surfaces, `^blaxel-t-retrieval` should say the planned run selects them with `--suite selection --surfaces …`, which needs no new hook, so an implementer does not reach for forwarding the registry hook to workers.

4. **`^testing-t-launch-cleanup` points at nothing.** It cites the policy's "Timing, observable status, cleanup, and flakiness" section, which is two sentences about readiness and sleeps, and the spec sentence it used to derive from was trimmed at the spec review. Under the proof policy that makes it a promise living only in the proof: either fold the per-launch copy into `^testing-t-build-lifetime` as one more owned output under `^worker-build-lifetime`, or drop it. `^testing-t-build-lifetime`'s second pointer to the same section is harmless but adds nothing.

5. **Two small promises without an assertion.** "Uploads use paths specific to the shard attempt" (`blaxel-testshards.md:43`) and the `temporary-cleanup` setup timing (`:86`) can each be one observation inside `^blaxel-t-retrieval`: the uploaded script's path lies inside the attempt directory, and the shard summary's phases include the cleanup step with its counts. Both cost nothing extra on a run that already happens.

## Reviewer checklist

- **Proof coverage.** Every promise at an honest shape; directives honored and the coverage models say where; mocks declared with forfeits; coverage carried elsewhere named. The two gaps are refinement 5.
- **Mocking and boundaries.** No mock sits inside the chain an assertion is about. The audit-filter mock in the guard seam and the lease/audit precondition in the cleanup seam are declared and forfeited to the live runs. Real boundaries (process, filesystem, Blaxel API, browser) are each crossed for real at least once.
- **Placement.** Nothing spec-shaped hides in the proofs except the suite decision in the blocker.
- **Status and citation grades.** New obligations carry "(test to be written)"; the five converted walks need the mixed form (refinement 1).
- **References.** All resolve; the proofs index is regenerated and correct.
- **Cost.** Four live scenarios on a two-worker pool, sharing fixtures; one real nested-runner seam that rebuilds the source CLI once; the rest contracts and cheap seams. Proportionate to a change whose whole risk is reuse before owned processes stop or evidence reaches the caller.

## Evidence and limits

- Read every proof hunk with context and the three rewritten proofs in full; checked each new assertion against the spec paragraph it cites and each spec promise against the assertions; verified anchors, links, cited files, the self-test gate and the index by `git grep` and `git show`.
- Not established: whether Blaxel accepts a label change on a `DEPLOYED` sandbox, which `^blaxel-t-pool-live` will show; the exact `experiment` placement rules beyond what `test-registry.md:95` states.

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness.
