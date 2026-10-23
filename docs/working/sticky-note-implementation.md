# Sticky note implementation and validation

Implemented the single slice in `docs/working/sticky-note-plan.md` against the approved specs at `7d95f9f` and converged proofs at `fde3c79`. HEAD remains `f7e0dae600ad725e0c109090c78067fffcbaa651`; every change is uncommitted.

The production page uses a native textarea, a small model for draft ownership and save decisions, and the real resource SDK. It saves only `/text`, after a 400 ms typing pause or blur; retains unsent text across remote updates and disconnects; refreshes access and the whole root before reconnect saves; and discards drafts on confirmed access loss, unreadable data, or a refused save. The copied page carries its own approved stylesheet, font, warning icon, thumbnail, README and generated notices.

No files under `specs/` or `storybook/spec/` changed. No host installation or linking was performed. Product servers and CLI calls used fresh absolute temporary homes. The existing Storybook service on port 6012 was left alone.

## Files changed and why

| Files | Purpose |
| --- | --- |
| `packages/server/assets/templates/sticky-note/{manifest.json,data.json,index.html,page.js,model.js,model.d.ts,styles.css,Caveat-Medium.woff2,icons.css,thumbnail.png,README.md,THIRD-PARTY-NOTICES.txt}` | Ship the independent copied page, data, native editing and save behavior, exact story assets, guidance and attribution. |
| `packages/server/scripts/capture-sticky-note-thumbnail.mjs` | Capture the real WithText story at 360 × 360 with loaded Caveat and a transparent background. |
| `packages/server/src/bundled-template-ids.ts` | Add Sticky note to the existing installation and telemetry inventory. |
| `packages/server/test/{sticky-note-model,sticky-note-template,checklist-template,bundled-template-installation}.test.ts`; `packages/server/src/telemetry/derivation.test.ts` | Prove model decisions, shipped contents, two-template identity and installation, failure isolation and classification. |
| `scripts/licenses/assets.json`; `test/repo/{licensing-config,licensing-generator}.test.ts`; `test/node/{licensing,cli-assets}.test.ts` | Attribute packaged font/icon assets and verify real generated notices and complete server/CLI copies. |
| `packages/web/test/e2e/template-harness.ts` and `template-conformance-setup.ts` (replace Checklist-named helpers) | Share isolated product-server setup, template selection, real input and clipboard facilities. |
| `packages/web/test/e2e/template-sticky-note-{real-stack,conformance}.test.ts` | Prove 16 real behavior walks and all 16 unchanged story states. |
| `packages/web/test/e2e/template-checklist-{real-stack,conformance}.test.ts` | Keep Checklist on the shared helpers; retain its acceptance assertions. |
| `packages/web/playwright{,.real-stack,.checklist-conformance,.sticky-note-conformance}.config.ts`; `test.config.mjs`; `test.prebuilt.mjs`; `test/repo/test-runner-{config,prebuilt,provider}.test.ts` | Give each new browser file one owning surface, reuse the existing Storybook build recipe and include both conformance surfaces in the web-package selector assertion. |
| `proofs/arch/{licensing,telemetry/derivation,templates/bundled-installation,templates/bundled-templates,templates/sticky-note}.md`; `proofs/product/{licensing,templates}.md`; `proofs/ui/templates/sticky-note/index.md` | Replace pending citations only after passing evidence, and remove stale coverage-model statements. |
| `docs/working/sticky-note-plan.md` | Repair its link to the renamed shared harness. |
| `docs/working/sticky-note-implementation.md` | Preserve the proof mapping, command history, findings and limits for review. |

Root and story notices were regenerated but stayed byte-identical because the font component deduplicates. Existing generic installer, build-copy and telemetry-classification mechanisms needed no implementation change beyond the inventory.

## Every assigned proof obligation

Each citation below is copied from the final proof. Test titles are exact; suite titles identify the parameterized model or telemetry cases. All assigned pending citations have been discharged.

