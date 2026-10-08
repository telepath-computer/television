import type { ResourceID, ResourceSummary, ResourceType, StoreAddress } from "@telepath-computer/television-shared/resources";

/**
 * What a resource type supplies behind the one interface the layer calls
 * (specs/arch/resources/index.md#^rs-type-contract). Each type also exposes
 * its operations, classified as reads or writes, and its subscriptions.
 */
export interface ResourceTypeImplementation {
  readonly type: ResourceType;
  /** The type's content file in a store's directory. */
  readonly contentFileName: string;
  /** The content of a store with no value, which has no content file. */
  readonly emptyContent: unknown;
  /** Reads a content file's text: the content, or why the store cannot use it. */
  parseContent(text: string): { content: unknown } | { problem: string };
  /** The content file's text, or null for the content of a store with no value. */
  serializeContent(content: unknown): string | null;
  /** Starts serving a store with this content. */
  open(resourceID: ResourceID, content: unknown): void;
  /**
   * Stops serving a destroyed store: subscriptions made by its resource ID
   * end, and its owner's subscriptions to its own store, which now has no
   * store, hear the content of a store with no value.
   */
  close(resourceID: ResourceID, owner: string | undefined): void;
}

/**
 * A save of new content: the content now current, and, when the save's
 * outcome is uncertain, the refusal to give in place of an acknowledgement
 * once the content has taken effect
 * (specs/arch/resources/index.md#^rs-arch-uncertain-save).
 */
export interface SavedContent {
  content: unknown;
  uncertain: Error | null;
}

/** Whether an operation reads a resource or writes it: `read` access allows only reads. */
export type OperationAccess = "read" | "write";

/** A resource's description and usage, which the layer owns for every type. */
export interface ResourceDetails {
  description: string;
  usage: string;
}

/**
 * The key under which a subscription follows a store: an artifact's own
 * store follows the artifact's pointer, across its first write and a
 * destroy, and any other store its resource ID.
 */
export function subscriptionKey(address: StoreAddress): string {
  return "artifactID" in address ? `artifact:${address.artifactID}` : `resource:${address.resourceID}`;
}

/** What the layer offers a type: everything but the type's own content. */
export interface ResourceTypeHost {
  /**
   * Resolves a store's address for a read, loading the store on first use:
   * its resource ID, or null for an artifact's own store before its first
   * write. Throws `no-artifact`, `no-store`, `not-found`, `wrong-type` or
   * `unavailable` unless the store can be used.
   */
  resolveForRead(address: StoreAddress, type: ResourceType): ResourceID | null;
  /**
   * Resolves a store's address for a write, as `resolveForRead` does, and
   * first completes what its first write has not yet saved: the artifact's
   * pointer, the directory and the manifest (specs/arch/resources/index.md
   * ^rs-first-write). Returns the resource ID whose content the write saves.
   */
  resolveForWrite(address: StoreAddress, type: ResourceType): ResourceID;
  /**
   * Saves new content under the storage rule. When the save's outcome is
   * uncertain and its file reads back valid, returns what the file holds with
   * the refusal to give; when it fails otherwise, throws and nothing changed.
   */
  saveContent(resourceID: ResourceID, content: unknown): SavedContent;
  /** The subscription keys that follow a store: its resource ID's, and its owner's while the owner's pointer stands. */
  followers(resourceID: ResourceID): string[];
  emitChanged(resourceID: ResourceID, paths: string[]): void;
  /** Throws `not-enabled` unless stores can be created explicitly: with the bindings flag on only. */
  requireCreation(): void;
  /** Creates a store of the type from its starting content, with the bindings flag on only. */
  createStore(type: ResourceType, details: ResourceDetails, content: unknown): ResourceSummary;
}
