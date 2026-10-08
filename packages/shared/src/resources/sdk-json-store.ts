// The JSON store's SDK functions and the SDK's local-write model
// (specs/arch/resources/json-store.md, SDK functions and Local writes in the SDK).
import { resourceError } from "./errors.ts";
import { applyJsonWrite, type JsonWrite } from "./json-apply.ts";
import { checkPathSegments, childKeys, compareChildKeys, isJsonObject, jsonEqual, parseJsonPath, readJsonValue } from "./json-paths.ts";
import {
  decodeUpdateEntries,
  decodeWriteValue,
  encodeUpdateEntries,
  encodeWriteValue,
  setMember,
  validateJsonValue,
  validateUpdateValues,
  validateWriteValue,
  type UpdateEntryValue,
  type WriteValue,
} from "./json-values.ts";
import type { PageWrite } from "./page-wire.ts";
import { generatePushKey } from "./push-keys.ts";
import { callPage, type SdkConnection, type StoreKey, type WriteOutcome } from "./sdk-connection.ts";
import { onPageConnection, pageConnection, requireArtifactPage } from "./sdk-page.ts";
import type { JSONValue, JsonReadResult } from "./types.ts";

/** Calls of a transaction's function before it gives up (specs/arch/resources/json-store.md#^js-arch-limits). */
const MAX_TRANSACTION_CALLS = 25;

export type Unsubscribe = () => void;

/** A handle for a store. The artifact's own store has no resource ID here: `getStore()` leaves it null. */
export interface Store {
  readonly resourceID: string | null;
}

export interface Ref {
  readonly key: string | null;
  readonly parent: Ref | null;
  readonly root: Ref;
  readonly path: string;
}

/** The reference `push` returns, also a promise of the write, with `then`, `catch` and `finally`, that resolves with a plain reference to the new child. */
export interface ThenableRef extends Ref, Pick<Promise<Ref>, "then" | "catch" | "finally"> {}

export interface Snapshot {
  readonly key: string | null;
  readonly ref: Ref;
  exists(): boolean;
  val(): JSONValue | undefined;
  child(path: string): Snapshot;
  forEach(fn: (child: Snapshot) => boolean | void): boolean;
  readonly size: number;
  readonly metadata: { readonly hasPendingWrites: boolean };
}

type Segments = readonly string[];

/** A queued write as the local view applies it. */
interface LocalWrite {
  readonly apply: JsonWrite;
  /** The paths it writes at, for `hasPendingWrites`. */
  readonly paths: readonly Segments[];
  /** The server's clock as estimated when the write was made, for `serverTimestamp()`. */
  readonly now: number;
}

// --- References ---

const refStates = new WeakMap<Ref, { store: Store; segments: Segments }>();

function stateOf(ref: Ref): { store: Store; segments: Segments } {
  const state = refStates.get(ref);
  if (!state) throw resourceError("invalid-path", "Not a reference made by ref() or child().");
  return state;
}

function parsePath(path: unknown): string[] {
  if (typeof path !== "string") throw resourceError("invalid-path", "A path is a string of keys separated by /.");
  return parseJsonPath(path);
}

class JsonRef implements Ref {
  readonly key: string | null;
  readonly path: string;

  constructor(store: Store, segments: Segments) {
    refStates.set(this, { store, segments });
    this.key = segments.length === 0 ? null : segments[segments.length - 1]!;
    this.path = segments.join("/");
  }

  get parent(): Ref | null {
    const { store, segments } = stateOf(this);
    return segments.length === 0 ? null : new JsonRef(store, segments.slice(0, -1));
  }

  get root(): Ref {
    const { store, segments } = stateOf(this);
    return segments.length === 0 ? this : new JsonRef(store, []);
  }
}

class JsonThenableRef extends JsonRef implements ThenableRef {
  private readonly done: Promise<Ref>;

  constructor(store: Store, segments: Segments, written: Promise<void>) {
    super(store, segments);
    // It resolves with a plain reference: resolving with itself would never settle.
    this.done = written.then(() => new JsonRef(store, segments));
    // A page may keep only the reference; its refusal is then not an unhandled rejection.
    this.done.catch(() => undefined);
  }

