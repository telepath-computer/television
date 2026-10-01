*How the promises in Artifact frame (architecture) are proven.*

# Artifact frame (architecture) — proof

Proves [specs/arch/artifact-frame/index.md](../../../specs/arch/artifact-frame/index.md).

## Coverage model

### Coverage

This root owns no terminal test assertion. Its module-map and lifecycle coverage is composed from the specs that own the observable outcome or the boundary mechanism:

- Local path-content watching and notification are covered by [reload-navigation.md#^rn-ac-watch-target](./reload-navigation.md#^rn-ac-watch-target), [reload-navigation.md#^rn-ac-file-watch](./reload-navigation.md#^rn-ac-file-watch), [reload-navigation.md#^rn-ac-recursive-watch](./reload-navigation.md#^rn-ac-recursive-watch), and [reload-navigation.md#^rn-ac-watch-debounce](./reload-navigation.md#^rn-ac-watch-debounce), with the full browser and Electron outcome at [product/artifacts.md#^af-ac-folder-source](../../product/artifacts.md#^af-ac-folder-source).
- Tearing down the current channel and reconstructing it fresh are crossed by [reload-navigation.md#^rn-ac-persist-browser](./reload-navigation.md#^rn-ac-persist-browser), whose real-browser walk removes the current channel's frames and observes a newly loaded frame after returning.
- Live-document continuity across tab selection is [product/artifacts.md#^af-ac-tab-continuity](../../product/artifacts.md#^af-ac-tab-continuity)'s browser and Electron acceptance path. That path catches the consequential lifecycle error — rendering only the selected page or replacing its frame during an ordinary tab switch. The no-limit rule orders no arbitrary page-count matrix; the implementing collection has no cap, while the continuity path proves that inactive pages remain live.
- A move that does reload or replace a document composes with the bridge's reset contracts and crossings at [artifact-bridge.md#^ab-ac-reload-swap-reset](./artifact-bridge.md#^ab-ac-reload-swap-reset), [artifact-bridge.md#^ab-ac-reparent](./artifact-bridge.md#^ab-ac-reparent), [artifact-bridge.md#^ab-ac-reparent-seam](./artifact-bridge.md#^ab-ac-reparent-seam), and [artifact-bridge.md#^ab-ac-replace-reset](./artifact-bridge.md#^ab-ac-replace-reset).
- The Markdown host remains part of the code-authoritative core except for the editor color treatment. Its [UI proof](../../ui/markdown-editor/index.md) owns that sheet's production crossing and visual-judgment boundary; server-rendered read-only Markdown receives no parity assertion from either proof.

Accepted recreation during channel switches and page rearrangement is a limit on the continuity promise, not another behavior to prove. The frame-core suites described below remain evidence for code review, not assertions in any of the four coverage states.

## Assertions

This spec declares no test assertions.
