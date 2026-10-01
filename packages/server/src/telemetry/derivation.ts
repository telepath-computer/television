import { isIP } from "node:net";
import {
  hasTrailingSeparator,
  isHtmlPath,
  isMarkdownPath,
  isTvArtifact,
  type Artifact,
} from "@telepath-computer/television-artifact";
import {
  isPageReorder,
  preservesPageMembership,
  type TabPage,
  type AppearanceMode,
  type InstalledTheme,
} from "@telepath-computer/television-shared";
import {
  BUNDLED_THEME_IDS,
  type BundledThemeID,
} from "../bundled-theme-installer.ts";
import { DEFAULT_SERVER_PORT, getDefaultTelevisionStoragePath } from "../config.ts";
import { AGENT_TYPES, telemetryVersion } from "./types.ts";
import type {
  AgentType,
  AuthMode,
  ChannelPinsChangeType,
  ClientApp,
  LaunchMode,
  TelemetryEventProperties,
  TelemetryVersion,
  ThemeState,
  ThemeSettingsProperties,
} from "./types.ts";

export type ArtifactTelemetryProperties = Pick<
  TelemetryEventProperties,
  "artifact_kind" | "path_kind" | "path_file_type" | "url_host" | "url_is_artifact_proxy"
>;

export function deriveArtifactProperties(artifact: Artifact): ArtifactTelemetryProperties {
  if (artifact.kind === "path") {
    if (hasTrailingSeparator(artifact.path)) {
      return { artifact_kind: "path", path_kind: "folder" };
    }
    return {
      artifact_kind: "path",
      path_kind: "file",
      path_file_type: isHtmlPath(artifact.path) ? "html" : isMarkdownPath(artifact.path) ? "markdown" : "other",
    };
  }

  return {
    artifact_kind: "url",
    url_host: classifyUrlHost(artifact.url),
    url_is_artifact_proxy: isTvArtifact(artifact.url),
  };
}

export interface ThemeTelemetryInput {
  activeThemeName: string | null;
  themeCount: number;
}

export type ThemeTelemetryProperties = Pick<TelemetryEventProperties, "theme_state" | "theme_count">;

const BUNDLED_THEME_ID_SET: ReadonlySet<string> = new Set(BUNDLED_THEME_IDS);

function classifyThemeState(activeThemeName: string | null): ThemeState {
  if (activeThemeName === null) return "none";
  if (BUNDLED_THEME_ID_SET.has(activeThemeName)) return activeThemeName as BundledThemeID;
  return "custom";
}

export function deriveThemeProperties(input: ThemeTelemetryInput): ThemeTelemetryProperties {
  return {
    theme_state: classifyThemeState(input.activeThemeName),
    theme_count: input.themeCount,
  };
}

export interface ThemeSettingsInput {
  activeThemeName: string | null;
  themes: readonly InstalledTheme[];
  themeJavaScriptConsentIds: readonly string[];
  appearanceMode: AppearanceMode;
}

export function deriveThemeSettingsProperties(input: ThemeSettingsInput): ThemeSettingsProperties {
  const theme = input.themes.find((candidate) => candidate.id === input.activeThemeName);
  const mainDeclared = theme?.enableMainJS === true;
  return {
    theme_state: classifyThemeState(input.activeThemeName),
    theme_main_js_declared: mainDeclared,
    theme_main_js_enabled: mainDeclared && input.activeThemeName !== null &&
      input.themeJavaScriptConsentIds.includes(input.activeThemeName),
    theme_iframe_background_enabled: theme?.enableIframeBackgroundJS === true,
    theme_iframe_overlay_enabled: theme?.enableIframeOverlayJS === true,
    appearance_mode: input.appearanceMode,
  };
}

export type AgentTypeTelemetryProperties = { agent_type: AgentType };
export type InstalledByAgentTelemetryProperties = Pick<TelemetryEventProperties, "installed_by_agent">;

