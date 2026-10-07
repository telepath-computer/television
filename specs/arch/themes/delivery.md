*Theme delivery: how the active theme's files reach the application and artifact documents, and how each document gets its light or dark appearance marker.*

# Theme delivery

A Television server has at most one active installed theme. This spec covers how that theme's stylesheet and scripts get from its package folder into the documents a person sees, and how each of those documents learns whether it is light or dark.

The theme reaches two kinds of document. The *application document* is Television's own page: the sidebar, navbar and stage. It loads the theme stylesheet, can run a consented main script, and hosts two sandboxed frames in which the theme's background and foreground scripts run. *Artifact documents* that link a live canonical version get the same stylesheet through canonical's wrapper, and never run theme JavaScript.

What people see when themes change, including when scripts rerun and when the application reloads, is owned by [themes and appearance](../../product/themes-and-appearance.md). The manifest flags, the consent set and the `theme-changed` event are owned by [theme architecture](./index.md). How the appearance script and bridge are injected into artifact documents, and how artifacts capture pointer input, are owned by the [artifact bridge](../artifact-frame/artifact-bridge.md). Which artifact documents reload on a theme change is owned by [reload and navigation](../artifact-frame/reload-navigation.md#reload). The [appearance explainer](../explainer-appearance.md) follows all of this from start to finish.

## Active-theme route

The server serves the active package at a fixed public address:

```text
GET /theme/theme.css               stylesheet entry
GET /theme/main.js                 main-page script entry
GET /theme/iframe-background.js    background frame script entry
GET /theme/iframe-overlay.js       foreground frame script entry
GET /theme/<path>                  any other file in the package, at its path within the package
```

Files are served exactly as stored. The server does not rewrite URLs inside them or combine them with other CSS, so a theme's relative `url(...)` and `@import` references resolve against `/theme/` to files in the same package.

Only files inside the active package's folder can be reached. A path that leads outside it, including through a symbolic link, is refused, and packages that are installed but not active cannot be reached at all.

The route needs no authentication and allows any origin. The application document and artifact documents can be on a different origin from the server, and a cross-origin stylesheet request cannot carry the bearer token the control API uses. As a result, anyone who can reach the server can read the active package's files.

A `README.md` at the package root is never served, even though it stays in the package: `/theme/README.md` returns `404`. Authoring agents keep context for the theme there, and it is not meant to be public. ^theme-delivery-readme

The server applies each script entry's gate itself, whatever the client requests. `main.js` is delivered only when the active theme's registered manifest has `enableMainJS: true` and the active theme's ID is in the consent set. The two frame entries are delivered when their own flags, `enableIframeBackgroundJS` and `enableIframeOverlayJS`, are `true`. The frame entries do not depend on consent.

The four entry paths always succeed. When there is nothing to deliver, because no theme is active, a gate is closed, or the package folder or entry file is missing, `theme.css` returns an empty stylesheet and each script entry returns an empty script. Any other path that cannot be served returns `404`. ^theme-delivery-script-route

Every response must be revalidated before a browser reuses it, and its validator changes whenever the active package or the bytes served change. That way, selecting another theme or editing the package is never hidden by a cached copy at the same URL. A query string on a request does not affect what is served. Appearance is not an input either: one stylesheet serves both light and dark, switching on the root marker described under [Appearance resolver](#appearance-resolver).

## Canonical composition

A live canonical version's `styles.css` is a small wrapper that imports the version's own `base.css` and then `/theme/theme.css`. A frozen version's wrapper imports only its base, so frozen v1 is never themed. [Canonical](../canonical.md) decides which versions are live and which are frozen.

The wrapper copies the query string it was requested with, unchanged, onto both import URLs: `/canonical/v2/styles.css?x=1` imports `/canonical/v2/base.css?x=1` and `/theme/theme.css?x=1`. The imported resources ignore the query. This lets a document that keeps running across a theme change, such as the markdown editor, refresh its whole canonical stylesheet by changing the query on its one link. Without the copy, a browser could keep the theme it imported before. An authored query such as `authoredForAppVersion` passes through the same way and changes nothing.

## Stylesheet order

In the application document and in a live canonical artifact document, the theme stylesheet comes after every stylesheet Television provides: the complete foundation, and in the application every surface stylesheet. No Television stylesheet loads after it. Because the foundation's tokens have zero specificity ([foundation overriding](../../ui/foundation/index.md#overriding)), a theme's declarations win in both kinds of document.

## App-document selector

The application document's root element carries `data-television-document="app"`. The desktop app's local connection page is an application document in this sense and carries it too. Because the same theme stylesheet also loads in artifact documents, a rule meant only for the application starts with `:root[data-television-document="app"]`. A rule without that prefix applies wherever the theme loads. ^theme-delivery-app-document

## Appearance resolver

Every document Television manages has `data-theme="light"` or `data-theme="dark"` on its root element. That value is the document's effective appearance, and the foundation and theme CSS select their light or dark values on it. A shared resolver script sets it from an input of `system`, `light` or `dark`. `light` and `dark` are used directly, and `system` follows the document's `prefers-color-scheme`, including when the operating system changes.

## Shell first paint and confirmed state

The application works out its appearance input from two fields of confirmed display state: `activeThemeColorScheme` and `appearanceMode`. A theme that declares `light` or `dark` supplies that value. With no theme active, or a theme that declares `light dark`, the stored preference is used. The application applies this input before connected content mounts, and works it out again whenever a `theme-changed` or `appearance-changed` event updates either field. ^theme-delivery-shell-appearance

Before the server has answered, an inline script, the first thing in the application document's `<head>` and ahead of every stylesheet, installs the resolver using the last confirmed input. That input is cached in local storage under `television-appearance-mode` as `system`, `light` or `dark`. A missing, invalid or unreadable value means `system`. Each confirmed input is written back to the key, and confirmed state replaces the cached value whenever they differ. The cached value is the input, not the stored preference, so a fixed theme's first paint is already right. There is one key per browser origin, not one per server. That is an accepted limitation: after switching servers, the first paint can use the previous server's input until the new server's state arrives.

An appearance change never requests or replaces the theme stylesheet or the main script. It only changes the root marker and recreates the sandboxed frames.

Artifact appearance depends on the application's `color-scheme` passing down through each artifact iframe's ancestors (see [Artifact documents](#artifact-documents)). Application CSS does not set a different `color-scheme` on any element between the root and an artifact frame.

## Application theme link

The application document has one link to the theme stylesheet. It points to `/theme/theme.css` on the connected server and gets a fresh query value every time it is refreshed. Without a new URL, Firefox can reuse the previous link's stylesheet without asking the server.

The link is added as soon as the connection is established, without waiting for display state. It is refreshed on every `theme-changed` event except one that only changes consent, and removed on disconnect. Each new link is placed after every other stylesheet in the document, and the previous link is removed so its late load cannot take effect.

When the current link finishes loading, fails, or is removed, the application announces on `document` that theme styles have changed. Code that measures layout listens for this, because a `theme-changed` event arrives before the new styles apply. A link that has already been replaced does not announce. ^theme-delivery-style-notification

## Application theme JavaScript

### Main script

The main script is a classic, non-module external `<script>` in the application document's `<head>`. Its source is `/theme/main.js` on the connected server, with a fresh query value each time it is added. The application adds it only while the active theme's ID is in the confirmed consent set; the server's gate above still applies. Because it is a classic script, `document.currentScript.src` gives the script's own URL during top-level execution. Code can use that URL to resolve files in the package. Relative URLs used any other way resolve against the application page.

Whether the application reloads is decided by each document from its own state. If the document has a main-script include and a `theme-changed` event either selects a different theme (including no theme) or removes consent for the active theme, the document reloads completely rather than swapping resources in place. Without an include, those changes apply in place. Before reloading, the document applies and caches the new appearance input, so the reloaded page paints with it. After the reload, the page starts from confirmed server state, so the earlier script returns only if the new theme meets both gates. ^theme-delivery-script-reset

### Sandboxed frames

The background and foreground frames are created when the active theme's registered manifest enables them. Consent plays no part.

Both frames are removed and created again when a different theme is selected, on every `theme-changed` event for the same theme except one that only changes consent, and whenever the application root's effective `data-theme` changes. They are removed when no theme is active and on disconnect. The old frames are removed before any new ones are made. A frame is never installed for a state that has already been replaced, even when the registry lookup it waited on finishes late.

Each frame's document is generated by the application. It has a transparent background, no margin and no scrolling, and loads one classic external script from its entry route, again with a fresh query value. Its root element carries `data-theme="light"` or `data-theme="dark"`, copied from the application root when the frame is created, and `html` and `body` declare the same value as `color-scheme`. The frame stays transparent only while that `color-scheme` matches the one its host element in the application uses. When they differ, the browser paints the frame opaque. A frame script reads its appearance from the root `data-theme` when it starts, and resolves package files from `document.currentScript.src`.

The sandbox is exactly `allow-scripts`. Without `allow-same-origin`, the frame document has an opaque origin, even though its script comes from the Television server, so it cannot reach the application's DOM, storage or credentials. Theme CSS in the application cannot style the frame document either. Failures inside a frame stay inside it.

If either frame receives focus, the application moves focus back to the last focused element outside the theme surfaces without scrolling. If there is none, it moves focus to `#app`. The frame hosts' markup, layering and pointer transparency are owned by the [app UI spec](../../ui/app/index.md#^app-theme-visual-layers).

### Host-to-frame pointer protocol

Frame scripts cannot receive input directly, so the application forwards pointer activity to them. It forwards trusted pointer and click events from the application document, and the `artifact-pointer` reports that the current artifact document sends through the [artifact bridge](../artifact-frame/artifact-bridge.md). The bridge also converts artifact coordinates into application coordinates. Forwarding does not cancel, stop or capture the original event, so the application or artifact still handles it as usual.

Each such input produces one message to each current frame:

```ts
type ThemeFramePointerMessage = {
  type:
    | "television-theme-pointer-move"    // pointermove
    | "television-theme-pointer-down"    // pointerdown
    | "television-theme-pointer-up"      // pointerup
    | "television-theme-pointer-cancel"  // pointercancel
    | "television-theme-pointer-click";  // click
  clientX: number;  // CSS pixels from the application viewport's top-left
  clientY: number;
  button: number;   // the button that changed or clicked; -1 for move and cancel
  buttons: number;  // PointerEvent.buttons after the change; 0 for cancel and click
};
```

Messages are sent with target origin `"*"`, because an opaque origin cannot be named. They are not queued, so a frame misses anything sent before its listener is installed. The protocol only goes from host to frame. The application ignores every message whose source is a theme frame, whatever its content, including one that looks like an `artifact-pointer` report. A frame script recognises host messages by their `type` and by `event.source === parent`.

## Artifact documents

Television-managed artifact documents are local HTML and markdown served through the artifact proxy, the markdown editor, and the built-in "artifact missing" and "URL unsupported" pages. They install the same resolver before their styles, always with input `system`. No message tells them the server's preference. Instead, their `prefers-color-scheme` already reflects the application's effective appearance. In Chrome and Firefox, an iframe's `prefers-color-scheme` follows the `color-scheme` it inherits from the application. In Electron, the application sets the native theme for the whole app, including webviews, under the [desktop appearance contract](../desktop/appearance.md). Safari does not pass the inherited scheme into iframes, so there an artifact follows the device. The [product spec](../../product/themes-and-appearance.md#appearance-preference) records this as a known gap. Theme frames do not rely on this inheritance, because each receives its appearance when it is created.

## Inputs to proof derivation that the spec does not otherwise show

### Facts a test author would likely miss

Browsers, Firefox in particular, can reuse a stylesheet already loaded from the same URL without asking the server. A refresh test that changes the entry `theme.css` would pass even if nested imports were stale. Refresh coverage therefore changes only a stylesheet that `theme.css` imports, leaving the entry file byte-for-byte the same, and checks the changed presentation. The markdown editor's in-place canonical refresh is proven in Firefox for the same reason.

### Coverage owned by another spec

The real-browser and Electron acceptance paths for theme presentation, executable themes and appearance are owned by [themes and appearance](../../product/themes-and-appearance.md#testing). Electron's native theme and webview appearance are owned by [desktop appearance](../desktop/appearance.md#testing). This spec's proof covers the delivery mechanisms those paths rely on.
