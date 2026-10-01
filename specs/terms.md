*Glossary of Television spec terms; each term links to the spec that owns it. Maintained by review, not generated.*

# Terms

These are the terms used to talk about the spec system itself. Domain terms are defined by the spec authoritative for them and collected here as they arise. Keeping this list correct is part of reviewing any change that introduces or moves a term.

- *spec* — an authority document under `specs/`. Owned by `spec-policy.md`.
- *authority* — exclusive ownership of a slice of truth by one spec. Owned by `spec-policy.md`.
- *product spec* — a spec defining user-facing behavior. Owned by `spec-policy.md`.
- *arch spec* — a spec defining modules and contracts. Owned by `spec-policy.md`.
- *block ref* — a stable anchor on a statement, citable from elsewhere. Owned by `spec-policy.md`.
- *proof* — the derived-authority document under `proofs/` that says how one mirrored spec's promises are proven; the spec wins on conflict. Owned by `spec-proofs.md`.
- *testing directive* — human-owned guidance in a spec's `## Testing` section about how its promises should be tested, which its proof must honor. Owned by `spec-proofs.md`.
- *boundary test* — a test that exercises a production code path through a real I/O boundary rather than a double. Owned by `arch/testing-policy.md`.
- *boundary seam* — the edge where one part of the system meets another (a module dependency, network protocol, subprocess, IPC, shell, browser, filesystem, the iframe/webview sandbox, etc.); the place a test may mock to isolate logic on one side. Owned by `arch/testing-policy.md`.
- *fixture* — authored data a test feeds the system (inputs, seeded state, documents); it can be wrong but cannot skip production code, unlike a mock (a replaced mechanism). Owned by `arch/testing-policy.md`.
- *compositional coverage* — proving a behavior across a clean, minimal seam by composing a contract test on each side with a seam test that the handoff is wired on the real path, rather than enumerating end-to-end permutations; valid only given a single clean handoff. Owned by `arch/testing-policy.md`.
- *spine* — a deliverable's set of principal paths from its outermost boundary to an observable outcome, including each principal alternative exit (validation failure, refusal, recoverable error); every spine path must be proven by an acceptance test. Owned by `arch/testing-policy.md`.
- *breadth* — the variation that routes into a deliverable's spine paths (input permutations, enumerated property values, edge cases, which inputs succeed or fail), covered by compositional contract-and-seam tests rather than re-run end to end. Owned by `arch/testing-policy.md`.
- *acceptance test* — a test exercising one of a deliverable's principal paths at the outermost boundary with mocks minimized to a default of none on the path under test (an exceptional mock is justified, greenlit, and forfeit-named; motion disablement is the standing carve-out), asserting the outcome a real user or agent would observe. Owned by `arch/testing-policy.md`.
- *contract test* — a test proving one side of a named seam in isolation (producer emits right / consumer handles right), with the seam as its edge and the other side absent or mocked; where permutation breadth lives. Owned by `arch/testing-policy.md`.
- *seam test* — a test proving one named handoff is wired on the real production path, crossed once for real, without re-running the permutations the contract tests cover. Owned by `arch/testing-policy.md`.
- *runbook* — a spec stating an operational procedure step by step; authoritative for the process, derived from (and citing) the mechanism specs it exercises, which win on conflict. Owned by `spec-policy.md`.
- *explainer* — a derived spec document that may restate one concern owned across several specs from start to finish; the owning specs win on conflict, and it has no proof. Owned by `spec-policy.md`.
- *note* — any working document. Owned by `spec-docs.md`.
- *proposal* — a working document that explores a change before its decisions are written into the specs. Owned by `spec-docs.md`.
- *working document* — a document a task writes while work is in flight, kept under `docs/working/` until pre-merge docs prep. Owned by `spec-docs.md`.
- *archive* — `docs/archive/`, salient working documents included with a squash merge, grouped by month and preserved in Git history; nobody's job to keep updated. Owned by `spec-docs.md`.
- *pre-merge docs prep* — the working-document cleanup performed once the work is complete, before the contribution is considered ready to merge into a shared branch. Owned by `spec-docs.md`.
- *back pressure* — learnings from implementation that flow back up the chain into spec changes; welcome, and cleaned up rather than left as a gap. Owned by `spec-policy.md`.
- *spec gate* — the gate that begins the autonomous phase: every spec delta has converged under independent agent review, with human review handled as `spec-policy.md` requires. Owned by `spec-workflow.md`.
- *surface* (UI) — a distinct part of the user interface. Owned by `spec-ui.md`.
- *template* (UI) — a Liquid file owning authoritative markup for a surface or any part of it: declared parameters (`{% doc %}` with `@param` annotations), then pure markup; imports its styling and content; does no computation. Owned by `spec-ui.md`.
- *UI spec* — a surface's spec under `specs/ui/` (prose, optionally with templates, styles, and content): the exclusive authority for that surface's interaction, markup, and styling. Owned by `spec-ui.md`.

