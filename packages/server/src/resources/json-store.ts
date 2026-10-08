import {
  applyJsonWrite,
  checkJsonLimits,
  isValidKey,
  isResourceError,
  jsonEqual,
  jsonWritePaths,
  parseJsonPath,
  readJsonValue,
  resourceError,
  validateJsonValue,
  type JSONValue,
  type JsonReadResult,
  type JsonWrite,
  type ResourceID,
  type ResourceSummary,
  type StoreAddress,
  type WriteValue,
} from "@telepath-computer/television-shared/resources";
import { subscriptionKey, type OperationAccess, type ResourceTypeHost, type ResourceTypeImplementation } from "./type.ts";

/** A store's content in memory: its value, or undefined when it has none. */
type JsonStoreContent = JSONValue | undefined;

export interface JsonSubscriber {
  /** Receives the value at the path on registration and after each change to it. */
  onValue(result: JsonReadResult): void;
  /** Called once when the subscription ends because its store was destroyed. */
  onEnd(): void;
}

interface Subscription {
  segments: string[];
  last: JsonReadResult;
  subscriber: JsonSubscriber;
}

function readResult(value: JsonStoreContent, segments: readonly string[]): JsonReadResult {
  const found = readJsonValue(value, segments);
  return found === undefined ? { exists: false } : { exists: true, value: found };
}

function sameResult(left: JsonReadResult, right: JsonReadResult): boolean {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  return jsonEqual(left.value, right.value);
}

/** A read result received from a client, checked before it is compared. */
function receivedReadResult(value: unknown): JsonReadResult {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const result = value as Record<string, unknown>;
    if (result.exists === false && Object.keys(result).length === 1) return { exists: false };
    if (result.exists === true && Object.hasOwn(result, "value") && Object.keys(result).length === 2) {
      validateJsonValue(result.value);
      return { exists: true, value: result.value };
    }
  }
  throw resourceError("invalid-value", "A compare-and-set carries the value it expects, or its absence.");
}

/** The JSON store's page operations. */
export type JsonOperation = "get" | "subscribe" | "set" | "update" | "push" | "remove" | "compare-and-set";

/**
 * The `json` resource type's server side: one value per store, applied one
 * write at a time, saved before anyone sees it (specs/arch/resources/json-store.md).
 * Every operation runs to completion synchronously, so each store's queue is
 * strictly serial, its first write included.
 */
export class JsonStoreType implements ResourceTypeImplementation {
  readonly type = "json" as const;
  readonly contentFileName = "content.json";
  readonly emptyContent: JsonStoreContent = undefined;
  /** Each operation's class, so access is checked before the operation runs (specs/product/resources/json-store.md#^js-access). */
  readonly operationAccess: Readonly<Record<JsonOperation, OperationAccess>> = {
    get: "read",
    subscribe: "read",
    set: "write",
    update: "write",
    push: "write",
    remove: "write",
    "compare-and-set": "write",
  };
  private readonly host: ResourceTypeHost;
  private readonly values = new Map<ResourceID, JsonStoreContent>();
  /** Subscriptions by the key of the address they were made with. */
  private readonly subscriptions = new Map<string, Set<Subscription>>();

  constructor(host: ResourceTypeHost) {
    this.host = host;
  }

  // --- The content file (specs/arch/resources/json-store.md#^js-arch-content-file) ---

