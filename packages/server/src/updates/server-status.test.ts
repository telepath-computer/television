import { describe, expect, it } from "vitest";
import { isReleaseVersion } from "@telepath-computer/television-shared";
import { REQUIRED_DESKTOP_VERSION } from "../required-desktop-version.ts";
import { buildServerStatus } from "./server-status.ts";

// Contract tests (specs/arch/updates/desktop-upgrade-gate.md
// ^t-gate-advertised): the producer side of the `server-status` seam — the
// message builder includes the server's required desktop version, and null
// for a 0.0.0 server (^required-desktop-constant). The websocket crossing is
// owned by version-advertisement.md ^t-server-status-on-connect
// (packages/server/test/version-advertisement.test.ts). The build stamp is
// passed as an explicit input, as in the resolver contracts (version.test.ts).

describe("the baked required desktop version (^required-desktop-constant)", () => {
  it("is null or a valid release-version triple — shape only; the value is a hand-made operations decision (^ops-bump)", () => {
    if (REQUIRED_DESKTOP_VERSION !== null) {
      expect(isReleaseVersion(REQUIRED_DESKTOP_VERSION)).toBe(true);
    }
  });
});

describe("buildServerStatus", () => {
  it("is the server-status message: type, version, requirement, and a null update field until the channel relay lands", () => {
    expect(buildServerStatus({}, "0.1.176", "0.1.150")).toEqual({
      type: "server-status",
      version: "0.1.176",
      requiredDesktopVersion: "0.1.150",
      update: null,
    });
  });

  it("advertises null when the baked requirement is null", () => {
    expect(buildServerStatus({}, "0.1.176", null).requiredDesktopVersion).toBe(null);
  });

  it("a 0.0.0 server advertises no requirement, even with a baked constant (^required-desktop-constant)", () => {
    const status = buildServerStatus({}, undefined, "0.1.150");
    expect(status.version).toBe("0.0.0");
    expect(status.requiredDesktopVersion).toBe(null);
  });

  it("a 0.0.0 server advertises no requirement even under the requirement hook alone", () => {
    const status = buildServerStatus({ TV_TEST_REQUIRED_DESKTOP_VERSION: "8.8.8" }, undefined, "0.1.150");
    expect(status.version).toBe("0.0.0");
    expect(status.requiredDesktopVersion).toBe(null);
  });

  it("honors both test hooks when unstamped (^hook-server-version, ^hook-required-version)", () => {
    const status = buildServerStatus(
      { TV_TEST_VERSION: "9.9.9", TV_TEST_REQUIRED_DESKTOP_VERSION: "8.8.8" },
      undefined,
      "0.1.150",
    );
    expect(status.version).toBe("9.9.9");
    expect(status.requiredDesktopVersion).toBe("8.8.8");
  });

  it("a hooked version advertises the baked requirement when the requirement hook is absent", () => {
    const status = buildServerStatus({ TV_TEST_VERSION: "9.9.9" }, undefined, "0.1.150");
    expect(status.requiredDesktopVersion).toBe("0.1.150");
  });

  it("ignores both hooks when the stamp is present — release builds are inert", () => {
    const status = buildServerStatus(
      { TV_TEST_VERSION: "9.9.9", TV_TEST_REQUIRED_DESKTOP_VERSION: "8.8.8" },
      "0.1.176",
      "0.1.150",
    );
    expect(status.version).toBe("0.1.176");
    expect(status.requiredDesktopVersion).toBe("0.1.150");
  });
});

// The update field of server-status carries the channel-derived state
// verbatim (update-channel.md ^relay); derivation breadth is owned by
// ^t-relay in updates/update-channel.test.ts.
describe("buildServerStatus update passthrough (^relay)", () => {
  it("rides the provided update state, defaulting to null when none applies", () => {
    expect(buildServerStatus({ TV_TEST_VERSION: "1.0.0" }, undefined, null).update).toBeNull();
    const update = {
      toast: { version: "2.0.0", markdown: "hi" },
      desktop: null,
    };
    expect(buildServerStatus({ TV_TEST_VERSION: "1.0.0" }, undefined, null, update).update).toEqual(update);
  });
});