## Artifact frame and bridge

- *artifact* — a pointer to content, held externally or generated on the fly, displayed on the stage; where users interact with information and functionality that is not core to Television itself. Owned by [product/artifacts.md](product/artifacts.md).
- *document* — an artifact's content as a browser shows it: a page in its own right, with its own styling, scripts, and history, rendered inside Television but not part of Television's own page. Owned by [product/artifacts.md](product/artifacts.md).
- *icon* — a drawing from the interface's glyph vocabulary: carried by the `tv-icon` element in content, or consumed as a stencil token (`--icon-check`) where a stylesheet rule must draw it. Owned by [ui/foundation/icons/index.md](ui/foundation/icons/index.md).
- *external page artifact* — an artifact added by an `http:` or `https:` URL that is not a shared artifact's; its URL points at an ordinary web page rather than a Television artifact. Owned by [product/artifacts.md](product/artifacts.md).
- *browser demo mode* — the host-file-enabled mode in which a browser shows external page artifacts directly in their frames. Owned by [product/artifacts.md](product/artifacts.md).
- *artifact frame* — the surface holding one artifact's document; its markup, interaction, and styling are owned by [ui/app/artifact-frame/index.md](ui/app/artifact-frame/index.md).
- *filmstrip* — the stage's horizontal row of pages. Owned by [ui/app/stage/index.md](ui/app/stage/index.md).
- *remote artifact* — a `kind: "url"` artifact whose URL matches a Television artifact route; normally one served by another Television host (product-facing synonym: *shared artifact*). Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *bridge* (artifact bridge) — the injected in-frame script, Electron preload behavior, and host-side handling that carry lifecycle, navigation, keyboard, and content-update messages across the iframe/webview boundary. Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *readiness tracking* (*readiness gate*) — the lifecycle bookkeeping of a frame's most recently adopted, not-yet-retired document identity (normally the current document's); knowledge only, never a shield on the frame. Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *bridge document GUID* — a random per-load identity stamped on bridge lifecycle messages so the host can distinguish the displayed document from stale messages sent by a document that is leaving. Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *navigation-key message* — the bridge message forwarding the navigation chord (option+arrow on macOS, ctrl+arrow on Windows/Linux) out of an embedded document. Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *ready message* — the `bridge-ready` lifecycle message by which a loaded document asks the host to trust its bridge. Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *leaving message* — the `leaving` lifecycle message by which a document tells the host it is entering `pagehide` and its trust should be retired if it is still the trusted document. Owned by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md).
- *error page* — the page standing where the artifact's document would be when it cannot show; one page, its contents by state. Owned by [ui/app/artifact-frame/index.md](ui/app/artifact-frame/index.md).

## App shell and channels

