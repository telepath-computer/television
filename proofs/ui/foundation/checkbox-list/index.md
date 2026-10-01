*How the promises in Checkbox list (UI) are proven.*

# Checkbox list (UI) — proof

Proves [specs/ui/foundation/checkbox-list/index.md](../../../../specs/ui/foundation/checkbox-list/index.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Test assertions

The suite proves the component's static authored state and its deliberate no-control boundary ([arch/testing-policy.md#^ui-suite-scope](../../../../specs/arch/testing-policy.md#^ui-suite-scope)). Marker placement, wrapping geometry, cursor, spacing, colour, and the checked treatment are rendered styling and remain in staging and review ([arch/testing-policy.md#^ui-styling-out](../../../../specs/arch/testing-policy.md#^ui-styling-out)).

- **Contract** (the production checkbox-list element module loaded directly in a real browser; one short unchecked item and one long checked item in a narrow list are authored markup fixtures; canonical bundle delivery is not crossed and remains with [arch/canonical.md#^cn-t-authored-build](../../../arch/canonical.md#^cn-t-authored-build) and [arch/canonical.md#^cn-t-server-mount](../../../arch/canonical.md#^cn-t-server-mount), while repository module shape remains with [arch/ui/index.md#^ui-t-module-shape](../../../arch/ui/index.md#^ui-t-module-shape); no mocks or test hooks; synchronization waits for both custom-element definitions, installs a subtree `MutationObserver` plus capturing `input` and `change` recorders before real pointer input, waits for each resulting `click`, and retains the records through two animation frames): the list keeps exactly its two direct item children in authored order with their complete content, only the authored done row carries `checked`, and pressing either row changes no attribute, child, order, or content and emits no `input` or `change` event — *(covered by test: `packages/web/test/e2e/checkbox-list.test.ts` “preserves authored static rows under real presses (^cbx-ac-static)”)*. ^cbx-ac-static

Coverage relationship: [arch/canonical.md#^cn-t-authored-build](../../../arch/canonical.md#^cn-t-authored-build) owns delivery of the element modules and stylesheet, [arch/canonical.md#^cn-t-server-mount](../../../arch/canonical.md#^cn-t-server-mount) owns their registration in a real artifact document, [arch/canonical.md#^cn-t-v1-additive](../../../arch/canonical.md#^cn-t-v1-additive) owns permanence of the public names, and [arch/ui/elements.md](../../../../specs/arch/ui/elements.md) owns their public API and compatibility boundary. [arch/ui/index.md#^ui-t-module-shape](../../../arch/ui/index.md#^ui-t-module-shape) governs the `packages/web/src/elements/` location of the modules canonical makes public, their direct `HTMLElement` base, and public-name registration. This row begins after the production definitions load and does not repeat either architecture owner. No existing consuming-surface or canonical test proves this component's static behavior.

