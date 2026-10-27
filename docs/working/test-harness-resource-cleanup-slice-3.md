# Slice 3: exclusive Blaxel worker lifecycle

Status: [review round 2](test-harness-resource-cleanup-slice-3-review-r2.md) passed at `dc1d9f2e`; slice 3 has converged. Integrated validation is recorded [separately](test-harness-resource-cleanup-integrated.md).
Final executable checkpoint: `7b0213bb`. The repeated live qualification passed on
its first native attempt in 4m 56s. The correction and evidence follow the original
qualification history below.
The converged plan and proofs govern the scope. Slice 2 passed at `296391c0`.
No tests, builds, lint, type checks, browsers or servers run on the shared host.
All executions below use pushed revisions on the private Blaxel coordinator and
`rose-cleanup` workers. No shared-pool worker experiments have been performed.

## Implementation

The worker-local lock command carries its implementation before checkout and uses
one short `flock` guard. Its record owns an attempt-specific scratch directory and
an outer process token. Only the coordinator renews; normal release follows owned
process teardown and retained evidence. Expired renewal uses the same cleanup
procedure for active and quiet abandoned work. Old timestamps, incomplete records,
unknown dispatch and unsafe cleanup remain fail-closed at the reviewed boundaries.
Pool publication follows runtime verification; deletion reserves eligible workers
before unpublishing them. A never-published worker keeps that state if deletion
fails, so a partial provisioning failure does not require an installed runtime to
retry deletion.

The live driver and its two native fixture files are explicit experiment surfaces.
They use only the named private pool and retain default native and infrastructure
retries. Only the two coordinator-crash invocations shorten recovery to 60 seconds;
ordinary qualification and production runs use the 1200-second default.
The final qualification below establishes the planned and targeted paths, both
crash scenarios, temporary placement, diagnostics, and pool deletion.

## Validation record

| Revision | Command on Blaxel | Retained run / result |
| --- | --- | --- |
| `1320c957` | `npm test -- blaxel --pool rose-cleanup --file test/repo/blaxel-worker-lease.test.ts` | `.test-runs/2026-10-27T18-41-03-525Z-p19298-r7dc71e154247c385`: two intended assertion failures, infrastructure completed. |
| `2c0f5d6b` | Same selected file | `.test-runs/2026-10-27T18-50-52-346Z-p19842-r74788ac655aa50a6`: implementation failure, not green. Vitest rewrote serialized dynamic imports; cleanup also rejected regular overlay files as mount boundaries. |
| `e102e200` | `npm run lint`; `npm run type-check` | Lint passed; type check found contract-test typing errors. `.test-runs/slice-3-static/e102e200.log`. |
| `e59caa56` | Same static commands | Both passed. `.test-runs/slice-3-static/e59caa56.log`. |
| `12939310` | Lease seam, then lease contracts, each selected by file through the canonical Blaxel runner | `.test-runs/2026-10-27T19-11-24-927Z-p21647-r03d2ada7561f5f9a`: all six lease seam cases passed on both workers; canonical retrieval failed because checkout removed `attempt.json`. The run is infrastructure-incomplete, not a green checkpoint. Contracts were not reached. |

The failed cleanup retained both private leases rather than admitting new work.
Read-only inspection established that the worker overlay exposes device 19 for
directories and 20 for regular files under the same mount. The corrected cleaner
uses actual mount records plus directory device boundaries. It still refuses
mounted paths and symlink roots. Earlier reports and available native files were
copied before the next acquisition can discard abandoned worker evidence.

The coordinator shutdown path now waits for in-flight acquisitions, shares one
teardown operation with normal completion, and reports failed releases. Optional
resource sidecars use only the bounded warning-only transport; the generic evidence
inventory cannot turn a diagnostic read failure into a native failure or bypass
its byte budget.

## Review refinements and limits