| Obligation | Passing test evidence |
| --- | --- |
| `templates-sticky-note-t-package` | policy-grade test: `packages/server/test/sticky-note-template.test.ts`, “provides the page, exact empty seed and transparent 360 by 360 display” |
| `templates-sticky-note-t-delivery` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “new Sticky note from the popover persists its seed, display, edits and independent assets” |
| `templates-sticky-note-t-assets` | policy-grade test: `packages/server/test/sticky-note-template.test.ts`, “ships the story font unchanged and a transparent 360 by 360 WithText thumbnail” |
| `templates-sticky-note-t-readme` | policy-grade test: `packages/server/test/sticky-note-template.test.ts`, “documents shared text, saving, offline limits, adaptation and the retained font licence” |
| `templates-sticky-note-t-validity` | covered by `packages/server/test/sticky-note-model.test.ts`, “Sticky note whole-value validation” |
| `templates-sticky-note-t-saving` | covered by `packages/server/test/sticky-note-model.test.ts`, “Sticky note save timing and confirmation ownership” |
| `templates-sticky-note-t-offline` | covered by `packages/server/test/sticky-note-model.test.ts`, “Sticky note offline draft and reconnect decisions” |
| `templates-sticky-note-t-write-scope` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “new Sticky note from the popover persists its seed, display, edits and independent assets”; “real editing preserves line breaks, spaces, copying and native undo”; “agent commands and two viewers preserve active typing and follow the latest stored write” |
| `templates-sticky-note-t-confirmation` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “an older save confirmation leaves newer typing pending” |
| `templates-sticky-note-t-reconnect` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “offline typing survives rollback and saves after reconnect checks”; “reconnect discards a draft when access is lost”; “reconnect discards a draft when readable data is lost” |
| `templates-sticky-note-t-invalid-guard` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “unreadable data discards pending typing and recovers without reopening”; “invalid subscriptions prevent new writes while an already-sent write remains last-write-wins” |
| `sticky-note-ui-ac-new` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “new Sticky note from the popover persists its seed, display, edits and independent assets” |
| `sticky-note-ui-ac-editing` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “real editing preserves line breaks, spaces, copying and native undo” |
| `sticky-note-ui-ac-live` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “agent commands and two viewers preserve active typing and follow the latest stored write” |
| `sticky-note-ui-ac-access` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “real share access changes discard drafts and retain the latest saved read-only text” |
| `sticky-note-ui-ac-loading` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “first load waits for readable data and access and announces disconnection before recovering” |
| `sticky-note-ui-ac-offline` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “offline typing survives rollback and saves after reconnect checks”; “read-only disconnection stays read-only and reconnect without a draft shows current text” |
| `sticky-note-ui-ac-draft-lifetime` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “reloading or closing an offline note loses its unsent draft” |
| `sticky-note-ui-ac-save-failure` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “a genuinely refused save discards newer typing and announces rollback with reconnect priority” |
| `sticky-note-ui-ac-invalid` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “unreadable data discards pending typing and recovers without reopening” |
| `sticky-note-ui-ac-unavailable` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “damaged saved bytes show the alert and recover after repair and restart” |
| `sticky-note-ui-ac-layout` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, “long text scrolls and copies within the note in editable and read-only views” |
| `sticky-note-ui-ac-conformance` | policy-grade tests: `packages/web/test/e2e/template-sticky-note-conformance.test.ts`, “Sticky note conforms: <story ID>” |
| `templates-bundled-t-inventory` | policy-grade test: `packages/server/test/checklist-template.test.ts`, “ships Checklist and Sticky note with their exact inventory identities and minimum versions” |
| `templates-install-t-validate` | policy-grade test: `packages/server/test/bundled-template-installation.test.ts`, “accepts exactly the bundled templates at or above their minimum versions” |
| `templates-install-t-build` | policy-grade test: `test/node/cli-assets.test.ts`, “ships the complete bundled template tree byte-for-byte through both builds” |
| `templates-install-t-retry` | policy-grade tests: `packages/server/test/bundled-template-installation.test.ts`, “keeps an invalid occupant when its socket prevents backup, then replaces it after the obstruction clears” and “keeps the prior folder after backup when a socket in bundled source blocks replacement copy, then retries” |
| `templates-install-t-independent-ids` | policy-grade test: `packages/server/test/bundled-template-installation.test.ts`, “handles both templates independently across prior state, preservation, replacement and a failed backup” |
| `t-template-classify` | policy-grade test: `packages/server/src/telemetry/derivation.test.ts`, “template-use telemetry derivation”, table “classifies %s without returning authored content” |
| `licensing-t-sticky-note-font` | policy-grade tests: `test/repo/licensing-config.test.ts`, “records the Sticky note story and packaged font with complete OFL notices”; `test/repo/licensing-generator.test.ts`, “regenerates the committed asset folder notices byte-for-byte” |
| `licensing-ac-ignored-silent` | policy-grade test: `test/node/licensing.test.ts`, cases tagged `^licensing-ac-ignored-silent` |
| `licensing-ac-sticky-note-font` | policy-grade test: `test/node/licensing.test.ts`, “Sticky note carries Caveat attribution in source and every package that ships its font” |
| Product bundled-template promise (`artifact-template-bundled`) | The shared creation walk, “new Sticky note from the popover persists its seed, display, edits and independent assets”, in `packages/web/test/e2e/template-sticky-note-real-stack.test.ts`, cited by `proofs/product/templates.md`. |

The 16 conformance exports are New, WithText, Empty, Loading, LoadingDisconnected, Typing, LongText, LongTextScrolled, ReadOnly, EmptyReadOnly, Disconnected, LongTextDisconnected, SaveFailed, Unreadable, UnreadableDisconnected and Dark. Each is compared against the complete production page with its font loaded, completed story play and no permitted differences.

