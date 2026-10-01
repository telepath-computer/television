*Theme architecture: installed package validation, the in-memory registry, shared display and main-JavaScript-consent contracts, control APIs, events, and privacy-preserving telemetry.*

**Status:** active-package observation is implemented.

# Theme architecture

A Television server reads visual-theme packages from its data directory and keeps one validated list that every client can use. This spec defines the package and registry data, how selection is stored and announced, and the server and shared-client contracts around them.

## What this owns

This spec owns installed theme manifests, package validation, registry scans and lifetime, active-package observation, theme, appearance, and per-theme main-JavaScript-consent fields in display state, theme control routes and shared-client methods, selection rules, and the theme count sent to telemetry. [The product spec](../../product/themes-and-appearance.md) owns what people observe. [The Settings UI spec](../../ui/app/settings/index.md) owns the consent control's content and presentation. [Theme authoring](./authoring.md) owns the theming guidance bundled for agents. Bundled-package installation has its own architecture spec; [theme delivery](./delivery.md) owns stylesheet delivery and all three executable-script runtimes. The [appearance explainer](../explainer-appearance.md) follows these contracts through every rendering context.

## Shared contracts

The shared package exports these wire types:

```ts
type ThemeColorScheme = "light" | "dark" | "light dark";

interface ThemeManifest {
  name: string;
  version: string;
  colorScheme: ThemeColorScheme;
  authoredForAppVersion?: string;
  enableMainJS?: boolean;
  enableIframeOverlayJS?: boolean;
  enableIframeBackgroundJS?: boolean;
}

interface InstalledTheme extends ThemeManifest {
  id: string;
}

interface ThemeValidationError {
  folder: string | null;
  error: string;
}

interface ThemeRegistrySnapshot {
  themes: InstalledTheme[];
  errors: ThemeValidationError[];
}

type AppearanceMode = "system" | "light" | "dark";
```

`DisplayState` contains required `activeThemeName: string | null`, required `activeThemeColorScheme: ThemeColorScheme | null`, required `appearanceMode: AppearanceMode`, and required `themeJavaScriptConsentIds: string[]`. `DisplayPatch` accepts the theme name, appearance mode, and consent fields, but not the derived color scheme; its consent array replaces the complete consent set. `null` selects the null theme: no installed-theme overlay.

The shared `theme-changed` event carries the current selection, its derived color scheme, and the consent set:

```ts
{
  type: "theme-changed";
  themeName: string | null;
  activeThemeColorScheme: ThemeColorScheme | null;
  themeJavaScriptConsentIds: string[];
}
```

Every emitted array is a fresh value.

## Installed package contract

