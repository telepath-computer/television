// Staging fixture: what a brand-new server's interface shows — the onboarding
// channels in sidebar order, with the focus channel open on its first page.
// Channel names and pages come from the onboarding design manifests
// (frames/lib/onboarding.ts); never a conformance target.
import { channels as onboarding } from "../../lib/onboarding.ts";

// The bundle creates TV Guide last and designates it the focus channel
// (packages/server/assets/onboarding-channels/onboarding-channels.json); the
// sidebar lists unpinned channels newest first (specs/ui/app/sidebar/sidebar.frame).
const SIDEBAR_ORDER = ["tv-guide", "productivity", "business-ops", "research"];
const FOCUS_CHANNEL = "tv-guide";

const channels = SIDEBAR_ORDER.map((slug) => {
  const channel = onboarding[slug];
  if (!channel) throw new Error(`No onboarding manifest for ${slug}`);
  return { id: slug, name: channel.name, tabs: channel.pages };
});

export default {
  channels,
  selected: FOCUS_CHANNEL,
  selected_tab: onboarding[FOCUS_CHANNEL].pages[0].id,
};
