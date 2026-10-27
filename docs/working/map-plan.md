# Bundled Map template plan

## Status

This working document records the draft decisions, open questions, proof plan, and review cost for adapting the installed Map 2.0.0 page into Television as bundled Map 2.1.0. The specifications in this change are drafts until Rupert accepts them.

## Scope

The change will:

- add Map 2.1.0 to the bundled template package and closed bundled-template inventory;
- start each copied Map artifact with an empty `{}` store;
- preserve the installed page's map, place-list, category, detail, photo, basemap, responsive-sheet, keyboard, and local interaction behavior;
- load Television's canonical stylesheet and use foundation tokens while keeping Leaflet and the Map-specific stylesheet local to the copied artifact;
- bundle and declare Leaflet 1.9.4 and the Lucide icon subset;
- cover store-to-page behavior against a running Television server without depending on the Esri network;
- keep Map presentation code-authoritative for now, while Map architecture specifies how store values affect the page; and
- omit the installed examples and photos from the bundle.

This branch will not add Table, an MDX Map UI specification, Map spec stories, or Map UI conformance coverage.

## Decisions made in this draft

These choices were not completely settled by an existing Television specification and the installed page together.

1. **Advance the bundled version.** The bundled manifest starts at `2.1.0`, and the minimum installed version is `2.1.0`. Serving boot therefore backs up and replaces an installed `2.0.0` copy, including the current copy installed for Rupert, instead of treating the source page as already current.
2. **Use the shared display defaults.** The manifest omits `display`. The installed page does not establish a Television page size, and the full map already adapts to its frame.
3. **Normalize the Toolbox icon declaration.** The manifest lists only `src` and `type`, as the other bundled templates do; the source's redundant `sizes: "any"` is removed.
4. **Keep source-oriented file names.** The package keeps `map.js` and `map.css` instead of renaming them to match another template. Their names are already part of the installed page and do not change its behavior.
5. **Keep useful icon reference material, but not sample content.** `icons.svg` and the vendored Lucide README, licence, generated module, and SVG subset stay with the package because they document the names an adapting agent may use and their provenance. `examples/` and `photos/` are excluded; the README uses a short inline data example instead.
6. **Use a static canonical page shell.** The installed page's local-preview stylesheet loader is replaced by direct canonical stylesheet, resource SDK, Leaflet, and Map asset links. Local preview machinery is not behavior of a copied Television artifact.
7. **Preserve tolerant reads after creation.** Missing, null, and empty stores show the empty map. The page treats invalid named property values as absent and ignores properties outside the schema. It shows places under any JSON-store key, as Map 2.0.0 did, but ignores categories under keys that break the letter-first rule. Categories without a usable name and places without usable coordinates are omitted. A root value that is neither null nor an ordinary object shows the unreadable-data state. Starting-data validation remains the shared template path; no Map-specific rejection test is added.
8. **Use the existing bundled recovery rules.** A normal disconnect keeps the last good map and catches up after reconnection. An SDK `no-store` result keeps the last good map. Another terminal SDK error shows the unreadable-data alert and starts a new subscription after reconnection. A root value the page cannot read also shows the alert, and a later readable value restores the map. None of these cases repairs the store.
9. **Keep the page read-only.** Interaction state remains in the viewer's page. Unrelated store updates preserve local `sidebar` visibility and basemap choices; a later stored `sidebar` or `basemap` value overrides the corresponding choice in the open page. The page subscribes to the whole store and never writes defaults or interaction state.
10. **Make external tiles irrelevant to automated behavior tests.** The real-stack test aborts requests to the fixed Esri tile host. This gives up assertions about rendered tile images while retaining real browser, server, store, Leaflet, and Map-page coverage. The architecture spec leaves attribution presentation code-authoritative until the Esri release question in TV-1009 is settled; the current page keeps the attribution from the installed page.
11. **Declare all shipped icon ancestry.** The asset inventory records Leaflet under BSD-2-Clause and records both Lucide under ISC and the inherited Feather icon material under MIT, following the licence text shipped with the subset.
12. **Leave the template skill reference generic.** The existing reference tells agents to discover and inspect installed templates with `tv templates list` and `tv templates show`; it deliberately does not enumerate bundled IDs. Map's README carries Map-specific store guidance.
13. **Make the smallest truthful product-spec adjustment.** The Map architecture spec owns what the store means and what the page shows, omits, falls back to, or reports. Until an MDX Map UI spec exists, presentation remains code-authoritative: layout, styling, wording, controls, and keyboard shortcuts are outside the architecture contract. The bundled-template product rule points to the inventory for that authority boundary.
14. **Do not freeze the page's appearance in tests.** Package tests check canonical asset composition, and real-stack tests check behavior against the store. There are no byte-for-byte stylesheet assertions or appearance assertions.

## Open questions for Rupert

### 1. May Television distribute a page that requests these Esri tiles?

