import { describe, expect, it } from "vitest";
import type { UpdateState } from "@telepath-computer/television-shared";
import {
  RECOMMENDED_DESKTOP_VERSION,
  decideDesktopUpgradeRecommendation,
} from "../src/services/desktop-upgrade-recommendation.ts";

// Contract coverage for the web-bundle-owned recommendation decision
// (specs/arch/updates/desktop-upgrade-recommendation.md
// ^desktop-rec-t-decision): every input is authored here. The real shell
// version, boot ordering, and retained server-state crossings remain with the
// seam and product assertions cited by that spec.

describe("desktop upgrade recommendation decision (^desktop-rec-t-decision)", () => {
  const noToast: UpdateState = { toast: null, desktop: null };
  const applyingToast: UpdateState = {
    toast: { version: "9.9.9", markdown: "A server update applies." },
    desktop: null,
  };
  const eligible = {
    electron: true,
    shellVersion: "1.3.2",
    noticesSuppressed: false,
    updateState: noToast,
  } as const;

  it("pins the recommendation at 1.4.0, the boundary between apps installed from npm and downloaded apps", () => {
    expect(RECOMMENDED_DESKTOP_VERSION).toBe("1.4.0");
  });

  it.each([
    ["a null retained update state", null],
    ["a retained state with no server toast", noToast],
  ])("applies to an older release shell in Electron with %s", (_name, updateState) => {
    expect(decideDesktopUpgradeRecommendation({ ...eligible, updateState })).toBe(true);
  });

  it.each([
    ["browser context", { electron: false }],
    ["development shell", { shellVersion: "0.0.0" }],
    ["unknown shell", { shellVersion: null }],
    ["malformed shell", { shellVersion: "0.1" }],
    ["shell at threshold", { shellVersion: "1.4.0" }],
    ["shell above threshold", { shellVersion: "1.4.1" }],
    ["gate presentation suppression", { noticesSuppressed: true }],
    ["applying server toast", { updateState: applyingToast }],
  ])("does not apply for %s", (_name, override) => {
    expect(decideDesktopUpgradeRecommendation({ ...eligible, ...override })).toBe(false);
  });

  it("compares release components numerically", () => {
    expect(decideDesktopUpgradeRecommendation({ ...eligible, shellVersion: "1.3.99" })).toBe(true);
    expect(decideDesktopUpgradeRecommendation({ ...eligible, shellVersion: "1.10.0" })).toBe(false);
  });
});
