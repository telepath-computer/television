# Test-harness resource cleanup: integrated validation

Status: all three slices converged; target reconciliation and the full gate passed. Ready for independent integrated review.
Owner: rose. Draft PR #12. Branch: `thopter/test-harness-resource-cleanup`.
No test, build, lint, type check, browser or server runs on the shared development
host. The dedicated Blaxel coordinator performs all execution below.

## Target reconciliation

On 2026-10-27, fetched `origin` and read the complete branch histories on both sides.
`origin/main` is `a8e73fbf5eecfb27172ff5928ffb71f0c6844368`, already an ancestor
of the reviewed branch head `dc1d9f2e`. The merge base is that same main commit;
there are no incoming commits to merge. The earlier real merge is `74d22941`.
The logical-merging skill was read in full. Its policy-level reconciliation still
applies; an artificial merge adds no integration evidence.

Audited the complete changed-path inventory against main and the governing specs,
proofs and converged slices. There are no production application changes. Checked
the interaction paths beyond changed files:

- Worker build ownership spans shared Playwright/Vitest fixtures and direct
  product-server/versioned-bundle callers. Failed preparation is removed; pending
  preparation and servers settle before reusable worker outputs are disposed.
  Version-keyed reuse and serialized web builds remain intact.
- The five built-application conversions preserve same-origin authentication and
  stable-front restart continuity. PR #9's built reset and the separate Settings
  development walk remain. Main's demo fixture connection teardown remains.
- The Vite service still strips conditional validators before its middleware,
  preserving main's full-response correction. This contribution claims no measured
  incremental memory saving after that correction.
- Parent diagnostics and bounded retained links cross planned and targeted paths,
  provider normalization, retry aggregation and final reporting. Owner attribution
  and `TMPDIR` survive restricted child environments.
- Reservation, dispatch registration, teardown, retrieval, recovery and pool
  publication/deletion retain the converged exclusion rules. The default recovery
  interval is 1200 seconds for every profile. Existing execution deadlines and
  native/infrastructure retry budgets remain. Main's origin-repository checkout
  selection is unchanged; result-reset preservation remains covered by slice 3.
- The two harness experiment surfaces are excluded from ordinary `all` and CI.
  The committed private driver and every new live proof obligation have evidence;
  no new pending proof citation remains. Intentional fixture failures are retained
  as failures, separate from the passing outer qualification.

No textual conflict, policy conflict or additional behavior edit was found. The
only code-file change after slice convergence is the review-requested dry-run
comment. The full gate validates the composition at the pushed checkpoint.

## Slice 3 review observations

[Round 2](test-harness-resource-cleanup-slice-3-review-r2.md) passes the slice. A
comment now explains that clearing the inherited shard token is limited to the
two immediate dry-run CLI placement cases; ordinary surface ownership remains.
Record both the number of shard attempts and distinct shard indices reporting
`Lease renewal lost` in the full-gate result. Fail-on-first-renewal-error behavior
is unchanged; do not infer transport tolerance from the private qualification.

## Private cleanup and full gate

The passing live driver deleted `tv-testshard-x64-rose-cleanup-01` and `-02` through
the canonical pool manager. All its evidence is retained locally. Read-only API
inventory at 2026-10-27 21:26:06 UTC finds only `tv-cleanup-coordinator-rose` among
those three private resources. It reports 144 deployed sandboxes overall; this is
an inventory, not a quota or active-concurrency measurement.

At pushed checkpoint `7c66d160c2494bb673e16010563f0c8b5887f36e`, the canonical
private-pool delete and list both exited zero with no workers listed. The dedicated
coordinator remained outside the worker-pool labels and then executed:

```sh
npm test -- pool blaxel delete --pool rose-cleanup
npm test -- pool blaxel list --pool rose-cleanup
npm run verify -- blaxel --pool poc
```

The gate used all standard 36 shards and the default native/infrastructure retry
budgets of two. No fault experiment, provisioning or deletion targeted shared
workers. Normal lease acquisition and cleanup ran under the converged rules.

## Full-gate result

`npm run verify -- blaxel --pool poc` exited **0** at `7c66d160`:

