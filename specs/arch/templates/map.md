*The bundled Map artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Map artifact template

Map is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions.

This spec owns what the store means and what the page shows, omits, falls back to, or reports. Until a Map UI spec exists, presentation remains code-authoritative under the [migration map](../../spec-migration.md): layout, styling, wording, controls, and keys are outside this contract.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The bundled `data.json` must contain `{}`, which becomes the starting value in the [JSON store owned by the artifact](../../product/resources/resources.md#^rs-own-store). The `dataSchema` in the bundled manifest is exactly this schema: ^bundled-artifact-template-map-store

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Map store",
  "description": "An agent-owned collection of places.",
  "type": ["object", "null"],
  "additionalProperties": false,
  "properties": {
    "title": {
      "type": "string",
      "description": "Collection heading and document title. An empty or omitted value uses the fallback heading and document title defined by the page."
    },
    "subtitle": { "type": "string", "description": "Optional supporting line below the map heading." },
    "numbered": {
      "type": "boolean", "default": false,
      "description": "Show the one-based sorted position on pins and in the list."
    },
    "basemap": {
      "type": "string", "enum": ["standard", "satellite", "hybrid"], "default": "standard",
      "description": "Stored map layer. Hybrid adds Esri boundaries and place labels to satellite imagery."
    },
    "sidebar": {
      "type": "string", "enum": ["open", "closed"], "default": "open",
      "description": "Stored sidebar visibility. The sidebar is hidden when there are no valid places; the viewer can change visibility locally."
    },
    "categories": {
      "type": "object",
      "description": "Optional category definitions keyed by stable letter-prefixed IDs. Place category fields refer to these keys. Without categories, places use the theme accent colour and pin glyph, with no category pill.",
      "propertyNames": { "pattern": "^[A-Za-z][A-Za-z0-9_-]*$" },
      "additionalProperties": { "$ref": "#/$defs/category" }
    },
    "places": {
      "type": "object",
      "description": "Places keyed by stable letter-prefixed IDs, such as place-01. Omission or an empty object shows the empty state.",
      "propertyNames": { "pattern": "^[A-Za-z][A-Za-z0-9_-]*$" },
      "additionalProperties": { "$ref": "#/$defs/place" }
    }
  },
  "$defs": {
    "icon": {
      "type": "string",
      "enum": [
        "pin", "landmark", "museum", "restaurant", "coffee", "bar", "hotel", "park", "beach", "mountain",
        "viewpoint", "shop", "airport", "train", "bus", "parking", "hospital", "school", "home", "work",
        "star", "heart", "flag", "music", "theatre", "sports", "church", "bridge", "ferry", "info"
      ]
    },
    "category": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string", "minLength": 1,
          "description": "Category label shown in the list and details and matched by the place filter."
        },
        "icon": {
          "$ref": "#/$defs/icon", "default": "pin",
          "description": "Default icon for places in this category. A place icon can override it."
        },
        "color": {
          "type": "string", "enum": ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "neutral"],
          "description": "Category colour from the Television foundation palette. If omitted, the page assigns colours to categories lacking an explicit colour in sorted-key order, cycling through the enum; explicit colours do not consume slots."
        }
      }
    },
    "place": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "lat", "lng"],
      "properties": {
        "title": {
          "type": "string", "minLength": 1,
          "description": "Place name in the list, pin label, and details."
        },
        "lat": { "type": "number", "minimum": -90, "maximum": 90, "description": "WGS84 latitude in degrees." },
        "lng": { "type": "number", "minimum": -180, "maximum": 180, "description": "WGS84 longitude in degrees." },
        "order": {
          "type": "number",
          "description": "Sort ascending; omitted values come last. Keys break ties. Displayed numbers use the sorted position, not this value."
        },
        "icon": {
          "$ref": "#/$defs/icon",
          "description": "Override the category icon for a place with a known category. Unknown or omitted categories use pin. Numbered mode displays the sorted number instead."
        },
        "category": {
          "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]*$",
          "description": "A key in the optional categories map. A missing categories map or an omitted or unknown key is uncategorised, using the theme accent colour and pin glyph with no category pill. Explicit neutral categories use the neutral palette colour."
        },
        "description": {
          "type": "string",
          "description": "Optional place description shown in the list and details."
        },
        "photo": {
          "type": "string",
          "description": "An HTTPS URL or path inside the artifact folder. Relative paths may start with ./ and cannot contain edge whitespace, dot segments, percent escapes, query strings, or fragments.",
          "anyOf": [
            { "pattern": "^https://[^\\s/?#]+(?:[/?#][^\\s]*)?$" },
            { "pattern": "^(?:\\./)?(?!\\s)(?!.*\\s$)(?!\\.{1,2}(?:/|$))[^/\\\\:%?#\\u0000-\\u001F]+(?:/(?!\\.{1,2}(?:/|$))[^/\\\\:%?#\\u0000-\\u001F]+)*$" }
          ]
        },
        "credit": {
          "type": "object", "additionalProperties": false, "required": ["text"],
          "properties": {
            "text": {
              "type": "string", "minLength": 1,
              "description": "Full photo credit, including the creator and licence where required."
            },
            "url": {
              "type": "string", "pattern": "^https://[^\\s/?#]+(?:[/?#][^\\s]*)?$",
              "description": "HTTPS link to the photo source or licence."
            }
          }
        },
        "fields": {
          "type": "object", "additionalProperties": true,
          "description": "Detail labels mapped to any JSON values. Arrays and objects are serialized; empty values use the empty-value fallback defined by the page."
        }
      }
    }
  }
}
```

[Creating an artifact](./index.md#^artifact-template-schema) rejects starting data that breaks the schema; writes after creation are not checked against it.

When the page reads a later value, it ignores properties the schema does not name. It ignores category and place entries whose keys do not match the letter-first key pattern. It omits a place whose coordinates are not finite numbers inside the latitude and longitude ranges. An empty or unusable title uses the untitled-place fallback defined by the page; an unknown category is uncategorised; an unknown place icon inherits a valid category icon; an unknown category icon falls back to a pin; and a missing or unknown category colour uses the deterministic automatic colour. Unusable descriptions, photos, credits, or `fields` are omitted. ^bundled-artifact-template-map-later-values

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Filters, selection, sheet position, expanded overlapping pins, sidebar position, and the selected basemap are viewer-local. A later change to stored `sidebar` or `basemap` applies to the open page and overrides the corresponding viewer choice.

A missing, null, or empty store shows the empty map. A root value that is neither null nor an ordinary object shows an unreadable-data alert; a later readable value restores the map. A normal disconnection keeps the last good map without a message and catches up after reconnection. If the SDK listener ends with `no-store`, the page keeps the last good map. If the listener ends with any other SDK error, the page shows the unreadable-data alert; after a later reconnection, it starts a new subscription. The page does not repair the store. ^bundled-artifact-template-map-runtime

## Packaged page and guidance

The page loads the Television canonical stylesheet before `map.css`, loads the resource SDK, and keeps Leaflet and the Lucide icon subset inside the template folder so copied artifacts work independently. Leaflet requests street, satellite, and label tiles from Esri and displays the attribution configured for each layer. The vendored assets follow the [folder-notices rule](../licensing.md#^licensing-folder-notices). The `icons` field in the manifest lists one entry, `icon.svg`, which is a square SVG; [icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-map-page

The bundled `README.md` explains every top-level store field and the category and place fields above, the empty starting store, sorting and fallback behavior, supported icon and colour names, safe photo and credit values, viewer-local interaction, external tile requirement, and live read-only subscription. It gives `tv resource json set` and `remove` examples that write at specific paths. It includes a short inline example; the bundle contains no example places or photos. Place and category keys are chosen explicitly because JSON-store push IDs do not fit the letter-prefixed key rule in the schema. ^bundled-artifact-template-map-readme

## Testing guidance

Real-stack tests abort requests to the configured Esri tile host. They cover the copied page, resource SDK, server, and store without depending on the network, and make no claim about rendered tile images. ^bundled-artifact-template-map-testing
