# Bundled Weather plan

## Status

Weather remains a proposed bundled artifact template. Rupert changed the data-source decision after the first implementation plan passed review, before implementation began. This revision returns the architecture and UI specs and their stories to independent spec review. The existing Weather proofs describe the superseded agent-written model and are intentionally left unchanged until the revised specs pass; implementation slices are withdrawn and will be derived again after the proofs are revised.

## Decisions Rupert made

1. **Open at 340 by 340 reference pixels.** This is now the decided default, with `transparent: true` retained in the draft. It is compact without making the three-character temperature treatment feel pinched.

   | 280 × 280 | **340 × 340 — selected** | 420 × 420 |
   | --- | --- | --- |
   | ![Weather at 280 by 280](weather-size-280.png) | ![Weather at 340 by 340](weather-size-340.png) | ![Weather at 420 by 420](weather-size-420.png) |

2. **Fetch forecasts in the page from Open-Meteo.** The store now holds the place name, latitude, longitude, units, and an optional page-owned saved forecast. Agents no longer fetch or write forecast values.
3. **Use Open-Meteo's free API.** Rupert judged Television to qualify because it is free and MIT-licensed, with no subscriptions or advertising, matching Open-Meteo's examples of non-commercial use.
4. **Credit the data visibly.** Open-Meteo data are under CC BY 4.0, so every card state carries the provider and licence credit.
5. **Treat 10,000 calls per day per IP address as a release constraint.** The provider also lists 5,000 calls per hour and 600 per minute. The release gate below keeps the aggregate effect of many open copies visible.

## Decisions made in this draft

These choices were necessary to turn Rupert's direction into one exact contract. They are recommendations until Rupert accepts the revised specs.

1. **Keep a normalized, page-owned `forecast` cache.** It retains the already reviewed `timeZone`, `updatedAt`, `current`, `hourly`, and `daily` shape, plus the requested coordinates and units. That lets the offline page keep the accepted time-zone, window, label, and display rules without exposing Open-Meteo's parallel response arrays to agents.
2. **Match a cache by coordinates and units, not the display name.** A different coordinate or unit can produce a wrong display and is ignored. A place-name-only change can safely show the saved values for the same coordinates and units while the refresh runs. Any change to the name, coordinates, or units still triggers the requested refresh.
3. **Do not add geocoding.** The agent supplies the human-readable name and WGS84 coordinates together. The page calls only the forecast endpoint, so it does not guess which place a name means or add another provider, request, failure mode, or licence.
4. **Make one seven-day request.** The exact request asks for current, hourly, and daily temperature, WMO weather code, and day/night fields, with `timezone=auto`, `timeformat=unixtime`, the selected temperature unit, and `forecast_days=7`. The returned hourly series is ample for the first 23 future entries without a second request.
5. **Use UNIX instants for daylight-saving correctness.** Hourly values become ISO instants and are formatted in the returned IANA time zone. Open-Meteo says daily UNIX values need its `utc_offset_seconds` applied to recover their dates, so daily cache entries use that date rather than passing a daily timestamp through the IANA zone and risking the `new Date('YYYY-MM-DD')` class of error near a clock change.
6. **Timestamp receipt, not model generation.** `updatedAt` is the page clock's instant after a complete response has been received and validated. It therefore means what the visible “Updated” label says: how long ago this page successfully refreshed.
7. **Require one internally complete response.** Unknown WMO codes, non-finite values, mismatched parallel-array lengths, wrong unit metadata, an invalid returned zone, bad JSON, HTTP errors, and network errors all count as failed requests. A failed response never partly replaces or corrupts a saved forecast.
8. **Map every documented forecast WMO code explicitly.** Codes 0, 1–2, 3, 45/48, liquid precipitation, frozen precipitation, and 95–99 map to `clear`, `partly-cloudy`, `cloudy`, `fog`, `rain`, `snow`, and `thunderstorm`. Current summaries preserve useful distinctions such as mainly clear, drizzle, heavy rain, rime fog, snow grains, and hail while the artwork stays within the seven-condition vocabulary.
9. **Pause the timer while the document is hidden.** A configured page fetches on open, on a relevant store change, and about every 15 minutes while visible. When it becomes visible, it fetches immediately if 15 minutes have elapsed since the last attempt; otherwise it waits out that interval. Failures do not create a faster retry loop. This follows “while it is showing” and reduces avoidable calls against the shared IP limit.
10. **Discard obsolete in-flight results.** A response for coordinates or units that changed while it was in flight is neither shown nor saved. A name-only change keeps it eligible because it still describes the same requested point and units.
11. **Save by a root transaction.** A writable copy preserves the current place and unknown fields, aborts when the coordinates or units changed, and does not replace a compatible cache with a later `updatedAt`. When two writable copies race, the successfully fetched candidate with the later fetch instant remains. This also prevents an old response from restoring a location an agent just changed.
12. **Let read-only copies fetch into memory.** They may start from a compatible saved forecast and replace it locally with a successful response, but make no write. A successful response remains visible if its attempted save loses access or the Television connection; a later scheduled success can save after access returns.
13. **Fail softly when a cache exists.** A provider failure keeps the compatible saved or in-memory forecast without an extra error label. Its unchanged age is the honest indication of staleness and avoids crowding the small card. With no compatible forecast, the page shows “Forecast unavailable” and says it will try again soon. The next scheduled attempt, reopening, or a configuration change can recover.
14. **Keep refreshing through a Television disconnection.** Once the page has read a location, the provider request does not depend on the store connection. Results stay in memory until a later successful fetch can be saved. Before the first store value arrives, a disconnected page remains loading as before.
15. **Use a compact but complete attribution line.** Every ready and placeholder card says `Open-Meteo data · adapted · CC BY 4.0`. The provider name and licence are links that open outside the artifact. “adapted” visibly records the condition mapping, selection, labels, and rounding required by CC BY 4.0.
16. **Change only the data-source-dependent placeholders.** Empty becomes “No location yet” because `{}` now means no configuration. Loading also covers a configured first fetch. A new unavailable story covers failure without a cache, and a saved-after-failure story shows the silent cached fallback. The accepted unreadable, appearance, condition, size, time-zone, accessibility, and layout designs remain.
17. **Keep automated tests entirely local.** Future browser tests must intercept every request to the Open-Meteo host, fulfill it from deterministic fixtures or abort it, and fail on an unexpected provider request. A live provider check is investigation evidence, not a test dependency.

