import type {
  ApplicationChannelSnapshot,
  ApplicationPageSnapshot,
  ApplicationService,
} from "../services/application-service.ts";
import { setPageSizeAndFullScreen } from "./page-size.ts";

/** Replace one page's shared size state through the application page-write seam. */
export function setPageFullScreen(
  application: ApplicationService,
  channel: ApplicationChannelSnapshot,
  page: ApplicationPageSnapshot,
  fullScreen: boolean,
): void {
  setPageSizeAndFullScreen(application, channel, page, page.size, fullScreen);
}
