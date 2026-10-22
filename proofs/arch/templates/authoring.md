*Proves that the emitted television skill teaches safe linked-template use, compatible authoring, and explicit copying or detachment.*

# Artifact template guidance — proof

Proves [specs/arch/templates/authoring.md](../../../specs/arch/templates/authoring.md).

## Coverage model

The real skills build emits the documents an agent receives; seam checks read those emitted files.
Checks cover delivery and salient commands/rules; guidance review assesses meaning, examples and agreement with the governing template contracts.
The intro, template document and CLI capabilities must consistently distinguish changing one artifact from changing its shared template.
No browser, server or live favicon service is needed to prove instructional content.
[Making skills](../making-skills.md) owns bundle membership and installation; [template architecture](./index.md) proves the taught runtime mechanisms.
The no-default-writes and compatibility instructions are authoring duties; tests do not claim to enforce them on arbitrary user-authored pages.
The existing display guidance checks remain applicable and retain their evidence grade.
No mechanism is mocked; source documents and the emitted build tree are the inputs under examination.

## Test hooks

`TV_SKILLS_DIST_DIR` directs the real skills build into a temporary output directory; production uses its normal dist directory. It changes the destination, not build behavior.

## Assertions

- **Seam** (source intro → real skills build → emitted `SKILL.md`; no mocks): under [the introduction](../../../specs/arch/templates/authoring.md#^artifact-template-skill-intro), the skill teaches list, show-before-data, create and path; considers available templates for artifact/macro/stock-artifact requests; introduces default linking; and links `templates.md` for using, detaching and authoring. *(test to be written)* ^templates-guide-t-intro
- **Seam** (template guidance and CLI-capability sources → real skills build → delivered guidance; no mocks): under [the template document](../../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc), guidance covers selected home, flat list/show records and fresh scans, app cache, folder/URL forms, schemas and no starting data, caller validation and failed-creation inspection. It says to link for data-only changes, copy or detach before changing files for one artifact, preserve ID/store on repointing, and warn that template edits affect all linked artifacts. It teaches compatible schema/page revisions, empty/partial rendering without writes, README/resources references, URL restrictions, local SVG/PNG icons and the specified one-time site-icon acquisition order. It explains minimum-version preservation/replacement and folder deletion hazards, and refers page/naming work to `SKILL.md`. Guidance review checks these meanings; build checks verify the relevant content reaches the emitted documents without pinning incidental wording. *(test to be written)* ^templates-guide-t-authoring
- **Seam** (source intro → real skills build → emitted `SKILL.md`; no mocks; uses the declared `TV_SKILLS_DIST_DIR` hook): Under [the skill introduction](../../../specs/arch/templates/authoring.md#^artifact-template-skill-intro), the built intro tells agents to pass creation width, height, or full-screen flags when the request calls for them. *(policy-grade test: `test/repo/skills-build.test.ts` “emits template discovery and authoring guidance beside the television skill”)* ^templates-guide-t-display-intro
- **Seam** (source authoring document → real skills build → emitted `templates.md`; no mocks; uses the declared `TV_SKILLS_DIST_DIR` hook): Under [the authoring document](../../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc), the built document teaches optional manifest `display` fields for size and full-screen state when defaults do not suit the template. *(policy-grade test: `test/repo/skills-build.test.ts` “emits template discovery and authoring guidance beside the television skill”)* ^templates-guide-t-display-authoring
- **Seam** (intro and template-authoring source files → real skills build → emitted `television/SKILL.md` and `templates.md`; no mocks; uses the declared `TV_SKILLS_DIST_DIR` hook): under [the skill introduction](../../../specs/arch/templates/authoring.md#^artifact-template-skill-intro) and [the authoring document](../../../specs/arch/templates/authoring.md#^artifact-template-authoring-doc), the built intro names `--transparent` and `--no-transparent` for requests needing those display settings, and the built authoring guide teaches optional `display.transparent` alongside the size and full-screen values. Guidance review checks the meaning against the linked display contract. Extend the existing “emits template discovery and authoring guidance beside the television skill” build check. *(policy-grade tests: `test/repo/skills-build.test.ts`, “emits template discovery and authoring guidance beside the television skill”)* ^templates-guide-t-transparent
