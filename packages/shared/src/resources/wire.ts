// The routes' sub-paths and message framing. They are defined here, not by
// the specs, and are not a public API: the SDK and the CLI are the supported
// clients (specs/arch/resources/index.md#^rs-wire-boundary).
import type { EncodedUpdateEntry, EncodedWriteValue } from "./json-values.ts";
import type {
  AccessLevel,
  JSONValue,
  ResourceBinding,
  ResourceID,
  ResourceRefusalCode,
  ResourceSummary,
  StoreAddress,
} from "./types.ts";

export const ADMIN_ROUTE_PREFIX = "/api/resources/v1";
export const ARTIFACT_ROUTE_PREFIX = "/artifact-resources";

const resourceRoute = (resourceID: ResourceID, action = "") =>
  `${ADMIN_ROUTE_PREFIX}/resources/${encodeURIComponent(resourceID)}${action === "" ? "" : `/${action}`}`;
const artifactRoute = (artifactID: string, action: string) => `${ADMIN_ROUTE_PREFIX}/artifacts/${encodeURIComponent(artifactID)}/${action}`;

/** Administrative routes, relative to the server's origin. */
export const adminRoutes = {
  /** GET, with an optional `artifact` query parameter. */
  list: `${ADMIN_ROUTE_PREFIX}/resources`,
  /** GET. */
  info: (resourceID: ResourceID) => resourceRoute(resourceID),
  describe: (resourceID: ResourceID) => resourceRoute(resourceID, "describe"),
  bind: (resourceID: ResourceID) => resourceRoute(resourceID, "bind"),
  unbind: (resourceID: ResourceID) => resourceRoute(resourceID, "unbind"),
  destroy: (resourceID: ResourceID) => resourceRoute(resourceID, "destroy"),
  /** POST: creates the artifact's share link at a level, or changes its level. */
  share: (artifactID: string) => artifactRoute(artifactID, "share"),
  /** POST: revokes the artifact's share link. */
  unshare: (artifactID: string) => artifactRoute(artifactID, "unshare"),
  /** POST, with the bindings flag on. */
  jsonCreate: `${ADMIN_ROUTE_PREFIX}/json/create`,
  /** GET, with the store's address (`storeQuery`) and a `path` query parameter. */
  jsonGet: `${ADMIN_ROUTE_PREFIX}/json/value`,
  // POST, each naming its store in the body's `store`.
  jsonSet: `${ADMIN_ROUTE_PREFIX}/json/set`,
  jsonUpdate: `${ADMIN_ROUTE_PREFIX}/json/update`,
  jsonPush: `${ADMIN_ROUTE_PREFIX}/json/push`,
  jsonRemove: `${ADMIN_ROUTE_PREFIX}/json/remove`,
} as const;

/** The query parameter that carries each kind of store address. */
const STORE_QUERY_KEYS = { artifactID: "artifact", resourceID: "resourceID" } as const;
const STORE_BODY_KEYS = { artifactID: "artifactID", resourceID: "resourceID" } as const;

/** A store's address as query parameters, for the JSON store's `GET` route. */
export function storeQuery(store: StoreAddress): URLSearchParams {
  return "artifactID" in store
    ? new URLSearchParams({ [STORE_QUERY_KEYS.artifactID]: store.artifactID })
    : new URLSearchParams({ [STORE_QUERY_KEYS.resourceID]: store.resourceID });
}

/**
 * The store address that query parameters or a request body carry, or null
 * unless they carry exactly one address of exactly one kind.
 */
export function parseStoreAddress(fields: Record<string, unknown>, keys: "query" | "body"): StoreAddress | null {
  const names = keys === "query" ? STORE_QUERY_KEYS : STORE_BODY_KEYS;
  const artifactID = fields[names.artifactID];
  const resourceID = fields[names.resourceID];
  if ((artifactID === undefined) === (resourceID === undefined)) return null;
  if (artifactID !== undefined) return typeof artifactID === "string" ? { artifactID } : null;
  return typeof resourceID === "string" ? { resourceID } : null;
}

// Every state-changing administrative route is a POST with a JSON body.
/** At least one of the two is given. */
export interface DescribeRequest { description?: string; usage?: string }
export interface BindRequest { artifactID: string; access: AccessLevel }
export interface UnbindRequest { artifactID: string }
export interface DestroyRequest { force?: boolean }
export interface ShareRequest { access: AccessLevel }
export interface JsonCreateRequest { description: string; usage?: string; value?: JSONValue }
export interface JsonSetRequest { store: StoreAddress; path: string; value: EncodedWriteValue }
export interface JsonUpdateRequest { store: StoreAddress; path: string; entries: EncodedUpdateEntry[] }
export interface JsonPushRequest { store: StoreAddress; path: string; key: string; value: EncodedWriteValue }
export interface JsonRemoveRequest { store: StoreAddress; path: string }

export interface ListResponse { resources: Array<ResourceSummary & { access?: AccessLevel }> }
export interface InfoResponse { resource: ResourceSummary & { bindings: Array<Omit<ResourceBinding, "resourceID">> } }
export interface SummaryResponse { resource: ResourceSummary }
export interface BindResponse { authRequired: boolean }
export interface DestroyResponse { removedBindings: ResourceBinding[] }
/** A share link: its path, `/artifact/<share-id>/`, apart from the server's origins, which a client joins with it. */
export interface ShareResponse { shareID: string; access: AccessLevel; path: string; origins: string[] }

/** The body of every refusal; `bindings` accompanies `still-bound`. */
export interface RefusalBody {
  error: string;
  code: ResourceRefusalCode;
  bindings?: ResourceBinding[];
}
