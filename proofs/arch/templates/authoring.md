*Proves that the built television skill introduces artifact templates and carries usable authoring guidance.*

# Artifact template guidance — proof

Proves [specs/arch/templates/authoring.md](../../../specs/arch/templates/authoring.md).

## Coverage model

The real skills build is the boundary: checks read its emitted `SKILL.md` and `templates.md`, then a guidance review checks that the instructions agree with the template and installation specs. This proves that an agent receives the document and the decisions it needs. It does not repeat scanner or creation tests. [Making skills](../making-skills.md) owns general bundle membership and installation.

## Test hooks

No production test hook is needed.

## Assertions

- **Seam** (source intro and authoring file → real skills build → emitted `television` bundle): Under [the specified behavior](../../../specs/arch/templates/authoring.md#^artifact-template-skill-intro), `SKILL.md` names list, create, and path commands, directs artifact requests to consider available templates including “macro” and “stock artifact,” and points template editing requests to the sibling `templates.md`. *(policy-grade test: `test/repo/skills-build.test.ts`, cases tagged `^templates-guide-t-intro`)* ^templates-guide-t-intro
- **Seam** (source authoring document → real skills build → emitted `templates.md`): Under [the specified behavior](../../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc), the document teaches home selection, folder and manifest requirements, optional data and image, scan-based validation, copied README and excluded metadata, installed bundled-copy preservation and replacement, and post-edit validation; guidance review finds no claim that a created artifact records template origin. *(policy-grade test: `test/repo/skills-build.test.ts`, cases tagged `^templates-guide-t-authoring`)* ^templates-guide-t-authoring
