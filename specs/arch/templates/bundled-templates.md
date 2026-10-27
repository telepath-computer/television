*The bundled artifact template inventory and shared rules.*

# Bundled artifact templates

Television ships these [artifact templates](../../product/templates.md#^artifact-template-bundled). They follow the ordinary [folder and copy contract](./index.md#^artifact-template-package); [bundled installation](./bundled-installation.md) owns when an installed copy is kept or replaced.

| Folder ID | Manifest `name` | Manifest `description` | Initial `version` | Minimum installed version | Architecture spec | UI spec |
|---|---|---|---|---|---|---|
| `checklist` | Checklist | A list of items to tick off and edit. | `1.0.0` | `1.0.0` | [Checklist](./checklist.md) | [Checklist page](../../ui/templates/checklist.mdx) |
| `calendar` | Calendar | Show one to seven days of live events, including all-day events and highlighted moments. | `1.0.0` | `1.0.0` | [Calendar](./calendar.md) | [Calendar page](../../ui/templates/calendar.mdx) |
| `sticky-note` | Sticky note | A yellow note to type into; an agent can write on it too. | `1.0.0` | `1.0.0` | [Sticky note](./sticky-note.md) | [Sticky note page](../../ui/templates/sticky-note.mdx) |
| `map` | Map | An interactive map with category colours and icons, a floating place list, photos, and detailed place information. | `2.0.0` | `2.0.0` | [Map](./map.md) | [Code-authoritative](../../spec-migration.md) |

`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist', 'calendar', 'sticky-note', 'map']`; [telemetry](../telemetry/derivation.md#^artifact-template-telemetry-derivation) uses this closed vocabulary. ^bundled-artifact-template-inventory
