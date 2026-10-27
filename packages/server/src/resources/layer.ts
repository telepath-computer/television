import path from "node:path";
import {
  ACCESS_LEVELS,
  OWN_STORE_DESCRIPTION,
  RESOURCE_TYPES,
  isResourceID,
  resourceError,
  validateResourceDescription,
  validateResourceUsage,
  type AccessLevel,
  type ArtifactShare,
  type ResourceBinding,
  type ResourceEvent,
  type ResourceID,
  type ResourceSummary,
  type ResourceType,
  type StoreAddress,
} from "@telepath-computer/television-shared/resources";
import { JsonStoreType } from "./json-store.ts";
import {
  UncertainWriteError,
  createDirectories,
  deleteFile,
  errorMessage,
  isTemporaryFileName,
  nodeResourceStorageOperations,
  removeDirectory,
  rewriteFile,
  type DirectoryEntry,
  type ResourceStorageOperations,
} from "./storage.ts";
import type { ResourceDetails, ResourceTypeHost, ResourceTypeImplementation, SavedContent } from "./type.ts";
import { subscriptionKey } from "./type.ts";

// specs/arch/resources/index.md#^rs-storage
interface StoredManifestV1 {
  version: 1;
  createdAt: string;
  description: string;
  usage: string;
  /** Exactly for an own store. */
  ownerArtifactID?: string;
}

interface StoredBindingsV1 {
  version: 1;
  bindings: ResourceBinding[];
}

/** A store the layer has loaded: it stays in memory until the server stops (specs/arch/resources/index.md#^rs-load). */
interface StoreRecord {
  resourceID: ResourceID;
  type: ResourceType;
  /** Null while the store has no manifest: an interrupted first write, or damage. */
  manifest: StoredManifestV1 | null;
  unavailableReason: string | null;
}

/** What the layer needs from the artifact records, which `ServerStore` owns. */
export interface ArtifactStoreHost {
  artifactExists(artifactID: string): boolean;
  /** Whether an existing artifact has a store (specs/arch/resources/index.md#^rs-has-store). */
  hasStore(artifactID: string): boolean;
  /** The resource ID an artifact's record points to, if it has one. */
  storePointer(artifactID: string): ResourceID | undefined;
  /** The existing artifact whose record points to this resource ID, if any. */
  pointerOwner(resourceID: ResourceID): string | undefined;
  /**
   * Saves an artifact's record with `store` set to `resourceID`, or without
   * it, under the storage rule. Throws when nothing changed. When the save's
   * outcome is uncertain, returns the pointer the record now holds, as read
   * back, with the refusal to give (specs/arch/resources/index.md
   * ^rs-arch-uncertain-save).
   */
  saveStorePointer(artifactID: string, resourceID: ResourceID | undefined): { pointer: ResourceID | undefined; uncertain: Error | null };
  /** Whether an existing artifact can be shared: a path artifact (specs/product/resources/resources.md#^rs-shareable). */
  isShareable(artifactID: string): boolean;
  /** Whether an existing artifact is a Markdown file artifact, which is shared only at read (specs/arch/resources/index.md#^rs-share-change). */
  isMarkdown(artifactID: string): boolean;
  /** An artifact's share link, if it has one. */
  shareOf(artifactID: string): ArtifactShare | undefined;
  /** The existing artifact whose share link has this share ID, if any. */
  shareOwner(shareID: string): string | undefined;
  /** A new share ID, equal to no artifact ID or share ID (specs/arch/resources/index.md#^rs-share-ids). */
  newShareID(): string;
  /** Saves an artifact's share link, or its removal, as `saveStorePointer` saves its pointer. */
  saveShare(artifactID: string, share: ArtifactShare | undefined): { share: ArtifactShare | undefined; uncertain: Error | null };
}

/**
 * A change to what the IDs in pages' addresses reach, for the page
 * connection to act on (specs/arch/resources/index.md#^rs-share-change):
 * a share link's new level, IDs whose connections end because what they
 * reach changed: a revoked share ID, or a deleted artifact's IDs, or an
 * artifact whose pointer to its own store was saved or removed
 * (specs/arch/resources/index.md#^rs-own-store-destroyed).
 */
export type AccessChange =
  | { kind: "level"; id: string; access: AccessLevel }
  | { kind: "ended"; ids: string[] }
  | { kind: "store"; artifactID: string };

/** What an ID in a page's address reaches (specs/arch/resources/index.md#^rs-resolve-id). */
export interface ReachedArtifact {
  artifactID: string;
  level: AccessLevel;
}

export interface ResourceLayerOptions {
  /** The Television home; resources live under `<home>/resources/` and bindings in `<home>/state/`. */
  storagePath: string;
  artifacts: ArtifactStoreHost;
  /** Generates resource IDs, as artifact IDs are generated. */
  generateID: () => string;
  /** Test hook: the file writer's filesystem operations. */
  storage?: ResourceStorageOperations;
}

export type ResourceEventListener = (event: ResourceEvent) => void;

/** A resource's information as `info` reports it: its summary and its bindings, an own store's owner included. */
export type ResourceInfoReport = ResourceSummary & { bindings: Array<Omit<ResourceBinding, "resourceID">> };

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byResourceID(left: { resourceID: string }, right: { resourceID: string }): number {
  return compareStrings(left.resourceID, right.resourceID);
}

function byArtifactID(left: { artifactID: string }, right: { artifactID: string }): number {
  return compareStrings(left.artifactID, right.artifactID);
}

function byBinding(left: ResourceBinding, right: ResourceBinding): number {
  return byResourceID(left, right) || byArtifactID(left, right);
}

function sameBinding(binding: ResourceBinding, resourceID: ResourceID, artifactID: string): boolean {
  return binding.resourceID === resourceID && binding.artifactID === artifactID;
}

function bindingKey(binding: ResourceBinding): string {
  return `${binding.resourceID}\n${binding.artifactID}`;
}

/** The `bound` and `unbound` events that take bindings from `before` to `after`. */
function bindingEvents(before: readonly ResourceBinding[], after: readonly ResourceBinding[]): ResourceEvent[] {
  const previous = new Map(before.map((binding) => [bindingKey(binding), binding]));
  const next = new Map(after.map((binding) => [bindingKey(binding), binding]));
  const changed = [
    ...before.filter((binding) => !next.has(bindingKey(binding))),
    ...after.filter((binding) => previous.get(bindingKey(binding))?.access !== binding.access),
  ].sort(byBinding);
  return changed.map((binding): ResourceEvent =>
    next.get(bindingKey(binding)) === binding
      ? { event: "bound", resourceID: binding.resourceID, artifactID: binding.artifactID, access: binding.access }
      : { event: "unbound", resourceID: binding.resourceID, artifactID: binding.artifactID },
  );
}