- *channel* — the workspace unit a person keeps their work in, listed by the channel sidebar. Owned by [product/channels.md](product/channels.md); its sidebar presentation by [ui/app/sidebar/index.md](ui/app/sidebar/index.md).
- *channel sidebar* — the narrow region down the window's left listing channels; always qualified — never bare "sidebar", a word the `tv-sidebar-view` artifact skill also uses. Owned by [ui/app/sidebar/index.md](ui/app/sidebar/index.md).
- *channel switcher* — the collapsed navbar's trigger wearing the open channel's name, opening the channel switcher popover. Owned by [ui/app/top-bar/index.md](ui/app/top-bar/index.md).
- *channel switcher popover* — the popover composing the channel list while the channel sidebar is collapsed. Owned by [ui/app/top-bar/index.md](ui/app/top-bar/index.md).
- *pinned channels* — the channel sidebar's first group, in the order the user arranges them. Display owned by [ui/app/sidebar/index.md](ui/app/sidebar/index.md); pinning semantics by [product/channels.md](product/channels.md).
- *stage* — the region artifacts are shown in: the ground below the navbar, holding the filmstrip. Owned by [ui/app/stage/index.md](ui/app/stage/index.md).
- *page* (tab page) — the filmstrip's unit and what a tab stands for; holds an artifact. User-facing behavior owned by [product/tab-pages.md](product/tab-pages.md); presentation by [ui/app/stage/index.md](ui/app/stage/index.md).
- *system modal* — the app's interrupting surface: one dialog, its contents by state. Owned by [ui/app/system-modal/index.md](ui/app/system-modal/index.md).
- *dialog* — the panel that interrupts the screen for an important decision or issue: a backdrop over everything, a centred panel on it. Owned by [ui/app/dialog/index.md](ui/app/dialog/index.md).
- *alert* — the dialog's vocabulary for an interruption demanding a response: the question as title, the consequence in one line, Cancel and the action, the destructive action never the default. Owned by [ui/app/dialog/index.md](ui/app/dialog/index.md).
- *lift* — a z-index raising an element above its siblings on the same layer, written as a calculation on the layer token; it orders siblings only, never the app-level layers. Owned by [ui/foundation/index.md](ui/foundation/index.md), Layers.
- *navigation chord* — the platform keyboard chord (option+arrow on macOS, ctrl+arrow on Windows/Linux) that steps between tab pages and channels. Behavior owned by [product/keyboard-navigation.md](product/keyboard-navigation.md); its predicate and delivery out of documents by [arch/artifact-frame/artifact-bridge.md](arch/artifact-frame/artifact-bridge.md); the shell handler by [arch/ui/keyboard-navigation.md](arch/ui/keyboard-navigation.md).

## Themes and appearance

- *theme* — one installed package that changes Television's visual treatment server-wide through a required CSS entry and may declare sandboxed visual JavaScript or main-page JavaScript with per-theme user consent. User-visible behavior is owned by [product/themes-and-appearance.md](product/themes-and-appearance.md); its package contract by [arch/themes/index.md](arch/themes/index.md).
- *executable theme* — a theme whose manifest enables one or more root JavaScript entries: consented `main.js` in the main application document, sandboxed `iframe-background.js` behind it, or sandboxed `iframe-overlay.js` above it. Owned by [product/themes-and-appearance.md](product/themes-and-appearance.md), with its package, consent, and delivery contracts in [arch/themes/index.md](arch/themes/index.md) and [arch/themes/delivery.md](arch/themes/delivery.md).
- *theme ID* — the exact immediate directory name of an installed theme package, used for selection and stored identity. Owned by [product/themes-and-appearance.md](product/themes-and-appearance.md), with its filesystem and registry contract in [arch/themes/index.md](arch/themes/index.md).
- *theming document* — the self-contained theme-authoring guidance shipped as `theming.md` inside the `television` skill. Owned by [arch/themes/authoring.md](arch/themes/authoring.md).
- *null theme* — the absence of an active installed theme, labelled `None` or described as having no theme on user-facing surfaces. Owned by [product/themes-and-appearance.md](product/themes-and-appearance.md).
- *default theme* — the installed theme assigned on a new installation; currently Clouds. Owned by [product/themes-and-appearance.md](product/themes-and-appearance.md), with its installation contract in [arch/themes/bundled-installation.md](arch/themes/bundled-installation.md).
- *theme registry* — the server's last complete snapshot of valid installed theme records and invalid-folder errors. Owned by [arch/themes/index.md](arch/themes/index.md).
- *bundled theme* — an installed-theme package shipped with Television. Television installs it when absent and not previously handled, preserves a later absence as a user deletion, and backs up existing content before replacing it when invalid or below its per-theme minimum version. Owned by [arch/themes/bundled-installation.md](arch/themes/bundled-installation.md).
- *appearance preference* — the server-shared choice of following the system, preferring light, or preferring dark; the null theme and a theme whose `colorScheme` is `light dark` follow it. Owned by [product/themes-and-appearance.md](product/themes-and-appearance.md), with its stored contract in [arch/themes/index.md](arch/themes/index.md).
- *effective appearance* — the light or dark result after the active theme either follows the appearance preference or fixes one value. Owned by [product/themes-and-appearance.md](product/themes-and-appearance.md), with its delivery contract in [arch/themes/delivery.md](arch/themes/delivery.md).

