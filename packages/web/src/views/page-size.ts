import type { PageSize } from "@telepath-computer/television-shared";
import type {
  ApplicationChannelSnapshot,
  ApplicationPageSnapshot,
  ApplicationService,
} from "../services/application-service.ts";

/** Replace one page's shared size and mode in the same whole-list update. */
export function setPageSizeAndFullScreen(
  application: ApplicationService,
  channel: ApplicationChannelSnapshot,
  page: ApplicationPageSnapshot,
  size: PageSize,
  fullScreen: boolean,
): void {
  const pages = channel.pages.map((candidate) => ({
    artifactIds: [...candidate.artifactIds],
    geometry: {
      ...candidate.geometry,
      full_screen: candidate === page
        ? fullScreen
        : candidate.geometry.full_screen,
    },
    size: candidate === page ? { ...size } : { ...candidate.size },
  }));
  void application.updateChannelPages(channel.id, pages).catch(() => {});
}
