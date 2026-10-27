import { describe, expect, it } from "vitest";
import { buildRemoteURL, normalizeConnectURL, parseDesktopConnectURL, resolveDesktopAppVersion } from "../src/connect-url.ts";

describe("normalizeConnectURL", () => {
  it("accepts explicit http URLs", () => {
    expect(normalizeConnectURL("http://localhost:32848")).toBe("http://localhost:32848");
  });

  it("accepts explicit https URLs", () => {
    expect(normalizeConnectURL("https://tv.example.com/")).toBe("https://tv.example.com");
  });

  it("rewrites bare host:port to http", () => {
    expect(normalizeConnectURL("localhost:32848")).toBe("http://localhost:32848");
    expect(normalizeConnectURL("127.0.0.1:32848")).toBe("http://127.0.0.1:32848");
  });

  it("rejects invalid and unsupported schemes", () => {
    expect(() => normalizeConnectURL("")).toThrow(/valid http or https/i);
    expect(() => normalizeConnectURL("ftp://example.com")).toThrow(/valid http or https/i);
    expect(() => normalizeConnectURL("not a url!!!")).toThrow(/valid http or https/i);
  });
});

// proofs/arch/desktop/connect-flow.md#^desktop-t-connect-link
// Pure parser boundary: authored links, no mechanism replacements.
it("reads one link as an HTTP origin and its decoded token", () => {
  for (const [link, serverURL, token] of [
    ["http://example.test/path?extra=yes&token=a%2Bb%26c", "http://example.test", "a+b&c"],
    ["https://example.test:8443/deep?token=secret#fragment", "https://example.test:8443", "secret"],
    ["example.test", "http://example.test", null],
    ["localhost:32848/?ignored=yes", "http://localhost:32848", null],
  ]) expect(parseDesktopConnectURL(link!)).toEqual({ serverURL, token });
  for (const link of ["", "not a url!!!", "ftp://example.test", "file:///tmp/example", "mailto:person@example.test"]) {
    expect(() => parseDesktopConnectURL(link)).toThrow(/valid http or https/i);
  }
});

// Contract tests for the shell's desktopAppVersion resolution
// (specs/arch/updates/desktop-upgrade-gate.md ^hook-shell-version). The
// TV_TEST_DESKTOP_APP_VERSION hook IS a declared mock of `app.getVersion()`:
// tests that use it forfeit coverage of the real version path, which the
// unhooked ^t-shell-version-param Electron seam carries
// (test/e2e/version-param.test.ts).
describe("resolveDesktopAppVersion (desktopAppVersion source)", () => {
  it("reports app.getVersion()'s value in normal use", () => {
    expect(resolveDesktopAppVersion("0.1.174", {})).toBe("0.1.174");
  });

  it("requires the compound gate: the hook without TV_TEST_MODE=true is inert", () => {
    expect(resolveDesktopAppVersion("0.1.174", { TV_TEST_DESKTOP_APP_VERSION: "9.9.9" })).toBe("0.1.174");
    expect(
      resolveDesktopAppVersion("0.1.174", { TV_TEST_MODE: "1", TV_TEST_DESKTOP_APP_VERSION: "9.9.9" }),
    ).toBe("0.1.174");
  });

  it("TV_TEST_MODE=true alone changes nothing", () => {
    expect(resolveDesktopAppVersion("0.1.174", { TV_TEST_MODE: "true" })).toBe("0.1.174");
    expect(
      resolveDesktopAppVersion("0.1.174", { TV_TEST_MODE: "true", TV_TEST_DESKTOP_APP_VERSION: "" }),
    ).toBe("0.1.174");
  });

  it("reports the hook value under TV_TEST_MODE=true with the variable set", () => {
    expect(
      resolveDesktopAppVersion("0.1.174", { TV_TEST_MODE: "true", TV_TEST_DESKTOP_APP_VERSION: "9.9.9" }),
    ).toBe("9.9.9");
  });
});

describe("buildRemoteURL", () => {
  it("adds mode=electron, token, and desktop app version query params", () => {
    const url = new URL(buildRemoteURL("http://localhost:32848", "secret", "0.1.170"));
    expect(url.searchParams.get("mode")).toBe("electron");
    expect(url.searchParams.get("token")).toBe("secret");
    expect(url.searchParams.get("desktopAppVersion")).toBe("0.1.170");
    expect(url.protocol).toBe("http:");
    expect(url.host).toBe("localhost:32848");
  });

  it("omits token param when empty", () => {
    const url = new URL(buildRemoteURL("http://localhost:32848", ""));
    expect(url.searchParams.get("mode")).toBe("electron");
    expect(url.searchParams.has("token")).toBe(false);
  });

  it("never produces a localhost: custom scheme for bare host input", () => {
    const normalized = normalizeConnectURL("localhost:32848");
    const remote = buildRemoteURL(normalized, "");
    expect(remote.startsWith("http://localhost:32848")).toBe(true);
    expect(new URL(remote).protocol).toBe("http:");
  });
});
