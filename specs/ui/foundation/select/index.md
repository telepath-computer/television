*UI spec: the select — the control that chooses one option from a list; its trigger, selection, interior, and keyboard.*

# Select (UI)

A control for choosing one value from a fixed list — a button wearing the current choice, opening a list of options, the job the native select does. The select is a popover specialization ([popover](../popover/index.md)): the panel, pairing, dismissal, and placement are the popover's, and this spec owns the trigger's content, the selection, the interior, and the keyboard.

**Status:** initial select vocabulary — a flat list, single selection. No disabled options, groups, or placeholder state until a surface needs one.

## Markup

The select is the custom element `<tv-select>`, holding its options:

- `<tv-select>` — the panel. It carries the popover's attributes — `trigger`, `manual`, `open` — with the popover's meanings ([popover](../popover/index.md), Markup).
- `<tv-option>` — one option: the label is the content, and `value` is the value the option stands for. `selected` marks the chosen option; the selection is singular — exactly one option wears it, and with none authored the first option is selected. `highlighted` marks the highlighted option while the panel is open ([Keyboard](#keyboard)) — element-managed state, like `open`, never authored.

The composing surface writes the trigger as a `<button>` with an id and no content of its own: the element owns the trigger's content — the selected option's label and the select caret, the joint up/down caret that marks a pop-up control ([icons](../icons/index.md)) — and rewrites it whenever the selection changes, so a surface never restates the choice.

The trigger is as wide as its widest option would make it, so committing a different option never resizes it — the native pop-up convention; it resizes only when the option set changes. A composing surface that states its own width on the trigger with ordinary CSS wins.

The elements carry the semantics themselves — the trigger reads as a combobox naming its highlighted option, the panel as a listbox, each option as an option marked selected or not — so the composing surface writes no roles and no wiring: a trigger button with an id, the panel naming it, the options inside. The exact write contracts, the minted ids the pairing uses, and the scripting surface (the `value` property, the `change` event) are the element architecture's ([arch/ui/elements.md#tv-select-tv-option](../../../arch/ui/elements.md#tv-select-tv-option)). [frames/foundations/select.frame](../../../../frames/foundations/select.frame) stages the specimen, and [styles.css](./styles.css) states the interior.

## Popover exclusivity

The select does not participate in popover exclusivity: opening a select closes no popover or menu, and opening a popover or menu does not close a select through that rule. A select inside Settings therefore leaves the Settings popover open. Ordinary dismissal still applies; this exception does not make the select `manual`.

## Selection

Opening the panel starts the highlight at the selected option. Moving the highlight changes nothing: the selection changes only when an option is *committed* — a press on an option, or Enter, Space, or Tab on the highlighted one. Committing makes the option the selected one, puts its label on the trigger, and closes the panel; committing the already-selected option closes and changes nothing. Escape and light dismiss close without committing ([popover](../popover/index.md), Behaviour).

## Keyboard

Opening never moves focus, and options never take it ([popover](../popover/index.md), Behaviour); the trigger, while it holds focus, reports the highlight to assistive technology ([Markup](#markup)). With the trigger focused and the panel closed, Enter, Space, ArrowDown, and ArrowUp open the panel.

While the panel is open the keys below act on it from wherever focus sits, and on nothing else — an open select owns them, as the native control does. The arrow keys move the highlight, holding at the first option when Up has nowhere to go and at the last when Down has nowhere to go; Home and End jump to the ends; and typing moves it — printable characters typed in quick succession accumulate into a string, the highlight moves to the next option whose label starts with it, and a pause resets the string. The highlight is singular across input methods: pointing at an option moves it there, and the arrow keys continue from wherever it last was. Only pointer movement counts as pointing — the panel opening under a resting pointer does not move the highlight, though it opens covering the trigger and usually does exactly that. Enter and Space commit ([Selection](#selection)); Tab, when the trigger holds focus, commits and then moves focus on as it would from any control.

## Placement

The select shares the popover's placement rules ([popover](../popover/index.md), Placement) — the per-axis choice by available room, the `--popover-distance` clearance off every window edge, taking the room there is when no side fits, and the continuous re-placement — with its own resting alignment: the panel opens over the trigger, leading edges aligned, seated so the selected option's row sits exactly where the trigger is — the pop-up convention that makes reopening feel like the list was there all along, the current choice under the pointer. When that seat would cross a window edge, the panel falls back to covering the trigger top edges aligned when there is room below, and bottom edges aligned — opening upward — when there is not. The panel keeps no clearance off the trigger, and opens at least as wide as it.

## Testing

The [companion proof](../../../../proofs/ui/foundation/select/index.md) describes the production-element browser coverage and its boundaries. The [popover](../popover/index.md) owns dismissal, placement, and the trigger contract; composing surfaces own their values and what a change of one does.
