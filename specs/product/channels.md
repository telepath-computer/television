*What a channel is to a user: identity, creation, renaming, deletion, pinning, ordering, and how one channel is the focused one everywhere.*

**Status:** implemented redesign product authority. TV-549 tracks the caller-supplied-id gap stated below.

# Channels

A channel is the workspace a person keeps related work in: a named collection of open artifacts, listed in the channel sidebar, shown one at a time. This spec describes what a person can do with channels and what the app promises about them — not how the channel sidebar draws them, which is that surface's own spec.

## What this owns

This spec owns the user-facing behavior of channels. It deliberately does not own:

- The channel sidebar's interaction, markup, and styling — [ui/app/sidebar/index.md](../ui/app/sidebar/index.md) (UI), exclusively.
- The layout a channel holds — its ordered tab pages — [arch/layout/index.md](../arch/layout/index.md); their user-facing behavior is [tab-pages.md](./tab-pages.md).
- The `tv` commands that create and manipulate channels — [cli.md](./cli.md).

## What a channel is

A *channel* is the unit a person keeps their work in: it has a name, an ordered set of open artifacts arranged as tab pages, and a stable identity. Channels belong to the server: every client connected to that server sees the same channels, with the same names, in the same order. ^ch-definition

The client connects to exactly one server, so the channel sidebar lists one server's channels and a channel never needs to say which server it belongs to. ^ch-single-server

**Identity.** A channel's id is minted by the server and never changes. Ids are ULIDs, whose leading bits encode creation time — so sorting channels by id is sorting them by creation, and the model carries no separate creation-time field. One deliberate gap: the API still accepts a caller-supplied id verbatim, so id sortability is not yet an owned contract; today only Television's own code creates ids, so they are reliably sortable. Closing the gap is tracked as [TV-549](https://linear.app/telepath-computer/issue/TV-549). ^ch-identity

## Creating

Anyone can create a channel at any time, from the UI or from the CLI ([cli.md](./cli.md)). A new channel starts empty — no artifacts, no tab pages — and unpinned. ^ch-create

## Renaming

A channel's name is the user's to change at any time. The name is server state: renaming a channel renames it for every client. Renaming changes nothing else — not the channel's id, its ordering position, or its contents. (The in-place rename interaction is [ui/app/sidebar/index.md](../ui/app/sidebar/index.md)'s.) ^ch-rename

## Deleting

Deleting a channel is permanent, and confirms before acting (the confirmation dialog is [ui/app/sidebar/index.md](../ui/app/sidebar/index.md)'s). Deleting a channel hard-deletes the channel's metadata and every artifact registry record referenced by it; artifact removals complete before the channel removal is announced. Television never deletes or mutates the filesystem paths or remote URLs those artifact records point to. ^ch-delete-semantics

When the focused channel is deleted, the app lands on the first remaining pinned channel; if there are no pinned channels, the first unpinned one; if there are no channels at all, the no-channels empty state (its design is the stage's — [ui/app/stage/index.md](../ui/app/stage/index.md)). ^ch-delete-selection

## Pinning and ordering

- **Pinning is shared.** Pinning or unpinning a channel updates every connected client. ^ch-pin-shared
- **Pinned channels are ordered by hand.** The user arranges the pinned channels, and every connected client sees the same order. ^ch-pin-order
- **Pinning moves a channel between the groups.** Pinning places a channel in the pinned group; unpinning returns it to the unpinned group, where its position is simply its creation-ordered slot ([below](#^ch-unpinned-order)). The channel row menu's Pin action places the channel at the end of the pinned list, and its Unpin action returns it to its creation-ordered slot. Dragging a channel into the pinned region places it at the dropped position; dragging it out returns it to its creation-ordered slot. ^ch-pin-placement
- **Unpinned channels are ordered by created date, newest first.** Creation time derives from the channel id ([Identity](#^ch-identity)) and never changes when a channel is focused — so the list never re-sorts under the user, and new channels surface at the top. Users who care about a channel's position pin it and place it. ^ch-unpinned-order

## Focus

The server tracks which channel is *focused* and broadcasts changes to all clients: every connected client shows the focused channel, so all of them are looking at the same work. Selecting a channel focuses it — for everyone. The CLI's focus commands move the same state ([cli.md](./cli.md)), and so does the navigation chord's vertical movement ([product/keyboard-navigation.md](./keyboard-navigation.md)). ^ch-focus-broadcast

What is selected *within* a channel — which tab page — is deliberately not shared; that is [tab-pages.md](./tab-pages.md)'s.

## Disconnection

Losing the server is a shell-wide transition to the disconnected state ([ui/app/index.md](../ui/app/index.md), Connection states) — channels have no individual offline state, because they all live on the one server. ^ch-disconnect

## Testing

Channel-lifecycle acceptance must use the channel sidebar in a real browser against a running Television server.

Deletion acceptance must use the real confirmation and inspect the real server storage, a referenced filesystem path, and a referenced remote resource after cancellation and confirmation.

Every shared-state acceptance case must use two connected clients, with the change reaching the second client without a reload.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), the [channel-state architecture spec](../arch/channel-state/index.md) owns real HTTP and websocket evidence that artifact removals precede channel removal and that the resulting pin and focus changes arrive in order. The [app shell](../ui/app/index.md#connection-states) owns the disconnected state across the whole shell. The [channel-sidebar UI](../ui/app/sidebar/index.md) owns its controls, drag behavior, and motion. This spec does not require duplicate tests for event ordering, disconnection, or sidebar interaction.

