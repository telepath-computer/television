import path from "node:path";
import { createArtifact } from "@telepath-computer/television-artifact";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type SinglePageGeometry,
  type TabPage,
} from "@telepath-computer/television-shared";
import { describe, expect, it } from "vitest";
import { resolveBindAddresses } from "../bind-addresses.ts";
import { BUNDLED_THEME_IDS } from "../bundled-theme-installer.ts";
import { DEFAULT_SERVER_PORT, getDefaultTelevisionStoragePath } from "../config.ts";
import {
  classifyTelemetryVersion,
  deriveAgentTypeFromPath,
  deriveArtifactProperties,
  deriveBindingProperties,
  deriveChannelPinsProperties,
  deriveClientProperties,
  derivePageFullScreenChanges,
  derivePageReorderProperties,
  deriveServerConfigProperties,
  deriveThemeProperties,
  deriveThemeSettingsProperties,
  deriveUserAgentProperties,
  normalizeInstalledByAgent,
} from "./derivation.ts";
import { telemetryVersion, THEME_STATES } from "./types.ts";

describe("telemetry artifact derivation", () => {
  it.each([
    {
      label: "folder path",
      source: "/Users/alice/secret-project/",
      artifact: createArtifact({ id: "folder", kind: "path", title: "Secret Folder", path: "/Users/alice/secret-project/" }),
      expected: { artifact_kind: "path", path_kind: "folder" },
    },
    {
      label: "html file path",
      source: "/Users/alice/private/index.HTML",
      artifact: createArtifact({ id: "html", kind: "path", title: "Secret HTML", path: "/Users/alice/private/index.HTML" }),
      expected: { artifact_kind: "path", path_kind: "file", path_file_type: "html" },
    },
    {
      label: "markdown file path",
      source: "/Users/alice/private/notes.markdown",
      artifact: createArtifact({ id: "md", kind: "path", title: "Secret Notes", path: "/Users/alice/private/notes.markdown" }),
      expected: { artifact_kind: "path", path_kind: "file", path_file_type: "markdown" },
    },
    {
      label: "other file path",
      source: "/Users/alice/private/data.csv",
      artifact: createArtifact({ id: "other-file", kind: "path", title: "Secret CSV", path: "/Users/alice/private/data.csv" }),
      expected: { artifact_kind: "path", path_kind: "file", path_file_type: "other" },
    },
    {
      label: "artifact proxy URL",
      source: "http://localhost:32848/artifact/01ARZ3NDEKTSV4RRFFQ69G5FAV/",
      artifact: createArtifact({ id: "proxy", kind: "url", title: "Proxy", url: "http://localhost:32848/artifact/01ARZ3NDEKTSV4RRFFQ69G5FAV/" }),
      expected: { artifact_kind: "url", url_host: "localhost", url_is_artifact_proxy: true },
    },
    {
      label: "tailnet artifact proxy URL",
      source: "http://100.100.50.25:32848/artifact/01ARZ3NDEKTSV4RRFFQ69G5FAV/",
      artifact: createArtifact({ id: "tailnet-proxy", kind: "url", title: "Tailnet Proxy", url: "http://100.100.50.25:32848/artifact/01ARZ3NDEKTSV4RRFFQ69G5FAV/" }),
      expected: { artifact_kind: "url", url_host: "tailnet", url_is_artifact_proxy: true },
    },
    {
      label: "non-default-port artifact proxy URL",
      source: "http://127.0.0.1:43123/artifact/01ARZ3NDEKTSV4RRFFQ69G5FAV/",
      artifact: createArtifact({ id: "custom-port-proxy", kind: "url", title: "Custom Port Proxy", url: "http://127.0.0.1:43123/artifact/01ARZ3NDEKTSV4RRFFQ69G5FAV/" }),
      expected: { artifact_kind: "url", url_host: "localhost", url_is_artifact_proxy: true },
    },
    {
      label: "localhost URL",
      source: "http://127.0.0.1:5173/app?secret=alice",
      artifact: createArtifact({ id: "local", kind: "url", title: "Local", url: "http://127.0.0.1:5173/app?secret=alice" }),
      expected: { artifact_kind: "url", url_host: "localhost", url_is_artifact_proxy: false },
    },
    {
      label: "tailnet URL",
      source: "https://100.100.50.25/private",
      artifact: createArtifact({ id: "tailnet", kind: "url", title: "Tailnet", url: "https://100.100.50.25/private" }),
      expected: { artifact_kind: "url", url_host: "tailnet", url_is_artifact_proxy: false },
    },
    {
      label: "third-party URL",
      source: "https://example.com/customer/alice",
      artifact: createArtifact({ id: "third-party", kind: "url", title: "External", url: "https://example.com/customer/alice" }),
      expected: { artifact_kind: "url", url_host: "third-party", url_is_artifact_proxy: false },
    },
  ])("classifies $label without returning source strings", ({ artifact, expected, source }) => {
    const properties = deriveArtifactProperties(artifact);

    expect(properties).toEqual(expected);
    expect(JSON.stringify(properties)).not.toContain(source);
    expect(JSON.stringify(properties)).not.toContain(path.basename(source));
  });
});

