# Core area trim: review document

**Branch:** `thopter/trim-core`, based on `f6cdd91e` (the merge base with `origin/thopter/spec-tightening`). One commit per spec, then one commit with these review files. No citation needed repointing, so there is no link-only commit.

**Convergence:** converged. Round 1 had no blocking findings and two non-blocking ones; both were addressed, and round 2 accepted the fixes and raised nothing new.

| Spec | Words before | Words after |
|---|---|---|
| specs/product/artifacts.md | 1818 | 1683 |
| specs/product/channels.md | 920 | 862 |
| specs/product/tab-pages.md | 1016 | 883 |
| specs/product/artifact-navigation.md | 908 | 873 |
| specs/product/keyboard-navigation.md | 850 | 772 |
| specs/arch/channel-state/index.md | 2909 | 2652 |
| specs/arch/layout/index.md | 1193 | 1065 |
| specs/arch/layout/migration.md | 1913 | 1796 |
| **Total** | **11527** | **10586** |

The cut is small, about 8%. These specs were already mostly decisions and contracts: stored-data formats a later version must read, sync rules between clients and server, the migration's data-safety cases, and product promises. Most of what remained to cut was backlog references, history, and restatements of rules owned elsewhere.

## Decisions for Josh

1. **Should `## Testing` sections take the policy's "Inputs to proof derivation that the spec does not otherwise show" heading?** Every spec in this area has a `## Testing` section holding what the policy now calls designer or architect directives and coverage owned by another spec. More than a dozen citations in other specs and proofs point at `#Testing` in these files (for example `specs/ui/app/stage/index.md:128-132`, `specs/ui/app/artifact-frame/index.md:64`, `specs/arch/explainer-desktop-app.md:72`). The branch keeps the `## Testing` heading so those citations stay valid. Options: rename the heading repo-wide in one pass after the trims merge, or keep `## Testing` as an accepted form.
2. **Should block refs that nothing cites be removed?** The policy says a ref ideally exists only while something cites it. In this area, 42 of the 94 anchors have no citation in specs, proofs, code or tests (for example `^af-name`, `^af-channel-reload`, `^ch-definition`, `^tp-model`, most `^cs-*` and all `^rn-*` refs). The branch leaves every anchor on a kept statement in place, because proofs are about to be re-derived and may cite them. Options: sweep uncited anchors after proof re-derivation, or leave them.
3. **Are ticket links acceptable in specs as transitional markers?** The branch cuts TV-524, TV-525 and TV-549 as backlog pointers and keeps the limitations they track (rearranging pages may reload documents; the API accepts a caller-supplied channel id). The policy allows context about the future where it helps derivation, so a ticket link beside a known gap could be read as allowed. The branch reads it as backlog.
4. **The caller-supplied channel id gap is wider than the spec says.** `^ch-identity` names the gap as sortability only. In the code, a caller-supplied id has no format check, may be empty, and a duplicate id silently replaces an existing channel (`packages/server/src/server-store.ts:513-518`, `packages/server/src/routes.ts:44,251-253`). Whether to accept and state this, or close it, is a product decision. The branch leaves the text as it was apart from the ticket link.

## Judgment calls in the diff

Each is a cut where a reasonable person could disagree. The reviewer saw all of them; it disputed none.

