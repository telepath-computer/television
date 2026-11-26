*The onboarding architecture root: bundled content and build validation, the design bake, and the per-data-directory installer.*

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
| Installer | [installer.md](./installer.md) | State-file schema and migration, install algorithm, declared store data, initial pages, retry after a crash, marker, and focus |

Terms defined by this domain: *onboarding channel* is defined by [onboarding-channels.md](../../product/onboarding/onboarding-channels.md); *channel slug*, *artifact slug*, and *onboarding config* by [arch/onboarding/content.md](./content.md); *the bake* by [arch/onboarding/bake.md](./bake.md); *onboarding state file* and *onboarding channel marker* by [installer.md](./installer.md). The redesign has no onboarding tab-promotion behavior or browser promotion record.

## Identity model

The *channel slug* is the stable identity of an onboarding channel across releases and data directories. The content tree names each channel folder by slug; the state file records installs by slug; the `Channel` DTO's onboarding marker carries the slug. Display names, channel IDs, and artifact IDs serve their own domains, but reinstall suppression keys only on the slug.

## Testing

Each module's behavior is proven under the spec that owns it. This index does not require a separate test.
