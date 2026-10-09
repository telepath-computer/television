> **Archived 2026-10 from branch stlhood/cli-artifact-layout.** This was the proposal the human approved before the spec edits; the specs follow it, with the move's crash safety (a durable move record that commits the move and is completed before any later change or at startup) added during spec review in specs/arch/layout/index.md#^ly-move. It is the one place the approved intent is stated as a whole, including what was left out of scope. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Proposal: arranging artifacts from the CLI

## Goal

An agent using `tv` can see and change how every artifact in a channel is arranged — its page's size, whether the page is full-screen, and its position in the channel's left-to-right order — and can move an artifact to another channel. The `television` skill teaches agents to do this.

## What exists

A channel's layout is an ordered list of tab pages ([arch/layout/index.md](../../specs/arch/layout/index.md#^ly-model)). Each page lists its artifacts (one per page today) and carries `full_screen` and a `size` in reference pixels: the size the page renders at on a 1280×800 page box, scaled partially to the real window ([ui/app/stage/index.md](../../specs/ui/app/stage/index.md), The size).

- **Reading:** `tv get-channel` already prints the channel record, including `layout`. [product/cli.md](../../specs/product/cli.md) does not promise that the layout appears in its output.
- **Changing:** the server accepts a layout update only as a replacement of the whole page list, which may reorder pages and change their size and full-screen state but may not change which artifacts are on the channel ([^ly-update-membership](../../specs/arch/layout/index.md#^ly-update-membership)). The CLI has no command for it; [product/cli.md](../../specs/product/cli.md#Metadata, listing, and deletion) says reordering is done through the UI or the channel PATCH API.
- **Moving:** there is no way to move an artifact between channels. The CLI spec tells agents to create a second artifact on the other channel instead.

## Proposed behavior

### Reading

`tv get-channel` is the way to read a channel's arrangement. The CLI spec promises that its output includes the channel's pages in order, each with its artifact IDs, `full_screen`, and `size`. No new read command.

### Changing one artifact's page

A new command changes the page that holds one artifact:

```
tv update-page --id <artifact-id> [--width <px>] [--height <px>] [--full-screen | --no-full-screen] [--position <n>]
```

- At least one change option is required.
- `--width` and `--height` set the page's size in reference pixels: finite and positive, either or both. Values follow the existing layout validation; very large values are accepted and limited when the page is drawn, as for sizes set by dragging.
- `--full-screen` / `--no-full-screen` enter or leave full-screen. As in the app, full-screen does not change the stored size, so leaving returns to it.
- `--position <n>` moves the page to position `n` in the channel's order, counting from 1 at the left. A position outside `1` to the number of pages is an error.
- Changes apply as one layout update, so connected clients see them like a change made in the app, and telemetry records order and full-screen changes as it already does for layout updates.

The CLI builds the change from the current layout and submits the whole list through the existing layout API; no new server operation is needed for this command.

### Moving an artifact to another channel

A new command moves an artifact:

```
tv move-artifact --id <artifact-id> --channel <target-channel-id> (--focus-artifact | --no-focus)
```

- The artifact keeps its ID, so its store, share link, and any references to it continue to work.
- It leaves its current page (a page left empty is removed, as with deletion) and is appended as a new page at the end of the target channel, keeping the size and full-screen state of the page it left.
- Exactly one focus directive is required, as for creation. `--focus-artifact` sends the artifact-focus nudge, which switches clients to the target channel and selects the page.
- Moving an artifact to the channel it is already on succeeds and changes nothing.
- An unknown artifact or target channel is an error.
- Clients showing the source channel lose the page under the existing selection fallback; the document reloads when shown on the target channel, as it does after any channel switch.

This needs a new server operation, because layout updates cannot change membership. The layout rule that membership changes only through creation and deletion gains moving as a third way. The app gets no gesture for moving in this change.

### Agent guidance

The `television` skill's CLI guidance describes reading the arrangement with `tv get-channel`, the two new commands, what reference pixels mean, and when to use `move-artifact` rather than creating a second artifact. Command help for both commands carries what an agent needs to choose them.

## Telemetry

The closed telemetry vocabulary has no event for moving an artifact between channels, and this change adds none: telemetry is unchanged. Moves record nothing; `update-page` changes are recorded by the existing layout-update events.

## Out of scope

- A UI gesture for moving artifacts between channels.
- Commands that submit a whole layout at once.
- Multi-artifact pages; the commands operate on the page that holds the artifact, whatever it contains.
