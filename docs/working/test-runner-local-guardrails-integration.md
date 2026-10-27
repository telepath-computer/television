# Main integration

The integration starts from branch `0cb92bda` and main `a8e73fbf`, with merge base `3919459f`. Both commit lists and main's first-parent commit descriptions were read in full. This record accompanies the integrated review; it does not replace the governing specs.

## Policies to reconcile

The contribution makes the canonical runner the guided entrypoint for every registered test config. Local runs coordinate through one same-user mutex across checkouts; marked hosts admit one explicit file unless deliberately overridden. Exact file selection and retry admission use the same working-tree or selected-commit inventory. All native launchers supply context, nested runner tests own private locks, and destructive lifecycle cases retain their isolated placement. Instructions reached from AGENTS.md explain these choices and regular safe development-branch pushes.

Main preserves those domains but changes their surroundings:

- The foundation tests move from `staging/test` to `frames/lib`, with surface `unit:frames`; skillbench and its surface/config/cache outputs are deleted. The native guard must follow the foundation config, and active guardrail assertions must use the new surface. Registry-based enumeration must cover the resulting set without restoring deleted tooling.
- Blaxel selects the invoking checkout's GitHub `origin`, strips embedded credentials, and reuses one worker checkout and dependency cache across repositories. Keep that selection and shell-script extraction alongside this branch's exact targeted file handoff and explicit retry budgets. Repository switching is unchanged by this integration.
- Registry Vite services strip conditional request headers and return complete bodies, avoiding Chromium's retained 304-response buffers. Preserve the service seam, proof, and tests alongside native admission and lifecycle cleanup.
- Spec policy now centers on what derivation cannot reliably infer; human review mechanics move to the workflow, and testing guidance carries only additional knowledge. Retain that authority and review structure while carrying the branch's explicit push and test guidance. Review affected specs for old anchors and needless duplication.
- Product work adds resource stores and sharing, artifact isolation, CLI arrangement/moves, desktop connection handling, and UI/Markdown fixes. Preserve those implementations, contracts, new tests, Firefox coverage, and `tv serve --print-links` recipe. Their existing registered surfaces inherit the native check and canonical launch context.

## Review refinements

Slice 3's first review passed. Keep the AGENTS.md mutex orientation for Josh's PR review: it states the specific guidance he requested. Do not optimize the bounded native sweep during integration; its measured cost is known and the review explicitly judges optimization unnecessary now.

## Audit and validation

The registry audit resolves 36 distinct native configs, with no registry errors and no missing first-line native guard. The rename carries the guard into `frames/vitest.config.ts`; skillbench stays deleted. Both stale `unit:staging` assertions now select `unit:frames`. Main added no other registered native entrypoint. Existing local, planned, targeted and diagnostic launch sites still set context; the Electron wrapper inherits it. Searches of the full tree found no new canonical subprocess caller needing a private mutex hook.

The coordinator retains main's repository selection, checkout/dependency scripts and credential handling alongside the branch's target adapter and numeric retry forwarding. No repository-switching mechanism changed. PR #32's Vite listener, conditional-request fixture and proof remain intact. Main's resource/isolation/layout/desktop test additions remain on their existing registered surfaces, including the new Firefox project and node Firefox preflight. Product implementations and contracts outside runner/guidance domains retain main's changes.

The conflicting Blaxel setup paragraph combines multi-repository token access with the marker's one-file local effect. The daemon proof retains main's six assertions and the branch's one-file command. The runner proof now includes main's `--print-links` recipe. Two local-only test-file instructions also use one-file commands. Generated spec/proof indexes come from the merged tree.

The revised spec policy and workflow review mechanics remain intact, including relocated ownership anchors. The contribution's touched runner, Blaxel, preflight and attestation testing sections use `Testing guidance`, with their incoming links updated. Two runner paragraphs that merely repeated the testing policy's acceptance and real-process obligations were removed; their proof assertions and tests remain. Specific CLI, config-loading and service-handoff guidance remains. The development-branch and coordinator instructions compose with main's human review section without changing review timing.

`npm ci --prefer-offline --no-audit --fund=false` completed using Node 24.21.0 and the updated manifests. The edited guardrail file passed locally in 26.4 seconds with default retries, run `2026-10-27T13-14-58-706Z-p1229209-r186832249237bcae`. This is a rename reconciliation, not a new red/green behavior claim. A one-off ESLint `no-undef` check with Node globals passed for all 15 changed runner JavaScript modules; it closes the earlier lint concern without adding lint machinery. `git diff --check` passed. The full gate follows on the committed, pushed tree; no earlier run is represented as its result.

Primitive's edit hook reported truncated governing-decision retrieval. That is unknown graph coverage, not an all-clear. This merge follows existing repository policies and Josh's reviewed decisions, so it introduces no new durable fork to record.
