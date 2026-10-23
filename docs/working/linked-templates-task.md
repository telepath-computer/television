# Linked templates and Toolbox: task record

Working record for `feat/toolbox`, branched from `feat/artifact-templates` at `54cd365`. The pull request targets `feat/artifact-templates`. The intent is in the updated [templates proposal](templates-proposal.md); the authority is the specs it was drafted into, with the Toolbox specified as `specs/ui/app/toolbox.mdx` and its stories in `storybook/spec/toolbox/`.

## Settled

- Rupert set every decision in this change in conversation on October 22, 2026: linked by default with `--copy`, detach by copying and repointing, URL templates, no starting data in templates, manifest `dataSchema`, flat `list` and `show` output, the server-side cache with pushes to the app, manifest `icons` with agent-fetched site icons and letter defaults, the Toolbox name and design, ⌘K, and the minimum-version rule for bundled templates.
- Rupert read the spec draft and approved it on October 22, 2026. The later rounds (flat types, cache, ⌘K, adopting the new `spec-ui.md` and the reference repairs it needed, and the review refinements) were his decisions but their wording still needs his read in the pull request.
- Only `specs/spec-ui.md` was brought over from the Checklist branch's policy changes, by Rupert's instruction.
- Reviews use a fresh `codex exec` process with GPT-6 Astra at `xhigh`. The spec drafter was also GPT-6 Astra, so the reviewer is not from a different provider than the author; Rupert's standing rule is to delegate through Codex.
- MDX entries in the generated spec index need a change to `scripts/specs-index.mjs`; that is implementation work.
- The Checklist and Calendar template branches need linking changes after this merges; raise with Rupert then.

## Stages

| Stage | Status |
|---|---|
| Spec convergence | Done: round 1 PASS, three refinements applied, follow-up round 2 PASS with no new findings; committed at `bf195c7` |
| Proof derivation | Complete for all 26 affected product, architecture and UI specs at `bf195c7`; 61 assertions remain `(test to be written)`; no ambiguous expected results found |
| Proof convergence | Done: round 1 FAIL, round 2 FAIL, round 3 PASS with one generated-count fix applied |
| Plan | Done: four slices; plan review round 1 PASS with no findings |
| Implementation, red/green TDD | All four planned slices committed through `10a8f3a`. The Toolbox layout and blank-store guidance follow-up is implemented and validated, with scoped independent review passing; it remains uncommitted. See the final validation entry below. |
| Integrated result and full verification | Slice checks complete; independent integrated review and full verification pending with the supervisor |
| Pull request | Not opened |

## Open obligations

- Supervisor review of slice 4 and the integrated contribution after slice validation.
- The pre-existing theme request race is documented below with evidence at `d17b041`; it is outside this slice.
- The full browser run recorded an intermittent tab-drag timing failure; its unchanged-tree isolated run passed. Details are in the review-corrections entry.
- Full verification belongs to the supervisor on the committed, pushed tree.
- Pre-merge docs prep before the work is treated as ready to merge.

## Validation

Proof derivation only, against approved spec commit `bf195c7d135a45b396465ac96572824c2423b526` and its diff from `54cd365`, with the resulting proofs uncommitted:

- Updated every affected product/architecture/UI proof and created `proofs/ui/app/toolbox.md` for the MDX spec. Root governance documents, generated indexes and story/frame assets receive no separate proof under the proof-location policy. Reference-only spec edits retain their existing behavior evidence and name the correct coverage owner.
- Re-derived linking, explicit copying, URL creation, caller data/schema checks, watched discovery, icons, Toolbox behavior/conformance, installation recovery and authoring guidance. Retired automatic-copy, template-seed, thumbnail-grid and scan-on-every-opening promises. Existing test citations retain their grade only for the stated surviving claim. The old thumbnail route citation has an explicit retirement note; its test still needs replacement or retirement during implementation.
- 61 assertions are marked `(test to be written)`: isolation 1; reload/navigation 1; CLI architecture 2; onboarding installer 2; template authoring 2; bundled installation 3; bundled Example 2; template architecture 20; product CLI 4; product resources 1; product telemetry 1; product templates 11; Toolbox 11. Several assertions share a test journey or table; this is not a count of required test files or runs.
- No spec ambiguity required withholding an assertion. Proof review round 1 returned FAIL; all three findings were verified against the specs and cited tests and remediated: declared the Electron setup substitution and its desktop connection coverage, classified uncertain-save failure as Acceptance, and marked folder-error ordering across multiple invalid folders `(test to be written)`. Round 2 returned FAIL; both findings were verified and remediated: added real-browser directory-read failure acceptance through the server/client caches, marked `(test to be written)`, and corrected three authoring assertions to reference the declared `TV_SKILLS_DIST_DIR` hook. Independent re-review is pending.
- Regenerated `proofs/index.md` with `scripts/specs-index.mjs` through its exported `generateIndexes` function and a temporary root exposing only the proofs tree: 125 proofs, including Toolbox. This avoided rewriting the spec index; the generator's separate MDX-spec-index limitation remains implementation work.
- `git diff --check` passed. A read-only, MDX-aware audit passed for all 26 spec/proof mappings, changed-proof relative links and block references, and definition uniqueness across the `.md`/`.mdx` spec/proof trees.
- Initial proof-derivation run of `npm test -- local --file test/repo/spec-links.test.ts`: 6 passed, 2 failed, no recovered flakes. The two failures are the existing mirror checks, which assume a proof `.md` must point to a spec `.md` and therefore reject the policy-required `toolbox.md` / `toolbox.mdx` pair. File links, block references, unique anchors, test-code citations and the other governance checks pass. Final report: `.test-runs/2026-10-22T22-18-39-749Z-p2870000-re5c111829e90c83b/summary.json`. An initial sandbox run stopped at the npm subprocess probe with `EPERM`; the completed runs used the same targeted command outside the sandbox.
- Round 1 remediation checks passed: `git diff --check`, all 71 relative links and block references in the two remediated proofs, and the pending-assertion counts (60 total; 20 in template architecture). The targeted repository test was not rerun for these proof-text corrections; its recorded MDX mirror failures remain open.
- Round 2 remediation checks passed: `git diff --check`, all 39 relative links and block references in the two remediated proofs, cited test names and hook usage, and the pending-assertion counts (61 total; 11 in Toolbox). No behavioral tests were run; the new acceptance obligation remains unwritten.
- Specs, tests and implementation files were left unchanged. Full verification and behavioral tests were not run for this proof-only stage. No commit or push was made.

### Slice 1 implementation — October 22–23, 2026

This checkpoint records the original implementation and validation. The Ajv-only rework below supersedes its validator, schema-test inventory, dependency inventory and review result.

Work is based on `fd654fd5743cdd60895b4292364ab387931881db` on `feat/toolbox`. Every command below ran in this worktree against its uncommitted tree at the stated stage. The canonical runner records dirty HEAD tree `7b4381aefa4afb5dc4d0efa3a4db072ac5d285ec`; that is not a snapshot of the edits. The final changed source/test/proof/config file set, excluding this record, is SHA-256 `e0a730561894bc7c35dfa4ecd39a7073e04c95a89a1bf7e49ca86865f7c39746` (per-file manifest in ignored `scratch/linked-templates-slice1-tree.json`). Intermediate dirty snapshots were not retained; the timestamped reports identify their selections and results.

Implemented flat records, fresh CLI list/show projections, default linked and explicit copied folder creation, URL creation, caller-only data with local Draft 2020-12 schema validation, and the schema-driven Example with no starting-data file. Display, placement, durable writes, failure retention, exact IDs and paths, and telemetry privacy remain covered. Ajv checks the official metaschema synchronously during package discovery; Hyperjump evaluates caller data without external resource retrieval or data mutation. The reference/projection adapter preserves annotation and literal values and resolves schema-local resources, pointers and dynamic anchors.

Added scanner/schema/preflight and creation tables, CLI contracts and real CLI journeys, package assertions and two browser journeys. The new linked journey proves shared files, separate stores, copy independence, live edits, disappearance/restoration and ordinary path-update detachment. Replaced automatic-copy and template-seed assertions assigned to this slice; slug/collision and copied-symlink cases explicitly request copying, and store-failure cases supply caller data. Old icon/thumbnail, Toolbox, installer-recovery and delivered-guidance tests remain assigned to later slices.

Thirty proof placeholders now cite actual tests: template architecture 12, CLI architecture 2, product templates 8, product CLI 4, resources 1, telemetry 1 and bundled Example 2. Retained no-display and template-path citations were updated to the surviving test names. Thirty-one later-slice placeholders remain. No specs or Storybook spec assets changed, and no spec/proof ambiguity required a decision.

Independent review through GPT-6 Astra at `xhigh` (thread `01a165e4-fd41-7200-91c0-659121f94ea3`) found implementation defects in referenced annotation schemas, exact folder paths ending in whitespace, overlapping reference targets, forward anchors, late resource scopes and provisional duplicate-anchor checks and references followed before their containing scope settles and a retained child missing from the evaluator projection. Each behavioral defect received a failing regression and fix. The final reachability repair also received a bounded-process regression for resource-scope oscillation; retaining discovered containing resources for live descendants fixed it without an iteration cap. Projection now follows every surviving schema node, removing the separate first-discovery classification that caused the retained-child defect. The review also corrected the quoted inspection hint for IDs starting with a dash and the Example README focus directive. Review rounds 1–5 returned FAIL on the defects above; round 6 returned PASS with no remaining actionable slice 1 findings or separate complexity finding. Its read-only probes covered the repaired projection, overlapping references, opaque literals, late scopes, duplicate rejection and termination. Review artifacts are under ignored `scratch/codex/slice1-review/`. Final owning-suite results are recorded below.

Canonical runs (UTC; `F` is the failed test count) follow. Each timestamp identifies `.test-runs/<timestamp>-*/summary.json`; native reports contain case-level results. Every run recorded **zero recovered flakes and zero process leaks**. The repeated `--file` invocation at 23:49:35 selected only the last file; the Example journey was therefore run separately at 23:50:59.