  then<Fulfilled = Ref, Rejected = never>(
    onFulfilled?: ((value: Ref) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): Promise<Fulfilled | Rejected> {
    return this.done.then(onFulfilled, onRejected);
  }

  catch<Rejected = never>(onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null): Promise<Ref | Rejected> {
    return this.done.catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<Ref> {
    return this.done.finally(onFinally);
  }
}

/**
 * The handle for the artifact's own store, or with a resource ID for that
 * store, made without network I/O (specs/arch/resources/sdk.md#^sdk-handles).
 */
export function getStore(resourceID?: string): Store {
  requireArtifactPage();
  return Object.freeze({ resourceID: resourceID === undefined ? null : String(resourceID) });
}

export function ref(store: Store, path = ""): Ref {
  requireArtifactPage();
  return new JsonRef(store, parsePath(path));
}

export function child(parent: Ref, path: string): Ref {
  requireArtifactPage();
  const { store, segments } = stateOf(parent);
  const joined = [...segments, ...parsePath(path)];
  checkPathSegments(joined);
  return new JsonRef(store, joined);
}

// --- The local view ---

function isWithin(inner: Segments, outer: Segments): boolean {
  return outer.length <= inner.length && outer.every((segment, index) => inner[index] === segment);
}

function pendingAt(pendingPaths: readonly Segments[], segments: Segments): boolean {
  return pendingPaths.some((path) => isWithin(path, segments) || isWithin(segments, path));
}

/** A store value holding `value` at `segments` and nothing else. */
function nest(segments: Segments, value: JSONValue): JSONValue {
  let node = value;
  for (let index = segments.length - 1; index >= 0; index--) {
    const parent: Record<string, JSONValue> = {};
    setMember(parent, segments[index]!, node);
    node = parent;
  }
  return node;
}

interface Confirmed {
  readonly segments: Segments;
  readonly result: JsonReadResult;
  readonly seq: number;
}

interface View {
  readonly value: JSONValue | undefined;
  /** The paths of every queued write to the store when the view was taken: its snapshots report these, whatever the queue holds at delivery. */
  readonly pendingPaths: readonly Segments[];
}

/**
 * What the page sees at `segments`: the confirmed value with every queued
 * write to the same store, the own store's by either address, numbered
 * above it applied in order (specs/arch/resources/json-store.md#^js-arch-local-writes).
 */
function viewAt(connection: SdkConnection, store: StoreKey, confirmed: Confirmed, segments: Segments): View {
  let root = confirmed.result.exists ? nest(confirmed.segments, confirmed.result.value) : undefined;
  const pendingPaths: Segments[] = [];
  for (const queued of connection.queue()) {
    if (!connection.sameStore(queued.store, store)) continue;
    const local = queued.local as LocalWrite;
    for (const path of local.paths) pendingPaths.push(path);
    if (queued.seq <= confirmed.seq) continue;
    try {
      root = applyJsonWrite(root, local.apply, { now: local.now }, { checkSize: false });
    } catch {
      // The server will refuse it; until then it shows nothing.
    }
  }
  return { value: readJsonValue(root, segments), pendingPaths };
}

class JsonSnapshot implements Snapshot {
  readonly key: string | null;
  readonly ref: Ref;
  readonly metadata: { readonly hasPendingWrites: boolean };
  private readonly value: JSONValue | undefined;
  private readonly pendingPaths: readonly Segments[];

  constructor(snapshotRef: Ref, value: JSONValue | undefined, pendingPaths: readonly Segments[]) {
    this.ref = snapshotRef;
    this.key = snapshotRef.key;
    this.value = value;
    this.pendingPaths = pendingPaths;
    this.metadata = Object.freeze({ hasPendingWrites: pendingAt(pendingPaths, stateOf(snapshotRef).segments) });
  }

  get size(): number {
    if (Array.isArray(this.value)) return this.value.length;
    return isJsonObject(this.value) ? Object.keys(this.value).length : 0;
  }

  exists(): boolean {
    return this.value !== undefined;
  }

  val(): JSONValue | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  child(path: string): Snapshot {
    const childRef = child(this.ref, path);
    return new JsonSnapshot(childRef, readJsonValue(this.value, parsePath(path)), this.pendingPaths);
  }

  forEach(fn: (child: Snapshot) => boolean | void): boolean {
    for (const key of childKeys(this.value)) {
      if (fn(this.child(key)) === true) return true;
    }
    return false;
  }
}

// --- Listeners ---

type ListenerKind = "value" | "child-added" | "child-changed" | "child-removed";

interface Listener {
  readonly kind: ListenerKind;
  readonly callback: (snapshot: Snapshot) => void;
  readonly onError: ((error: Error) => void) | undefined;
  delivered: boolean;
  /** The view where the listener was added, when the location's value was known then: what it hears first. */
  start: View | null;
  /** The value last delivered, or for a child listener the value its last events were computed from. */
  last: JSONValue | undefined;
  /** Whether the value last seen had unconfirmed writes. */
  lastPending: boolean;
}

/** A location the page listens at: one server subscription shared by its listeners. */
interface Location {
  readonly key: string;
  readonly store: Store;
  readonly segments: Segments;
  confirmed: Confirmed | null;
  readonly listeners: Set<Listener>;
  unsubscribe: () => void;
}

const locations = new Map<string, Location>();

function locationKey(store: StoreKey, segments: Segments): string {
  // Unambiguous, so no resource ID a page passes, the empty one included, shares the own store's locations.
  return JSON.stringify([store, ...segments]);
}

function sameValue(left: JSONValue | undefined, right: JSONValue | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return jsonEqual(left, right);
}

/** Child events between two values: added, removed and changed keys of an object, in child order. */
function childEvents(before: JSONValue | undefined, after: JSONValue | undefined): Array<{ kind: ListenerKind; key: string; value: JSONValue }> {
  const old = isJsonObject(before) ? before : {};
  const next = isJsonObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])].sort(compareChildKeys);
  const events: Array<{ kind: ListenerKind; key: string; value: JSONValue }> = [];
  for (const key of keys) {
    const inOld = Object.hasOwn(old, key);
    const inNext = Object.hasOwn(next, key);
    if (inNext && !inOld) events.push({ kind: "child-added", key, value: next[key]! });
    else if (inOld && !inNext) events.push({ kind: "child-removed", key, value: old[key]! });
    else if (!jsonEqual(old[key]!, next[key]!)) events.push({ kind: "child-changed", key, value: next[key]! });
  }
  return events;
}