const KNOWN_AGENT_TYPES = AGENT_TYPES.filter((agentType) => agentType !== "dot-agents" && agentType !== "interactive-install" && agentType !== "other");
const IPV4_VERSION = 4;
const TAILNET_FIRST_OCTET = 100;
const TAILNET_MIN_SECOND_OCTET = 64;
const TAILNET_MAX_SECOND_OCTET = 127;

export function deriveAgentTypeFromPath(targetPath: string): AgentTypeTelemetryProperties {
  const tokens = pathTokens(targetPath);
  const known = KNOWN_AGENT_TYPES.find((agentType) => tokens.includes(agentType));
  if (known) return { agent_type: known };
  if (targetPath.split(/[\\/]+/).some((part) => part.toLowerCase() === ".agents")) return { agent_type: "dot-agents" };
  return { agent_type: "other" };
}

export function normalizeInstalledByAgent(value: string | undefined | null): InstalledByAgentTelemetryProperties {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length === 0 ? {} : { installed_by_agent: normalized };
}

export interface ServerConfigTelemetryInput {
  port: number;
  storagePath: string;
  authMode: AuthMode | "none";
  launchMode: LaunchMode;
  defaultStoragePath?: string;
}

export type ServerConfigTelemetryProperties = Pick<
  TelemetryEventProperties,
  "port" | "storage_path" | "auth_mode" | "launch_mode"
>;

export function deriveServerConfigProperties(input: ServerConfigTelemetryInput): ServerConfigTelemetryProperties {
  return {
    port: input.port === DEFAULT_SERVER_PORT ? "default" : "custom",
    storage_path: input.storagePath === (input.defaultStoragePath ?? getDefaultTelevisionStoragePath()) ? "default" : "custom",
    auth_mode: input.authMode === "auth" ? "auth" : "no-auth",
    launch_mode: input.launchMode,
  };
}

export type UserAgentTelemetryProperties = Pick<
  TelemetryEventProperties,
  "client_platform" | "browser_vendor" | "browser_major_version"
>;

export interface ClientTelemetryInput {
  clientApp: ClientApp;
  userAgent?: string | null;
  desktopAppVersion?: TelemetryVersion;
}

export type ClientTelemetryProperties = Pick<
  TelemetryEventProperties,
  "client_app" | "client_platform" | "browser_vendor" | "browser_major_version" | "desktop_app_version"
>;

export function deriveUserAgentProperties(userAgent: string | undefined | null): UserAgentTelemetryProperties {
  const ua = userAgent ?? "";
  const browser = parseBrowser(ua);
  return {
    client_platform: parsePlatform(ua),
    browser_vendor: browser.vendor,
    ...(browser.major === undefined ? {} : { browser_major_version: browser.major }),
  };
}

export function deriveClientProperties(input: ClientTelemetryInput): ClientTelemetryProperties {
  return {
    client_app: input.clientApp,
    ...deriveUserAgentProperties(input.userAgent),
    ...(input.desktopAppVersion === undefined ? {} : { desktop_app_version: input.desktopAppVersion }),
  };
}

export type BindingTelemetryProperties = Pick<
  TelemetryEventProperties,
  "binds_loopback" | "binds_all_interfaces" | "binds_tailnet" | "binds_other_specific"
>;

export function deriveBindingProperties(addresses: readonly string[]): BindingTelemetryProperties {
  return {
    binds_loopback: addresses.some(isLoopbackAddress),
    binds_all_interfaces: addresses.includes("0.0.0.0"),
    binds_tailnet: addresses.some(isTailnetIPv4),
    binds_other_specific: addresses.some((address) => !isLoopbackAddress(address) && address !== "0.0.0.0" && !isTailnetIPv4(address)),
  };
}

export type PageReorderTelemetryProperties = { change_type: "tab_reorder" };

export function derivePageReorderProperties(
  previousPages: readonly TabPage[],
  nextPages: readonly TabPage[],
): PageReorderTelemetryProperties | null {
  return isPageReorder(previousPages, nextPages)
    ? { change_type: "tab_reorder" }
    : null;
}

export type PageFullScreenTelemetryProperties = Pick<TelemetryEventProperties, "full_screen">;

