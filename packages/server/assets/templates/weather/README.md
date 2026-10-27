# Weather

Weather starts with the empty root object `{}`. Set a location by replacing the whole JSON store:

```sh
tv resource json set --artifact "$ARTIFACT_ID" '{"place":"San Francisco","latitude":37.7749,"longitude":-122.4194,"units":"celsius"}'
```

The fields owned by a person or agent are:

- `place`: the name shown on the card.
- `latitude`: a WGS84 latitude from -90 to 90.
- `longitude`: a WGS84 longitude from -180 to 180.
- `units`: either `celsius` or `fahrenheit`.

Town-level coordinates are usually precise enough. Use finer coordinates only when the forecast needs them: every open card sends the coordinates and the viewer's IP address to Open-Meteo.

Change only the displayed name without fetching different weather:

```sh
tv resource json set --artifact "$ARTIFACT_ID" place '"San Francisco Bay Area"'
```

Change both coordinates together when moving the card to another place:

```sh
tv resource json update --artifact "$ARTIFACT_ID" '{"latitude":40.7128,"longitude":-74.006}'
```

Change units independently:

```sh
tv resource json set --artifact "$ARTIFACT_ID" units '"fahrenheit"'
```

Clear the card by replacing its root with `{}`, not `null`:

```sh
tv resource json set --artifact "$ARTIFACT_ID" '{}'
```

The page fetches forecasts from Open-Meteo and caches its last successful result in `forecast`. Do not write or edit `forecast`; the page owns it. Offline, the saved forecast remains visible and shows how long ago it was fetched. A read-only page fetches weather for itself but does not save it.

An external network request to Open-Meteo is required for each fresh forecast. Whenever the card shows forecast data, it visibly credits Open-Meteo and the CC BY 4.0 source data.

To adapt the design, edit `styles.css` and the first-party drawings in `artwork.svg` and `icon.svg`. The document background is transparent so the rounded card floats in the artifact frame when the manifest display setting is applied at creation.
