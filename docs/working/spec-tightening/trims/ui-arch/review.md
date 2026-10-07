# Trim review: UI architecture area (`ui-arch`)

**Branch:** `thopter/trim-ui-arch`, stacked on `thopter/spec-tightening` at `f6cdd91e`. One commit per trimmed spec, then one commit for this area's review files. There is no link-only commit, because no citation needed repointing.

**Convergence:** converged. Round 1 found no blocking findings and three non-blocking ones. Two were fixed and one was disputed. Round 2 accepted all three responses and found nothing new. The raw reviews are [round-1-review.md](round-1-review.md) and [round-2-review.md](round-2-review.md).

| Spec | Words before | Words after |
| --- | ---: | ---: |
| `specs/arch/ui/index.md` | 1147 | 921 |
| `specs/arch/ui/foundation.md` | 722 | 626 |
| `specs/arch/ui/elements.md` | 1432 | 1324 |
| `specs/arch/ui/conformance.md` | 924 | 896 |
| `specs/arch/ui/keyboard-navigation.md` | 854 | 764 |
| `specs/arch/ui/lit-view.md` | 933 | 897 |
| `specs/arch/ui/menu-view.md` | 152 | 134 |
| `specs/arch/ui/overflow-fade.md` | 671 | 654 |
| `specs/arch/skills/sidebar-view.md` | 461 | 418 |
| `specs/arch/canonical.md` | 1558 | 1558 (unchanged) |
| `specs/arch/node-versions.md` | 972 | 960 |
| `specs/arch/making-skills.md` | 621 | 520 |
| `specs/arch/skillbench.md` | 539 | 454 |
| `specs/arch/developer-skills.md` | 325 | 325 (unchanged) |
| **Total** | **11311** | **10451** |

The trim is modest, about 8%. Most of this area is contract: the canonical bundle that artifacts link, the public element APIs, the Node version contracts and a developer-facing installer. The largest cuts restated rules owned by theme delivery, the foundation UI spec and the popover UI spec. `canonical.md` and `developer-skills.md` were read in full and left alone, because every statement in them is a contract or a procedure.

## Decisions for Josh

1. **Should `conformance.md` keep describing machinery that does not exist yet?**
   - **Where:** `specs/arch/ui/conformance.md`, sections "Mechanisms" and "The conformance tests".
   - **The question:** these sections describe automated structural comparison, selector checks and a per-surface test directory, `packages/web/test/conformance/`, none of which exists. The "Release exception for TV-649" section defers them. The policy says a spec describes the product as it is and is not a backlog. But the sections also read as your committed design for TV-649, and the exception says to review that approach with you.
   - **Options:** (a) keep them as the committed design, as now; (b) move the unbuilt mechanism to the TV-649 ticket or a working document, and keep only what holds today: byte identity and delivery checks, the exemption rule and the release exception.
   - **On the branch:** (a). The text is unchanged apart from small condensing.
2. **Should the overflow-fade helper's TypeScript signature stay pinned?**
   - **Where:** `specs/arch/ui/overflow-fade.md`, "Contract".
   - **The question:** `ItemEdgeFadeOptions` and `mountItemEdgeFade` are used only inside the product. The policy pins such a type only when an architect chooses to. The reviewer suggested unpinning it in round 1. I disputed this because I cannot tell whether the pin was deliberate.
   - **Options:** keep the pinned signature, or drop the signature and keep the behaviour: mask geometry, the explicit `refresh()`, cleanup, and putting the mask on the item that carries the backdrop filter.
   - **On the branch:** kept.
3. **Is `lit-view.md`'s level of detail deliberate?**
   - **Where:** `specs/arch/ui/lit-view.md`.
   - **The question:** the spec defines an internal utility in terms of lit-html's internals, for example the commit guard, `reconnected()` handling and the microtask catch-up. This reads as a deliberate architecture decision, and some of its statements are regression traps, such as the `keyed()` warning. Much of it may also be detail that derivation would get right from the guarantees alone.
   - **On the branch:** kept, apart from a pointer and some condensing.

## Judgment calls in the diff

Each entry gives the cut, the reason, and what the remaining text still lets a reader derive. The reviewer raised no dispute on any of them.

