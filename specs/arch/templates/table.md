*The bundled Table artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Table artifact template

Table is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Table UI spec](../../ui/templates/table.mdx) owns the page appearance and interaction.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template `data.json` seeds the artifact [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"rows":{}}`. Agents write the value, so it has a contract: the manifest `dataSchema`, which is this schema. ^bundled-artifact-template-table-store

```json
{
  "type": "object",
  "required": ["rows"],
  "properties": {
    "rows": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["order"],
        "properties": {
          "order": { "type": "number" }
        }
      }
    }
  }
}
```

The schema leaves every field other than `order` unconstrained so a row can hold any JSON cell value. Extra root fields are allowed and ignored. [Creating an artifact](./index.md#^artifact-template-schema) from the template rejects starting data that breaks the schema; writes after creation are not checked against it.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. It treats each `rows` key as a stable row key, but never displays that key. Rows sort by ascending `order`, then by key when two orders match; `order` is not a visible column. Every other row field is a cell. Columns follow the order in which cell names first appear across stored rows in that base order. Search, column sorting and row selection affect the page only. A value as a whole follows the contract when it is an object whose `rows` is an object and every row is an object with a finite numeric `order`. A value that does not, or no value, is shown as the [Table UI spec](../../ui/templates/table.mdx#data-the-page-cannot-read) describes. ^bundled-artifact-template-table-behaviour

## Packaged page and guidance

The page loads Television canonical stylesheet, components and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. The manifest `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-table-page

The bundled `README.md` explains the root, rows, hidden keys, ordering and cell fields. It gives `tv resource json` commands to add a row, change a cell, remove a row and clear the table. It says that the page follows changes live without writing, that search and sorting stay in the page, that invalid data is not repaired, and that copied artifacts are independent. It points an adapting agent to the local modules and foundation-token stylesheet. ^bundled-artifact-template-table-readme
