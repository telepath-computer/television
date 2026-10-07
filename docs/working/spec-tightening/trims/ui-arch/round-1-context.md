# Round 1 context: ui-arch trim

**Area:** UI architecture (`ui-arch`).

**Specs in the area:**
- every file in `specs/arch/ui/`: `index.md`, `foundation.md`, `elements.md`, `conformance.md`, `keyboard-navigation.md`, `lit-view.md`, `menu-view.md`, `overflow-fade.md`;
- every file in `specs/arch/skills/`: `sidebar-view.md`;
- `specs/arch/canonical.md`, `specs/arch/node-versions.md`, `specs/arch/making-skills.md`, `specs/arch/skillbench.md`, `specs/arch/developer-skills.md`.

The UI specs under `specs/ui/` are not in this area.

**Base commit:** `f6cdd91e417e1f94c8617baebb016e921c21d6e5` (`git merge-base HEAD origin/thopter/spec-tightening`). See the trim with `git diff f6cdd91e..HEAD -- specs`.

**Notes from the trimmer:**
- `canonical.md` and `developer-skills.md` are unchanged: on reading, every statement was a contract (artifacts, the frozen bundle, a developer-facing CLI) or a procedure.
- `conformance.md` describes automated checks that do not exist yet (the TV-649 release exception). That is left as written and will be raised with the architect as a decision; it is not something the trim decides.
- No block ref was removed, so no citation was repointed or left dangling. The spec-link test passes.
- One pointer was corrected: `conformance.md` said the byte-identity and delivery checks are required by `index.md`; `index.md` never required them, `foundation.md` does.