export function derivePageFullScreenChanges(
  previousPages: readonly TabPage[],
  nextPages: readonly TabPage[],
): PageFullScreenTelemetryProperties[] {
  if (!preservesPageMembership(previousPages, nextPages)) return [];

  return nextPages.flatMap((nextPage) => {
    const previousPage = previousPages.find((candidate) =>
      haveSameArtifactMembership(candidate, nextPage)
    );
    if (
      previousPage === undefined ||
      previousPage.geometry.full_screen === nextPage.geometry.full_screen
    ) return [];
    return [{ full_screen: nextPage.geometry.full_screen }];
  });
}

export interface ChannelPinsTelemetryProperties {
  pin_change_type: ChannelPinsChangeType;
  pinned_channel_count: number;
}

export function deriveChannelPinsProperties(
  previousPinnedChannelIds: readonly string[],
  nextPinnedChannelIds: readonly string[],
): ChannelPinsTelemetryProperties | null {
  if (sameOrderedValues(previousPinnedChannelIds, nextPinnedChannelIds)) return null;

  const previous = new Set(previousPinnedChannelIds);
  const next = new Set(nextPinnedChannelIds);
  const added = nextPinnedChannelIds.some((channelId) => !previous.has(channelId));
  const removed = previousPinnedChannelIds.some((channelId) => !next.has(channelId));
  const changeType: ChannelPinsChangeType = added && removed
    ? "replace"
    : added
      ? "pin"
      : removed
        ? "unpin"
        : "reorder";
  return {
    pin_change_type: changeType,
    pinned_channel_count: nextPinnedChannelIds.length,
  };
}

export function classifyUrlHost(url: string): "localhost" | "tailnet" | "third-party" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "third-party";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.")) {
    return "localhost";
  }
  if (isTailnetIPv4(hostname)) return "tailnet";
  return "third-party";
}

function haveSameArtifactMembership(left: TabPage, right: TabPage): boolean {
  return sameOrderedValues(left.artifactIds, right.artifactIds);
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pathTokens(targetPath: string): string[] {
  return targetPath.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function parsePlatform(userAgent: string): "windows" | "macos" | "linux" | "ios" | "android" | "other" {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("windows nt")) return "windows";
  if (ua.includes("macintosh") || ua.includes("mac os x")) return "macos";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return "other";
}

function parseBrowser(userAgent: string): { vendor: "chrome" | "safari" | "firefox" | "edge" | "other"; major?: number } {
  const edge = parseMajor(userAgent, /\bEdg\/(\d+)/);
  if (edge !== undefined) return { vendor: "edge", major: edge };

  const firefox = parseMajor(userAgent, /\bFirefox\/(\d+)/);
  if (firefox !== undefined) return { vendor: "firefox", major: firefox };

  const chrome = parseMajor(userAgent, /\b(?:HeadlessChrome|Chrome|CriOS)\/(\d+)/);
  if (chrome !== undefined) return { vendor: "chrome", major: chrome };

  const safari = parseMajor(userAgent, /\bVersion\/(\d+)(?:\.\d+)?[^)]*\bSafari\//);
  if (safari !== undefined) return { vendor: "safari", major: safari };

  return { vendor: "other" };
}

function parseMajor(userAgent: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(userAgent);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isInteger(value) ? value : undefined;
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized === "[::1]" || normalized.startsWith("127.");
}

function isTailnetIPv4(hostname: string): boolean {
  if (isIP(hostname) !== IPV4_VERSION) return false;
  const [a, b] = hostname.split(".").map((part) => Number.parseInt(part, 10));
  return a === TAILNET_FIRST_OCTET && b !== undefined && b >= TAILNET_MIN_SECOND_OCTET && b <= TAILNET_MAX_SECOND_OCTET;
}

/** Classify outgoing analytics only; local lifecycle state retains the full version. */
export function classifyTelemetryVersion(value: string): TelemetryVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return telemetryVersion("0.0.0");
  const [, major, minor, patch, prerelease] = match;
  if (prerelease?.split(".").some((part) => /^0\d+$/.test(part))) {
    return telemetryVersion("0.0.0");
  }
  return telemetryVersion(`${major}.${minor}.${patch}`);
}