Slice 2 refinements 1 and 2 are implemented: reuse the timing-provider constant and
resolve a targeted Vitest config relative to its surface cwd. Recovery receipts
carry the actual prior run/lock, worker, renewal/deadline and attributed process
cleanup, rather than assuming a coordinator's OS death can be proven remotely.
The final live qualification establishes receipt retention and Chromium temporary-file placement.

Primitive's warning `dec_8e3d38a8` (check
`td7crdek1b1n4dhajyww5p174s8h23bq`) remains unread because its CLI failed to install
or start. The supervisor directed no further debugging and confirmed it is not an
authority over the converged specs and Josh's decisions. Commit-hook scans also
reported partial/truncated results; those are not a complete conflict check.
No new lasting team decision is being established by this implementation.

The next failed run confirmed expiry recovery, process disuse and scratch deletion
on both private workers. Its retained worker records and native reports are in
`manual-worker-01/` and `manual-worker-02/` under that run directory. The checkout
helper resets `.testshards/results`, so initial identity/cleanup/receipt evidence
must survive in attempt scratch and be restored after checkout, on shell failure,
and by confirmed teardown after a killed shell. The correction adds that fixture
boundary without changing repository selection or checkout behavior. Those
leases remained held until their ordinary deadlines (about 19:31 UTC); no lock was
stolen or deadline edited. The subsequent green runs recovered them normally.


Read-only inventory at 19:29:39 UTC counted 146 sandboxes, all reported DEPLOYED,
including the two `rose-cleanup` workers and `tv-cleanup-coordinator-rose` outside
the pool. This does not establish active-work concurrency or an account-specific
quota; it does establish that the historical 75 figure is not a sandbox-count
limit here. Fresh live qualification replaces two owned workers after deletion,
without increasing the private worker count or touching shared workers.

`c7482876` passed lint and type checking on the dedicated coordinator. Its next
lease run deliberately supplies `--lock-ttl-seconds 60` to qualify recovery from
the retained failed attempt; native and infrastructure retry budgets stay at their
defaults. The following contract run uses the ordinary recovery default.

## Focused green checkpoint

The checkout-reset correction passed the canonical runner at `c7482876`:
lease seam `.test-runs/2026-10-27T19-32-10-022Z-p22962-rfb177538dcaa4d24`
(seven cases, deliberate 60-second recovery interval), then contracts
`.test-runs/2026-10-27T19-32-20-996Z-p23059-r89282347b68d6c0c`
(nine cases, ordinary interval). Both completed on the first infrastructure
attempt with no test failures, recovered retries or leaks. Downloaded recovery
receipts survived the results reset, and the leases released after retrieval.
Lint and type checking passed at this revision and again at `49cfe0c3`.
The combined logs are in `.test-runs/slice-3-static/rose-slice3-green3.log`
and `rose-slice3-affected.log`. The earlier `53d800fa` type failure was a test
callback declaration requiring an unused SDK method; its log is
`rose-slice3-static3.log` in the same directory.

At `49cfe0c3`, the seam and contracts passed again in
`2026-10-27T19-33-58-506Z-p23646-raaae2ad64b76b375` and
`2026-10-27T19-35-29-126Z-p23746-r01712028c5135ed1`. The provider file in
`2026-10-27T19-35-43-906Z-p23846-r3318f29853e73be5` exposed two source assertions
that still expected the old dispatch and interrupted-report wiring. The callback
behavior assertions passed. `720cef01` updated those two source assertions,
then ran the narrow pair before their whole file and the affected files below.
All listed runs used `npm test -- blaxel --pool rose-cleanup --file <file>`
with ordinary retry and recovery defaults; the first also selected the two names
with `--grep`. Full downloaded trees are under `.test-runs/<run>/`.

