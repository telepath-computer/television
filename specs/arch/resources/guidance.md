*Resource guidance: the `resources.md` document bundled inside the `television` skill that teaches agents to use an artifact's own JSON store and share links, what guidance for created stores and bindings must teach when it ships, and what the `tv-tasks` skill says about where task-list data lives and where a live list's messages go.*

# Resource guidance

Agents learn to give artifacts lasting data from one guidance document that travels inside the main `television` skill. This document defines what that guidance teaches and where it comes from, and what the task-list skill says about where its data lives.

## What this owns

This spec owns the content and derivation of the *resource guidance document*, shipped as `resources.md` beside the `television` skill's `SKILL.md` and `theming.md`, what guidance for created stores and bindings must teach, and what the `tv-tasks` skill says about where task-list data lives and where a live list's messages go. The behavior the guidance describes is owned by [product/resources/resources.md](../../product/resources/resources.md), [product/resources/json-store.md](../../product/resources/json-store.md) and the [resource architecture](./index.md); bundle membership and consumer delivery by [making skills](../making-skills.md). The guidance states nothing those specs do not promise.

## Document role and source

The `television` skill's build emits `resources.md` from `packages/skills/skills/television/src/resources.md`, beside `SKILL.md` and `theming.md`. `SKILL.md`, built from `skill-intro.md`, introduces the JSON store by [its purpose](#^rg-purpose) in one paragraph that points to `resources.md`, telling an agent to read it when an artifact's data must be shared by every client viewing it or read or written by the agent, or when the person mentions JSON stores or resources. The document is hand-authored from the specs above, like `SKILL.md`. ^rg-document

## What it leads with

The guidance leads with the JSON store's purpose, in `SKILL.md`'s paragraph and in the opening of `resources.md`, and only then introduces resources, the general concept the JSON store is the first type of: while it is the only type, its use is the reason to read on. A JSON store, a small database that Television keeps on its server, inspired by Firebase's Realtime Database, provides what localStorage cannot: data synchronized live across every client viewing the artifact, and readable and writable by the agent through the `tv` CLI, as for a to-do list that the person and the agent work on together. The guidance says plainly that keeping state that must persist across clients, or that the agent needs to read or write, in localStorage is fundamentally broken, and that something like a to-do list almost certainly belongs in a JSON store, not in localStorage. It makes the JSON store the place for an artifact's state and advises avoiding localStorage for any state: localStorage works on artifact pages today, but a future Television release may break it. It presents localStorage as a good choice for no kind of state, even state that concerns one client: state that only matters while the page is open, such as the active tab, stays in the page itself, and state that should survive a reload or a change of channel, such as text the person has typed but not yet submitted, goes in the JSON store, which every client viewing the artifact shares. It does not call the JSON store a better option than localStorage, which cannot share data or reach the agent at all, or say that the store replaces it. ^rg-purpose

## What it teaches