1. **layout/index.md: the `^ly-no-splits` paragraph is cut.** It said the stage-1 model has no pane tree, stored split ratio, page-splitting operation or multi-artifact placeholder, and that later layout kinds extend `PageGeometry`. Reason: it describes what the model lacks; the policy says a positive statement is not a negative rule. What remains: the `TabPage` and `PageGeometry` types show exactly what is stored; `^ly-membership` says later milestones may add geometry kinds and that the container and membership field do not change; `^ly-update-membership` forbids regrouping. Adding a field to a stored type needs a spec change anyway. The round 1 reviewer explicitly agreed the paragraph need not be restored.
2. **channel-state/index.md: the reasons each pre-redesign browser field was retired are cut** (multi-server removal, focus being shared, server-owned tab membership, tab promotion's removal, the card canvas). Reason: retirement records are history. What remains (`^cs-retired-state`, `^cs-token-carry`): the full list of fields an old record may hold, that only the auth token is honored, and that the rest are ignored and may be dropped. The cut also removed the sentence "browser-persisted state carries no promotion record"; the inventory table lists all browser-persisted state and says every fact comes from exactly one tier, so a promotion record has no place in it.
3. **keyboard-navigation.md: the Non-goals section is cut.** It said no other app-level shortcuts are promised and that there is no tab-closing shortcut. Reason: the first half describes what is not covered, which the policy leaves to judgment; the second half is owned by `tab-pages.md#^tp-no-tab-ops`, which keeps it. Nothing cited the section.
4. **artifacts.md: backlog cut from "What survives moving around".** TV-524 (preserving documents through rearrangement), TV-525 (a recency buffer for channel switches) and "dragging an artifact by its frame is a future milestone" are gone. The accepted limitation stays: rearranging pages may reload documents, and continuity is promised to tab switching alone.
5. **artifacts.md: the Navigation section is reduced to a one-line pointer.** Cut: the demo-mode exception (stated in the demo-mode section and in `artifact-navigation.md`) and "that history can be stepped back and forward from the frame itself, which also shows whether either direction has anywhere to go" (owned by `ui/app/artifact-frame/index.md`, Back and Forward).
6. **artifacts.md: "If these states are designed later, they arrive here and the carve-out retires" is cut** from `^af-states-carve-out`. Future plan. The carve-out and its scope stay.
7. **tab-pages.md: the continuity paragraph and the Keyboard navigation section are cut.** Both only pointed at their owners, `artifacts.md` (`^af-tab-continuity`, "What survives moving around") and `keyboard-navigation.md`. The "What this owns" list still names both owners, and its continuity bullet now says that switching tabs never reloads a document.
8. **tab-pages.md: "the label formula for a multi-artifact page is that milestone's question" is cut** from `^tp-label`. Future work with nothing for derivation to act on; the label rule and its stage-1 basis stay.
9. **channel-state/index.md: the successor rule is no longer restated in `^cs-focus-successor`.** It now refers to `channels.md#^ch-delete-selection` and keeps "the first channel in the channel sidebar's order", the server-side decision and its rationale. The restated "newest unpinned" wording was more specific than the product's "first unpinned"; the product rule, together with `^ch-unpinned-order` (newest first), gives the same result.
10. **migration.md: the display-field rewrite now relies on `^mig-record-atomic`.** Cut: the sentences on failure before and after the rename, and "current code never writes `activeScreenID`". The atomic rule covers every channel or display record rewrite in the pass, and `^rn-storage-scope` already says current writes use only channel spellings. Kept: temp file beside `display.json`, stale temp files never treated as display state, byte-stable no-op.
11. **migration.md: `^ly-boot-migration` is condensed.** Cut: "a record already at version 2 loads as-is", "the migration is idempotent" and the downgrade pointer. Idempotence and the skip of completed work are in `^one-migration`; downgrade is in `layout/index.md#^ly-stored-record`, which the layout spec still owns.
12. **keyboard-navigation.md: "Keyboard navigation works when the bridge works. The goal is to make it as consistent as possible given the realities of iframes and the web." is cut.** The bullets that follow state exactly where the chord works and where it does not.

## Kept but doubtful

- **channel-state `^cs-sidebar-width-key`: "rounded to the nearest pixel on commit (ties round up)" and "never during the drag".** The stored format (whole pixels as a base-10 integer string) is a contract with later versions; the rounding direction and write timing look like implementation choices any reasonable implementer would make acceptably. Kept because a proof cites this anchor for storage-contract breadth.
- **artifacts.md: the `?authoredForAppVersion` paragraph.** No code reads the marker on the stylesheet link; the canonical server only passes the query string through (`packages/server/src/canonical.ts:46-50`). It is a contract with authoring agents, which is why it was kept.
- **channels.md `^ch-pin-placement`: the menu and drag placement detail.** The sidebar UI spec states the same gestures (`specs/ui/app/sidebar/index.md:48-59`). Kept because channel-state's `^cs-pinned-update` cites it as the product's placement rule.
- **artifacts.md: "Demo mode changes nothing else…".** Partly a negative statement, but an implementer could plausibly extend demo mode to links that leave Television.
- **keyboard-navigation.md `^tp-chord-shell-focus`: its last sentence** overlaps `^tp-chord-focus-continuity`. It reads like a regression guard.
- **tab-pages.md: "Pages scale with the display…".** It repeats the stage UI spec's sizing formula in product terms. Kept as a product promise.
- **Forward-looking text about later milestones** in `layout/index.md#^ly-membership` and `tab-pages.md#^tp-one-artifact`. Kept because it tells implementers the multi-artifact container is deliberate and must not be narrowed.
- **Testing sections' platform directives** ("must run in a real browser against a running Television server"). The testing policy's acceptance definition already requires an outermost boundary, but it allows "a real browser or the real Electron app", so naming which platforms (or both) is a directive. Kept throughout.
- **"What this owns" lists.** Each names neighbouring specs a reader would expect content from. Shortened only by dropping the repeated "deliberately".
- **migration.md: the opening paragraph describing the first layout model.** History, but a migration spec's reader needs it.

## Routine cuts

Grouped by kind. Each gives where, what, and where the content still lives.

**Restatements of an owner's rule**
- channels.md Identity: "and the model carries no separate creation-time field" — owned by `channel-state/index.md#^cs-no-created-field`.
- channels.md intro: "not how the channel sidebar draws them, which is that surface's own spec" — the "What this owns" list says it.
- channels.md Renaming: the parenthetical pointer to the sidebar's rename interaction — the owns list names the sidebar UI spec.
- tab-pages.md The model: "— exactly one in stage 1 —" in `^tp-model` — stated by `^tp-one-artifact` directly below.
- tab-pages.md The model: three repeated "the gesture is specified in ui/app/stage" clauses merged into one sentence.
- artifact-navigation.md: the "Forward is discarded on a new move" section folded into the Forward bullet; same rule, one place.
- artifact-navigation.md What this owns: "It names internal machinery only by reference."
- keyboard-navigation.md `^tp-chord`: "the channel sidebar presents that order, ui/app/sidebar/index.md" — the order is the channels spec's, cited in the same sentence.
- channel-state `^cs-pinned-update`: the restated placement rules — kept by `channels.md#^ch-pin-placement`, which the bullet cites.
- channel-state "Channel focus flows one way": "Artifact focus is not shared state" and the tab-pages ownership pointer — both in `^cs-outside-inventory`.
- channel-state client state layer: the fetching-and-caching sentence for artifact records and "How the layer decomposes … is deliberately the implementer's, below" — both in `^cs-internals-carve-out`, which now absorbs "class structure, caching, and rollback mechanics".
- channel-state `^cs-selection-memory`: the persistence prohibition and behavior list — owned by `tab-pages.md#^tp-selection-local` and `^tp-selection-fallback` (round 1 finding 1).
- layout/index.md: the "Migration from version 1" section — the owns list and `^ly-stored-record` both point to `migration.md`.
- layout/index.md `^ly-validation`: "There is no split-page validation because there are no split pages."
- migration.md `^rn-directory-preservation`: "this migration does not add `layoutVersion`, flatten a tree, or perform any part of the mapping" — now "the version-1-to-2 mapping is step 2's"; `^rn-storage-scope` already says the step changes names only.
- migration.md "No creation-time field": the parenthetical that writing the versioned record is not a backfill.

**History**
- layout/index.md `^ly-server-state`: "the redesign changes the semantics of layout, not the location of authority".
- layout/index.md intro: "It is the durable core the redesigned UI renders from"; the intro's mention of converting stored arrangements (the companion's job) replaced by "how it is stored and versioned".
- layout/index.md `^ly-stored-record`: "this model is the second major product iteration on layout" and "simply" — the fact that version 1 never stored a version field stays.
- migration.md mapping: "the redesign has no browser tab-promotion pass" as the reason the onboarding `order` field goes — "nothing reads it" stays.
- migration.md `^ly-boot-migration`: "(the pattern telemetry and onboarding use)".
- migration.md `^rn-storage-scope`: "The browser's local-state field spellings changed alongside this step historically" — rewritten to state the present fact (no browser rename step is needed) with a link to `^cs-token-carry`.
- channel-state `^cs-internals-carve-out`: "per the approved authority boundary".

