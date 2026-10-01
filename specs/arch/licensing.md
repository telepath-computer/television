*The licensing implementation: bundle-derived third-party notices generation for the esbuild, Vite, and skill outputs, the config file for elections, notice texts, and ignored packages, the vendored-asset provenance manifest, the committed source-surface notices, the suite-run allowlist gate, and the assertions on the CLI tarball and the desktop upload directory — wired into the existing build, verify, and publish pipeline.*

# Licensing architecture

Television's executables and browser bundles are built by inlining third-party packages into single files, which strips the license files those packages contain out of what users receive. This spec defines the machinery that puts the required notices back: generators that read what each bundler actually emitted, a small set of reviewed configuration files for the judgment calls, and verification checks that keep it all true.

## What this owns

This spec owns the **implementation of the licensing policy** in [product/licensing.md](../product/licensing.md): the notices generators and where their outputs land, the license configuration files (config and vendored-asset manifest) and their schemas, the notice-text resolution rules, the gate and its suite enforcement path, the assertions on the CLI tarball and the desktop upload directory, and where Electron's license files sit in the built desktop app. The policy itself — what is promised and which licenses are acceptable — is owned by the product spec.

## Simple rules, and a human for the rest

npm is a wilderness. Packages declare no license, or put their terms only in a README, or ship three license files, or misspell an SPDX id — and there will always be a shape nobody anticipated. **This system does not try to meet that variety procedurally.** ^licensing-simple-rules

One simple rule set covers the packages on the golden path: a license id in the manifest, a license file at the package root, an inventory entry derived from what the bundler emitted. A package matching those rules is handled with no one's attention. A package that does not match **trips verification and stops the build**, and a person resolves the specific problem in reviewed configuration — with a config entry, license election, or exact notice text, as appropriate — or removes the package from the shipped material.

The rule set does not grow to absorb the exceptions, and that restraint is the design rather than a gap in it. A rule elaborate enough to handle every oddity is the failure mode: no one can review what it will do to a package it has not met yet, it breaks in new ways as the ecosystem shifts, and it accretes a branch per oddity until the behavior lives in the code instead of in anyone's understanding of it. Failing loudly and letting a person write down the answer keeps the mechanism small enough to reason about, and keeps the judgment calls in a file a reviewer can read.

## Why notices derive from bundler output, not manifests

Scanning `package.json` dependency declarations is the obvious approach and is wrong for this repository, in both directions: ^licensing-why-bundle-derived

- **Manifests under-report.** The published CLI (`@telepath-computer/television`) declares a single runtime dependency (`skills`), yet its built `dist/cli.cjs` inlines on the order of ninety third-party packages — they enter through workspace `devDependencies` and are compiled in by esbuild. A manifest scan would conclude the tarball redistributes almost nothing.
- **Manifests over-report.** The full installed tree is ~750 packages, the large majority development-only tooling that never enters any shipped artifact. Attributing all of it would bury the real notices in noise and misstate what we redistribute.

The only accurate source is **what the bundler actually emitted**: esbuild's metafile for the esbuild bundles, and a bundle-aware plugin for the Vite builds. Notices generated from that source stay correct as bundles change — a tree-shaken package drops out, a newly bundled one appears — which is what makes the product promise that notices are [generated, never hand-maintained](../product/licensing.md#^licensing-generated) hold over time. What bundlers cannot see is handled beside it, never by scanning the whole tree: vendored assets come from the asset manifest, and the dependencies declared for the CLI package and the desktop app are read from exactly the two manifests that declare them ([declared dependencies](#^licensing-declared-scan)).

## Module map