| UTC | Exact command | Result |
|---|---|---|
| 2026-10-22 23:06:08 | `npm test -- local --file packages/cli/test/cli.test.ts --grep 'artifact template CLI commands'` | failed; F=6 |
| 2026-10-22 23:06:31 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'declares the sole Example'` | failed; F=1 |
| 2026-10-22 23:06:40 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | failed; F=21 |
| 2026-10-22 23:06:44 | `npm test -- local --file packages/cli/test/cli.test.ts --grep 'artifact template CLI commands'` | passed; F=0 |
| 2026-10-22 23:07:04 | `npm test -- local --file packages/web/test/e2e/template-example-real-stack.test.ts` | failed; F=1 |
| 2026-10-22 23:08:09 | `npm test -- local --file test/node/cli-assets.test.ts --grep 'ships the complete bundled Example'` | failed; F=1 |
| 2026-10-22 23:08:12 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | passed; F=0 |
| 2026-10-22 23:09:07 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'declares the sole Example'` | passed; F=0 |
| 2026-10-22 23:09:13 | `npm test -- local --file packages/server/test/templates-create.test.ts` | failed; F=6 |
| 2026-10-22 23:09:33 | `npm test -- local --file packages/cli/test/cli.test.ts` | passed; F=0 |
| 2026-10-22 23:09:40 | `npm test -- local --file test/node/cli-assets.test.ts --grep 'ships the complete bundled Example'` | passed; F=0 |
| 2026-10-22 23:09:41 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts` | passed; F=0 |
| 2026-10-22 23:10:02 | `npm test -- local --file packages/server/test/templates-create.test.ts` | failed; F=9 |
| 2026-10-22 23:10:41 | `npm test -- local --file packages/server/test/templates-failures.test.ts` | passed; F=0 |
| 2026-10-22 23:10:51 | `npm test -- local --file packages/server/test/templates-create.test.ts` | failed; F=1 |
| 2026-10-22 23:11:15 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'template\|creation output'` | passed; F=0 |
| 2026-10-22 23:11:45 | `npm test -- local --file packages/server/test/templates-create.test.ts --grep 'validates caller data'` | passed; F=0 |
| 2026-10-22 23:11:59 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-22 23:12:00 | `npm test -- local --file packages/server/test/templates-routes.test.ts` | passed; F=0 |
| 2026-10-22 23:12:03 | `npm test -- local --file packages/cli/test/cli.test.ts --grep 'requires --port under config port 0'` | passed; F=0 |
| 2026-10-22 23:12:27 | `npm test -- local --file packages/server/test/templates-create.test.ts` | passed; F=0 |
| 2026-10-22 23:12:40 | `npm test -- local --file packages/web/test/e2e/linked-templates-real-stack.test.ts` | failed; F=1 |
| 2026-10-22 23:13:10 | `npm test -- local --surface unit:cli` | passed; F=0 |
| 2026-10-22 23:13:20 | `npm test -- local --surface unit:server` | passed; F=0 |
| 2026-10-22 23:14:15 | `npm test -- local --file packages/web/test/e2e/template-example-real-stack.test.ts` | passed; F=0 |
| 2026-10-22 23:15:27 | `npm test -- local --file test/node/cli-assets.test.ts` | passed; F=0 |
| 2026-10-22 23:16:46 | `npm test -- local --file packages/server/test/templates-scanner.test.ts --grep self-contained` | failed; F=2 |
| 2026-10-22 23:17:01 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'caller\|piped'` | failed; F=1 |
| 2026-10-22 23:18:02 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | passed; F=0 |
| 2026-10-22 23:18:03 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-22 23:18:46 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'validates caller data'` | passed; F=0 |
| 2026-10-22 23:18:54 | `npm test -- local --file packages/server/test/templates-scanner.test.ts --grep 'escaping schema'` | failed; F=1 |
| 2026-10-22 23:19:11 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | passed; F=0 |
| 2026-10-22 23:19:12 | `npm test -- local --surface unit:shared` | passed; F=0 |
| 2026-10-22 23:19:28 | `npm test -- local --file packages/web/test/e2e/linked-templates-real-stack.test.ts` | passed; F=0 |
| 2026-10-22 23:20:20 | `npm test -- local --file test/node/cli-acceptance.test.ts` | passed; F=0 |
| 2026-10-22 23:20:25 | `npm test -- local --file test/repo/spec-links.test.ts` | failed; F=2 |
| 2026-10-22 23:21:14 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | failed; F=3 |
| 2026-10-22 23:24:42 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | failed; F=1 |
| 2026-10-22 23:24:44 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | failed; F=1 |
| 2026-10-22 23:32:48 | `npm test -- local --file packages/server/test/templates-create.test.ts --grep 'exact installed folder'` | failed; F=0; module-load failure, no tests executed |
| 2026-10-22 23:34:34 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | failed; F=0; module-load failure, no tests executed |
| 2026-10-22 23:36:10 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | failed; F=15 |
| 2026-10-22 23:36:28 | `npm test -- local --file packages/server/test/templates-create.test.ts --grep 'exact installed folder'` | failed; F=3 |
| 2026-10-22 23:36:45 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | failed; F=2 |
| 2026-10-22 23:36:56 | `npm test -- local --file packages/server/test/templates-create.test.ts --grep 'exact installed folder'` | passed; F=0 |
| 2026-10-22 23:37:40 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-22 23:38:19 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | passed; F=0 |
| 2026-10-22 23:38:19 | `npm test -- local --file packages/server/test/templates-create.test.ts` | passed; F=0 |
| 2026-10-22 23:38:19 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'template\|caller\|piped\|creation output'` | passed; F=0 |
| 2026-10-22 23:39:02 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'evaluates activated'` | failed; F=1 |
| 2026-10-22 23:40:04 | `npm test -- local --file test/node/cli-assets.test.ts` | passed; F=0 |
| 2026-10-22 23:40:14 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-22 23:41:02 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-22 23:41:28 | `npm test -- local --surface unit:server` | passed; F=0 |
| 2026-10-22 23:42:25 | `npm test -- local --file test/node/cli-acceptance.test.ts` | passed; F=0 |
| 2026-10-22 23:45:37 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'overlapping activated'` | failed; F=1 |
| 2026-10-22 23:46:27 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'overlapping activated'` | passed; F=0 |
| 2026-10-22 23:46:52 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'discovers activated anchors'` | failed; F=1 |
| 2026-10-22 23:47:43 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'discovers activated anchors'` | passed; F=0 |
| 2026-10-22 23:48:01 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'resource identifier when'` | failed; F=1 |
| 2026-10-22 23:48:49 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'resource identifier when'` | passed; F=0 |
| 2026-10-22 23:49:05 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-22 23:49:35 | `npm test -- local --file packages/web/test/e2e/template-example-real-stack.test.ts --file packages/web/test/e2e/linked-templates-real-stack.test.ts` | passed; F=0; runner selected only the last file (linked journey) |
| 2026-10-22 23:49:35 | `npm test -- local --surface unit:server` | passed; F=0 |
| 2026-10-22 23:50:41 | `npm test -- local --file test/repo/spec-links.test.ts` | failed; F=2 |
| 2026-10-22 23:50:59 | `npm test -- local --file packages/web/test/e2e/template-example-real-stack.test.ts` | passed; F=0 |
| 2026-10-22 23:54:38 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'settles.*resource'` | failed; F=2 |
| 2026-10-22 23:55:20 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'settles.*resource'` | passed; F=0 |
| 2026-10-22 23:55:46 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-23 00:05:17 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'settles reachable reference targets'` | failed; F=5 |
| 2026-10-23 00:06:42 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'settles reachable reference targets'` | passed; F=0 |
| 2026-10-23 00:07:05 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-23 00:09:03 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'retains containing resource scopes'` | failed; F=1 |
| 2026-10-23 00:09:35 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'retains containing resource scopes'` | passed; F=0 |
| 2026-10-23 00:09:45 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-23 00:13:14 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'projects a referenced structural child'` | failed; F=1 |
| 2026-10-23 00:13:39 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'projects a referenced structural child'` | passed; F=0 |
| 2026-10-23 00:13:47 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | passed; F=0 |
| 2026-10-23 00:15:02 | `npm test -- local --surface unit:server` | passed; F=0 |
| 2026-10-23 00:15:02 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'validates caller data'` | passed; F=0 |

Initial red runs exposed the missing flat/schema/URL/CLI/Example behavior and retired copy/seed assumptions. Intermediate creation failures exposed a channel-map typo and the default HTTP parser's 100 KB limit; both were fixed. Browser assertion repairs used the actual unwritten-store response and absent store pointer. The CLI hint test stopped pinning incidental quote formatting while retaining the exact ID and required-field checks.

Schema regression reds exposed relative IDs, absolute dynamic references, extension-keyword behavior, annotation targets, nested literal references, overlapping activated roots, forward anchors and late resource scopes. The abandoned validator integrations were removed. Hyperjump integration failures at 23:36:10 and 23:36:45 came from the instance adapter and false-schema diagnostic, respectively; both were repaired. The whitespace regression was accidentally inserted three times for its first behavioral red; the duplicates were removed, leaving one passing regression. The two module-load failures at 23:32:48 and 23:34:34 occurred during dependency replacement and are not behavioral red evidence.

The host ran out of space during the diagnostic `npm install --no-save --package-lock=false json-schema-library@11.6.14`; it failed with `ENOSPC`. The interrupted test-file write was fully restored. Verified ignored `storybook/dist` and `packages/desktop/dist` inside this worktree and ten inactive CLI runtime directories created by this task under `/tmp` were removed to recover space. The external npm cache was left untouched; validation resumed using the recovered task-owned space. Final manifests contain only the intended explicit Ajv/Hyperjump dependencies.

Additional validation: `npm run type-check --workspace @telepath-computer/television-server` passed during implementation and after the last schema fix. Initial whole-repo `npm run type-check` failures identified the result union, test path narrowing and missing `watching` fixtures; a later failure identified a schema test-table inference issue. All were repaired. `npm run type-check && npm run lint:package-manifests && git ls-files -m -o --exclude-standard -- '*.ts' | xargs npx eslint --max-warnings=0` passed before the final scope fix and passed again on the final source tree; the closing results are recorded below. `git diff --check` passed. Read-only in-memory Node/tsx probes and independent-review probes supplied the reproducers subsequently captured in tests.

The `spec-links` runs retain the plan's exact expected baseline: six pass and two fail, “the proof tree mirrors every proof-bearing spec and has no orphan” and “every proof declares its exact mirrored spec.” MDX mirroring belongs to slice 3; file links, anchors and test-code citations pass. The server suite's single existing skip is the privileged-port permission test because this host cannot stage EACCES/EPERM. Browser journeys ran in Chromium; the runner reported Firefox unavailable.

Expected remaining baseline: icon selection, watched discovery, authenticated icons and cache work in slice 2; Toolbox, old UI expectations, MDX and theming-reference work in slice 3; installer recovery and delivered guidance in slice 4. No completion or full-suite result is claimed for those areas. Full `npm run verify`, commit, push, CLI install/link and host-home server execution were not performed. Working documents remain because the contribution still has three implementation slices.


Closing validation, October 23 at 00:18 UTC: **slice 1 complete**. Independent review round 6 passed. Final source/test/proof/config digest remains `e0a730561894bc7c35dfa4ecd39a7073e04c95a89a1bf7e49ca86865f7c39746`; only this task record changed after the closing checks.

| Validation | Result and tested stage |
|---|---|
| `npm test -- local --file packages/server/test/templates-schema.test.ts` | Final source: 55 passed at 00:13:47. |
| `npm test -- local --surface unit:server` | Final source: 1,166 passed, 1 existing host-dependent skip at 00:15:02; report `.test-runs/2026-10-23T00-15-02-052Z-p3522288-r6ff689f8eff4cc24/summary.json`. |
| `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'validates caller data'` | Final source, fresh packaged build: 1 passed, 45 excluded by selection at 00:15:02; report `.test-runs/2026-10-23T00-15-02-074Z-p3522289-ra471db7410fad5f1/summary.json`. |
| `npm run type-check && npm run lint:package-manifests && git ls-files -m -o --exclude-standard -- '*.ts' \| xargs npx eslint --max-warnings=0` | Final source: passed at 00:15–00:16. Manifest lint covered 15 root/workspace manifests and the publishable package. |
| `git diff --check` | Passed after the final task-record edit. |
| `npm test -- local --surface unit:cli` | 313 passed during implementation. CLI source was unchanged by the later schema fixes. |
| `npm test -- local --surface unit:shared` | 67 passed during implementation. Shared source was unchanged by the later schema fixes. |
| `npm test -- local --file test/node/cli-acceptance.test.ts` | 46 passed at 23:42:25, before the final reference-discovery/projection refinements. |
| `npm test -- local --file test/node/cli-assets.test.ts` | 24 passed at 23:40:04; Example assets and dependency inventory were unchanged afterward. |
| `npm test -- local --file packages/web/test/e2e/linked-templates-real-stack.test.ts` | Chromium journey passed at 23:19:28 and again at 23:49:35 (the latter used the repeated-file command recorded above). |
| `npm test -- local --file packages/web/test/e2e/template-example-real-stack.test.ts` | Chromium journey passed at 23:14:15 and 23:50:59. Both browser journeys preceded the final schema-only refinements. |
| `npm test -- local --file test/repo/spec-links.test.ts` | Final proof citations: 6 passed, 2 expected MDX mirror failures at 23:50:41. Proof files were unchanged afterward. |

The final server owning suite and freshly packaged CLI schema journey validate the later schema-only refinements. All 81 canonical runs in this slice recorded zero recovered flakes, process leaks and infrastructure failures; behavioral reds and the two module-load failures are retained in the ledger. No additional baseline was introduced. The branch remains uncommitted and unpushed, with full verification reserved for the supervisor as instructed.


### Ajv-only rework — October 23, 2026

Rupert directed that schema checking use Ajv alone and remain small. He revised `specs/arch/templates/index.md#^artifact-template-schema` and the matching proof to accept Ajv's compilation/reference behavior and leave unreached references unchecked. The prior read-only probe had confirmed the old unqualified wording conflicted with that behavior; no files changed during that stopped turn. This rework uses his revised text without additional spec changes.

`template-schema.ts` is now 31 lines. A fresh `Ajv2020` compiles each template with `strict: false`, `validateFormats: false`, `allErrors: true`, and no external loader. The module checks the declared root dialect and formats validation errors with the data path or root, Ajv's reason (including missing required fields), and `tv templates show`. There is no custom reference walker or projection. Default insertion, coercion and field removal stay disabled by Ajv's defaults.

`npm uninstall -w @telepath-computer/television-server @hyperjump/browser @hyperjump/json-schema @hyperjump/uri --ignore-scripts --no-audit --no-fund --offline` succeeded, removing nine packages. The three requested dependencies and their unused transitives are absent from the server manifest and lockfile; Ajv remains the sole explicit schema dependency. Nothing else was installed.

Pruned the schema file from 55 cases to 23 focused compilation/validation cases and the scanner file to 29 cases. Removed dynamic-reference, anchor, relative-ID, overlap, activated-annotation and custom-walker regressions. Retained valid/boolean schemas, wrong dialects, invalid schemas, local and unresolved references, required/type diagnostics, format/content annotations, no default seeding, no coercion and no field removal. Added the revised unused-reference acceptance case and updated `templates-t-schema` citations. Creation, failure, CLI and Example journeys remain intact.

The first schema run produced the intended red: 20 passed and the unused unresolved reference case failed against the old walker. After replacement all 21 passed. The first scanner run had 28 pass and one diagnostic assertion fail because Ajv reported an invalid numeric ID at the schema root rather than naming `$id`; the spec permits a field or root. The assertion now checks the existing `dataSchema` root diagnostic and inspection hint; all 29 passed without adding a schema workaround.

All rework runs use the dirty worktree based on `fd654fd5743cdd60895b4292364ab387931881db`. The source/test/proof/config snapshot after the final Ajv typing corrections and validation-comment correction, excluding this task record, has SHA-256 `ddc08dccfcaabb3cfb23e059c6789d559d453369ce44c08f053f4f5bc8aa553c`; the per-file manifest is in ignored `scratch/linked-templates-ajv-only-tree.json`. The runner records the unchanged HEAD tree, not this dirty snapshot. The earlier runs preceded the final wrapper fix, as recorded below.

Independent review found one Ajv API-handling defect: native asynchronous validators return validated data on success and carry their errors in `ValidationError`. Two focused cases reproduced false being mistaken for failure and an invalid value bypassing the diagnostic formatter. The wrapper now treats fulfilled async validation as success and formats Ajv's validation errors consistently; no reference or schema traversal was added. All 23 schema cases passed after that fix. The full server, CLI acceptance, asset and static checks had already passed on the first Ajv-only tree; the updated wrapper passed the repeated checks listed below.

Independent Ajv-only review round 1 returned FAIL on the API-handling issue above; round 2 returned PASS with no remaining actionable finding. The review accepted native Ajv compilation/reference behavior and the revised spec. Artifacts: `scratch/codex/slice1-review/last-message-ajv-only.txt` and `last-message-ajv-only-2.txt`. The original Hyperjump review is historical evidence only.

Canonical rework runs are below. Times are UTC on October 23, and each timestamp identifies its `.test-runs/<timestamp>-*/summary.json`. All recorded zero recovered flakes, process leaks and infrastructure failures. Filtered cases are reported separately from the existing host-dependent server skip.

| UTC | Exact command | Result |
|---|---|---|
| 03:59:30 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | 20 passed, 1 failed |
| 04:00:52 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | 28 passed, 1 failed |
| 04:00:52 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | 21 passed, 0 failed |
| 04:02:27 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | 29 passed, 0 failed |
| 04:03:35 | `npm test -- local --file test/node/cli-acceptance.test.ts` | 46 passed, 0 failed |
| 04:03:35 | `npm test -- local --surface unit:server` | 1124 passed, 0 failed, 1 skipped |
| 04:05:59 | `npm test -- local --file test/node/cli-assets.test.ts` | 24 passed, 0 failed |
| 04:06:49 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep '\$async'` | 0 passed, 2 failed, 21 filtered |
| 04:07:33 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | 23 passed, 0 failed |
| 04:08:18 | `npm test -- local --file test/node/cli-acceptance.test.ts` | 46 passed, 0 failed |
| 04:08:18 | `npm test -- local --surface unit:server` | 1126 passed, 0 failed, 1 skipped |
| 04:11:07 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | 23 passed, 0 failed |
| 04:11:59 | `npm test -- local --file test/node/cli-assets.test.ts` | 24 passed, 0 failed |

`npm run type-check && npm run lint:package-manifests && npx eslint packages/server/src/template-schema.ts packages/server/test/templates-schema.test.ts packages/server/test/templates-scanner.test.ts --max-warnings=0` passed twice on the first Ajv-only wrapper. After the async API fix, it failed because Ajv's synchronous function type omits `$async` and `ValidationError.errors` contains partial error objects. A follow-up attempt failed because the chosen union type is not exported from `ajv/dist/2020.js`. These were corrected using the inferred validator type, a property-presence guard, and Ajv's partial error-object type. No runtime traversal or schema rules were added.

The final static command passed: `npm run type-check && npm run lint:package-manifests && npx eslint packages/server/src/template-schema.ts packages/server/src/server-store.ts packages/server/test/templates-schema.test.ts packages/server/test/templates-scanner.test.ts --max-warnings=0`. The server-store edit only corrects its comment from schema compilation to validation yielding. `git diff --check` passed after the final record edit, and a manifest/lockfile check confirmed no Hyperjump entries remain.

Closing results: schema file **23 passed**, scanner **29 passed**, server surface **1,126 passed / 1 existing privileged-port skip**, CLI acceptance **46 passed**, and CLI assets **24 passed**. The server and CLI runs at 04:08 cover the async result/error fix. The schema run at 04:11 and asset run at 04:11:59 cover the property-presence narrowing; the subsequent annotation-only import removal and comment correction were checked by the final type-check/lint. Source and test behavior were unchanged by those final type/comment edits. The validation snapshot above records the resulting uncommitted tree.

**Ajv-only rework complete.** No new spec/proof finding remains. The two recorded MDX mirror failures and other later-slice obligations retain their original assignments; the MDX checks were not rerun for this rework. No commit, push, full verification, host CLI installation or host-home server run was performed. No additional packages were installed or large ad hoc temporary directories created.

### Metaschema isolation review fix — October 23, 2026

The supervisor's independent review superseded the preceding PASS with one blocker: caller schemas could resolve references into Ajv's preloaded metaschemas, contrary to `^artifact-template-schema`. Added one row to the existing schema-rejection table for `https://json-schema.org/draft/2020-12/meta/validation#/$defs/stringArray`; it failed before the implementation change. The existing `^templates-t-schema` proof citation covers that table and remains unchanged.

Applied Rupert's specified fix: a module-level `Ajv2020` only checks `validateSchema(schema)` and supplies `errorsText()` on failure; each caller schema compiles in a fresh instance with `meta: false`, `validateSchema: false`, `strict: false`, `validateFormats: false`, `allErrors: true`, and no external loader. The module is 35 lines. No custom reference checks, dependencies or spec changes were added.

