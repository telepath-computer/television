*The canonical bundle: the stylesheet and components script Television serves an artifact document at `/canonical/v<n>/*`, the live and frozen inputs that produce it, and the compatibility contract over each version.*

# Canonical

Television serves artifacts a stylesheet and a components script at one stable address per version: the canonical bundle. It gives artifacts consistency and capability without requiring package imports — tokens, type, document defaults, and public elements, one link away on the same origin. A live version's rendered truth is the complete foundation ([ui/foundation/index.css](../ui/foundation/index.css)) and the element specs the build draws on. A frozen version's authority is its committed built payload under `packages/canonical/frozen/`, anchored by that version's provenance record (currently [v1's `frozen.json`](../../packages/canonical/frozen/v1/frozen.json)). This spec owns those two input classes, the build that produces the served files, the public mount and caching, the theme layer, version compatibility, and the freeze procedure.

## Serving

Each version is mounted at `/canonical/v<n>/*`: the canonical-built stylesheet at `base.css`, the `fonts/` it references, and `components.js`. The server classifies a version as frozen when its production directory contains `frozen.json`; an unmarked version is live.

A frozen version's public `styles.css` imports only its exact base and no theme. V1 therefore renders its fixed light base regardless of selected appearance, selected theme, or theme bytes.

A live version's server-owned `styles.css` applies the [shared theme layer](./themes/delivery.md#canonical-composition). Theme delivery's foundation-owned cascade governs theme precedence across live artifact and application documents.

Theme and appearance changes reach artifacts on a live canonical version without changing canonical's build output or the artifact. The [appearance explainer](./explainer-appearance.md) follows that live path and contrasts it with frozen v1.

### Caching

Television uses two cache classes on mounts that adopt this policy, following the GUI bundle's precedent ([updates/version-advertisement.md#^cache-headers](./updates/version-advertisement.md#^cache-headers)). A Television-served resource at a content-addressed filename is served with `Cache-Control: public, max-age=31536000, immutable`. A Television-served resource at any other filename has an `ETag` and a cache policy that requires revalidation before reuse. Stable production canonical responses use `Cache-Control: no-cache`; another mount adopting this class may add directives while preserving mandatory revalidation. In production canonical output, every live-version font is named `<stem>.<digest><extension>`, where `<digest>` is the first eight characters of the lowercase hexadecimal SHA-256 of the file bytes, inserted immediately before the original extension; the built stylesheet references that emitted name. A frozen version already carries its content-addressed font names and references as committed output. The production `fonts/` tree contains only those content-addressed files and the server serves that whole path as immutable. Public `base.css`, the server-owned `styles.css` wrapper, and each stable `/canonical/v<n>/components.js` address require revalidation. The base and active-theme resources have independent validators. ^cn-cache-policy

This caching contract governs production canonical build output. The current, code-governed development middleware path instead serves live authored sources under their plain filenames with `Cache-Control: no-cache`; those source responses are not immutable canonical output.

## The version directory

Every canonical version is exactly one of two input classes:

- A **live version** uses the complete foundation at `specs/ui/foundation/index.css` as its stylesheet authority and has a versioned production copy under `packages/canonical/styles/canonical/v<n>/`. The authority's imports and their order bind which live foundation and element sheets the artifact document carries. Production never imports spec files. The canonical builder recursively resolves the production copy, extracts the document-scope icon placeholders, content-addresses and copies its fonts, and bundles `packages/canonical/canonical-components.ts` from the live production element modules.
- A **frozen version** has one committed built tree at `packages/canonical/frozen/v<n>/`. Its runtime payload is `styles.css`, `components.js`, and the content-addressed files those bytes reference under `fonts/`. The adjacent `frozen.json` records the source commit captured and the Node, npm, and esbuild versions used. That commit's canonical sources match the pre-freeze source state; unrelated committed test or documentation changes do not affect provenance. A frozen tree contains output, not sources or editable UI specs: its stylesheet is not resolved again, its fonts are not renamed again, and its component bundle is not rebuilt from live modules.

`frozen.json` has exactly four string fields: `sourceCommit`, the full Git object id of the committed source state whose canonical inputs were captured; `nodeVersion`, the concrete Node version string; `npmVersion`, the concrete npm version string; and `esbuildVersion`, the concrete installed esbuild package version. The source commit predates the commit that adds its own record.

The builder discovers valid version directories in both package roots and rejects a version present in both rather than choosing one. A fresh build clears the canonical output root, builds each live input as above, and copies each frozen version directory recursively and byte-for-byte to `dist/canonical/v<n>/`, including `frozen.json`. It generates nothing into `packages/canonical/frozen/`. The output tree therefore represents exactly the versions committed in the two input roots, with no stale version left behind.