describe("telemetry page reorder derivation", () => {
  it.each([
    {
      label: "page reorder",
      previous: [page(["a"]), page(["b", "c"])],
      next: [page(["b", "c"]), page(["a"])],
      expected: { change_type: "tab_reorder" },
    },
    {
      label: "unchanged page order",
      previous: [page(["a"]), page(["b"])],
      next: [page(["a"]), page(["b"])],
      expected: null,
    },
    {
      label: "artifact addition",
      previous: [page(["a"])],
      next: [page(["a"]), page(["b"])],
      expected: null,
    },
    {
      label: "artifact removal",
      previous: [page(["a"]), page(["b"])],
      next: [page(["a"])],
      expected: null,
    },
    {
      label: "full-screen-only change",
      previous: [page(["a"])],
      next: [page(["a"], { kind: "single", full_screen: true })],
      expected: null,
    },
    {
      label: "page-size-only change",
      previous: [page(["a"])],
      next: [{
        ...page(["a"]),
        size: { ...DEFAULT_PAGE_SIZE, width: DEFAULT_PAGE_SIZE.width + 1 },
      }],
      expected: null,
    },
    {
      label: "artifact regrouping",
      previous: [page(["a", "b"]), page(["c"])],
      next: [page(["a"]), page(["b", "c"])],
      expected: null,
    },
  ])("classifies $label", ({ previous, next, expected }) => {
    expect(derivePageReorderProperties(previous, next)).toEqual(expected);
  });
});

describe("telemetry page full-screen derivation", () => {
  it.each([
    {
      label: "one page enters full-screen",
      previous: [page(["a"]), page(["b"])],
      next: [page(["a"], { kind: "single", full_screen: true }), page(["b"])],
      expected: [{ full_screen: true }],
    },
    {
      label: "one page leaves full-screen",
      previous: [page(["a"], { kind: "single", full_screen: true })],
      next: [page(["a"])],
      expected: [{ full_screen: false }],
    },
    {
      label: "several pages change while their order changes",
      previous: [
        page(["a"], { kind: "single", full_screen: true }),
        page(["b"]),
      ],
      next: [
        page(["b"], { kind: "single", full_screen: true }),
        page(["a"]),
      ],
      expected: [{ full_screen: true }, { full_screen: false }],
    },
    {
      label: "presentation is unchanged",
      previous: [page(["a"]), page(["b"], { kind: "single", full_screen: true })],
      next: [page(["a"]), page(["b"], { kind: "single", full_screen: true })],
      expected: [],
    },
    {
      label: "a page is added",
      previous: [page(["a"])],
      next: [page(["a"]), page(["b"], { kind: "single", full_screen: true })],
      expected: [],
    },
    {
      label: "a page is removed",
      previous: [page(["a"]), page(["b"], { kind: "single", full_screen: true })],
      next: [page(["a"])],
      expected: [],
    },
  ])("classifies $label", ({ previous, next, expected }) => {
    expect(derivePageFullScreenChanges(previous, next)).toEqual(expected);
  });
});