All commands below ran in `/root/workspace/dev/television/feat/toolbox` on branch `feat/toolbox`, dirty HEAD `fd654fd5743cdd60895b4292364ab387931881db` (HEAD tree `7b4381aefa4afb5dc4d0efa3a4db072ac5d285ec`). The red run used the preceding implementation plus the new test row. All subsequent checks used the final source/test tree, unchanged afterward. Its changed source/test/proof/config snapshot, excluding this task record, is SHA-256 `53aa1044728723cf661f91e92cee00f193ad3225426a659b9f6aa82954f11a5f`; the per-file manifest is `scratch/linked-templates-metaschema-isolation-tree.json`.

| UTC start | Exact command | Result |
|---|---|---|
| 04:24:39 | `npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'meta/validation'` | Expected red: 1 failed, 23 filtered; compiler did not throw |
| 04:24:59 | `npm test -- local --file packages/server/test/templates-schema.test.ts` | 24 passed |
| 04:25:16 | `npm test -- local --file packages/server/test/templates-scanner.test.ts` | 29 passed |
| 04:25:24 | `npm test -- local --surface unit:server` | 1,127 passed, 1 existing privileged-port permission skip |
| — | `npm run type-check` | Passed |
| — | `npx eslint packages/server/src/template-schema.ts packages/server/test/templates-schema.test.ts --max-warnings=0` | Passed |
| — | `git diff --check` | Passed, including the final task-record update |

Each test timestamp identifies its `.test-runs/2026-10-23T<timestamp>-*/summary.json`; the server report is `.test-runs/2026-10-23T04-25-24-753Z-p3610138-rcdfec8c989fb636e/summary.json`. All four runs recorded zero recovered flakes, process leaks and infrastructure failures. The initial red was the only failing check.

Independent re-review in a fresh Codex process, GPT-6 Astra at `xhigh`, resumed reviewer thread `01a165e4-fd41-7200-91c0-659121f94ea3` and returned **PASS: the metaschema-isolation blocker is closed, with no new defect found**. The read-only review checked the fix and existing red/green reports; it ran no additional tests. Report: `scratch/codex/slice1-review/last-message-metaschema-isolation.txt`.

Slice 1 remains complete. The later-slice baseline and two MDX mirror failures are unchanged and were not rerun. No commit, push, full verification, package installation or host CLI installation was performed.


### Slice 2 implementation — October 23, 2026

**Implementation and slice validation complete; supervisor review pending.** Work stayed on `feat/toolbox`, based on `4ede94e0f534565ccfc193ee28de0334063e33e8`. No commit or push was made.

Implemented local SVG/PNG icon validation and deterministic selection, authenticated exact-ID icon bytes with content type and `no-store`, and delivery-time containment checks. Retired the thumbnail route/client and replaced its route test. When observation is unavailable, icon requests validate directly without changing the scan cache or publishing events.

The serving store starts its template cache after bundled handling in step 6, before display initialization and ordinary artifact/theme watchers. Token-only construction starts neither scan nor observation. The cache uses the shared recursive watcher, debounces changes, publishes full scans and invalidated IDs, handles warning/fallback/recovery, and closes observation on disposal. Synchronous scans preserve read/publication order; fresh CLI/create reads use that same cache and cancel queued debounce work. Stale callbacks from replaced watchers are ignored.

Each `ServerConnection` owns its list and icon Blob URLs while the popover is closed. Startup/reconnect loading follows subscription and the desktop boot barrier. Full loads and pushes invalidate icons, stale responses are ignored, failed loads retry on opening, and watcher failure refreshes on opening or once when learned while open. The current popover consumes this cache, preserves prior rows during refresh, and leaves its body blank before the first scan. Its visual and interaction redesign remains in slice 3.

Added scanner icon tables; server/client cache contracts; native filesystem-to-WebSocket, authenticated HTTP and real-browser seams; watcher fallback acceptance; boot-order/token-only checks; and icon CORS coverage. Extended server-connection tests for event-before-load ordering and desktop-barrier preservation. Existing artifact/theme watcher fixtures distinguish template observation without changing their retained claims. Tests use only the proof-declared controlled peers, transport timing/abort, watcher-failure and CSS-motion hooks. No dependencies were added.

All **12 slice 2 proof placeholders** now cite real tests: eight in template architecture, two in onboarding, one in shared watcher integration and one in isolation. The retired thumbnail proof points to its icon replacement. Nineteen linked-template/Toolbox placeholders remain for slices 3–4; the unrelated daemon-unit placeholder also remains. No spec or Storybook specification changed, and no spec/proof ambiguity required a decision.

#### Validation tree and results

Every command below ran in `/root/workspace/dev/television/feat/toolbox` on the evolving **uncommitted** tree based on `4ede94e`. The runner reports HEAD tree `b6494070c7dac1332ec526887b45ef534d9aee3e` with `dirty: true`; that is not a snapshot of the edits. Intermediate dirty trees were not retained. The final source/test/proof snapshot, excluding this task record, is SHA-256 `dd6019148f03f2b1c7dfa642cd2b9335069be97306096f9be76d59a534bfb42f`; its per-file manifest is in ignored `scratch/linked-templates-slice2-tree.json`.

The final owning run at 04:57:36 passed **1,148 server tests, 67 shared tests and 579 browser-app tests** (1,794 total). It has two retained skips: the server privileged-port permission case unavailable on this host, and the pre-existing ACP fake-server disconnect case. After that run, production changes only named the icon/debounce constants and replaced the popover's copied scan field with a getter; test changes strengthened bootstrap scan observation and awaited both delayed browser responses through completion. The final 77-case server selection, three browser journeys, eight freshly packaged CLI template cases, type-check and lint cover those closing changes. The source/test/proof tree was unchanged after the final checks.

Times below are UTC. Each timestamp locates `.test-runs/2026-10-23T<timestamp>-*/summary.json`; the full report names every case. The combined-surface command is preserved in its invoked order. Filtered cases are reported by Vitest as pending alongside actual skips.

