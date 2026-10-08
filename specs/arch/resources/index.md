*The resource architecture root: the module map, the bindings flag, resource IDs, descriptions and records, each artifact's store and its share link with the artifact record's fields and save rules, storage with loading on first use, the two route families with their authorization and requests from other origins, the page connection's access and ordering rules, resource events, what each resource type implements, server bootstrap and artifact-deletion integration, and the CLI integration.*

# Resource architecture

The server keeps resources for artifacts and agents and serves two ways in: one for an artifact's page, authorized by the artifact ID or share ID in its address, and one for agents, authorized by the server's token. Every artifact this server serves from its own files has its own store, which the artifact's record points to, and an artifact can have a share link that reaches it at a lower level. This document defines the parts every resource type shares, and the rules that keep access checks, ordering and stored data correct.

## What this owns

This spec owns the *resource layer*: the part of Television every resource type shares. That covers the bindings flag, resource IDs, descriptions and records, storage, loading stores on first use, artifacts' own stores and share links, description and binding validation, the artifact and administrative route families, the page connection, resource events and their delivery to agents, the responsibilities each type takes on, the layer's integration with server bootstrap and artifact deletion, and the CLI integration of the share and `tv resource` commands. User-facing behavior is owned by [product/resources/resources.md](../../product/resources/resources.md).

| Spec | Owns |
|---|---|
| this spec | the layer, as above |
| [sdk.md](./sdk.md) | the browser module at `/sdk/v1/resources.js`: its build, serving, the layer's functions, the connection status and the connection client |
| [json-store.md](./json-store.md) | the `json` type: paths, values and operations, write application, transactions, subscriptions, local writes in the SDK, its content file and limits, and its CLI verbs |
| [guidance.md](./guidance.md) | the `resources.md` guidance document in the `television` skill, and the `tv-tasks` skill's use of a JSON store |

The *resource SDK* is the browser module; the *page connection* is defined below.

## Code layout