describe("telemetry channel pins derivation", () => {
  it.each([
    { label: "pin", previous: ["a"], next: ["a", "b"], expected: { pin_change_type: "pin", pinned_channel_count: 2 } },
    { label: "unpin", previous: ["a", "b"], next: ["b"], expected: { pin_change_type: "unpin", pinned_channel_count: 1 } },
    { label: "reorder", previous: ["a", "b", "c"], next: ["c", "a", "b"], expected: { pin_change_type: "reorder", pinned_channel_count: 3 } },
    { label: "replace", previous: ["a", "b"], next: ["b", "c"], expected: { pin_change_type: "replace", pinned_channel_count: 2 } },
    { label: "batch pin", previous: [], next: ["a", "b"], expected: { pin_change_type: "pin", pinned_channel_count: 2 } },
    { label: "batch unpin", previous: ["a", "b"], next: [], expected: { pin_change_type: "unpin", pinned_channel_count: 0 } },
    { label: "unchanged", previous: ["a", "b"], next: ["a", "b"], expected: null },
  ])("classifies $label", ({ previous, next, expected }) => {
    expect(deriveChannelPinsProperties(previous, next)).toEqual(expected);
  });
});

function page(
  artifactIds: string[],
  geometry: SinglePageGeometry = DEFAULT_PAGE_GEOMETRY,
): TabPage {
  return {
    artifactIds,
    geometry: { ...geometry },
    size: { ...DEFAULT_PAGE_SIZE },
  };
}

describe("telemetry binding derivation", () => {
  it.each([
    {
      label: "default loopback",
      addresses: resolveBindAddresses(),
      expected: { binds_loopback: true, binds_all_interfaces: false, binds_tailnet: false, binds_other_specific: false },
    },
    {
      label: "all interfaces",
      addresses: resolveBindAddresses(["0.0.0.0"]),
      expected: { binds_loopback: false, binds_all_interfaces: true, binds_tailnet: false, binds_other_specific: false },
    },
    {
      label: "tailnet with loopback",
      addresses: resolveBindAddresses(["100.64.12.34"]),
      expected: { binds_loopback: true, binds_all_interfaces: false, binds_tailnet: true, binds_other_specific: false },
    },
    {
      label: "other specific with loopback",
      addresses: resolveBindAddresses(["192.168.1.10"]),
      expected: { binds_loopback: true, binds_all_interfaces: false, binds_tailnet: false, binds_other_specific: true },
    },
    {
      label: "multiple specific bindings",
      addresses: resolveBindAddresses(["100.127.255.255,10.0.0.5"]),
      expected: { binds_loopback: true, binds_all_interfaces: false, binds_tailnet: true, binds_other_specific: true },
    },
    {
      label: "ipv6 loopback classifier support",
      addresses: ["::1"],
      expected: { binds_loopback: true, binds_all_interfaces: false, binds_tailnet: false, binds_other_specific: false },
    },
  ])("classifies $label", ({ addresses, expected }) => {
    expect(deriveBindingProperties(addresses)).toEqual(expected);
  });
});

describe("telemetry user-agent derivation", () => {
  it.each([
    {
      label: "Chrome on Windows",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      expected: { client_platform: "windows", browser_vendor: "chrome", browser_major_version: 123 },
    },
    {
      label: "Headless Chrome on Linux",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/123.0.0.0 Safari/537.36",
      expected: { client_platform: "linux", browser_vendor: "chrome", browser_major_version: 123 },
    },
    {
      label: "Safari on macOS",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      expected: { client_platform: "macos", browser_vendor: "safari", browser_major_version: 17 },
    },
    {
      label: "Firefox on Linux",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
      expected: { client_platform: "linux", browser_vendor: "firefox", browser_major_version: 124 },
    },
    {
      label: "Edge on Windows",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.67",
      expected: { client_platform: "windows", browser_vendor: "edge", browser_major_version: 124 },
    },
    {
      label: "Electron Chromium on macOS",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Television/0.1.170 Chrome/134.0.0.0 Electron/35.0.0 Safari/537.36",
      expected: { client_platform: "macos", browser_vendor: "chrome", browser_major_version: 134 },
    },
    {
      label: "Mobile Safari on iOS",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      expected: { client_platform: "ios", browser_vendor: "safari", browser_major_version: 17 },
    },
    {
      label: "Chrome on Android",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      expected: { client_platform: "android", browser_vendor: "chrome", browser_major_version: 125 },
    },
    {
      label: "unknown UA",
      userAgent: "mystery-client/private-screen-name",
      expected: { client_platform: "other", browser_vendor: "other" },
    },
  ])("classifies $label without emitting the raw UA", ({ userAgent, expected }) => {
    const properties = deriveUserAgentProperties(userAgent);

    expect(properties).toEqual(expected);
    expect(JSON.stringify(properties)).not.toContain(userAgent);
    expect(JSON.stringify(properties)).not.toContain("private-screen-name");
  });

  it("combines client metadata with parsed UA and desktop app version", () => {
    expect(deriveClientProperties({
      clientApp: "desktop",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Electron/35.0.0 Safari/537.36",
      desktopAppVersion: telemetryVersion("0.1.170"),
    })).toEqual({
      client_app: "desktop",
      client_platform: "linux",
      browser_vendor: "chrome",
      browser_major_version: 134,
      desktop_app_version: "0.1.170",
    });
  });
});