/**
 * Brings listeners up to date with a location's view: first each child
 * event, across the child listeners in child order, then each onValue
 * listener whose value changed or whose last pending write left the queue.
 */
function deliverView(location: Location, listeners: readonly Listener[], view: View): void {
  const locationRef = new JsonRef(location.store, location.segments);
  const pending = pendingAt(view.pendingPaths, location.segments);
  const childCalls: Array<{ key: string; listener: Listener; value: JSONValue }> = [];
  const valueListeners: Listener[] = [];
  for (const listener of listeners) {
    if (!location.listeners.has(listener)) continue;
    if (listener.kind === "value") {
      const changed = !listener.delivered || !sameValue(listener.last, view.value);
      // The last unconfirmed write here left the queue: onValue hears it even when the value is unchanged.
      const cleared = listener.delivered && listener.lastPending && !pending;
      listener.lastPending = pending;
      if (!changed && !cleared) continue;
      listener.delivered = true;
      listener.last = view.value;
      valueListeners.push(listener);
      continue;
    }
    const before = listener.delivered ? listener.last : undefined;
    listener.delivered = true;
    listener.last = view.value;
    for (const event of childEvents(before, view.value)) {
      if (event.kind === listener.kind) childCalls.push({ key: event.key, listener, value: event.value });
    }
  }
  // A stable sort keeps listeners in registration order for one child.
  childCalls.sort((left, right) => compareChildKeys(left.key, right.key));
  for (const { key, listener, value } of childCalls) {
    if (location.listeners.has(listener)) callPage(listener.callback, new JsonSnapshot(child(locationRef, key), value, view.pendingPaths));
  }
  for (const listener of valueListeners) {
    if (location.listeners.has(listener)) callPage(listener.callback, new JsonSnapshot(locationRef, view.value, view.pendingPaths));
  }
}

