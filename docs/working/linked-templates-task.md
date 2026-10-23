# Linked templates and Toolbox: task record

Working record for `feat/linked-templates`, branched from `feat/artifact-templates` at `54cd365`. The pull request targets `feat/artifact-templates`. The intent is in the updated [templates proposal](templates-proposal.md); the authority is the specs it was drafted into, with the Toolbox specified as `specs/ui/app/toolbox.mdx` and its stories in `storybook/spec/toolbox/`.

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
| Implementation, red/green TDD | Slice 1 complete, including Ajv-only rework and metaschema isolation fix; slices 2–4 not started |
| Integrated result and full verification | Not started |
| Pull request | Not opened |

## Open obligations

- MDX support in the spec index generator.
- MDX support in the spec-links mirror checks (`test/repo/spec-links.test.ts`), which reject the `toolbox.mdx` / `toolbox.md` spec–proof pair.
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

Work is based on `fd654fd5743cdd60895b4292364ab387931881db` on `feat/linked-templates`. Every command below ran in this worktree against its uncommitted tree at the stated stage. The canonical runner records dirty HEAD tree `7b4381aefa4afb5dc4d0efa3a4db072ac5d285ec`; that is not a snapshot of the edits. The final changed source/test/proof/config file set, excluding this record, is SHA-256 `e0a730561894bc7c35dfa4ecd39a7073e04c95a89a1bf7e49ca86865f7c39746` (per-file manifest in ignored `scratch/linked-templates-slice1-tree.json`). Intermediate dirty snapshots were not retained; the timestamped reports identify their selections and results.

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

All commands below ran in `/root/workspace/dev/television/feat/linked-templates` on branch `feat/linked-templates`, dirty HEAD `fd654fd5743cdd60895b4292364ab387931881db` (HEAD tree `7b4381aefa4afb5dc4d0efa3a4db072ac5d285ec`). The red run used the preceding implementation plus the new test row. All subsequent checks used the final source/test tree, unchanged afterward. Its changed source/test/proof/config snapshot, excluding this task record, is SHA-256 `53aa1044728723cf661f91e92cee00f193ad3225426a659b9f6aa82954f11a5f`; the per-file manifest is `scratch/linked-templates-metaschema-isolation-tree.json`.

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