| Revision | Selection | Canonical run | Result |
| --- | --- | --- | --- |
| `720cef01` | `test/repo/test-runner-provider.test.ts (two named cases)` | `2026-10-27T19-37-58-570Z-p24402-r4cdc7d5562c47eee` | passed; infrastructure completed |
| `720cef01` | `test/repo/test-runner-provider.test.ts` | `2026-10-27T19-38-09-966Z-p24499-r70f1f3eed2e449a5` | passed; infrastructure completed |
| `720cef01` | `test/repo/blaxel-pool-discovery.test.ts` | `2026-10-27T19-38-20-913Z-p24595-r84122d6e0b62dd4c` | passed; infrastructure completed |
| `720cef01` | `test/repo/blaxel-stale-owner-audit.test.ts` | `2026-10-27T19-39-40-343Z-p24692-rcb3f084f0f0c7c95` | passed; infrastructure completed |
| `720cef01` | `test/repo/test-runner-config.test.ts` | `2026-10-27T19-39-51-507Z-p24788-r2f67497f4e209dab` | passed; infrastructure completed |
| `720cef01` | `test/repo/resource-diagnostics.test.ts` | `2026-10-27T19-40-02-197Z-p24884-r776a0c6fb3273936` | passed; infrastructure completed |
| `720cef01` | `test/repo/resource-diagnostics-links.test.ts` | `2026-10-27T19-42-16-320Z-p24982-rf5458848d49b258a` | passed; infrastructure completed |
| `720cef01` | `test/repo/test-runner-resource-parent.test.ts` | `2026-10-27T19-42-28-510Z-p25079-r8d56b8721e4a08db` | passed; infrastructure completed |
| `720cef01` | `test/repo/test-runner-shard-worker.test.ts` | `2026-10-27T19-42-41-867Z-p25175-rf392193489fc6ad8` | passed; infrastructure completed |
| `720cef01` | `test/node/owned-process.e2e.test.ts` | `2026-10-27T19-43-03-198Z-p25283-r3d5b7ad0c998a6d0` | passed; infrastructure completed |

Every run in this table has zero failed tests, recovered retries, process leaks and infrastructure failures.

At `5b23a426`, the delayed-entry case additionally checks that an unregistered
request cannot release after teardown; the audit case verifies that available-worker
audit preparation/teardown preserves legacy residue and non-current scratch.
Each new assertion passed narrowly, followed by both complete files:

| Selection | Canonical run | Result |
| --- | --- | --- |
| `test/repo/blaxel-worker-lease.test.ts (named case)` | `2026-10-27T19-43-45-072Z-p25796-r8622f05d670cea64` | passed; infrastructure completed |
| `test/repo/blaxel-lease-contracts.test.ts (named case)` | `2026-10-27T19-43-56-561Z-p25892-rd9b8c692ec75d21a` | passed; infrastructure completed |
| `test/repo/blaxel-worker-lease.test.ts` | `2026-10-27T19-44-07-741Z-p25987-rbb26c267c14b8a41` | passed; infrastructure completed |
| `test/repo/blaxel-lease-contracts.test.ts` | `2026-10-27T19-44-18-970Z-p26082-r36dc8f04d41f53f9` | passed; infrastructure completed |

All four completed on the first infrastructure attempt, with no failures, recovered retries or leaks.

## Live qualification and intermediate failures

The first driver invocation at `5b23a426` stopped at coordinator preflight:
`2026-10-27T19-45-11-581Z-p26606-r3f51d29611472c9b` records missing `ss`.
Installed `iproute2` on `tv-cleanup-coordinator-rose` only; no worker changed.
The next canonical invocation uses the same pushed revision and normal retry
budget. Its first native attempt (`blaxel-live-EQZRnS`) found that Blaxel accepts
sandbox deletion before listing stops returning the deleted workers. The manager
had removed dispatch eligibility before its accepted deletes; fresh-only ensure
correctly refused the still-visible pool. Its final cleanup completed. SDK 0.3.24's
`SandboxInstance.delete` awaits the delete API response, not absence from listing.
The driver correction at `9d197e8f` polls for confirmed absence after a successful
canonical delete before recreating or claiming the pool gone. No lease protocol,
retry default, or provider configuration changes for this correction.

