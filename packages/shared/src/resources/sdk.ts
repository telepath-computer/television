// The resource SDK, served to artifact pages at /sdk/v1/resources.js
// (specs/arch/resources/sdk.md). It bundles only first-party resource modules.
import { resourceError } from "./errors.ts";
import {
  deleteValue as deleteValuePlaceholder,
  increment as incrementPlaceholder,
  serverTimestamp as serverTimestampPlaceholder,
  type DeleteValuePlaceholder,
  type ServerValuePlaceholder,
} from "./json-values.ts";
import { pageConnection, requireArtifactPage } from "./sdk-page.ts";
import type { ConnectionStatus } from "./sdk-connection.ts";
import type { AccessLevel, PageEvent, ResourceInfo } from "./types.ts";
import type { Unsubscribe } from "./sdk-json-store.ts";

export type { AccessLevel, JSONValue, PageEvent, ResourceInfo, ResourceSummary } from "./types.ts";
export type { ConnectionStatus } from "./sdk-connection.ts";
export type { Ref, Snapshot, Store, ThenableRef, Unsubscribe } from "./sdk-json-store.ts";
export type { WriteValue } from "./json-values.ts";
export {
  child,
  get,
  getStore,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from "./sdk-json-store.ts";

function unexpectedReply(): Error {
  return resourceError("unavailable", "The server answered a request unexpectedly.");
}

/**
 * Resolves with the page's level on its artifact's store: the level its
 * address carries. Rejects with no-store when the address reaches no artifact
 * that has a store (specs/arch/resources/sdk.md#^sdk-access).
 */
export async function getAccess(): Promise<AccessLevel> {
  const level = await pageConnection().access();
  if (level === null) throw resourceError("no-store", "This page's address reaches no artifact that has a store.");
  return level;
}

/**
 * Calls back with the page's level on its artifact's store once it is known,
 * then with each change, until Unsubscribe is called. The level is null while
 * the page's address reaches no artifact that has a store, as after the share
 * link it was opened through is revoked.
 */
export function onAccessChanged(callback: (access: AccessLevel | null) => void): Unsubscribe {
  return pageConnection().onAccess(callback);
}

/** With the bindings flag on: resolves with the stores this artifact can use, ordered by resource ID. */
export async function listResources(): Promise<ResourceInfo[]> {
  const reply = await pageConnection().request({ type: "list" });
  if (reply.type !== "resources") throw unexpectedReply();
  return [...reply.resources].sort((left, right) => (left.resourceID < right.resourceID ? -1 : left.resourceID > right.resourceID ? 1 : 0));
}

/** With the bindings flag on: resolves with one store this artifact can use; rejects with not-bound when it cannot use it. */
export async function getResourceInfo(resourceID: string): Promise<ResourceInfo> {
  const reply = await pageConnection().request({ type: "info", resourceID: String(resourceID) });
  if (reply.type !== "resource") throw unexpectedReply();
  return reply.resource;
}

/** Calls back with each event the page receives: about its own store without a resource ID, and with the flag on its bound stores. */
export function onResourcesChanged(callback: (event: PageEvent) => void): Unsubscribe {
  return pageConnection().onEvent(callback);
}

/** The connection status now. Opens no connection. */
export function getConnectionStatus(): ConnectionStatus {
  return pageConnection().status;
}

/** Calls back with the connection status as it stands soon after registration, then with each change. */
export function onConnectionStatusChanged(callback: (status: ConnectionStatus) => void): Unsubscribe {
  return pageConnection().onStatus(callback);
}

// The JSON store's placeholders are the shared module's, failing like every SDK function off an artifact page.

export function serverTimestamp(): ServerValuePlaceholder {
  requireArtifactPage();
  return serverTimestampPlaceholder();
}

export function increment(n: number): ServerValuePlaceholder {
  requireArtifactPage();
  return incrementPlaceholder(n);
}

export function deleteValue(): DeleteValuePlaceholder {
  requireArtifactPage();
  return deleteValuePlaceholder();
}
