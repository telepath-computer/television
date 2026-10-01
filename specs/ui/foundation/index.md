*UI spec: the foundation — the design tokens, base element styling, and materials every surface builds on.*

# Foundation (UI)

This spec defines the shared tokens, base element styling, and materials used across Television's interface, under the UI spec authority rules ([spec-ui.md](../../spec-ui.md)).

**Status:** migration to the v2 foundation is in progress. Migrated so far: the color, text, spacing, shadow, and font tokens, the button element with its derived states, the panel, and the prose treatment.

## Tokens

The named values the rest of the styling builds from, one sheet per concern:

- [colors.css](./tokens/colors.css) — the color slots, the scales and alpha scales built from them, and the color roles: the situations, their tints, the derived state fills, and the thresholds and amounts those derivations read; the dark table restates only what dark changes
- [text.css](./tokens/text.css) — the text sizes and the control lines
- [spacing.css](./tokens/spacing.css) — the spacing ladder, the radius roles, and the panel clearance
- [shadows.css](./tokens/shadows.css) — elevation
- [fonts.css](./tokens/fonts.css) — font families and weights
- [layers.css](./tokens/layers.css) — the interface's paint order
- [app.css](./tokens/app.css) — the application vocabulary: the component tokens of the application chrome, catalogued beside the shared sheets but outside the composed foundation — the application document loads it as its second sheet, and an artifact document never receives it

Styling references a token only as `var(--<name>)`, never by its value.

Token names follow three rules:

- **Primitives:** an unprefixed name, such as `--red`.
- **General-purpose tokens:** the kind of value first, then its step or purpose, such as `--radius-md` or `--color-danger`.
- **Subject-specific tokens:** the subject first, then the property and optional state, such as `--control-radius` or `--tab-text-color-selected`. A subject can be one part of the UI or a group, such as all controls.

Application tokens live in [app.css](./tokens/app.css). Shared tokens live in the other token sheets and are available to both the application and live canonical artifacts. Overriding a token also changes values derived from it, unless those values are overridden separately.

A `*-border` token accepts a complete CSS border declaration, such as `2px dashed red`. Some borders also provide separate color and width tokens. State-specific border values apply in their states. ^component-borders

Every token a theme may set is declared at the root, in these sheets — never on a component. A custom property declared on a component element shadows the inherited root value, so a theme's root override would silently lose; component styling only consumes tokens with `var(--<name>)`. A component-scoped custom property is therefore always internal mechanism state, not a theme dial. ^fd-tokens-at-root

## Interaction states

Hover, pressed and expanded feedback must be visible while keeping text and icons readable. For filled controls, prefer a change that increases text contrast; if that change is hard to see, use another readable color. Transparent controls may show a tint on interaction. Judge translucent controls against their actual background, rather than choosing colors from light or dark mode alone.

`active` names the pressed appearance. A trigger may keep that appearance while its menu or popover is open. Selected tabs and channels have separate selected states.

Where hover feedback is provided, its default background mixes the resting and active colors by `--hover-mix`. Setting an active background makes hover follow it automatically. The supplied active color and opacity are used unchanged. Controls with no hover feedback remain unchanged on hover.

Images and gradients cannot be mixed this way; provide explicit hover and active backgrounds when using them.

Keyboard focus indicators take precedence over decorative outlines.

## Dark and light mode

