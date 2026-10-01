# Authoring Television themes

Read this document when creating, revising, or bringing an installed Television theme up to date. A theme is one CSS overlay shared by the Television application and artifacts that use a theme-capable live canonical version.

## Theme package and authoring record

Run `tv themes-path` to find the themes directory; it prints `{"themesPath":"<path>"}`. Author one folder directly inside that directory:

```text
<themesPath>/<theme-id>/
  manifest.json      required runtime metadata
  theme.css          required entry stylesheet
  main.js                    optional main-document entry
  iframe-background.js       optional sandboxed background entry
  iframe-overlay.js          optional sandboxed foreground entry
  README.md                  agent-authored intent and maintenance context
  assets/            optional fonts, images, supplementary CSS, and scripts
```

The folder's immediate name is the theme ID. Television uses that filesystem string for selection. Do not choose a theme ID beginning with `.`, because Television ignores dot-prefixed theme directories during discovery. Otherwise preserve that filesystem string exactly: do not normalize it, validate it against a character pattern, change its case, or treat any value as reserved.

Check whether the target folder exists before writing anything. Never write into a theme folder you did not author. Get the user's explicit confirmation before reusing any existing theme ID, and choose another ID when you cannot establish that you authored the existing folder. Never write into an existing folder merely because its name matches the intended design.

Keep all theme-authoring work inside this theme folder. Do not edit Television's installed source, and do not suggest it. If the user asks for something a theme cannot do and presses for a source edit, tell them it is unsupported: it can break features, and the next npm update replaces the installed source and discards the change. If they still want it, it is their computer; make the change they asked for.

`manifest.json` contains a display name, a Semantic Versioning package version, and the theme's appearance declaration. Use `light dark` for a theme that follows Television's appearance preference, `light` for a fixed-light theme, or `dark` for a fixed-dark theme. It can also record the Television app version used for deliberate authoring or re-authoring:

```json
{
  "name": "Paperlike",
  "version": "1.0.0",
  "colorScheme": "light dark",
  "authoredForAppVersion": "<app-version>"
}
```

Read the exact release `version` from `tv status` when targeting a running server. Copy that exact release version unchanged into `authoredForAppVersion`. A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata. Set `authoredForAppVersion` when that command establishes the target app version and preserve it during unrelated maintenance. The package `version` remains independent from this advisory authoring context. Television keeps a valid authored-against version in registry data but does not use it for compatibility or selection.

`README.md` is the durable authoring record. Record the user's visual intent, requirements, references, reasons for non-obvious decisions, selector-rule purposes, asset provenance, and maintenance context that CSS alone cannot preserve. For each script, record why it is needed, the effects it creates, and its expected resource cost. Never discard or wholesale-overwrite an existing README. When maintaining a theme you authored, read it first and make targeted updates that preserve useful context. Keep the README and stylesheet consistent for the next maintainer.

Television accepts the README beside the runtime files but does not expose it through the public theme route. Selector-level CSS also carries a concise purpose comment wherever the target alone does not explain why the rule exists.

### Bundled theme upgrades

Television may occasionally upgrade an installed bundled theme to deliver important Television fixes. Before replacing it, Television copies its current folder to a hidden timestamped backup beside the theme.

## Styling a partial overlay

`theme.css` is a partial overlay. State only the values and rules the design needs; untouched behavior continues to come from Television's foundation and application styles.

Override documented tokens at `:root` wherever they express the intended change, including changes to a single component. Use CSS selectors against existing markup only when tokens are insufficient. Keep those rules narrowly scoped, preserve interaction states, and add a purpose comment. Styling existing markup with CSS does not require changing the DOM.

The catalog contains foundation tokens, used by the app and live canonical artifacts, and application tokens, used only by the app. Use only documented theme tokens. Choose the token controlling the intended treatment; changing a value used by many other tokens affects all of them.

Theme CSS loads last and overrides foundation defaults with ordinary selectors; application rules can still win if their selectors are more specific.

