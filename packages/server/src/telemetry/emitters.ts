import {
  getChannelArtifactIDs,
  type Channel,
  type AppearanceMode,
  type TabPage,
  type ThemeRegistrySnapshot,
} from "@telepath-computer/television-shared";
import type { Artifact } from "@telepath-computer/television-artifact";
import type { TelemetryClientContext } from "./client-meta.ts";
import type {
  ArtifactDeletionCause,
  TelemetryEvent,
  TelemetryEventProperties,
  TelemetryPersonProperties,
  TelemetryVersion,
  ThemeChangeReason,
} from "./types.ts";
import { telemetryVersion, type AuthMode, type LaunchMode } from "./types.ts";
import {
  deriveArtifactProperties,
  deriveBindingProperties,
  deriveChannelPinsProperties,
  derivePageFullScreenChanges,
  derivePageReorderProperties,
  deriveServerConfigProperties,
  deriveThemeProperties,
  normalizeInstalledByAgent,
} from "./derivation.ts";

export type BoundTelemetryCapture = (event: TelemetryEvent, clientContext?: TelemetryClientContext | null) => void;

const MEDIAN_PAIR_DIVISOR = 2;

export interface ServerTelemetryStoreSnapshot {
  readonly storagePath: string;
  listChannels(): Channel[];
  listArtifacts(): Artifact[];
  getActiveThemeName(): string | null;
  getThemeRegistry(): ThemeRegistrySnapshot;
}

export interface ServerStoreTelemetryHooks {
  artifactCreated(artifact: Artifact, clientContext?: TelemetryClientContext | null): void;
  artifactUpdated(artifact: Artifact, clientContext?: TelemetryClientContext | null): void;
  artifactDeleted(artifact: Artifact, deletionCause: ArtifactDeletionCause, clientContext?: TelemetryClientContext | null): void;
  channelCreated(channel: Channel, clientContext?: TelemetryClientContext | null): void;
  channelUpdated(channel: Channel, clientContext?: TelemetryClientContext | null): void;
  channelDeleted(channel: Channel, clientContext?: TelemetryClientContext | null): void;
  channelLayoutChanged(previousLayout: readonly TabPage[], nextLayout: readonly TabPage[], clientContext?: TelemetryClientContext | null): void;
  channelPinsChanged(previousPinnedChannelIds: readonly string[], nextPinnedChannelIds: readonly string[], clientContext?: TelemetryClientContext | null): void;
  appearanceModeChanged(appearanceMode: AppearanceMode, clientContext?: TelemetryClientContext | null): void;
  themeChanged(reason: ThemeChangeReason, clientContext?: TelemetryClientContext | null): void;
}

export type ContentTotalsTelemetryProperties = Pick<
  TelemetryEventProperties,
  "total_screens" | "total_artifacts" | "median_artifacts_per_screen" | "average_artifacts_per_screen"
>;

