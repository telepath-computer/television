*The bundled artifact template inventory and shared rules.*

# Bundled artifact templates

Television ships these [artifact templates](../../product/templates.md#^artifact-template-bundled). They follow the ordinary [folder and copy contract](./index.md#^artifact-template-package); [bundled installation](./bundled-installation.md) owns when an installed copy is kept or replaced.

| Folder ID | Manifest `name` | Manifest `description` | Initial `version` | Minimum installed version | Architecture spec | UI spec |
|---|---|---|---|---|---|---|
| `checklist` | Checklist | A list of items to tick off and edit. | `1.0.0` | `1.0.0` | [Checklist](./checklist.md) | [Checklist page](../../ui/templates/checklist.mdx) |

`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['checklist']`; [telemetry](../telemetry/derivation.md#^artifact-template-telemetry-derivation) uses this closed vocabulary. ^bundled-artifact-template-inventory
