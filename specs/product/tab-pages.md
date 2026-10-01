*What tab pages promise the user: one tab per page of the focused channel, labeled by its artifact, stepped through by tab or keyboard, with selection private to each browser.*

**Status:** adopted stage-one tab-page product authority.

# Tab pages

Inside a channel, each open artifact sits on its own page, and each page gets one tab. Picking a tab shows its page; the arrow-key chord steps between them. This spec describes how that model behaves for a person using it — what a tab stands for, what it is called, what selecting one does and doesn't affect elsewhere.

## What this owns

This spec owns the user-facing behavior of tab pages. It deliberately does not own:

- The tab strip's and stage's interaction, markup, and styling — [ui/app/tab-strip/index.md](../ui/app/tab-strip/index.md) and [ui/app/stage/index.md](../ui/app/stage/index.md) (UI), exclusively.
- The layout data model a page lives in — [arch/layout/index.md](../arch/layout/index.md).
- Channels themselves — creation, deletion, focus — [channels.md](./channels.md).
- The navigation chord that steps between pages and channels — [product/keyboard-navigation.md](./keyboard-navigation.md).
- What survives moving around — the artifact frame's continuity promises, [product/artifacts.md](./artifacts.md).

## The model

A *tab page* holds one or more artifacts open on a channel — exactly one in stage 1 — and always gets exactly one tab. The channel's pages are ordered, and the tab strip and the stage show that one order — a tab stands for its page ([ui/app/stage/index.md](../ui/app/stage/index.md)). ^tp-model

In stage 1 a page holds exactly one artifact. That is a UI-layer constraint, not a data-model one: the stored model already carries multi-artifact pages for later milestones ([arch/layout/index.md#^ly-not-narrowed](../arch/layout/index.md#^ly-not-narrowed)). ^tp-one-artifact

- A new artifact opens as a new page at the end of the order ([arch/layout/index.md#^ly-create-appends](../arch/layout/index.md#^ly-create-appends)).
- Pages can be reordered, and the new order is shared: it is the channel's layout, saved on the server for every client. The gesture is specified in [ui/app/stage/index.md](../ui/app/stage/index.md).
- Pages can be resized, and the new size is shared: it is part of the channel's layout, saved on the server for every client. The gesture is specified in [ui/app/stage/index.md](../ui/app/stage/index.md).
- Pages scale with the display, partially and all together: a larger window shows artifacts somewhat larger, never in full proportion to the window ([ui/app/stage/index.md](../ui/app/stage/index.md), The size).
- Pages can be made full-screen, and leaving returns the page to its size; the gestures are specified in [ui/app/stage/index.md](../ui/app/stage/index.md).

## Tabs

A tab represents its page on the channel's stage — nothing more. Selecting and reordering are its only interactions: a tab carries no operations of its own — no menu, no rename, no close, and no keyboard shortcut that closes it. Removing an artifact happens on the artifact's own frame, with confirmation ([product/artifacts.md#^af-delete-semantics](./artifacts.md#^af-delete-semantics)); a page left with no artifacts is removed, and its tab with it ([arch/layout/index.md#^ly-delete-removes](../arch/layout/index.md#^ly-delete-removes)) — a tab disappears only because its page emptied. ^tp-no-tab-ops

A tab's label is its artifact's title, and retitling the artifact retitles the tab — a consequence of stage 1's one artifact per page ([#^tp-one-artifact](#^tp-one-artifact)). This changes when pages hold several artifacts: the label formula for a multi-artifact page is that milestone's question. ^tp-label

## Selection

When the focused channel has pages, exactly one is selected; its tab shows as selected and its page is the interactive one (background pages are inert until selected — [ui/app/stage/index.md](../ui/app/stage/index.md)). An empty channel has no pages and so no selection; what it shows instead — the empty stage, a bare strip — is specified in [ui/app/stage/index.md](../ui/app/stage/index.md).

- **Selection is per-browser, in memory only.** Which page is selected is not shared between clients and never persisted — not even browser-local storage. Within a session the browser remembers a selection per channel, so switching to another channel and back returns to the page you were on; a reload forgets them all and lands on the focused channel's first page. Two people on the same channel each look at their own page, and changing tabs locally never affects anyone else. ^tp-selection-local
- **Selection falls back deterministically.** Entering a channel with no remembered selection selects its first page — the same landing a reload uses. When the selected page is removed, selection moves to the page now at its position, or to the preceding page when the removed page was the last; a channel emptied of pages has no selection. ^tp-selection-fallback
- **Artifact focus is the one shared nudge.** When something focuses an artifact — the CLI's focus commands ([cli.md](./cli.md)), an agent pushing new work — the server broadcasts it, and every client selects the page containing that artifact, switching channels first if needed. It is one-way: local tab changes never broadcast back. ^tp-focus-selects

Selecting a page never reloads it: switching tabs preserves the documents, per the frame's continuity promise ([product/artifacts.md#^af-tab-continuity](./artifacts.md#^af-tab-continuity)); reordering pages, by contrast, is not promised to preserve them ([product/artifacts.md](./artifacts.md), "What survives moving around" — cited, not restated).

## Keyboard navigation

The navigation chord steps the selection through the channel's pages (and between channels on its vertical axis). Its behavior — the chord itself, the axes, the ends, where it always works — is specified in [product/keyboard-navigation.md](./keyboard-navigation.md).

## Testing

Product acceptance must run in a real browser against a running Television server. Shared-state paths must use two connected clients on that server. Reordering and resizing paths must use real pointer input.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [layout architecture](../arch/layout/index.md#Testing) owns proof that the stored model supports several artifacts on one page. For this product, browser acceptance covers only stage 1's one-artifact pages; it must not narrow the stored model to one artifact per page.

[Artifact acceptance](./artifacts.md#Testing) owns document continuity through tab switching; this spec does not repeat it. [Keyboard navigation](./keyboard-navigation.md#Testing) owns the navigation chord and points to the architecture proof that the chord and pointer input use the same page-selection operation. This spec requires no additional acceptance measure to show that the two inputs use the same operation.

The [tab-strip UI](../ui/app/tab-strip/index.md#The tab) specifies each tab as a pill that contains only its label. Conformance to the tab template ([arch/ui/conformance.md](../arch/ui/conformance.md)), rather than this spec's acceptance, establishes that tabs have no menu, rename, or close controls. This spec's acceptance in a real browser covers the Delete and Backspace behavior.