Put cross-appearance statements at `:root`. A root statement applies in both appearances and beats foundation mode tables. Put appearance-specific differences under `[data-theme="light"]` and `[data-theme="dark"]`, after the theme's root statements, so equal-specificity mode statements win by source order. Only add mode-specific values when the design needs them.

### Start with the four semantic colors

Four tokens establish the basic readable scheme from which surfaces, controls and supporting copy take their colors:

- `--color-surface` — the main document and component ground;
- `--color-surface-muted` — the neighbouring ground used by the sidebar, code blocks and other quieter surfaces;
- `--color-text` — ordinary text and controls; and
- `--color-text-muted` — supporting text, labels and placeholders.

State all four together for each look the theme defines. A theme with Light and Dark variants puts one set under each mode selector. A fixed Dark-only or Light-only look puts one set at `:root`, uses no mode blocks, and declares the matching fixed value in the manifest's `colorScheme`. To customize only one appearance of an adaptive theme while leaving the other on foundation defaults, declare `light dark` and put one set under only that mode selector instead.

These four tokens are enough to replace the main surfaces and text, but they do not change every color in the interface. The following overrides are optional and keep their foundation defaults when omitted:

- Set `--accent` to change primary actions, selection and the focus ring. Otherwise they retain the default blue accent.
- Set `--app-wallpaper` at the app-scoped root to choose the application ground. Otherwise the wallpaper retains the foundation value rather than following `--color-surface` automatically.
- Set any of `--red`, `--orange`, `--yellow`, `--green`, `--cyan`, `--blue`, `--purple`, or `--pink` to change that color family. Each base color regenerates its complete scale, including status, data and tint uses that point to the scale.

### Token catalog

```css
{{INJECT_FOUNDATION_VOCABULARY}}
```

{{INJECT_APP_SHELL_REFERENCE}}

## Panels and surface edges

Popovers, menus, select option lists, dialogs, artifact frames and the sidebar divider consume `--panel-edge-highlight` (a complete gradient) and `--panel-edge-shadow` (a complete sharp shadow). Set both to `none` to disable the decoration. Broad shadows are independent: `--artifact-frame-shadow` defaults to `var(--shadow-xl)` and either accepts `none` without erasing the rim. `--panel-border` defaults to `none`; frame and sidebar borders inherit it and accept explicit overrides. Ordinary buttons, text fields, separators and keyboard focus retain their own borders and outlines.

## Interaction feedback

Where a control provides hover or pressed feedback, the change must be visible and its text or icon remain readable. Prefer increasing label contrast on filled controls when that gives visible feedback; otherwise use a readable direction that does. Transparent controls can reveal their shape with a wash. Appearance mode and text color alone do not determine the right direction.

Most control families derive active background from resting background. Ordinary and semantic filled controls move the resting color toward a light or dark pole chosen from its lightness. Wallpaper-overlay controls add a wash of their text color. Hover then mixes the resting and active colors using `--hover-mix`. A root-level theme override of a documented resting token keeps this automatic derivation unless the theme also supplies an active token. An explicit active background is used as supplied, including opacity; it is not tinted or flipped again. Active also styles expanded triggers; selection is separate.

Unselected tabs use the wallpaper-overlay treatment by default. For one coordinated treatment across tabs, ordinary navbar controls and the empty-stage message, set `--wallpaper-overlay-background` at the app-scoped root. Its active and hover states derive automatically, and tabs inherit the complete family. Set `--wallpaper-overlay-background-active` only when the derived active treatment needs an explicit replacement.

Use the tab tokens only when tabs must differ from the shared overlay treatment. In that case set both `--tab-background` and `--tab-background-active`; tab active defaults to the shared overlay active background and does not derive from a tab-specific resting background. Leave `--tab-background-hover` alone so Television computes hover between the two tab values. The same local-pair rule applies when a selector gives individual controls different colors: set resting and active tokens on that element because an active value inherited from an ancestor was derived there, before the local resting override. Do not replace the state selectors themselves. Set `--tab-background-selected` separately because selection is not an interaction state.