describe("telemetry server config derivation", () => {
  it.each([
    {
      label: "default port and storage with auth daemon",
      input: { port: DEFAULT_SERVER_PORT, storagePath: getDefaultTelevisionStoragePath(), authMode: "auth" as const, launchMode: "daemon" as const },
      expected: { port: "default", storage_path: "default", auth_mode: "auth", launch_mode: "daemon" },
    },
    {
      label: "custom port and storage with explicit no-auth CLI",
      input: { port: DEFAULT_SERVER_PORT + 1, storagePath: "/tmp/alice-tv-data", authMode: "no-auth" as const, launchMode: "cli" as const },
      expected: { port: "custom", storage_path: "custom", auth_mode: "no-auth", launch_mode: "cli" },
    },
    {
      label: "internal none auth collapses to no-auth",
      input: { port: DEFAULT_SERVER_PORT, storagePath: getDefaultTelevisionStoragePath(), authMode: "none" as const, launchMode: "cli" as const },
      expected: { port: "default", storage_path: "default", auth_mode: "no-auth", launch_mode: "cli" },
    },
  ])("classifies $label", ({ input, expected }) => {
    expect(deriveServerConfigProperties(input)).toEqual(expected);
  });
});

describe("telemetry agent derivation", () => {
  it.each([
    ["pi", "/Users/alice/.pi/skills"],
    ["opencode", "/Users/alice/.opencode/skills"],
    ["claude", "/Users/alice/.claude/skills"],
    ["codex", "/Users/alice/.codex/skills"],
    ["hermes", "/Users/alice/Library/Application Support/hermes/skills"],
    ["hermes", "/Users/alice/.hermes/skills"],
    ["openclaw", "/Users/alice/.openclaw/skills"],
    ["cursor", "/Users/alice/.cursor/skills"],
  ] as const)("classifies %s skill directory", (agentType, targetPath) => {
    expect(deriveAgentTypeFromPath(targetPath)).toEqual({ agent_type: agentType });
  });

  it("classifies a generic .agents path as dot-agents", () => {
    expect(deriveAgentTypeFromPath(path.join("/Users/alice/project", ".agents", "skills"))).toEqual({ agent_type: "dot-agents" });
  });

  it("classifies unrecognized paths as other", () => {
    expect(deriveAgentTypeFromPath("/Users/alice/custom-skills")).toEqual({ agent_type: "other" });
  });

  it("normalizes open-ended installed-by harness product names", () => {
    for (const name of ["Claude Code", "Novel Harness", "pi", "New Agent Product"]) {
      expect(normalizeInstalledByAgent(`  ${name}  `)).toEqual({ installed_by_agent: name.toLowerCase() });
    }
    expect(normalizeInstalledByAgent(undefined)).toEqual({});
    expect(normalizeInstalledByAgent("  ")).toEqual({});
  });
});

describe("telemetry theme derivation", () => {
  it("publishes the closed null, bundled, and custom vocabulary", () => {
    expect(THEME_STATES).toEqual(["none", ...BUNDLED_THEME_IDS, "custom"]);
  });

  it("classifies active custom themes without returning the theme name", () => {
    const properties = deriveThemeProperties({ activeThemeName: "alice-secret-theme", themeCount: 4 });

    expect(properties).toEqual({ theme_state: "custom", theme_count: 4 });
    expect(JSON.stringify(properties)).not.toContain("alice-secret-theme");
  });

  // proofs/arch/telemetry/derivation.md#^tel-t-theme
  it("classifies a previously bundled theme as custom", () => {
    expect(deriveThemeProperties({ activeThemeName: "solarized", themeCount: 1 })).toEqual({ theme_state: "custom", theme_count: 1 });
  });

  it("classifies the null theme", () => {
    expect(deriveThemeProperties({ activeThemeName: null, themeCount: 0 })).toEqual({ theme_state: "none", theme_count: 0 });
  });

  it.each(BUNDLED_THEME_IDS)("classifies the bundled %s theme ID by membership", (themeID) => {
    expect(deriveThemeProperties({ activeThemeName: themeID, themeCount: 1 })).toEqual({
      theme_state: themeID,
      theme_count: 1,
    });
  });
});

