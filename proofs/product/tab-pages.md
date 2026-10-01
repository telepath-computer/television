*How the promises in Tab pages are proven.*

# Tab pages — proof

Proves [specs/product/tab-pages.md](../../specs/product/tab-pages.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Acceptance criteria

Shared declaration ([arch/testing-policy.md#^declaration-schema](../../specs/arch/testing-policy.md#^declaration-schema)): every assertion below is **acceptance** shape — the outer boundary is a real browser against a really-running server, with two connected application documents in one browser context where another client's outcome is part of the claim. Channels and artifacts are fixtures created through the production API or CLI; create, retitle, remove, and focus actions under test also enter through those production boundaries. No test hook replaces a production mechanism. Real-motion declaration ([arch/testing-policy.md#^motion-rule](../../specs/arch/testing-policy.md#^motion-rule)): no assertion below claims motion, so each may use the default motion override — a mock that forfeits coverage of the motion itself. The navigation chord's product assertions live with [product/keyboard-navigation.md](../../specs/product/keyboard-navigation.md).

Stage 1's one-artifact presentation is exercised by the page/tab outcomes below; data-model support for several artifacts in one page is specified in [arch/layout/index.md#^ly-not-narrowed](../../specs/arch/layout/index.md#^ly-not-narrowed) and must be proven in that architecture row's assertion map, not restated as a browser invariant here. Tab switching's no-reload outcome is proven by the acceptance walk at [product/artifacts.md#^af-ac-tab-continuity](./artifacts.md#^af-ac-tab-continuity); these selection assertions compose with it rather than repeating live-document state in every case. The label-only tab markup that supplies no menu, rename, or close control is specified in [tab.frame](../../specs/ui/app/tab-strip/tab.frame), held by non-suite conformance; [#^tp-ac-no-tab-ops](#^tp-ac-no-tab-ops) proves the destructive keyboard negative without turning template identity into a product test.

- Creating an artifact without requesting focus appends one new page and tab at the end of the channel's existing order in every connected client, with that page holding the new artifact — *(covered by tests: `packages/web/test/e2e/tab-pages.test.ts` “artifact creation appends a page and retitling updates its tab label” and “shared tab-page product outcomes > converges creation, retitle, focus, and drag order while tab selection stays local”)*. ^tp-ac-create-appends
- A tab's label is its artifact's title, and retitling the artifact through the production API updates every connected client's tab — *(covered by tests: `packages/web/test/e2e/tab-pages.test.ts` “artifact creation appends a page and retitling updates its tab label” and “shared tab-page product outcomes > converges creation, retitle, focus, and drag order while tab selection stays local”)*. ^tp-ac-label
- Changing the selected tab in one client changes nothing in another connected client on the same channel — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “shared tab-page product outcomes > converges creation, retitle, focus, and drag order while tab selection stays local”)*. ^tp-ac-selection-local
- Selecting a page, switching to another channel, and returning restores that page's selection — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “selection survives a channel return while unseen channels and reload choose first”)*. ^tp-ac-selection-memory
- Entering a channel with no remembered selection selects its first page; removing the selected page selects the page now at its position, or the preceding page when the removed page was the last — *(covered by tests: `packages/web/test/e2e/tab-pages.test.ts` “selection survives a channel return while unseen channels and reload choose first” and “selected-page removal falls forward, then backward, then to no selection”)*. ^tp-ac-selection-fallback
- After a reload, the focused channel's first page is selected — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “selection survives a channel return while unseen channels and reload choose first”)*. ^tp-ac-reload-first
- Focusing an artifact selects the page containing it on every connected client, switching channels when the artifact is on another channel — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “shared tab-page product outcomes > converges creation, retitle, focus, and drag order while tab selection stays local”)*. ^tp-ac-focus-selects
- Pressing Delete or Backspace with a tab focused removes no artifact, page, or tab and invokes no content-management action — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “Delete and Backspace on a focused tab perform no content operation”)*. ^tp-ac-no-tab-ops
- Reordering tabs with real pointer input in one client produces the same order in another connected client and the server's channel layout — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “shared tab-page product outcomes > converges creation, retitle, focus, and drag order while tab selection stays local”)*. ^tp-ac-reorder-shared
- Resizing a page with real pointer input in one client updates the server's channel layout and is observed in another connected client — *(covered by test: `packages/web/test/e2e/tab-pages.test.ts` “shared tab-page product outcomes > resizing a page with real pointer input is observed by another connected client”)*. ^tp-ac-resize-shared

