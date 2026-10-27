# Resource-cleanup proposal: review response

Proposal round 3 at `57a701d0`, spec round 1 at `cd8aa453`, proof round 2 at `3fa15d47`, and plan round 2 at `04a6b275` all **PASS**, relayed by the supervisor. Proof round 2 also approves the narrow placement spec delta. Slice 1 is implemented for independent review; its evidence is linked below. Earlier sections retain the response history, including the superseded private full-gate arrangement. Reviewer: Claude Fable (Nina), arranged by the supervisor.

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

## Spec round 1: convergence and proof derivation

The supervisor relayed **PASS** on `cd8aa453`. The [complete spec review](test-harness-resource-cleanup-spec-review-r1.md) is copied verbatim. Apply the nonblocking refinements under the bounded rule; no additional spec-review round is requested by this response.

| Refinement | Assessment and disposition |
| --- | --- |
| 1: terminology | Use lease for coordinator ownership and lock for its directory. Say shard attempt for one shard's execution, retaining attempt for the shard-set attempt. Keep the existing block anchor stable. |
| 2: unreadable records | Use the same clean-audit requirement for acquisition and deletion. Missing ownership evidence authorizes neither signalling by name nor ignoring surviving owners. |
| 3: command-unavailable deletion | Partly accepted. A fresh worker never published for dispatch can be deleted without a lease. Do not adopt the broader inference that a worker absent from coordinator discovery has no live or valid earlier run: the review supplies no provider guarantee for that implication. A previously eligible worker whose ownership check cannot run remains held/reported for operator repair. This preserves the converged no-live-lease deletion rule; it adds no new recovery service or override. |
| 4: helper rule | Trim the spec to worker ownership, publication after success, teardown and the Blaxel backstop. The proof derives pending-build/failure cleanup and real Playwright/Vitest crossings from that rule and ordinary cleanup correctness. |
| 5: operations and output | State idle-pool deletion/refusal consequences, locate resource sidecars and receipts under downloaded artifacts, and name the temporary-cleanup lifecycle step. |
| 6: transitional text | Label the legacy protocol transitional and remove the two non-requirements. |
| 7: testing guidance | Keep actual Node and Chromium descriptor observations. Remove the duplicate placement rule and leave browser-version measurement hygiene in the proposal's experiment plan. |
| 8: sidecar lifetime and wording | Explicitly finalize setup sidecars outside scratch before removal; keep allocation-versus-free-space interpretation in working guidance rather than authority. |

### Proof checkpoint

The mirrored proofs now derive the following coverage, with new obligations explicitly marked **test to be written**:

| Owner | Coverage and cost boundary |
| --- | --- |
| `proofs/arch/test-runner/blaxel-testshards.md` | Contract decisions/order; real guard/registration and filesystem seams; canonical live retrieval/refusal, automatic active/quiet recovery, fresh provisioning and pool deletion on dedicated workers. Planned and targeted paths share small fixtures. Node and actual Chromium descriptor paths establish temporary-directory inheritance. No deliberate OOM, disk exhaustion, shared-pool contamination, or matrix of provider failures. |
| `proofs/arch/test-runner/reporting.md` | Bounded writer and retained-link contracts; real parent/Linux/native-runner capture; downloaded failed and recovered-attempt evidence composed into the same provider runs. Unknown probes, missing observations and lost reports cannot become passing evidence. |
| `proofs/arch/testing-policy.md` | Worker cache/publication contract, real Playwright and Vitest teardown seams with real source-CLI/web output, and failed-launch copy cleanup. The built-app default is honored by test design, not a policy-compliance source scan. |
| Shared-execution and runner proofs | Cross-reference the owner-token, temporary-directory, diagnostic-history and real-plan crossings above. Keep ordinary stale-owner protection and isolated-GitHub fixture restrictions. |
| Theme product/delivery and artifact product proofs | Update the selected five cases' loading boundary and mark adaptation pending. Preserve their user-visible assertions, stable origin/authentication over restart, and the separate Settings development-module walk. PR #9's reset remains unchanged. |

