import type { Artifact } from "@telepath-computer/television-artifact";

export const TELEVISION_CLIENT_META_HEADER = "X-Television-Client-Meta";
export const TELEMETRY_ACTIVITY_MESSAGE_TYPE = "telemetry-activity";

export interface ClientTelemetryMeta {
  clientId: string;
  userAgent: string;
  clientApp: "browser" | "desktop";
  desktopAppVersion?: string;
}

export interface TelemetryActivitySignal {
  type: typeof TELEMETRY_ACTIVITY_MESSAGE_TYPE;
  clientId: string;
}

export const TELEMETRY_SIGNAL_MESSAGE_TYPE = "telemetry-signal";

/**
 * The subset of the closed telemetry vocabulary that clients may signal
 * (specs/arch/telemetry/client-signals.md). Firing semantics (when and how
 * often each fires) are owned by the update-notifications or skill-selector
 * feature specs.
 */
export type ClientSignalEventName =
  | "client_autoreloaded"
  | "update_toast_shown"
  | "update_prompt_copy_clicked"
  | "desktop_upgrade_gate_shown"
  | "artifact_skill_prompt_copy_clicked";

/**
 * Client → server over the /events websocket, alongside the activity signal.
 * A lockstep internal contract (arch/updates/index.md
 * ^updates-lockstep-contracts): unknown or malformed messages are dropped,
 * never answered. Property keys and value patterns are validated server-side
 * against the client-signal registry (client-signals.md ^signal-validation);
 * omission of any declared key is allowed.
 */
export interface TelemetryClientSignal {
  type: typeof TELEMETRY_SIGNAL_MESSAGE_TYPE;
  clientId: string;
  event: ClientSignalEventName;
  properties: Record<string, string>;
}

export type TelemetrySuppressionReason = "do-not-track" | "ci" | "development" | "developer-host";
export type TelemetryStatusState = "active" | "opted-out" | "suppressed" | "unavailable";

export interface TelemetryStatus {
  state: TelemetryStatusState;
  reason: TelemetrySuppressionReason | null;
  guidPresent: boolean;
  region: "us";
}

/**
 * Input DTO for artifact creation.
 *
 * Discriminated by `kind`:
 *
 * - `kind: "path"` → external filesystem path pointer via `path`.
 * - `kind: "url"` → external URL pointer via `url`.
 *
 * Artifact ids are minted by the server; callers do not supply them.
 */
export type NewArtifact =
  | {
      kind: "path";
      title: string;
      path: string;
    }
  | {
      kind: "url";
      title: string;
      url: string;
    };

export type CreateArtifactResult = { artifact: Artifact; channelID: string };

/** Response shape for `DELETE /artifacts/:id`. */
export type DeleteArtifactResult =
  | PathArtifactRemovalResult
  | UrlArtifactRemovalResult;

/** Removal result for a path artifact. The target file or directory is never touched. */
export type PathArtifactRemovalResult = {
  outcome: "deleted";
  kind: "path";
  artifactID: string;
  path: string;
};

/** Removal result for a URL-backed artifact. The remote URL is never touched. */
export type UrlArtifactRemovalResult = {
  outcome: "deleted";
  kind: "url";
  artifactID: string;
  url: string;
};

export type ArtifactRemovalResult =
  | PathArtifactRemovalResult
  | UrlArtifactRemovalResult;

export type ChannelRemovalResult = {
  channelID: string;
  metadataPath: string;
  artifactResults: ArtifactRemovalResult[];
};

/** Input DTO for `PATCH /artifacts/:id`. */
export type ArtifactPatch = {
  title?: string;
  path?: string;
  url?: string;
};

/** Input DTO for `PATCH /channels/:id`. */
export type ChannelPatch = Partial<Pick<Channel, "name" | "layout">>;

export type ThemeColorScheme = "light" | "dark" | "light dark";

export interface ThemeManifest {
  name: string;
  version: string;
  colorScheme: ThemeColorScheme;
  authoredForAppVersion?: string;
  enableMainJS?: boolean;
  enableIframeBackgroundJS?: boolean;
  enableIframeOverlayJS?: boolean;
}

export interface InstalledTheme extends ThemeManifest {
  id: string;
}

export interface ThemeValidationError {
  folder: string | null;
  error: string;
}

export interface ThemeRegistrySnapshot {
  themes: InstalledTheme[];
  errors: ThemeValidationError[];
}

export type AppearanceMode = "system" | "light" | "dark";

/** Response shape for `GET /display`. */
export type DisplayState = {
  focusedChannelId: string | null;
  pinnedChannelIds: string[];
  activeThemeName: string | null;
  activeThemeColorScheme: ThemeColorScheme | null;
  appearanceMode: AppearanceMode;
  themeJavaScriptConsentIds: string[];
  acpEnabled: boolean;
};

/** Input DTO for `PATCH /display`. */
export type DisplayPatch = Partial<Pick<
  DisplayState,
  "focusedChannelId" | "pinnedChannelIds" | "activeThemeName" | "appearanceMode" |
    "themeJavaScriptConsentIds"
>>;