## Design decisions carried forward

- The small, medium, and large layouts retain the 600-by-480 and 760-by-740 two-dimensional thresholds, the 230-pixel minimum treatment, and the wide-short composition.
- The hourly window begins with current conditions as “Now”; later cells and daily rows keep the accepted instant, time-zone, locale, deduplication, and current-date rules. Age, labels, windows, and current high and low follow the clock within one minute.
- The seven skies, first-party condition drawings, gradient-only backgrounds, white type, responsive temperature, range bars, transparent document, fixed placeholder sky, and theme treatment are unchanged.
- The page continues to use the foundation typography and spacing. The separate typography reading remains an open question below.
- The Toolbox icon remains first-party. The future package will still carry the Phosphor spinner and warning assets under the vendored-asset and folder-notices rules.

## What was verified

### Open-Meteo

- The official Forecast API endpoint is `https://api.open-meteo.com/v1/forecast`. Its documentation defines `latitude`, `longitude`, `current`, `hourly`, `daily`, `temperature_unit`, `timeformat`, `timezone`, and `forecast_days`, and documents the requested current, hourly, and daily fields.
- `timezone=auto` returns an IANA `timezone`; `timeformat=unixtime` returns epoch seconds. The documentation specifically says daily UNIX values need `utc_offset_seconds` applied to recover their dates and recommends UNIX instants for daylight-saving-aware conversion.
- The documented response is an object with coordinate and zone metadata, a `current` object, and parallel `hourly` and `daily` arrays. The live response on 27 October 2026 matched it, including `current_units`, `hourly_units`, and `daily_units`.
- The official WMO table includes codes 0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, and 99. The spec maps every one.
- The free endpoint needs no key. Open-Meteo's current terms say non-commercial use is limited to fewer than 10,000 calls per day, 5,000 per hour, and 600 per minute, applied by IP address and application. They put returned data under CC BY 4.0 and give private or non-profit apps without subscriptions or advertising as non-commercial examples.
- The terms say request logs can contain IP addresses, coordinates, and other request information and can be retained for up to 90 days. That disclosure belongs in the release decision because every configured page sends its coordinates directly to Open-Meteo.

### Television's frame

