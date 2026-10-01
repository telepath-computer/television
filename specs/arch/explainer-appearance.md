*Explainer: how Television combines a theme with the server-wide appearance preference across the application, artifacts, theme script frames, and Electron-native surfaces.*

# Appearance from preference to pixels

Television lets a person choose light, dark, or follow the operating system for everyone connected to a server. An active theme can follow that preference or fix one appearance. The application spans a main page, embedded artifact pages, optional visual-effect frames, and sometimes Electron, so the resulting appearance has to reach several separate documents before each surface can respond.

## How to read this

This is a derived *explainer* under [spec policy](../spec-policy.md#^explainer-type). It brings together rules owned by the linked specs; those specs remain authoritative and win if this account conflicts with them.

## Four related values

Four values take part in the journey:

1. The *appearance preference* is the server's stored choice: `system`, `light`, or `dark`. It is shared by every connected client.
2. A theme's manifest `colorScheme` is `light dark`, `light`, or `dark`. `light dark` follows the appearance preference; the single values fix one appearance. The manifest reader normalizes the declaration before any registry or client receives it.
3. The *effective appearance* is the `light` or `dark` result for one Television-managed document. Television records it as `data-theme` on that document's root element. Under an adaptive theme and the `system` preference, different clients can have different effective appearances because each follows its own operating system. A third-party page can respond to its browser context without carrying Television's marker.
4. CSS `color-scheme` tells the browser which light or dark treatment to use for native controls and embedded browsing contexts. Television's foundation keeps it aligned with `data-theme`; theme CSS leaves this property to the foundation.

The application gives its resolver the stored preference for an adaptive theme or the manifest's fixed value for a fixed theme. Keeping these values distinct explains why some parts receive that resolver input while others receive the browser-resolved light or dark result. The [product behavior](../product/themes-and-appearance.md#appearance-preference), [manifest and display contracts](./themes/index.md), and [foundation mode rules](../ui/foundation/index.md#dark-and-light-mode) own their exact meanings.

## The server stores the preference and supplies the active scheme

Settings writes the choice to the server's display state. The server validates and persists it, sends the confirmed value to clients, and emits `appearance-changed` when the stored value changes. A display response pairs the active theme ID with `activeThemeColorScheme`, which the server derives from its current registry rather than storing. Every `theme-changed` event carries the same pair, including an updated scheme after registry refresh. The [Settings control](../ui/app/settings/index.md#interaction) does not present a requested value as confirmed before the server accepts it. Theme selection is separate state: selecting a fixed theme does not rewrite the preference, and the control continues to update it while that theme holds the effective appearance fixed. These behaviors belong to [themes and appearance](../product/themes-and-appearance.md#appearance-preference) and [theme architecture](./themes/index.md#selection-and-display-state).

A new installation starts at `system`. Once stored, the preference survives browser, desktop, and server restarts. Following the operating system does not continually rewrite server state: the stored value remains `system`, and each adaptive client resolves it locally.

## The application resolves first paint and connected state

The application needs a light or dark result before it can paint, but the server connection is not ready that early. A small inline script therefore runs before stylesheet links and installs the shared [appearance resolver](./themes/delivery.md#appearance-resolver). It starts from the browser's last server-confirmed resolver input: the preference for an adaptive theme or the fixed value for a fixed theme. Missing, malformed, or unreadable cache data falls back to `system`.

This browser cache is only a first-paint hint, and one cache is shared across server connections. Once the connected server's display state is ready, its active theme scheme and stored preference replace the cached choice before connected content mounts. Later theme events carry the next scheme, and preference events carry the next preference, so either can recompute the input without a registry request. The [shell first-paint contract](./themes/delivery.md#shell-first-paint-and-confirmed-state) owns this ordering.

The resolver turns that input into the root marker:

- `light` and `dark` write that value directly;
- `system` asks `prefers-color-scheme` and listens for operating-system changes while `system` remains selected.

The result is always `data-theme="light"` or `data-theme="dark"`. An operating-system change can therefore change the application root without any server event, but only while the active theme and stored preference resolve to `system`.

## Foundation and themes turn the marker into appearance

The foundation's light values are the baseline. Its zero-specificity dark block restates only the tokens and `color-scheme` values that change when the root carries `data-theme="dark"`; values that are not restated keep their light definition. This is the [foundation's dark-and-light mode](../ui/foundation/index.md#dark-and-light-mode), implemented in its [color token sheet](../ui/foundation/tokens/colors.css).

One active theme stylesheet loads after the foundation in the application and in artifacts using a live canonical version. [Canonical](./canonical.md) is the versioned stylesheet-and-script bundle Television serves to artifact documents. An adaptive theme can use `[data-theme="light"]` and `[data-theme="dark"]` blocks to follow the effective appearance. A fixed theme uses root declarations and fixes the root marker through its manifest. Theme CSS does not declare `color-scheme`; the foundation supplies the value matching the marker. The same stylesheet bytes serve every appearance the theme supports, so appearance changes need no stylesheet request. [Theme authoring](./themes/authoring.md#appearance-and-scope) defines these patterns, and [theme delivery](./themes/delivery.md#application-theme-link) defines the application link's lifecycle.

An effective appearance change updates the existing application document in place. It does not reload that document or refresh the theme stylesheet, and it does not rerun [main-page theme JavaScript](../product/themes-and-appearance.md#main-page-javascript-and-consent), which runs only with the user's consent. Changing only the stored preference under a fixed theme leaves the root marker and presentation unchanged.

## Browser artifacts receive appearance through the iframe boundary

Television-managed HTML and markdown artifact documents install the same resolver before their styles, but with a fixed `system` preference. They do not receive the server preference through a Television message. Instead, the artifact iframe inherits the application's used `color-scheme`. In Chrome and Firefox, that embedding scheme controls the iframe document's `prefers-color-scheme` result, which the artifact resolver turns into its own root `data-theme`. The exact installation points and browser behavior are in [artifact documents](./themes/delivery.md#artifact-documents) and [embedded-document platform behavior](./themes/delivery.md#embedded-document-platform-behavior).

A live canonical artifact then uses the same foundation mode blocks and active theme layer as the application. Its document stays loaded when appearance changes; its resolver changes the root marker and CSS responds in place. Canonical's build output does not vary by appearance, as [canonical serving](./canonical.md#serving) specifies.

Safari does not carry an explicit embedding scheme into an iframe when it differs from the device preference. In that case, an artifact iframe continues to follow the device.

Frozen canonical v1 is deliberately outside the live path. Its committed stylesheet is fixed light and has no active-theme layer, so changing appearance does not change its canonical styling. Keeping that result stable is part of [v1's compatibility contract](./canonical.md#v1).

## Electron carries the resolved input to separate web contents

An Electron artifact runs in a webview, a separate browser context that cannot inherit the application page's scheme as an iframe does. After the server confirms display state, the application sends its resolved `system`, `light`, or `dark` input to Electron's main process. The main process sets Electron's application-wide theme source before the first artifact webview attaches. Electron resolves `system` and applies the result to renderers, webviews, native menus, and dialogs. [Desktop appearance](./desktop/appearance.md) owns this path.

A Television-managed artifact document still uses the shared resolver with fixed `system`. Inside the webview, its media query sees Electron's native result and updates the root marker. A third-party page instead responds through its own CSS and scripts. Later effective appearance changes update the same loaded webview rather than replacing its document. The application document continues to use its browser resolver in parallel.

Disconnecting or returning to the desktop connect screen keeps the last resolved native input. A newly connected server's display state replaces it with that server's resolved value before connected content and its first webview mount.

## Fixed themes hold one effective appearance

A fixed theme's manifest supplies `light` or `dark` as the resolver input regardless of the stored preference. The application root therefore carries the fixed `data-theme`, and the foundation selects the matching mode values and `color-scheme`. This includes mode-dependent values that the theme does not override, such as border opacity, active-state tint strength, and the four shadow tokens.

In Chrome and Firefox, an artifact iframe inherits that fixed scheme and its fixed-`system` resolver writes the same root marker. Electron gives webviews, third-party pages, native menus, and dialogs the fixed value through `nativeTheme`. The optional theme script frames copy the application marker, so their scripts receive it too.

Changing Light, Dark, or Adapt to system in Settings still updates the stored preference while a fixed theme is active. Nothing visible changes. Selecting an adaptive theme or the null theme makes the latest stored preference effective again.

## Theme script frames copy the effective appearance

The optional theme background and overlay frames are different from artifact frames. Television creates their complete documents, isolates their scripts, and treats them as disposable visual effects. They receive neither the shared resolver nor an appearance message.

When the application root's `data-theme` changes—whether from theme selection, a server preference, or an operating-system change—Television removes each enabled theme frame and creates a new one. The new document starts with a copy of the application's effective `data-theme`, so its script reads the final light or dark value once at startup. The [sandboxed-frame lifecycle](./themes/delivery.md#sandboxed-frames) owns creation and replacement.

Transparency requires the frame element and its child document to use the same scheme. The app shell's [frame-host rules](../ui/app/index.md#theme-visual-layers) pin each host element to the light or dark value named by the application root; the generated child document declares that same literal value on its root and body. Their backgrounds remain transparent. Matching the schemes allows the child viewport to composite transparently, including when the selected appearance differs from the device preference; a mismatch forces the frame opaque. The exact host declarations live in the app [stylesheet](../ui/app/styles.css).

Recreating a theme frame reruns its script and clears the old frame's animation state, listeners, and timers. It does not reload the application or artifacts, rerun main-page theme JavaScript, or refresh theme CSS. A frame script therefore reads the root marker once at startup rather than listening for appearance changes, as [theme-authoring guidance](./themes/authoring.md#theme-effects-and-scripts) explains.

## What changes in place and what is replaced

A preference change under an adaptive theme, an operating-system change while that theme follows the system, or a theme change that selects a different effective appearance has these outcomes:

- the application resolver updates the existing application's root marker;
- foundation and appearance-aware theme CSS respond in place;
- live Television-managed browser artifacts respond through their embedded-document resolver, subject to Safari's limit above;
- Electron updates its native theme and existing webviews in place;
- enabled theme script frames are replaced so their host and child schemes match;
- frozen canonical v1 styling stays fixed light; and
- application and artifact documents, editor contents, the active theme stylesheet, and main-page theme JavaScript remain in place.

A stored preference change under a fixed theme changes only server state, because the resolved input and effective appearance stay fixed. The different presentation lifecycles above preserve stateful documents while allowing the two decorative theme frames to restart only when their effective appearance changes.
