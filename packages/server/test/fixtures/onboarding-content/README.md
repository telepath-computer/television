# Onboarding content validation fixtures

Fixture content trees for the validation matrix in
`proofs/arch/onboarding/content.md#^t-validation-matrix`. Each tree is passed as
an explicit content-tree root to the real validation entry points
(`specs/arch/onboarding/content.md#^build-validation`); one tree per defect
class, plus one fully valid tree. Fake channels live only here, never in the
production asset tree (`specs/arch/onboarding/content.md#^no-placeholder-content`).

| Fixture | Defect class |
|---|---|
| `valid/` | none — passes schema-only and full build validation; carries several artifacts in pinned order, exercises all three artifact source shapes (directory `first/intro/`, HTML file `second/notes.html`, markdown file `second/readme.md`), and includes the allowed root `README.md` |
| `unparseable-config/` | `onboarding-channels.json` does not parse as JSON |
| `schema-bad-version/` | config `version` is earlier than `3` |
| `schema-empty-channels/` | `channels` is empty |
| `schema-empty-name/` | channel `name` empty after trimming |
| `schema-empty-title/` | artifact `title` empty after trimming |
| `schema-empty-artifacts/` | channel `artifacts` is empty |
| `slug-pattern/` | slug violates the slug pattern |
| `slug-double-hyphen/` | slug contains `--` (`specs/arch/onboarding/content.md#^slug-rules`) |
| `missing-channel-folder/` | configured channel slug has no matching folder |
| `unknown-focus/` | `focusChannel` names an unconfigured slug |
| `missing-artifact-source/` | configured artifact has no source — schema-valid, so it also proves schema-only runtime validation passes where full build validation fails (`specs/arch/onboarding/installer.md#^lazy-source-resolution`) |
| `ambiguous-artifact-source/` | artifact has both `<slug>.html` and `<slug>/` sources — one tree per ambiguity pair, with the other two below |
| `ambiguous-html-md/` | artifact has both `<slug>.html` and `<slug>.md` sources |
| `ambiguous-md-dir/` | artifact has both `<slug>.md` and `<slug>/` sources |
| `dir-artifact-no-index/` | directory artifact without root `index.html` |
| `duplicate-channel-slugs/` | duplicate channel slugs |
| `duplicate-artifact-slugs/` | duplicate artifact slugs within a channel |
| `orphan-channel-folder/` | channel folder on disk not referenced by the config |
| `orphan-root-file/` | file at the content-tree root not permitted by the config or README exception |
| `orphan-artifact-file/` | artifact file on disk not referenced by the config |
| `orphan-dotfile/` | dot-prefixed file not referenced by the config — any unreferenced content fails, with no hidden-file carve-out |
