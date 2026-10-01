*Coverage of native input styling and shared error messages through foundation delivery and composing surfaces.*

# Input — proof

Proves [input UI](../../../../specs/ui/foundation/input/index.md).

The input is native markup with ambient styling, so it orders no standalone behavior or styling tests. The [foundation distribution seam](../../../arch/ui/foundation.md#^ui-t-foundation-copy) includes its stylesheet in the real web copy and fresh production build; [canonical distribution](../../../arch/canonical.md#^cn-t-authored-build) includes it in live canonical while preserving frozen v1. The [system-modal markup and submission assertions](../../app/system-modal/index.md#^sm-ac-markup-smoke) cover the real consumer’s reported and cleared validation state, associated error paragraph, and authentication retry. Native editing behavior is browser-owned. Styling is governed by conformance and review, not permanent color or geometry assertions.
