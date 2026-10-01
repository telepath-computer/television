import type { NavigationKey } from "@telepath-computer/television-artifact/browser";
import type { ApplicationSnapshot } from "./application-service.ts";

/** The existing application operations used by pointer and keyboard navigation. */
export interface ApplicationNavigationTarget {
  readonly snapshot: ApplicationSnapshot;
  selectPage(channelId: string, artifactId: string): void;
  focusChannel(channelId: string): Promise<void>;
}

/**
 * Apply one physical arrow to the current application snapshot.
 *
 * The function owns no state: successful moves enter the same selection or
 * focus operation as the corresponding tab or channel-row release.
 */
export function handleApplicationNavigationKey(
  application: ApplicationNavigationTarget,
  key: NavigationKey,
): boolean {
  const snapshot = application.snapshot;
  const focusedChannel = snapshot.focusedChannel;

  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (focusedChannel === null || focusedChannel.selectedPage === null) return false;
    const currentIndex = focusedChannel.pages.indexOf(focusedChannel.selectedPage);
    const targetIndex = currentIndex + (key === "ArrowLeft" ? -1 : 1);
    const targetArtifactId = focusedChannel.pages[targetIndex]?.artifactIds[0];
    if (currentIndex === -1 || targetArtifactId === undefined) return false;

    blurDOMFocus();
    application.selectPage(focusedChannel.id, targetArtifactId);
    return true;
  }

  const orderedChannelIds = channelSidebarOrder(snapshot);
  const currentIndex = focusedChannel === null
    ? -1
    : orderedChannelIds.indexOf(focusedChannel.id);
  const targetIndex = currentIndex + (key === "ArrowUp" ? -1 : 1);
  const targetChannelId = orderedChannelIds[targetIndex];
  if (currentIndex === -1 || targetChannelId === undefined) return false;

  blurDOMFocus();
  void application.focusChannel(targetChannelId).catch(() => {});
  return true;
}

function channelSidebarOrder(snapshot: ApplicationSnapshot): readonly string[] {
  const channels = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const pinned = snapshot.display.pinnedChannelIds.filter((channelId) =>
    channels.has(channelId)
  );
  const pinnedIds = new Set(pinned);
  const unpinned = snapshot.channels
    .filter(({ id }) => !pinnedIds.has(id))
    .map(({ id }) => id)
    .sort((left, right) => right.localeCompare(left));
  return [...pinned, ...unpinned];
}

function blurDOMFocus(): void {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) activeElement.blur();
}
