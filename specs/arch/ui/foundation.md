*The UI foundation architecture: how the stylesheets the UI specs compose for each document cross into production.*

# Foundation architecture

The UI specs are authoritative for styling content and for what each document carries: [Foundation UI](../../ui/foundation/index.md) and its linked element specs own the foundation's vocabulary, and [index.css](../../ui/foundation/index.css) defines its composition. This spec governs how that styling reaches production — the distribution of foundation and element sheets — and the shell document's preload of the artifact font.

## Distribution

The icon sheet is carried by `tv-icon` inside its own shadow root; [elements.md#tv-icon](./elements.md#tv-icon) owns that route and its public guarantee.

The foundation sheets assigned to the app document and the ambient element sheets cross into `packages/web/src/foundation/` as byte-identical committed copies. The complete production foundation at `packages/web/src/foundation/index.css` loads them globally in the order [ui/foundation/index.css](../../ui/foundation/index.css) imports their sources. Production imports only these copies and never imports spec files.

Every implemented non-ambient stylesheet stated by the UI spec tree crosses as a byte-identical committed sibling of the production module that renders its markup, and that module imports the sibling copy. Where a surface's styling is stated in the `style:` blocks of its reference frames rather than a standalone stylesheet, the blocks' content crosses byte-identical into the sibling sheet, in the order the crossings table lists the frames, and the sibling carries nothing else. A theme stylesheet instead crosses as the byte-identical `theme.css` entry of its installed package; its declared image assets keep the same relative paths and bytes. A stylesheet whose owning spec explicitly says **specified, not implemented** has no production crossing until that status changes. The icon sheet additionally has one deliberately partial live crossing: canonical extracts only its `tv-icon:not(:defined)` rules for document scope, governed by [canonical's live-version build](../canonical.md#the-version-directory) and [icon sizing](../../ui/foundation/icons/index.md#Sizing). The sheets a live canonical version composes cross into `packages/canonical` under that build contract; a frozen version has no foundation crossing.

Implementation-owned host scaffolding and styling under a named code-governed carve-out may accompany that copy in additional sibling sheets; those companions are delivery routes, not spec crossings.

The artifact-missing and url-unsupported documents load canonical v2 as [theme delivery](../themes/delivery.md) states, then carry one byte-identical embedded copy of their shared error-page sheet. That embedded sheet contains no duplicate foundation declarations.

The web build derives the canonical Hind filename from the byte-identical `packages/web/src/foundation/fonts/Hind-Variable.woff2` copy using canonical's digest rule ([canonical.md#^cn-cache-policy](../canonical.md#^cn-cache-policy)). The source entry document carries no digest or canonical font URL; the build step inserts exactly one `<link rel="preload" as="font" crossorigin>` with the derived `/canonical/v2/fonts/Hind-Variable.<digest>.woff2` URL into the built shell entry document. The preload is unconditional. When a server has no production canonical mount or serves only unbuilt canonical sources, the missing content-addressed URL returns `404`; that failed optional hint is inert, and the shell and its artifact frames continue loading normally.

## Anchored placement

An anchored popover must not sit inside a persistently transformed ancestor on shipped engines: Chromium 134 and earlier resolve the anchor from pre-transform geometry ([Chromium issue 382294252](https://issues.chromium.org/issues/382294252)). Centering and offsets that coexist with anchored popovers therefore live in scroll position.

## Electron drag regions

The foundation delivery also carries the Electron drag-region convention. An element marked `electron-draggable` is a window drag region; its interactive descendants opt out so they still receive input, while ordinary descendants remain part of the grab area. The channel sidebar's titlebar uses this `electron-draggable` convention as the window's grab handle ([ui/app/sidebar/index.md#^sb-titlebar](../../ui/app/sidebar/index.md#^sb-titlebar)).

## Testing

Coverage of foundation distribution must inspect the real repository files. It must also run a fresh production web build from the same repository and inspect the output. Font-preload coverage must compose the source font bytes with outputs from fresh web and canonical builds.

Drag-region coverage must be accompanied by proof that the sidebar titlebar moves the native window in the real Electron app. The channel sidebar spec owns that proof.