Retained obligations: `af-ui-ac-transparent-state` remains in `packages/web/test/artifact-view.test.ts`; `af-ui-ac-transparent-hover` remains in `packages/web/test/e2e/artifact-view.test.ts`; `af-ui-ac-transparent-menu`, stage menu overlap and resize-state coverage remain in `packages/web/test/e2e/stage.test.ts`. These files and their assertions were not changed. Their broader surfaces were not added to the user’s requested validation selection.

## Test command ledger

Every canonical test invocation that produced a run record appears below, including red runs, failed diagnostics, preflight failures and manual reruns. Commands omit shell log redirection only. Counts are passed/failed/skipped; filtered Vitest cases appear as skipped. “Retries” means attempts actually retried, not the configured retry budget. A later row for the same command is an explicit manual rerun. Evidence is the named directory under `.test-runs/`, containing `results.json` and `summary.json`.

| Command | Result; passed / failed / skipped | Retries; recovered flakes | Run directory |
| --- | --- | --- | --- |
| `npm test -- local --file test/repo/test-runner-prebuilt.test.ts --grep 'one Storybook recipe'` | incomplete; 0 / 0 / 0; 0.4s | 0; 0 | `2026-10-23T15-05-49-002Z-p420-r646d225a76d933b3` |
| `npm test -- local --file test/repo/test-runner-config.test.ts` | incomplete; 0 / 0 / 0; 0.4s | 0; 0 | `2026-10-23T15-05-49-081Z-p420-r6b17e9308b0741ba` |
| `npm test -- local --file packages/server/test/sticky-note-template.test.ts` | incomplete; 0 / 0 / 0; 0.3s | 0; 0 | `2026-10-23T15-06-20-435Z-p420-rbb42bd7806a1e297` |
| `npm test -- local --file packages/server/test/checklist-template.test.ts` | incomplete; 0 / 0 / 0; 0.2s | 0; 0 | `2026-10-23T15-06-22-542Z-p420-ref1ffefffb2bacc7` |
| `npm test -- local --file packages/server/src/telemetry/derivation.test.ts --grep 'template-use telemetry derivation'` | incomplete; 0 / 0 / 0; 0.1s | 0; 0 | `2026-10-23T15-06-23-190Z-p420-r2e5f10be4b86baee` |
| `npm test -- local --file test/repo/test-runner-prebuilt.test.ts --grep 'one Storybook recipe'` | failed; 0 / 1 / 10; 6.9s | 0; 0 | `2026-10-23T15-06-51-930Z-p203037-r71f2295262e6ef98` |
| `npm test -- local --file test/repo/test-runner-config.test.ts` | failed; 11 / 3 / 0; 6.8s | 0; 0 | `2026-10-23T15-06-52-136Z-p203087-r510196b884611d1f` |
| `npm test -- local --file packages/server/test/sticky-note-model.test.ts` | incomplete; 0 / 0 / 0; 0.1s | 0; 0 | `2026-10-23T15-07-05-828Z-p420-r848b488ca44293e4` |
| `npm test -- local --file packages/server/test/bundled-template-installation.test.ts` | incomplete; 0 / 0 / 0; 0.1s | 0; 0 | `2026-10-23T15-07-18-156Z-p420-r6314c8a8a155ea4b` |
| `npm test -- local --file packages/server/test/sticky-note-model.test.ts` | failed; 0 / 0 / 0; 3.3s | 0; 0 | `2026-10-23T15-07-28-034Z-p207217-r68b2781b1967275c` |
| `npm test -- local --file test/repo/test-runner-config.test.ts` | passed; 14 / 0 / 0; 6.8s | 0; 0 | `2026-10-23T15-09-20-780Z-p218961-r2ad6b4e913008fb8` |
| `npm test -- local --file test/repo/test-runner-prebuilt.test.ts` | failed; 10 / 1 / 0; 62.8s | 0; 0 | `2026-10-23T15-09-21-924Z-p219354-r965cbf44380ae9da` |
| `npm test -- local --file packages/server/test/sticky-note-model.test.ts` | failed; 0 / 29 / 0; 12.1s | 0; 0 | `2026-10-23T15-09-24-162Z-p219982-ra00feb3186cedf4e` |
| `npm test -- local --file packages/server/test/checklist-template.test.ts` | failed; 3 / 1 / 0; 28.1s | 0; 0 | `2026-10-23T15-09-37-840Z-p222237-r21f26320d484afcb` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-conformance.test.ts` | failed; 0 / 16 / 0; 167.0s | 32; 0 | `2026-10-23T15-09-40-839Z-p222966-r56fef3f3959b70c3` |
| `npm test -- local --file packages/server/src/telemetry/derivation.test.ts --grep 'template-use telemetry derivation'` | failed; 8 / 2 / 94; 27.6s | 0; 0 | `2026-10-23T15-09-43-435Z-p223394-r2da20361fe070d1d` |
| `npm test -- local --file packages/server/test/bundled-template-installation.test.ts` | failed; 8 / 9 / 0; 31.2s | 0; 0 | `2026-10-23T15-09-46-432Z-p224003-r22dcfd556035eb4e` |
| `npm test -- local --file test/repo/licensing-config.test.ts` | failed; 19 / 2 / 0; 21.8s | 0; 0 | `2026-10-23T15-09-50-268Z-p224412-re2ae8d96e4229a05` |
| `npm test -- local --file test/repo/licensing-generator.test.ts` | failed; 17 / 1 / 0; 22.6s | 0; 0 | `2026-10-23T15-09-53-790Z-p224779-r898aa61f1ec8dbff` |
| `npm test -- local --file packages/server/test/sticky-note-template.test.ts` | failed; 0 / 3 / 0; 9.2s | 0; 0 | `2026-10-23T15-10-12-070Z-p226606-rc9ff19de4cdaf7e4` |
| `npm test -- local --file packages/server/test/sticky-note-model.test.ts` | passed; 29 / 0 / 0; 4.4s | 0; 0 | `2026-10-23T15-11-05-946Z-p231489-ra1afd2b1763581f5` |
| `npm test -- local --file packages/server/test/sticky-note-model.test.ts --grep 'discards a draft'` | failed; 2 / 1 / 26; 4.9s | 0; 0 | `2026-10-23T15-12-14-313Z-p238092-rd153dbdcea3a384c` |
| `npm test -- local --file packages/server/test/sticky-note-model.test.ts` | passed; 29 / 0 / 0; 4.2s | 0; 0 | `2026-10-23T15-12-47-924Z-p241658-rf43d98c2b1025e53` |
| `npm test -- local --file test/repo/test-runner-prebuilt.test.ts --grep 'real plan-file worker suppresses'` | passed; 1 / 0 / 10; 9.1s | 0; 0 | `2026-10-23T15-12-56-276Z-p243754-r0f9bc3029bf30910` |
| `npm test -- local --file test/repo/test-runner-prebuilt.test.ts` | passed; 11 / 0 / 0; 17.4s | 0; 0 | `2026-10-23T15-13-34-643Z-p246224-r137153d26f6d9903` |
| `npm test -- local --file packages/server/test/sticky-note-template.test.ts --grep 'font unchanged\|documents shared'` | failed; 1 / 1 / 1; 5.5s | 0; 0 | `2026-10-23T15-13-35-741Z-p246621-r12ec5cb14435f193` |
| `npm test -- local --file packages/server/src/telemetry/derivation.test.ts` | passed; 104 / 0 / 0; 5.2s | 0; 0 | `2026-10-23T15-13-39-178Z-p247244-r18a4629cf9cbfd19` |
| `npm test -- local --file packages/server/test/checklist-template.test.ts` | passed; 4 / 0 / 0; 5.2s | 0; 0 | `2026-10-23T15-13-42-320Z-p247785-r79b8f8bceca52505` |
| `npm test -- local --file packages/server/test/network-proxy.test.ts` | passed; 6 / 0 / 0; 4.1s | 0; 0 | `2026-10-23T15-14-17-609Z-p251490-rfd18743ceac89563` |
| `npm test -- local --file packages/server/test/sticky-note-template.test.ts` | passed; 3 / 0 / 0; 2.9s | 0; 0 | `2026-10-23T15-14-37-372Z-p253248-r75535da9ebd09e9b` |
| `npm test -- local --file packages/server/test/bundled-template-installation.test.ts` | passed; 17 / 0 / 0; 12.0s | 0; 0 | `2026-10-23T15-14-40-377Z-p253760-rce7cf40d8fd1ad0c` |
| `npm test -- local --file test/node/licensing.test.ts --grep 'Sticky note carries Caveat' --retries 0` | failed; 0 / 1 / 18; 24.1s | 0; 0 | `2026-10-23T15-15-00-304Z-p254768-r8d65de9eb5c40526` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | failed; 0 / 16 / 0; 166.7s | 0; 0 | `2026-10-23T15-15-51-399Z-p260713-r3415f939dcfb6722` |
| `npm test -- local --file test/repo/licensing-config.test.ts` | passed; 21 / 0 / 0; 4.3s | 0; 0 | `2026-10-23T15-16-16-827Z-p266527-r2af5d60cccb7c953` |
| `npm test -- local --file test/repo/licensing-generator.test.ts` | passed; 18 / 0 / 0; 3.5s | 0; 0 | `2026-10-23T15-16-19-551Z-p267411-r34e2a39085754993` |
| `npm test -- local --file test/node/licensing.test.ts` | passed; 19 / 0 / 0; 31.2s | 0; 0 | `2026-10-23T15-16-21-766Z-p267926-r84c2ab2adbd2fcf1` |
| `npm test -- local --file test/node/cli-assets.test.ts` | passed; 24 / 0 / 0; 25.0s | 0; 0 | `2026-10-23T15-17-37-224Z-p275999-r9fa8492f521ca908` |
| `npm test -- local --file packages/web/test/e2e/template-checklist-real-stack.test.ts --retries 0` | passed; 23 / 0 / 0; 57.1s | 0; 0 | `2026-10-23T15-19-18-440Z-p285099-r39361b01bb8b2ec8` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | failed; 13 / 3 / 0; 106.9s | 0; 0 | `2026-10-23T15-20-53-375Z-p291614-rb7326f1e44d7418b` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-conformance.test.ts --retries 0` | failed; 9 / 7 / 0; 69.9s | 0; 0 | `2026-10-23T15-23-33-801Z-p308225-r0cafaccbf3e55de4` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'new Sticky note\|real editing preserves\|real share access' --retries 0` | failed; 1 / 2 / 0; 37.4s | 0; 0 | `2026-10-23T15-25-17-295Z-p315212-reaeaae5033be1280` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-conformance.test.ts --grep 'sticky-note--(empty\|loading-disconnected\|typing\|disconnected\|long-text-disconnected\|save-failed\|unreadable-disconnected)$' --retries 0` | passed; 7 / 0 / 0; 72.2s | 0; 0 | `2026-10-23T15-27-40-439Z-p320156-rd41c529aecba99c2` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'real editing preserves\|real share access' --retries 0` | failed; 0 / 2 / 0; 36.4s | 0; 0 | `2026-10-23T15-29-40-654Z-p327803-rf8f39eed4ef2772d` |
| `npm test -- local --file test/repo/spec-links.test.ts` | passed; 8 / 0 / 0; 4.7s | 0; 0 | `2026-10-23T15-31-48-722Z-p335254-rea14b0e7878ad439` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'real editing preserves\|real share access\|long text scrolls' --retries 0` | passed; 3 / 0 / 0; 35.8s | 0; 0 | `2026-10-23T15-32-43-751Z-p339735-r27fc73655b6d2a0b` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | passed; 16 / 0 / 0; 99.1s | 0; 0 | `2026-10-23T15-33-38-887Z-p343848-r3459bc14cdcbca0d` |
| `npm test -- local --file packages/web/test/e2e/template-sticky-note-conformance.test.ts --retries 0` | passed; 16 / 0 / 0; 59.5s | 0; 0 | `2026-10-23T15-36-19-334Z-p352378-r59c53d6d9407729d` |
| `npm test -- local --file packages/web/test/e2e/template-checklist-conformance.test.ts --retries 0` | passed; 21 / 0 / 0; 100.9s | 0; 0 | `2026-10-23T15-37-29-845Z-p362467-r5095e7160873ac08` |
| `npm test -- local --surface unit:server,unit:root,e2e:node,e2e:browser-app-real-stack,e2e:checklist-conformance,e2e:sticky-note-conformance` | failed; 2055 / 2 / 5; 1052.5s | 0; 0 | `2026-10-23T15-39-33-957Z-p375636-r9afe2f9cc117187d` |
| `node scripts/test/cli.mjs local --file test/repo/node-toolchain.test.ts --grep 'writes the selected-test sentinel' --no-publish` | incomplete; 0 / 0 / 0; 0.0s | 0; 0 | `2026-10-23T15-41-26-752Z-p388796-rda4c154e0e87e576` |
| `npm test -- local --file test/repo/test-runner-shard-plan.test.ts` | passed; 10 / 0 / 0; 8.8s | 0; 0 | `2026-10-23T15-58-54-037Z-p450333-r83a50c4ed48fa868` |
| `npm test -- local --file test/repo/test-runner-provider.test.ts --grep 'selects package surfaces'` | passed; 1 / 0 / 41; 3.2s | 0; 0 | `2026-10-23T15-58-55-628Z-p450811-r9841e0277d01acfe` |
| `npm test -- local --surface unit:root` | passed; 449 / 0 / 1; 118.4s | 0; 0 | `2026-10-23T15-59-19-520Z-p452580-r6ce56288139f48fd` |
| `node scripts/test/cli.mjs local --file test/repo/node-toolchain.test.ts --grep 'writes the selected-test sentinel' --no-publish` | incomplete; 0 / 0 / 0; 0.0s | 0; 0 | `2026-10-23T16-01-07-732Z-p459456-r6269e017d35bb78f` |
| `npm test -- local --file test/repo/spec-links.test.ts` | passed; 8 / 0 / 0; 6.8s | 0; 0 | `2026-10-23T16-04-23-110Z-p468905-r9b3f1eb2ed72d598` |

