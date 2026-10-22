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
| Spec convergence | Round 1 PASS with four non-blocking findings; three applied, one deferred to implementation; follow-up review running |
| Proof derivation | Not started |
| Proof convergence | Not started |
| Plan | Not started |
| Implementation, red/green TDD | Not started |
| Integrated result and full verification | Not started |
| Pull request | Not opened |

## Open obligations

- MDX support in the spec index generator.
- Pre-merge docs prep before the work is treated as ready to merge.

## Validation

None yet.
