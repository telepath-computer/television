*The artifact bridge: how an embedded artifact document and the app cooperate across the iframe/webview boundary — lifecycle and readiness, navigation reporting, input observation, keyboard forwarding, and live updates for shared artifacts.*

**Status:** implemented artifact bridge authority.

# Artifact bridge

> **Review model — read this first.** The architect does not line-review this spec. It is exempt from the human slop-free-zone review: it is settled and maintained through layers of adversarial review between state-of-the-art models, and it is accepted as too dense for a human reader to audit by hand. Any agent that reads or edits this spec must first read and comply with the **complexity-inoculation** skill. An agent that does not have access to the Complexity Inoculation skill must stop and tell its user that it needs that skill before handling the volume of complex information this spec contains.

> **Refactor earmark.** This spec — and the code it governs — bundles several concerns that should be separated into isolated modules with clean, simple contracts between them. The proposed cut (a proposal for the refactor's designer, not settled law): **the trusted channel** (document identity, readiness, stale-message rejection, source validation — one module that hands everyone else a clean stream of "a document arrived / left / said X" events); **installation** (how the script gets into each kind of document, with its serialization and CSP constraints quarantined); **keyboard** (chord in, one message out); **navigation** (observe moves, decide who commits each one, announce them); and **content freshness** (the shared-artifact poll and its offline behavior). Until that refactor, the bundling is a large part of why this document is as dense as it is. Treat the refactor as planned work, not an open question.

An artifact renders inside a real browser frame — an `<iframe>` in the browser app, a `<webview>` in the desktop app. The bridge is how the app and the document cooperate across that boundary: in browser iframes, a small script Television places inside the document; in Electron, a companion preload plus native host hooks. The app learns that the document is running Television's script, where it navigates, when shared content changes, and hears the keyboard shortcuts a focused document would otherwise swallow.

## Authority

This spec owns the **bridge**: the injected in-frame script, the companion Electron webview preload behavior, the host-side message handling, and the bridge message protocol below. It owns **readiness tracking** — the lifecycle bookkeeping of each frame's most recently adopted, not-yet-retired document identity, which normally describes the currently loaded document.

It does **not** own artifact reloading, in-frame navigation history, or URL conversion; those are [reload-navigation.md](./reload-navigation.md), which shares the bridge and is cross-referenced where readiness meets reload and navigation. The frame's user-facing behavior is [product/artifacts.md](../../product/artifacts.md) (product). User-facing artifact navigation is [artifact-navigation.md](../../product/artifact-navigation.md) (product). The artifact kinds and `isTvArtifact` predicate live in code not yet under spec authority (see [spec-migration.md](../../spec-migration.md)).

## Why a bridge exists

A frame's document handles its own input and, in the general case, tells its embedder nothing. For cross-origin documents the ordinary DOM boundary is absolute; Electron exposes privileged host APIs over a webview, and this contract deliberately uses only the preload and the named native hooks rather than arbitrary guest inspection. A local same-origin iframe is technically inspectable from the host, but this spec gives every transport one behavioral owner rather than one mechanism: browser iframes run the injected script; Electron webviews use the companion preload plus host-native navigation and key paths. One contract covers them all — not one implementation. Six needs cross the frame boundary:

- **Lifecycle**: knowing that the loaded document is running Television's script and is ready to cooperate, and knowing when it leaves ([Readiness tracking](#readiness-tracking)).
- **Navigation reporting**: surfacing in-document navigation so the app can keep per-artifact history ([reload-navigation.md](./reload-navigation.md)).
- **Pointer observation**: keeping application-level theme effects responsive while the pointer is inside the artifact document ([theme delivery](../themes/delivery.md#host-to-frame-pointer-protocol)).
- **Keyboard forwarding**: the app's navigation shortcuts (the navigation chord) must work while focus is inside a document, which is most of the time; without forwarding, a focused frame is a dead zone for them.
- **Live updates for shared artifacts**: detecting content changes for artifacts served by another Television host, observable only from inside the document ([The remote-content poll](#the-remote-content-poll)).
- **Link handling**: separating web-document navigation, application handoff, browser-local behavior, and invalid targets without letting one kind acquire another kind's authority ([Link handling](#link-handling)).

The bridge observes and relays. It cancels the navigation chord's native default and the link or form defaults identified under [Link handling](#link-handling). Which web-document navigations are cancelled is code-governed ([the navigation-recording carve-out](./reload-navigation.md#^nav-recording-carve-out)). It never rewrites a document's DOM or rendered content. The product-level statements are [product/artifacts.md](../../product/artifacts.md) and [product/artifact-navigation.md](../../product/artifact-navigation.md).

## Link handling

Every bridge-owned link or form path resolves its target against the artifact document's base URL and assigns one of four dispositions:

| Kind | Target | Common outcome |
|---|---|---|
| **Web** | Relative or absolute HTTP(S) | Document navigation. This is the only kind eligible for a `navigation-request` or to enter artifact history from incoming link or navigation input. User-visible plain and modifier behavior is owned by [Links that leave Television](../../product/artifact-navigation.md#links-that-leave-television). |
| **Application** | Any valid scheme that is neither HTTP(S) nor browser-local, including schemes Television has never seen | One external application handoff. It never becomes document navigation or artifact history. Modifier keys, middle-click, a non-self target, and `download` do not change the outcome because there is no browser document or download to create. |
| **Browser-local** | Browser-executable or local-resource schemes such as `javascript:`, `data:`, `blob:`, `file:`, and `about:` | No application handoff and no artifact history. Markdown leaves these inert. Executable HTML retains only the behavior and authority its own artifact context already has. |
| **Invalid** | A value that cannot be parsed with its base URL | No bridge action, application handoff, or artifact-history entry. |

In the browser bridge, form actions use the same dispositions. Only HTTP(S) form navigation can be reported or cancelled for host commitment; non-web form actions stay native and unreported. Which web submissions are cancelled is code-governed by [the navigation-recording carve-out](./reload-navigation.md#^nav-recording-carve-out).

In the browser, application links use the current artifact browsing context for the external-protocol handoff. A plain executable-HTML application anchor already has this native behavior. The browser bridge intervenes only when modifier keys, middle-click, an authored target, or `download` would ask for another context or a download; it cancels that disposition and initiates the same single handoff in the current context. The markdown view initiates the same current-context handoff itself because its rendered links carry data attributes rather than native `href` attributes. Browser-local links remain inert in markdown and native to executable HTML as stated in the table.

In Electron, the preload prevents native application-scheme anchor navigation and exposes an application-link request in every webview. A request proceeds only while Chromium's native `UserActivation.isActive` getter reports active user activation. The preload captures that getter before artifact scripts run, so shadowing the page-visible property cannot forge activation. Left- and middle-button application anchors use this request regardless of modifier, target, or `download`; a synthetic anchor click without active user activation remains inert. Direct application-scheme navigation in any frame and custom schemes through `setWindowOpenHandler` are denied, making the preload's private IPC the only application-handoff path. Browser-local subframe navigation remains native, and a blob URL used as a download target still reaches Chromium's download path; other non-web main-frame navigation is denied.

The Electron main process reclassifies every IPC value, then accepts an application link only when the requesting webview's current document has the same non-opaque HTTP(S) origin as its Television host renderer. This origin restriction confines operating-system handoff to the connected Television trust domain: it admits local path artifacts and the local markdown view, while excluding third-party URL artifacts, shared artifacts served from another origin, error documents, and non-web documents even though the preload runs in those webviews. HTTP(S), browser-local, local-resource, malformed, and non-application values are rejected on this channel. An accepted value reaches `shell.openExternal`; HTTP(S) outside-open continues through the separate window-open path.

The activation gate proves that a real activation is current, not that the activated element supplied the URL. Local executable HTML may use a real click on any element to request any application URL while transient activation remains live. This authority is accepted inside the connected Television trust domain; the gate prevents a cold scripted launch. ^ab-link-handling

## Message protocol

All messages flow over `postMessage` (browser iframe → host) or `ipcRenderer.sendToHost` (Electron webview → host); the host replies in kind. The wire types are owned here. Every guard ends with `return !("id" in value)` so the bridge union is disjoint from the content protocol, which carries an `id`.

```ts
export type BridgeDocumentGuid = string;

export type BridgeMessage =
  | URLTargetRequest
  | URLTargetNotification
  | ArtifactMissingRequest
  | ArtifactMissingNotification
  | ProxyContentChangedNotification
  | BridgeReadyNotification
  | BridgeLeavingNotification
  | NavigationRequestNotification
  | NavigationKeyNotification
  | ArtifactPointerNotification;
```

Guest → host lifecycle messages:

```ts
export interface BridgeReadyNotification {
  type: "bridge-ready";
  guid: BridgeDocumentGuid;
}

export interface BridgeLeavingNotification {
  type: "leaving";
  guid: BridgeDocumentGuid;
}
```

`bridge-ready` carries only its document GUID: source validation plus the GUID establish trust, so no reported URL participates in readiness. Both lifecycle messages carry a GUID. There is no version-compatibility handling: `isBridgeReadyNotification` requires `guid` to be a string, so a `bridge-ready` without one (a document served by an older Television installation) fails the guard, is not dispatched, and is ignored — such documents simply never establish trust, per the cross-version non-goal under Known limits.

Guest → host input, navigation, and reload messages:

```ts
export interface NavigationKeyNotification {
  type: "navigation-key";
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
}

export interface ArtifactPointerNotification {
  type: "artifact-pointer";
  eventType: "pointermove" | "pointerdown" | "pointerup" | "pointercancel" | "click";
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
}

export interface NavigationRequestNotification {
  type: "navigation-request";
  url: string;
  replace?: boolean;
  sameDocument?: boolean;
  native?: boolean;
}

export interface ProxyContentChangedNotification {
  type: "proxy-content-changed";
}
```

`navigation-key` is sent for the **navigation chord** observed inside the document: **option+arrow on macOS, ctrl+arrow on Windows and Linux**. The predicate:

- All four arrow directions, with **no other modifier** held, and no other combination. The chord deliberately takes the platform's word-wise cursor movement (the decided trade); the word-wise *selection* variant (shift added) and everything else stays native to the document. Ctrl rather than alt on Windows and Linux because alt+arrow is the browser's own Back/Forward there — the chord must not fight the browser chrome.
- Auto-repeat forwards (`event.repeat` is not filtered): a held chord keeps forwarding keydowns. (What a held chord does at the app's ends is the app's policy, like every other meaning of the key.)
- A keydown with `isComposing` is not forwarded — during IME composition the arrow keys belong to the candidate window, and navigating away from a half-composed word would be hostile.
- Text-editing targets are **not** exempt — the navigation chord always wins; the app deliberately accepts overriding the chord's word-wise cursor movement in editors.

Winning rests on two mechanisms. The bridge's keydown listener installs on the window in the **capture phase**, so it observes the chord before any handler below the window and survives an editor's ordinary `stopPropagation()` (rich-text editors commonly bind the chord for word motion); the guarantee's boundary is an artifact script that registered its own window capture listener earlier and calls `stopImmediatePropagation()` — that runs first and can starve the forwarding, accepted and not defended against. And the listener calls `preventDefault()` on the matched chord before posting, so the native word-wise cursor movement does not also run; propagation is not suppressed — document scripts still receive the event, the bridge cancels only the default action.

The message carries the key, not a meaning: what the app does with it (moving between tabs and channels) is the app's policy ([product/keyboard-navigation.md](../../product/keyboard-navigation.md); the receiving handler is [arch/ui/keyboard-navigation.md](../ui/keyboard-navigation.md)'s), so the wire shape survives keyboard-model changes. **Architect ruling for implementation — the private wire shape is fixed as `{ type: "navigation-key", key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" }`.** Changing it requires updating its producers, guards, and consumers together.

`artifact-pointer` is observational input for application-level theme surfaces. The browser bridge and Electron preload capture trusted `pointermove`, `pointerdown`, `pointerup`, `pointercancel`, and `click` events and report their guest-viewport coordinates and button fields without cancelling, suppressing, or capturing the event. The host accepts the message through the same current-frame source validation as other input, converts its coordinates to application-viewport CSS pixels using the frame's rendered rectangle and layout dimensions, and passes it to the [host-to-frame pointer protocol](../themes/delivery.md#host-to-frame-pointer-protocol). A frame with a zero layout width or height produces no theme message. The bridge reports the raw event fields; theme delivery owns move, cancel, and click normalization.

Request/response pairs (a guest view asks the host a question; the host replies into the frame):

```ts
export interface URLTargetRequest { type: "url-target-request"; }
export interface URLTargetNotification { type: "url-target"; url: string | null; }

export interface ArtifactMissingRequest { type: "artifact-missing-request"; }
export interface ArtifactMissingNotification { type: "artifact-missing"; title: string; path: string; }
```

For a `url-target-request`, the host replies with the artifact's current navigation URL when that URL is an external HTTP or HTTPS page. [reload-navigation.md](./reload-navigation.md) defines the current URL under “Navigation state.” In every other case, the host replies with the artifact's own URL for a URL artifact and `null` for any other kind.

For an `artifact-missing-request`, the host replies with the current path artifact's title and path. If the title changes while the document remains loaded, the host sends the updated title and the artifact's path to that document over the same transport. The document stays loaded.

Each type has an exported guard (`isBridgeReadyNotification`, `isBridgeLeavingNotification`, and so on). `navigation-request` and `proxy-content-changed` semantics belong to [reload-navigation.md](./reload-navigation.md); they appear here because they share the transport and interact with readiness.

## Document GUID

Each loaded bridge document mints one *bridge document GUID* during bridge startup. The GUID identifies a document instance inside a frame. It is not a security token and does not need cryptographic strength; it only needs to be unique enough within one host session to separate one loaded document from another.

Source validation proves that a message came through the current frame element or an accepted departing lifecycle source. It does not prove which loaded document inside that frame sent the message. A full-document navigation can leave an old document's `pagehide` / `leaving` message racing with the incoming document, and Chromium can deliver unload-time iframe messages after the iframe `WindowProxy` no longer compares equal to the current frame window. The GUID lets the host retire trust only for the document instance it currently trusts and ignore stale lifecycle messages from the previous document.

Bridge GUID generation must work in plain-HTTP producer pages. Code must not rely on `crypto.randomUUID()`, which is not available in every non-secure context. Use `crypto.getRandomValues` when present, with a `Math.random()` plus `Date.now()` fallback when needed. The fallback is acceptable because the GUID is not an authentication or authorization token; it only separates a small number of document loads within one host session.

The host keeps one `currentGuid` per artifact frame. `currentGuid === null` means the host trusts no loaded document for that frame.

## Injection paths

The same protocol reaches the host through these paths:

| # | Where | Frame | Top-level vs framed | Lifecycle authority | Host receives via |
|---|---|---|---|---|---|
| 1 | Proxy HTML | browser iframe | framed | injected bridge | `postMessage` |
| 2 | Proxy-rendered markdown | browser iframe | framed | injected bridge | `postMessage` |
| 3 | Electron webview preload | webview | top-level | preload | `ipcRenderer.sendToHost` |
| 4 | Markdown view bundle | browser iframe | framed only | injected bridge | `postMessage` |
| 5 | artifact-missing view | iframe or webview | framed in browser, top-level in webview | injected bridge in browser, preload in webview | `postMessage` or `ipcRenderer.sendToHost` |
| 6 | url-unsupported view | browser iframe | framed | injected bridge | `postMessage` |

The proxy makes two inline insertions into HTML. An appearance-only parser-blocking script runs after the last applicable CSP meta and before style-bearing content; it installs the shared resolver with `system`. The complete bridge remains at document end, preserving body-before-ready ordering. Its source begins by installing the same fixed-`system` resolver before calling `installBridge`, including in a top-level webview document where `installBridge` returns without iframe behavior. Repeated installation adopts one controller.

Both scripts remain subject to the artifact's CSP. A policy that blocks Television's inline bridge also blocks the resolver; Television does not bypass it. The complete bridge is serialized for proxy injection by `bridgeScriptSource()` via self-contained function sources, so serialized functions use no imports, module-scope helpers, or closures. `Function#toString()` carries no module bindings, so helpers used by the injected bridge are duplicated inside `installBridge`.

A browser document that does not run one of these bridge paths never proves readiness: it renders and stays fully interactive ([product/artifacts.md#^af-native-interaction](../../product/artifacts.md#^af-native-interaction)), but it cannot forward the navigation chord or report its lifecycle — the accepted keyboard limit ([product/artifacts.md#^af-hotkey-limit](../../product/artifacts.md#^af-hotkey-limit)). In Electron, the consumer attaches the preload to the webview; a `<webview>` is a top-level browsing context (`window.parent === window`), so the injected iframe bridge cannot reach the embedder with `postMessage`. The preload uses `ipcRenderer.sendToHost` and runs in uncontrolled third-party pages, raw webview documents, and Chromium error documents.

## Browser bridge behavior

In browser iframes, the injected bridge is the document lifecycle authority. `installBridge(win, options)` is idempotent and, when `win.parent !== win`, installs the keydown, navigation, lifecycle, and content-poll listeners before it posts `bridge-ready` to `win.parent`.

The browser bridge:

- mints one document GUID when installed;
- posts `bridge-ready` with the GUID after its listeners are installed;
- posts `leaving` with the same GUID on `pagehide`;
- posts `bridge-ready` with the same GUID on `pageshow` only when `event.persisted === true`;
- applies [Link handling](#link-handling) when navigation reporting is enabled: eligible HTTP(S) moves are reported through `navigation-request`, application dispositions are normalized to one current-context handoff, and other non-web destinations are not reported; which web moves are cancelled, and how reported moves become history, is code-governed ([the navigation-recording carve-out](./reload-navigation.md#^nav-recording-carve-out));
- forwards the navigation chord as `navigation-key`;
- reports trusted pointer motion, button transitions, cancellation, and clicks as `artifact-pointer` without changing the document's native input path;
- runs the remote-content poll — the live-update mechanism for *shared* artifacts described below — and posts `proxy-content-changed` when the observed `ETag` changes.

**Granted browser-compatibility exception — in-frame navigation recording.** The bridge's primary path uses the Navigation API, which only Chromium ships. Browsers without `window.navigation`, including Firefox and Safari, use the fallback implemented as capture-phase `click` and `submit` listeners, wrappers around `history.pushState` and `history.replaceState`, and `popstate` and `hashchange` listeners. This is a granted exception to the [UI browser-compatibility policy](../../ui/index.md#browser-compatibility) for the bridge's existing implementation because changing the established recorder without cross-engine coverage would put artifact-frame navigation at risk. [TV-701](https://linear.app/telepath-computer/issue/TV-701) tracks the required Firefox and WebKit coverage. The fallback is named here to document the exception; its implementation details remain code-governed by the [navigation-recording carve-out](./reload-navigation.md#^nav-recording-carve-out).

The `pageshow.persisted` repost covers back/forward-cache restores. The browser does not rerun the bridge installer for a cached document, but the earlier `pagehide` retired the host's trust; reposting the same GUID lets the still-installed bridge prove readiness again without minting a new document identity.

The install options (real exported contract):

```ts
export interface ArtifactPollCadence {
  normalMs: number;
  slowMs: number;
}

export interface InstallBridgeOptions {
  reportNavigation?: boolean;
  /** Test-only scheduling override; production callers omit it. */
  pollCadence?: ArtifactPollCadence;
}
```

Tests can set `pollCadence` to change the polling schedule. Production callers omit it. When `reportNavigation === false`, the navigation block is skipped; lifecycle, key forwarding, and the poll still install for framed documents. Status/helper views use this mode because their internal UI should not become artifact navigation history.

### The remote-content poll

The remote-content poll is the live-update mechanism for *shared* Television artifacts, and it is not part of readiness or key forwarding. Operationally, a shared artifact is a `kind: "url"` artifact whose URL matches a Television artifact route (the `isTvArtifact` predicate). That predicate does not compare origins: it normally identifies content owned and served by another Television host, but a URL artifact pointing at the connected host itself matches too and is handled the same way. The predicate lives in code not yet under spec authority ([spec-migration.md](../../spec-migration.md)). The poll lives in the bridge only because detecting a content change means reading the proxied response's `ETag` from inside the artifact's own document, which needs same-origin access — exactly where the bridge already runs. It is co-located here out of that necessity.

The distinction it serves: a *local* Television artifact is served by the same host that owns its source, and that host watches the source and pushes updates through the [local path-content update contract](./reload-navigation.md#^rn-local-content-change), so local artifacts do not depend on this poll. A shared artifact gets no such push — the owning host's file-change events do not reach the observing side, and the observing host does not own the file, so neither server can notify it of a change. Instead the observing document polls its own `/artifact/<id>/...` URL with `HEAD` every 5 seconds (backing off to 15 seconds while requests fail), records the first `ETag` as a baseline, and posts `proxy-content-changed` when the `ETag` changes; change detection is that client-side comparison, not an HTTP `304`. The host then reloads the shared artifact. The poll installs in any document served from a Television artifact route (`/artifact/<id>/…`), local or shared — never for arbitrary third-party sites — and the host acts on `proxy-content-changed` only for shared `kind: "url"` artifacts, so a local document's poll notifications are inert; its `HEAD` traffic is the accepted cost of keeping the injected script uniform.

The poll's lifecycle follows the document's. It stops on `pagehide` so a departing document does not keep driving reloads — and stopping is strict, with two distinct observables: a queued cycle is cancelled before it can issue a request, and an in-flight request is aborted when practical — either way, a request already issued before `pagehide` must have no effects on completion: no baseline mutation, no `proxy-content-changed`, no next cycle scheduled. On `pageshow` with `event.persisted === true` — the same back/forward-cache restore that reposts `bridge-ready` — the poll resumes as exactly one loop, keeping its prior baseline `ETag` so a change made while the document sat in the cache is detected on the first resumed poll. A restored document that regained trust but silently lost its live updates would break the shared-artifact promises for the rest of that document's life.

The poll also carries the shared artifact's offline story: while the producer is unreachable, `HEAD` requests fail and the poll simply backs off — the frame keeps showing the last-seen document — and when the producer returns with changed content, the next successful poll observes the new `ETag` and the artifact reloads on its own. The user-facing promise is [product/artifacts.md#^af-shared-offline](../../product/artifacts.md#^af-shared-offline). Its accepted limits, in one place:

- **Last-seen content is the mounted document itself; nothing stores the response.** Any path that reloads or recreates the frame while the producer is still away — a host reload, navigation, leaving and returning to the channel, a relaunch — loads fresh and can land on an error document instead.
- **Self-healing needs the poll's same-origin `HEAD` to be issuable from inside the document.** Running a script is not the boundary; issuing the request is. In the browser a raw document receives no injected bridge, and on either transport a document's security policy can allow scripts yet block their connections (`connect-src` governs the `fetch` both the bridge and the preload use). A document where the request cannot be issued keeps its last-seen bytes but does not update on recovery. (The script-injection half is browser-only — the Electron preload runs in every webview document and polls the ones on artifact routes; the connection-policy half applies to both.)
- **Detection begins at the baseline.** The first successful `HEAD`'s `ETag` is stored without comparison to the displayed document's own response, so any change landing between the document's load and that first success — producer online or not — is absorbed into the baseline and never reloads the stale display. The request starts immediately but nothing bounds its completion; an outage before the first success extends the window indefinitely, and the frame stays on the stale pre-baseline document until the next content change after it.
- **Recovery is document-owned, so a failed detected-change reload strands the frame.** When a detected change triggers a reload and the producer vanishes before the replacement document loads, the poll went down with the departing document and nothing is left to notice the later return; the frame stays on the error document until reloaded by another path. Making recovery survive a failed replacement would need host-owned retry machinery, which this spec deliberately does not add.

Detection is keyed to the `ETag` of the **displayed document's** response, not the artifact tree: in a folder artifact, changing another page or a subresource does not change the displayed document's `ETag` and does not reload it — today's e2e "browser keeps shared folder sub-pages inline and polls only the viewed document" pins exactly that. Artifact-tree freshness for shared views is tracked in [TV-732](https://linear.app/telepath-computer/issue/TV-732).

## Electron webview preload behavior

In Electron webviews, the preload is the single lifecycle authority for the displayed document. For each loaded document it:

- mints one document GUID;
- posts `bridge-ready` with the GUID once the document has loaded: immediately if `document.readyState` is already `"complete"` when the preload runs, otherwise on the `load` event — registering a `load` listener unconditionally would miss an already-complete document, and the one-shot ready message has no second chance;
- posts `leaving` with the GUID on `pagehide`;
- posts `bridge-ready` with the same GUID on `pageshow` only when `event.persisted === true`;
- runs the remote-content poll and posts `proxy-content-changed` when the observed `ETag` changes;
- reports trusted pointer motion, button transitions, cancellation, and clicks as `artifact-pointer` without changing the document's native input path;
- implements the Electron side of [Link handling](#link-handling) through the content bridge, preload activation gate, private IPC, and main-process handoff. The classification, direct-navigation blocks, active-user requirement, and connected-origin restriction are stated together there. ^ab-application-link-electron

The preload does **not** forward keys. The desktop shell intercepts the navigation chord natively, above the page, so the chord works over every webview document — including third-party pages and raw documents that could never run a script. This is why the keyboard limit for script-less documents exists only in the browser app. The shell-side mechanism is code-authoritative, but the contract it must satisfy is stated here: the shell matches the same chord predicate as the browser bridge (the platform chord with no other modifier, auto-repeat included, ignored during IME composition), consumes the keystroke before the page acts on it, and delivers it to the app's navigation handling with the same meaning as a `navigation-key` message. Unlike the browser bridge, consumption is total: the guest document never receives the consumed keydown — an accepted asymmetry of native interception. Because the preload forwards no keys, this is the only Electron key path — there is no duplicate delivery to prevent. The concrete Electron events and calls are implementation-defined. The required outcome is the input and navigation behavior above, without a second wire protocol for the shell.

The injected bridge is inert when it runs top-level in a webview. It does not post `bridge-ready` there because `window.parent === window` in a webview, so the iframe bridge's `postMessage` transport cannot reach the embedder. Keeping it inert gives each webview document exactly one lifecycle GUID source; the preload is the authority because it reaches the host via IPC and is attached by the consumer, including for third-party pages that do not know the Television protocol.

Electron navigation retires trust through webview events the host observes:

- `did-start-navigation` retires trust when `isMainFrame === true` and `isInPlace !== true`. The start event is used, rather than a commit event such as `did-navigate`, because trust must be retired before the incoming document's preload can post `bridge-ready`: retiring after the incoming GUID was adopted would leave that ready document distrusted, with no second ready message coming. The `isInPlace !== true` condition keeps same-document hash and history moves from retiring trust — those keep the current document, so its bridge remains installed and should stay trusted.
- `did-fail-load` retires trust for a main-frame load failure, and not for a failure reporting `isMainFrame === false`. Defensive handling of malformed or field-less event shapes is code's business, not stated here.
- A Chromium error document (`chrome-error://`) that runs the preload is treated like any other preload-covered document: the host accepts its `bridge-ready`.
- One outcome is accepted without repair: Electron also fires `did-fail-load` for a *cancelled* load (`window.stop()`, an aborted provisional navigation). The previous document then remains displayed with its trust already retired, and its preload never re-announces, so the retained document stays unready until it reloads. Accepted because readiness has no current effects.
- `did-navigate-in-page` never retires trust. The [main-frame rule](./reload-navigation.md#^rn-main-frame-navigation) and the remaining [navigation-recording carve-out](./reload-navigation.md#^nav-recording-carve-out) govern whether and how it is recorded as artifact navigation.

## Host-side handling

The artifact frame's host element dispatches guest messages after source-validating the sender:

- **iframe**: iframe messages are considered only while the current iframe element is connected and exposes a non-null `contentWindow`; ordinary messages must come from that window. An absent event source never matches an absent frame window. Departure messages have additional accepted sources because Chromium can deliver them while the document is unloading and the current `WindowProxy` has changed:
  - `leaving` and native full-document `navigation-request` messages are accepted from the lifecycle window captured when the host adopted `bridge-ready` for the current document.
  - `leaving` is also accepted when `event.origin` equals the expected frame origin, derived from the host-owned `src`. That is normally the consumer origin for local proxy and bundled-view frames, and the producer origin for remote Television URL frames (after a redirect the attribute can trail the document; the fallback knows the expected origin, not the actual one).
- **webview**: the host uses the message only from the currently subscribed webview IPC listener.

Source validation proves the message came through the current frame element or an accepted departing lifecycle source. It does not prove which loaded document inside that frame sent the message. The lifecycle GUID supplies that document identity. For the iframe `leaving` origin fallback, the origin check only admits the message to lifecycle handling; `guid === currentGuid` remains the authority for retiring trust.

One association gap is accepted at same-element document changes. A no-GUID side-effect message (`navigation-request`, `proxy-content-changed`) posted by a departing document just before a swap can be delivered after the reset. Because the same-element `WindowProxy` stays stable, its source compares equal to the new document's window, source validation admits it, and trust does not gate the action. The same source check can admit a queued lifecycle repost: a `bridge-ready` from a back/forward-cache restore racing the swap can re-adopt the predecessor's GUID, which then stands until a matching `leaving`, a replacement's own ready, or another reset; readiness gates nothing meanwhile. The exposure is one message-queue hop wide. Replacing the frame element prevents this gap because messages from the replaced frame fail source validation. The gap remains accepted when the same frame element is reused.

The host delivers a source-validated `navigation-key` to the [shell navigation handler](../ui/keyboard-navigation.md#^kbn-handler), and a source-validated `artifact-pointer` to the application theme pointer forwarder after coordinate conversion. Input messages carry no GUID and are not GUID-gated: document identity decides trust and lifecycle only. Acceptance is source validation alone — the message must arrive through a real artifact frame, and nothing more: no trust requirement, no check of which pane sent it or whether it holds focus. Readiness tracks lifecycle; it is not an input-authorization gate, so source-valid input acts independently of trust. Tightening acceptance beyond source validation would be new hardening, which this spec deliberately does not add.

A browser iframe that shows an external page artifact under browser demo mode ([product/artifacts.md#^af-demo-mode](../../product/artifacts.md#^af-demo-mode)) is not a bridge participant. Its document is the external page's own code, which source validation alone would let drive navigation, the navigation chord, or theme pointer effects with bridge-shaped messages. The host therefore acts on no message from that frame, and the frame never proves readiness. ^ab-demo-frame-inert

The host must subscribe to iframe messages and webview IPC before or in the same render turn as it assigns any artifact frame. A fast local or cached document can send its one-shot `bridge-ready` immediately after load; the host must not miss it. If a caller sets artifact data before connecting the frame's host element to the DOM, that path must still avoid creating a loadable frame before subscriptions are active. ^4f91aa30

## Readiness tracking

The host tracks, per frame, the most recently adopted, not-yet-retired bridge identity. Normally that describes the currently loaded document; two disclosed limits — a lost unload-time `leaving`, and the one-hop queued-repost window under Host-side handling — can leave it describing a departed one, accepted because readiness gates nothing. This is the *readiness gate* in its lifecycle-only role: **readiness is knowledge, not a shield.** A frame is never made non-interactive, never has pointer events suspended, and never changes appearance based on readiness — and readiness gates no message acceptance either: it records an adopted, not-yet-retired lifecycle identity, and supplies the identity used to retire trust. (A document that does not run or emit a given bridge behavior naturally lacks that behavior — a property of the document, not a readiness gate.) The machinery is kept because trust bookkeeping is what makes stale-message handling and reload/navigation coordination correct, and because the lifecycle bookkeeping is useful groundwork (the exploration of intercepting keystrokes for bridgeless frames is [TV-526](https://linear.app/telepath-computer/issue/TV-526)) — though treating readiness as current-document authorization or liveness would need a hardening mechanism this spec does not add.

The state is two fields — readiness is derived, not stored:

```ts
interface ArtifactFrameTrustState {
  // null = the host trusts no loaded document for this frame.
  // A frame is "ready" exactly when this is non-null.
  currentGuid: BridgeDocumentGuid | null;
  // The window captured when bridge-ready was adopted: the accepted source for
  // departing lifecycle messages (see Host-side handling).
  lifecycleWindow: Window | null;
}
```

Retiring trust is one operation, always both fields:

```ts
currentGuid = null;
lifecycleWindow = null;
```

There is no separate readiness boolean to keep synchronized, so no invariant between copies of the same fact and no recovery rule for their divergence.

Both fields matter. Clearing the GUID lets a back/forward-cache restore re-adopt its own repost. Clearing the lifecycle window matters because `navigation-request` carries no GUID: a stale one from a departed document's still-captured window would pass source validation and write a bogus history entry — the GUID check cannot catch it there. (The protection bites where the former source is distinct from the current frame window, such as after frame replacement; within one frame element the `WindowProxy` stays stable across navigations, so window identity cannot separate documents there.)

### Proving readiness

Trust is established one way only: a `bridge-ready` carrying a GUID, sent after the bridge or preload listeners are installed.

```text
on recognized message from source-validated frame:
  if message is bridge-ready and message.guid is a string
     and message.guid !== currentGuid:
    currentGuid = message.guid
    lifecycleWindow = (iframe: the current validated contentWindow;
                       webview: null — IPC exposes no guest Window, and the
                       subscribed listener supplies source identity there)
```

A repost of the current GUID while trusted changes nothing — trust is already established. After a reset, `currentGuid` is null, so any well-formed announcement (including a back/forward-cache repost of the GUID that was just cleared) differs from it and adopts.

Adoption is allowed even when the frame is already ready. `bridge-ready` is a once-per-load message, with one intentional repeat for `pageshow.persisted`; accepting a different GUID while ready rotates identity as soon as an incoming document proves itself. That lets stale `leaving` messages compare against the incoming GUID instead of retiring trust in the fresh document. It complements the Electron `did-start-navigation` rule, which must retire trust before an incoming preload ready so a later retirement does not wipe the adopted GUID.

No other message adopts a GUID or marks a frame ready — the navigation, poll, key, and request/response shapes all carry no GUID, so accepting any of them as trust evidence would let a stale message from a departed document vouch for the next one. They are acted on (or ignored) on their own terms regardless of the frame's trust state.

### Retiring trust

Readiness resets whenever the current document instance is no longer trusted:

- **Initial mount** of any artifact frame: start with the trust state clear.
- **Browser `pagehide`**: the bridge sends `leaving` with its GUID. The host resets only if `guid === currentGuid`; stale `leaving` messages are ignored.
- **Browser native full-document navigation**: the departing document's GUID-matched `leaving` retires trust — for every native move, whatever its target. The preceding `navigation-request` never retires trust: it is reported from the Navigation API's `navigate` event, *before* the move commits, and the move can still be cancelled (another listener, `beforeunload`, the user declining a leave prompt) — retiring on the request would strand a document that never left as permanently untrusted. A late `leaving` from the old document cannot harm an incoming document that already adopted: the GUID comparison rejects it. (`leaving` delivery at unload is best-effort; a lost one leaves stale trust standing on a departed document — which gates nothing.)
- **Electron full-document navigation**: reset on `did-start-navigation` when `isMainFrame === true` and `isInPlace !== true`.
- **Electron main-frame load failure**: reset on `did-fail-load`; a subsequent preload `bridge-ready` from Chromium's error document can prove readiness again.
- **Host reload** (`reloadProxyFrame`): reset before committing the reload URL.
- **Host-driven navigation** (`forceCurrentFrameSrc`): reset before assigning the target URL.
  The reset-before-assignment order in both host-driven cases is load-bearing: a fast local or cached incoming document can post `bridge-ready` immediately on load, and a reset that ran after the URL assignment could erase that fresh document's just-adopted trust. ^ab-reset-before-assign
- **Reload-causing moves and reconnects**: any DOM move or disconnect/reinsert that reloads the frame's document resets trust — the reloaded document must prove readiness again. A state-preserving move that keeps the same document loaded (where the platform provides one) does not reset. (Frame continuity across tab switches — [product/artifacts.md#^af-tab-continuity](../../product/artifacts.md#^af-tab-continuity) — requires the stage's realized motion to keep the live document loaded.)
- **Artifact swap**: reset for the new artifact document.

The enumerated host-side triggers apply one governing rule: **whenever the host removes or replaces a frame element, or changes its logical document source, the trust state resets before the replacement can load.** Two current paths the list above does not name fall under it — retargeting the frame's public view URL, and the markdown-missing removal-and-recovery path — and any future host path that swaps the document inherits the rule. A document's *self*-navigation is outside it: there the transport rules above govern — GUID-matched `leaving` in the browser (asynchronous, so no pre-load ordering exists to demand), the webview events in Electron. A replacement document that never announces readiness must not inherit its predecessor's trust or GUID (beyond the disclosed queued-message window under Host-side handling).

Hash changes, `pushState`, `did-navigate-in-page`, plain re-renders, and theme changes that do not reload the frame do not reset readiness.

### Stale lifecycle messages

A stale `leaving` message cannot retire trust in a newer document: after document B adopts, `currentGuid` is B, so a late `leaving` from document A fails the `guid === currentGuid` check. A stale `navigation-request` cannot mark a current-protocol frame ready because only `bridge-ready` adopts. A duplicate `bridge-ready` with the current GUID is harmless. A `bridge-ready` with a different GUID is treated as a fresh loaded document and adopted, so current bridge code sends `bridge-ready` only once per load, plus the explicit `pageshow.persisted` repost for a real browser-cache restore.

## Known limits and non-goals

The pointer-relay limits in this section are explicit non-goals for current production code, not missing implementation or acceptance criteria. [TV-743](https://linear.app/telepath-computer/issue/TV-743) keeps their long-term known-defect record; no viable solution or promise of eventual support is established.

- A browser document that cannot run the bridge — raw non-HTML proxy responses such as images, PDFs, text, audio, and video, and local HTML whose Content Security Policy blocks the injected inline script — renders and stays interactive but cannot forward the navigation chord while focused, report pointer input to theme surfaces, or provide bridge lifecycle. (The host still observes ordinary frame load events; what such a document lacks is the bridge's cooperation, not all loading state.) The keyboard limit is stated to the user in [product/artifacts.md#^af-hotkey-limit](../../product/artifacts.md#^af-hotkey-limit); the theme-pointer limit is stated in [product/themes-and-appearance.md](../../product/themes-and-appearance.md#^theme-artifact-pointer-limit). In Electron the preload observes ordinary DOM documents. Pointer retrieval from Chromium-managed raw or plugin content is not promised and has not been established across a complete document-type matrix, so additional Electron dead zones are possible rather than confirmed here.
- **Cross-version compatibility** over the bridge is a non-goal. A shared artifact's document runs whatever bridge its producer serves — and version answers only the protocol question, never a capability one: a document speaking the current protocol gets its messages' specified handling, subject to the document and transport capability limits stated above (script injection; issuing the freshness request). An older or otherwise mismatched producer's documents establish no trust and forward no navigation chord even where they run a script. Message shapes from such a producer that happen to match the current protocol (an older bridge's `navigation-request` or `proxy-content-changed`) are handled on their own terms like any recognized message — incidental interoperation, not a promise. There is no version-compatibility machinery of any kind: a `bridge-ready` without a GUID is ignored, no fallback restores trust, and whatever degradation results is accepted until that installation upgrades.
- Nested frames inside an artifact document are outside this bridge: their input and lifecycle are invisible, including pointer input for application-level theme effects.
- Pointer reporting is not guaranteed against artifact content that prevents the bridge listener from receiving an event. For example, a listener registered earlier on the same event path can call `stopImmediatePropagation()`. This is a platform-level possibility, not a confirmed failure in the current supported artifact matrix; defending against such interference is a current production non-goal.
- Readiness has no failure UI, timeout, placeholder, display effect, or acceptance effect ([Readiness tracking](#readiness-tracking)); a document lacks only the behaviors it does not emit or cannot perform. Loading and unreachable presentation remains code-governed ([product/artifacts.md#^af-states-carve-out](../../product/artifacts.md#^af-states-carve-out)); the missing-artifact and unsupported-URL states are designed as the frame's error page ([ui/app/artifact-frame/index.md](../../ui/app/artifact-frame/index.md)).
