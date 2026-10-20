# Checklist implementation plan

Replace the bundled Example with the specified Checklist on `feat/artifact-template-checklist`. This plan assigns the implementation and all 34 pending proof assertions to one slice. It follows [Planning and slices](../../specs/spec-workflow.md#planning-and-slices); the [Checklist architecture](../../specs/arch/templates/checklist.md), [UI spec](../../specs/ui/templates/checklist.mdx), and their proofs remain authoritative.

## One slice: ship the complete Checklist

**Scope.** Deliver the copied page, its store model and editing behavior, package assets, installation/build adaptations, telemetry vocabulary, and proof-derived tests. Keep these together: local editing, remote changes, rejected saves, and invalid-data guards all reconcile the same editor with the same SDK subscription. Dividing them would leave the most important interactions for another convergence cycle. The test groups below are red/green batches within this slice, not separate slices.

**Baseline.** Before implementation, the shipped folder and tuple still name Example; Checklist tests are absent and the three retired Example assertions remain cited. No test run was performed for this planning task, so an existing green baseline is not claimed. First run the affected existing files narrowly and record any unrelated failures. Each new batch must fail for its missing behavior before implementation, then pass. The slice ends with all obligations discharged and full verification green; it leaves no temporary failing baseline or functionality for a later slice.

**Implementer standards.** Follow `/root/workspace/skills/code/SKILL.md` and `/root/workspace/skills/code-implement/SKILL.md`: tests first, small implementation batches, independent whole-result review, and no commit without explicit authorization. This task only writes this plan.

## Page organization

Create `packages/server/assets/templates/checklist/` with:

- `manifest.json`: inventory identity/version, width 640 and height 800; omit `fullScreen` so the shared default applies.
- `data.json`: exactly `{"title":"Checklist","items":{}}`.
- `index.html`: the page shell, canonical stylesheet link, local stylesheet and module entry, and reusable row/icon markup following the pilot.
- `model.js`: browser-native ES module exporting whole-value/item-map validation, store-key comparison and item ordering, insertion-order calculation, the renumbering callback factory, and the platform-dependent shortcut decision. A small `model.d.ts` supplies types to strict TypeScript tests without duplicating behavior.
- `page.js`: DOM editing, selection/focus, SDK calls, subscription lifecycle, and status rendering. Import `./model.js` and the real `/sdk/v1/resources.js`.
- `styles.css`, `thumbnail.png`, and `README.md`.

The page and contract tests import the **same shipped `model.js`**. Keep it free of DOM and SDK imports so direct tests need neither a fake DOM nor a replacement SDK. The SDK does not export its internal `compareChildKeys`; implement the specified numeric-index/UTF-16 comparison once in this module, never `localeCompare`. Use safe own-property handling for arbitrary store-valid keys. Ship all other dependencies, including any icon support, inside the folder; resolve foundation icon markup during authoring, with no Storybook, repository-source, package-manager, or build dependency when an artifact runs.

Use the SDK as the sole owner of optimistic writes, acknowledgements, rollback, and transaction retries. Keep the latest subscribed value separate from the active item draft. Reconcile rows by key so unrelated updates preserve the focused DOM node, selection, and native undo. Centralize permission to start a write: current data valid, access read-write, and connection connected. Check it again at blur and any deferred callback. Rendering never repairs or normalizes stored data.

Ordinary edits use only `set(title)`, complete three-field `set(items/<key>)`, `push(items, object)`, and `remove(items/<key>)`. When an insertion cannot produce a strictly valid order, reserve one key with value-less `push(items)` and pass a callback from `model.js` to `runTransaction(items, callback)`. Each invocation derives from its supplied current map, preserving existing extra fields; missing/invalid maps return `undefined`, and a removed predecessor means append. Never reserve another key on retry.

Remote updates retain active item text until blur, including a remotely deleted row. A failed save must override that draft protection and show the rolled-back value even with focus retained. Access loss retains the last view read-only; invalid data and `unavailable` replace the checklist with the alert. Keep a status region mounted before inserting a message. After a subscription-ending error, re-establish the root listener on a later successful connection: `sdk-json-store.ts` removes listeners on such errors, so SDK reconnect alone cannot recover that page.

Copy `storybook/spec/templates/checklist/styles.css` directly into the folder. Compare raw `Buffer` bytes in a focused test, following `packages/web/test/foundation-copy.test.ts`; do not normalize, transform, or regenerate CSS during a test. That existing foundation registry does not enumerate the Storybook template sheet. Also compare the CSS response from a created artifact with those bytes. Review markup and icon treatment against all story exports, including focus and disconnected poses, and ensure no extra styling overrides the specified treatment. Automated structure/selector comparison stays deferred under TV-649.

## Files to change

| Area | Files and work |
|---|---|
| Shipped package | Add the Checklist files above; delete `packages/server/assets/templates/example/`; change `packages/server/src/bundled-template-ids.ts` to the readonly Checklist tuple. The installer already derives its minimum-version inventory from that tuple. |
| Package and model contracts | Add `packages/server/test/checklist-template.test.ts` for package/README/PNG/CSS contracts and `packages/server/test/checklist-model.test.ts` for the actual exported logic. |
| Existing package/telemetry coverage | Adapt `packages/server/test/bundled-template-installation.test.ts`, `test/node/cli-assets.test.ts`, `packages/server/test/templates-create.test.ts`, and `packages/server/src/telemetry/{derivation,types}.test.ts`. Production telemetry already consumes the tuple. |
| Browser acceptance | Replace `packages/web/test/e2e/template-example-real-stack.test.ts` with `template-checklist-real-stack.test.ts`; add a small adjacent `checklist-harness.ts` for creation, artifact-frame lookup, store reads, clipboard fixtures, and server/proxy lifecycle. |
| Shared test infrastructure | Extend `packages/server/test/e2e/network-proxy.ts` selectively as below; add focused `packages/server/test/network-proxy.test.ts` checks. Update both `packages/web/playwright.config.ts` and `packages/web/playwright.real-stack.config.ts`, plus `test.config.mjs`: each explicitly lists the old acceptance filename. |
| Evidence and retirement | Update `proofs/arch/templates/{checklist,bundled-templates,bundled-installation}.md`, `proofs/ui/templates/checklist/index.md`, `proofs/product/templates.md`, and `proofs/arch/telemetry/derivation.md` with actual test citations and resolved pending text. Remove the retired Example anchors and retirement section after replacing their tests. Resolve the old retired-anchor link in `docs/working/templates-plan.md` when removing those anchors. |

Read and retain general template creation, scanner, routes, and authoring coverage. `packages/server/test/templates-routes.test.ts` currently contains only unrelated `outside.example` origins, not bundled Example expectations; it needs validation, not a blanket rename. Existing installed Example folders remain ordinary user-owned templates; do not introduce a deletion or migration of user folders.

## Tests written first and proof assignment

Every anchor below belongs to this single slice. Implement the complete assertion in the linked proof, including its fixtures, declared mocks and forfeits; the summaries identify the test groups, not reduced acceptance criteria.

| Proof | Anchors | Red/green test batch and passing evidence |
|---|---|---|
| [Bundled inventory](../../proofs/arch/templates/bundled-templates.md) | `^templates-bundled-t-inventory` | Actual source directory, tuple, minimum, exact manifest name/description/version identify only Checklist. Replace the Example package/no-display assertions. |
| [Installation](../../proofs/arch/templates/bundled-installation.md) | `^templates-install-t-validate`, `^templates-install-t-build`, `^templates-install-t-state-retry` | Adapt real validator rejection fixtures, byte-for-byte server/CLI package copies, and failed state-write/next-boot retry to Checklist. Preserve the existing state, boot, backup and replacement cases, updating fixture IDs, backup names and sorted state expectations. |
| [Telemetry](../../proofs/arch/telemetry/derivation.md) | `^t-template-classify` | Checklist is bundled by exact ID; Example, case variants and other IDs are custom. Adapt event type and real creation/emission tests without weakening privacy assertions. |
| [Checklist architecture](../../proofs/arch/templates/checklist.md) | `^templates-checklist-t-package`, `^templates-checklist-t-thumbnail`, `^templates-checklist-t-readme` | Exact seed/display, a decoded 4:5 PNG, and all README meanings/command forms. Review the screenshot and guidance; content checks do not establish their meaning alone. |
| Same | `^templates-checklist-t-validity`, `^templates-checklist-t-order`, `^templates-checklist-t-renumber` | Direct imports test valid/invalid roots and items, nonfinite direct inputs, extra fields without mutation, numeric and UTF-16 key ties, all insertion positions, equal/adjacent/extreme orders, and repeated callback inputs with concurrent changes or invalid maps. |
| [Checklist UI](../../proofs/ui/templates/checklist/index.md) | `^checklist-ui-t-shortcut`, `^checklist-ui-t-styles` | Direct production shortcut decisions cover macOS and non-macOS inputs; the package test compares raw CSS bytes. |
| Checklist UI | `^checklist-ui-ac-new`, `^checklist-ui-ac-title`, `^checklist-ui-ac-items` | Real popover creation, persisted display/default and seed, autofocus, blank-add no-op, add/reload, title placeholder/paste, saves before blur, Return/Shift-Return, empty blur removal, done editing/order, whitespace preservation, agent line breaks without writes, native undo, and flat/no-clear controls. |
| Checklist UI | `^checklist-ui-ac-navigation`, `^checklist-ui-t-shortcut-delivery`, `^checklist-ui-ac-paste`, `^checklist-ui-ac-remove` | Real keys, clipboard, pointer and selection prove wrapped-line navigation, both Backspace branches, actual-host completion shortcut/caret retention, ordered multiline paste, accessible control names/Tab/Space, and middle/final/sole removal focus. |
| Checklist architecture | `^templates-checklist-t-write-scope`, `^templates-checklist-t-delivery` | Add outgoing-operation observations and administrative readback to the editing walks: precise write paths, complete item replacement/extra-field loss, push and delete. Observe real canonical/SDK/local asset responses; move the installed template out of discovery, then reload the copy and save successfully. |
| Checklist UI | `^checklist-ui-ac-live`, `^checklist-ui-ac-remote-remove`, `^checklist-ui-ac-access` | Second viewer and spawned documented CLI commands prove live title/other-row changes, focused-text protection and sequential last-write-wins. Separately prove deleted active-item restoration by typing/nonempty blur and no restoration on empty blur. Real share upgrade, downgrade during editing, empty read-only view and revocation exercise SDK access delivery. |
| Checklist architecture | `^templates-checklist-t-transaction`, `^templates-checklist-t-transaction-invalid`, `^templates-checklist-t-invalid-guard` | Hold a real CAS, apply an administrative conflicting edit, release and observe retry/atomic committed map with extras retained; repeat with deleted predecessor and missing/invalid items. Invalidate during an active unsent edit and prove input/blur/deferred work starts no write; separately release an ordinary write sent before invalidation and observe last-write-wins. Repair restores saving. |
| Checklist UI | `^checklist-ui-ac-loading`, `^checklist-ui-ac-reconnect`, `^checklist-ui-ac-save-failure` | Real proxy timing produces blank first load, disconnect over blank/valid/error views, read-only retention, remote updates and recovery. Selective holds produce a genuine refused save and focused-editor rollback; observe status-region creation before messages and eventual dismissal without asserting an exact duration. Release access notification, restore access, and save again. |
| Checklist UI | `^checklist-ui-ac-invalid`, `^checklist-ui-ac-unavailable`, `^checklist-ui-ac-layout` | Malformed/missing initial and live values yield the complete alert without repairs, then recover. Corrupt the real saved file while stopped and repair it during another stop; the open page recovers after restart. Long/wrapped lists at starting size and 360×640 remain usable without horizontal overflow, including the final controls with a status strip. |

The product proof delegates its pending Checklist journey to `^checklist-ui-ac-new`. The other template proofs introduce no additional pending assertions. Remove `^templates-example-t-package`, `^templates-example-t-no-display`, and `^templates-example-ac-live` and all live citations to them; do not count their old tests as Checklist evidence.

## Minimal browser infrastructure

Use `test/helpers/playwright.ts` and `launchProductServer({ bundledTemplatesBundle })` from `test/helpers/product-server.ts`, with the existing real popover patterns in `skill-selector.test.ts`. The product harness already installs the bundle, serves built canonical/SDK assets, and runs spawned CLI commands. Load the built application and its copied artifact through the real production sandbox. Follow `resource-sdk-harness.ts` for a mapped `tv-sdk.test` HTTP host and Chromium host-resolver arguments; assert opaque artifact origin and `isSecureContext === false`.

Reuse the server-side `NetworkProxy`; do not create a second proxy or fake SDK. Existing write holds suffice for CAS conflicts and already-sent writes; stream holds, sever/refuse and retarget cover loading and restart. Add a per-connection server-message predicate hold/release for access notifications while a later refusal passes unchanged. Extend frame parsing to unmasked server frames and fragmented messages, preserving original bytes and control frames. Add focused framing/release/disconnect checks and run existing SDK proxy consumers after this shared change. Declare the changed ordering for the refused-save test as the proof does.

Keep a stable outer proxy while stopping and relaunching `ProductServer` against the same temporary home with `cleanupHome: false`; edit the actual `content.json` only after disposal completes, then retarget to the new backend. Put this orchestration in `checklist-harness.ts` and remove the home in final cleanup. No general product-server lifecycle API extension is needed.

Populate clipboard fixture text in a separate ordinary browser page with a textarea and real copy keys, then use real paste keys in the artifact. Do not require secure-context clipboard APIs inside the sandbox or dispatch a fabricated paste event. Observe DOM selection, roles, real wire operations and administrative reads; use readiness signals rather than sleeps. Contract inputs cover both shortcut platforms; the browser case claims only the actual host OS.

## Reproducible thumbnail

During implementation, add `packages/server/scripts/capture-checklist-thumbnail.mjs` as a small authoring utility, outside the copied template. Accept a Storybook base URL and Chromium executable path. Use `http://127.0.0.1:6007` if it serves this worktree, otherwise run `npm --workspace @telepath-computer/storybook run dev -- --port 6007 --host 127.0.0.1` here. The port was unavailable during planning.

Open `/iframe.html?id=spec-templates-checklist--with-items&viewMode=story` with default light args, a 640×800 CSS viewport and device scale factor 0.625. Use `/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome` on this host. Wait for `.checklist-page`, all six grocery rows and `document.fonts.ready`; keep the pointer away from rows and capture the viewport with Playwright `scale: "device"` to produce 400×500 PNG pixels. This preserves the starting-size layout instead of activating the narrow-layout media query at a 400px CSS viewport. Decode the result to verify dimensions and review it against `WithItems` before placing it at `checklist/thumbnail.png`. Record these inputs in the utility; no pixel golden or arbitrary size tolerance is required.

## Verification and completion

1. Iterate with `npm test -- local --file <test-path> --grep <case>`, then that whole file. Start with the package/model tests and adapted installer/telemetry tests; write browser batches before their page behavior. Never use broad verification as the inner loop.
2. Once these pass, run the affected owning surfaces, including `e2e:browser-app-real-stack`, the SDK/proxy consumers, template scanner/create/routes/CLI/build checks and skill guidance tests. Use `npm test -- list --file <path>` to check ownership after the filename/config changes. Type-checking must exercise telemetry vocabulary probes; Vitest alone does not check `satisfies`.
3. Review every story pose, the thumbnail and README; replace every pending citation with its actual test evidence and check retired references are gone. Independently converge the complete slice, including the integrated result. No later implementation slice is planned.
4. Pass `npm run verify` on the completed contribution under the current testing/shared-branch policies. Both `~/.tv-developer` and `~/.tvdev-use-blaxel` exist on this host. Targeted local tests can use uncommitted changes; full verification defaults to Blaxel and needs the committed, pushed revision. This plan grants no commit permission or local bypass. A future implementer must report that prerequisite if authorization still forbids commits, not claim narrow checks as a full gate. On a marked host, local full verification requires explicit human authorization for `--allow-extreme-inefficiency`.

Report the revision actually verified, results, recovered flakes and limits. Full verification must finish green before implementation is considered complete.

## Risks and open questions

No unimplementable spec/proof conflict was found. The main risks are preserving native undo/caret through subscriptions, differentiating remote draft protection from rollback, guarding blur after invalidation/access loss, and restoring subscriptions after `unavailable`. The real-browser assertions above are required evidence for these interactions.

The selective proxy extension must preserve existing SDK tests and clean up held frames/sockets. Numeric-gap exhaustion belongs in the shared pure logic tests; the real CAS cases prove wiring without building another transaction-retry framework. Keep thumbnail capture at the specified CSS size, and verify that the chosen Chromium produces the intended device-pixel dimensions.

If browser editing, icon delivery, or SDK lifecycle behavior exposes a promise that cannot be met, report the precise spec/proof finding and return it through the derivation chain. Do not change the UI authority, weaken an assertion, or silently choose different behavior to finish implementation.
