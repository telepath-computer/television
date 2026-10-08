> **Archived 2026-10 from PR #29.** This proposal set out the resource API this change delivers: each artifact's own JSON store, share links, and created stores and bindings behind a flag that is off as shipped. The specs follow it with later decisions it does not record, among them a store for every local path artifact rather than every HTML artifact, `read-write` share links refused only for Markdown artifacts, link addresses that the server provides, and agent guidance that leaves where an artifact's state lives to the agent's judgment and highly discourages localStorage, where section 9 kept localStorage for one client's state; it preserves the design's intent and its reasons as one statement, which the individual specs and the diff do not give together. The task record it links to was not archived. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Proposal: artifact data in JSON stores, and share links

**Status:** draft for Josh's review. Once approved, its decisions are written into the owning specs under the spec workflow, and the code follows.

This proposal describes how Television keeps data for HTML artifacts. Each HTML artifact has its own *JSON store*, a persistent JSON value that the artifact's pages and agents read, write and observe live. An artifact can have a *share link*, which gives other people access to it at a chosen level. The JSON store is the first type of *resource*, the general concept underneath it. Stores that agents create and bind to artifacts are available behind a feature flag that is off by default.

## 1. Summary

HTML artifacts often need data that outlives the page and that more than one party uses: a to-do list that the person checks off and the agent adds to, a form an agent reads later, a counter several viewers update. Browser storage such as `localStorage` cannot hold such data: each browser keeps its own copy, no other viewer sees it, and the agent cannot reach it.

Television provides:

- **A JSON store for every HTML artifact.** A page calls `getStore()` from a JavaScript SDK that the server serves and gets its artifact's store, with nothing to create or bind. The agent reads and writes the same store from the shell with `tv resource json` commands that address it by the artifact's ID.
- **The JSON store's behavior.** Its SDK is inspired by the Firebase Realtime Database's modular API, so it feels familiar to developers who know that API, and it stores plain JSON exactly as written. A page sees its own writes at once, the server saves every write to disk before other clients see it, and a page can tell the person whether it is connected. There is no offline mode.
- **Share links.** An artifact can have one share link, at `read` or `read-write` level, which the agent can change or revoke at any time. The link reaches the artifact without revealing the artifact's own ID, and another Television host can add it to a channel as a shared artifact.
- **Created stores and bindings, behind a feature flag** that is off by default: an agent can create stores and bind any store to any artifact by its resource ID, many to many.
- **Agent guidance** in the bundled `television` skill, and **an onboarding showcase**: the Productivity channel's Company To-dos, a live to-do list kept in its own store.

A page reaches its data through the ID in its own address, the artifact's ID or a share ID. No ID, token or other secret goes into artifact source or passes through an agent's conversation.

## 2. Terms

- A *resource* is something the server keeps on behalf of artifacts and agents, with a lifetime independent of any artifact. Every resource has a *resource ID*, generated at random when the resource is created, and a description. A resource has no name: its ID is the only way to address it.
- A *resource type* defines what a resource holds and the operations on it. Television has one type, `json`.
- A *JSON store* is a resource of type `json`: one persistent JSON value.
- An *artifact's store*, or its *own store*, is the JSON store that belongs to one local HTML artifact, which uses it by default. It is an ordinary JSON store that its artifact is bound to at `read-write`.
- An *access level* is `read` or `read-write`.
- A *share link* is an address, `/artifact/<share-id>/`, that reaches one artifact at one access level. Its *share ID* is random and separate from the artifact's own ID.
- A *shared artifact* is an artifact on a channel whose document another Television host serves, added by that host's artifact address ([artifacts.md](../../../specs/product/artifacts.md)). A share link is such an address.
- The *feature flag* is a constant in the shipped code, off by default. With it on, an agent can create stores explicitly, and a *binding* grants one artifact access to one store, by its resource ID, at one access level. A store's *usage* is free text that describes its content and the rules its readers and writers follow.
- The *resource layer* is what every resource type shares: IDs, descriptions, storage, access checks, routes, the page connection, events and the common commands.
- The *resource SDK* is the browser module at `/sdk/v1/resources.js` through which a page uses its data. The *page connection* is the one WebSocket that the SDK opens for all of a page's resource traffic.

"Shared state" is not used as a name for this feature, because the channel-state specs use it for channel state synchronized between clients.

## 3. An artifact's store

### What pages and agents see

A page gets its artifact's store with `getStore()`:

```js
import { getStore, ref, onValue, set } from "/sdk/v1/resources.js";

// Content: { tasks: { <key>: { title: string, done: boolean, due?: "YYYY-MM-DD" } } }.
// The page sets only a task's done; agents add, change and remove tasks.
const db = getStore();
onValue(ref(db, "tasks"), (snap) => render(snap.val()));

function toggle(key, done) {
  return set(ref(db, `tasks/${key}/done`), done);
}
```

