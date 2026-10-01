*UI spec: the popover — the panel that floats over the page while the page stays live, anchored to the trigger that opened it.*

# Popover (UI)

A popover is a panel that floats over the page in an opaque box while the page stays live. Popovers are opened by, and anchored to, a `<button>` trigger.

## Markup

The popover is authored as `<tv-popover>`, with these attributes:

- `trigger` — id reference, required: the id of the button that opens the panel ([Trigger](#trigger)).
- `manual` — boolean attribute (present or absent): present, the composing surface owns closing ([Behaviour](#behaviour)).
- `open` — boolean attribute: present while the panel is presented. The attribute is the open state: the element toggles it, a staged pose declares it, script sets or removes it, and the stylesheet keys on it. The element behaves the same whichever of these changed the attribute.

The element keeps its authored children in light DOM as direct layout children. The host owns layout, native scrolling and rounded content clipping, including authored heights, grid columns and wrapping flex layouts. The exterior rim remains visible outside that content clip; its paint follows the positioned panel without changing content layout.

## Behaviour

Popovers exhibit the following behavior:

- The page stays live while a popover is open.
- A press on the trigger toggles the panel; outside presses and Escape dismiss it under the [nesting rules](#nesting).
- Opening does not move focus.
- Automatically managed popovers form one open branch per document, as described below. Selects remain excluded from opening exclusivity ([select](../select/index.md#popover-exclusivity)).
- When the panel closes, focus returns to the trigger if the panel held it.

A popover declared `manual` ignores outside presses and Escape, and stands outside automatic opening exclusivity — opening it closes nothing, and opening another popover leaves it open. The composing surface closes it.


## Nesting

A popover is a child of the open popover whose content contains its trigger. Where more than one ancestor contains that trigger, the nearest owns it. This relationship follows the trigger, not the panel's DOM location: a child panel may be rendered elsewhere and still belongs to its parent. These relationships form a branch from a root popover through its open descendants. Menus inherit these rules as popover specializations. ^po-nesting

- Opening an unrelated root closes the previously open automatically managed branch.
- Opening a child keeps its ancestors open. Opening another child of the same parent closes the previous child and its descendants.
- Closing or removing any popover closes all its descendants, whatever caused it to close. Dismissing the root therefore closes the whole branch; dismissing a child leaves its ancestors open.

The existing `manual` and select exclusions continue to govern automatic opening and dismissal. They do not allow descendants to remain open after their parent closes or is removed.

### Dismissal boundaries

The inside of a popover includes its descendant panels, including portions drawn beyond its edges. Pointer movement between these surfaces does not dismiss them.

| Gesture | Result |
| --- | --- |
| Press inside a child | Its ancestors remain open. The pressed control keeps its ordinary action. |
| Press inside an ancestor but outside its open child | Dismiss that child and its descendants. The original target still acts normally, including opening a different child or closing the ancestor. |
| Press outside the entire branch | Dismiss the branch. |
| Escape | The deepest open popover that handles Escape dismisses; that same keypress must not also dismiss its ancestors. An editor or other control that handles Escape keeps its existing behavior, without also dismissing its containing popover. |

Trigger presses keep the ordinary toggle behavior. These rules add no keyboard shortcuts and do not change a menu's keyboard behavior or a select's own dismissal rules.

Dismissal does not redirect its gesture to a newly exposed surface underneath. The original pointer target receives its normal action and focus. The existing focus-return rule applies at the dismissed branch's boundary: if focus was in the dismissed popover or any descendant, return it to that popover's trigger, unless the pointer action moved focus to its target. Do not restore focus to a child trigger inside a parent that is also closing.

## Trigger

The `trigger` attribute names the button that opens the panel, by id; the element wires the toggle. The panel need not sit beside the trigger. An open popover belongs to the trigger that opened it; a popover open with no trigger is a defect: it belongs to nothing and anchors to nothing. ^po-invoker

When the panel opens — a trigger press, or the `open` attribute set by anything — the trigger reads as expanded to assistive technology and shows the expanded state, the pressed look the button sheet states ([ui/foundation/button/index.md](../button/index.md)). When the panel closes, the trigger reads as collapsed and the look clears. The element maintains this through `aria-expanded` on the trigger — the exact write contract is stated in the element architecture ([arch/ui/elements.md#tv-popover](../../../arch/ui/elements.md#tv-popover)) — and the composing surface never writes it.

The element and its scripting surface are specified by the element architecture ([arch/ui/elements.md](../../../arch/ui/elements.md)).

## Placement

The panel opens below the trigger, left edges aligned. It keeps `--popover-distance` clear on every side — off the trigger, and off every window edge; the panel never crosses a window edge. Each axis flips on its own when the preferred side does not fit and the opposite side has more room. The panel opens above when it does not fit below and there is more room above, and aligns right edges when left alignment does not fit and right alignment offers more room. When the room on the chosen side is less than the panel wants, the panel takes the room there is and the contents scroll. The position is recomputed continuously: the panel follows the trigger and re-places whenever the window, the trigger, or the panel changes.

## Layer

The open panel renders on the `--layer-panel` layer ([ui/foundation/index.md](../index.md), Layers). The document boundary applies: a panel inside an artifact document stays within that document.

The panel participates in the document's stacking order, deliberately not the platform popover API, whose open panels render in the top layer where nothing the app or a theme paints can layer with them.

## Testing

The [companion proof](../../../../proofs/ui/foundation/popover/index.md) describes the production-element browser coverage and its boundaries.
