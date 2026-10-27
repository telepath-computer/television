*Proves the bundled artifact template inventory against the source manifests and exported IDs.*

# Bundled artifact templates — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

Contract checks read the real bundled manifests and exported inventory without mocks. [Checklist](./checklist.md), [Calendar](./calendar.md), [Sticky note](./sticky-note.md), and [Map](./map.md) package proofs own display options, starting data, page delivery, and guidance; [bundled installation](./bundled-installation.md) owns build membership and boot replacement. [Telemetry derivation](../telemetry/derivation.md#^t-template-classify) proves classification against the closed ID vocabulary.

The inventory assertion covers all four bundled templates and retains the Checklist package checks.

## Test hooks

The inventory contract reads the actual bundled files and exported IDs; it replaces no production dependency.

## Inventory

- **Contract** (real source folders, manifests, and exported inventory; no mocks): Under [the inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the bundled folder IDs are exactly `checklist`, `calendar`, `sticky-note`, and `map`, and `BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'calendar', 'sticky-note', 'map']`. Checklist, Calendar, and Sticky note start at and require `1.0.0`; Map starts at and requires `2.1.0`. Each manifest declares the exact name and description in the inventory. *(policy-grade test: `packages/server/test/checklist-template.test.ts`, “ships Checklist, Calendar, Sticky note and Map with their exact inventory identities and minimum versions”)*. ^templates-bundled-t-inventory
