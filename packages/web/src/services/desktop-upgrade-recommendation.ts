import {
  DEV_VERSION,
  isNewerVersion,
  isReleaseVersion,
  type UpdateState,
} from "@telepath-computer/television-shared";

/**
 * The release version below which the recommendation applies
 * (^desktop-rec-version). Apps installed from npm are 1.3.x or earlier and
 * downloaded apps are 1.4.0 or later, so this value selects the npm apps. It
 * stays 1.4.0 and is never derived from the release version, a server
 * version or the required desktop version.
 */
export const RECOMMENDED_DESKTOP_VERSION = "1.4.0";

/** Recommendation dismissal, independent from the channel-toast key. */
export const DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY =
  "tv-desktop-upgrade-recommendation-dismissed";

/**
 * Fixed body authored by
 * specs/ui/app/update-notification/content.yml#desktop_upgrade_recommendation.
 * Production does not import spec content; this constant conforms verbatim.
 */
export const DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN =
  "### Recommended desktop upgrade available\n" +
  "\n" +
  "The Television desktop app is now a downloaded Mac app that updates itself. This copy was installed with npm and receives no more updates.\n" +
  "\n" +
  "To move to the downloaded app on an Apple Silicon Mac:\n" +
  "\n" +
  "1. [Download Television for Mac](https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64).\n" +
  "2. Open the downloaded disk image and drag Television to Applications.\n" +
  "3. Quit this app, then open Television from Applications. It keeps your saved server connection.\n" +
  "\n" +
  "From then on, open Television from Applications, not with `tv-desktop`.";

export interface DesktopUpgradeRecommendationContext {
  electron: boolean;
  /** Parsed shell release, or null when absent/malformed. */
  shellVersion: string | null;
}

export interface DesktopUpgradeRecommendationInput
  extends DesktopUpgradeRecommendationContext {
  /** The gate-owned one-way presentation suppression switch. */
  noticesSuppressed: boolean;
  /** Retained state for the bundle-serving connection; null before any state. */
  updateState: UpdateState | null;
}

/** The live eligibility conjunction owned by ^desktop-rec-condition. */
export function decideDesktopUpgradeRecommendation(
  input: DesktopUpgradeRecommendationInput,
): boolean {
  if (!input.electron || input.noticesSuppressed) return false;
  if (input.updateState?.toast != null) return false;
  if (input.shellVersion === null || !isReleaseVersion(input.shellVersion)) return false;
  if (input.shellVersion === DEV_VERSION) return false;
  return isNewerVersion(RECOMMENDED_DESKTOP_VERSION, input.shellVersion);
}
