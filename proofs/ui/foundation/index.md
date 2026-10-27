*How the promises in Foundation (UI) are proven.*

# Foundation (UI) — proof

Proves [specs/ui/foundation/index.md](../../../specs/ui/foundation/index.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

The interaction-background model is checked through token/API delivery checks and visual review of default and explicitly overridden endpoints. Review preserves unchanged regular-button hover and separate selected/expanded semantics; gradient endpoints require explicit state backgrounds.

The [interaction contrast policy](../../../specs/ui/foundation/index.md#interaction-states) is evaluated in staging and visual review across applicable pointer states, both appearances and representative bright and dark backdrops. This is visual judgment, not an automated color-direction assertion.

The manifest-driven root marker and the foundation-owned `color-scheme` are composed at the [theme-delivery browser crossing](../../arch/themes/delivery.md#^theme-delivery-t-theme-color-scheme) and the [product appearance spine](../../product/themes-and-appearance.md#^theme-ac-appearance). Those assertions exercise real computed mode tokens and native scheme in both document classes. This stylesheet-only proof does not duplicate them with selector- or declaration-text tests.

The shared app-bar height and traffic-light reserve are application token styling, so their exact values and computed padding receive no direct foundation assertion. [UI architecture](../../arch/ui/index.md#^ui-t-platform-marker) proves that the application root marks Electron context exactly. [Channel-sidebar titlebar coverage](../app/sidebar/index.md#^sb-ac-titlebar-controls), [navbar lead coverage](../app/top-bar/index.md#^top-ac-lead-markup), and [collapse acceptance](../app/index.md#^ap-ac-sidebar-collapse) prove that the consuming surfaces render and remain usable; conformance and staging retain exact alignment and spacing.

The [text-token material](../../../specs/ui/foundation/tokens/text.css), including `--line-control-lg`, crosses into the web and live canonical builds through [foundation distribution](../../arch/ui/foundation.md#^ui-t-foundation-copy) and [canonical distribution](../../arch/canonical.md#^cn-t-authored-build). The large button/input geometry remains styling authority and adds no token-value test. [Setup](../setup/index.md#^setup-t-states) proves the consumer attributes.

## Assertions

### Test assertions

Except for the shared edge contract below, the token values and relationships, prose treatment, typography, font appearance, reset declarations, control geometry, and panel chrome are rendered styling authority without suite assertions. Their values remain binding in the stylesheets above, while staging and review judge adherence ([arch/testing-policy.md#^ui-styling-out](../../../specs/arch/testing-policy.md#^ui-styling-out)). The suite does not repeat token catalogs, inspect computed colors or dimensions, measure font metrics, compare screenshots, or assert selector and declaration text. This foundation has no template, rendered markup, state machine, or functional selection rule, so it warrants no markup, state, or interaction assertion.

Selection suppression and readable-region opt-in belong to the app surface and are proved by [ui/app/index.md#^ap-ac-selection](../app/index.md#^ap-ac-selection).

> **Cost.** The prose, token, reset, control, panel, and font additions remain styling authority; no permanent suite assertion is added merely to enumerate their files, values, selectors, or declarations.


- **Contract** (real Chromium, canonical v2 stylesheet, authored open native dialog and popover/menu/select boxes, native buttons and input; no mocks): in light and dark appearance, each consumer resolves the complete sharp shadow and gradient at its own radius. Broad shadows and edge paints independently accept `none`; a custom ordinary border remains visible. Native controls retain borders, focus and pointer input. Covered by `packages/web/test/e2e/window-edge-rims.test.ts`, “canonical panels share complete paints and independent borders”. Production menu interaction and frame/sidebar paint are composed from [artifact-frame edge coverage](../app/artifact-frame/index.md#^af-ui-ac-window-edges). ^foundation-ac-panel-edges

The production scrolling-panel regression and the opened canonical panel/native-dialog matrix in the same browser file prove exterior pixels after real wheel scrolling with broad shadows disabled. Floating elements preserve authored light-DOM children and native host scrolling; native dialogs use the documented `.dialog-content` wrapper. The unwrapped native-dialog case retains native overflow and does not claim the complete edge treatment.

Authored floating-panel layout and clipping are covered by the [popover proof](popover/index.md#^po-ac-authored-layout). The same browser file checks that a native dialog with either `height: 100px` or `max-height: 100px` constrains its `.dialog-content` scroll box, and samples an authored red border on opened production panels with both edge paints and broad shadows disabled.