- **The store exists from the moment the artifact does.** Until something writes to it, its root has no value, as after `remove(ref(db))`: a snapshot of it has `exists()` false and `val()` undefined. Nothing is stored on disk until the first write. A page can read and observe the store and check its access before the first write, and its listeners carry on across that write without noticing it.
- **Only local HTML path artifacts have a store**: artifacts whose files this server serves. Onboarding artifacts installed by earlier releases, whose fixed IDs predate generated ones, have none (section 10).
- **The agent addresses the store by the artifact's ID**, with `tv resource json <verb> --artifact <artifact-id>` (section 4). It uses the ID it already has and does not need the store's resource ID.
- **The page's code documents the data.** Next to the `getStore()` call, a comment describes the store's structure and rules: each field's type and whether it is required, what the page writes and what agents write. The description travels with the artifact's files and changes with the code that defines the data.
- **A resource ID grants a page nothing.** Pages reach data only through the artifact ID or share ID in their own address, and, with the flag on, through the bindings of that artifact. Resource IDs are therefore not secret, and a page may learn them; only an artifact's ID is kept from share viewers.

### What it is underneath

An artifact's store is an ordinary JSON resource with a resource ID of its own, unrelated to the artifact's ID, that its artifact is bound to at `read-write`. The artifact record points to it with a `store` field, written by the store's first write, which marks it as the artifact's default store. The owner's binding is implicit and cannot be removed. One pointer per record keeps the relationship one to one. The store's metadata also names its owner artifact, for people browsing the files and for recovery; the record's pointer is authoritative. The first write gives the store a fixed, system-generated description, which never contains the artifact's ID, since a page under a share ID must never learn it; an agent can change it, as any store's. Section 8 gives the first write's order.

### Deleting an artifact

Deleting an artifact removes its record, and with it any share link. The artifact's files stay on disk, and so does its store, whose metadata still names the deleted artifact. To recover, an agent registers the files as a new artifact and copies the old store's data into the new artifact's store: it finds the old store with `tv resource list`, which shows each store's owner, deleted ones included, reads it with `--resource`, or reads the store's content file directly, and writes the data with `set --artifact <new-id> --file`.

## 4. The JSON store

A JSON store holds one JSON value: an object, an array, a string, a number, a boolean or `null`, or no value at all.

**The API is inspired by Firebase's.** It feels familiar to developers who know the Firebase Realtime Database's modular API, but it is Television's own: its specs, not Firebase's, define how it behaves, and some of its differences are named below. References point at slash-separated paths, and a page uses `get`, `set`, `update` (several paths at once, all or nothing), `push`, `remove`, `runTransaction`, `onValue`, the child events, `serverTimestamp()` and `increment()`. `push` adds a child under a key generated by the client, which sorts in creation order, and returns the new reference at once, which is also a promise of the write. Server-filled values can appear anywhere in a written value. Agents that write artifacts already know Firebase's API, so a familiar form reduces what the guidance must teach. Queries such as `orderByChild`, `onDisconnect` and offline persistence do not exist.

**The data is plain JSON.** Firebase treats `null` as absence and turns arrays into objects with numeric keys. The store does neither: `null`, `{}` and `[]` are stored and read back unchanged, a path with no value is distinct from `null`, and arrays stay arrays. `set(ref, null)` stores `null`, and deleting is explicit, with `remove` or with `deleteValue()` inside `update`. An array element can be replaced through its path, and other array changes write the whole array. Lists that several clients edit use `push`, so concurrent additions never collide.

**The page sees its own writes at once.** The SDK shows a write to the page's listeners immediately, then confirms it with the server. A write the server refuses is rolled back, and its promise rejects. A snapshot's `metadata.hasPendingWrites` is true while it includes unconfirmed writes and clears when they are confirmed, so a page can show a "saving" state. Server-filled values are estimated for display until confirmed. When the page's access is `read`, the SDK refuses a write before showing it, and the server refuses any write that reaches it through `read` access.

**Writes are ordered and durable.** The server applies one store's writes one at a time, and the last write to a path wins. A write is confirmed only once the server has saved it to disk, and other clients see it only then. While a page stays connected, its writes are applied in the order it made them, and none is applied twice. A transaction writes only if the value it read is unchanged, and otherwise calls its function again with the current value, up to a limit; returning `undefined` aborts it.

**Observing.** `onValue` delivers the current value as soon as it is known, then again after every change that alters it. `onChildAdded`, `onChildChanged` and `onChildRemoved` report changes to an object's children, in key order, so pushed children arrive in creation order.