The private workspace package `@telepath-computer/canonical` at `packages/canonical` owns the live production copies, frozen payloads, builder, [public-name fixture](../../packages/canonical/test/fixtures/canonical-public-api.json), and build tests. A divergence between the live foundation authority and a version's production copy is a defect. A divergence between a frozen committed file and the corresponding fresh output is also a defect.

## What artifacts are told

An artifact is written by an agent reading Television's skill guidance, so what the bundle offers is only reachable if that guidance says it is there. The television skill's HTML artifact guidance (`packages/skills/skills/television/src/html-artifact-style.md`) and the bundled artifact-authoring skills target live canonical v2 for newly authored artifacts. The HTML guidance lists the v2 bundle addresses to link, the vocabulary its styles provide, and every public icon name. For each public element, it includes the markup an author writes, the element's attributes, and its documented custom properties.

It states nothing that is not contract. An internal class, a shadow part, a structure an element happens to render — none appears there, because an artifact written against it must survive everything a version is free to change. The same holds for vocabulary: guidance and every stylesheet a skill ships name only what the live foundation defines. A retired name preserved only by a frozen version appears in neither, so no new artifact is written against it.

## Versioning

An artifact is written once and kept, and the address it links carries a version. The integer is the promise: nothing served under `/canonical/v<n>/` breaks an artifact written against it. The promise holds for every released version, live or frozen.

A live version may change only by compatible addition: new elements, new tokens, and new skill content. A name it has shipped — a token, element, attribute or attribute value, documented custom property, or icon name — keeps its meaning. New names may be added, and a default treatment may be refined in degree, but behavior cannot be removed in kind. A change that would break an artifact freezes the live version and starts the next version.

A frozen version's committed output does not change. Review treats any edit under `packages/canonical/frozen/v<n>/` as a compatibility decision, not ordinary generated-output maintenance. A required security or browser-compatibility fix is made as an explicit edit to that payload or regenerated deliberately from its recorded source commit; it is never inherited accidentally from a live module. An addition that should not alter a frozen version may ship at a point-version address (`v1.1`), its own directory and mount; no point version currently exists.

To freeze a live version:

1. Start from a committed state whose canonical inputs match the source version being frozen, and run a fresh production canonical build with the recorded Node, npm, and esbuild versions.
2. Validate every name in that version's public-name fixture against the built stylesheet and component bundle.
3. Commit the exact built `styles.css`, `components.js`, and content-addressed font files under `packages/canonical/frozen/v<n>/`, with a `frozen.json` naming that source commit and toolchain.
4. Delete that version's production source directory under `packages/canonical/styles/canonical/`, leaving no live-version input for the captured version, and update the vendored-asset licensing inventory to the committed payload.
5. Never run a generator against the frozen directory. Subsequent canonical builds only copy it.

An artifact styles a public element through its tag name, documented attributes and values, and documented custom properties; classes and internal structure are never contract. The public-name fixture records, per version, every name an artifact can write or reference. For a released version it grows while that version is live and never loses an entry.

### v1

V1 is frozen. Its only authority and payload is the tree beside its [`frozen.json`](../../packages/canonical/frozen/v1/frozen.json):

- [`styles.css`](../../packages/canonical/frozen/v1/styles.css) — the built v1 base stylesheet, including its shipped compatibility names and document-scope icon placeholders;
- [`components.js`](../../packages/canonical/frozen/v1/components.js) — the built element bundle for `tv-icon`, `checkbox-list`, and `checkbox-item`, including the icon glyph set it shipped;
- [`fonts/Hind-Variable.933e9900.woff2`](../../packages/canonical/frozen/v1/fonts/Hind-Variable.933e9900.woff2) — the one content-addressed font those stylesheet bytes reference; and
- [`frozen.json`](../../packages/canonical/frozen/v1/frozen.json) — capture provenance, not an artifact runtime resource.

`components.js` is required for `tv-icon`: the element draws its glyph on upgrade, and without the script the placeholder box stays empty. `checkbox-list` renders from its stylesheet alone; its module only defines the tags. V1's frozen bundle does not inherit changes to the live element modules.

### v2 (live)

V2's stylesheet authority is the complete foundation, [ui/foundation/index.css](../ui/foundation/index.css). Its versioned production copy is [packages/canonical/styles/canonical/v2/index.css](../../packages/canonical/styles/canonical/v2/index.css). V2 carries no compatibility sheet; frozen v1 preserves its earlier vocabulary. From each top-level icon rule, the live builder retains only selectors matching `tv-icon:not(:defined)` or `tv-icon:not(:defined)[size="…"]`, with the declarations unchanged, for document scope. A rule shared with `:host` therefore contributes its placeholder selectors without exposing its shadow-root selectors to the document. Nested rules are not lifted out of their context. The complete icon sheet ships inside the element bundle.
