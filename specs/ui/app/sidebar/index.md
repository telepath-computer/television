*UI spec: the channel sidebar — the narrow region down the left of the window; its interaction, markup, and styling.*

# Channel sidebar (UI)

Television's window is divided into two regions side by side. This spec owns the narrow one on the left — what it holds, how it behaves, and what it looks like. The division itself, and the region the channel sidebar sits in, are stated by [ui/app/index.md](../index.md).

The channel sidebar lists *channels* — the things a person keeps their work in. Pinned channels are listed first under their own heading, in the order the user arranges them; the rest follow by created date, newest first. An empty group never renders — no heading — on either side.

**Status:** implemented stage-one channel-sidebar authority. Channel semantics are owned by [channels.md](../../../product/channels.md). The production implementation renders the permanent ordered rows, shared scrolling, menus, selection, native rename, drag choreography including held-edge scrolling, and native titlebar movement.

Parameters are rendering inputs only: the caller supplies the channel list with its pinned marks, in arranged-then-created order, and the template derives the two groups — computation within what Liquid can say ([spec-ui.md](../../../spec-ui.md)). Nothing here specifies where channels live, whether a pin is personal or shared, or what marks a channel as activated — those belong to the channels product spec ([channels.md](../../../product/channels.md)).

## Markup and styling

The reference frames in this directory are the visual authority ([spec-ui.md](../../../spec-ui.md)); each is linked from the prose that discusses its subject. The surface fills the region it is given; the region's size is stated by the shell ([ui/app/index.md](../index.md)).

- [sidebar.frame](./sidebar.frame) — the surface, posable per the selected and renaming rows.
- [channel-list.frame](./channel-list.frame) — the channel list as a surface of its own, composed by the scrolling body here and by the channel switcher popover ([ui/app/top-bar/index.md](../top-bar/index.md), The lead group); the host owns geometry and scrolling, the list owns its rows, groups, and spacing.

Styling that exists only while a drag gesture is in flight is deliberately left to the implementation: the frames do not state it. Drag behavior is governed by the prose of this spec. ^sb-gesture-styling-carve-out