**There is no offline mode.** The SDK reconnects on its own when a page's connection is lost. While the page is disconnected, every read and write fails at once. When the connection is lost, the page's unconfirmed writes roll back and reject, but the server may still apply one, even after writes the page makes once it reconnects, and the page then hears it as it hears another client's change. Listeners stay registered across the loss. When the connection returns, each hears the current value if it differs from the last value it heard; values in between are not replayed. A page can read its connection status, `idle`, `connecting`, `connected` or `disconnected`, and hear its changes, so that it can tell the person when changes cannot be saved, and that a change the loss cut off may not have been saved.

**A save whose outcome is uncertain** is one where the disk reports an error after the new data has replaced the old. The server refuses the write, saying that its outcome is unknown, and takes what its saved data holds as current, which is ordinarily the write's result. When the saved data cannot be read back, or is not valid, the value from before the write stands, and the next successful save writes it. Either way the store stays available, so a client can read it and retry. A value kept this way can be lost if the machine crashes before the next successful save; this is accepted so that a passing disk error leaves the store usable.

**Unreadable data.** Stored data the server cannot read makes the store `unavailable`. Its files are left exactly as they are, never reset, operations on it fail, and other stores keep working.

**Limits.** A store's value, the depth of the paths in it, and a single write as sent each have a limit, set by the specs. The page or command that would send a write over its limit refuses it without sending it.

**Plain HTTP.** Every SDK feature works on a page served over plain HTTP from an address other than `localhost`, such as a LAN or tailnet address, where browsers withhold the features they reserve for secure contexts.

**Commands.** Agents use the same operations from the shell:

```bash
tv resource json get    <store> [<path>]
tv resource json set    <store> [<path>] (<value> | --file <path>)
tv resource json update <store> [<path>] (<values> | --file <path>)
tv resource json push   <store> <path> (<value> | --file <path>)
tv resource json remove <store> <path>
tv resource json watch  <store> [<path>]
```

`<store>` is exactly one of two options, so no argument's meaning depends on its shape:

- `--artifact <artifact-id>` reaches that artifact's own store. This is the common case, and it works before the first write, when the store has no resource ID yet.
- `--resource <resource-id>` reaches any store by its resource ID, including a deleted artifact's, since deleting an artifact does not delete its store. This works whether or not the flag is on.

`get` reports a path with no value distinctly from `null`, and `push` prints the key it generated. `watch` prints the current value, then the latest value whenever it changes. When changes come faster than it reads them, it skips the values in between, and once they stop its last line shows what is stored: an agent watching a store needs its current state, not every step. The commands act with the server's administrative authority, so they reach a store whatever access its pages have.

## 5. Share links

**The model.** An artifact has at most one share link. The agent creates it at a level, `read` or `read-write`. It can change the link's level at any time without changing the link, and it can revoke the link, which stops it working for everyone who holds it. Sharing again after a revocation creates a different link.

```bash
tv share-artifact   --id <artifact-id> [--access <read|read-write>] # create the link, or change its level
tv unshare-artifact --id <artifact-id>                                # revoke it
```

`--access` defaults to `read`: without it, `tv share-artifact` creates a `read` link, or prints the existing link when that is `read`, and refuses when the existing link is `read-write`, asking for `--access` to be given explicitly, so that leaving out the option never changes a link's level. The server gives a link as its path, `/artifact/<share-id>/`, with the origins it can be reached at, the list `tv links` uses, in which a `0.0.0.0` listener stands for each of the machine's IPv4 addresses and no origin is preferred; `tv share-artifact` prints each origin joined with the path, one complete URL per line, and a page that knows its own origin can join that with the path. The link carries no token: the share ID is the whole capability.

**Which artifacts can be shared:** local path artifacts, which the server serves from its own files at `/artifact/<id>/`. A URL artifact cannot be shared, whether it is an external web page or a shared artifact from another Television host: serving a share link to it would mean sending the viewer to the artifact's original address, which would reveal that address and escape the link's level and revocation. A person who wants to pass on another producer's artifact asks that producer for a link. A share link to a path artifact that is not HTML, such as a Markdown file, works as a view of the file; its level matters only for artifacts that use a store.

**The share ID.** A share link has the shape of an artifact's own address, `/artifact/<share-id>/`. The artifact's files and relative paths therefore work unchanged; the SDK, which reads its ID from the page's address, connects with the share ID without any change to the artifact's code; and another Television host that adds the link to a channel recognizes it as a shared artifact. The viewer's app loads the page from the producer's server, so the page uses the producer's store at the link's level, its writes land in the producer's data, and changes made on the producer reach it live.

**Every ID carries a level.** The artifact's own ID carries `read-write`, and a share ID carries its link's level. The routes that serve an artifact's data take the lower of the ID's level and the binding's level. An artifact's binding to its own store is always `read-write`, so for its own store the ID's level decides alone.

**Changes apply at once, once saved.** Creating, changing or revoking a share is acknowledged only after the artifact record is durably saved, and the server's map from share IDs to artifacts changes with it. When the save's outcome is uncertain, the server reads the record back, takes what it finds as current, and reports that the outcome is unknown, so that the agent can check and retry. Once a change takes effect, pages open through the link hear the new level, and a revocation closes their connections and stops the address serving the artifact.

