# Removal account: test-runner specs

This account compares the nine old specs in `specs/arch/test-runner/` at `d2837551` with the six new ones at `92574976`, and says what became of each passage of the old specs, in order. It is step 5 of the spec-rewrite method. The ledger (`ledger.md`) justifies what the new specs say; this account justifies what they no longer say.

A *passage* here is a paragraph, a list or table that makes one point, a code block, or a list item that makes a separate point of its own. Each passage has one primary outcome:

- **Kept**: the same statement, in the same file, with its substance and nearly all of its wording unchanged.
- **Reworded**: the same meaning in new words, in the same file.
- **Moved**: now stated in another new file, which the entry names.
- **Derivable**: no longer stated, because it follows from a named statement in the new specs, the testing policy or the code.
- **Dropped**: no longer stated, because it does not belong under `specs/spec-policy.md`. The reason is given.

Where a passage splits, the entry gives the primary outcome first and says what happened to the rest. New specs are named without their directory; anchors are given as `file#section`. "Cited by" lists references outside the rewritten files that pointed at a heading, anchor or file that no longer exists; the full inventory is at the end. The proofs under `proofs/arch/test-runner/` are re-derived after human review, so their citations are listed only in the inventory.

## attestation.md

1. **Opening paragraph (purpose; draft pull requests use a separate skip).** **Reworded**: attestation.md's introduction keeps the purpose, cheap checks always running, and doubt resolving to running tests. The draft-PR skip is stated in github-ci.md#when-it-runs.
2. **Ownership paragraph.** **Reworded**: the introduction's second paragraph names github-ci.md and test-runner.md#verify.
3. **"What an attestation claims", the claim in bold.** **Reworded**: attestation.md#the-claim, first paragraph.
4. **Tree hash definition.** **Reworded**: first bullet of #the-claim.
5. **Full validation gate (lint, type-check, manifests, complete `all` with desktop, standard retries; recovered flake is a pass).** **Reworded**: first paragraph of #the-claim. It now also says that a Blaxel attestation does not cover Firefox (review round 1).
6. **Self-pinning for everything the tree controls.** **Reworded**: first bullet of #the-claim.
7. **What the tree does not pin, and the two bounds.** **Reworded**: second bullet of #the-claim.
8. **Attestation version introduction.** **Reworded**: #the-claim (the version in the ref) and #policy (only current-version refs are honored).
9. **Version domain and encoding; malformed disables both.** **Reworded**: the comment on `testpassVersion` in #policy, and "anything unexpected means disabled".
10. **Version bound to the validation interval (read before the first phase and at completion).** **Reworded**: the last eligibility condition in #who-may-write, and the closing sentence of #operations.
11. **Safe version-change procedure.** **Reworded**: attestation.md#operations, five steps. The sentence that the disabled flag is re-checked by a run's writer is derivable from the eligibility condition that reads the policy at the end. "Policy history on main is the audit trail" is dropped as derivable from Git.
12. **Ref shape code block.** **Reworded**: the first sentence of #the-claim names the ref and its target.
13. **Bare ref, no metadata.** **Reworded**: third bullet of #the-claim.
14. **Create-only compare-and-swap push; benign outcomes; lease rejection handling.** **Reworded**: fourth bullet of #the-claim keeps the exact push form, existing-valid success and malformed-reported. The measured "Everything up-to-date" transport behavior is dropped as Git implementation detail.
15. **Consumer fetches by name and verifies the invariant; malformed refs ignored and deletable.** **Reworded**: third bullet of #the-claim, and `--delete-ref` in #revoking-and-pruning.
16. **Lab refs.** **Reworded**: last bullet of #the-claim.
17. **"Who writes, and when" introduction (every clause; a miss is not an error).** **Reworded**: #who-may-write, "A run that misses a condition simply does not write". Cited by `.github/workflows/ci.yml` and `scripts/test/cli.mjs` (`#who-writes-and-when`).
18. **Clause 1, eligible source.** **Reworded**: the two source bullets and "A local run never writes" in #who-may-write.
19. **Clause 2, one tree.** **Reworded**: first condition bullet.
20. **Clause 3, clean and unchanged, bracketed.** **Reworded**: first condition bullet. The remark that a recorded `workingTreeDirty: false` alone is insufficient is dropped as an implementation note.
21. **Clause 4, complete scope, including the `SKIP_ACP_TESTS` example.** **Reworded**: second condition bullet keeps `SKIP_ELECTRON_E2E`. The `SKIP_ACP_TESTS` example is derivable: that knob guards suites outside the gate.
22. **Clause 5, canonical retry policy.** **Reworded**: third condition bullet.
23. **Clause 6, not itself attested-skipped.** **Reworded**: fourth condition bullet.
24. **Clause 7, policy permits at start and end.** **Reworded**: fifth condition bullet.
25. **`blaxel-verify` writer.** **Reworded**: first source bullet, which now also holds the definition of a publication-qualifying run that used to live in test-runner.md.
26. **`github-ci` writer, command-boundary identity, `contents: write`, forks.** **Reworded**: second source bullet. The `contents: write` permission is dropped as workflow wiring the job needs anyway.
27. **The production writer refuses other sources; GitHub test jobs use `provider=local`.** **Reworded**: the identity requirement in the second source bullet, and "A local run never writes" in #who-may-write.
28. **Trust model.** **Reworded**: last paragraph of #who-may-write.
29. **`attest-check` computation and auditable log.** **Reworded**: first paragraph of attestation.md#skipping-in-ci. Cited by `.github/workflows/ci.yml` (`#skip-semantics-in-ci`).
30. **Expected negative outcomes are successes.** **Reworded**: first bullet of #skipping-in-ci.
31. **Unexpected failure is non-gating; outputs written before a failing step survive.** **Reworded**: second bullet of #skipping-in-ci.
32. **Skip authorization through `authorized`, with the measured run and exact expressions; accepted post-action residual.** **Reworded**: second bullet of #skipping-in-ci keeps the mechanism, the reason and the accepted residual. The run ID and literal condition strings are dropped as history and workflow text.
33. **Heavy jobs skip only on the literal `'true'`; the join's third condition requires it.** **Derivable**: from "any doubt resolves to running the tests" (attestation.md introduction) and from trusting a skip only together with `authorized=true` (#skipping-in-ci).
34. **Never-skip-on-doubt in the job graph: `!cancelled()`; shards require build success.** **Reworded**: third bullet of #skipping-in-ci.
35. **Step-level skips on matrix jobs, with the required contexts named.** **Reworded**: fourth bullet of #skipping-in-ci, corrected. The live ruleset requires the matrix checks `unit` and `e2e:desktop`, not each `e2e shard n/16`.
36. **What always runs; only heavy jobs skip; drafts skip everything.** **Reworded**: "Only the heavy jobs skip" in #skipping-in-ci, and github-ci.md#when-it-runs.
37. **The join's behavior on drafts, non-drafts and attested runs.** **Moved**: github-ci.md#required-checks, including the attested-skip exception (review round 1).
38. **Main pushes skip the same way; a novel tree runs everything.** **Reworded**: last paragraph of #skipping-in-ci. The novel-tree case is derivable from the tree-hash claim.
39. **"Failure modes" introduction.** **Reworded**: "any doubt resolves to running the tests" in the introduction.
40. **Failure-mode bullets (unreachable origin; bad policy; broken invariant or age; decision job failure; write failures non-fatal).** **Reworded**, spread over #skipping-in-ci (expected problems give `skip=false`; heavy jobs run when the decision job crashes), #policy (anything unexpected means disabled), #the-claim (readers ignore mismatched refs) and #who-may-write (a failed write leaves the result unchanged).
41. **Staleness: definition changes self-invalidate.** **Reworded**: first bullet of #the-claim.
42. **Environment drift: the 7-day window, the committer-time proxy, future timestamps rejected, the bound in the log.** **Reworded**: second bullet of #the-claim keeps the window and the rejection of future dates. The explanation of why committer time is conservative is dropped as derivable, and the bound in the log line as implementation detail.
43. **Revocation: delete the ref; the flag as kill switch; in-flight skips; refs inert.** **Reworded**: attestation.md#revoking-and-pruning, first paragraph.
44. **Activation policy: default-deny, the type, the trusted read from `origin/main`, unavailable conditions, lab refs not consulting the policy.** **Reworded**: attestation.md#policy. The statement that lab writes ignore the policy is dropped as detail of the experiment tooling. Cited by `test/repo/test-runner-attestation.test.ts` (`#activation-policy`).
45. **Prune command block.** **Reworded**: the option bullets in #revoking-and-pruning. Cited by `scripts/test/cli.mjs`, `test/repo/test-runner-attestation.test.ts` and `test/repo/test-runner-guardrails.test.ts` (`#prune-and-retention`).
46. **Prune safety semantics.** **Reworded**: #revoking-and-pruning keeps the dry-run default, refreshing from origin, zero deletions without a policy, strictly-older cutoffs, the version refusals and stopping at the first failure. Rejecting globs and non-`refs/testpass/` names is kept in the `--delete-ref` bullet. The note that custom namespaces need an explicit fetch is dropped as Git knowledge.
47. **Three prune modes.** **Reworded**: the three option bullets.
48. **Attestations are pure optimization state; growth is bounded.** **Reworded**: "Pruning is always safe…". The growth bound is dropped as derivable.
49. **Testing guidance: real Git for writer and prune tests; workflow-file inspection proves contents only.** **Dropped**: it restates the testing policy's seam rule and honesty rule (`testing-policy.md#^shape-seam`, `#Policy`), so it changes no proof derivation.
50. **Testing guidance: the isolated CI graph's four demonstrations.** **Reworded**: attestation.md#testing-guidance keeps the write, the skip with checks green and the decision-job failure cases. The absent-attestation case is derivable as an ordinary run. The join turning red after a build failure is derivable from github-ci.md#required-checks together with github-ci.md#testing-guidance. Cited by `test/repo/test-runner-attestation.test.ts` and `test/repo/test-runner-guardrails.test.ts` (`#test-assertions`, a heading that also did not exist in the old spec).
51. **Lab-mode verify publishes as part of the command; lab refs pruned.** **Kept**: attestation.md#testing-guidance.
52. **What no test can exercise; the operator's first checks; rollback.** **Reworded**: last paragraph of #testing-guidance.

## blaxel-testshards.md

