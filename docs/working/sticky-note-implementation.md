# Sticky note merge adaptation

The first-merge record below is retained as history. The current Calendar re-merge is recorded under **Second merge: Calendar base `e5326a8`** at the end of this document.

This records the resolution of the in-progress merge of `e6f12ef05ac8617ec88a96058a60a5c9230d6d4d` into `feat/artifact-template-sticky-note`, at unchanged HEAD `475da061ac7fcca783ea4d2615b975620a767f68`. It replaces the earlier implementation ledger for the current task; that ledger remains in HEAD. The merge remains uncommitted. No abort, push, host installation or linking of `tv` was performed.

The merge starts from the finished templates branch in every conflicted file, then reapplies the Sticky note delta from `810aafa..475da06`. The audit also restores clean-merged old Checklist changes to the base where they had survived. Sticky note page/model/styles, UI MDX and stories remain byte-identical to `475da06`.

## The 29 conflict resolutions

- `packages/server/src/bundled-template-ids.ts` — Retained the base's inventory module and extended its readonly tuple to `['checklist', 'sticky-note']`.
- `packages/server/src/telemetry/derivation.test.ts` — Retained the base's telemetry suite and restored Sticky note classification for CLI/UI plus differently cased IDs becoming `custom`.
- `packages/server/test/bundled-template-installation.test.ts` — Retained every base installation/recovery test; restored validation for both packages and independent installation/failure coverage; adapted exact state, cache, atomic-write and failure/retry assertions for two bundled IDs.
- `packages/server/test/checklist-template.test.ts` — Retained the base's SVG icon delivery test and its replacement of thumbnail checks; restored the exact two-template inventory and both manifest identities/minimum versions.
- `packages/skills/skills/television/src/app-shell-reference.md` — Kept the base Toolbox reference; moved the transparency source link and refreshed only reviewed source fingerprints.
- `packages/web/playwright.config.ts` — retained the base’s wildcard conformance exclusion and real-stack list, adding Sticky note real-stack coverage to the exclusion list.
- `packages/web/playwright.real-stack.config.ts` — retained the base’s real-stack tests, including templates creation, and added the Sticky note real-stack file.
- `packages/web/test/e2e/template-checklist-conformance.test.ts` — took the finished base Checklist test unchanged, including its shared conformance helpers and current proof citations.
- `packages/web/test/e2e/template-checklist-real-stack.test.ts` — kept the finished base Checklist tests, switching their harness import and startup to the shared `TemplateHarness` with Checklist identity.
- `proofs/arch/telemetry/derivation.md` — Kept the base telemetry proof and extended exact bundled-ID classification to Checklist and Sticky note.
- `proofs/arch/templates/bundled-installation.md` — Kept base recovery, interruption and removal contracts; reapplied two-template validation, copying and independent installation evidence.
- `proofs/arch/templates/bundled-templates.md` — Kept the base proof structure and restored both package identities, versions and the two-ID tuple.
- `proofs/arch/templates/index.md` — Kept base schema/cache/icon contracts and linked both template data-shape and UI proofs.
- `proofs/index.md` — Regenerated from the merged proof tree with node scripts/specs-index.mjs, including the moved sibling Markdown proofs.
- `proofs/product/licensing.md` — Kept the base licensing acceptance and restored Sticky note font, source-folder and packed-notice coverage.
- `proofs/product/templates.md` — Kept base Toolbox/URL/schema journeys, added Sticky note alongside Checklist and repaired the transparency proof link.
- `specs/arch/templates/bundled-installation.md` — Kept base replacement recovery and generalized the inventory links and plural IDs for both templates.
- `specs/arch/templates/bundled-templates.md` — Kept Checklist and restored the Sticky note row and exact two-ID inventory.
- `specs/arch/templates/index.md` — Kept the full base folder/cache/schema/icon architecture and generalized its package-owner link.
- `specs/index.md` — Regenerated from the merged spec tree with node scripts/specs-index.mjs.
- `specs/product/templates.md` — Kept base Toolbox, URL and schema behavior; restored the statement that each bundled template owns its architecture and UI specs.
- `specs/spec-migration.md` — Kept base Toolbox and retained-surface boundaries; added Sticky note, icon ownership and the relocated transparency spec.
- `test.config.mjs` — kept the base’s shared `e2e:conformance` group and `cwd: "."`; added Sticky note conformance and real-stack roots plus browser-app exclusions.
- `test.prebuilt.mjs` — kept the base’s single Storybook recipe covering `e2e:conformance`; removed the obsolete per-template groups.
- `test/node/cli-assets.test.ts` — Kept base build/resolver checks; restored both-template byte-copy coverage and required both packages, README files and SVG icons.
- `test/repo/licensing-generator.test.ts` — Kept base generator checks; restored the Sticky note package and story folders to generated notice expectations.
- `test/repo/test-runner-config.test.ts` — kept the base’s shared conformance expectations and added explicit ownership checks for Sticky note conformance and real-stack files.
- `test/repo/test-runner-provider.test.ts` — retained the base’s package-selection expectation with only the shared `e2e:conformance` surface.
- `test/repo/theming-reference.test.ts` — Kept base current-authority inventory and retired-selector exclusion; repointed transparency MDX to its spec location.

## Other adaptations

- Rebuilt `template-harness.ts` from the base Checklist harness, preserving `TEST_HOST_LAUNCH`, Toolbox creation and the supplied-icon row check, and reapplying Sticky note’s per-template identity, rich clipboard input and clipboard-reading helpers. Both real-stack suites now use it; the duplicate `checklist-harness.ts` is deleted.
- Migrated Sticky note conformance onto `conformance-harness.ts`: shared browser lifecycle, server/client, per-test proxy, Storybook (`TV_SPEC_STORYBOOK_URL`), artifact creation/URLs and story discovery. Kept Sticky note’s state definitions, font-readiness checks and rendered comparison size unchanged.
- Pointed shared conformance setup and harness imports at `template-harness.ts`. The retired `template-conformance-setup.ts` duplicated the base setup; no unique setup behavior required preservation.
- Deleted both old template-specific Playwright conformance configs, `config/vite.checklist-storybook.ts` and `scripts/test/build-checklist-conformance.mjs`.
- Updated the clean-merged `test-runner-prebuilt.test.ts` addition to expect the shared conformance surface.
- Sticky note creation test now says “from Toolbox” and uses the shared Toolbox/icon creation walk.
- Updated Sticky note and artifact-frame transparency test citation comments to the new beside-the-MDX proof locations. The base Checklist tests already use their new proof paths.
- Checked template tests for reliance on template-list `path`; there is none in this slice. Sticky note’s artifact `path` read remains valid and is not a template-list read.

- Moved `proofs/ui/templates/sticky-note/index.md` to `proofs/ui/templates/sticky-note.md` and `proofs/ui/app/artifact-frame/transparency/index.md` to `proofs/ui/app/artifact-frame/transparency.md`; adjusted outgoing relative links and all incoming spec/proof links and test comments.
- Removed the stale `proofs/ui/app/templates-popover/index.md` and old Checklist `index.md` proof; base Toolbox and `proofs/ui/templates/checklist.md` remain authoritative.
- Sticky note creation proofs now use Toolbox, observe the supplied row icon and cite the renamed creation test. Font proof keeps byte identity; a separate scanner contract replaces thumbnail checks with icon selection.
- The transparency proof no longer claims to use the obsolete Templates popover proof arrangement. Its browser behavior and visual-review boundary remain unchanged.
- The theme-reference proof now identifies Toolbox authority and retained historical selector assets.
- `specs/arch/ui/conformance.md` is byte-identical to e6f12ef; that version contains no stale artifact-frame MDX link to repair.
- The chosen Sticky note SVG and Checklist `icon.svg` are first-party files. Checklist licensing covers its inline Phosphor controls in `index.html`; Sticky note already has the equivalent Phosphor record and its Caveat notices. No third-party entry is needed for the chosen SVG.

## Stale clean-merge files restored to the base

- `proofs/ui/markdown-editor/index.md` — restored base.
- `proofs/ui/setup/index.md` — restored base.
- `proofs/ui/templates/checklist/index.md` — deleted; absent from base.
- `specs/product/tab-pages.md` — restored base.
- `specs/ui/app/copy-button/index.md` — restored base.
- `specs/ui/app/index.md` — restored base.
- `specs/ui/app/skill-selector/content.yml` — restored base.
- `specs/ui/app/skill-selector/skill-selector.frame` — restored base.
- `specs/ui/app/skill-selector/thumbnails/calendar.png` — restored base.
- `specs/ui/app/skill-selector/thumbnails/markdown.png` — restored base.
- `specs/ui/app/skill-selector/thumbnails/table.png` — restored base.
- `specs/ui/app/skill-selector/thumbnails/tasks.png` — restored base.
- `specs/ui/markdown-editor/index.md` — restored base.

- Restored `frameset.json`, the retained toolbar selector frame, both old popover experiment story modules and the retained popover MDX to the base. Removed old Checklist thumbnail/capture files, moved popover thumbnails and the old Checklist conformance report that are absent from the base. These are historical base assets, not restored production popover behavior.
- Copied the chosen `b.svg` exactly to Sticky note `icon.svg`; replaced the thumbnail package assertion with the same real validator/icon-selector contract used by Checklist. Rendered the unchanged SVG at 20 pixels on light and dark backgrounds; the writing and folded corner remain legible. The existing font/Phosphor licensing records remain; the chosen SVG needs no third-party notice. Extended packed-folder licensing coverage to assert both bundled templates.
- Read the artifact-frame reference prose against the relocated transparency MDX and its story/style sources before refreshing the two changed fingerprints. Kept the base Toolbox text and the base app-index fingerprint.
- Repaired three local links in the artifact-frame proof after the first spec-links run caught them.
- Updated the working plan to use icons, Toolbox, shared conformance and the moved proof links, with the validation scope requested for this merge.