**Share IDs are random,** generated as artifact IDs are, and not derived from them. Share IDs and artifact IDs appear in the same address form, so no new artifact ID or share ID may equal any existing artifact ID or share ID. With IDs this random the check practically never fails, but it is made in both directions. The share is stored in the artifact record, so deleting the artifact deletes its share, and the server builds its map of share IDs from the records it loads.

**Tokenless servers refuse sharing.** Anyone who can reach a server running without a token can already read its event stream, which carries artifact IDs (section 11), so a share link would protect nothing there.

**The artifact ID never reaches a share viewer.** A viewer holding only the share link must have no way to learn the artifact's own ID through the page or anything the browser receives. The guarantee is for that viewer. It does not extend to a browser that also holds the server's token, which can read artifact records through the server's API (section 11). These are the places the ID could appear, and the rule for each:

1. The page's address contains only the share ID.
2. The SDK's responses, such as the store's access level, carry no artifact ID. What they report about a store is what Television generates, its resource ID, type and the page's level on it, never the description or usage an agent wrote.
3. The events a page hears carry no artifact ID, description or usage.
4. Redirects, such as from `/artifact/<share-id>` to `/artifact/<share-id>/` or to a folder's index, error pages and response headers are built from the ID in the request, never from the artifact's own ID.
5. The artifact's own content is outside Television's control: its files and the data its store holds. If an agent writes the artifact's ID into them, for example in an absolute link, a share viewer sees it. The `television` skill's rules to keep an artifact's links relative and to keep IDs out of its source and data cover this, and the specs state it as the author's responsibility.

## 6. Created stores and bindings, behind a flag

The feature flag is a constant in the shipped code, off by default. How it is changed is decided later.

| Available whatever the flag | Available only with the flag on |
| --- | --- |
| `getStore()`, the artifact's own store | `getStore(resourceId)`, a store bound to the artifact, with `listResources` and `getResourceInfo` |
| `tv resource json get/set/update/push/remove/watch` with `--artifact` or `--resource` | `tv resource json create` |
| `tv resource list`, `info`, `describe`, `destroy` and `events` | `tv resource bind` and `unbind` |
| Share links: create, change level, revoke | Bindings other than an owner's own |
| The connection status, the store's access level, the JSON store's data API | |

With the flag off, the CLI has no `tv resource json create`, `bind` or `unbind` command: none of them appears in its help output, and running one fails as an unknown command. The server also refuses every operation the flag hides, whether it arrives from the CLI, the administrative routes or a page connection, with an error saying that it is not enabled; hiding the commands alone would not be enough. A store created while the flag was on stays an ordinary store with the flag off, reached with `--resource`, but its bindings are neither read nor used, so no page reaches it; turning the flag on again makes them effective. The shipped guidance teaches only what the first column lists.

Every store, an artifact's own included:

- **Description and usage.** Each store has a description, one line, which is always required, and a usage, free text, possibly several lines, in which an agent describes the content's structure and the rules its readers and writers follow; the usage is empty unless given. An artifact's own store starts with a fixed, system-generated description. Both can be changed at any time with `tv resource describe`, and both are shown wherever an agent inspects the store. They are for agents: no page receives them. The usage lets an agent that did not create a store use it the way its pages expect.
- **Lifetime.** A store exists until it is destroyed. Deleting an artifact never deletes a store, its own included. Destroying a store that artifacts are bound to is refused unless forced, and the refusal lists them; an artifact is always bound to its own store. Destroying an artifact's own store also removes the artifact's pointer to it, durably, before the store's files are deleted, so the artifact's next write creates a new store with a new resource ID, never the destroyed one, and pages open on the artifact see their store's root become empty until then. A destroy takes effect at its first step, which for an artifact's own store is removing the pointer: from then on the store is gone for pages and agents, even if a later step fails, and destroying it again deletes what is left.
- **Commands.** `tv resource list` (every store, with its owner, or the stores an artifact is bound to), `info`, `describe` and `destroy`, which take the store's resource ID, and `events`.

With the flag on:

- **Creating stores.** `tv resource json create`, with a required description, an optional usage and an optional starting value, creates a store and prints its resource ID.
- **Bindings.** A binding grants one artifact access to one store, by its resource ID, at a level the binding states; there is no default. Any store can be bound to any artifact, another artifact's own store included. An artifact's binding to its own store is implicit and cannot be changed or removed. Only an agent or person binds, through the CLI; artifacts do not declare what they need. The server checks bindings on every operation, so binding, unbinding and changing a level take effect at once, including for open pages. A page that loses its binding finds its next operation failing, and its listeners receive an error. A page reaches a bound store with `getStore(resourceId)`, its own store included; the resource ID in the artifact's source grants nothing without the binding.
- **Events.** `created`, `bound` and `unbound` report created stores and bindings; `updated` (a description or usage changed) and `destroyed` exist whatever the flag. A page hears `destroyed` and content changes for the stores its artifact is bound to, and `bound` and `unbound` for its own bindings. It never hears `created` or `updated`, and never learns about another artifact's bindings or another artifact's ID.