| UTC start | Exact command | Result |
|---|---|---|
| 04:38:12 | `npm test -- local --file packages/server/test/templates-scanner.test.ts --grep 'icons'` | 0 passed, 12 failed, 29 skipped/filtered |
| 04:38:44 | `npm test -- local --file packages/server/test/templates-scanner.test.ts --grep 'icons'` | 12 passed, 0 failed, 29 skipped/filtered |
| 04:39:43 | `npm test -- local --file packages/server/test/templates-cache.test.ts` | module-load failure: cache module not yet implemented |
| 04:40:30 | `npm test -- local --file packages/server/test/templates-routes.test.ts` | 2 passed, 3 failed |
| 04:41:28 | `npm test -- local --file packages/server/test/templates-cache.test.ts` | 4 passed, 0 failed |
| 04:41:42 | `npm test -- local --file packages/server/test/templates-routes.test.ts` | 0 passed, 5 failed |
| 04:42:17 | `npm test -- local --file packages/server/test/templates-routes.test.ts` | 4 passed, 1 failed |
| 04:43:18 | `npm test -- local --file packages/web/test/template-cache.test.ts` | module-load failure: cache module not yet implemented |
| 04:44:10 | `npm test -- local --file packages/web/test/template-cache.test.ts` | 4 passed, 0 failed |
| 04:44:29 | `npm test -- local --file packages/web/test/server-connection.test.ts --grep 'subscribes to template'` | 0 passed, 1 failed, 34 skipped/filtered |
| 04:44:51 | `npm test -- local --file packages/web/test/server-connection.test.ts --grep 'subscribes to template'` | 1 passed, 0 failed, 34 skipped/filtered |
| 04:46:23 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --grep 'preloads authenticated'` | 1 failed |
| 04:47:35 | `npm test -- local --file packages/server/test/onboarding-installer.test.ts --grep 'watchers\|template cache'` | 2 passed, 1 failed, 47 skipped/filtered |
| 04:47:35 | `npm test -- local --file packages/server/test/templates-routes.test.ts` | 6 passed, 0 failed |
| 04:49:02 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --grep 'preloads authenticated'` | 1 passed after one recovered timeout |
| 04:49:19 | `npm test -- local --file packages/server/test/cross-origin-routes.test.ts --grep 'token routes'` | 1 passed, 0 failed, 3 skipped/filtered |
| 04:49:20 | `npm test -- local --file packages/server/test/onboarding-installer.test.ts --grep 'watchers\|template cache'` | 3 passed, 0 failed, 47 skipped/filtered |
| 04:53:19 | `npm test -- local --file packages/server/test/templates-cache.test.ts --grep 'failed watcher'` | 0 passed, 1 failed, 4 skipped/filtered |
| 04:53:23 | `npm test -- local --file packages/web/test/server-connection.test.ts --grep 'template loading behind'` | 0 passed, 1 failed, 35 skipped/filtered |
| 04:53:25 | `npm test -- local --file packages/server/test/server-store-file-watcher.test.ts --grep 'handoff\|owners before\|watcher error\|stale callbacks'` | 0 passed, 4 failed, 13 skipped/filtered |
| 04:54:40 | `npm test -- local --file packages/server/test/server-store-file-watcher.test.ts` | 17 passed, 0 failed |
| 04:54:40 | `npm test -- local --file packages/server/test/templates-cache.test.ts` | 5 passed, 0 failed |
| 04:54:40 | `npm test -- local --file packages/web/test/server-connection.test.ts` | 36 passed, 0 failed |
| 04:55:56 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --retries 0` | 3 passed; retries disabled |
| 04:57:36 | `npm test -- local --surface unit:server,unit:shared,unit:browser-app` | 1794 passed, 0 failed, 2 skipped/filtered |
| 05:02:23 | `npm test -- local --surface unit:server --grep 'artifact template\|watched template cache\|template cache\|token-only\|token routes'` | 77 passed, 0 failed, 1072 skipped/filtered |
| 05:02:23 | `npm test -- local --file test/repo/spec-links.test.ts` | 6 passed, 2 failed |
| 05:03:32 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --retries 0` | 3 passed; retries disabled |
| 05:03:32 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'template'` | 8 passed, 0 failed, 38 skipped/filtered |

The first icon and route runs failed on the intended missing behavior. The first cache-file runs failed to import the not-yet-created cache modules; they are module-load reds, not behavioral evidence. The connection and popover reds then exercised the absent wiring. Intermediate route failures exposed a missing shared-event export and a repeated false-status publication during fallback reads; both were fixed. The first bootstrap check used the wrong bundled-fixture path; correcting it made the real installer/cache observation pass.

The lifecycle regression reds reproduced callbacks from a failed watcher affecting its replacement and icon requests crossing a halted desktop boot barrier. Both were repaired before their full files passed. The four ordinary-watcher failures came from fixtures counting the additional template watcher; those fixtures now identify their own artifact/theme consumers and retain their prior assertions.

One browser run (04:49:02) recovered on retry after the first attempt exhausted its 30-second test timeout during reconnect. The missed-edit setup now performs mutation and cache publication synchronously while sockets are closed, and the journey has a 90-second overall budget for cold startup and reconnect on a busy host. Both subsequent complete browser runs passed all three journeys with retries disabled, including the final run after explicit delayed-response completion checks. No final run relied on retry recovery. Firefox was unavailable; browser evidence is Chromium.

All **29 canonical runs** recorded zero process leaks and zero infrastructure failures. The recovered browser timeout above is the sole recovered flake. The final `spec-links` result preserves the planned baseline exactly: six checks pass, and only “the proof tree mirrors every proof-bearing spec and has no orphan” and “every proof declares its exact mirrored spec” fail on the MDX/Markdown Toolbox pair. Links, block references and test-code citations pass.

Additional commands:

- `npm run type-check`: the first run (during integration) failed on erasable-syntax parameter properties, a private-store test access, the missing shared `TemplateClient` type export, and the not-yet-replaced popover thumbnail call. The second failed on an overly narrow icon mock return type. Both were corrected; the final run passed on the final source/test tree.
- `git ls-files -m -o --exclude-standard -- '*.ts' | xargs npx eslint --max-warnings=0`: first failed on 17 unnamed numeric constants in PNG parsing/ranking and debounce; the final run passed after naming them without changing their values.
- `git diff --check`: passed during implementation and after the final task-record edit.
- Browser runner precommands built the web app, artifact documents, canonical assets and SDK. The CLI acceptance runner's `node scripts/licenses/build-suite.mjs` built and checked the packaged CLI/server/web/assets, skills and desktop output. These were canonical-runner prerequisites, not host installs.

**Remaining baseline:** Toolbox appearance, interaction, messages, icon fallback presentation, MDX mirroring/index generation and theming-reference work belong to slice 3; bundled replacement recovery and delivered guidance belong to slice 4. Their obsolete UI/guidance tests were not treated as slice 2 obligations. There is no remaining thumbnail-route obligation or new unassigned failure. Full `npm run verify` remains for the supervisor on a committed, pushed revision. No host CLI installation/link, host-home server execution, dependency installation or large ad hoc temporary directory was used. Test-created homes were removed, including two empty ACP homes left when the final server selector filtered out their teardown; the owning suite’s cached temporary web bundle was also removed. Canonical reports and the small ignored validation manifest remain as evidence.


### Slice 2 reconnect review fix — October 23, 2026

Independent review returned **FAIL**: reconnect retained icon bytes when a partial push superseded the full list response. The push refreshed its named IDs, but icons changed during the outage could remain stale indefinitely. This finding superseded the preceding implementation-complete handoff.

Added the combined regression before changing production code: preload `one` and `two`, reset, delay the reconnect list, apply a current scan invalidating only `one`, then complete the list and open the popover. The red run reproduced `two-old` where `two-new` was required. Reset now revokes and removes all cached icons, so either the full response or a superseding partial push reloads them. The previous list remains available. Disposal reuses this cleanup instead of repeating it. The `^templates-t-app-cache` proof now cites the new regression.

#### Validation

All commands ran in `/root/workspace/dev/television/feat/toolbox`, on the uncommitted `feat/toolbox` tree based on `4ede94e0f534565ccfc193ee28de0334063e33e8`. The red tree contains only the added regression beyond the previous handoff; its snapshot is SHA-256 `8b0a8ea97d24e6ac971215e40dcb56acdb298f21c6011b22efe057677af2107a` in `scratch/linked-templates-reconnect-red-tree.json`. The final source/test/proof snapshot is SHA-256 `2b6e0cd9de42bea5cb90d8e501b97a801d68590fa9bafe09de1945f10765886f` in `scratch/linked-templates-reconnect-final-tree.json`. Both exclude this task record. The green cache-file run used the final source/test tree before adding the proof citation; the owning suite and static checks used the final snapshot. No source, test or proof changed afterward.

| UTC start | Exact command | Result |
|---|---|---|
| 05:19:23 | `npm test -- local --file packages/web/test/template-cache.test.ts --grep 'partial push'` | Expected red: 1 failed, 4 filtered; `two-old` instead of `two-new` |
| 05:19:48 | `npm test -- local --file packages/web/test/template-cache.test.ts` | 5 passed |
| 05:20:13 | `npm test -- local --surface unit:browser-app` | 580 passed, 1 existing ACP fake-server disconnect skip |
| — | `npm run type-check && npx eslint packages/web/src/services/template-cache.ts packages/web/test/template-cache.test.ts --max-warnings=0` | Passed |
| — | `git diff --check` | Passed, including this final record edit |

Each test timestamp locates its `.test-runs/2026-10-23T<timestamp>-*/summary.json`; the owning-suite report is `.test-runs/2026-10-23T05-20-13-530Z-p3806290-r1ba2f603cada97d6/summary.json`. All three runs recorded zero recovered flakes, process leaks and infrastructure failures. The intentional regression red was the only failure. Removed the temporary web bundle retained by the owning-suite helper.

The reconnect blocker is fixed and awaits independent re-review. No spec/proof ambiguity, new dependency or other finding arose. The planned slice 3–4 baseline remains unchanged; those checks were not rerun. No full verification, commit, push, installation or host-home server run was performed.


### Slice 3 implementation checkpoint — October 23, 2026

**Historical checkpoint: incomplete; superseded by the completion entry below.** Toolbox behavior and MDX repository support are implemented and tested. The required Conform dependency, 18 story comparisons, Storybook/service build wiring and canonical-runner registration are not implemented. The approved plan explicitly requires `@telepath-computer/conform`, and [UI policy](../../specs/spec-ui.md#^ui-conformance-test) says each surface “runs conform on every spec story against production in that state”. That package is absent from the installed dependencies and lockfile. The implementation request also says not to install anything or add a dependency without stopping to report its need and alternative. This conflict was raised while independent work continued; no dependency/install authorization arrived. Ordinary Playwright behavioral tests and copying the approved styles do not satisfy that conformance obligation. No spec or story was changed to resolve the conflict.

Replaced the old grid with a production Toolbox view, a small search/highlight model and a platform shortcut predicate. The navbar supplies its existing template cache and an async creation/focus action. The view uses the approved story styles, cached rows/icons, name-only search, stable highlighted IDs, input focus and active-option semantics, real scrolling, summary/directory messages and Unicode letter defaults. Creation retains linked/URL behavior, selected-tab placement, silent failures and the existing UI telemetry source. Supplied images fall back after decoding errors. The app listener handles Meta+K on macOS and Ctrl+K elsewhere.

Added six cheap state/icon/platform cases, two production-browser consumer contracts, a real Electron shortcut seam and two temporary-tree MDX tooling contracts. Reworked the former skill-selector browser file into ten Toolbox journeys, retaining real successful creation and display/transparency defaults. Retired thumbnail/grid/description, copy/seed-store and scan-on-open expectations. Replaced the seed-write obstruction with channel-layout-save obstruction after registration; added fresh-scan refusal, URL activation and real SVG/PNG/broken-byte icon coverage. Retained the explicitly declared focus-request abort. Navbar, Settings, app-root, theme-product and slice 2 cache tests now address Toolbox; unrelated retained stylesheet checks remain.

The index generator now includes standalone MDX surfaces and their Markdown proofs. Repository checks include MDX links, anchors and test-code citations, map MDX specs to Markdown proofs in both directions, and retain directory-based Markdown UI authority. Regenerated both indexes; only the spec index needed a content change. Theme-reference selection now follows Toolbox while retaining the artifact-frame pilot and historical routing assets.

Thirteen proof placeholders now cite actual tests: ten in `proofs/ui/app/toolbox.md` and the three UI creation/display/transparency assertions in `proofs/product/templates.md`. Navbar proof citations retain their existing test names and now exercise Toolbox composition. `^toolbox-t-conformance` remains explicitly unwritten. Seven placeholders remain across the affected proof tree: this one and six assigned to slice 4.

#### Validation

All commands below ran in this worktree on uncommitted changes based on `d17b04161cb1a438cd37d8372b90bff664f32370` (`feat/toolbox`). Canonical reports record dirty HEAD tree `fc915594e64399a708723ee8dd35c955695a7f73`; that is not a snapshot of the edits. The final changed source/test/proof/config file manifest, excluding this task record, is SHA-256 `d8b5a0a8f34ad8950aeb02bee9c1fc2c13d0a37eeda913f20510748fb575f362`, in ignored `scratch/linked-templates-slice3-tree.json`. Intermediate dirty snapshots were not retained. The stages below identify which implementation each run exercised; final file/suite runs used the final relevant source/tests, with proof citations completed before the last repository checks. No source or test changed after the final runs.

Each UTC timestamp identifies `.test-runs/2026-10-23T<timestamp>-*/summary.json`, with case-level evidence in its native report. All 32 canonical runs recorded zero recovered flakes, process leaks and infrastructure failures. The unchanged-tree theme rerun below recovered an intermittent failure across separate invocations; the runner does not count that as a recovered flake.

| UTC start | Exact command | Result |
|---|---|---|
| 05:30:05 | `npm test -- local --file packages/web/test/toolbox-state.test.ts` | module-load failure; no tests ran |
| 05:30:33 | `npm test -- local --file packages/web/test/toolbox-state.test.ts` | 6 passed, 0 failed |
| 05:31:35 | `npm test -- local --file packages/web/test/e2e/toolbox.test.ts --test-retries 0` | 0 passed, 2 failed |
| 05:32:24 | `npm test -- local --file test/repo/spec-documents.test.ts` | module-load failure; no tests ran |
| 05:33:36 | `npm test -- local --file packages/web/test/e2e/toolbox.test.ts --retries 0` | 2 passed, 0 failed |
| 05:34:02 | `npm test -- local --file test/repo/spec-documents.test.ts` | 2 passed, 0 failed |
| 05:35:45 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --retries 0` | 3 passed, 4 failed |
| 05:36:39 | `npm test -- local --file test/repo/spec-links.test.ts` | 8 passed, 0 failed |
| 05:36:40 | `npm test -- local --file test/repo/theming-reference.test.ts` | 1 passed, 0 failed |
| 05:37:40 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --retries 0` | 8 passed, 2 failed |
| 05:38:19 | `npm test -- local --file packages/desktop/test/e2e/toolbox.test.ts --retries 0` | 0 passed, 1 failed |
| 05:40:10 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --grep 'Toolbox opens\|real SVG' --retries 0` | 1 passed, 1 failed |
| 05:41:07 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --grep 'Toolbox opens' --retries 0` | 1 passed, 0 failed |
| 05:41:31 | `npm test -- local --surface unit:browser-app` | 583 passed, 3 failed, 1 skipped/filtered |
| 05:41:44 | `npm test -- local --file packages/desktop/test/e2e/toolbox.test.ts --retries 0` | 1 passed, 0 failed |
| 05:41:46 | `npm test -- local --file test/repo/spec-documents.test.ts` | 2 passed, 0 failed |
| 05:42:22 | `npm test -- local --file test/repo/spec-documents.test.ts --grep 'mirrors in both directions'` | 0 passed, 1 failed, 1 skipped/filtered |
| 05:42:48 | `npm test -- local --file test/repo/spec-documents.test.ts` | 2 passed, 0 failed |
| 05:42:49 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --retries 0` | 10 passed, 0 failed |
| 05:42:51 | `npm test -- local --file test/repo/spec-links.test.ts` | 8 passed, 0 failed |
| 05:43:41 | `npm test -- local --file packages/web/src/views/top-bar.test.ts --grep 'empty strip without a notice'` | 0 passed, 1 failed, 5 skipped/filtered |
| 05:43:54 | `npm test -- local --file packages/web/src/views/top-bar.test.ts` | 6 passed, 0 failed |
| 05:43:55 | `npm test -- local --file packages/web/test/e2e/toolbox.test.ts --retries 0` | 2 passed, 0 failed |
| 05:44:17 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --retries 0` | 3 passed, 0 failed |
| 05:44:45 | `npm test -- local --file packages/web/test/e2e/top-bar.test.ts --retries 0` | 6 passed, 0 failed |
| 05:44:48 | `npm test -- local --surface unit:browser-app` | 586 passed, 0 failed, 1 skipped/filtered |
| 05:45:27 | `npm test -- local --file packages/web/test/e2e/settings.test.ts --retries 0` | 4 passed, 0 failed |
| 05:46:43 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | 0 passed, 1 failed |
| 05:46:45 | `npm test -- local --file test/repo/spec-links.test.ts` | 8 passed, 0 failed |
| 05:46:50 | `npm test -- local --file test/repo/theming-reference.test.ts` | 1 passed, 0 failed |
| 05:47:42 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | 1 passed, 0 failed |
| 05:51:55 | `npm test -- local --file test/repo/ui-style-delivery.test.ts` | 3 passed, 0 failed |

The first state and MDX fixture runs were expected missing-module reds, not assertion-level behavior failures. The first browser consumer run failed because the production Toolbox module did not yet exist. Its command mistakenly used `--test-retries 0`, which the root runner did not apply; it ran with the default two retries. Every later browser/Electron command used the correct `--retries 0` selector. The additional MDX regression at 05:42:22 was an assertion-level red: a wrong-extension `proof.mdx` could satisfy the forward mirror. Restricting MDX fallback to spec destinations fixed it; the whole fixture file and both formerly failing repository mirror checks passed.

Intermediate browser failures exposed test assumptions about focus after clicking a non-focusable stage, unscoped option selectors that also selected sidebar options, the canonical trailing slash on linked folder paths, and a partial layout update remaining in memory after its durable save failed. The corrected partial-failure test checks the registered record and unchanged focus/selection throughout. A hidden combobox cannot be located through the default accessibility query after dismissal, so that assertion now uses the input element. One icon journey encountered navigation/reconnection interruption while browser build prerequisites overlapped; its narrow rerun and the later complete ten-test file passed with retries disabled. No icon production workaround was added.

The first Electron run reached the desktop-version gate: the direct app-URL fixture omitted the actual desktop version. The fixture now supplies the package version, disables the helper's default version override and checks `app.getVersion()`; the actual host keyboard crossing then passed. Browser evidence is Chromium because Firefox is unavailable. Electron ran on Linux/Xvfb using the existing harness, whose launch disables the sandbox because this host lacks a configured setuid helper. There is no claim of Windows or macOS acceptance.

The first owning browser-unit suite found three remaining old top-bar selectors. A narrow test reproduced that failure, the selectors were updated, the whole top-bar unit file passed, and the complete browser-unit suite then passed **586 tests with one existing ACP fake-server disconnect skip**.

The affected executable-theme journey first failed at its post-server-restart execution-count assertion (`theme-product-acceptance.test.ts:1794`): five executions instead of four. The Toolbox interactions earlier in the journey passed. The same narrow command passed on an unchanged tree at 05:47:42 with retries disabled. No theme implementation or assertion was changed; the root cause remains unresolved, so this checkpoint does not claim that instability is fixed or that it predates this slice.

Additional exact commands and results:

- `npm run type-check`: initially failed on missing required template fixture fields and a direct untyped import of the JavaScript index generator. Corrected the fixture and exercised the generator through a child Node process. Subsequent runs passed.
- `npm run type-check && git ls-files -m -o --exclude-standard -- '*.ts' | xargs npx eslint --max-warnings=0`: type-check passed; lint selection failed because it included the deleted `skill-selector.ts`. The existing-file command below passed twice, including the final TypeScript edits.
- `npm --workspace @telepath-computer/storybook run type-check`: passed.
- `npm --workspace @telepath-computer/storybook run build`: passed, with the existing empty-production-stories glob and bundle-size warnings. This establishes compilation, not browser rendering of the Toolbox MDX wrapper or story conformance.
- `npm run specs:index`: passed during implementation and after proof citation edits; regenerated specs and proofs indexes.
- `npm run type-check && npm run specs:index && git diff --check`: passed on the final source/test/proof tree.
- `git diff --check`: passed again after this task-record update.
- Browser/desktop runner prerequisites built web, artifact views, canonical assets and the SDK; desktop execution also used its existing build prerequisite. These were builds, not host installations.

Exact lint invocation:

```sh
python3 - <<'PY'
import subprocess
from pathlib import Path
files=subprocess.check_output(['git','ls-files','-m','-o','--exclude-standard','--','*.ts'],text=True).splitlines()
subprocess.run(['node','node_modules/eslint/bin/eslint.js',*[f for f in files if Path(f).is_file()],'--max-warnings=0'],check=True)
PY
```

**Remaining baseline versus the plan:** MDX mirror/index failures, theme-reference selection and the exercised UI/cache integration baseline are resolved. The planned slice 3 exit baseline is not met: all 18 Conform comparisons and their delivery/runner wiring remain, and the MDX documentation wrapper has not been verified in a browser. The intermittent theme count failure also remains an explicit finding. Slice 4 still owns bundled replacement recovery and delivered guidance. No spec/proof ambiguity was decided, no dependency was added, and no spec/story/style authority was changed; the sole authority-tree edit is the generated index.

No full `npm run verify`, commit, push, host CLI install/link or host-home server run occurred. The existing Storybook server on port 6106 was left alone. Test-created homes/profiles were cleaned by their fixtures. Removed 17 completed workers' cached temporary source-CLI/web bundles after matching their generated Toolbox assets to this worktree; an initial stricter hash check stopped before deletion because the two versioned web bundles legitimately had different JavaScript hashes. No large ad hoc temporary directory or installation was created. Canonical reports and the small ignored validation manifest remain.


### Slice 3 completion — October 23, 2026

**Status: implemented and locally validated; ready for supervisor review.** Rupert authorized the local Conform 0.2.0 tarball and its installation. This supersedes the preceding dependency blocker. Added exactly the requested direct development dependency to `packages/web/package.json`; the lock records Conform and its automatically resolved Playwright 1.64.1 peer/core. No other direct dependency or browser was installed.

The conformance setup follows the read-only Checklist branch (`237aae8`, including `524dc97`'s Blaxel package-selection expectation): a dedicated Chromium config, production mount, built-Storybook Vite service, production Vite service, build prerequisite, canonical surface and prebuilt recipe. Web Playwright invocations run from the repository root so the runner uses its existing toolchain while Conform captures with its own peer. Ordinary browser discovery excludes the conformance file. Workspace-version checks distinguish actual workspace members from externally supplied packages in the same npm scope, as on Checklist.

`e2e:toolbox-conformance` enumerates the built Storybook index, checks that Toolbox stories exist, fails for any unmapped story and compares all 18 states through real input and the proof-declared item service. The comparison includes the trigger and panel in a shared 640×800 outer canvas; only the neutral mount supplies Storybook's 16px padding and the canvas height. Production Toolbox markup/styles are untouched by the test and there is no difference allowlist. The MDX browser check loads its Docs page, finds its prose headings and all 18 embedded story wrappers, and asserts no browser page errors. No story or story stylesheet changed; `toolbox.css` is byte-identical to the approved story stylesheet.

The final `^toolbox-t-conformance` placeholder now cites `toolbox-conformance.test.ts`, “Toolbox conforms: ${id}”, and the MDX wrapper check. Slice 3 has discharged all **14** assigned placeholders: 11 Toolbox and three product UI creation/display/transparency assertions. The earlier checkpoint's remaining-marker count included an unrelated standing `startup-bind-failure.md#^t-unit-content` placeholder (TV-507). The actual linked-templates remainder is **five**, all assigned to slice 4: three bundled-installation and two delivered-guidance assertions. Navbar's inherited assertions remain covered. No spec/proof ambiguity required a decision; the only authority-tree edit remains the generated spec index.

#### Validation

The 23 main-worktree commands below ran on `/root/workspace/dev/television/feat/toolbox`, branch `feat/toolbox`, based on `d17b04161cb1a438cd37d8372b90bff664f32370`. The additional 13:46:25 command ran from an isolated `git archive d17b041` snapshot at `scratch/theme-baseline-d17b041`, with existing external dependencies symlinked in; its build failed before testing. That directory was removed. Its report is retained at `scratch/baseline-report-2026-10-23T13-46-25-528Z-p3960777-ra90ed36a423b15b3/`.

The 13:49:45, 13:57:32 and 14:00:13 commands used the normal worktree path temporarily restored to `d17b041`. The diagnostic script checked `git diff --exit-code` before adding test-only observations, temporarily removed the newly installed web peer directory, and restored every saved file byte-for-byte and the peer directory in `finally`. New untracked Toolbox files were unreferenced by the baseline. The first two runs added only request/event/response/execution logging. The third also delayed the two folder-loss requests until restoration executed, then released them and waited for that execution before restarting; it retained the original post-restart assertion. These diagnostic runs are evidence about the existing race, not replacement acceptance tests or full baseline verification.

