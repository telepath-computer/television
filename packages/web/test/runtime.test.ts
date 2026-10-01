// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isElectronMode, resolveAuthToken, resolveDesktopAppVersion, resolveServerURL } from "../src/config.ts";

describe("runtime config", () => {
  it("uses the serverURL query param when present", () => {
    expect(resolveServerURL("?mode=electron&serverURL=http://localhost:32848/channels")).toBe(
      "http://localhost:32848",
    );
  });

  it("falls back to window.location.origin when serverURL is absent", () => {
    expect(resolveServerURL("", "https://television.example.com")).toBe("https://television.example.com");
  });

  it("reads the token query param when present", () => {
    expect(resolveAuthToken("?token=secret-token&serverURL=http://localhost:32848")).toBe("secret-token");
  });

  it("returns null when the token query param is absent", () => {
    expect(resolveAuthToken("?serverURL=http://localhost:32848")).toBeNull();
  });

  it("detects electron mode from mode=electron", () => {
    expect(isElectronMode("?mode=electron&serverURL=http://localhost:32848")).toBe(true);
  });

  it("treats all other modes as browser mode", () => {
    expect(isElectronMode("?serverURL=http://localhost:32848")).toBe(false);
    expect(isElectronMode("?mode=browser")).toBe(false);
    expect(isElectronMode("")).toBe(false);
  });

  it("reads the Electron desktop app version query param", () => {
    expect(resolveDesktopAppVersion("?mode=electron&desktopAppVersion=0.1.170")).toBe("0.1.170");
    expect(resolveDesktopAppVersion("?mode=electron")).toBeNull();
  });
});
