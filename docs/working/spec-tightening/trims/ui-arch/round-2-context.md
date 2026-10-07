# Round 2 context: ui-arch trim

**Area:** UI architecture (`ui-arch`).

**Specs in the area:**
- every file in `specs/arch/ui/`: `index.md`, `foundation.md`, `elements.md`, `conformance.md`, `keyboard-navigation.md`, `lit-view.md`, `menu-view.md`, `overflow-fade.md`;
- every file in `specs/arch/skills/`: `sidebar-view.md`;
- `specs/arch/canonical.md`, `specs/arch/node-versions.md`, `specs/arch/making-skills.md`, `specs/arch/skillbench.md`, `specs/arch/developer-skills.md`.

The UI specs under `specs/ui/` are not in this area.

**Base commit:** `f6cdd91e417e1f94c8617baebb016e921c21d6e5` (`git merge-base HEAD origin/thopter/spec-tightening`). See the whole trim with `git diff f6cdd91e..HEAD -- specs`. The changes made since round 1 are in the most recent commit's `specs/` changes (`git show HEAD -- specs`).

**Previous round:** `docs/working/spec-tightening/trims/ui-arch/round-1-review.md`. It reported no blocking findings and three non-blocking ones.

**Responses to round 1:**

1. *overflow-fade.md: the `mountItemEdgeFade` signature and options type are internal and pinned.* **Disputed; kept, and listed as kept but doubtful for the architect.** The policy lets an architect pin an internal type where it is the clearest way to convey a decision. The trimmer cannot tell whether this one was pinned on purpose, and the brief says unsure means keep. The review document will ask the architect whether to unpin it.
2. *menu-view.md: the module-level counter is a mechanism, not a requirement.* **Addressed.** The sentence now says a view mints each trigger id, and keeps the guarantees: unique across the application, stable for the bound position's lifetime, opaque to callers, never derived from caller or domain identity.
3. *making-skills.md and sidebar-view.md: future bake and generation tooling.* **Addressed.** The Render mechanism now says exemplar markup is rendered by hand; the "Generate or author" mechanism is now "Author", written by hand; sidebar-view's derivation table drops "(baked once bake tooling exists)".
