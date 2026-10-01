*How the promises in Elements are proven.*

# Elements — proof

Proves [specs/arch/ui/elements.md](../../../specs/arch/ui/elements.md).

## Coverage model

### Test coverage

[ui/foundation/icons/index.md#^ic-ac-markup-smoke](../../ui/foundation/icons/index.md#^ic-ac-markup-smoke) proves that every current public icon name resolves to its exact SVG through both shadow-root construction paths, so this architecture contract adds no second name resolver. [arch/canonical.md#^cn-t-v1-additive](../canonical.md#^cn-t-v1-additive) independently prevents a public icon name from disappearing from either the frozen v1 bundle or live v2; reading the current manifest alone could not catch that removal. [ui/foundation/icons/index.md#^ic-ac-tree-scope](../../ui/foundation/icons/index.md#^ic-ac-tree-scope) proves the live icon's own root sizes it in document and author-shadow-root scopes, [ui/foundation/icons/index.md#^ic-ac-spinning](../../ui/foundation/icons/index.md#^ic-ac-spinning) owns live spinning behavior, and the icon UI spec keeps the remaining live size and colour styling.

[ui/foundation/checkbox-list/index.md#^cbx-ac-static](../../ui/foundation/checkbox-list/index.md#^cbx-ac-static) owns the live checkbox elements' authored content, checked state, absent generated control, and no-toggle behavior in a real browser. [arch/canonical.md#^cn-t-authored-build](../canonical.md#^cn-t-authored-build) owns delivery of their live module and stylesheet; [arch/canonical.md#^cn-t-frozen-copy](../canonical.md#^cn-t-frozen-copy) owns preservation of the frozen v1 bundle; [arch/canonical.md#^cn-t-server-mount](../canonical.md#^cn-t-server-mount) owns registration from both in real artifact documents; and [arch/canonical.md#^cn-t-v1-additive](../canonical.md#^cn-t-v1-additive) owns permanence of the public tag, attribute, custom-property, and icon names. This architecture row orders no duplicate checkbox assertion.

[Popover](../../ui/foundation/popover/index.md), [menu](../../ui/foundation/menu/index.md), and [select](../../ui/foundation/select/index.md) derive the public panel APIs and their UI behavior into the production-element Chromium cases in `packages/web/test/e2e/panel-elements.test.ts`. Popover owns `open` and trigger ARIA lifecycle, shared placement, and cleanup; menu owns item semantics and ordinary-click activation; select owns value/change semantics, generated identities, trigger semantics, keyboard input, and its placement/exclusivity specializations. These proofs cite the browser evidence and the separate controller resource-cleanup contract. Real browser input, accessibility, and geometry establish those behaviors; fixture action/event counters only observe results. Their shared panel-controller crossing supplies the common mechanisms once rather than duplicating tests here. [Menu view](./menu-view.md#^mn-ac-markup-smoke) separately proves production-view trigger ID creation and stable pairing in a mocked DOM, forfeiting browser behavior to those same panel proofs.

The [shared checkbox-color token](../../../specs/ui/foundation/tokens/colors.css) value and every other visual treatment are rendered styling, judged from the checkbox UI authority rather than measured here. [arch/ui/index.md#^ui-t-module-shape](./index.md#^ui-t-module-shape) governs the unconditional web element shape for every production custom element, including those reached from canonical's production entrypoint; its existing assertion covers repository location, class shape, and registration without adding another element-behavior test here.

## Assertions

This spec declares no test assertions.
