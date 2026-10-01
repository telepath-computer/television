*The keyboard-navigation architecture: the shell's single navigation handler, the three paths that deliver the chord into it, and the delegation map across the specs that own each piece.*

**Status:** implemented stage-one keyboard-navigation architecture. The production policy handler is `packages/web/src/services/application-navigation.ts`; `packages/web/src/views/television-app.ts` owns the shell door, and `packages/web/src/main.ts` supplies the handler through the application-service construction seam.

# Keyboard navigation (architecture)

Pressing the navigation chord has to work the same whether your focus is on the app's own chrome, inside an artifact document in the browser, or inside one in the desktop app — three very different places for a keystroke to start. This spec pins the shape that makes that true: one handler owns what the chord means, and every delivery path feeds it. It is the central collector for keyboard-navigation implementation authority; the pieces it does not own, it names the owner of.

## What this owns

This spec owns the **shell navigation handler** — the app's single policy point for the navigation chord — the shell's own key listener and its application of the bridge-owned chord predicate, and the **delegation map** below. The user-facing behavior it realizes is [product/keyboard-navigation.md](../../product/keyboard-navigation.md)'s.

## The shell navigation handler

One handler is the app's single policy point for the navigation chord. Three doors deliver into it: ^kbn-handler

- **The shell's own key listener**, for the chord pressed while focus is outside an artifact document: app controls, the channel sidebar, the tab strip, stage ground, and document/body focus after a successful move releases its originating focus. The listener is owned by the application root but attaches at the top-level document boundary while that root is connected, so shell delivery remains available when no descendant of the root owns focus. It feeds the runtime's real platform identity into the bridge-owned chord predicate. A matched chord's default action is cancelled before delivery — the same rule the bridge's in-document listener follows — so the platform's native word-wise caret movement never also runs in an app-chrome text field; unmatched keys are untouched. ^kbn-shell-boundary
- **The bridge's `navigation-key` message**, for the chord pressed inside a browser-iframe document; the host accepts it on source validation alone ([arch/artifact-frame/artifact-bridge.md](../artifact-frame/artifact-bridge.md), "Keyboard forwarding").
- **Electron's native interception**, for the chord pressed inside any webview document; the shell-side mechanism is code-authoritative but must satisfy the contract the bridge spec states (same predicate, total consumption, same meaning as a `navigation-key`).

The doors are mutually exclusive by focus — a keystroke starts in exactly one of the three places — and the bridge spec states Electron has a single key path, so there is no duplicate delivery to prevent and no deduplication machinery. ^kbn-doors

Whichever door delivers, the handler applies the product policy ([product/keyboard-navigation.md#^tp-chord](../../product/keyboard-navigation.md#^tp-chord)): it computes the move — horizontally over the channel's page order, vertically over the channel sidebar's order — applies the end-stops, blurs DOM focus, and effects the result through the state layer: the per-channel selection memory for horizontal moves ([arch/channel-state/index.md#^cs-selection-memory](../channel-state/index.md#^cs-selection-memory)), the shared focused-channel write for vertical ones ([arch/channel-state/index.md#^cs-focus](../channel-state/index.md#^cs-focus)). How the handler decomposes into views and services below this contract is the implementer's, per the standing carve-out ([arch/channel-state/index.md](../channel-state/index.md), Code-governed carve-out). ^kbn-policy-point

**The doors differ; the operation is one.** Once the handler decides a chord is a navigation event, it effects the change through the same operation the pointer path uses — the same call site that clicking a channel row fires for channel focus, and that clicking a tab fires for page selection. There is no keyboard-only code path for mutating navigation state; a keyboard-only mutation would be a second implementation of the same move, free to drift from the clicked one. ^kbn-one-operation

## Delegation map

| Piece | Owner |
|---|---|
| The chord predicate (platform mapping, modifiers, repeat, IME) and the `navigation-key` wire shape | [arch/artifact-frame/artifact-bridge.md](../artifact-frame/artifact-bridge.md) |
| Applying that predicate in the shell listener, including real platform detection | this spec |
| Delivery out of documents: browser forwarding, Electron native-interception contract | [arch/artifact-frame/artifact-bridge.md](../artifact-frame/artifact-bridge.md) |
| What the movement means: axes, ends, blur, focus update | [product/keyboard-navigation.md](../../product/keyboard-navigation.md) |
| The state the handler moves: selection memory, focused channel | [arch/channel-state/index.md](../channel-state/index.md) |
| Per-surface key handling (the tab strip's response to unmodified arrows, rename field, dialogs) | each surface's UI spec ([spec-ui.md](../../spec-ui.md)) |

## Testing

Coverage for this architecture follows the [delegation map](#Delegation map). The testing policy says to name coverage provided by other specs rather than duplicate it ([testing-policy.md#Tests are the validation mechanism](../testing-policy.md#Tests are the validation mechanism)). This spec requires tests of the shell listener. It also requires tests at the points where keyboard and pointer input enter the same navigation operations. It does not require duplicate tests of movement or delivery.

Coverage of the shell listener must run in a browser with its real platform identity and use DOM key delivery to reach the navigation handler. Pointer and keyboard input must each be observed entering the same production operation for page selection. They must also each be observed entering the same production operation for channel focus. Because this spec requires keyboard and pointer input to enter the same production operations, it does not require a screenshot, transition, or DOM comparison between keyboard and pointer navigation.