All other runs used the evolving slice 3 implementation. The final source/test/config/proof manifest, excluding this task record, is SHA-256 `5018fb6c5db9f8f3f1bab999fb654325548468e624721dd5b2cdf9a8f53ac97e`, in `scratch/linked-templates-slice3-final-tree.json`. The complete conformance run, type-check and lint used those final source/test/config bytes before the final proof citation; the final cache, browser-contract, normal theme and spec-links checks include that citation. No implementation or test changed after those runs.

Each timestamp locates `.test-runs/2026-10-23T<timestamp>-*/summary.json`, except the archived failure described above. All 23 main-worktree reports record **zero recovered flakes, process leaks and infrastructure failures**. The isolated archive attempt records one infrastructure failure. All browser runs below disabled retries. The earlier 05:46 theme failure and separate 05:47 pass remain in the preceding ledger; the diagnostic explains the pre-existing race without claiming it is fixed.

| UTC start | Exact command | Result |
|---|---|---|
| 13:36:23 | `npm test -- local --file test/repo/test-runner-provider.test.ts --grep 'selects package surfaces for Blaxel'` | 0 passed, 1 failed, 41 filtered |
| 13:39:30 | `npm test -- local --surface e2e:toolbox-conformance --grep 'spec-toolbox--open$' --retries 0` | Collection failed; no tests ran |
| 13:39:41 | `npm test -- local --file test/repo/test-runner-provider.test.ts --grep 'selects package surfaces for Blaxel'` | 1 passed, 0 failed, 41 filtered |
| 13:40:46 | `npm test -- local --surface e2e:toolbox-conformance --grep 'spec-toolbox--open$' --retries 0` | 0 passed, 1 failed |
| 13:40:48 | `npm test -- local --file test/repo/package-version-sync.test.ts --grep 'internal @telepath'` | 0 passed, 1 failed, 6 filtered |
| 13:41:53 | `npm test -- local --surface e2e:toolbox-conformance --grep 'spec-toolbox--open$' --retries 0` | 0 passed, 1 failed |
| 13:42:06 | `npm test -- local --file test/repo/test-runner-config.test.ts` | 14 passed, 0 failed |
| 13:42:08 | `npm test -- local --file test/repo/package-version-sync.test.ts` | 7 passed, 0 failed |
| 13:44:09 | `npm test -- local --surface e2e:toolbox-conformance --grep 'spec-toolbox--open$' --retries 0` | 0 passed, 1 failed |
| 13:44:11 | `npm test -- local --file test/repo/test-runner-prebuilt.test.ts` | 10 passed, 0 failed |
| 13:45:24 | `npm test -- local --surface e2e:toolbox-conformance --grep 'spec-toolbox--open$\|documentation' --retries 0` | 1 passed, 1 failed |
| 13:45:26 | `npm test -- local --file test/repo/test-runner-provider.test.ts` | 42 passed, 0 failed |
| 13:46:25 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | Baseline archive: prerequisite build failed; no tests ran |
| 13:47:08 | `npm test -- local --surface e2e:toolbox-conformance --grep documentation --retries 0` | 0 passed, 1 failed |
| 13:48:45 | `npm test -- local --surface e2e:toolbox-conformance --grep documentation --retries 0` | 0 passed, 1 failed |
| 13:49:45 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | 1 passed, 0 failed; baseline with observation-only logging |
| 13:51:18 | `npm test -- local --surface e2e:toolbox-conformance --grep documentation --retries 0` | 1 passed, 0 failed |
| 13:55:12 | `npm test -- local --surface e2e:toolbox-conformance --retries 0` | 19 passed, 0 failed |
| 13:57:32 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | 1 passed, 0 failed; baseline with observation-only logging |
| 14:00:13 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | 1 passed, 0 failed; baseline delayed-request diagnostic, five executions observed |
| 14:01:51 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --retries 0` | 3 passed, 0 failed |
| 14:02:10 | `npm test -- local --file test/repo/spec-links.test.ts` | 8 passed, 0 failed |
| 14:02:57 | `npm test -- local --file packages/web/test/e2e/toolbox.test.ts --retries 0` | 2 passed, 0 failed |
| 14:03:33 | `npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable themes run only' --retries 0` | 1 passed, 0 failed |

The first package-selector run was the expected red for the newly required surface. Initial conformance attempts failed during setup: the registry factory did not forward `cwd`, then assertions used the root Playwright `expect` with Conform's peer-version Locator. Forwarding `cwd` and using the peer locator's waits fixed those errors. Subsequent Open comparisons exposed mismatched outer canvas bounds and an extra fixture background; the shared viewport canvas and plain padded mount resolved them without changing Toolbox or the stories. The MDX selector initially expected an exact heading name, while Storybook's heading-link control contributes to that accessible name; suffix matching fixed it. The final complete surface passed **19 tests: all 18 comparisons plus the documentation wrapper**. The version-sync red was the scope-prefix assumption; Checklist's workspace-membership rule resolved it. No behavioral failure was retried into a passing conformance result.

Additional exact commands and results:

- `npm install --workspace @telepath-computer/television-web --ignore-scripts --no-audit --no-fund`: passed; added three package records (Conform and its peer/core), preserving the existing root Playwright toolchain. This installation is the explicit authorization exception.
- `npm run type-check`: initially failed on TypeScript's deep generic instantiation for the conformance page-evaluation argument. Passing the authored scan as serialized JSON fixed the compile boundary; the final run passed.
- The exact Python/ESLint invocation printed in the preceding checkpoint was rerun over all existing changed TypeScript files: passed with `--max-warnings=0`.
- `npm --workspace @telepath-computer/storybook run type-check`: passed again.
- `npm run specs:index && git diff --check`: passed after the proof update; `git diff --check` also passed after the final task-record edit.
- `cmp packages/web/src/views/toolbox.css storybook/spec/toolbox/styles.css && git diff --exit-code -- storybook/spec specs/ui && git diff --name-only -- specs && git diff --check`: passed; only `specs/index.md` was listed.
- Every conformance invocation ran `node scripts/test/build-toolbox-conformance.mjs` through the canonical runner. The final full run successfully built web/artifact/canonical/SDK artifacts and Storybook, started both registered services and stopped them afterward. Existing missing production-story glob, bundle-size and Vite dynamic-import analysis warnings did not fail the build or browser checks. No second Storybook dev server was started.
- Baseline wrappers were `python3 scratch/run-theme-baseline.py > scratch/theme-baseline-normal-path-run1.log 2>&1`, the same command with `run2.log`, and `python3 scratch/run-theme-baseline.py --delay-loss-request > scratch/theme-baseline-delayed-loss.log 2>&1`. All completed and verified restoration. The table records their actual canonical test commands and results.

#### Theme execution finding

The race predates this slice. The test at `d17b041` waits for the script URL to change and the count to remain two after moving the theme folder away, but does not wait for the loss-triggered script request to settle before restoring the folder. The route can serve an empty JavaScript entry while absent (HTTP 200), or real bytes if a delayed request arrives after restoration. `refreshThemeScript()` removes the former element; that does not cancel an already-started external script fetch. Consequently the restoration request and the older loss request can both execute, followed by another execution on reconnect.

The controlled baseline diagnostic at 14:00:13 demonstrates this exact ordering in both app pages. In page zero, restoration revision `...6026-45` executes third; after release, older loss revision `...5490-43` executes fourth; reconnect revision `...7787-48` executes fifth. The native report's stdout and `scratch/theme-baseline-delayed-loss.log` retain timestamps and URLs. The unchanged post-restart assertion happened to see four before the fifth arrived, so that diagnostic reports a pass despite recording five. This also exposes the assertion's timing sensitivity. Two observation-only baseline runs passed normally. The final uninstrumented slice 3 run at 14:03:33 passed. The earlier failing run lacked this trace, so its precise request sequence cannot be retrospectively proven, but the same excess execution and its cause are established in pre-slice production code. No theme implementation, timing assertion or diagnostic hook is included in this slice's diff; only Toolbox selectors changed in the retained theme journey.

**Remaining baseline versus the plan:** the MDX mirror/index and theme-reference failures, Toolbox behavior, all 18 comparisons, MDX browser rendering and slice 2 cache journeys are resolved. The previously recorded owning browser-unit run remains 586 passed with one existing ACP fake-server skip; creation, navbar, Settings, Electron, MDX fixture and stylesheet-delivery results remain in the first checkpoint. Only slice 4's bundled replacement recovery and delivered guidance remain in the linked-templates plan. The independent theme race above is an existing finding, not a claim that the whole repository is green. Chromium was exercised; Firefox is unavailable. Full verification and independent review remain with the supervisor.

No commit, push, full `npm run verify`, host CLI install/link or host-home server occurred. The existing port-6106 Storybook server was left alone. Removed the isolated baseline snapshot, restored-source backup and four completed theme-test source-CLI runtime directories after matching their CLI hash and baseline/final web assets. Also removed 18 temporary registry/provider fixtures attributable to the recorded runs. Small ignored diagnostic scripts, logs, manifests and canonical reports remain for review.


### Slice 3 review corrections — October 23, 2026

Independent review returned **FAIL**: root-cwd Playwright execution broke two fixture reads, and the watcher-fallback test still selected the retired Templates warning classes. This supersedes the preceding completion handoff.

The correction changes three test lines. Both fixture reads use `new URL(relativePath, import.meta.url)`: the PNG in `skill-selector.test.ts` and the Markdown source in `markdown-editor-integration.test.ts`. The audit of browser tests and shared helpers found no other cwd-dependent fixture reads; remaining file access uses module-relative paths, absolute temporary paths or explicit subprocess cwd. Keeping package cwd would require a wrapper because explicit registry commands execute from the repository root in both the local and planned-shard paths (`scripts/test/cli.mjs`, `scripts/test/planned-shard-worker.mjs`). Two module-relative reads are smaller and preserve the intended root Playwright executable without changing runner machinery.

The watcher-failure assertion now selects `.toolbox-invalid, .toolbox-folder-error`. To demonstrate that it rejects a warning, a temporary negative control created an invalid template directory and refreshed discovery through the real authenticated client. After confirming the actual Toolbox warning appeared, the zero-warning assertion failed with **expected 0, received 1**. The temporary control was then removed. No production behavior, proof assertion, story or stylesheet changed.

#### Validation

Both review findings are fixed; independent re-review remains pending. All runs use `/root/workspace/dev/television/feat/toolbox`, branch `feat/toolbox`, uncommitted on `d17b04161cb1a438cd37d8372b90bff664f32370`. The final source/test/config/proof manifest, excluding this task record, is `scratch/linked-templates-slice3-review-final-tree.json`, SHA-256 `c3eb8d28c25bb1dc3855bdeb90ad5af72c52a2172ea7d30035060fdc0b69a5c3`. It differs from the preceding handoff in exactly those three test files.


The two ENOENT runs exercised the incoming review tree before these fixes. The warning negative control used the corrected selectors and two module-relative reads plus the temporary invalid-directory setup described above. The targeted green and all three complete surfaces used the final implementation/test bytes identified by the manifest. No source or test changed afterward. Each timestamp identifies `.test-runs/2026-10-23T<timestamp>-*/summary.json` and its native report. All eight runs recorded zero recovered flakes, process leaks and infrastructure failures. The separate tab-drag rerun passed after a failure in the full invocation; that is an intermittent failure across invocations, not a runner-counted recovered flake.

| UTC start | Exact command | Result |
|---|---|---|
| 14:19:53 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --grep 'real SVG and PNG' --retries 0` | 0 passed, 1 failed; expected PNG ENOENT red |
| 14:20:58 | `npm test -- local --file packages/web/test/e2e/markdown-editor-integration.test.ts --grep 'loads markdown bytes after' --retries 0` | 0 passed, 1 failed; expected Markdown ENOENT red |
| 14:22:13 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --grep 'retries initial load' --retries 0` | 0 passed, 1 failed; expected warning negative-control red (0 expected, 1 received) |
| 14:23:22 | `npm test -- local --surface e2e:browser-app --grep 'real SVG and PNG\|loads markdown bytes after\|retries initial load' --retries 0` | 3 passed, 0 failed |
| 14:24:35 | `npm test -- local --surface e2e:browser-app --retries 0` | 319 passed, 1 failed, 1 skipped; tab-drag assertion at line 1149 |
| 14:27:46 | `npm test -- local --surface unit:browser-app` | 586 passed, 0 failed, 1 skipped |
| 14:39:44 | `npm test -- local --file packages/web/test/e2e/tab-strip.test.ts --grep 'cancels a live selection crossing' --retries 0` | 1 passed, 0 failed; unchanged tree, no retry |
| 14:40:40 | `npm test -- local --surface e2e:toolbox-conformance --retries 0` | 19 passed, 0 failed |

The complete browser surface ran all four requested files successfully: **skill-selector 10, markdown-editor-integration 8, toolbox 2 and template-cache 3** (23 tests, no skips/failures). Conform passed **18 story comparisons plus the MDX wrapper check**. Browser units passed **586**, with the standing ACP fake-server disconnect skip. The browser e2e skip is the existing Firefox-only appearance case in Chromium; Firefox remains unavailable on this host.

The full browser surface is **not claimed green**. Its one failure is `tab-strip.test.ts`, “cancels a live selection crossing when an edge drag takes over scrolling”: the monotonicity assertion passed, but the first and last sampled scroll positions were both zero, so line 1149's strict decrease assertion failed (`0 < 0`). The same case passed alone on the unchanged tree with retries disabled. `git diff --exit-code d17b041 -- packages/web/test/e2e/tab-strip.test.ts packages/web/test/e2e/fixtures/tab-strip.html packages/web/test/e2e/helpers.ts packages/web/src/views/tab-strip.ts packages/web/src/views/tab-strip.css packages/web/src/views/tab-reorder.ts packages/web/src/views/stage.ts packages/web/src/constants.ts` passed. The isolated fixture mounts Stage and TabStrip directly and does not import Toolbox or TopBar; it performs no cwd-relative fixture read. This is a separate timing-sensitive test finding, not either reported review defect. No tab behavior or timing assertion was changed, and the precise scheduling cause is not established. The user-authorized minimum of all affected browser files is green; the full-run failure remains visible for the supervisor rather than being represented as a passing broad result.

Additional validation:

- `npm run type-check`: passed during the negative-control stage and again on the final tree after its removal.
- `npx eslint packages/web/test/e2e/skill-selector.test.ts packages/web/test/e2e/markdown-editor-integration.test.ts packages/web/test/e2e/template-cache.test.ts --max-warnings=0`: passed during the negative-control stage. The same command followed by `&& git diff --check` passed on the final tree.
- The conformance surface's registered prerequisite rebuilt production assets and Storybook successfully. Its services completed and stopped normally; the existing Storybook dev server on port 6106 was untouched.
- `git diff --check`: passed after this final record update. A byte-hash check against `scratch/linked-templates-slice3-review-final-tree.json` confirmed every tested source/test/config/proof file remains unchanged.

No additional dependency, permanent test, proof/spec change or story/style change was needed. The plan's five slice 4 obligations remain unchanged. The two review findings are resolved; the previously documented theme race and this separate tab-drag intermittent failure remain reported limitations. No full verification, commit, push, host CLI installation/link or host-home server occurred. Removed eight completed source-CLI/versioned-web temporary build directories after checking their assets and confirming no process still referenced them. The small ignored negative-control fragment, audit, manifests, logs and canonical reports remain for review.


### Slice 4 implementation — October 23, 2026