Two additional escalated targeted invocations exited 2 before creating a run record while new browser paths were temporarily registered before their files existed: `npm test -- local --file packages/server/test/sticky-note-model.test.ts` and `npm test -- local --file packages/server/test/sticky-note-template.test.ts`. Both were rerun after registration completed.

The two `node scripts/test/cli.mjs` rows for the selected-test sentinel are expected negative child probes spawned by `node-toolchain.test.ts`. The fixture deliberately supplies npm 10.9.4 and proves that preflight rejects it before executing the sentinel. Their incomplete status is the asserted result; their parent tests pass. The actual session runtime is npm 11.17.0.

## Development failures and their resolutions

- Restricted subprocesses returned `EPERM` from Node `spawnSync("npm", ["--version"])`; canonical preflight therefore reported npm unavailable. Authorized escalated runs resolved the environment issue. No tests executed in those incomplete runs.
- Model red first failed to import its absent production module, then all 29 cases failed against deliberately unimplemented exports. The implementation passed all 29. Strengthening recovery to require a new edit after unavailable data exposed one failure; marking a completed non-disconnection read failure as checked allowed later valid subscription data to save again, and all 29 passed.
- Package, inventory, installation, telemetry, license inputs and runner-registration tests failed before their implementation. The package README test briefly overconstrained capitalization and wrapping; its check was corrected to the required meaning, without changing product prose to satisfy that incidental assumption.
- Real packed licensing red failed on the missing template folder notice. Regenerating notices made packed licensing pass. Existing generic build copying passed once the new folder existed.
- Initial conformance red failed all 16 states because the template was absent; the default retry budget retried each twice (32 retries). After implementation, nine passed and seven exposed an incompatible Playwright locator matcher in test readiness. Native waits and primitive polling fixed the test harness; all 16 then passed without retries.
- The first behavior run failed all 16 cases against the empty page. After implementation it passed 13 and failed three. A click hit an app resize handle, and a read-only native key sequence did not select text in Chromium; those test mechanics were corrected. Native control experiments isolated the real remaining bug: assigning an unchanged placeholder on every input splits the browser’s undo group. The page now updates the attribute only when its state changes. The unchanged undo expectation passes. Clipboard tests use real selection and fresh sentinels to rule out stale copied text.
- An unchanged nested-worker prebuilt test failed once with `STACK_TRACE_ERROR` while another worker built Storybook. It passed in isolation and on the full file rerun without code changes. Builds and browser commands were serialized afterward.
- Initial `npm run type-check` exited 2 because the new browser test used `Array.findLast`, outside the configured TypeScript library, causing a related implicit-any diagnostic. Using `filter(...).at(-1)` fixed the helper; the next type-check passed.
- The first combined owning-surface run found two repository checks beyond the targeted list: an old package-selector assertion omitted both conformance surfaces (Checklist was already missing at HEAD), and tracked inventory could not see the untracked new config. The assertion now names the four registered web-package surfaces. The 21 new files were marked intent-to-add so the existing tracked-inventory check can see them; no file content is staged and no commit was made. The inventory implementation and its tests were not weakened.

