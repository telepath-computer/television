*Coverage of native input styling and shared error messages through foundation delivery and composing surfaces.*

# Input — proof

Proves [input UI](../../../../specs/ui/foundation/input/index.md).

The input is native markup with ambient styling, so it orders no standalone behavior or styling tests. The [foundation distribution seam](../../../arch/ui/foundation.md#^ui-t-foundation-copy) includes its stylesheet in real production copies and a fresh build; [canonical distribution](../../../arch/canonical.md#^cn-t-authored-build) includes it in live canonical while preserving frozen v1. [Setup's state contract](../../setup/index.md#^setup-t-states) proves the consumer requests `data-size="lg"`, reports and clears validation state, and associates the supplied error with the field. Native editing is browser-owned; exact control height and styling remain conformance and review concerns.
