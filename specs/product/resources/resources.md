*Resources: data the server keeps for artifacts and agents — each local artifact's own store, share links that give other people access to an artifact at a chosen level, descriptions and usage, created stores and bindings behind the bindings flag, the limits of the access model, and the share and `tv resource` commands common to every type.*

# Resources

An HTML artifact often needs data that outlives its page and that more than one party uses: a to-do list that the person checks off and the agent adds to, a form an agent reads later, a counter that several viewers update. Browser storage such as `localStorage` cannot hold such data: each browser keeps its own copy, no other viewer sees it, and the agent cannot reach it. Television keeps such data on its server as resources. Every artifact this server serves from its own files has its own store, which its pages and agents read, write and watch live, and an artifact can have a share link that gives other people access to it at a chosen level.

## What this owns

This spec owns the user-facing behavior that every resource type shares: what a resource is, its resource ID, description, usage, status and lifetime, an artifact's store, share links and access levels, how an artifact's page uses its store, resource events, the bindings flag and the created stores and bindings it adds, the limits of the access model, and the share commands and the `tv resource` commands common to every type, with their output. The one resource type, its content behavior, and its `tv resource json` commands are owned by [the JSON store spec](./json-store.md). The implementation is owned by [the resource architecture](../../arch/resources/index.md), and what agents are taught by [the resource guidance spec](../../arch/resources/guidance.md).

The share commands and the `tv resource` commands follow the CLI's general behavior: home selection, connecting to the server, directive errors and the recovery pointer ([cli.md](../cli.md)).

## Resources and types

A *resource* is something the server keeps on behalf of artifacts and agents, with a lifetime independent of any artifact. Every resource has a *resource ID*, generated at random when the resource is created, unique among resources and unrelated to any artifact's ID. A resource has no name: its resource ID is the only way to address it. Every resource also has a [description and a usage](#^rs-usage). Its *resource type* decides what it holds and which operations it offers. Television has one resource type, `json`: the [JSON store](./json-store.md), one persistent JSON value. ^rs-resource-id

## An artifact's store