| Piece | Location | Job |
|---|---|---|
| Notices generator | `scripts/licenses/generate-notices.mjs` | bundler inventories + config + asset manifest → per-surface notices files |
| License config | `scripts/licenses/config.json` | allowlist copy, elections, notice texts, ignored packages |
| Vendored-asset manifest | `scripts/licenses/assets.json` | provenance of tracked third-party material |
| Surface declaration | `scripts/licenses/lib/surfaces.mjs` | machine-readable copy of the product-owned surface list, with inventory and package-topology mechanics; imported by every consumer |
| Inventory root | `.licenses-inventory/` (git-ignored) | persisted per-surface inventories handed from the builds to aggregation and the gate |
| License gate | `scripts/licenses/check.mjs` | suite-test failure on unacceptable shipped licenses or stale notices |
| Vite inventory plugin | `scripts/licenses/vite-plugin.mjs` in each shipping Vite config | bundle-module inventory → inventory root |
| Root notices | `THIRD-PARTY-NOTICES.txt` (repo root, committed) | the source-repository surface's notices |
| Tarball assertions | `scripts/check-publishable.mjs` (extended) | packed tarballs carry `LICENSE`, plus notices exactly where the surface has entries |

## Notices generation

### The inventory root

Metafiles and bundle-module lists live in build-process memory, so neither survives to the later aggregation and gate steps on its own. The persisted handoff artifact is the *inventory root*: `.licenses-inventory/` at the repository root, git-ignored. Every build that produces a shipped surface writes one structured per-surface inventory file there — `<inventoryRoot>/<surface>.json`: ^licensing-inventory-root

```ts
/** scripts/licenses/lib/surfaces.mjs — architecture mapping of the product-owned list */
type LicenseSurfaceDeclaration =
  | { surface: "cli"; producesInventory: true; packageDirectory: "packages/cli" }
  | { surface: "desktop"; producesInventory: true; packageDirectory: "packages/desktop" }
  | { surface: "skill:tv-calendar"; producesInventory: true; parentSurface: "cli" }
  | { surface: "skill:tv-tasks"; producesInventory: true; parentSurface: "cli" }
  | { surface: "source"; producesInventory: false }
  | { surface: "view:markdown"; producesInventory: true; parentSurface: "cli" }
  | { surface: "web"; producesInventory: true; parentSurface: "cli" }

type Surface = LicenseSurfaceDeclaration["surface"]
type InventorySurface = Extract<LicenseSurfaceDeclaration, { producesInventory: true }>["surface"]

/** <inventoryRoot>/<surface>.json — written by each inventory-producing surface's build */
interface SurfaceInventory {
  surface: InventorySurface
  packages: {
    name: string
    version: string
    declaredLicense: string | null   // the manifest's license value, unmodified
    licenseFilePath: string | null   // package-root license file, when one exists
  }[]
}
```

When the same `name@version` appears more than once across the inventories being combined, the records collapse to one and **the record carrying a license file wins** — it is the one that can resolve a notice; a record without the path resolves to nothing. One implementation of that rule serves every caller, in the inventory module. Two implementations of a preference rule is how the preference silently inverts. ^licensing-record-dedupe

