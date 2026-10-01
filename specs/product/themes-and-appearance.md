*Themes and appearance: how people choose a server-wide installed theme, use its CSS and JavaScript visual surfaces, grant per-theme consent for main-page JavaScript, and set the light, dark, or system preference that the active theme resolves into appearance.*

# Themes and appearance

Television can load an installed theme and apply it for everyone connected to the same server. Every theme supplies CSS, and it can add isolated animated surfaces behind or above the application or ask the user to trust JavaScript that runs in the main page. People also choose whether the server prefers a light appearance, a dark appearance, or the operating system; a theme can follow that preference or declare one fixed appearance.

## What this owns

This spec owns the user-visible behavior of installed themes, CSS and JavaScript theme surfaces, main-page JavaScript consent, theme selection and refresh, invalid-theme reporting, bundled themes, and appearance selection. Theme package validation, storage, APIs, events, and telemetry are owned by [the theme architecture](../arch/themes/index.md). [Theme delivery](../arch/themes/delivery.md) owns how the active package's stylesheet and scripts reach browser documents, including sandboxing and the host-to-frame pointer protocol. [The app shell](../ui/app/index.md) owns the overlay markup and stacking, and [Settings](../ui/app/settings/index.md) owns the consent control's exact presentation. The [appearance explainer](../arch/explainer-appearance.md) follows the preference through these surfaces from start to finish.

## Theme packages, the null theme, and the default theme

