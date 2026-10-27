*The bundled Map artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Map artifact template

Map is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The page's appearance and interaction remain code-authoritative under the [migration map](../../spec-migration.md).

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template's `data.json` seeds the artifact's [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{}`. Missing, null, and empty stores show an empty map with no place list. Agents write the value, so it has a contract: the manifest's `dataSchema`, which is this schema. ^bundled-artifact-template-map-store

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Map store",
  "description": "An agent-owned collection of places. Missing, null, and empty stores show an empty map; the page never writes defaults.",
  "type": [
    "object",
    "null"
  ],
  "additionalProperties": false,
  "properties": {
    "title": {
      "type": "string",
      "description": "Collection heading and document title. An empty or omitted value displays Places in the sidebar and Map as the document title."
    },
    "subtitle": {
      "type": "string",
      "description": "Optional supporting line below the map heading."
    },
    "numbered": {
      "type": "boolean",
      "default": false,
      "description": "Show the one-based sorted position on pins and in the list."
    },
    "basemap": {
      "type": "string",
      "enum": [
        "standard",
        "satellite",
        "hybrid"
      ],
      "default": "standard",
      "description": "Initial map layer. Hybrid adds Esri boundaries and place labels to satellite imagery."
    },
    "sidebar": {
      "type": "string",
      "enum": [
        "open",
        "closed"
      ],
      "default": "open",
      "description": "Initial sidebar visibility. The sidebar is hidden when there are no valid places; the viewer can change visibility locally."
    },
    "categories": {
      "type": "object",
      "description": "Optional category definitions keyed by stable letter-prefixed IDs. Place category fields refer to these keys. Without categories, places use the theme accent colour and pin glyph, with no category pill.",
      "propertyNames": {
        "pattern": "^[A-Za-z][A-Za-z0-9_-]*$"
      },
      "additionalProperties": {
        "$ref": "#/$defs/category"
      }
    },
    "places": {
      "type": "object",
      "description": "Places keyed by stable letter-prefixed IDs, such as place-01. Omission or an empty object shows the empty state.",
      "propertyNames": {
        "pattern": "^[A-Za-z][A-Za-z0-9_-]*$"
      },
      "additionalProperties": {
        "$ref": "#/$defs/place"
      }
    }
  },
  "$defs": {
    "icon": {
      "type": "string",
      "enum": [
        "pin",
        "landmark",
        "museum",
        "restaurant",
        "coffee",
        "bar",
        "hotel",
        "park",
        "beach",
        "mountain",
        "viewpoint",
        "shop",
        "airport",
        "train",
        "bus",
        "parking",
        "hospital",
        "school",
        "home",
        "work",
        "star",
        "heart",
        "flag",
        "music",
        "theatre",
        "sports",
        "church",
        "bridge",
        "ferry",
        "info"
      ]
    },
    "category": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "description": "Category label shown in the list and details and matched by the place filter."
        },
        "icon": {
          "$ref": "#/$defs/icon",
          "default": "pin",
          "description": "Default icon for places in this category. A place icon can override it."
        },
        "color": {
          "type": "string",
          "enum": [
            "red",
            "orange",
            "yellow",
            "green",
            "cyan",
            "blue",
            "purple",
            "pink",
            "neutral"
          ],
          "description": "Category colour from the Television foundation palette. If omitted, the page assigns colours to categories lacking an explicit colour in sorted-key order, cycling through the enum; explicit colours do not consume slots."
        }
      }
    },
    "place": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "title",
        "lat",
        "lng"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "description": "Place name in the list, pin label, and details."
        },
        "lat": {
          "type": "number",
          "minimum": -90,
          "maximum": 90,
          "description": "WGS84 latitude in degrees."
        },
        "lng": {
          "type": "number",
          "minimum": -180,
          "maximum": 180,
          "description": "WGS84 longitude in degrees."
        },
        "order": {
          "type": "number",
          "description": "Sort ascending; omitted values come last. Keys break ties. Displayed numbers use the sorted position, not this value."
        },
        "icon": {
          "$ref": "#/$defs/icon",
          "description": "Override the category icon for a place with a known category. Unknown or omitted categories use pin. Numbered mode displays the sorted number instead."
        },
        "category": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]*$",
          "description": "A key in the optional categories map. A missing categories map or an omitted or unknown key is uncategorised, using the theme accent colour and pin glyph with no category pill. Explicit neutral categories use the neutral palette colour."
        },
        "description": {
          "type": "string",
          "description": "Up to two lines of preview text in the list; the full text appears in details."
        },
        "photo": {
          "type": "string",
          "description": "An HTTPS URL or path inside the artifact folder. Relative paths may start with ./ and cannot contain edge whitespace, dot segments, percent escapes, query strings, or fragments.",
          "anyOf": [
            {
              "pattern": "^https://[^\\s/?#]+(?:[/?#][^\\s]*)?$"
            },
            {
              "pattern": "^(?:\\./)?(?!\\s)(?!.*\\s$)(?!\\.{1,2}(?:/|$))[^/\\\\:%?#\\u0000-\\u001F]+(?:/(?!\\.{1,2}(?:/|$))[^/\\\\:%?#\\u0000-\\u001F]+)*$"
            }
          ]
        },
        "credit": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "text"
          ],
          "properties": {
            "text": {
              "type": "string",
              "minLength": 1,
              "description": "Full photo credit, including the creator and licence where required."
            },
            "url": {
              "type": "string",
              "pattern": "^https://[^\\s/?#]+(?:[/?#][^\\s]*)?$",
              "description": "HTTPS link to the photo source or licence."
            }
          }
        },
        "fields": {
          "type": "object",
          "additionalProperties": true,
          "description": "Detail labels mapped to any JSON values. Arrays and objects display as JSON; empty values display as a dash."
        }
      }
    }
  }
}
```

The schema constrains starting data when [creating an artifact](./index.md#^artifact-template-schema). Writes after creation are not checked against it. For later values, the page omits a place whose coordinates are not finite numbers inside the latitude and longitude ranges. An empty or unusable title displays as `Untitled place`. An unknown category is uncategorised. An unknown place icon inherits a valid category icon, while an unknown category icon becomes a pin; a missing or unknown category colour uses the page's deterministic automatic colour; and unusable descriptions, photos, credits, or fields are omitted. The page does not write a repair. Places sort by `order`, with omitted values last and keys breaking ties. Displayed numbers use the resulting one-based position.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Filters, selection, sidebar and sheet position, expanded overlapping pins, and the selected basemap are viewer-local. A missing, null, or empty store is readable. A root value that is neither null nor an ordinary object shows an alert saying that the map cannot be shown because its saved data is not in the form the page reads. A normal disconnection keeps the last good map without a message and catches up after reconnection. A terminal loss of store access also keeps the last good map. Another terminal store error shows the same alert, makes no repair write, and starts a new subscription after reconnection. A later readable value restores the map. ^bundled-artifact-template-map-runtime

## Packaged page and guidance

The page loads Television's canonical stylesheet before `map.css`, loads the resource SDK, and includes Leaflet 1.9.4 and the Lucide icon subset inside the template folder so copied artifacts work independently. Leaflet requests street, satellite, and label tiles from Esri and displays the attribution configured for each layer. Automated store-behavior tests do not depend on that external service. The package and repository notices declare Leaflet under BSD-2-Clause, Lucide under ISC, and inherited Feather icon material under MIT. ^bundled-artifact-template-map-page

The manifest's `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied.

The bundled `README.md` explains every top-level store field and the category and place fields above, the empty starting store, sorting and fallback behavior, supported icon and colour names, safe photo and credit values, viewer-local interaction, external tile requirement, and live read-only subscription. It gives scoped `tv resource json set` and `remove` examples and a short inline example instead of shipping sample places or photos. Place and category keys are chosen explicitly because JSON-store push IDs do not fit the schema's letter-prefixed key rule. ^bundled-artifact-template-map-readme