These files — never anything written into a dist, and not the human-readable notices text — are the machine-readable inputs of the CLI umbrella aggregation and the gate. Their consumer is the suite path: the `e2e:node` pre-build runs both product builds, and the licensing tests run the gate over the inventories left in the root ([suite enforcement](#^licensing-suite-enforcement)). A standalone `npm run build` writes them too (they are ignored output, harmless to leave behind).

**Which product areas require licensing attention is declared in the [product spec](../product/licensing.md#^licensing-surface-list), not discovered from the repository.** The declaration above assigns each product area its code-facing identifier and mechanics: whether its build produces an inventory, which workspace package holds its shipped output, and whether it is a child folded into the CLI umbrella. The `source` surface is rendered from the asset manifest alone and therefore produces no inventory. `scripts/licenses/lib/surfaces.mjs` is the machine-readable copy of this mapping. Every consumer imports it: the gate, the CLI umbrella aggregation, the packed-tarball check, the Vite plugin, and the asset-manifest loader. ^licensing-declared-surfaces

The product list, this architecture mapping, and `surfaces.mjs` must agree; divergence is a review defect. No automated check infers the list from workspace directories, package manifests, or build outputs, because those structures cannot decide whether a product area carries third-party material. The product decision and its code mapping are kept aligned by review.

**The gate fails when a surface declared to produce an inventory has none in the root.** That is the direction a check can catch: a build step that stopped running leaves no trace anywhere else. The opposite direction — an inventory for a surface nobody declared — is refused where it would be created, by the inventory writer and by the Vite plugin at construction, so it cannot reach the root for the gate to find. ^licensing-declared-forward

Reading the directory instead would make the three consumers agree by construction and prove nothing by agreeing. A build step that silently stopped producing one surface's inventory would remove that surface from all three at once: the gate would check what remained and pass, the umbrella would attribute what remained and look complete, the tarball check would find the file it expected — and the product would ship a bundle whose third-party code no notice mentions, with every check green. A declaration is the fixed thing each consumer can be measured against, which is the only arrangement in which a missing surface is detectable at all.

### Ignored packages

An *ignored package* ([policy](../product/licensing.md#^licensing-ignored)) is dropped where bundler output becomes an inventory — the single module-path mapper both bundler families share. It therefore has no inventory record, nothing for the notices to render, and nothing for the gate to check, rather than each later stage remembering to skip it. The list is the policy's last-resort escape hatch for material that genuinely does not fit this processing pipeline; a missing or inconvenient notice is resolved through the reviewed notice-text configuration. ^licensing-ignored-filter

An entry's `pattern` is an exact package name or `@scope/*` for a whole scope. Nothing else is a pattern: a bare `*`, a partial wildcard such as `@scope/pre*`, a trailing-slash form, and an empty string are all rejected when the config loads, so a typo cannot silently widen or narrow what the system handles.

The notices pipeline has exactly two entrances, and the same predicate guards both. Bundler output enters through the mapper above, where an ignored package is dropped. Hand-written material enters through the [vendored-asset manifest](#vendored-asset-provenance), where a component naming an ignored package is **rejected** — the build fails, naming the asset and component. Rejecting rather than dropping is the deliberate choice on this side: bundler output is generated and silently narrowing it is correct, while a manifest entry is something a person wrote, and quietly discarding it would hide the mistake. Neither entrance can produce a rendered mention, which is what makes the product's never-named promise structural rather than a convention. ^licensing-ignored-entrances

### Notices content

**A notices file exists where there is third-party material to declare.** A surface whose build yields no entries — no handled package, no vendored asset — gets no file, and none is expected of it: a file that announced it had nothing to say would be a puzzle handed to the reader, not a notice. Absence therefore carries the same meaning as an empty file would have, without asking anyone to interpret it. ^licensing-notices-existence

The **whole file**, not only its header, follows the product's [reader rule](../product/licensing.md#^licensing-notices-audience). What a file that does exist contains:

- **The header** states what the file is — the third-party licensing notices for the software included in this product — and which product it belongs to, in words someone who did not build it would use. No surface id, no editing instruction, no statement about licensing status.
- **Each entry** names the material the way its own publisher names it, states the license it is under, and reproduces its complete terms. Material with package identity is named by its package name, with the version when its record carries one; material without is named by the `name` its [asset record](#vendored-asset-provenance) declares for it. Nothing else appears — no statement of where we obtained it, because the copyright holder is named in the license text itself and that is the attribution the terms require. In particular the config `id` that identifies a record *to us* never renders, and this spec's own field names are not labels in the output: a reader is told what the material is, not which key it sat under.
- **Each item appears once.** The same name and version can arrive from a bundler inventory and from the asset manifest — a package both compiled into a bundle and embedded in a prebuilt file does. It renders as one entry. Two arrivals that disagree about the license or the notice text are not merged and not silently preferred: the build fails, because a disagreement means one of the two records is wrong and picking a winner would ship the wrong terms. ^licensing-entry-once
- **Entries are uniform.** Nothing in the file reveals which internal path produced an entry. Whether we learned of a piece of third-party material from a bundler's output or from the vendored-asset manifest is our concern; the reader is handed one list of the third-party software in the product, and the two sources are indistinguishable in it.

This spec pins what the file says, not its exact bytes. ^licensing-notices-header

### esbuild bundles (CLI and desktop)

`packages/cli/build.mjs` and `packages/desktop/build.mjs` call esbuild's `build()` directly. Each such call adds `metafile: true`, and the build script passes the metafile(s) to the notices generator, which:

1. maps every metafile input path under `node_modules/` to its containing package (name and version, from the nearest `package.json`), drops [ignored packages](#ignored-packages), and persists the rest as the surface's inventory in the [inventory root](#^licensing-inventory-root);
2. resolves each package's license id (manifest SPDX expression, corrected by config) and its notice text per the [resolution rules](#notice-text-resolution);
3. folds in the [vendored assets](#vendored-asset-provenance) declared for the surface;
4. writes `THIRD-PARTY-NOTICES.txt` into the package's `dist/` when there is at least one entry to write: a header, then one entry per item of third-party material, in the shape the [content rule](#notices-content) fixes. ^licensing-generator-behavior

The CLI package ships `dist/**` through its `files` glob, and the desktop [upload directory](./desktop/distribution.md#^desktop-dist-upload) carries the desktop workspace's `dist/`, so a notices file that is written reaches the tarball and the built app with no further step. The CLI build also copies the web, view, and skill dists into `dist/web/`, `dist/views/`, and `dist/skills/` — their surface inventories, read from the [inventory root](#^licensing-inventory-root), are folded into the CLI's notices file at that point, so one umbrella file covers everything in the tarball, alongside whichever per-directory files exist. ^licensing-notices-placement

### Vite bundles (web client, bundled views, skill bundles)

Every shipping Vite build adds Television's own inventory plugin, `scripts/licenses/vite-plugin.mjs`: `packages/web/vite.config.ts`, each bundled view's config (e.g. `packages/view-markdown`), and the skill configs `packages/skills/skills/tv-calendar/vite.config.ts` and `packages/skills/skills/tv-tasks/vite.config.ts`. The plugin **rejects a surface id that is absent from the declaration or has `producesInventory: false`**, when the config constructs it — a typo fails in the config that holds the mistake, before it can produce an inventory nobody expects. It is bundle-aware: in `generateBundle` it collects the emitted chunks' module paths (skipping rollup-virtual ids), filters to `node_modules` modules, and maps them to containing packages through the same resolution path as the esbuild metafiles. First-party rather than the off-the-shelf `rollup-license-plugin`, because that plugin fails the build on any package with no declared license, including packages this system does not handle at all, and its only escape is recording an invented SPDX id — and its remaining contribution, extracted license text, is data this architecture already distrusts by design ([resolution rules](#^licensing-notice-resolution)). ^licensing-vite-plugin

The plugin writes **no in-dist inventory file**: it persists the surface's inventory into the [inventory root](#^licensing-inventory-root), and the generator writes the final notices directly into the dist. A final shipping directory contains no raw inventory artifact, and carries the generated notices file when it has entries ([existence rule](#^licensing-notices-existence)) — the CLI build copies these dists wholesale and `tv skills install` copies whole skill directories, so anything else written into a dist would literally ship. Ignored packages are dropped by the shared mapper, exactly as on the esbuild path. The final notices: ^licensing-vite-intermediate

- `THIRD-PARTY-NOTICES.txt` in the web dist (which always has entries), served at the stable URL `/THIRD-PARTY-NOTICES.txt` next to the client bundle, fulfilling the product's [third-party notices promise](../product/licensing.md#^licensing-notices-promise) for the browser surface;
- a `THIRD-PARTY-NOTICES.txt` in each built view or skill dist **that has entries** ([existence rule](#^licensing-notices-existence)). The per-skill file matters because `tv skills install` copies a skill's directory out of our package into the user's agent directory — where a skill carries third-party material, its notices must live inside the copied directory to travel with it. ^licensing-skill-notices

Vite's default preservation of `/*! ... */` and `@license` legal comments in minified output is left in place. Those inline banners are how some packages (DOMPurify, lit-html) expect to be attributed, but only packages that author such banners get them — the generated notices are the complete record, the banners a courtesy left intact. ^licensing-legal-comments

### The source-repository surface

The vendored assets are delivered by a bare clone of the public repository, before any build runs, so the repository root carries a **committed** `THIRD-PARTY-NOTICES.txt` covering them. It is still generator-owned, not hand-maintained: the generator produces it from the asset manifest's source-surface entries, and the gate fails when the committed file differs from a fresh generation — the same regenerate-and-diff staleness discipline as any other generated committed artifact. One mechanism covers the whole surface. An asset whose folder is copied out of the package as a unit also carries a generated [folder notices file](#^licensing-folder-notices). ^licensing-root-notices

## Notice-text resolution

For each package in a scanned inventory, the notice text is resolved in exactly two steps: ^licensing-notice-resolution

1. **The package's license file, verbatim**, when it ships one (`LICENSE*`/`LICENCE*`/`COPYING*` at the package root).
2. **Otherwise, a reviewed `notices` config entry supplies the text**, and that text is the **exact bytes to render**: a person writes what the file should say, and the generator emits it unchanged. Nothing repairs, decodes, reformats, or reconstructs a package's terms — a rule clever enough to fix one package's markup is clever enough to corrupt another's, and neither outcome is reviewable ([policy](../product/licensing.md#^licensing-no-repair)).

If neither yields a notice for a bundled package, **the build fails** and names the package. Failing beats the alternative — substituting generic SPDX template text — because MIT's core demand is the *author's* copyright line, and a template carries a blank placeholder instead. The current tree has exactly one such package: `cookie-signature@1.0.7`, bundled into the CLI, whose MIT grant and `Copyright (c) 2012 LearnBoost` line live only in its README; its config entry is part of the initial config. ^licensing-no-boilerplate

Additionally, when a package ships an Apache-2.0 `NOTICE` file, its contents are reproduced in the generated notices — Apache-2.0 §4(d) requires it. None of the currently shipped Apache dependencies carries one; the rule exists for the first that does. ^licensing-apache-notice

## The config file

All licensing judgment calls live in one reviewed file, `scripts/licenses/config.json`, consumed by both the generator and the gate. Nothing in the toolchain makes a silent judgment: a dual license is never auto-picked, a missing license field is never auto-guessed, a missing notice is never auto-extracted.

```ts
/** scripts/licenses/config.json */
interface LicenseConfig {
  /**
   * License identifiers acceptable in shipped surfaces — the machine-readable copy of the
   * product allowlist, which must match it exactly (see below). OFL-1.1 is on
   * it for the vendored typeface; its font-only scope is policy, upheld in
   * review (product/licensing.md), not a distinction this file encodes.
   */
  allow: string[]
  /** Dual/multi-license elections: which offered license we take. */
  elections: LicenseElection[]
  /** Reviewed notice texts for packages that ship no license file. */
  notices: NoticeText[]
  /** Packages the system does not handle at all. */
  ignored: IgnoredPackage[]
}

interface LicenseElection {
  package: string       // package name, e.g. "dompurify"
  offered: string       // the SPDX expression we elected from, e.g. "(MPL-2.0 OR Apache-2.0)"
  elected: string       // the single license we take it under, e.g. "Apache-2.0"
}

interface NoticeText {
  package: string       // e.g. "cookie-signature"
  text: string          // the exact upstream notice, copied by the reviewer
  source: string        // where it was copied from, e.g. "README ## License section"
}

interface IgnoredPackage {
  pattern: string       // exact package name, or "@scope/*" for a whole scope
}
```

The `allow` array is the machine-readable copy of the allowlist whose contents are owned by [the product spec](../product/licensing.md#^licensing-allowlist-contents); it must match exactly. The sync is review discipline, per [spec-policy.md](../spec-policy.md)'s no-procedural-enforcement stance: any change touching either side is reviewed against the other, and a divergence is a review defect — the gate deliberately does not parse spec prose. ^licensing-allow-sync

An election records the upstream declaration it was made against — its `offered` expression — and the gate **fails when the package's actual declaration no longer matches that recorded value** — an upgrade that changes a dependency's license terms must force a fresh human decision rather than silently inheriting the old one. The comparison is machine-to-machine (recorded string against the manifest's current `license` value). ^licensing-override-drift

Dead-entry detection is defined per config category: an **election or notice text** is dead unless its package appears in a current scanned inventory; **ignored entries are not liveness-checked at all** — they are a standing scoping decision rather than a correction to an observed fact, and a scope pattern that currently matches nothing is still the policy. Mere physical presence in `node_modules` keeps nothing alive — a stale entry whose package survives only as development tooling is still dead. ^licensing-dead-entries

Ignored entries are recorded **by name or scope, never by version**: they say which code this system does not handle, and that answer does not change with a version bump. ^licensing-ignored-shape

Initial recorded contents: an election for `dompurify` (`(MPL-2.0 OR Apache-2.0)` → `Apache-2.0`); the notice text for `cookie-signature`; the ignored pattern `skills`. No pattern is recorded for workspace code: a workspace package resolves to its real path outside `node_modules`, so it never reaches the mapper that would need to skip it. ^licensing-initial-config

## Vendored-asset provenance

Third-party material tracked in Television's own source is invisible to every bundler-derived scanner — it looks like first-party code. Each such asset is declared in `scripts/licenses/assets.json`. An asset is one or more tracked files; because a prebuilt file can embed several third-party components, the third-party content is modeled per component, not per file:

```ts
/** scripts/licenses/assets.json */
interface VendoredAsset {
  id: string            // identifies the record in validation failures; never rendered
  paths: string[]       // the tracked files, repo-relative
  components: VendoredComponent[]
  surfaces: Surface[]   // which shipped surfaces include it; each validated against the declaration
  noticesFolder?: string // repo-relative tracked folder that also carries a committed notices file for this asset
}

interface VendoredComponent {
  package?: string      // npm identity, when the component is an embedded package
  version?: string      // the embedded version, when known
  name?: string         // reader-facing name, for a component with no package identity
  license: string       // SPDX id or LicenseRef from the allowlist
  noticeText: string    // the complete text to reproduce (full license text where the license requires it)
}
```

An asset's `surfaces` are checked against the [declaration](#^licensing-declared-surfaces) when the manifest loads, not against a pattern. A pattern accepts `view:markdwon`: the manifest loads clean, the asset renders into no file, and the material it declares is attributed nowhere — a silent miss whose only symptom is an absence nobody is looking for.

**Every component carries its own name.** A component with package identity is named by it; a component without declares `name`, and the config loader rejects one that has neither, since an entry that cannot be named cannot be rendered. Nothing is borrowed from the asset record: one bundle can embed two unrelated projects, and each is named for what it is rather than for the file they happen to share. The asset's `id` and `paths` never render: they identify the record when validation fails and say which files it covers.

Component rules: every component carries a license and the complete `noticeText` to reproduce — the full terms, not just a copyright line, because for these assets there is no package license file for the [package resolution rules](#^licensing-notice-resolution) to read. A component missing either field fails the build, as does one naming a package matched by an ignored pattern ([the second entrance](#^licensing-ignored-entrances)).

Every rule in this section is enforced **once, where the manifest loads**. The loader is the only entrance production takes into asset data, so the generator and the gate consume what it returns without re-checking it: a second copy of a rule can only agree with the first or contradict it, and neither outcome is worth the code that produces it. ^licensing-asset-components

The generator folds each asset's components into the notices of every surface listed for it; `"source"` entries drive the [committed root notices](#^licensing-root-notices) (the CLI umbrella additionally inherits web/view/skill-surface assets through [aggregation](#^licensing-notices-placement)). ^licensing-asset-manifest

The [asset manifest](../../scripts/licenses/assets.json) is the canonical inventory of tracked third-party material: file paths, components, license texts, delivery surfaces, and notices folders. This spec owns the schema and processing contracts; concrete record expectations and verification belong in the [licensing proof](../../proofs/arch/licensing.md#^licensing-t-real-assets-seam) and its tests.

### Folder notices

Some tracked folders leave the package as a unit: [bundled-theme installation](./themes/bundled-installation.md#serving-boot-installation) copies each theme's complete source folder into the user's data directory. An asset whose material sits in such a folder names it in `noticesFolder`, and the generator writes a committed `THIRD-PARTY-NOTICES.txt` into that folder, rendered from the asset's components under the same [content rule](#notices-content) as every other notices file. Assets naming the same folder share one file. The gate fails when a committed folder file differs from a fresh generation, exactly as it does for the root file, and the loader checks a `noticesFolder` the way it checks `paths`: it must be a repository-relative path to an existing folder. The license text therefore lives once, in the manifest, and every rendered copy is checked against it. ^licensing-folder-notices

### Bundled themes with externally licensed material

The [product rule](../product/licensing.md#^licensing-theme-material) for a bundled theme that includes externally licensed material is met by one asset record per theme and, for material held in a text file, an attribution comment: ^licensing-theme-records

- the record's paths are every tracked file that contains the material, in the theme's UI spec and in its production folder; its components name each upstream work, with the license text copied verbatim from the upstream license file at a fixed revision whose terms are the ones declared, or from dated retained website terms for the [Unsplash material](../product/licensing.md#^licensing-unsplash); its surfaces are `cli` and `source`, plus `desktop` when the desktop app ships the theme; its `noticesFolder` is the theme's folder under `packages/server/assets/themes/`;
- a text file that contains the material opens with a comment that names the upstream project and its address, reproduces its copyright line when supplied by upstream, names its license, and points to `THIRD-PARTY-NOTICES.txt`. For a color scheme that file is the stylesheet: the comment is authored in the UI spec's `styles.css` and reaches `theme.css` through the byte-identical copy. A binary file such as an image carries no comment; the folder notices attribute it.

A release tag or registry package is a valid source only when its own license file carries the declared terms. Whether a theme includes externally licensed material is decided in review, like every other vendored-asset question.

The prebuilt onboarding calendar bundle now contains only first-party code, so it needs no vendored-asset entry. A tracked file whose only embedded third-party code is an ignored package gets no entry at all — there is nothing for the system to carry, and declaring one is rejected. Adding any other vendored third-party material without an `assets.json` entry is a review defect — the checklist question is "did third-party bytes enter the tree outside `node_modules`?"; no tooling can catch this class.

## LICENSE propagation and manifest lint

The root `LICENSE` is the single source ([policy](../product/licensing.md#^licensing-mit); its copyright line is [product authority](../product/licensing.md#^licensing-copyright-line)). The CLI build copies it into the CLI package root, and the desktop build script copies it into the [upload directory](./desktop/distribution.md#^desktop-dist-upload), so the copies are regenerated — byte-identical by construction — on every build rather than maintained by hand. The manifest lint in `scripts/check-publishable.mjs --manifest-only` (already run by `npm run verify`) additionally requires `"license": "MIT"` in every workspace manifest. ^licensing-license-propagation

## The license gate and tarball assertions

`scripts/licenses/check.mjs` is the gate satisfying [gate enforcement](../product/licensing.md#^licensing-gate). Its inputs are the persisted per-surface inventories in the [inventory root](#^licensing-inventory-root), the **declared dependencies** of the CLI package and the desktop workspace, the config, and the asset manifest — never the human-readable notices text. Ignored packages never reached an inventory to begin with ([the filter](#^licensing-ignored-filter)). It fails, naming each offender, when: ^licensing-gate-behavior

- a package's resolved license cannot be determined, or is outside `allow` and not covered by an election;
- a [declaration](#^licensing-declared-surfaces) with `producesInventory: true` has no inventory in the root;
- a **bundled** package's notice text cannot be resolved ([resolution rules](#^licensing-notice-resolution)) and no config entry covers it — a declared dependency owes a license the allowlist accepts, not a notice, since its own license file travels with it to the user ([self-delivery](../product/licensing.md#^licensing-external-deps));
- an election no longer matches the package's actual declaration ([drift rule](#^licensing-override-drift));
- a config entry is dead under the [category-specific dead-entry rules](#^licensing-dead-entries) (dead entries are removed, not accumulated);
- the committed root `THIRD-PARTY-NOTICES.txt` is stale ([source surface](#^licensing-root-notices)).

**Declared dependencies** are read from the `dependencies` field of two manifests: the published CLI package's, `packages/cli`, and the desktop workspace's, `packages/desktop`, which lists the packages the ToDesktop build installs into the app ([the desktop workspace](./desktop/distribution.md#The desktop workspace)). Their licenses are resolved from the installed tree exactly as a bundled package's is, then checked against the same allowlist. Only the declared names are read, not their own dependency trees: the closure below a dependency is that project's decision, and this gate exists to hold *ours* to the policy. Ignored packages are skipped like everywhere else. A declared dependency is gated but never attributed — nothing about it enters a notices file. ^licensing-declared-scan

Electron, the product's [upstream aggregate](../product/licensing.md#^licensing-electron-aggregate), reaches neither the bundlers nor this scan: it is a development dependency of the desktop workspace, and the ToDesktop build supplies the app's copy at the [runtime version](./desktop/runtime.md#^desktop-runtime-version). The electron-builder release set in the [ToDesktop configuration](./desktop/distribution.md#^desktop-dist-config) places Electron's `LICENSE`, renamed `LICENSE.electron.txt`, and `LICENSES.chromium.html` in the Mac app's `Contents/Resources`. ^licensing-electron-built-app

`scripts/check-publishable.mjs --tarballs` — already run by `publish.yml` after the builds — additionally asserts each packed public tarball contains `LICENSE` (byte-identical to root), and contains `dist/THIRD-PARTY-NOTICES.txt` **exactly when that package's surface has entries** — the surface taken from the [declaration](#^licensing-declared-surfaces), never inferred from a directory name or by treating one package as whatever is left over — and a missing inventory reported as the publishable package whose build has not run, not as a filesystem error, and the entries derived from the same inventory, assets, and config the generator rendered from. This is the last line: whatever else regresses, a package cannot publish while missing legal files it owes, and cannot publish a notices file with nothing in it. ^licensing-tarball-assertions

The licensing tests check the desktop [upload directory](./desktop/distribution.md#^desktop-dist-upload) the same way, on a directory generated by the real build script: it contains `LICENSE`, byte-identical to the root file, and `dist/THIRD-PARTY-NOTICES.txt` exactly when the `desktop` surface has entries, with the bytes the desktop build wrote. ToDesktop builds the app from that directory, so these are the files the app carries. ^licensing-upload-assertions

## Pipeline integration

Licensing enforcement runs as **ordinary tests in the standard suites** — no dedicated verify phase, no dedicated CI job, no workflow or attestation changes. The `e2e:node` surface's registry `preCommand` ([test-registry.md](./test-runner/test-registry.md)) runs **both** product builds — the full CLI composite build and the desktop build — sharing the default [inventory root](#^licensing-inventory-root), and the licensing test file runs the gate as a fast file-level check over those persisted inventories, alongside the notices, tarball and upload-directory inspections. Every `npm run verify` and every CI run executes these tests because they live in the normal suites; that is the enforcement point. In CI's build-once fan-out, where shards skip `preCommand`s, the inventory root reaches the shards inside the build artifact because it is untracked, and the artifact carries the build's untracked output ([the artifact's contents](./test-runner/github-ci.md#^gha-prebuilt-partition)). ^licensing-suite-enforcement

- **Publish:** no new steps. `publish.yml` runs `npm run build`, which emits the notices as part of building, and then `npm run check:publish-tarballs`, which asserts them (above).
- **Desktop builds:** no step beyond `build.mjs`, which emits the desktop notices. The upload directory that the [build script](./desktop/distribution.md#The build script) generates carries the files checked [above](#^licensing-upload-assertions).

The generators and gate are plain Node scripts with no network access — license resolution reads only the installed tree. ^licensing-pipeline

## Testing

Real builds verify the licensing integration for the CLI and desktop esbuild products and for every declared Vite surface that produces an inventory. Real builds also verify that the full CLI build aggregates inventories and that the inventories from the suite's product builds reach the license gate. The upload-directory assertions inspect a directory generated by the real desktop build script. Fixture bundler output is not used for this evidence.

The committed `scripts/licenses/assets.json` manifest is read directly, with no substitute, to verify that each record for a vendored asset reaches every surface listed in that record. [Electron's license files](#^licensing-electron-built-app) are checked in the built Mac app, which ToDesktop packages with its own copy of Electron, by the desktop product spec's [real-host acceptance](../product/desktop-app.md#Testing).

