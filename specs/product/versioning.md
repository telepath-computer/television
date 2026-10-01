*How Television names release lines, carries exact Semantic Versions unchanged, and gives each desktop release the version of the Television release it is built from.*

# Product versioning

Television release identities are ordinary three-part Semantic Versions. Product prose may name a release line as **Television 1.3**; surfaces that identify an exact release use the complete version, such as `1.3.1`.

## What this owns

This spec owns Television's release numbering, release-line naming, exact-version use, and the user-facing promise that each desktop release carries the exact version of the Television release it is built from. It does not govern theme package versions, dependency versions, canonical artifact versions, stored-format versions, or other schema versions.

[Update architecture](../arch/updates/index.md) owns validation and comparison of release versions, build stamps, workspace synchronization, and publication mechanics. Product surfaces that name or identify a Television release follow the rules here.

## Release identity and numbering

A *Television release version* is a `major.minor.patch` numeric triple satisfying Semantic Versioning 2.0.0 syntax and ordering. ^pv-release-version

The major and minor components select the release line, and the patch component identifies an exact release within that line. ^pv-release-identity

## Release names and exact versions

Ordinary release language names a release line as **Television `major.minor`**, such as **Television 1.3**. This form is suitable for release headings, announcements, and prose about the release line. ^pv-release-name

When the exact installed, available, or reported release matters, Television uses the complete `major.minor.patch` version unchanged. Exact-version surfaces include **About Television**, update details, bug reports and diagnostics, the release-version portion of `tv --version`, and the `version` value in `tv status`. Package manifests and specifiers, theme metadata, canonical authored-version metadata, release-version build stamps, API and websocket fields, telemetry, comparisons, and stored version identifiers use the same triple. Code and authoring guidance pass an exact version through without translating it into another display format. ^pv-exact-version

The CLI may append its separately labeled developer-build commit annotation to `tv --version` under the [CLI version contract](./cli.md#^cli-developer-version). The annotation is build provenance, not part of the Television release version.

`tv status` copies the server's `/health` version when that field is available, so an exact release has the same release version at both boundaries. It does not include the CLI's developer-build commit annotation. An unstamped development server reports the update domain's `0.0.0` sentinel unchanged. A health response without the field leaves `version` absent from status. ^pv-machine-boundary

On macOS, Television supplies the exact package version as the About panel's application version and leaves the build-version field empty. The product has no independent build-number identity. Package managers and operating-system metadata inspectors expose the same package or bundle release version. ^pv-os-metadata-scope

## Server and desktop release

Each Television release publishes the `@telepath-computer/television` CLI/server package under its exact release version. The server, its served interface, and every workspace package built for that release derive from that one version.

A *desktop release* is a build of the desktop app that Television releases to users. Each desktop release is built from one Television release and carries that release's exact version. Television releases the desktop app only when a desktop change is worth shipping, so some Television versions have no desktop release: desktop 1.4.0 may be followed by desktop 1.4.5 while servers receive every release in between. A desktop version therefore identifies the Television release, and so the code, that the app was built from. ^pv-desktop-release-version

## Television 1.3

The release line that introduces the bundled themes and appearance support described by [Themes and appearance](./themes-and-appearance.md) is **Television 1.3**. Its release identity for this release is `1.3.1`. ^pv-themes-release

## Testing

Version acceptance reads the exact version independently from the actual built package manifest, invokes the built `tv` executable, and proves that the release-version portion of `tv --version` carries that value unchanged. Against a running server built from the same release, `tv status` must expose the same release version received through `/health`. The product CLI proof owns these process paths and the developer-build annotation cases; this proof shares them rather than invoking the executable again.

Release-identity acceptance must inspect the publishable CLI/server package and the desktop [upload directory](../arch/desktop/distribution.md#^desktop-dist-upload) built from the same release commit: the upload directory's generated manifest and its ToDesktop configuration's `buildVersion` must carry the CLI/server package's version. Repository source manifests alone do not establish the versions users receive. Desktop architecture must prove the exact value supplied to Electron and that no build number is supplied; the [real-Mac run](./desktop-app.md#Testing) remains the acceptance boundary for the native About panel.