/** A listener that has heard nothing yet first hears the view it was added in, if it has one. */
function deliverStart(location: Location, listener: Listener): void {
  const start = listener.start;
  listener.start = null;
  if (start !== null && !listener.delivered && location.listeners.has(listener)) deliverView(location, [listener], start);
}

/** One change at one location: the view it left there and the listeners there when it happened. */
interface Change {
  readonly location: Location;
  readonly listeners: readonly Listener[];
  readonly view: View;
}

/**
 * Captures a change at each of `affected` that has a known value, before any
 * page code runs, so that what a callback does while the change is being
 * delivered cannot alter it.
 */
function capture(connection: SdkConnection, affected: readonly Location[]): Change[] {
  const changes: Change[] = [];
  for (const location of affected) {
    if (location.confirmed === null) continue;
    changes.push({
      location,
      listeners: [...location.listeners],
      view: viewAt(connection, location.store.resourceID, location.confirmed, location.segments),
    });
  }
  return changes;
}

/** Delivers one change, everywhere it was captured: each listener first hears its start, if it has one, then the change. */
function deliverChange(changes: readonly Change[]): void {
  for (const { location, listeners, view } of changes) {
    for (const listener of listeners) deliverStart(location, listener);
    deliverView(location, listeners, view);
  }
}

/** Deliveries waiting for the one in progress, in the order of the changes they deliver. */
const waitingDeliveries: Array<() => void> = [];
let delivering = false;

/**
 * Runs a delivery, or queues it behind the one in progress. A callback that
 * writes changes the view while listeners are still hearing the previous
 * change; delivering the new change at once would let the rest of the
 * previous delivery reach listeners after it, carrying the older state. So
 * each delivery finishes before the next starts.
 */
function runDelivery(delivery: () => void): void {
  waitingDeliveries.push(delivery);
  if (delivering) return;
  delivering = true;
  try {
    for (let next = waitingDeliveries.shift(); next !== undefined; next = waitingDeliveries.shift()) next();
  } finally {
    delivering = false;
  }
}

/** Captures a change to the values at `affected` and delivers it after every change before it. */
function changed(connection: SdkConnection, affected: readonly Location[]): void {
  const changes = capture(connection, affected);
  if (changes.length > 0) runDelivery(() => deliverChange(changes));
}

/** Writes joined or left these stores' queues: every location in them may see a change, delivered as one. */
function refreshStores(connection: SdkConnection, stores: readonly StoreKey[]): void {
  changed(connection, [...locations.values()].filter((location) => stores.includes(location.store.resourceID)));
}

onPageConnection((connection) => connection.observeQueue((stores) => refreshStores(connection, stores)));

/** Ends a location whose subscription the server ended: each listener hears the error and is removed. */
function endLocation(location: Location, error: Error): void {
  if (locations.get(location.key) === location) locations.delete(location.key);
  const listeners = [...location.listeners];
  location.listeners.clear();
  for (const listener of listeners) {
    if (listener.onError) callPage(listener.onError, error);
  }
}