- The full server surface exposed one clean-merged onboarding test expecting only Checklist. Extended its manifest-presence and initial-cache assertions to both templates; startup order, scan count, watcher count and cleanup assertions remain unchanged. The focused case and independent follow-up review passed.

## Specification changes for owner approval

The following lists the merge result against the templates base. Changes retained verbatim from the owner-approved Sticky note commits are identified separately from adaptations. No Sticky note behavior or story appearance changed.

### Base-forced change to the approved Sticky note architecture

`specs/arch/templates/sticky-note.md`

Old:

> The template includes `thumbnail.png`, a square screenshot of the UI story `WithText` at 360 by 360 pixels, preserving the transparent background. The [Templates popover UI spec](../../ui/app/templates-popover.mdx) owns how the image is displayed.

New:

> The manifest’s `icons` lists one entry, `icon.svg`: a square SVG of a yellow note with writing and a folded corner. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-sticky-note-icon

### Adapted onto the base architecture and migration structure

`specs/arch/templates/index.md`

- Old: “lists the shipped templates; [Checklist](./checklist.md) owns its package and store contract.” → new: “lists the shipped templates and links to the architecture spec for each package and store contract.”

`specs/product/templates.md`

- Old: “[Checklist architecture](../arch/templates/checklist.md) owns the Checklist's display size and store contract; [its UI spec](../ui/templates/checklist.mdx) owns its page.” → new: “Each template has an architecture spec for its display options and store contract, and a UI spec for its page.”

`specs/spec-migration.md`

- Old: “[arch/templates/checklist.md](arch/templates/checklist.md) for the Checklist display size, store contract, icon, and README guidance;” → new: “[arch/templates/checklist.md](arch/templates/checklist.md) and [arch/templates/sticky-note.md](arch/templates/sticky-note.md) for the bundled pages, display options, store contracts, icons, and README guidance;”.
- Old: “The [Checklist page](ui/templates/checklist.mdx) has UI authority in its MDX spec.” → new: “The [Checklist page](ui/templates/checklist.mdx) and [Sticky note page](ui/templates/sticky-note.mdx) have UI authority in their MDX specs.”
- Old: “Toolbox, Checklist template page,” → new: “Toolbox, Checklist and Sticky note template pages,”.
- Old: “[Toolbox](ui/app/toolbox.mdx) and the [Checklist page](ui/templates/checklist.mdx) are MDX specs” → new: “[Toolbox](ui/app/toolbox.mdx), the [Checklist page](ui/templates/checklist.mdx) and the [Sticky note page](ui/templates/sticky-note.mdx) are MDX specs”.
- Old: “The artifact frame transparency stories retain their separate [pilot arrangement](ui/app/artifact-frame/index.md).” → new: “The [artifact frame transparency spec](ui/app/artifact-frame/transparency.mdx) retains its separate [pilot arrangement](ui/app/artifact-frame/index.md).”
- Old: “Toolbox and the Checklist page are under it.” → new: “Toolbox and the Checklist and Sticky note pages are under it.”

### Other Sticky note spec changes retained (theme scope adapted after review)

`specs/arch/licensing.md`

- Old: “it for the vendored typeface;” → new: “it for vendored typefaces;”.
- Old: “copies each theme's complete source folder into the user's data directory.” → new: “copies each theme's complete source folder into the user's data directory, and [bundled artifact templates](./templates/bundled-installation.md) carry their dependencies into each copied artifact.”

`specs/arch/telemetry/derivation.md`