// Contract: proofs/arch/telemetry/derivation.md#^t-theme-settings.
// Authored registry/display fixtures; no mocks. Server attachment is tested separately.
describe("TV-755 theme settings derivation", () => {
  const privateID = "alice-private-theme";
  const otherID = "alice-inactive-theme";
  const flagsOff = {
    theme_main_js_declared: false,
    theme_main_js_enabled: false,
    theme_iframe_background_enabled: false,
    theme_iframe_overlay_enabled: false,
  };
  it.each([
    { label: "None with preserved consent", active: null, declarations: { enableMainJS: true }, consent: [privateID], mode: "system", expected: { ...flagsOff, theme_state: "none" } },
    { label: "absent declarations", active: privateID, declarations: {}, consent: [privateID], mode: "light", expected: { ...flagsOff, theme_state: "custom" } },
    { label: "false declarations", active: privateID, declarations: { enableMainJS: false, enableIframeBackgroundJS: false, enableIframeOverlayJS: false }, consent: [privateID], mode: "dark", expected: { ...flagsOff, theme_state: "custom" } },
    { label: "main declared without active consent", active: privateID, declarations: { enableMainJS: true }, consent: [otherID], mode: "system", expected: { ...flagsOff, theme_state: "custom", theme_main_js_declared: true } },
    { label: "main consented", active: privateID, declarations: { enableMainJS: true }, consent: [privateID], mode: "dark", expected: { ...flagsOff, theme_state: "custom", theme_main_js_declared: true, theme_main_js_enabled: true } },
    { label: "background without main consent", active: privateID, declarations: { enableIframeBackgroundJS: true }, consent: [], mode: "light", expected: { ...flagsOff, theme_state: "custom", theme_iframe_background_enabled: true } },
    { label: "overlay without main consent", active: privateID, declarations: { enableIframeOverlayJS: true }, consent: [], mode: "system", expected: { ...flagsOff, theme_state: "custom", theme_iframe_overlay_enabled: true } },
    { label: "bundled theme with every surface", active: "clouds", declarations: { enableMainJS: true, enableIframeBackgroundJS: true, enableIframeOverlayJS: true }, consent: ["clouds"], mode: "dark", expected: { theme_state: "clouds", theme_main_js_declared: true, theme_main_js_enabled: true, theme_iframe_background_enabled: true, theme_iframe_overlay_enabled: true } },
  ] as const)("classifies $label", ({ active, declarations, consent, mode, expected }) => {
    const settings = deriveThemeSettingsProperties({
      activeThemeName: active,
      themes: [{
        id: active ?? privateID,
        name: "Alice Private Display Name",
        version: "1.0.0",
        colorScheme: "light dark",
        ...declarations,
      }],
      themeJavaScriptConsentIds: [...consent],
      appearanceMode: mode,
    });
    expect(settings).toEqual({ ...expected, appearance_mode: mode });
    for (const privateValue of [privateID, otherID, "Alice Private Display Name", "themeJavaScriptConsentIds"]) {
      expect(JSON.stringify(settings)).not.toContain(privateValue);
    }
  });

  it("reports no enabled JavaScript for a selected ID absent from the registry", () => {
    expect(deriveThemeSettingsProperties({
      activeThemeName: privateID,
      themes: [],
      themeJavaScriptConsentIds: [privateID],
      appearanceMode: "system",
    })).toEqual({ ...flagsOff, theme_state: "custom", appearance_mode: "system" });
  });
});