The main risk worth the live cost is reuse before owned processes stop or evidence reaches the caller. Contracts cover failure permutations, but cannot replace real Blaxel metadata updates, dispatch, renewal, cleanup and download. The two private workers and separate Blaxel coordinator in the proposal remain planned resources, not an assertion that they exist or are available. Actual execution will use committed/pushed revisions and the canonical runner; native retries retain the default budget. Only the existing recovery-interval option is shortened deliberately for crash tests.

Validation for this checkpoint is document/source inspection, review-copy comparison, Markdown index regeneration, and Git whitespace/diff inspection. No tests, builds, browser/server launches, provider experiments, or worker operations ran. Test and harness implementation has not begun. Independent proof review is the next gate; Josh's spec review remains at PR time.

Primitive's file check surfaced existing recovery decisions and the correction to the supervisor's illustrative rule, with `truncated: true` from discovery. That was not a complete constraint check; no decision was overridden or reconciled. These proof details derive the existing choices and introduce no new higher-order direction to record.

## Proof round 1: placement finding and refinements

The [complete proof review](test-harness-resource-cleanup-proof-review-r1.md) is copied verbatim. Its one blocker is warranted: the proofs ordered automated live qualification and intentionally failing native fixtures without an owning registry/runner placement rule. The worker reads the committed registry; the local replacement-registry hook is not a worker-selection mechanism.

The proposed correction keeps automated qualification and uses the existing `experiment` kind. Register separate `experiment:blaxel-harness` and `experiment:blaxel-harness-fixtures` surfaces; both stay outside `all` and ordinary CI. The driver runs through the canonical local runner on a dedicated credentialed Blaxel coordinator outside the worker pool and owns a disposable private pool. Its worker selection contains only the native fixtures. This retains repeatability, unlike operator-only live evidence, without a new kind, suite, forwarded registry hook, or general execution-placement framework. Ordinary Linux seams remain in the repository suite.

