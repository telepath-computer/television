# Trim review: updates and versioning

Branch `thopter/trim-updates`, based on `f6cdd91e` (`thopter/spec-tightening`). One commit per trimmed spec, one commit of link-only repoints in other specs and proofs, and one commit of these review files. The git diff is the complete record; this document guides it.

**Convergence:** converged in round 2. Round 1 raised three blocking and two non-blocking findings; all five were addressed. Round 2 accepted every fix and raised one non-blocking finding about proof prose (see [Effects](#effects)). The reviewer changed no files in either round.

| Spec | Words before | Words after |
|---|---:|---:|
| `specs/product/update-notifications.md` | 3,830 | 3,393 |
| `specs/product/versioning.md` | 732 | 640 |
| `specs/arch/updates/index.md` | 1,540 | 1,189 |
| `specs/arch/updates/update-channel.md` | 2,737 | 2,438 |
| `specs/arch/updates/desktop-upgrade-gate.md` | 3,775 | 3,434 |
| `specs/arch/updates/desktop-upgrade-recommendation.md` | 739 | 675 |
| `specs/arch/updates/desktop-self-update-notice.md` | 738 | 615 |
| `specs/arch/updates/version-advertisement.md` | 1,797 | 1,564 |
| `specs/arch/updates/runbook-channel-deploy.md` | 931 | 828 |
| `specs/arch/updates/runbook-ux-staging.md` | 1,657 | 1,592 |
| **Total** | **18,476** | **16,368 (−11%)** |

The cut is small for two reasons. Most of this area is contracts consumed across releases: the public channel file, the desktop connect check, the frozen preload operations, storage keys, and the release procedure that keeps npm and ToDesktop in step. And most of its explanation answers objections an implementer would raise (why the gate lives in the served bundle, why an unknown shell version gates, why the poll has jitter it does not need). Where I was unsure, I kept the text and listed it below.

## Decisions for Josh

1. **What a user sees while the channel is down after a valid read.** The product spec said an unreachable, malformed or empty channel shows no toast. The arch spec and the code keep the last valid document in memory and keep showing its toast (`packages/server/src/updates/update-channel.ts`). The reviewer flagged the contradiction as blocking, so the branch rewords `^channel-silent-failure` to: no channel error, and no toast *unless the server still holds an earlier valid notice*. Options: accept that (the branch's state, matching the code), or decide that a failed poll should clear the notice, which would change the arch spec and the code.

2. **Are the `server-status` version fields really lockstep?** `arch/updates/index.md#^updates-lockstep-contracts` says the `/events` shapes may change freely between releases because auto-reload restores a matched pair. But the gate deliberately runs in a stale bundle when the reload loop guard is exhausted (`desktop-upgrade-gate.md#^gate-reload-precedence`: "older gate code still judges correct server-emitted data"), and every older bundle reads `version` to decide whether to reload at all. So `type`, `version` and `requiredDesktopVersion` of `ServerStatusMessage` are in practice read across releases. Options: pin those three fields as frozen, cross-release members (as the desktop connect check is), or accept the risk and say so. The branch leaves the text as it is.

3. **The TV-684 cutoff paragraph (`desktop-upgrade-gate.md#^pre-gate-legacy-cutoff`).** It records the evidence query, approval owner and removal conditions for the legacy `/display` compatibility field. Part of it is an accepted limitation (shells left at cutoff stop at the connect-screen identity error), and part reads like the ticket's plan. Options: keep it whole (branch), or keep only that the projection is transitional, who approves its removal, and the accepted outcome, moving the query and thresholds to TV-684.

4. **"Every ten minutes" for desktop update checks.** The product spec promises that the downloaded app checks at start and every ten minutes. No Television code sets that: `packages/desktop/src/index.ts` calls the ToDesktop runtime's `init()` with only `updateReadyAction`, so the interval is the vendor's default. Options: keep it as a product promise and make it a stated dependency on that default (or set it explicitly), or drop the number. The branch keeps it.

5. **The staging runbook rests on proof-declared hooks.** `runbook-ux-staging.md` derives its recipes from the `TV_TEST_*` hooks declared in the proofs (`proofs/arch/updates/*#Test hooks`), which are agent-owned. The policy says a runbook derives from mechanism specs. Options: promote the staging hooks a human-facing runbook depends on into the arch specs, or accept the runbook citing proofs. The branch leaves it.

## Judgment calls

Each is a cut a reasonable person could dispute. The reviewer did not dispute any of them.

- **The channel fetch timeout** (`update-channel.md`, "Server-side polling", the "Bounds" bullet: "Each fetch times out after 10 seconds"). A value chosen to make polling work, the policy's own example of what does not belong. What remains: every timeout is a silent failure that keeps the last valid document, and the schedule bounds how often fetches happen.
- **Why the gate keys on the server, not the channel** (`desktop-upgrade-gate.md`, the uncited `^gate-server-keyed` paragraph). It explained that a channel-keyed gate would fire fleet-wide the moment the channel deployed. What remains: the delivery paragraph says keying on the connected server makes the gate fire only once that server is upgraded, and the product's `^gate-server-driven` says it never fires in advance of the user's own server upgrade.
- **The evidence behind the Electron-context rule** (`desktop-upgrade-gate.md#^electron-context`): "verified against the repo's full history and the package's npm publish record" and "insurance against a shell that has never existed". What remains: every published shell sends `?mode=electron` on every load path, so there is no user-agent fallback.
- **Product non-goals** (`update-notifications.md`, "Non-goals"). Three of four bullets restated earlier statements: no server self-upgrade (the "Five mechanisms" section), no notice for routine releases (`^channel-curated`), no shell-to-server version comparison (the auto-reload section). The fourth, no other notification surface, moved under "One notice at a time".
- **Testing-section restatements.** Each `## Testing` section is now `## Inputs to proof derivation that the spec does not otherwise show`, as `docs/working/spec-tightening/companion-changes.md` item 5 anticipates. I kept every directive about how or where to test and every statement of coverage owned elsewhere, and cut lists that repeated the spec's own promises (for example, the self-update notice's list of states that must or must not show it, the gate's "sole presentation" acceptance, "each serialized update event may contain only its stated version fields"). I placed every kept directive under "Directives from the designer or architect" without knowing which were human decisions.
- **Release-detail naming in the toast body** (`update-notifications.md#^toast-markdown`): "Release details identify the available release with its exact release version, matching the channel's `version`; a heading may use **Television `major.minor`**". What remains: the bullet points at versioning's `^pv-exact-version`, and `update-channel.md#^ops-author` still tells the channel author to copy the exact version and allows the release-line heading.
- **The markdown editor's 500 ms figure** (`version-advertisement.md#^reload-action`). The product's accepted limitation (`^reload-immediate`) still says the loss is under a second; I reworded its "sub-second window" to "less than a second" in plain words.
- **The `tv status` details in versioning** (`^pv-machine-boundary`). No developer annotation, `0.0.0` passing through, and an absent field all live in `product/cli.md` ("Server lifecycle commands"). The anchor stays as a one-line reference because test comments cite it.
- **Internal names and paths**: `ServerConnection.updateState`, `RECOMMENDED_DESKTOP_VERSION`, `DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN`, `DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN`, `isElectronMode()`, `preflightConnection()`, `loadRemote()`, `renderMarkdown`, `applyCorsMiddleware`, `staticDir`, and the paths `packages/cli/build.mjs`, `packages/web/vite.config.ts`, `packages/server/src/event-stream.ts`, `packages/web/src/markdown.ts`, `packages/desktop/src/index.ts`. Each names no contract; the behavior each sat beside is still stated.
- **The pre-diagnostic fallback in the staging runbook** (comparing hashed module script URLs for bundles that predate `window.__tvVersion`). Such bundles are long out of circulation.

## Kept but doubtful

- `desktop-upgrade-gate.md#^pre-gate-legacy-cutoff`: see decision 3.
- `update-channel.md#^poll-lifecycle` (disposing `Server` stops polling). Arguably obvious; kept because a leaked timer is an easy mistake. Nothing cites the anchor.
- `update-channel.md#^poll-cache-bust`: the exact `?t=<epoch-seconds>` parameter and request header. The decision is that every fetch bypasses the CDN cache; the exact mechanism could be derived.
- `desktop-upgrade-gate.md#^required-desktop-constant` naming `packages/server/src`, and the runbook naming `packages/server/src/required-desktop-version.ts`. Kept because a maintainer edits that constant by hand.
- `index.md#^updates-dev-version`: the `__TV_VERSION__` name and the warning that `readServerPackageVersion()`'s `package.json` fallback must not feed update logic. The warning reads as a regression trap; the name is referenced throughout the domain.
- `version-advertisement.md#^version-probe`: "nothing in the product may read them" is a prohibition. Kept as a deliberate one.
- `update-notifications.md`, "Desktop app updates": "every ten minutes" (decision 4).
- `versioning.md#^pv-themes-release` ("Television 1.3" is the theming release line, identity `1.3.1`). Reads partly as history; kept because `product/themes-and-appearance.md` cites it.
- `versioning.md#^pv-exact-version`: the long list of exact-version surfaces.
- `index.md`'s module map and `^telemetry-split`. Both orient rather than decide; I shortened the map's rows.
- The product spec's telemetry list, which repeats event properties that `arch/telemetry/client-signals.md` declares.
- `desktop-upgrade-recommendation.md#^desktop-rec-selection-precedence`, which repeats ordering stated by the gate and the product.

## Routine cuts

**Introductions.** In every spec except the two small arch notices, the "Plain english" paragraph and the "What this owns" section were folded into one introduction. Statements of what neighbouring specs own were kept only where a reader would look here first.

**Restatements of rules owned elsewhere.**
- `index.md`: the unknown-message handling details (owned by `version-advertisement.md#^unknown-messages`); the closing "follow the gate's required-floor procedure" pointer (in the runbook and the gate's operations).
- `version-advertisement.md`: the stamp-only resolution and `readServerPackageVersion()` (owned by `index.md#^updates-dev-version`); the reload-before-gate rationale (owned by the gate's `^gate-reload-precedence`; the dying-page rule stays here).
- `update-channel.md`: the channel URL code block (owned by the product's `^channel-url`); the "development build cannot meaningfully compare" sentence under `^hook-url-implies-polling` (stated in `^dev-version-no-poll`); the developer-marker rationale (owned by the product's `^toast-dev-host`); the `?serverURL=` aside under `^one-toast` (owned by `^reload-origin-rule`).
- `update-notifications.md`: the recommendation's "Last in the shared order" and the self-update notice's "After the server notice" bullets (owned by `^notice-precedence`); the "0.0.0 shell is independently exempt" sentence under developer hosts (in `^desktop-rec-scope`); citations of the arch no-telemetry anchors.
- `desktop-upgrade-recommendation.md`: "even though the first downloaded release carries a later version" (in the product's `^desktop-rec-first-release`); "the body's download link follows standard external-link behavior" (the markdown pipeline's); "the bell is not shown when the shell reaches the threshold or the gate takes precedence" (follows from "while the recommendation applies").
- `desktop-upgrade-gate.md`: "Neither threshold is computed from package versions" (stated by `^required-desktop-version` and `^desktop-rec-version`); "mirroring the toast-shown semantics".
- The three arch telemetry sections no longer list "exactly" which properties each event carries; `arch/telemetry/client-signals.md` declares them (round-1 finding 5).
- `runbook-ux-staging.md` and `runbook-channel-deploy.md`: the telemetry asides about developer hosts (owned by `product/telemetry.md#^telemetry-rules`); the restated "no push, no force-refresh".

**Rationale with no reader.** `index.md`: "mirroring the `__TV_TELEMETRY_BUILD__` precedent" and "Non-goals, not omissions". `version-advertisement.md`: "costs nothing" for the response header, "a next-day fresh tab". `update-notifications.md`: "a reload is only triggered when the client is already known-stale".

**Wording.** Throughout, I replaced shorthand ("iff", "re-presents", "belt-and-suspenders", "papers over", "gains a `version` field") with plain statements of the same rule.

## Findings that are not edits

Spec–code mismatches:
- **Version resolution is not stamp-only.** `index.md#^updates-dev-version` says the server's update version comes from the stamp alone, otherwise `0.0.0`. `packages/server/src/updates/version.ts:28-35` consults `TV_TEST_VERSION` between the two when the stamp is absent. The hook is declared in the proofs, not in the spec.
- **Where the published version comes from.** `index.md` says every workspace has the root manifest's version and the workflow publishes "that version". `.github/workflows/publish.yml` reads `packages/cli/package.json`, then copies the result to every workspace and the root, and its patch bump repeats until npm lacks the version.
- **The desktop update interval** depends on the ToDesktop runtime's default (decision 4).
- **Immutable caching** goes to every file under `assets/` (`packages/server/src/server.ts:262-270`), not to files checked as content-hashed; this relies on Vite's output layout. Consistent with the spec's intent.
- **The gate's subscription** goes through a shared desktop-update state (`packages/web/src/views/desktop-upgrade-gate.ts:79-84`, `desktop-update.ts:72-80`), not a direct bridge subscription; the behavior matches `^gate-instructions`.

Gaps in the specs:
- The `ServerStatusMessage` fields read across releases (decision 2).
- `runbook-ux-staging.md`'s knob table lists the server-notice and recommendation dismissal keys but not `tv-desktop-self-update-dismissed`, which a recipe uses.
- `runbook-channel-deploy.md` step 3 says "At merge time, also follow the release-specific compatibility record next to it" and links `desktop-upgrade-gate.md#^ops-first-gate`, which states the 1.3.1 requirement rather than a procedure to follow. The intended action is unclear.

## Effects

**Stale proof sections** (proofs are re-derived after acceptance):
- `proofs/arch/updates/update-channel.md#^t-poll-failures` asserts "a fetch that reaches the 10-second timeout"; the spec no longer states the value.
- The coverage models of `proofs/product/versioning.md`, `proofs/product/update-notifications.md`, `proofs/arch/updates/desktop-upgrade-gate.md` and `proofs/arch/updates/desktop-self-update-notice.md` refer to "the spec's Testing section" in prose (round-2 finding 6, deliberately not edited because only links may change).
- Proofs that name `RECOMMENDED_DESKTOP_VERSION`, `DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN` and similar constants still match the code; they just no longer echo the spec.

**Citations repointed** (link target only), from `#Testing` to `#Inputs to proof derivation that the spec does not otherwise show` unless noted:
- `specs/arch/desktop/updates.md` → `product/update-notifications.md`
- `specs/ui/app/index.md` → `arch/updates/desktop-upgrade-gate.md` and `product/update-notifications.md`
- `specs/ui/app/update-notification/index.md` → `arch/updates/update-channel.md`, `arch/updates/desktop-self-update-notice.md`, `product/update-notifications.md`
- `specs/ui/app/desktop-upgrade-gate/index.md` → `arch/updates/desktop-upgrade-gate.md`, `product/update-notifications.md`
- `specs/ui/app/dialog/index.md` → `product/update-notifications.md`
- `proofs/arch/desktop/distribution.md` → `product/versioning.md`
- `proofs/arch/updates/desktop-upgrade-gate.md` → `arch/updates/desktop-upgrade-gate.md`
- `specs/product/telemetry.md` → `product/update-notifications.md#Telemetry`, which owns what that sentence claims.

**Citations left dangling:** none. The only anchor removed, `^gate-server-keyed`, had no citations.

**Spec-link test:** passes, 8 of 8, with no expected failures. The brief's borrowed `node_modules` path (`~/workspace/wt/television/serve-persist-fix-tv-856`) does not exist on this host; I linked `~/workspace/wt/television-test-runner-guardrails/node_modules` instead. Heading anchors are not checked by that test, so the heading repoints above were verified by search.

## Raw review record

- Round 1: `round-1-context.md`, `round-1-review.md`, `round-1-reviewer.log`.
- Round 2: `round-2-context.md`, `round-2-review.md`, `round-2-reviewer.log`.

My response to round 2's only finding, finding 6 (non-blocking): disputed for this run. The finding asks to reword proof coverage-model prose that names "the spec's Testing section". It is prose, not a citation link, and the brief forbids editing proofs beyond link repoints. It is listed under stale proof sections for re-derivation.
