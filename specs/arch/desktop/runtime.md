*The Electron runtime for development runs and tests: its exact version and declarations, installed-file validity on development and test hosts, how those hosts obtain it, and the recurring major-upgrade procedure.*

# Electron runtime

Development runs and the desktop tests start Electron from the `electron` npm package, which needs a platform-specific executable and supporting files in addition to its JavaScript. This spec defines exactly which Electron release Television uses, how development and test machines obtain those larger files, and what must be present before Television treats them as runnable.

## What this owns

This spec owns Electron's exact version and its repository declarations, the runtime mechanics on development and test hosts, the predicate for an installed runtime to be valid, how those hosts obtain the runtime, and the recurring Electron-major upgrade procedure. [The e2e harness](./e2e-harness.md) owns test-time setup. The app users install gets Electron from the ToDesktop build, which reads this spec's version ([distribution.md](./distribution.md#^desktop-dist-upload)).

An *Electron runtime* is the generated platform distribution under the installed `electron` package's `dist/` directory, together with `dist/version` and the package-root `path.txt` that identify its executable. A *valid Electron runtime* is one exact-version distribution satisfying the platform predicate below. The npm package alone is not a runtime.

An *absent Electron runtime* has no `path.txt`, no `dist/version`, and either no `dist/` directory or an empty one. Any other generated-runtime state that does not satisfy a valid platform layout is invalid rather than absent. ^desktop-runtime-absence

## Version

Television's Electron target is exactly **`43.7.6`**. The root development dependency and the desktop workspace's development dependency both declare that target without a range, and the ToDesktop build's generated manifest carries the same exact version, keeping development runs, tests, and the installed app on one Chromium/runtime version. ^desktop-runtime-version

Development and test hosts run Linux or macOS, and the runtime provides the layouts below for them. The desktop package's browser-side esbuild target remains `es2022`, while Node-side bundles remain under [the Node-version build contract](../node-versions.md).

## Runtime location and validation

The Electron package root is found by resolving `electron/package.json`; validation never loads `electron`'s main entry. Loading that entry is installation-capable in Electron 43 and is reserved for [obtaining the runtime](#obtaining-the-runtime). Every existing runtime is classified from files under that resolved package root first. ^desktop-runtime-before-resolver

A successful validation produces this logical contract for [the e2e harness](./e2e-harness.md) and [preflight](../test-runner/preflight.md):

```ts
type ValidElectronRuntime =
  | { layout: "native"; executablePath: string }
  | { layout: "upstream-macos"; executablePath: string };

type RuntimeValidation =
  | { valid: true; runtime: ValidElectronRuntime }
  | { valid: false };
```

The executable path is absolute and constructed from the resolved package root. It is never accepted from an earlier resolver call or an unchecked external path.

### Common exact-version predicate

Every valid layout satisfies all of these conditions: ^desktop-runtime-common-validity

- `electron/package.json` reports the [declared target version](#^desktop-runtime-version).
- `dist/version` is a regular file whose UTF-8 content matches that target exactly.
- `path.txt` is a regular file whose UTF-8 content is exactly the layout-specific relative path below, with no surrounding whitespace.
- The corresponding executable is a regular executable file at the constructed path.

A missing field, mismatched version, unexpected `path.txt`, or incomplete platform layout is invalid. Runtime validation reads only within the resolved Electron package root and never follows `path.txt` as an arbitrary path.

### Linux layout

The native layout applies the common predicate with Electron's Linux filename: `path.txt` and the constructed `dist/` executable are both `electron`. Linux sandbox readiness is an execution-environment decision owned by [e2e-harness.md](./e2e-harness.md), not part of native-runtime file validity. ^desktop-runtime-native-validity

### macOS layout

The Mac runtime is Electron's upstream application-bundle layout:

- `path.txt` = `Electron.app/Contents/MacOS/Electron`;
- executable `dist/Electron.app/Contents/MacOS/Electron`;
- regular file `dist/Electron.app/Contents/Info.plist`, whose `CFBundleExecutable` is `Electron`;
- nonempty directory `dist/Electron.app/Contents/Frameworks/`.

A partial copy that does not satisfy this complete predicate is invalid. ^desktop-runtime-macos-validity

## Obtaining the runtime

Installing the repository's dependencies places Electron's JavaScript package without its generated native runtime; Television has no `postinstall` for Electron. Hosts obtain the runtime through Electron's own installer. Playwright global setup ([e2e-harness.md](./e2e-harness.md#^desktop-e2e-global-setup)) and the Electron repair phase of [Blaxel shards](../test-runner/blaxel-testshards.md) invoke it directly, and a development run started with `npm run start:electron` reaches it through Electron's resolver when the executable is absent. Television does not mutate generated runtime files in place. ^desktop-runtime-lazy-install

The installed runtime must not depend on the install-time `extract-zip → yauzl → fd-slicer` chain. Electron 43's package tree and lockfile contain neither `yauzl` nor `fd-slicer`; this negative boundary prevents reintroducing the extraction path that can report a successful npm install over an incomplete runtime. ^desktop-runtime-extractor-boundary

## Operations

An Electron major upgrade changes the runtime for development, tests, and the installed app, even when Television's imported API surface is small.

1. Choose one supported Electron release and update the root and desktop development declarations to the same exact version. The ToDesktop build's generated manifest follows them.
2. Inspect that Electron release's platform requirements against [desktop product support](../../product/desktop-app.md#^desktop-product-support) and its Node requirements against [the repository toolchain](../node-versions.md); update those owners first when a requirement moves.
3. Regenerate `package-lock.json` with the repository's declared Node/npm toolchain. Prove the installed Electron version and complete dependency tree, and confirm disallowed extractor dependencies are absent.
4. Run the tests for runtime declarations, environment planning, the complete desktop e2e surface, and licensing.
5. Confirm that the build's pinned electron-builder release ([distribution.md](./distribution.md#^desktop-dist-config)) packages the new Electron release; if it does not, change the pin under that spec's operations.
6. Run the product spec's [real-host checks](../../product/desktop-app.md#Testing) that an Electron version change needs.

The product spec owns those checks, their supported host and their evidence exception.

## Testing

A test installs the runtime with an empty archive cache and no installed runtime. It uses a published Node binary, Electron's real package and installer, and real download, extraction, and filesystem operations without replacing any of them. The test uses a Node release on which Electron's installer has been observed to exit with status `0` while leaving the runtime incomplete. The [extractor boundary](#^desktop-runtime-extractor-boundary) guards against that outcome. The installed result must satisfy [runtime validity](#runtime-location-and-validation).