## 7. The resource layer

### Layer and types

Resource types differ in what they do with their content: a JSON store has `get` and `push`, while a database would have queries. The layer therefore covers only what every type shares: IDs and descriptions, storage and status, access checks, routes, the page connection, events and the common commands. Each type supplies its operations, each classified as a read or a write so that the layer refuses a write through `read` access before the type's code runs, and its content, limits, content events, SDK accessor and CLI verbs.

### Routes and authority

- **Artifact routes**, under `/artifact-resources/<id>/v1/`, carry a page's connection. The artifact ID or share ID in the path is their whole authority, and its level bounds what they allow. They never accept the server's token, never reach data that their ID gives no access to, and never reveal another artifact's ID or bindings, or a store's description or usage, which are for agents. They have a prefix of their own because `/artifact/<id>/` serves the artifact's files, where resource paths would compete with file names.
- **Administrative routes**, under `/api/resources/v1/`, carry the CLI's operations, with full access to every store. They require the server's token whenever the server requires one, and never accept an artifact ID or share ID as authority.

The two families never substitute for each other. Their sub-paths and message framing are defined by shared code and are not a public API: the SDK and the CLI are the supported clients. The `v1` in the routes and in the SDK's path is the resource API's version.

**Requests from other origins.** The server does not check the `Origin` of resource requests or WebSocket connections, and sends no CORS headers on resource routes. The artifact or share ID in an artifact route's path, or the token on an administrative route, is the gate, so a page on another site that holds an ID has that ID's level, as any client holding it does. Nothing depends on the scheme or address a browser used, so Television works behind an HTTPS front that terminates TLS, such as `tailscale serve`, and the SDK connects with `wss:` on pages served over `https:`.

### The page connection

The SDK keeps one WebSocket open per page while the page needs it and carries all of the page's resource traffic over it. One ordered connection gives a page's writes their order, and lets the server send a write's effect on the page's listeners before it confirms the write. The server checks access for every operation when it applies it, not when the connection opens. Each connection stands alone: the server keeps nothing about a page between connections, and the SDK never sends a write or request on more than one connection, so nothing is applied twice. Writes on different connections have no order between them.

### Events

The layer emits each event after the change it reports is stored. `changed` reports that a store's content changed and names the paths the write touched, so that a client following one path can pass over writes elsewhere.

- A page hears events about its artifact's store, including a change of its access level. They identify the store as the artifact's store, without an ID; with the flag on, a bound store is identified by its resource ID.
- Agents receive events from the server's `/events` stream, which a server that requires the token closes to any client without it. There, events about an artifact's store identify it by the artifact's ID and, once the store has one, its resource ID.
- `tv resource json watch` follows `changed` events for its store and reads the value after each one that can affect its path. With `--artifact` it filters by the artifact's ID, which also covers a watch started before the store's first write.

### The SDK module

The server serves one module, `/sdk/v1/resources.js`, without authorization and with the same bytes for every page: it carries no credentials or IDs. The module finds its artifact from the page's own address, so artifact code never handles an ID or token; on a page served anywhere else, its functions fail. Its push-key generator is adapted from the Firebase JavaScript SDK under the Apache License 2.0, so the SDK is a licensing surface: the server serves its third-party notices beside the module, and the adapted file carries Firebase's attribution. It carries the JSON store's accessor and data functions, the store's access level and its changes, and the connection status; with the flag on, also `getStore(resourceId)`, `listResources` and `getResourceInfo`, which report each store the artifact can use with its resource ID, type and the page's level and nothing an agent wrote, and the events of bound stores. Every refusal carries a stable code that says what went wrong, such as `read-only`, `unavailable`, `disconnected` or `too-large`.

## 8. Storage

```text
<home>/state/artifacts/<artifact-id>.json   the artifact record, with "store" and "share" when it has them
<home>/resources/json/<resource-id>/
  manifest.json                             the store's metadata: its description, usage and creation time, and an own store's owner artifact
  content.json                              the store's value, exactly as written; absent when the root has no value
<home>/state/resource-bindings.json         the bindings by resource ID, with the flag on only; an owner's binding is implicit
```

