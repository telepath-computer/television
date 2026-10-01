*UI spec: the checklist — the static done/not-done idiom an authored artifact writes as markup.*

# Checkbox list (UI)

A list whose rows carry a done mark: a drawn box, filled and checked when the row says so, the row's text muted and struck through with it. It is display, not a control — the marks state what the author wrote, and pressing one does nothing.

[ui/foundation/checkbox-list/template.liquid](./template.liquid) renders the authored markup and [ui/foundation/checkbox-list/styles.css](./styles.css) states the looks, the marker included: it is drawn by the sheet, not written by the author. The marker rides the row's first line rather than centring against the row, so a row that wraps keeps its box beside the text it belongs to. Hovering the marker shows a not-allowed cursor — the row is not a target, and saying so at the box alone leaves the text hoverable and selectable as ordinary prose.

The elements' contract is specified by [arch/ui/elements.md](../../../arch/ui/elements.md).

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), real-browser coverage must show that the list preserves its author-written `<checkbox-item>` children. It must show that the list preserves their order and complete content, along with each item's authored `checked` state. It must also show that the list does not generate a control. After a real pointer press on an unchecked item and on a checked item, the list's markup must remain unchanged. Neither press may emit an `input` or `change` event.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite does not cover the marker's placement, the layout when text wraps, the cursor, spacing, colour, or how checked items look. Those remain staging and review concerns.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [element architecture](../../../arch/ui/elements.md#Testing) assigns [Canonical](../../../arch/canonical.md) responsibility for proving which elements are public and preserving their compatibility. It assigns [UI architecture](../../../arch/ui/index.md#Testing) responsibility for proving how production element modules are structured. For the checkbox list, those proofs show that its module and stylesheet reach a real artifact document. They show that the public names remain available. They also show that the production modules follow the custom-element conventions. Coverage for this surface starts after the production custom-element definitions load. It does not duplicate the architecture proofs described above.

