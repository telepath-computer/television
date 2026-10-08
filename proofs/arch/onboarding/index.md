*How the promises in Onboarding architecture are proven.*

# Onboarding architecture — proof

Proves [specs/arch/onboarding/index.md](../../../specs/arch/onboarding/index.md).

## Coverage model


The product spec owns the runtime spine at built-CLI and real-browser boundaries. Architecture breadth composes across three seams:

- **Validated content into the binary.** [arch/onboarding/content.md](../../../specs/arch/onboarding/content.md) owns source/config validation, including declared store data; [arch/cli/index.md#^t-valid-tree-ships](../cli/index.md#^t-valid-tree-ships) owns byte-identical server and CLI packaging.
- **Serving CLI into store bootstrap.** [arch/cli/index.md#^t-resolution](../cli/index.md#^t-resolution) crosses the packaged path into a real serving store; [installer.md](../../../specs/arch/onboarding/installer.md) owns store-side migration, install, declared-store, failure, and bootstrap contracts.
- **Installer marker onto server transports.** [installer.md](../../../specs/arch/onboarding/installer.md) owns marker persistence, API read-only behavior, HTTP responses, and websocket events. The marker has no browser consumer because onboarding channels appear in the ordinary unpinned channel list without a promotion pass; it remains install identity and agent-visible metadata.

The bake is authoring tooling outside the runtime path. [arch/onboarding/bake.md](../../../specs/arch/onboarding/bake.md) owns its spawned-process success and failure paths, transformation breadth, and real validator handoff. Runtime delivery does not depend on whether committed content was baked or written by hand.

## Assertions

### Test assertions

This root is a module map and ownership boundary. It introduces no separate test assertion beyond the product, content, installer, bake, and CLI assertions linked above. The buffer promises are ordinary installer authority and are tested there; repeating them here would order duplicate coverage.