Complete-background tokens also accept gradients and images, which cannot be color-interpolated. Supply explicit hover and active backgrounds for those treatments.

## Image backgrounds

Themes may optionally include an image background. If included, follow the setup and readability guidance below.

### Adding an image

Put wallpaper images inside the theme package and reference them from the app-scoped root in `theme.css`:

```css
:root[data-television-document="app"] {
  --app-wallpaper-image: url(assets/day.jpg);
}

/* Optional: use a different image in dark appearance. */
:root[data-television-document="app"][data-theme="dark"] {
  --app-wallpaper-image: url(assets/night.jpg);
}
```

`--app-wallpaper-image` is a registered URL value: relative paths resolve against the declaring stylesheet. Use `none` to remove the image. The default wallpaper treatment centers and covers the available ground. Use `--app-wallpaper` for a complete background declaration when changing positioning, adding gradients or composing other layers.

### Readability over the image

Choose `--wallpaper-overlay-background` and `--wallpaper-overlay-text-color` together. Unselected tabs, ordinary navbar overlay controls and the empty-stage message share this treatment. Over a busy image, start with `--tint-surface-muted` or `--tint-surface` and `--color-text`. These fills use `--alpha-50`; add `--wallpaper-overlay-blur` separately if a frosted treatment helps. A dark translucent fill with light text can suit either appearance. Judge the visible result over the image: blur softens detail but does not ensure contrast. Increase the fill opacity or use a solid surface when necessary.