The delta is in `test-registry.md` (surface ownership/exclusion), `test-runner.md` (coordinator placement, planned/targeted fixture selection and driver cleanup), and a reference from `blaxel-testshards.md`. It changes no lock, recovery, cleanup or diagnostic promise. It does need independent spec review: the earlier PASS did not cover this missing placement. [tvdev-contribute](/home/user/.agents/skills/tvdev-contribute/SKILL.md) requires “independent agent convergence of every spec delta remains required before proof derivation.” The corresponding repository [workflow](../../specs/spec-workflow.md#Recommended approach) governs that ordering. Josh's human spec review remains at PR time.

| Finding | Assessment and disposition |
| --- | --- |
| B1: live tests and deliberately failing fixtures have no home | Return the proposed placement above to independent spec review before binding the live proof declarations to it. The existing behavioral live assertions remain pending obligations; no tests or driver implementation are written at this checkpoint. |
| R1: grades and proxy declaration | Accepted. Every affected theme, delivery, artifact and bridge assertion now distinguishes its existing policy-grade walk from the unwritten built-application adaptation. The theme declarations name the real stable-front proxy as harness transport; the coverage model still explains stable origin/authentication across port-0 backend restarts. Reset and already-built walks retain their coverage grades. |
| R2: worker-guard seam placement | Accepted. State ordinary repository test on Linux, with real procfs, signals, OS guard and filesystem. No provider credentials or live-provider acceptance is required. This contribution still executes that test only on Blaxel. The whole-worker audit forfeit remains with live recovery. |
| R3: worker fixture selection | Accepted in the proposed owning specs. A canonical `--tag blaxel-harness-fixture` selection delegates `--suite selection --surfaces experiment:blaxel-harness-fixtures`; `--surface experiment:blaxel-harness-fixtures` selects the targeted path. Bind those commands into the shared live declaration and retrieval assertion after placement convergence. Clarify now that reporting's replacement-registry hook applies only to the local parent/child seam. |
| R4: failed-launch cleanup assertion | Consolidate it into the existing real worker seam, using the missing bundle path and subsequent valid launch within the same fixture; remove the standalone assertion and redundant second contract citation. The review's authority premise is too narrow: the testing policy's timing/cleanup section does say cleanup of long-running modules is core to correctness, below its motion subsection. The consolidation is still worthwhile because the same worker-lifetime crossing can cover the private-copy failure without another fixture or launch sequence. |
| R5: upload path and cleanup timing | Accepted. Add to the existing live retrieval run: uploaded script paths are inside the current shard attempt directory, and retained phases include `temporary-cleanup` with counts and free-space evidence. No new live run. |

After placement spec convergence, complete the dependent proof binding: name both surfaces and the coordinator host in the shared live declaration, spell out planned/targeted selection in retrieval, and derive selection coverage for exclusion from `all`/ordinary CI and absence of driver recursion. Reporting's live diagnostic assertion shares that same driver. These are pending derivation steps, not silently approved additions to the reviewed proof tree.

Validation is document/source inspection, exact comparison of the saved review, Markdown index regeneration and Git diff/whitespace inspection. No tests, builds, browser/server launches, provider experiments or worker operations ran. Test and harness implementation remains unstarted.

Primitive's file check returned existing recovery and placement decisions with `truncated: true`; it was not a complete constraint check. No decision was overridden or reconciled. The latest 20 decisions contained no duplicate of the proposed automated experiment placement; it is recorded as agent-attributed `dec_7893f958`, with the repeatability rationale and operator-only alternative. That record does not substitute for independent spec convergence or Josh's PR review.

## Proof round 2: convergence and implementation planning

The supervisor relayed **PASS** on `3fa15d47`; the [complete report](test-harness-resource-cleanup-proof-review-r2.md) is preserved verbatim. The reviewer approved the placement spec delta and explicitly allowed the deferred proof binding as a bounded follow-up without another round. Complete that binding: both experiment surfaces, the dedicated coordinator host, planned/tag and targeted/surface commands, and one source-level registry/driver selection contract. Reporting's live assertion shares the same driver and placement. No new live scenario, suite, kind or test hook is introduced.

| Refinement | Assessment and disposition |
| --- | --- |
| 1: general selector description | Accepted. State package/runner/tag planned selection alongside the existing target path; this documents the current routing used by the reviewed placement. |
| 2: broad-run guardrail description | Accepted. Cross-reference the Blaxel harness surfaces and their exclusion from `all` alongside the other opt-in suites. |
| 3: minimum fixture shape | Accepted in the shared proof declaration and implementation plan. At least two native files are needed for the reviewed two-shard, file-atomic fixture run. This is derived test design, so it does not need a permanent minimum inventory rule in the registry spec. |

The work is not clearly one slice. The [implementation plan](test-harness-resource-cleanup-plan.md) proposes three coherent slices: worker-owned builds plus the five built-app conversions; bounded diagnostic capture/reporting; then exclusive leases, recovery, scratch/pool operations and the shared live qualification. Keeping the entire remote ownership lifecycle together avoids partially integrated exclusion rules. Separating diagnostics and helpers makes their real framework/process boundaries reviewable without repeating the paid-service scenarios. Slice 3 explicitly owns the pending remote diagnostic evidence and killed-worker backstop from the earlier slices. Each slice has its red/green criteria and expected baseline; the integrated result has a separate review and full gate.

Every test/build runs on a pushed revision on Blaxel. All worker-affecting validation uses `rose-cleanup`; the driver runs on `tv-cleanup-coordinator-rose` outside the pool. The plan also chooses the same private two-worker pool for complete `all` verification using the existing shard-count override, replacing the proposal's earlier shared-pool final-run arrangement. The complete selection still qualifies under the runner spec; private capacity and timeout headroom are unmeasured and must be reported if they block the gate. No silent shared-pool fallback is authorized by this plan.

Validation for this planning checkpoint is document/source inspection, exact review-copy comparison, Markdown index regeneration, and Git diff/whitespace inspection. No tests, builds, browser/server launches, provider experiments or worker operations ran. Implementation waits for the supervisor-arranged independent plan review. Josh's spec review remains at PR time.

Primitive surfaced the already-recorded opt-in experiment choice after the prior turn. That was consistent context but added no new requirement. Its edit hook reported a truncated governing-set scan, so it did not establish a complete constraint check; no decision was overridden. This turn follows the settled direction; the slice ordering and private validation arrangement are contribution-scoped execution choices, so no new durable decision was recorded.

## Plan round 1: full-gate placement and refinements

The [complete review](test-harness-resource-cleanup-plan-review-r1.md) is preserved verbatim. Its one blocker is warranted: the two-worker full gate had no credible setup/retry allowance, and deferring that known problem until the end of implementation would only delay completion. The three slices, proof assignments and intermediate baselines remain unchanged.

Read-only aggregation of `test/timing-baseline.json` confirms 311 Blaxel file medians totaling 882.506 seconds, or 441.253 seconds per worker when divided over two; `e2e:browser-app` contributes 376.485 seconds. These are historical measurements through 2026-09-29, not a measured duration or guaranteed timeout for the eventual tree. The coordinator's cold profile gives each worker process 480 seconds, including setup, and `scripts/test/cli.mjs` forwards no worker-timeout override. That is sufficient evidence to reject the two-worker gate budget without executing it. The documented tier has no allowance for a standard-size private pool beside the shared pool; actual occupancy still needs checking before provisioning.

Restore ordinary full verification to `npm run verify -- blaxel --pool poc`, at the standard 36 shards, invoked from `tv-cleanup-coordinator-rose` after private qualification and deletion of both private workers. The previous all-private gate was my overly broad reading of the worker-experiment restriction, not a requirement from Josh. All tests, lint, type checks and builds still run on Blaxel at pushed revisions; every fault, interruption and cleanup experiment remains private. The shared pool sees only ordinary full verification through the implemented runner. This restores the converged proposal's validation arrangement without changing a spec, proof obligation, timeout, retry budget or shard default.

| Refinement | Assessment and disposition |
| --- | --- |
| 1: large surface expansion | Accepted. Keep focused cases, complete affected files and directly affected helper callers on the private pool. Leave whole large surfaces, including `e2e:browser-app`, to the standard-shard integrated gate. State that `--surface` takes the one-worker targeted path even with `--shards`; do not imply the private pair splits it. |
| 2: name option forwarding | Accepted. Add `scripts/test/cli.mjs` and explicit `--lock-ttl-seconds` forwarding to slice 3's implementation area, with CLI delegation coverage and the existing live recovery run. Omitting the override retains the specified default. No new worker-timeout control. |
| 3: request inventory mechanism | Accepted. Use Playwright request events within the existing five walks. No extra launch or inventory harness. |
| 4: capacity arithmetic | Accepted as a planning bound, not a current inventory. The documented 72 shared workers plus two private workers and one coordinator reach 75 exactly. Check current workspace occupancy/limits before provisioning; report insufficient room without altering shared workers. |

Validation for this revision is whole-review reading and exact-copy comparison, source/spec inspection, arithmetic over the committed timing JSON, and Git diff/whitespace checks. No test command, build, browser/server launch, provider call or worker operation ran. Implementation remains unstarted and waits for the supervisor-arranged plan re-review. Coordinator capabilities and current capacity remain unmeasured; Josh's spec acceptance remains due at PR time.

Primitive's edit hook reported a truncated governing-set scan, so it did not establish a complete constraint check. No decision was overridden or reconciled. This revision follows the converged behavior and corrects contribution-scoped execution choices; it establishes no new durable team decision.

## Plan round 2: convergence and slice 1

The [complete PASS report](test-harness-resource-cleanup-plan-review-r2.md) is preserved unchanged. Accept its two bounded refinements: slice 3 adds an explicit supplied/default CLI-argument contract for `--lock-ttl-seconds`, and capacity planning no longer equates the documented concurrent-shard limit with a count of idle sandboxes. No slice boundary or proof obligation changes.

Read-only provider inventory found 143 deployed `poc` sandboxes and none of the named private hosts. The documented 72-worker inventory is therefore not current. Blaxel accepted creation of `tv-cleanup-coordinator-rose`; the canonical pool manager, running there at pushed `04a6b275`, provisioned `tv-testshard-x64-rose-cleanup-01` and `-02`. Each uses the named Playwright image, 8192 MB and Node 24.22.1/npm 11.19.1, with x64/Linux verified on the workers. API-key authentication and the GitHub credential are available; values were passed only through the SDK process environment. The provider accepted this capacity, but its account-specific quota and idle-sandbox accounting remain unknown. No shared worker was modified.

The first red checkpoint adds a real Playwright/Vitest worker fixture and parent seam. Each worker uses real source CLI and versioned web output in two cases, observes reuse after per-case cleanup, and leaves its outputs for the parent to inspect after normal teardown. An absent bundle exercises failed-launch private-copy cleanup; a later worker must receive different paths. Nested fixture retries are zero to observe exactly two cases; the canonical parent retains its default retry budget. Test execution has not yet occurred at this checkpoint. All subsequent commands and evidence are recorded below.

## Slice 1: implemented for independent review

The [slice 1 evidence record](test-harness-resource-cleanup-slice-1.md) contains the red/green revisions, exact selections, canonical run directories, request inventories, failed intermediate attempts and remaining limits. The code checkpoint is `38976455`; the following proof/document update changes no executable behavior.

The shared build owner now publishes only successful preparation, reuses each worker's source CLI and each versioned web build, removes failed output and waits for preparation during teardown. Real Playwright and Vitest worker fixtures close that lifetime after server cleanup. Per-launch cleanup is registered before preparation and removes failed private copies and homes. Existing direct and indirect builder callers receive the appropriate fixture registration. The selected two theme and three demo-mode cases now load built assets while retaining their product assertions; PR #9's reset and the separate Settings development walk remain unchanged. The theme restart path uses the existing stable-front proxy, and the helper supplies the built unsupported-URL view at the server's static path.

Four contract cases and the real two-framework seam have intended red/green evidence. The five converted walks first failed on their observed development-module requests, then passed on built application requests. Both affected browser files and ten focused caller selections passed, as did remote lint/type checking and the final cache/startup-disposal checks. Completed green runs needed no recovered retries and reported no process leaks. The final proxy check had one separate incomplete attempt when the coordinator's Git fetch stalled before acquisition; the confirmed fetch child was stopped, its failure retained, and the unchanged selection passed on repetition. The evidence record distinguishes that infrastructure interruption from test failures.

All execution occurred on the named private Blaxel hosts at pushed revisions; nothing ran on the shared development host and no shared worker was modified. The five mirrored proof files now cite the implemented, passing coverage. The optional Firefox project was unavailable; no new Firefox validation is claimed. Slice 1's killed-worker backstop, diagnostic transport, renewable worker ownership and recovery remain assigned to slices 2 and 3. Full verification and integrated review are still pending. The private hosts remain allocated for those slices.

The supervisor arranges independent review of this slice before further implementation. No new durable team decision was made; this work implements the converged proposal, specs, proofs and plan.

## Slice 1 round 1: convergence and slice 2

The supervisor relayed **PASS** at `036d0491`; the [complete review](test-harness-resource-cleanup-slice-1-review-r1.md) is preserved unchanged. Apply the proof-only refinement by attributing per-case server disposal to the real seam, and clarify that the final static log ends with the separately recorded fetch interruption. Keep the second framework invocation: it directly exercises the reviewed later-worker lifetime assertion, and removing it now would change that proof's scope. This optional cost reduction does not block convergence.

The reported 143 deployed shared sandboxes remain an operator question for Josh and an integrated-review documentation item. Do not infer quota semantics or change the pool. Slice 2 implements bounded parent diagnostics, retained links and retry history; live provider recovery/diagnostic qualification and the lease/download race remain explicitly pending until slice 3.

## Slice 2: implemented for independent review

The [slice 2 evidence record](test-harness-resource-cleanup-slice-2.md) records red/green commits, exact canonical selections, all intermediate failures and the remaining boundaries. The final code checkpoint is `0e82df7f`; the following proof/document update changes no executable behavior.

The shared collector retains a baseline before preparation and final observations after cleanup for planned standalone, combined Vitest and targeted execution. The targeted Vitest path uses the existing attempt recorder so recovered failures trigger kernel capture. Bounded serialization and download preserve identities, unavailable reasons, counter resets, exact execution intervals and native evidence, with no sample payload in compact summaries or timing events. Aggregation keeps earlier attempt links without replacing the final native outcome. The real-reader seam caught an installed util-linux parser incompatibility; the implementation now reads an enclosing whole-second UTC window and filters its output to the exact observation interval.

Five collector/interval contracts, two retained-link contracts, four parent cases and the combined-project seam have passed. Complete reporting, provider and shard-worker files passed, followed by focused checks for the kernel-reader corrections. Lint and type checking passed on the private coordinator at the final code checkpoint. Every test used the canonical runner and private pool at a pushed revision; none ran on the shared development host or shared pool. All executed runs reported zero process leaks and infrastructure failures. Temporary diagnostic probes used during kernel-reader debugging are removed.

The reporting proof now cites the implemented bounds, parent and link coverage. Its live download/reuse and recovery-receipt assertion stays pending for slice 3. The current lease/download race, worker recovery, scratch reclamation, persistent-worker retention, full verification and integrated review are still outstanding. The private hosts remain allocated. The supervisor arranges independent review before slice 3 begins. No new durable team decision was made.
# Slice 2 convergence and slice 3 start

The supervisor relayed PASS at `296391c0`; the complete review is preserved in
`test-harness-resource-cleanup-slice-2-review-r1.md`. Accept the bounded
refinements: reuse the timing-provider constant, resolve targeted Vitest configs
from the declared surface cwd, and reconcile recovery receipts with slice 3's
actual records. Passing surfaces intentionally retain compact start/end sidecars
within the existing per-attempt budget; this aids comparisons without a sampler
or cross-run archive.

Slice 3 starts with real generated lock-command checks on disposable Linux roots.
The first checkpoint only extracts the existing command without changing its
timestamp-only behavior; the new assertions require renewable ownership and
confirmed quiet-orphan recovery. Execution is pending on the private Blaxel pool.

## Slice 3 first red and Primitive observation

At `1320c957`, private canonical run
`.test-runs/2026-10-27T18-41-03-525Z-p19298-r7dc71e154247c385`
reached both native lock assertions and failed them with completed infrastructure:
the timestamp-only record lacks the renewable identity and cannot recover an
expired renewable lease. Defaults were unchanged: no unit retries, two allowed
infrastructure retries (none used).

Primitive flagged `dec_d81a353e` during pool-lifecycle edits. The ordinary CLI was
absent; npm returned ETARGET and its installed launcher failed with a dynamic
require error. A temporary loader recovered the decision text: it repeats the
earlier lock directive, including the literal no-expiry language, without the
later reviewed automatic-recovery clarification. Recorded the check as followed:
normal runs retain ownership through download; expired renewal authorizes owned
process cleanup, never reuse beneath live work. The converged specs govern that
clarification. The supervisor explicitly directed no further Primitive debugging.
Its partial/truncated decision scan is not a complete authority check. No tests,
builds or application processes ran on the shared host.