1. **Opening paragraph (recommended path, speed, hot standby, the principal reason for a single runner).** **Reworded**: first paragraph of blaxel-testshards.md. The claim that Blaxel routing is the principal reason for a single runner is dropped, because test-runner.md's introduction states the runner's purpose.
2. **Ownership paragraph.** **Reworded**: the third introduction paragraph. Classification moved to sharded-execution.md#shard-outcomes.
3. **The only remote provider; the coordinator and pool scripts.** **Reworded**: last sentence of the first paragraph.
4. **Repository selection, normalization, failing before dispatch, public and private checkouts.** **Reworded**: blaxel-testshards.md#repository-and-credentials, first paragraph. The clause that `--repo-url` leaves the checks against `origin` unchanged is derivable from test-runner.md#^remote-revision, which makes no exception for it. Cited by `scripts/test/blaxel-repository.mjs` (`#Repository`).
5. **One pool for every repository; one checkout switched per run; dependency reuse.** **Reworded**: second paragraph of #repository-and-credentials.
6. **Shared trust boundary.** **Reworded**: same paragraph.
7. **GitHub token sources, `GH_TOKEN`, `GIT_ASKPASS`, never written.** **Reworded**: third paragraph of #repository-and-credentials. The variable name `GH_TOKEN` is dropped as worker wiring.
8. **Pool labels, `DEPLOYED`, too few workers fails, 72 workers, 36 shards, the 75 limit, the override, architecture checks.** **Reworded**: blaxel-testshards.md#pool, first two paragraphs. The constant names are dropped.
9. **The 36-shard measurements (42.957 s, 21.479 s, 30 s) and two verify lanes.** **Dropped**: the measurements are history behind a setting; the two-lanes rationale is **reworded** in #pool.
10. **`ensure` naming, default pool, size, image, memory, nvm tag, `.nvmrc` runtime.** **Reworded** in part: #pool keeps nvm and the `.nvmrc` Node. Sandbox names, the image, the memory size and the nvm tag are dropped as provisioning parameters that the pool manager holds.
11. **Fresh-only provisioning and the `createIfNotExists` reason.** **Reworded**: third paragraph of #pool.
12. **Labels published only after verification; partial workers reported; a partly deleted pool is not refilled.** **Reworded**: third paragraph of #pool keeps eligibility after verification. The rest is derivable from "refuses a pool that already has workers" and "delete the pool and ensure it again".
13. **Locking: the lock file, record fields, the guard, rechecks, no guard during downloads (`^blaxel-reservation`).** **Reworded**: first bullet of blaxel-testshards.md#leases, and the `WorkerLease` type, which pins the fields other revisions read. The anchor is gone.
14. **At most 32 concurrent acquisitions; waiting for every lease; one infrastructure result per shard when acquisition fails.** **Dropped**: concurrency and per-shard failure bookkeeping are implementation. "Fails if fewer workers than shards" is kept in #pool, and infrastructure classification is in sharded-execution.md#shard-outcomes.
15. **Only the coordinator renews; `recoverAfter`; 20 minutes; `--lock-ttl-seconds`; no revival.** **Reworded**: second bullet of #leases. Its independence from the execution timeout is dropped as derivable.
16. **Outer shard attempt token; dispatch recorded first; the entry point registers before checkout; attempt-specific uploads; unknown dispatch outcomes keep the lease.** **Reworded**: third and fourth bullets of #leases. Attempt-specific upload paths are dropped as implementation.
17. **Release conditions; the shell never unlocks; process stop is not proof; audit and signals; audit in the log; nvm before nounset; unreadable audits keep the lease (`^blaxel-release`).** **Reworded**: fourth bullet of #leases. The shell ordering detail (nvm before nounset) and the audit's log placement are dropped as code-level detail. The anchor is gone.
18. **Download while holding the lock; identity checks; early setup failures; retrieval retry; release of an unused lease; no reset before the boundary.** **Reworded** in part: the opening paragraph of #leases keeps the lease lasting until reports are downloaded and checked. Infrastructure classification of missing evidence moved to sharded-execution.md#shard-outcomes. The unused-lease release conditions are dropped as implementation.
19. **Interruption: retained evidence, authoritative interrupted snapshot, exit `130`, a second signal exits.** **Reworded**: fifth bullet of #leases. The detailed list of retained evidence is derivable from reporting.md#honest-status, "Reports state only what was observed".
20. **Abandoned-run recovery introduction (`^blaxel-recovery`).** **Reworded**: blaxel-testshards.md#abandoned-runs, first paragraph. The anchor is gone.
21. **Recovery under the guard; stopping live abandoned supervisors; the receipt; the exception to download-before-release.** **Reworded**: the numbered steps and the receipt paragraph of #abandoned-runs.
22. **Interrupted recovery; a returning coordinator; holding on failure; unreadable records; operator action.** **Reworded**: last paragraph of #abandoned-runs. That interrupted recovery leaves the old identity in place is derivable from the guarded sequence.
23. **Older runners (transitional).** **Reworded**: blaxel-testshards.md#older-runners.
24. **Pool deletion rules.** **Reworded**: blaxel-testshards.md#deleting-workers.
25. **`--audit-stale-owners`.** **Dropped**: a coordinator diagnostic option not reached through `npm test`; the code governs it.
26. **Temporary files: private attempt directory, `TMPDIR`, uploads in the attempt directory, sidecars finalized, short paths, caches (`^blaxel-scratch`).** **Reworded**: first paragraph of blaxel-testshards.md#temporary-files, anchor kept. Upload placement is dropped as implementation.
27. **The two removal targets.** **Reworded**: the removal list.
28. **Disuse established by lease and audit; link, mount and escape checks; what is preserved; what is reported (`^blaxel-known-leftovers`).** **Reworded**: the paragraph after the list. Mount-boundary and path-escape checks are folded into "does not follow links out of these locations". The anchor is gone.
29. **Teardown after the attempt; uncertain teardown; failed cleanup blocks dispatch; download despite cleanup failure; Chromium's unlinked shared memory.** **Reworded**: last paragraph of #temporary-files. Download despite a cleanup failure is derivable from release requiring retrieved reports (#leases).
30. **Only the current attempt's evidence on the worker; no archive; contents owned by reporting.** **Reworded**: last sentence of #temporary-files.
31. **Shard lifecycle: uploads before starting; a rejected upload becomes `transport/worker-dispatch`.** **Dropped**: implementation. That a transport failure is an infrastructure failure is in sharded-execution.md#shard-outcomes. Cited by proofs (`#Shard lifecycle`).
32. **The worker script's steps, Electron repair (`^blaxel-electron-repair`), runtime activation, system packages, owner lifecycle, targeted runs, `CI=1`.** **Reworded** in part: blaxel-testshards.md#runs keeps activating the checked-out `.nvmrc` Node, stale-owner handling, and running the same registry declarations, including wrapper commands. Step names, Electron repair mechanics (desktop runtime preparation is owned by `desktop/e2e-harness.md`) and environment exports are dropped as implementation. Nothing outside the area cited the anchor.
33. **A synthesized infrastructure summary for setup failures; path normalization.** **Derivable**: from sharded-execution.md#shard-outcomes, where a missing summary is `infra-failed`.
34. **Dependency-hash caching: inputs, marker path, `npm ci` flags.** **Reworded** in part: "dependencies are reinstalled only when the dependency declarations differ" in #repository-and-credentials. The marker path and flags are dropped as implementation. Cited by proofs (`#Dependency-hash caching`).
35. **Classification rules.** **Moved**: sharded-execution.md#shard-outcomes, generalized for both Blaxel and CI.
36. **Plan identity validation after download.** **Moved**: sharded-execution.md#plans (the worker checks the plan) and #shard-outcomes (a plan mismatch is `infra-failed`).
37. **Failure attribution (`worker-execution`, `timeout`, `transport`, `report-download`).** **Dropped**: internal failure-kind vocabulary that nothing outside the runner reads.
38. **`stale-owner` fails closed at the sandbox.** **Reworded**: second paragraph of blaxel-testshards.md#runs.
39. **Options table.** **Dropped** in large part: the coordinator script's options are code-governed. The user-facing ones are kept where their meaning matters: `--pool poc` (#pool), `--allow-shard-count-override 1` (#pool), `--lock-ttl-seconds` (#leases), `--repo-url` (#repository-and-credentials), `--commit` and `--ignore-uncommitted` (test-runner.md#^remote-revision), and the two infrastructure retries (test-runner.md#retries). Cited by proofs (`#Options`).
40. **Timeout profiles and the default-profile note.** **Dropped**: tuning values.
41. **Output directory layout and exit codes.** **Reworded** in part: exit codes are in test-runner.md's exit-code list and the interruption bullet of #leases, and provider output in `provider/` is in reporting.md#run-directory. The layout is dropped as internal.
42. **Local setup: install and log in.** **Kept**: blaxel-testshards.md#setup.
43. **Token item in 1Password, cross-repository access, env or file, the marker.** **Reworded**: #setup. Cross-repository access is in #repository-and-credentials. Cited by `specs/arch/testing-policy.md` (`#Local setup`, now `#setup`).
44. **Pool provisioning commands and the `default` pool trap.** **Reworded**: #setup. Cited by proofs (`#Pool provisioning`).
45. **Opt-in local suite exclusions (PostHog and daemon never on Blaxel).** **Moved**: test-runner.md#the-test-registry (both suites outside `all`, local-only placement) and blaxel-testshards.md#runs (other suites refused).
46. **Testing guidance: a live run before main; one targeted run suffices; real API and transport.** **Reworded**: first paragraph of #testing-guidance.
47. **A targeted run is insufficient for plan transfer.** **Reworded**: first bullet.
48. **Fresh workers for provisioning changes; a dedicated pool.** **Reworded**: second bullet.
49. **Recovery experiments on a dedicated pool; harness placement; observing temporary paths live.** **Reworded**: the following paragraphs. The harness placement moved here from test-runner.md.
50. **Two repositories for repository-switching changes.** **Reworded**: third bullet.

## flaky-tests.md

The file is removed. Its content now lives in test-runner.md#retries and reporting.md#honest-status. Cited by `specs/arch/testing-policy.md` (the file).

1. **Opening paragraph (a two-layer mechanism).** **Moved**: the introduction and bullets of test-runner.md#retries.
2. **Ownership paragraph.** **Dropped**: the file no longer exists, and its owners are now named where the content lives.
3. **Definition of a *flaky test*.** **Moved** in part: test-runner.md#retries defines a *recovered flake*, and the annotation bullet confines annotations to investigated flakiness in the harness or environment. `specs/terms.md` still defines *flaky test* against this file.
4. **Retry budget (two for non-unit surfaces, none for unit; recoveries reported; package configs at zero).** **Moved**: the runner-budget bullet of test-runner.md#retries. Package-level zero is dropped, because the runner always passes an explicit count.
5. **Infrastructure retries are separate; may repeat unit work; observations from incomplete attempts stay diagnostic; no flake count.** **Moved**: the infrastructure-retries bullet of test-runner.md#retries and sharded-execution.md#shard-outcomes. The counter detail is derivable from recovered flakes being native retries (reporting.md#honest-status).
6. **`FLAKY_TEST_RETRIES` type and resolution (parsing, `CI`, defaults).** **Moved** in part: the annotation bullet gives 5 under the runner and CI unless the variable is set. Parsing rules are dropped as code.
7. **The runner injects 5 unless set; direct runs get 0.** **Moved**: same bullet. The direct-run default is derivable from the code.
8. **One test case only.** **Moved**: same bullet ("never on a whole file or suite").
9. **Playwright annotation pattern (code block).** **Derivable**: from `test/flaky-retries.ts` and existing annotated tests. The `flaky:` title prefix is kept in the annotation bullet.
10. **Vitest annotation pattern (code block).** **Derivable**: as above.
11. **A quarantine file allowed when its name says so.** **Dropped**: no quarantine file exists, and nothing uses the allowance.
12. **Policy: investigate first; fix real failures; annotate only investigated harness flakiness; the prefix sets `flakyAnnotated`.** **Moved**: the annotation bullet of test-runner.md#retries.
13. **Recovered-flake reporting (Vitest attempt recorder authoritative; Playwright `flaky`; listed with attempts).** **Moved**: reporting.md#honest-status, for Vitest. Playwright's native status is derivable from its report.
14. **Lifecycle failures are not recoverable flakes.** **Moved**: "No retry clears a process leak" in test-runner.md#retries, and sharded-execution.md#shard-outcomes (a leak is `failed`, not retried).
15. **Network resets are harness defects, not grounds for annotation.** **Dropped**: flake discipline, including the proxy reset rule, belongs to the testing policy (`testing-policy.md#timing-observable-status-cleanup-and-flakiness`).
16. **Testing: annotations are judged in review.** **Dropped**: it restates the testing policy's review-based coverage judgment.