The second native attempt (`blaxel-live-UjVPFN`) crossed planned/targeted retrieval,
competition and held deletion, actual TMPDIR placement, and both coordinator-kill
scenarios before reaching the immediate final-deletion listing check. Its retained
planned, targeted, active-recovered and quiet-recovered runs respectively are:

- `2026-10-27T19-47-58-353Z-p27645-r7a1cb06d08f363aa`
- `2026-10-27T19-48-57-858Z-p27882-r0bc76a565de0ad6d`
- `2026-10-27T19-50-34-628Z-p28106-r6bde140566d56c43`
- `2026-10-27T19-51-51-273Z-p28338-r1db5ab714ba682ea`

Each reports the intentional one failed fixture and one recovered native fixture,
completed infrastructure and no process leaks. The active receipt lists seven
and eight attributed processes on the two workers, including SIGKILL for surviving
Node processes. Quiet receipts have empty process lists. Failed-surface sidecars
are about 1.8 KiB; kernel access was available with no matching lines during the
observed intervals. That does not establish the absence of an OOM outside those
intervals. Chromium `148.0.7778.96` from
`/home/playwright/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`
held sixteen observed descriptors under the attempt TMPDIR, including deleted
`.org.chromium.Chromium.*` files. These are placement observations, not a memory
pressure reproduction or measured savings claim. This intermediate driver revision
is not the final green qualification.

The canonical driver run at `5b23a426`,
`2026-10-27T19-46-15-645Z-p27336-r76172043306620d7`, completed infrastructure but
failed all three native attempts. Its attempt recorder shows 70.9 s, 357.7 s and
348.8 s. The first failed the fresh-only ensure assertion; the other two reached
the final delete then observed two workers still listed. No other assertion failed.
All three attempt directories (`blaxel-live-EQZRnS`, `blaxel-live-UjVPFN`,
`blaxel-live-wQ4JDh`) retain their logs and successful final cleanup records.
Both full attempts' child run trees and the outer native attempt report are
copied under `.test-runs/`. Default retries were allowed to finish; no revision
changed under this invocation. The corrected one-case driver runs at `9d197e8f`.

At `9d197e8f`, the first driver attempt (`blaxel-live-pyyGvj`) reached a targeted
run that recovered an infrastructure failure:
`2026-10-27T20-01-14-534Z-p30344-r4b185c22b003ef58`. Attempt 1's remote entry and
teardown rejected a lost/expired 60-second lease before native evidence existed;
its exact renewal/transport timing was not retained and the cause of that lapse
is not established. Default infrastructure retry ran on the other worker and
retained the expected native failed/recovered outcomes under `attempt-2/`.
The driver still looked for `temporary-placement.json` outside that attempt
subdirectory. `d32457f7` derives artifact roots from the retained shard output
instead. It also corrects the live driver's overly broad 60-second override:
only deliberate abandoned-run invocations use it, as the plan requires; ordinary
retrieval and reuse use the production 1200-second default. No production lease
interval or retry budget changed.

The `9d197e8f` outer run
`2026-10-27T20-00-04-460Z-p29961-r0fbeb800a4123ebe` passed on its second native
attempt (8m 39s total), followed by clean lint and type checking. Its first native
failure is exactly the placement-artifact existence assertion at line 163; its
second attempt (`blaxel-live-7Frvi5`) passed every live assertion, observed both
private workers disappear, and retained `cleanup.json` with exit 0. The outer
result correctly reports one recovered driver attempt. The complete outer report,
both live attempt directories and all child runs are retained. The static output
is `.test-runs/slice-3-static/rose-slice3-live3.log`.

The `d32457f7` driver run,
`2026-10-27T20-09-47-242Z-p31959-reebae862cce797b7`, passed on its second native
attempt, then passed lint and type checking. The first failure was the driver's
120-second download-rendezvous wait in the quiet scenario, not a native fixture
assertion; both gate files eventually existed. The completed retry is
`blaxel-live-9zKaAr`, with passed completion and exit-0 cleanup, and all child
reports retained. The final driver allows 600 seconds to reach that rendezvous,
covering the runner's 480-second cold execution allowance plus teardown. This
changes neither a native retry budget nor a production worker timeout. Its static
log is `.test-runs/slice-3-static/rose-slice3-live4.log`.