## Other commands

| Command | Actual result |
| --- | --- |
| `npm run type-check` | First run: exit 2, unsupported test helper and related implicit-any. Second and final runs: exit 0. |
| `npm run lint` | All three runs exited 0, no warnings. |
| `node scripts/specs-index.mjs` | Both runs exited 0; 145 specs and 128 proofs indexed; generated files unchanged. |
| `git diff --check` | Passed throughout development and in the final check. |
| `git add --intent-to-add --pathspec-from-file=/tmp/sticky-note-new-files --pathspec-file-nul` | Exit 0; 21 new task files become visible to tracked-file inventory. `git diff --cached --stat` remains empty. |
| `nvm use` | Selected Node v24.19.0 and npm 11.17.0. |
| `python3 -u -m http.server 0 --bind 127.0.0.1 --directory storybook/dist` | Served this checkout’s Storybook at port 33847 for the capture; stopped afterward. |
| `node packages/server/scripts/capture-sticky-note-thumbnail.mjs http://127.0.0.1:33847` | Exit 0; captured and visually reviewed the transparent 360 × 360 WithText image. |
| `generateSourceNotices({outputPath: "THIRD-PARTY-NOTICES.txt"})` and `generateFolderNotices({write: true})` from `scripts/licenses/generate-notices.mjs` | Succeeded; regenerated root and six folder notices. Root/story output remained byte-identical. |

