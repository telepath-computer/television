import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type LayoutNode,
  type OnboardingChannelMarker,
  type PageSize,
  type TabPage,
} from "@telepath-computer/television-shared";

type LegacyOnboardingChannelMarker = { slug: string; order: number };
type StoredTabPage = Omit<TabPage, "size"> & { size?: PageSize };

export type LegacyStoredChannelRecord = Record<string, unknown> & {
  id: string;
  name: string;
  layoutVersion?: never;
  layout: LayoutNode[];
  onboarding?: LegacyOnboardingChannelMarker;
};

export type IntermediateStoredChannelRecord = Record<string, unknown> & {
  id: string;
  name: string;
  layoutVersion: 2;
  layout: StoredTabPage[];
  onboarding: LegacyOnboardingChannelMarker;
};

export type PreSizeStoredChannelRecord = Record<string, unknown> & {
  id: string;
  name: string;
  layoutVersion: 2;
  layout: StoredTabPage[];
};

export type CurrentStoredChannelRecord = Record<string, unknown> & {
  id: string;
  name: string;
  layoutVersion: 2;
  layout: TabPage[];
  onboarding?: OnboardingChannelMarker;
};

export type LegacyStoredDisplayRecord = Record<string, unknown> & {
  activeChannelID: string | null;
  focusedChannelId?: never;
  pinnedChannelIds?: never;
};

export type CurrentStoredDisplayRecord = Record<string, unknown> & {
  activeChannelID?: never;
  focusedChannelId: string | null;
  pinnedChannelIds: string[];
};

/**
 * Convert one authored channel record to the redesign shape. Version-2 pages
 * stay untouched; a legacy marker is slimmed, and fully current records return
 * unchanged.
 */
export function convertStoredChannelRecord(
  record:
    | LegacyStoredChannelRecord
    | IntermediateStoredChannelRecord
    | PreSizeStoredChannelRecord
    | CurrentStoredChannelRecord,
): PreSizeStoredChannelRecord | CurrentStoredChannelRecord {
  if (record.layoutVersion === 2) {
    if (!isLegacyOnboardingMarker(record.onboarding)) return record;

    const { onboarding, ...siblings } = record as IntermediateStoredChannelRecord;
    return {
      ...siblings,
      onboarding: { slug: onboarding.slug },
    };
  }

  const { layout, onboarding, layoutVersion: _absentLayoutVersion, ...siblings } = record;
  return {
    ...siblings,
    layoutVersion: 2,
    layout: layout
      .flatMap(legacyNodeArtifactIds)
      .map((artifactID) => ({
        artifactIds: [artifactID],
        geometry: { ...DEFAULT_PAGE_GEOMETRY },
      })),
    ...(onboarding === undefined ? {} : { onboarding: { slug: onboarding.slug } }),
  };
}

/** Add the shared size only to version-2 pages that predate the field. */
export function backfillStoredChannelPageSizes(
  record: PreSizeStoredChannelRecord | CurrentStoredChannelRecord,
): CurrentStoredChannelRecord {
  if (record.layout.every((page) => Object.hasOwn(page, "size"))) {
    return record as CurrentStoredChannelRecord;
  }

  return {
    ...record,
    layout: record.layout.map((page) =>
      Object.hasOwn(page, "size")
        ? page as TabPage
        : { ...page, size: { ...DEFAULT_PAGE_SIZE } }
    ),
  } as CurrentStoredChannelRecord;
}

/**
 * Convert the pre-redesign display fields after the storage-name step.
 * Current records are already migration output and stay unchanged.
 */
export function convertStoredDisplayRecord(
  record: LegacyStoredDisplayRecord | CurrentStoredDisplayRecord,
  channelIds: readonly string[],
): CurrentStoredDisplayRecord {
  if (isCurrentStoredDisplayRecord(record)) {
    return record;
  }

  const { activeChannelID, ...siblings } = record;
  const focusIsCurrent = activeChannelID !== null && channelIds.includes(activeChannelID);
  return {
    ...siblings,
    focusedChannelId: focusIsCurrent ? activeChannelID : newestChannelId(channelIds),
    pinnedChannelIds: [],
  };
}

function isLegacyOnboardingMarker(
  marker: unknown,
): marker is LegacyOnboardingChannelMarker {
  return typeof marker === "object" && marker !== null &&
    Object.keys(marker).length === 2 &&
    typeof (marker as Record<string, unknown>).slug === "string" &&
    typeof (marker as Record<string, unknown>).order === "number";
}

function legacyNodeArtifactIds(node: LayoutNode): string[] {
  switch (node.type) {
    case "card":
      return [node.artifactID];
    case "row":
      return node.children.map((child) => child.artifactID);
    case "stack":
      return node.children.flatMap((child) =>
        child.type === "card"
          ? [child.artifactID]
          : child.children.map((rowChild) => rowChild.artifactID)
      );
  }
}

function isCurrentStoredDisplayRecord(
  record: LegacyStoredDisplayRecord | CurrentStoredDisplayRecord,
): record is CurrentStoredDisplayRecord {
  return !Object.hasOwn(record, "activeChannelID");
}

function newestChannelId(channelIds: readonly string[]): string | null {
  // Mirror ServerStore.pickDeletionSuccessorChannelID's unpinned fallback,
  // including its localeCompare ordering and first-wins tie behavior.
  let newest: string | null = null;
  for (const channelId of channelIds) {
    if (newest === null || channelId.localeCompare(newest) > 0) {
      newest = channelId;
    }
  }
  return newest;
}
