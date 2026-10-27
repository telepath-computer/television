# Resource-cleanup proposal: review response

Independent round 1 reviewed `1652787e`. Reviewer: Claude Fable (Nina), arranged by the supervisor. The [full review](test-harness-resource-cleanup-review-r1.md) remains unchanged: FAIL on two blockers. The response committed at `99b7ed93` narrowed the work pending Josh's decisions. This response records the revised proposal following his 2026-10-27 instruction; it does not claim reviewer convergence.

## Josh's scope decisions

All of the following belong in PR #12:

- Keep a worker exclusively reserved while the previous run's processes may be alive and until results have been downloaded. Account for direct Blaxel API callers as well as shard coordinators.
- After taking that lock, every run removes the known `television-source-cli-e2e-*` and `television-web-bundle-*` directories directly under `/tmp`, plus stale per-run scratch. Preserve everything else. This handles residue from test revisions without the helper fixes.
- Keep worker-lifetime helper cleanup, per-run scratch, suitable built-app acceptances, and bounded failure diagnostics. Drop pool drain/recreation and the pending rollout choice.

Josh then calibrated the lock scope: only our runner and pool scripts touch these workers. Keep their locking correct and simple; do not defend against hypothetical callers or add elaborate mixed-version machinery. The revised proposal uses the existing lock directory and ownership identity, holds it through teardown/download, and makes pool operations respect it. It does not introduce a persistent compatibility fence, separate worker controller, or general API gateway.

The [proposal](test-harness-resource-cleanup-proposal.md) incorporates the result-download-race note. Its separate file is removed because the correction is now in scope. No spec, proof, or implementation has been changed.

## Blockers

| Finding | Current assessment and disposition |
| --- | --- |
| B1: lease redesign is unnecessary for scratch cleanup alone, with unresolved availability and mixed-version consequences | The original scope objection was warranted. Josh now explicitly requires a simple correction to our lock lifecycle. Keep atomic directory acquisition and `lockId`; remove age-only reclamation, audit descendants, and release from the coordinator after downloads. Cover dispatch uncertainty and signal/exception paths using the existing cleanup machinery. State the availability cost: uncertainty can hold a worker indefinitely. Keep the fixed results tree and protect it through download instead of adding a cross-run artifact archive. |
| B2: old branches keep leaking outside the new directory | Address this with Josh's selected recurring pre-run deletion. New locks use `expiresAt: 0`, which the inspected old acquisition code does not reclaim. Older coordinators still release their own locks before downloading, so active dispatching branches need the small lifecycle correction and old in-flight downloads must finish. No permanent old-client exclusion, separate controller architecture, or pool recreation is proposed. Helpers on older branches can still leak; subsequent updated runs reclaim their known residue. |

## Refinements

| Finding | Current disposition |
| --- | --- |
| R1: quantify relative benefit | Retain the historical roughly 3.2 GB shared-memory increase and 1.16 GB / 0.079 GB leaked-prefix measurements. Explicitly assess PR #32: it directly addresses 304-buffer accumulation for registry Vite services. Keep suitable built-app acceptances for shipped-asset coverage and fewer module requests, with no claim that they are necessary to fix that leak or will save the historical amount of memory. Any incremental resource measurement uses a baseline containing #32. |
| R2: compare pool recreation with legacy deletion | Josh chose recurring exact-prefix cleanup. Remove the alternatives table, recreation recommendation, and unresolved rollout decision. Require whole-worker exclusion and idle confirmation before deletion; the prefix alone is insufficient evidence of disuse. Preserve unrelated `/tmp` contents and persistent caches. |
| R3: commit only to minimum diagnostics | Keep parent start/end RAM, shared memory, temporary free space and OOM-counter observations, plus bounded kernel OOM lines on failure. Retain evidence for recovered retries. Keep the 128 KiB/surface and 8 MiB/attempt limits. Hold one attempt's evidence on a worker until retrieval; a blocked worker cannot accumulate new attempts. Detailed probes remain optional. |
| R4: name infrastructure and account for capacity | Retain two private `rose-cleanup` workers and the separate Blaxel coordinator as planned infrastructure, not reserved capacity. Recheck actual pool inventory and provider limits rather than assuming the old 72+3 arithmetic describes today's workspace. All test/build execution remains on Blaxel; private experiments use bounded owned processes and do not invoke isolated-GitHub-only destructive fixtures. |
| R5: disclose remaining unbundled exposure | Retain the named inventory, labeled with its original base revision, and require reconciliation against current main before implementation. Existing deferred cases remain visible; no claim that all of them require Vite or have sufficient headroom. |
| R6: justify helper fixes in addition to scratch | Keep helper cleanup for within-shard worker disposal and callers without a Blaxel wrapper. Preserve once-per-worker/per-version build reuse and clean failed builds. This contribution does not authorize cleanup on the shared development host. |
| R7: sequence PR #9 | PR #9 merged as `f81a2465`. Preserve its theme-reset conversion when integrating current main and reconcile the other theme/auth walks and stable-front proxy against the merged implementation. There is no remaining PR #9 merge-order decision. |

## Remaining evidence

Independent re-review should assess the revised scope against Josh's decisions and simplicity calibration: our acquire/release/error paths, result retrieval before release, recovery of uncertain work, and the pool-management script. There is no adversarial API-caller requirement. Live provider behavior and `TMPDIR` placement still need proof-stage experiments. No observed Chromium failure has been attributed to the lock or download races, and no post-#32 experiment establishes the remaining memory benefit of built loading.

Validation of this revision consists of document, code, policy, and PR inspection plus Git whitespace/diff checks. No tests, builds, browsers, servers, remote experiments, or worker cleanup were run for this revision. The pushed proposal is the next independent-review checkpoint; spec derivation follows convergence.