- **Content and metadata are separate files.** `content.json` is plain JSON, with no wrapper, that a person or agent can read, copy or restore directly. A root with no value is represented by the file's absence, so a stored `null` and a missing value stay distinct across a restart. A `content.json` that exists but cannot be read or parsed is damage: the store is reported as `unavailable`, the file is left as it is, and it is never mistaken for absence.
- **The first write to an artifact's store** is acknowledged only when all of it is durable, and happens in a fixed order: the server allocates a resource ID and saves the artifact record with its pointer, then creates the store's directory and manifest, then writes the content. The pointer is therefore saved before any of the store's files exist, so the store is never created unreferenced, and a crash can leave only three incomplete states, each with one outcome:
  - a pointer with no store directory, or a directory with neither manifest nor content: an interrupted first write. The root has no value, and the next write completes the missing steps.
  - a manifest with no content: a store whose root has no value.
  - content with a missing or invalid manifest: damage, since no interrupted write leaves this state. The store is `unavailable` and its files are left as they are, so existing content is never treated as absent or overwritten.
- **Every later change touches one file:** a write rewrites or deletes `content.json`, and a change to a description or usage rewrites `manifest.json`. Each file is replaced atomically and flushed to disk, its directory included, before a change is complete. When the last flush fails, the uncertain-save rule of section 4 applies: the server takes what the disk holds as current, or keeps the state from before the change when it cannot read that back, refuses the change, saying that its outcome is unknown, and makes nothing unavailable.
- **Artifact records follow the same save rules** for every rewrite and every deletion, including the uncertain-save rule. A record carries the store pointer and the share, which are promises the server makes to writers and share holders, and any rewrite, such as a title change, replaces the whole record. A deletion has to be durable too, or a crash could bring back a deleted artifact's share link.
- **Strict file formats.** A manifest or the bindings file is valid only when it matches its version's format exactly: every field the format has, each of its type, and no other field. A file that does not match, including one of a version the server does not know, is not valid: the server reports what depends on it as `unavailable` and leaves the file untouched. The server writes only the fields a format has. A later release may add a field to these files without changing the version, with its reader supplying a default when the field is missing. Artifact records have no version: a record without `store` or `share` means that the artifact has no store yet and is not shared, which is right for every existing artifact.
- **Versions.** Television supports neither downgrading a server nor a client running a different version from its server, because clients reload after an upgrade (the reload contract in [version advertisement](../../../specs/arch/updates/version-advertisement.md)).
- **Migration.** None. The resource layer has never reached `main`, so no installation holds resource files or a bindings file. Development homes created from this branch before the design is implemented are recreated. Existing artifact records are read unchanged.
- **Stores load when first used.** The server reads a store into memory when a page or the CLI first uses it, so that startup does not grow with every artifact that ever stored data, deleted ones included. A store whose files cannot be read is reported as `unavailable` then. A loaded store stays in memory until the server stops: after an uncertain save, the value in memory can be the authoritative one, and discarding it would break the uncertain-save promise.
- **Footprint.** An artifact that never writes data has no store files. One that does has a directory with two files. A share adds one small field to the artifact record. With the flag off, no bindings file is created.

## 9. Agent guidance

Agents learn the feature from `resources.md`, a guidance document that the bundled `television` skill ships beside `SKILL.md` and `theming.md`, hand-authored from the specs. `SKILL.md` introduces the JSON store in one paragraph that points to it, telling an agent to read it when an artifact's data must be shared by every client viewing it, or read or written by the agent, or when the person mentions JSON stores or resources.

**It leads with the JSON store's purpose.** A JSON store, a small database that Television keeps on its server, inspired by Firebase's Realtime Database, provides what `localStorage` cannot: data synchronized live across every client viewing the artifact, and readable and writable by the agent through the `tv` CLI, as for a to-do list that the person and the agent work on together. The guidance says plainly that keeping such data in `localStorage` is fundamentally broken, and that something like a to-do list almost certainly belongs in a JSON store. It keeps `localStorage` as the right tool for state that belongs to one client only, such as the active tab, or unsaved text that the person expects to survive a change of channel. It does not call the store a better option than `localStorage` or say that the store replaces it, since the two do different jobs.

It teaches:

- when to use a JSON store, and when state belongs in the page, in `localStorage` or in the artifact's files;
- `getStore()` and the JSON store SDK, through a complete example: a plain-HTML to-do list whose store holds the list and whose page renders it live. It shows `onValue` delivering the current value first, `push` for a list that several clients edit, a transaction, a server-filled value, and the connection status: the page says when it is disconnected, disables its writing controls until the connection returns, and warns that a change the loss cut off may not have been saved. The guidance gives the commands with which the agent adds and completes its tasks, and points to the `tv-tasks` skill for to-do lists built for a person;
- the comment that documents the data, next to the `getStore()` call: each field's type and whether it is required, what the page writes and what agents write;
- the `tv resource json` commands, addressing the store with `--artifact`;
- that a page sees its own writes at once and refused writes roll back, and how to show a "saving" state;
- that there is no offline mode, that a write cut off by a lost connection may still be saved, and how to show the connection status;
- where the store differs from Firebase, and the Firebase APIs that do not exist;
- how a page checks its access level and renders a read-only view, since a share link may open it at `read`;
- share links, for when the person asks to share an artifact;
- that no ID, token or other secret ever goes into artifact source or the data its store holds.