Check resting, hover, pressed, open-menu and selected states in both appearances, over bright and dark image regions and at different window sizes. Apply the [interaction feedback](#interaction-feedback) guidance over the actual backdrop. If the automatic feedback does not suit the image, set the complete active background, including opacity:

```css
:root[data-television-document="app"] {
  --wallpaper-overlay-background-active: oklch(27.9% 0.041 260.031 / 75%);
}
```

Hover follows this override automatically. Tabs inherit the overlay active background but derive hover from their own resting background. If setting an explicit `--wallpaper-overlay-background-hover`, also set `--tab-background-hover: var(--wallpaper-overlay-background-hover)` when tabs should share it. This is needed for gradient or image fills, where interpolation is unavailable. Keep keyboard focus visible. The empty-stage message uses only the resting treatment.

## Runtime and loading

Television publishes the active package at one stable `/theme/` path. Eligible package files are served byte for byte. Keep `@import` and `url(...)` references relative to `theme.css`; the browser resolves them beneath the stable active-package path. Do not construct a URL from the theme ID, and do not expect Television to rewrite CSS.

The application loads `/theme/theme.css` after its complete foundation and application surface. Artifacts that link a theme-capable live canonical version load the same entry after their complete canonical foundation. No Television-owned stylesheet content follows the active theme. Frozen canonical v1 remains its built, unthemed, light-only surface.

Saving any file in the active package tree uses the live-update path. The application and affected artifacts refresh: local HTML artifacts reload, the markdown editor preserves its editor and contents while refreshing canonical styling, built-in artifact error documents reload, and third-party URL artifacts remain loaded. This update fanout covers nested stylesheets, images, fonts, the manifest, the authoring README, and other package files whether or not the active stylesheet currently requests them. Television combines the registered manifest's `colorScheme` with the stored appearance preference. `light dark` follows the preference; `light` or `dark` fixes presentation to that value while preserving preference changes for a later adaptive theme or `None`. An effective appearance change updates app and artifact document state without reloading those documents, the entry stylesheet, or the main script. It recreates each enabled theme frame and reruns its entry script. A stored preference change under a fixed theme changes no presentation.

Registry refresh publishes package discovery and manifest metadata. This includes a changed `colorScheme`. Use it after adding or repairing a package or changing its manifest; `tv set-theme <theme-id>` performs that refresh before selecting an installed ID. Saving a manifest in the active package also follows the live-update path, but its registry record keeps the last scanned metadata until refresh or the next serving boot.

If the active package folder temporarily disappears, Television keeps its exact theme ID selected and shows foundation and canonical styling while watching for the same path. Restoring the folder reapplies the package without a registry refresh. Refreshing the registry while the folder is absent selects `None`, and restoring the folder after that does not select it again.

## Theme effects and scripts

Theme effects are optional visual additions, such as textures, tint overlays, or animated backgrounds. Use them when the requested design calls for them, following the token-first approach above:

1. Prefer CSS. The permanent `#foreground-overlay` spans the application viewport above the interface, accepts no pointer input, and is the preferred surface for tint, `backdrop-filter`, translucent imagery, texture, and scanline effects. Ordinary menus and popovers sit beneath it; native modal dialogs remain above it.
2. Use JavaScript in a sandboxed frame when CSS cannot produce the effect and application DOM access is unnecessary, for example for an animation driven by host-supplied pointer information. Put effects behind the interface in `iframe-background.js` or above the interface and CSS foreground in `iframe-overlay.js`.
3. Use main-page JavaScript only when the effect requires access to the main application document.

The layers, from back to front, are `#theme-iframe-background` (z-index `0`), `#app` (`1`), `#foreground-overlay` (`2147483646`), and `#theme-iframe-overlay` (`2147483647`). Theme CSS may set opacity, filters and other presentation on the three effect surfaces. Their fixed viewport positioning, protected stacking and `pointer-events: none` keep effects separate from application interaction. Television keeps each frame element's `color-scheme` and its document's declared scheme matched to the effective `data-theme`; that match is what keeps the frame transparent. Read `data-theme` from the frame document's root once at startup. Appearance changes recreate the frames and rerun their scripts, so scripts need no appearance listener. Never change `color-scheme` on the frame document's root: a mismatch with the frame element forces the frame opaque. Theme CSS cannot cross into frame documents.

### Entry declarations

Each JavaScript surface has an independent manifest declaration and matching root entry:

| Manifest declaration | Root entry | Runtime |
| --- | --- | --- |
| `"enableMainJS": true` | `main.js` | Main application document after exact-ID user consent |
| `"enableIframeBackgroundJS": true` | `iframe-background.js` | Sandboxed frame behind the application |
| `"enableIframeOverlayJS": true` | `iframe-overlay.js` | Sandboxed frame above the application and CSS foreground |

For example, a package using all three entries declares:

```json
{
  "name": "Paperlike",
  "version": "1.0.0",
  "colorScheme": "light dark",
  "authoredForAppVersion": "<app-version>",
  "enableMainJS": true,
  "enableIframeBackgroundJS": true,
  "enableIframeOverlayJS": true
}
```

Each declaration is optional and must be a boolean when present. A present declaration, including `false`, requires its matching readable root file; only `true` enables execution. An entry without its declaration does not execute. The reserved `/theme/main.js`, `/theme/iframe-background.js`, and `/theme/iframe-overlay.js` URLs return a successful empty JavaScript response when their manifest or consent gates are closed, or the active package or entry is unavailable. Other script files are ordinary package assets. Television does not parse or validate JavaScript.

The declarations follow the server's registered manifest snapshot. Editing a declaration does not change its delivery gate until the theme registry refreshes. Saving any package file still triggers the active-package live-update path and uses the registered manifest snapshot.

All three entries run as classic scripts in browser and desktop application documents and never run in artifacts. During top-level execution, capture `document.currentScript.src` and resolve package assets relative to that URL. Ordinary document-relative URLs resolve against the entry's document.

### Sandboxed frames and pointer information

Iframe entries execute automatically without main-page consent. Each frame uses exactly `sandbox="allow-scripts"`, which gives its document an opaque origin. The script can draw and animate inside that document but cannot access the application DOM. The frames are inert, absent from sequential focus, and receive no direct pointer or keyboard input; pointer input continues to the application beneath them.

The host sends application pointer transitions and supported artifact pointer notifications to both current frames through `window` message events. Messages are not queued or replayed before a frame installs its listener. Accept messages only when `event.source === parent` and `data.type` is one of these closed names:

- `television-theme-pointer-move`
- `television-theme-pointer-down`
- `television-theme-pointer-up`
- `television-theme-pointer-cancel`
- `television-theme-pointer-click`

Every message contains only `type`, `clientX`, `clientY`, `button`, and `buttons`:

```js
{
  type,
  clientX,
  clientY,
  button,
  buttons
}
```

`clientX` and `clientY` are application-viewport CSS pixels. `buttons` is the standard post-transition bitmask. Move carries `button: -1` and the current buttons; down and up carry the changed button and the post-transition bitmask; click carries the clicked button and `buttons: 0`; cancel carries `button: -1, buttons: 0`. The host's opaque recipient requires `"*"` as the destination origin. This wildcard does not create a reverse command channel: Television ignores messages sent from a theme frame.

Keep each frame transparent wherever the application should remain visible. Destroying a frame ends its isolated runtime: the frame's removal ends its document, listeners, timers, and effects without reloading the application.

### Main-page trust boundary and lifecycle

A registered `enableMainJS: true` makes the root `main.js` eligible, and execution additionally requires the active theme's exact ID in the server's persisted consent set. Selecting or activating a theme does not grant consent. Before requesting consent, inspect and explain `main.js` and the effects it creates, then ask the user to grant consent in Settings. An authoring agent does not grant consent on the user's behalf. Settings shows the main-page JavaScript switch when the registered active theme declares `enableMainJS: true`. The user grants or withdraws consent there.

Consent is an explicit trust decision. Television loads eligible `main.js` as a classic script in each connected browser and desktop application document. It has ordinary access to that page's DOM, globals, browser storage, and network APIs. Electron grants no Node.js integration beyond capabilities the application renderer already exposes. Television's elements, globals, internal state, and other implementation details are not a stable JavaScript theme API and can change between releases. Consent persists for the exact theme ID until the user opts out, including while another theme is selected.

Keep main-page customization self-contained. Own top-level DOM rather than mutating Television-owned elements, and keep visual additions noninteractive. Excessive CPU or GPU use in any executable surface is a usability defect.

Every active-package refresh reruns an enabled and consented main script and destroys and recreates each enabled iframe, including refreshes caused by an unrelated package file. Main scripts therefore use repeat-safe ownership that recognizes and reuses or replaces their nodes, listeners, and timers. Frame replacement supplies cleanup for iframe effects. Consent-only changes preserve the frames unless the application reloads. Appearance changes recreate each enabled iframe and rerun its script; disconnect removes them. An active-package refresh, appearance change, or disconnect does not reload the application document, so successful main-page effects can remain until that document reloads.

When the main-script include is installed, opting out or selecting another theme or `None` automatically reloads the application document. The fresh document clears the script's DOM additions, listeners, timers, globals, and other document-lifetime effects before applying confirmed destination state. Persistent storage writes and completed network requests remain outside this reset boundary.

A load failure, syntax error, or uncaught exception in an iframe stays inside that frame. The same failure in `main.js` does not throw through Television's bundled application module, although successful main-page changes made before or around an error can still break the product.

## Appearance

Television combines the manifest's required `colorScheme` with the server-wide appearance preference. `light dark` follows that preference. `light` and `dark` fix the effective appearance to the declared value without rewriting the preference. Television dynamically maintains the resulting `data-theme="light"` or `data-theme="dark"` on the application root. Television-managed artifact documents install the same resolver with fixed `system`: a browser artifact resolves from the iframe's inherited scheme, while an Electron artifact resolves from Electron's native application preference. Each generated theme-frame document starts with the application's effective value and is recreated when that value changes.

Hinge all appearance-dependent theme styling on the root attribute. Do not use `light-dark()` or `prefers-color-scheme`; those mechanisms can follow browser or device state instead of Television's root marker. The foundation supplies Television's zero-specificity `color-scheme` value in every theme-capable app and artifact document, matching native controls and embedded contexts to `data-theme`. Theme CSS never declares `color-scheme`; the manifest is the theme's one appearance declaration.

A fixed theme puts its semantic colors and other token statements at `:root`, uses no mode blocks, and declares the matching `light` or `dark` value in its manifest. An adaptive theme declares `light dark`, states shared choices at `:root`, then puts only intended differences under `[data-theme="light"]` and `[data-theme="dark"]` after those shared statements. It can customize one mode and leave the other on foundation defaults.

Inspect light and dark effective appearance for an adaptive theme. For a fixed theme, inspect its one effective appearance under both a matching and an opposing stored preference, confirming that the presentation stays fixed. Mode-dependent foundation values that the theme does not override—including border opacity, active-state tint strength, and the four shadow tokens—follow the effective root marker.

## Theme selection

The user can choose a theme in the Settings UI. Agents activate one with `tv set-theme <theme-id>`, substituting the exact installed ID. Any capitalization of `none` selects no theme, which user-facing output labels `None`.

A successful command prints one of these transitions:

```text
Active theme changed from '<previous>' to '<new>'.
Active theme unchanged: '<selection>'.
Active theme: '<new>'.
```

The first two forms report the opening selection when it was available. The third confirms the new selection when the opening read was unavailable. Activation does not need a separate preliminary selection read; preserve prior-selection context when the command provides it.

## Authoring workflow

1. Gather the user's visual intent, references, palette and typography direction, and the application or artifact surfaces that matter.
2. Run `tv themes-path` to locate the themes directory and `tv status` to establish the target app version. When the installation is not in the default home, give these and every later `tv` command the same `--home`. A user who keeps the default home elsewhere writes its path into `~/.tv-home`, and then commands need no `--home`.
3. Choose an exact theme ID, inspect the target path, and apply the existing-folder safeguards above before writing.
4. Choose the least invasive visual surface, then write the manifest with its required `colorScheme`, entry stylesheet, README, any justified JavaScript entries, and relative assets as one package. Add purpose comments to narrow selector rules.
5. Activate the package with `tv set-theme <theme-id>`. Correct any manifest error the command reports.
6. When the package declares `main.js`, inspect and explain it, then ask the user to grant consent in Settings. For iframe entries, account for the sandbox, pointer-message contract, and frame replacement lifecycle.
7. Iterate on the files in its watched package tree. Refresh the theme registry to publish manifest changes.
8. Verify the application shell and one artifact using a theme-capable live canonical version. For an adaptive theme, inspect light and dark effective appearance. For a fixed theme, inspect matching and opposing stored preferences and confirm that presentation stays fixed. Check readability, asset loading, native controls, intended cross-document reach, and document continuity.
9. Leave the README, comments, stylesheet, script, manifest, and assets consistent for the next maintainer.

Visual verification can include screenshots when the environment can render both documents headlessly and interpret the results. Offer the user an optional review of the shell and one live-canonical artifact (four captures): light and dark effective appearance for an adaptive theme, or matching and opposing stored preferences for a fixed theme. Explain that it takes additional time. Wait for the user's consent before capturing them. Write captures only to a temporary location, review them, and delete every temporary capture after review. If the environment lacks either capability or the user declines, ask the user to inspect the same states.

## Clouds as a worked example

The installed Clouds package at `<themesPath>/clouds/` is a locally available structural example of package shape, relative assets, application-only scoping, and purpose-specific shell rules. Its version may meet or exceed Television's minimum, and its files may contain user edits, so read it as a local example rather than a pristine template. Use the vocabulary and reference in this document as the authority when adapting the example.