**Initial implementation and slice validation completed; independent review subsequently returned FAIL. The correction and its validation are recorded below.** All work is uncommitted on `feat/toolbox` at `f0fa32377f8d2fa7d897976e72bbbace9b0d3d12`, in `/root/workspace/dev/television/feat/toolbox`.

The bundled installer now completes a hidden backup, writes state without the handled ID, removes the destination, copies the complete bundled folder to that path, and records the ID after success. A failed backup or state removal leaves the destination intact. The ordinary unhandled-ID rule restores an absent folder on the next serving boot. Removed the staged-copy/prior-folder rollback code. The existing filesystem adapter now also observes copy/removal operations; the installation-loop hook accepts the proof-declared two-ID inventory. Production uses the real filesystem and shipped inventory. No dependency was added.

Replaced tests for recovering hidden prior/staged pairs and keeping the old destination through a replacement-copy failure. The handled-deletion claim remains, including when two artifacts depend on the deleted folder. Added operation-order, interrupted-removal/reboot, failed state removal, two-ID containment/bundle removal, and linked-record/store preservation cases. The latter create two artifacts and their different stores through production operations, preserve valid edits despite a newer source, then exercise invalid/below-minimum replacement and handled deletion. Existing validation, minimum-version, backup, token-only and atomic state-write checks remain. The installer file has 21 passing cases.

The real skills build now checks the delivered list/show/create/path commands and linking/copying/detachment rules, caller data and compatible schemas, empty rendering without writes, URL restrictions, icons and agent favicon acquisition, minimum versions and broken paths. Replaced the retired starting-data, thumbnail-exclusion, automatic-copy and incidental link-label assertions. Bundle membership and display/transparency checks remain. Reviewed the emitted intro, template document, CLI capabilities and Toolbox reference against the approved contracts. Small source edits shorten sentences, state default sharing, name `manifest.json`, and remove an internal deferred-work note. The Toolbox reference required no edit.

Replaced all five slice-4 proof placeholders with actual test citations: `templates-install-t-retry`, `templates-install-t-containment`, `templates-install-t-linked-records`, `templates-guide-t-intro`, and `templates-guide-t-authoring`. No assertion scope or mock declaration changed. No spec/proof ambiguity or needed spec change was found. Specs and Storybook specification files are unchanged.

#### Validation

Every command below ran locally in this worktree on the evolving uncommitted tree atop `f0fa323`. The runner reports HEAD tree `552adebc891b9af985bcca60a35f5eb8a5ea2504` with `dirty: true`; that hash is not a snapshot of the edits. The final source/test/proof file manifest, excluding this task record, is `scratch/linked-templates-slice4-tree.json`, SHA-256 `4b584aa5867feaa548f074182bf7d39f3a11a176694a7fa1c2540828b9b51bd8`. Byte checks confirm those files remain unchanged. Small ignored reports and the manifest remain for review.

The initial installer red used the new tests against HEAD implementation. Five cases exposed missing recovery behavior/hooks; two linked-record cases also had an incorrect expected path without the stored trailing slash. The latter expectations were corrected with the implementation. The first green installer runs precede only a comment and the inventory-hook type annotation. The final runtime implementation and installer tests are covered by both full server runs. The guidance runs identify their stages below; all runs from 15:01:44 onward use final source/test/proof bytes. The CLI build copied the final guidance bytes, separately confirmed against source and producer output.

Times are UTC; each timestamp identifies `.test-runs/2026-10-23T<timestamp>-*/summary.json` and its native report. All runs record zero recovered flakes, process leaks and infrastructure failures. Filtered tests are not counted as skips below. The JSON-store failure followed by separate passing invocations is an intermittent failure across invocations, not a runner-counted recovered flake.

