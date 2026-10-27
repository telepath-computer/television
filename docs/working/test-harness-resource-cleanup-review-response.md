# Resource-cleanup proposal: review response

Independent round 3 reviewed `57a701d0`: **PASS**, relayed by the supervisor. The proposal has converged. The round 1 and 2 sections below retain the response history; [round 3](#Round 3: convergence and spec derivation) records the bounded refinements and current spec checkpoint. Reviewer: Claude Fable (Nina), arranged by the supervisor.

Independent round 1 reviewed `1652787e`. The [full review](test-harness-resource-cleanup-review-r1.md) remains unchanged: FAIL on two blockers. The response committed at `99b7ed93` narrowed the work pending Josh's decisions. The following sections through round 2 record that history, not the current review verdict.

## Josh's scope decisions

All of the following belong in PR #12:

- Keep a worker exclusively reserved through process cleanup and result download. Account for our pool script's direct Blaxel API calls as well as shard coordinators. Automatic recovery of an abandoned run is the explicit exception to download-before-release described below; recovery must stop its owned processes before reuse.
- After taking that lock, every run removes the known `television-source-cli-e2e-*` and `television-web-bundle-*` directories directly under `/tmp`, plus stale per-run scratch. Preserve everything else. This handles residue from test revisions without the helper fixes.
- Keep worker-lifetime helper cleanup, per-run scratch, suitable built-app acceptances, and bounded failure diagnostics. Drop pool drain/recreation and the pending rollout choice.

Josh then calibrated the lock scope: only our runner and pool scripts touch these workers. Keep their locking correct and simple; do not defend against hypothetical callers or add elaborate mixed-version machinery. The revised proposal uses the existing lock directory and ownership identity, holds it through teardown/download, and makes pool operations respect it. It does not introduce a persistent compatibility fence, separate worker controller, or general API gateway.

Following round 2, Josh selected automatic recovery and required that a crashed coordinator's still-active run cannot hold a worker forever. The supervisor clarified that his suggested predicate and grace-period mechanism were illustrations: keep a special case if correctness needs it and explain why. Josh also delegated the built-app scope judgment, noting that recurring cleanup reduces the case for a broad conversion. The resulting design and scope below are this contribution's proposal, not a claim that Josh prescribed their mechanics.

The [proposal](test-harness-resource-cleanup-proposal.md) incorporates the result-download-race note. Its separate file is removed because the correction is now in scope. No spec, proof, or implementation has been changed.

## Blockers

| Finding | Current assessment and disposition |
| --- | --- |
| B1: lease redesign is unnecessary for scratch cleanup alone, with unresolved availability and mixed-version consequences | The original scope objection was warranted. Josh now explicitly requires the lock correction. Keep atomic directory acquisition and `lockId`, replace blind reclamation with renewal and cleanup before reuse, audit descendants, and normally release after download. Round 2 below supplies automatic recovery and sizes the availability cost. Keep the fixed results tree rather than a cross-run artifact archive. |
| B2: old branches keep leaking outside the new directory | Address this with Josh's selected recurring pre-run deletion. New locks use `expiresAt: 0`, which the inspected old acquisition code does not reclaim. Older coordinators still release their own locks before downloading; branches take that correction when they integrate main. Round 2 refinement 3 removes the requirement to update all active branches or wait for all old in-flight runs before this contribution's final verification. No permanent old-client exclusion, separate controller architecture, or pool recreation is proposed. Helpers on older branches can still leak; subsequent updated runs reclaim their known residue. |

## Refinements

| Finding | Current disposition |
| --- | --- |
| R1: quantify relative benefit | Retain the historical roughly 3.2 GB shared-memory increase and 1.16 GB / 0.079 GB leaked-prefix measurements. PR #32 directly addresses 304-buffer accumulation for registry Vite services. Narrow conversion to two files for their proof boundary and repeated loads; do not claim they are necessary to fix that leak or will save the historical amount of memory. Any incremental resource measurement uses a baseline containing #32. |
| R2: compare pool recreation with legacy deletion | Josh chose recurring exact-prefix cleanup. Remove the alternatives table, recreation recommendation, and unresolved rollout decision. Require whole-worker exclusion and idle confirmation before deletion; the prefix alone is insufficient evidence of disuse. Preserve unrelated `/tmp` contents and persistent caches. |
| R3: commit only to minimum diagnostics | Keep parent start/end RAM, shared memory, temporary free space and OOM-counter observations, plus bounded kernel OOM lines on failure. Retain evidence for recovered retries. Keep the 128 KiB/surface and 8 MiB/attempt limits. Hold one attempt's evidence until retrieval or abandoned-run recovery; disclose discarded orphan reports in a bounded receipt. Detailed probes remain optional. |
| R4: name infrastructure and account for capacity | Retain two private `rose-cleanup` workers and the separate Blaxel coordinator as planned infrastructure, not reserved capacity. Recheck actual pool inventory and provider limits rather than assuming the old 72+3 arithmetic describes today's workspace. All test/build execution remains on Blaxel; private experiments use bounded owned processes and do not invoke isolated-GitHub-only destructive fixtures. |
| R5: disclose remaining unbundled exposure | Retain the named inventory, labeled with its original base revision, and require reconciliation against current main before implementation. Existing deferred cases remain visible; no claim that all of them require Vite or have sufficient headroom. |
| R6: justify helper fixes in addition to scratch | Keep helper cleanup for within-shard worker disposal and callers without a Blaxel wrapper. Preserve once-per-worker/per-version build reuse and clean failed builds. This contribution does not authorize cleanup on the shared development host. |
| R7: sequence PR #9 | PR #9 merged as `f81a2465`. Preserve its theme-reset conversion when integrating current main and reconcile the other theme/auth walks and stable-front proxy against the merged implementation. There is no remaining PR #9 merge-order decision. |

## Remaining evidence

Independent re-review should assess the revised scope against Josh's decisions and simplicity calibration: our acquire/release/error paths, result retrieval before release, recovery of uncertain work, and the pool-management script. There is no adversarial API-caller requirement. Live provider behavior and `TMPDIR` placement still need proof-stage experiments. No observed Chromium failure has been attributed to the lock or download races, and no post-#32 experiment establishes the remaining memory benefit of built loading.

Validation of this revision consists of document, code, policy, and PR inspection plus Git whitespace/diff checks. No tests, builds, browsers, servers, remote experiments, or worker cleanup were run for this revision. The pushed proposal is the next independent-review checkpoint; spec derivation follows convergence.

## Round 2: automatic recovery and narrower conversion

Independent round 2 reviewed `d3570bf4`. The [full review](test-harness-resource-cleanup-review-r2.md) is preserved verbatim: **FAIL on undefined recovery of a dead coordinator's lock**. The blocker was warranted. A lock that survives coordinator death without an automatic recovery entry point would steadily remove pool capacity. The proposal now supplies all four missing decisions:

| Blocker detail | Proposed resolution |
| --- | --- |
| Entry point | The next canonical `acquireAny()` call invokes the common worker lock helper. Pool mutations reuse it. No new recovery service or manual routine for ordinary coordinator crashes. |
| Evidence of coordinator loss | The coordinator renews once a minute through setup, execution, cleanup, and download. A worker-local deadline is the last renewal plus the configured worker timeout plus 15 minutes. Missing renewals beyond that interval mean ownership has been abandoned, whether caused by a crash, suspension, or network partition; no claim of cross-host PID certainty. Expiry permits cleanup, not reuse beneath survivors. |
| Undownloaded reports | Normal runs hold through verified download. After lost renewal reaches the recovery deadline, discard orphan reports during reuse and record their loss with the old identity, process cleanup, and deadline in a bounded recovery receipt. No orphan archive or additional blocking download. A returning coordinator that lost ownership reports infrastructure failure. |
| Capacity cost | At the 480-second cold-worker default, an orphan becomes recoverable 23 minutes after its last renewal; the 240-second default gives 19 minutes. Actual reuse adds the next acquisition attempt and bounded cleanup. A still-running owned supervisor or descendant is stopped by token and audited, so it cannot renew the lock or prevent ordinary recovery forever. |

One recovery sequence handles quiet and still-active abandoned attempts. The proposal deliberately forgoes early quiet-worker recovery to avoid a second liveness test or report-age clock. It keeps a short OS-released filesystem critical section for competing acquisition/renewal/release, and checks ownership at remote dispatch registration so a delayed API call cannot start obsolete work after recovery. These are races in our own code paths, not defenses against hypothetical callers.

Two limits remain for correctness: a process whose identity or termination cannot be confirmed cannot be ignored, and a legacy lock without outer-run attribution cannot justify killing by name. Hold and report those repair cases. Updated, attributable runs recover automatically even when their supervisor remains alive. Empty acquisition records with no dispatched work can be reclaimed after a clean worker audit; missing scratch metadata never adds a gate. This distinguishes a real cleanup failure from an ordinary crashed coordinator without multiplying recovery procedures.

Refinement 1 is resolved by contributor judgment: **five cases in two files**, the settings-persistence and executable-lifecycle cases in `theme-product-acceptance.test.ts` and all three cases sharing `browser-demo-mode.test.ts`'s page helper. The theme product and delivery proofs already describe built application behavior; both files include reload/restart walks and reuse existing helpers. PR #9 owns reset. After PR #32 and routine cleanup, the remaining 15-file migration has diminishing benefit relative to its proof and regression work. Name main's additional isolation/move callers as deferred too. Limit the proposed default to new or substantially changed `ProductServer` browser acceptances, leaving in-process `Server` / `appURLForServer()` paths and Electron seams alone.

| Refinement | Assessment and local change |
| --- | --- |
| 2: runner scratch needs stronger metadata than legacy prefixes | Accepted. After taking the lock and obtaining a clean worker owner audit, remove every earlier attempt directory in `/tmp/tv-testshards/` except the current one. Missing or partial directory metadata alone cannot block cleanup. Keep the existing path boundary and live-process protections. This does not decide how another run's held lock is recovered. |
| 3: require other branches to update and old runs to finish | Accept removing both pool-wide prerequisites. `expiresAt: 0` protects updated runs from the inspected old acquisition code; only the new helper understands the renewable deadline. Branches integrate the fix normally and final verify uses ordinary acquisition. An old coordinator still releases before downloading, which new code cannot retroactively protect. Respect unexpired legacy TTLs; after expiry a clean worker audit permits reclamation, while unattributable live work holds and reports. |
| 4a: distinguish Chromium 148 investigation from PR #32's 145 evidence | Accepted. State the observed trace version `148.0.7778.96`, the Playwright manifest's expected `145.0.7632.6`, and main's conditional 1223-to-1208 cache aliases. Today's actual worker browser version is unknown. Record the launched browser version and resolved executable/cache path during future Blaxel validation before interpreting memory or temporary-file evidence. No browser alignment change or new experiment is proposed here. |
| 4b: credentials for the Blaxel coordinator sandbox | Accepted. Specify process-environment injection of `BL_WORKSPACE`, an authorized `BL_API_KEY`, and `BLAXEL_TV_GH_TOKEN`, loaded in memory on the launching host. The installed SDK's authentication source and repository token reader support these paths. Do not copy credential files, embed values in commands/scripts/logs, or persist them in sandbox/Git configuration; verify availability before dispatch and end the credential-bearing process after report retrieval. No secret was read, copied, or transmitted while preparing this revision. |

The revision is ready for independent re-review; the historical FAIL is unchanged until that review converges. No spec, proof, or implementation was edited. No test, build, browser/server launch, remote experiment, or worker operation ran. Live renewal/recovery behavior, browser versions, `TMPDIR` placement, and incremental resource benefit remain unmeasured; the proposal names the private Blaxel validation needed after spec/proof convergence.

## Round 3: convergence and spec derivation

The [round 3 report](test-harness-resource-cleanup-review-r3.md) is copied verbatim. It passes the proposal and raises no blocker. Under the workflow's bounded-refinement rule, apply the four substantive improvements without reopening cosmetic review or adding another proposal stage:

| Refinement | Judgment and disposition |
| --- | --- |
| 1: fixed recovery interval | Accepted. Use 20 minutes, preserving the existing cold-profile allowance, independent of shard timeout. Reuse `--lock-ttl-seconds` for the interval override and derive renewal cadence from it. A healthy coordinator renews throughout ownership, so tying recovery to execution timeout bought no safety. Remove the custom-timeout field/case and the 19/23-minute distinction. This remains a proposed operating allowance to validate on Blaxel. |
| 2: delete a worker that cannot be cleaned | Accepted. Normal test acquisition still requires a clean audit. Explicit pool deletion refuses a valid reservation but may destroy an expired worker despite failed process cleanup. It first removes test-dispatch eligibility so a delayed provider deletion cannot hit a new test run. Failed deletion stays visible to pool management and unavailable to tests. Fresh-only `ensure` does not refill a partly deleted pool. This makes the stated operator repair path usable. |
| 3: live legacy work | Accepted. Skip/report it after TTL expiry and allow its matching-ID exit trap to free it normally. Do not call every live legacy run a repair case or add a second recovery mechanism. An old run that never exits still has the explicit pool deletion path. |
| 4: receipt and provisioning wording | Remove the separate receipt limit; the 8 MiB attempt budget already bounds it. Replace the undefined pool-draining language with delayed publication of test-discovery labels until runtime setup and architecture verification succeed. The existing architecture probe alone is insufficient to exclude a worker in the middle of setup once Node becomes available. Keep incomplete provisioning visible to the manager, with no silent reuse. No new pool-wide coordination protocol. |

Main at `a8e73fbf` is integrated in `74d22941`, with the policy-level reconciliation in that merge message. Preserve the Vite full-response fix, PR #9's built reset, origin repository selection, single-origin app helper, SDK assets and current proxy API. PR #30 separately fixed demo-mode fixture teardown by closing idle HTTP connections; revise the resource proposal to say so. The five-case conversion is retained for its shipped-asset boundary and repeated loads, with no claim that it cures that flake or produces the historical memory saving.

### Spec checkpoint

| Owner | Derived delta |
| --- | --- |
| `specs/arch/testing-policy.md` | Worker-owned reusable builds with Playwright/Vitest teardown and failed-preparation cleanup; built application default limited to new/substantially changed `ProductServer` browser acceptances. |
| `specs/arch/test-runner/blaxel-testshards.md` | Exclusive renewable reservation through teardown and retrieval; fixed recovery interval and existing option; automatic owned-process cleanup and explicit abandoned-report loss; legacy skip; pool provisioning/deletion exclusion; per-attempt scratch and exact pre/post-run cleanup. Replace the TTL-only release promises rather than leaving contradictory authority. Dedicated fresh workers can prove provisioning without recreating the shared pool. |
| `specs/arch/test-runner/reporting.md` | Parent start/end resource observations, failed/recovered attempt retention, missing-evidence honesty, bounded kernel excerpts and sidecars, recovery receipts, and normalized links to retained diagnostics. |
| `specs/arch/test-runner/test-runner.md` | Cross-reference the Blaxel abandonment exception while preserving ordinary live-owner protection; preserve outer attempt attribution through nested scopes. |
| `specs/arch/test-runner/sharded-execution.md` | Carry the outer attempt environment and diagnostic artifact references across shared execution and provider normalization. No planning, shard-count, or retry change. |

The rewritten spec policy on main governs this derivation. The proposal retains implementation rationale and the future experiment plan; specs own the lasting lifecycle decisions and cross-process/reporting contracts. Mirrored proofs and theme setup descriptions are intentionally unchanged at this checkpoint: they follow independent spec convergence. Product promises, production code, and the five conversion implementations are unchanged by this checkpoint.

Validation is read-only source/policy review, exact-copy comparison of the independent review, and Git diff/whitespace inspection. No tests, builds, browser/server launches, remote experiments, or worker operations ran. Live recovery, temporary-file placement and bounded evidence transport remain to be proven on committed/pushed Blaxel revisions. The supervisor arranges independent spec review; Josh accepts the spec changes at PR time.

Primitive surfaced the known recovery decisions and their later correction, alongside unrelated scope matches. Its discovery scan was truncated, so it was not a complete governing-set check. Repository policy and the supervisor's latest instructions governed the assessment; no decision was overridden or reconciled.
