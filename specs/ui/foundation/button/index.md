*UI spec: the button — what a button looks like across its states, and the attributes that vary it.*

# Button (UI)

The control a person presses to do something. Every button in Television's own interface is this one; a surface places it and gives it a label, and nothing else about it is the surface's to decide. Its styling is part of Television's base element vocabulary ([ui/foundation/index.md](../index.md), Elements).

**Status:** implemented foundation button vocabulary.

## Markup

A button is the native `<button>` element with its label inside, and there is no template here: the element *is* the markup, and a template would only restate it. What this spec owns is [ui/foundation/button/button.css](./button.css) — how that element looks — and the attributes below that vary it.

Using the native element rather than a custom one is deliberate: it keeps the platform's focus behaviour, keyboard activation, form participation and accessibility semantics, none of which a replacement would get for free.

## API

Variation is expressed as attributes on the element, so a surface writes `<button>` and adds only what it needs.

Each is added when a surface needs one, and states what it is *for* rather than what it looks like — the same discipline the foundation's color roles follow.

- `intent="primary"` — the default action, macOS-style: the one action a surface most wants taken, worn in the selected color; at most one per view, and Return activates it within its dialog (the wiring belongs to the dialog surface).
- `intent="danger"` — the destructive action: a press that destroys something. It wears the danger color and is never the default action ([ui/app/dialog/index.md](../../app/dialog/index.md), the alert).
- `intent="alert"` — the caution action: a press worth a second look, worn in the alert color.
- `variant="ghost"` — a transparent, borderless button that inherits the containing text color and uses hover and press tints. Replaces the bare `ghost` attribute. The variant is explicit on each button; containers do not assign it automatically.
- Omit `variant` for the regular filled button. `intent`, `icon`, and `size` compose independently with the variant. A ghost button with an intent wears the intent color as text rather than fill.
- `icon` — the button's whole content is an icon, and the button stands as if it held a line of text: its content is a line-sized cell, so it is exactly as tall as a labelled button, and square. The glyph sits a step below the line — the icon scale's step under it, `sm` at the default size — because filling the line outsizes the letters beside it and matching them leaves the glyph adrift in the cell. The button's line governs both cell and step; a control that wants a compact button inside it tightens the line rather than shrinking the icon. The glyph must be an element child (`<tv-icon>`, a `<span>`); an anonymous text node cannot be placed into the cell.
- `target` — a snug press-target around inline content, for a button living dense in chrome — a bar, a row, a line — rather than standing alone: the shared block padding step with a tightened inline step, at the default text size. It composes with `variant` and `intent` like any geometry; an `icon` button is already snug, so `target` adds nothing there. If a third fit ever joins `target` and `icon`, the pair promotes to an enum the way the bare `ghost` attribute became `variant="ghost"`.
- `size="sm"` — the step-down size, for a button sitting inside another control or a dense row, pairing a text step with a padding step and sizing the icon the button holds.
- `size="lg"` — the step-up size, for a screen built around one or two prominent controls, such as the [setup screen](../../setup/index.md)'s Connect button. A [text field](../input/index.md#Size) beside it takes the same size, so the two are the same height.

## Pointer and expanded states

| Treatment | Rest | Hover | Pressed or expanded |
| --- | --- | --- | --- |
| Regular | Control or intent fill | Unchanged | Derived active fill |
| Ghost | Transparent | Hover tint | Active tint |

Pressed means `:active`; expanded means `aria-expanded="true"`. The expanded treatment persists while the associated menu or popover is open and takes precedence over hover. Disabled buttons do not receive pointer or expanded styling.

State feedback follows the shared [interaction states](../index.md#interaction-states) rules.

Variant rules use zero-specificity selectors such as `:where(button[variant="ghost"])` and their state selectors. Buttons retain the shared control geometry, focus and disabled treatment.

A component placing a button uses these rather than undoing the ambient styling. Undoing means keeping a hand-copy of whatever properties the foundation happens to set, which falls out of step the moment the foundation sets one more.

## Focus

A pointer press activates a button without taking focus — the Mac convention, followed so Television feels native: focus stays where it was, and a later keystroke never rings a button the pointer touched. Keyboard access is untouched — Tab reaches every button, activation works, and the focus ring follows keyboard focus only ([button.css](./button.css)). The suppression is behaviour, not styling: a delegated `pointerdown` handler prevents the default focus move on buttons alone; other controls keep pointer focus (a field must focus to type). The app shell owns the handler.

**Ambient styling is the weakest thing in the cascade.** Every rule for the bare element is wrapped in `:where()`, which contributes nothing to specificity, so an intent or a component overrides it with a plain selector. Without that, a rule like `button:hover` outranks a component's own `:hover` and the component has to contrive a selector to win — a workaround that reads like an accident and gets tidied away, taking the fix with it. ^bt-ambient-is-weakest

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this element requires no direct test. The button has no standalone view or custom behavior. Each surface that uses it must prove that it renders a native `<button>` with the attributes and accessible label that surface requires. Focus, keyboard activation, form participation, and accessibility semantics come from the native browser control. They receive no separate button test.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [foundation architecture](../../../arch/ui/foundation.md#Testing) owns proof that this element's authoritative stylesheet reaches a fresh production web build. This element requires no duplicate test of that delivery.