function listen(listenRef: Ref, kind: ListenerKind, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe {
  const connection = pageConnection();
  const { store, segments } = stateOf(listenRef);
  const key = locationKey(store.resourceID, segments);
  let location = locations.get(key);
  if (!location) {
    const created: Location = { key, store, segments, confirmed: null, listeners: new Set(), unsubscribe: () => undefined };
    locations.set(key, created);
    created.unsubscribe = connection.subscribe(store.resourceID, segments.join("/"), {
      onValue: (result, seq) => {
        created.confirmed = { segments, result, seq };
        changed(connection, [created]);
      },
      onEnd: (error) => endLocation(created, error),
    });
    location = created;
  }
  const listener: Listener = { kind, callback, onError, delivered: false, start: null, last: undefined, lastPending: false };
  const target = location;
  target.listeners.add(listener);
  if (target.confirmed !== null) {
    // Already known at this location: the listener starts from the view now,
    // delivered once onValue has returned its Unsubscribe, or before the
    // next change reaches it if that comes first.
    listener.start = viewAt(connection, store.resourceID, target.confirmed, segments);
    queueMicrotask(() => runDelivery(() => deliverStart(target, listener)));
  }
  return () => {
    if (!target.listeners.delete(listener) || target.listeners.size > 0) return;
    if (locations.get(key) === target) locations.delete(key);
    target.unsubscribe();
  };
}

export function onValue(valueRef: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe {
  return listen(valueRef, "value", callback, onError);
}

export function onChildAdded(parentRef: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe {
  return listen(parentRef, "child-added", callback, onError);
}

export function onChildChanged(parentRef: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe {
  return listen(parentRef, "child-changed", callback, onError);
}

export function onChildRemoved(parentRef: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe {
  return listen(parentRef, "child-removed", callback, onError);
}

// --- Reads ---

/** What the page sees at `segments` from a location it already listens at, or null when none holds it. */
function heldView(connection: SdkConnection, store: StoreKey, segments: Segments): View | null {
  for (const location of locations.values()) {
    if (!connection.sameStore(location.store.resourceID, store) || location.confirmed === null || !isWithin(segments, location.segments)) continue;
    return viewAt(connection, store, location.confirmed, segments);
  }
  return null;
}

async function fetchView(connection: SdkConnection, store: StoreKey, segments: Segments): Promise<View> {
  const reply = await connection.request({ type: "get", ...(store === null ? {} : { resourceID: store }), path: segments.join("/") });
  if (reply.type !== "value") throw resourceError("unavailable", "The server answered a read unexpectedly.");
  return viewAt(connection, store, { segments, result: reply.result, seq: reply.seq }, segments);
}

export async function get(getRef: Ref): Promise<Snapshot> {
  const connection = pageConnection();
  const { store, segments } = stateOf(getRef);
  const view = await fetchView(connection, store.resourceID, segments);
  return new JsonSnapshot(getRef, view.value, view.pendingPaths);
}

// --- Writes ---

function pendingNow(connection: SdkConnection, store: StoreKey): Segments[] {
  return connection.queue().flatMap((queued) => (connection.sameStore(queued.store, store) ? (queued.local as LocalWrite).paths : []));
}

/**
 * Queues a write and shows it at once. It is checked first as the server
 * would check it against an empty store, so a write that could never apply
 * is refused before anything is shown. Size is left to the server, which
 * alone knows whether the containers the write lands in are arrays or
 * objects.
 */
function queueWrite(
  writeRef: Ref,
  wire: PageWrite,
  apply: JsonWrite,
  paths: readonly Segments[],
  onMismatch?: (current: JsonReadResult) => void,
): Promise<WriteOutcome> {
  const { store } = stateOf(writeRef);
  const connection = pageConnection();
  const now = connection.serverNow();
  applyJsonWrite(undefined, apply, { now }, { checkSize: false });
  const local: LocalWrite = { apply, paths, now };
  return connection.write(store.resourceID, wire, local, onMismatch);
}

/** Runs `start`, turning a synchronous throw into a rejection. */
function settled<T>(start: () => Promise<T>): Promise<T> {
  try {
    return start();
  } catch (error) {
    return Promise.reject(error);
  }
}

// Each write shows the value decoded from what it sends, so changes the page
// later makes to the objects it passed reach neither the server nor the view.

export function set(setRef: Ref, value: WriteValue): Promise<void> {
  return settled(() => {
    requireArtifactPage();
    const { segments } = stateOf(setRef);
    validateWriteValue(value);
    const path = segments.join("/");
    const encoded = encodeWriteValue(value);
    return queueWrite(setRef, { kind: "set", path, value: encoded }, { kind: "set", path, value: decodeWriteValue(encoded) }, [segments]);
  }).then(() => undefined);
}

export function update(updateRef: Ref, values: Record<string, UpdateEntryValue>): Promise<void> {
  return settled(() => {
    requireArtifactPage();
    const { segments } = stateOf(updateRef);
    validateUpdateValues(values);
    const path = segments.join("/");
    const encoded = encodeUpdateEntries(values);
    const entries = decodeUpdateEntries(encoded);
    const paths = entries.map(([key]) => [...segments, ...parsePath(key)]);
    return queueWrite(updateRef, { kind: "update", path, entries: encoded }, { kind: "update", path, entries }, paths);
  }).then(() => undefined);
}

export function push(parentRef: Ref, value?: WriteValue): ThenableRef {
  requireArtifactPage();
  const { store, segments } = stateOf(parentRef);
  const key = generatePushKey();
  const childSegments = [...segments, key];
  // push makes a reference, so it refuses a too-deep path as child does.
  checkPathSegments(childSegments);
  const done =
    value === undefined
      ? Promise.resolve()
      : settled(() => {
          validateWriteValue(value);
          const encoded = encodeWriteValue(value);
          const wire: PageWrite = { kind: "push", path: segments.join("/"), key, value: encoded };
          return queueWrite(parentRef, wire, { kind: "set", path: childSegments.join("/"), value: decodeWriteValue(encoded) }, [childSegments]);
        }).then(() => undefined);
  return new JsonThenableRef(store, childSegments, done);
}

export function remove(removeRef: Ref): Promise<void> {
  return settled(() => {
    requireArtifactPage();
    const { segments } = stateOf(removeRef);
    const path = segments.join("/");
    return queueWrite(removeRef, { kind: "remove", path }, { kind: "remove", path }, [segments]);
  }).then(() => undefined);
}

/**
 * A compare-and-set loop (specs/arch/resources/json-store.md#^js-arch-transactions).
 * Each attempt is shown as an unconfirmed write; a mismatched attempt is
 * replaced by the next one as it leaves the queue.
 */
export function runTransaction(
  transactionRef: Ref,
  fn: (current: JSONValue | undefined) => JSONValue | undefined,
): Promise<{ committed: boolean; snapshot: Snapshot }> {
  return settled(async () => {
    const connection = pageConnection();
    // While the page is disconnected the transaction fails without calling its function.
    connection.requireReachable();
    const { store, segments } = stateOf(transactionRef);
    const path = segments.join("/");
    const first = heldView(connection, store.resourceID, segments) ?? (await fetchView(connection, store.resourceID, segments));
    const start: JsonReadResult = first.value === undefined ? { exists: false } : { exists: true, value: first.value };
    return new Promise<{ committed: boolean; snapshot: Snapshot }>((resolve, reject) => {
      const finish = (committed: boolean, value: JSONValue | undefined) =>
        resolve({ committed, snapshot: new JsonSnapshot(transactionRef, value, pendingNow(connection, store.resourceID)) });
      const attempt = (current: JsonReadResult, calls: number): void => {
        let result: JSONValue | undefined;
        try {
          result = fn(current.exists ? structuredClone(current.value) : undefined);
          if (result === undefined) {
            finish(false, current.exists ? current.value : undefined);
            return;
          }
          validateJsonValue(result);
          // A copy, so the page's later changes to the object it returned do not show.
          const committed = structuredClone(result);
          queueWrite(
            transactionRef,
            { kind: "compare-and-set", path, expected: current, value: committed },
            { kind: "set", path, value: committed },
            [segments],
            (now) => {
              if (calls >= MAX_TRANSACTION_CALLS) {
                reject(resourceError("max-retries", `The transaction's function was called ${MAX_TRANSACTION_CALLS} times without a commit.`));
                return;
              }
              attempt(now, calls + 1);
            },
          ).then((outcome) => {
            if (outcome.kind === "applied") finish(true, committed);
          }, reject);
        } catch (error) {
          reject(error);
        }
      };
      attempt(start, 1);
    });
  });
}
