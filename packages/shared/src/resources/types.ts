/** Generated as artifact IDs are: 26 characters of Crockford's base32, a ULID (specs/arch/resources/index.md#^rs-records). */
export type ResourceID = string;
export type ResourceType = "json";
export type AccessLevel = "read" | "read-write";

export const RESOURCE_TYPES: readonly ResourceType[] = ["json"];
export const ACCESS_LEVELS: readonly AccessLevel[] = ["read", "read-write"];

/** The lower of two levels, as a page's level on a bound store is (specs/arch/resources/index.md#^rs-resolve-id). */
export function lowerAccess(left: AccessLevel, right: AccessLevel): AccessLevel {
  return left === "read" || right === "read" ? "read" : "read-write";
}

/** An artifact's share link as its record carries it (specs/arch/resources/index.md#^rs-artifact-record). */
export interface ArtifactShare {
  id: string;
  access: AccessLevel;
}

/** How the CLI addresses a store: exactly one of the two (specs/arch/resources/index.md#^rs-records). */
export type StoreAddress = { artifactID: string } | { resourceID: ResourceID };

// specs/arch/resources/index.md#^rs-records
export interface ResourceSummary {
  resourceID: ResourceID;
  type: ResourceType;
  /** One line, 1 to 1024 UTF-8 bytes; "" only when the manifest cannot be read. */
  description: string;
  /** Free text, line breaks allowed, at most 16,384 UTF-8 bytes; "" when none was given. */
  usage: string;
  status: "available" | "unavailable";
  /** Present exactly when status is "unavailable". */
  unavailableReason?: string;
  /** ISO 8601; absent only when the manifest cannot be read. */
  createdAt?: string;
  /** Present exactly for an own store: the artifact that owns it, a deleted one included. */
  ownerArtifactID?: string;
}

/**
 * A store an artifact can use, as its page sees it: only what Television
 * generates, never the description or usage an agent wrote
 * (specs/arch/resources/sdk.md, The layer's functions).
 */
export interface ResourceInfo {
  resourceID: ResourceID;
  type: ResourceType;
  /** The page's level on the store. */
  access: AccessLevel;
}

export interface ResourceBinding {
  resourceID: ResourceID;
  artifactID: string;
  access: AccessLevel;
}

/** The description an own store's first write gives it (specs/arch/resources/index.md#^rs-records). */
export const OWN_STORE_DESCRIPTION = "Store owned by an artifact, created at its first write.";

// specs/arch/resources/index.md#^rs-arch-events
export type ResourceEvent =
  /**
   * `paths` lists where the content changed; for a JSON store, the paths the
   * write touched. `artifactID` is an own store's owner, as its manifest
   * records it.
   */
  | { event: "changed"; resourceID: ResourceID; artifactID?: string; paths: string[] }
  | { event: "created"; resource: ResourceSummary }
  | { event: "updated"; resource: ResourceSummary }
  /** `artifactID` is an own store's owner, as its manifest records it. */
  | { event: "destroyed"; resourceID: ResourceID; artifactID?: string }
  | { event: "bound"; resourceID: ResourceID; artifactID: string; access: AccessLevel }
  | { event: "unbound"; resourceID: ResourceID; artifactID: string };

/** What a page receives: no artifact ID, description or usage. A changed event without a resource ID is about the page's own store. */
export type PageEvent =
  | { event: "changed"; resourceID?: ResourceID; paths: string[] }
  | { event: "destroyed"; resourceID: ResourceID }
  /** `access` is the page's level on the store. */
  | { event: "bound"; resourceID: ResourceID; access: AccessLevel }
  | { event: "unbound"; resourceID: ResourceID };

// specs/arch/resources/index.md#Errors
export type ResourceErrorCode =
  | "not-artifact-page"
  | "no-store"
  | "not-enabled"
  | "not-bound"
  | "wrong-type"
  | "read-only"
  | "not-found"
  | "no-artifact"
  | "not-shareable"
  | "not-shared"
  | "tokenless"
  | "access-required"
  | "read-write-unsupported"
  | "owner-binding"
  | "invalid-description"
  | "invalid-usage"
  | "still-bound"
  | "unavailable"
  | "disconnected";

// specs/arch/resources/json-store.md#^js-arch-errors
export type JsonStoreErrorCode = "invalid-path" | "invalid-value" | "too-large" | "max-retries";

export type ResourceRefusalCode = ResourceErrorCode | JsonStoreErrorCode;

export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

/** The value at a path, as reads and subscriptions report it. */
export type JsonReadResult = { exists: true; value: JSONValue } | { exists: false };
