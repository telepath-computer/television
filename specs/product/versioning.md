*How Television names release lines, carries exact Semantic Versions unchanged, and gives each desktop release the version of the Television release it is built from.*

# Product versioning

Television release identities are ordinary three-part Semantic Versions. Prose may name a release line, such as **Television 1.3**; surfaces that identify an exact release use the complete version, such as `1.3.1`.

This spec covers Television's own release versions only. It does not govern theme package versions, dependency versions, canonical artifact versions, stored-format versions or other schema versions. Validation and comparison of release versions, build stamps, workspace synchronization and publication are [update architecture](../arch/updates/index.md)'s.

## Release identity and numbering

A *Television release version* is a `major.minor.patch` numeric triple satisfying Semantic Versioning 2.0.0 syntax and ordering. ^pv-release-version

The major and minor components select the release line, and the patch component identifies an exact release within that line. ^pv-release-identity

## Release names and exact versions

Ordinary release language names a release line as **Television `major.minor`**, such as **Television 1.3**. This form suits release headings, announcements and prose about the release line. ^pv-release-name

When the exact installed, available or reported release matters, Television uses the complete `major.minor.patch` version unchanged. Exact-version surfaces include **About Television**, update details, bug reports and diagnostics, the release-version portion of `tv --version`, and the `version` value in `tv status`. Package manifests and specifiers, theme metadata, canonical authored-version metadata, release-version build stamps, API and websocket fields, telemetry, comparisons and stored version identifiers use the same triple. Code and authoring guidance pass an exact version through without translating it into another display format. ^pv-exact-version

The developer-build commit annotation that `tv --version` may append ([CLI version contract](./cli.md#^cli-developer-version)) is build provenance, not part of the Television release version.

`tv status` reports the server's `/health` version unchanged, as the [CLI](./cli.md#Server lifecycle commands) describes. ^pv-machine-boundary

On macOS, Television supplies the exact package version as the About panel's application version and leaves the build-version field empty. The product has no independent build-number identity. Package managers and operating-system metadata inspectors expose the same package or bundle release version. ^pv-os-metadata-scope

## Server and desktop release

Each Television release publishes the `@telepath-computer/television` CLI/server package under its exact release version. The server, its served interface and every workspace package built for that release derive from that one version.

A *desktop release* is a build of the desktop app that Television releases to users. Each desktop release is built from one Television release and carries that release's exact version. Television releases the desktop app only when a desktop change is worth shipping, so some Television versions have no desktop release: desktop 1.4.0 may be followed by desktop 1.4.5 while servers receive every release in between. A desktop version therefore identifies the Television release, and so the code, that the app was built from. ^pv-desktop-release-version

## Television 1.3

The release line that introduces the bundled themes and appearance support described by [Themes and appearance](./themes-and-appearance.md) is **Television 1.3**. Its release identity is `1.3.1`. ^pv-themes-release

## Inputs to proof derivation that the spec does not otherwise show

### Facts a test author would likely miss

- Repository source manifests alone do not establish the versions users receive. Release-identity acceptance inspects the publishable CLI/server package and the desktop [upload directory](../arch/desktop/distribution.md#^desktop-dist-upload) built from the same release commit: the upload directory's generated manifest and its ToDesktop configuration's `buildVersion` carry the CLI/server package's version.

### Coverage owned by another spec

- The [product CLI](./cli.md#Command model, help, version, and recovery text) proof owns the process paths that read the exact version from the built package manifest, invoke the built `tv` executable and compare `tv --version` and `tv status`, including the developer-build annotation cases. This spec's proof shares them rather than invoking the executable again.
- Desktop architecture proves the exact value supplied to Electron and that no build number is supplied; the [real-Mac run](./desktop-app.md#Testing) is the acceptance boundary for the native About panel.