- Old: “[bundled package folder ID](../templates/bundled-templates.md#^bundled-artifact-template-inventory)” → new: “[bundled package folder IDs](../templates/bundled-templates.md#^bundled-artifact-template-inventory)”.

`specs/arch/templates/bundled-installation.md`

- Old: “owns IDs, names, descriptions, and versions; [Checklist](./checklist.md) owns its display size, initial data, page packaging, and README guidance;” → new: “owns IDs, names, descriptions, and versions, and links to each template's display options, initial data, page packaging, and README guidance;”.
- Old: “[bundled ID](./bundled-templates.md#^bundled-artifact-template-inventory)” → new: “[bundled IDs](./bundled-templates.md#^bundled-artifact-template-inventory)”.

`specs/arch/templates/bundled-templates.md`

- Old: “(no Sticky note inventory row)” → new: “| `sticky-note` | Sticky note | A yellow note to type into; an agent can write on it too. | `1.0.0` | `1.0.0` | [Sticky note](./sticky-note.md) | [Sticky note page](../../ui/templates/sticky-note.mdx) |”.
- Old: “`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist']`” → new: “`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'sticky-note']`”.

`specs/arch/themes/authoring.md`

- Old: “- Compare the source files recorded in the reference with the current app UI authorities: every `.frame` and `.css` file under `specs/ui/app/`; `specs/ui/app/index.md`, which defines the app document marker; and the Storybook stories, MDX pages and stylesheets to which an app UI spec delegates authority. Missing, additional, or duplicate source entries fail the check.” → new: “- Compare the source files recorded in the reference with the current authoritative `.frame` and `.css` files under `specs/ui/app/`, plus `specs/ui/app/index.md`, which defines the app document marker, every `.mdx` spec under `specs/ui/app/` together with the story module it names and the stylesheet those stories import. Missing, additional, or duplicate source entries fail the check.”

`specs/product/licensing.md`

- Old: “prebuilt onboarding artifacts, bundled themes, and *vendored assets*” → new: “prebuilt onboarding artifacts, bundled themes and artifact templates, and *vendored assets*”.
- Old: “bundled views, installed skills, bundled themes — is read” → new: “bundled views, installed skills, bundled themes and artifact templates — is read”.
- Old: “on that list for the vendored typeface.” → new: “on that list for vendored typefaces.”
- Old: “fine for a typeface we embed unmodified and wrong for code.” → new: “fine for bundled typefaces kept under OFL with reserved-name restrictions respected, and wrong for code.”

`specs/ui/app/artifact-frame/index.md`

- Old: “[Storybook spec](../../../../storybook/spec/artifact-frame/artifact-frame.mdx)” → new: “[Transparency spec](transparency.mdx)”.

`specs/ui/app/stage/index.md`

- Old: “[transparent frame](../../../../storybook/spec/artifact-frame/artifact-frame.mdx)” → new: “[transparent frame](../artifact-frame/transparency.mdx)”.

- `specs/ui/templates/sticky-note.mdx` and `specs/ui/app/artifact-frame/transparency.mdx` remain byte-identical to `475da06`; their complete original prose, imports, stories and layout are retained.
- The remaining Sticky note architecture prose also remains byte-identical to `475da06`; only the quoted thumbnail/icon paragraph changed.
- Regenerated spec/proof index entries are listed below with the index command.

The theme-reference inventory wording is additionally narrowed to “current authoritative `.frame` and `.css` files” because the base retains retired selector assets without current UI authority. The base test deliberately excludes that frame.

`specs/index.md` and `proofs/index.md` were regenerated by `node scripts/specs-index.mjs` (147 specs, 130 proofs); entries now include Sticky note and the relocated transparency MDX/proofs, with the base Toolbox entries retained. `specs/arch/ui/conformance.md` is unchanged from the base, which has no old artifact-frame MDX link.

The generated spec-index changes against the base are:

- `arch/templates/bundled-templates.md`: “(11 lines)” becomes “(12 lines)”.
- Added under `arch/templates/`: “`sticky-note.md` (49 lines) — *The bundled Sticky note artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*”
- Added under `ui/app/artifact-frame/`: “`transparency.mdx` (38 lines) — *UI spec: the artifact frame’s transparent state, hover behaviour and resize appearance.*”
- Added under `ui/templates/`: “`sticky-note.mdx` (82 lines) — *UI spec: the bundled Sticky note page, for text that a person and an agent can edit together.*”

## Review

Independent review used `gpt-6-astra` at `xhigh` and returned PASS after correcting the current-authority wording, two proof descriptions and test-name citations. Review checked actual code, specs, proofs, fixture coverage, the supplied SVG and removal of obsolete files. It did not run tests; execution results follow below. A final code-shape inspection found no further simplification or architecture change warranted: the result retains the base conformance helpers and one shared real-stack template harness.

## Executed validation commands

Every canonical test command used `TV_PW_WORKERS=1` and `--retries 0`. Results are the runner’s normalized results, not inferred from progress output. Evidence paths are relative to the checkout unless absolute.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm install` | Exit 1; 5.4 s | `/tmp/sticky-merge-install.log` |
| `npm install` | Exit 0; 7.2 s | `/tmp/sticky-merge-install-retry.log` |
| `node scripts/specs-index.mjs` | Exit 0; 0.2 s | `/tmp/sticky-merge-specs-index.log` |
| `npm run type-check` | Exit 0; 36.8 s | `/tmp/sticky-merge-type-check.log` |
| `npm run lint` | Exit 0; 24.2 s | `/tmp/sticky-merge-lint.log` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/server/test/sticky-note-template.test.ts --retries 0` | Exit 0; 3.9 s; 4 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-16-561Z-p307597-r01c1ccd4dbfe8cc0/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/server/test/sticky-note-model.test.ts --retries 0` | Exit 0; 3.1 s; 29 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-20-491Z-p307964-r1966a421427b6c94/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/server/test/checklist-template.test.ts --retries 0` | Exit 0; 3.3 s; 4 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-23-812Z-p308557-r8fc4f8b8c50ba20f/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/server/test/bundled-template-installation.test.ts --retries 0` | Exit 0; 20.8 s; 23 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-27-124Z-p309178-r5e9a8c0ed586a9bf/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/server/src/telemetry/derivation.test.ts --retries 0` | Exit 0; 3.6 s; 104 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-47-862Z-p313062-rafc1bdba04ec1672/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/licensing-config.test.ts --retries 0` | Exit 0; 3.6 s; 21 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-51-785Z-p313227-r6a048f56faa0bf29/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/licensing-gate.test.ts --retries 0` | Exit 0; 3.2 s; 10 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-55-366Z-p313802-rdf2247c405c76525/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/licensing-generator.test.ts --retries 0` | Exit 0; 5.2 s; 18 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-43-58-864Z-p314167-raf60af623816b63e/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/licensing-publishable.test.ts --retries 0` | Exit 0; 11.8 s; 7 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-44-04-387Z-p315772-rec43fd533f6cb12e/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/spec-links.test.ts --retries 0` | Exit 1; 4.4 s; 6 passed, 2 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-44-16-208Z-p318424-rbb6998804472fa04/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/spec-links.test.ts --retries 0` | Exit 0; 3.9 s; 8 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-45-30-798Z-p326385-ra466aba7b5e55f47/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/specs-index.test.ts --retries 0` | Exit 0; 2.8 s; 2 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-45-34-763Z-p326984-r70b59c63bba6938b/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-attestation.test.ts --retries 0` | Exit 0; 12.5 s; 44 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-45-37-680Z-p327248-rcdd5bc571faa534a/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-config.test.ts --retries 0` | Exit 0; 4.0 s; 14 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-45-50-380Z-p330519-rc1ef757e455a89d3/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-guardrails.test.ts --retries 0` | Exit 0; 22.5 s; 63 passed, 0 failed, 1 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-45-54-321Z-p331365-re0b39f07eb25e89d/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-prebuilt.test.ts --retries 0` | Exit 0; 14.2 s; 11 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-46-16-677Z-p333102-r01838ba6545907ae/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-preflight.test.ts --retries 0` | Exit 0; 2.8 s; 9 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-46-30-832Z-p334925-re364c3b5a90d78f6/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-provider.test.ts --retries 0` | Exit 0; 4.7 s; 43 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-46-33-770Z-p335079-r0e3bb6178f9b7355/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-reporting.test.ts --retries 0` | Exit 0; 13.2 s; 26 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-46-38-477Z-p335254-re2748c5b211bd7f0/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-shard-plan.test.ts --retries 0` | Exit 0; 8.9 s; 10 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-46-51-808Z-p337119-r3f6f0824c6fcc207/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-shard-worker.test.ts --retries 0` | Exit 0; 29.4 s; 12 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-47-00-732Z-p338386-rce77528834ce1b8b/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/test-runner-timing-baseline.test.ts --retries 0` | Exit 0; 4.0 s; 6 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-47-30-229Z-p340231-r3c8ab32a60bb126c/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/repo/theming-reference.test.ts --retries 0` | Exit 0; 3.7 s; 1 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-47-34-385Z-p340615-r096b00faf4a81f91/results.json` |
| `npm ls @playwright/test playwright playwright-core @telepath-computer/conform` | Exit 0; 7.0 s | `/tmp/sticky-merge-dependency-versions.log` |
| `node scripts/specs-index.mjs` | Exit 0; 0.3 s | `/tmp/sticky-merge-specs-index-final.log` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/template-checklist-conformance.test.ts --retries 0` | Exit 0; 98.5 s; 21 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-47-37-985Z-p341203-rcaf79ae25272f4ee/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/template-sticky-note-conformance.test.ts --retries 0` | Exit 0; 65.5 s; 16 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-49-16-649Z-p347804-r646cbbdfcb447931/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/template-checklist-real-stack.test.ts --retries 0` | Exit 0; 69.1 s; 23 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-50-22-273Z-p352909-r73ce32a030e30cd9/results.json` |
| `node /tmp/sticky-icon-preview.mjs` | Exit 0; 1.3 s | `/tmp/sticky-merge-icon-preview.log` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | Exit 0; 103.1 s; 16 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-51-31-327Z-p360111-r48910b0c28d9ca91/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/node/cli-assets.test.ts --retries 0` | Exit 0; 28.6 s; 24 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-53-14-526Z-p371441-r26836415bc9df89e/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file test/node/licensing.test.ts --retries 0` | Exit 0; 32.7 s; 19 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-54-08-371Z-p373949-rc7562444f2afb9ce/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/server/test/onboarding-installer.test.ts --grep 'starts the template cache after bundled handling' --retries 0` | Exit 0; 10.7 s; 1 passed, 0 failed, 49 skipped, 0 recovered flakes | `.test-runs/2026-10-25T14-04-24-802Z-p416858-r2548bb2d8d9c4ef9/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --surface unit:server,unit:root,e2e:node,e2e:browser-app-real-stack,e2e:conformance --retries 0` | Exit 1; 1517.3 s; 2168 passed, 2 failed, 3 skipped, 0 recovered flakes | `.test-runs/2026-10-25T13-55-22-358Z-p378451-r9c8e89c11872d039/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'theme settings persist rendered app and artifact outcomes through a built-server restart' --retries 0` | Exit 0; 57.4 s; 1 passed, 0 failed, 0 skipped, 0 recovered flakes | `.test-runs/2026-10-25T14-21-32-810Z-p505783-r403f520006116911/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --surface unit:server,e2e:browser-app-real-stack --retries 0` | Exit 0; 406.9 s; 1331 passed, 0 failed, 2 skipped, 0 recovered flakes | `.test-runs/2026-10-25T14-22-56-002Z-p514766-rd6512f92f36afd17/results.json` |
| `git diff --exit-code 475da06 -- packages/server/assets/templates/sticky-note/index.html packages/server/assets/templates/sticky-note/page.js packages/server/assets/templates/sticky-note/model.js packages/server/assets/templates/sticky-note/model.d.ts packages/server/assets/templates/sticky-note/styles.css packages/server/assets/templates/sticky-note/icons.css storybook/spec/templates/sticky-note specs/ui/templates/sticky-note.mdx specs/ui/app/artifact-frame/transparency.mdx` | Exit 0; 0.0 s | `/tmp/sticky-merge-sticky-behavior-invariants.log` |
| `cmp docs/working/sticky-note-icons/b.svg packages/server/assets/templates/sticky-note/icon.svg` | Exit 0; 0.0 s | `/tmp/sticky-merge-icon-identity.log` |
| `git diff --exit-code e6f12ef -- package.json package-lock.json packages/web/package.json specs/arch/ui/conformance.md` | Exit 0; 0.0 s | `/tmp/sticky-merge-base-invariants.log` |
| `git rev-parse HEAD MERGE_HEAD` | Exit 0; 0.0 s | `/tmp/sticky-merge-merge-heads.log` |
| `env TV_PW_WORKERS=1 npm test -- local --surface e2e:browser-app --retries 0` | Exit 0; 700.0 s; 340 passed, 0 failed, 2 skipped, 0 recovered flakes | `.test-runs/2026-10-25T14-30-41-286Z-p538261-r78c4c37114c1f403/results.json` |
| `npm run type-check` | Exit 0; 23.6 s | `/tmp/sticky-merge-type-check-final.log` |
| `npm run lint` | Exit 0; 22.2 s | `/tmp/sticky-merge-lint-final.log` |
| `git add -A -- . ':!docs/working/sticky-note-icons'` | Exit 0; 0.0 s | `/tmp/sticky-merge-stage-final.log` |
| `git diff --name-only --diff-filter=U` | Exit 0; 0.0 s | `/tmp/sticky-merge-unresolved-files.log` |
| `git diff --name-only` | Exit 0; 0.0 s | `/tmp/sticky-merge-unstaged-files.log` |
| `git diff --cached --check` | Exit 0; 0.3 s | `/tmp/sticky-merge-staged-whitespace.log` |
| `git diff --check` | Exit 0; 0.0 s | `/tmp/sticky-merge-working-whitespace.log` |
| `git ls-files --others --exclude-standard` | Exit 0; 0.0 s | `/tmp/sticky-merge-untracked-files.log` |
| `git grep -n '^<<<<<<<\|^>>>>>>>'` | Exit 1; 0.1 s | `/tmp/sticky-merge-conflict-markers.log` |

## Failures encountered and their disposition

- The first `npm install` exited 1 in the filesystem sandbox: the toolchain child reported npm unavailable and could not write `/root/.npm/_logs`. The same command with the required filesystem/network access exited 0. The base dependency files stayed byte-identical. npm reported 29 vulnerabilities (10 moderate, 16 high, 3 critical) and six pending install-script approvals; dependency remediation was not part of this merge.
- The first targeted spec-links run had six passes and two failures, identifying three local links to `./transparency/index.md` in the artifact-frame proof. Those links now point to `./transparency.md`; the focused rerun passed all eight tests, and the full root surface passed later.
- The targeted batch shell was interrupted with exit 143 after the CLI-assets file had completed successfully and before the licensing file started. The cause of that shell interruption was not established. Licensing was then run separately and passed; no targeted file was left unrun.
- The first owning-surfaces command failed two tests. The onboarding cache test still expected only Checklist; its manifest and cache checks now expect both templates, while startup ordering, scan/watcher counts and cleanup assertions remain unchanged. Its focused case passed, and the complete server surface then passed 1,263 tests with one existing skip.
- The other failure was the unchanged base theme-restart acceptance test exceeding its 30-second limit. It passed unchanged in isolation at 29.821 seconds, then passed unchanged in the complete real-stack rerun at 11.419 seconds. The latter surface passed 68 tests with one existing skip. The exact source of the timing variation is unknown. Independent review found no direct merge-induced cause: the test and restart helpers match the base, and that test launches without bundled templates. No timeout, production behavior or assertion was changed.
- Automatic retries were disabled for every canonical run (`--retries 0`). The runner reported zero recovered flakes; the earlier timeout and successful manual reruns are nevertheless recorded here.

## Setup and audit operations

- Source inspection used `git show e6f12ef:<path>`, `git diff 810aafa 475da06 -- <path>`, and `git diff e6f12ef -- <path>` for the owned conflict paths, plus focused `rg`, `cat` and `sed` reads. These established the base-first resolutions and the clean-merge audit.
- An initial spec-edit script invoked unavailable `python` (exit 127); its `python3` replacement completed successfully. The adaptation scripts and relative-link audit then exited 0.
- Initial sandboxed `git add` attempts exited 128 because this linked worktree's Git index is outside the writable checkout. The corresponding authorized escalated staging commands succeeded. No automatic approval review rejected an action.
- Owned-file whitespace checks passed after resolution. Early whole-spec checks still saw the two index conflicts before index regeneration; the final checks below cover the completed tree.
- Obsolete-reference searches found no active old harness/config/group names or old proof links after the working-plan fixes. Historical old names quoted in this report are intentional. Retained base popover and selector assets remain historical references and have no production Toolbox authority.
- The selected SVG was rendered without alteration at 20 pixels on light and dark backgrounds (`/tmp/sticky-icon-preview.png`) and visually inspected. Its writing and folded corner remain legible.
- `npm ls @playwright/test playwright playwright-core @telepath-computer/conform` confirmed Playwright 1.64.1 throughout and npm-published conform 0.2.0. The manifest, lockfile and conformance architecture comparisons in the command table are exact byte/diff checks, not version guesses.

The tests exercised the uncommitted merge worktree at HEAD `475da061ac7fcca783ea4d2615b975620a767f68` with MERGE_HEAD `e6f12ef05ac8617ec88a96058a60a5c9230d6d4d`. Only documentation recording the results changed after the final code checks. Product servers and CLI tests used the existing isolated temporary-home harnesses. The checkout was never linked or installed as the host `tv`.

## Final requested surface results

| Surface | Passed | Failed | Skipped | Result source |
| --- | ---: | ---: | ---: | --- |
| `unit:root` | 452 | 0 | 1 | First owning-surfaces run |
| `unit:server` | 1,263 | 0 | 1 | Affected-surfaces rerun |
| `e2e:node` | 331 | 0 | 0 | First owning-surfaces run |
| `e2e:browser-app-real-stack` | 68 | 0 | 1 | Affected-surfaces rerun |
| `e2e:conformance` | 56 | 0 | 0 | First owning-surfaces run |
| `e2e:browser-app` | 340 | 0 | 2 | Final browser-app run |

Total across these final surface results: **2,510 passed, zero failed, five existing skips**. The first combined command's two failures remain in the command ledger; they are not erased by the affected-surface reruns.

The five skips are conditional coverage: the root lifecycle fixture requires the authorized GitHub workflow identity and opt-in; this host cannot stage the server privileged-port EACCES/EPERM case; the real-stack Firefox-specific Markdown case skips Chromium; and the two ordinary-browser appearance cases each skip the browser that does not own that contract. Focused `--grep` runs also report filtered tests as skipped; those are not additional coverage gaps.

## Remaining review and merge state

The owner must review the quoted specification adaptations. The previously approved Sticky note behavior and story appearance are unchanged. The observed theme-restart timing variation remains unexplained, although both the focused reproduction and complete rerun passed unchanged; no direct merge-induced cause was found. There is no unresolved implementation finding.

The merge is intentionally **uncommitted and still in progress**. No merge abort, commit, push or `npm run verify` was performed. The original untracked `docs/working/sticky-note-icons/` source directory is left untouched and untracked; the selected exact SVG copy is staged with the implementation. All resolved tracked changes and the updated working documents are staged.

Final Git checks: `git diff --check` and `git diff --cached --check` exited 0; the unresolved-file and unstaged-file lists were empty. `git grep -n '^<<<<<<<\|^>>>>>>>'` exited 1 with no output, meaning no conflict markers matched. `git ls-files --others --exclude-standard` listed only the four original files under `docs/working/sticky-note-icons/`. The exact SVG comparison, approved-runtime comparison and base dependency/conformance-spec comparison all exited 0. HEAD and MERGE_HEAD remain the two revisions recorded above.

After adding these results to this document, staging and the whitespace, unresolved-file, conflict-marker and unstaged-file checks were repeated successfully.


## Second merge: Calendar base `e5326a8`

This continues the in-progress merge at HEAD `475da061ac7fcca783ea4d2615b975620a767f68`, with MERGE_HEAD `e5326a81876b3e0be92004c857275d8ccba7b84a`. The starting tree was the earlier reviewed resolution saved as `0979e530` (tree `09dd02a`), followed by the base change from `e6f12ef` to `e5326a8`. The latter is the Calendar squash merge #42. The earlier resolution supplies Sticky note intent; the current base supplies Calendar and base intent. This section supersedes earlier merge-state and validation totals.

The work retains the three-template inventory in Checklist, Calendar, Sticky note order. Persisted handled-ID state and scanner/cache output retain the existing alphabetical sorting; tests express ordered declarations followed by `.sort()` where those contracts apply. The developer telemetry marker was refreshed before tests. No host CLI installation or linking was performed.

### The 21 resolutions

- `packages/server/src/bundled-template-ids.ts` — Combined the inventory as `['checklist', 'calendar', 'sticky-note']`.
- `packages/server/src/telemetry/derivation.test.ts` — Retained CLI/UI classification for all three IDs and Sticky note case-mismatch privacy checks.
- `packages/server/test/bundled-template-installation.test.ts` — Combined three-package validation, copy/preservation/replacement/failure coverage, and Calendar handled-deletion fixtures; adapted state and operation counts.
- `packages/server/test/checklist-template.test.ts` — Asserted all three exact manifest identities, minimum versions, folders, and inventory order.
- `packages/server/test/onboarding-installer.test.ts` — Required all three installed manifests before cache startup and all three cached IDs.
- `proofs/arch/telemetry/derivation.md` — Included all three exact IDs while retaining custom-ID privacy requirements.
- `proofs/arch/templates/bundled-installation.md` — Reconciled validation, build, retry, and independent-installation assertions with the three-package fixtures.
- `proofs/arch/templates/bundled-templates.md` — Included all three package owners, identities, versions, and the exact inventory tuple.
- `proofs/arch/templates/index.md` — Linked architecture and UI ownership for Checklist, Calendar, and Sticky note.
- `proofs/index.md` — Regenerated from the complete proof tree with `node scripts/specs-index.mjs`.
- `scripts/licenses/assets.json` — Retained Calendar Phosphor assets and Sticky note story/package Caveat and Phosphor records.
- `specs/arch/templates/bundled-installation.md` — Kept the inventory link to each template owner, covering all three packages without repeating their contracts.
- `specs/arch/templates/bundled-templates.md` — Kept Checklist, Calendar, Sticky note rows and tuple in that order.
- `specs/arch/templates/index.md` — Kept the inventory as the route to every package/store owner.
- `specs/index.md` — Regenerated from the complete spec tree with `node scripts/specs-index.mjs`.
- `specs/product/templates.md` — Kept the general architecture/UI ownership statement for each bundled template.
- `specs/spec-migration.md` — Combined all three template owners and conformance coverage while preserving the relocated transparency spec.
- `test.config.mjs` — Combined all three conformance/real-stack roots and ordinary-browser exclusions, preserving one shared conformance group with `cwd: "."`.
- `test/node/cli-assets.test.ts` — Required all three complete byte-identical template trees and manifest/page/README/icon resolver children.
- `test/node/licensing.test.ts` — Required packed notices for all three bundled template folders.
- `test/repo/licensing-config.test.ts` — Retained Calendar asset assertions and Sticky note font/icon assertions and ordered manifest inventory.

### Adaptations and audit

- Both Playwright real-stack lists now place Checklist, Calendar, and Sticky note in that order; test-runner ownership assertions cover all three conformance files and all three real-stack files.
- Sticky note follows the base Checklist icon-ownership change. Architecture owns a square `icon.svg` and delivery; the UI spec has an `Icon` section immediately before `Appearance`. The architecture proof links to the UI proof review assertion. The prior 20-pixel icon review is retained as historical evidence; this merge does not claim a new visual or independent review.
- `specs/spec-ui.md` remains identical to `e5326a8`. The five Sticky note story exports with `play` meet its deterministic-state rule: `Empty`, `Typing`, and `Disconnected` use `caretAtEnd`, focusing the textarea and setting both selection ends to its fixed value length. `LongTextScrolled` waits for the bundled font and assigns `scrollTop = 180`; `LongTextDisconnected` waits for the same font and assigns `scrollTop = scrollHeight`. Fixed args and viewport determine the result. No toggle, random input, clock-dependent state, or repeated text append appears in those functions. Stories remain unchanged.
- Calendar runtime, stories, architecture/UI specs, the changed Checklist icon specs/proofs, and dependency manifests were compared with `e5326a8` and are unchanged. Sticky note runtime and stories were compared with `475da06` and are unchanged.
- The requested contribution, complexity, UI, proof, testing, and runner guidance was read. This checkout's `tvdev-contribute` links writing and complexity guidance but no separate code-style guide; filename and reference searches found no such guide in the checkout. Existing code conventions were followed. The logical-merging and document-writing guidance was applied to the reconciliation and record.
- A delegated implementation worker handled ten code/test/config conflicts and three related test-routing files. The principal agent handled the remaining conflicts, icon ownership, integration audit, and validation. This was implementation assistance, not independent review.

### Exact specification diff for owner approval

The complete diff below is against `e5326a8`, including unchanged-from-Sticky-note additions and generated index changes. It is literal Git output, not a paraphrase.

```diff
diff --git a/specs/arch/licensing.md b/specs/arch/licensing.md
index c9b6037..0cd8778 100644
--- a/specs/arch/licensing.md
+++ b/specs/arch/licensing.md
@@ -159 +159 @@ interface LicenseConfig {
-   * it for the vendored typeface; its font-only scope is policy, upheld in
+   * it for vendored typefaces; its font-only scope is policy, upheld in
diff --git a/specs/arch/telemetry/derivation.md b/specs/arch/telemetry/derivation.md
index 508fbe4..f362c34 100644
--- a/specs/arch/telemetry/derivation.md
+++ b/specs/arch/telemetry/derivation.md
@@ -20 +20 @@ All derivations run server-side (CLI-side for agent-type at skill install).
-- **Artifact template use** — classify the exact selected template ID against the [bundled package folder ID](../templates/bundled-templates.md#^bundled-artifact-template-inventory): return that ID when it belongs to the bundled set, and `custom` otherwise. This classification depends on ID membership, not whether Television originally installed the folder. The request source is the closed `cli` or `ui` value. No folder path, display name, manifest content, or caller data reaches telemetry. ^artifact-template-telemetry-derivation
+- **Artifact template use** — classify the exact selected template ID against the [bundled package folder IDs](../templates/bundled-templates.md#^bundled-artifact-template-inventory): return that ID when it belongs to the bundled set, and `custom` otherwise. This classification depends on ID membership, not whether Television originally installed the folder. The request source is the closed `cli` or `ui` value. No folder path, display name, manifest content, or caller data reaches telemetry. ^artifact-template-telemetry-derivation
diff --git a/specs/arch/templates/bundled-installation.md b/specs/arch/templates/bundled-installation.md
index b8fa5bf..dd793b1 100644
--- a/specs/arch/templates/bundled-installation.md
+++ b/specs/arch/templates/bundled-installation.md
@@ -5 +5 @@
-Television ships its [bundled artifact templates](./bundled-templates.md) as folders in the server package and installs them into each serving home. This spec owns the server package source and validation, the minimum-version rule, the handled-IDs state file, and replacement and backup behavior. [Template architecture](./index.md) owns the installed folder validator and request-time scan; [the bundled inventory](./bundled-templates.md) owns IDs, names, descriptions, and versions; [Checklist](./checklist.md) owns its display size, initial data, page packaging, and README guidance, and [Calendar](./calendar.md) owns its initial data, page packaging, and README guidance; [CLI architecture](../cli/index.md#build-and-packaged-asset-layout) owns the standalone package copy and resolver.
+Television ships its [bundled artifact templates](./bundled-templates.md) as folders in the server package and installs them into each serving home. This spec owns the server package source and validation, the minimum-version rule, the handled-IDs state file, and replacement and backup behavior. [Template architecture](./index.md) owns the installed folder validator and request-time scan; [the bundled inventory](./bundled-templates.md) owns IDs, names, descriptions, and versions, and links to each template's display options, initial data, page packaging, and README guidance; [CLI architecture](../cli/index.md#build-and-packaged-asset-layout) owns the standalone package copy and resolver.
diff --git a/specs/arch/templates/bundled-templates.md b/specs/arch/templates/bundled-templates.md
index 1f61717..aebc90f 100644
--- a/specs/arch/templates/bundled-templates.md
+++ b/specs/arch/templates/bundled-templates.md
@@ -10,0 +11 @@ Television ships these [artifact templates](../../product/templates.md#^artifact
+| `sticky-note` | Sticky note | A yellow note to type into; an agent can write on it too. | `1.0.0` | `1.0.0` | [Sticky note](./sticky-note.md) | [Sticky note page](../../ui/templates/sticky-note.mdx) |
@@ -12 +13 @@ Television ships these [artifact templates](../../product/templates.md#^artifact
-`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'calendar']`; [telemetry](../telemetry/derivation.md#^artifact-template-telemetry-derivation) uses this closed vocabulary. ^bundled-artifact-template-inventory
+`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'calendar', 'sticky-note']`; [telemetry](../telemetry/derivation.md#^artifact-template-telemetry-derivation) uses this closed vocabulary. ^bundled-artifact-template-inventory
diff --git a/specs/arch/templates/index.md b/specs/arch/templates/index.md
index 488377b..14f8145 100644
--- a/specs/arch/templates/index.md
+++ b/specs/arch/templates/index.md
@@ -5 +5 @@
-Television reads artifact templates from `templates/` in the selected home. This spec owns the installed folder contract, CLI records, watched app cache, and server operation that creates an artifact from a template. [Product behavior](../../product/templates.md) owns the feature promises; [bundled installation](./bundled-installation.md) owns installation; [the bundled inventory](./bundled-templates.md) lists the shipped templates; [Checklist](./checklist.md) and [Calendar](./calendar.md) own their packages and store contracts.
+Television reads artifact templates from `templates/` in the selected home. This spec owns the installed folder contract, CLI records, watched app cache, and server operation that creates an artifact from a template. [Product behavior](../../product/templates.md) owns the feature promises; [bundled installation](./bundled-installation.md) owns installation; [the bundled inventory](./bundled-templates.md) lists the shipped templates and links to the architecture spec for each package and store contract.
diff --git a/specs/arch/templates/sticky-note.md b/specs/arch/templates/sticky-note.md
new file mode 100644
index 0000000..b48bb4c
--- /dev/null
+++ b/specs/arch/templates/sticky-note.md
@@ -0,0 +1,49 @@
+*The bundled Sticky note artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*
+
+# Sticky note artifact template
+
+Sticky note is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Sticky note UI spec](../../ui/templates/sticky-note.mdx) owns appearance and interaction.
+
+The bundled manifest declares `display: { "width": 360, "height": 360, "transparent": true }` in reference pixels. `fullScreen` uses the shared default. These values use the [creation display-options contract](../layout/index.md#^ly-creation-display); the [artifact frame](../../ui/app/artifact-frame/index.md) owns the surrounding transparent presentation.
+
+## Store
+
+The template `data.json` seeds the [artifact's own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"text":""}`. The typing hint is a placeholder, never stored text; an agent reading a new note sees an empty string. The value has this contract because agents write it:
+
+```ts
+interface StickyNoteData {
+  text: string;
+}
+```
+
+The value is valid when it is a JSON object, not an array or `null`, with a `text` string. The string may be empty and may contain whitespace and line breaks. Other fields are ignored and left unchanged by page writes. A missing value, missing `text`, or any other type breaks the contract and is shown as [Data the page cannot read](../../ui/templates/sticky-note.mdx#data-the-page-cannot-read) describes. ^bundled-artifact-template-sticky-note-store
+
+The page subscribes to the whole store through the [resource SDK](../resources/sdk.md), so it can validate the root as well as the text. Each save uses `set` at `text` with the complete current string, leaving other root fields alone. Clearing the note writes `""`; it does not remove the field. Opening, reading and displaying the note write nothing.
+
+Once the page has read a value that breaks the contract, it starts no write until it reads a valid value again; what happens to an unsent edit is in [Data the page cannot read](../../ui/templates/sticky-note.mdx#data-the-page-cannot-read). A write already sent follows the ordinary store rules. Saved data reported unavailable uses the same alert and follows the [resource recovery rules](../resources/index.md#^rs-storage), including repair and server restart.
+
+## Saving and concurrent changes
+
+Each input restarts a 400 ms delay; leaving the field saves an unsent change immediately. The page retains the latest locally edited text until its save is confirmed. A confirmation clears only the draft it saved, leaving newer typing pending. While text is waiting to be sent, incoming valid text does not replace it or disturb selection or scrolling. After sending, the field follows SDK values again unless there is newer unsent typing. An unchanged value leaves selection alone. Concurrent writes replace the whole string under the [store's last-write-wins rule](../../product/resources/json-store.md#^js-write-order); text is not merged and earlier incoming values are not replayed after a local save.
+
+The page uses [`getAccess` and `onAccessChanged`](../resources/sdk.md#^sdk-access) and the SDK [connection status](../resources/sdk.md#^sdk-connection-status). Editing requires previously established write access and readable data. A disconnect alone does not remove that access. Confirmed loss of write access clears the retained draft and follows the [read-only behaviour](../../ui/templates/sticky-note.mdx#read-only).
+
+The SDK has [no offline queue](../resources/sdk.md#^sdk-reconnect). The page keeps one current draft in memory while disconnected, including locally edited text whose in-flight save rejects with `disconnected`. It keeps that draft on screen through SDK rollback and reconnection, and makes no write calls while disconnected. This is a replacement text to save, not a queue of SDK requests; closing or reloading the page loses it.
+
+On reconnection, the page checks current access and reads the whole store with `get` before sending a retained draft. With write access and valid data, it saves the latest draft once the normal pause or leaving-field condition is met; if that condition was met while disconnected, it saves immediately. The arriving stored text does not overwrite the draft first. Loss of access or unreadable data follows the rules above. With no draft, the page simply displays the current stored text. These saves use ordinary last-write-wins ordering, including the [uncertain outcome of a write sent before disconnection](../../product/resources/json-store.md#^js-disconnect).
+
+A rejection other than `disconnected` clears the retained draft, including any newer unsent typing, and displays the value after SDK rollback, with the [save-failure message](../../ui/templates/sticky-note.mdx#saving). The displayed value may include a write whose durability the server [could not confirm](../../product/resources/json-store.md#^js-uncertain-write).
+
+## Packaged page and guidance
+
+The page loads Television's canonical stylesheet and the resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder, loaded after the canonical stylesheet; [conformance](../../spec-ui.md#conformance) holds the packaged page to the UI stories.
+
+The template carries its own `Caveat-Medium.woff2`, byte-identical to the [story font](../../../storybook/spec/templates/sticky-note/Caveat-Medium.woff2), and loads it through `@font-face` at weight 500. Production imports no spec files and fetches no external font. Conformance captures wait for the bundled font to load. The source is [Google Fonts' Caveat](https://github.com/google/fonts/tree/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat), under SIL Open Font License 1.1. The [font provenance](../../../storybook/spec/templates/sticky-note/font-source.md) records the fixed source, weight extraction and checksums.
+
+Following [folder notices](../licensing.md#^licensing-folder-notices), the packaged font is registered in `scripts/licenses/assets.json` for `cli` and `source`, and for `desktop` if that package ships it. The template folder carries a generated `THIRD-PARTY-NOTICES.txt` with Caveat's complete upstream copyright notice and OFL terms, as Checklist carries its icon notice. The story copy has its own source-surface inventory entry and folder notice. The font remains under OFL when the template is copied or adapted.
+
+The manifest's `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-sticky-note-icon
+
+The bundled `README.md` explains the root object and `text` string, that a new note starts with empty text, that the typing hint is never saved, that spaces and line breaks are kept, and that other root fields are ignored and preserved. It explains that the page and agent share the artifact's own store and that changes appear live. It shows `tv resource json set --artifact <id> /text '"…"'` to replace the text and `tv resource json set --artifact <id> /text '""'` to clear it, leaving other fields alone.
+
+The README explains [saving and concurrent changes](#saving-and-concurrent-changes), including retention of typing while disconnected and the need to keep the page open until it saves. It warns that invalid or missing data shows an error and is not repaired by the page. It identifies `styles.css` as the place to adapt the look and explains that the transparent document background works with the manifest display setting, which is applied at creation. It names the bundled Caveat font, links its upstream licence at the fixed revision above, and tells an adapting agent to retain the font's notice. Copied artifacts are independent of the installed template.
diff --git a/specs/arch/themes/authoring.md b/specs/arch/themes/authoring.md
index a9c8da8..1e4d47b 100644
--- a/specs/arch/themes/authoring.md
+++ b/specs/arch/themes/authoring.md
@@ -198 +198 @@ Automated reference checks run in the repository test suite and must:
-- Compare the source files recorded in the reference with the current app UI authorities: every `.frame` and `.css` file under `specs/ui/app/`; `specs/ui/app/index.md`, which defines the app document marker; and the Storybook stories, MDX pages and stylesheets to which an app UI spec delegates authority. Missing, additional, or duplicate source entries fail the check.
+- Compare the source files recorded in the reference with the current authoritative `.frame` and `.css` files under `specs/ui/app/`, plus `specs/ui/app/index.md`, which defines the app document marker, every `.mdx` spec under `specs/ui/app/` together with the story module it names and the stylesheet those stories import. Missing, additional, or duplicate source entries fail the check.
diff --git a/specs/index.md b/specs/index.md
index 3e5b611..9798ab3 100644
--- a/specs/index.md
+++ b/specs/index.md
@@ -95 +95 @@ Generated from the description line of every spec by `scripts/specs-index.mjs`,
-    - `bundled-templates.md` (12 lines) — *The bundled artifact template inventory and shared rules.*
+    - `bundled-templates.md` (13 lines) — *The bundled artifact template inventory and shared rules.*
@@ -98,0 +99 @@ Generated from the description line of every spec by `scripts/specs-index.mjs`,
+    - `sticky-note.md` (49 lines) — *The bundled Sticky note artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*
@@ -138,0 +140 @@ Generated from the description line of every spec by `scripts/specs-index.mjs`,
+      - `transparency.mdx` (38 lines) — *UI spec: the artifact frame’s transparent state, hover behaviour and resize appearance.*
@@ -185,0 +188 @@ Generated from the description line of every spec by `scripts/specs-index.mjs`,
+    - `sticky-note.mdx` (86 lines) — *UI spec: the bundled Sticky note page, for text that a person and an agent can edit together.*
diff --git a/specs/product/licensing.md b/specs/product/licensing.md
index 68898ab..cb7c3e0 100644
--- a/specs/product/licensing.md
+++ b/specs/product/licensing.md
@@ -95 +95 @@ Every handled package — bundled into a shipped surface or declared as a depend
-**OFL-1.1** (the SIL Open Font License) is on that list for the vendored typeface. It is the one entry whose scope is narrower than the list implies: it carries conditions beyond attribution — the font stays under OFL, cannot be sold on its own, reserved-name rules apply to modifications — which are fine for a typeface we embed unmodified and wrong for code. So OFL-1.1 arriving on a *code* package is a decision to make, not an automatic pass. That scope is held in review, deliberately: encoding it would mean a machine deciding what is a font and asserting a file is unmodified, and neither is a judgment a checker can make. ^licensing-ofl-fonts-only
+**OFL-1.1** (the SIL Open Font License) is on that list for vendored typefaces. It is the one entry whose scope is narrower than the list implies: it carries conditions beyond attribution — the font stays under OFL, cannot be sold on its own, reserved-name rules apply to modifications — which are fine for bundled typefaces kept under OFL with reserved-name restrictions respected, and wrong for code. So OFL-1.1 arriving on a *code* package is a decision to make, not an automatic pass. That scope is held in review, deliberately: encoding it would mean a machine deciding what is a font and asserting a file is unmodified, and neither is a judgment a checker can make. ^licensing-ofl-fonts-only
diff --git a/specs/product/templates.md b/specs/product/templates.md
index fa7a865..c720fa2 100644
--- a/specs/product/templates.md
+++ b/specs/product/templates.md
@@ -37 +37 @@ People use the Toolbox popover in the navbar. Activation creates a copied folder
-Television ships bundled artifact templates; [bundled template content](../arch/templates/bundled-templates.md) owns the inventory and links to each template's own specs. [Checklist architecture](../arch/templates/checklist.md) owns the Checklist's display size and store contract, and [Calendar architecture](../arch/templates/calendar.md) owns the Calendar store contract; the UI spec of each template owns its page. On serving boot, Television installs an unhandled bundled template. A handled folder that the user deletes stays absent. A valid installed copy at or above the minimum version is preserved, including user edits; an invalid copy or one below the minimum is backed up and replaced at the same path. A routine bundled version change does not overwrite a usable installed copy. An interrupted replacement can leave the folder absent until the next serving boot restores it. [Bundled installation](../arch/templates/bundled-installation.md) owns the minimum-version, backup, and recovery contracts. ^artifact-template-bundled
+Television ships bundled artifact templates; [bundled template content](../arch/templates/bundled-templates.md) owns the inventory and links to each template's own specs. Each template has an architecture spec for its display options and store contract, and a UI spec for its page. On serving boot, Television installs an unhandled bundled template. A handled folder that the user deletes stays absent. A valid installed copy at or above the minimum version is preserved, including user edits; an invalid copy or one below the minimum is backed up and replaced at the same path. A routine bundled version change does not overwrite a usable installed copy. An interrupted replacement can leave the folder absent until the next serving boot restores it. [Bundled installation](../arch/templates/bundled-installation.md) owns the minimum-version, backup, and recovery contracts. ^artifact-template-bundled
diff --git a/specs/spec-migration.md b/specs/spec-migration.md
index 91d0f71..cba4143 100644
--- a/specs/spec-migration.md
+++ b/specs/spec-migration.md
@@ -40 +40 @@ The migrated areas, authoritative here:
-- **Artifact templates** → [product/templates.md](product/templates.md) for copied folder artifacts, URL artifacts, starting data, discovery, and bundled templates; [arch/templates/index.md](arch/templates/index.md) for folder validation, manifest `dataSchema`, flat CLI records, icons, the watched app cache and `/events` updates, fresh CLI scans, and creation; [arch/templates/bundled-templates.md](arch/templates/bundled-templates.md) for the bundled inventory and shared rules; [arch/templates/checklist.md](arch/templates/checklist.md) for the Checklist display size, store contract, icon, and README guidance; [arch/templates/calendar.md](arch/templates/calendar.md) for the Calendar store contract, icon, and README guidance; [arch/templates/bundled-installation.md](arch/templates/bundled-installation.md) for boot installation and recovery at the same path; and [arch/templates/authoring.md](arch/templates/authoring.md) for skill guidance. CLI, resource, telemetry, and [Toolbox](ui/app/toolbox.mdx) owners state their respective integration requirements. The [Checklist page](ui/templates/checklist.mdx) and [Calendar page](ui/templates/calendar.mdx) have UI authority in their MDX specs. Page details outside those contracts remain code-authoritative.
+- **Artifact templates** → [product/templates.md](product/templates.md) for copied folder artifacts, URL artifacts, starting data, discovery, and bundled templates; [arch/templates/index.md](arch/templates/index.md) for folder validation, manifest `dataSchema`, flat CLI records, icons, the watched app cache and `/events` updates, fresh CLI scans, and creation; [arch/templates/bundled-templates.md](arch/templates/bundled-templates.md) for the bundled inventory and shared rules; [arch/templates/checklist.md](arch/templates/checklist.md), [arch/templates/calendar.md](arch/templates/calendar.md), and [arch/templates/sticky-note.md](arch/templates/sticky-note.md) for the bundled pages, display options, store contracts, icons, and README guidance; [arch/templates/bundled-installation.md](arch/templates/bundled-installation.md) for boot installation and recovery at the same path; and [arch/templates/authoring.md](arch/templates/authoring.md) for skill guidance. CLI, resource, telemetry, and [Toolbox](ui/app/toolbox.mdx) owners state their respective integration requirements. The [Checklist page](ui/templates/checklist.mdx), [Calendar page](ui/templates/calendar.mdx), and [Sticky note page](ui/templates/sticky-note.mdx) have UI authority in their MDX specs. Page details outside those contracts remain code-authoritative.
@@ -46,2 +46,2 @@ The migrated areas, authoritative here:
-- **UI specs** → the surfaces under `specs/ui/`: the app shell, channel sidebar, navbar, tab strip, stage and its navigation, system modal, Toolbox, Checklist and Calendar template pages, copy button, desktop upgrade gate, update notification, Markdown editor color treatment and narrow table-interaction buffer, onboarding artifact designs, and desktop setup screen; plus foundation tokens, reset, styling, controls, panels, fonts, and elements. [Toolbox](ui/app/toolbox.mdx), the [Checklist page](ui/templates/checklist.mdx) and the [Calendar page](ui/templates/calendar.mdx) are MDX specs whose prose and story appearance are authoritative, with stories in `storybook/spec/`. Their production implementations and proofs must follow them. Other surfaces retain their current frame or template contracts under [spec-ui.md](spec-ui.md), including existing stylesheet-copy, delivery, browser and visual-review checks. The artifact frame transparency stories retain their separate [pilot arrangement](ui/app/artifact-frame/index.md). The remaining artifact-frame and Markdown-editor boundaries are listed with those domains above.
-- **UI conformance** → [the UI policy](spec-ui.md#^ui-conformance-test) requires a conformance test for each spec story against production in the same state. Toolbox and the Checklist and Calendar pages are under it. The [earlier conformance machinery](arch/ui/conformance.md) applies to retained frame and template surfaces. The [retired selector entry](ui/app/skill-selector/index.md) routes to Toolbox; retained grid assets and old Storybook paths preserve existing references and carry no Toolbox authority.
+- **UI specs** → the surfaces under `specs/ui/`: the app shell, channel sidebar, navbar, tab strip, stage and its navigation, system modal, Toolbox, Checklist, Calendar and Sticky note template pages, copy button, desktop upgrade gate, update notification, Markdown editor color treatment and narrow table-interaction buffer, onboarding artifact designs, and desktop setup screen; plus foundation tokens, reset, styling, controls, panels, fonts, and elements. [Toolbox](ui/app/toolbox.mdx), the [Checklist page](ui/templates/checklist.mdx), the [Calendar page](ui/templates/calendar.mdx) and the [Sticky note page](ui/templates/sticky-note.mdx) are MDX specs whose prose and story appearance are authoritative, with stories in `storybook/spec/`. Their production implementations and proofs must follow them. Other surfaces retain their current frame or template contracts under [spec-ui.md](spec-ui.md), including existing stylesheet-copy, delivery, browser and visual-review checks. The [artifact frame transparency spec](ui/app/artifact-frame/transparency.mdx) retains its separate [pilot arrangement](ui/app/artifact-frame/index.md). The remaining artifact-frame and Markdown-editor boundaries are listed with those domains above.
+- **UI conformance** → [the UI policy](spec-ui.md#^ui-conformance-test) requires a conformance test for each spec story against production in the same state. Toolbox and the Checklist, Calendar and Sticky note pages are under it. The [earlier conformance machinery](arch/ui/conformance.md) applies to retained frame and template surfaces. The [retired selector entry](ui/app/skill-selector/index.md) routes to Toolbox; retained grid assets and old Storybook paths preserve existing references and carry no Toolbox authority.
diff --git a/specs/ui/app/artifact-frame/index.md b/specs/ui/app/artifact-frame/index.md
index 271ff8d..1f23f17 100644
--- a/specs/ui/app/artifact-frame/index.md
+++ b/specs/ui/app/artifact-frame/index.md
@@ -11 +11 @@ Another surface may wear the frame's look around content of its own, as the [set
-The [Storybook spec](../../../../storybook/spec/artifact-frame/artifact-frame.mdx) owns interaction, markup and styling for the transparent state; the rest of the frame remains specified here.
+The [Transparency spec](transparency.mdx) owns interaction, markup and styling for the transparent state; the rest of the frame remains specified here.
diff --git a/specs/ui/app/artifact-frame/transparency.mdx b/specs/ui/app/artifact-frame/transparency.mdx
new file mode 100644
index 0000000..008dcbd
--- /dev/null
+++ b/specs/ui/app/artifact-frame/transparency.mdx
@@ -0,0 +1,38 @@
+import { Meta, Canvas, Story } from "@storybook/addon-docs/blocks";
+import { useEffect, useRef } from "react";
+import * as Stories from "../../../../storybook/spec/artifact-frame/artifact-frame.stories.ts";
+
+export const HoverDemo = () => {
+  const container = useRef(null);
+  useEffect(() => {
+    const timer = window.setInterval(() => {
+      container.current?.querySelector(".artifact-frame")?.toggleAttribute("data-hovered");
+    }, 2000);
+    return () => window.clearInterval(timer);
+  }, []);
+  return <div ref={container} className="artifact-frame-hover-demo"><Story of={Stories.TransparentAtRest} inline /></div>;
+};
+
+<Meta of={Stories} name="Spec" />
+
+*UI spec: the artifact frame’s transparent state, hover behaviour and resize appearance.*
+
+# Artifact frame: transparency
+
+These stories and [styles](../../../../storybook/spec/artifact-frame/styles.css) specify the transparent state promised by the [product spec](../../../product/artifacts.md#^af-transparent). The opaque story supplies a comparison; the [frame spec](./index.md) owns the rest of the frame.
+
+<Canvas of={Stories.Opaque} />
+
+<Canvas of={Stories.TransparentAtRest} />
+
+Hovering the transparent frame reveals the frost and title bar; leaving hides them. Both fade over 300ms with ease timing. The bar overlays the bottom of the document without resizing it, and becomes hidden after fading out so its controls leave keyboard navigation. Reduced motion makes the change immediate.
+
+While the frame's menu is open, the frame keeps its hovered state whether or not the pointer is over it, and returns to rest only once the menu closes. The menu opens beside its trigger, as on an opaque frame.
+
+<Canvas of={Stories.TransparentHovered} />
+
+The frame also takes its hovered state, the one shown above, while the stage's resize cursor is active for its page: whenever the pointer is in the band where the page's edges can be grabbed, and for the whole of a resize drag, whether or not the pointer is over the frame. The [stage's handles](../stage/index.md#handles) define that band. There is no separate resizing look.
+
+This demonstration alternates between rest and hover every two seconds, using the same fade. Pointer hover still works.
+
+<HoverDemo />
diff --git a/specs/ui/app/stage/index.md b/specs/ui/app/stage/index.md
index 77eaf63..9ad4a47 100644
--- a/specs/ui/app/stage/index.md
+++ b/specs/ui/app/stage/index.md
@@ -88 +88 @@ The gesture is pointer-only, inheriting the shell's desktop input boundary ([ui/
-- The page's artifact frame carries `data-resize-active` while either holds: the pointer is on one of the page's handles, or a resize drag runs, wherever the pointer goes. It loses the marker only when neither holds, so a drag that ends or is cancelled with the pointer still on a handle keeps it. A [transparent frame](../../../../storybook/spec/artifact-frame/artifact-frame.mdx) shows its hovered state for that time.
+- The page's artifact frame carries `data-resize-active` while either holds: the pointer is on one of the page's handles, or a resize drag runs, wherever the pointer goes. It loses the marker only when neither holds, so a drag that ends or is cancelled with the pointer still on a handle keeps it. A [transparent frame](../artifact-frame/transparency.mdx) shows its hovered state for that time.
diff --git a/specs/ui/templates/sticky-note.mdx b/specs/ui/templates/sticky-note.mdx
new file mode 100644
index 0000000..5dff337
--- /dev/null
+++ b/specs/ui/templates/sticky-note.mdx
@@ -0,0 +1,86 @@
+import { Meta, Canvas } from "@storybook/addon-docs/blocks";
+import * as Stories from "../../../storybook/spec/templates/sticky-note/sticky-note.stories.ts";
+
+<Meta of={Stories} />
+
+export const Artifact = ({ children }) => <div style={{ width: "360px", maxWidth: "100%" }}>{children}</div>;
+
+*UI spec: the bundled Sticky note page, for text that a person and an agent can edit together.*
+
+# Sticky note template
+
+Each story shows one state of the page, checked against production by [UI conformance](../../spec-ui.md#conformance).
+
+<Artifact><Canvas of={Stories.WithText} /></Artifact>
+
+## A new note
+
+A new note is empty. Its hint disappears when you type and returns when you clear the note. Opening the note does not focus or select it. Click the note or reach it with Tab to begin editing. The text box is named "Note" for assistive technology.
+
+<Artifact><Canvas of={Stories.New} /></Artifact>
+
+<Artifact><Canvas of={Stories.Empty} /></Artifact>
+
+## Opening a note
+
+You can start typing once the note has opened.
+
+<Artifact><Canvas of={Stories.Loading} /></Artifact>
+
+<Artifact><Canvas of={Stories.LoadingDisconnected} /></Artifact>
+
+## Typing
+
+Return and Shift-Return insert line breaks. Pasting keeps plain text, including line breaks and spaces. Spellcheck is off; the usual selection, copying and undo work within the field.
+
+What you type is saved automatically shortly after you pause, or when you leave the field. Normal saving shows no message.
+
+<Artifact><Canvas of={Stories.Typing} /></Artifact>
+
+## Changes from elsewhere
+
+Changes an agent or another viewer makes appear while the note is open. Incoming changes never replace what you are typing or move your caret while you type. Once you pause or leave the field, changes from elsewhere can appear again.
+
+## Long text
+
+Scroll within the note to read the rest of the text. Only the text scrolls. Scrolling, selection and copying also work when the note is read-only.
+
+<Artifact><Canvas of={Stories.LongText} /></Artifact>
+
+<Artifact><Canvas of={Stories.LongTextScrolled} /></Artifact>
+
+## Read-only
+
+A read-only share exposes "Note" as a read-only text box. An empty read-only note has no typing hint. If permission to edit is removed while the note is open, it becomes read-only and shows the latest saved text. Revoking the share link leaves that text visible. Editing becomes available again when permission returns.
+
+<Artifact><Canvas of={Stories.ReadOnly} /></Artifact>
+
+<Artifact><Canvas of={Stories.EmptyReadOnly} /></Artifact>
+
+## Saving
+
+If an open, editable note loses its connection to Television, it says "Reconnecting…" and you can keep typing. What you typed is kept and saved once it reconnects. Keep the page open: reloading or closing it before it can save loses those unsaved edits. A read-only note stays read-only while disconnected.
+
+If Television rejects a save, the note returns to the text Television has kept and says "Couldn't save that change." for a few seconds. When disconnected, "Reconnecting…" takes precedence. These messages use a status region so screen readers announce them.
+
+<Artifact><Canvas of={Stories.Disconnected} /></Artifact>
+
+<Artifact><Canvas of={Stories.LongTextDisconnected} /></Artifact>
+
+<Artifact><Canvas of={Stories.SaveFailed} /></Artifact>
+
+## Data the page cannot read
+
+If the note cannot be read, an alert replaces its text. Any edit still waiting to save is discarded. The note cannot be edited until it has been repaired; once an agent fixes it, it appears again without reopening the page. The error is announced to screen readers as an alert.
+
+<Artifact><Canvas of={Stories.Unreadable} /></Artifact>
+
+<Artifact><Canvas of={Stories.UnreadableDisconnected} /></Artifact>
+
+## Icon
+
+In the Toolbox, the template's icon is a yellow note with writing and a folded corner.
+
+## Appearance
+
+<Artifact><Canvas of={Stories.Dark} /></Artifact>
```

### Validation of the second merge

The tested revision is the uncommitted merged tree at HEAD `475da061ac7fcca783ea4d2615b975620a767f68`, MERGE_HEAD `e5326a81876b3e0be92004c857275d8ccba7b84a`. Every canonical run used `TV_PW_WORKERS=1` and `--retries 0`. No production, story, dependency, or test changes were made in response to validation. This is targeted validation, not full verification.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `node scripts/specs-index.mjs` | Exit 0, twice; 149 specs and 132 proofs | `/tmp/sticky-calendar-specs-index.log` |
| `npm run type-check` | Exit 0 | `/tmp/sticky-calendar-type-check.log` |
| `npm run lint` | Exit 0 | `/tmp/sticky-calendar-lint.log` |
| `env TV_PW_WORKERS=1 npm test -- local --surface unit:server,unit:root,e2e:node,e2e:browser-app-real-stack,e2e:conformance --retries 0` | Exit 1 in the sandbox at preflight; no tests ran: npm subprocess reported unavailable | `.test-runs/2026-10-26T04-02-53-186Z-p420-r64c7289e9bdb9e96/summary.json` |
| `env TV_PW_WORKERS=1 npm test -- local --surface unit:server,unit:root,e2e:node,e2e:browser-app-real-stack,e2e:conformance --retries 0` (required environment access) | Exit 1; 1,256.946 s; 2,225 passed, 1 failed, 3 skipped, 0 recovered flakes | `.test-runs/2026-10-26T04-03-09-415Z-p1101697-r41a183aeb5d8f7d1/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/template-calendar-conformance.test.ts --grep 'Calendar conforms: spec-templates-calendar--highlighted' --retries 0` | Exit 1; 32.613 s; the same single failure, no passes/skips/recovered flakes | `.test-runs/2026-10-26T04-24-43-286Z-p1168138-re7c3f7cf5b75db25/results.json` |
| `env TV_PW_WORKERS=1 npm test -- local --surface e2e:browser-app --retries 0` | Exit 0; 675.682 s; 340 passed, 0 failed, 2 skipped, 0 recovered flakes | `.test-runs/2026-10-26T04-26-11-569Z-p1170991-r1b7608daea7fe421/results.json` |

| Surface | Passed | Failed | Skipped | Recovered flakes |
| --- | ---: | ---: | ---: | ---: |
| `unit:root` | 452 | 0 | 1 | 0 |
| `unit:server` | 1,271 | 0 | 1 | 0 |
| `e2e:node` | 331 | 0 | 0 | 0 |
| `e2e:browser-app-real-stack` | 99 | 0 | 1 | 0 |
| `e2e:conformance` | 72 | 1 | 0 | 0 |
| `e2e:browser-app` | 340 | 0 | 2 | 0 |

Across the six requested surfaces: **2,565 passed, 1 failed, 5 skipped, 0 recovered flakes**, with zero process leaks. The isolated reproduction repeats the same failure and is not counted as additional coverage. The five skips are existing conditional cases: the GitHub-only lifecycle fixture, a privileged-port permission case this host cannot stage, the Firefox-specific real-stack Markdown case under Chromium, and two appearance cases that skip the browser not owning their contract. The intentional watcher-error logs in the browser-app run come from the template-cache failure-injection test, which passed.

### Calendar conformance failure left open

`Calendar conforms: spec-templates-calendar--highlighted` fails while conform captures the Storybook **reference** page, before comparison with the production Calendar. The same failure reproduced in isolation without automatic retries:

> Failed to execute 'multiply' on 'DOMMatrixReadOnly': The is2D member is set to true but the input matrix is a 3d matrix.

The stack names `localMatrix` in the conform capture code. The installed `@telepath-computer/conform` is `0.2.0`; `packages/web/node_modules/@telepath-computer/conform/dist/appearance/capture-in-page.js:181` multiplies matrices from CSS Typed OM transform components. The unchanged Calendar style uses `perspective(...)`, `translateY(...)`, `rotateX(...)`, and `scale(...)` for the highlighted event (`storybook/spec/templates/calendar/styles.css:663`).

Evidence for treating this as unrelated to the re-merge: Calendar source, story/styles, conformance test, Storybook Vite config, conformance Playwright config, and dependency manifests/lockfile are byte-identical to `e5326a8`. The shared conformance harness differs from that base only in importing the previously reviewed `template-harness.ts` in place of `checklist-harness.ts`; the exported browser-launch and host constants used there have identical values. The exception happens in reference capture, which does not use the Sticky note runtime or the production Calendar data path. All 16 Sticky note story comparisons pass, along with the other 56 conformance comparisons. This establishes a reproducible reference-capture problem on this host; it does not establish whether the underlying defect belongs to Chromium or conform. A separate clean-base checkout was not run.

The initial error context was retained at `/tmp/sticky-calendar-highlighted-initial-error.md`; both normalized results retain the exact exception and stack. No story, product behavior, permitted-difference list, dependency, or test expectation was changed to hide this failure.

### Final staging and checks

The merge remains uncommitted and in progress; no commit, abort, stash, push, or `npm run verify` was performed. The four icon sources remain untracked. No independent review was performed for this second merge.

The 21 conflict paths and seven adaptation paths were staged explicitly, followed by this report with `git add -- docs/working/sticky-note-implementation.md`. Staging used the required access to the linked-worktree Git index. No `git add -A` was used. All staging operations succeeded; no automatic approval rejection occurred.

| Final command | Actual result |
| --- | --- |
| `git diff --check` | Exit 0; no output |
| `git diff --cached --check` | Exit 0; no output |
| `git diff --name-only --diff-filter=U` | Exit 0; no output |
| `git diff --name-only` | Exit 0; no output |
| `git grep -n -E '^(<<<<<<<\|=======\|>>>>>>>)($\| )'` | Exit 1; no conflict markers |
| `cmp docs/working/sticky-note-icons/b.svg packages/server/assets/templates/sticky-note/icon.svg` | Exit 0; no output |
| `git diff --exit-code 475da06 -- packages/server/assets/templates/sticky-note/index.html packages/server/assets/templates/sticky-note/page.js packages/server/assets/templates/sticky-note/model.js packages/server/assets/templates/sticky-note/model.d.ts packages/server/assets/templates/sticky-note/styles.css packages/server/assets/templates/sticky-note/icons.css storybook/spec/templates/sticky-note` | Exit 0; no output |
| `git diff --exit-code e5326a8 -- packages/server/assets/templates/calendar storybook/spec/templates/calendar specs/arch/templates/calendar.md specs/ui/templates/calendar.mdx packages/web/test/e2e/template-calendar-conformance.test.ts config/vite.spec-storybook.ts packages/web/playwright.conformance.config.ts package.json package-lock.json packages/web/package.json specs/spec-ui.md specs/arch/templates/checklist.md specs/ui/templates/checklist.mdx proofs/arch/templates/checklist.md proofs/ui/templates/checklist.md` | Exit 0; no output |
| `git rev-parse HEAD MERGE_HEAD` | Exit 0; HEAD and MERGE_HEAD unchanged |
| `git ls-files --others --exclude-standard` | Exit 0; only the four original icon sources |

A byte comparison also confirmed that `specs/ui/templates/sticky-note.mdx` differs from `475da06` only by the four-line Icon section. The exact spec quotation in this document was checked against current `git diff --unified=0 e5326a8 -- specs`; all 21 resolution paths were checked against the initial unmerged-file list. The final checks are retained at `/tmp/sticky-calendar-final-checks.json`. After recording these results, the report was staged again and the whitespace, marker, unresolved-file, unstaged-file, runtime, and icon checks were repeated.

The remaining issue is the reproduced Calendar reference-capture failure described above. Owner approval of the quoted spec deltas remains due before any shared-branch merge. The requested re-merge work is staged and uncommitted; this record does not claim full verification or independent review.