/** An ISO 8601 date and time, with seconds and a zone designator. */
const ISO_DATE_TIME = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isISODate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_TIME.exec(value);
  if (!match?.groups || Number.isNaN(Date.parse(value))) return false;
  // Date.parse rolls a day past its month's end into the next month.
  const day = Number(match.groups.day);
  const date = new Date(0);
  date.setUTCFullYear(Number(match.groups.year), Number(match.groups.month) - 1, day);
  return date.getUTCDate() === day;
}

function passes(check: (value: unknown) => void, value: unknown): boolean {
  try {
    check(value);
    return true;
  } catch {
    return false;
  }
}

function notFound(resourceID: string): Error {
  return resourceError("not-found", `Resource not found: ${resourceID}`);
}

function notEnabled(): Error {
  return resourceError("not-enabled", "Creating stores and binding them to artifacts is not enabled on this server.");
}

/**
 * The refusal of a change whose save's outcome is uncertain
 * (specs/arch/resources/index.md#^rs-arch-uncertain-save), marked so that a
 * page's refusal can say its outcome is unknown without its message.
 */
export function unknownOutcome(change: string, error: unknown): Error {
  return Object.assign(resourceError("unavailable", `Could not confirm ${change}, so its outcome is unknown: ${errorMessage(error)}.`), { outcomeUnknown: true });
}

/** Whether a refusal is of a change whose outcome is unknown. */
export function isUnknownOutcome(error: unknown): boolean {
  return error instanceof Error && (error as { outcomeUnknown?: unknown }).outcomeUnknown === true;
}

