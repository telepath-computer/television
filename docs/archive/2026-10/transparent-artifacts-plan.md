> **Archived 2026-10 from branch `feat/transparent-artifacts`.** This was the implementation plan for transparent artifacts, followed as written in two slices; it is the one view of how the record, CLI and template work was split from the frame and stage rendering, and why. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Transparent artifacts implementation plan

Implement the approved specs and converged proofs on `feat/transparent-artifacts`, based on `613bb48`. The [task record](transparent-artifacts-task.md) records approval, implementation status, and validation. This document defines the two implementation slices.

**Two sequential slices.** The record, CLI, and template paths extend existing display-option and save mechanisms and belong in one review. Frame/stage rendering needs separate attention to browser motion, input, CSS composition, and Electron document hosting. Splitting there keeps each review coherent without a separate slice for every layer, following [Planning and slices](../../specs/spec-workflow.md#planning-and-slices).

Use proof-derived red/green TDD within each slice, then independent convergence. Extend existing tests and fixtures where they already cross the required boundary. The commands below use the [canonical runner](../../specs/arch/test-runner/test-runner.md#commands); narrow them with `--grep` while iterating, then run the owning surfaces. Before running Television, ensure `~/.tv-developer` exists as required by `AGENTS.md`.

## Slice 1 — Persist transparency through CLI, API, and templates

**Scope and authorities.** Deliver the following assertions, including their declared fixtures, mocks, and transport boundaries. Anchor names in the last column belong to the linked proofs.

| Requirement | Spec anchors | Proof assertions |
|---|---|---|
| Flat record, validated patches, true-or-absent storage and transport | [Record](../../specs/arch/artifacts/index.md#^ar-record), [inputs](../../specs/arch/artifacts/index.md#create-and-update-inputs), [transparency](../../specs/arch/artifacts/index.md#^ar-transparent) | [Records proof](../../proofs/arch/artifacts/index.md): `ar-t-transparent-model`, `ar-t-transparent-roundtrip`, `ar-t-transparent-load`, `ar-t-patch-validation`; retain inherited `ar-t-record-shape`, `ar-t-targets`, `ar-t-input-seam`. |
| Creation display validation; page size/mode remain independent | [Creation display](../../specs/arch/layout/index.md#^ly-creation-display) | [Layout proof](../../proofs/arch/layout/index.md): `ly-ac-create-transparent`, `ly-ac-create-transparent-invalid`. |
| Flags, conflicts, help, updates and printed metadata | [Create display](../../specs/product/cli.md#^cli-create-display), [updates](../../specs/product/cli.md#metadata-listing-and-deletion), [output](../../specs/product/cli.md#output-conventions), [client mapping](../../specs/arch/cli/index.md#client-boundary) | [CLI contracts](../../proofs/arch/cli/index.md): `cli-t-transparent-request`, `cli-t-transparent-invalid`, `cli-t-transparent-help`; [CLI acceptance](../../proofs/product/cli.md): `cli-ac-transparent`, `cli-ac-transparent-invalid`. |
| Manifest validation, independent precedence, seeded copies and later independence | [Manifest](../../specs/arch/templates/index.md#^artifact-template-package), [creation](../../specs/arch/templates/index.md#creating-an-artifact), [precedence](../../specs/product/templates.md#^artifact-template-display-options) | [Template contracts](../../proofs/arch/templates/index.md): `templates-t-transparent-scan`, `templates-t-transparent-resolution`, `templates-t-transparent-request-invalid`, retaining `templates-t-display-resolution`; [template acceptance](../../proofs/product/templates.md): `templates-ac-transparent-cli`. |
| Bundled agent guidance | [Introduction](../../specs/arch/templates/authoring.md#^artifact-template-skill-intro), [authoring document](../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc) | [Authoring proof](../../proofs/arch/templates/authoring.md): `templates-guide-t-transparent`. |

**Code and reuse.**

- Extend `packages/artifact/src/model.ts` record types, schemas and construction; `packages/shared/src/types.ts` display/patch types; and `ArtifactClient.update` in `packages/shared/src/client.ts`. Creation already forwards `display`; metadata reads pass records through. Update the two `store`/`share` comments to cite `specs/arch/artifacts/index.md#^ar-record`, closing the task obligation.
- Extend the shared display schema and patch validation in `packages/server/src/routes.ts`, manifest validation in `packages/server/src/templates.ts`, and `createArtifact`, `createTemplateArtifact`, `createKindArtifact`, and `updateArtifact` in `packages/server/src/server-store.ts`. Both creation paths must supply transparency. Reuse template field-by-field `??` resolution and the existing `saveArtifactRecord`/adoption/event path. Keep transparency out of `newArtifactPage`.
- Extend create/update options, help and diagnostics in `packages/cli/src/index.ts`. Preserve omission versus explicit false and detect both transparency spellings through parser option events. Raw argv scanning also matches option values, such as a title of `--transparent`, so it cannot satisfy the omission contract.
- Update `hasSameArtifactMetadata` and its comment for the expanded metadata surface: existing [telemetry emission](../../specs/arch/telemetry/emitters.md#event-sourcing) still distinguishes a real change from a same-value patch ([`t-emit-hooks`](../../proofs/arch/telemetry/emitters.md#^t-emit-hooks)); no telemetry payload extension is needed.
- Update `packages/skills/skills/television/src/{skill-intro.md,templates.md}` and their built-output coverage. Correct nearby descriptions of display options that currently describe page values only.

**Verification criteria.** True and absence survive schema loading, HTTP responses, individual/list/channel reads, events and restart for both artifact kinds. Creation false stores no field; patch false removes it; omission preserves it. Invalid whole patches and creation display values change nothing. Real resource operations retain store/share through transparency and title updates, and retain transparency through share changes, using the existing [record-save coverage](../../proofs/arch/resources/index.md#^rs-arch-t-artifact-record) and durable-writer contracts. Template validation/listing retains both booleans; request overrides, manifest defaults, initial store writes and restart produce the specified record and page values. Spawned CLI success/refusal and emitted guidance cover their outer boundaries.

Extend the existing files below; a focused server transparency file beside them may hold the HTTP/disk/event/boot walk if that keeps the tests clearer. Reuse `page-layout.test.ts` HTTP/WebSocket helpers, the resource-store fixtures and the built-process CLI harness.

```sh
npm test -- local --file packages/artifact/test/unit/model.test.ts
npm test -- local --file packages/cli/test/cli.test.ts
npm test -- local --file packages/server/test/endpoints.test.ts
npm test -- local --file packages/server/test/page-layout.test.ts
npm test -- local --file packages/server/test/templates-scanner.test.ts
npm test -- local --file packages/server/test/templates-create.test.ts
npm test -- local --file packages/server/test/resources/artifact-stores.test.ts
npm test -- local --file packages/server/test/telemetry-emitters.test.ts
npm test -- local --file test/node/cli-acceptance.test.ts
npm test -- local --file test/repo/skills-build.test.ts
npm test -- local --surface unit:artifact,unit:shared,unit:cli,unit:server
```

**Expected baseline.** All slice-1 assertions and affected existing tests pass; no deliberate failing tests remain. The setting is saved and delivered, but frames still render opaque. Frame/stage behavior, the browser/Electron product walk, the popover transparency walk, and corresponding theme guidance remain incomplete and belong to slice 2. Full verification is deferred until that slice.

## Slice 2 — Render transparent frames and complete acceptance

**Scope and authorities.**

| Requirement | Spec anchors / authored states | Proof assertions |
|---|---|---|
| Live visible setting, interaction and retention through moves/restart | [Product transparency](../../specs/product/artifacts.md#^af-transparent) | [Artifact acceptance](../../proofs/product/artifacts.md#^af-ac-transparent): `af-ac-transparent`, in both a real browser and Electron. |
| Frame state, hover/exit, menu hold, keyboard reachability and reduced motion | [Frame owner](../../specs/ui/app/artifact-frame/index.md#artifact-frame-ui), [Storybook behavior](../../storybook/spec/artifact-frame/artifact-frame.mdx#artifact-frame-transparency), [stories](../../storybook/spec/artifact-frame/artifact-frame.stories.ts) and [styles](../../storybook/spec/artifact-frame/styles.css) | [Frame proof](../../proofs/ui/app/artifact-frame/index.md): `af-ui-ac-transparent-state`, `af-ui-ac-transparent-hover`; retain `af-ui-ac-window-edges` on opaque frames. Review `Opaque`, `TransparentAtRest` and `TransparentHovered` by eye. |
| Transparent background pages and input ownership | [Filmstrip](../../specs/ui/app/stage/index.md#filmstrip) | [Stage proof](../../proofs/ui/app/stage/index.md#^st-ac-transparent-input): `st-ac-transparent-input`, retaining selection-motion coverage. |
| Popover uses manifest transparency without a display override | [Display defaults](../../specs/product/templates.md#^artifact-template-display-options) | [Template acceptance](../../proofs/product/templates.md#^templates-ac-transparent-ui): `templates-ac-transparent-ui`. |
| Shipped theme reference describes the supported frame/stage states | [App-shell reference](../../specs/arch/themes/authoring.md#app-shell-selector-and-markup-reference) | [Theme guidance proof](../../proofs/arch/themes/authoring.md): `theme-authoring-t-app-shell-freshness` and existing bundle coverage. |

**Code and reuse.** Add state selection to `ArtifactView.template` in `packages/web/src/views/artifact-view.ts`. The existing update path receives replacement metadata, while document identity is determined separately; reuse it. Derive the transparent styling from Storybook in an additive sibling sheet or the existing host sheets. Account for `artifact-document-host.css` rules on both iframe and webview: their backgrounds, top radii and oversized document box must not leave paint outside the transparent frame. Preserve Electron webview sizing.

Use the existing `MenuView` and descendant `tv-menu[open]` for the menu-held state. Keep the hover transitions on the clip and title bar so stage filter/opacity transitions remain effective. Apply the background-page exception through `stage.ts`/`stage.host.css` as needed: suppress wallpaper backdrop blur while retaining scale, artifact fade/blur and inertness.

Keep the copied base `artifact-view.css` and `stage.css` conforming and their existing checks active. Update style-delivery bookkeeping if an added import needs it. The Storybook state has visual review rather than a new stylesheet-copy or automated conformance test; [TV-649](../../specs/arch/ui/conformance.md#release-exception-for-tv-649) does not waive existing checks. Update the frame/stage sections of `packages/skills/skills/television/src/app-shell-reference.md` and its authority fingerprints in `test/repo/theming-reference.test.ts`, including the Storybook authorities.

**Verification criteria.** Extend `packages/web/test/artifact-view.test.ts` for state selection, the production-frame fixture and `packages/web/test/e2e/artifact-view.test.ts` for real hover/menu/keyboard motion, and the stage fixture/test for background input. Prove both 300ms transitions, delayed hiding, stable document bounds, an open menu after pointer exit, and immediate reduced-motion results using browser transition/animation signals. The stage press selects once without activating embedded controls; a later press operates the selected document.

Extend `packages/web/test/e2e/artifact-view-wheel.test.ts` and `packages/desktop/test/e2e/artifact-view-webview-wheel.test.ts` (or adjacent focused files) for the complete `af-ac-transparent` walk: path plus a URL backed by a real share link, connected updates, authored opaque content and interaction, moves, restart and reconnection. Reuse `test/helpers/product-server.ts` and `stable-front-proxy.ts` to retain the serving origin over restart, plus the existing Electron launch helper. Extend `skill-selector.test.ts` for the popover walk, observing its real outgoing request.

Review production beside all three Storybook states, then review transparent and opaque background pages on patterned wallpaper with visible theme blur. These visual checks cover surface/rim removal, corners, frost and background treatment; they are separate from the behavioral assertions.

```sh
npm test -- local --file packages/web/test/artifact-view.test.ts
npm test -- local --file packages/web/test/e2e/artifact-view.test.ts
npm test -- local --file packages/web/test/e2e/stage.test.ts
npm test -- local --file packages/web/test/e2e/artifact-view-wheel.test.ts
npm test -- local --file packages/web/test/e2e/skill-selector.test.ts
npm test -- local --file packages/desktop/test/e2e/artifact-view-webview-wheel.test.ts
npm test -- local --file packages/web/test/e2e/window-edge-rims.test.ts
npm test -- local --file test/repo/theming-reference.test.ts
npm test -- local --file test/repo/skills-build.test.ts
npm test -- local --surface unit:root,unit:browser-app
npm test -- local --surface e2e:browser-app,e2e:desktop
npm run verify
```

**Expected final baseline.** All slice-2 assertions pass, slice-1 behavior remains green, and every deferred obligation is closed. Converge the integrated result, update proof evidence to name its implementing tests, and wait for full verification to pass under [testing policy](../../specs/arch/testing-policy.md#verification-provider-and-completion). On a Blaxel-marked host this requires an authorized committed/pushed implementation revision; this planning task authorizes no commit or local bypass.

## Risks and findings

The main data risk is dropping explicit false before template resolution or storing it afterward. The main rendering risks are document-host CSS overriding the transparent state, title-bar visibility affecting keyboard/menu access, and hover transitions interfering with stage motion. Existing mechanisms and the focused proofs above cover these without new state or persistence systems.

Planning found no spec or proof defect. CSS placement and any Electron-specific adjustment remain implementation choices to verify against the approved visual and behavioral contract; this plan does not claim they have been exercised.

Slice-1 implementation found one plan-method defect: the proposed raw argv scan treated flag spellings supplied as titles as transparency options. Independent review caught it; parser option events preserve the specified omission and conflict behavior. Regression tests cover both spellings as title values for path, URL, template, and update commands. No spec or proof change was needed.

The final inherited-evidence check found and corrected a citation defect in `ar-t-input-seam`: its earlier named CLI integration test creates only a path artifact, while the assertion also requires a URL repoint through the shared client. The citation now names “server and CLI round-trip through status, title update, get, and delete”, which creates a URL artifact, repoints it through the real CLI and server, and reads back the changed URL. No new coverage was needed.
