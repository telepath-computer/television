import { defineEvent } from "@rupertsworld/event-target";
import type { Artifact } from "@telepath-computer/television-artifact";
import type {
  AppearanceMode,
  ServerEvent,
  Channel,
  TabPage,
  ThemeColorScheme,
} from "./types.ts";

type Units = {
  type: "unit";
  x?: number;
  y?: number;
};

/** Generic state change (no payload). */
export interface ChangeEvent extends Event {
  type: "change";
}
export const ChangeEvent = defineEvent<ChangeEvent>();

/** Parsed `/events` WebSocket event from a television server. */
export interface ServerEventMessageEvent extends Event {
  type: "server-event";
  serverURL: string;
  event: ServerEvent;
}
export const ServerEventMessageEvent = defineEvent<ServerEventMessageEvent>();

/** Proposed layout after drag (or similar). */
export interface LayoutMutationEvent extends Event {
  type: "layout-proposal";
  layout: TabPage[];
}
export const LayoutMutationEvent = defineEvent<LayoutMutationEvent>();

/** Horizontal layout scroll position in layout units. */
export interface LayoutScrollEvent extends Event {
  type: "layout-scroll";
  scroll: Units;
}
export const LayoutScrollEvent = defineEvent<LayoutScrollEvent>();

/** Store domain events — emitted by `ServerStore` on every mutation. */
export interface ArtifactCreatedEvent extends Event {
  type: "artifact-created";
  channelID: string;
  artifact: Artifact;
}
export const ArtifactCreatedEvent = defineEvent<ArtifactCreatedEvent>();

export interface ArtifactUpdatedEvent extends Event {
  type: "artifact-updated";
  artifact: Artifact;
}
export const ArtifactUpdatedEvent = defineEvent<ArtifactUpdatedEvent>();

export interface ArtifactRemovedEvent extends Event {
  type: "artifact-removed";
  artifactID: string;
  channelID: string;
}
export const ArtifactRemovedEvent = defineEvent<ArtifactRemovedEvent>();

export interface ArtifactContentChangedEvent extends Event {
  type: "artifact-content-changed";
  artifactID: string;
}
export const ArtifactContentChangedEvent = defineEvent<ArtifactContentChangedEvent>();

export interface ChannelCreatedEvent extends Event {
  type: "channel-created";
  channel: Channel;
}
export const ChannelCreatedEvent = defineEvent<ChannelCreatedEvent>();

export interface ChannelUpdatedEvent extends Event {
  type: "channel-updated";
  channel: Channel;
}
export const ChannelUpdatedEvent = defineEvent<ChannelUpdatedEvent>();

export interface ChannelRemovedEvent extends Event {
  type: "channel-removed";
  channelID: string;
}
export const ChannelRemovedEvent = defineEvent<ChannelRemovedEvent>();

export interface ChannelChangedEvent extends Event {
  type: "channel-changed";
  channelID: string | null;
}
export const ChannelChangedEvent = defineEvent<ChannelChangedEvent>();

export interface PinnedChannelsChangedEvent extends Event {
  type: "pinned-channels-changed";
  pinnedChannelIds: string[];
}
export const PinnedChannelsChangedEvent = defineEvent<PinnedChannelsChangedEvent>();

export interface ArtifactFocusEvent extends Event {
  type: "artifact-focus";
  channelID: string;
  artifactID: string;
}
export const ArtifactFocusEvent = defineEvent<ArtifactFocusEvent>();

export interface ThemeChangedEvent extends Event {
  type: "theme-changed";
  themeName: string | null;
  activeThemeColorScheme: ThemeColorScheme | null;
  themeJavaScriptConsentIds: string[];
}
export const ThemeChangedEvent = defineEvent<ThemeChangedEvent>();

export interface AppearanceChangedEvent extends Event {
  type: "appearance-changed";
  appearanceMode: AppearanceMode;
}
export const AppearanceChangedEvent = defineEvent<AppearanceChangedEvent>();

export type StoreDomainEvent =
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | ArtifactRemovedEvent
  | ArtifactContentChangedEvent
  | ChannelCreatedEvent
  | ChannelUpdatedEvent
  | ChannelRemovedEvent
  | ChannelChangedEvent
  | PinnedChannelsChangedEvent
  | ArtifactFocusEvent
  | ThemeChangedEvent
  | AppearanceChangedEvent;
