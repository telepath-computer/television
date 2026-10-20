*Proves the bundled artifact template inventory against the source manifests and exported IDs.*

# Bundled artifact templates — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

Contract checks read the real bundled manifests and exported inventory without mocks. [Checklist package coverage](./checklist.md) owns display size, starting data, page delivery, and guidance; [bundled installation](./bundled-installation.md) owns build membership and boot replacement. [Telemetry derivation](../telemetry/derivation.md#^t-template-classify) proves classification against the closed ID vocabulary. The inventory assertion is to be written; existing Example tests do not discharge it.

## Test hooks

The inventory contract reads the actual bundled files and exported IDs; it replaces no production dependency.

## Inventory

- **Contract** (real source folders, manifests, and exported inventory; no mocks): Under [the inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the only bundled ID is `checklist`, the readonly tuple is `['checklist']`, the inventory records minimum installed version `1.0.0`, and the manifest declares `Checklist`, `A list of items to tick off and edit.`, and version `1.0.0`. *(test to be written)* ^templates-bundled-t-inventory

## Retired assertion references

The following anchors remain only because existing test code still cites them. They order no Example behavior and provide no Checklist evidence; remove them when those tests are replaced during implementation.

The Example package assertion is retired; the current obligation is [the Checklist package contract](./checklist.md#^templates-checklist-t-package). ^templates-example-t-package

The Example assertion forbidding manifest display options is retired; Checklist requires the display values in [the package contract](./checklist.md#^templates-checklist-t-package). ^templates-example-t-no-display

The Example message-only page assertion is retired; [Checklist UI acceptance](../../ui/templates/checklist/index.md) owns the replacement page. ^templates-example-ac-live
