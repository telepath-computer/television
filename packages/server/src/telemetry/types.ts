import type { AppearanceMode } from "@telepath-computer/television-shared";
import {
  BUNDLED_THEME_IDS,
  type BundledThemeID,
} from "../bundled-theme-installer.ts";

export type { BundledThemeID };

const telemetryVersionBrand: unique symbol = Symbol("telemetryVersion");

export type TelemetryVersion = string & { readonly [telemetryVersionBrand]: true };

export function telemetryVersion(value: string): TelemetryVersion {
  return value as TelemetryVersion;
}

export const AUTH_MODES = ["auth", "no-auth"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const DEFAULT_OR_CUSTOM = ["default", "custom"] as const;
export type DefaultOrCustom = (typeof DEFAULT_OR_CUSTOM)[number];

export const LAUNCH_MODES = ["daemon", "cli"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export const CLIENT_APPS = ["browser", "desktop"] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

export const CLIENT_PLATFORMS = ["windows", "macos", "linux", "ios", "android", "other"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export const BROWSER_VENDORS = ["chrome", "safari", "firefox", "edge", "other"] as const;
export type BrowserVendor = (typeof BROWSER_VENDORS)[number];

export const ARTIFACT_KINDS = ["path", "url"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const PATH_KINDS = ["folder", "file"] as const;
export type PathKind = (typeof PATH_KINDS)[number];

export const PATH_FILE_TYPES = ["html", "markdown", "other"] as const;
export type PathFileType = (typeof PATH_FILE_TYPES)[number];

export const URL_HOSTS = ["localhost", "tailnet", "third-party"] as const;
export type UrlHost = (typeof URL_HOSTS)[number];

export const LAYOUT_CHANGE_TYPES = ["tab_reorder"] as const;
export type LayoutChangeType = (typeof LAYOUT_CHANGE_TYPES)[number];

export const CHANNEL_PINS_CHANGE_TYPES = ["pin", "unpin", "reorder", "replace"] as const;
export type ChannelPinsChangeType = (typeof CHANNEL_PINS_CHANGE_TYPES)[number];

export const ARTIFACT_DELETION_CAUSES = ["direct", "channel_deleted"] as const;
export type ArtifactDeletionCause = (typeof ARTIFACT_DELETION_CAUSES)[number];

export const ARTIFACT_SKILLS = ["calendar", "table", "tasks", "markdown"] as const;
export type ArtifactSkill = (typeof ARTIFACT_SKILLS)[number];

export const THEME_STATES = ["none", ...BUNDLED_THEME_IDS, "custom"] as const;
export type ThemeState = (typeof THEME_STATES)[number];

export type ThemeChangeReason = "selection" | "fallback";

export interface ThemeSettingsProperties {
  theme_state: ThemeState;
  theme_main_js_declared: boolean;
  theme_main_js_enabled: boolean;
  theme_iframe_background_enabled: boolean;
  theme_iframe_overlay_enabled: boolean;
  appearance_mode: AppearanceMode;
}

export const AGENT_TYPES = [
  "pi",
  "opencode",
  "claude",
  "codex",
  "hermes",
  "openclaw",
  "cursor",
  "dot-agents",
  "interactive-install",
  "other",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export interface TelemetryEventProperties extends Partial<ThemeSettingsProperties> {
  telemetry_opted_out?: boolean;
  pre_telemetry?: boolean;
  server_version?: TelemetryVersion;
  old_version?: TelemetryVersion;
  new_version?: TelemetryVersion;
  auth_mode?: AuthMode;
  binds_loopback?: boolean;
  binds_all_interfaces?: boolean;
  binds_tailnet?: boolean;
  binds_other_specific?: boolean;
  port?: DefaultOrCustom;
  storage_path?: DefaultOrCustom;
  launch_mode?: LaunchMode;
  installed_by_agent?: string;
  client_app?: ClientApp;
  client_platform?: ClientPlatform;
  browser_vendor?: BrowserVendor;
  browser_major_version?: number;
  desktop_app_version?: TelemetryVersion;
  // Update-notification versions (client-signaled; pattern-validated release
  // triples per specs/arch/telemetry/client-signals.md ^signal-no-ugc — free
  // text cannot ride these fields):
  from_version?: TelemetryVersion;
  to_version?: TelemetryVersion;
  channel_version?: TelemetryVersion;
  required_desktop_version?: TelemetryVersion;
  total_screens?: number;
  total_artifacts?: number;
  median_artifacts_per_screen?: number;
  average_artifacts_per_screen?: number;
  artifact_kind?: ArtifactKind;
  path_kind?: PathKind;
  path_file_type?: PathFileType;
  url_host?: UrlHost;
  url_is_artifact_proxy?: boolean;
  deletion_cause?: ArtifactDeletionCause;
  change_type?: LayoutChangeType;
  pin_change_type?: ChannelPinsChangeType;
  pinned_channel_count?: number;
  full_screen?: boolean;
  artifact_skill?: ArtifactSkill;
  theme_count?: number;
  theme_change_reason?: ThemeChangeReason;
  agent_type?: AgentType;
}

export type TelemetryPersonProperties = TelemetryEventProperties;

type EventWithProperties<Name extends TelemetryEventName, Properties extends TelemetryEventProperties = TelemetryEventProperties> = {
  name: Name;
  properties?: Properties;
  personProperties?: TelemetryPersonProperties;
};

export type TelemetryEvent =
  | EventWithProperties<"server_installed">
  | EventWithProperties<"server_started">
  | EventWithProperties<"server_upgraded">
  | EventWithProperties<"session_activity">
  | EventWithProperties<"artifact_created">
  | EventWithProperties<"artifact_updated">
  | EventWithProperties<"artifact_deleted">
  | EventWithProperties<"screen_created">
  | EventWithProperties<"screen_updated">
  | EventWithProperties<"screen_deleted">
  | EventWithProperties<"layout_changed">
  | EventWithProperties<"channel_pins_changed">
  | EventWithProperties<"tab_page_full_screen_changed">
  | EventWithProperties<"artifact_skill_prompt_copy_clicked">
  | EventWithProperties<"theme_changed">
  | EventWithProperties<"appearance_mode_changed">
  | EventWithProperties<"skill_installed">
  | EventWithProperties<"telemetry_opted_out">
  // Update-notification events, client-signaled (client-signals.md); firing
  // semantics owned by the updates domain (specs/arch/updates/index.md):
  | EventWithProperties<"client_autoreloaded">
  | EventWithProperties<"update_toast_shown">
  | EventWithProperties<"update_prompt_copy_clicked">
  | EventWithProperties<"desktop_upgrade_gate_shown">;

export type TelemetryEventName =
  | "server_installed"
  | "server_started"
  | "server_upgraded"
  | "session_activity"
  | "artifact_created"
  | "artifact_updated"
  | "artifact_deleted"
  | "screen_created"
  | "screen_updated"
  | "screen_deleted"
  | "layout_changed"
  | "channel_pins_changed"
  | "tab_page_full_screen_changed"
  | "artifact_skill_prompt_copy_clicked"
  | "theme_changed"
  | "appearance_mode_changed"
  | "skill_installed"
  | "telemetry_opted_out"
  | "client_autoreloaded"
  | "update_toast_shown"
  | "update_prompt_copy_clicked"
  | "desktop_upgrade_gate_shown";

export interface BuiltTelemetryProperties extends TelemetryEventProperties {
  distinct_id: string;
  $session_id?: string;
  $set?: TelemetryPersonProperties;
}

export interface BuiltTelemetryEvent {
  name: TelemetryEventName;
  distinctId: string;
  properties: BuiltTelemetryProperties;
}
