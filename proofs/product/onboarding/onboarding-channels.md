*How the promises in Onboarding channels are proven.*

# Onboarding channels — proof

Proves [specs/product/onboarding/onboarding-channels.md](../../../specs/product/onboarding/onboarding-channels.md).

## Coverage model

Acceptance tests invoke the built `tv` process against real temporary
[Television homes](../../../specs/product/cli.md#^cli-home) and observe
channel state through CLI commands and served artifact bytes over HTTP. Each
home holds a config file that sets port `0` before its first boot, so the
fresh-install walk also carries
[the config-only home assertion](#^ac-config-only-home).
Fixtures use the production bundle or small authored bundle variants.
Every source shape crosses the real installation and serving paths without
mocks. Artifacts' stores seeded from the bundle are observed through spawned
`tv resource json` commands; the installer proof carries the failure breadth.

Browser acceptance runs against the built CLI server. It covers initial focus,
ordinary sidebar placement, and reconnecting across an upgrade. The shared
motion override excludes unrelated CSS motion from these claims; interaction
proofs retain that coverage.

The [content proof](../../arch/onboarding/content.md#^t-production-tree) pins
the shipped set and designated focus channel. These tests derive package data
at runtime, including the single-file welcome document and the sibling assets
of task and calendar directory artifacts.

A declared starting value whose write fails leaves the channel installed and
the artifact's store without a value, or holding what was saved when the write
failed after saving it ([its promise](../../../specs/product/onboarding/onboarding-channels.md#^onboarding-store-failed)).
A built-process walk could reach a failed write only by damaging a home before
its first boot, so the installed channel and the store without a value are
proven by
[the installer's declared-store contract](../../arch/onboarding/installer.md#^t-onboarding-stores),
over real storage, and what a write that failed after saving leaves by
[the JSON store's uncertain-write contract](../../arch/resources/json-store.md#^js-arch-t-uncertain). What Company To-dos shows when it cannot use its store is
[the onboarding UI proof](../../ui/onboarding-artifacts/index.md)'s.

## Test hooks

Browser restart cases use the stable development proxy to keep one browser
origin while forwarding real HTTP and websocket traffic to successive server
processes. It replaces no client or server mechanism; ordinary installations
connect to the server directly.

## Assertions

### Acceptance test criteria

The built-process criteria below are **acceptance** shape ([testing-policy.md](../../../specs/arch/testing-policy.md)): the boundary is the built `tv` CLI, spawned as a real process against a real temporary home and observed through spawned `tv` commands and real HTTP. The server and every command receive the home with `--home`; its config file sets port `0`, and commands pass the acquired port with `--port`, following [the test-runner recipe](../../../specs/arch/test-runner/test-runner.md#Test infrastructure addresses). Bundle variation uses the production resolution mechanism — the built binary is copied beside a fixture bundle, or beside none. Setup reaches starting states through real boots and real `tv` commands. Fixtures are named per assertion. No mocks or test hooks are used. The tests derive the designated focus slug from the package; [arch/onboarding/content.md#^t-production-tree](../../arch/onboarding/content.md#^t-production-tree) independently pins the production value, so the acceptance walk does not duplicate package data.

- **Fresh install.** First serve against a new home creates every bundled onboarding channel with its configured name and one configured-or-default tab page per configured artifact in artifact-list order; all channels are unpinned and the display-active channel is the designated channel from the bundle. Every entry document served over HTTP carries the corresponding packaged content, and every directory artifact serves its sibling files byte-identical to the package. Expectations come from the shipped config and sources at runtime. Fixture: the shipped production bundle. TV Guide uses the same source-derived check for its single-file welcome document, with no separate welcome-image fetch; the task and calendar directories retain real sibling-file serving coverage. Every installed artifact's ID, as `tv` reports it, is in the generated form rather than the earlier predictable form, and the store of each artifact whose shipped config entry declares one holds its declared starting value with each date moved from the declared `shiftDatesFrom` to the installation day, as `tv resource json get --artifact` reports; today that is Company To-dos, holding the starting tasks due around the day of the walk. This proves [fresh installation](../../../specs/product/onboarding/onboarding-channels.md#^fresh-install), [generated IDs](../../../specs/product/onboarding/onboarding-channels.md#^onboarding-artifact-ids) and [stores that start with data](../../../specs/product/onboarding/onboarding-channels.md#^onboarding-stores) — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` “Fresh install creates every bundled channel and focuses the designated channel”, which finds artifacts through their channels' pages and derives the declared stores from the shipped config)*. ^ac-fresh-install
- **A config-only home is brand-new.** The fresh-install walk's first serve runs over a home that holds only its config file and installs every bundled channel, so a config file does not make a home count as already served. This proves the config-only case of [fresh installation](../../../specs/product/onboarding/onboarding-channels.md#^fresh-install) — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` "Fresh install creates every bundled channel and focuses the designated channel")*. ^ac-config-only-home
- **Markdown artifact.** A boot beside a bundle whose channel carries a markdown artifact installs it as an ordinary markdown path artifact: the artifact record the CLI reports points at a `.md` file, and its content is served over the markdown content endpoint byte-identical to the packaged source. Fixture: a bundle with one markdown artifact — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` "Markdown artifact installs as an ordinary markdown path artifact")*. ^ac-markdown-artifact
- **Artifact page order and layout.** A boot beside a bundle whose channel carries several artifacts installs one tab page per artifact in the bundle's artifact-list order. Each page carries its configured size and geometry when present and the corresponding shared default when absent; membership remains one artifact per page. Fixture: a bundle with size-only, full-screen-only, both-authored, and default artifacts in a pinned order — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` “Configured artifact order installs as configured-or-default pages”)*. ^ac-artifact-page-order
- **Missing bundle control.** The same built binary copied without its packaged sibling directories starts with exactly one empty, unmarked "Default" channel and no artifacts — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` "Missing bundle control: the same binary without packaged siblings starts with one empty Default")*. ^ac-missing-bundle
- **Upgrade receives only new channels.** A home first installed by a real boot beside a fixture bundle, then booted beside a superset bundle containing one additional channel, gains exactly that unpinned channel; previously received channels are unchanged and no duplicates appear. An artifact title changed through the built CLI and its user-owned target bytes edited after the first boot both survive the superset boot. Fixtures: subset and superset bundles — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` "Upgrade receives only new channels")*. ^ac-upgrade-only-new
- **Deletion respected.** After deleting an installed onboarding channel — and, in a separate walk of the same path, one of its artifacts — through real `tv` commands and restarting, nothing is re-created. In a third walk, after `tv resource json set --artifact` replaces Company To-dos' tasks with one task of the walk's own, and a fourth, after `tv resource json remove --artifact` removes its whole value, a restart writes nothing to the store, which still holds what the walk left — *(policy-grade tests: the cases under `test/node/fresh-install-onboarding.test.ts` "Deletion respected": the first two, and the generated "Company To-dos' store, with its value %s, gains nothing from the starting value after restart", which finds Company To-dos from the shipped config)*. ^ac-deletion-respected
- **Focus is not stolen.** A home given content through real `tv` commands keeps its active channel across a boot that installs new onboarding channels — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` "Focus is not stolen from a storage directory with real content")*. ^ac-focus-not-stolen
- **Pre-initialized storage counts as fresh.** A home containing exactly the token-only construction's output — storage directories and `state/token`, with no channels or display state — plus its config file installs every onboarding channel on its first serve, focuses the bundle's designated channel, and contains no "Default" channel. Fixture: the checked-in token-only storage shape, with the config file that sets port `0` — *(policy-grade test: `test/node/fresh-install-onboarding.test.ts` "Pre-initialized storage counts as fresh")*. ^ac-preinit-focus
- **Single-artifact-release upgrade.** A home in the state the single-artifact release leaves behind boots cleanly: TV Guide content is not duplicated or modified, newer channels install, focus is unchanged, and the legacy sentinel remains byte-identical. Fixture: an authored v1 home containing exactly the migration input surface, plus the config file that sets port `0` — *(covered by authored test: `test/node/fresh-install-onboarding.test.ts` “Legacy upgrade boots cleanly without duplicating TV Guide”)*. ^ac-legacy-upgrade
- **Screen-named state upgrade.** A pre-rename version-2 `onboarding.json` boots cleanly: every recorded screen slug remains received without reinstall, every timestamp is unchanged, newly available channels install once, the resulting state is version 3 with the channel-named field, and a second boot changes no byte. Fixture: version-2 state generated from a real first boot before rewriting its field names — *(covered by inherited test: `test/node/fresh-install-onboarding.test.ts` "Pre-rename v2 onboarding state preserves every record through the built CLI")*. ^ac-v2-state-upgrade

The browser criteria are also **acceptance** shape: a real browser drives the web client against a really-running built-CLI server. A stable development-proxy hook keeps the app origin constant across real backend restarts while forwarding real HTTP and websocket traffic; it replaces no client or server mechanism. The shared motion override is a declared mock of unrelated transitions and animations, which these assertions forfeit to the owning channel-sidebar, tab-strip, and stage interaction assertions. Server states are prepared by real boots and `tv` commands, and browser storage is never seeded directly. No other mocks or test hooks are used.

- **New channel appears.** A browser connected to a server that gains a new onboarding channel across a restart shows it as an ordinary unpinned channel in the channel sidebar, both when connecting after the restart and when left open to reconnect automatically; the focused channel stays unchanged — *(policy-grade tests: `packages/web/test/e2e/onboarding-browser.test.ts` "connecting after an upgrade shows the new ordinary unpinned sidebar channel without changing focus" and "an open browser automatically reconnects to the new ordinary unpinned sidebar channel without changing focus")*. ^ac-new-channel-appears
- **Fresh-install browser view.** A browser connecting to a fresh installation shows the bundle's designated channel focused and every bundled onboarding channel in the unpinned channel-sidebar group, in the ordinary newest-first order — *(policy-grade test: `packages/web/test/e2e/onboarding-browser.test.ts` "a fresh production installation shows every bundled channel newest-first with the designated channel focused")*. ^ac-fresh-browser
