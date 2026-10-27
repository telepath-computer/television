*How the promises in Button (UI) are proven.*

# Button (UI) — proof

Proves [specs/ui/foundation/button/index.md](../../../../specs/ui/foundation/button/index.md).

## Coverage model

### Test coverage

A button has no standalone view or custom behavior: its markup is the native element a composing surface writes, and its variation is authored styling. Markup smoke for each surface proves that the surface emits a native button with the attributes and accessible label it needs. [Navbar lead markup](../../app/top-bar/index.md#^top-ac-lead-markup) therefore owns proof that the channel switcher requests `target`, while [navbar pressure coverage](../../app/top-bar/index.md#^top-ac-lead-floor) proves that the resulting lead remains usable under pressure. Neither assertion measures the exact `target` padding; that geometry remains authored styling, including the rule that `target` adds nothing to an icon button. Native focus, keyboard activation, form participation, and semantics come from the browser once the markup exists. The production-copy seam at [arch/ui/foundation.md#^ui-t-foundation-copy](../../../arch/ui/foundation.md#^ui-t-foundation-copy) proves that the authoritative stylesheet for this element reaches the built app. [Setup coverage](../../setup/index.md#^setup-t-states) proves the consumer requests `size="lg"`; [Copy coverage](../../app/copy-button/index.md#^cb-ac-markup-smoke) covers the reusable control's size input. The foundation and [live canonical](../../../arch/canonical.md#^cn-t-authored-build) crossings include the large-size CSS. No direct button assertion is ordered: measuring intent colours, geometry, hover, active, focus, disabled, or specificity outcomes would test styling, which stays in staging and review ([arch/testing-policy.md#^ui-styling-out](../../../../specs/arch/testing-policy.md#^ui-styling-out)).

## Assertions

This spec declares no test assertions.
