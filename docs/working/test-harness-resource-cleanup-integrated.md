# Test-harness resource cleanup: integrated validation

Status: all three slices converged; target reconciliation complete; full gate pending.
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

Before the gate, confirm private-pool deletion and absence through the canonical
manager on the coordinator. Keep that coordinator outside the worker-pool labels.
At the fixed committed and pushed integration checkpoint, run:

```sh
npm test -- pool blaxel delete --pool rose-cleanup
npm test -- pool blaxel list --pool rose-cleanup
npm run verify -- blaxel --pool poc
```

The gate uses all standard 36 shards and the default retry budgets. No fault
experiment, provisioning or deletion targets shared workers. Retain the final
summary, attempts, diagnostics and coordinator log before reporting. Ordinary
lease acquisition/cleanup is authorized by the plan, including clean expired
legacy residue; uncertain ownership must hold and report.

## Remaining work and limits

Full-gate results and renewal-loss counts are pending. Integrated independent
review follows the result. Docs preparation, PR-ready status, Josh's spec review
and required GitHub checks remain later obligations. No new lasting decision is
made in this integration step. Primitive's earlier unread warning remains in the
slice record; incomplete hook scans are not a complete governing check.