/** Response shape for `POST /display/focus`. */
export type FocusResult = {
  channelID: string;
  artifactID: string;
};

export type ArtifactID = string;

export type SinglePageGeometry = {
  kind: "single";
  full_screen: boolean;
};

export type PageGeometry = SinglePageGeometry;

export type PageSize = {
  width: number;
  height: number;
};

export type TabPage = {
  artifactIds: ArtifactID[];
  geometry: PageGeometry;
  size: PageSize;
};

export const DEFAULT_PAGE_GEOMETRY = {
  kind: "single",
  full_screen: false,
} as const satisfies SinglePageGeometry;

// Mirrors specs/ui/app/stage/measures.yml page.initial_* in reference pixels;
// conformance keeps the authored stage values and this shared default equal.
export const DEFAULT_PAGE_SIZE = {
  width: 560,
  height: 740,
} as const satisfies PageSize;

// Version-1 layout types survive only as the server migration's input model.
// Current channel layout uses TabPage[] above.
export type LayoutWidth = number | "auto";
export type LayoutHeight = number | "auto";

export type CardNode = {
  type: "card";
  artifactID: string;
  width: LayoutWidth;
  height: LayoutHeight;
};

export type RowNode = {
  id: string;
  type: "row";
  height: LayoutHeight;
  children: CardNode[];
};

export type StackNode = {
  id: string;
  type: "stack";
  children: Array<CardNode | RowNode>;
};

export type LayoutNode = CardNode | RowNode | StackNode;

// Present iff the channel was created by the onboarding installer. Only the
// installer writes it; public create/update requests ignore the field
// (specs/arch/onboarding/installer.md#^marker-api-readonly).
export interface OnboardingChannelMarker {
  slug: string;
}

export interface Channel {
  id: string;
  name: string;
  layout: TabPage[];
  onboarding?: OnboardingChannelMarker;
}

export type ServerEvent =
  | {
      // Artifact identity came into existence on the owning channel.
      // The full `artifact` payload is included so clients can render the new
      // page without a follow-up fetch.
      type: "artifact-created";
      channelID: string;
      artifact: Artifact;
    }
  | {
      type: "artifact-updated";
      artifact: Artifact;
    }
  | {
      type: "artifact-content-changed";
      artifactID: string;
    }
  | {
      // The artifact's page membership is gone because the artifact was deleted.
      type: "artifact-removed";
      artifactID: string;
      channelID: string;
    }
  | {
      type: "channel-created";
      channel: Channel;
    }
  | {
      type: "channel-updated";
      channel: Channel;
    }
  | {
      type: "channel-removed";
      channelID: string;
    }
  | {
      // The focused channel changed. Persisted server-side; new clients see
      // the current value via `GET /display` when they connect.
      type: "channel-changed";
      channelID: string | null;
    }
  | {
      type: "pinned-channels-changed";
      pinnedChannelIds: string[];
    }
  | {
      type: "theme-changed";
      themeName: string | null;
      activeThemeColorScheme: ThemeColorScheme | null;
      themeJavaScriptConsentIds: string[];
    }
  | {
      type: "appearance-changed";
      appearanceMode: AppearanceMode;
    }
  | {
      // Transient nudge: clients should switch to `channelID` if needed,
      // select the named artifact's page, and play a brief
      // highlight animation. Not persisted; not replayed on connect.
      type: "artifact-focus";
      channelID: string;
      artifactID: string;
    };

// --- Update-notifications lockstep contracts -------------------------------
// Server → client shapes riding the /events websocket alongside the
// ServerEvent broadcasts. Lockstep contracts: they ship with the web bundle
// the same server serves, so they carry no schema versioning and may change
// freely between releases (specs/arch/updates/index.md
// ^updates-lockstep-contracts). ServerStatusMessage is deliberately NOT a
// member of the ServerEvent union — it is a connection-lifecycle message,
// sent point-to-point on connect (plus broadcast on update-state change),
// never replayed, and describes the server rather than the store
// (specs/arch/updates/version-advertisement.md ^events-version).

/** Update-channel state relayed by the server (specs/arch/updates/update-channel.md). */
export interface UpdateState {
  /** Set when the channel's version is strictly newer than the server's; null otherwise. */
  toast: UpdateToast | null;
  /** The channel's desktop upgrade instructions, relayed verbatim when present; null otherwise. */
  desktop: DesktopUpgradeInstructions | null;
}

export interface UpdateToast {
  /** The announced release. */
  version: string;
  markdown: string;
  prompt?: string;
  promptButtonLabel?: string;
}

export interface DesktopUpgradeInstructions {
  upgradeMarkdown: string;
}

/** First message on every /events connection; re-broadcast when update state changes. */
export interface ServerStatusMessage {
  type: "server-status";
  /** The server's release version; "0.0.0" for development builds. */
  version: string;
  /** The desktop release this server requires; null when it advertises none. */
  requiredDesktopVersion: string | null;
  /** Update-channel state, null when no valid channel data applies. */
  update: UpdateState | null;
}

export function getChannelArtifactIDs(channel: Pick<Channel, "layout">): string[] {
  return channel.layout.flatMap((page) => page.artifactIds);
}
