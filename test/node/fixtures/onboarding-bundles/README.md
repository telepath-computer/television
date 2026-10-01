# Built-CLI acceptance fixture bundles

Onboarding bundles placed beside a copy of the really-built CLI binary by the
acceptance suite in `test/node/fresh-install-onboarding.test.ts`, exercising
the production sibling-directory resolution
(specs/product/onboarding/onboarding-channels.md acceptance criteria), and
reused by the browser acceptance suite in
`packages/web/test/e2e/onboarding-browser.test.ts`.

Tier split: these bundles feed **acceptance tests at the built-CLI/browser
boundary**; the bundles under
`packages/server/test/fixtures/onboarding-bundles/` feed the store-level
installer contract tests.

| Bundle | Purpose |
|---|---|
| `resolution/` | distinct-from-production content proving the built binary resolves its `./onboarding` sibling (`proofs/arch/cli/index.md#^t-resolution`) |
| `subset/` | first-boot bundle for the upgrade walk (`^ac-upgrade-only-new`) |
| `superset/` | `subset` plus one new channel; also drives deletion/focus walks |
| `superset-plus/` | `superset` plus a third channel; its promotion after a restart is the observable proof the reconnect bootstrap and promotion pass completed (the retired `^ac-tab-close-permanent` walk — tab promotion is removed by the redesign, decision 13) |
| `tv-guide-superset/` | `tv-guide` plus a newer channel, for the legacy-upgrade walk (`^ac-legacy-upgrade`) |
| `markdown/` | single channel with one markdown artifact, for the markdown-artifact walk (`^ac-markdown-artifact`; the shipped production bundle carries none) |
| `designed/` | single channel with size-only, full-screen-only, both-authored, and default pages in authored order (`^ac-artifact-page-order`) |
