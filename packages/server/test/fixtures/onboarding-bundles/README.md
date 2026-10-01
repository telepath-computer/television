# Onboarding installer fixture bundles

Small content trees driving the installer contract tests in
`packages/server/test/onboarding-installer.test.ts`
(specs/arch/onboarding/installer.md test assertions). All are schema-valid so
the install loop runs; `*-broken` trees have a channel whose artifact source is
missing, exercising lazy per-channel failure
(specs/arch/onboarding/installer.md#^lazy-source-resolution).

Tier split: these bundles feed **store-level contract tests** (direct
`ServerStore` construction); the bundles under
`test/node/fixtures/onboarding-bundles/` feed the **built-CLI and browser
acceptance suites** through the production sibling-directory resolution.

| Bundle | Purpose |
|---|---|
| `two-channels/` | ordinary two-channel bundle (file + directory artifact) for exactly-once, crash retry, focus, overwrite, telemetry-silence cases |
| `markdown-channel/` | single channel with a markdown file artifact, for the `.md` destination-extension and overwrite cases (`^copy-overwrite-unmarked`, `^t-overwrite-unmarked`) |
| `ordered-artifacts/` | single channel with size-only, full-screen-only, both-authored, and default pages in authored order (`^t-layout-install`, `^t-crash-retry`) |
| `second-broken/` | first channel installs, second fails on a missing source (`^t-per-channel-persistence`) |
| `first-broken/` | first channel fails, later channel still installs (`^failure-containment`); focus channel fails to install (`^t-focus-matrix`) |
| `tv-guide-plus/` | bundle containing `tv-guide` plus a newer channel, for migration cases (`^t-migrate-v1`, `^t-migrate-legacy-v2`, `^t-migrate-artifact`) |
