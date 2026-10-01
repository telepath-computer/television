*UI spec: the navbar — artifact tabs and application controls.*

# Navbar (UI)

The *navbar* contains the artifact tabs and application controls. It currently sits above the stage ([ui/app/index.md](../index.md)).

**Status:** adopted stage-one authority.

## Markup and styling

[top-bar.frame](./top-bar.frame) defines the navbar, including the collapsed-sidebar controls and channel switcher popover.

## Composition

The navbar passes the supplied tabs to the [tab strip](../tab-strip/index.md) in order. Changing channels replaces the tabs immediately while keeping the application controls mounted.

## The lead group

While the [channel sidebar is collapsed](../index.md#^ap-sidebar-collapse), the navbar provides controls to reopen it and switch channels. With no channels, only the expand control is available. ^tb-lead-group

The channel switcher opens a [popover](../../foundation/popover/index.md) containing the shared [channel list](../sidebar/channel-list.frame) and create button. The list scrolls while the create button stays visible. Each row offers the same [context menu](../sidebar/index.md#the-row-menu) as the sidebar. ^tb-switcher

- Selecting a channel applies the same [shared selection](../../../product/channels.md) as selecting a sidebar row, then closes the popover. Selecting the current channel closes it without changing the selection. The sidebar stays collapsed. ^tb-switcher-select
- Keyboard navigation follows the [menu rules](../../foundation/menu/index.md#keyboard) for entry, arrow movement, and highlighting. Enter or Space selects the highlighted channel and closes the popover. The selected channel remains marked while navigation highlights another row. Rename inputs and child menus retain their own keyboard handling. Dismissal follows the popover rules. ^tb-switcher-keyboard
- The create button follows [sidebar creation](../sidebar/index.md#creating): it inserts a channel at the top of the unpinned group and opens renaming in that row. Creation selects the new channel without closing the popover, which stays open when renaming finishes. ^tb-switcher-create

### Pinning and reordering

The [sidebar drag rules](../sidebar/index.md#pinning-and-reordering) apply to the
switcher list, including pinning, unpinning, reordering, cancellation, and edge
scrolling. The popover boundary replaces the sidebar boundary: outside the
popover is the unpinned side. Edge scrolling uses the scrolling list above the
create bar, and the carried row follows the pointer without clipping at either
the list or panel edges. ^tb-switcher-drag

The switcher stays open through a drag, including release outside the panel.
Escape during a drag cancels that drag without dismissing the switcher; a later
Escape follows ordinary popover dismissal. Dragging never selects the carried
channel or expands the sidebar.

### Channel context menu

The [sidebar channel context menu](../sidebar/index.md#the-row-menu), [rename](../sidebar/index.md#renaming), [pinning](../sidebar/index.md#pinning-and-reordering), and [delete confirmation](../sidebar/index.md#deleting) rules apply here. Menu interaction and keyboard behavior come from the [menu spec](../../foundation/menu/index.md#keyboard); placement, trigger toggling, and focus restoration come from the [popover spec](../../foundation/popover/index.md). The switcher adds no keyboard shortcuts. ^tb-switcher-context-menu

Opening a channel context menu or using one of its actions does not select that channel. Rename and Pin/Unpin leave the switcher open; the row remains visible after moving groups, retaining focus if it held it. Renaming the selected channel updates the switcher label. These actions do not reload artifacts.

Deletion follows the shared dialog and selection rules. Opening confirmation closes the menu and switcher under the [dialog rules](../dialog/index.md#behaviour). Cancelling restores the switcher at its previous scroll position and returns focus to the row. After confirmed deletion, the switcher reopens while channels remain, reflects the resulting selection, and returns focus to that selected row. Deleting the last channel leaves it closed, removes the switcher, and returns focus to the expand control.

#### Nested dismissal

The channel context menu is a child of the switcher under the shared [popover nesting and dismissal rules](../../foundation/popover/index.md#nesting). Closing the switcher closes its context menu. Row selection, menu triggers, and creation retain their existing actions when an inner menu dismisses.

Rename follows the sidebar rules for commit, blur, and Escape. Cancelling an edit does not also dismiss the switcher. The confirmation dialog follows its shared dismissal rules and the restoration behavior above.

## Layout

Switching between empty and populated channels does not move the navbar controls or stage vertically. ^tp-stable-height

The strip centres on the stage while it fits. When space runs short, the strip shifts and then scrolls within the remaining space. Controls retain their natural size. ^tp-strip-centres

The leading controls remain visible and usable under pressure; the strip narrows before they would be clipped. ^tp-lead-floor

The clear gaps defined by [top-bar.frame](./top-bar.frame) remain outside the interactive tab strip and control boxes, including when tabs overflow and while the sidebar moves. These gaps provide space to drag the window. Padding inside a scrolling strip does not count as clear navbar space. ^tp-drag-bands

The [tab-strip spec](../tab-strip/index.md#^tb-strip-scrolls) owns scrolling, clipping and overflow feedback within the available space.

Resizing the bar or adding and removing controls updates this layout immediately, without animation. Scrolling the selected tab into view remains governed by the tab-strip rules.

## Popover height

[top-bar.frame](./top-bar.frame) caps the height of navbar popovers. The shared [popover placement rule](../../foundation/popover/index.md) can reduce that limit to fit the window. Overflow scrolls inside the panel; in the channel switcher, the create button stays visible below the list.

## Window dragging

Dragging empty navbar space moves the native window. Tabs and controls remain interactive rather than acting as window drag targets.

## Testing

Prove native window dragging in the real Electron app by dragging empty navbar space and observing the window move.
