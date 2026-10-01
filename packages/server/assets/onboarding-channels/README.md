# Onboarding content — replacement contract

This tree contains the reviewed release content installed into new Television
data directories. The design sources live under
[`specs/ui/onboarding-artifacts/`](../../../../specs/ui/onboarding-artifacts/index.md).

**All four channels are baked content**:
generated from the design sources under `specs/ui/onboarding-artifacts/` by
`scripts/bake-onboarding.mjs` (specs/arch/onboarding/bake.md; requires the
repository's Node 24 toolchain). Do not edit
these channel folders or their `artifacts` config entries by hand — a re-bake
overwrites them. To change their content, edit the design sources
and re-bake; the diff is reviewed and committed like any content change.
Their display `name` values, channel order, and `focusChannel` in
`onboarding-channels.json` are hand-edits the bake preserves. An artifact
entry may also carry optional initial-page `size` and `geometry`; for baked
channels author those fields in the design channel's `layout.yml` so a
re-bake carries them into the config. Missing fields use the shared page
defaults. The bake renders flat `.frame` sources into complete HTML documents
and copies flat `.md` sources unchanged. Declared skill assets are copied beside
the task and calendar entry documents; the welcome is a single HTML file with
an inline logo.

**All non-tv-guide content is swap-free**: tests derive their expectations
from this config and these files at runtime, so content edits need zero test
changes.

**`tv-guide` content is deliberately test-pinned** (it is released copy) and
is covered by `packages/server/test/onboarding-content.test.ts`, which pins
its artifact configuration, single-file source, canonical dependencies, and
public styling vocabulary. Fresh-install acceptance derives served content
from the package, including the welcome document. Changes to a pinned contract
require updating that assertion deliberately.

**The channel SET (folder names = slugs) is pinned in exactly one place**:
`test/helpers/shipped-onboarding.ts`. Adding, removing, or renaming a channel
updates that list deliberately. Slugs are permanent identity once released —
renaming one reads as delete-plus-add to every existing install
(specs/arch/onboarding/content.md).

Build validation (`packages/server/scripts/validate-onboarding.mjs`) checks
every edit; this README is the only unreferenced file allowed in this tree.
