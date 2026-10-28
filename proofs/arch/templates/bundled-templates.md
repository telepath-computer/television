*Proves the bundled artifact template inventory against the source manifests and exported IDs.*

# Bundled artifact templates — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

Contract checks read the real bundled manifests and exported inventory without mocks. [Checklist](./checklist.md), [Calendar](./calendar.md), [Sticky note](./sticky-note.md), and [Table](./table.md) package proofs own display options, starting data, page delivery, and guidance; [bundled installation](./bundled-installation.md) owns build membership and boot replacement. [Telemetry derivation](../telemetry/derivation.md#^t-template-classify) proves classification against the closed ID vocabulary.

The inventory assertion covers all four bundled templates and retains the Checklist package checks.

## Test hooks

The inventory contract reads the actual bundled files and exported IDs; it replaces no production dependency.

## Inventory

- **Contract** (real source folders, manifests, and exported inventory; no mocks): Under [the inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the bundled folder IDs are exactly `checklist`, `calendar`, `sticky-note`, and `table`, and `BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'calendar', 'sticky-note', 'table']`. All initial manifest versions and minimum installed versions are `1.0.0`. Checklist declares `Checklist` and `A list of items to tick off and edit.`; Calendar declares `Calendar` and `Show one to seven days of live events, including all-day events and highlighted moments.`; Sticky note declares `Sticky note` and `A yellow note to type into; an agent can write on it too.`; Table declares `Table` and `An editable table to fill by hand or with an agent.` *(policy-grade test: `packages/server/test/checklist-template.test.ts`, “ships Checklist, Calendar, Sticky note and Table with their exact inventory identities and minimum versions”)*. ^templates-bundled-t-inventory