Read-only file searches, source/diff inspection, log polling and image inspection are not repeated in this validation ledger. They introduced no changes or independent validation claims.

## Findings, review and limits

No spec/proof contradiction or ambiguity was found. The plan asks for `npm run verify`; the user explicitly prohibits that command and assigns full verification to the principal after review. This report therefore records the requested targeted files, six owning surfaces and individual repository checks, without claiming the unrun full gate.

The independent reviewer used `gpt-6-astra` at `xhigh` reasoning effort and read the actual production code, tests, packaging, licensing and proof changes. Review and the follow-up for native undo and selection passed. It did not rerun tests; the command ledger supplies execution evidence.

Independent final proof audit passed: no assertion or anchor was weakened or dropped from `fde3c79`, all citations name executable evidence, and no assigned pending marker remains. The additional package-selector assertion correction also passed review. A separate bounded simplification pass and architecture assessment passed without edits or judgment findings.

A subsequent independent Codex review returned FAIL for one blocking test gap: the blur step could pass through the ordinary debounce. The model and reasoning effort of that review were not exposed, and the reviewer performed no test execution. The correction and mutation evidence below supersede the initial blur-coverage assessment for `sticky-note-ui-ac-new`.

The browser files in this slice own Chromium. Runner preflight reported no Firefox executable; no Firefox result is claimed. Thumbnail composition and README meaning were reviewed separately because file assertions alone cannot prove them.