- Television's browser artifact iframe and response header use the same sandbox tokens and omit `allow-same-origin`, giving the page an opaque origin. Cross-origin requests therefore send `Origin: null`.
- Television's sandbox CSP contains only the `sandbox` directive; it has no `connect-src` restriction. The isolation spec identifies an external service's refusal of `Origin: null` as the relevant limitation.
- A live GET sent with `Origin: null` on 27 October 2026 returned `200`, the documented JSON shape, and `Access-Control-Allow-Origin: *` from Open-Meteo.
- A headless Chromium probe inside an iframe with Television's exact sandbox tokens reported `location.origin === "null"` and successfully fetched the endpoint. This verifies the browser path rather than inferring it from headers alone.
- Map supplies the repository precedent: its architecture spec names the external host, README obligation, offline limitation, and network-free browser testing rule; its working plan carries the unresolved provider permission, attribution, request disclosure, and release condition. Weather follows that shape, with the release gate below rather than treating CORS or current terms as permanent.

## Release gate

Weather must not be released until Rupert explicitly signs off on all four items together:

- [ ] **Free-API licence judgement:** Television remains within Open-Meteo's non-commercial examples—free, MIT-licensed, and without subscriptions or advertising—and may rely on the keyless free endpoint.
- [ ] **Attribution:** the visible `Open-Meteo data · adapted · CC BY 4.0` line and its provider and licence links are the approved CC BY 4.0 treatment for the transformed display.
- [ ] **Rate limit and availability:** a continuously visible copy makes about 96 scheduled calls a day, opening and configuration changes add calls, and Open-Meteo applies the 10,000/day limit by IP address and application with no free-tier uptime guarantee. Many open copies behind one IP can exhaust the shared allowance.
- [ ] **External request and disclosure:** each configured copy sends latitude, longitude, units, IP address, and ordinary request metadata directly to Open-Meteo; current terms allow request logs containing coordinates and IP addresses to be kept for up to 90 days. A provider or CORS change can stop fresh forecasts, leaving only the saved fallback.

As with Map's Esri gate, implementation review cannot substitute for this product and licence sign-off. If the terms, limits, attribution requirement, endpoint, or CORS policy changes before release, the gate must be reviewed again.

## Open questions for Rupert

1. **Should the widget float on a transparent artifact?** Recommendation: yes. The self-contained rounded sky card is the designed object, and transparency prevents an unrelated document surface from appearing around it.
2. **Are the 600-by-480 and 760-by-740 breakpoints right?** Recommendation: yes. Requiring both dimensions prevents an hourly or daily panel from appearing in a wide but too-short resize, while giving each layout a stable composition. The seven-row panel needs the 740-pixel height to keep every row legible at the exact boundary.
3. **Should app appearance ever recolour a populated card?** Recommendation: no. Day, night, and condition are more meaningful than app appearance for this object. The dark-appearance story proves that clear daylight remains clear daylight.
4. **Should Weather typography follow a theme that changes the foundation font?** Recommendation: Reading A—Weather follows the font selected by the active theme through the foundation, while its condition skies and artwork remain fixed. This matches the stories, which use `var(--font-sans)`. Reading B would keep the default foundation font under every theme. Keep the proof's link to this question during review, then replace it with the decided durable source during pre-merge docs prep because `docs/working/` is removed or archived at that stage.
5. **Is the seven-condition vocabulary enough for version 1?** Recommendation: yes. The exact WMO mapping covers every code the selected endpoint documents without multiplying artwork variants.
6. **Should the first version carry more weather facts?** Recommendation: no. Wind, precipitation totals, humidity, alerts, and feels-like temperature would compete with the requested hierarchy. Current temperature, short condition, high and low, hourly temperatures, and daily ranges are enough for a polished first version.
7. **Does the visual direction feel sufficiently Apple-like without copying Apple artwork?** Recommendation: keep the atmospheric gradients, oversized temperature, translucent forecast panels, restrained white type, and original SVGs. The locally darkened header area protects contrast without turning bright skies into dark cards.
8. **Is the 22-story review surface the right granularity?** Recommendation: yes. The original 20 states remain, and the two data-source-dependent additions separately bind cached failure and first-fetch failure. Every condition, responsive stress case, exceptional store state, and appearance promise still has a deterministic story.

## Next stage after spec review

Re-derive the Weather architecture and UI proofs from the accepted Open-Meteo contract, including request interception, cache transactions, read-only in-memory fetches, failure recovery, concurrency, attribution, CORS assumptions, and the release gate. Only after those proofs pass review should implementation be sliced again. The former two-slice plan and its plan-review refinements no longer apply because the store model, package logic, browser behavior, and proof surface all changed.
