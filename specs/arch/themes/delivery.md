*Theme delivery: how the selected installed package reaches application and artifact documents and combines with the shared appearance preference.*

# Theme delivery

The server publishes the active installed package at one stable URL. Its stylesheet reaches the application and live canonical artifact documents. A consented main script can run in the application document, while independently declared background and foreground scripts run in isolated application-level frames. Display state and theme events carry `activeThemeColorScheme`, derived from the active manifest's normalized `colorScheme`, and the application combines it with the shared appearance preference: `light dark` follows the preference, while `light` or `dark` supplies that fixed resolver input. Television-managed artifact documents install the same resolver with fixed `system`, so their root marker comes from the browser iframe or Electron webview appearance path. Each generated theme-frame document receives the application's effective value when it is created. The foundation color sheet supplies Television's `color-scheme` through zero-specificity rules governed by its [Overriding contract](../../ui/foundation/index.md#overriding). Both the application document and a live canonical document load the complete foundation before the active theme, every application surface sheet also precedes that theme, and no Television-owned stylesheet content follows it. A theme's token and surface declarations therefore win in either document class. Frozen v1 carries no theme layer.

The [appearance explainer](../explainer-appearance.md) presents these delivery paths together with their product, UI, canonical, and desktop context.

## Active-theme route

The public, CORS-enabled route is:

```text
GET /theme/theme.css
GET /theme/main.js
GET /theme/iframe-background.js
GET /theme/iframe-overlay.js
GET /theme/<asset-path>
```

When a valid installed theme is active, the route serves files only from that registered package. `theme.css` is returned byte for byte. Query parameters on `/theme/theme.css` distinguish request URLs but do not affect package lookup, response bytes, or the validator. Relative `url(...)` and `@import` references therefore resolve naturally under `/theme/`; the server neither rewrites URLs nor concatenates theme CSS into another response. A request that escapes the active package is rejected, including an escape through a symbolic link.

The three root script names are gated entry routes. `/theme/main.js` returns the package's exact bytes as a classic JavaScript response only when the active registered manifest contains `enableMainJS: true` and the active theme's exact ID belongs to the display state's JavaScript-consent set. `/theme/iframe-background.js` requires registered `enableIframeBackgroundJS: true`, and `/theme/iframe-overlay.js` requires registered `enableIframeOverlayJS: true`; the iframe routes do not consult the consent set. Each route returns a successful empty JavaScript response when its gate is closed, when the null theme is selected, or when the active package root or matching entry is unavailable. An entry without its required gate is not exposed through its reserved path. The routes do not inspect script syntax or behavior. Other JavaScript files remain ordinary static package assets, but Television does not load them itself. ^theme-delivery-script-route

A package-root `README.md` is authoring context, not a public theme asset. `/theme/README.md` returns `404` even when that file exists in the active package. The exclusion applies equally to an installed copy of a bundled package; it does not modify or remove the file from storage. ^theme-delivery-readme

With the null theme selected, or when the active package root or CSS entry file is unavailable, `/theme/theme.css` returns an empty stylesheet. Each gated JavaScript entry returns its empty response under the conditions above. Other files return `404`. Inactive packages have no public mount.

Every response requires revalidation. The active-theme validator derives from package identity and response bytes, so selection, entry-file edits, and asset replacement cannot reuse stale bytes at the stable URL. Appearance is not an input to these bytes or validators. Registry control routes remain authenticated; theme files are public because cross-origin stylesheet requests cannot attach the display API's bearer token. ^theme-delivery-route

## Canonical composition

Canonical discovers the version directories under its configured production root and exposes each version's exact canonical-owned stylesheet bytes at `/canonical/v<n>/base.css`. A live version's public `/canonical/v<n>/styles.css` applies the shared active theme under the document cascade above. The base and active theme are separate resources with independent validators, and their composition inspects neither display state nor either stylesheet's bytes.

Each wrapper copies its request's complete query string onto every import URL without interpreting individual parameters. The complete query string is the serialized substring received after `?` in the request target; the wrapper does not percent-decode or reserialize it. A query-free wrapper request produces query-free import URLs. For example, `/canonical/v2/styles.css?tv-styles=123` imports `/canonical/v2/base.css?tv-styles=123` followed by `/theme/theme.css?tv-styles=123`. The imported routes derive their response bytes and validators from their resources, independent of that query. A refreshed wrapper URL therefore gives each nested stylesheet a refreshed URL while preserving the independently served canonical base and active theme. ^theme-delivery-wrapper-query

