*Proves the bundled artifact template inventory against the source manifests and exported IDs.*

# Bundled artifact templates — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

Contract checks read the real bundled manifests and exported inventory without mocks. [Checklist package coverage](./checklist.md) owns display size, starting data, page delivery, and guidance; [bundled installation](./bundled-installation.md) owns build membership and boot replacement. [Telemetry derivation](../telemetry/derivation.md#^t-template-classify) proves classification against the closed ID vocabulary.

## Test hooks

The inventory contract reads the actual bundled files and exported IDs; it replaces no production dependency.

## Inventory

- **Contract** (real source folders, manifests, and exported inventory; no mocks): Under [the inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the only bundled ID is `checklist`, the readonly tuple is `['checklist']`, the inventory records minimum installed version `1.0.0`, and the manifest declares `Checklist`, `A list of items to tick off and edit.`, and version `1.0.0`. *(policy-grade test: `packages/server/test/checklist-template.test.ts`, “ships only Checklist with its exact inventory identity and minimum version”)* ^templates-bundled-t-inventory
