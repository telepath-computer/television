*Proves that the built television skill introduces artifact templates and carries usable authoring guidance.*

# Artifact template guidance — proof

Proves [specs/arch/templates/authoring.md](../../../specs/arch/templates/authoring.md).

## Coverage model

The real skills build is the boundary: checks read its emitted `SKILL.md` and `templates.md`, then a guidance review checks that the instructions agree with the template and installation specs. This proves that an agent receives the document and the decisions it needs, including how to request starting display options and when to put them in a manifest. It does not repeat scanner or creation tests. [Making skills](../making-skills.md) owns general bundle membership and installation. No mechanism is mocked; the build input files are fixtures.

## Test hooks

No production test hook is needed.

## Assertions

- **Seam** (source intro and authoring file → real skills build → emitted `television` bundle): Under [the specified behavior](../../../specs/arch/templates/authoring.md#^artifact-template-skill-intro), `SKILL.md` names list, create, and path commands, directs artifact requests to consider available templates including “macro” and “stock artifact,” and points template editing requests to the sibling `templates.md`. *(policy-grade test: `test/repo/skills-build.test.ts`, cases tagged `^templates-guide-t-intro`)* ^templates-guide-t-intro
- **Seam** (source authoring document → real skills build → emitted `templates.md`): Under [the specified behavior](../../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc), the document teaches home selection, folder and manifest requirements, optional data and image, scan-based validation, copied README and excluded metadata, installed bundled-copy preservation and replacement, and post-edit validation; that the page follows `SKILL.md`'s artifact workflow and the folder name its naming guidance, that the manifest `name` is the visible and default title, and that the README describes the store's shape with a link to `resources.md`; guidance review finds no claim that a created artifact records template origin. *(policy-grade test: `test/repo/skills-build.test.ts`, cases tagged `^templates-guide-t-authoring`)* ^templates-guide-t-authoring
- **Seam** (source intro → real skills build → emitted `SKILL.md`; no mocks or test hooks): Under [the skill introduction](../../../specs/arch/templates/authoring.md#^artifact-template-skill-intro), the built intro tells agents to pass creation width, height, or full-screen flags when the request calls for them. *(policy-grade test: `test/repo/skills-build.test.ts` “emits template discovery and authoring guidance beside the television skill”)* ^templates-guide-t-display-intro
- **Seam** (source authoring document → real skills build → emitted `templates.md`; no mocks or test hooks): Under [the authoring document](../../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc), the built document teaches optional manifest `display` fields for size and full-screen state when defaults do not suit the template. *(policy-grade test: `test/repo/skills-build.test.ts` “emits template discovery and authoring guidance beside the television skill”)* ^templates-guide-t-display-authoring
