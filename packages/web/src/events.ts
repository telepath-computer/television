import { defineEvent } from "@rupertsworld/event-target";
import type { ServerStatusMessage } from "@telepath-computer/television-shared";

/**
 * ServerConnection / ServerConnectionOwner: the channels map changed — a
 * channel was added, renamed, or removed. Consumers that render
 * channel lists (e.g. the picker) subscribe here to re-render.
 *
 * Dispatched by `ServerConnection` when it processes a server-broadcast
 * channel mutation, and re-dispatched by `ServerConnectionOwner`.
 */
export interface ChannelsChangedEvent extends Event {
  type: "channels-changed";
}
export const ChannelsChangedEvent = defineEvent<ChannelsChangedEvent>();

/**
 * ServerConnection / ServerConnectionOwner: the connection had already
 * bootstrapped successfully re-established its `/events` socket. Events
 * broadcast during the outage were lost (the server replays nothing), so
 * consumers that cache server state must refresh from server truth.
 *
 * Deliberately not a `ServerEvent`: the server emitted no mutation. The
 * reconnect-refresh seam attaches here, and future version/timestamp
 * logic can decide at this point which refreshes to skip. Not dispatched
 * on the first successful connect.
 */
export interface ServerReconnectedEvent extends Event {
  type: "server-reconnected";
}
export const ServerReconnectedEvent = defineEvent<ServerReconnectedEvent>();

/**
 * ServerConnection: a `server-status` connection-lifecycle message arrived on
 * the `/events` socket — the connection's first message, re-broadcast when
 * the server's update state changes
 * (specs/arch/updates/version-advertisement.md ^events-version).
 *
 * Deliberately not a `ServerEvent`: it describes the server, not the store.
 * The reload decision and the Electron boot barrier attach here.
 */
export interface ServerStatusEvent extends Event {
  type: "server-status";
  message: ServerStatusMessage;
}
export const ServerStatusEvent = defineEvent<ServerStatusEvent>();

/**
 * ACPClient: the flattened public `status` field changed. Consumers read
 * `client.status` directly after receiving this event.
 */
export interface ACPClientStatusChangedEvent extends Event {
  type: "status-changed";
}
export const ACPClientStatusChangedEvent = defineEvent<ACPClientStatusChangedEvent>();

/**
 * ACPClient: the transcript changed. Consumers read `client.messages`
 * directly after receiving this event.
 */
export interface ACPClientMessagesChangedEvent extends Event {
  type: "messages-changed";
}
export const ACPClientMessagesChangedEvent = defineEvent<ACPClientMessagesChangedEvent>();