- `packages/shared/src/resources/` holds what the server, the SDK and the CLI client share: the bindings flag, the types below, description, usage, resource ID and path validation, the JSON store's value semantics, push-key generation, and the routes' sub-paths and message framing. It stays browser-compatible.
- `packages/server/src/resources/` holds the layer and each type's server side.
- The shared client exposes the administrative routes as `TelevisionClient.resources` ([CLI integration](#CLI integration)).

The routes' sub-paths and message framing are defined by that shared code, not by this spec. They are not a public API: the SDK and the CLI are the supported clients. This spec pins the route prefixes, their authorization and origin rules, and the behavior every client relies on. ^rs-wire-boundary

## The bindings flag

The [bindings flag](../../product/resources/resources.md#^rs-flag) is the constant `RESOURCE_BINDINGS_ENABLED` in the shared module, `false` as shipped. `Server` takes `resourceBindings` as an optional option whose default is that constant, and passes it to the layer; the CLI takes it from [its environment](../cli/index.md#Contract surface). Production code never passes a value of its own, so the shipped server and CLI have the flag off; tests construct servers and CLI environments with it on. ^rs-flag-constant

With the flag off:

- The layer refuses with `not-enabled`, on both route families, what the flag hides: creating a store explicitly, binding and unbinding, and a page's operations on stores by resource ID, which are `getStore(resourceId)`'s operations and listing and inspecting bound stores.
- The layer never reads, rewrites or deletes the bindings file, so it uses no binding but each owner's implicit binding to its own store, and turning the flag on again makes the stored bindings effective. A store created while the flag was on is an ordinary store, reached by its resource ID and written, described and destroyed like any other.
- `created`, `bound` and `unbound` are never emitted, since nothing that causes them can happen.

## Records

```ts
/** Generated as artifact IDs are: 26 characters of Crockford's base32, a ULID. */
type ResourceID = string;
type ResourceType = "json";
type AccessLevel = "read" | "read-write";

/** How the CLI addresses a store: exactly one of the two. */
type StoreAddress = { artifactID: string } | { resourceID: ResourceID };

interface ResourceSummary {
  resourceID: ResourceID;
  type: ResourceType;
  description: string;            // one line, 1 to 1024 UTF-8 bytes; "" only when the manifest cannot be read
  usage: string;                  // free text, line breaks allowed, at most 16,384 UTF-8 bytes; "" when none was given
  status: "available" | "unavailable";
  unavailableReason?: string;     // present exactly when status is "unavailable"
  createdAt?: string;             // ISO 8601; absent only when the manifest cannot be read
  ownerArtifactID?: string;       // present exactly for an own store: the artifact that owns it, a deleted one included
}

interface ResourceBinding {
  resourceID: ResourceID;
  artifactID: string;
  access: AccessLevel;
}

/** The description an own store's first write gives it. */
const OWN_STORE_DESCRIPTION = "Store owned by an artifact, created at its first write.";
```

A description is one line: it is not empty and contains no line feed or carriage return. A [usage](../../product/resources/resources.md#^rs-usage) may contain any text within its limit, line breaks included. Every resource has a resource ID, generated when it is created; a value of any other form than a resource ID's names no resource, so a resource ID never reaches the filesystem unchecked. A store whose manifest the layer cannot read or validate is reported unavailable, with an empty description and usage and no creation time or owner. ^rs-records

## Artifacts' stores and share links

An artifact *has a store* when it is a path artifact whose ID has the form Television generates, a ULID, whatever its path: a folder or a file of any kind, Markdown included. No rule restricts stores or bindings to a kind of local path artifact. URL artifacts have none, nor do onboarding artifacts installed by earlier releases with fixed IDs. An artifact cannot change its kind or its ID, so whether it has a store never changes. ^rs-has-store

An artifact's *own store* is the store its record's `store` points to. Its owner is bound to it at `read-write` implicitly, for as long as the pointer stands: the bindings file never holds that binding, and binding and unbinding refuse it with `owner-binding`. The layer reports it among a store's bindings in `info`, among an artifact's stores in `list --artifact` and, with the flag on, among the stores a page's `listResources` and `getResourceInfo` report. A page's opening state and the `bound` and `unbound` events never carry it: it begins with the store's first write and ends with the pointer. ^rs-own-store-binding

**Buffer: the artifact record.** The artifact record and its registry are otherwise code-authoritative (`packages/server/src/server-store.ts`; [product/artifacts.md](../../product/artifacts.md)). This buffer makes authoritative only what the resource layer relies on: ^rs-artifact-record

```ts
// The artifact record's resource fields; a record without them has no store yet and is not shared.
interface ArtifactRecordResourceFields {
  store?: ResourceID;                              // the artifact's store, from its first write
  share?: { id: string; access: AccessLevel };     // the artifact's share link
}
```

- Every rewrite of a record and every deletion of one follows [the storage rule](#^rs-storage), including [the uncertain-save rule](#^rs-arch-uncertain-save): an uncertain rewrite takes the record it reads back as current, and an uncertain deletion that finds the file gone takes the artifact as deleted. A record carries promises to the store's writers and the link's holders, and any rewrite, such as a title change, replaces the whole record, so every record write needs the durability of the data. The server applies one artifact's record changes one at a time, each on the record as it stands after the last.
- Artifact records have no version. A record without `store` or `share` is valid: it records an artifact whose store has never been written and that has no share link, as does every record an earlier release wrote.
- The record's API and event shapes carry the two fields as the record does, so a token holder sees an artifact's store's resource ID and its share link.

**Share IDs.** A share ID is generated by the artifact ID generator. When the layer loads, it builds its map from share IDs to artifacts from the records the store loads. A newly generated artifact ID or share ID that equals an existing artifact ID or share ID is drawn again, in both directions. ^rs-share-ids

**Resolving an ID.** The artifact routes and the artifact proxy resolve the ID in a request's path: an artifact ID reaches its artifact at `read-write`, a share ID reaches its artifact at its link's level, and any other ID reaches nothing. A page's level on its artifact's own store is the level its ID carries. With the flag on, its level on a store its artifact is bound to by resource ID, its own included, is the lower of that and the binding's level, and it has none on a store its artifact is not bound to. ^rs-resolve-id

**Changing a share link.** Creating a link, changing its level and revoking it each rewrite the artifact's record. Only once the rewrite is complete does the layer change its map, answer the request and act on open pages: after a level change it sends each page connection opened under that share ID the new level, and after a revocation it closes them. An uncertain rewrite takes the record it reads back as current, acts on what changed, and refuses the request with `unavailable`, saying that its outcome is unknown. A request that gives no level shares at `read`: it creates a `read` link, or answers with the existing link when that is `read`, writing nothing. When the existing link is `read-write`, such a request is refused with `access-required` and changes nothing. Creating a link or changing its level on a tokenless server is refused with `tokenless`; revoking is not. A URL artifact is refused with `not-shareable`, and revoking an artifact that has no link with `not-shared`. A request at `read-write` for a Markdown file artifact, a path artifact whose path the artifact model classifies as Markdown (`isMarkdownPath`), whether it would create the link or change its level, is refused with `read-write-unsupported` and changes nothing; whether an artifact [has a store](#^rs-has-store) plays no part. Refusals come in the order `no-artifact`, `not-shareable`, `tokenless`, `read-write-unsupported`, `access-required`. Only such a request is refused: a link that is already `read-write` keeps its level when its artifact's path changes to a Markdown file, and caps the access the artifact has, as any link does. ^rs-share-change

**Buffer: serving under a share ID.** The artifact proxy (`packages/server/src/artifact-proxy.ts`), otherwise code-authoritative, serves `/artifact/<share-id>/…` as it serves the artifact's own address. Every redirect it sends, such as to add a trailing slash or to a folder's index, every error document and every response header is built from the ID and the path in the request, never from the artifact's own ID or from the names of its files and folders on disk, which can contain that ID. A single-file artifact, HTML, Markdown or another file, is therefore served at `/artifact/<share-id>/` itself, while under its own ID that address redirects to its file's name; `/artifact/<share-id>` redirects to `/artifact/<share-id>/`, and every other path under the share ID, the file's name included, answers as a missing file. This holds for the redirects and errors of the library that streams the files, and while the files change during a request: a single file that has become a folder is answered as missing. An error response carries its status and fixed text for it, never the server's own text for the failure, such as a file's path, which contains the artifact's ID when its files lie in a folder named for it. A share ID that reaches nothing, such as a revoked one, is served as an ID that names no artifact. ^rs-share-serving

## Storage

```text
<home>/state/artifacts/<artifact-id>.json   the artifact record, with "store" and "share" when it has them
<home>/resources/<type>/<resource-id>/
  manifest.json                             the resource's metadata
  …                                         the type's content files, such as a JSON store's content.json
<home>/state/resource-bindings.json         the explicit bindings, with the flag on only
```

```ts
interface StoredManifestV1 {
  version: 1;
  createdAt: string;
  description: string;
  usage: string;
  ownerArtifactID?: string;      // exactly for an own store
}

interface StoredBindingsV1 {
  version: 1;
  bindings: ResourceBinding[];   // at most one per store and artifact, and never an owner's binding to its own store
}
```

An own store's manifest records the artifact that owns it, for people browsing the files and for recovery; the artifact record's pointer is authoritative, and the manifest's owner is never compared with it. Every file is rewritten through a temporary file in the same directory, flushed to disk and renamed over the original, followed by a flush of the directory; creating a directory is followed by a flush of its parent, and deleting a file by a flush of its directory. A change is complete, and may be reported or acknowledged, only after its last flush succeeds. Every later change to a resource touches one file: a change of description or usage rewrites the manifest, and a write to its content rewrites the type's content files. While the server runs, only the server writes these files. Anyone may read them, as [recovering a deleted artifact's data](../../product/resources/resources.md#^rs-artifact-deleted) may, and a person or agent edits them only as a recovery step, while the server is stopped, as [the guidance](./guidance.md#^rg-teaches) teaches. ^rs-storage

**The first write to an artifact's store** is acknowledged only when all of it is durable, and happens in this order: the layer generates a resource ID and saves the artifact's record with `store` pointing to it; then it creates the store's directory and writes its manifest, with the description `OWN_STORE_DESCRIPTION`, an empty usage and the owner's ID; then the type writes the content. The pointer is therefore saved before any of the store's files exist, so the store is never left without its artifact's pointer. Each step follows the storage rule; a step whose outcome is uncertain ends the write there, refused as the uncertain-save rule says, and the next write completes the missing steps. An artifact's store has one write queue from its first use, before its first write, so two first writes never generate two resource IDs. ^rs-first-write

**Loading on first use.** The layer reads a store when a page or a command first uses it, not at startup, so that startup does not grow with every artifact that ever stored data, deleted ones included. An artifact's own store is found through its artifact's pointer, and any store through its resource ID. Loading reads the manifest and the type's content and removes leftover temporary files from the store's directory. A crash can leave a store in one of three incomplete states, and each has one outcome: ^rs-load

- a pointer with no store directory, or a directory with neither manifest nor content: an interrupted first write. The store has no value, and the next write completes the missing steps;
- a manifest with no content: a store with no value;
- content with a missing or not valid manifest: damage, since no interrupted write leaves this state. The store is unavailable and its files are left as they are, so existing content is never treated as absent or overwritten.

A manifest or content file the layer cannot read or validate likewise makes the store unavailable with a reason, and the file is left exactly as it is. A loaded store stays in memory until the server stops: after an uncertain save, the value in memory can be the authoritative one, and releasing it would break the uncertain-save promise.

**Startup.** The layer reads no manifest and no content at startup, whatever the flag. With the flag on, it reads the bindings file. Leftover temporary files in the state directory are removed. Bindings whose artifact does not exist, or whose store has no directory, are discarded and the bindings file is rewritten; checking a store needs no manifest. A bindings file the layer cannot read or validate is left exactly as it is, and the layer refuses every binding request, and every page operation on a store by resource ID, with `unavailable` until a later start can read it, while artifacts' own stores keep working. Starting with no bindings would lose them all at the next rewrite. ^rs-startup

**Listing.** `list` reads every entry under `<home>/resources/<type>/` for each type the layer implements, and loads each store, as a first use does. Only a directory whose name is a resource ID is a store: any other entry, including a file whose name is a resource ID, and a directory for an unknown type are ignored and left in place. ^rs-list

**File formats.** A manifest or the bindings file is valid only when it matches its version's format exactly: every field the format has, each of its type, and no other field, at the file's top level or within a binding. A file that does not match, including one of a version the server does not know, is not valid and is left untouched, as above. The server writes only the fields the format has, so nothing else is carried through a rewrite. A later release may add a field to these files without changing the version, with its reader supplying a default when the field is missing. Television supports neither downgrading a server nor a client running a different version from its server, because clients reload after an upgrade ([version advertisement](../updates/version-advertisement.md#The reload contract)). ^rs-file-formats

**A save whose outcome is uncertain.** A rewrite can fail after its rename has replaced the file, and a deletion after it has removed the file, when the flush of the directory fails. The server cannot then know whether the change will survive a crash. It reads the file back, or finds it gone, and takes that as current: a manifest's description and usage, a store's content as [its type](./json-store.md#^js-arch-uncertain) reads it, the bindings file's bindings, an artifact record's store pointer and share link, or a deleted resource's or record's absence. Since the rename or removal has already happened, what it finds is ordinarily the change, which then takes effect as a completed change does, with its events. The server refuses the change with `unavailable` and a message saying that its outcome is unknown. When the file cannot be read back, or what it holds is not valid, the state from before the change stands, and the next successful save of that file writes it. Nothing becomes unavailable because a save's outcome is uncertain, so a client can read what is there and retry. What the server takes as current may not yet be durable, and a crash of the machine before the next successful save of that file can lose it; this is accepted, as [the product spec](../../product/resources/resources.md#^rs-uncertain-save) states. ^rs-arch-uncertain-save

Destroying a store happens in this order: when it is an own store whose artifact exists, the layer first saves the owner's record without `store`; then, with the flag on, it removes the store's bindings and writes the bindings file; then it deletes the store's files and directory. A crash between the steps therefore never leaves a pointer to a destroyed store. The destroy takes effect with its first step, once that step is saved or taken as saved under [the uncertain-save rule](#^rs-arch-uncertain-save). From then on the store is destroyed: the layer emits `destroyed` at once, before the later steps, so that pages using the store and every `watch` that follows it, by its resource ID or its owner's artifact ID, hear that it is gone; and the layer leaves the store out of `list` and refuses every operation on its resource ID with `not-found`, apart from a destroy. A later step that fails refuses the destroy and leaves an incomplete deletion, which a retried destroy finishes by running the steps that remain. A server that starts while an incomplete deletion remains, after such a failure or a crash between the steps, finds its files as a store again, which no artifact's pointer reaches, with any bindings the destroy had not removed; destroying it deletes them. Once the pointer is cleared, the owner's next write is [a first write](#^rs-first-write), which creates a new store under a new resource ID. Making that later use fail instead is a known later refinement ([TV-950](https://linear.app/telepath-computer/issue/TV-950)). ^rs-destroy-order

Version 1 is the first version of the manifest's format and of the bindings file's, so the server migrates neither.

## Bootstrap and artifact deletion

`ServerStore` constructs the resource layer from its `storagePath` and loads it during [bootstrap step 2](../onboarding/installer.md#^bootstrap-sequence), after channel and artifact metadata, so that the onboarding installer can write artifacts' stores. ^rs-bootstrap

When an artifact is deleted, by `tv delete-artifact`, by removing its channel or by any other path, its record is deleted under the save rule, with its share link, and the layer removes its share ID from its map and closes the page connections opened under the artifact's ID or its share ID. Its store stays, with its manifest naming the deleted artifact. With the flag on, the layer also removes the artifact's own bindings and emits `unbound` for each; other artifacts' bindings to its store stay, since the store does. The artifact ID is never reused, so a binding left behind by a crash between the two steps grants nothing, and the next startup with the flag on discards it. ^rs-artifact-delete

## Route families

### Artifact routes

The artifact routes live under `/artifact-resources/<id>/v1/`, where `<id>` is an artifact ID or a share ID, and consist of one WebSocket, the *page connection*, at `/artifact-resources/<id>/v1/connection`. The ID in the path is the whole of their authorization, and the level it carries bounds what they allow ([resolving an ID](#^rs-resolve-id)). They do not accept the server's token, never reach data their ID gives no access to, and never reveal an artifact ID, including their own artifact's when they were reached through a share ID, another artifact's bindings, or a store's description or usage, which agents write and only agents receive. Resource IDs may reach a page, since they grant nothing without the ID in the path. A refusal on the page connection carries its code and a message written for the page from the code and the resource ID the request named, never the server's own text for the failure, which can name an artifact or the server's files; an `unavailable` refusal's message still says whether the change's outcome is unknown. A path whose ID reaches no artifact is accepted like any other; that ID simply has no store and no bindings. The prefix is separate from `/artifact/<id>/`, where the artifact proxy serves the artifact's own files and resource paths would compete with file names. ^rs-artifact-routes

### Administrative routes

The administrative routes live under `/api/resources/v1/` and are JSON over HTTP. They require the server's bearer token in the `Authorization` header whenever the server requires the token, and require nothing on a tokenless server. They carry each type's operations on a store addressed by [`StoreAddress`](#^rs-records), creating, changing and revoking share links, listing, information, description and usage changes and destruction, and, with the flag on, creating stores and managing bindings, with full access to every store whatever the access its pages have. They never accept an artifact ID or share ID as authority. Agents receive resource events from [the `/events` stream](#^rs-events-stream). ^rs-admin-routes

### Requests from other origins

The server serves requests and WebSocket upgrades on either route family whatever their `Origin` header, and sends no CORS headers on these routes. The ID in an artifact route's path, or the token on an administrative route, is the whole authorization: a page on another site that holds an artifact ID or share ID reaches the store at that ID's level, as any client holding it does, and a server that requires the token refuses an administrative request without it wherever the request comes from. The routes do not depend on the scheme or host a browser used to reach the server, so pages served through [a front that terminates TLS](../../product/resources/resources.md#^rs-https-front) and forwards plain HTTP, whose origins are `https:`, use them as other pages do. No resource route changes state on `GET` or `HEAD`. ^rs-any-origin

A shared artifact's page is framed with the producer's URL directly (`packages/web/src/artifact-dispatcher.ts`), so its document has the producer's origin and its SDK connects to the producer's server.

## The page connection

The SDK keeps at most one page connection open per page load, for as long as the page has listeners, callbacks, unconfirmed writes or outstanding requests, and reconnects when it is lost ([sdk.md](./sdk.md#^sdk-connection)). Each connection stands alone: the server keeps nothing about a page between its connections, and the SDK never sends a write or request on more than one connection ([sdk.md](./sdk.md#^sdk-reconnect)). ^rs-page-connection

- **Opening state.** On each connection the server first sends the page's *access*: the level the connection's ID carries on its artifact's own store, or nothing when it reaches no artifact that has a store; and with the flag on, the resource ID of that store once its first write has created it, unless the bindings file cannot be read, and the artifact's explicit bindings, each with its store's resource ID, type and the page's level on it. It also sends the server's current time. It carries no artifact ID or share ID.
- **Checks.** The server checks the page's access for every operation when it applies it, not when the connection opens, resolving the connection's ID again each time. A write through `read` access is refused with `read-only` before the type's code runs. An operation on the artifact's own store when the ID reaches no artifact that has one is refused with `no-store`. With the flag off, an operation on a store by resource ID is refused with `not-enabled`; with it on, one on a store the artifact is not bound to is refused with `not-bound`, and one on a resource of another type with `wrong-type`.
- **Write order.** Each write carries a sequence number that increases with every write the page sends on the connection. The server handles a connection's writes in the order it receives them, one at a time across all of the connection's stores, applying or refusing each, and answers each by its sequence number. Writes on different connections have no order between them: the server may handle a write it received on a connection the page has since lost after writes on the page's next connection. ^rs-write-sequence
- **Notifications before acknowledgement.** When a write is applied, the server sends this connection's subscription updates caused by the write before it sends the write's acknowledgement. Acknowledgements follow the type's durability rule, so a page never sees its write confirmed before other clients could see it. ^rs-notify-before-ack
- **Changes of access.** When the level of the share link a connection was opened under changes, the server sends the connection its access again, as the opening state gives it, at the new level, and then, with the flag on, `bound` for each binding whose level for the page changed. One message carries the whole access, so the SDK holds the new level for every store at once, and a page whose artifact has no store is sent no level after the change either. With the flag on, the server also sends the access again when the artifact's own store gets its resource ID, as soon as its first write has saved the artifact's pointer, even when a later step of that write fails, and when it loses it, as soon as a destroy [takes effect](#^rs-destroy-order). A revocation, or the artifact's deletion, closes the connection ([changing a share link](#^rs-share-change)). A change of the artifact's path closes nothing: whether it [has a store](#^rs-has-store) does not depend on its path, and its store stays its own. With the flag on, when a binding is removed or its store destroyed, the server ends the connection's subscriptions to that store with `not-bound` and sends the corresponding event, and when a binding's level changes, it sends `bound` with the page's new level. When the artifact's own store is destroyed, the connection's subscriptions to its own store, made without its resource ID, stay, and each hears the root with no value as soon as the destroy [takes effect](#^rs-destroy-order), even when a later step of it fails; the artifact's next write creates its new store. ^rs-own-store-destroyed
- **Events.** The server sends the connection the [page events](#^rs-arch-events) the product spec gives a page.

## Resource events

```ts
type ResourceEvent =
  | { event: "changed"; resourceID: ResourceID; artifactID?: string; paths: string[] }   // artifactID: an own store's owner
  | { event: "created"; resource: ResourceSummary }
  | { event: "updated"; resource: ResourceSummary }
  | { event: "destroyed"; resourceID: ResourceID; artifactID?: string }                  // artifactID: an own store's owner
  | { event: "bound"; resourceID: ResourceID; artifactID: string; access: AccessLevel }
  | { event: "unbound"; resourceID: ResourceID; artifactID: string };

/** What a page receives: no artifact ID, description or usage. A changed event without a resource ID is about the page's own store. */
type PageEvent =
  | { event: "changed"; resourceID?: ResourceID; paths: string[] }
  | { event: "destroyed"; resourceID: ResourceID }
  | { event: "bound"; resourceID: ResourceID; access: AccessLevel }   // the page's level on the store
  | { event: "unbound"; resourceID: ResourceID };
```

The layer emits each event after the change it reports is stored, and `destroyed` once the destroy [takes effect](#^rs-destroy-order). `changed` lists in `paths` where the content changed, in the type's own terms; for a JSON store these are the paths the write touched ([json-store.md](./json-store.md#^js-arch-changed-paths)). Every event identifies its store by its resource ID, and `changed` and `destroyed` identify an own store by `artifactID` as well, the owner its manifest records, which is a deleted artifact's for a deleted artifact's store, so a client following an artifact's store before its first write recognizes it. `updated` follows a change to a description, a usage or both. A resource's status is settled when the layer reads its stored data, so no event reports one. Destroying a resource emits `destroyed` alone: its bindings go with it, so it emits no `unbound`. `changed`, `updated` and `destroyed` exist whatever the flag, and `created`, `bound` and `unbound` only with it on. A page receives `changed` for its artifact's own store, without a resource ID, and with the flag on the subset [the product spec](../../product/resources/resources.md#^rs-events) gives it for the stores its artifact is bound to explicitly, by resource ID, in the shapes of `PageEvent`; `bound` and `unbound` reach a page only for its own artifact, and `updated` and `created` never reach a page. ^rs-arch-events

**Buffer: the `/events` stream.** The server's `/events` WebSocket, whose wire vocabulary is otherwise code-authoritative ([arch/channel-state/index.md](../channel-state/index.md)), is how agents receive resource events: `tv resource events` and `tv resource json watch` read it ([CLI integration](#^rs-cli-integration)). This buffer makes authoritative only what those commands rely on:

- The stream carries every resource event as `{ type: "resource-event", event: ResourceEvent }`, in the order the layer emits them, to every client connected when each is emitted.
- A client presents the server's token as the `token` query parameter. A server that requires the token closes a connection without the valid token with WebSocket status 4401; a tokenless server accepts every connection.
- The first message on a connection is `server-status`, sent only once the token check has passed ([version-advertisement.md#^events-version](../updates/version-advertisement.md#^events-version)). A client that has received it therefore receives every resource event emitted afterwards.
- The stream carries the app's other messages as well, and a client ignores the message types it does not use. The web client has no use for resource events yet and ignores them under the [unknown-message rule](../updates/version-advertisement.md#^unknown-messages).

Like the resource routes, the stream serves any origin. A server that requires the token closes it to any client without the token, but on a tokenless server a page on another site can open it and read every resource event, including the artifact IDs that `changed`, `bound` and `unbound` carry, as it reads the stream's other messages. This is an accepted exposure of tokenless mode ([product](../../product/resources/resources.md#^rs-tokenless)), which is also why a tokenless server refuses share links. ^rs-events-stream

## Errors

Every refusal carries a stable code. The layer's codes are:

```ts
type ResourceErrorCode =
  | "not-artifact-page"  // SDK only: the page is not served as artifact content
  | "no-store"           // the ID or artifact reaches no artifact that has a store
  | "not-enabled"        // an operation the bindings flag hides, while it is off
  | "not-bound"          // the artifact is not bound to this store
  | "wrong-type"         // the resource is of another type than the operation
  | "read-only"          // a write through read access
  | "not-found"          // administrative: no resource has this resource ID
  | "no-artifact"        // administrative: --artifact, a share command, bind or list --artifact names no artifact on the server
  | "not-shareable"      // administrative: sharing a URL artifact
  | "not-shared"         // administrative: revoking the link of an artifact that has none
  | "tokenless"          // administrative: creating or changing a share link on a tokenless server
  | "access-required"    // administrative: sharing without a level an artifact whose link is read-write
  | "read-write-unsupported" // administrative: sharing a Markdown file artifact at read-write
  | "owner-binding"      // administrative: binding or unbinding an own store's owner, which is always bound
  | "invalid-description" // a description that is empty, over its limit or more than one line
  | "invalid-usage"      // a usage over its limit
  | "still-bound"        // destroy without force while artifacts are bound, an own store's owner included
  | "unavailable"        // the stored data is unavailable, or a save's outcome is unknown (below)
  | "disconnected";      // SDK only: the page was disconnected from the server, or lost its connection before the server answered
```

`unavailable` refuses an operation for one of two reasons, and its message says which. Either the stored data the operation needs is unavailable: a store whose files [loading](#^rs-load) could not read or validate, or, with the flag on, the bindings file, without which the layer refuses every binding request and every page operation on a store by resource ID. That lasts until the files can be read, by a later start. Or a save's [outcome is unknown](#^rs-arch-uncertain-save): the server has taken what the file holds as current, and the resource stays available, so a client can read it and retry.

Each type adds codes for its own operations ([json-store.md](./json-store.md#^js-arch-errors)). The administrative routes answer a refusal with a non-2xx status and `{ error: string, code: string }`; a `still-bound` refusal also carries `bindings: ResourceBinding[]`.

## What each type implements

A resource type supplies, behind one server-side interface the layer calls:

- its type name, and its content files with their validation, which loading reads;
- the content of a store with no value, which an artifact's own store has before its first write, and creation of a store from its starting content;
- its operations, each classified as a read or a write, so the layer can apply the access check before the operation runs;
- its subscriptions, when it emits `changed`, and the paths that event lists;
- its limits, and when its stored data is unavailable;
- its SDK accessor and handle ([sdk.md](./sdk.md)), and its CLI verbs under `tv resource <type>`.

The layer owns everything else: resource IDs, artifacts' own stores and share links, descriptions, usages, status reporting, bindings and access checks, routes, connections, events, manifests and the bindings file. ^rs-type-contract

## CLI integration

The share commands and the `tv resource` commands contact the server like every other client command ([arch/cli/index.md](../cli/index.md#Client boundary)) and call the shared client's resource methods:

```ts
interface ResourcesClient {
  /** Creates the artifact's share link at this level, or changes its level; gives the link's path apart from the server's origins. */
  share(input: { artifactID: string; access?: AccessLevel }): Promise<{ shareID: string; access: AccessLevel; path: string; origins: string[] }>;
  /** Revokes the artifact's share link. */
  unshare(input: { artifactID: string }): Promise<void>;
  list(input?: { artifactID?: string }): Promise<Array<ResourceSummary & { access?: AccessLevel }>>;
  /** A resource's summary and bindings, an own store's owner included. */
  info(input: { resourceID: ResourceID }): Promise<ResourceSummary & { bindings: Array<Omit<ResourceBinding, "resourceID">> }>;
  /** Changes the description, the usage or both; at least one is given. */
  describe(input: { resourceID: ResourceID; description?: string; usage?: string }): Promise<ResourceSummary>;
  destroy(input: { resourceID: ResourceID; force?: boolean }): Promise<{ removedBindings: ResourceBinding[] }>;
  /** Reads the `/events` stream and calls onEvent for every resource event on it until signal aborts or the stream's connection ends. */
  events(input: { onEvent: (event: ResourceEvent) => void; signal?: AbortSignal }): Promise<void>;
  // With the bindings flag on:
  bind(input: { resourceID: ResourceID; artifactID: string; access: AccessLevel }): Promise<{ authRequired: boolean }>;
  unbind(input: { resourceID: ResourceID; artifactID: string }): Promise<void>;
  json: JsonStoreClient; // json-store.md
}
// On TelevisionClient: readonly resources: ResourcesClient
```

`tv share-artifact` calls `share` with `--id` and, when it is given, `--access`, and prints each of the reply's `origins` followed by its `path`, `/artifact/<share-id>/`, one per line, through the formatter that [`tv links`](../cli/index.md#Client boundary) uses. The origins are [the server's origins](../cli/index.md#^cli-server-origins), the list `tv links` uses. The reply gives the path apart from them, so that a client that knows the origin it was loaded from, such as a page of the app, can join that origin with the path. `tv unshare-artifact` calls `unshare` and prints the product's line. A `--access` value other than `read` or `read-write` is a directive error that makes no call. ^rs-share-cli-integration

With the flag off, the CLI registers neither `bind` nor `unbind` nor `tv resource json create`, not even as hidden commands, so no help that Commander generates lists them and invoking one is an unknown-command directive error. Each common command makes the one call its name matches, passing the resource ID it is given. `list --artifact` passes `artifactID`, and its results carry `access`. `describe` passes the description it is given, the text of `--usage`, or both, and without either it is a directive error that makes no call. `bind` writes the product's tokenless warning to stderr when the result's `authRequired` is false. `events` prints each event as compact JSON on its own line, ends with status 0 on `SIGINT` or `SIGTERM`, and fails like any unreachable-server command when the connection ends. Refusals arrive as HTTP status errors whose messages the server writes in the product's wording, and the CLI prints them as it prints other HTTP status errors.

The shared client reads [the `/events` stream](#^rs-events-stream) for `events` and for the JSON store's [`watch`](./json-store.md#^js-arch-watch). It passes on only `resource-event` messages and ignores the stream's others. A connection the server closes with 4401 is reported as an HTTP `401` is, so these commands print the same unauthorized message as the HTTP commands; a connection that closes for any other reason, or never opens, fails as an unreachable server does. ^rs-cli-integration

## Testing

Coverage of requests from other origins sends real requests to a running server, including requests of the kind browsers send without a CORS preflight and WebSocket upgrades, with another site's `Origin` and with the `https:` origin of a page behind a front that terminates TLS. Storage, loading and startup-recovery coverage uses a real filesystem. Behavior that exists only with the bindings flag on is covered on servers and CLI environments constructed with the flag on, and the shipped build's refusals with the flag off.
