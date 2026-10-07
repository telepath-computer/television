PASS. I found no blocking loss of meaning, added requirement, or product decision made by the trim. The replacement links preserve the removed requirements. I found no incoming citations to removed section anchors.

1. **Non-blocking — [overflow-fade.md, “Contract”](/home/user/workspace/wt/television/trim-ui-arch/specs/arch/ui/overflow-fade.md:7): internal API remains pinned.** The exact `ItemEdgeFadeOptions` shape and `mountItemEdgeFade` signature serve callers maintained in this repository; they are not an artifact-authoring, storage, or process contract. The surrounding prose already establishes the helper’s responsibility. Leave the function name and argument packaging to code, while retaining the mask geometry, explicit refresh requirement, cleanup behavior, and backdrop-filter rationale.

2. **Non-blocking — [menu-view.md, trigger-ID rule](/home/user/workspace/wt/television/trim-ui-arch/specs/arch/ui/menu-view.md:7): the generation mechanism remains over-specified.** Application-wide uniqueness, lifetime stability, opacity, and independence from domain identity are meaningful requirements. A module-level counter is one implementation of them; another generator could satisfy the same decision. Remove the counter prescription and retain those guarantees.

3. **Non-blocking — future tooling remains in [making-skills.md, “The bundle”](/home/user/workspace/wt/television/trim-ui-arch/specs/arch/making-skills.md:23) and [sidebar-view.md, “Derivation”](/home/user/workspace/wt/television/trim-ui-arch/specs/arch/skills/sidebar-view.md:32).** “Until bake tooling exists,” “generation-from-points is an option,” and “baked once bake tooling exists” describe possible future work without helping derive the current bundle. State the current authoring and rendering methods; keep tooling proposals outside specs.

Keeping the expressly deferred conformance machinery pending the architect’s decision is appropriate; deleting that decision would exceed a trim.

This was a read-only review of the diff, complete scoped specs, and supporting authority, proofs, and code. No files were changed or tests run.

Converged: yes