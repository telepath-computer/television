import { describe, expect, it } from "vitest";
import { REQUIRED_DESKTOP_VERSION } from "../../packages/server/src/required-desktop-version.ts";
import { buildServerStatus } from "../../packages/server/src/updates/server-status.ts";
import { decideDesktopGate } from "../../packages/web/src/services/desktop-gate.ts";
import { decideDesktopUpgradeRecommendation } from "../../packages/web/src/services/desktop-upgrade-recommendation.ts";

// proofs/arch/updates/desktop-upgrade-gate.md#^updates-t-themes-desktop-floor
// Production constants and decision functions; only version/context inputs
// are authored. Real Electron startup is covered by ^ac-themes-desktop-required.
describe("desktop release floor (^updates-t-themes-desktop-floor)", () => {
  it("requires desktop 1.5.0 in release server status", () => {
    expect(REQUIRED_DESKTOP_VERSION).toBe("1.5.0");
    expect(buildServerStatus({}, "1.5.0").requiredDesktopVersion).toBe("1.5.0");
    expect(buildServerStatus({}, undefined).requiredDesktopVersion).toBeNull();
  });

  // Apps installed from npm are 1.3.x or earlier; downloaded apps are 1.4.0
  // or later. The floor gates every app below 1.5.0, so the recommendation,
  // which stays at 1.4.0, reaches no app.
  it.each([
    ["initial allowed cohort", true, "0.1.207", true, false],
    ["published desktop", true, "0.1.216", true, false],
    ["latest npm app", true, "1.3.2", true, false],
    ["first downloaded app", true, "1.4.0", true, false],
    ["immediately below", true, "1.4.9", true, false],
    ["app at requirement", true, "1.5.0", false, false],
    ["app above requirement", true, "1.5.1", false, false],
    ["unknown desktop", true, null, true, false],
    ["development desktop", true, "0.0.0", false, false],
    ["browser", false, "0.1.216", false, false],
  ])("handles %s", (_name, electron, shellVersion, gated, recommended) => {
    const suppressed = decideDesktopGate({ electron, shellVersion, requiredDesktopVersion: REQUIRED_DESKTOP_VERSION });
    expect(suppressed).toBe(gated);
    expect(decideDesktopUpgradeRecommendation({
      electron,
      shellVersion,
      noticesSuppressed: suppressed,
      updateState: null,
    })).toBe(recommended);
  });
});
