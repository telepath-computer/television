*Proves the bundled artifact template inventory against the source manifests and exported IDs.*

# Bundled artifact templates — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

Contract checks read the real bundled manifests and exported inventory without mocks. [Checklist](./checklist.md) and [Sticky note](./sticky-note.md) package proofs own display options, starting data, page delivery, and guidance; [bundled installation](./bundled-installation.md) owns build membership and boot replacement. [Telemetry derivation](../telemetry/derivation.md#^t-template-classify) proves classification against the closed ID vocabulary.

The two-template inventory assertion remains to be implemented; the existing Checklist-only test supplies its starting coverage.

## Test hooks

The inventory contract reads the actual bundled files and exported IDs; it replaces no production dependency.

## Inventory

- **Contract** (real source folders, manifests, and exported inventory; no mocks): Under [the inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the bundled folder IDs are exactly `checklist` and `sticky-note`, and `BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'sticky-note']`. Both initial manifest versions and minimum installed versions are `1.0.0`. Checklist declares `Checklist` and `A list of items to tick off and edit.`; Sticky note declares `Sticky note` and `A yellow note to type into; an agent can write on it too.` *(test to be written)*: extend `packages/server/test/checklist-template.test.ts`, replacing “ships only Checklist with its exact inventory identity and minimum version” with “ships Checklist and Sticky note with their exact inventory identities and minimum versions”; retain its existing Checklist identity checks. ^templates-bundled-t-inventory