## Preparation without dispatch

A final source pass found that `executionRequested: false` was being used as a
proxy for “no evidence produced.” Preparation can already have produced identity,
cleanup and recovery files before dispatch fails. At `06b07c0f`, the unchanged
retention implementation was extracted into the existing lease-lifecycle module
and a focused contract crossed real worker preparation/teardown and local writes,
substituting only the SDK read transport. Canonical run
`2026-10-27T20-25-30-716Z-p34389-r43c8aec32b92d34f` failed at release because the
prepared file had not been downloaded; infrastructure completed and the missing
file assertion was the intended red.

`45202ee9` tracks whether preparation was requested and stops treating that state
as evidence-free merely because execution was not requested. Available artifacts
are also downloaded before propagating a required log-read failure, so missing
logs cannot suppress other retained evidence. Unknown preparation or retrieval
still holds the lease. No new worker state or recovery branch was added.

The retention correction passed narrowly, then the full contracts, provider and
stale-owner files passed at `45202ee9`, with no native failures, recovered retries,
leaks or infrastructure failures. Lint and type checking also passed; the combined
log is `.test-runs/slice-3-static/rose-slice3-retention-green.log`.

| Selection | Canonical run |
| --- | --- |
| `test/repo/blaxel-lease-contracts.test.ts (named case)` | `2026-10-27T20-28-25-923Z-p34956-r7a8e2fe5488f771c` |
| `test/repo/blaxel-lease-contracts.test.ts` | `2026-10-27T20-29-15-006Z-p35077-rc75cd93e2b864b85` |
| `test/repo/test-runner-provider.test.ts` | `2026-10-27T20-29-27-245Z-p35174-r098f4b0d3cd1cad7` |
| `test/repo/blaxel-stale-owner-audit.test.ts` | `2026-10-27T20-29-39-395Z-p35271-r3dc4727db3aa7390` |

## Initial qualification and handoff

At `45202ee9`, `npm test -- local --surface experiment:blaxel-harness` on
`tv-cleanup-coordinator-rose` passed on its first native attempt in 271.207 seconds:
`2026-10-27T20-31-21-143Z-p35862-rde268122d6db9e34`. The outer driver reports zero
failed or recovered tests, process leaks and infrastructure failures. It kept the
ordinary native retry budget of two and infrastructure budget of two. Ordinary
child runs used the default 1200-second recovery interval; only the two deliberately
abandoned runs supplied `--lock-ttl-seconds 60`.

The complete live attempt is `.test-runs/blaxel-live-YSZi2G/`. Its completion and
cleanup records show success and exit 0. Every pointer below resolves to a fully
copied local run tree under `.test-runs/`; the two deliberately killed coordinators
truthfully remain incomplete. The fixtures intentionally yield one failed native
case and one recovered case in each completed child run. These expected native
failures are assertions of the passing driver, not unaddressed suite failures.

| Scenario | Canonical child run | Expected result |
| --- | --- | --- |
| planned transfer and retrieval | `2026-10-27T20-31-43-447Z-p36010-r102a02d53fa2b20e` | one deliberate native failure and one recovered case; infrastructure completed |
| targeted retrieval and reuse | `2026-10-27T20-32-52-337Z-p36243-r7d1d01b2f31bd9ae` | one deliberate native failure and one recovered case; infrastructure completed |
| held-capacity refusal | `2026-10-27T20-32-42-262Z-p36128-r7e9debd7b5412984` | incomplete; no passing selected surface |
| active coordinator killed | `2026-10-27T20-33-03-214Z-p36326-r50763ec34c56268e` | incomplete; no passing selected surface |
| active orphan recovered | `2026-10-27T20-34-11-856Z-p36450-rfdddc02ece515dce` | one deliberate native failure and one recovered case; infrastructure completed |
| quiet coordinator killed | `2026-10-27T20-34-25-068Z-p36548-r02e5eeb7df18d744` | incomplete; no passing selected surface |
| quiet orphan recovered | `2026-10-27T20-35-28-816Z-p36690-r7eb081f69c2f7b8b` | one deliberate native failure and one recovered case; infrastructure completed |
| dispatch refused after deletion | `2026-10-27T20-35-48-311Z-p36815-r3d7413d5032dbe88` | incomplete; no passing selected surface |

