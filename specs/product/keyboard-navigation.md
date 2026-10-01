*How the keyboard moves through the app: the navigation chord that steps between tab pages and between channels, where it always works, and the one place it can't.*

**Status:** implemented redesign product authority.

# Keyboard navigation

One keyboard gesture moves you around Television: hold the platform's modifier and press an arrow key to step sideways through the current channel's pages or up and down through the channels themselves. This spec collects the promises of that gesture in one place, because it cuts across surfaces — channels, tab pages, and the documents inside artifacts — that each have their own specs.

## What this owns

This spec owns the user-facing behavior of app-level keyboard navigation: the *navigation chord* and what it moves. It deliberately does not own:

- Per-surface key handling — including the tab strip's response to unmodified arrows, the rename field's Enter/Escape, and the dialog's keys — which is each surface's UI spec's, exclusively ([spec-ui.md](../spec-ui.md)).
- How the chord escapes a focused artifact document — the bridge's forwarding and Electron's native interception — [arch/artifact-frame/artifact-bridge.md](../arch/artifact-frame/artifact-bridge.md).
- The shell handler that realizes the movement — [arch/ui/keyboard-navigation.md](../arch/ui/keyboard-navigation.md).
- What the movement changes: page selection is [tab-pages.md](./tab-pages.md)'s; channel focus is [channels.md](./channels.md)'s.

## The navigation chord

The *navigation chord* — option+arrow on macOS, ctrl+arrow on Windows and Linux, with no other modifier held — steps through a two-dimensional grid: left and right move the selection through the channel's pages ([tab-pages.md](./tab-pages.md)), up and down move between channels, in the channel sidebar's order — pinned channels in their pin order, then unpinned newest first ([channels.md#^ch-pin-order](./channels.md#^ch-pin-order), [channels.md#^ch-unpinned-order](./channels.md#^ch-unpinned-order); the channel sidebar presents that order, [ui/app/sidebar/index.md](../ui/app/sidebar/index.md)). ^tp-chord

- Movement stops at the ends on both axes — no wrapping.
- Navigating releases DOM focus from the control or artifact document that originated the move, and moving to another channel updates channel focus ([channels.md#^ch-focus-broadcast](./channels.md#^ch-focus-broadcast)) — for every client, since channel focus is shared. Keyboard delivery stays attached to the application after that release: consecutive chords continue moving without asking the person to restore focus. ^tp-chord-focus-continuity
- Each platform's chord deliberately takes that platform's word-wise cursor movement (the cost of working in text fields); the shift-added variants and every other combination stay native. Ctrl on Windows/Linux because alt+arrow is the browser's own Back/Forward there.

Once the navigation registers, the transition between channels or tab pages is visually identical whether it came from the chord or from a click — identical because it *is* the same operation: both inputs land on one navigational call site ([arch/ui/keyboard-navigation.md#^kbn-one-operation](../arch/ui/keyboard-navigation.md#^kbn-one-operation)).

## Where it works

Keyboard navigation works when the bridge works. The goal is to make it as consistent as possible given the realities of iframes and the web.

- Ordinary text-field focus does not suppress the chord: it works while typing. Active IME composition stays native — during a composition the arrow keys belong to the candidate window, and the chord does not navigate ([arch/artifact-frame/artifact-bridge.md](../arch/artifact-frame/artifact-bridge.md) owns the predicate).
- Inside artifacts: a document running the current artifact bridge forwards the chord while focused. In the browser, a document that cannot deliver the current bridge message — one that cannot run the script, or one served by an older, incompatible installation — is a dead zone for the chord while it holds focus ([product/artifacts.md#^af-hotkey-limit](./artifacts.md#^af-hotkey-limit)). In the desktop app this limit does not exist (native interception).
- Outside an artifact document: the chord works from app controls, including a focused tab, and from non-action shell ground, including body focus after a successful move and the channel-sidebar region. After a chord originates in an artifact document, a focused tab, shell ground, or the channel sidebar, focus release never detaches later chords. ^tp-chord-shell-focus

## Non-goals

- No other app-level navigation shortcuts are promised — the keyboard scope of the redesign is arrow-key movement. There is deliberately no keyboard shortcut that closes a tab ([tab-pages.md#^tp-no-tab-ops](./tab-pages.md#^tp-no-tab-ops)).

## Testing

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), [keyboard-navigation architecture](../arch/ui/keyboard-navigation.md#Testing) owns the proof that pointer input and the navigation chord use the same production operations for page selection and channel focus. This spec requires no separate comparison of what the two input paths render.

Browser acceptance must run in a browser connected to a Television server. Vertical acceptance must use a second connected client.

The incompatible-installation dead zone does not require a separate test fleet against older Television installations.

Focus-continuity acceptance must run against a Television server in both a real browser and the real Electron application. Each path must begin its artifact-document, focused-tab, shell-ground, and channel-sidebar walks with a real click. The Electron path must use production webviews and native pointer and keyboard input.

Contract coverage for option on macOS, ctrl on Windows and Linux, key events with `repeat` set, additional modifiers, and IME composition belongs to the artifact bridge's chord predicate and to [keyboard-navigation architecture](../arch/ui/keyboard-navigation.md#Delegation map)'s use of that predicate in the shell listener. That architecture coverage also crosses real platform detection once, in the shell listener of a running client ([its Testing](../arch/ui/keyboard-navigation.md#Testing)). The product acceptance paths use only the real chord for the host on which they run. They do not provide browser acceptance on multiple operating systems.