- **`ui/index.md`: the TV-708 sentence.** Cut "A small user-facing message explaining the failure is desired and tracked in TV-708". It is a plan, and the policy keeps plans out of specs. The accepted limitation stays: there is no fallback, the entry script aborts and the page is blank.
- **`ui/index.md`, Styling: theme-resource details.** Cut three statements that theme delivery owns:
  - theme JavaScript is application-only (`themes/delivery.md`, "Application theme JavaScript": canonical wrappers, artifact proxy documents, the markdown editor and error documents install none of it);
  - the Clouds stylesheet crossing (`themes/bundled-installation.md` and `foundation.md`'s theme-stylesheet crossing);
  - the editor and error documents loading the fixed-`system` resolver before canonical v2 (`themes/delivery.md`, "Artifact documents").

  Two statements were kept: one module owns all five theme resources, and the app view supplies the permanent foreground element. Delivery does not group all five resources under one owner, and the proof asserts sole ownership.
- **`foundation.md`: the "Membership" list.** It restated the composition in `ui/foundation/index.css`, and it listed icons, which that file does not import because the icon sheet ships inside `tv-icon`. The intro now points to the foundation UI spec and `index.css` as the owners of the vocabulary and the composition.
- **`foundation.md`: the error-document loading order.** Cut the order, which `themes/delivery.md` owns. Kept the error documents' byte-identical embedded sheet with no duplicate foundation declarations.
- **`foundation.md`: "Matching a CSS selector alone never establishes that Electron moves the window."** The Testing section already requires proof in the real Electron app.
- **`elements.md`: popover-family placement geometry.** Cut "below the trigger, left edges aligned, window-edge flipping", which the popover UI spec's Placement section owns. Kept: one shared placement implementation, which includes the select's alignment over its selected option, and no per-surface direction attribute or artifact-menu exception.
- **`elements.md`: the select-exclusivity prohibition.** Cut "must not close popovers or menus…". It restated the select UI spec's "Popover exclusivity" section, which the remaining sentence links.
- **`elements.md`: three "one is added when a surface needs it" clauses.** These were future notes. "No properties, methods, or events" remains, and a spec change can add one at any time.
- **`elements.md`: "A checklist that wants different spacing … writes ordinary CSS".** This follows from "the styling API is the tag names and `checked`".
- **`keyboard-navigation.md`: the Status line.** It held "stage-one" and three production file paths. Those are code locations, which the code governs. The handler's contract is unchanged.
- **`menu-view.md`: the module-level counter.** Cut on the reviewer's suggestion. All of the id guarantees remain: unique across the application, stable for the position's lifetime, opaque, and never derived from caller or domain identity.
- **`menu-view.md`: the proof pointer in Testing.** A spec does not need to describe its proof. It now says that the elements own coverage of their behaviour, composing surfaces own coverage of their commands, and this spec covers the trigger-id rule.
- **`making-skills.md`: the `authoredForAppVersion` rules.** Condensed to a link to `themes/delivery.md#artifact-documents`, which owns the version sources and the set, preserve and omit rules. Kept the facts this spec owns: the `television` skill teaches the parameter, and the four named skills carry the placeholder.
- **`making-skills.md` and `sidebar-view.md`: future tooling.** Cut "until bake tooling exists", "generation-from-points is an option" and "baked once bake tooling exists". The mechanism named "Generate or author" is now "Author". If generating skill text is still an intended option, this rename loses it.
- **`skillbench.md`: the Status line and "Package layout".** The Status line described later phases, which are a plan. It is replaced by the decision it contained: the page opens no write paths. The package layout is code-governed. `middleware.mjs`, `sizes.json` and the routes are still named where they matter. The layout's note that the test surface is `unit:skillbench` lives in `test.config.mjs`.
- **`sidebar-view.md`: the status paragraph and the publication boundary.** These overlapped, so they were merged. The name "Rupert" was dropped from the TV-585 sentence. The ticket still names who confirms the requirements. The three registration requirements are unchanged.

## Kept but doubtful

- `ui/index.md`: "owned by a small module that declares the key and its record shape" in client-persisted preferences. This is internal code organization, but it may be a convention you want.
- `ui/index.md`: the one-module ownership of five theme resources, and "the app view supplies the permanent CSS foreground element". These partly overlap theme delivery and the app UI spec.
- `overflow-fade.md`: coalescing updates into one animation-frame callback and reading geometry before writing. These are performance mechanisms, kept because derivation might not avoid layout thrash.
- `conformance.md`: "Exemption lists are expected to shrink…; growth of a surface's list is a review signal." This is review guidance rather than a rule.
- `elements.md`: "There is no per-surface direction attribute or artifact-menu exception." This negative statement reads like a recorded decision.
- `node-versions.md`: the exact contents of the toolchain checker's failure message. This is developer-facing behaviour that is close to derivable.
- `making-skills.md`: the Storybook staging records, meaning state leaves and the `Preview` leaf. This is internal tooling, but it is the documented way skills are staged.
- `sidebar-view.md`: the "to try it locally" steps. This is operational help that is close to derivable.
- `canonical.md`: left whole. The freeze procedure is not under an `## Operations` heading as the policy suggests. Moving it was not a trim, so it was left in place.

## Routine cuts

**Restatements of another owner**
- `ui/index.md`, Views: the summary of the `View` lifecycle, which [lit-view.md](../../../../../specs/arch/ui/lit-view.md) owns.
- `ui/index.md`, Styling: "A view's own styles are its sibling `.css`", already stated under Views.
- `ui/index.md`, Custom elements: "A frozen canonical version instead serves its committed `components.js`…", which `canonical.md` owns.
- `ui/index.md`: the "Helpers", "Foundation" and "Keyboard navigation" pointer sections, merged into one "Related architecture specs" list.
- `ui/index.md`, Testing: the two sentences pointing to the testing policy. Silence inherits the policy.
- `foundation.md`, Distribution: "The application loads the complete shared foundation; artifact documents load the canonical version they link". `ui/index.md`'s Documents section owns this.
- `foundation.md`: "The frames are the authority; the sibling is their committed concatenation". The sentence before it says the same.
- `foundation.md`: "canonical copies its already-built stylesheet and component bundle unchanged". `canonical.md` owns this.
- `elements.md`, intro: the frozen-version sentence, condensed into the canonical sentence.
- `elements.md`, `keyboard-navigation.md` and `lit-view.md` Testing sections: "The testing policy says to name coverage provided by other specs…". The policy itself says this.
- `lit-view.md`: "Convention: the class defined on its own…". This is now a pointer to `ui/index.md#views`, which owns the convention.
- `keyboard-navigation.md`: the "What this owns" section, merged into the introduction. Its list repeated the delegation map.
- `keyboard-navigation.md`, Testing: "It does not require duplicate tests of movement or delivery", folded into "movement and delivery are proven by their owners".
- `making-skills.md`: the sidebar-view example of a non-shipping skill. `sidebar-view.md` owns that fact.
- `node-versions.md`: the second sentence about `.nvmrc` consumers, condensed. The version table states which consumers use it.

**Condensing without loss of meaning**
- `ui/index.md`, intro: the view-decomposition sentence; "otherwise none is involved"; "surgery" reworded as "transient DOM changes".
- `conformance.md`, intro: the requirement is no longer restated, since `spec-ui.md` states it. "Silent divergence is forbidden: deviate only by declaring" became "Any other divergence is a failure".
- `conformance.md`: dropped "if these checks prove insufficient, the same tests support that escalation without redesign", which was speculation about the future.
- `keyboard-navigation.md`: the rationale for the single operation was shortened.
- `lit-view.md`: the consequence of the `keyed()` trap was shortened. The trap and its fix remain.
- `overflow-fade.md`: "does not own scrolling, selection, focus, or item content" became "manages mask geometry only". The disposal steps became "stops all updates and clears…". The tab strip's ownership of `data-overflow` was condensed.
- `skillbench.md`: "Source under `src/`…" and the parenthetical about `sizes.json`.
- `sidebar-view.md`: "Adding a public event is a spec change here first" (true of any spec) and "Acknowledged in the carried JS header".
- `node-versions.md`: the Authority paragraph, merged into one sentence. The list of consuming specs is kept.

**Corrected pointer**
- `conformance.md`: the byte-identity and delivery checks are now said to be required by `foundation.md`. The spec had named `index.md`, which never required them.

## Findings that are not edits

Mismatches between spec and code (not fixed):

1. **Not every view in `packages/web/src/views/` follows the `View` shape that `ui/index.md` describes.**
   - `views/menu.ts:24` does not export its class, and it has no sibling `menu.css`. Its styles come from `elements/menu.css`.
   - `views/copy-button.ts` and `views/dialog.ts` are template functions, not `View` classes.
   - `views/channel-list.ts` is a plain `ChannelListController` that imports `channel-sidebar.css` and `channel-sidebar.drag.css`.
   - Several views import extra `.host.css` or `.drag.css` sheets. These may fall under the carve-out for implementation-owned scaffolding.
   - Helper modules such as `page-sizing.ts` and `tab-reorder.ts` also live in `views/`.

   Either the spec should say what counts as a view, or the code should conform.
2. **The localStorage "abort" is an uncaught throw.**
   - The spec says the entry script "aborts with a console error and leaves a blank page". In the code, the `LocalStore` constructor throws at module top level (`main.ts:67`, `store.ts:85-92`).
   - The foundation stylesheets imported before that line still apply, so the page is styled but empty.
   - The behaviour matches the spec's intent, and no code path is written for this case.
3. **There is no `packages/web/test/conformance/` directory.** This is expected under the TV-649 exception. The byte-identity tests (`packages/web/test/foundation-copy.test.ts`, driven by `test/repo/lib/ui-style-crossings.ts`) have no list of allowed divergences. That is consistent with the spec while no divergence exists.
4. **The production `packages/web/src/foundation/index.css` is not byte-identical to `specs/ui/foundation/index.css`.**
   - Its import paths are flattened.
   - The spec requires only that it load the copies in the same order, and the test checks only the order. This is consistent, but noted, because "byte-identical copies" in `foundation.md` could be misread as covering `index.css` too.

Claims checked and found to match the code:
- `canonical.md`: the serving and frozen classification, the cache headers, the frozen v1 tree and `frozen.json` fields, the builder's discovery, rejection and copying, and the icon placeholder extraction.
- `node-versions.md`: `.nvmrc`, the engines, the `node18` targets, `@types/node` 22, `check-toolchain.mjs` and its two entry points, and the `.nvmrc` consumers.
- `skillbench.md`: the default command, stdin, the rejection of absolute paths, `before_command`, and the middleware routes.
- `developer-skills.md`: the installer arguments and the four common directories.
- `sidebar-view.md`: the storage key and the registration in `skills.json`.
- `overflow-fade.md`: the helper's signature, properties, cap and animation-frame coalescing.
- `elements.md`: the element behaviour, including that no `CustomEvent` is used anywhere.

No missing contract was found.

## Effects

- **Citations:** no block ref was removed and no cited heading was removed, so no citation was repointed or left dangling.
- **Spec-link test:** passes, 8 of 8, on the final branch. No failures are expected.
  - The command in the brief points at `~/workspace/wt/television/serve-persist-fix-tv-856/node_modules`, which does not exist on this host.
  - I linked `~/workspace/television-prerelease-archive/node_modules` instead, which has vitest 2.1.9, ran the same test file, and removed the link.
- **Proof sections that may be stale:**
  - `proofs/arch/ui/index.md`: the `^ui-t-style-delivery` and `^ui-t-theme-resources` assertions still assert that the Clouds package stays out of the compiled graph, and that the standalone documents load canonical v2 in order. `ui/index.md` no longer states these; theme delivery and bundled installation own them. When the proof is re-derived, decide whether these assertions move to those owners' proofs.
  - `proofs/arch/ui/menu-view.md` line 9 describes a "module counter". The spec now leaves the mechanism open.
  - `proofs/arch/skillbench.md` is unaffected because it orders no assertions.
- **Reviewer behaviour:** in both rounds the reviewer changed nothing in the worktree. `git status` showed only the new review files.