The driver observed renewal while downloads were held, refusal of competing
acquisition and deletion, unchanged held reports, correct report/native-attempt
links after scratch removal, both known-prefix removals and stale-scratch removal,
and preservation of unrelated `/tmp` and persistent-cache sentinels. Real Node
paths and Chromium descriptors (including unlinked files) were under the shard's
TMPDIR. Active recovery signalled attributed processes; quiet recovery used the
same procedure with no survivors. Both incoming runs retained the old identity,
renewal/deadline, cleanup outcome and discarded-report receipts.

The final pool manager deleted `tv-testshard-x64-rose-cleanup-01` and `-02`, waited
for confirmed absence, and a fresh canonical dispatch failed because the pool was
empty. The private coordinator remains allocated with its evidence for the later
integrated gate. No shared worker was used or changed during qualification.

The implementation and proof citations are ready for independent review, not for
merge. Slice review, integrated-result review, target reconciliation, the ordinary
full Blaxel verification gate, pre-merge docs preparation and Josh's human spec/PR
review remain. This evidence establishes lifecycle behavior, not peak memory use,
measured suite-wide savings, a new exhaustion reproduction or provider latency
bounds. The earlier shortened-lease expiry's precise timing remains unknown and
is recorded above. No production behavior, default retry budget, browser version
or shard count was changed. Primitive's unread warning remains recorded above;
its CLI was not debugged further.

## Slice review round 1 correction

