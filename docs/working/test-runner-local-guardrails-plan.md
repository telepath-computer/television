# Local test-runner guardrails — implementation plan

This plan derives from the converged [proposal](test-runner-local-guardrails-proposal.md), [runner spec](../../specs/arch/test-runner/test-runner.md), [testing policy](../../specs/arch/testing-policy.md), and [runner proof](../../proofs/arch/test-runner/test-runner.md), including the proof review at `3bdfa431`. It groups implementation and validation into three reviewable slices. The supervisor coordinates independent review; Josh reviews the specs on the pull request.

## Why three slices

Selection and retries share the actual one-file boundary. Mutex ownership crosses CLI execution, verify orchestration, and process cleanup. Native admission crosses separately wired configs and launchers, and must agree with the instruction layer. Each group has enough distinct behavior and evidence to warrant its own review under [Planning and slices](../../specs/spec-workflow.md#planning-and-slices). The integrated review then checks their interactions.

The order establishes command admission before attaching process ownership, then enables native refusals once canonical execution is complete. Host health remains the primary outcome throughout; targeted Blaxel fan-out is outside this contribution.

## Implementation boundaries

The existing code offers the necessary seams, with a few consequential gaps:

- `scripts/test/cli.mjs` resolves surface ownership before running local or remote work. `file-inventory.mjs` can read a selected Git tree, but its working-tree inventory currently omits untracked files. Reuse these boundaries for one shared file-resolution result consumed by local admission, retry admission, and exact native selection.
- Local and targeted commands currently forward native file filters, which can widen. Planned workers already have exact-file adapters. Reuse that machinery where it fits and cross each distinct local and targeted handoff with the proof's real native tests.
- Verify currently runs phases with `spawnSync` and direct local paths call `process.exit`. Mutex ownership must surround those paths through cleanup. Keep phase order, exit propagation, reporting, and attestation behavior intact while making ownership release explicit. The direct verify test child needs a deliberate ownership handoff; a generally inherited exemption is insufficient.
- Planned Blaxel forwarding currently omits a zero retry budget. Pass the resolved numeric budget explicitly through the existing adapters. Attestation fact construction must also see the standalone broad zero-retry override.
- Registered configs include `staging/vitest.config.ts`, outside the usual discovery roots. Use the registry to cover entrypoints. Native context is `TV_TEST_RUNNER_CONTEXT=1`; the non-plan shard path needs it without acquiring new lifecycle responsibilities.

Keep the implementation within these modules and their callers. The mutex uses existing process identity and stale-owner cleanup, a stable same-user location and compatible record, and atomic acquisition. It needs no expiry, background service, waiter queue, resource monitor, or authentication scheme. Exact record fields and internal helper boundaries can be settled while implementing the proof-derived tests.

If implementation requires a changed promise, including registry wording for additional fixture surfaces, return it through spec review and proof derivation before dependent work; Josh's human spec review remains due on the pull request.

## Slice 1 — file admission and retry policy

Implement marked-host one-file admission, exact native file selection on local and targeted remote paths, actionable redirection, the broad-local flag rename, and selection-dependent zero retries. Resolve local files from the current working tree, including untracked files; resolve remote files and ownership from the selected committed tree. Preserve unmarked local breadth, placement restrictions, and the independent full-`all` shortcut guardrail.

Keep parsing, verify phase forwarding, native retry arguments, remote numeric budgets, and attestation eligibility in this slice. Update CLI help for the behavior delivered here. Reuse one command-admission path for direct tests and verify where their semantics agree, without broadening unrelated argument parsing.

**Red/green and evidence.** First select the repository's `.nvmrc` runtime and supported npm, then install this worktree's missing dependencies with `npm ci`. Start with failing CLI assertions in `test/repo/test-runner-guardrails.test.ts` and focused file-resolution/native-selection tests. Prove real Vitest and Playwright collection and retry attempts with small authored fixtures; extend the worker and attestation tests at their existing seams. The obligations are [file selection and guidance](../../proofs/arch/test-runner/test-runner.md#file-selection-and-guidance-at-the-command-boundary), [retry selection and execution](../../proofs/arch/test-runner/test-runner.md#retry-selection-and-execution), and [retry eligibility facts](../../proofs/arch/test-runner/attestation.md#^attest-retry-options), plus [marked verify refusal](../../proofs/arch/test-runner/test-runner.md#^t-marked-verify-refusal), [explicit local verify](../../proofs/arch/test-runner/test-runner.md#^t-marked-local-verify), and [host-marker behavior](../../proofs/arch/test-runner/test-runner.md#^t-blaxel-host-marker). Shared help and override-independence assertions cover the implemented options now and are completed by slices 2 and 3; their proof markers stay until slice 3 completes each whole assertion.

After focused red/green work, commit and push, then run the affected repository-test surface on Blaxel. Record targeted and planned remote zero-retry evidence using small non-unit native fixtures, including the adversarial sibling on the targeted path. These runs establish file/retry behavior here; native-context evidence is completed after slice 3.

**Expected baseline.** All tests introduced or changed in this slice pass; update existing expectations for the renamed flag rather than carrying failures forward. The mutex/wait and native refusal obligations remain unimplemented, explicitly assigned to slices 2 and 3. Full instruction-layer updates remain assigned to slice 3. No known failing-test baseline is planned.

## Slice 2 — mutex ownership, waiting, and recovery

Implement the stable same-user mutex, the gated private-location hook, immediate refusal, opt-in wait, and independent contention bypass. Perform usage, selection, and placement checks before waiting. Dry-run reports the same resolved lock path supplied to real acquisition without taking the production lock.

Integrate ownership into direct local execution and the whole local verify. Keep the direct test-phase child protected if its verify parent exits; unrelated and arbitrarily nested commands still contend. Release follows test-process exit and cleanup. Reuse identity checks and stale-owner recovery, preserving cleanup-then-failure when stale test processes are found. Adapt every existing nested CLI test that executes work, including reporting, toolchain, and lifecycle cases, to a private lock path in this same slice.

**Red/green and evidence.** Derive the ordinary mutex tests from [Local mutex](../../proofs/arch/test-runner/test-runner.md#local-mutex). Organize direct-run and verify ownership tests into independently runnable files, using small temporary checkouts and cooperative native fixtures. Include routine dead-owner recovery, real acquisition races, cancellation statuses, bypass independence, service teardown, and the preflight-bounded remote exemption. Update CLI help and complete the mutex portion of the shared assertions. Run the edited file locally; after pushing, run the affected repository-test surface on Blaxel to check isolation under an outer worker.

Add the interruption, surviving-child, orphan, and stale-cleanup cases only to the existing isolated lifecycle surface. At the start of slice 2, prepare the exact branch-only `Process Lifecycle Fault Injection` workflow with its cleanup, timeout, and artifact configuration, and send that concrete proposal to the supervisor for any still-needed operator authorization while implementation proceeds. Validate the cases through that authorized workflow before declaring this slice complete; do not run them on this host or Blaxel. The contribution must not retain that workflow. Record which operating-system backend actually ran. If only this authorization or run remains pending after the ordinary mutex checks pass, independent slice 3 work may proceed while slice 2 stays open; both slices must converge before integrated review.

**Expected baseline.** Slice 1 remains green, all ordinary mutex tests pass, and the isolated evidence covers the destructive cases. No failing-test baseline is carried into slice 3. Native entrypoint refusal and the final guidance remain outstanding; no mutex guarantee is deferred to final integration.

## Slice 3 — native entrypoints and reachable guidance

Add the shared native check to every registered Vitest and Playwright config, before service-dependent setup can mask its diagnostic. Wire context through local, planned, targeted supervised, and non-plan diagnostic launchers. Preserve declared native fixtures and the deliberate exact-value direct-native override. Complete the help and independent-option assertions.

Update `AGENTS.md` and affected invocation guidance from the converged specs. The entry instructions must state focused local iteration, the same-user mutex and wait, shared-host risk, independent overrides, broader Blaxel validation after committing and pushing, and the narrow/broad retry distinction. Carry regular safe development-branch commits and pushes into the repository sources of `tvdev-contribute` and `tvdev-review`, including the coordinator constraint. Edit those sources as contribution content; do not adopt the principal-agent skill. Preserve the testing policy's current broad-local permission rule and the current `--force` and `--ignore-uncommitted` names unless the supervisor relays a further Josh decision.

**Red/green and evidence.** Implement [Native entrypoints](../../proofs/arch/test-runner/test-runner.md#native-entrypoints) in a dedicated, independently runnable test file. Measure the real config-loading sweep; cover marker-specific message variants once per native tool. Launcher tests remove inherited context before exercising the production launcher. Use real small native fixtures for override and context admission. Review written guidance under the [testing-policy proof](../../proofs/arch/testing-policy.md), including desktop/macOS and local-only suite commands. Regenerate indexes and run the relevant documentation checks through the prescribed test route.

After committing and pushing, validate the affected repository tests remotely and complete the live targeted/planned handoff evidence with guarded configs. The integrated full Blaxel verify supplies planned-worker context evidence; it is not an extra special-purpose run.

**Expected baseline.** Every implemented test passes and every new committed-test obligation has its evidence citation. All functionality and guidance are present. Integrated full verification and final review remain the completion gate below, with no accepted failing-test baseline.

## Test execution and fixture safety

For each behavior, write its proof-derived test, observe the intended failure, implement, and rerun that focused check. An import or setup failure alone does not establish the red behavior. Locally run only the one test file just edited, optionally narrowed with grep; do not serially loop over files for a known multi-file check. Use the default retry budget for validation, with plain `--retries 0` only for a deliberate focused check. Push safe, coherent development checkpoints before broader remote validation.

A refusal test must remain bounded if the refusal is missing, during red/green work or a later regression: the native sweep uses a files-only listing or verified no-match file filter that loads the real config without executing tests, and other refusal cases use dry-run or small authored fixtures so none can start broad work.

Nested canonical fixture launchers supply separate private lock paths per independent scenario and share a path only for deliberate contenders. Production-location checks remain read-only. Readiness and explicit release coordinate the small competing processes; no workload stresses the host. Tests own and clean up their fixtures even after failed assertions. Verify uses an authored small registry and substituted downstream phase programs, never the real repository's full gate inside a test. These limits apply under local, Blaxel, and GitHub outer runners.

Reuse committed native fixture inputs for local seams and live remote checks. Where canonical live dispatch needs registry entries, use small opt-in non-unit fixture surfaces excluded from `all`; they test native attempts and collection and never dispatch Blaxel themselves. Keep intentional fail-first behavior distinguishable from product failures in the validation record. Destructive lifecycle fixtures retain their isolated-only placement and cannot be repurposed for these remote checks.

At each slice handoff, report the pushed revision, relevant red/green evidence, remote checks, recovered flakes, and remaining obligations. Replace proof test markers with honest citations as coverage lands. Keep commands, tested revisions, outcomes, and retained live report locations in the contribution's validation record; standing proofs describe which live evidence is required.

## Integrated result and pull request

After all three slice reviews converge, review the complete interaction of selection, retries, native context, mutex ownership, reporting, and guidance. Resolve all outstanding proof obligations and any failures discovered by wider validation. Report Linux and macOS evidence separately; Linux process tests alone do not establish the macOS backend.

Before final full validation, update this development branch to contain the current target history under the repository's logical-merging guidance, reconcile changed policies, and push the resulting tree. Run `npm run verify -- blaxel` on that revision with the default retries and await the complete result. Retain the targeted/planned live evidence and isolated lifecycle reports alongside that full-gate result. Changes after validation require checks appropriate to the changed tree; no earlier run is represented as validation of a later revision.

Converge the integrated review through the supervisor. Prepare the draft pull request for Josh's spec review, with its description written under [developer-skills/pr-writing](../../developer-skills/pr-writing/SKILL.md). Keep working documents while the PR is a draft; perform [pre-merge docs prep](../../specs/spec-docs.md#^pre-pr-docs-prep) before treating the completed contribution as ready to merge. This task ends with the contribution ready for Josh's review, without merging it.

The draft-PR handoff must list production GitHub CI as outstanding until the PR is marked ready: its unit job exercises the production local mutex around the nested tests, and its desktop job exercises canonical local execution through the Electron wrapper. Blaxel validation does not establish those CI handoffs. Required GitHub checks must pass before merge under the shared-branch workflow.
