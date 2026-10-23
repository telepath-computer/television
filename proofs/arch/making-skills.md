*How the promises in Making skills are proven.*

# Making skills — proof

Proves [specs/arch/making-skills.md](../../specs/arch/making-skills.md).

## Coverage model

Designed skill surfaces follow their owning UI proofs: MDX surfaces use story conformance and retained frame/template surfaces keep [their conformance contract](./ui/conformance.md). This changes no bundle-membership promise. [Template guidance](./templates/authoring.md) carries template-copy and artifact-snapshot guidance through the real build; this proof retains the general packaging checks.

### Shipped-content evidence

The build test executes the real manifest-driven skills build and checks salient generated guidance and runtime assets, including exact release-version pass-through into authored-against metadata. The same seam proves the `television` bundle's four-file shape and the manifest's sole `television` member; [theme authoring](./themes/authoring.md) owns `theming.md` content and its detailed source-to-bundle proof, [resource guidance](./resources/guidance.md) owns `resources.md` content, and [template guidance](./templates/authoring.md) owns `templates.md` content. The onboarding build emits calendar and task browser components separately under `onboarding-dist/`; [the bake proof](./onboarding/bake.md#^t-baked-content) owns their use. The CLI build copies the complete producer tree byte-for-byte into its packaged `dist/skills`; [arch/cli/index.md#^cli-build-skills-copy](./cli/index.md#^cli-build-skills-copy) owns that package crossing. Finally, [product/cli.md#^cli-ac-skills-copy](../product/cli.md#^cli-ac-skills-copy) spawns the built `tv skills install` command and compares the complete installed tree and every byte with the packaged tree. These checks compose one source-to-consumer chain; `skills.json` remains the membership registry. ^skills-authored-app-version

## Test hooks

`TV_SKILLS_DIST_DIR` selects a temporary output destination for the real build; production uses the default dist directory. No build mechanism is replaced.

## Assertions

### Test assertions

- **Seam** (authoritative source fragments → real manifest-driven skills build → emitted skill text): the built `television` skill carries current release discovery, exact-version pass-through, advisory meaning, set/preserve/omit rules, and the canonical query shape for authored artifacts. *(policy-grade test: `test/repo/skills-build.test.ts`, cases tagged `^making-skills-t-authored-app-version`)* ^making-skills-t-authored-app-version
- **Seam** (skills manifest → real skills build → emitted trees): only `television` appears in `packages/skills/dist/`, with `SKILL.md`, `theming.md`, `resources.md`, and `templates.md` and links from the primary file. Calendar and task browser components appear in `packages/skills/onboarding-dist/` for baking, while table and task guidance do not ship to an agent. *(policy-grade test: `test/repo/skills-build.test.ts`, cases tagged `^making-skills-t-theming-bundle`)* ^making-skills-t-theming-bundle