An installed package lives in the `themes/` directory of the [Television home](../../product/cli.md#^cli-home) the server serves, and has this shape:

```text
<home>/themes/<theme-id>/
  manifest.json
  theme.css                required stylesheet entry
  main.js                  main-page entry (required when enableMainJS is present)
  iframe-overlay.js        foreground-frame entry (required when enableIframeOverlayJS is present)
  iframe-background.js     background-frame entry (required when enableIframeBackgroundJS is present)
  README.md                agent-authored context (when present)
  ... optional static assets
```

The immediate directory name is the theme ID. For every directory included in the [registry scan](#registry-scan), the scanner preserves that string exactly as the filesystem reports it and adds it as `InstalledTheme.id`; it performs no case conversion, normalization, reserved-value check, or other character-pattern validation. Every lookup and identity comparison uses exact string equality. Lowercase ASCII letters, digits, and dashes are a convention for Television's bundled theme IDs, not an installed-package rule.

The runtime manifest contains required `name`, `version`, and `colorScheme`, plus optional `authoredForAppVersion`, `enableMainJS`, `enableIframeOverlayJS`, and `enableIframeBackgroundJS`. `name` is a non-empty display string. `version` is a valid Semantic Versioning 2.0.0 package version. A valid Semantic Versioning 2.0.0 `authoredForAppVersion` names the Television app version the theme was authored or re-rendered against and is returned in the validated manifest. An absent, non-string, or unparseable authored-against value is omitted from that manifest and never invalidates the package. The field is advisory: the server never compares it with the running app version.

The manifest reader trims `colorScheme`, lowercases it, and splits it on whitespace. The resulting set of words must contain `light`, `dark`, or both, with no other word; it resolves those cases to the canonical value `light`, `dark`, or `light dark`, respectively. A missing or non-string field, an empty value, or any unrecognized word is a validation error whose message names `colorScheme` and the three accepted values. The validated `ThemeManifest`, registry records, shared-client protocol, and runtime consumers carry only `ThemeColorScheme`, never the raw string. ^themes-color-scheme

Each recognized JavaScript flag, when present, must be a JSON boolean, is returned unchanged in the validated manifest, and requires its matching entry to be a readable regular file at the package root. `true` registers that entry as enabled for [theme delivery](./delivery.md#^theme-delivery-script-route), and `false` keeps it disabled. `enableMainJS` governs `main.js`, `enableIframeOverlayJS` governs `iframe-overlay.js`, and `enableIframeBackgroundJS` governs `iframe-background.js`. The validator does not parse, compile, or execute the files, so invalid JavaScript does not invalidate the package. An entry file without its matching manifest property is ignored by validation and the package remains valid. Any non-boolean recognized flag is a validation error. ^themes-javascript-package

Unknown JSON properties are accepted but are omitted from the validated manifest. `theme.css` is always a readable regular file at the package root.

Authoring agents create and maintain `README.md` with the theme context governed by [the authoring spec](./authoring.md#the-authored-theme-folder). The file is permitted beside the runtime files but is not runtime metadata: package validation ignores it, registry records omit it, and [theme delivery](./delivery.md#active-theme-route) excludes it from the public package route.

One package validator owns these rules. Runtime directory scans and server build validation both call it, so a package cannot pass one path and fail the other. The build fails when any bundled candidate is invalid; [bundled installation](./bundled-installation.md#bundled-packages-and-versions) owns which bundled source folders must exist and their minimum versions.

Theme CSS refers to files within its package with relative `url(...)` and `@import` paths. The package contract permits data URLs and external URLs as ordinary CSS references.

## Registry scan

A *theme registry* is the server's last complete `ThemeRegistrySnapshot`. A scan reads folders directly inside `<home>/themes/`, except those whose names begin with `.`. Dot-prefixed folders, including bundled-theme backups, are ignored without producing a theme or validation error. Ordinary files and symbolic links at that level are also not candidates. Each candidate produces either one validated `InstalledTheme` record or one `ThemeValidationError`. When a folder has several defects, its one error string names all defects found. ^themes-registry-candidates

Valid themes sort by `name.localeCompare(other.name, "en")`, then by `id.localeCompare(other.id, "en")`. Folder errors sort by `folder.localeCompare(other.folder, "en")`. A failure to read the themes directory produces `{ themes: [], errors: [{ folder: null, error: ... }] }`. Directory and package errors contain no absolute filesystem path.

A serving store follows the [serving bootstrap sequence](../onboarding/installer.md#^bootstrap-sequence): the [bundled-theme installer](./bundled-installation.md) runs before this scan, display state becomes available afterward, and the one-time Clouds decision runs before ordinary invalid-theme fallback. It replaces the whole registry snapshot on each explicit refresh. The registry does not watch the themes directory: package discovery and manifest metadata changes become visible in its snapshot only on boot or refresh. Active-package observation is a separate lifecycle and never scans or replaces the registry. If refresh changes `colorScheme` or any JavaScript flag on the still-selected package, the store emits `theme-changed` with that same theme ID after installing the new snapshot. The event carries the new normalized `activeThemeColorScheme` so connected applications reconcile appearance, entry routes, and sandboxed frames under the new manifest state.

## Active-package observation

While a non-null theme is selected, the serving store watches the complete active package folder recursively. Every descendant file is relevant, without a filename, extension, public-route, or depth filter: creating, editing, renaming, or deleting `theme.css`, a nested import or static asset, `manifest.json`, `README.md`, or any other file schedules the active theme's debounced `theme-changed` event. Several notifications within one debounce window coalesce into one event. The event carries the same exact theme ID and does not alter the registry or display state. ^themes-active-package-watch

Active-package observation uses the shared server content-watcher contract in [reload and navigation](../artifact-frame/reload-navigation.md#^rn-shared-content-watcher), the same module that local path artifacts use. The selected package root enters recursive-folder mode. Selecting another theme closes the prior watcher and cancels its pending event before the next watcher starts; selecting the null theme and disposing the store likewise leave no active theme watcher or timer. A callback from a superseded target cannot emit for the current selection.

If the active package root disappears, the watcher schedules `theme-changed` for the still-selected theme ID, enters missing-root recovery, and polls for that exact path. [Theme delivery](./delivery.md#active-theme-route) supplies empty stylesheet and script entries and unavailable assets while the root is absent. Reappearance re-arms the recursive watch and schedules another `theme-changed`, so clients apply the restored package without a registry refresh. The selection and its registered color scheme remain unchanged throughout this live recovery. An explicit registry refresh or serving boot while the root is absent applies the ordinary invalid-theme fallback below and ends recovery by selecting the null theme.

A runtime watcher error while the root remains present is reported and closes that active watcher, matching path-artifact error handling. It does not change the registry or selected theme. Missing-root recovery is not treated as a runtime watcher error.

## Selection and display state

Theme selection consults the current registry. A non-null `activeThemeName` must exactly equal the `id` of a valid entry in that snapshot. A boot or refresh that leaves the active theme ID absent from the valid entries persists `activeThemeName: null` and emits the ordinary theme change. This invalid-theme fallback selects the null theme, never the default theme Clouds. A repaired package remains unselected until a client selects it.

The stored display record is unchanged: `activeThemeColorScheme` is response-derived and is never persisted or accepted in a display patch. For `GET /display` and `theme-changed`, it is `null` when `activeThemeName` is `null`; otherwise it is the normalized `colorScheme` of that exact entry in the current registry. Missing-root recovery retains the registry entry and therefore retains this value. Boot or refresh fallback completes before producing the display response or event, so an unavailable selection yields `activeThemeName: null` and `activeThemeColorScheme: null`. ^themes-active-color-scheme

The optional `themeJavaScriptConsentIds` array in `state/display.json` represents a set of exact theme IDs whose main-page JavaScript the user has consented to run. Sandboxed iframe entries do not consult this set. An absent field and an empty array both mean no consent. A present array contains unique non-empty strings; order has no meaning, comparisons use membership, and ID strings are never normalized. A display patch supplies the complete next set. Adding an ID grants consent; opting out removes that ID. Registry scans, package loss, manifest changes, and selecting another theme do not prune the set, so consent remains associated with the exact theme ID until an explicit opt-out. The server exposes the normalized set as a required array in every display response. This optional stored field requires no boot migration. ^themes-javascript-consent-state

The consent set authorizes only the active exact ID's main-page entry; sandboxed iframe entries do not consult it. The [public script route](./delivery.md#^theme-delivery-script-route) applies the separate manifest and consent gates, and [application theme JavaScript](./delivery.md#application-theme-javascript) specifies how confirmed display and registry state select resources.

The display record also stores `appearanceMode`; a new installation's record starts at `system`. A current record that lacks the field is migrated to `system` before strict display loading; [the display migration spec](../layout/migration.md#^mig-appearance-backfill) owns that ordered operation. Display responses and events carry the stored preference. The server validates and persists it but does not resolve `system` or generate appearance-specific CSS. Theme selection and manifest refresh never rewrite this preference. [Theme delivery](./delivery.md#shell-first-paint-and-confirmed-state) combines the confirmed `appearanceMode` and `activeThemeColorScheme`: `null` and `light dark` follow the preference, while `light` and `dark` supply that fixed value instead.

The server emits `theme-changed` when `activeThemeName` or JavaScript-consent membership changes, and every such event carries the current `activeThemeColorScheme` and complete consent set. Repeating the same selection and set membership emits nothing, including a patch that only reorders consent IDs. Active-package changes, package-root loss, package-root re-arm, and an active package's manifest declaration changing on registry refresh may also emit `theme-changed` with the same theme ID, current color scheme, and unchanged consent set. The server emits `appearance-changed` when `appearanceMode` changes; repeating the stored value emits nothing.

## Control API and shared client

Authenticated control routes expose the registry:

```text
GET  /themes
  -> 200 ThemeRegistrySnapshot

POST /themes/refresh
  -> 200 ThemeRegistrySnapshot
```

Refresh completes the scan and any active-theme fallback before responding. These control routes use the server's authenticated API CORS policy. Public stylesheet and asset delivery is a separate concern.

`TelevisionClient.themes.list()` calls `GET /themes`; `TelevisionClient.themes.refresh()` calls `POST /themes/refresh`. Display reads and patches use the shared fields above. The application service exposes `listThemes()`, `refreshThemes()`, `setActiveTheme()`, `setThemeJavaScriptConsent(themeId, enabled)`, and `setAppearanceMode()` for the settings surface. The consent method adds or removes the exact ID in the current confirmed set and patches the complete result. Registry methods return the completed snapshot without storing it as application state. Preference writes update no local value speculatively. When a failed display write may have reached the server—a statusless transport failure or a server error—the service refetches display state once before reporting the original failure, so its exposed value is the latest confirmed server result.

`tv set-theme <theme-id>` refreshes before selecting a theme ID, preserving the argument exactly for folder-error matching and the display patch. If that folder has a validation error, the command prints it; if no folder error matches, it reports that the theme was not found. Any case-insensitive spelling of the CLI token `none` writes `activeThemeName: null` without scanning and selects the null theme.

## Telemetry boundary

The telemetry classifier reads committed selection, appearance preference, the current validated registry, and exact-ID main-page consent. Its output is limited to the closed classifications defined by [telemetry property derivation](../telemetry/derivation.md#^theme-settings-derivation): theme state, four configured-use JavaScript booleans, and appearance preference. `theme_count` is the number of valid registry entries. Theme state is `none | <bundled-theme-id> | custom`; [the bundled theme inventory](../../ui/themes/bundled.yml) owns the ID enumeration. User-authored folder names, manifest names and IDs, validation messages, package versions, authored-against app versions, consent ID lists, script content, and absolute paths never enter serialized telemetry. ^themes-telemetry-boundary

Explicit selection changes and registry-refresh fallback supply distinct internal reasons to the telemetry hook. Consent changes and same-selection manifest refreshes affect the current snapshot without emitting a telemetry switch. The `theme-changed` domain event also serves rendering and may fire for these operations or package reloads; it is not the source of analytics switch counts. Startup publishes normalized current settings through boot telemetry. [Telemetry emitters](../telemetry/emitters.md#theme-and-appearance-snapshots) own publication and refresh timing.

## Testing

Manifest normalization and package validation are covered through the production validator over real package folders; no server or browser crossing is needed for that contract. The cases include each resolved `colorScheme`, whitespace, capitalization, reversed word order, a missing field, a non-string value, an empty value, and an unrecognized word.

Display-state and event coverage must cross a real serving store, `state/display.json`, the authenticated display protocol, and the server event stream. It confirms that `activeThemeColorScheme` is absent from the stored record and derived as the paired null, adaptive, or fixed value in display responses and theme events, including missing-root recovery and a registry refresh that changes the active declaration. The opening stored record omits the consent field, and the crossing includes a store restart.

Active-package observation coverage must cross a real serving store, the production shared content watcher, and real temporary package trees. It must change a nested file while leaving the entry stylesheet untouched, remove the complete active package root, restore that root at the same path, and observe the debounced `theme-changed` events and unchanged selected ID without invoking registry refresh. Separate target-selection coverage must establish that file artifacts and both recursive consumers—folder artifacts and active themes—use the same injected watcher handoff with the intended mode.

Runtime-error coverage may inject a watcher failure at the content-watcher boundary; that mock forfeits only native error generation to the shared watcher's contract coverage. It must establish reporting, failed-watcher cleanup, and suppression of stale callbacks without turning the error into registry or selection state.