The shipped guidance teaches only what is available while [the bindings flag](../../product/resources/resources.md#^rs-flag) is off:

- when to use a JSON store, when state belongs in the page itself or in the artifact's files, and to avoid localStorage for any state, as [the guidance's opening](#^rg-purpose) says;
- that every HTML artifact has its own store, which a page gets with `getStore()` and which needs nothing created or bound;
- the comment that documents the store's data, next to the `getStore()` call: each field's type and whether it is required, what the page writes and what agents write, as the example's comment does;
- the JSON store SDK, with a complete artifact example: a to-do list whose store holds the list itself and whose page renders it live, showing `onValue` delivering the current value first, `push` for lists that several clients edit, a transaction, a server-filled value, and the connection status, saying when the page is disconnected and disabling its writing controls until the connection returns, and saying that a change the loss cut off may not have been saved, together with the `tv resource json` commands, addressed with `--artifact`, with which the agent adds and completes the list's tasks, matching the comment. The example is plain HTML, and one short sentence says that the `tv-tasks` skill exists for building to-do lists for a person and is left out of the example to keep its focus on using the JSON store;
- the `tv resource json` commands, addressing the artifact's store with `--artifact` and the artifact's ID;
- not to edit a store's files directly, and why: a write through `tv resource json` changes only the paths it names, is validated, takes its place in order with the page's writes and reaches every client viewing the artifact, while an edit of the files replaces the whole value, can silently drop a write a page makes meanwhile, and is overwritten by the server's next write to the store; reading the store's content file is fine, and editing its files is a recovery step, taken only while the server is stopped;
- that a page sees its own writes immediately, that refused writes roll back, and how to show a "saving" state with `hasPendingWrites` in an `onValue` listener;
- that there is no offline mode: while the page is disconnected, writes and reads fail at once; when the connection is lost, unconfirmed writes roll back although the server may still apply them, and listeners catch up when the connection returns; and how to show the person the connection status with `onConnectionStatusChanged`, as the example does;
- where the store differs from Firebase: `set(ref, null)` stores `null`, deletion uses `remove` or `deleteValue()`, and arrays stay arrays;
- the APIs that do not exist, especially Firebase APIs agents may reach for, such as queries like `orderByChild`, `onDisconnect` and offline persistence;
- checking the page's access level with `getAccess` or `onAccessChanged` and rendering a read-only view when it is `read`, since a share link may open the artifact at `read`;
- share links, with `tv share-artifact` and `tv unshare-artifact`, for when the person asks to share an artifact: the link's level, `read` unless `--access read-write` is given, which a Markdown artifact cannot have, changing it, revoking it, and that the artifact's own links stay relative, so that its ID never appears in what a share viewer receives;
- that no artifact ID, share ID, token or other secret ever goes into artifact source or the data its store holds, which a share viewer's page receives as it receives the source. ^rg-teaches

The guidance's wording on the JSON store's API presents it as inspired by Firebase's, familiar to developers who know that API, and never as having Firebase's shape or behaving as Firebase's does: the store's own specs define its behavior. ^rg-firebase

## Guidance for created stores and bindings

The `television` skill ships no guidance for creating stores and binding them while the bindings flag is off. When such guidance ships, it teaches: ^rg-bindings

- creating a store, binding an artifact to it with an explicit access level, reaching it from the page with `getStore(resourceId)`, and the common commands;
- giving each store a specific description of what it holds and what uses it, and keeping that description accurate with `tv resource describe` as the store's use changes; descriptions and usages are for agents, and no page receives them;
- writing a [usage](../../product/resources/resources.md#^rs-usage) when creating a store, describing the structure of its content and the rules its readers and writers follow; reading a store's usage with `tv resource info` before writing to it; and keeping it accurate with `tv resource describe --usage`;
- that a usage stands on its own: its later reader has only `tv resource info`, which shows the store and the artifacts bound to it, so the usage states each field's type and whether it is required, the rules writers keep, and who writes what, and refers to nothing else outside the store, such as files, conversations or other artifacts;
- not to write code for a store being unbound or destroyed while the page is open: that is rare and usually an agent's own doing, so a page needs nothing for it beyond the error callback that reports any failed operation.

## The task-list skill

The `tv-tasks` skill is presentational: it teaches how to render tasks once an artifact has them, not where they come from or where their state lives. It says that this is the artifact author's choice, which depends on context, and names places the data can come from, such as a JSON store, a third-party API such as the person's productivity app when it has an HTTP API, or the artifact's HTML itself. It points to a JSON store as a good place for a to-do list's data, referring to the `television` skill's `resources.md`, and tells the agent not to keep a to-do list in localStorage, saying that localStorage may break in a future Television release. ^rg-tv-tasks

For a list whose tasks arrive or change while the page is open, such as one rendered from a JSON store, the `tv-tasks` skill says where the list's status or error message goes: in the page header, after its title and any subtitle. A list that shows such a message has a page header to hold it. ^rg-tv-tasks-message

## Testing

The complete artifact example in the guidance must run as written, in a real browser against a running server, registered as an artifact and using its own store, so the guidance never teaches code that does not work.