An installed theme is a folder Television discovers in the themes directory of the [Television home](./cli.md#^cli-home) the server serves, `<home>/themes`; [`tv themes-path`](./cli.md#^cli-themes-path) prints that directory when the command selects the server's home. Its folder name is the *theme ID*, preserved exactly as the filesystem reports it. Discovered IDs are not normalized or otherwise restricted to a character pattern, and every identity comparison uses exact string equality. A package contains a manifest, a `theme.css` entry stylesheet, and any static assets its CSS uses. It may also contain `main.js` for the main application document, `iframe-background.js` for an isolated surface behind the application, and `iframe-overlay.js` for an isolated surface above it. A valid manifest supplies the theme's display name, package version, and color scheme: light, dark, or both. A theme that declares both follows the server's appearance preference; a theme that declares only light or dark keeps that fixed look. The manifest may record the app version the theme was authored against and independently declare any of those scripts executable. This app-version value is advisory metadata for agents and never controls whether the theme can be installed or selected. The settings UI shows the display name; commands and stored state use the theme ID.

The *null theme* is the absence of an active installed theme. This is Television's internal technical term in specs, code, tests, and developer documentation. User-facing surfaces — the settings UI, CLI help and messages, the user guide, and bundled skill guidance — label the choice `None` or describe it as having no theme or running without a theme; they never show the term `null theme`.

With the null theme selected, Television applies no installed-package CSS or JavaScript: the application's theme frames are absent, the app uses its foundation and app styles, and artifacts use their canonical base. Selecting the null theme while main-page theme JavaScript is active reloads the application document under the executable-theme lifecycle. Any capitalization of the CLI token `none` selects the null theme. The [delivery contract](../arch/themes/delivery.md#active-theme-route) defines the empty public entry responses.

The *default theme* is the installed theme assigned on a new installation. Clouds is the current default theme.

Among folders eligible for discovery, Television reserves no theme IDs. `none` is CLI vocabulary for the null theme, and `default` is product vocabulary for Clouds; neither is a special theme ID. Television does not expect anyone to name a theme folder `none` or `default`, so such a folder receives no reserved-name validation, carve-out, or special handling, and none is to be added. Television does not promise that such a folder works well in the CLI or Settings, but the folder must not crash Television.

One active theme applies server-wide. A theme selected in one client reaches every connected browser and desktop client, including artifacts that link a theme-capable live canonical version. The selection and per-theme main-JavaScript consents persist across client and server restarts. Every installed theme supplies one CSS overlay that may style both light and dark appearances; all optional JavaScript surfaces are confined to the Television application.

Frozen canonical v1 is not theme-capable. An existing artifact that links v1 remains loadable but renders its fixed light canonical base: it does not load the active theme and receives no canonical appearance mappings. Selecting or editing a theme, or changing appearance, does not change that artifact's canonical styling. Its host may still reload it through the generic theme-change lifecycle; that reload does not make v1 themed.

## Executable themes and visual surfaces

An *executable theme* declares one or more JavaScript surfaces in its manifest. `"enableMainJS": true` declares the root `main.js` entry for the main application page. `"enableIframeBackgroundJS": true` declares `iframe-background.js` for a sandboxed frame behind the application, and `"enableIframeOverlayJS": true` declares `iframe-overlay.js` for a sandboxed frame above it. The declarations are independent and a theme may use any combination. A script file without its matching declaration does not execute. Theme JavaScript never enters an artifact document. ^theme-executable-javascript

The application also provides a permanent CSS-only foreground surface that themes can style for effects such as tinting, translucent imagery, and scanlines. It and both optional frames cover the application viewport without accepting pointer input. Their exact markup and stacking belong to the [app UI spec](../ui/app/index.md#theme-visual-layers). Browser top-layer surfaces, including native popovers and modal dialogs, appear above the theme surfaces.

### Main-page JavaScript and consent

Main-page JavaScript consent is server-wide and belongs to the exact theme ID. Selecting a theme does not grant consent. Settings presents the consent control only for the active theme when its registered manifest declares `enableMainJS: true`. Enabling it adds that ID to the consent set and causes `main.js` to run as a classic external script in every connected browser and desktop application document; a newly connected or reloaded application also runs it while the same theme remains active and consented. Selecting another theme preserves the prior theme's consent, so returning to that exact ID permits its main script to run again. ^theme-javascript-consent

A consented main script has the application page's ordinary same-origin browser privileges. It can inspect or replace the application DOM, read page-visible data and browser storage, issue network requests, install listeners and timers, and change browser globals. Granting consent therefore trusts that theme's main script on every client connected to the server. Electron's existing process isolation remains in force; consent grants no Node.js integration beyond capabilities already exposed to the application renderer.

Television supports the manifest declaration, user consent, active-package delivery, and execution lifecycle. Its application elements, internal globals, state machinery, and other implementation details are not a compatibility API for main-page theme JavaScript and may change between releases. A script can deliberately or accidentally interfere with those surfaces and break the application's UX.

The main-script loader runs outside the bundled application's module execution. A load or syntax error, or an uncaught exception thrown by the script, is reported by the browser and does not stop or rethrow through Television's bundled application code. This isolation does not protect the app from DOM, global, storage, network, or resource changes the script successfully makes before or around an error.

### Sandboxed background and foreground JavaScript

A selected theme's declared iframe scripts run automatically, without main-page JavaScript consent, in two separate full-viewport frames. Each frame is sandboxed with script execution and an opaque origin. Its script can draw and animate inside its own document but cannot read or mutate the application DOM. The background frame sits behind the application UI; the foreground frame sits above the UI and the CSS foreground surface. Neither frame can receive direct pointer or keyboard interaction.

The host sends each frame a one-way stream containing viewport pointer coordinates and button transitions, so visual effects can follow the pointer while the underlying application or artifact document receives the actual input. The stream continues across an artifact document when its browser bridge or Electron preload can observe the pointer; the artifact's own clicks and other input remain effective. Browser artifacts without the bridge and nested frames cannot contribute pointer data. Electron promises this behavior for ordinary DOM documents, not Chromium-managed raw or plugin content. These gaps are explicit non-goals for current production code rather than incomplete feature acceptance. [Artifact bridge known limits and non-goals](../arch/artifact-frame/artifact-bridge.md#known-limits-and-non-goals) own the precise distinction between confirmed isolation limits, possible content interference, and unconfirmed Electron cases, with their long-term record in [TV-743](https://linear.app/telepath-computer/issue/TV-743). Messages sent by a frame have no effect on the host. The exact protocol and opaque-origin delivery rules belong to [theme delivery](../arch/themes/delivery.md#host-to-frame-pointer-protocol). ^theme-artifact-pointer-limit

Selecting another theme ends both prior frame effects and starts the destination theme's enabled surfaces. An active-package refresh restarts enabled frame effects, including when the changed package file is unrelated to their scripts. An effective appearance change also restarts each enabled frame effect so its replacement document carries the new appearance. Disabling a frame declaration ends that surface at registry refresh. Each restart or removal ends all effects held inside its sandbox without reloading the application document. Script load, syntax, and runtime failures remain inside the affected frame and leave the application operational. The [delivery lifecycle](../arch/themes/delivery.md#sandboxed-frames) defines frame replacement. ^theme-iframe-lifecycle

### Main-script reset lifecycle

An active-package refresh reruns a consented, enabled `main.js`. The package watcher reports the package as a whole, so editing any file in the active package can rerun the script, including an edit that leaves `main.js` unchanged. When the current application document has an active main-script include, withdrawing that theme's consent or selecting another theme, including `None`, forces a full reload of every connected application document. The reload clears the prior script's DOM changes, listeners, timers, globals, and other document-lifetime effects before applying the confirmed state. Selecting another theme while no main-script include is active replaces theme resources in place. Disconnecting or rerunning the script during an active-package refresh cannot undo effects from an earlier execution. The [delivery reset contract](../arch/themes/delivery.md#^theme-delivery-script-reset) defines the installed-surface bookkeeping. ^theme-javascript-lifecycle

## Discovering and selecting themes

When serving starts, Television scans the folders directly inside the themes directory. It ignores every folder whose name begins with `.`: the folder is not listed, reported as invalid, or available for selection. The settings popover lists `None` plus every valid discovered theme. It also shows each invalid discovered theme folder with a readable validation error; an invalid theme cannot be selected. ^themes-hidden-directories

The settings popover has a refresh action. Refresh scans the directory again, replaces the displayed result when the scan completes, and makes newly added or repaired themes available. Registry results for an added folder or a changed manifest do not appear until refresh or the next serving boot.

The active package is live independently of registry scans. Creating, editing, renaming, or deleting any file anywhere in its folder tree refreshes the theme in connected clients without a registry refresh, whether or not that file is currently served or referenced. ^theme-active-package-live-update

If the active package folder disappears while the server is running, Television keeps its exact theme ID selected and removes its CSS from connected clients. Sandboxed effects reset and remain absent while their package entries are unavailable, while effects that `main.js` already applied can remain in a live application document. Television watches for the same folder to return, then reapplies the CSS, starts fresh declared sandbox surfaces, and reruns consented main JavaScript without a registry refresh or another selection. An explicit refresh or a serving boot while the package is unavailable applies the ordinary invalid-theme fallback and persists the null theme; restoring the folder after that fallback does not reselect it. Empty route behavior is owned by [theme delivery](../arch/themes/delivery.md#^theme-delivery-script-route). ^theme-active-package-recovery

A failed scan leaves Television running and displays the failure. A failed selection leaves the control on the server-confirmed selection and displays the write error. An open settings popover updates when another connected client or `tv set-theme` changes the selection.

If a boot or refresh finds that the selected theme is invalid, Television selects the null theme and persists that result. This fallback never selects the default theme, Clouds, and does not modify the theme folder. A discovered folder that has `theme.css` but no manifest therefore remains in place and appears as invalid; on a later serving boot, a bundled theme ID is first subject to [bundled-theme handling](../arch/themes/bundled-installation.md#serving-boot-installation). Repairing the folder later does not select it again automatically.

## Bundled themes

Television ships the installed themes identified by [the bundled theme inventory](../ui/themes/bundled.yml). Together with `None`, these are the theme choices on a fresh installation. Clouds is the default theme. This set first ships in [Television 1.3](./versioning.md#^pv-themes-release); each theme package retains its own independent package version. [Bundled-theme installation](../arch/themes/bundled-installation.md#bundled-packages-and-versions) defines each theme's minimum installed version.

On a serving boot, Television installs an absent bundled theme only if it has never handled that theme ID for this home. Handling means installing bundled content or recognizing existing content that Television keeps. After an ID has been handled, an absent theme remains absent as a user deletion. When something exists at that theme ID, Television replaces it if it is not a valid theme with a valid Semantic Version, or if it is a valid versioned theme whose version is below the minimum. It keeps a valid versioned theme unchanged when its version meets or exceeds the minimum, even when Television ships a newer version or did not install that copy. ^themes-bundled-minimums

Before replacing existing content at a bundled theme ID, Television copies it to a hidden timestamped backup beside it. Only then does it copy in the bundled theme, replacing user edits and extra files. After a backup or replacement failure or interruption, the theme destination contains either the prior content or the complete bundled package, and a later boot applies the same rules again. The theme ID does not change, so a selected theme remains selected and its existing main-JavaScript consent still applies. [Bundled-theme installation](../arch/themes/bundled-installation.md#serving-boot-installation) owns the backup name and installation details.

Removing a theme from the bundled set leaves existing installed copies available as user-owned packages.

For each home, Television decides once whether to select Clouds as the default theme. It selects Clouds when the stored theme is unset and the installed Clouds package is valid. The default-theme decision preserves every non-null stored theme. After the decision completes, selecting the null theme is an ordinary persisted choice and remains selected across later boots. The decision remains pending until Television has handled Clouds.

## Appearance preference

Each Television server stores one appearance preference shared by all connected clients:

- `Adapt to system` follows the operating system when the active theme follows the preference;
- `Light` selects light when the active theme follows the preference;
- `Dark` selects dark when the active theme follows the preference.

The active theme determines how that preference reaches the screen. An *adaptive theme* supports light and dark and follows the stored preference. A *fixed theme* declares only light or only dark and makes that value the *effective appearance* wherever the theme is active, regardless of the stored preference. The null theme follows the preference. Selecting a fixed theme never rewrites the preference, so its current value applies again when an adaptive theme or the null theme is selected. ^theme-effective-appearance

The preference persists across browser, desktop, and server restarts. A browser uses its last server-confirmed appearance input during first paint, then resolves appearance from the connected server's confirmed display state when it arrives. Confirmed server state wins if the cached input differs.

An effective appearance change updates the application and Television-managed artifact documents in place as their appearance inputs change. Live canonical versions respond through their appearance mappings; frozen v1 remains fixed light. The application replaces each enabled theme frame so its host and new document use the effective application appearance and its script runs again. The change does not reload app or artifact documents, replace editor contents, rerun the main theme script, or refresh theme stylesheets. Theme changes reload local authored HTML and Television's built-in artifact error documents; the markdown editor refreshes its canonical stylesheet without replacing its editor or contents. An application document reloads only under the main-script reset rule above. Third-party URL artifacts stay loaded after both kinds of change.

Changing the stored preference while a fixed theme is active updates that setting but does not change presentation. The application root, foundation mode values, browser artifacts where the embedding scheme propagates, Electron webviews and native surfaces, and theme script frames all keep the theme's fixed effective appearance. Theme selection can still refresh theme resources under its ordinary lifecycle.

In Chrome and Firefox, an iframe's used color scheme controls the light or dark preference seen inside it. This carries the application's effective appearance into artifact iframes. Safari does not propagate that explicit override: an iframe continues to follow the device when the effective appearance differs from it. Theme frames do not depend on that propagation because each replacement document receives the application's effective appearance directly. Electron applies the application's appearance input to the whole application, including artifact webviews, native menus, and dialogs.

## Settings access

The navbar provides a settings control immediately after the skill picker. Its popover contains the theme and appearance choices, per-theme main-page JavaScript consent when the active theme declares it, theme refresh, validation errors, and write failures. The appearance choices remain available under a fixed theme: changing one updates the stored preference even though the visible appearance stays fixed. Sandboxed frame declarations require no consent control. The popover closes when the user clicks elsewhere or presses Escape. Exact content, markup, interaction, and styling belong to the settings UI spec.

## Scope

Theme packaging, validation, selection, and delivery do not provide user controls to install, update, edit, or delete theme packages.

Light/dark switching does not by itself supply finished dark palettes for the redesigned app chrome or bundled themes. Until finished dark palettes exist for both surfaces, appearance changes may affect only browser-native controls there. Television must not ship the appearance feature as complete while those surfaces respond only through browser-native controls.

## Testing

Acceptance of theme discovery and selection must use the real Settings controls against a running Television server over HTTP and websocket connections. Valid and invalid theme folders and Television homes must be real filesystem fixtures. Selection acceptance must use a second connected client and must cover Chromium and Firefox.

Acceptance of v1 compatibility must load a committed old-style v1 document and a live-v2 control document in a real browser against a running production server with a loud unscoped theme. The v1 document must request no theme and keep its fixed light canonical styling, while the v2 control must request and render the theme.

Desktop theme persistence must be accepted in the real Electron app connected to a running server.

Active-package live-update acceptance must use a real browser against a running Television server and a real active package whose entry stylesheet imports a nested stylesheet. With the entry bytes unchanged and no registry refresh, changing only the nested stylesheet must update computed presentation in the app and a live-canonical artifact. The same acceptance path must remove and restore the complete active package while the server keeps running, observe the foundation/canonical baselines and restored presentation, and confirm that the selected theme ID does not change.

Executable-theme acceptance uses one real-browser spine through production Settings, a running production server, a real active package, multiple connected application documents, and an artifact document. That shared path composes main consent and reset with both sandboxed surfaces, real input in the application and bridge-capable artifact, preserved clicks, browser top-layer controls, package refresh, and a built-server restart. A corresponding real-Electron spine covers main consent, cross-client reset and execution, creation and replacement of both sandboxed frames, and pointer input in an ordinary artifact document.

Appearance acceptance must exercise `Adapt to system`, `Light`, and `Dark` with one adaptive and one fixed installed theme in a real browser and the real Electron app. It must show that the fixed theme controls the application, a Television-managed artifact, a third-party URL artifact, Electron-native surfaces, and both theme script frames while preference changes still persist; selecting the adaptive theme then applies the latest preference. With both sandboxed frame surfaces enabled, the browser path must show that an effective appearance change replaces their documents, reruns their scripts with the new `data-theme`, and leaves them transparent over the application in dark appearance. The browser path must cross a built-server restart.

Bundled-theme acceptance must start a built Television server against real temporary homes and the packaged Clouds folder, covering both first installation and an upgrade boot.

Do not add tests for theme folders named `none` or `default`; the product promises only that such a folder does not crash Television.
