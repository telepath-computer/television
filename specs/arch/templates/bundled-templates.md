*The bundled Example artifact template: its ID, manifest with dataSchema, empty-state message, and agent guidance.*

# Bundled artifact template

Television ships one [bundled artifact template](../../product/templates.md#^artifact-template-bundled). It follows the ordinary [folder contract](./index.md#^artifact-template-package); [bundled installation](./bundled-installation.md) owns when an installed copy is kept or replaced.

| Folder ID | Manifest `name` | Manifest `description` | Initial `version` | Minimum installed version |
|---|---|---|---|---|
| `example` | Example | A live message that an agent can change. | `1.0.0` | `1.0.0` |

The bundled source manifest for Example declares no `display`.

`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['example']`; [telemetry](../telemetry/derivation.md#^artifact-template-telemetry-derivation) uses this closed vocabulary. ^bundled-artifact-template-inventory

The manifest omits `url`, and the bundled folder contains no `data.json`. Each new artifact starts with an unwritten store unless the caller supplies data. The manifest declares this `dataSchema`, following the [template schema contract](./index.md#^artifact-template-schema):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "message": { "type": "string" } },
  "required": ["message"]
}
```

The page loads the canonical Television stylesheet as the `television` skill describes. It reads `message` through the [resource SDK](../resources/sdk.md) and displays it as text, including an empty string. When no string is available, it displays “Hello from a template.” without writing to the store. It subscribes to store changes, so an agent write with [`tv resource json`](../../product/resources/json-store.md#^js-cli) updates the open page. The person makes no edits in the page. ^bundled-artifact-template-example

Its `README.md` explains that `message` is a string in the store belonging to each artifact, that `tv resource json` changes that message, and that an agent edits the copied page files directly to change one artifact.
