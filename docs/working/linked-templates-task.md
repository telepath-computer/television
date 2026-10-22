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
| Plan | Not started |
| Implementation, red/green TDD | Not started |
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