/** A file's text, or null when it does not exist. */
function readIfExists(storage: ResourceStorageOperations, filePath: string): string | null {
  try {
    return storage.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The fields of each stored file's version 1 format. A file with any other
 * field is not valid, at its top level or within a binding, and the server
 * writes only these (specs/arch/resources/index.md#^rs-file-formats).
 */
const MANIFEST_FIELDS: readonly string[] = ["version", "createdAt", "description", "usage", "ownerArtifactID"];
const MANIFEST_REQUIRED_FIELDS: readonly string[] = ["version", "createdAt", "description", "usage"];
const STORED_BINDINGS_FIELDS: readonly string[] = ["version", "bindings"];
const BINDING_FIELDS: readonly string[] = ["resourceID", "artifactID", "access"];

function hasExactly(record: object, fields: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

/** A manifest's text parsed and checked against its version's format, or null when it is not valid. */
function parseManifest(text: string): StoredManifestV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const manifest = parsed as Record<string, unknown>;
  const keys = Object.keys(manifest);
  if (!MANIFEST_REQUIRED_FIELDS.every((field) => keys.includes(field)) || !keys.every((key) => MANIFEST_FIELDS.includes(key))) return null;
  if (
    manifest.version !== 1 ||
    !isISODate(manifest.createdAt) ||
    !passes(validateResourceDescription, manifest.description) ||
    !passes(validateResourceUsage, manifest.usage) ||
    (Object.hasOwn(manifest, "ownerArtifactID") && (typeof manifest.ownerArtifactID !== "string" || manifest.ownerArtifactID.length === 0))
  ) {
    return null;
  }
  return parsed as StoredManifestV1;
}

function serializeManifest(manifest: StoredManifestV1): string {
  const { version, createdAt, description, usage, ownerArtifactID } = manifest;
  return JSON.stringify({ version, createdAt, description, usage, ...(ownerArtifactID === undefined ? {} : { ownerArtifactID }) });
}

function parseStoredBindings(text: string): ResourceBinding[] {
  const parsed = JSON.parse(text) as Partial<StoredBindingsV1>;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !hasExactly(parsed, STORED_BINDINGS_FIELDS) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.bindings)
  ) {
    throw new Error("it is not a version 1 bindings file");
  }
  const seen = new Set<string>();
  return parsed.bindings.map((binding: unknown) => {
    const record = binding as Record<string, unknown>;
    if (
      typeof record !== "object" ||
      record === null ||
      !hasExactly(record, BINDING_FIELDS) ||
      !isResourceID(record.resourceID) ||
      typeof record.artifactID !== "string" ||
      record.artifactID.length === 0 ||
      !ACCESS_LEVELS.includes(record.access as AccessLevel)
    ) {
      throw new Error("it holds a malformed binding");
    }
    const key = `${record.resourceID}\n${record.artifactID}`;
    if (seen.has(key)) throw new Error("it holds two bindings for one store and artifact");
    seen.add(key);
    return { resourceID: record.resourceID, artifactID: record.artifactID, access: record.access as AccessLevel };
  });
}

/**
 * The resource layer: stores by resource ID, their manifests and content,
 * artifacts' own stores through their records' pointers, loading on first
 * use, bindings behind the bindings flag, destruction, events and the types'
 * shared rules (specs/arch/resources/index.md). Every change runs to
 * completion synchronously and is reported only after its files are durably
 * written.
 */
export class ResourceLayer {
  readonly json: JsonStoreType;
  private readonly storagePath: string;
  private readonly artifacts: ArtifactStoreHost;
  private readonly generateID: () => string;
  private readonly storage: ResourceStorageOperations;
  private readonly types: Map<ResourceType, ResourceTypeImplementation>;
  private readonly stores = new Map<ResourceID, StoreRecord>();
  /**
   * Stores whose destroy has taken effect while some of their files remain:
   * every operation on them but a destroy is refused with `not-found`, and a
   * restart forgets them (specs/arch/resources/index.md#^rs-destroy-order).
   */
  private readonly destroyed = new Set<ResourceID>();
  private readonly listeners = new Set<ResourceEventListener>();
  private readonly accessListeners = new Set<(change: AccessChange) => void>();
  private loaded = false;
  /** The bindings flag, as `Server` passes it (specs/arch/resources/index.md#^rs-flag-constant). */
  private bindingsEnabled = false;
  /** The explicit bindings, read from the bindings file with the flag on. */
  private bindings: ResourceBinding[] = [];
  /** Why binding requests are refused: an unreadable bindings file. */
  private bindingsProblem: string | null = null;
  /** Whether the bindings file may hold bindings the layer has dropped, since rewriting it failed. */
  private bindingsFileStale = false;

  constructor(options: ResourceLayerOptions) {
    this.storagePath = options.storagePath;
    this.artifacts = options.artifacts;
    this.generateID = options.generateID;
    this.storage = options.storage ?? nodeResourceStorageOperations;
    const host: ResourceTypeHost = {
      resolveForRead: (address, type) => this.resolveForRead(address, type),
      resolveForWrite: (address, type) => this.resolveForWrite(address, type),
      saveContent: (resourceID, content) => this.saveContent(resourceID, content),
      followers: (resourceID) => this.followers(resourceID),
      emitChanged: (resourceID, paths) => this.emitChanged(resourceID, paths),
      requireCreation: () => {
        this.requireLoaded();
        if (!this.bindingsEnabled) throw notEnabled();
      },
      createStore: (type, details, content) => this.createStore(type, details, content),
    };
    this.json = new JsonStoreType(host);
    this.types = new Map<ResourceType, ResourceTypeImplementation>([["json", this.json]]);
  }

  // --- Startup (specs/arch/resources/index.md#^rs-startup) ---

  /**
   * Readies the layer at bootstrap step 2. It reads no manifest and no
   * content: stores load when first used. Leftover temporary files of the
   * bindings file are removed.
   */
  load(): void {
    const stateDir = path.dirname(this.bindingsPath);
    let entries: string[] = [];
    try {
      if (this.storage.exists(stateDir)) entries = this.storage.readDirectory(stateDir).map((entry) => entry.name);
    } catch (error) {
      console.warn(`Could not look for leftover temporary files in ${stateDir}: ${errorMessage(error)}`);
    }
    for (const entry of entries) {
      if (isTemporaryFileName(entry) && entry.startsWith(`.${path.basename(this.bindingsPath)}.`)) {
        try {
          this.storage.deleteFile(path.join(stateDir, entry));
        } catch (error) {
          console.warn(`Could not remove the leftover temporary file ${path.join(stateDir, entry)}: ${errorMessage(error)}`);
        }
      }
    }
    this.loaded = true;
  }

  /**
   * Turns the bindings flag on, before the server accepts connections, and
   * reads the bindings file, discarding bindings whose artifact or store
   * directory no longer exists.
   */
  enableBindings(): void {
    this.bindingsEnabled = true;
    let stored: ResourceBinding[] = [];
    try {
      const text = readIfExists(this.storage, this.bindingsPath);
      if (text !== null) stored = parseStoredBindings(text);
    } catch (error) {
      // Left exactly as it is: starting with no bindings would lose them all at the next rewrite.
      this.bindingsProblem = `The resource bindings file ${this.bindingsPath} cannot be read: ${errorMessage(error)}`;
      console.warn(`${this.bindingsProblem}. Bindings are unavailable until it is repaired and the server restarts.`);
      return;
    }
    const kept = stored.filter(
      (binding) =>
        this.artifacts.artifactExists(binding.artifactID) &&
        this.artifacts.pointerOwner(binding.resourceID) !== binding.artifactID &&
        !this.storeDirectoryAbsent(binding.resourceID),
    );
    this.bindings = kept;
    if (kept.length !== stored.length) {
      try {
        this.writeBindings(kept);
      } catch (error) {
        this.bindingsFileStale = true;
        console.warn(`Could not discard bindings to missing artifacts or stores: ${errorMessage(error)}`);
      }
    }
  }

  // --- Reads ---

  /**
   * Every store, ordered by resource ID, loading each as a first use does
   * (specs/arch/resources/index.md#^rs-list); or, for an artifact, the stores
   * it can use, its own included once written, each with its level.
   */
  list(input: { artifactID?: string } = {}): Array<ResourceSummary & { access?: AccessLevel }> {
    this.requireLoaded();
    if (input.artifactID === undefined) {
      const found: StoreRecord[] = [];
      for (const type of RESOURCE_TYPES) {
        if (!this.types.has(type)) continue;
        const directory = path.join(this.storagePath, "resources", type);
        let entries: DirectoryEntry[];
        try {
          if (!this.storage.exists(directory)) continue;
          entries = this.storage.readDirectory(directory);
        } catch (error) {
          throw resourceError("unavailable", `The stores in ${directory} cannot be listed: ${errorMessage(error)}`);
        }
        for (const entry of entries) {
          if (!entry.isDirectory || !isResourceID(entry.name)) continue;
          const record = this.findStore(entry.name);
          if (record !== null) found.push(record);
        }
      }
      return found.map((record) => this.summary(record)).sort(byResourceID);
    }
    const artifactID = input.artifactID;
    this.requireArtifact(artifactID);
    return this.artifactBindings(artifactID)
      .flatMap((binding) => {
        const record = this.findStore(binding.resourceID);
        return record === null ? [] : [{ ...this.summary(record), access: binding.access }];
      })
      .sort(byResourceID);
  }

  info(resourceID: ResourceID): ResourceInfoReport {
    this.requireLoaded();
    const record = this.requireStore(resourceID);
    return {
      ...this.summary(record),
      bindings: this.bindingsOf(resourceID).map(({ artifactID, access }) => ({ artifactID, access })),
    };
  }

  /**
   * The stores an artifact can use: its own, at `read-write`, while its
   * pointer stands, and with the flag on the stores it is bound to
   * explicitly (specs/arch/resources/index.md#^rs-own-store-binding).
   */
  artifactBindings(artifactID: string): ResourceBinding[] {
    const pointer = this.artifacts.storePointer(artifactID);
    const own: ResourceBinding[] = pointer === undefined ? [] : [{ resourceID: pointer, artifactID, access: "read-write" }];
    return [...own, ...this.explicitBindings().filter((binding) => binding.artifactID === artifactID)].sort(byResourceID);
  }

  /** Whether the bindings flag is on. */
  get bindingsFlag(): boolean {
    return this.bindingsEnabled;
  }

  /** Whether pages can use stores by resource ID: the flag is on and the bindings file could be read. */
  get storesByResourceID(): boolean {
    return this.bindingsEnabled && this.bindingsProblem === null;
  }

  onEvent(listener: ResourceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Calls the listener with each change to what pages' IDs reach, once it is saved. */
  onAccessChange(listener: (change: AccessChange) => void): () => void {
    this.accessListeners.add(listener);
    return () => this.accessListeners.delete(listener);
  }

  // --- Pages (specs/arch/resources/index.md#The page connection) ---

  /**
   * What an ID in a page's address reaches: an artifact ID its artifact at
   * `read-write`, a share ID its artifact at its link's level, and any other
   * ID nothing (specs/arch/resources/index.md#^rs-resolve-id).
   */
  resolveID(id: string): ReachedArtifact | null {
    if (this.artifacts.artifactExists(id)) return { artifactID: id, level: "read-write" };
    const artifactID = this.artifacts.shareOwner(id);
    if (artifactID === undefined) return null;
    const share = this.artifacts.shareOf(artifactID);
    return share?.id === id ? { artifactID, level: share.access } : null;
  }

  /** Whether an artifact has a store that a page reaches without a resource ID (specs/arch/resources/index.md#^rs-has-store). */
  hasOwnStore(artifactID: string): boolean {
    return this.artifacts.artifactExists(artifactID) && this.artifacts.hasStore(artifactID);
  }

  /** The resource ID of an artifact's own store, once its first write has saved the pointer. */
  ownStoreOf(artifactID: string): ResourceID | undefined {
    return this.artifacts.storePointer(artifactID);
  }

  /** An artifact's explicit bindings, ordered by resource ID: none while the flag is off or the bindings file cannot be read. */
  explicitBindingsOf(artifactID: string): ResourceBinding[] {
    return this.explicitBindings().filter((binding) => binding.artifactID === artifactID).sort(byResourceID);
  }

  /**
   * Throws `not-enabled` while the flag is off, and `unavailable` while the
   * bindings file cannot be read: a page's operations on stores by resource
   * ID need both.
   */
  requireStoresByResourceID(): void {
    this.requireBindings();
  }

  /** The type of a store an artifact is bound to. */
  storeType(resourceID: ResourceID): ResourceType {
    return this.findStore(resourceID)?.type ?? "json";
  }

  // --- Share links (specs/arch/resources/index.md#^rs-share-change) ---

  /**
   * Creates the artifact's share link at this level, or changes its level.
   * Sharing at the level the link has changes nothing. Only once the record
   * is saved does the change take effect and reach open pages.
   */
  /**
   * Creates the artifact's share link at `access`, or changes its level. A
   * request without a level shares at `read`, and is refused while the link
   * is `read-write`, so that it never changes a link's level.
   */
  share(artifactID: string, requested: AccessLevel | undefined, options: { authRequired: boolean }): { shareID: string; access: AccessLevel } {
    this.requireLoaded();
    this.requireArtifact(artifactID);
    if (!this.artifacts.isShareable(artifactID)) {
      throw resourceError("not-shareable", `Artifact ${artifactID} cannot be shared: only artifacts this server serves from its own files can be shared.`);
    }
    if (!options.authRequired) {
      throw resourceError("tokenless", "Sharing an artifact needs the server's auth token, and this server runs without one.");
    }
    // A shared Markdown page is a static rendered page, which no one can edit
    // through the link; whether an artifact has a store decides nothing
    // (specs/arch/resources/index.md#^rs-share-change).
    if (requested === "read-write" && this.artifacts.isMarkdown(artifactID)) {
      throw resourceError(
        "read-write-unsupported",
        `Read-write sharing is not supported for artifact ${artifactID}, a Markdown file: its shared page is a static rendered page that no one can edit through the link. Pass --access read to share it read-only.`,
      );
    }
    const current = this.artifacts.shareOf(artifactID);
    if (requested === undefined && current?.access === "read-write") {
      throw resourceError(
        "access-required",
        `Artifact ${artifactID} already has a read-write share link. Pass --access read-write to keep it, or --access read to make it read-only.`,
      );
    }
    const access = requested ?? "read";
    if (current?.access === access) return { shareID: current.id, access };
    const saved = this.artifacts.saveShare(artifactID, { id: current?.id ?? this.artifacts.newShareID(), access });
    this.shareChanged(current, saved.share);
    if (saved.uncertain !== null) throw saved.uncertain;
    return { shareID: saved.share!.id, access: saved.share!.access };
  }

  /** Revokes the artifact's share link, closing the pages opened through it once the record is saved. */
  unshare(artifactID: string): void {
    this.requireLoaded();
    this.requireArtifact(artifactID);
    const current = this.artifacts.shareOf(artifactID);
    if (current === undefined) throw resourceError("not-shared", `Artifact ${artifactID} is not shared.`);
    const saved = this.artifacts.saveShare(artifactID, undefined);
    this.shareChanged(current, saved.share);
    if (saved.uncertain !== null) throw saved.uncertain;
  }

  /**
   * Ends what a deleted artifact's IDs reached: its explicit bindings, with
   * `unbound` for each, and the page connections opened under its ID or its
   * share ID (specs/arch/resources/index.md#^rs-artifact-delete). Never throws.
   */
  artifactDeleted(artifactID: string, shareID: string | undefined): void {
    this.removeArtifactBindings(artifactID);
    this.emitAccess({ kind: "ended", ids: shareID === undefined ? [artifactID] : [artifactID, shareID] });
  }

  /** Throws `unavailable` until the layer is loaded, which only a serving boot does. */
  requireLoaded(): void {
    if (!this.loaded) throw resourceError("unavailable", "The resource layer is not loaded.");
  }

  // --- Changes ---

  /** Changes the description, the usage or both; at least one is given. */
  describe(resourceID: ResourceID, change: { description?: string; usage?: string }): ResourceSummary {
    this.requireLoaded();
    if (change.description !== undefined) validateResourceDescription(change.description);
    if (change.usage !== undefined) validateResourceUsage(change.usage);
    const record = this.requireStore(resourceID);
    this.requireUsable(record);
    const base = record.manifest ?? this.newManifest(this.artifacts.pointerOwner(resourceID));
    const parts = [change.description === undefined ? null : "description", change.usage === undefined ? null : "usage"].filter((part) => part !== null);
    const label = `changing the ${parts.join(" and ")} of resource ${resourceID}`;
    if (record.manifest === null) this.createStoreDirectory(record, label);
    const uncertain = this.saveManifest(record, {
      ...base,
      description: change.description ?? base.description,
      usage: change.usage ?? base.usage,
    }, label);
    const summary = this.summary(record);
    this.emit({ event: "updated", resource: summary });
    if (uncertain !== null) throw uncertain;
    return summary;
  }

  /** With the flag on: binds an artifact to a store at a level, or changes its level. */
  bind(resourceID: ResourceID, artifactID: string, access: AccessLevel): void {
    this.requireBindings();
    if (!ACCESS_LEVELS.includes(access)) throw new Error(`Unknown access level: ${String(access)}`);
    this.requireStore(resourceID);
    this.requireArtifact(artifactID);
    this.refuseOwnerBinding(resourceID, artifactID);
    const existing = this.bindings.find((binding) => sameBinding(binding, resourceID, artifactID));
    if (existing?.access === access) return;
    const next = [...this.bindings.filter((binding) => !sameBinding(binding, resourceID, artifactID)), { resourceID, artifactID, access }];
    const saved = this.saveBindings(next, `binding artifact ${artifactID} to resource ${resourceID}`);
    this.adoptBindings(saved.bindings);
    if (saved.uncertain !== null) throw saved.uncertain;
  }

  /** With the flag on: removes an artifact's binding to a store. */
  unbind(resourceID: ResourceID, artifactID: string): void {
    this.requireBindings();
    this.requireStore(resourceID);
    this.refuseOwnerBinding(resourceID, artifactID);
    if (!this.bindings.some((binding) => sameBinding(binding, resourceID, artifactID))) {
      throw resourceError("not-bound", `Artifact ${artifactID} is not bound to resource ${resourceID}.`);
    }
    const next = this.bindings.filter((binding) => !sameBinding(binding, resourceID, artifactID));
    const saved = this.saveBindings(next, `unbinding artifact ${artifactID} from resource ${resourceID}`);
    this.adoptBindings(saved.bindings);
    if (saved.uncertain !== null) throw saved.uncertain;
  }

  /**
   * Destroys a store, whatever the flag: first its owner's pointer, then
   * with the flag on its bindings, then its files and directory. The destroy
   * takes effect with its first step that is saved: from then on the store
   * is destroyed and `destroyed` is emitted, even when a later step fails,
   * which leaves an incomplete deletion that a retried destroy finishes
   * (specs/arch/resources/index.md#^rs-destroy-order).
   */
  destroy(resourceID: ResourceID, options: { force?: boolean } = {}): ResourceBinding[] {
    this.requireLoaded();
    if (this.destroyed.has(resourceID)) {
      this.finishDeletion(resourceID, this.storeDirectory("json", resourceID));
      return [];
    }
    const record = this.requireStore(resourceID);
    if (this.bindingsEnabled && this.bindingsProblem !== null) throw resourceError("unavailable", this.bindingsProblem);
    const bound = this.bindingsOf(resourceID).map(({ artifactID, access }) => ({ resourceID, artifactID, access }));
    if (bound.length > 0 && options.force !== true) {
      throw Object.assign(
        resourceError(
          "still-bound",
          `Resource ${resourceID} is still bound to ${bound.map((binding) => `${binding.artifactID} (${binding.access})`).join(", ")}. --force destroys the resource and removes those bindings.`,
        ),
        { bindings: bound },
      );
    }
    const change = `destroying resource ${resourceID}`;
    const owner = this.artifacts.pointerOwner(resourceID);
    const manifestOwner = record.manifest?.ownerArtifactID ?? owner;
    const hadExplicitBindings = this.explicitBindings().some((binding) => binding.resourceID === resourceID);
    let tookEffect = false;
    const takeEffect = () => {
      if (tookEffect) return;
      tookEffect = true;
      this.destroyed.add(resourceID);
      this.stores.delete(resourceID);
      const explicit = this.bindings.filter((binding) => binding.resourceID === resourceID);
      if (explicit.length > 0) {
        this.bindings = this.bindings.filter((binding) => binding.resourceID !== resourceID);
        this.bindingsFileStale = true;
      }
      this.types.get(record.type)!.close(resourceID, owner);
      // The owner's pointer was removed first, when there is one.
      if (owner !== undefined) this.emitAccess({ kind: "store", artifactID: owner });
      this.emit({ event: "destroyed", resourceID, ...(manifestOwner === undefined ? {} : { artifactID: manifestOwner }) });
    };

    // The owner's pointer first, so a crash never leaves a pointer to a destroyed store.
    if (owner !== undefined) {
      const saved = this.artifacts.saveStorePointer(owner, undefined);
      if (saved.pointer === resourceID) throw saved.uncertain ?? unknownOutcome(change, "the pointer was not removed");
      takeEffect();
      if (saved.uncertain !== null) throw saved.uncertain;
    }
    // Then the bindings, with the flag on.
    if (hadExplicitBindings) {
      const next = this.bindings.filter((binding) => binding.resourceID !== resourceID);
      try {
        this.writeBindings(next);
      } catch (error) {
        if (!(error instanceof UncertainWriteError)) {
          if (!tookEffect) throw resourceError("unavailable", `Could not remove the bindings of resource ${resourceID}: ${errorMessage(error)}`);
          throw this.incompleteDeletion(resourceID, error);
        }
        // When this is the destroy's first step, the file read back says whether it took effect.
        if (!tookEffect) {
          const read = this.readBackBindings();
          if (read === null || read.some((binding) => binding.resourceID === resourceID)) throw unknownOutcome(change, error);
          this.bindings = this.liveBindings(read);
          takeEffect();
        }
        throw unknownOutcome(change, error);
      }
      this.bindings = next;
      takeEffect();
    }
    // Then the files and the directory.
    const directory = this.storeDirectory(record.type, resourceID);
    if (!tookEffect) {
      let first: string | null = null;
      try {
        first = this.firstStoreFile(directory);
        if (first !== null) deleteFile(this.storage, first);
      } catch (error) {
        if (!(error instanceof UncertainWriteError) || first === null) {
          throw resourceError("unavailable", `Could not destroy resource ${resourceID}: ${errorMessage(error)}`);
        }
        if (!this.confirmedAbsent(first)) throw unknownOutcome(change, error);
        takeEffect();
        throw unknownOutcome(change, error);
      }
      takeEffect();
    }
    this.finishDeletion(resourceID, directory);
    return bound;
  }

  /**
   * Removes a deleted artifact's explicit bindings and emits `unbound` for
   * each (specs/arch/resources/index.md#^rs-artifact-delete), even when the
   * bindings file cannot be saved: the artifact's deletion is already
   * stored, so its access has ended either way. Never throws.
   */
  private removeArtifactBindings(artifactID: string): void {
    if (!this.bindingsEnabled || this.bindingsProblem !== null) return;
    const removed = this.bindings.filter((binding) => binding.artifactID === artifactID);
    if (removed.length === 0) return;
    const next = this.bindings.filter((binding) => binding.artifactID !== artifactID);
    try {
      this.writeBindings(next);
    } catch (error) {
      // A binding left on disk names an artifact that no longer exists: it
      // grants nothing, and the next save of the file or the next startup
      // discards it.
      this.bindingsFileStale = true;
      console.warn(`Could not remove the bindings of deleted artifact ${artifactID}: ${errorMessage(error)}`);
    }
    this.bindings = next;
    for (const binding of removed.sort(byResourceID)) {
      this.emit({ event: "unbound", resourceID: binding.resourceID, artifactID });
    }
  }

  // --- The type host ---

  private resolveForRead(address: StoreAddress, type: ResourceType): ResourceID | null {
    this.requireLoaded();
    let resourceID: ResourceID;
    if ("artifactID" in address) {
      this.requireOwnStore(address.artifactID);
      const pointer = this.artifacts.storePointer(address.artifactID);
      if (pointer === undefined) return null;
      resourceID = pointer;
    } else {
      resourceID = address.resourceID;
    }
    const record = this.requireStore(resourceID);
    if (record.type !== type) {
      throw resourceError("wrong-type", `Resource ${resourceID} is a ${record.type} resource, not a ${type} resource.`);
    }
    this.requireUsable(record);
    return resourceID;
  }

  private resolveForWrite(address: StoreAddress, type: ResourceType): ResourceID {
    const known = this.resolveForRead(address, type);
    let resourceID: ResourceID;
    if (known === null) {
      // The first write: the artifact's pointer is saved before any of the
      // store's files exist (specs/arch/resources/index.md#^rs-first-write).
      const artifactID = (address as { artifactID: string }).artifactID;
      resourceID = this.newResourceID();
      const saved = this.artifacts.saveStorePointer(artifactID, resourceID);
      if (saved.pointer !== resourceID) throw saved.uncertain ?? new Error(`The store pointer of artifact ${artifactID} was not saved.`);
      // Open pages hear of the pointer now, even when a later step of this write fails.
      this.emitAccess({ kind: "store", artifactID });
      this.requireStore(resourceID);
      if (saved.uncertain !== null) throw saved.uncertain;
    } else {
      resourceID = known;
    }
    const record = this.stores.get(resourceID)!;
    if (record.manifest === null) {
      const label = `the first write to the store of artifact ${this.artifacts.pointerOwner(resourceID) ?? resourceID}`;
      this.createStoreDirectory(record, label);
      const uncertain = this.saveManifest(record, this.newManifest(this.artifacts.pointerOwner(resourceID)), label);
      if (uncertain !== null) throw uncertain;
    }
    return resourceID;
  }

  /**
   * Saves a store's content under the storage rule: its content file is
   * rewritten, or deleted when the store is left with no value. When the
   * save's outcome is uncertain, what the file holds takes effect with the
   * refusal to give, or the state from before stands when it cannot be read
   * back (specs/arch/resources/index.md#^rs-arch-uncertain-save).
   */
  private saveContent(resourceID: ResourceID, content: unknown): SavedContent {
    const record = this.stores.get(resourceID)!;
    const implementation = this.types.get(record.type)!;
    const filePath = path.join(this.storeDirectory(record.type, resourceID), implementation.contentFileName);
    const text = implementation.serializeContent(content);
    const label = `${record.type === "json" ? "writing to JSON store" : "writing to resource"} ${resourceID}`;
    try {
      if (text === null) deleteFile(this.storage, filePath);
      else rewriteFile(this.storage, filePath, text);
    } catch (error) {
      if (!(error instanceof UncertainWriteError)) {
        throw resourceError("unavailable", `Could not save resource ${resourceID}: ${errorMessage(error)}`);
      }
      const uncertain = unknownOutcome(label, error);
      let parsed: ReturnType<ResourceTypeImplementation["parseContent"]>;
      try {
        const readBack = readIfExists(this.storage, filePath);
        if (readBack === null) return { content: implementation.emptyContent, uncertain };
        parsed = implementation.parseContent(readBack);
      } catch (readError) {
        parsed = { problem: errorMessage(readError) };
      }
      if ("problem" in parsed) {
        console.warn(`Resource ${resourceID} keeps its value from before a save whose outcome is unknown, since ${filePath} cannot be read back: ${parsed.problem}.`);
        throw uncertain;
      }
      return { content: parsed.content, uncertain };
    }
    return { content, uncertain: null };
  }

  private followers(resourceID: ResourceID): string[] {
    const owner = this.artifacts.pointerOwner(resourceID);
    return [subscriptionKey({ resourceID }), ...(owner === undefined ? [] : [subscriptionKey({ artifactID: owner })])];
  }

  private emitChanged(resourceID: ResourceID, paths: string[]): void {
    const owner = this.stores.get(resourceID)?.manifest?.ownerArtifactID;
    this.emit({ event: "changed", resourceID, ...(owner === undefined ? {} : { artifactID: owner }), paths });
  }

  /** With the flag on, which `requireCreation` checks first: creates a store with its starting content and no owner. */
  private createStore(type: ResourceType, details: ResourceDetails, content: unknown): ResourceSummary {
    validateResourceDescription(details.description);
    validateResourceUsage(details.usage);
    const resourceID = this.newResourceID();
    const record: StoreRecord = { resourceID, type, manifest: null, unavailableReason: null };
    const change = `creating resource ${resourceID}`;
    const implementation = this.types.get(type)!;
    const directory = this.storeDirectory(type, resourceID);
    let uncertain: Error | null = null;
    try {
      this.createStoreDirectory(record, change);
      uncertain = this.saveManifest(record, { version: 1, createdAt: new Date().toISOString(), description: details.description, usage: details.usage }, change);
    } catch (error) {
      this.removeIncompleteStore(directory);
      throw error;
    }
    this.stores.set(resourceID, record);
    implementation.open(resourceID, implementation.emptyContent);
    const saved = this.saveContent(resourceID, content);
    implementation.open(resourceID, saved.content);
    const summary = this.summary(record);
    this.emit({ event: "created", resource: summary });
    const refusal = uncertain ?? saved.uncertain;
    if (refusal !== null) throw refusal;
    return summary;
  }

  // --- Internals ---

  /**
   * The store with this resource ID, loaded on first use, or null when no
   * store has it: no directory and no artifact's pointer, or a destroy that
   * has taken effect (specs/arch/resources/index.md#^rs-load).
   */
  private findStore(resourceID: string): StoreRecord | null {
    if (!isResourceID(resourceID) || this.destroyed.has(resourceID)) return null;
    const known = this.stores.get(resourceID);
    if (known) return known;
    for (const type of this.types.keys()) {
      const directory = this.storeDirectory(type, resourceID);
      let present: boolean;
      try {
        present = this.storage.exists(directory);
      } catch (error) {
        // Only a confirmed absence is an interrupted first write; the store may hold a value.
        return this.uncheckedStore(type, resourceID, error);
      }
      if (present) return this.loadStore(type, resourceID, directory);
    }
    if (this.artifacts.pointerOwner(resourceID) === undefined) return null;
    // A pointer with no store directory: an interrupted first write, with no value.
    const record: StoreRecord = { resourceID, type: "json", manifest: null, unavailableReason: null };
    this.stores.set(resourceID, record);
    this.json.open(resourceID, this.json.emptyContent);
    return record;
  }

  /** A store whose directory cannot be checked, kept in memory as unavailable, as one whose files cannot be read is. */
  private uncheckedStore(type: ResourceType, resourceID: ResourceID, error: unknown): StoreRecord {
    const record: StoreRecord = { resourceID, type, manifest: null, unavailableReason: `its directory cannot be checked: ${errorMessage(error)}` };
    console.warn(`Resource ${resourceID} is unavailable: ${record.unavailableReason}.`);
    this.stores.set(resourceID, record);
    return record;
  }

  /** Reads a store's manifest and content, removing leftover temporary files, and keeps it in memory. */
  private loadStore(type: ResourceType, resourceID: ResourceID, directory: string): StoreRecord {
    const implementation = this.types.get(type)!;
    const record: StoreRecord = { resourceID, type, manifest: null, unavailableReason: null };
    let content = implementation.emptyContent;
    try {
      for (const { name: entry } of this.storage.readDirectory(directory)) {
        if (!isTemporaryFileName(entry)) continue;
        try {
          this.storage.deleteFile(path.join(directory, entry));
        } catch (error) {
          console.warn(`Could not remove the leftover temporary file ${path.join(directory, entry)}: ${errorMessage(error)}`);
        }
      }
      const manifestText = readIfExists(this.storage, path.join(directory, "manifest.json"));
      const contentText = readIfExists(this.storage, path.join(directory, implementation.contentFileName));
      if (manifestText !== null) {
        record.manifest = parseManifest(manifestText);
        if (record.manifest === null) record.unavailableReason = "its manifest is not valid";
      } else if (contentText !== null) {
        record.unavailableReason = "it has content but no manifest";
      } else if (this.artifacts.pointerOwner(resourceID) === undefined) {
        // Only an artifact's first write leaves a store directory with neither
        // file to complete; a created store's description was never saved.
        record.unavailableReason = "its creation was interrupted, so it has no manifest";
      }
      if (record.unavailableReason === null && contentText !== null) {
        const parsed = implementation.parseContent(contentText);
        if ("problem" in parsed) record.unavailableReason = parsed.problem;
        else content = parsed.content;
      }
    } catch (error) {
      record.unavailableReason = `its files cannot be read: ${errorMessage(error)}`;
    }
    if (record.unavailableReason !== null) {
      console.warn(`Resource ${resourceID} is unavailable: ${record.unavailableReason}.`);
    }
    this.stores.set(resourceID, record);
    if (record.unavailableReason === null) implementation.open(resourceID, content);
    return record;
  }

  /** A manifest for a store whose first write or description change completes it. */
  private newManifest(owner: string | undefined): StoredManifestV1 {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      description: OWN_STORE_DESCRIPTION,
      usage: "",
      ...(owner === undefined ? {} : { ownerArtifactID: owner }),
    };
  }

  /** Creates a store's directory, and the directories above it, each flushed in its parent. */
  private createStoreDirectory(record: StoreRecord, change: string): void {
    try {
      createDirectories(this.storage, this.storagePath, this.storeDirectory(record.type, record.resourceID));
    } catch (error) {
      if (error instanceof UncertainWriteError) throw unknownOutcome(change, error);
      throw resourceError("unavailable", `Could not create the directory of resource ${record.resourceID}: ${errorMessage(error)}`);
    }
  }

  /**
   * Writes a store's manifest. When the save's outcome is uncertain and the
   * file reads back valid, what it holds takes effect and the refusal is
   * returned; when it cannot be read back, the refusal is thrown and the
   * state from before stands.
   */
  private saveManifest(record: StoreRecord, manifest: StoredManifestV1, change: string): Error | null {
    const filePath = path.join(this.storeDirectory(record.type, record.resourceID), "manifest.json");
    try {
      rewriteFile(this.storage, filePath, serializeManifest(manifest));
    } catch (error) {
      if (!(error instanceof UncertainWriteError)) {
        throw resourceError("unavailable", `Could not save the manifest of resource ${record.resourceID}: ${errorMessage(error)}`);
      }
      const uncertain = unknownOutcome(change, error);
      let parsed: StoredManifestV1 | null;
      try {
        const readBack = readIfExists(this.storage, filePath);
        parsed = readBack === null ? null : parseManifest(readBack);
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        console.warn(`Resource ${record.resourceID} keeps its manifest from before a save whose outcome is unknown, since ${filePath} cannot be read back.`);
        throw uncertain;
      }
      record.manifest = parsed;
      return uncertain;
    }
    record.manifest = manifest;
    return null;
  }

  /** Writes the bindings file under the same rule, returning the bindings now current. */
  private saveBindings(bindings: ResourceBinding[], change: string): { bindings: ResourceBinding[]; uncertain: Error | null } {
    try {
      this.writeBindings(bindings);
    } catch (error) {
      if (!(error instanceof UncertainWriteError)) {
        throw resourceError("unavailable", `Could not save resource bindings: ${errorMessage(error)}`);
      }
      const uncertain = unknownOutcome(change, error);
      const read = this.readBackBindings();
      if (read === null) throw uncertain;
      return { bindings: this.liveBindings(read), uncertain };
    }
    return { bindings, uncertain: null };
  }

  /**
   * The bindings file read back after a save whose outcome is uncertain, or
   * null when it cannot be read or is not valid, so that the bindings from
   * before stand.
   */
  private readBackBindings(): ResourceBinding[] | null {
    try {
      return parseStoredBindings(this.storage.readFile(this.bindingsPath));
    } catch (error) {
      console.warn(`Resource bindings keep their state from before a save whose outcome is unknown, since ${this.bindingsPath} cannot be read back: ${errorMessage(error)}.`);
      return null;
    }
  }

  /** The bindings of a file read back whose artifact and store exist. */
  private liveBindings(read: ResourceBinding[]): ResourceBinding[] {
    return read.filter((binding) => this.artifacts.artifactExists(binding.artifactID) && this.findStore(binding.resourceID) !== null);
  }

  /** Makes `bindings` current, emitting `bound` and `unbound` for each binding that changed. */
  private adoptBindings(bindings: ResourceBinding[]): void {
    const events = bindingEvents(this.bindings, bindings);
    this.bindings = bindings;
    for (const event of events) this.emit(event);
  }

  private writeBindings(bindings: readonly ResourceBinding[]): void {
    const stored: StoredBindingsV1 = {
      version: 1,
      bindings: [...bindings].sort(byBinding).map(({ resourceID, artifactID, access }) => ({ resourceID, artifactID, access })),
    };
    rewriteFile(this.storage, this.bindingsPath, `${JSON.stringify(stored, null, 2)}\n`);
    this.bindingsFileStale = false;
  }

  /**
   * Finishes deleting a destroyed store: the bindings file, when it may still
   * hold bindings the layer dropped, then every file in the store's
   * directory and the directory itself. A failure leaves the rest for a
   * retried destroy.
   */
  private finishDeletion(resourceID: ResourceID, directory: string): void {
    try {
      if (this.bindingsEnabled && this.bindingsFileStale && this.bindingsProblem === null) this.writeBindings(this.bindings);
      if (this.storage.exists(directory)) {
        for (let file = this.firstStoreFile(directory); file !== null; file = this.firstStoreFile(directory)) {
          deleteFile(this.storage, file);
        }
        removeDirectory(this.storage, directory);
      }
    } catch (error) {
      if (!(error instanceof UncertainWriteError)) throw this.incompleteDeletion(resourceID, error);
      // A directory found gone is taken as deleted, as the uncertain-save rule says.
      if (this.confirmedAbsent(directory)) this.destroyed.delete(resourceID);
      throw unknownOutcome(`destroying resource ${resourceID}`, error);
    }
    this.destroyed.delete(resourceID);
  }

  /** The refusal of a destroy that took effect and could not finish deleting what the store left. */
  private incompleteDeletion(resourceID: ResourceID, error: unknown): Error {
    return resourceError("unavailable", `Resource ${resourceID} is destroyed, but what it left could not all be deleted; destroy it again to finish: ${errorMessage(error)}`);
  }

  /** A store's directory's first file to delete, its content before its manifest, or null when it holds none. */
  private firstStoreFile(directory: string): string | null {
    if (!this.storage.exists(directory)) return null;
    const entries = this.storage.readDirectory(directory).map((entry) => entry.name).sort((left, right) => (left === "manifest.json" ? 1 : right === "manifest.json" ? -1 : compareStrings(left, right)));
    return entries.length === 0 ? null : path.join(directory, entries[0]!);
  }

  /** Removes what a failed creation left, as far as it can. */
  private removeIncompleteStore(directory: string): void {
    try {
      for (let file = this.firstStoreFile(directory); file !== null; file = this.firstStoreFile(directory)) this.storage.deleteFile(file);
      if (this.storage.exists(directory)) this.storage.removeDirectory(directory);
    } catch (error) {
      console.warn(`Could not remove what a failed store creation left in ${directory}: ${errorMessage(error)}`);
    }
  }

  /** A resource ID no store has, refused with `unavailable` when whether one has it cannot be checked. */
  private newResourceID(): ResourceID {
    for (;;) {
      const resourceID = this.generateID();
      if (this.stores.has(resourceID) || this.destroyed.has(resourceID) || this.artifacts.pointerOwner(resourceID) !== undefined) continue;
      let taken: boolean;
      try {
        taken = [...this.types.keys()].some((type) => this.storage.exists(this.storeDirectory(type, resourceID)));
      } catch (error) {
        throw resourceError("unavailable", `Could not check whether a new resource ID is free: ${errorMessage(error)}`);
      }
      if (!taken) return resourceID;
    }
  }

  /** Whether the filesystem confirms that no type has a directory for this resource ID. */
  private storeDirectoryAbsent(resourceID: ResourceID): boolean {
    return [...this.types.keys()].every((type) => this.confirmedAbsent(this.storeDirectory(type, resourceID)));
  }

  private requireStore(resourceID: string): StoreRecord {
    const record = this.findStore(resourceID);
    if (record === null) throw notFound(resourceID);
    return record;
  }

  private requireUsable(record: StoreRecord): void {
    if (record.unavailableReason === null) return;
    const label = record.type === "json" ? "JSON store" : "Resource";
    throw resourceError("unavailable", `${label} ${record.resourceID} is unavailable: ${record.unavailableReason}`);
  }

  private requireArtifact(artifactID: string): void {
    if (!this.artifacts.artifactExists(artifactID)) throw resourceError("no-artifact", `Artifact not found: ${artifactID}`);
  }

  /** Throws `no-artifact` or `no-store` unless the artifact exists and has a store. */
  private requireOwnStore(artifactID: string): void {
    this.requireArtifact(artifactID);
    if (!this.artifacts.hasStore(artifactID)) {
      throw resourceError("no-store", `Artifact ${artifactID} has no store: only artifacts this server serves from its own files, with IDs Television generated, have one.`);
    }
  }

  /** Throws `not-enabled` while the flag is off, and `unavailable` while the bindings file cannot be read. */
  private requireBindings(): void {
    this.requireLoaded();
    if (!this.bindingsEnabled) throw notEnabled();
    if (this.bindingsProblem !== null) throw resourceError("unavailable", this.bindingsProblem);
  }

  private refuseOwnerBinding(resourceID: ResourceID, artifactID: string): void {
    if (this.artifacts.pointerOwner(resourceID) === artifactID) {
      throw resourceError("owner-binding", `Artifact ${artifactID} is always bound to its own store ${resourceID}.`);
    }
  }

  private explicitBindings(): ResourceBinding[] {
    return this.bindingsEnabled ? this.bindings : [];
  }

  /** A store's bindings ordered by artifact ID: its owner's, while the pointer stands, and the explicit ones with the flag on. */
  private bindingsOf(resourceID: ResourceID): ResourceBinding[] {
    const owner = this.artifacts.pointerOwner(resourceID);
    const own: ResourceBinding[] = owner === undefined ? [] : [{ resourceID, artifactID: owner, access: "read-write" }];
    return [...own, ...this.explicitBindings().filter((binding) => binding.resourceID === resourceID)].sort(byArtifactID);
  }

  private summary(record: StoreRecord): ResourceSummary {
    const { manifest } = record;
    const available = record.unavailableReason === null;
    const owner = manifest?.ownerArtifactID ?? (manifest === null && available ? this.artifacts.pointerOwner(record.resourceID) : undefined);
    return {
      resourceID: record.resourceID,
      type: record.type,
      description: manifest?.description ?? "",
      usage: manifest?.usage ?? "",
      status: available ? "available" : "unavailable",
      ...(available ? {} : { unavailableReason: record.unavailableReason! }),
      ...(manifest === null ? {} : { createdAt: manifest.createdAt }),
      ...(owner === undefined ? {} : { ownerArtifactID: owner }),
    };
  }

  /** Acts on open pages once a share change is saved: a link's new level, or the end of a revoked one. */
  private shareChanged(before: ArtifactShare | undefined, after: ArtifactShare | undefined): void {
    if (before === undefined) return;
    if (after?.id !== before.id) this.emitAccess({ kind: "ended", ids: [before.id] });
    else if (after.access !== before.access) this.emitAccess({ kind: "level", id: before.id, access: after.access });
  }

  private emitAccess(change: AccessChange): void {
    for (const listener of [...this.accessListeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error("A resource access listener failed", error);
      }
    }
  }

  private emit(event: ResourceEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("A resource event listener failed", error);
      }
    }
  }

  /**
   * Whether the filesystem confirms that a path is absent. A path that
   * exists, or whose existence cannot be checked, is not: only a confirmed
   * absence may count as a deletion or an interrupted write.
   */
  private confirmedAbsent(targetPath: string): boolean {
    try {
      return !this.storage.exists(targetPath);
    } catch {
      return false;
    }
  }

  private storeDirectory(type: ResourceType, resourceID: ResourceID): string {
    return path.join(this.storagePath, "resources", type, resourceID);
  }

  private get bindingsPath(): string {
    return path.join(this.storagePath, "state", "resource-bindings.json");
  }
}