**Backlog and external references**
- channels.md status line and `^ch-identity`: TV-549 references.
- migration.md: "the redesign is described in the Discord announcement instead". The repository cannot confirm that announcement exists.

**Wording only (no intended change of meaning)**
- artifacts.md: intro sentence on what artifacts are for; `^af-name`; the `authoredForAppVersion` paragraph; the root appearance marker bullet now links the appearance resolver it names (`arch/themes/delivery.md#appearance-resolver`), which was an unexplained term; deletion confirmation paragraph condensed ("so nothing is removed by mistake…" dropped as implied by asking first); Local source changes; the tab-continuity rationale; the Non-goals sentence turned from "is a non-goal" into a plain statement.
- keyboard-navigation.md: the word-wise cursor rationale; the "visually identical" sentence.
- channel-state: "Rationale:" label dropped from `^cs-converge` ("honest convergence" became "reliable way to converge"); `^cs-optimistic` reworded ("projection" became "state", "secondary read failure" became "the read failure"; "Optimism is an allowance, not a requirement" moved into the first sentence); "lockstep contracts" in `^cs-wire-carve-out` became "always ship together, so they may change freely between releases"; `^cs-display-migration` reworded with "after that migration's name step" in place of the parenthetical.
- migration.md `^rn-display-behavior`: "the shipping loader" became "the display loader and the later display step (`^cs-display-migration`)". The added link names the step that resolves a dangling value; it adds no rule.

