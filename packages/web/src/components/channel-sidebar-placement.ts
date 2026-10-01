/** `zones.below_pinned_px` in `specs/ui/app/drag.yml`. */
export const CHANNEL_SIDEBAR_BELOW_PINNED_PX = 24;

export type ChannelSidebarSide = "pinned" | "unpinned";

export interface ChannelSidebarMembership {
  pinnedChannelIds: readonly string[];
  unpinnedChannelIds: readonly string[];
}

export interface ChannelSidebarDragSource extends ChannelSidebarMembership {
  channelId: string;
}

export interface ChannelSidebarPoint {
  x: number;
  y: number;
}

export interface ChannelSidebarRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChannelSidebarRowBounds {
  channelId: string;
  top: number;
  bottom: number;
}

export interface ChannelSidebarPlaceholderBounds {
  side: ChannelSidebarSide;
  index: number;
  top: number;
  bottom: number;
}

export interface ChannelSidebarPlacementGeometry {
  sidebar: ChannelSidebarRect;
  /** Current rendered pinned rows, excluding the carried row and placeholder. */
  pinnedRows: readonly ChannelSidebarRowBounds[];
  /** Top of the unpinned heading, or null while that group is absent. */
  unpinnedGroupTop: number | null;
  /**
   * Bottom of current pinned content, including its placeholder when present.
   * This and unpinnedGroupTop cannot both be null in complete drag geometry.
   */
  pinnedContentBottom: number | null;
  placeholder: ChannelSidebarPlaceholderBounds | null;
}

export interface ChannelSidebarPlacementInput {
  source: ChannelSidebarDragSource;
  current: ChannelSidebarMembership;
  pointer: ChannelSidebarPoint;
  geometry: ChannelSidebarPlacementGeometry;
}

export type ChannelSidebarPlacement =
  | {
      kind: "placement";
      side: ChannelSidebarSide;
      placeholder: { side: ChannelSidebarSide; index: number } | null;
      /** Complete replacement value for ApplicationService.setPinnedChannelIds. */
      operation: readonly string[] | null;
    }
  | { kind: "invalidated" };

/**
 * Calculate one channel-sidebar drag pose without mutating view or server state.
 * Callers re-evaluate on every application snapshot; changed ordered membership
 * invalidates the pose before it can produce a stale full-list operation.
 */
export function calculateChannelSidebarPlacement(
  input: ChannelSidebarPlacementInput,
): ChannelSidebarPlacement {
  if (!hasValidMembership(input.source) ||
      !hasValidMembership(input.current) ||
      !haveSameMembership(input.source, input.current) ||
      !haveCurrentPinnedRows(input) ||
      !hasZoneBoundary(input.geometry)) {
    return { kind: "invalidated" };
  }

  const side = resolveSide(input.pointer, input.geometry);
  return side === "pinned"
    ? pinnedPlacement(input)
    : unpinnedPlacement(input);
}

function pinnedPlacement(
  input: ChannelSidebarPlacementInput,
): ChannelSidebarPlacement {
  const { source, current, pointer, geometry } = input;
  const retained = geometry.placeholder?.side === "pinned" &&
    pointer.y >= geometry.placeholder.top &&
    pointer.y <= geometry.placeholder.bottom
    ? geometry.placeholder.index
    : null;
  const index = retained ?? findPinnedIndex(pointer.y, geometry.pinnedRows);
  const pinnedChannelIds = current.pinnedChannelIds.filter(
    (channelId) => channelId !== source.channelId,
  );
  pinnedChannelIds.splice(index, 0, source.channelId);

  return {
    kind: "placement",
    side: "pinned",
    placeholder: { side: "pinned", index },
    operation: pinnedChannelIds,
  };
}

function unpinnedPlacement(
  input: ChannelSidebarPlacementInput,
): ChannelSidebarPlacement {
  const { source, current } = input;
  const sourceWasPinned = source.pinnedChannelIds.includes(source.channelId);
  const index = sourceWasPinned
    ? findCreationOrderedIndex(
        current.unpinnedChannelIds,
        source.channelId,
      )
    : source.unpinnedChannelIds.indexOf(source.channelId);

  return {
    kind: "placement",
    side: "unpinned",
    placeholder: sourceWasPinned && current.unpinnedChannelIds.length === 0
      ? null
      : { side: "unpinned", index },
    operation: sourceWasPinned
      ? current.pinnedChannelIds.filter(
          (channelId) => channelId !== source.channelId,
        )
      : null,
  };
}

function resolveSide(
  pointer: ChannelSidebarPoint,
  geometry: ChannelSidebarPlacementGeometry,
): ChannelSidebarSide {
  const { sidebar } = geometry;
  const outside = pointer.x < sidebar.left || pointer.x > sidebar.right ||
    pointer.y < sidebar.top || pointer.y > sidebar.bottom;
  if (outside) return "unpinned";

  const unpinnedBoundary = geometry.unpinnedGroupTop ??
    (geometry.pinnedContentBottom === null
      ? Number.NEGATIVE_INFINITY
      : geometry.pinnedContentBottom + CHANNEL_SIDEBAR_BELOW_PINNED_PX);
  return pointer.y < unpinnedBoundary ? "pinned" : "unpinned";
}

function findPinnedIndex(
  pointerY: number,
  rows: readonly ChannelSidebarRowBounds[],
): number {
  const index = rows.findIndex(({ top, bottom }) =>
    pointerY < top + (bottom - top) / 2
  );
  return index === -1 ? rows.length : index;
}

/** Pinned-origin landing relies on the product invariant that id order is creation order. */
function findCreationOrderedIndex(
  unpinnedChannelIds: readonly string[],
  channelId: string,
): number {
  const remaining = unpinnedChannelIds.filter((id) => id !== channelId);
  const index = remaining.findIndex((id) => id < channelId);
  return index === -1 ? remaining.length : index;
}

function hasZoneBoundary(
  geometry: ChannelSidebarPlacementGeometry,
): boolean {
  return geometry.unpinnedGroupTop !== null ||
    geometry.pinnedContentBottom !== null;
}

function hasValidMembership(membership: ChannelSidebarMembership): boolean {
  const ids = [
    ...membership.pinnedChannelIds,
    ...membership.unpinnedChannelIds,
  ];
  return new Set(ids).size === ids.length;
}

function haveSameMembership(
  source: ChannelSidebarMembership,
  current: ChannelSidebarMembership,
): boolean {
  return haveSameIds(source.pinnedChannelIds, current.pinnedChannelIds) &&
    haveSameIds(source.unpinnedChannelIds, current.unpinnedChannelIds);
}

function haveCurrentPinnedRows(input: ChannelSidebarPlacementInput): boolean {
  const expected = input.current.pinnedChannelIds.filter(
    (channelId) => channelId !== input.source.channelId,
  );
  const actual = input.geometry.pinnedRows.map(({ channelId }) => channelId);
  const placeholder = input.geometry.placeholder;
  const placeholderIsValid = placeholder === null ||
    (Number.isInteger(placeholder.index) &&
      placeholder.index >= 0 &&
      placeholder.index <= (placeholder.side === "pinned"
        ? expected.length
        : input.current.unpinnedChannelIds.length));
  return input.source.pinnedChannelIds.includes(input.source.channelId) !==
      input.source.unpinnedChannelIds.includes(input.source.channelId) &&
    haveSameIds(expected, actual) &&
    placeholderIsValid;
}

function haveSameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((channelId, index) => channelId === right[index]);
}