export function createServerStoreTelemetryHooks(
  store: ServerTelemetryStoreSnapshot,
  capture: BoundTelemetryCapture,
): ServerStoreTelemetryHooks {
  return {
    artifactCreated(artifact, clientContext): void {
      safeEmit(() => {
        const totals = deriveContentTotalsProperties(store);
        capture({
          name: "artifact_created",
          properties: { ...deriveArtifactProperties(artifact), ...totals },
          personProperties: totals,
        }, clientContext);
      });
    },
    artifactUpdated(artifact, clientContext): void {
      safeEmit(() => capture({ name: "artifact_updated", properties: deriveArtifactProperties(artifact) }, clientContext));
    },
    artifactDeleted(artifact, deletionCause, clientContext): void {
      safeEmit(() => {
        const totals = deriveContentTotalsProperties(store);
        capture({
          name: "artifact_deleted",
          properties: {
            ...deriveArtifactProperties(artifact),
            deletion_cause: deletionCause,
            ...totals,
          },
          personProperties: totals,
        }, clientContext);
      });
    },
    channelCreated(_channel, clientContext): void {
      safeEmit(() => {
        const totals = deriveContentTotalsProperties(store);
        capture({ name: "screen_created", properties: totals, personProperties: totals }, clientContext);
      });
    },
    channelUpdated(_channel, clientContext): void {
      safeEmit(() => capture({ name: "screen_updated" }, clientContext));
    },
    channelDeleted(_channel, clientContext): void {
      safeEmit(() => {
        const totals = deriveContentTotalsProperties(store);
        capture({ name: "screen_deleted", properties: totals, personProperties: totals }, clientContext);
      });
    },
    channelLayoutChanged(previousLayout, nextLayout, clientContext): void {
      safeEmit(() => {
        const reorderProperties = derivePageReorderProperties(previousLayout, nextLayout);
        if (reorderProperties) {
          capture({ name: "layout_changed", properties: reorderProperties }, clientContext);
        }
        for (const properties of derivePageFullScreenChanges(previousLayout, nextLayout)) {
          capture({ name: "tab_page_full_screen_changed", properties }, clientContext);
        }
      });
    },
    channelPinsChanged(previousPinnedChannelIds, nextPinnedChannelIds, clientContext): void {
      safeEmit(() => {
        const properties = deriveChannelPinsProperties(
          previousPinnedChannelIds,
          nextPinnedChannelIds,
        );
        if (properties) {
          capture({ name: "channel_pins_changed", properties }, clientContext);
        }
      });
    },
    appearanceModeChanged(appearanceMode, clientContext): void {
      safeEmit(() => capture({
        name: "appearance_mode_changed",
        properties: { appearance_mode: appearanceMode },
      }, clientContext));
    },
    themeChanged(reason, clientContext): void {
      safeEmit(() => {
        capture({
          name: "theme_changed",
          properties: {
            ...deriveThemeProperties({
              activeThemeName: store.getActiveThemeName(),
              themeCount: store.getThemeRegistry().themes.length,
            }),
            theme_change_reason: reason,
          },
        }, clientContext);
      });
    },
  };
}

export function deriveContentTotalsProperties(store: ServerTelemetryStoreSnapshot): ContentTotalsTelemetryProperties {
  const channels = store.listChannels();
  const totalChannels = channels.length;
  const totalArtifacts = store.listArtifacts().length;
  const artifactCounts = channels.map((channel) => getChannelArtifactIDs(channel).length);
  return {
    total_screens: totalChannels,
    total_artifacts: totalArtifacts,
    median_artifacts_per_screen: median(artifactCounts),
    average_artifacts_per_screen: totalChannels === 0 ? 0 : totalArtifacts / totalChannels,
  };
}

export interface ServerTelemetryConfigInput {
  version: TelemetryVersion;
  storagePath: string;
  port: number;
  bindAddresses: readonly string[];
  authMode: AuthMode | "none";
  launchMode: LaunchMode;
  installedByAgent?: string | null;
  defaultStoragePath?: string;
}

export type ServerConfigSnapshotTelemetryProperties = Pick<
  TelemetryEventProperties,
  | "server_version"
  | "auth_mode"
  | "binds_loopback"
  | "binds_all_interfaces"
  | "binds_tailnet"
  | "binds_other_specific"
  | "port"
  | "storage_path"
  | "launch_mode"
  | "installed_by_agent"
>;

export function deriveServerConfigSnapshotProperties(input: ServerTelemetryConfigInput): ServerConfigSnapshotTelemetryProperties {
  return {
    server_version: telemetryVersion(input.version),
    ...deriveServerConfigProperties({
      port: input.port,
      storagePath: input.storagePath,
      authMode: input.authMode,
      launchMode: input.launchMode,
      ...(input.defaultStoragePath === undefined ? {} : { defaultStoragePath: input.defaultStoragePath }),
    }),
    ...deriveBindingProperties(input.bindAddresses),
    ...normalizeInstalledByAgent(input.installedByAgent),
  };
}

export function emitServerBootTelemetry(
  capture: BoundTelemetryCapture,
  events: readonly TelemetryEvent[],
  serverConfig: ServerConfigSnapshotTelemetryProperties,
  telemetryPreference: Pick<TelemetryPersonProperties, "telemetry_opted_out">,
): void {
  safeEmit(() => {
    for (const event of events) {
      if (event.name === "server_started") {
        capture({
          name: "server_started",
          properties: serverConfig,
          personProperties: { ...serverConfig, ...telemetryPreference },
        });
        continue;
      }
      capture(event);
    }
  });
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / MEDIAN_PAIR_DIVISOR);
  if (sorted.length % MEDIAN_PAIR_DIVISOR === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / MEDIAN_PAIR_DIVISOR;
}

function safeEmit(callback: () => void): void {
  try {
    callback();
  } catch {
    // Telemetry emitters must never crash or alter the product path.
  }
}