Every example and onboarding artifact demonstrates what the feature is for, beyond meeting its specs. The guidance on creating and binding stores and on usage text moves to guidance behind the flag or out of the shipped skill (section 15). It includes writing a specific description and a usage that stands on its own, since its later reader has only `tv resource info`, and writing no code for a store unbound or destroyed while the page is open, which is rare and usually an agent's own doing.

**The task-list skill.** The `tv-tasks` skill is presentational: it teaches how to render tasks, not where they come from or where their state lives. It says that this is the artifact author's choice, names possible sources, such as a JSON store, a third-party API such as the person's productivity app, or the artifact's HTML itself, points to a JSON store as a good place for a to-do list's data, and discourages `localStorage` for to-do lists. A list whose tasks change while the page is open puts its status or error message in the page header, so that the header stays directly before the list.

## 10. Onboarding

- **Company To-dos is the JSON store's showcase**: the Productivity channel's live to-do list, kept in its own store, which the person and their agent work on together. The page renders the tasks with `tv-tasks` components from the store's value and again whenever it changes, so a task the agent adds, changes, completes or removes appears without a reload. It groups tasks by due date, relative to the viewer's day, into *Earlier*, *Today*, *Upcoming* and *Someday*, and checking a task sets its `done`.
- **It has no local-only mode.** Its checkboxes work only while the page has the store's value, can use the store and is connected. While it is disconnected, the page says that changes cannot be saved and disables every checkbox until the connection returns. When it cannot use its store, as it loads or later, it shows an error that gives the reason and disables every checkbox until the page reloads. When a save is refused while the page can still use the store, the checkbox returns to what the SDK shows once it has rolled the save back, and the page shows the error but disables nothing, so the list stays usable; the error goes when a later toggle is saved. A save that fails because the connection was lost shows as the disconnected state, not as an error. The message appears in the page header.
- **Installation seeds the store.** The onboarding manifest declares a starting value for the artifact's store. Installing the channel writes it, with its dates moved so that they fall the same number of days from the installation day as they were authored from the story day. The description of the store's data is a comment in the page's module.
- **Installed once.** A channel is installed once, and what the user changes or deletes is never recreated. A home that installed Productivity from an earlier release keeps the Company To-dos it was installed with, and gets no store. If a crash interrupts installing a channel, the next start installs it again, and a duplicate artifact left by the interrupted attempt is accepted: the installer has no recovery machinery.
- **Generated IDs.** Installed onboarding artifacts get the same random IDs as every other artifact, so a default installation never ships a store reachable through an ID that can be guessed. Onboarding artifacts installed by earlier releases keep their fixed IDs, and have no store.

## 11. Security boundary

Access levels exist so that artifacts can be shared, at an appropriate level, within the trust boundary of the user's own server and clients. The design assumes that artifact code is trusted less than the Television app: artifact code does not hold the server's administrative authority. The ID in a page's address scopes its access, and a share link can be revoked. Nothing in this design isolates the artifacts on one server from each other. The specs state these limits:

- **Knowing an ID means holding its access.** Anyone who can load an artifact through its own ID can read and write its store, and anyone holding a share link has the link's level. Their writes land in the producer's data. IDs appear in URLs, browser history, logs and pasted links, and any client holding one, such as a script on another machine or a page on another site, can do what a page with it can.
- **IDs cannot be guessed.** Artifact IDs and share IDs carry 80 random bits from a cryptographic source, which is beyond realistic guessing. The practical risk is an ID leaking, which more bits would not reduce.
- **Artifacts served by one server share its origin.** Television serves HTML artifacts on its own origin without a sandbox, so one artifact's code can find another artifact's ID, and through it use that artifact's store.
- **Known defect: artifact code can read the server's token.** The Television app keeps the token in browser storage for the server's origin, where artifact code from the same server can read it and use the administrative routes, whatever its access. This contradicts the design's assumption and is accepted for now: a separate work stream moves artifacts onto their own origin, which hides the token from artifact frames. Until then, access levels constrain only pages opened in browsers that do not hold the server's token, such as those of a share link's recipients. A browser that holds the token can also read artifact records through the server's API, which is why the promise that a share viewer never learns the artifact's ID is made for viewers without the token.
- **Tokenless servers.** Running without a token is the explicit choice of the person running the server, and anyone who can reach such a server can use its administrative routes, a page on another site included. Pages' access levels still apply, but the server refuses share links. Such a page can also read every resource event from the event stream, including the artifact IDs in them, as it reads the stream's other messages. This exposure is accepted with the rest of tokenless mode. Any client can also change bindings there, which exist only with the flag on; the server's tokenless startup warning and `tv resource bind` say so.