The titlebar is the window's grab handle over this region, and holds the space the macOS traffic lights occupy — they overlay the window's top-left corner, and that corner belongs to the channel sidebar. The reservation follows the desktop shell, which marks the document root ([arch/ui/index.md#^ui-platform-marker](../../../arch/ui/index.md#^ui-platform-marker)); in a browser it is zero ([ui/foundation/tokens/app.css#--traffic-light-x-reserve](../../foundation/tokens/app.css#--traffic-light-x-reserve)). The empty area of the titlebar remains available as a native window drag target regardless of the state of the neighbouring navbar; in particular, a horizontally overflowing tab strip scrolled rightwards must not take the hit region of the titlebar away. ^sb-titlebar

The titlebar's collapse control closes the channel sidebar ([ui/app/index.md#^ap-sidebar-collapse](../index.md#^ap-sidebar-collapse)). ^sb-titlebar-controls

The right edge carries a one-pixel translucent white inner seam and a half-pixel black exterior seam, consuming the [shared panel paints](../../foundation/index.md#panels-and-surface-edges). At DPR1, fractional exterior coverage remains visible. The seam adds no perimeter or broad shadow. One-pixel layout tracks retain the sidebar and main-region positions. `--sidebar-border` inherits `--panel-border` and accepts a component override. The sidebar border color token controls the independent scrolled titlebar separator.

## Interaction

Pointer and keyboard behavior here inherits the desktop-only input boundary stated by the shell ([ui/app/index.md#^ap-desktop-input-scope](../index.md#^ap-desktop-input-scope)); no touch gesture is implied.

- A channel responds under the pointer — the treatment is stated by [channel.frame](./channel.frame). The whole row is the target, not the text within it — a channel's name is often much shorter than the row, and a target that shrinks to fit its label would be unpredictable to hit. A long name stays on one line and truncates with an ellipsis before the menu trigger rather than running underneath it.
- A channel selects through the browser's `click` event on release, not on press, following the app-wide [draggable activation rule](../index.md#^ap-drag-click-activation). A press is also how a drag begins (Pinning and reordering, below), and selecting at press would switch the stage under every rearrangement. Pointer movement within the threshold in [drag.yml](../drag.yml) leaves the ordinary click intact; movement beyond it latches a drag, whose click is suppressed so rearranging never selects the carried channel.
- The list is one scrolling region: pinned and unpinned scroll together, below the fixed titlebar. While anything is scrolled past the top edge, the titlebar closes with a hairline — using the sidebar border token ([sidebar.frame](./sidebar.frame)) — and at rest the edge is bare. The fade treatment used by the tab strip is not used here: the scrolled edge is chrome, and chrome takes a line. A change that repaints the list — a drop, a rename — never moves its scroll position: the list keeps the reader's place.
- When at least one channel exists, exactly one is selected, across both groups — there is no other state in which none is; selecting one deselects whatever was selected before. A selected channel keeps its fill while the pointer is over it, so hovering never hides where you are.


## Creating

Creating is one press of the titlebar's create button ([sidebar.frame](./sidebar.frame)). The button is excluded from window dragging; the remaining titlebar space stays draggable. Pressing it creates a channel — born “New channel” — at the top of the unpinned group, the newest channel; it is selected and opens renaming in place, the name selected whole, so typing names it at birth and Enter settles it. The row grows into place — the list makes room over the shared displacement duration ([drag.yml](../drag.yml)) rather than snapping — and the field takes the seat as the growth lands, so its selection never flickers mid-grow. The rest of the semantics of creating — identity, what a new channel contains — belong to the channels product spec ([channels.md#^ch-create](../../../product/channels.md#^ch-create)).

## The row menu

Every row carries its own menu (the [menu](../../foundation/menu/index.md) vocabulary; the actions — Rename, Pin or Unpin by group, Delete — are authored in [channel-menu.frame](./channel-menu.frame)) — a popover is cheap declared DOM, so openness stays structural, nothing scripted. The trigger–menu id pairing is production wiring, minted per [arch/ui/menu-view.md](../../../arch/ui/menu-view.md); the reference frames do not render it. The trigger is the channel's overlaid sibling (a button cannot contain interactive content). It is visible while the row is selected or hovered, while the trigger has keyboard focus, and while its menu is open.

## Pinning and reordering

A channel pins from its row menu, joining the end of the pinned group; Unpin returns it to its place among the unpinned — created order decides where, not the moment of unpinning. Reordering pinned channels is done by dragging; there is no other reorder operation.

Dragging arranges. Pressing a channel and moving beyond the click threshold lifts the actual row — it follows the pointer anywhere, never clipped by the channel sidebar — and the drag reads by zone: the unpinned zone begins at the heading of its group — or, when there is no unpinned group to mark it, a stated distance below the last pinned row ([drag.yml](../drag.yml)) — and everything above it belongs to the pinned group — the gap between the last pinned row and the heading included, so hovering there marks the end of the pinned group. A placeholder can mark the beginning, any position between rows, or the end of either group.

- Over the pinned group, a row-shaped tint — the placeholder vocabulary shared with the tab strip ([ui/app/stage/index.md](../stage/index.md)); the shape and tint are stated by [channel-placeholder.frame](./channel-placeholder.frame) — marks the slot the row will take, and the other rows make way on the shared displacement duration ([drag.yml](../drag.yml)). Dropping commits the arrangement. An unpinned row carried here pins at the marked slot.
- Over the unpinned group the placeholder does not follow the pointer: created order fixes where the row lands, and the tint sits at that slot whatever the row's origin. For a row that came from this group that is where it already was — picking it up moves nothing, and release returns it there. For a pinned row it marks the landing its drop would take.
- A pinned row carried over the unpinned zone also wears the unpin action on its top-right corner — a small ringed pill, the slashed pin and the word Unpin ([channel.frame](./channel.frame), the `unpinning` state) — while release would unpin. Dropping unpins, and the list reflows to created order. The carried preview is compact — the row shrunk to its name, ringed like the pill — so the action reads at the pointer, not across the channel sidebar. The preview stays under the pointer: grabbed far along a wide row, the grip moves in with the shrink rather than leaving the preview hanging beside it.
- A drop toward a group that is not there behaves by side, the motion on the displacement duration in each case. With nothing pinned, carrying a row into the pinned zone materializes that group — heading and placeholder sliding down from the top — and carrying it back out sends it away again; dropping while it is in pins the row, and the group stays. Unpinning toward an absent unpinned group materializes nothing: the unpin action is the whole signal, and the drop creates the group. Carrying a group's only row out empties it; the emptied group leaves the same way, and the row's own group returns with its slot if the row comes back.

Carrying a row near the scrolling region's top or bottom edge scrolls the list, faster the nearer the edge; the measures are stated in [drag.yml](../drag.yml).

Release commits wherever the pointer is, and the pinned zone lives only within the channel sidebar: everything outside it — sideways over the stage included — is the unpinned side. Dragging a pinned row out of the channel sidebar and releasing unpins it; a row already unpinned returns to its slot. The rule for ending a tab drag ([ui/app/stage/index.md#^st-reorder-commit](../stage/index.md#^st-reorder-commit)) also governs pin dragging. A captured pointer release is the only way to commit a pin drag. It issues the marked pin, unpin, or reorder operation exactly once. Escape, pointer cancellation, and unexpected capture loss each abandon the drag, restore the original arrangement, and issue no operation; capture loss after a completed release is inert. An interrupted gesture has no coherent alternate result, so interruption abandons the transient slot rather than silently choosing it. Rearranging never changes which channel is open: the selected channel stays selected through every drag, pin, and unpin. Nothing the channel sidebar does disturbs the stage: renaming, pinning, unpinning, and reordering are channel-sidebar-local repaints, and the open channel's artifacts are unaffected.

Shared pin state can change under a drag — pinning is server state synced live ([arch/channel-state/index.md#^cs-pinned](../../../arch/channel-state/index.md#^cs-pinned)), and remote updates are not gated or queued while a drag is in flight; the UI may render them mid-drag. What the drag then does is deliberately left to the implementation: interrupt the drag in progress, or let it complete and nullify it on release — whichever is easier. The one hard rule is that state is never corrupted: whichever the implementation chose, the pinned list after release is valid and consistent with the server. ^sb-drag-remote

## Renaming

The native text field uses [foundation input styling](../../foundation/input/index.md); this surface owns its placement and interaction.

Renaming happens in place ([channel.frame](./channel.frame), the `renaming` state): the row menu's Rename swaps the channel's name for a field in the row's own seat; the trigger and menu withdraw while the name is edited, and a blue check in the trigger's seat marks the commit. The field is prefilled with the name, selected whole, and wears the row's exact box, so entering and leaving the edit moves nothing. Enter, the check, or leaving the field commits; Escape abandons the edit; a name emptied to nothing commits nothing — the old name stays.

## Deleting

Deleting confirms before it acts: the row menu's Delete opens the alert ([delete-confirm.frame](./delete-confirm.frame); the dialog vocabulary is [ui/app/dialog/index.md](../dialog/index.md), Appearance) — a dialog over the screen, dimmed — asking about the channel by name; deletion is permanent ([channels.md#^ch-delete-semantics](../../../product/channels.md#^ch-delete-semantics)). Cancel closes it and nothing changes; the dialog's Escape and backdrop dismissal paths likewise leave the channel untouched. Focus rests on Cancel. Where deletion lands — the first pinned channel, the first there is, or the no-channels empty state — is stated by [channels.md#^ch-delete-selection](../../../product/channels.md#^ch-delete-selection). A deleted row shrinks away on the same displacement duration, the list closing over it. With no channels left the channel sidebar shows no groups at all and the stage stays blank ([ui/app/stage/index.md](../stage/index.md), The empty channel) — the create affordance stays put as the way forward.

## Testing

Under [the real-motion rule in the testing policy](../../../arch/testing-policy.md#^real-motion), tests of edge autoscroll must run with real motion. Every drag test must also run with real motion. Every test of a row growing or shrinking must also run with real motion. More generally, a test must run with real motion whenever motion can affect its outcome, even if motion is not what the test is about. ^sb-real-motion

Native window movement must be proven in the real Electron app against a running server. The proof must give the neighbouring tab strip enough tabs to overflow, scroll it rightwards, then drag the empty channel-sidebar titlebar and observe the `BrowserWindow` move. Movement with a fitting strip or with an overflowing strip still at its left edge does not satisfy this regression condition. Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [foundation drag-region testing](../../../arch/ui/foundation.md#Testing) owns the shared selectors that define drag and no-drag regions. Proof that those selectors match does not replace the requirement stated here to prove native window movement. ^sb-titlebar-native-testing

