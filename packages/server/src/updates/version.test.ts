import { describe, expect, it } from "vitest";
import {
  DEV_VERSION,
  isNewerVersion,
  isReleaseVersion,
  isStaleBundle,
} from "@telepath-computer/television-shared";
import { resolveRequiredDesktopVersion, resolveUpdateReleaseVersion } from "./version.ts";

// Contract tests (pure logic, no boundary crossed) for the update-domain
// version model: specs/arch/updates/index.md ^updates-version-comparisons and
// ^updates-dev-version, and the stamp-only resolver with its test hooks
// (version-advertisement.md ^hook-server-version,
// desktop-upgrade-gate.md ^hook-required-version). The build-time stamp is
// passed as an explicit input here; real stamped-build coverage is carried by
// the build seams (version-advertisement.md ^t-web-stamp and the CLI
// build-config integrity test).

describe("isReleaseVersion", () => {
  it("accepts plain major.minor.patch triples", () => {
    expect(isReleaseVersion("0.1.174")).toBe(true);
    expect(isReleaseVersion("10.20.30")).toBe(true);
    expect(isReleaseVersion("0.0.0")).toBe(true);
  });

  it("rejects everything that is not a plain triple", () => {
    expect(isReleaseVersion("")).toBe(false);
    expect(isReleaseVersion("1.2")).toBe(false);
    expect(isReleaseVersion("1.2.3.4")).toBe(false);
    expect(isReleaseVersion("1.2.3-beta.1")).toBe(false);
    expect(isReleaseVersion("v1.2.3")).toBe(false);
    expect(isReleaseVersion("1.2.x")).toBe(false);
    expect(isReleaseVersion(" 1.2.3")).toBe(false);
    expect(isReleaseVersion("1.2.3 ")).toBe(false);
  });
});

describe("isNewerVersion (numeric triple greater-than)", () => {
  it("compares the three numeric components in order", () => {
    expect(isNewerVersion("0.2.0", "0.1.174")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.1.175", "0.1.174")).toBe(true);
    expect(isNewerVersion("0.1.174", "0.1.174")).toBe(false);
    expect(isNewerVersion("0.1.173", "0.1.174")).toBe(false);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
  });

  it("compares numerically, not lexicographically", () => {
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.1.9", "0.1.10")).toBe(false);
  });
});

describe("isStaleBundle (string inequality with the dev exemption)", () => {
  it("is true exactly when the versions differ as strings", () => {
    expect(isStaleBundle("0.1.173", "0.1.174")).toBe(true);
    expect(isStaleBundle("0.1.175", "0.1.174")).toBe(true);
    expect(isStaleBundle("0.1.174", "0.1.174")).toBe(false);
  });

  it("treats 0.0.0 on either side as matching (^updates-dev-version)", () => {
    expect(isStaleBundle(DEV_VERSION, "0.1.174")).toBe(false);
    expect(isStaleBundle("0.1.174", DEV_VERSION)).toBe(false);
    expect(isStaleBundle(DEV_VERSION, DEV_VERSION)).toBe(false);
  });
});

describe("resolveUpdateReleaseVersion (stamp-only, ^hook-server-version)", () => {
  it("returns the stamp whenever the build defines one", () => {
    expect(resolveUpdateReleaseVersion({}, "0.1.174")).toBe("0.1.174");
  });

  it("ignores TV_TEST_VERSION when the stamp is present — release builds are inert to the hook", () => {
    expect(resolveUpdateReleaseVersion({ TV_TEST_VERSION: "9.9.9" }, "0.1.174")).toBe("0.1.174");
  });

  it("resolves 0.0.0 when unstamped with no hook", () => {
    expect(resolveUpdateReleaseVersion({}, undefined)).toBe(DEV_VERSION);
  });

  it("honors TV_TEST_VERSION exactly when the stamp is absent", () => {
    expect(resolveUpdateReleaseVersion({ TV_TEST_VERSION: "9.9.9" }, undefined)).toBe("9.9.9");
  });

  it("ignores a TV_TEST_VERSION that is not a plain triple", () => {
    expect(resolveUpdateReleaseVersion({ TV_TEST_VERSION: "not-a-version" }, undefined)).toBe(DEV_VERSION);
    expect(resolveUpdateReleaseVersion({ TV_TEST_VERSION: "1.2.3-beta" }, undefined)).toBe(DEV_VERSION);
    expect(resolveUpdateReleaseVersion({ TV_TEST_VERSION: "" }, undefined)).toBe(DEV_VERSION);
  });
});

describe("resolveRequiredDesktopVersion (^hook-required-version)", () => {
  it("returns the baked constant whenever the build defines a stamp", () => {
    expect(resolveRequiredDesktopVersion("0.1.170", {}, "0.1.174")).toBe("0.1.170");
    expect(resolveRequiredDesktopVersion(null, {}, "0.1.174")).toBe(null);
  });

  it("ignores TV_TEST_REQUIRED_DESKTOP_VERSION when the stamp is present", () => {
    expect(
      resolveRequiredDesktopVersion("0.1.170", { TV_TEST_REQUIRED_DESKTOP_VERSION: "9.9.9" }, "0.1.174"),
    ).toBe("0.1.170");
  });

  it("honors TV_TEST_REQUIRED_DESKTOP_VERSION exactly when the stamp is absent", () => {
    expect(
      resolveRequiredDesktopVersion("0.1.170", { TV_TEST_REQUIRED_DESKTOP_VERSION: "9.9.9" }, undefined),
    ).toBe("9.9.9");
    expect(
      resolveRequiredDesktopVersion(null, { TV_TEST_REQUIRED_DESKTOP_VERSION: "9.9.9" }, undefined),
    ).toBe("9.9.9");
  });

  it("falls back to the baked constant when the hook is absent or invalid", () => {
    expect(resolveRequiredDesktopVersion("0.1.170", {}, undefined)).toBe("0.1.170");
    expect(
      resolveRequiredDesktopVersion("0.1.170", { TV_TEST_REQUIRED_DESKTOP_VERSION: "nope" }, undefined),
    ).toBe("0.1.170");
    expect(
      resolveRequiredDesktopVersion(null, { TV_TEST_REQUIRED_DESKTOP_VERSION: "" }, undefined),
    ).toBe(null);
  });
});