## Initial owning-surface baseline

The required six-surface command ran to completion. Its only failures were the package-selection assertion and tracked-file inventory in `unit:root`; the other five surfaces passed on the final production code. After the two corrections passed their focused checks, the complete affected `unit:root` surface passed. The original combined command is accurately recorded as failed in the ledger; no successful rerun of all six together is claimed.

| Surface | Final passing tests | Existing skips | Failures | Recovered flakes |
| --- | ---: | ---: | ---: | ---: |
| `unit:root` (affected-surface rerun) | 449 | 1 | 0 | 0 |
| `unit:server` | 1,183 | 1 | 0 | 0 |
| `e2e:node` | 325 | 2 | 0 | 0 |
| `e2e:browser-app-real-stack` | 63 | 1 | 0 | 0 |
| `e2e:checklist-conformance` | 21 | 0 | 0 | 0 |
| `e2e:sticky-note-conformance` | 16 | 0 | 0 | 0 |
| **Total** | **2,057** | **5** | **0** | **0** |

The five existing skips are the GitHub-identity lifecycle guardrail, the privileged-port permission case this host cannot stage, two Firefox resource acceptance cases and the Firefox Markdown theme-refresh case. No Sticky note obligation is skipped. These two run records report no infrastructure failures or process leaks.

Final runtime evidence: `.test-runs/2026-10-23T15-39-33-957Z-p375636-r9afe2f9cc117187d/results.json`. Corrected repository-unit evidence: `.test-runs/2026-10-23T15-59-19-520Z-p452580-r6ce56288139f48fd/results.json`.

Nothing remains incomplete in the implementation, assigned proof assertions or requested validation. Full `npm run verify` remains intentionally unrun for the principal after review, as the user instructed. All changes remain unstaged; new files have intent-to-add entries only. HEAD is unchanged, and no requested action has committed or published the work.

## Review correction — elapsed-time blur check (superseded)

The later P2 finding was reproduced: removing the production blur listener left the original creation test passing. Waiting for a held write and eventual persistence did not distinguish blur saving from the ordinary 400 ms debounce.

That correction changed only `packages/web/test/e2e/template-sticky-note-real-stack.test.ts` and this ledger. The creation case recorded native input, native blur and the SDK optimistic write event with `performance.now()` in the same artifact frame. It required that event order and a write less than 400 ms after input. The proxy observation and persisted-value assertion remained. The observer changed no timer, handler or SDK operation. The test name and proof citation for `sticky-note-ui-ac-new` were unchanged.

Mutation evidence: with exactly `field.addEventListener("blur", () => model.blur());` removed from the production page, the strengthened test failed specifically at the new timing assertion: expected less than 400 ms, received `400.6999999284744` ms. Restoring the listener made the same case pass. The production page was restored byte-for-byte; its pre-mutation and final SHA-256 are both `a17a0a16b8c69ef71589deda315789dc66f767b9f82a5071e2b7574d854e6e32`. No production defect or persistent production change resulted.