## Findings that are not edits

Mismatches between spec and code, and gaps the specs do not name. None were fixed.

1. **Folder artifacts need a trailing separator to be watched.** `artifacts.md#^af-folder-live-update` says any path artifact that points at a folder reloads on changes anywhere in the tree. The server treats a path as a folder only when it ends in a separator; a folder path saved without one gets no watch at all (`packages/server/src/server-store.ts:177-187`).
2. **Duplicate caller-supplied channel ids overwrite.** See decision 4. Also, unpinned ordering uses `localeCompare` (`packages/web/src/views/channel-list.ts:1558`), which matches code-point order for Television's uppercase ULIDs but not necessarily for caller-supplied ids.
3. **Display-state writes are all-or-nothing.** `channel-state#^cs-display-partial` says "each field's validation applies on its own". The server validates each field separately but rejects the whole write if either is invalid (`packages/server/src/server-store.ts:668-687`). The spec wording can be read either way; the code's reading should probably be stated.
4. **Navigating to an artifact's home keeps the forward trail.** `artifact-navigation.md` says navigating somewhere new after going back discards the forward trail, and that a link to home returns to the home position without a duplicate entry. The code moves the cursor to home and keeps the forward entries (`packages/web/src/services/artifact-navigation-state.ts:74-80`). Whether returning home counts as a new move is not stated.
5. **Version-1 records are migrated only on a serving boot.** `layout/index.md#^ly-stored-record` says version-1 records are migrated on load. The migration runs only when the server starts to serve (`packages/server/src/server-store.ts:261-263`); a token-only startup skips it, and its loader drops version-1 records as malformed (`server-store.ts:898`). A record with an explicit `layoutVersion` other than 2 is also skipped as malformed rather than migrated (`packages/server/src/redesign-storage-migration.ts:180`). The specs do not cover either case.
6. **Malformed records do not stop boot.** `migration.md#^mig-record-atomic` says any migration failure stops boot before serving. Malformed channel and display records are skipped silently and left for the loader (`packages/server/src/redesign-storage-migration.ts:81,100,116`); only I/O errors and the two named conflicts stop boot. Whether a skipped malformed record is a "migration failure" is unclear.
7. **Ordinary state writes are not atomic.** The migration's atomic-write rule is met (`redesign-storage-migration.ts:141-145`), but routine channel and display writes use `writeFileSync` directly (`server-store.ts:1392,1459`). No spec states a crash-safety contract for ordinary writes, so this is a gap rather than a mismatch.
8. **Two heading links already point at headings that do not exist.** `proofs/ui/app/index.md:32` links `channel-state/index.md#Test hooks`, and `proofs/arch/artifact-frame/artifact-bridge.md:110` links `artifacts.md#test-hooks`. Neither heading exists on the base commit either. The link test does not check heading anchors.

Claims checked and confirmed against code include: title handling, the `data-theme` override, delete confirmation and file preservation, the demo-mode marker file and URL-shape rule, channel deletion order and successor, pin and unpin placement, selection memory and fallback, artifact-focus ordering, the sidebar storage keys, the optimistic-write recovery rules, the layout types and validation, and every migration step and directory case.

## Effects

- **Stale proof sections:** none found. No proof assertion derives from a cut statement; the cut material was restatement, history or backlog. Proofs will still be re-derived under the plan.
- **Citations repointed:** none. No cited block ref was removed. The only removed anchor, `^ly-no-splits`, had no citations. No cited heading was removed (checked for "Forward is discarded on a new move", "Keyboard navigation", "Navigation", "Non-goals", "Migration from version 1", and "Migration from the pre-redesign client state").
- **Citations left dangling:** none.
- **New links added:** `artifacts.md` links `arch/themes/delivery.md#appearance-resolver`; `channel-state` `^cs-focus-successor` links `channels.md#^ch-delete-selection`; `migration.md` links `channel-state#^cs-token-carry`, `#^mig-record-atomic` and `channel-state#^cs-display-migration`.
- **Spec-link test:** passes, 8 of 8, with no expected failures. The brief's borrowed `node_modules` path (`~/workspace/wt/television/serve-persist-fix-tv-856`) no longer exists, so the test ran with vitest 4.1.5 borrowed from `~/workspace/carryall/node_modules`; the test uses only `node:fs`, `node:path` and vitest.

## Process notes

- Both reviews took about four minutes, and the round 1 review is short. The reviewer reported reading the owners, proofs and code in round 2.
- The reviewer changed no files in either round.
- The round context files cite WIP commits (`e69d79e8`, `b308f4c5`) that the final commit reorganisation replaced; the specs' content at the end of round 2 is the content on the branch.