Every local path artifact has its own JSON store, its *artifact's store*, which its pages use by default. A page gets it with `getStore()`, and an agent reaches it from the shell with `tv resource json` and the artifact's ID ([JSON store commands](./json-store.md#Commands)). Nothing needs to be created or bound. ^rs-artifact-store

- **It exists from the moment the artifact does.** Until something writes to it, its root has no value, as after removing the whole value, and nothing is stored on disk. A page can read and observe the store and check its access before the first write, and its listeners carry on across that write without noticing it.
- **Every local path artifact has a store:** every path artifact this server serves from its own files, whatever kind of file or folder it is, with an ID that Television generated. No rule restricts stores, or bindings, to a kind of local path artifact: a Markdown file artifact has a store too, though nothing it renders uses one, and with [the bindings flag](#^rs-flag) on a store can be bound to it, which is useless but allowed. A URL artifact has none, including a shared artifact served by another Television host. Onboarding artifacts installed by earlier releases, whose fixed IDs predate generated ones, have none either ([onboarding](../onboarding/onboarding-channels.md#^onboarding-artifact-ids)).
- **An agent addresses the store by the artifact's ID.** It uses the ID it already has and does not need the store's resource ID.
- **The page's code documents the data.** Next to the `getStore()` call, a comment describes the store's structure and rules: each field's type and whether it is required, what the page writes and what agents write. The description travels with the artifact's files and changes with the code that defines the data ([the resource guidance](../../arch/resources/guidance.md#^rg-teaches)).
- **A resource ID grants a page nothing.** A page reaches data only through the artifact ID or [share ID](#^rs-share-id) in its own address and, with [the bindings flag](#^rs-flag) on, through its artifact's [bindings](#^rs-binding). Resource IDs are therefore not secret, and a page may learn them; an artifact's ID is kept from [share viewers](#^rs-share-hides-id).

Underneath, an artifact's store is an ordinary JSON store with a resource ID of its own, which its artifact is bound to at `read-write`. The artifact's record points to it from the store's first write on, and that pointer is what makes it the artifact's *own store*, the one `getStore()` and `--artifact` reach. The owner's binding is implicit: it cannot be changed or removed while the pointer stands. The store also records which artifact owns it, for people browsing its files and for recovery; the artifact's pointer is what counts. An own store differs from any other store only in these respects. ^rs-own-store

The first write gives an own store this description, which never contains the artifact's ID, since a page opened through a share link must never learn it ([the promise to share viewers](#^rs-share-hides-id)); an agent can change it, as any store's:

```text
Store owned by an artifact, created at its first write.
```

Deleting an artifact removes its record, and with it its share link. The artifact's files stay on disk, and so does its store, which still records the deleted artifact as its owner. To recover, an agent registers the files as a new artifact and copies the old store's data into the new artifact's store: it finds the old store with `tv resource list`, which reports each store's owner, deleted artifacts included, reads it with `tv resource json get --resource <resource-id>`, or reads the store's content file directly, and writes the data with `tv resource json set --artifact <new-id> --file <path>`. ^rs-artifact-deleted

## Status

A resource's status is `available`, or `unavailable` with a reason, such as stored data the server cannot read. The server leaves an unavailable resource's stored data exactly as it is, operations on its content fail, and other resources keep working. The server learns a store's status when the store is first used ([the JSON store spec](./json-store.md#^js-storage)). ^rs-status

When the server cannot confirm that a change to a resource, to an artifact's share link or to the bindings reached the disk, it refuses the change, saying that its outcome is unknown, and keeps what its saved data holds, which is ordinarily the change. Nothing becomes unavailable for this: a client can check what is there and retry. Such a change may not yet be durable, and a crash of the machine before the next successful save can lose it. This is accepted so that a passing disk error leaves resources usable. ^rs-uncertain-save

## Share links

An artifact has at most one *share link*. The agent creates it at an [access level](#^rs-id-levels), `read` or `read-write`. It can change the link's level at any time without changing the link, and it can revoke the link, which stops it working for everyone who holds it. Sharing again after a revocation creates a different link. ^rs-share

Only local path artifacts can be shared: those this server serves from its own files at `/artifact/<id>/`. A URL artifact cannot be shared, whether it is an external web page or a shared artifact from another Television host: serving a share link to it would mean sending the viewer to the artifact's original address, which would reveal that address and escape the link's level and revocation. A person who wants to pass on another producer's artifact asks that producer for a link. A share link to a path artifact that is not HTML, such as a Markdown file, works as a view of the file. A link's level caps whatever access to resources the artifact has, through its own store or, with [the bindings flag](#^rs-flag) on, its bindings; whether the artifact has a store decides nothing about sharing. The one exception is a Markdown file artifact, which can only be shared at `read`: its shared page is a static rendered page, which no one can edit through the link, so a `read-write` link would mislead whoever creates it. Sharing one at `read-write`, whether creating its link or changing the link's level, is refused, saying that read-write sharing is not supported for it, while a `read` link to it works as any other. ^rs-shareable

A share link has the shape of an artifact's own address, `/artifact/<share-id>/`. Its *share ID* is random and separate from the artifact's own ID. The artifact's files and relative paths therefore work unchanged through the link; the resource SDK, which reads its ID from the page's address, connects with the share ID without any change to the artifact's code; and another Television host that adds the link to a channel recognizes it as a [shared artifact](../artifacts.md#Shared artifacts). The link carries no token: the share ID is the whole capability. ^rs-share-id

Every ID that reaches an artifact carries an *access level*, `read` or `read-write`. The artifact's own ID carries `read-write`, and a share ID carries its link's level. A page has that level on its artifact's store. ^rs-id-levels

Creating, changing or revoking a share link takes effect once the artifact's record is saved, and only then is it acknowledged. When the save's outcome is uncertain, the server reads the record back, takes what it finds as current, and reports that the outcome is unknown, so that the agent can check and retry ([uncertain saves](#^rs-uncertain-save)). Once a change takes effect, pages open through the link hear the new level, and a revocation closes their connections and stops the link's address serving the artifact. ^rs-share-changes

Share IDs are generated as artifact IDs are, and are not derived from them. Share IDs and artifact IDs appear in the same address form, so no new artifact ID or share ID equals any existing artifact ID or share ID. A share link is kept in its artifact's record, so deleting the artifact deletes its link.

A server running without an auth token refuses to create a share link or change its level. Anyone who can reach such a server can already read its event stream, which carries artifact IDs ([tokenless mode](#^rs-tokenless)), so a share link would protect nothing there. Revoking a link works on any server. ^rs-share-tokenless

**The artifact ID never reaches a share viewer.** A viewer holding only the share link has no way to learn the artifact's own ID through the page or anything the browser receives. The promise concerns the page and what the browser receives through the link; a person who also holds the server's token can read artifact records through the server's interface. These are the places the ID could appear, and the rule for each: ^rs-share-hides-id

1. The page's address contains only the share ID.
2. The SDK's responses, such as the page's access level, carry no artifact ID. What they report about a store is what Television generates, its resource ID, type and the page's level on it, never the description or usage an agent wrote.
3. The events a page hears carry no artifact ID, description or usage.
4. Redirects, such as from `/artifact/<share-id>` to `/artifact/<share-id>/` or to a folder's index, error pages and response headers are built from the ID in the request, never from the artifact's own ID or from the names of its files on disk, which can contain it. An artifact that is a single file is served at the link's address itself, not redirected to its file's name.
5. The artifact's own content is outside Television's control: its files and the data its store holds. If an agent writes the artifact's ID into them, for example in an absolute link, a share viewer sees it. Keeping an artifact's links relative, as [the `television` skill](../../arch/resources/guidance.md#^rg-teaches) teaches, is the author's responsibility.

## Access

The server checks a page's access for every operation when it applies it, not when the page connects, so a change of level applies at once, including to pages already open. It classifies each of a type's operations as a read or a write, and refuses a write through `read` access before the operation touches the resource. [The JSON store spec](./json-store.md#^js-access) lists the store's reads and writes. ^rs-read-enforced

## Using the store from an artifact's page

An artifact's page uses its store through the resource SDK, a JavaScript module the server serves at `/sdk/v1/resources.js`. The page imports it from the server that served the page and calls `getStore()`. Artifact source contains no artifact ID, token or other secret, and needs no setup: the SDK finds the artifact from the page's own address, which holds the artifact's ID or a share ID. ^rs-sdk-own-address

From the SDK, a page can:

- use its artifact's store through the JSON store's functions;
- read its access level, and hear when a change to the share link it was opened through changes it, including when the link is revoked and the page has no access;
- see whether it is connected to the server, and be told when that changes ([the connection](#^rs-connection));
- receive events about its artifact's store ([Resource events](#Resource events));
- with [the bindings flag](#^rs-flag) on, use a store its artifact is bound to with `getStore(resourceId)`, its own included, and list the stores it can use, each with its resource ID, type and the page's level on it.

Getting the store with `getStore()` involves no network request and always succeeds. When the artifact has no store, the first operation on it fails. Errors from the SDK carry a stable code that says what went wrong. ^rs-sdk-handles

A page's connection to its server can be lost, and the SDK reconnects on its own. There is no offline mode: while the page is disconnected, its reads and writes fail at once rather than wait for the connection to return, and its listeners stay in place and catch up when it does. A page can read the connection's status, which says whether it is connecting, connected or disconnected, or idle while the page uses nothing that needs a connection, and register a callback for its changes, so that it can show the person when their changes cannot be saved. ^rs-connection

Every SDK feature works on a page served over plain HTTP from an address other than `localhost`, such as a LAN or tailnet address, where browsers withhold features they reserve for secure contexts. ^rs-plain-http

A shared artifact works in its viewers' apps. A viewer's app loads a shared artifact's page from the producer's server, so the page uses the producer's store at the level its address carries, its writes land in the producer's data, and changes made on the producer reach it live. ^rs-shared-artifact

## Resource events

Television reports these resource events:

| Event | When |
|---|---|
| `changed` | A resource's content changes. A type emits it only if it has a notion of content change; the JSON store emits it for every write it applies, naming the paths the write touched. |
| `created` | A store is created explicitly. |
| `updated` | A resource's description or usage changes. A resource's status is settled when the server reads its stored data, so no event reports it. |
| `destroyed` | A resource is destroyed. |
| `bound` | An artifact is bound to a store, or its binding's level changes. |
| `unbound` | A binding is removed, other than by destroying its store. |

`changed`, `updated` and `destroyed` exist whatever the flag; `created`, `bound` and `unbound` exist only with [the bindings flag](#^rs-flag) on. A page receives `changed` for its artifact's own store, which it identifies as its own store without an ID, and hears a change of its own access level. With the flag on, it also receives `destroyed` and `changed` for the other stores its artifact is bound to, identified by their resource IDs, and `bound` and `unbound` for its artifact's own bindings; a store becomes visible to a page through `bound`. A page never learns about other artifacts' bindings, and no event a page receives carries an artifact ID, a description or a usage; a page never receives `updated` or `created`. Agents receive events from the server's event stream: `tv resource json watch` follows a store's changes, and `tv resource events` prints every resource event. On the stream, an event about an own store identifies it by its resource ID and its owner artifact's ID. ^rs-events

## Description and usage

Every resource has a *description*, a line that says what it holds and what uses it, which is always required, and a *usage*: free text, which may span several lines, in which an agent describes the structure of the resource's content and the rules that the code and agents reading and writing it should follow, in whatever form it judges best. The usage is empty unless one is given. An own store starts with [its fixed description](#^rs-own-store) and an empty usage. Both can be changed at any time, whatever the flag, without affecting the resource's content or bindings, and both are shown wherever an agent inspects the resource. They are written for agents, and no page receives them. The usage lets an agent that did not create a resource use it the way its pages expect. ^rs-usage

## Lifetime

A resource exists until it is destroyed. Deleting an artifact, or removing the channel that holds it, never deletes a store, its own store included; with [the bindings flag](#^rs-flag) on, it removes that artifact's bindings. Nothing deletes a resource because no artifact is bound to it. ^rs-lifetime

Destroying a resource that artifacts are bound to is refused unless forced, and the refusal lists them. An own store's owner is always bound to it, so destroying an own store whose artifact exists always needs force. A forced destroy removes those bindings with the resource. Destroying an own store also removes its owner's pointer to it, saved before the store's files are deleted, so the artifact's next write creates a new store with a new resource ID, never the destroyed one; until then, pages open on the artifact see their store's root with no value. A destroy takes effect at its first step, which for an own store is removing the pointer: from then on the store is gone for pages and agents, even if a later step fails. Such a failure is reported, and destroying the store again deletes what is left; until then, a restart of the server finds what is left as a store again. Destroying is available whatever the flag, so that people and agents can always delete their data; a new own store appearing when the artifact is used again is accepted. Making that later use fail instead is a known later refinement ([TV-950](https://linear.app/telepath-computer/issue/TV-950)). ^rs-destroy-bound

## Created stores and bindings, behind a flag

The *bindings flag* is a constant in the shipped code, off by default. How it is changed is decided later. ^rs-flag

| Available whatever the flag | Available only with the flag on |
|---|---|
| `getStore()`, the artifact's own store | `getStore(resourceId)`, a store bound to the artifact, with `listResources` and `getResourceInfo` |
| `tv resource json get/set/update/push/remove/watch` with `--artifact` or `--resource` | `tv resource json create` |
| `tv resource list`, `info`, `describe`, `destroy` and `events` | `tv resource bind` and `unbind` |
| Share links: `tv share-artifact` and `tv unshare-artifact` | Bindings other than an owner's to its own store |
| The connection status, the page's access level, the JSON store's data functions | |

With the flag off, the CLI has no `tv resource json create`, `tv resource bind` or `tv resource unbind` command: running one fails as an unknown command, and none of them appears in any help the CLI prints. That includes top-level help, the help of `tv resource` and of `tv resource json`, whether asked for with `--help` or with a `help` command, and the help printed for a command line that names one of them, such as `tv resource bind --help`. The server also refuses each operation the second column lists, whether it arrives from the CLI, the administrative interface or a page, with an error saying that it is not enabled; leaving the commands out of the CLI alone would not be enough. Stores are then created only as artifacts' own stores, and no binding but an owner's is used. A store created while the flag was on stays an ordinary store with the flag off, which agents reach with `--resource`, but no page reaches it: the stored bindings are never read and never deleted, and turning the flag on again makes them effective. [The shipped guidance](../../arch/resources/guidance.md#^rg-teaches) teaches only what the first column lists. ^rs-flag-off

With the flag on, agents create stores and bind them to artifacts:

- **Creating stores.** An agent creates a store with `tv resource json create`, giving its description and optionally its usage and starting value, and receives its resource ID ([the JSON store commands](./json-store.md#Commands)). Creating one goes through its type, because each type's starting content differs.
- **Bindings.** A *binding* grants one artifact access to one store, by its resource ID, at an access level, which every binding states; there is no default. Any store can be bound to any artifact, another artifact's own store included. Binding an artifact that is already bound to the store changes its level; an artifact's binding to its own store cannot be changed this way. A binding records an existing artifact and an existing store. Artifacts do not declare the stores they need: an agent or person binds them through the CLI. A page reaches a store its artifact is bound to with `getStore(resourceId)`, its own store included, and its level on it is the lower of the level its address carries and the binding's level. The resource ID in the artifact's source grants nothing without the binding. ^rs-binding
- **Live bindings.** Binding, unbinding and changing a level take effect at once, including for pages already open. A page that loses its binding, or whose bound store is destroyed, finds its next operation on that store failing, and its active listeners on it receive an error. A page whose level changes to `read` has its later writes refused. ^rs-binding-live

## The access model and its limits

Access levels exist so that artifacts can be shared, at an appropriate level, within the trust boundary of the user's own server and clients. The model assumes that artifact code is trusted less than the Television app: artifact code does not hold the server's administrative authority. The ID in a page's address scopes its access, and a share link can be revoked without affecting the artifact or its store. Each artifact's document runs apart from the app and from other artifacts ([artifacts.md#^af-sandbox](../artifacts.md#^af-sandbox)), so on a server that requires the token, one artifact's code learns another artifact's ID only from content or data it is given, or, in the desktop app, from the browser storage that shared artifacts from one producer share ([isolation.md#^iso-limitations](../../arch/artifact-frame/isolation.md#^iso-limitations)). These are the model's limits: ^rs-limits

- **Knowing an ID means holding its access.** Television serves an artifact's content to anyone who has its ID ([artifacts.md#^af-artifact-id](../artifacts.md#^af-artifact-id)), and anyone who can load an artifact through its own ID can read and write its store; anyone holding a share link has the link's level. Their writes land in the producer's data. IDs appear in URLs, browser history, logs and pasted links. Any client holding one, such as a script on another machine or a page on another site, can do what a page with it can.
- **Tokenless servers.** Running without an auth token is the choice of the person running the server, and anyone who can reach such a server can use its administrative interface, including a page on another site open in a browser that can reach it. Pages' access levels still apply there, but the server refuses share links. Such a page can also read every resource event from the server's event stream, which carries resource events to agents and the app, including the artifact IDs in them, as it can the stream's other messages. This exposure is accepted with the rest of tokenless mode; a server that requires the token refuses its administrative interface and its event stream to a page without it. With [the bindings flag](#^rs-flag) on, any client can also change bindings there; [the server's tokenless startup warning](../cli.md#Server lifecycle commands) and `tv resource bind` say so. ^rs-tokenless

The server does not check which site a request comes from. An artifact's ID or a share ID, or the server's token, is the whole gate: a page on another site that holds an ID uses the store at that ID's level, as any client holding it can, and the administrative interface requires the token whenever the server requires one. ^rs-other-origins

Television works behind an HTTPS front: a proxy that terminates TLS and forwards requests to the server over plain HTTP, such as `tailscale serve`. A page reached at the front's `https:` address, whether at its artifact's address or at a share link's, uses the store as it does over plain HTTP. ^rs-https-front

In return, no secret appears in artifact source or agent conversations, `read` access is enforced by the server, and a share link can be revoked without affecting the artifact or its store.

## Commands

### Share commands

```bash
tv share-artifact   --id <artifact-id> [--access <read|read-write>]
tv unshare-artifact --id <artifact-id>
```

`tv share-artifact` creates the artifact's share link at the level `--access` gives, or changes the existing link's level, and prints the link as complete URLs, one per line: each origin the server reports for [connect links](../cli.md#^cli-connect-link), with `0.0.0.0` expanded and none preferred, followed by the link's path, `/artifact/<share-id>/`. Running it again at the same level prints the same link and changes nothing. `--access` defaults to `read`: without it, the command creates a `read` link, or prints the existing link when that is `read`. When the existing link is `read-write`, the command without `--access` refuses and changes nothing, so that leaving out the option never changes a link's level and never hands out a `read-write` link as the default. `tv unshare-artifact` revokes the link and prints `Artifact <artifact-id> is no longer shared.` ^rs-share-cli

- Both commands refuse an ID that names no artifact on the server.
- `share-artifact` without `--access` refuses an artifact whose link is `read-write`, saying that the link is `read-write`, that `--access read-write` keeps it and that `--access read` makes it read-only.
- `share-artifact` refuses a URL artifact, saying that only artifacts this server serves from its own files can be shared, and on a server running without an auth token it refuses, saying that sharing needs the token.
- `share-artifact --access read-write` refuses a Markdown file artifact, saying that read-write sharing is not supported for it and that `--access read` shares it.
- `unshare-artifact` refuses an artifact that has no share link.

### Common commands

The common commands take the resource ID first. `bind` and `unbind` exist only with [the bindings flag](#^rs-flag) on:

```bash
tv resource list [--artifact <artifact-id>]
tv resource info <resource-id>
tv resource describe <resource-id> [<description>] [--usage <text>]
tv resource destroy <resource-id> [--force]
tv resource events
tv resource bind <resource-id> <artifact-id> --access <read|read-write>
tv resource unbind <resource-id> <artifact-id>
```

Each type adds its own commands under `tv resource <type>`, including the `create` command that makes a store of that type with the flag on ([JSON store commands](./json-store.md#Commands)). `info` shows a resource's metadata and `destroy` removes a resource because `get` and `remove` are JSON store operations. The commands act with the server's administrative authority, so they can use every resource whatever its bindings. ^rs-cli

The commands report each resource with its resource ID, type, description, usage, status, the reason when it is unavailable, its creation time and, for an own store, the ID of the artifact that owns it, a deleted one included, in the shape of the architecture's [`ResourceSummary`](../../arch/resources/index.md#^rs-records).

| Command | Output |
|---|---|
| `tv resource list` | `{ "resources": ResourceSummary[] }`: every resource, ordered by resource ID. |
| `tv resource list --artifact <id>` | `{ "resources": (ResourceSummary & { "access": "read" \| "read-write" })[] }`: the stores that artifact is bound to, its own store included once it has been written, ordered by resource ID. |
| `tv resource info <resource-id>` | `{ "resource": ResourceSummary & { "bindings": { "artifactID": string, "access": "read" \| "read-write" }[] } }`: bindings ordered by artifact ID, an owner's included. |
| `tv resource events` | Each resource event as it happens, one [`ResourceEvent`](../../arch/resources/index.md#^rs-arch-events) per line. It runs until interrupted, and fails like any command that cannot reach the server when its connection ends. |

These print compact one-line JSON. The commands that change state print one line of text:

```text
Resource <resource-id> description updated.
Resource <resource-id> usage updated.
Resource <resource-id> description and usage updated.
Artifact <artifact-id> bound to resource <resource-id> with <read|read-write> access.
Artifact <artifact-id> unbound from resource <resource-id>.
Resource <resource-id> destroyed.
```

- `list --artifact` refuses an artifact ID that names no artifact on the server.
- `describe` changes the description, the usage, or both, and needs at least one of them. It takes the whole description as one argument, and the whole usage as the argument of `--usage`, which may span several lines. A description must be one line, and cannot be empty.
- `bind` requires `--access`; omitting it is a directive error. It refuses an artifact ID that names no artifact on the server. On a server running without an auth token it also writes this warning to stderr: ^rs-cli-bind

  ```text
  WARNING: this Television server runs without an auth token, so any client that can reach it can change resource bindings.
  ```

- `unbind` refuses an artifact that is not bound to the store.
- `bind` and `unbind` refuse an own store's owner, saying that an artifact is always bound to its own store.
- `destroy` refuses while any artifact is bound to the resource. The refusal names each bound artifact with its access level, an own store's owner included, and says that `--force` destroys the resource and removes those bindings. With `--force`, the confirmation line becomes `Resource <resource-id> destroyed; removed bindings for <artifact-id>, <artifact-id>.` when there were bindings.
- A command naming a resource ID that names no resource fails with `Resource not found: <resource-id>`.

## Testing

Acceptance for sharing and permissions runs across two servers, because it is the one test that proves the access model as people use it. A producer and a viewer run as real servers on different origins with authentication on and the bindings flag off, as shipped. A real browser holds only the viewer's credentials, and the test uses the built CLI and the shipped SDK. An artifact on the producer is shared through its share link at `read`, and the viewer adds the link as a shared artifact and shows it in the viewer's app. From inside that shared page, the test proves that the producer's server enforces the link's level, not only the SDK:

- writes through `read` access are refused, even when the SDK is bypassed;
- live changes reach the shared page;
- changing the link to `read-write` while the page is open lets its next write through, and the write persists;
- revoking the link closes the page's connection and stops the link's address serving the artifact;
- the shared page cannot reach the producer's administrative interface.

The sharing and permissions acceptance runs in Firefox as well as Chromium, because a shared artifact is a page from another site framed inside the viewer's app, which Firefox treats differently from Chromium. A small number of the feature's other principal paths also run in Firefox, following the repository's existing selection of Firefox tests.

Acceptance for [the promise that the artifact ID never reaches a share viewer](#^rs-share-hides-id) opens an artifact through its share link in a real browser that holds no token, records everything the page and the browser receive (the address, every response and header, redirects, every SDK response and event, and errors), and asserts that the artifact's ID appears nowhere in it.
