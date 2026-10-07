*The artifact-frame architecture root: the domain's module map, the frame lifecycle rules, and the deliberate boundary between what is specified here and what remains governed by code.*

**Status:** implemented redesign authority. The frame-core carve-out below remains deliberately code-authoritative.

# Artifact frame (architecture)

**Plain english:** this is the front door to the machinery behind showing an artifact in the app. Three pieces of that machinery are pinned down by their own specs — the message channel between the app and the embedded document, how local source changes, reloads, and in-artifact navigation work, and how artifact responses stay fresh when loaded. The remaining machinery is deliberately *not* specified: it is mature, well-tested code, and this document says exactly where that unspecified zone begins and ends. UI specs separately own the frame's presentation and the Markdown editor's color treatment.

## What this owns

This spec owns the artifact-frame domain's **authority boundary** and its **frame lifecycle rules**. The user-facing promises of the frame are [product/artifacts.md](../../product/artifacts.md); the frame's markup, interaction, and styling are [ui/app/artifact-frame/index.md](../../ui/app/artifact-frame/index.md) (UI); and the embedded Markdown editor's color treatment is [ui/markdown-editor](../../ui/markdown-editor/index.md) (UI).

## Module map

| Spec | Owns |
|---|---|
| [artifact-bridge.md](./artifact-bridge.md) | the bridge: the in-document script and Electron preload, the message protocol, readiness tracking, keyboard forwarding, and the shared-artifact content poll |
| [reload-navigation.md](./reload-navigation.md) | local path-content watching and notification, artifact reload (cache-busting, content/theme reload), and in-frame navigation history contracts |
| [markdown-tables-buffer.md](./markdown-tables-buffer.md) | source preservation, intentional table edits, link routing, and rendering without normalization in the bundled Markdown view |
| [proxy-caching.md](./proxy-caching.md) | complete artifact-proxy cache behavior for successful resources, shorthand redirects, and unsuccessful responses |

## The frame core is code-authoritative, deliberately

Everything in the frame's implementation *not* claimed by the module specs above or the narrow Markdown-editor color and table exceptions below is the **frame core**, and it remains governed by code — reviewed and evolved as code, with no spec to conform to. The core includes: ^frame-core-carve-out

- **Renderer routing** — deciding how an artifact renders (the markdown host, a proxied iframe, an Electron webview) and constructing the frame element around it.
- **The markdown host** — the bundled markdown view and its content protocol, except for the editor's color treatment owned by [ui/markdown-editor](../../ui/markdown-editor/index.md) and the contracts in [the Markdown table buffer](markdown-tables-buffer.md) and [the table-interaction UI buffer](../../ui/markdown-editor/index.md#^md-table-interaction-buffer). Server-rendered read-only Markdown remains part of the code-authoritative core.
- **The status-view mechanism** — how the artifact-missing and url-unsupported documents are produced and served stays code's; their bridge participation is the bridge spec's, their contents the frame's error page ([ui/app/artifact-frame/index.md](../../ui/app/artifact-frame/index.md), Error page).
- **Navigation-state and reload internals** beyond the contracts [reload-navigation.md](./reload-navigation.md) states.
- **Frame element composition** — the DOM the implementation builds around the document, beyond what the UI spec's template binds.

This is a deliberate carve-out, not a gap. The core is mature, single-consumer code whose behavior the redesign does not change. Its direct tests of dispatcher routing, the content host, status handling, navigation internals, and frame composition remain code-authoritative evidence: they show that these subjects have focused coverage independent of tab and page presentation. Broader artifact-navigation, shared-artifact, path-artifact, and reconnect walks also cross the core, but their mapped product, bridge, reload, state, or migration subjects remain with those owners. A mixed case may therefore change at an owned slice without turning its surviving renderer or host behavior into spec authority.

Specifying these internals would spend authority on decisions that are working and that no current design pressure wants to move. Tests in the carve-out are reviewed and maintained with the code; they are not inherited or policy-grade assertions of this spec. If later work surfaces a contract another spec needs from the core, that contract gets stated in the most relevant spec at that time — the boundary moves by deliberate steps, not by drift.

## Frame lifecycle

The lifecycle rules below are authority; they exist because ordinary DOM moves of an `<iframe>` or `<webview>` reload its document, destroying everything inside it. ^frame-lifecycle

- **Frames live with their channel.** Only the current channel's frames exist; all of its tab pages stay rendered and loaded — held offscreen as needed — with no limit on their count. Switching channels tears frames down and builds the arriving channel's fresh.
- **Tab motion must preserve frames.** Moving between tab pages must keep every frame's live document loaded and continuous — ordinary remove-and-reinsert reparenting reloads a frame's document, so the realized motion must avoid anything that does (repositioning, or a state-preserving move where the platform provides one) — because tab switching is the app's most frequent movement and must not lose in-document state or work ([product/artifacts.md#^af-tab-continuity](../../product/artifacts.md#^af-tab-continuity)).
- **Recreation is accepted where continuity is not promised**: channel switches, and page rearrangement — today that is reordering by tab drag ([ui/app/stage/index.md](../../ui/app/stage/index.md)); artifact drag, when it arrives in a future milestone, is likewise free to recreate. Two future enhancements are tracked: preserving frames through drag operations ([TV-524](https://linear.app/telepath-computer/issue/TV-524)) and preserving recently-visited channels' frames under a bounded recency buffer ([TV-525](https://linear.app/telepath-computer/issue/TV-525)).
- Any move that reloads a frame's document is a reload, and the bridge treats it as one: the reloaded document must prove readiness again ([artifact-bridge.md](./artifact-bridge.md), "Retiring trust").

## Testing

Tests for these lifecycle rules live with the specs that own the outcomes. [product/artifacts.md](../../product/artifacts.md) covers continuity across tab switches. [reload-navigation.md](./reload-navigation.md) covers tearing down and rebuilding a channel's frames. [artifact-bridge.md](./artifact-bridge.md) covers a reloaded document proving readiness again.

This spec requires no separate tests. The rule that page count has no limit does not require repeating a test with different page counts. Frame recreation is allowed during channel switches and page rearrangement, so continuity is not required in those cases. Tests do not need to prove that recreation occurs. ^frame-testing