## CLI

- *tv CLI* — the user-facing `tv` command surface. Owned by `product/cli.md`.
- *Television home* (also *home*) — the directory holding one Television installation: its optional config file and all the state and content the server keeps. Selected by `--home`, otherwise the default home; distinct from the operating-system home directory. Owned by [product/cli.md](product/cli.md#^cli-home).
- *default home* — the Television home a command uses when it is given no `--home`: the directory named in `~/.tv-home` when that file exists, otherwise `~/.television`. Owned by [product/cli.md](product/cli.md#^cli-home-selection); `~/.tv-home` by [product/cli.md](product/cli.md#^cli-home-pointer).
- *config file* — a home's optional `config.json`, holding the settings the server and local commands share: port, additional listeners, authentication, and the installed-by agent. Owned by [product/cli.md](product/cli.md#^cli-config-file); its reader and writer by [arch/cli/index.md](arch/cli/index.md).
- *connect link* — the URL a person opens to use Television, in a browser or the desktop app: the server's origin for one listening address, with `/?token=<token>` when the server requires the bearer token. Owned by [product/cli.md](product/cli.md#^cli-connect-link).
- *directive error* — a usage error the CLI itself detects while parsing arguments or validating whether a command and its options can be dispatched. Owned by `product/cli.md`.
- *focus directive* — a creation-command flag that asks for the new channel or artifact to be shown immediately. CLI spelling and signal emission are owned by [product/cli.md](product/cli.md); the resulting focus behavior by the product owner below.
- *channel focus* — the persisted active channel. Owned by [product/channels.md](product/channels.md) and its shared-state contracts.
- *artifact focus* — a transient one-shot request to select an artifact's tab page, switching to its channel when needed, with no highlight effect. Owned by [product/tab-pages.md#^tp-focus-selects](product/tab-pages.md#^tp-focus-selects); CLI request syntax is [product/cli.md](product/cli.md)'s.
- *bundled skill collection* — the Television agent skills shipped beside the built CLI. Membership is defined by `packages/skills/skills.json`; shipping and installation behavior is owned by `product/cli.md` and `arch/cli/index.md`.
- *external skills installer* — Vercel's third-party skills package that `tv skills install -i` delegates to. Owned by `product/cli.md`.

## Desktop

- *desktop application* — defined and owned by [product/desktop-app.md](product/desktop-app.md).
- *setup screen* — the desktop app's connect screen when it has no saved server connection. Owned by [ui/setup/index.md](ui/setup/index.md).
- *local page* — the desktop app's packaged `connect.html`, which shows the setup screen and the connection dialogs while a saved connection is starting. Owned by [arch/desktop/connect-flow.md](arch/desktop/connect-flow.md#^desktop-local-page).
- *Disconnect from Server* — the desktop app's command that forgets the saved connection and returns to the setup screen. Owned by [arch/desktop/connect-flow.md](arch/desktop/connect-flow.md#^desktop-disconnect-server).
- *Electron runtime* — defined and owned by [arch/desktop/runtime.md](arch/desktop/runtime.md).
- *valid Electron runtime* — defined and owned by [arch/desktop/runtime.md](arch/desktop/runtime.md).
- *upload directory* — defined and owned by [arch/desktop/distribution.md](arch/desktop/distribution.md).
- *candidate build* — defined and owned by [arch/desktop/distribution.md](arch/desktop/distribution.md).

## Testing

- *provider* — where tests run: `local` or `blaxel`. Owned by `arch/test-runner/test-runner.md`.
- *attestation* — a bare `refs/testpass/<version>/<tree-hash>` ref recording that an exact tree passed full validation under an attestation version. Owned by `arch/test-runner/attestation.md`.
- *selector* — a flag that narrows which tests run (suite, surface, package, file, grep, runner, tag). Owned by `arch/test-runner/test-runner.md`.
- *broad run* — an unnarrowed run of everything, gated by the broad-run guardrail. Owned by `arch/test-runner/test-runner.md`.
- *test surface* — an independently runnable test area declared in `test.config.mjs`. Owned by `arch/test-runner/test-registry.md`.
- *suite* — a named selection of surfaces (`unit`, `e2e`, `agent`, `all`). Owned by `arch/test-runner/test-registry.md`.
- *execution group* — an ordered band of surfaces declared in the registry. Owned by `arch/test-runner/test-registry.md`.
- *preflight* — checks run before a test run: local capability, and remote git-safety and auth. Owned by `arch/test-runner/preflight.md`.
- *run directory* — the `.test-runs/<run-id>/` tree holding a run's normalized output. Owned by `arch/test-runner/reporting.md`.
- *normalized surface result* — the per-surface result shape every runner and provider is normalized into. Owned by `arch/test-runner/reporting.md`.
- *shard* — one slice of a remote provider run. Owned by `arch/test-runner/sharded-execution.md`.
- *attempt* — one execution of a shard set, combined across retries. Owned by `arch/test-runner/sharded-execution.md`.
- *infrastructure failure* — a shard failure in setup or around the run, distinct from a test failure. Owned by `arch/test-runner/sharded-execution.md`.
- *test failure* — a shard failure caused by a failing test, distinct from an infrastructure failure. Owned by `arch/test-runner/sharded-execution.md`.
- *flaky test* — a test that passes on retry; governed by the retry budget. Owned by `arch/test-runner/flaky-tests.md`.

## Product versioning

- *Television release version* — the complete Semantic Version that identifies one exact Television release, such as `1.3.1`. Owned by [product/versioning.md](product/versioning.md); [arch/updates/index.md](arch/updates/index.md) consumes it and owns update-domain validation and comparison.
- *release name* — ordinary product language for a Television release line, such as **Television 1.3**. Owned by [product/versioning.md](product/versioning.md).
- *desktop release* — a build of the desktop app that Television releases to users, carrying the version of the Television release it is built from. Owned by [product/versioning.md](product/versioning.md).

## Update notifications

- *update channel* — the manually-deployed public JSON notice naming the latest Television release worth announcing. Owned by `product/update-notifications.md`.
- *update toast* — the server-update notice shown when the update channel names a release newer than the connected server. Owned by `product/update-notifications.md`.
- *desktop self-update notice* — the notice that tells the user of a downloaded desktop app that a desktop update has downloaded, and offers the restart that installs it. Owned by `product/update-notifications.md`.
- *desktop upgrade recommendation* — the deprecated advisory notice that tells the user of a desktop app installed from npm that the downloaded app is available; it is shown after normal Electron boot when the shell is older than the web bundle's recommended desktop release and no server-update toast applies. Owned by `product/update-notifications.md`.
- *desktop upgrade gate* — the boot barrier that halts a desktop app at a blocking gate screen, before the functional application session forms, when its shell is older than the desktop release its connected server requires. Owned by `product/update-notifications.md`.
- *desktop connect check* — the desktop shell's pre-page reachability, authentication, and Television identity check at `GET /desktop/connect-check`. Owned by `arch/updates/desktop-upgrade-gate.md`.

## Telemetry

- *telemetry* — anonymous usage data collected about a running Television server. Owned by `product/telemetry.md`.
- *telemetry event* — one recorded occurrence of a predefined kind of activity, carrying a fixed set of predefined properties. Owned by `product/telemetry.md`.
- *telemetry user* — the single anonymous identity per Television server that telemetry is keyed to; the server is the user. Owned by `product/telemetry.md`.
- *client* — one browser profile, or the desktop app, connecting to a server; the unit a *session* belongs to. Owned by `product/telemetry.md`.
- *client id* — a stable, anonymous per-client identifier persisted on the device, used to scope sessions across reconnects. Owned by `product/telemetry.md`.
- *session* — a span of genuine user engagement with the interface by one client, from which session count and length are derived. Owned by `product/telemetry.md`.
- *activity signal* — a lightweight, content-free signal the interface sends while a user is engaged, from which the server derives sessions. Owned by `product/telemetry.md`.
- *administrator guide* (also *admin guide*) — the standalone document an agent loads to install, configure, upgrade, or administer Television. Its procedural authority and publication are owned by [arch/cli/admin-guide.md](arch/cli/admin-guide.md).
- *Television skill* — the `television` skill loaded through the agent skill system; for telemetry, it carries awareness and control instructions only, not proactive disclosure. Owned by `product/telemetry.md`.
- *telemetry disclosure* — telling users that telemetry is enabled by default and how to opt out, through the [disclosure surfaces](product/telemetry.md#Disclosure).
- *agent runtime harness name* — the software running the agent, supplied as the config file's `installedByAgent` setting or to `tv skills install --installed-by-agent`, such as Codex, Claude Code, Hermes, OpenClaw, or Pi; not a personalized nickname, persona name, model name, or any value with version numbers or qualifiers. Owned by `product/telemetry.md`.
- *telemetry chokepoint* — the single typed module every telemetry event passes through (the closed event/property vocabulary + the `capture()` entry); the structural enforcement of no-UGC. Owned by `arch/telemetry/index.md`.
- *telemetry suppression gate* — the predicate that decides whether any telemetry is emitted at all under the [telemetry rules](product/telemetry.md#^telemetry-rules); named to distinguish it from other suppression mechanics in the codebase. Owned by `arch/telemetry/identity.md`.
- *telemetry sink* — the outbound boundary that delivers events to PostHog: the bounded in-memory buffer and fire-and-forget transport. Owned by `arch/telemetry/sink.md`.
- *telemetry client signal* — the generic, content-free client→server message by which a client reports a telemetry-worthy moment only it can observe, validated against a per-event registry and forwarded through the chokepoint. Owned by `arch/telemetry/client-signals.md`.

## Onboarding

- *onboarding channel* — a bundled starter channel Television installs exactly once per Television home. Owned by `product/onboarding/onboarding-channels.md`.
- *channel slug* — the stable identity key of an onboarding channel across releases, data directories, and browsers; the content folder name. Owned by `arch/onboarding/content.md`.
- *artifact slug* — the stable identity key of an onboarding artifact within its channel. Owned by `arch/onboarding/content.md`.
- *onboarding config* — the root config file in the bundled content tree that owns channel install order, the designated focus channel, display names, artifact titles, and each channel's initial tab-page order. Owned by `arch/onboarding/content.md`.
- *bake* — the manually-run script that ports an onboarding channel design from the UI spec's design sources into the bundled content tree and config; its output is committed and reviewed like any other content change. Owned by `arch/onboarding/bake.md`.
- *onboarding state file* — `state/onboarding.json`, the per-data-directory record of which channel slugs have been received. Owned by `arch/onboarding/installer.md`.
- *onboarding channel marker* — the `onboarding` field persisted in a channel's metadata, carrying its slug. Owned by `arch/onboarding/installer.md`.

## Licensing

- *shipped surface* — a distribution channel through which Television delivers code or assets to someone outside the project (the published CLI package, the desktop application, browser-delivered bundles, vendored assets). Owned by `product/licensing.md`.
- *license allowlist* — the recorded set of licenses acceptable for third-party material in shipped surfaces; the license gate (run by the standard test suites) fails anything outside it and its recorded exceptions (the Electron aggregate and elections). Owned by `product/licensing.md`.
- *license election* — the explicit, recorded choice of which license Television accepts a dual- or multi-licensed dependency under. Owned by `product/licensing.md`.
- *vendored asset* — third-party material tracked in Television's own source tree rather than consumed as a package dependency, declared in the vendored-asset manifest. Owned by `product/licensing.md`.
- *upstream aggregate* — a third-party runtime accepted as an exception because it arrives carrying its own third-party legal payload, on condition those files stay intact in what users install (Electron, inside the desktop application). Owned by `product/licensing.md`.
- *ignored package* — a package the licensing system does not inspect, gate, or name in any file it generates; the owner's recorded decision that the system leaves it alone. Owned by `product/licensing.md`.
- *handled package* — any other package we bundle or declare: it carries an allowlisted license (and, when bundled, real notice text), or the build fails. Owned by `product/licensing.md`.
