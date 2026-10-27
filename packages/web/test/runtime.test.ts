// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isElectronMode, resolveAuthToken, resolveDesktopAppVersion } from "../src/config.ts";

describe("runtime config", () => {
  it("reads the token query param when present", () => {
    expect(resolveAuthToken("?mode=electron&token=secret-token")).toBe("secret-token");
  });

  it("returns null when the token query param is absent", () => {
    expect(resolveAuthToken("?mode=electron")).toBeNull();
  });

  it("detects electron mode from mode=electron", () => {
    expect(isElectronMode("?mode=electron&token=secret-token")).toBe(true);
  });

  it("treats all other modes as browser mode", () => {
    expect(isElectronMode("?token=secret-token")).toBe(false);
    expect(isElectronMode("?mode=browser")).toBe(false);
    expect(isElectronMode("")).toBe(false);
  });

  it("reads the Electron desktop app version query param", () => {
    expect(resolveDesktopAppVersion("?mode=electron&desktopAppVersion=0.1.170")).toBe("0.1.170");
    expect(resolveDesktopAppVersion("?mode=electron")).toBeNull();
  });
});