## github-ci.md

1. **Opening paragraph (what CI validates, drafts skip, fan-out, caches, building once).** **Reworded**: github-ci.md's introduction and #when-it-runs.
2. **Ownership paragraph.** **Reworded**: the introduction.
3. **What CI runs is owned under the runner's retry contract; attestation owns the skip.** **Reworded**: the introduction.
4. **The developer-to-CI reuse path through verify's attestation; `--no-publish`.** **Moved**: attestation.md#who-may-write and #skipping-in-ci, and the `--no-publish` sentence in test-runner.md#verify.
5. **GitHub CI as the other attestation source; `TV_TEST_REF_PUBLICATION`.** **Moved**: attestation.md#who-may-write.
6. **Superseded pull-request runs (`^gha-pr-concurrency`).** **Reworded**: github-ci.md#when-it-runs. The anchor is gone.
7. **Every job selects Node from `.nvmrc` once; which action selects it; metric recorders on the runner default.** **Dropped**: workflow wiring. `.nvmrc` authority is owned by `node-versions.md`.
8. **The install contract: what is cached, the key, no `restore-keys`, a hit skips `npm ci`, a miss saves, version bumps miss.** **Reworded**: first paragraph of github-ci.md#dependency-and-browser-caches. The version-bump cost and a possible later refinement are dropped as an accepted trivial cost and backlog. Cited by `.github/actions/setup-workspace/action.yml` and `test/repo/test-runner-guardrails.test.ts` (`#dependency-install`).
9. **The npm store cache as miss-path accelerator.** **Dropped**: implementation.
10. **The readiness namespace must increment; `shard-readiness-v2`.** **Reworded**: last sentence of #dependency-and-browser-caches.
11. **The combined shard archive and its key on `ImageOS`/`ImageVersion`; the build as sole producer after launch proof.** **Reworded**: second paragraph of #dependency-and-browser-caches.
12. **Consumer fallback on a miss, and image rollout skew.** **Reworded**: same paragraph.
13. **Browser environment: `setup-playwright`, no Node selector, per-shard launch probes, the operator's removal condition.** **Reworded** in part: the per-shard launch and its reason are in #dependency-and-browser-caches. The composite action's internals are dropped as workflow detail, and the probes' removal condition as backlog. Cited by `.github/workflows/ci.yml` (`#browser-environment`).
14. **Deferred pinned Playwright container, with runs and findings.** **Dropped**: history and a deferred plan (spec-policy, "What the product is now").
15. **Jobs without browsers use neither path; desktop needs Electron and builds for itself.** **Dropped**: workflow detail. Desktop's independence from the build is kept in github-ci.md#build-once.
16. **Desktop runtime preparation (`^gha-electron-runtime-preparation`).** **Dropped**: owned by `desktop/e2e-harness.md`, which the paragraph itself deferred to. Cited by `specs/arch/explainer-desktop-app.md` (`#desktop-runtime-preparation`).
17. **The matrix plans `e2e-ci`; a registry assertion; desktop covered separately.** **Reworded**: github-ci.md#jobs. The required registry assertion is dropped as the proof's to derive.
18. **Each shard computes the plan with the VM timing provider and Blaxel weights.** **Reworded**: #jobs, and sharded-execution.md#plans and #duration-baseline. The timing-provider identity is dropped as code.
19. **Phases recorded; run directory uploaded through `--run-dir-output`; the join's agreement checks.** **Reworded**: github-ci.md#run-artifacts and #required-checks. Phase recording moved to reporting.md#timing-records.
20. **Overlapping builds as the reason to build once.** **Reworded**: the first sentence of #build-once states the arrangement. The CLI build's sub-builds are dropped as derivable.
21. **The artifact is the build's output, from three sources (`^gha-prebuilt-partition`).** **Reworded**: #build-once, anchor kept.
22. **The artifact is every untracked file except three paths, with no output list.** **Reworded**: #build-once.
23. **The promise is bounded; four things out of scope (`^gha-prebuilt-bounds`).** **Reworded**: the second limit bullet in #build-once (adds files only; no deletions, empty directories or `node_modules` writes). Repository metadata differing between checkouts is derivable from taking tracked files from the shard's own checkout. Nothing cited the anchor.
24. **The one rule on builds (`^gha-prebuilt-tracked-rule`), with the `LICENSE` example.** **Reworded**: the first limit bullet. The `LICENSE` example is dropped. The anchor is gone.
25. **The manifest declares recipes; the `PrebuiltManifest` type; the coverage check.** **Reworded** in part: #build-once keeps the recipes and the rule that each surface build step is covered exactly once. The type is dropped: it is read only by the same tree's build job.
26. **One-day artifact retention; a tar archive keeping modes.** **Reworded** in part: the tar archive and its reason. Retention is dropped as a workflow setting.
27. **Consumers fail loudly, with no fallback (`^gha-prebuilt-consumer`).** **Reworded**: #build-once. The anchor is gone. Cited by a comment in `test/repo/test-runner-guardrails.test.ts`.
28. **`--skip-pre-commands` and `--plan` worker inputs.** **Reworded** in part: shards "skip their surfaces' build steps". The option names are dropped as internal to the workflow and worker.
29. **The build job produces the readiness cache before building.** **Dropped**: workflow ordering.
30. **Fan-out scope: desktop builds for itself.** **Reworded**: third limit bullet.
31. **Join integrity: draft guard, `always()`, success rules, vibe-mode, the attested path, the checkout, an induced-failure live run.** **Reworded**: github-ci.md#required-checks. The join's own checkout is dropped as derivable. The live induced failure is derivable from #testing-guidance together with the join's rules.
32. **Tool prerequisites on CI workers (`ss`, procfs; changes land together).** **Derivable**: planned shard workers check the process backend and fail without it (test-runner.md#processes-started-by-tests). The rule that changes land together is dropped as a maintenance obligation. Cited by `.github/workflows/ci.yml` (`#tool-prerequisites-on-ci-workers`).
33. **Sixteen shards as the measured knee, with run IDs; the total changes together.** **Reworded**: #jobs, without run IDs. Cited by `packages/web/playwright.config.ts`, `packages/web/playwright.real-stack.config.ts` and `test/repo/test-runner-guardrails.test.ts` (`#ci-worker-counts`).
34. **The `e2e:browser-app` two-worker pin, inconclusive measurements, `TV_PW_WORKERS`.** **Dropped**: a configuration value in `packages/web/playwright.config.ts` with no settled reason; the code governs it.
35. **`e2e:browser-app-real-stack` runs one worker, with the observed failures.** **Reworded**: github-ci.md#browser-worker-counts. Run IDs and the ticket are dropped as history.
36. **Testing: no test reaches the cache and artifact services; an isolated live run; scratch namespaces; deleting entries.** **Reworded**: github-ci.md#testing-guidance. Cited by proofs (`#Testing`).
37. **The four required pieces of live evidence.** **Derivable**: each follows from the promises in #dependency-and-browser-caches and #required-checks once a live run is required.
38. **Production check names can be confirmed only after merge.** **Reworded**: last sentence of #testing-guidance.
39. **Retirement record for the Blacksmith provider.** **Dropped**: history (spec-policy, "What the product is now"). Cited by `test/repo/test-runner-guardrails.test.ts` (`#retirement-record`).

## preflight.md

The file is removed. Cited by `AGENTS.md`, `developer-skills/tvdev-setup/SKILL.md` (by name, including "Execution-host capability checks"), `specs/arch/desktop/e2e-harness.md`, `specs/arch/desktop/index.md`, `specs/arch/desktop/runtime.md`, `specs/arch/node-versions.md` and `specs/arch/telemetry/sink.md`. Section and anchor citations are listed with their passages below.

1. **Opening paragraph and ownership.** **Dropped**: the file is gone. Its owners are now test-runner.md (remote revision checks, process backend), `node-versions.md` (toolchain) and `telemetry/sink.md` (the PostHog key).
2. **Definition of a *preflight*: named checks, a result each, in order, stopping at the first failure.** **Derivable**: from the code. `test-runner.md` still lists `preflight` as a command, and verify's phases include it. `specs/terms.md` still defines *preflight* against this file.
3. **Required checks: `node` always, `process-lifecycle` for local and planned runs, the union of surface checks, unit-only not exempt, exceptions for targeted and non-plan paths.** **Moved** in part: the process-backend scope is in test-runner.md#processes-started-by-tests, and surface-declared checks in test-runner.md#the-test-registry ("checks that must pass before it runs"). The reason unit-only runs are not exempt is derivable from "canonical local runs … check".
4. **Coordinator checks (`blaxel-github-token`, `blaxel-auth`); workers run the host check; capability checks are local only.** **Moved** in part: the Blaxel checks (credentials, a clean tree, a pushed commit) in test-runner.md#verify and #providers. The rest is derivable from the backend scope and from the token rule in blaxel-testshards.md#repository-and-credentials.
5. **Plain GitHub CI gets the host check without a `ci` provider.** **Derivable**: planned workers check the backend (test-runner.md#processes-started-by-tests), and CI is not a provider (#providers).
6. **`node` delegates to `node-versions.md`; its name is stable.** **Dropped**: owned by `node-versions.md`. The check's name is internal.
7. **`process-lifecycle` backends on Linux and macOS; never degrade to names or ports.** **Moved**: test-runner.md#processes-started-by-tests.
8. **`playwright-chromium`.** **Derivable**: from the registry's surface checks and the code.
9. **`playwright-firefox`: skipped with a reason outside GitHub Actions, required inside it.** **Moved**: the Firefox paragraph in test-runner.md#the-test-registry (review round 1), extended to say that Blaxel runs cover Chromium only.
10. **`electron` check against the shared environment planner; never installs (`^preflight-electron-runtime`).** **Dropped**: Electron runtime preparation and its planner are owned by `desktop/e2e-harness.md`. Cited by `specs/arch/explainer-desktop-app.md`.
11. **`daemon-test-host`, with its direct-run backstop.** **Moved**: the daemon-acceptance bullet in test-runner.md#the-test-registry ("refuses to start unless `TV_DAEMON_TEST_HOST=1`"), which covers the backstop.
12. **`posthog-test-key`, its sources and prefix.** **Dropped**: owned by `telemetry/sink.md#real-posthog-integration-test-surface`, which states the key, its sources and the prefix; test-runner.md links there.
13. **`blaxel-github-token`, `blaxel-auth`.** **Derivable**: from the token rule in blaxel-testshards.md#repository-and-credentials and verify's Blaxel checks.
14. **`fuser` is not a dependency; provider images must include the backend; a missing tool fails.** **Moved** in part: test-runner.md#processes-started-by-tests (the backend tools; worker setup installs them on Blaxel). The `fuser` note is dropped.
15. **Blaxel remote preflight introduction.** **Moved**: test-runner.md#providers (`^remote-revision`).
16. **The four git-safety checks.** **Moved**: test-runner.md#providers (a clean tree, a commit on an `origin` branch, `--ignore-uncommitted`). The exact Git commands are dropped as code.
17. **The `git` summary only when all checks pass.** **Dropped**: an internal type.
18. **After dispatch, planned workers run the host check and stale-owner cleanup; a failure is a pre-test infrastructure failure.** **Moved**: test-runner.md#processes-started-by-tests (stale tokens fail the run as infrastructure) and sharded-execution.md#shard-outcomes.
19. **Contributors commit and push before Blaxel; development branches.** **Moved**: test-runner.md#^remote-revision. The branch workflow is owned by `spec-workflow.md`. Cited by `specs/spec-workflow.md` (`#contributor-branches-and-remote-revisions`) and `specs/arch/testing-policy.md` (`#Contributor branches and remote revisions`).
20. **Reachability, not naming; `--ignore-uncommitted` gives no evidence for local edits; macOS and Linux alike.** **Moved**: test-runner.md#^remote-revision ("on a branch on `origin`"; "still tests only the committed revision"). The platform sentence is dropped as derivable.
21. **Contract types (`PreflightResult`, `RemoteGitPreflight`, `RemotePreflightResult`).** **Dropped**: internal types written and read by the same revision.
22. **Testing guidance: contract coverage for missing capabilities; the Linux seam; macOS needs a macOS host.** **Derivable**: from `testing-policy.md#^platform-breadth` and the backend statement.
23. **Testing guidance: the Electron planner handoff.** **Dropped**: owned by `desktop/e2e-harness.md`.
24. **Testing guidance: a real Git seam for git safety.** **Derivable**: from the testing policy's seam rule.
25. **Testing guidance: live evidence for Blaxel capability changes.** **Moved**: blaxel-testshards.md#testing-guidance (a live run for changes to remote operation). Cited by `specs/product/desktop-app.md`, `proofs/product/desktop-app.md` and proofs (`#testing-guidance`).

## reporting.md

1. **Opening paragraph.** **Reworded**: reporting.md's introduction.
2. **Ownership paragraph.** **Reworded**: the introduction links duration planning to sharded-execution.md. The list of what reporting owns is derivable from the sections.
3. **Run-directory location and the exact run-ID format, with its reason.** **Reworded** in part: reporting.md#run-directory keeps uniqueness across processes and hosts. The exact format is dropped: nothing parses it.
4. **Directory tree.** **Reworded**: the list in #run-directory.
5. **The `outputs` block; atomic writes; early exits still write the top-level files.** **Reworded**: #run-directory, scoped after review round 1. The promise holds once a directory exists, and refusals leave none. The `outputs` block is dropped as internal.
6. **Which process owns the directory (local CLI; the shard worker for CI shards; the Blaxel finalizer).** **Reworded**: #run-directory.
7. **CI matrix jobs keep distinct runs, and the join validates without rewriting them.** **Derivable**: from "Each GitHub CI test job writes its own" (#run-directory) and github-ci.md#required-checks.
8. **`--run-dir-output` and why `.test-runs/` is not enumerated.** **Reworded**: #run-directory. Its write is now tied to the directory's creation, not to "before preflight" (review round 1).
9. **Normalized surface result definition and types (`Counts`, `ProcessLeakSocket`, `NormalizedProcessLeak`, `NormalizedSurfaceResult`).** **Dropped** in large part: these are internal normalization types. The fields readers use are pinned instead in `RunSummary` (reporting.md#the-compact-summary). Cited by proofs (`#Normalized surface result`).
10. **Normalization rules: Vitest failures; recoveries only from the attempt recorder; never from aggregate messages; Playwright `flaky`; a missing report is incomplete evidence.** **Reworded**: reporting.md#honest-status.
11. **Duration sources for standalone, combined and provider parts.** **Dropped**: internal accounting.
12. **`TimingProvider` reference; `buildReports`.** **Dropped**: internal.
13. **`ReportSummary` and `ReportResults` types.** **Reworded** in part: the `RunSummary` pin keeps the fields readers use. The rest is dropped as writer-owned.
14. **`failedSurfaces` declared once; generated declarations must match; `surfacesRun`/`surfacesSkipped` counting; provider records.** **Dropped**: internal counting rules. "Missing work is never counted as run" is kept in #honest-status.
15. **`selection` is the requested scope; results only where evidence exists; nothing synthesized; idle shards.** **Reworded**: #honest-status, and the `results.json` line in #run-directory. The idle-shard detail is dropped.
16. **The three status fields.** **Reworded**: #honest-status, now placed in the summary's `run` block (review round 1).
17. **What an incomplete run may and may not report.** **Reworded**: #honest-status.
18. **`failedSurfaces`/`skippedSurfaces` semantics; partial aggregates.** **Dropped**: internal.
19. **An interrupted provider run is incomplete and keeps its evidence.** **Derivable**: interruption is an infrastructure failure (sharded-execution.md#shard-outcomes), so the run is incomplete (#honest-status). The coordinator keeps what it retrieved (blaxel-testshards.md#leases).
20. **A passed summary with a nonzero exit.** **Moved**: sharded-execution.md#shard-outcomes.
21. **Process-leak status fields; stale owners as synthetic lifecycle surfaces; counting unique leaks.** **Reworded** in part: #honest-status (a leak fails its surfaces and marks them incomplete). Failure-kind names and the synthetic-surface representation are dropped as internal.
22. **Compact discipline: no passed tests; the compact fields; 800-character errors; leaks in full; `results.json`.** **Reworded**: reporting.md#the-compact-summary and its pinned type. The 800-character limit is dropped as a tuning value.
23. **`events.ndjson` as the exception to compact discipline.** **Reworded**: #the-compact-summary.
24. **Resource diagnostics: what is observed, when, and as unavailable rather than zero (`^resource-diagnostics`).** **Reworded**: reporting.md#resource-diagnostics, anchor kept.
25. **The sidecar's identity, retention, links, attempt history; no invented outcomes.** **Reworded**: the second paragraph of #resource-diagnostics.
26. **Kernel OOM lines, byte limits, reserved space, stated truncation, warnings (`^resource-diagnostic-bounds`).** **Reworded** in part: bounded per surface and per attempt, never changing outcomes. The byte limits are dropped as tuning values. The anchor is gone.
27. **What the observations do not prove; no periodic sampler or heap snapshots required.** **Reworded**: first paragraph of #resource-diagnostics. The list of things not required is dropped, since nothing asks for them.
28. **Recovery receipts.** **Reworded**: last sentence of #resource-diagnostics.
29. **No credentials, query strings, bodies or environments; identities without arguments; outside scratch; out of the event stream; native retry and trace policy unchanged.** **Reworded** in part: reporting.md#nothing-secret. The remaining placement notes are derivable from blaxel-testshards.md#temporary-files (evidence moves out of scratch).
30. **Event stream encoding (UTF-8 NDJSON, RFC 8785) and completion.** **Reworded** in part: "The same input gives the same bytes" in reporting.md#timing-records. The canonicalization scheme is dropped as the means of that determinism.
31. **The event hierarchy; leak events; the synthetic shard; fail-fast and `not-assigned` surfaces.** **Reworded** in part: the event kinds are in the pinned `TimingEvent` type. The hierarchy rules are dropped as writer-owned.
32. **The full event types.** **Reworded** in part: the envelope and the fields `baseline update` reads are pinned, with the rule for changing the stream (review rounds 1 and 2). The rest is dropped as writer-owned.
33. **Phase metrics as standing output, mirrored in the summary and printed.** **Reworded**: "The summary repeats the phases" in #timing-records.
34. **Stable phase categories; costly steps; cache status; provider-specific names.** **Reworded** in part: the phase coverage sentence. The category vocabulary is dropped: no dashboard reads it.
35. **GitHub jobs measuring schedule delay; sidecar ingestion; the join's metrics artifact.** **Dropped**: workflow implementation. Their best-effort status is kept in #timing-records.
36. **Blaxel phases; surface phases; verify's metrics.** **Reworded**: the phase coverage sentence, and the verify example in the best-effort paragraph.
37. **Report finalization; `verify:tests` and `verify:total` appended to the summary only.** **Reworded**: the best-effort paragraph of #timing-records (review round 1).
38. **`phaseMetrics` is load-bearing; later appends best-effort; wrappers re-raise.** **Reworded**: the best-effort paragraph (review rounds 1 and 2).
39. **Duration integers; POSIX paths; stripping the remote root; the `testId` digest.** **Dropped**: internal. Repository-relative paths are kept in the pinned file event.
40. **Leak records: `leakId` digest, sorting, executable only, sockets, `survived`.** **Reworded** in part: #nothing-secret keeps the executable without arguments. The rest is dropped as internal.
41. **File `durationMs`, `planningDurationMs`, `complete: false`.** **Reworded**: the comments on the pinned file event, and sharded-execution.md#duration-baseline (review round 1).
42. **One event per native attempt; `recoveredFlake` flags; preserve unknowns.** **Derivable**: from #honest-status ("never becomes a failed test"; only observed outcomes).
43. **Playwright JSON suffices; Vitest's does not; the attempt recorder; never from `failureMessages` (`^vitest-attempt-recording`).** **Reworded**: #honest-status. The anchor is gone. Cited by proofs (sharded-execution).
44. **Deterministic ordering; contiguous `sequence`.** **Reworded** in part: the contiguous `sequence` is pinned, and determinism is stated. The ordering rules are dropped.
45. **What the event stream never contains; the environment allowlist.** **Reworded**: #nothing-secret.
46. **GitHub Actions artifacts (name, `if: always()`, error if missing, 30 days; no credentials).** **Moved**: github-ci.md#run-artifacts. The credentials rule is in reporting.md#nothing-secret.
47. **Testing: a seam for the Vitest attempt recorder; fixtures from recorded reports.** **Derivable**: from the testing policy's seam and composition rules, given the recorder statement in #honest-status.

## sharded-execution.md

1. **Opening paragraph.** **Reworded**: sharded-execution.md's introduction.
2. **Ownership paragraph.** **Reworded**: the introduction.
3. **One committed rollup at `test/timing-baseline.json`; a planning input measured only on Blaxel; every plan uses it.** **Reworded**: sharded-execution.md#duration-baseline.
4. **`TimingProvider` union and the baseline types.** **Dropped**: the baseline's format is left to code, because the file is committed with the code that reads it (review round 1, finding 1). The Blaxel identity is pinned in reporting.md#timing-records.
5. **The `providers` map holds only the Blaxel entry.** **Dropped**: format detail, as above.
6. **The canonical empty baseline; the planner requires the file; the 60-second no-history weight.** **Dropped**: format and a constant. Unknown files being weighted as expensive is kept in #plans.
7. **Timing-provider identities (local, Blaxel, GitHub, a reserved container ID).** **Dropped**: an internal identity scheme, except the Blaxel identity pinned in reporting.md.
8. **`TV_TEST_TIMING_PROVIDER` defaults; GitHub fails without one.** **Dropped**: wiring between the workflow and the reporter.
9. **What the median is taken over, and the sample and count fields.** **Reworded** in part: #duration-baseline (planning duration; complete, finally passing observations; recovered flakes included; review round 1). The count fields are dropped.
10. **Median arithmetic; units; ownership must match.** **Dropped**: arithmetic. Registry ownership of files is in test-runner.md#the-test-registry.
11. **Key order, serialization and byte-identical output.** **Dropped**: formatting that the code owns.
12. **The only writer is `baseline update`.** **Reworded**: #duration-baseline. Cited by `scripts/test/timing-baseline.mjs` (`#Manual update`).
13. **Input-run criteria.** **Reworded**: "it reads only complete Blaxel runs of the full suite".
14. **The `all` label is not evidence; validation; recompute; printed changes; `--dry-run`.** **Reworded**: #duration-baseline. Stream validation is in reporting.md#timing-records.
15. **Aborts on unreadable runs; fails with none; never commits; never automatic; a person reviews.** **Reworded**: #duration-baseline.
16. **Nothing is carried forward.** **Reworded**: same paragraph, with the reason.
17. **Shard plan definition; atomic files; every surface present.** **Reworded**: sharded-execution.md#plans.
18. **Plan types.** **Dropped**: plans are produced and consumed within one run.
19. **A valid plan has at least one file; idle per-shard surfaces.** **Reworded** in part: a shard with no files for a surface skips it (#plans). The at-least-one-file rule is dropped as code.
20. **Ordering, canonical JSON, the `planId` digest, the baseline digest, no time or randomness; retained.** **Reworded** in part: "Plans are deterministic … identified by a digest of its content". The formulas are dropped.
21. **Inventory from `git ls-files`; a temporary index for another commit; untracked files cannot matter.** **Reworded**: first bullet of #plans. The Git mechanics are dropped.
22. **The candidate filename pattern; exactly one owner; configuration failures; no config imports.** **Reworded** in part: the first bullet of #plans. The one-owner rule is in test-runner.md#the-test-registry. The filename pattern is dropped as code.
23. **Workers load configs only to execute; the assigned-versus-collected guard.** **Reworded**: second bullet of #plans. Cited by proofs (`#Explicit file execution`).
24. **Baseline medians are used whatever the plan's provider; predictions are in Blaxel time.** **Reworded**: #duration-baseline and the balancing bullet of #plans. Cited by `scripts/test/shard-plan.mjs` (`#Provider weights and unknown files`).
25. **The generous unknown-file weight formula.** **Reworded** in part: "weighted as expensive". The formula is dropped.
26. **Nearest-rank p90; `weightSource`.** **Dropped**: arithmetic.
27. **LPT assignment steps.** **Dropped**: algorithm. "Balanced by expected duration" is kept.
28. **LPT prevents heavy surfaces piling up; predicted sums are advisory.** **Reworded**: the balancing bullet ("guide the balance but do not predict wall time").
29. **A static plan; no queue; retries reuse it.** **Reworded**: last bullet of #plans.
30. **Stage-one cost model: additive medians only.** **Reworded**: the balancing bullet states it as an accepted limitation.
31. **The 2× overestimate and 24-second observations.** **Dropped**: measurements behind the advisory statement.
32. **Revision triggers before any shard-count increase.** **Dropped**: a plan for future work (spec-policy, "What the product is now": a spec is not a backlog).
33. **Each GitHub job computes the plan; digest check; no mutable inputs.** **Reworded**: the determinism bullet of #plans.
34. **Digests do not prove cross-job agreement; summary fields; the join's checks.** **Reworded**: the determinism bullet, and github-ci.md#required-checks.
35. **Blaxel computes the plan once; workers validate it.** **Reworded**: the determinism bullet.
36. **No native `--shard` in planned runs.** **Derivable**: from "Each shard runs exactly its assigned files" (#plans).
37. **Vitest absolute paths and substring ambiguity; the collection check; the combined `unit:workspaces` process.** **Reworded** in part: the substring trap is stated once, in test-runner.md#commands, and the collection check in #plans. The combined process is dropped as internal.
38. **Playwright `--test-list`; custom commands forward it.** **Dropped**: mechanism. Wrapper commands applying remotely is in blaxel-testshards.md#runs.
39. **Generated lists and configs retained.** **Derivable**: from the run directory's `provider/` output (reporting.md#run-directory).
40. **A collection mismatch fails the surface as incomplete, with lists kept.** **Reworded**: second bullet of #plans.
41. **`not-assigned` surfaces skip everything; empty groups skipped; aggregates not skipped.** **Reworded** in part: second bullet of #plans. The aggregation rule is dropped as internal.
42. **`--skip-pre-commands`: caller-supplied artifacts, no fallback build.** **Moved** in part: github-ci.md#build-once (shards skip build steps; a missing archive fails, with no fallback). The option names are dropped.
43. **Planned execution is an exception to native sharding; native `--shard` remains for diagnostics.** **Dropped**: describes mechanisms outside any contract.
44. **Explicit shard counts; reviewed settings; a run never changes its own demand.** **Reworded**: last paragraph of #duration-baseline. Cited by `scripts/test/cli.mjs` (`#Shard-count scaling`).
45. **The recommendation algorithm, its 120-second target and its printed report.** **Reworded** in part: the two-minute target. The report's contents are dropped.
46. **Capacity owned by Blaxel; recommendations never override; GitHub's count is owned by github-ci.md.** **Reworded** in part: "A person changes the configured shard counts". The rest is derivable from blaxel-testshards.md#pool and github-ci.md#jobs.
47. **Blaxel and CI both run `scripts/run-test-shard.mjs`.** **Reworded**: the introduction.
48. **`--plan` input; grouping; the combined process.** **Dropped**: internal options. Cited by proofs (`#Shared shard worker`).
49. **`--test-retries` for non-unit surfaces; `FLAKY_TEST_RETRIES` injection.** **Moved**: test-runner.md#retries (the budget and annotation) and github-ci.md#jobs (shards pass the budget explicitly).
50. **Child environment composition; removing `FORCE_COLOR` and `NO_COLOR`.** **Dropped**: implementation.
51. **`--skip-pre-commands` (worker side).** **Moved**: as item 42.
52. **`--fail-fast`.** **Dropped**: nothing in the repository passes it (review round 1, finding 8). test-runner.md#retries now speaks only of ordinary runs.
53. **The worker writes `shard-<index>.json` and exits nonzero on failure.** **Dropped**: internal.
54. **On Blaxel the worker preserves the outer token and `TMPDIR`; sidecars travel with artifacts.** **Moved**: blaxel-testshards.md#leases (the token), #temporary-files (`TMPDIR`) and reporting.md#resource-diagnostics.
55. **Blaxel provider report collection; GitHub retains summaries.** **Derivable**: from reporting.md#run-directory and github-ci.md#run-artifacts.
56. **Provider report types (`ProviderTask`, `ProviderShard`, `AttemptReport`, `CombinedReport`).** **Dropped**: produced and consumed within one coordinator run. Cited by proofs (`#Blaxel provider report shape`).
57. **`NormalizedProcessLeak` is reporting's; generated declarations keep the unions.** **Dropped**: internal.
58. **Shard status values; completion decides first.** **Reworded**: sharded-execution.md#shard-outcomes.
59. **`infra-failed` meaning.** **Reworded**: first outcome bullet.
60. **A test failure is a completed shard and is not retried.** **Reworded**: second outcome bullet.
61. **A contradictory passed summary.** **Reworded**: second outcome bullet.
62. **A process leak is a completed lifecycle failure.** **Reworded**: second outcome bullet. reporting.md#honest-status covers its incompleteness.
63. **An unreadable summary.** **Reworded**: first outcome bullet.
64. **Observations kept from an infrastructure-failed shard do not settle the run.** **Reworded**: the paragraph after the bullets.
65. **Blaxel classifies per its spec; GitHub receives exits directly.** **Reworded**: the last sentence of #shard-outcomes.
66. **Each attempt's report files; an unreadable summary becomes infrastructure-failed.** **Derivable**: from the first outcome bullet and reporting.md#run-directory.
67. **The retry condition is owned by test-runner.md; the `stale-owner` exception; no GitHub retry coordinator.** **Reworded**: #shard-outcomes and blaxel-testshards.md#runs.
68. **Attempt history; the latest attempt wins; missing results; equal plans across attempts.** **Reworded** in part: "The run's result takes each shard from its latest attempt". The missing-result and plan-equality rules are derivable from the outcome rules and the fixed plan.
69. **The combined report's shard set and failed-task list; superseded observations; passing rule.** **Reworded**: the paragraph after the bullets.
70. **Normalization by surface; combined counts; deduplicated leaks; `not-assigned` and fail-fast parts.** **Dropped**: internal aggregation.
71. **Provider failure records; contradictions; `provider:<name>` when no evidence exists.** **Derivable**: from reporting.md#honest-status.
72. **The timing hierarchy from provider results; links only to retained files.** **Derivable**: from reporting.md#timing-records and #run-directory.
73. **Testing: platform coverage for `resolveTimingProvider`.** **Dropped**: the identity scheme is no longer specified, and the platform rule is the testing policy's.
74. **Testing: seams launching installed runners for exact assignment, the combined config and `--test-list`.** **Derivable**: from the testing policy's seam rule and the collection check in #plans.
75. **Testing: the Electron wrapper seam.** **Derivable**: from the testing policy (each call site is its own seam).
76. **Testing: a live planned Blaxel run proves plan transfer.** **Reworded**: sharded-execution.md#testing-guidance.
77. **Testing: live GitHub evidence of plan agreement.** **Reworded**: same section. Cited by proofs (`#testing`).

## test-registry.md

The file is removed. Its rules now live in test-runner.md#the-test-registry. Cited by `specs/arch/desktop/e2e-harness.md`, `specs/arch/explainer-desktop-app.md`, `specs/arch/licensing.md` and `test/repo/test-runner-guardrails.test.ts` (the file); `specs/terms.md` defines *test surface*, *suite* and *execution group* against it.

1. **Opening paragraph and ownership.** **Moved**: test-runner.md#the-test-registry and its introduction.
2. **Definition of a *test surface*; package association; "surface" is unrelated to artifacts.** **Moved** in part: the definition. Package association and the naming note are dropped as derivable.
3. **`test.config.mjs` is the registry; nothing is inferred from names.** **Moved**: test-runner.md#the-test-registry. Cited by proofs (`#source-of-truth`).
4. **Grouped versus top-level declarations; flattening; path normalization; `cwd` rules.** **Dropped**: loader implementation.
5. **`TestSurface` type.** **Dropped**: internal; the registry and its loader change together in one tree.
6. **Declared versus normalized surfaces.** **Dropped**: internal.
7. **The field list, including `isolated-github-only` and `supports`.** **Moved** in part: test-runner.md#the-test-registry names what a surface declares, and the `isolated-github-only` placement paragraph moved there. The note that targeted Blaxel runs skip the `supports` check is dropped as code.
8. **`TestService` type and the `publishUrlEnv` pattern.** **Dropped**: internal declaration format.
9. **Service lifetime, order, earlier URLs, full URLs, scoped and restored variables, the same declarations on every path.** **Moved** in part: test-runner.md#network-addresses-in-tests (a registry-declared service's URL arrives in the variable the registry names; no address derived from another), and blaxel-testshards.md#runs (the same declarations remotely). Order and restoration are derivable. Cited by `specs/arch/desktop/e2e-harness.md` (`#Surface services`).
10. **The suite record type and the include/exclude rule semantics.** **Dropped**: loader semantics.
11. **The registered suites.** **Reworded** in part: test-runner.md#the-test-registry defines suites and `all`, and names the excluded classes. The complete list is in `help` and the registry.
12. **`all` composition; explicit selection; lifecycle-fault and dynamic-services experiments; PostHog; daemon; build-config.** **Moved**: test-runner.md#the-test-registry. The dynamic-services and build-config notes are derivable from `all` being unit plus end-to-end.
13. **The Blaxel harness surfaces (`^blaxel-harness-surfaces`).** **Moved**: blaxel-testshards.md#testing-guidance. The anchor is gone. Cited by proofs.
14. **`DeclaredExecutionGroup`; flattening; ordering; `unit:build-config` as a separate surface.** **Dropped**: internal scheduling.
15. **`TestConfig` type.** **Dropped**: internal.
16. **The `.d.mts` conflation note.** **Dropped**: an implementation note.
17. **`SelectionOptions` and `selectSurfaces` semantics.** **Moved** in part: test-runner.md#commands (selectors). Tag AND-composition and the co-selector conflict error are dropped as code.
18. **`owningSurfaces`; path containment.** **Derivable**: from the code.
19. **Every test file has exactly one owner; `excludeRoots`.** **Moved**: test-runner.md#the-test-registry.
20. **`CANONICAL_TEST_INCLUDE_ROOTS`; `loadTestConfig` and `validateRegistry` signatures.** **Dropped**: internal. Cited by proofs (`#Discovery and validation`).
21. **Only `packages/` and `test/` are scanned.** **Moved**: test-runner.md#the-test-registry ("under `packages/` and `test/`").
22. **Validation errors.** **Moved** in part: an undeclared runner config is a registry error. The other errors are derivable from the code.

## test-runner.md

1. **Authority paragraph listing what the spec owns and its companions.** **Reworded**: test-runner.md's second paragraph.
2. **Also authoritative for addresses, Vite responses and process lifecycle.** **Reworded**: same paragraph.
3. **"Why this exists": one runner for anyone, especially agents; the grammar is the contract.** **Reworded**: the opening paragraph.
4. **Without one runner, invocations drift and agents emit ignored arguments.** **Reworded**: the opening paragraph.
5. **The runner guides; named overrides; not a security boundary; recognizable departures only.** **Reworded**: test-runner.md#guidance-not-enforcement.
6. **The consolidation pays off three ways (bulleted).** **Dropped**: motivation that adds nothing to items 3–4 and changes no derivation.
7. **Provider definitions.** **Reworded**: test-runner.md#providers.
8. **GitHub Actions is not a selectable provider.** **Reworded**: #providers.
9. **No default provider for shortcuts; remote runs test a committed revision from `origin`; only verify resolves automatically.** **Reworded**: #providers and #^remote-revision.
10. **Commands code block.** **Reworded**: the commands table and #verify.
11. **`npm test -- verify` is equivalent to `npm run verify`.** **Derivable**: from the code and `package.json`.
12. **Command table.** **Reworded**: the table in test-runner.md#commands.
13. **Package-level scripts are not supported entrypoints.** **Reworded**: the opening paragraph.
14. **Native entrypoints refuse; every host; launch paths carry context; unauthenticated; the non-plan preflight exception.** **Reworded**: test-runner.md#native-test-entrypoints. The preflight-scope exception now sits in #processes-started-by-tests.
15. **The refusal's content on marked and unmarked hosts; fixed examples; registered entrypoints only.** **Reworded**: #native-test-entrypoints.
16. **The direct-run override, exactly `1`; what it bypasses; help; testing-policy permission.** **Reworded**: #native-test-entrypoints and the policy pointer in #shared-development-hosts.
17. **Selector definition and table.** **Reworded**: the selector bullets in #commands. Cited by proofs (`#selectors`).
18. **The local provider accepts every suite subject to guardrails; Blaxel accepts only `all`, `unit` and `e2e`, with targeted and planned paths.** **Moved**: blaxel-testshards.md#runs.
19. **`--file` resolves to one owning surface; the local `supports` check; unknown positional arguments; unknown `--against-test-guidance` options.** **Reworded** in part: the `--file` bullet in #commands. The `supports` asymmetry and option-parsing rules are dropped as code.
20. **Publication-qualifying test execution (`^test-publication-qualifying`).** **Moved**: the Blaxel source bullet in attestation.md#who-may-write. Nothing outside the area cited the anchor.
21. **A publication-qualifying verify; selection options count.** **Moved**: attestation.md#who-may-write ("no narrowing selector").
22. **No opt-in; `--no-publish`; `--publish` is a usage error.** **Moved** in part: attestation.md#who-may-write and test-runner.md#verify. The `--publish` usage error is dropped as code.
23. **Two attestation source classes; `attest-write`; local never qualifies.** **Moved**: attestation.md#who-may-write.
24. **`--run-dir-output`: an atomic write right after creation; not inherited; orchestration validates the path.** **Moved**: reporting.md#run-directory.
25. **Broad runs are refused and directed to verify.** **Reworded**: test-runner.md#the-full-suite-shortcut.
26. **PostHog, daemon and harness surfaces are not broad verification.** **Moved**: test-runner.md#the-test-registry (outside `all`) and blaxel-testshards.md#testing-guidance (the harness).
27. **What trips the guardrail; other selections remain subject to local guardrails.** **Reworded**: #the-full-suite-shortcut.
28. **`--grep` alone; `--force`; verify passes `--force`; the broad-local override does not lift it.** **Reworded**: #the-full-suite-shortcut.
29. **Host marker (`^blaxel-host-marker`).** **Reworded**: test-runner.md#marked-hosts, anchor kept. It now says the marker is found through `HOME`, as `os.homedir()` reads it.
30. **One local file on marked hosts (`^local-one-file`).** **Reworded**: #one-local-file-on-marked-hosts, anchor kept.
31. **`--allow-extreme-inefficiency` is refused, naming its replacement; the shared phrase.** **Dropped**: the rename is history. The shared phrase moved to #guidance-not-enforcement, scoped to the shared-host and retry overrides (review round 1).
32. **The file boundary is set before preflight; native filters; uncommitted files; directories refused; `--force`.** **Reworded**: ^local-one-file and the native-filter paragraph in #commands.
33. **What the refusal says.** **Reworded**: the paragraph after ^local-one-file.
34. **Local-only placement takes precedence; agent tests.** **Reworded**: the same paragraph, which now also covers the harness driver (merge fix `8e6cfcb2`).
35. **The mutex across checkouts and its compatibility contract (`^local-test-mutex`).** **Reworded**: #one-local-run-at-a-time, anchor kept. The location and record are now pinned.
36. **When it is taken; verify's handoff; protection if the verify parent exits; commands that take none.** **Reworded**: ^local-test-mutex. Protection after the parent exits is derivable from staleness requiring every recorded process to be gone.
37. **The contention refusal's content.** **Reworded**: the choices list.
38. **The wait option; validation before waiting; cancellation statuses; combining with the bypass is an error; help documents it.** **Reworded**: the wait bullet and the paragraph after the list. Validation order and help are derivable.
39. **Held until processes exit and cleanup ends; recovery by identity; elapsed time never; stale processes fail the run.** **Reworded**: the staleness paragraph.
40. **The contention bypass and the independence of the overrides.** **Reworded**: the paragraph after the choices list.
41. **The self-test lock-location hook and the dry run.** **Dropped**: test seams for the proof and the code.
42. **Help exposes the paths and overrides.** **Derivable**: from the commands table ("Usage, including the guardrails and overrides below").
43. **Verify runs phases and stops at the first failure.** **Reworded**: test-runner.md#verify. Cited by `specs/arch/testing-policy.md` and proofs (`#Verify orchestration`).
44. **The marker controls resolution; local verify follows the guardrails.** **Reworded**: #verify.
45. **Provider resolution rules; positional and `--provider` errors.** **Reworded**: #verify. The argument errors are dropped as code.
46. **Phases for each provider; where remote preflight runs; the double preflight under `auto`; retry validation; the success line; attestation.** **Reworded**: #verify. The double-preflight explanation is derivable, and the tested revision is now "selected, `HEAD` by default" (review round 1).
47. **The vibe-mode check (`^verify-vibe-mode`).** **Reworded**: #verify, anchor kept. It now says what vibe mode is, because no other spec defines it.
48. **`--plan`.** **Reworded**: #verify and the exit-code list.
49. **The build-config integrity surface.** **Dropped**: an ordinary unit surface in `all`. The build configuration it checks is owned by `telemetry/sink.md`, which cites it.
50. **PostHog roundtrip suite selection and command.** **Dropped**: owned by `telemetry/sink.md#real-posthog-integration-test-surface`, which has the command. test-runner.md keeps its exclusion from `all` and links there.
51. **PostHog suite exclusion, local-only placement, the key and the preflight.** **Moved**: the PostHog bullet in test-runner.md#the-test-registry. The key details are owned by the sink spec.
52. **Daemon acceptance selection and command.** **Reworded** in part: the daemon bullet in #the-test-registry. The command follows from the one-file rule and the variable.
53. **Daemon suite exclusion; a designated host; the exact acknowledgement; the test repeats the check; not an authorization boundary.** **Reworded**: the daemon bullet ("refuses to start unless `TV_DAEMON_TEST_HOST=1`").
54. **What the daemon surface does (build, pack, install, bulldozer, asserted path).** **Dropped**: the test's own walk, owned by the test and the CLI specs.
55. **Persisted serve rejects port `0`; the temporary-home procedure; `TV_DAEMON_TEST_DIRTY_START`.** **Reworded** in part: the exception paragraph in #network-addresses-in-tests. The dirty-start mode is dropped as a test option that the code governs.
56. **Blaxel harness qualification (`^blaxel-harness-placement`).** **Moved**: blaxel-testshards.md#testing-guidance, with the anchor. Cited by proofs, which link the old file.
57. **The driver's fixture selections, committed registry, deliberate failures and cleanup.** **Moved** in part: blaxel-testshards.md#testing-guidance. The selection details belong to the driver and its README.
58. **The default budget; positive `--retries`; the unit notice; the per-test annotation pointer.** **Reworded**: the runner-budget bullet of #retries. The unit notice is dropped as code.
59. **Plain `--retries 0` for one file; resolution against what runs; native filters; `--grep` alone.** **Reworded**: the zero-retries bullet.
60. **Broader zero refused; the override's semantics; verify; it lifts nothing else; help follows the policy.** **Reworded**: the zero-retries bullet.
61. **Zero forms leave unit defaults, annotations and infrastructure retries alone.** **Reworded**: the zero-retries bullet.
62. **No automatic `maxFailures` cap.** **Reworded**: the paragraph closing #retries, scoped to ordinary runs (review round 1).
63. **Blaxel infrastructure retries, including the `stale-owner` exception.** **Moved**: the infrastructure-retries bullet of #retries, sharded-execution.md#shard-outcomes and blaxel-testshards.md#runs.
64. **CI is part of the retry contract; `--test-retries 2`; the desktop job inherits; change together.** **Moved**: github-ci.md#jobs (shards pass the budget explicitly). The change-together obligation is dropped as a maintenance rule that a competent change already follows.
65. **A local run writes a run directory and exits `0` or `1`.** **Derivable**: from reporting.md#run-directory and the exit-code list. Cited by proofs (`#local-execution`).
66. **Grouped execution; the combined `unit:workspaces` process; result splitting.** **Dropped**: internal scheduling.
67. **`--file` and `--grep` selections run surfaces one at a time.** **Dropped**: internal scheduling.
68. **Each surface task runs in its owned scope, with services and teardown before the next.** **Moved**: test-runner.md#processes-started-by-tests.
69. **Surfaces may declare a build, services or a command (registry-owned).** **Reworded**: test-runner.md#the-test-registry.
70. **`SKIP_ELECTRON_E2E=1` reclassifies desktop as skipped.** **Dropped**: code. attestation.md#who-may-write keeps the consequence that such a run cannot write.
71. **Test infrastructure binds port `0` (`^test-dynamic-ports`).** **Reworded**: test-runner.md#network-addresses-in-tests, anchor kept. Cited by proofs in product specs (`#Test infrastructure addresses`).
72. **Consumers receive full URLs; no numeric literals or fallbacks.** **Reworded**: same paragraph.
73. **Registry-declared service mechanics (own listener, Vite's port `0`, pre-transforms off, URL variables, order, missing variables fail).** **Reworded** in part: the Vite paragraph. Order and the missing-variable failure are derivable.
74. **Helpers return the bound URL; readiness messages.** **Reworded**: ^test-dynamic-ports.
75. **The `tv serve` test recipe (temporary home, port `0`, `--print-links`, `--port`).** **Derivable**: from the port rule together with the CLI specs that own the home, the hidden `--print-links` flag and the client-port rule (`product/cli.md`, `arch/cli/index.md`).
76. **Playwright configs read the published URL; no `webServer`; no fallback.** **Derivable**: from the full-URL rule.
77. **Static fixtures use relative URLs; injected service URLs; alternate hostnames.** **Derivable**: from the rule against numeric literals and derived addresses.
78. **Each URL is independent; the artifact host and view.** **Reworded**: "Nothing derives one service's address from another's port".
79. **Inert numeric ports are allowed.** **Reworded**: last sentence of ^test-dynamic-ports.
80. **A stable front listener across backend restarts.** **Derivable**: a technique that follows from the ban on reserve-then-release.
81. **Vite services never answer `304` (`^test-service-full-responses`).** **Reworded**: anchor kept.
82. **The Chromium shared-memory reason.** **Reworded**: same paragraph.
83. **Destructive fixture placement (`isolated-github-only`).** **Moved**: test-runner.md#the-test-registry. "This restriction is permanent" is dropped as emphasis without content.
84. **Lifecycle constants (`TEST_SURFACE_OWNER_ENV`, a two-second grace).** **Reworded** in part: the variable name is kept. The grace value is dropped as tuning (written as "a short grace period"). Cited by proofs (`#Surface process lifecycle`).
85. **Surface process scope and its owner (`^test-surface-owner`).** **Reworded**: #processes-started-by-tests, anchor kept.
86. **Token contents; opaque to tests; process groups; helpers preserve it; detached children.** **Reworded**: the token bullet and the pinned `SurfaceOwner`, which is now specified as a cross-revision format. Process-group mechanics are dropped.
87. **The scope's five-step order.** **Reworded** in part: the teardown bullet. The rule that a build step must exit without live descendants is dropped as detail.
88. **Teardown after any exit; `SIGTERM` then `SIGKILL`; the two-second reason; idempotence; no process outlives the scope.** **Reworded**: the teardown bullet.
89. **A killed owner cannot clean up; ephemeral hosts; persistent hosts reap later.** **Reworded**: the stale-owner bullet.
90. **The combined Vitest projects; one scope; a leak fails every member.** **Dropped**: internal. A comma-separated `surfaceId` for multi-surface scopes is noted in the pinned type.
91. **Persistent workers inspect tokens; staleness by supervisor; reap and fail.** **Reworded**: the stale-owner bullet.
92. **Blaxel reserves the whole worker; recovery may stop abandoned supervisors; outer attribution; resource evidence.** **Moved**: blaxel-testshards.md#leases and #abandoned-runs, and reporting.md#resource-diagnostics.
93. **End-of-surface leak detection (`^test-process-leak`).** **Reworded**: the teardown bullet, anchor kept. The diagnostic field list is reduced to PID, command and sockets, plus the pinned summary fields.
94. **Linux and macOS discovery; never by port or name.** **Reworded**: the discovery bullet.
95. **A leak fails its surface even when tests passed; results stay visible; combined members all fail.** **Reworded**: the teardown bullet and reporting.md#honest-status.
96. **Exit-code list.** **Reworded**: #commands. Cited by proofs (`#exit-codes`).
97. **A remote command exits `0` only with a passed report.** **Reworded**: #commands.
98. **The Cursor agent environment workaround.** **Reworded**: test-runner.md#cursor-agent-environment. The constants block is dropped.
99. **Testing guidance: spawn the CLI; native refusals through the native tool; self-test seams.** **Derivable**: from the testing policy's acceptance shape and mocking policy.
100. **Testing guidance: surface services coverage.** **Derivable**: from the testing policy's seam rule.
101. **Testing guidance: compositional provider selection; the Git seam; the live planned run.** **Derivable**: from the testing policy. The live run is in blaxel-testshards.md#testing-guidance and sharded-execution.md#testing-guidance.
102. **Testing guidance: reading `ci.yml` proves only its contents.** **Derivable**: from the testing policy's honesty rule, with the live requirement in github-ci.md#testing-guidance.

## Statements with no old passage

These new statements have no predecessor. The ledger gives each one's reason.

- The pinned `LocalTestMutexRecord`, `SurfaceOwner` and `WorkerLease` shapes (test-runner.md, blaxel-testshards.md). The old specs called these contracts without giving their shape.
- The pinned `RunSummary` and `TimingEvent` fields, and the rule for changing the event stream (reporting.md, review rounds 1 and 2).
- That Blaxel runs, and so Blaxel attestations, cover Chromium only (test-runner.md, attestation.md).
- The marker being found through `HOME` while the mutex ignores it (test-runner.md).
- The required check names as they stand in the live ruleset (github-ci.md#required-checks).
- The testing guidance that destructive lifecycle tests belong in `isolated-github-only` surfaces (test-runner.md#testing-guidance).

## Counts

Each passage is counted once, under its primary outcome. 75 of the reworded or moved passages also drop a detail, which the entry names, so "Reworded" and "Moved" overstate how much survived word for word.

| Old spec | Passages | Kept | Reworded | Moved | Derivable | Dropped |
|---|---|---|---|---|---|---|
| `attestation.md` | 52 | 1 | 48 | 1 | 1 | 1 |
| `blaxel-testshards.md` | 50 | 1 | 38 | 3 | 1 | 7 |
| `flaky-tests.md` | 16 | 0 | 0 | 10 | 2 | 4 |
| `github-ci.md` | 39 | 0 | 27 | 2 | 2 | 8 |
| `preflight.md` | 25 | 0 | 0 | 12 | 6 | 7 |
| `reporting.md` | 47 | 0 | 34 | 2 | 4 | 7 |
| `sharded-execution.md` | 77 | 0 | 43 | 4 | 8 | 22 |
| `test-registry.md` | 22 | 0 | 1 | 11 | 1 | 9 |
| `test-runner.md` | 102 | 0 | 66 | 15 | 11 | 10 |
| **All** | **430** | **2** | **257** | **60** | **36** | **75** |

## Where a reviewer might start

These are the judgment calls a human is most likely to disagree with, in rough order of consequence:

- **Contracts the old specs named but did not shape, now pinned.** The mutex record and owner token (test-runner.md), the worker lease (blaxel-testshards.md) and the summary and event fields (reporting.md) are new authority. Each is pinned only as far as another revision or reader relies on it.
- **Internal types and algorithms left to code.** The normalized result and provider report types (reporting 9, 13; sharded-execution 56), the baseline file's format (sharded-execution 4–6), the planning arithmetic and LPT steps (sharded-execution 25–27) and the coordinator's option table (blaxel-testshards 39).
- **Measured settings dropped with their measurements.** The 36-shard figures (blaxel-testshards 9), timeout profiles (blaxel-testshards 40), the `e2e:browser-app` two-worker pin (github-ci 34) and the cost-model revision triggers (sharded-execution 31–32). The settings themselves remain in code.
- **Content left to other owners.** Electron preflight and runtime preparation (`desktop/e2e-harness.md`: preflight 10, github-ci 16), the PostHog key (`telemetry/sink.md`: preflight 12, test-runner 50), flake discipline and network resets (testing policy: flaky-tests 15), and the `tv serve` test recipe (CLI specs: test-runner 75).
- **Testing guidance removed as derivable from the testing policy.** These are the derivable entries under each Testing heading (for example test-runner 99–102 and sharded-execution 73–75). The method's test is whether removal changes a correct proof derivation; the proofs, once re-derived, will show it.
- **Small rules dropped as unused or history.** The quarantine-file allowance (flaky-tests 11), `--fail-fast` (sharded-execution 52), the renamed `--allow-extreme-inefficiency` refusal (test-runner 31), `--audit-stale-owners` (blaxel-testshards 25) and the Blacksmith retirement record (github-ci 39).
- **Citations from outside the area.** `AGENTS.md`, `specs/spec-workflow.md`, `specs/arch/testing-policy.md` and `developer-skills/tvdev-setup/SKILL.md` point at `preflight.md`. `specs/terms.md` names `preflight.md`, `flaky-tests.md` and `test-registry.md` as owners. These are what readers meet first. All are listed below.

## Citations of removed passages

References outside the rewritten files whose target file, heading or block anchor no longer exists at `92574976`. They come from a scan of `specs/`, `proofs/`, `test/`, `scripts/`, `packages/`, `developer-skills/`, `.github/`, `AGENTS.md` and the guides. Citations whose targets survive, including `^test-dynamic-ports`, `^local-one-file`, `^local-test-mutex`, `^blaxel-host-marker`, `^verify-vibe-mode`, `^test-service-full-responses`, `^gha-prebuilt-partition`, `^blaxel-scratch` and `^resource-diagnostics`, are not listed.

Two rows were already broken before the rewrite: the `#test-assertions` headings in attestation.md and github-ci.md did not exist in the old specs either. Test comments in `test/node/cli-assets.test.ts` and `test/repo/test-runner-prebuilt.test.ts` cite `github-ci.md#^gha-prebuilt-cli-outputs`, a proof anchor in `proofs/arch/cli/index.md`; that citation was also broken before the rewrite.

| Old target | Now | Cited by |
|---|---|---|
| `attestation.md` `#activation-policy` | attestation.md#policy | `test/repo/test-runner-attestation.test.ts` |
| `attestation.md` `#prune-and-retention` | attestation.md#revoking-and-pruning | `scripts/test/cli.mjs`, `test/repo/test-runner-attestation.test.ts`, `test/repo/test-runner-guardrails.test.ts` |
| `attestation.md` `#skip-semantics-in-ci` | attestation.md#skipping-in-ci | `.github/workflows/ci.yml`, `test/repo/test-runner-attestation.test.ts` |
| `attestation.md` `#test-assertions` | no such heading in the old spec either; now attestation.md#testing-guidance | `test/repo/test-runner-attestation.test.ts`, `test/repo/test-runner-guardrails.test.ts` |
| `attestation.md` `#who-writes-and-when` | attestation.md#who-may-write | `.github/workflows/ci.yml`, `proofs/arch/test-runner/attestation.md`, `scripts/test/cli.mjs` |
| `blaxel-testshards.md` `#Dependency-hash caching` | dropped; reuse rule in blaxel-testshards.md#repository-and-credentials | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#Local setup` | blaxel-testshards.md#setup | `specs/arch/testing-policy.md` |
| `blaxel-testshards.md` `#Locking` | blaxel-testshards.md#leases | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#Older runners and pool operations` | blaxel-testshards.md#older-runners and #deleting-workers | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#Options` | dropped; user-facing options named in their sections | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#Pool provisioning` | blaxel-testshards.md#setup | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#Repository` | blaxel-testshards.md#repository-and-credentials | `proofs/arch/test-runner/blaxel-testshards.md`, `scripts/test/blaxel-repository.mjs` |
| `blaxel-testshards.md` `#Shard lifecycle` | blaxel-testshards.md#runs (in part) | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#^blaxel-known-leftovers` | blaxel-testshards.md#temporary-files | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#^blaxel-recovery` | blaxel-testshards.md#abandoned-runs | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#^blaxel-release` | blaxel-testshards.md#leases | `proofs/arch/test-runner/blaxel-testshards.md` |
| `blaxel-testshards.md` `#^blaxel-reservation` | blaxel-testshards.md#leases | `proofs/arch/test-runner/blaxel-testshards.md` |
| `flaky-tests.md` (file) | test-runner.md#retries | `proofs/arch/test-runner/flaky-tests.md`, `specs/arch/testing-policy.md` |
| `github-ci.md` `#Testing` | github-ci.md#testing-guidance | `proofs/arch/test-runner/github-ci.md` |
| `github-ci.md` `#^gha-pr-concurrency` | github-ci.md#when-it-runs | `proofs/arch/test-runner/github-ci.md` |
| `github-ci.md` `#^gha-prebuilt-tracked-rule` | github-ci.md#build-once | `proofs/arch/test-runner/github-ci.md` |
| `github-ci.md` `#browser-environment` | github-ci.md#dependency-and-browser-caches (probes) | `.github/workflows/ci.yml` |
| `github-ci.md` `#build-once-fan-out` | github-ci.md#build-once | `.github/workflows/ci.yml`, `scripts/run-test-shard.mjs`, `scripts/test/prebuilt.mjs` |
| `github-ci.md` `#ci-worker-counts` | github-ci.md#jobs and #browser-worker-counts | `packages/web/playwright.config.ts`, `packages/web/playwright.real-stack.config.ts`, `test/repo/test-runner-guardrails.test.ts` |
| `github-ci.md` `#dependency-install` | github-ci.md#dependency-and-browser-caches | `.github/actions/setup-workspace/action.yml`, `test/repo/test-runner-guardrails.test.ts` |
| `github-ci.md` `#desktop-runtime-preparation` | dropped; owned by desktop/e2e-harness.md | `specs/arch/explainer-desktop-app.md` |
| `github-ci.md` `#retirement-record` | dropped (history) | `test/repo/test-runner-guardrails.test.ts` |
| `github-ci.md` `#test-assertions` | no such heading in the old spec either; now github-ci.md#testing-guidance | `test/repo/test-runner-guardrails.test.ts` |
| `github-ci.md` `#tool-prerequisites-on-ci-workers` | derivable from test-runner.md#processes-started-by-tests | `.github/workflows/ci.yml` |
| `preflight.md` `#Contributor branches and remote revisions` | test-runner.md#^remote-revision | `AGENTS.md`, `developer-skills/tvdev-setup/SKILL.md`, `proofs/arch/test-runner/preflight.md`, `proofs/arch/test-runner/test-runner.md`, `specs/arch/desktop/e2e-harness.md`, `specs/arch/desktop/index.md`, `specs/arch/desktop/runtime.md`, `specs/arch/node-versions.md`, `specs/arch/telemetry/sink.md`, `specs/arch/testing-policy.md` |
| `preflight.md` `#^preflight-electron-runtime` | dropped; owned by desktop/e2e-harness.md | `specs/arch/explainer-desktop-app.md` |
| `preflight.md` `#contributor-branches-and-remote-revisions` | test-runner.md#^remote-revision | `specs/spec-workflow.md` |
| `preflight.md` `#testing-guidance` | blaxel-testshards.md#testing-guidance (live evidence) | `proofs/arch/test-runner/test-runner.md`, `proofs/product/desktop-app.md`, `specs/product/desktop-app.md` |
| `reporting.md` `#Normalized surface result` | reporting.md#the-compact-summary (pinned RunSummary) | `proofs/arch/test-runner/reporting.md` |
| `reporting.md` `#^resource-diagnostic-bounds` | reporting.md#resource-diagnostics | `proofs/arch/test-runner/reporting.md` |
| `reporting.md` `#^vitest-attempt-recording` | reporting.md#honest-status | `proofs/arch/test-runner/sharded-execution.md` |
| `sharded-execution.md` `#Blaxel provider report shape` | dropped (internal types) | `proofs/arch/test-runner/sharded-execution.md` |
| `sharded-execution.md` `#Explicit file execution` | sharded-execution.md#plans | `proofs/arch/test-runner/sharded-execution.md` |
| `sharded-execution.md` `#Manual` | sharded-execution.md#duration-baseline | `scripts/test/timing-baseline.mjs` |
| `sharded-execution.md` `#Provider` | sharded-execution.md#plans and #duration-baseline | `scripts/test/shard-plan.mjs` |
| `sharded-execution.md` `#Shard-count` | sharded-execution.md#duration-baseline | `scripts/test/cli.mjs` |
| `sharded-execution.md` `#Shared shard worker` | dropped in part; see account items 47-54 | `proofs/arch/test-runner/sharded-execution.md` |
| `sharded-execution.md` `#testing` | sharded-execution.md#testing-guidance | `proofs/arch/test-runner/test-runner.md` |
| `test-registry.md` (file) | test-runner.md#the-test-registry | `proofs/arch/test-runner/test-registry.md`, `specs/arch/desktop/e2e-harness.md`, `specs/arch/explainer-desktop-app.md`, `specs/arch/licensing.md`, `test/repo/test-runner-guardrails.test.ts` |
| `test-registry.md` `#Discovery and validation` | test-runner.md#the-test-registry | `proofs/arch/test-runner/test-registry.md` |
| `test-registry.md` `#Surface services` | test-runner.md#network-addresses-in-tests | `specs/arch/desktop/e2e-harness.md` |
| `test-registry.md` `#^blaxel-harness-surfaces` | blaxel-testshards.md#testing-guidance | `proofs/arch/test-runner/blaxel-testshards.md`, `proofs/arch/test-runner/test-registry.md` |
| `test-registry.md` `#source-of-truth` | test-runner.md#the-test-registry | `proofs/arch/test-runner/test-registry.md` |
| `test-runner.md` `#Surface process lifecycle` | test-runner.md#processes-started-by-tests | `proofs/arch/test-runner/sharded-execution.md`, `proofs/arch/test-runner/test-runner.md` |
| `test-runner.md` `#Test infrastructure addresses` | test-runner.md#network-addresses-in-tests | `proofs/product/cli.md`, `proofs/product/onboarding/onboarding-channels.md`, `proofs/product/resources/resources.md` |
| `test-runner.md` `#Verify orchestration` | test-runner.md#verify | `proofs/arch/test-runner/test-runner.md`, `specs/arch/testing-policy.md` |
| `test-runner.md` `#^blaxel-harness-placement` | blaxel-testshards.md#^blaxel-harness-placement | `proofs/arch/test-runner/blaxel-testshards.md`, `proofs/arch/test-runner/test-registry.md`, `proofs/arch/test-runner/test-runner.md` |
| `test-runner.md` `#exit-codes` | test-runner.md#commands | `proofs/arch/test-runner/test-runner.md` |
| `test-runner.md` `#local-execution` | derivable; see account item 65 | `proofs/arch/test-runner/test-runner.md` |
| `test-runner.md` `#local-guardrails` | test-runner.md#shared-development-hosts | `packages/artifact/README.md`, `proofs/arch/test-runner/test-runner.md` |
| `test-runner.md` `#selectors` | test-runner.md#commands | `proofs/arch/test-runner/test-runner.md` |
| `test-runner.md` `#verify-orchestration` | test-runner.md#verify | `proofs/arch/test-runner/test-runner.md` |
