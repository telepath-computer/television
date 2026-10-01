import { describe, expect, it } from "vitest";
import { resolveBundleVersion } from "../src/version.ts";

// Contract test for the client's bundle-version resolution
// (specs/arch/updates/version-advertisement.md ^t-version-resolution): the
// consumer of the __TV_VERSION__ build define, with the define's value
// substituted as an explicit input — greenlit by the spec, forfeiting
// real-build coverage, which the ^t-web-stamp build seam carries
// (test/repo/build-config-integrity.test.ts).

describe("resolveBundleVersion", () => {
  it("resolves an undefined build constant to 0.0.0 (^web-version-stamp dev-server case)", () => {
    expect(resolveBundleVersion(undefined)).toBe("0.0.0");
  });

  it("resolves an empty stamp to 0.0.0", () => {
    expect(resolveBundleVersion("")).toBe("0.0.0");
  });

  it("returns the stamped version when the build defines one", () => {
    expect(resolveBundleVersion("0.1.174")).toBe("0.1.174");
    expect(resolveBundleVersion("9.9.9")).toBe("9.9.9");
  });

  it("defaults to the module-level stamp, which is undefined under the test runner", () => {
    // Under vitest __TV_VERSION__ is not defined, so the zero-argument call is
    // the dev-server shape: 0.0.0.
    expect(resolveBundleVersion()).toBe("0.0.0");
  });
});
