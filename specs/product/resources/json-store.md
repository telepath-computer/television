*The JSON store: the resource type that keeps one persistent JSON value, read, written and observed live by artifacts through an API inspired by Firebase's and by agents through `tv resource json` — its data semantics, writes, instant local writes, transactions, observation, storage guarantees and commands.*

# JSON store

A JSON store keeps one JSON value on the Television server, such as a task list's items or a form's answers, so that an artifact's page and an agent can both read it, change it and watch it change. Its JavaScript interface is inspired by the Firebase Realtime Database's modular API, so it feels familiar to developers who know that API, and it stores plain JSON exactly as written.

## What this owns

This spec owns the user-facing behavior of the `json` [resource type](./resources.md): its data semantics and paths, its operations, how a page sees its own writes, transactions, observing changes, which operations are reads and writes, its storage guarantees, and the `tv resource json` commands with their output. An artifact's store, resource IDs, descriptions and usage, share links, access levels, events, created stores and bindings, and the common commands are owned by [the resources spec](./resources.md). The SDK's types and the implementation are owned by [the JSON store architecture](../../arch/resources/json-store.md).

## The store

A *JSON store* is a resource of type `json`. It holds one JSON value: an object, an array, a string, a number, a boolean or `null`, or no value at all. [An artifact's store](./resources.md#^rs-artifact-store) starts with no value. A store created explicitly, which only [the bindings flag](./resources.md#^rs-flag) allows, is created with a starting value, which is `{}` unless another is given.

An artifact's page uses its store like this:

```js
import { getStore, ref, onValue, push, update } from "/sdk/v1/resources.js";

// Content: { items: { <key>: { title: string, done: boolean } } }.
// The page adds items and marks them done; agents do the same.
const db = getStore();
const items = ref(db, "items");

onValue(items, snap => render(snap.val() ?? {}));

const added = push(items, { title: "Buy milk", done: false });
await update(ref(db), { [`items/${added.key}/done`]: true });
```

References point at slash-separated paths. A page uses `get`, `set`, `update`, `push`, `remove`, `runTransaction`, `onValue`, the child events, `serverTimestamp()` and `increment()`. Their forms will be familiar to developers who know the Firebase Realtime Database's modular API, but the store is Television's own: this spec, not Firebase's, defines how they behave, and the differences below are deliberate. Queries such as `orderByChild`, `onDisconnect` and offline persistence do not exist. ^js-api

## Paths

A path is a sequence of keys separated by `/`, such as `items/abc/done`. Empty segments, including leading and trailing slashes, are ignored, so `""` and `"/"` both address the whole value. A key that is a whole number written without leading zeros, such as `0` or `12`, addresses an array element when the value at its parent is an array, and an object member otherwise. ^js-paths

## Data semantics

The store keeps plain JSON. Firebase treats `null` as absence and turns arrays into objects with numeric keys; the store does neither. ^js-plain-json

- `null` is a stored value. `{}` and `[]` are stored and read back unchanged.
- A path with no value is distinct from `null`: its snapshot's `exists()` is false and its `val()` is `undefined`.
- `set(ref, null)` stores `null`. Deleting is explicit: `remove(ref)` deletes the value at a path, and `deleteValue()` deletes a path inside `update`.
- Writing below a path that has no value creates the missing parents as objects. Writing below a string, number, boolean or `null` replaces it with an object.
- Arrays stay arrays. A path can read into an array, and `set` can replace an existing element. Inserting, deleting and reordering elements is done by writing the whole array, directly or in a transaction. A write that would add an element through a path, delete one, or reach below a missing element is refused. ^js-arrays
- Every object key in a written value is a non-empty key without `/`, so every member can be addressed by a path; a value with any other key is refused.
- A store's value has a size limit, and writes that would exceed it are refused. A single write also has a size limit as it is sent, and the page or command that would send a larger one refuses it without sending it.

Lists that several clients edit use `push` rather than array indexes, so concurrent additions never collide.

## Writes

- `set` replaces the value at a path.
- `update` applies several writes at once, all or nothing. Its keys are paths relative to the reference, and they must not overlap: no key's path may lie within another key's path.
- `push` adds a child under a new key and returns the new reference immediately, before the write is confirmed; the reference is also a promise of the write. Keys are generated by the client that pushes and sort in creation order. `push` without a value only generates the reference and writes nothing. `push` below an array is refused.
- `remove` deletes the value at a path. Removing a path with no value succeeds and changes nothing.
- `serverTimestamp()` and `increment(n)` can appear anywhere in a value passed to `set`, `push` or `update`, including nested inside objects. The server fills them in when it applies the write: the timestamp as milliseconds since the Unix epoch, and the increment as the current number at that position plus `n`, or `n` when there is no number there. `deleteValue()` is accepted only as an entry in `update`. ^js-server-values

The server applies the writes to one store one at a time, and the last write to a path wins. A write is confirmed only after the server has saved it to disk, and other clients see it only then, apart from a write whose save the server cannot confirm ([below](#^js-uncertain-write)). While a page stays connected, its writes are applied in the order the page made them. Each write is sent once, on one connection, so none is applied twice. ^js-write-order

## The page sees its own writes immediately

The SDK applies a page's write to what the page's listeners see at once, then confirms it with the server. Listeners see the confirmed value with the page's unconfirmed writes applied in order. When the server confirms a write, it becomes part of the confirmed value. When another client's change arrives, the page's unconfirmed writes are applied again on top of it. When the server rejects a write, the SDK rolls it back and the write's promise rejects. ^js-local-writes

A snapshot's `metadata.hasPendingWrites` is true when it includes unconfirmed writes. When the last unconfirmed write at a location is confirmed, that location's `onValue` listeners receive a snapshot with `hasPendingWrites` false, even if the value is unchanged, so a page can clear a "saving" indicator. Child events fire only for the changes they name, so a confirmation that changes no child calls no child-event callback; a page that shows a saving state watches it with `onValue`. ^js-pending-flag

Server-filled values are estimated for display and replaced by the server's values on confirmation.

When the SDK already knows that the page's access to the store is `read`, it rejects a write before showing anything. If the page's access changes while it is open, the server rejects the write and it rolls back like any other rejected write. ^js-read-local

There is no offline mode. When the connection is lost, the page's unconfirmed writes are rolled back at once, with their promises rejected. A write rolled back this way may still be saved, because the server may have received it before the connection was lost. The server may apply such a write after the loss, even after writes the page makes once it reconnects, so it can replace a newer value at the same path. Whenever the server applies it, the page's listeners hear it once the page is connected again, as they hear another client's change. While the page is [disconnected](./resources.md#^rs-connection), every write and `get` fails at once, and such a write is never shown: `push` still returns its reference, whose promise rejects. Firebase would show writes made offline and send them later; the store refuses them. Nothing a page wrote is sent again after the connection returns. ^js-disconnect

## Transactions

`runTransaction(ref, fn)` calls `fn` with the value at `ref`, or `undefined` when there is none, and writes the value `fn` returns only if the value at `ref` has not changed since `fn` saw it. Otherwise it calls `fn` again with the current value, up to a retry limit, after which it fails. When `fn` returns `undefined`, the transaction aborts without writing and resolves with `committed` false. A transaction's result is plain JSON. ^js-transactions

## Observing

- `onValue` delivers the current value as soon as it is known, then again after every change that alters it. ^js-on-value
- Child events apply to object values. `onChildAdded` fires for each existing child and then for each new one, `onChildChanged` when a child's value changes, and `onChildRemoved` when a child is deleted. Children are visited in key order: whole-number keys without leading zeros come first in numeric order, then the other keys in lexicographic order, so pushed children arrive in creation order. ^js-child-events
- After a lost connection, the SDK reconnects and resubscribes on its own. Listeners stay registered while the page is disconnected, including those added then. A listener whose value changed in the meantime receives the current value; intermediate values are not replayed. ^js-reconnect
- An exception thrown by a page's callback does not affect other listeners or the connection.
- When the page can no longer reach the store, as when the share link it was opened through is revoked, or, with the bindings flag on, when its binding to a store is removed or that store is destroyed ([live bindings](./resources.md#^rs-binding-live)), its listeners on that store receive an error and stop.
- When its own store is [destroyed](./resources.md#^rs-destroy-bound), the page can still reach its own store, which has no value until its next write creates a new one: its listeners hear the root with no value, as after removing the whole value, and stay in place.

## Access

`read` access allows `get`, `onValue` and the child events. `set`, `update`, `push` with a value, `remove` and transactions are writes. ^js-access

## Storage

The server is the only writer of a store's data. Each store is saved so that a crash leaves either the previous value or the new one, never a partial one. Stored data the server cannot read is reported as unavailable when the store is first used ([resources.md#^rs-status](./resources.md#^rs-status)) and left unchanged, never reset, while other stores keep working. ^js-storage

When the server cannot confirm that a write reached the disk, it refuses the write, saying that its outcome is unknown, and the store takes the value its saved data holds, which is ordinarily the write's result. Listeners and other clients see that value as they see any change, and the writing page sees its write's promise reject. When the saved data cannot be read back, or is not valid, the value from before the write stands, and the next successful save writes it. Either way the store stays available, so a client can read what it holds and retry. A value kept this way may not yet be durable: if the machine crashes before the store's next successful save, it can be lost, and the store returns with an earlier value. This is accepted so that a passing disk error leaves the store usable. ^js-uncertain-write

## Commands

```bash
tv resource json get    <store> [<path>]
tv resource json set    <store> [<path>] (<value> | --file <path>)
tv resource json update <store> [<path>] (<values> | --file <path>)
tv resource json push   <store> <path> (<value> | --file <path>)
tv resource json remove <store> <path>
tv resource json watch  <store> [<path>]
tv resource json create --description <text> [--usage <text>] [<value> | --file <path>]
```

`<store>` is exactly one of two options, so no argument's meaning depends on its shape: ^js-cli-store

- `--artifact <artifact-id>` reaches that artifact's own store. This is the common case, and it works before the store's first write.
- `--resource <resource-id>` reaches any store by its resource ID, including a deleted artifact's, since deleting an artifact does not delete its store. This works whatever [the bindings flag](./resources.md#^rs-flag).

`create` makes a store, with the flag on only. It requires `--description`, which must be one line, and sets the store's [usage](./resources.md#^rs-usage) when `--usage` is given.

A value is JSON text given as one argument, or read from the file `--file` names, where `-` means standard input; a command refuses both at once. `<values>` for `update` is a JSON object whose keys are paths relative to `<path>`. A path argument of `/` addresses the whole value, as an omitted optional path does. When `set` or `update` receives one argument after the store and no `--file`, that argument is the value and the path is the whole value. Values from the command line are plain JSON: they carry no server-filled values or delete markers. ^js-cli

| Command | Success output |
|---|---|
| `create` | `{"resourceID":"<resource-id>"}`, the new store's resource ID. |
| `get` | `{"exists":true,"value":<value>}`, or `{"exists":false}` when the path has no value. |
| `set`, `update`, `remove` | `JSON store <store> updated.`, where `<store>` is `of artifact <artifact-id>` or `<resource-id>`, as the command addressed it. |
| `push` | `{"key":"<new-key>"}` |
| `watch` | The `get` output for the current value, then again whenever that value changes, one line each. It runs until interrupted, and fails like any command that cannot reach the server when its connection ends. |

`get` reports a missing path distinctly from `null`, and an artifact's store before its first write as having no value. Commands on a store that is unavailable, or on a resource of another type, fail with a message saying so. A command naming an artifact that does not exist fails with `Artifact not found: <artifact-id>`, and one naming an artifact that has no store says that only artifacts this server serves from its own files, with IDs Television generated, have one. A resource ID that names no store fails with `Resource not found: <resource-id>`. The commands act with the server's administrative authority, so they reach a store whatever access its pages have.

`watch` converges on the stored value: once changes stop, its last line shows what is stored at its path. When changes arrive faster than it reads them, it skips the values in between, and a value that changes and changes back between two reads prints nothing. This is deliberate. `watch` learns of changes from the server's event stream and reads the value after each one that can affect its path, so the server keeps nothing for it, and an agent watching a store needs its current state rather than every step. ^js-watch
