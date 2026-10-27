# Slice 3: exclusive Blaxel worker lifecycle

Status: implementation and private qualification in progress; not ready for review.
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
They use only the named private pool, shorten recovery to 60 seconds deliberately,
and retain default native and infrastructure retries. Normal runs retain the
1200-second recovery interval. Qualification remains pending below.

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
The live receipt, retention and Chromium temporary-file observations remain open.

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
boundary without changing repository selection or checkout behavior. The new
leases remain held until their ordinary deadlines (about 19:31 UTC); no lock was
stolen or deadline edited.


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
