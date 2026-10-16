*The bundled Example artifact template: its ID, manifest, starting store value, page behavior, and adapting-agent guidance.*

# Bundled artifact template

Television ships one [bundled artifact template](../../product/templates.md#^artifact-template-bundled). It follows the ordinary [folder and copy contract](./index.md#^artifact-template-package); [bundled installation](./bundled-installation.md) owns when an installed copy is kept or replaced.

| Folder ID | Manifest `name` | Manifest `description` | Initial `version` | Minimum installed version |
|---|---|---|---|---|
| `example` | Example | A live message that an agent can change. | `1.0.0` | `1.0.0` |

`BUNDLED_ARTIFACT_TEMPLATE_IDS` is the readonly tuple `['example']`; [telemetry](../telemetry/derivation.md#^artifact-template-telemetry-derivation) uses this closed vocabulary. ^bundled-artifact-template-inventory

Its `data.json` seeds the artifact's [own JSON store](../../product/resources/resources.md#^rs-own-store) with this value:

```ts
interface ExampleData {
  message: string;
}
```

```json
{"message":"Hello from a template."}
```

The page loads Television's canonical stylesheet as the `television` skill describes. It reads `message` through the [resource SDK](../resources/sdk.md) and shows it as text. It subscribes to store changes, so an agent's [`tv resource json`](../../product/resources/json-store.md#^js-cli) write updates the open page. The person makes no edits in the page. ^bundled-artifact-template-example

Its `README.md` tells an adapting agent: “The page shows the `message` string in this artifact's JSON store; use `tv resource json` to change it.”
