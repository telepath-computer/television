*The JSON store architecture: the `json` resource type's content file, path and value rules, limits, how the server applies writes and server-filled values, push keys, the transaction protocol, subscriptions, the SDK's functions and its local-write model, durability failures, and the `tv resource json` CLI integration.*

# JSON store architecture

The JSON store keeps one JSON value per store and lets pages and agents change it while others watch. The server applies each store's writes one at a time and saves each to disk before anyone sees it; the SDK shows a page its own writes at once and reconciles them with what the server confirms. This document defines those mechanisms and the types artifact code uses.

## What this owns

This spec owns the implementation of the `json` [resource type](./index.md#^rs-type-contract): its content file, path and value validation, limits, write application, server-filled values, push keys, transactions, subscriptions, the SDK functions and types for stores, the SDK's local-write model, and the `tv resource json` CLI integration. User-facing behavior is owned by [product/resources/json-store.md](../../product/resources/json-store.md). Resource IDs, artifacts' stores, manifests, routes, connections, bindings and events are owned by [the resource architecture](./index.md).

## The content file

A store's value is `content.json` in its [directory](./index.md#^rs-storage): the value written as compact JSON text, with no wrapper, which a person or agent can read, copy or restore directly; any JSON text reads back. A store with no value has no `content.json`, so a stored `null` and a missing value stay distinct across a restart. Removing the whole value deletes the file. A `content.json` that exists but cannot be read, does not parse as JSON, or holds a value that breaks the limits below makes the store unavailable when it [loads](./index.md#^rs-load); it is never mistaken for a missing value. ^js-arch-content-file

## Paths and values

The shared module parses a path by splitting it on `/` and dropping empty segments; the empty list addresses the whole value. Every segment is a key of at most 768 UTF-8 bytes. A segment of ASCII digits with no leading zero, or `0` itself, is an *index*: it addresses an array element when the value at its parent is an array, and an object member otherwise. Reading through an array with a segment that is not an index below the array's length finds no value. ^js-arch-paths

A written value must be JSON: `null`, a boolean, a finite number, a string, an array or a plain object. Object keys follow the key rule above. Anything else, including `undefined`, `NaN`, functions and class instances, is refused with `invalid-value`. In a value passed to `set`, `push` or `update`, a server-value placeholder may stand in for any value, and in `update` a delete placeholder may stand for an entry. Placeholders are carried apart from the plain JSON in requests, so any plain value, including an object with a key such as `.sv`, is stored exactly as written. ^js-arch-values

Applying a write at a path:

1. Wherever a segment's parent is an array, the segment must be an index less than the array's length; otherwise the write is refused with `invalid-path`.
2. To set a value, walk the path from the root, replacing each parent that is missing, or a string, number, boolean or `null`, with `{}`, then set the final segment.
3. To delete, remove the final segment from its parent. Deleting an array element is refused with `invalid-path`. When the path has no value, deleting changes nothing and creates no parents.

An `update` applies all its entries as one write. It is refused with `invalid-path` when two of its keys, once parsed, address the same path or one lies within the other, such as `a` and `a/b`, or `a` and `a/`.

Two values are equal when they are deeply equal as JSON, ignoring object key order. Children are ordered by key: index keys first in numeric order, then other keys by UTF-16 code unit order. ^js-arch-apply

## Limits

| Limit | Value |
|---|---|
| A store's value, serialized as compact JSON | 1 MiB (1,048,576 bytes) |
| Depth of any value in a store, and segments in a path | 32 |
| A key | 768 UTF-8 bytes |
| Calls of a transaction's function | 25 |
| A write's message, as sent | 16 MiB (16,777,216 bytes) |

A value's *depth* is the number of keys on its path from the store's root: the root value has depth 0, and each member or element is one deeper than its parent. A path of more than 32 segments is refused with `invalid-path`, and so is a write whose result would put any value at a depth over 32, whether through the path it writes at, the written value's own nesting, or both. A write whose result would exceed the size limit is refused with `too-large`. A refused write changes nothing. ^js-arch-limits

A write's *message* is the page connection message or the administrative request body that carries it, counted in UTF-8 bytes. The message limit bounds what is sent, as the size limit bounds what is stored. The two differ because an `update` may carry any number of entries, and server values travel apart from the plain JSON, so a message can be many times the size of the value it leaves. The client that would send a write measures its message first, and refuses one over the limit with `too-large` without sending it: the SDK ([local writes](#^js-arch-local-writes)), and the shared client that the CLI uses ([commands](#^js-arch-cli)). A write the server could never receive is therefore never sent. The server accepts no larger message on either route family. It closes a page connection that sends one with WebSocket status 1009, and refuses a larger administrative request with `too-large`. ^js-arch-write-limit

## Applying writes

Each store has one queue. The server applies each write in it completely before the next:

1. It computes the new value from the current one, filling server values: `serverTimestamp()` with the server's clock in milliseconds since the Unix epoch, and `increment(n)` with the number at that position before this write plus `n`, or `n` when that position holds no number.
2. It validates the result against the limits.
3. It saves the new value under the [storage rule](./index.md#^rs-storage): it rewrites `content.json`, or deletes it when the store is left with no value. A write to an artifact's store that has not been written before is [its first write](./index.md#^rs-first-write), which saves the artifact's pointer and the manifest first.
4. It replaces the in-memory value, sends subscription updates, and emits `changed`.
5. It acknowledges the write.

The `changed` event a write emits lists in `paths` each path the write touched, as its segments joined with `/`, the whole value being the empty string: the path of a `set` or a `remove`; a `push`'s path with the new key; each entry's path below an `update`'s path, in the order of its entries; and the path of a transaction's write. A write can change the value at a path only when one of these paths equals that path, contains it or lies within it, so a client following one path can pass over events for writes elsewhere. ^js-arch-changed-paths

A write that fails at any step before step 4 leaves the in-memory value and the stored value unchanged, unless the failure comes after the rename has replaced the file, where [the rule for an uncertain write](#^js-arch-uncertain) applies. Reads and subscription registration use the in-memory value between writes. Creating a store also runs through this rule. ^js-arch-apply-writes

When saving `content.json` fails after the rename has replaced it, or after its deletion, the write's outcome is [uncertain](./index.md#^rs-arch-uncertain-save). The server reads `content.json` back, or finds it gone, and takes the value it holds, or no value, as the store's value. Since the rename or deletion has happened, that is the write's result, and the server finishes step 4 with it as for an applied write, so subscribers hear it and `changed` is emitted. Then, in place of step 5, it refuses the write with `unavailable` and a message saying that its outcome is unknown. When the file cannot be read back, or what it holds is not a valid value, the value before the write stands and the write is refused the same way. Either way the store stays available, and a failure before the rename leaves it available too. ^js-arch-uncertain

The server answers a page's `get` and registers a page's subscription after all of the page's earlier writes on the same connection have been applied, and every value it sends a page carries the highest [sequence number](./index.md#^rs-write-sequence) of that connection's writes it includes. ^js-arch-read-order

## Push keys

`push` keys are generated by the client that pushes, by the shared module, in the form Firebase uses: 20 characters from the alphabet `-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz`, whose ASCII order is its sort order. The first 8 characters encode the client's clock in milliseconds since the Unix epoch, most significant first; the last 12 are random, from `crypto.getRandomValues`. When a client generates two keys in the same millisecond, it increments the random part of the previous key instead of drawing a new one, so one client's keys sort in creation order. The shared module's generator is adapted from the Firebase JavaScript SDK's and carries its attribution ([adapted code](../../product/licensing.md#^licensing-adapted-code)). ^js-arch-push-keys

## Transactions

A transaction is a compare-and-set loop driven by the SDK:

1. The SDK calls the function with the value at the reference as the page currently sees it, fetching it from the server first when no listener holds it.
2. When the function returns `undefined`, the transaction aborts without sending anything and resolves with `committed` false.
3. Otherwise the SDK sends a compare-and-set write carrying the value the function saw, or its absence, and the function's result.
4. The server applies the write only when the value at that path equals the value the function saw. Otherwise it refuses the write and returns the current value at the path, and the SDK calls the function again with it.
5. When the function has been called the limit's number of times without a commit, the SDK rejects with `max-retries`.

Each attempt's result is shown locally as an unconfirmed write, replaced by the next attempt and rolled back on abort or failure. A transaction resolves with `committed` and a snapshot of the value at the reference after it. While the page is [disconnected](./sdk.md#^sdk-reconnect), `runTransaction` rejects with `disconnected` without calling the function, and a transaction whose attempt or fetch is outstanding when the connection is lost rejects with `disconnected`. ^js-arch-transactions

## Subscriptions

The wire has one subscription kind: the value at a path. On registration the server sends the current value, then sends it again after each applied write that changes its existence or its value. ^js-arch-subscriptions

## SDK functions

```ts
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

/** A placeholder the server fills in when it applies the write. */
export interface ServerValue { readonly __serverValue: unique symbol }
/** A placeholder that deletes its path; accepted only as an entry of update(). */
export interface DeleteSentinel { readonly __deleteSentinel: unique symbol }
/** A JSON value in which a ServerValue may stand in for any value. */
export type WriteValue = JSONValue | ServerValue | WriteValue[] | { [key: string]: WriteValue };

/** The page's own store has no resource ID here: getStore() leaves it null. */
export interface Store { readonly resourceID: string | null }

export interface Ref {
  readonly key: string | null;   // the last path key; null at the root
  readonly parent: Ref | null;   // null at the root
  readonly root: Ref;
  readonly path: string;         // keys joined with "/"; "" at the root
}

export interface ThenableRef extends Ref, Pick<Promise<Ref>, "then" | "catch" | "finally"> {}

export interface Snapshot {
  readonly key: string | null;
  readonly ref: Ref;
  exists(): boolean;
  val(): JSONValue | undefined;  // undefined when the path has no value
  child(path: string): Snapshot;
  forEach(fn: (child: Snapshot) => boolean | void): boolean;  // child order; true from fn stops, and forEach then returns true
  readonly size: number;         // number of children: array length, object key count, else 0
  readonly metadata: { readonly hasPendingWrites: boolean };
}

export function getStore(resourceID?: string): Store;
export function ref(store: Store, path?: string): Ref;
export function child(parent: Ref, path: string): Ref;

export function get(ref: Ref): Promise<Snapshot>;
export function set(ref: Ref, value: WriteValue): Promise<void>;
export function update(ref: Ref, values: Record<string, WriteValue | DeleteSentinel>): Promise<void>;
export function push(ref: Ref, value?: WriteValue): ThenableRef;
export function remove(ref: Ref): Promise<void>;
export function runTransaction(
  ref: Ref,
  fn: (current: JSONValue | undefined) => JSONValue | undefined,
): Promise<{ committed: boolean; snapshot: Snapshot }>;

export function onValue(ref: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe;
export function onChildAdded(ref: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe;
export function onChildChanged(ref: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe;
export function onChildRemoved(ref: Ref, callback: (snapshot: Snapshot) => void, onError?: (error: Error) => void): Unsubscribe;

export function serverTimestamp(): ServerValue;
export function increment(n: number): ServerValue;
export function deleteValue(): DeleteSentinel;
```

`Unsubscribe` is the [layer's](./sdk.md#The layer's functions). `getStore` is the type's accessor: without an argument it returns the artifact's own store, and with a resource ID a store bound to the artifact, and it follows the [handle rules](./sdk.md#^sdk-handles). Path arguments are validated when the reference is made; an invalid one throws `invalid-path`. `push` generates its key synchronously and returns a reference that is also a promise of the write, with `then`, `catch` and `finally`. It resolves with a reference to the new child, one that is not itself a promise, when the write is confirmed, and rejects when it is refused; without a value it resolves at once and sends nothing. `remove` and `deleteValue` delete; `set(ref, null)` stores `null`. Each child-event callback receives the child's snapshot. ^js-arch-sdk

The JSON store's error codes, added to [the layer's](./index.md#Errors), are: ^js-arch-errors

```ts
type JsonStoreErrorCode = "invalid-path" | "invalid-value" | "too-large" | "max-retries";
```

## Local writes in the SDK

For each location the page reads, the SDK keeps the last value the server sent, the *confirmed value*, with the sequence number it carries. `get` fetches the confirmed value from the server and resolves with what the page sees at that location. The page's unconfirmed writes form one queue in sequence order. What the page sees at a location is its confirmed value with every queued write to the location's store whose sequence number is higher than the confirmed value's applied in order, using the [write rules](#^js-arch-apply). The artifact's own store is one store by either address, without a resource ID and, while the page's access gives it ([sdk.md](./sdk.md#Handles)), by its resource ID, so a write through either address shows at the locations of both and counts for their `hasPendingWrites`. When the access stops giving it, as when a destroy takes it away, a write still queued through that resource ID no longer shows at the locations without one. ^js-arch-local-writes

- A write is queued and shown at once, then sent. When the page's access to the write's store is known to be `read`, the SDK rejects it with `read-only` instead and queues nothing. A write whose message would exceed the [message limit](#^js-arch-write-limit) is rejected the same way, with `too-large`, and so is every write made while the page is [disconnected](./sdk.md#^sdk-reconnect), with `disconnected`.
- Server values are estimated when shown: a timestamp from the page's clock corrected by the server time received when the connection opened, and an increment from the number the page currently sees at that position.
- Because the server sends a write's subscription updates before its acknowledgement ([index.md](./index.md#^rs-notify-before-ack)), the acknowledgement removes a write whose effect the confirmed value already holds.
- A refused write is removed from the queue, the affected locations are recomputed, and its promise rejects with the server's error.
- When the connection is lost, or closes before its opening state arrives, every queued write is removed from the queue at once, the affected locations are recomputed, and each write's promise rejects with `disconnected`. The server may still apply such a write ([index.md](./index.md#^rs-write-sequence)), and it then reaches the page as another client's change does: in the value the next connection's subscription sends if the server applied it before then, or in a later update.
- A snapshot's `hasPendingWrites` is true when a queued write's path equals, contains or lies within the snapshot's path. When a location's last such write leaves the queue, its `onValue` listeners receive a snapshot with `hasPendingWrites` false, whether or not the value changed.
- Listeners are called only when what they see changes, apart from that `hasPendingWrites` notification to `onValue` listeners. After a reconnection, a listener is called only when the value differs from the last one it received.
- Child events are computed by comparing a location's successive values: keys present only in the new object are added, keys present only in the old are removed, and keys present in both with unequal values are changed, delivered in child order. A value that is not an object has no children. The first value delivers `onChildAdded` for every child. A child-event callback is called only for these changes, and a change of `hasPendingWrites` alone calls no child-event callback.
- A snapshot that a listener receives, from `onValue` or a child event, shows the moment of the change that called the listener: its value and its `hasPendingWrites` both stand as they did when that change happened. A write that a callback makes while listeners hear a change is a later change, so neither shows it, even in snapshots delivered after the write was made.

## Commands

The `tv resource json` verbs call the shared client's JSON store methods over the administrative routes, and `watch` also reads [the `/events` stream](./index.md#^rs-events-stream):

```ts
interface JsonStoreClient {
  /** With the bindings flag on: creates a store and resolves with its summary, which carries its resource ID. */
  create(input: { description: string; usage?: string; value?: JSONValue }): Promise<ResourceSummary>;
  get(input: { store: StoreAddress; path: string }): Promise<{ exists: true; value: JSONValue } | { exists: false }>;
  set(input: { store: StoreAddress; path: string; value: JSONValue }): Promise<void>;
  update(input: { store: StoreAddress; path: string; values: Record<string, JSONValue> }): Promise<void>;
  push(input: { store: StoreAddress; path: string; key: string; value: JSONValue }): Promise<void>;
  remove(input: { store: StoreAddress; path: string }): Promise<void>;
  /** Calls onValue with the value at the path, then again whenever a read finds it changed, until signal aborts or the stream's connection ends. */
  watch(input: {
    store: StoreAddress;
    path: string;
    onValue: (result: { exists: true; value: JSONValue } | { exists: false }) => void;
    signal?: AbortSignal;
  }): Promise<void>;
}
```

Each verb but `create` takes exactly one of `--artifact` and `--resource`, passed as the [`StoreAddress`](./index.md#^rs-records) `artifactID` or `resourceID`; neither, or both, is a directive error that makes no call. Its confirmation line names the store as the product spec gives it. `create` without `--description` is a directive error that makes no call, and it prints the new store's resource ID as the product spec gives it. The CLI parses each value argument or file as JSON before calling, and refuses text that does not parse as a directive error. `push` generates its key with the shared module before calling and prints it. The shared client refuses a write whose request body would exceed the [message limit](#^js-arch-write-limit) with `too-large` without sending it, and the CLI prints that refusal as it prints the server's. `watch` ends with status 0 on `SIGINT` or `SIGTERM` and fails like any unreachable-server command when the connection ends. ^js-arch-cli

`watch` follows the value at its path through [the `/events` stream](./index.md#^rs-events-stream) and `get`:

1. It opens the stream and waits for the stream's first message, after which every resource event reaches it.
2. It reads the value at its path with `get` and passes the result to `onValue`.
3. For each `changed` event for its store, recognized by the address it was given (the event's `artifactID` or `resourceID`), that lists a path equal to its own, containing it or lying within it ([changed paths](#^js-arch-changed-paths)), it reads the value again. Reads run one at a time, the first included: when such events arrive during a read, it reads once more after that read, however many arrived. It passes a result to `onValue` only when the result differs from the last one passed, under [the store's equality](#^js-arch-apply).
4. Given a resource ID, it fails with `not-found` when a `destroyed` event names that resource ID. Given an artifact, it treats a `destroyed` event naming that artifact as a change at the root, since [destroying an own store](./index.md#^rs-destroy-order) leaves the artifact's store with no value until its next write. It fails with a read's refusal when a read is refused.

Following an artifact's store by its artifact's ID covers a `watch` started before the store's first write, whose `changed` events carry a resource ID that `watch` did not know when it started. The server emits `changed` only after the write is stored ([applying writes](#^js-arch-apply-writes)), and each read starts after the event that called for it, so once writes stop, the last value `watch` passed equals what is stored. A value the store held only between two reads is never passed, as [the product spec](../../product/resources/json-store.md#^js-watch) accepts. ^js-arch-watch

## Testing

Local-write coverage must run the SDK in a real browser against a running server, including a write the server refuses after the page showed it, a connection lost while the page has unconfirmed writes, one of which the server applied before the loss, using `increment` so that applying a write twice would show, and writes and reads made while the page is disconnected.