| UTC start | Exact command | Result and tree stage |
|---|---|---|
| 14:54:46 | `npm test -- local --file test/repo/skills-build.test.ts --grep 'emits template discovery and authoring guidance'` | 1 failed, 11 filtered; original stale link-label assertion |
| 14:57:16 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'finishes backup\|absent destination\|removing its ID\|unhandled ID\|one bundled ID\|linked records'` | 7 failed, 14 filtered; new tests against HEAD implementation |
| 14:57:58 | `npm test -- local --file test/repo/skills-build.test.ts --grep 'emits template discovery and authoring guidance'` | 1 failed, 11 filtered; replaced assertions exposed a retained regex stopping at the dot in SKILL.md |
| 14:58:09 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'finishes backup\|absent destination\|removing its ID\|unhandled ID\|one bundled ID\|linked records'` | 7 passed, 14 filtered; implemented recovery and corrected path expectations |
| 14:58:40 | `npm test -- local --file test/repo/skills-build.test.ts --grep 'emits template discovery and authoring guidance'` | 1 passed, 11 filtered; corrected regex, before prose cleanup |
| 14:58:40 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts` | 21 passed |
| 14:59:29 | `npm test -- local --file test/repo/skills-build.test.ts --file test/repo/theming-reference.test.ts` | 1 passed; repeated --file selected only theming-reference, not both files |
| 14:59:32 | `npm test -- local --surface unit:server` | 1,151 passed, 1 failed, 1 skipped; JSON-store WebSocket timeout described below |
| 14:59:32 | `npm test -- local --file test/node/cli-assets.test.ts --retries 0` | 24 passed; real server/skills/CLI/desktop build and packaged asset checks |
| 15:00:24 | `npm test -- local --file test/repo/skills-build.test.ts` | 11 passed, 1 failed; second stale link label in the membership test |
| 15:01:14 | `npm test -- local --file test/repo/skills-build.test.ts --grep 'builds only television'` | 1 passed, 11 filtered; final membership test checks the link target |
| 15:01:44 | `npm test -- local --file test/repo/skills-build.test.ts` | 12 passed; final guidance source/test/proof bytes |
| 15:02:37 | `npm test -- local --surface unit:root` | 447 passed, 1 existing isolated-GitHub-only skip |
| 15:02:37 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --retries 0` | 3 passed |
| 15:03:53 | `npm test -- local --file packages/server/test/resources/json-store-server.test.ts --grep 'applies a set of placeholders'` | 1 passed, 9 filtered; unchanged-tree isolated run |
| 15:04:54 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --retries 0` | 10 passed |
| 15:06:38 | `npm test -- local --surface unit:server` | 1,152 passed, 1 existing privileged-port permission skip; no concurrent test run |
| 15:09:24 | `npm test -- local --file packages/web/test/e2e/template-example-real-stack.test.ts --retries 0` | 1 passed |

The first server-suite failure was `packages/server/test/resources/json-store-server.test.ts`, “applies a set of placeholders whose message is exactly the limit, through the page connection and the administrative route”: the message recorder reported `no matching message within 5000ms; saw []`. It passed alone without changes, then the complete server suite passed without another concurrent test run. Resource code, tests and harness are unchanged. This harness supplies no bundled-template path, so the installer returns before the changed logic. The precise timeout cause is unconfirmed; concurrent build/test load is a possible contributor, not an established diagnosis.

Additional validation:

- `npm run type-check && npx eslint packages/server/src/bundled-template-installer.ts packages/server/src/server-store.ts packages/server/test/bundled-template-installation.test.ts --max-warnings=0`: first failed during type-check because the inventory default inferred only the literal ID `example`; ESLint did not run. Added the explicit read-only ID/minimum-version array type. The same command then passed. No runtime change was required.
- `npx eslint test/repo/skills-build.test.ts --max-warnings=0`: passed on final guidance tests.
- `git diff --exit-code HEAD -- packages/server/test/resources packages/server/src/resources`: passed.
- `git diff --check` and `git diff --exit-code -- specs storybook/spec`: passed. The final byte-hash check matched the manifest above. Direct byte comparison confirmed the emitted template document matches its source and all four packaged skill documents match the producer build; the emitted SKILL.md includes the final intro and CLI text.
- Browser checks used Chromium with retries disabled. Firefox is unavailable on this host. The existing build warnings about bundle size and unresolved canonical CSS at build time did not fail the build. The owning server and repository suites retain only their existing environment-restricted skips.

**Remaining baseline versus the plan:** none of the allocated linked-template baseline remains. Bundled recovery, delivered guidance, package assets, Example rendering, app cache and Toolbox interaction pass their selected checks; the final owning server and repository suites are green with the stated skips. The known TV-1002 theme-script race and tab-strip sampling race were not changed or re-exercised in this slice. The separate JSON-store timeout and passing reruns remain recorded above. Full `npm run verify` was not run, so this is not a complete-gate claim. Independent slice/integrated review and full verification on a committed, pushed revision remain with the supervisor.

No commit, push, package installation, host CLI install/link or host-home server occurred. Tests use absolute temporary homes and the existing developer marker was present. Fixture cleanup removed installer homes and temporary skills output. Removed the two completed source-CLI runtime directories from the Toolbox and Example runs after confirming matching generated CLI bytes/current assets and no live references. Left another task's active test runtime alone. Normal ignored build output, canonical reports and the small validation manifests remain. Final `git diff --check` passed, and source/test/proof hashes still match the recorded manifest.

### Slice 4 review correction — October 23, 2026

**Correction implemented and locally validated. Supervisor re-review remains pending.** Independent review found that copying directly into the destination could leave a valid manifest and page without a supporting script. The next boot would keep that incomplete folder and mark the ID handled. This supersedes the preceding handoff's claim that replacement recovery was complete.

The installer now copies the bundled folder into a hidden sibling, `.example.bundled-template.tmp` for Example, and renames it onto the destination only after the copy succeeds. It removes a stale hidden copy on the next boot. Backup, durable state removal, destination removal, complete replacement and handled recording retain their required order. A failed copy leaves the destination absent and the ID unhandled. Valid customized destinations remain unchanged, including when a stale hidden copy exists.

Replaced the failure test's socket at `index.html` with a real socket obstructing the page's supporting `runtime.js`. After clearing the obstruction, the next serving boot must install every source file with matching bytes. Added two stale-copy cases, with the destination absent or valid and customized. Strengthened the order test to observe a complete hidden copy before the rename. The state-file atomicity test now records only renames onto the state path, while still delegating all renames to Node. The installer file has 23 cases. No tests were retired in this correction beyond replacing the inadequate failure fixture.

The approved `^bundled-artifact-template-backup` rule requires a complete replacement before recording success and permits an absent destination until the next boot. The hidden copy satisfies that rule without restoring the retired prior-folder rollback behavior. No spec conflict, proof ambiguity, new dependency or new test hook was found. The existing `^templates-install-t-retry` citation covers the strengthened and added cases; all five slice 4 proof citations remain unchanged. Guidance source, built guidance and its earlier validation are unchanged.

#### Validation

All commands ran in `/root/workspace/dev/television/feat/toolbox` on the uncommitted tree atop `f0fa32377f8d2fa7d897976e72bbbace9b0d3d12`. Only the installer and its test file changed since the preceding slice 4 handoff, apart from this record. The updated source/test/proof manifest is `scratch/linked-templates-slice4-review-tree.json`, SHA-256 `945af03f2639ad8ee5136816b27149964a4e5f1b7d882d5cafdd8d1c9ade5949`. It excludes this record. The original manifest remains as historical evidence.

Times below are UTC and identify `.test-runs/2026-10-23T<timestamp>-*/summary.json` and native reports. Filtered cases are not skips.

| UTC start | Exact command | Result and tree stage |
|---|---|---|
| 15:24:39 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'supporting-file copy\|interrupted hidden copy'` | 1 passed, 2 failed, 20 filtered; original implementation. The stale-copy cases failed, but the first socket filename, `support.js`, failed copying before the required page arrived, so it did not expose the reported reboot defect |
| 15:27:18 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'supporting-file copy\|interrupted hidden copy'` | 3 failed, 20 filtered; original implementation with the socket at `runtime.js`. Reproduced the reported defect: after reboot the ID was handled while the supporting script was absent |
| 15:28:17 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'finishes backup\|supporting-file copy\|interrupted hidden copy'` | 4 failed, 19 filtered; original implementation with the added complete-copy order and absent-destination assertions |
| 15:28:50 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts --grep 'finishes backup\|supporting-file copy\|interrupted hidden copy'` | 4 passed, 19 filtered; final correction |
| 15:31:48 | `npm test -- local --file packages/server/test/bundled-template-installation.test.ts` | 23 passed; final correction |
| 15:32:28 | `npm test -- local --surface unit:server` | 1,154 passed, 1 existing privileged-port permission skip; final correction, after type-check and the narrow tests completed |

Additional validation on the final source/test bytes:

- `npm run type-check`: passed.
- `npx eslint packages/server/src/bundled-template-installer.ts packages/server/test/bundled-template-installation.test.ts --max-warnings=0`: passed.
- `git diff --check && git diff --exit-code -- specs storybook/spec`: passed; no specification changes.

All six canonical runs above recorded zero recovered flakes, process leaks and infrastructure failures. The red failures were expected test failures. The server suite passed on its first run of this correction; no additional intermittent failure occurred. Small filesystem probes established the socket ordering for the revised fixture; their temporary directories were removed. Installer fixture homes and sockets were cleaned by the tests. No full `npm run verify`, commit, push, package installation, host CLI install/link or host-home server occurred.

**Remaining baseline versus the plan:** no allocated linked-template test failure remains in the selected checks. The reported partial-copy defect is corrected and the required suites pass; independent re-review and full verification still belong to the supervisor. Earlier browser limitations and intermittent failures remain documented above. The guidance and all other slice 4 source/test/proof bytes still match the original handoff manifest. Final `git diff --check` passed, and all source/test/proof hashes match the review manifest.


### Toolbox layout and blank-store guidance follow-up — October 23, 2026

**Complete within the requested scope; uncommitted and unpushed.** Work stayed in `/root/workspace/dev/television/feat/toolbox` on `feat/toolbox`, HEAD `10a8f3afe6d56ababcdd034bce5c809b125343a4`. The final approved design has a fixed footer in every state: “Ask your agent to add artifacts to your toolbox, then reuse them anywhere.” The empty-directory message is “Nothing here yet.” The search gap belongs to the scrolling body. Production renders that design, and `toolbox.css` is byte-identical to the approved story stylesheet. The four approved spec/story files were not changed by the implementer; their final-design hashes are preserved in `scratch/linked-templates-followup-approved.json`.

Extended the existing [conformance assertion](../../proofs/ui/app/toolbox.md#^toolbox-t-conformance), [browser-input assertion](../../proofs/ui/app/toolbox.md#^toolbox-t-browser-input), and [message assertion](../../proofs/ui/app/toolbox.md#^toolbox-t-messages). Conformance covers the rendered states. The two existing browser tests additionally prove that the initial gap scrolls away, search and footer stay fixed, and the footer survives pending, empty, unmatched and error states. Footer promises cite `toolbox-layout`; no `toolbox-footer` anchor remains. No test file, fixture, hook or test case was added.

Added “Start from a blank store” under “Author a template” in the delivered template guidance. It explains Toolbox creation without data, page controls that write only when a person acts, and an empty message suggesting the agent when the agent supplies content. Moved the existing missing-value, partial-data and no-default-writes instruction into this section without changing it. The [authoring assertion](../../proofs/arch/templates/authoring.md#^templates-guide-t-authoring) and existing real skills-build check cover the instruction reaching the delivered guide; they do not claim to enforce it on arbitrary authored pages.

Independent review used a separate read-only Codex context with GPT-6 Astra at `xhigh`, thread `01a169aa-986e-7270-b482-1410bcd45ab8`. Review of the final approved specs and derived proofs returned PASS. Review of the implementation, tests and proofs also returned PASS with no actionable findings or simplification/architecture changes. Reports are `scratch/codex/toolbox-followup-review/proof-result-final.txt` and `implementation-result.txt`. This is scoped follow-up review, not integrated review of the whole branch.

#### Validation

All test commands below ran locally with the prefix `TMPDIR="$PWD/scratch/linked-templates-followup-tmp"`. Times are UTC on October 23. Each timestamp locates its `.test-runs/2026-10-23T<timestamp>-*/summary.json` and native report; the exact paths and counts are collected in `scratch/linked-templates-followup-validation.json`. Filtered cases are not skips. The runner records dirty HEAD tree `7aab84c8209877218fda22c4d75f6b9c0aa75743`, not a snapshot of the edits.

| UTC start | Exact command after the temporary-directory prefix | Result |
|---|---|---|
| 16:57:08 | `npm test -- local --file test/repo/skills-build.test.ts --grep "emits template discovery and authoring guidance"` | Expected red: 1 failed, 11 filtered; blank-store instruction absent |
| 16:57:08 | `npm test -- local --file packages/web/test/e2e/toolbox.test.ts --retries 0` | Expected red: 2 failed; scrolling boundary was 6px below the field and footer was absent |
| 16:58:35 | `npm test -- local --surface e2e:toolbox-conformance --grep "spec-toolbox--open$" --retries 0` | Expected red: 1 failed; missing footer and incorrect clipping/layout |
| 16:59:15 | `npm test -- local --file test/repo/skills-build.test.ts --grep "emits template discovery and authoring guidance"` | 1 passed, 11 filtered |
| 16:59:43 | `npm test -- local --file test/repo/skills-build.test.ts` | 12 passed |
| 16:59:43 | `npm test -- local --file test/repo/spec-links.test.ts` | 8 passed |
| 17:00:30 | `npm test -- local --file packages/web/test/e2e/toolbox.test.ts --retries 0` | 2 passed |
| 17:02:14 | `npm test -- local --surface unit:browser-app` | 586 passed, 1 existing ACP fake-server disconnect skip |
| 17:02:15 | `npm test -- local --surface e2e:toolbox-conformance --retries 0` | 19 passed: all 18 stories and the MDX documentation check |
| 17:06:58 | `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --retries 0` | 10 passed |
| 17:08:03 | `npm test -- local --file packages/web/test/e2e/template-cache.test.ts --retries 0` | 3 passed |

The red runs used unchanged production code and guidance with the final approved stories and extended assertions. Guidance source/test/proof bytes were final from the focused green run onward. Toolbox source/test/proof bytes were final from the browser green run onward. The final manifest of all changed source, test, proof and approved specification files, excluding this task record, is `scratch/linked-templates-followup-final-tree.json`, SHA-256 `05a8b0105998e977991545ece9e047b6318b4096c9b509236e88e0828c286f83`. Closing byte checks matched it and the approved-file manifest.

Additional checks passed:

- `npm run type-check`.
- `npx eslint packages/web/src/views/toolbox.ts packages/web/test/e2e/toolbox.test.ts test/repo/skills-build.test.ts --max-warnings=0`.
- `cmp storybook/spec/toolbox/styles.css packages/web/src/views/toolbox.css`.
- `git diff --check`, including this final record update.

All 11 canonical runs recorded zero recovered flakes, process leaks and infrastructure failures. The only failures were the three intentional red runs. Browser checks used Chromium with retries disabled; Firefox is unavailable on this host. Build warnings about bundle size, canonical CSS resolved at runtime and Storybook/Vite imports did not fail validation. The existing Storybook dev server on port 6106 was left running; conformance used its registered build and temporary test services. No second Storybook dev server was started.

Removed the task-owned temporary directory after confirming no process retained its `TMPDIR`. Canonical reports, small logs and validation manifests remain. No full `npm run verify`, commit, push, package installation or host CLI installation occurred. All selected follow-up checks pass; integrated branch review, full verification and pre-merge docs prep remain with the supervisor.

### Slice 5 — copy-only templates with starting data — October 23, 2026

**Complete within the requested scope.** The approved root `$async` rejection clears the blocker, all requested checks pass, and independent review has no findings. The earlier blocked handoff is retained below; the correction and final results are at the end of this section. Nothing is committed or pushed.

Implementing the approved spec delta `2463776..f6c0a63`. Proofs are updated before tests and code. Folder templates produce independent copies using filesystem cloning when available; root manifest/data stay with the template. Optional starting data is scan-validated and caller data replaces it, including null. CLI copy controls, linked-template paths and detach/compatibility guidance are retired. Existing scan cache, icons, display precedence and installer recovery remain. Guidance includes saving an artifact to the toolbox as a snapshot.

Validation uses canonical targeted checks followed by the requested owning suites, with fresh temporary homes. No full verify, host CLI install/link, commit or push is authorized. Results and proof review will be recorded below.

Independent proof review by a separate GPT-6 Astra agent at `xhigh` passed all changed proofs with no blockers. The root browser red run failed because two template creations returned the same installed folder. CLI red rejected neither the obsolete flag nor its help entry; scanner red exposed missing validation of starting data. Guidance red exposed the obsolete instructions; the focused and complete skills-build tests subsequently passed.

A schema issue remains pending a maintainer decision. The synchronous scan must validate starting data, while Ajv treats its nonstandard `$async` flag as asynchronous validation. Rewriting that flag changes schema-local references. The governing sentences are “Optional manifest `dataSchema` must be a valid JSON Schema Draft 2020-12 schema” and “References resolve only within `dataSchema` itself.” The maintainer was asked whether to explicitly reject the Ajv extension or retain it and convert scanning and its callers to async. No spec decision has been inferred; independent work continues.

The owning CLI/shared/browser-app run passed 964 tests with one existing ACP fake-server disconnect skip. The owning server run passed 1,154 tests with one existing privileged-port permission skip. Both recorded zero recovered flakes, process leaks and infrastructure failures. Exact per-run records are in `scratch/slice5-clients-validation.json` and `scratch/slice5-server-validation.json`.

Two test-environment issues were kept separate from product failures. Starting spec-links while a server test removed a fixture caused the canonical runner’s package discovery to fail with `ENOENT` inside the checkout-local temporary directory, before tests started; subsequent canonical invocations are serialized. A Unix-socket obstruction fixture used a 123-byte path exceeding Linux’s socket-address limit and timed out. A short-path isolated rerun passed, then the full server suite passed using `TMPDIR=/tmp/tv-s5-server`; that task-owned directory and the intermediate `.t5` directory were removed. No product or test code was changed for either environment issue.

Implementation review used the same independent GPT-6 Astra context at `xhigh`. It found one blocker in the tentative synchronous schema compiler: `{ $async: true, $ref: "#/$async" }` references boolean `true`, but suppressing `$async` by rewriting it to `false` changes that reference. Nested async schemas also remain unresolved. The reviewer found no additional implementation, test, guidance, architecture or simplification issue in the inspected scope. Overall implementation review is FAIL until the schema decision is resolved; passing existing suites does not clear this finding.

#### Changes and proof disposition

- Server creation always copies folder contents with Node's `COPYFILE_FICLONE` option, which permits an ordinary-copy fallback. Root `manifest.json` and `data.json` are excluded; supporting files and the existing symlink handling remain. Template data seeds the store unless caller data is present, including null. Ordinary artifact registration replaces the linked-folder shortcut. Scanner validation reads starting data, checks store limits and the declared schema, and rejects data files on URL templates. The synchronous schema compiler is tentative because of the blocker above.
- CLI and shared request types no longer accept or advertise `--copy`/`copy`. Flat list/show records retain their shape. Toolbox already omits copy, data and display in its request; the changed real-browser test proves it receives template starting data and still handles an unwritten store. Example already had no `data.json`; its README now teaches editing the copied page.
- The delivered skill teaches independent copies, data precedence and saving an artifact to the toolbox as a snapshot. Snapshot guidance includes current store values, null versus unwritten stores, single HTML files, supporting files and URL artifacts. Linked-template, detach and schema-compatibility instructions are removed.
- Retired linking, explicit-copy, detach and compatibility obligations within the affected proofs. Replaced `^templates-ac-copy-detach` with `^templates-ac-copy-lifecycle`, and `^templates-install-t-linked-records` with `^templates-install-t-copied-artifacts`. Added and discharged `^templates-t-clone` and `^templates-guide-t-snapshot`. Updated copied-folder, starting-data, URL rejection, Toolbox, bundled Example and guidance assertions with real test citations. The ordinary shared-folder resource promise is preserved in a separate path-artifact journey. `^templates-t-package` remains `(test to be written)` pending the schema decision; the standing `^templates-t-schema` citation does not resolve that finding.
- Replaced `linked-templates-real-stack.test.ts` with `templates-real-stack.test.ts`: one copied-template journey and one ordinary shared-folder resource journey. Added a real-filesystem clone-option observer and expanded scanner, creation, CLI acceptance, Toolbox and built-guidance coverage. Removed redundant linked/copy permutations, linked-target failure coverage and linked-template content-watcher expectations. Existing cache, icon, display and failure handling tests remain.

The initial Toolbox starting-data run failed during an unexpected app reload with its temporary home inside the Vite-watched checkout. The unchanged test passed with `TMPDIR=/tmp/tv-s5-root`, outside that watched tree. Subsequent Toolbox checks use that short external temporary root. This is recorded separately from product changes; no assertion was weakened.

#### Validation and remaining work

The following final requested selections all passed on the uncommitted tree above `f6c0a6352234d846cb99a07ad884c98f336c9d28`. Together they contain 2,244 passed tests and two existing skips. The recorded Git tree is the committed HEAD tree, not a snapshot of the edits. Times are UTC on October 23 and locate `.test-runs/2026-10-23T<timestamp>-*/summary.json` and native reports.

| UTC start | Exact command | Result |
|---|---|---|
| 18:27:05 | `TMPDIR="$PWD/scratch/slice5-tmp" npm test -- local --file test/repo/skills-build.test.ts` | 12 passed |
| 18:26:53 | `TMPDIR="$PWD/scratch/slice5-tmp" npm test -- local --surface unit:cli,unit:shared,unit:browser-app --run-dir-output scratch/slice5-client-units-run.txt` | CLI 311, shared 67, browser-app 586 passed; 1 existing ACP fake-server disconnect skip |
| 18:35:36 | `TMPDIR=/tmp/tv-s5-server npm test -- local --surface unit:server` | 1,154 passed; 1 existing privileged-port permission skip |
| 18:40:25 | `TMPDIR="$PWD/scratch/slice5-tmp" npm test -- local --file test/node/cli-acceptance.test.ts --run-dir-output scratch/slice5-cli-acceptance-run.txt` | 45 passed |
| 18:44:31 | `TMPDIR="$PWD/scratch/slice5-tmp" npm test -- local --file test/node/cli-assets.test.ts --run-dir-output scratch/slice5-cli-assets-run.txt` | 24 passed |
| 18:45:43 | `TMPDIR="$PWD/scratch/slice5-tmp" npm test -- local --surface e2e:browser-app-real-stack --grep '(templates-real-stack\|template-example-real-stack)\.test\.ts' --retries 0` | 3 passed |
| 18:53:40 | `TMPDIR=/tmp/tv-s5-root npm test -- local --surface e2e:browser-app --grep '(skill-selector\|toolbox\|template-cache)\.test\.ts' --retries 0` | 15 passed |
| 18:58:44 | `TMPDIR=/tmp/tv-s5-root npm test -- local --surface e2e:toolbox-conformance --retries 0` | 19 passed: all 18 stories and the MDX check |
| 19:00:31 | `TMPDIR=/tmp/tv-s5-root npm test -- local --file test/repo/spec-links.test.ts` | 8 passed |

Targeted green runs preceded the owning checks: scanner 41, schema 24, creation 13, changed bundled cases 3, routes 6, CLI contracts/help 71, CLI copy/stdin acceptance 2, guidance 1 and Toolbox starting-data activation 1. The short-path socket case also passed before the full server suite. All 32 completed canonical runs, including expected reds and intermediate failures, are recorded in `scratch/slice5-all-validation.json`; client exact commands and server selections/counts are retained in their respective manifests. The earlier schema-file green preceded the conditional `$async` correction; the owning server run includes it but does not clear the review finding. The clone observer initially missed Node's named export until `syncBuiltinESMExports` was used; the guidance check initially expected the concepts in the wrong order. Those test corrections are distinct from production fixes.

Additional checks passed: `npm run type-check`; the local `node_modules/.bin/eslint` executable over the 20 changed/new TypeScript files listed in `scratch/slice5-eslint-files.json`, with `--max-warnings=0`; `cmp storybook/spec/toolbox/styles.css packages/web/src/views/toolbox.css`; and `git diff --check`. Approved specs, story specifications and dependency manifests are unchanged. The proof index was regenerated without writing the spec index.

All completed canonical reports recorded zero recovered flakes, process leaks and infrastructure failures. The startup package-discovery exception described above occurred before a canonical report was created. Browser runs used Chromium with retries disabled; Firefox is unavailable on this host. Existing build warnings about bundle size, runtime canonical CSS and Storybook/Vite imports did not fail validation.

Removed the task-owned `scratch/slice5-tmp` and `/tmp/tv-s5-root` trees after checking that no process retained them. The server worker had already removed `.t5` and `/tmp/tv-s5-server`. Small logs, validation manifests and canonical reports remain. No full `npm run verify`, dependency installation, host CLI installation/link, commit or push occurred. The existing developer telemetry marker was verified before running Television.

Remaining work is the maintainer's schema choice, its implementation and regression coverage, discharge of `^templates-t-package`, and independent re-review. The pending choice is to explicitly reject Ajv's `$async` extension in the contract or retain acceptance and make scanning and its callers asynchronous. The current tentative compiler must not be treated as conforming or ready to merge.

The final source/test/proof manifest, excluding this record, is `scratch/slice5-final-tree.json`, SHA-256 `2c2857135f95ec197b208035ef2a20a3ccfbe099e3b5b1810575d0a497f54f67`. It records all 37 changed/new/deleted paths outside this record, including the known incomplete compiler. Closing whitespace, approved-spec/dependency and stylesheet checks passed.


#### Approved synchronous schema correction — October 23, 2026

The maintainer resolved the blocker: reject any root `$async` declaration with `$async is not supported in dataSchema`, keep scanning synchronous, and rely on Ajv's existing compile error for a synchronous schema referencing an async subschema. No schema rewriting or async-validator handling is permitted. The owning architecture sentence now records that explicit rejection; no other template contract changes. Regression tests precede the implementation, followed by the schema/scanner files, owning server suite, type-check and independent review. This supersedes the pending decision above.


The correction adds one `Object.hasOwn(schema, "$async")` guard before other schema checks and passes the original schema to Ajv. Validation is a plain synchronous call; no `$async` rewrite, async-validator branch, awaited validator or `ValidationError` handling remains. Three compiler cases cover true, false and the reported `#/$async` reference, and assert the input is unchanged. One case confirms Ajv rejects a synchronous root referencing an async subschema. The scanner's existing invalid-schema table gains true/false cases requiring the exact rejection and the inspection hint. The two tests accepting the extension were removed. Schema and scanner files are green with 26 and 43 cases; both `^templates-t-schema` and `^templates-t-package` now cite passing tests.

A fresh independent GPT-6 Astra context at exact `xhigh` reviewed the spec clarification, then the proof before tests/code, and finally the correction with its scanner/creation callers. All three reviews passed with zero findings. Its simplicity/architecture assessment found the shared compiler guard sufficient, with no traversal or new abstraction. Owning-suite and type-check results follow below.

The first red compiler report renders `$async` as “undefined” in the parameterized test title because Vitest treated it as a placeholder. The title was changed to “root async declaration” without changing the assertions. The red failures still demonstrate the three missing rejections; the nested-async case passed before the correction because Ajv already rejected it.