Theme delivery ([arch/themes/delivery.md](../../arch/themes/delivery.md)) sets the application root's `data-theme` from the active manifest's `colorScheme` and the stored appearance preference, and supplies Television-managed artifact documents with a marker through their browser or Electron appearance path. Dark mode is not a second design but a block of token statements under `:where([data-theme="dark"])` — zero specificity, like every token block ([Overriding](#overriding)) — restating only what dark changes: roles move to different steps of the same scales (`--color-surface` from white to a deep neutral step), and hue slots are restated slightly lighter, because values tuned for a white ground sit heavy on a dark one. Everything derived follows; anything not restated keeps its light value. The [appearance explainer](../../arch/explainer-appearance.md) follows the root marker into application, artifact, theme-frame, and desktop rendering.

`data-theme` selects both the foundation mode block and its zero-specificity `color-scheme`. A fixed theme gives the root its fixed marker through its manifest, so mode-specific values it does not override—including border opacity, active-state tint strength, and the four shadow tokens—and browser-native controls all use that same appearance.

## Overriding

The foundation is written to be overridden: element, token and state selectors carry zero specificity through `:where()`; pseudo-element rules retain only their pseudo-element specificity ([button/index.md](./button/index.md#^bt-ambient-is-weakest)), so ordinary statements in any later stylesheet — a theme, a surface sheet — win. An override takes one of two forms.

### Token statements

A token stated at `:root` applies everywhere, in both modes: the statement carries real specificity and the foundation blocks carry none. A theme written entirely as `:root` statements therefore looks the same in light and dark, by construction.

To give a token a different value per mode, state it under `[data-theme="dark"]` or `[data-theme="light"]`; the statement applies in that mode alone. Place mode blocks after the `:root` statements — the selectors tie on specificity, so a `:root` statement written later would override the mode blocks in both modes.

Theme CSS leaves `color-scheme` to the foundation. A theme declares whether it follows both modes or fixes one appearance in its manifest; delivery then supplies the matching root marker, so the foundation's mode block keeps native widgets aligned without a theme override.

### Selector rules

Any normal CSS rule beats the foundation element styling: write `button { border-radius: 0 }` or `.my-button:hover { … }` and it wins. Component styling properties such as `--checkbox-color` belong to the shared root token vocabulary.

## Reset

[reset.css](./reset.css) is deliberately small: beyond its few rules, elements keep their native behavior. Two rules bind surface authors — base typography is stated once on the body and inherited, so a surface does not restate it; block margins are zeroed, so every gap between blocks is authored. The reset takes no stance on selection: switching it off is policy owned by the app surface ([ui/app/index.md](../app/index.md)), so a document built on this reset stays selectable.

## Button

The control a person presses to do something: [button/index.md](./button/index.md).

### Inputs

Native text-entry controls and shared error messages: [input/index.md](./input/index.md).

## Icons

The interface's glyph vocabulary, carried by `tv-icon`: [icons/index.md](./icons/index.md). Where a rule must draw a glyph and no element can sit — a pseudo-element mark like the checklist's done check — the drawing ships as a stencil token instead ([tokens/colors.css#--icon-check](./tokens/colors.css#--icon-check)), the same vocabulary as a mask.

## Panels and surface edges

Panels are floating containers: popovers, including menus and select option lists, and dialogs. Popovers leave the surrounding page available; modal dialogs interrupt it. Their interaction and placement belong to the respective component specs.

Native artifact dialogs use `<dialog><div class="dialog-content">…</div></dialog>` so the content scrolls independently of the exterior paint. An unwrapped native dialog retains native overflow; authors use the wrapper to receive the complete edge treatment.

Panels, artifact frames and the sidebar divider share two complete decorative paints: `--panel-edge-highlight` is a gradient, and `--panel-edge-shadow` is a sharp outer shadow. Setting both to `none` disables the decoration. Broad shadows use separate render layers and remain independently configurable.

The gradient paints white at .36 for the first .5px, .28 for the next .5px, and .20 at the local radius and beyond. Its final `1em` stop resolves on the decorative pseudo-element, whose font size equals the local radius; inherited custom properties must not capture a radius at the root. The outer shadow has .5px spread with black alpha .205 in light appearance and .912 in dark. Fractional coverage remains visible at DPR1. [Color tokens](./tokens/colors.css) state both complete declarations.

`--panel-border` defaults to `none` and accepts an ordinary border independently of these paints. Frame and sidebar border shorthands inherit it and accept component overrides. `--color-border` continues to provide the generic color for control and separator borders. Keyboard focus retains its own outline.

A bounded real-browser contract verifies complete-paint disabling, independent broad shadows and borders, local radius computation, and preserved input/focus behavior for the shared panel consumers. The fractional raster checks are defined in [artifact-frame testing](../app/artifact-frame/index.md#testing). Other appearance remains a visual-review responsibility.

## Popover

The panel that floats over the page while the page stays live, anchored to the trigger that opened it: [popover/index.md](./popover/index.md).

## Select

The control that chooses one value from a fixed list, opened from a trigger wearing the current choice: [select/index.md](./select/index.md).

## Layers

Layers specify the paint order of the interface — everything composed inside `#app`. Around it, the document stacks the theme visual layers — wallpaper behind the interface, effect layers in front — which are the app shell's document-level machinery, outside this vocabulary; [ui/app/index.md](../app/index.md#^app-theme-visual-layers) owns them and states their values. Within the interface, each layer is a named token in [tokens/layers.css](./tokens/layers.css), and every z-index references a layer token: `z-index: var(--layer-…)` places an element on a layer, and a lift (below) calculates on one; a z-index that references no layer is a defect. The vocabulary is closed and ordered:

- `--layer-ground` — the base plane the document lays out: zero. Nothing is placed on it; lifts on the base plane calculate from it.
- `--layer-panel` — floating panels opened from a surface: menus, the popovers in the navbar. Above every base surface, including the one that opened them.
- `--layer-overlay` — the interruption: the dialog overlay, backdrop included. Above everything, open panels included.

A **lift** raises an element above sibling elements on the same layer: the selected page above the sibling pages, a drag-carried row above the other rows in the same list. A lift is written as a calculation on the layer the owning surface sits on — `z-index: calc(var(--layer-ground) + 1)` — so the declaration states both the plane and the local order. A lifted element never reaches the next layer in the order.

The rendered result must preserve the stated layer order. A declaration of a layer token alone does not establish that order: an ancestor's stacking context can keep the element below surfaces it must cover. DOM ancestry and the mechanism used to achieve the required order are implementation choices.

## Prose

[prose.css](./prose.css) gives document-like HTML — headings, paragraphs, lists, links, code, tables — standard defaults, so a plain semantic document reads well with no styling of its own.

Prose is regional: it applies inside any element marked `text-display="prose"`, and nowhere else. An artifact marks its body, or just the regions that are documents; a panel stays unstyled by sitting outside a marked region.

## Delivery

Both documents load the complete foundation, [index.css](./index.css), as their base stylesheet: the artifact document of the live canonical version, and the application document ([ui/app/index.md](../app/index.md)). The foundation is the shared layer only; the application document alone adds [app.css](./tokens/app.css) on top, so no chrome token reaches a document whose surfaces cannot use it. Freezing captures that version's fresh built stylesheet, component bundle, and content-addressed assets under `packages/canonical/frozen/v<n>/`, then retires that version's live production input; a frozen version has no editable foundation-source composition ([arch/canonical.md](../../arch/canonical.md)).
