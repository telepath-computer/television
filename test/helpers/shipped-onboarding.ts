// The single change-control point for the shipped onboarding channel set
// (specs/arch/onboarding/content.md#^no-placeholder-content). Changing this
// LIST is the deliberate act of shipping, retiring, or renaming an onboarding
// channel. Whether a channel's CONTENT is swap-free or deliberately test-pinned
// is per channel — the content tree's README
// (packages/server/assets/onboarding-channels/README.md) carries that contract.
// Imported by packages/server/test/onboarding-content.test.ts; nothing else
// pins the set.
export const SHIPPED_ONBOARDING_CHANNELS = ["research", "business-ops", "productivity", "tv-guide"];