The page requests street, imagery, and label tiles from `server.arcgisonline.com`. Its code shows `Tiles © Esri` for the street layer, `Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community` for imagery, and `Labels © Esri` for the hybrid label layer. Leaflet also shows its normal attribution. The installed README says the tiles require a network connection, but neither it nor the page links to Esri terms or establishes redistribution and production-use permission. Those requests also expose the requested tile coordinates—the viewed area and zoom—plus ordinary request metadata to Esri.

The release condition is tracked for Rupert in Linear as TV-1009.

**Recommendation:** keep the current tile URLs and attribution in this draft, but do not release Map until Rupert or legal review confirms that Television may ship this use of the service and decides whether its network disclosure is sufficient. If permission is not clear, choose an approved tile provider in a separate product decision rather than silently changing Map here.

### 2. Should Map receive a full MDX UI specification now?

This draft makes the page UI code-authoritative, as requested. A full UI specification would cover these independent review states:

1. empty map with no place list;
2. populated wide map with the place list open;
3. populated wide map with the place list closed;
4. a category filter applied;
5. selected place details without a photo;
6. selected place details with a photo, credit, description, and custom fields;
7. numbered places;
8. satellite basemap;
9. hybrid basemap and labels;
10. overlapping places expanded into separate choices;
11. the narrow-screen sheet and its collapsed, half, and expanded positions; and
12. data the page cannot read.

The spec would also state keyboard behavior, focus, wide-to-narrow transitions, light and dark themes, long and empty text, photo failure, local-photo safety, and which controls appear in each state. Its cost is an MDX contract, deterministic story fixtures, a Map story harness, roughly twelve production-versus-story conformance cases, deterministic local handling for map tiles, and visual review across responsive sizes and both themes. Those stories and selectors would then become maintained release contracts.

**Recommendation:** accept the temporary code-authority carve-out for this import. Add the full UI spec when Map's visual design is deliberately reviewed, or before a design change that should become a stable product contract.

### 3. Is the current visual adaptation ready to become the bundled design?

The installed page already uses Television token names in many places, but the bundled version changes its page shell to the canonical stylesheet and replaces remaining private colour fallbacks with foundation tokens where equivalents exist. With no UI spec, automated tests cannot decide whether the result preserves the intended visual character.

**Recommendation:** perform a human browser review of the empty, populated, selected-photo, narrow-sheet, satellite, hybrid, light, and dark states before release. Treat visual feedback as review of this draft, not as permission to invent new interaction behavior.

### 4. Should the Map schema and later-read rules use the same key restrictions?

The schema requires category and place keys to start with a letter, while JSON-store push IDs start with `-`. Map 2.0.0 nevertheless showed later place records under any key and ignored categories under incompatible keys. This draft preserves that behavior so a successful `push` cannot make a place disappear silently, but it leaves later place keys more permissive than starting-data validation and later category keys.

**Recommendation:** keep the 2.0.0 read behavior for this import and continue teaching explicit readable keys. Before a later schema version, decide whether the schema should allow any place key and whether categories should accept push IDs too.

### 5. Should a place icon apply when the place has no known category?

The current page uses a place icon only to override the icon from a known category. A place with an omitted or unknown category uses the uncategorised pin even when the place record names another supported icon.

**Recommendation:** keep the current behavior for this import. Reconsider it when the Map UI receives a full specification, because allowing uncategorised place icons would change the visible meaning of existing store values.

## Proof and implementation plan

1. Draft the Map architecture spec with the manifest's exact JSON Schema, the empty seed, runtime behavior, dependencies, licensing, and README obligations.
2. Draft the bundled inventory, product-boundary, migration-map, proof, and generated-index changes. Obtain an independent specification review before relying on them.
3. Add failing package, inventory, installer, build, telemetry, licensing, runner-ownership, and real-stack tests.
4. Add the adapted Map package and the smallest shared implementation changes needed to satisfy those tests.
5. Generate root and Map-folder third-party notices and the spec/proof indexes.
6. Run the targeted tests only. Before the real-stack Playwright run, create the development-host telemetry marker and confirm that no Playwright, Chromium, Vitest, Storybook build, or Vite build process is running. Use one Playwright worker.
7. Obtain an independent implementation review, address findings, and leave the worktree uncommitted for Rupert's review.

## Targeted validation

- Map package test, including explicit-key `set` and `remove` guidance rather than incompatible JSON-store push IDs.
- Exact bundled inventory, installation, onboarding, CLI asset, and telemetry tests changed here.
- Licensing inventory, notice generation, and shipped-notice tests changed here.
- Spec document, link, index, and test-runner ownership tests affected by the draft.
- Map's serialized real-stack browser test with `TV_PW_WORKERS=1` and Esri requests aborted locally.

The full suite, `npm run verify`, Storybook, standalone Vite builds outside the targeted runners, and unrelated conformance suites are outside this task's permitted validation.