A frozen version's wrapper is only the base import; it does not request the active theme. Its base import carries the wrapper query under the same rule. Frozen v1 therefore keeps its fixed light base even when the resolver sets a root appearance.

[Canonical](../canonical.md) owns live and frozen version authority, production inputs, builds, marker-based version discovery, and which version an artifact links. Theme delivery contains no canonical version list: every live version receives the shared theme layer, and a copied `frozen.json` marker excludes a frozen version from it.

An authored artifact may append the advisory query `?authoredForAppVersion=<version>` to its canonical stylesheet URL. The value records the Television app version the artifact was authored against; a future agent can compare it with app-version changes. The canonical server performs no version comparison and treats it like every other wrapper query by copying it to the import URLs. The imported resources serve the same bytes and validators they serve without the query, so the value changes neither rendering nor compatibility. A URL without the parameter is always accepted. ^theme-delivery-canonical

## Appearance resolver

`packages/artifact/src/browser/appearance-resolver.ts` owns the browser resolver used by the shell and, through serialized source, artifact documents. It accepts `system`, `light`, or `dark`, writes only the effective value to `document.documentElement.dataset.theme`, and returns a controller with `setPreference()`. Explicit preferences apply directly. `system` reads `matchMedia("(prefers-color-scheme: dark)")`; media-query changes reapply only while that preference is held.

Installation is idempotent per document. The controller lives at `window.__televisionAppearanceResolver`; the first installation preference wins, and later installation calls return it without replacing the preference or adding a listener. ^theme-delivery-resolver

## Shell first paint and confirmed state

The web build serializes the resolver into a classic inline script injected with Vite's `head-prepend` position. It is the first entry in the built document's `<head>` and runs before stylesheet links. The server declares the HTML response as UTF-8.

The script reads one local-storage cache key, `television-appearance-mode`; the key contains no server identifier. The cache contains only `system`, `light`, or `dark`. A valid cached value supplies first paint. Missing or malformed data and storage read failures use `system`.