In return, no secret appears in artifact source or agent conversations, the server enforces `read` access, and a share link can be revoked without affecting the artifact or its store.

## 12. Acceptance criteria

The product specs order acceptance tests for the feature's principal paths. These are set here as testing directives:

- **Sharing and permissions across two servers,** the one test that proves the access model as people use it. A producer and a viewer run as real servers on different origins with authentication on. A real browser holds only the viewer's credentials, and the test uses the built CLI and the shipped SDK. Artifacts on the producer, bound to stores with different access levels and one store left unbound, are added to the viewer as shared artifacts and shown in the viewer's app. From inside those pages, the test proves that the producer's server enforces access, not only the SDK: `read-write` access writes and the write persists; `read` access is refused even when the SDK is bypassed; an unbound store cannot be reached; live changes reach the shared page; binding changes apply to an open page; a second artifact on the same content keeps its own access level; and the shared page cannot reach the producer's administrative routes. It runs in Firefox as well as Chromium, because a shared artifact is a page from another site framed inside the viewer's app, which Firefox treats differently. With bindings behind the flag, it becomes the share-link test (section 15).
- **Share links.** One test opens an artifact through its share link, records everything the page and browser receive (the address, every response and header, redirects, every SDK response and event, and errors) and asserts that the artifact ID appears nowhere in it. Others open a share at `read` and switch it to `read-write` while the page is open, and revoke a share. The read-only walk also runs in Firefox.
- **Firefox.** A small number of the feature's other principal paths also run in Firefox, following the repository's existing selection of Firefox tests.
- **The guidance's example runs as written,** in a real browser against a running server, so that the guidance never teaches code that does not work.
- **The SDK is tested as served,** in a real browser, from a page on a plain-HTTP address that is not `localhost`.

## 13. Spec impact

The design is written into these specs, and the proofs follow each spec:

- `specs/product/resources/resources.md` and `json-store.md`: the artifact's store, the flag, share links, the access rule, the rule that the artifact ID never reaches a share viewer, and the CLI's addressing options. Share links replace read-only sharing through a second artifact (`^rs-less-access`).
- `specs/arch/resources/index.md`, `json-store.md` and `sdk.md`: resource IDs, the storage layout, loading on first use, routes resolving share IDs, access checks and events that identify an own store without an ID, page events under a share ID, and the refusals with the flag off.
- `specs/product/artifacts.md`: the share link, the artifact record's `store` and `share`, and the durable save rules for every rewrite and deletion of a record.
- `specs/arch/resources/guidance.md` and the `television` skill's guidance: the surface the flag leaves, and the comment that documents the data.
- The onboarding content, installer and UI specs: Company To-dos' seeded store.

## 14. Out of scope

- Resource types other than the JSON store, and the markdown editor as a store client.
- Stores for artifacts other than local HTML path artifacts.
- Queries, server-side presence (`onDisconnect`), offline persistence, per-path access rules and schema validation in the JSON store.
- A trash, or any change to what deleting an artifact removes, and a command that points a new artifact at an existing store.
- More than one share link per artifact, or links per recipient.
- How the flag is set or exposed.
- A version field for artifact records.
- Releasing idle stores from memory.
- Artifacts declaring the stores they need, names for stores, and per-store access keys or cross-origin settings.
- Isolating artifacts from each other on one server, moving artifacts to their own origin and keeping the token out of artifact frames, which is a separate work stream.

## 15. Settled questions

The questions this proposal left open were settled while it was written into the specs; [the task record](spec-derivation.md) holds each decision (item 41):

- The share commands are `tv share-artifact` and `tv unshare-artifact`.
- Guidance for created stores and bindings ships nowhere while the flag is off; the guidance spec keeps what it must teach.
- Josh revised the design so that resources are identified by ID only and an artifact's own store differs from any other store as little as possible: it can be bound to other artifacts and destroyed with the flag on, as section 6 says.
- The two-server test becomes the share-link test, in Chromium and Firefox, with a separate test that no share viewer learns the artifact's ID.
- The server's tokenless startup warning says that any client can change bindings only with the flag on.

## 16. References

- The specs this design is written into: [product/resources/resources.md](../../../specs/product/resources/resources.md), [product/resources/json-store.md](../../../specs/product/resources/json-store.md), and [arch/resources/](../../../specs/arch/resources/index.md) with its [SDK](../../../specs/arch/resources/sdk.md), [JSON store](../../../specs/arch/resources/json-store.md) and [guidance](../../../specs/arch/resources/guidance.md) specs.
- [spec-derivation.md](spec-derivation.md), the task record, which holds Josh's decisions and the details derived during spec writing and implementation.
- [implementation-plan.md](implementation-plan.md), the implementation plan.
