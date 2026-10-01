*Bundled theme installation: validated package assets, CLI path resolution, minimum-version installation and replacement with backup copies, and the one-time default-theme selection.*

# Bundled theme installation

Television releases carry installed-theme packages. On a serving boot, Television installs an absent theme only when its ID has not been handled and leaves it absent when the ID has been handled. It replaces existing content that does not meet the bundled-theme policy, backing it up first.

## What this owns

This spec owns runtime derivation of the bundled inventory, minimum-version installation rules, source tree, server and CLI distribution copies, bundled-asset locations and serving-store wiring, bundled-theme state file, package installation and replacement, backups and failure behavior, and initial-theme decision. [Theme architecture](./index.md) owns package validation and the installed-theme registry. [The app UI spec](../../ui/app/index.md) owns the app-document marker used by theme selectors. [The onboarding installer](../onboarding/installer.md#^bootstrap-sequence) owns the complete serving bootstrap order.

## Bundled packages and versions

Bundled packages use the installed-package contract from [theme architecture](./index.md#installed-package-contract):

```text
packages/server/assets/themes/<theme-id>/
  manifest.json
  theme.css
  THIRD-PARTY-NOTICES.txt  generated; present when the theme carries third-party material
  ... optional static assets
```

A theme that includes externally licensed material, such as a color scheme or an image, carries its attribution in its files and its folder under [licensing architecture](../licensing.md#^licensing-theme-records). The notices file is an ordinary package file: installation copies it with the rest of the folder.

[The bundled theme inventory](../../ui/themes/index.md) owns the IDs and minimum installed versions in [bundled.yml](../../ui/themes/bundled.yml). Build scripts consume those records to generate readonly `BUNDLED_THEMES` data, the derived `BUNDLED_THEME_IDS` list, and the `BundledThemeID` union. The generated module is committed for source execution; both the server asset build and standalone CLI build regenerate it before consuming it. Telemetry classification reads the derived IDs. The default-theme ID remains `clouds`, independently of inventory order. Installed versions and minimums use Semantic Versioning 2.0.0 precedence. ^bundled-theme-versions

Every bundled manifest declares its normalized [theme color scheme](./index.md#^themes-color-scheme). Aquarium, Clouds and Swiss declare `light dark`; Blueprint, CRT Phosphor, Nord and Tokyo Night declare `dark`. The bundled source package versions are Aquarium `1.0.2`, Blueprint and CRT Phosphor `1.0.0`, Clouds `2.1.0`, and Nord, Swiss, and Tokyo Night `1.1.1`. The inventory minimums are Aquarium `1.0.2`, Blueprint and CRT Phosphor `1.0.0`, Clouds `2.1.0`, and Nord, Swiss, and Tokyo Night `1.1.0`; under the replacement rule below, Television keeps valid installed copies at those minimums.

Bundled source directories conventionally use lowercase ASCII letters, digits, and dashes for theme IDs; installed-package validation does not impose that convention. Each package's `theme.css` is the byte-identical production copy of `styles.css` from the matching ID directory under `specs/ui/themes/`. The Clouds assets `wallpaper.webp` and `wallpaper-dark.webp` are byte-identical copies of the design assets at the same relative paths. Its stylesheet scopes wallpaper and app-chrome rules through the app-document selector defined by [theme delivery](./delivery.md#app-document-selector).

Before copying assets, the server build checks that the source tree contains exactly the theme IDs in the YAML inventory, every minimum and source package version is a valid Semantic Version, and every source package is valid and meets its minimum. It then copies the source tree byte-for-byte to `packages/server/dist/themes/`; the CLI build copies that tree byte-for-byte to `packages/cli/dist/themes/`.

A built CLI resolves `themes/` beside the real path of its executable. Source execution resolves `packages/server/assets/themes/`.

Foreground `tv serve` passes the resolved source directory to the production server. Persisted service arguments do not store an asset path: each service boot runs the packaged CLI, which resolves the assets beside its own executable.

## Installation state

Each [Television home](../../product/cli.md#^cli-home) may contain `<home>/state/bundled-themes.json`. Television writes this complete shape:

```ts
interface BundledThemeState {
  version: 2;
  installedThemeIDs: string[];
  initialThemeSelectionComplete: boolean;
}
```

`installedThemeIDs` contains unique exact theme IDs in ascending `en` locale order. A listed ID means Television previously installed bundled content at that ID or recognized existing content that it kept. The list does not record deletion events: when no destination exists for a listed ID, Television treats that absence as a user deletion. The list records no package version or provenance, so the minimum-version policy needs no state migration. IDs are stored without normalization or character-pattern validation. `initialThemeSelectionComplete` records that the data directory has made its one-time Clouds decision.

The state reader returns `ok` with that shape, `absent` when the file does not exist, or `invalid` for any other content. The writer serializes the complete state to a temporary file in the same directory and renames it over `bundled-themes.json`. It removes the temporary path after a failed write and leaves the prior state file intact. An absent file means no bundled theme ID has been handled and the initial decision is pending. Malformed JSON, a version other than 2, a non-string ID, a duplicate, an unsorted list, an invalid completion flag, or an unknown field makes the file invalid.

An invalid state file produces a warning and skips bundled-theme handling and initial selection for that boot. Television leaves the state file and installed themes untouched.

## Serving-boot installation

A serving store runs bundled-theme installation at step 6 of the [serving bootstrap sequence](../onboarding/installer.md#^bootstrap-sequence), immediately before the installed-theme registry scan. A token-only store does no bundled-theme work.

For each theme in the bundled inventory, Television first checks whether anything exists at that theme ID. If nothing exists and the ID has not been handled before, Television installs the bundled package. If the ID has been handled before, Television leaves it absent as a user deletion.

When something exists at the theme ID, one replacement rule applies: Television replaces it if it is not a valid theme with a valid Semantic Version, or if it is a valid versioned theme whose version is below the minimum. Television keeps a valid versioned theme unchanged when its version meets or exceeds the minimum, even when the bundled package is newer or Television did not install the existing theme. ^bundled-theme-replacement

Before replacing existing content at a bundled theme ID, Television copies it to an unused sibling named `.<theme-id>.backup.YYYY-MM-DD-HH-MM-SS`. It never overwrites or automatically deletes these backups, and the theme registry ignores backup folders under its [dot-directory rule](./index.md#^themes-registry-candidates). Only after the backup succeeds does Television copy in the complete bundled package. Television warns when it observes a backup or replacement failure. After a failure or interruption, the theme destination must contain either the prior content or the complete bundled package, and a later boot applies the same rules again. A failure for one theme does not stop bootstrap or handling of other themes. ^bundled-theme-backup

Replacement removes user edits and extra files from the installed theme; the backup keeps the prior content. After Television successfully installs, replaces, or keeps a theme, it adds the ID to the state file if needed. If saving the state file fails, the next boot applies the same rules again.

## Default-theme selection

After installation, registry scan, and display loading, a pending default-theme decision runs only when `clouds` is listed in `installedThemeIDs`. If a failure leaves `clouds` unhandled, the decision remains pending. A pre-existing sufficient Clouds package and a successfully installed or replaced package are handled alike.

When the stored active theme is `null` and the registry contains valid `clouds`, the server persists `activeThemeName: "clouds"`. A non-null active theme is preserved for this decision, including one that the registry will reject in the next bootstrap step. If Clouds is unavailable or invalid, the null value remains. The server then atomically writes `initialThemeSelectionComplete: true`.

The display write happens before the state write that records `initialThemeSelectionComplete: true`. A failure in either write stops boot. A retry sees either the original null value or the already-persisted non-null value and completes the pending decision. After completion, refresh and later boots never run the decision, so a later explicit null-theme selection remains an ordinary persisted choice. Ordinary invalid-theme fallback runs afterward; deleting an active handled Clouds package therefore falls back to the null theme without reinstalling or reselecting it. Invalid-theme fallback never selects the default theme.

## Testing

The filesystem contract tests use real temporary source and data-directory trees and the production serving store across installation, preservation, backup, replacement, and copy-failure paths. They do not replace any filesystem mechanism or serving-store dependency.