describe("telemetry derivation no-UGC outputs", () => {
  it("returns only classifications, integers, and versions", () => {
    const sourceStrings = [
      "/Users/alice/private/index.html",
      "index.html",
      "https://example.com/customer/alice?screen=roadmap",
      "alice-secret-theme",
      "Roadmap Screen",
      "mystery-client/private-screen-name",
      "custom-skills",
      "inactive-private-theme",
      "7.8.9-private",
    ];
    const [privatePath, , privateUrl, themeName, , userAgent, customSkillPath] = sourceStrings;
    const customPort = DEFAULT_SERVER_PORT + 1;
    const outputs = [
      deriveArtifactProperties(createArtifact({ id: "ugc-path", kind: "path", title: "Roadmap Screen", path: privatePath! })),
      deriveArtifactProperties(createArtifact({ id: "ugc-url", kind: "url", title: "Roadmap URL", url: privateUrl! })),
      derivePageReorderProperties(
        [page(["artifact-a"]), page(["artifact-b"])],
        [page(["artifact-b"]), page(["artifact-a"])],
      ),
      ...derivePageFullScreenChanges(
        [page(["artifact-a"])],
        [page(["artifact-a"], { kind: "single", full_screen: true })],
      ),
      deriveChannelPinsProperties(["private-channel-a"], ["private-channel-a", "private-channel-b"]),
      deriveBindingProperties(resolveBindAddresses(["100.64.1.2,192.168.1.5"])),
      deriveUserAgentProperties(userAgent),
      deriveClientProperties({ clientApp: "desktop", userAgent, desktopAppVersion: telemetryVersion("0.1.170") }),
      deriveServerConfigProperties({ port: customPort, storagePath: privatePath!, authMode: "none", launchMode: "cli" }),
      deriveThemeProperties({ activeThemeName: themeName!, themeCount: 1 }),
      deriveThemeSettingsProperties({
        activeThemeName: themeName!,
        themes: [{
          id: themeName!,
          name: "Roadmap Screen",
          version: "7.8.9-private",
          colorScheme: "light dark",
          enableMainJS: true,
          enableIframeBackgroundJS: true,
          enableIframeOverlayJS: true,
        }],
        themeJavaScriptConsentIds: [themeName!, "inactive-private-theme"],
        appearanceMode: "dark",
      }),
      deriveAgentTypeFromPath(customSkillPath!),
      normalizeInstalledByAgent("  Claude Code  "),
    ].filter((output): output is Record<string, unknown> => output !== null);

    for (const output of outputs) {
      const serialized = JSON.stringify(output);
      for (const source of sourceStrings) {
        expect(serialized).not.toContain(source);
      }
      for (const [key, value] of Object.entries(output)) {
        expect(isAllowedTelemetryValue(key, value), `${key}=${String(value)} should be a classified telemetry value`).toBe(true);
      }
    }
  });
});

function isAllowedTelemetryValue(key: string, value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
  if (key === "installed_by_agent") return value === "claude code";
  if (key.endsWith("version")) return /^\d+\.\d+\.\d+/.test(value);
  return new Set([
    "path",
    "url",
    "folder",
    "file",
    "html",
    "markdown",
    "other",
    "localhost",
    "tailnet",
    "third-party",
    "tab_reorder",
    "pin",
    "unpin",
    "reorder",
    "replace",
    "auth",
    "no-auth",
    "default",
    "none",
    "light",
    "dark",
    "system",
    ...BUNDLED_THEME_IDS,
    "custom",
    "daemon",
    "cli",
    "browser",
    "desktop",
    "windows",
    "macos",
    "linux",
    "ios",
    "android",
    "chrome",
    "safari",
    "firefox",
    "edge",
    "pi",
    "opencode",
    "claude",
    "codex",
    "hermes",
    "openclaw",
    "cursor",
    "dot-agents",
    "interactive-install",
  ]).has(value);
}

// proofs/arch/telemetry/derivation.md#^t-version-classification
it.each([
  ["1.2.3", "1.2.3"], ["0.0.0", "0.0.0"],
  ["1.2.3-alice.private+host-secret", "1.2.3"], ["1.2.3-0.2+01", "1.2.3"],
  ["1.2.3-01", "0.0.0"], ["01.2.3", "0.0.0"], ["v1.2.3", "0.0.0"],
  [" 1.2.3 ", "0.0.0"], ["1.2.3\n", "0.0.0"], ["1.2.3-", "0.0.0"],
  ["alice@example.test", "0.0.0"], ["/Users/alice", "0.0.0"], ["", "0.0.0"],
])("classifies strict semantic versions without private labels: %s", (input, expected) => {
  expect(classifyTelemetryVersion(input)).toBe(expected);
});
