# Linked templates and Toolbox: implementation plan

Implement the approved linked-template and Toolbox contracts in four sequential red/green TDD slices. This plan groups the work, assigns proof obligations, and records the test failures each slice must resolve. It does not change product or architecture decisions.

The starting tree is `96d85ae`, with specs approved at `bf195c7` against `54cd365` and proofs approved at `96d85ae`. The branch is `feat/linked-templates`; its contribution target is `feat/artifact-templates`. See the [task record](linked-templates-task.md), [planning and slices](../../specs/spec-workflow.md#planning-and-slices), and [testing policy](../../specs/arch/testing-policy.md). This document is an authored plan awaiting independent convergence, not an implementation or verification report.

## Implementation approach and verification

Keep the existing ordinary artifact records, resource stores, display resolver, placement operations, shared content watcher, authenticated client, event connection, and popover. Default links and explicit copies differ in the registered path; URL templates use the ordinary URL record. Detachment uses the existing path update. There is no new origin record, detach command, store migration, or runtime schema-version comparison.

The present implementation concentrates validation in `packages/server/src/templates.ts`, creation in `ServerStore.createTemplateArtifact`, transport in `routes.ts` and the shared `TemplateClient`, and CLI commands in `packages/cli/src/index.ts`. The app currently keeps scans and thumbnail URLs inside `packages/web/src/views/skill-selector.ts` only while it is open. Move that lifetime to the server connection, then replace the grid interaction with Toolbox. Keep schema and icon permutation tests at the contract boundary; share browser/CLI journeys where the proofs explicitly share obligations.

For each slice, first write or re-derive its proof-backed tests, observe the intended failures with a narrow selection, implement, and rerun that selection before widening to the affected suites. Retire assertions for retired promises in the same slice that replaces them; do not keep obsolete behavior just to preserve a green test. Retain surviving claims and their evidence grades. During implementation, update proof citations to the actual passing tests without silently changing assertion scope or mocks. The proof lists below allocate every one of the 61 pending assertions; linked proofs supply their complete declarations and test hooks.

Use `npm test -- local --file <test-file>` with `--grep <test-title>` where useful, through the [canonical runner](../../specs/arch/test-runner/test-runner.md). Add new tests to an appropriate existing surface, or register the required surface and services when existing ownership cannot run them. Keep production mounts and browser input real where the proofs require them. Preserve the existing desktop boot barrier, token isolation, ordinary live reload, and retained UI stylesheet checks when extending their seams.

Both `~/.tv-developer` and `~/.tvdev-use-blaxel` exist on this host. Full verification is `npm run verify`, with the suite dispatched to Blaxel on a committed, pushed revision. [Remote preflight](../../specs/arch/test-runner/preflight.md#contributor-branches-and-remote-revisions) must pass; uncommitted edits are not evidence from a remote run. Do not use local full verification as a convenience fallback. This planning task runs no behavioral tests and makes no commit; the final verification below is future implementation work.

## Starting baseline and later healing

Only the two mirror failures below have a recorded executed result. Other entries are predictions from the current source and test expectations, not newly measured failures. A passing test that still asserts a retired promise is also work to replace, even before it turns red.

| Baseline or expected intermediate failure | Healing slice |
|---|---|
| Recorded `test/repo/spec-links.test.ts`: six pass, two fail because `toolbox.md` is expected to mirror a `.md` spec. The index generator also omits the standalone MDX spec. | 3 |
| `test/repo/skills-build.test.ts` still expects template starting data, `thumbnail.png`, copy exclusions, and old introduction wording in sources already revised by the spec commit. | 4 |
| `test/repo/theming-reference.test.ts` still lists the three Templates pilot authorities; the approved app-shell reference fingerprints Toolbox stories, the MDX spec, and Toolbox CSS. | 3 |
| Scanner, server creation/failure, CLI, and Example tests expect automatic copying or template seeding. | 1, except icon-specific scanner/route assertions in 2 |
| The thumbnail route/client and their tests are replaced by icons; cached/default/fresh list behavior replaces the unconditional scan route. | 2 |
| `packages/web/test/e2e/skill-selector.test.ts` retains the thumbnail grid, description search, scan-on-open, old messages, automatic-copy/seed outcomes, and a seed-write UI failure. Related navbar/settings/theme tests retain Templates selectors. These can fail after slices 1–2. | 3 |
| Bundled installation tests encode staged/prior-folder rollback and require the old folder to remain through replacement failure. Those assertions can still pass while the implementation violates the approved recovery contract. | 4 |

At each slice boundary, its new and adapted tests must pass. Carry only the explicitly assigned later obligations above, with concrete failing test names recorded if they are encountered. An unexpected failure is investigated and either repaired in the responsible slice or explicitly assigned to a later slice; it is not covered by a blanket allowance for a failing suite. Mechanical type/fixture updates travel with changed interfaces so subsequent slices can build and test without compatibility fields for `hasData` or `hasThumbnail`.

## Slice 1 — Linked, copied, and URL creation through the CLI

**Scope.** Change folder validation and the shared records to the specified flat contracts, add URL templates and manifest `dataSchema`, and implement caller-only starting data. Use a maintained Draft 2020-12 validator with an explicit server dependency and packaged-build coverage; configure it for local schema references, the specified dialect and annotation behavior, and no coercion, default insertion, or field removal. A supporting `data.json` is ordinary content. Preserve exact IDs, display validation, error aggregation, and scan ordering. Icon selection and watched discovery are completed in slice 2.

Change creation, its HTTP request validation, shared client types, and CLI together. Default/false copy registers the installed folder; true copy excludes only `manifest.json` and retains supporting files and working internal symlinks. URL creation returns a URL and has no store. Reject the presence of data or copy for URL templates, including null/false. Validate caller data and all placement/display inputs before effects, recheck placement on save, preserve created content on later failures, and report the target, attempted ID, and unconfirmed step. Keep template-use telemetry at confirmed success with its closed vocabulary and privacy limits.

Add `--copy` and `templates show`; list/show request fresh scans and project their separate records without app metadata. Preserve selected-home behavior, stdin, focus-output ordering, and rejection of template-only options on path/URL sources. Prove shared files with separate stores, live edits, disappearance/restoration, and detachment through the existing command in one linked-artifact journey; share its store assertions with the resource proof.

Update the bundled Example now because its page currently relies on template seeding: remove its bundled starting-data file, add the exact approved schema, render the default for absent/non-string messages without writing, preserve an empty string and safe text, and explain per-artifact data and copying/detaching in its README. Keep the approved initial and minimum versions at `1.0.0`; a valid installed `1.0.0` remains preservable.

**Proof assertions discharged.**

| Proof | Assertions |
|---|---|
| [Template architecture](../../proofs/arch/templates/index.md) | `templates-t-package`, `templates-t-schema`, outstanding error ordering in `templates-t-scan`, `templates-t-create-route`, `templates-t-preflight`, `templates-t-preflight-seam`, `templates-t-copy`, `templates-t-display-resolution`, `templates-t-transparent-resolution`, `templates-t-folder-name`, `templates-t-failure`, `templates-t-uncertain-seed` |
| [CLI architecture](../../proofs/arch/cli/index.md) | `cli-t-template-create`, `cli-t-template-commands`; retain `cli-t-template-path` |
| [Product templates](../../proofs/product/templates.md) | `templates-ac-discovery`, `templates-ac-cli-create`, `templates-ac-copy-detach`, `templates-ac-url-create`, `templates-ac-display-cli`, `templates-ac-transparent-cli`, `templates-ac-data-refusal`, `templates-ac-cli-post-copy-failure`; retain the discovery refusal claim |
| [Product CLI](../../proofs/product/cli.md) | `cli-ac-create-artifact`, `cli-ac-template-stdin`, `cli-ac-template-show-refusal`, `cli-ac-template-options-refusal` |
| [Resources](../../proofs/product/resources/resources.md) and [telemetry](../../proofs/product/telemetry.md) | `rs-ac-shared-folder` in the shared linked/detach journey; `ac-artifact-template` across linked, copied and URL successes and data/save failures |
| [Bundled Example](../../proofs/arch/templates/bundled-templates.md) | `templates-example-t-package`, `templates-example-ac-live`; retain `templates-example-t-no-display` |

**Red/green and verification criteria.** Start with scanner and preflight tables, then real creation HTTP tests, CLI contracts, and built-CLI/browser journeys. Extend `packages/server/test/templates-{scanner,create,failures,routes}.test.ts`, `packages/cli/test/cli.test.ts`, and `test/node/cli-acceptance.test.ts`; share the browser resource/link journey rather than duplicate it. Adapt the package assertion in `bundled-template-installation.test.ts` and `packages/web/test/e2e/template-example-real-stack.test.ts`. Keep real resource writes and ordinary record/layout persistence in the seam tests. The declared uncertain-save adapter is the exception for that failure, not a substitute for successful writes.

Explicitly request copying in slug/collision and copied-symlink tests. Supply caller data in store-failure tests. Replace seed expectations with unwritten-store and explicit-null checks, and confirm that later ordinary writes remain independent of the template schema. Validate the changed Example source and real server/CLI packaged tree through `test/node/cli-assets.test.ts`; source/build/resolver claims must still hold with the changed file inventory.

**Expected exit baseline.** Core scanner/schema, creation, CLI, and Example obligations above are green, including their retained display, placement, malformed-request, and privacy coverage. Icon/discovery work remains assigned to slice 2; old UI expectations and MDX/theming-reference failures remain assigned to slice 3; installer recovery and delivered-guidance failures remain assigned to slice 4. This slice does not claim the complete app or suite is green.

## Slice 2 — Watched discovery, authenticated icons, and the app cache

**Scope.** Finish usable manifest icons, deterministic selection, and the authenticated bytes/content-type route. Replace thumbnail delivery and client APIs. Repeat selection and real-path containment on delivery; while watching is unavailable, icon-only validation changes neither scan cache nor events. No runtime favicon fetching is introduced.

Add the server scan cache after bundled handling in serving bootstrap step 6, with recursive observation through `file-watcher.ts`; token-only construction starts neither cache nor watcher. Watch setup and the initial scan must cover intervening edits. Debounce bursts, prevent stale publication, publish full scans and invalidated IDs, and implement warning/fallback/recovery and disposal. Fresh CLI/create scans feed the same cache/publication path. Preserve first `server-status`, no template-event replay, and the separate artifact-content event for a linked folder.

Own the app list and icon bytes per `ServerConnection`, including when the popover is closed. Subscribe before startup/reconnect loads; invalidate correctly on full loads and pushes; reject stale list/icon completions. Failed initial loads retry on opening without making an otherwise usable connection fail. Watcher failure refreshes on each opening and once when learned while open, without a repeated-false push loop. Wire this cache into the current popover now so real transport and opening behavior can be proved before the visual rewrite. Slice 3 owns Toolbox interaction and appearance.

**Proof assertions discharged.**

| Proof | Assertions |
|---|---|
| [Template architecture](../../proofs/arch/templates/index.md) | `templates-t-icons`, `templates-t-cache-order`, `templates-t-cache-events`, `templates-t-routes`, `templates-t-icon-route`, `templates-t-app-cache`, `templates-t-app-cache-seam`, `templates-ac-cache-fallback`; retain fresh creation lookup from slice 1 |
| [Bootstrap](../../proofs/arch/onboarding/installer.md) | `onboarding-t-template-cache-boot`, `onboarding-t-template-cache-inert` |
| [Shared watcher](../../proofs/arch/artifact-frame/reload-navigation.md) | `rn-t-template-watcher` |
| [Isolation](../../proofs/arch/artifact-frame/isolation.md) | `iso-t-template-icons` |

**Red/green and verification criteria.** Add scanner icon tables and ordered cache contracts using only the proof-declared peers; cross native filesystem observation, authenticated HTTP, and `/events` for real in the server seams. Extend `templates-routes.test.ts`, `onboarding-installer.test.ts`, and `cross-origin-routes.test.ts`, plus focused cache tests and affected server-connection/shared-client tests. Replace the explicitly retired thumbnail assertion `templates-t-thumbnail-route` with icon coverage, including encoded IDs, retargeted symlinks, `no-store`, correct media type, and fallback isolation.

Run the real-browser cache seam and fallback walk against the production connection and current popover: startup preload, request-free opening after success, edits while closed, reconnect after missed edits, delayed stale responses, initial-load retry, and watcher failure/recovery. Keep the previous list visible while refreshing. Use the specified response delay/abort and watcher-failure hooks only for the declared exceptional conditions. Failed-image and default-icon presentation remain in slice 3. Adapt the existing watcher-count fixtures to distinguish template observation in step 6 from artifact/theme observation in step 8; retain the original ordinary watcher claims.

**Expected exit baseline.** All server/client cache and icon obligations above are green, together with slice 1. There is no remaining old thumbnail route obligation. The current UI may still fail the grid/search/message/Toolbox tests assigned to slice 3; MDX and theming-reference issues also remain there. Installer recovery and guidance remain assigned to slice 4. Cache tests must not rely on the retired scan-on-every-open assumption.

## Slice 3 — Toolbox, story conformance, and MDX repository support

**Scope.** Replace the production grid with the Toolbox specified in `specs/ui/app/toolbox.mdx`: name-only search, stable highlighted IDs on updates, one-row Up/Down navigation, ordinary Left/Right text movement, real focus and scrolling, summary errors, default Unicode letter icons, and supplied images with decoding fallback. Add the platform-appropriate keyboard toggle in the app page and preserve shared popover behavior and navbar control continuity. Keep selected-tab placement and silent failure handling, including partial creation and failed focus. The item/action boundary serves templates; it does not require a second source or a general plugin registry.

Implement the required Chromium conformance file for every imported Toolbox story, currently 18. `@telepath-computer/conform` is absent from this branch, so include its dependency, production mount, Storybook/service build wiring, and canonical-runner integration. Use the approved state map, shared service fixtures, real input, shipped markup/styles, and matching viewport/theme/appearance. Uncovered stories fail, and there is no permitted-difference list. Production must not import spec stories or styles. This obligation is separate from the TV-649 deferral, which remains limited to retained frame/template surfaces.

Repair both MDX tooling obligations in this slice. `scripts/specs-index.mjs` must discover MDX surfaces even without a sibling `index.md`, retain the intended retained-prose selection, and regenerate both indexes. Extend `test/repo/spec-links.test.ts` to include MDX authority in link/anchor/citation checks and map `toolbox.mdx` to `toolbox.md` in both mirror directions and the exact `Proves` check. Preserve checks for retained directory-based UI specs and ordinary Markdown proofs.

Clean up the Templates Storybook pilot assumptions in production, tests, and theme-reference authority selection. Point the latter at Toolbox and retain relevant stylesheet delivery checks. Keep the routing assets explicitly retained by `specs/ui/app/skill-selector/index.md`, the historical Storybook redirect paths, and the separate artifact-frame pilot. A new mandatory conformance path replaces manual-only Toolbox checking; deleting unrelated workshop/history files is not part of this slice.

**Proof assertions discharged.**

| Proof | Assertions |
|---|---|
| [Toolbox](../../proofs/ui/app/toolbox.md) | All 11: `toolbox-t-conformance`, `toolbox-t-search-state`, `toolbox-t-default-icon`, `toolbox-t-shortcut-contract`, `toolbox-ac-open`, `toolbox-t-browser-input`, `toolbox-t-shortcut-seam`, `toolbox-ac-activation`, `toolbox-t-icon-browser`, `toolbox-ac-directory-error`, `toolbox-t-messages` |
| [Product templates](../../proofs/product/templates.md) | `templates-ac-ui-create`, `templates-ac-display-ui`, `templates-ac-transparent-ui`, sharing successful activation with Toolbox |
| [Navbar](../../proofs/ui/app/top-bar/index.md) | Retain `top-ac-markup-smoke` and `top-ac-controls-continuity` with Toolbox composition |

The MDX index/mirror repairs follow root governance and need no invented feature proof. Reference-only changes to retained UI, tab-page, and conformance proofs keep their existing owners and evidence.

**Red/green and verification criteria.** Add the cheap search, Unicode icon, and platform-predicate contracts first, then production-browser input/message checks and all story comparisons. Replace the retired expectations in `packages/web/test/e2e/skill-selector.test.ts`; retain real successful creation, display/transparency and focus behavior. Replace its seed-write failure with the approved channel-layout obstruction after registration, plus fresh-scan refusal and the declared failed-focus request. Keep the real directory-read failure: obstruct the directory after boot and publish the scan using authenticated `GET /templates?fresh=true` before opening. Mocked conformance messages alone do not discharge that acceptance.

Prove the shortcut through real browser and Electron keyboard delivery on the execution host, with platform breadth in the contract and only the declared Electron app-URL setup substitution. Prove icon requests and decoding/fallback against real local SVG/PNG/broken-byte fixtures. Update dependent assertions in navbar unit/e2e, settings, and theme-product tests; adapt `test/repo/lib/ui-style-crossings.ts` if module/style paths move. Preserve unrelated retained UI checks in `foundation-copy.test.ts` while correcting its obsolete manual-pilot explanation.

Use temporary fixture trees to demonstrate MDX index discovery and mirror correctness before implementing the generator/check changes. Then run `test/repo/spec-links.test.ts`, `test/repo/theming-reference.test.ts`, the affected web/desktop tests, Storybook type-check/build, and the complete Toolbox conformance file through its registered surface. The Toolbox documentation wrapper must render the approved MDX and stories. Re-run the slice 2 browser cache tests with the finished Toolbox.

**Expected exit baseline.** The two recorded mirror failures, the predicted theme-reference failure, and every UI/cache integration baseline from slices 1–2 are resolved. Toolbox behavior, all 18 story comparisons, MDX tooling and affected retained UI tests are green. Only the explicitly assigned bundled recovery and skill-guidance work remains for slice 4.

## Slice 4 — Bundled recovery, delivered guidance, and the green integrated result

**Scope.** Replace the bundled installer recovery sequence with backup completion, durable removal of the handled ID, destination removal, complete replacement at the same path, and handled-ID recording after success. A failed state removal leaves the destination intact; an interrupted replacement may leave it absent until next serving boot restores it. Preserve existing state validation, minimum-version comparison, hidden backup naming, handled deletion, and failure containment. Prove existing linked records and stores survive replacement and deletion without changing their identity or data. Remove staged/prior-folder rollback machinery whose promise was retired.

Finish delivery of the approved template guidance through the real skills build: default linking, show-before-data, copy/detach before editing one page, compatible schemas/pages, no default writes, flat CLI records, the watched cache, URL restrictions, local icons and one-time agent favicon acquisition, minimum-version handling, and broken-path consequences. Most source prose already changed in `bf195c7`; review emitted intro, template document, CLI capabilities and app-shell reference for agreement, rather than rewriting settled prose without need.

**Proof assertions discharged.**

| Proof | Assertions |
|---|---|
| [Bundled installation](../../proofs/arch/templates/bundled-installation.md) | `templates-install-t-retry`, `templates-install-t-containment`, `templates-install-t-linked-records`; retain `templates-install-t-validate`, `templates-install-t-build`, `templates-install-t-state`, `templates-install-t-boot`, `templates-install-t-state-retry` |
| [Template guidance](../../proofs/arch/templates/authoring.md) | `templates-guide-t-intro`, `templates-guide-t-authoring`; retain display and transparency guidance assertions |
| [Making skills](../../proofs/arch/making-skills.md) and [CLI packaging](../../proofs/arch/cli/index.md) | Retain actual bundle membership, distribution and installed-path evidence with the completed Example and guidance |

**Red/green and verification criteria.** Replace the prior-folder recovery tests in `packages/server/test/bundled-template-installation.test.ts` with the approved order/reboot tests before changing the installer. Keep the handled-deletion claim while removing dependence on hidden staging artifacts. Exercise backup and state-write failure, interruption, two-ID containment, and removal from the supplied bundled set using the declared hooks. Establish linked artifacts/stores through production operations before making the installed template invalid or below minimum. Retain the real server/CLI asset checks and Example browser evidence from slice 1. A newer source alone must not overwrite a valid installed template at the minimum.

Replace stale phrase/copy/seed assertions in `test/repo/skills-build.test.ts` with checks of the salient delivered commands and rules, using `TV_SKILLS_DIST_DIR` and the real build. Review guidance meaning and examples; avoid pinning incidental wording. Keep unrelated skill membership and display guidance checks.

**Expected exit baseline and completion.** No temporary baseline remains. Every allocated proof assertion has passing evidence; retired claims have been removed or replaced, and surviving claims remain covered. Converge the integrated result against the specs, proofs, tests and code, including cache/Toolbox behavior after the installer changes. This is the final slice and leaves the complete suite green.

Once implementation is authorized and complete, update the branch to contain its target before final contribution validation. Commit and push the exact tree to be tested, then run `npm run verify` synchronously on this marked host and wait for the complete result. Record the tested revision, result, recovered flakes, and relevant limits. Investigate a broad failure through a narrow reproducer before repeating the gate. Any changed tree or moved target needs validation of the resulting revision; an earlier pass is not evidence for it. Toolbox conformance and the required browser/Electron/build checks must be included or completed as specialized checks if the broad gate does not select them.

Perform [pre-merge docs prep](../../specs/spec-docs.md#pre-merge-docs-prep) when the contribution is complete and ready for a shared-branch merge; keep these working records during plan/implementation and draft review. Independent plan, slice, and integrated review follow the repository workflow and the review arrangement in the task record. Human spec acceptance still follows the task record before the first applicable shared-branch merge. After this contribution merges, raise the recorded Checklist and Calendar follow-up; those template branches are outside these slices.

## Planning findings

No blocking spec ambiguity or spec/proof contradiction was found. The mandatory Toolbox story conformance, minimum-version preservation of installed Example `1.0.0`, and retained historical routing assets are deliberate constraints, not implementation exceptions to weaken. The additional predicted skill-build and theme-reference failures are assigned above; neither was executed during planning.