Final correction validation used fresh temporary homes under `/tmp/tv-s5-async` and the canonical local runner. Exact commands and report paths are also in `scratch/slice5-async-validation.json`. Times below are UTC on October 23. Filtered tests are not skips.

| UTC start | Exact command | Result |
|---|---|---|
| 19:06:50 | `TMPDIR=/tmp/tv-s5-async npm test -- local --file packages/server/test/templates-schema.test.ts --grep 'root.*declaration\|async subschema' --run-dir-output scratch/slice5-async-schema-red-run.txt` | 1 passed, 3 expected failures, 22 filtered |
| 19:07:14 | `TMPDIR=/tmp/tv-s5-async npm test -- local --file packages/server/test/templates-scanner.test.ts --grep '\$async' --run-dir-output scratch/slice5-async-scanner-red-run.txt` | 0 passed, 2 expected failures, 41 filtered |
| 19:07:36 | `TMPDIR=/tmp/tv-s5-async npm test -- local --file packages/server/test/templates-schema.test.ts --run-dir-output scratch/slice5-async-schema-green-run.txt` | 26 passed |
| 19:07:53 | `TMPDIR=/tmp/tv-s5-async npm test -- local --file packages/server/test/templates-scanner.test.ts --run-dir-output scratch/slice5-async-scanner-green-run.txt` | 43 passed |
| 19:08:17 | `TMPDIR=/tmp/tv-s5-async npm test -- local --surface unit:server --run-dir-output scratch/slice5-async-server-run.txt` | 1,158 passed, 1 existing privileged-port permission skip |


`npm run type-check` passed. `node_modules/.bin/eslint packages/server/src/template-schema.ts packages/server/test/templates-schema.test.ts packages/server/test/templates-scanner.test.ts --max-warnings=0` and `git diff --check` passed. All five canonical correction runs recorded zero recovered flakes, process leaks and infrastructure failures. The two red runs failed only on the intended missing rejections; no intermediate implementation failure occurred. The owning server suite contains all updated schema/scanner cases and passed on its first correction run.

The prior CLI, shared, browser, acceptance, assets, skills-build and conformance implementation/tests remain byte-identical to the earlier handoff manifest. This correction changes the compiler, its two test files and the template architecture proof, plus the approved one-sentence schema-spec clarification and this record. The final slice has no remaining `(test to be written)` assertion in the affected template proof and no outstanding schema finding. Full branch verification and merge readiness are outside this requested slice validation.

The task-owned `/tmp/tv-s5-async` directory was removed after checking that no process retained it. Canonical reports and small logs remain. No `npm run verify`, dependency installation, host CLI installation/link, commit or push occurred. The final independent review was PASS at exact `xhigh`; the original rejection/rewrite blocker is resolved.

The corrected source/test/proof/spec manifest, excluding this record, is `scratch/slice5-async-final-tree.json`, SHA-256 `a92f54ab26e6a86ed83207d22f756990442640149d7f9f3151223802d2d7722e`. It supersedes the incomplete handoff manifest while retaining it as history.

### Whole-branch simplify and sanity pass — October 23, 2026

Reviewed `54cd365..17e6e73` against the copy-only specs at `f6c0a63` and the approved root `$async` clarification. Changes remain uncommitted on `feat/toolbox`; specs and stories are unchanged. This pass uses the complexity-inoculation and cold-reader guidance. The prior task entries remain history, not requirements.

Mechanical changes:

- Server/shared: removed the synchronous creation route's unnecessary async/await, redundant dot-directory checks, an unused containment-helper export and a duplicate import; corrected telemetry ownership wording.
- Tests: removed the unshipped `--copy` rejection/help and retired-guidance assertions, an unused thumbnail fixture/assertion, and an unused deferred-promise reject callback. Renamed copied image fixtures and a misleading starting-data variable. Display and failure tests now use their existing `data.json` fixtures without redundant caller-data overrides; the failure helper no longer needs an options argument. Corrected the stdin test title and its proof citation. The 377-line browser acceptance file moved from `skill-selector.test.ts` to `toolbox-acceptance.test.ts` without changing its contents.
- Guidance/proofs: removed linked/detach and retired-test wording, updated current browser citations, aligned the uncertain-write assertion with the common starting-value path, and documented the Toolbox footer. The focused theme-reference check exposed stale fingerprints for the Toolbox story, MDX and stylesheet; after reviewing those authorities against the reference, refreshed the three fingerprints. No authority bytes were edited.

The cleanup changes 44 added / 53 deleted lines outside this record, excluding the unchanged 377-line file move: production 6/8, tests 19/27, guidance and proofs 19/18. It removes one CLI test case; other assertion changes retain positive contract coverage.

Kept the ordinary artifact watcher, copied-symlink repair, icon path boundaries, schema validation, template-cache observation/recovery and response-order guards: each still serves the current contracts. Symlink repair predates this branch. Toolbox CSS remains byte-identical to the authoritative story stylesheet, with no unused classes found. Kept the explicitly retained historical frame, thumbnails and routing assets, historical working documents, and measured timing-baseline entries; the latter are regenerated from actual complete Blaxel measurements. Kept failure/starting-data and ordinary shared-folder resource journeys because they prove current promises.

Judgment raised: `packages/web/package.json` and the lockfile reference a Conform tarball outside the checkout (`../../../../../conform-builds/telepath-computer-conform-0.2.0.tgz`). Recommend selecting a portable published or repository-contained dependency before sharing the branch. No dependency source was guessed or changed.

The production simplification reader and a separate GPT-6 Astra reviewer at exact `xhigh` found no remaining mechanical issue after corrections. Independent final verdict: PASS for this cleanup; the dependency-source decision remains raised. Neither reviewer ran tests. Validation uses serialized canonical local invocations with fresh temporary homes under `/tmp/tv-tb-pass`, outside Vite's watched checkout. The developer telemetry marker was already present. Exact commands and results follow below. All requested final selections passed.


#### Validation results

Final owning selections plus the theme-reference check passed **2,248 tests, with two existing skips and no failures** on the uncommitted tree above `17e6e73a4a59a153479725e35d77f0d006b9a576`. The server skip cannot stage privileged-port permission denial on this host; the browser-app skip is the standing ACP fake-server disconnect case. Targeted checks preceded the owning suites. Browser tests used Chromium with retries disabled; Firefox is unavailable.

Two intermediate failures remain recorded. The first theme-reference check failed on stale Toolbox authority fingerprints; the reviewed guidance/fingerprint correction passed its focused rerun and the later skills build. The first full server run passed 1,157 tests, failed the unchanged JSON-store message-limit case after 31.04 seconds (its configured limit is 30 seconds), and skipped the existing privileged-port case. That case passed unchanged in isolation; the subsequent full server run passed 1,158 tests with the same skip. No assertion or timeout was weakened. All 20 canonical runs, including those failures, recorded zero runner-recovered flakes, process leaks and infrastructure failures; the manual server rerun is separate from that automatic-retry count.

Each run-directory output in the commands below points to its canonical `summary.json`, `results.json` and native reports. `scratch/toolbox-sanity/reports.json` collects the exact invocation, report directory, status and counts for all runs. Times are UTC on October 23. Filtered tests were not executed.

| UTC start | Command (`TMPDIR=/tmp/tv-tb-pass` for every row) | Result |
|---|---|---|
| 19:21:37 | `npm test -- local --surface unit:server --grep template --run-dir-output scratch/toolbox-sanity/target-server.run` | unit:server: 127 passed, 1032 filtered |
| 19:24:30 | `npm test -- local --file packages/server/test/templates-failures.test.ts --run-dir-output scratch/toolbox-sanity/target-failures.run` | unit:server: 6 passed |
| 19:24:38 | `npm test -- local --file packages/cli/test/cli.test.ts --grep 'template\|unsupported' --run-dir-output scratch/toolbox-sanity/target-cli.run` | unit:cli: 75 passed, 212 filtered |
| 19:24:45 | `npm test -- local --file test/repo/skills-build.test.ts --grep 'emits template discovery and authoring guidance' --run-dir-output scratch/toolbox-sanity/target-guidance.run` | unit:root: 1 passed, 11 filtered |
| 19:24:48 | `npm test -- local --file test/repo/theming-reference.test.ts --run-dir-output scratch/toolbox-sanity/theming-reference.run` | unit:root: 0 passed, 1 failed |
| 19:26:23 | `npm test -- local --file packages/web/test/template-cache.test.ts --run-dir-output scratch/toolbox-sanity/target-cache.run` | unit:browser-app: 5 passed |
| 19:26:26 | `npm test -- local --file test/node/cli-acceptance.test.ts --grep 'reads piped stdin' --retries 0 --run-dir-output scratch/toolbox-sanity/target-stdin.run` | e2e:node: 1 passed, 44 filtered |
| 19:26:52 | `npm test -- local --file test/repo/theming-reference.test.ts --run-dir-output scratch/toolbox-sanity/theming-reference-2.run` | unit:root: 1 passed |
| 19:26:55 | `npm test -- local --file packages/web/test/e2e/toolbox-acceptance.test.ts --retries 0 --run-dir-output scratch/toolbox-sanity/target-browser.run` | e2e:browser-app: 10 passed |
| 19:29:08 | `npm test -- local --surface unit:server --run-dir-output scratch/toolbox-sanity/server.run` | unit:server: 1157 passed, 1 failed, 1 skipped |
| 19:34:53 | `npm test -- local --file packages/server/test/resources/json-store-server.test.ts --grep 'applies a set of placeholders' --run-dir-output scratch/toolbox-sanity/resource-limit.run` | unit:server: 1 passed, 9 filtered |
| 19:35:32 | `npm test -- local --surface unit:server --run-dir-output scratch/toolbox-sanity/server-2.run` | unit:server: 1158 passed, 1 skipped |
| 19:41:04 | `npm test -- local --surface unit:cli,unit:shared,unit:browser-app --run-dir-output scratch/toolbox-sanity/clients.run` | unit:cli: 310 passed; unit:shared: 67 passed; unit:browser-app: 586 passed, 1 skipped |
| 19:43:35 | `npm test -- local --file test/node/cli-acceptance.test.ts --retries 0 --run-dir-output scratch/toolbox-sanity/cli-acceptance.run` | e2e:node: 45 passed |
| 19:47:36 | `npm test -- local --file test/node/cli-assets.test.ts --retries 0 --run-dir-output scratch/toolbox-sanity/cli-assets.run` | e2e:node: 24 passed |
| 19:48:49 | `npm test -- local --file test/repo/skills-build.test.ts --run-dir-output scratch/toolbox-sanity/skills-build.run` | unit:root: 12 passed |
| 19:49:09 | `npm test -- local --file test/repo/spec-links.test.ts --run-dir-output scratch/toolbox-sanity/spec-links.run` | unit:root: 8 passed |
| 19:49:20 | `npm test -- local --surface e2e:browser-app --grep '(toolbox-acceptance\|toolbox\|template-cache)\.test\.ts' --retries 0 --run-dir-output scratch/toolbox-sanity/browser.run` | e2e:browser-app: 15 passed |
| 19:52:59 | `npm test -- local --surface e2e:toolbox-conformance --retries 0 --run-dir-output scratch/toolbox-sanity/conformance.run` | e2e:toolbox-conformance: 19 passed |
| 19:57:04 | `npm test -- local --surface e2e:browser-app-real-stack --grep '(templates-real-stack\|template-example-real-stack)\.test\.ts' --retries 0 --run-dir-output scratch/toolbox-sanity/real-stack.run` | e2e:browser-app-real-stack: 3 passed |

`npm run type-check` and `npm run lint` passed both initially and again after the final test-helper/title edits; final logs are `scratch/toolbox-sanity/type-check-final.log` and `scratch/toolbox-sanity/lint-final.log`. `cmp storybook/spec/toolbox/styles.css packages/web/src/views/toolbox.css`, the no-diff check for specs/stories/dependency manifests, and `git diff --check` passed. Existing bundle-size and Storybook/Vite dynamic-import warnings did not fail checks.

The source/test/proof/guidance manifest is `scratch/toolbox-sanity/final-tree.json`, SHA-256 `e2a45a19a44649caec8c9681e3a16d6975fe16b93796ef027fac77610c86c576`. It excludes this task record and matches the final bytes. The Git tree reported by the runner is the committed HEAD tree, not a snapshot of the working edits.

Removed `/tmp/tv-tb-pass` after confirming no process retained that `TMPDIR`. Canonical reports and small logs/manifests remain for review. No full `npm run verify`, checkout dependency installation, host CLI installation/link, commit or push was performed. The work remains on the requested branch at the requested HEAD, ready for review of the cleanup and the separately raised dependency-source decision; this is not a claim of full merge validation.

### Toolbox icon continuity fix — October 23, 2026

Implemented on `feat/toolbox` above `bd5788faba03d80b6a2d62ee394267a5f7929e39`, leaving the maintainer-approved template-spec edit uncommitted. No remaining spec contradiction was found. The server compares records and private selected-icon path/size/modification-time signatures; unchanged scans publish nothing. Scan errors and watcher recovery still publish without invalidating unchanged icons. The app keeps existing images while invalidated bytes reload, revokes replaced URLs, removes unavailable/failed icons, and retains the requirement to reload every stale icon after reconnect even when a partial push supersedes the list response.

Updated both template and Toolbox proofs. The native watcher test now changes its selected nested icon rather than an unrelated support file, matching the approved event contract. New regression coverage exercises unchanged scans, isolated icon size/mtime changes, error/recovery publication, image retention across pushes/full fetches/reconnects, failure/removal/disposal, and actual Toolbox creation without a letter fallback. The browser test delays replacement icon transport only; creation, scanning, publication, caching and rendering remain real.

Red runs failed as intended: server cache 3 failures, client cache 5 failures, and browser creation 1 failure (both previously loaded images disappeared). After the fix, targeted server cache (7), template routes (6), client cache (9), and browser creation (1) all passed. An independent GPT-6 Astra reviewer at exact `xhigh` passed the approved spec/proof derivation and complete implementation with no findings; the reviewer did not run tests. Final requested validation passed on the uncommitted working tree:


| Selection | Result |
|---|---|
| `npm test -- local --surface unit:server` | 1,160 passed; 1 existing privileged-port permission skip |
| `npm test -- local --surface unit:browser-app` | 590 passed; 1 existing ACP fake-server disconnect skip |
| `npm test -- local --surface e2e:browser-app --grep '(toolbox-acceptance\|toolbox\|template-cache)\.test\.ts' --retries 0` | 16 passed |
| `npm test -- local --surface e2e:toolbox-conformance --retries 0` | 19 passed: all 18 stories and the MDX check |
| `npm test -- local --file test/repo/spec-links.test.ts` | 8 passed |
| `npm run type-check`; `npm run lint` | Both passed |

Exact invocations, run directories and counts for all 12 canonical runs, including the expected reds, are in `scratch/toolbox-icons/reports.json`; each run has a corresponding `.run` pointer and `.log` in that directory. The first red server run used the ordinary system temporary directory; subsequent canonical commands used `TMPDIR=/tmp/tv-icons`. Type-check and lint logs are retained there too. All canonical reports record zero recovered flakes, process leaks and infrastructure failures. Browser runs used Chromium with retries disabled; Firefox is unavailable on this host. Existing bundle-size, runtime canonical-CSS and Storybook/Vite warnings did not fail checks.

The Toolbox stylesheet-copy check and `git diff --check` passed. The approved architecture spec edit is preserved; no further spec or story changes were needed. Removed the task-owned `/tmp/tv-icons` tree after checking that no process retained it. Small logs and canonical reports remain for review. The developer telemetry marker was already present before running Television. No full `npm run verify`, host CLI installation/link, commit or push occurred. This completes the requested fix and validation, not full branch verification or merge preparation.
