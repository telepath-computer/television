*How the promises in Making skills are proven.*

# Making skills — proof

Proves [specs/arch/making-skills.md](../../specs/arch/making-skills.md).

## Coverage model

### Shipped-content evidence

The build test executes the real manifest-driven skills build and checks salient generated guidance and runtime assets, including exact release-version pass-through into authored-against metadata. The same seam proves the `television` bundle's two-file shape and the manifest's absence of a standalone theme skill; [theme authoring](./themes/authoring.md) owns `theming.md` content and its detailed source-to-bundle proof. The CLI build copies the complete producer tree byte-for-byte into its packaged `dist/skills`; [arch/cli/index.md#^cli-build-skills-copy](./cli/index.md#^cli-build-skills-copy) owns that package crossing. Finally, [product/cli.md#^cli-ac-skills-copy](../product/cli.md#^cli-ac-skills-copy) spawns the built `tv skills install` command and compares the complete installed tree and every byte with the packaged tree. These checks compose one source-to-consumer chain; `skills.json` remains the membership registry. ^skills-authored-app-version

## Assertions

### Test assertions

- **Seam** (authoritative source fragments → real manifest-driven skills build → emitted skill text): the built `television` skill carries current release discovery, exact-version pass-through, advisory meaning, set/preserve/omit rules, and canonical query shape for authored artifacts; the built `tv-tasks`, `tv-calendar`, and `tv-table` skills and the source-only `tv-sidebar-view` guidance carry the canonical query shape and the same release-version rules — *(covered by `test/repo/skills-build.test.ts` “builds the manifest collection with television theming guidance and specialist artifacts”)*. ^making-skills-t-authored-app-version
- **Seam** (skills manifest → real manifest-driven build → emitted bundle tree): the manifest produces one `television` bundle containing `SKILL.md` and sibling `theming.md`, with the primary file referencing the supporting file, and produces no standalone `tv-theme` bundle. Content inside `theming.md` remains owned by [theme authoring](./themes/authoring.md) — *(policy-grade test: `test/repo/skills-build.test.ts` “builds the manifest collection with television theming guidance and specialist artifacts”)*. ^making-skills-t-theming-bundle
