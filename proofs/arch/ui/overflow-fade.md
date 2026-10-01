*How the overflow-fade helper contract is proven.*

# Overflow fade — proof

Proves [overflow-fade architecture](../../../specs/arch/ui/overflow-fade.md).

## Coverage model

Real-browser contract tests mount the production helper on an authored horizontal scrollport with fixed-width fixture items. They exercise real scrolling, resizing and DOM changes; no application service or selection behavior is involved. CSS-property outputs are the helper contract, not pixel-conformance assertions. Blur and fade appearance are reviewed in the consuming UI frames. The contract tests run in Chromium and Firefox; the frames use the same production helper for visual review.

## Assertions

- **Contract:** enabled edges receive item-relative mask coordinates only while content remains beyond them. Right-only mode produces no left fade; both-edge mode handles both edges. Fitting content and exhausted edges leave no stale marker or mask properties. Distances respect the visible scrollport bounds, excluding borders — [Geometry and styling](../../../specs/arch/ui/overflow-fade.md#geometry-and-styling) *(covered by tests: `packages/web/test/e2e/item-edge-fade.test.ts` “positions right edge masks inside borders and clears exhausted edges”, “positions both edge masks inside borders and clears exhausted edges”, and “zero distance leaves overflowing content unmasked”)*. ^of-ac-geometry
- **Contract:** scroll, resize, item membership and label-size changes update the outputs after the scheduled animation frame; removed items are cleared. Updates do not recurse on their own writes — [Updates and cleanup](../../../specs/arch/ui/overflow-fade.md#updates-and-cleanup) *(covered by test: `packages/web/test/e2e/item-edge-fade.test.ts` “updates after item, label, class and scrollport changes without recurring writes”)*. ^of-ac-updates
- **Contract:** cleanup before a pending update cancels it, removes managed properties and markers, and prevents later scrolling or DOM changes from writing them again — [Updates and cleanup](../../../specs/arch/ui/overflow-fade.md#updates-and-cleanup) *(covered by test: `packages/web/test/e2e/item-edge-fade.test.ts` “cleanup cancels pending work and prevents subsequent writes”)*. ^of-ac-cleanup
- **Contract** (production helper in Chromium and Firefox over fixed-width fixture items and scrollport; no mocks): changing an inherited gap moves items without resizing them; calling `refresh()` updates item-relative mask geometry without scrolling. Repeated refreshes share the scheduled update, and refreshing after disposal leaves markers and properties cleared — [explicit refresh](../../../specs/arch/ui/overflow-fade.md#^of-explicit-refresh) and [cleanup](../../../specs/arch/ui/overflow-fade.md#updates-and-cleanup). Geometry is read against actual item and scrollport rectangles; mutation observation across animation frames checks that updates cease — *(covered by `packages/web/test/e2e/item-edge-fade.test.ts`, “explicit refresh updates position-only geometry and stays disposed”)*. ^of-ac-explicit-refresh

Review checks geometry reads precede mask writes and the helper leaves scrolling, selection, focus and content ownership with its caller.

## Tab-strip integration

The [tab-strip proof](../../ui/app/tab-strip/index.md#^tb-ac-overflow-fade) records the existing browser integration assertions for mounting, overflow changes and disconnection, required by [tab-strip integration](../../../specs/arch/ui/overflow-fade.md#tab-strip-integration). These assertions retain their existing test IDs and run in Chromium and Firefox.

- **Seam** (production theme-link owner and tab-strip view in Chromium and Firefox, with a fixed-width tab fixture and controlled HTTP stylesheet responses; the fixture application service forfeits persisted selection and real server transport to existing theme product acceptance): a loaded theme changes only tab spacing, and masks and the overflow marker update without user scrolling; changing effective root appearance updates them again. Removing the link restores the corresponding layout. Disconnection prevents subsequent theme or appearance changes from restoring masks. Browser stylesheet loading, layout, event delivery and observers remain real; readiness uses link settlement and animation-frame observation — [style refresh](../../../specs/arch/ui/overflow-fade.md#^of-style-refresh) *(covered by `packages/web/test/e2e/tab-strip.test.ts`, “refreshes overflow after applied theme and effective appearance changes” and “disconnecting the view clears masks and stops helper updates”)*. ^of-ac-style-refresh

Workshop notification and cleanup wiring are checked in implementation and visual review, using the production helper; no staging harness is added.