The [review](test-harness-resource-cleanup-slice-3-review-r1.md) found one blocker:
the live driver and CLI required personal resource names despite the general
dedicated-coordinator contract. The [response](test-harness-resource-cleanup-review-response.md#Slice 3 round 1: reusable qualification)
records the correction and all three refinement dispositions. The caller now
supplies coordinator and private-pool names through environment variables; both
are required, with the existing label, provider and shard-owner checks preserved.
Pool-derived sentinels and a neutral worker-local mode file remove the personal
fixture dependency. The harness README documents invocation and destructive pool
ownership. The lease/recovery protocol is unchanged.

Read-only inventory at 21:03:58 UTC counted 144 DEPLOYED sandboxes, including the
dedicated coordinator and neither private worker. At pushed `6d505597`, the canonical
pool manager provisioned the two `rose-cleanup` workers. No shared pool was changed.

All focused commands below ran on the private coordinator with
`npm test -- blaxel --pool rose-cleanup --file <file>`, adding `--grep` only as
shown. Unit and infrastructure retry budgets retained their defaults. Every run
tree is copied under `.test-runs/` in this worktree.

| Revision | Selection | Canonical run | Result |
| --- | --- | --- | --- |
| `6d505597` | `test/repo/test-runner-guardrails.test.ts --grep "configured Blaxel harness coordinator"` | `2026-10-27T21-04-23-673Z-p37437-r2770a6d409ac3de3` | intended red: real CLI returned 2 instead of 0 with non-personal fixture names; native assertion failed and infrastructure completed |
| `7b0213bb` | `test/repo/test-runner-guardrails.test.ts --grep "Blaxel harness"` | `2026-10-27T21-06-11-968Z-p37987-r702e58cd23f76853` | both configuration and refusal cases passed |
| `7b0213bb` | `test/repo/test-runner-provider.test.ts --grep "explicitly supplied recovery interval"` | `2026-10-27T21-06-43-017Z-p38102-rb266ce5fc5f4db0e` | explicit/default forwarding and all three 1200-second profile assertions passed |
| `7b0213bb` | whole `test/repo/test-runner-guardrails.test.ts` | `2026-10-27T21-06-55-197Z-p38199-rf555298cb899a967` | 65 passed; one existing skipped GitHub-only case |
| `7b0213bb` | whole `test/repo/test-runner-provider.test.ts` | `2026-10-27T21-07-24-246Z-p38301-rebd40cb7ccb5bc87` | 43 passed |

All four green runs completed without failed tests, recovered retries, process
leaks or infrastructure failures. `npm run lint` and `npm run type-check` then
passed on the dedicated coordinator at the same revision. Combined remote logs
are `.test-runs/slice-3-static/rose-slice3-r1-red.log` and
`rose-slice3-r1-green.log`.

The earlier Primitive warning remains unread as directed. This correction follows
the existing placement contract and changes no lasting decision. Commit-hook
scans again returned existing decisions with truncated coverage; they supplied no
new actionable constraint and are not a complete conflict check. No reconciliation
or further CLI debugging was attempted.

### Repeated live qualification

At pushed `7b0213bb`, the dedicated coordinator ran:

```sh
TV_BLAXEL_HARNESS_COORDINATOR=tv-cleanup-coordinator-rose \
TV_BLAXEL_HARNESS_POOL=rose-cleanup \
npm test -- local --surface experiment:blaxel-harness
```

Canonical run `2026-10-27T21-08-38-267Z-p38866-r679cddb899712621` passed on its
first native attempt in 296.197 seconds, with zero failed or recovered driver
tests, process leaks and infrastructure failures. The retained live attempt is
`.test-runs/blaxel-live-Py7UqI/`; its identity records the configured coordinator,
pool and exact revision, `completed.json` says passed, and `cleanup.json` records
exit 0. The driver retained the default two native retries and two infrastructure
retries. Only its two deliberate abandoned runs used the 60-second interval.

| Scenario | Canonical child run | Result |
| --- | --- | --- |
| planned retrieval | `2026-10-27T21-09-11-096Z-p39023-r7c42878bb3edd7a5` | expected failed/recovered native fixtures; infrastructure completed |
| held-capacity refusal | `2026-10-27T21-09-44-524Z-p39141-r01321059d8eb93e8` | expected incomplete refusal |
| targeted reuse | `2026-10-27T21-10-33-789Z-p39277-r92cce732e13126b3` | expected failed/recovered native fixtures; infrastructure completed |
| active coordinator killed | `2026-10-27T21-10-49-716Z-p39365-rda3ab840cf51883d` | expected incomplete run |
| active recovery | `2026-10-27T21-11-53-508Z-p39482-r6e6a876c57f088ee` | expected failed/recovered native fixtures; infrastructure completed |
| quiet coordinator killed | `2026-10-27T21-12-07-353Z-p39581-re263e8075af61eb2` | expected incomplete run |
| quiet recovery | `2026-10-27T21-13-11-418Z-p39676-rfa6c95cd577a4d4e` | expected failed/recovered native fixtures; infrastructure completed |
| absent-pool refusal | `2026-10-27T21-13-30-318Z-p39800-ra32edd1d26498fce` | expected incomplete refusal |

The driver deleted the earlier private pool after its focused reports were retained,
provisioned fresh workers, and repeated every live acceptance. Pool-derived residue
was removed, unrelated sentinels and caches survived, and the neutral mode input
exercised both recovery scenarios. Both private workers were deleted and confirmed
absent at completion. The entire outer run, attempt directory and eight child run
trees are retained locally; the combined log is
`.test-runs/slice-3-static/rose-slice3-r1-live.log`.

The source correction and proof/document updates are ready for independent
re-review. The dedicated coordinator remains for the later integrated gate.
No tests, builds or static checks ran on the shared host; no shared worker was
changed. Integrated review, target reconciliation, full verification and PR
readiness remain pending. The availability tradeoff on renewal errors and optional
checkout simplification remain as assessed in the review response, without claims
that those refinements were implemented.
