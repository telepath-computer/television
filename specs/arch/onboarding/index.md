*The onboarding architecture root: bundled content and build validation, the design bake, the per-data-directory installer, and the contracts this feature imposes on architecture modules that do not yet have their own specs.*

**Status:** adopted onboarding architecture.

# Onboarding architecture

Television carries starter-channel content from the release package into each serving data directory. This document maps the parts that author, package, install, remember, and expose that content.

## What this owns

The architecture that delivers [onboarding-channels.md](../../product/onboarding/onboarding-channels.md)'s product behavior:

| Module | Spec | Owns |
|---|---|---|
| Content and server packaging | [arch/onboarding/content.md](./content.md) | Content tree, version-3 config, slugs, artifact order, declared store data, and server build validation |
| CLI packaging and resolution | [arch/cli/index.md#Build and packaged asset layout](../cli/index.md#Build and packaged asset layout) | Copying validated output into the CLI package and resolving it when `tv serve` starts |
| Design bake | [arch/onboarding/bake.md](./bake.md) | The manually run script that renders onboarding frames into the content tree and config |
| Installer | [installer.md](./installer.md) | State-file schema and migration, install algorithm, declared store data, initial pages, retry after a crash, marker, focus, and default-channel invariant |

Terms defined by this domain: *onboarding channel* is defined by [onboarding-channels.md](../../product/onboarding/onboarding-channels.md); *channel slug*, *artifact slug*, and *onboarding config* by [arch/onboarding/content.md](./content.md); *the bake* by [arch/onboarding/bake.md](./bake.md); *onboarding state file* and *onboarding channel marker* by [installer.md](./installer.md). The redesign has no onboarding tab-promotion behavior or browser promotion record.

## Identity model

The *channel slug* is the stable identity of an onboarding channel across releases and data directories. The content tree names each channel folder by slug; the state file records installs by slug; the `Channel` DTO's onboarding marker carries the slug. Display names, channel IDs, and artifact IDs serve their own domains, but reinstall suppression keys only on the slug.

## Testing

Each module's behavior is proven under the spec that owns it. This index does not require a separate test.

## Buffer: impositions on modules without specs

Some onboarding contracts belong to modules that have no architecture spec yet: server-store bootstrap, the storage `state/` directory, and the shared `Channel` type. Until those specs exist, [installer.md](./installer.md) carries their obligations in marked buffer sections:

- `ServerStore` options and bootstrap ordering;
- `state/onboarding.json` and the legacy sentinel path;
- the optional slug-only `Channel.onboarding` marker and its public-API read-only rule.

A buffer is authority. Its promises are covered by the installer assertions; this root does not create placeholder server or shared-client architecture around them. When an owning spec arrives, it can absorb the marked section and its existing assertion relationships.