- All 36 shard indices passed on infrastructure attempt 1. All 22 selected
  surfaces ran and passed, covering 370 assigned files. Aggregated native counts:
  **3,705 passed, 8 skipped, 0 failed, 0 recovered retries** (3,713 total).
- **0 process leaks and 0 infrastructure failures.** `Lease renewal lost`:
  **0 shard attempts, 0 distinct shard indices**, checked against the complete
  provider report, attempt records and logs. This one run does not establish a
  transport-error tolerance guarantee or a long-term renewal failure rate.
- Lint, type checking, package manifests and the final vibe-mode check passed.
  `verify:total` was 141,073 ms; the test run was 119,945 ms. Test execution ran
  from 21:30:30.831 to 21:32:30.776 UTC on 2026-10-27.
- Retained 231 resource sidecars, all linked from the final surface results and
  present on disk, each with observed start/end samples. Every OOM-kill delta was
  zero. There were no native failed attempts, so kernel failure excerpts were
  correctly not requested. Largest sidecar: 1,741 bytes; largest combined resource
  sidecars for one shard: 13,727 bytes. These are interval observations, not peaks.
- The 36 pre-run cleanup reports show 1,013 source-CLI directories and 497 web
  bundle directories removed, with no cleanup skips/errors. Their recorded
  allocated bytes sum to **5,003,157,504 bytes** (about 5.0 GB / 4.66 GiB), equal
  to the summed before/after available-space delta. This is actual legacy residue
  reclaimed during ordinary acquisition, not a seeded shared-worker experiment.

Four acquisition candidates were skipped because
`/home/playwright/.nvm/nvm.sh` was absent: `tv-testshard-x64-poc-101`, `-08`, `-109`
and `-12`. The runner acquired replacements and every planned shard completed.
Those skipped workers were not repaired or reconfigured. Their missing runtime
cause remains unknown and is independent of the passing selected-shard results.

Automatic attestation publication was attempted after verification and failed
non-fatally: GitHub returned HTTP 403, permission denied to `jwhiting`, during the
ref update/fallback fetch. **The gate passed; no attestation publication is
claimed.** No credential changes, attestation retry or bypass was attempted.

A fresh `git fetch origin` after the gate still resolves main to `a8e73fbf`.
The tested tree contains that full target. Subsequent record edits change only
working documents; `7c66d160` is the exact tested revision, not an assertion that
any later documentation commit ran another gate.

## Retained evidence

The complete run is
[`.test-runs/2026-10-27T21-30-30-229Z-p40561-rde511175732d79a8/summary.json`](../../.test-runs/2026-10-27T21-30-30-229Z-p40561-rde511175732d79a8/summary.json).
Its `results.json`, `provider/blaxel/report.json`, provider summary, all 36 shard
logs/reports, native output and cleanup/resource sidecars are retained beneath
that directory. SDK binary downloads copied **1,100 files / 23,423,163 bytes**;
each downloaded length matched the coordinator filesystem inventory.

Additional local evidence is under `.test-runs/integrated-validation/`:
`rose-integrated-verify.log` (including private-pool absence and the attestation
error), `download-inventory.json`, `metrics.json`, and `private-cleanup.json`.
No test or static check executed on the shared development host.

After retaining evidence, the coordinator's API listed every dispatched process
as completed or failed, with the full gate completed/exit 0. Requested deletion
of the dedicated coordinator only. Read-only API inventory at
**2026-10-27 21:36:31 UTC** confirms all three private resource names absent
(143 remaining sandboxes, all deployed). The two private workers had already
been deleted. No shared worker was deleted.

## Remaining work and limits

Independent integrated review is next. Docs preparation, PR-ready status, Josh's
spec review and required GitHub checks remain later obligations. The attestation
write did not succeed. The four skipped workers' runtime problem is unresolved.
Incremental memory savings after the Vite correction and long-term renewal-loss
frequency remain outside this evidence.

No new lasting decision was made in this integration step. Primitive's commit
hook listed eight existing decisions, including superseded conversation wording,
and reported a truncated scan. This is not a complete governing check; the user
corrections and converged specs remain authoritative. The earlier unread warning
remains in the slice record; its CLI received no further debugging.
