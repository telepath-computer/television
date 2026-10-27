# Map

Map fills the artifact with an interactive map and a floating place list. Categories can give pins colours and default Lucide icons; numbered mode replaces pin glyphs with sorted positions. Leaflet 1.9.4 and the Map icon subset are included in this folder. Street, satellite, and hybrid tiles come from Esri and require network access.

## Store

An agent writes all data through `tv resource json`. The page subscribes to the whole store and never writes to it. A new Map starts with `{}`. An unwritten store, `null`, `{}`, or an empty `places` object shows the empty map and hides the place list.

The complete Draft 2020-12 JSON Schema is `dataSchema` in `manifest.json`. Its top-level fields are:

| Field | Meaning |
| --- | --- |
| `title` | Optional collection heading and document title. The defaults are Places and Map. |
| `subtitle` | Optional line below the heading. |
| `numbered` | Optional boolean. Shows one-based sorted positions on pins and rows; defaults to false. |
| `basemap` | `standard`, `satellite`, or `hybrid`; defaults to `standard`. |
| `sidebar` | `open` or `closed`; defaults to `open` when valid places exist. |
| `categories` | Optional category records keyed by stable letter-prefixed IDs. |
| `places` | Optional place records keyed by stable letter-prefixed IDs. |

A category requires `name`. Its optional `icon` is the default for places in that category. Its optional `color` is one of `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`, or `neutral`. Categories without a valid explicit colour receive those colours in JSON store key order; explicitly coloured categories do not consume an automatic slot.

A place requires `title`, `lat`, and `lng`. Latitude is from −90 to 90 and longitude from −180 to 180. Optional `order` sorts ascending, with omitted values last and keys breaking ties. Optional `category` names a category key. Optional `icon` overrides a known category's icon. Optional `description` appears in the list and details. Optional `photo` is an HTTPS URL or a safe path inside the copied artifact folder. Optional `credit` requires `text` and can include an HTTPS `url`. Optional `fields` maps detail labels to any JSON values; objects and arrays display as JSON, and empty values display as a dash.

Whenever keys determine order, Map uses the JSON store's key order: whole-number keys without leading zeros come first numerically, followed by other keys in UTF-16 order.

The schema requires category and place keys to start with a letter and contain only letters, digits, `_`, and `-`. Choose keys explicitly with `set`; JSON-store push IDs start with `-` and do not fit this schema.

All visible values render as plain text. Relative photo paths can begin with `./` and can contain spaces inside filenames. They cannot use absolute paths, edge whitespace, empty path segments, `.` or `..` segments, backslashes, colons, percent escapes, query strings, fragments, or control characters U+0000–U+001F. Remote photos and credit links must use HTTPS and cannot contain whitespace or control characters U+0000–U+001F. Include the creator and licence in `credit.text` when a photo requires attribution.

Writes after creation are not schema-validated. When the page reads a later value, a named value that does not fit the schema is treated as absent, and properties the schema does not name are ignored. A `categories` or `places` value that is not an object is absent. Places are the key exception: a usable place under any store key appears on the map, including one under a push ID. Badly keyed categories and categories without a usable `name` are ignored. A place without usable `lat` and `lng` coordinates is omitted.

An empty or unusable place title displays as Untitled place. Unknown categories are uncategorised. An uncategorised place uses the theme accent colour and pin glyph, even if its own `icon` names another glyph. An unknown place icon inherits a valid category icon; an unknown category icon becomes `pin`. Unusable optional text, media, credit, or fields are omitted. The page never repairs the store.

## Example and commands

This short value defines one category and one place without adding sample data to new Maps:

```json
{
  "title": "San Francisco",
  "categories": {
    "landmarks": { "name": "Landmarks", "icon": "landmark", "color": "blue" }
  },
  "places": {
    "golden-gate": {
      "title": "Golden Gate Bridge",
      "lat": 37.81972,
      "lng": -122.47861,
      "order": 1,
      "category": "landmarks",
      "icon": "bridge",
      "description": "A suspension bridge across the Golden Gate."
    }
  }
}
```

Create an empty Map, then add, change, or remove named records:

```sh
tv create-artifact --template map --channel <channel-id> --focus-artifact

ARTIFACT_ID="<artifact-id>"
tv resource json set --artifact "$ARTIFACT_ID" categories/landmarks '{"name":"Landmarks","icon":"landmark","color":"blue"}'
tv resource json set --artifact "$ARTIFACT_ID" places/place-01 '{"title":"Golden Gate Bridge","lat":37.81972,"lng":-122.47861,"category":"landmarks","icon":"bridge"}'
tv resource json set --artifact "$ARTIFACT_ID" places/place-01/title '"Golden Gate Bridge"'
tv resource json remove --artifact "$ARTIFACT_ID" places/place-01
```

To replace the complete value, use `tv resource json set --artifact "$ARTIFACT_ID" --file map.json`. Store a local photo in the copied artifact folder before referring to it by relative path.

## Categories, icons, and interaction

Supported icons are `pin`, `landmark`, `museum`, `restaurant`, `coffee`, `bar`, `hotel`, `park`, `beach`, `mountain`, `viewpoint`, `shop`, `airport`, `train`, `bus`, `parking`, `hospital`, `school`, `home`, `work`, `star`, `heart`, `flag`, `music`, `theatre`, `sports`, `church`, `bridge`, `ferry`, and `info`. `icons.svg` shows the set, and `vendor/lucide/README.md` records the upstream drawing for each name.

Select a row or pin to open details. The filter matches a place's title, category, and description without changing the store. The sidebar becomes a draggable three-height sheet in narrow windows. Standard, Satellite, and Hybrid layers, pan and zoom, the filter, selection, sidebar and sheet position, and expanded overlapping pins are viewer-local. A local sidebar or basemap choice survives unrelated data updates. A later stored `sidebar` or `basemap` value overrides the corresponding local choice.

Press **F** to fit all places. **Escape** closes the layers menu or details, or clears a focused filter. Place rows support arrow keys, Home, End, Enter, and Space. The map supports Leaflet's arrow and zoom keys. Motion follows `prefers-reduced-motion`, and colours follow Television's active theme.

The page keeps the last good map during a normal disconnect or after access to a shared store is revoked. Data in a form the page cannot read shows an alert without changing the store. A readable value or restored connection can recover the page.

## Third-party material

Leaflet is BSD-2-Clause. The Lucide subset is ISC and includes inherited Feather material under MIT. Complete notices travel with the copied artifact in `THIRD-PARTY-NOTICES.txt`; upstream licence and provenance files remain in `vendor/`.