  parseContent(text: string): { content: JsonStoreContent } | { problem: string } {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { problem: "its content.json is not valid JSON" };
    }
    try {
      validateJsonValue(value);
      checkJsonLimits(value);
    } catch (error) {
      if (!isResourceError(error)) throw error;
      return { problem: `its stored value breaks the JSON store's rules: ${error.message}` };
    }
    return { content: value };
  }

  serializeContent(content: unknown): string | null {
    return content === undefined ? null : JSON.stringify(content);
  }

  open(resourceID: ResourceID, content: unknown): void {
    this.values.set(resourceID, content as JsonStoreContent);
  }

  close(resourceID: ResourceID, owner: string | undefined): void {
    this.values.delete(resourceID);
    const key = subscriptionKey({ resourceID });
    const ended = this.subscriptions.get(key);
    this.subscriptions.delete(key);
    for (const subscription of ended ?? []) subscription.subscriber.onEnd();
    // The owner's own store has no store until its next write.
    if (owner !== undefined) this.notify(subscriptionKey({ artifactID: owner }), undefined);
  }

  // --- Operations ---

  /** Creates a store holding `value`, `{}` unless another is given, with the bindings flag on only. */
  create(input: { description: string; usage?: string; value?: JSONValue }): ResourceSummary {
    this.host.requireCreation();
    const value = input.value === undefined ? {} : input.value;
    validateJsonValue(value);
    checkJsonLimits(value);
    return this.host.createStore("json", { description: input.description, usage: input.usage ?? "" }, value);
  }

  /** A read: the value at a path. */
  get(address: StoreAddress, path: string): JsonReadResult {
    const segments = parseJsonPath(path);
    return readResult(this.valueOf(this.host.resolveForRead(address, "json")), segments);
  }

  /**
   * A write, applied completely before the next: compute and check the new
   * value, save it, replace the in-memory value, send subscription updates,
   * emit `changed`, and return so the caller can acknowledge
   * (specs/arch/resources/json-store.md#^js-arch-apply-writes). A write to
   * an artifact's own store that has not been written before is its first
   * write. When the save's outcome is uncertain, the value its file holds
   * takes effect the same way, and the write is then refused
   * (specs/arch/resources/json-store.md#^js-arch-uncertain).
   */
  write(address: StoreAddress, write: JsonWrite): void {
    const current = this.valueOf(this.host.resolveForRead(address, "json"));
    const next = applyJsonWrite(current, write, { now: Date.now() });
    const resourceID = this.host.resolveForWrite(address, "json");
    const saved = this.host.saveContent(resourceID, next);
    const value = saved.content as JsonStoreContent;
    this.values.set(resourceID, value);
    for (const key of this.host.followers(resourceID)) this.notify(key, value);
    this.host.emitChanged(resourceID, jsonWritePaths(write));
    if (saved.uncertain !== null) throw saved.uncertain;
  }

  /** A write that adds `value` under a new client-generated key; refused below an array. */
  push(address: StoreAddress, path: string, key: string, value: WriteValue): void {
    const segments = parseJsonPath(path);
    if (!isValidKey(key)) throw resourceError("invalid-path", "A push key must be a valid path key.");
    const current = this.valueOf(this.host.resolveForRead(address, "json"));
    if (Array.isArray(readJsonValue(current, segments))) {
      throw resourceError("invalid-path", "push() below an array is refused; write the whole array.");
    }
    this.write(address, { kind: "set", path: [...segments, key].join("/"), value });
  }

  /**
   * A transaction's write: sets `value` at `path` only when the value there
   * still equals `expected`; otherwise returns what is there now
   * (specs/arch/resources/json-store.md#^js-arch-transactions).
   */
  compareAndSet(address: StoreAddress, path: string, expected: unknown, value: unknown): { applied: true } | { applied: false; current: JsonReadResult } {
    const segments = parseJsonPath(path);
    const seen = receivedReadResult(expected);
    validateJsonValue(value);
    const current = readResult(this.valueOf(this.host.resolveForRead(address, "json")), segments);
    if (!sameResult(current, seen)) return { applied: false, current };
    this.write(address, { kind: "set", path, value });
    return { applied: true };
  }

  /** A subscription to the value at a path: the current value now, then each change to it. */
  subscribe(address: StoreAddress, path: string, subscriber: JsonSubscriber): () => void {
    const segments = parseJsonPath(path);
    const value = this.valueOf(this.host.resolveForRead(address, "json"));
    const subscription: Subscription = { segments, last: readResult(value, segments), subscriber };
    const key = subscriptionKey(address);
    let subscriptions = this.subscriptions.get(key);
    if (!subscriptions) {
      subscriptions = new Set();
      this.subscriptions.set(key, subscriptions);
    }
    subscriptions.add(subscription);
    subscriber.onValue(subscription.last);
    return () => {
      this.subscriptions.get(key)?.delete(subscription);
    };
  }

  private valueOf(resourceID: ResourceID | null): JsonStoreContent {
    return resourceID === null ? undefined : this.values.get(resourceID);
  }

  /** Sends each subscription under `key` the value at its path, when it differs from the last it heard. */
  private notify(key: string, value: JsonStoreContent): void {
    for (const subscription of [...(this.subscriptions.get(key) ?? [])]) {
      const result = readResult(value, subscription.segments);
      if (sameResult(result, subscription.last)) continue;
      subscription.last = result;
      subscription.subscriber.onValue(result);
    }
  }
}