The application's module code adopts the controller installed by the inline script. Once connected display state is ready, the module combines its required `activeThemeColorScheme` with the confirmed `appearanceMode`. A null scheme and `light dark` use the stored preference; `light` and `dark` use that fixed value. The module applies and caches this resolved input before connected content mounts. After an `appearance-changed` or `theme-changed` event updates confirmed display state, it recomputes from the same two fields. These confirmed display fields are the appearance path's complete server input; it does not read the theme registry. If a theme event also requires the [main-script reset](#main-script), the destination input is applied and its cache write completes or fails before the document reload begins. A cache write failure neither prevents the input from being applied nor delays that reload. Confirmed server state is authoritative over a disagreeing cache, and the raw manifest string never reaches this path. The cache never supplies settings or API state. ^theme-delivery-shell-appearance

The selected scheme inherits through every ancestor of an artifact iframe; application CSS does not reset it on an intervening element or the frame.

## App-document selector

The app UI spec owns `data-television-document="app"` on the application document's root element. Theme declarations meant only for app chrome begin with `:root[data-television-document="app"]`; declarations without that prefix may also match artifact documents that load a theme-capable live canonical version. The bundled [Clouds theme](../../ui/themes/clouds/index.md) uses this prefix for application tokens and rules, while its shared neutral tokens also apply in live canonical artifacts. The registered wallpaper URL token is owned by the [application token sheet](../../ui/foundation/tokens/app.css). ^theme-delivery-app-document

## Application theme link

One module, `packages/web/src/theme.ts`, owns the application's only active-theme link. It points to the connected server's absolute `/theme/theme.css` path with a unique cache-busting query on each refresh. The path remains stable for relative package assets, while the changing request URL prevents a browser from reusing the previous link's stylesheet without consulting the route. Setup and reconnect install the link as soon as the server connection becomes connected, without waiting for display-state readiness. Selection and every watched active-package change, loss, or recovery refresh it. Every installation keeps the link last among document stylesheets, so the theme is the last stylesheet content applied; replacing the current link node detaches any older resource load before it can become the current sheet. Disconnect removes it.

Appearance resolution does not request, replace, or refresh the theme link. A preference change under a fixed theme therefore leaves both the effective root marker and the link unchanged. ^theme-delivery-app-link

The application theme module dispatches `television-theme-styles-changed` on `document` when the current stylesheet finishes loading, fails to load, or is removed on disconnect. Consumers then remeasure layout affected by the applied styles. The notification carries no data and is not sent for a superseded link that settles later. A selection event alone is not a signal that the stylesheet has applied. Appearance remains observable through the effective root `data-theme` value, including changes caused by the operating system. ^theme-delivery-style-notification

## Application theme JavaScript

The same application theme module owns the main script include and both sandboxed frame lifecycles. Canonical wrappers, artifact proxy documents, the markdown editor, and built-in artifact error documents install none of them.

### Main script

The module owns at most one classic external `<script>` include in the application document's `<head>`. It creates the include only when the connected display state's active theme ID belongs to its confirmed JavaScript-consent set. The include points to the connected server's absolute `/theme/main.js` path with a unique cache-busting query on each refresh. The module appends it only after Television's first-party entry module has established the application runtime, so browser-reported loading failures, syntax errors, and uncaught exceptions do not interrupt or rethrow through that module's execution. The route applies the separate registered `enableMainJS` gate, and a delivered script executes with the application document's ordinary browser privileges.

Setup and reconnect leave the include absent until the application has received confirmed display state, then evaluate that state once. Every watched active-package change, loss, or recovery replaces the include when the active ID remains consented, so an enabled script executes on every such refresh even when `main.js` itself did not change. A registry refresh that changes the active package's `enableMainJS` state reaches the same path through the [registry event contract](./index.md#registry-scan). A consent-set change reevaluates the resources through the same `theme-changed` event: opting in injects the include for the active ID, while a membership change that does not affect the active ID updates application state without refreshing any active theme resource. Appearance changes do not replace the include. Disconnect removes it.

The module remembers whether the current application document has an installed main-script include. When a `theme-changed` event selects a different theme ID, including the null theme, or removes consent for that active ID while an include is installed, the application performs a full document reload instead of replacing resources in place. The server broadcasts the event, so every connected browser and Electron application document applies the same reload rule. The confirmed destination state controls startup after reload, preventing the prior script from returning unless the destination theme independently meets both gates. A same-ID active-package or registry event keeps the ordinary replacement lifecycle, and changing themes without an installed include remains in place. Sandboxed-frame replacement alone never requests a full application reload. ^theme-delivery-script-reset

Before a forced reload, a document whose Settings popover is open adds `reopenSettings=1` to its current URL while preserving every other URL component. Startup consumes the marker once by removing it with `history.replaceState` before opening Settings after the connected application view mounts. A document whose popover was closed adds no marker. The consumed marker is absent from subsequent reloads, so it cannot create a reload loop. ^theme-settings-reopen

Replacing or removing the main-script element outside the forced-reset cases does not roll back effects from code that already executed. The browser reports script failures through its ordinary error channels; Television's loader does not convert them into application startup or refresh failures. The script's own successful interference with application DOM, globals, listeners, timers, and in-flight document resources remains effective until the document reloads. Reloading ends those document-lifetime effects; it does not undo persistent storage writes or completed network requests. ^theme-delivery-script

Main JavaScript that needs a package-relative URL can capture the injected classic script's `document.currentScript.src` during top-level execution and resolve from that URL; document-relative URLs resolve from the application page.

### Sandboxed frames

The module installs the background frame only for registered `enableIframeBackgroundJS: true` and the foreground frame only for registered `enableIframeOverlayJS: true`. These decisions do not consult `themeJavaScriptConsentIds`. After confirmed display readiness on setup or reconnect, the module reads the current registry through the authenticated `GET /themes` contract and resolves the active entry by exact ID. A failed initial registry read leaves both frames absent until reconnect or a later frame-recreation trigger retries the lookup.

A selection change without a main-script reload destroys the prior frames before resolving the destination registry entry. A same-ID active-package or registry event also destroys both frames, refreshes the registry lookup, and recreates every enabled frame; this reruns both iframe entries even when their bytes did not change. Consent-only events preserve both frames. Whenever the application root's effective `data-theme` changes, the module synchronously removes both frames, refreshes the registry lookup, and recreates every enabled frame for that appearance; a superseded asynchronous operation cannot install a frame for an appearance that is no longer current. This appearance-driven replacement is confined to the decorative frame documents: the application and artifact documents retain their state, and the main script does not rerun. Null selection and disconnect remove both frames. Active-package loss retains the registered flags, so the replacement frame loads the entry route's empty response; recovery recreates it with the restored entry. A registry refresh that disables a flag removes its frame.

Each frame receives a minimal `srcdoc` document with a transparent, marginless, non-scrolling viewport and one classic external script pointing at its connected server's cache-busted entry route. The document root carries `data-theme="light"` or `data-theme="dark"`, copied from the application root at creation, and its embedded stylesheet declares the same literal `color-scheme` on `html` and `body`; both backgrounds remain transparent. The sandbox token set is exactly `allow-scripts`; omission of `allow-same-origin` gives the document an opaque origin even though its script comes from the connected server. A frame script cannot access the application DOM. It can read its appearance from the root `data-theme` at startup and use `document.currentScript.src` to resolve package-relative assets. Load, syntax, and runtime failures stay within that browsing context. Destroying the frame ends its document, listeners, timers, and other frame-held state.

The [app UI spec](../../ui/app/index.md#^app-theme-visual-layers) owns the exact frame-host IDs and attributes, viewport layering, pointer transparency, appearance-keyed host color scheme, and theme-controlled presentation. Delivery gives the child document the same effective appearance value as its host element; matching their used color schemes allows the transparent child viewport to composite over the application. The sandbox above controls each child document's isolation, and theme CSS cannot cross that boundary to style the child document.

An application-level focus guard remembers the latest focused, still-connected element outside the theme surfaces. If either iframe becomes `document.activeElement`, the guard returns focus to that element with scrolling suppressed; when no such element exists, it programmatically focuses `#app`, whose `tabindex="-1"` keeps it outside sequential navigation. The guard does not otherwise change application focus.

### Host-to-frame pointer protocol

The application host forwards pointer motion and button transitions to each installed frame. It accepts trusted events captured in the application document and source-validated `artifact-pointer` input from the current artifact document. Neither path prevents default behavior, stops propagation, or takes pointer capture, so the event continues through its ordinary application or artifact path. Every qualifying input produces one `postMessage` to each current frame; messages are not queued or replayed for a frame that has not installed its listener. ^theme-frame-pointer-contract

```ts
type ThemeFramePointerMessage = {
  type:
    | "television-theme-pointer-move"
    | "television-theme-pointer-down"
    | "television-theme-pointer-up"
    | "television-theme-pointer-cancel"
    | "television-theme-pointer-click";
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
};
```

`clientX` and `clientY` are CSS-pixel coordinates from the application viewport's top-left, without device-pixel-ratio scaling; the full-viewport frame therefore uses them directly. Application-document events supply these values directly. Artifact input arrives in the artifact viewport's coordinates, so the host maps it through the current artifact frame's rendered rectangle and layout dimensions. The mapping preserves the application's existing rectangular scale transforms; a frame with zero layout width or height supplies no message. `buttons` is the standard `PointerEvent.buttons` bitmask after the named transition: down includes the newly pressed button, up excludes the released button, move carries current state, and click carries `0`. `button` identifies the changed or clicked button for down, up, and click; the host sends `-1` for move and cancel and normalizes cancel to `buttons: 0`.

The five message names correspond respectively to `pointermove`, `pointerdown`, `pointerup`, `pointercancel`, and `click`, whether the source is the trusted application event or the current artifact peer's source-validated notification. A drag that produces no browser click still produces its down, motion, and up transitions. The host sends each message to the specific frame's current `contentWindow` with `targetOrigin: "*"`, required because the recipient has an opaque origin. The wildcard applies only to that destination operation. The host accepts no message from either theme frame: any `message` event whose source is one of those windows is ignored regardless of payload, including an `artifact-pointer` lookalike. Frame scripts identify host pointer messages by the closed `type` union and `event.source === parent`. ^theme-frame-pointer-one-way

Whether an artifact browsing context can produce a qualifying notification is outside theme delivery. [Artifact bridge known limits and non-goals](../artifact-frame/artifact-bridge.md#known-limits-and-non-goals) are the sole authority for bridgeless documents, nested frames, possible content interference, and unconfirmed Electron raw/plugin gaps; those cases are not requirements for current production delivery.

## Artifact documents

Artifact authors obtain the current app's exact release version from `version` in `tv status` when targeting a running server, or from the checkout root `package.json` when authoring in the Television repository. The version is copied unchanged into the `authoredForAppVersion` query. A missing status version or the `0.0.0` development sentinel does not establish an authored-against release. New artifacts authored against a known current Television release include its exact version on the canonical stylesheet URL. An existing value is preserved unless the artifact is deliberately reviewed or re-authored against another app release; if the author cannot establish the target release, omitting the parameter is correct. The value is advisory metadata, not a compatibility claim or a load gate.

The artifact proxy installs the shared resolver with fixed `system` in an early parser-blocking script after applicable CSP metadata and before styles. When authored markup puts a CSP meta element after content that can apply styles, Television preserves the policy and inserts the resolver after that earlier content. It does not move or bypass the policy. Its complete bridge remains at document end and invokes the same resolver before bridge installation. Authored HTML adds no appearance markup. Proxy-rendered markdown follows the same path. Non-HTML responses receive neither script.

The markdown editor, artifact-missing page, and url-unsupported page include a blocking fixed-`system` resolver before `/canonical/v2/styles.css`; their own styles follow canonical. Markdown inherits canonical v2's live prose defaults, including future refinements allowed by that version's contract. Theme changes reload local HTML and the built-in error documents. A ready markdown editor receives `styles-changed` and cache-busts its canonical link under the [wrapper query rule](#^theme-delivery-wrapper-query) without replacing the editor or document; no notification is queued before readiness. Appearance changes reload nothing and request no stylesheet.

## Embedded-document platform behavior

In Chrome and Firefox, an iframe's used `color-scheme` value controls that document's `prefers-color-scheme` query, including cross-origin frames. Safari uses the device preference inside an iframe when an explicit host preference disagrees; [TV-692](https://linear.app/telepath-computer/issue/TV-692) tracks this platform difference. Theme-frame appearance does not depend on that query: each frame document receives its effective `data-theme` and matching root scheme at creation. There is no appearance message in this contract.

Electron applies the application's appearance input app-wide through the [desktop appearance contract](../desktop/appearance.md), because a `<webview>` is a separate `WebContents` and does not inherit its embedder's scheme.

A fixed theme gives the application root its fixed `data-theme`, so the foundation selects the matching mode tokens and `color-scheme`. Chrome and Firefox artifact iframes inherit that scheme, while Electron gives webviews and native surfaces the same fixed value through `nativeTheme`. Theme script frames copy the fixed root marker. These paths therefore agree on the theme's effective appearance even when the stored preference differs. ^theme-delivery-embedded

## Testing

Active-route acceptance must cross the real public HTTP route and real package files. One missing-root walk uses a selected package with all three entries enabled and its main entry consented, removes and restores that package at the same path without registry refresh, and observes the stylesheet, scripts, ordinary assets, and validators together. The package-root `README.md` exclusion is exercised at the same boundary.

Active-package refresh coverage must change only a nested imported stylesheet while the entry stylesheet stays byte-identical. It must cross the real server event and application-link path, with changed imported presentation as its observed outcome. The product acceptance directive in [themes and appearance](../../product/themes-and-appearance.md#testing) owns the app-and-artifact presentation spine.

Foundation/theme composition coverage must combine seams for the application and live canonical documents with real-browser acceptance in both document classes. Browser fixtures must include fixed-light, fixed-dark, and `light dark` manifests. Their theme stylesheets use root token declarations or mode-specific declarations without declaring `color-scheme`, leaving the foundation to match that property to the effective root marker.

Markdown stylesheet-refresh acceptance must include Firefox against the production canonical and theme routes: a ready editor loaded under a fixed-dark theme changes to a light theme through the production event path, retains its document, editor, and contents, and renders the light presentation from a nested theme request carrying the refreshed wrapper query.

Main-script acceptance joins the [product's real-browser spine](../../product/themes-and-appearance.md#testing), keeping the production public route, confirmed display state, and application loader on the path. Browser script loading, error reporting, document replacement, and restoration of the production [Settings popover](../../ui/app/settings/index.md) are exercised without substituting those mechanisms.

Sandboxed-frame acceptance crosses the current registry, production entry routes, host elements, artifact bridge, and real iframe boundary in that same browser spine. Opaque-origin enforcement, browser-generated pointer trust and hit testing, pointer continuity across the application and a bridge-capable artifact, pointer cancellation, and browsing-context focus transfer remain real browser mechanisms. The same browser spine must exercise an effective appearance change and show that removal precedes replacement, no old-appearance frame remains, replacement scripts receive the new root `data-theme`, host and document schemes match, and the frames composite transparently in dark appearance. The product acceptance carries the corresponding Electron spine for ordinary webview documents.

Tests observe a standalone document's first paint at its first animation frame while the browser's preferred color scheme is emulated. Separate browser acceptance through the running artifact proxy observes the iframe's inherited color scheme, its root element's `data-theme` value, and its appearance-dependent rendered color without emulating the preferred color scheme. That acceptance does not measure the interval between parser execution and the iframe's first paint. ^theme-delivery-artifact-documents