| Phase | Command | Actual result | Evidence under `.test-runs/` |
| --- | --- | --- | --- |
| Reproduce the original gap, listener removed | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'new Sticky note from the popover' --retries 0` | Exit 0; 1 passed; 0 retries; 22.849 s. | `2026-10-23T16-21-42-638Z-p497109-reb83b924d353d6ef/results.json` |
| Strengthened test, listener still removed | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'new Sticky note from the popover' --retries 0` | Exit 1; 1 failed at the before-debounce assertion; 0 retries; 21.279 s. | `2026-10-23T16-22-43-240Z-p498853-rb8df13a4d746e096/results.json` |
| Listener restored | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'new Sticky note from the popover' --retries 0` | Exit 0; 1 passed; 0 retries; 22.740 s. | `2026-10-23T16-23-29-669Z-p500549-r9f4b4346ad4216e7/results.json` |
| Complete affected file | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | Exit 0; 16 passed; 0 skipped, failures or retries; 80.364 s. | `2026-10-23T16-24-22-521Z-p501830-rb141275c0f5a32e6/results.json` |
| Complete owning surface | `npm test -- local --surface e2e:browser-app-real-stack --retries 0` | Exit 0; 63 passed, 1 existing Firefox-specific skip; 0 failures or retries; 191.916 s. | `2026-10-23T16-26-06-278Z-p504045-r3b92c2254e4da199/results.json` |
| Types | `npm run type-check` | Exit 0. | `/tmp/sticky-blur-type-check.log` |
| Lint, first invocation and identical rerun | `npm run lint` | First: exit 2 from `ENOENT` while traversing `.agents`. Rerun: exit 0, no source changes between attempts. | `/tmp/sticky-blur-lint.log`, `/tmp/sticky-blur-lint-rerun.log` |
| Whitespace, before and after ledger completion | `git diff --check` | Both checks exited 0. | Terminal output. |

All five browser run records report zero infrastructure failures and process leaks. No automatic retry recovered a failure. A further independent source review rejected this correction: scheduling between `fill()` and Tab could exceed 400 ms on correct code, and the separate `/text` observer had not received a confirmed initial value before input. The mutation failure showed sensitivity to removing the listener, but did not resolve those two defects in the test. The event-order correction below supersedes this approach and its coverage claim.

## Review correction — saving during native blur

Changed only `packages/web/test/e2e/template-sticky-note-real-stack.test.ts` and this ledger. The creation case awaits a nonpending snapshot from the page's existing root subscription before any observed input. A capture listener records the unsent draft before the production blur handler; a listener registered after that handler closes the observation during the same native blur dispatch. The test requires `blur → write → after blur`. The SDK write must therefore start during blur; a subsequent debounce cannot supply the recorded event. Timers stay real, and there is no elapsed-time threshold, replaced handler, SDK stub or rendered-content change.

If the draft has already reached the SDK before Tab, the test releases and confirms that write, fills a different draft, and tries the setup again. The case deliberately allows its first draft to debounce before Tab, exercising this recovery on every run. Once blur starts with an unsent draft, a missing synchronous write fails immediately; that assertion is never retried. The existing proxy observation, blank status check and persisted-value assertion remain.

This proves the browser blur wiring assigned to `sticky-note-ui-ac-new` in the existing test, “new Sticky note from the popover persists its seed, display, edits and independent assets.” Its proof citation remains valid without a text change. No spec, proof or plan disagreement, production defect, or additional implementation obligation was found.

Removing exactly `field.addEventListener("blur", () => model.blur());` produced the intended failure: expected `blur → write → after blur`, received `blur → after blur`. Restoring the listener made the same case pass. The production page's SHA-256 before removal and after restoration is `a17a0a16b8c69ef71589deda315789dc66f767b9f82a5071e2b7574d854e6e32`.

| Phase | Command | Actual result | Evidence under `.test-runs/` |
| --- | --- | --- | --- |
| Production blur listener removed | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'new Sticky note from the popover' --retries 0` | Exit 1; 1 failed at the synchronous event-order assertion; 0 retries; 29.745 s. | `2026-10-23T16-41-31-510Z-p574640-r9727a0b22c994fbd/results.json` |
| Listener restored | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --grep 'new Sticky note from the popover' --retries 0` | Exit 0; 1 passed; 0 retries; 25.202 s. | `2026-10-23T16-42-14-136Z-p579666-raa84def3bdbdcb64/results.json` |
| Complete affected file, run 1 | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | Exit 0; 16 passed; 0 skipped, failures or retries; 86.649 s. | `2026-10-23T16-42-57-254Z-p582817-rfcd213802e6e2b00/results.json` |
| Complete affected file, run 2 | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | Exit 0; 16 passed; 0 skipped, failures or retries; 91.175 s. | `2026-10-23T16-44-24-419Z-p587326-r0ef5a63ceae2b05d/results.json` |
| Complete affected file, run 3 | `npm test -- local --file packages/web/test/e2e/template-sticky-note-real-stack.test.ts --retries 0` | Exit 0; 16 passed; 0 skipped, failures or retries; 103.272 s. | `2026-10-23T16-45-56-277Z-p598014-rd4de04af0855d21f/results.json` |
| Complete owning surface | `npm test -- local --surface e2e:browser-app-real-stack --retries 0` | Exit 0; 63 passed, 1 existing Firefox-specific skip; 0 failures or retries; 368.758 s. | `2026-10-23T16-47-48-298Z-p629038-r2b2af5d31b6b8e8f/results.json` |
| Types | `npm run type-check` | Exit 0 on the first invocation. | `/tmp/sticky-blur-event-order-type-check.log` |
| Lint | `npm run lint` | Exit 0 on the first invocation, no warnings. | `/tmp/sticky-blur-event-order-lint.log` |
| Whitespace, before and after ledger completion | `git diff --check` | Both checks exited 0. | Terminal output. |

All six browser run records report zero infrastructure failures, process leaks and recovered flakes. The single skipped case is the existing Firefox Markdown theme-refresh test; no Sticky note case is skipped. Setup recovery within the creation case is distinct from test retries: every command used `--retries 0`, and the runner reports zero retries.

Both review findings are addressed by the event-order assertion, confirmed observer readiness and exercised setup recovery. No work remains in this correction. Full `npm run verify` remains intentionally unrun for the principal. The tested tree is the uncommitted working tree on `f7e0dae600ad725e0c109090c78067fffcbaa651`; no commit, push, host installation or change to the existing Storybook server was made. The temporary production mutation was fully restored.
