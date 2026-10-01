*Overflow fade: an independent helper that supplies per-item mask geometry for scrolling surfaces.*

# Overflow fade

This spec owns the independent helper that positions CSS masks on items in a horizontal, left-to-right scrollport. The consuming UI spec owns which edges fade, the fade distance, and the appearance of the items. The [tab strip](../../ui/app/tab-strip/index.md) is one consumer.

## Contract

```ts
type ItemEdgeFadeOptions = {
  items: string;
  distance: number;
  edges: "right" | "both";
};

declare function mountItemEdgeFade(
  scrollport: HTMLElement,
  options: ItemEdgeFadeOptions,
): { refresh(): void; dispose(): void };
```

`items` selects descendants of the scrollport; `distance` is a nonnegative fade distance in CSS pixels. The helper manages geometry only. It does not own scrolling, selection, focus, or item content. The caller mounts it after the scrollport exists and calls `dispose()` when that surface disconnects.

## Geometry and styling

An enabled edge fades only while content remains outside that edge. The fade extends inward from the visible scrollport edge, excluding its border. Items intersecting that zone receive `data-item-edge-fade` and these CSS properties:

| Property | Value |
| --- | --- |
| `--item-fade-start` | Visible left edge relative to the item border box |
| `--item-fade-end` | Visible right edge relative to the item border box |
| `--item-fade-left` | Active left fade distance, or zero |
| `--item-fade-right` | Active right fade distance, or zero |

All values are CSS pixel lengths. Distances are capped at half the visible scrollport width so opposing fades cannot overlap. CSS uses the values to mask each item from transparent at an active edge to opaque inward. Items outside the active fade zones have no helper-owned mask properties or marker.

The mask belongs to the item carrying its backdrop filter, not the scrollport or an ancestor. This lets the item blur its backdrop before the mask fades the result. The consuming surface supplies clipping and the wallpaper sampling boundary; neither is created by the helper.

## Updates and cleanup

The helper measures on mount and responds to scrolling, scrollport and item resizing, and changes to item membership, label content, or classes within the scrollport. Font loading and changed labels must update the geometry when they change item sizes. Resize and mutation observers track these changes without reacting recursively to the helper's own CSS-property or marker writes.

The caller invokes `refresh()` after external styling moves items without resizing them, such as a change to their gap. It schedules the same measurement as an observed change and requires no scroll event. The helper does not poll for these changes. ^of-explicit-refresh

Updates are coalesced into one animation-frame callback. Each callback reads the required geometry before writing mask properties. Removed items lose their marker and properties and are no longer observed.

Disposal cancels any pending callback, removes listeners, disconnects observers, and clears the helper-owned marker and properties from managed items. Subsequent `refresh()` or `dispose()` calls have no effect.

## Tab-strip integration

The tab strip mounts the helper with both edges enabled and the distance from its UI measures. Each tab, including a selected tab, receives its own mask so backdrop blur remains available. The strip carries `data-overflow` while its contents exceed its visible width. The caller owns this marker, clipping and scrolling; the helper owns item mask geometry.

After the application [theme stylesheet settles or is removed](../themes/delivery.md#^theme-delivery-style-notification), or the effective root appearance changes, the tab strip updates its layout and refreshes mask geometry. This includes position-only changes and operating-system appearance changes while following the system. Updates preserve the existing selection, drag and scroll rules. Disconnecting removes these subscriptions. Workshop tab strips perform the same refresh after their environment applies theme or appearance changes. ^of-style-refresh

Real-browser overflow coverage must show `data-overflow` throughout the scroll range and, at each edge, item masks exactly while more tabs remain past that edge. At each end of the scroll range, the masks at that edge clear. Replacing the tabs with a list that fits must clear the overflow marker and item masks and leave no scroll range.

Run this integration coverage in Chromium and Firefox.
