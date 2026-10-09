*Runbook: staging every user-visible update-notifications state — server toast, bell, dismissal, desktop self-update notice, desktop recommendation, and desktop upgrade gate — on a development machine, for design/UX review.*

**Plain english:** the step-by-step recipes for making each update-related screen state appear on demand, so a designer can look at it or an agent can be told "get it into this state so I can see it" and do so deterministically. No code changes are needed for any recipe.

# Runbook: staging the update UX states

This is a *runbook* ([spec-policy.md#^runbook-type](../../spec-policy.md#^runbook-type)), derived from the test hooks and mechanisms of this domain: [arch/updates/index.md#^updates-test-hooks](../../../proofs/arch/updates/index.md#^updates-test-hooks), [update-channel.md#Test hooks](../../../proofs/arch/updates/update-channel.md#Test hooks), [desktop-upgrade-recommendation.md](./desktop-upgrade-recommendation.md), [desktop-upgrade-gate.md#Test hooks](../../../proofs/arch/updates/desktop-upgrade-gate.md#Test hooks), [version-advertisement.md#Test hooks](../../../proofs/arch/updates/version-advertisement.md#Test hooks). On conflict, those specs win.

Every recipe here uses only sanctioned hooks and is safe on developer machines: `TV_UPDATE_CHANNEL_URL` deliberately overrides the `0.0.0` dev-version suppression and never defaults to the production URL ([update-channel.md#^hook-url-implies-polling](./update-channel.md#^hook-url-implies-polling)), and the `TV_TEST_*` variables are structurally inert in released builds. Each recipe that starts the server with `tv serve` selects a temporary [Television home](../../product/cli.md#^cli-home-selection) with `--home`, and sets that home's port and authentication with [`tv config set`](../../product/cli.md#^cli-config-set) before `tv serve` reads them. Ports are examples; any free ports work. All commands run from the repo root. ^updates-ux-staging

> **Keep `~/.tv-developer` in place on developer hosts** — do not delete it for staging. It never blocks a recipe: the marker has no effect on channel polling or any other update mechanism ([update-channel.md#^dev-marker-no-bypass](./update-channel.md#^dev-marker-no-bypass)). Telemetry follows the [single enablement and destination cascade](../../product/telemetry.md#^telemetry-rules). ^staging-developer-marker

## Step 0 — a local update channel (used by the server-toast and gate recipes)

Serve a channel document from a local directory — `version` must be newer than the server's for the toast ([update-channel.md#^relay-split](./update-channel.md#^relay-split)); the `desktop` block is the gate screen's body (delete it to see the built-in fallback, [desktop-upgrade-gate.md#^gate-instructions](./desktop-upgrade-gate.md#^gate-instructions)):

```bash
mkdir -p /tmp/tv-demo-channel && cat > /tmp/tv-demo-channel/update-channel.json <<'EOF'
{ "schemaVersion": 1, "version": "99.0.0",
  "toast": { "markdown": "**Television 99.0.0** is out.", "prompt": "Please upgrade my Television server." },
  "desktop": { "upgradeMarkdown": "**Television Desktop 2.0.0 required.** [Download the latest version for Mac](https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64) and install it." } }
EOF
cd /tmp/tv-demo-channel && python3 -m http.server 8399 --bind 127.0.0.1
```

## Step 1 — a staging server that serves the interface (used by the browser previews and the real Electron app)

The interface must come from the server it connects to ([version-advertisement.md#^reload-origin-rule](./version-advertisement.md#^reload-origin-rule)). The from-source CLI serves the interface built in `packages/web/dist` ([the CLI's development asset resolvers](../cli/index.md#Build and packaged asset layout)), and the server runs from source, so the `TV_TEST_*` hooks are live. Give the staging server its home once:

```bash
npx tsx packages/cli/src/index.ts --home /tmp/tv-staging-home config set port 4402 auth false
```

Each recipe builds the interface with `npm run build:web` first and then starts the staging server with `npx tsx packages/cli/src/index.ts --home /tmp/tv-staging-home serve`. A recipe that stages a server version stamps the bundle to match it with `TV_TEST_WEB_VERSION`, which avoids an auto-reload attempt from the version mismatch.

## Toast + bell (browser)

The interface must come from the server it connects to ([version-advertisement.md#^reload-origin-rule](./version-advertisement.md#^reload-origin-rule)), so use the built CLI, which serves it. With the fast poll interval ([update-channel.md#^hook-poll-interval](./update-channel.md#^hook-poll-interval)), live edits to the channel JSON reach an open page within seconds:

```bash
npm run build
node packages/cli/dist/cli.cjs --home /tmp/tv-demo-storage config set port 4400 auth false
TV_UPDATE_CHANNEL_URL=http://127.0.0.1:8399/update-channel.json \
TV_UPDATE_CHANNEL_POLL_INTERVAL_MS=2000 \
node packages/cli/dist/cli.cjs --home /tmp/tv-demo-storage serve
# open http://127.0.0.1:4400
```

## Dismissed state and reset

Dismiss the toast: the bell persists and survives reloads; clicking it re-presents the toast ([update-channel.md#^bell](./update-channel.md#^bell)). Reset with `localStorage.removeItem("tv-update-dismissed")` in the devtools console ([update-channel.md#^dismissal](./update-channel.md#^dismissal)) — or announce a strictly newer `version` in the channel JSON; newer always re-presents.

## Desktop upgrade recommendation — browser preview

The recommendation is the deprecated notice for desktop apps installed from npm. It lives in the web client, uses the desktop mode/version page parameters, and requires no applying server toast ([desktop-upgrade-recommendation.md#^desktop-rec-condition](./desktop-upgrade-recommendation.md#^desktop-rec-condition)). Run the staging server (Step 1) with no channel override, which leaves this `0.0.0` server without a server toast:

```bash
npm run build:web
npx tsx packages/cli/src/index.ts --home /tmp/tv-staging-home serve
```

Open `http://127.0.0.1:4402/?mode=electron&desktopAppVersion=0.1.210`. The normal interface presents the desktop recommendation and bell, with its download link and steps and *Later* as its only button. Dismiss it to leave the bell; clicking the bell re-presents it. Reset automatic presentation with `localStorage.removeItem("tv-desktop-upgrade-recommendation-dismissed")` in devtools ([desktop-upgrade-recommendation.md#^desktop-rec-dismissal](./desktop-upgrade-recommendation.md#^desktop-rec-dismissal)).

## Desktop upgrade gate — browser preview

The gate lives in the web client and reads its inputs from the page URL ([desktop-upgrade-gate.md#^gate-seam](./desktop-upgrade-gate.md#^gate-seam)), so a plain browser stages it against the staging server (Step 1):

```bash
TV_TEST_WEB_VERSION=1.0.0 npm run build:web
# The staging server at version 1.0.0, requiring desktop 2.0.0:
TV_TEST_VERSION=1.0.0 TV_TEST_REQUIRED_DESKTOP_VERSION=2.0.0 \
TV_UPDATE_CHANNEL_URL=http://127.0.0.1:8399/update-channel.json \
npx tsx packages/cli/src/index.ts --home /tmp/tv-staging-home serve
```

Then open, in a browser:

- **Gated:** `http://127.0.0.1:4402/?mode=electron&desktopAppVersion=1.0.0`
- **Gated, unknown shell version** (the installed base, which predates `?desktopAppVersion=` — [desktop-upgrade-gate.md#^gate-unknown-version](./desktop-upgrade-gate.md#^gate-unknown-version)): same URL without `&desktopAppVersion=`
- **Not gated:** `…&desktopAppVersion=2.0.0` — normal boot, and the toast presents (channel 99.0.0 is newer than server 1.0.0)

## Desktop upgrade gate — real Electron app

The shell must claim an old version — dev shells report `0.0.0`, which is gate-exempt ([desktop-upgrade-gate.md#^gate-exemptions](./desktop-upgrade-gate.md#^gate-exemptions)) — via the declared `TV_TEST_MODE` + `TV_TEST_DESKTOP_APP_VERSION` hook ([desktop-upgrade-gate.md#^hook-shell-version](../../../proofs/arch/updates/desktop-upgrade-gate.md#^hook-shell-version)). And the desktop app loads its interface from the server, so the server side is the staging server (Step 1):

```bash
# 1. Build the interface stamped to match the staged server version:
TV_TEST_WEB_VERSION=1.0.0 npm run build:web

# 2. Run the staging server with the staging hooks:
TV_TEST_VERSION=1.0.0 \
TV_TEST_REQUIRED_DESKTOP_VERSION=2.0.0 \
TV_UPDATE_CHANNEL_URL=http://127.0.0.1:8399/update-channel.json \
npx tsx packages/cli/src/index.ts --home /tmp/tv-staging-home serve

# 3. In another terminal — the gated shell:
TV_TEST_MODE=true TV_TEST_DESKTOP_APP_VERSION=1.0.0 npm run start:electron
```

If a connection is already saved, choose **Disconnect from Server** in the Television application menu to forget it and return to [setup](../desktop/connect-flow.md#^desktop-disconnect-server). In setup's link field, paste `http://127.0.0.1:4402` (the demo server needs no token) and press **Connect**. Setup shows Connected, then the window loads the server's interface and halts at the gate with the channel's desktop instructions; no toast, no bell ([setup interaction](../../ui/setup/index.md#interaction), [gate precedence](./desktop-upgrade-gate.md#^gate-precedence)).

For the upgrade-and-relaunch exit, quit and relaunch claiming a current shell — normal boot, no gate, and the previously superseded toast presents:

```bash
TV_TEST_MODE=true TV_TEST_DESKTOP_APP_VERSION=2.0.0 npm run start:electron
```

For the gate's downloaded-update message and restart button, start the gated shell with the update runtime in its simulation mode, which reports a downloaded update a few seconds after launch ([desktop updates](../desktop/updates.md#testing)). The gate first shows the channel's instructions, then changes to the downloaded-update message ([desktop-upgrade-gate.md#^gate-instructions](./desktop-upgrade-gate.md#^gate-instructions)). With `TV_TEST_MODE` set, pressing the button records the restart instead of restarting:

```bash
npm run build:desktop
TV_TEST_MODE=true TV_TEST_DESKTOP_APP_VERSION=1.0.0 \
env -u ELECTRON_RUN_AS_NODE npx electron packages/desktop --runtime-simulate-updates=update-available
```

## Desktop self-update notice — real Electron app

The notice needs the real app, since only the app reports a downloaded update ([desktop-self-update-notice.md#^desktop-self-update-notice-condition](./desktop-self-update-notice.md#^desktop-self-update-notice-condition)). Run the staging server (Step 1) with none of the gate recipe's settings, so this `0.0.0` server neither gates nor polls a channel ([update-channel.md#^dev-version-no-poll](./update-channel.md#^dev-version-no-poll)); a server staged at a release version with `TV_TEST_VERSION` would poll the production channel and present its server notice instead. Then start the app with the update runtime in its simulation mode:

```bash
npm run build:web
npx tsx packages/cli/src/index.ts --home /tmp/tv-staging-home serve

# In another terminal:
npm run build:desktop
env -u ELECTRON_RUN_AS_NODE npx electron packages/desktop --runtime-simulate-updates=update-available
```

Connect to `http://127.0.0.1:4402`. A few seconds after launch the bell lights and the desktop self-update notice presents with the simulated version and **Restart to update**. Dismiss it to leave the bell; clicking the bell presents it again. Reset automatic presentation with `localStorage.removeItem("tv-desktop-self-update-dismissed")` in devtools ([desktop-self-update-notice.md#^desktop-self-update-notice-dismissal](./desktop-self-update-notice.md#^desktop-self-update-notice-dismissal)). Without `TV_TEST_MODE`, pressing **Restart to update** relaunches the app in the simulation's no-update mode, with no notice. To see the server notice take precedence, start the staging server with `TV_UPDATE_CHANNEL_URL=http://127.0.0.1:8399/update-channel.json`: the toast presents, and the desktop self-update notice stays hidden even after the toast is dismissed ([desktop-self-update-notice.md#^desktop-self-update-notice-precedence](./desktop-self-update-notice.md#^desktop-self-update-notice-precedence)).

## Verifying an auto-reload happened

To confirm a page really self-healed (silently reloaded onto the new bundle, [version-advertisement.md#^reload-action](./version-advertisement.md#^reload-action)) rather than just staying up, compare the exact release versions exposed by the programmatic diagnostic surfaces below.

1. **Bundle version, before vs after** — in the devtools console, `window.__tvVersion` ([version-advertisement.md#^version-probe](./version-advertisement.md#^version-probe)): it should read the old release before the server upgrade (e.g. `0.1.177`) and the new one after the heal (e.g. `0.1.178`) without any manual refresh. Pre-`^version-probe` bundles lack the global — there, compare the page's hashed module script instead: `document.querySelector('script[type="module"]').src` against the asset the server currently serves (`curl -s <server-url>/ | grep 'type="module"'`); a changed hash with no manual refresh is the reload.
2. **Server version** — `fetch("/health").then(r => r.json())` in the same console (or `curl <server-url>/health`); its `version` is what the bundle should now match.
3. **Do not read the loop-guard marker as proof.** `sessionStorage.getItem("tv-reload-attempted")` self-clears on success: the healed page removes it when it emits *client autoreloaded* ([version-advertisement.md#^autoreload-telemetry](./version-advertisement.md#^autoreload-telemetry)), so **`null` after things settle is the success state**, and the marker is observable only in flight — between the reload request and the healed page's first `server-status`. A marker that *lingers* alongside a still-mismatched bundle means the reload did **not** heal: the one permitted attempt is spent ([version-advertisement.md#^reload-loop-guard](./version-advertisement.md#^reload-loop-guard)).

## Knob reference

| Knob | Where | Effect (owning spec) |
|---|---|---|
| `TV_UPDATE_CHANNEL_URL` | server env | poll this channel URL instead of production; overrides dev-version suppression; every build; captured into a persisted daemon's environment at install time ([update-channel.md#^channel-url-override](./update-channel.md#^channel-url-override), [update-channel.md#^hook-persist-capture](./update-channel.md#^hook-persist-capture)) |
| `TV_UPDATE_CHANNEL_POLL_INTERVAL_MS` | server env | fast poll; honored only with the URL override; captured at install time like the URL ([update-channel.md#^hook-poll-interval](./update-channel.md#^hook-poll-interval)) |
| `TV_TEST_VERSION` | server env | the version an unstamped from-source server claims ([version-advertisement.md#^hook-server-version](../../../proofs/arch/updates/version-advertisement.md#^hook-server-version)) |
| `TV_TEST_REQUIRED_DESKTOP_VERSION` | server env | the requirement an unstamped server advertises ([desktop-upgrade-gate.md#^hook-required-version](../../../proofs/arch/updates/desktop-upgrade-gate.md#^hook-required-version)) |
| `TV_TEST_WEB_VERSION` | `vite build` env | stamps the web bundle's version at build time ([version-advertisement.md#^hook-web-version](../../../proofs/arch/updates/version-advertisement.md#^hook-web-version)) |
| `TV_TEST_MODE=true` + `TV_TEST_DESKTOP_APP_VERSION` | desktop app env | the shell claims this version instead of its real one; both required ([desktop-upgrade-gate.md#^hook-shell-version](../../../proofs/arch/updates/desktop-upgrade-gate.md#^hook-shell-version)) |
| `?mode=electron&desktopAppVersion=…` | page URL | browser preview of the gate inputs ([desktop-upgrade-gate.md#^gate-seam](./desktop-upgrade-gate.md#^gate-seam)) |
| `localStorage["tv-update-dismissed"]` | browser console | the dismissed announced version; remove to replay server-notice auto-presentation ([update-channel.md#^dismissal](./update-channel.md#^dismissal)) |
| `localStorage["tv-desktop-upgrade-recommendation-dismissed"]` | browser console | the dismissed recommended desktop version; remove to replay recommendation auto-presentation ([desktop-upgrade-recommendation.md#^desktop-rec-dismissal](./desktop-upgrade-recommendation.md#^desktop-rec-dismissal)) |
