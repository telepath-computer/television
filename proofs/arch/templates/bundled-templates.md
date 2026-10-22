*Proves the bundled artifact template inventory against the source manifests and exported IDs.*

# Bundled artifact templates — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

Contract checks read the real bundled manifests and exported inventory without mocks. [Checklist package coverage](./checklist.md) owns the Checklist's display size, starting data, page delivery, and guidance; [Calendar package coverage](./calendar.md) owns the Calendar's; [bundled installation](./bundled-installation.md) owns build membership and boot replacement. [Telemetry derivation](../telemetry/derivation.md#^t-template-classify) proves classification against the closed ID vocabulary.

## Test hooks

The inventory contract reads the actual bundled files and exported IDs; it replaces no production dependency.

## Inventory

- **Contract** (real source folders, manifests, and exported inventory; no mocks): Under [the inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the bundled IDs are `checklist` and `calendar`, the readonly tuple is `['checklist', 'calendar']`, the inventory records minimum installed version `1.0.0` for each, and the manifests declare the names, descriptions, and version `1.0.0` the inventory lists. *(policy-grade test: `packages/server/test/checklist-template.test.ts`, “ships Checklist and Calendar with their exact inventory identities and minimum versions”)* ^templates-bundled-t-inventory
