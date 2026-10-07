*How users learn about important Television updates and how clients stay current: the shared update notice and persistent bell, the deprecated desktop upgrade recommendation for apps installed from npm, silent client auto-reload, the desktop app's own updates, and the desktop upgrade gate.*

# Update notifications

The Television server does not update itself, so users need to find out when a server release worth installing exists. The downloaded desktop app does update itself, and running clients need to cope when the server behind them is upgraded. This spec describes what users see: a small in-app notice, with a bell to bring it back, for an important server release, for a desktop update that has downloaded, or, in a desktop app installed from npm, for the move to the downloaded app; browser tabs and desktop windows quietly reloading to match their server; and the desktop app blocking itself with upgrade instructions when it is too old to be used safely.

The mechanisms behind these behaviours are architecture under [arch/updates/index.md](../arch/updates/index.md). How desktop releases are made is [arch/desktop/distribution.md](../arch/desktop/distribution.md)'s, and how the app runs its updater and restarts into an update is [arch/desktop/updates.md](../arch/desktop/updates.md)'s.

## Five mechanisms, one goal

Five mechanisms keep a Television server and its clients up to date:

- An **update toast and bell** tell the user that an important Television server release exists ([The update toast](#the-update-toast)).
- A **desktop upgrade recommendation**, which is deprecated, uses the same notice and bell to tell the user of a desktop app installed from npm that the downloaded app is available and how to install it ([The desktop upgrade recommendation](#the-desktop-upgrade-recommendation)).
- The downloaded **desktop app updates itself**, and the same notice and bell offer a restart that installs a downloaded update ([Desktop app updates](#desktop-app-updates)).
- Client **auto-reload** keeps a running client matched to its server, invisibly ([Auto-reload](#auto-reload-stale-clients-self-heal)).
- The **desktop upgrade gate** stops a desktop app whose installed application has fallen too far behind, the one client piece auto-reload cannot refresh ([The desktop upgrade gate](#the-desktop-upgrade-gate)).

Television never upgrades a server on its own: the user's agent upgrades it. The downloaded desktop app installs its own updates when the user restarts it from the notice or the gate, or quits it. That restart is the only update control on any of these surfaces.

**One notice at a time.** The update toast, the desktop self-update notice and the desktop upgrade recommendation share one notice and bell ([ui/app/update-notification/index.md](../ui/app/update-notification/index.md)), which show one notice at a time, in that order. A notice that applies keeps the notice and bell whether or not the user has dismissed it, and dismissing it never reveals a later one. When it ceases to apply, a later notice that applies and has not been dismissed presents automatically in the same session; dismissal alone is not such a change. The desktop self-update notice and the recommendation never apply to the same app ([^desktop-rec-first-release](#^desktop-rec-first-release)), and the gate supersedes all three ([^gate-supersedes-toast](#^gate-supersedes-toast)). ^notice-precedence

No other notification surface carries updates: no badge, menu entry or system notification beyond the shared notice and bell and the gate.

## The update toast

The television.run website publishes a public *update channel*: a single manually deployed JSON notice naming the latest release worth announcing. Most releases never appear on it. Television ships continuously, and a toast for every version would train users to ignore it. A channel entry is a deliberate, human decision that a release matters. ^channel-curated

The channel lives at `https://television.run/update-channel.json`. The URL is part of the product: every shipped Television install watches it, and a release manager deploys to it ([update-channel.md](../arch/updates/update-channel.md) owns the document format and deploy procedure). ^channel-url

When the channel names a release newer than the server the user is connected to, the interface shows a persistent bell and presents a notice, the *update toast* (placement and presentation are [ui/app/update-notification/index.md](../ui/app/update-notification/index.md)'s): ^toast-behavior

- **Body.** A short markdown message written for that release, rendered with the same markdown treatment as the rest of the interface. The channel is Television's own published content, and the toast shows it as is. Links in it open outside the Television interface (a new browser tab, or the system browser from the desktop app). How release details name the release is [versioning](./versioning.md#^pv-exact-version)'s. ^toast-markdown
- **Copy-prompt button.** When the notice includes an upgrade prompt, the toast shows a button that copies the prompt text to the clipboard. The user pastes it to their agent, which performs the upgrade following the hosted admin guide at `https://television.run/install.md`. Copying works in every context Television runs in, including plain-HTTP LAN and Tailscale setups. ^toast-copy-prompt
- **Identical everywhere.** Browser and desktop show the same server-update toast. Its body has no desktop-specific variant and no "quit and relaunch" instruction: post-upgrade server steps are the agent's job, reached through the copied prompt. ^toast-identical
- **It stays until dismissed.** The toast never hides by itself; an important, rare notice should not disappear before the user acts on it. (How it closes is [ui/app/update-notification/index.md#^un-closing](../ui/app/update-notification/index.md#^un-closing)'s.)
- **Dismiss forever, per release.** Dismissing the toast means it never presents by itself again for that release, in that browser or desktop app, across reloads and restarts. A newer channel notice presents again. ^toast-dismiss
- **Persistent bell.** The bell shows, in browser and desktop alike, whenever the update channel indicates an available update, dismissed or not; it is the way back to a dismissed notice ([ui/app/update-notification/index.md#^un-bell-represents](../ui/app/update-notification/index.md#^un-bell-represents) owns its interaction). The bell disappears only when no update applies any more: the server now matches or exceeds the announced release, or no channel data is available. ^toast-bell

The toast degrades to silence. If the channel is unreachable, malformed or empty, or the server cannot check it, the user sees no channel error, and no server-update toast unless the server still holds an earlier valid channel notice ([update-channel.md#^poll-silent-failure](../arch/updates/update-channel.md#^poll-silent-failure)). A desktop app may still show its desktop self-update notice or its recommendation. ^channel-silent-failure

## The desktop upgrade recommendation

The *desktop upgrade recommendation* is deprecated. It exists only for desktop apps installed from npm, which are safe to use once they pass the gate but receive no more updates: it tells their users that the downloaded app is available and how to install it themselves. Downloaded apps receive [their own updates](#^desktop-self-update) and never the recommendation. When the app's version is older than the recommended desktop version, the app presents the recommendation through the update bell and notice. The recommendation is soft: the normal interface remains fully usable, and the user may keep the current desktop version. ^desktop-rec-behavior

- **Desktop only, after the gate.** Browser clients never receive it. The recommendation is considered only after the desktop upgrade gate allows normal boot ([^gate-supersedes-toast](#^gate-supersedes-toast)). Development builds of the app, which report `0.0.0`, are exempt. ^desktop-rec-scope
- **Fixed markdown body.** The recommendation body is bundled with the interface and rendered with the same markdown treatment and external-link behavior as the server update toast. It says that the Television desktop app is now a downloaded Mac app that updates itself, and that this copy was installed with npm and receives no more updates. It then gives the download link and the [installation steps](./desktop-app.md#^desktop-install-download), as the [administrator guide](../arch/cli/admin-guide.md) gives them, with one more step: quit this app before opening the downloaded one, which keeps the saved server connection. The exact words are the surface's copy ([content.yml#desktop_upgrade_recommendation](../ui/app/update-notification/content.yml#desktop_upgrade_recommendation)). ^desktop-rec-markdown
- **No agent prompt.** The recommendation carries no prompt for the user's agent, so the notice shows no copy-prompt button: the user follows the steps in its body. ^desktop-rec-copy-prompt
- **Dismiss forever.** Dismissing the recommendation keeps it from presenting by itself again across reloads and restarts, independently of server-notice dismissal. ^desktop-rec-dismiss
- **Persistent bell.** The bell remains after the recommendation is dismissed and presents it again when clicked. It disappears when the recommendation no longer applies. ^desktop-rec-bell

From Television 1.4.0, the recommended desktop version is `1.4.0`, and the [required desktop version](#^gate-themes-release) stays `1.3.1`. Version 1.4.0 is the [boundary between apps installed from npm and downloaded apps](./desktop-app.md#^desktop-npm-package), even though the first downloaded release carries a later version. The recommendation therefore reaches every npm-installed app that passes the gate, on every platform, and no downloaded app. Apps installed from npm below 1.3.1 are gated instead. The recommended version stays `1.4.0`, so a server that requires 1.4.0 or later gates every app installed from npm, and the recommendation reaches none of its clients. ^desktop-rec-first-release

## Auto-reload: stale clients self-heal

A client whose loaded interface was built from a different Television release than the server it is connected to reloads itself to pick up the server's current interface. ^reload-behavior

- **It is silent.** The user sees an ordinary page reload and nothing else: no toast, no error, no explanation.
- **It happens when staleness can appear.** A version mismatch can arise only when the server restarts on a new release, which always drops the client's live connection. So the client checks whenever its connection is established or re-established, and reloads at once on a mismatch. A reload at that moment can lose less than a second of unsaved keystrokes, because the markdown editor saves after a short pause in typing. This is accepted: the reload follows an upgrade the user has just asked their agent to perform, so they are unlikely to be typing in a markdown view, and machinery to remove the window is not worth its complexity. ^reload-immediate
- **It never loops.** If a reload does not clear the mismatch (for example, a misconfigured proxy serving a cached interface), the client does not retry and shows nothing. At most one reload is attempted per server release per tab session; the next server release retries. ^reload-once
- **Development builds never reload.** An interface built outside the release pipeline reports a development version and is treated as always matching, so developers running local builds against any server are never interrupted by a reload. ^reload-dev-exempt

The desktop app gets the same behavior, because it renders the interface served by the server. The desktop app's own version is never compared with the server's release version; the app is governed separately by [its own updates](#^desktop-self-update), [the gate](#the-desktop-upgrade-gate) and, for apps installed from npm, [the recommendation](#the-desktop-upgrade-recommendation).

### Developer hosts

The `~/.tv-developer` developer-host marker ([telemetry.md#^developer-host-project-guard](./telemetry.md#^developer-host-project-guard)) has no effect on update notifications. A release-build server on a marked host checks the update channel, and its clients see toasts and bells like any other install: developers' real, npm-installed personal servers must hear about releases too. What keeps development free of update notices is the build, not the host: a development-build server, which has no release version stamped, never polls the channel ([arch/updates/index.md#^updates-dev-version](../arch/updates/index.md#^updates-dev-version)), never triggers a reload, and advertises no desktop requirement, so it never gates ([desktop-upgrade-gate.md](../arch/updates/desktop-upgrade-gate.md)). ^toast-dev-host

## Desktop app updates

The desktop app installed from Television's [download link](./desktop-app.md#^desktop-install-download) updates itself from the desktop releases Television ships ([versioning](./versioning.md#^pv-desktop-release-version)): ^desktop-self-update

- **Checking and downloading.** The app checks for a released update when it starts and every ten minutes while it runs. A check that finds an update downloads it in the background.
- **The desktop self-update notice.** From Television 1.4.2, when the download finishes, the app presents the *desktop self-update notice* through the shared bell and notice. It says that Television updates its desktop app automatically and that the downloaded version installs when the user restarts the app, and it offers a **Restart to update** button.
- **Restart to update.** Pressing the button quits the app, installs the update and opens the app again on the new release, with its saved server connection. The user does nothing else.
- **Dismiss per version.** Dismissing the notice keeps it from presenting by itself again for that downloaded version, across reloads and restarts; a different downloaded version presents again. The bell stays while the update waits to install, and clicking it presents the notice again.
- **Desktop only, after the gate.** Browsers never show the notice. A gated app shows the downloaded update on the [gate screen](#^gate-instructions-fallback) instead. An app connected to a server whose interface predates the notice shows nothing about a downloaded update, which still installs on quit.
- **Installing on quit.** An update the user does not restart into installs after the user quits the app, and the app runs the new release when it is next opened after the installation finishes. The installation finishes a short time after the app quits, so an app opened again straight away can still run the earlier release. Such an app finds the update again, offers it again and installs it when it next restarts or quits.
- **Only desktop releases.** The app downloads only [desktop releases](./versioning.md#^pv-desktop-release-version). Between them, it finds nothing to download and shows nothing.

[Apps installed from the npm package](./desktop-app.md#^desktop-npm-package) do not update themselves.

## The desktop upgrade gate

The desktop app has one part auto-reload cannot refresh: the installed application itself, called the *shell* below. Each Television server release knows the minimum desktop release it is meant to be used with. A desktop app running an older shell than its connected server requires is *gated*: the normal interface never starts. Startup stops at a blocking gate screen saying the desktop app is out of date, with upgrade instructions rendered as markdown, with the same treatment and external-link behavior as the toast. ^gate-behavior

- **Blocking, not dismissible.** A gated desktop app cannot be used until it is upgraded and relaunched. The gate exists because the shell has fallen behind what the connected server needs; letting the user wave it away would defeat it.
- **Nothing runs behind it.** A gated app is halted, not covered: it loads no channels and no artifacts. An old shell and a new server may no longer speak the same internal language, so a gated app must not try; a notice floating over a working app would not prevent that. ^gate-halted
- **Desktop only.** Browser clients are never gated: a browser has no shell to fall behind, and auto-reload keeps it fully current. ^gate-desktop-only
- **The gate supersedes every notice.** A gated desktop app shows no server-update toast, desktop self-update notice or desktop recommendation, and no bell; the gate screen carries the whole upgrade story for that user, including a downloaded desktop update. ^gate-supersedes-toast
- **Curated, like the toast.** Routine releases never gate anyone: a server's required desktop release is raised deliberately, by a human, only when a shell change requires users to upgrade. ^gate-curated
- **Driven by the server, not the channel.** The gate compares the shell against the *connected server's* requirement, so it fires only after that server has been upgraded to a release needing the newer shell, never in advance for upgrades the user's own server has not received. It works even when the update channel is unreachable. ^gate-server-driven
- **Never a dead end.** When the app has downloaded an update, the gate says that this version of the desktop app does not work with the server and needs updating, and that the new version has already downloaded and installs on a restart, and it shows the **Restart to update** button, which works as the notice's does. When the app reports no downloaded update (it may still be downloading, its update may have failed, or it cannot report one, like an app released before apps could report downloads or an app installed from npm), the gate prefers upgrade instructions published on the update channel. When none are available (channel down or nothing published), it gives the user the desktop app's [download link](../arch/desktop/distribution.md#^desktop-dist-links) and tells them to install the latest version. A download reported while the gate is shown changes it to the first message. Both built-in messages are written for the user, not their agent, because the desktop app typically does not share a host with the agent and the administrator guide is agent-facing. Their words are the gate surface's copy ([ui/app/desktop-upgrade-gate/index.md](../ui/app/desktop-upgrade-gate/index.md)). ^gate-instructions-fallback

The theming release requires desktop `1.3.1`. Earlier shells cannot carry the server's selected light or dark appearance into artifact views. In the default Clouds theme, choosing an appearance that differs from the device can leave artifact text and its enclosing background in opposite appearances, making content unreadable. The requirement applies regardless of the current theme or appearance selection. ^gate-themes-release

When an important release needs both a server and a desktop upgrade, the desktop release that meets the new requirement comes out before the server release is published, and the update channel announces the server release after that ([desktop-upgrade-gate.md](../arch/updates/desktop-upgrade-gate.md#^ops-bump)). A server that requires the newer desktop release can therefore never be installed before that release can be downloaded, and a server and desktop app installed for the first time always work together. Downloaded desktop apps download the release [as they download any update](#^desktop-self-update) and install it when the user restarts or quits. The user then sees the toast; the gate does not fire, because their server is not upgraded yet. Their agent upgrades the server, which now requires the newer desktop release. An app that has installed that release boots normally. An app that has not is gated; it keeps checking for updates while gated, the gate offers the restart once it has downloaded the release, and the restarted app passes the gate. Users of apps installed from npm follow the gate's instructions. Instructions published on the channel should assume that order. ^gate-sequencing

## Telemetry

Four content-free telemetry events cover the server-update, reload and gate mechanisms, under all guarantees of [telemetry.md#Privacy guarantees](./telemetry.md#Privacy guarantees). Version numbers are the only payload, never the toast text, prompt or instructions. The events belong to the closed telemetry vocabulary ([arch/telemetry/index.md](../arch/telemetry/index.md)); when each fires is owned by the arch specs under [arch/updates/index.md](../arch/updates/index.md). Neither the desktop self-update notice nor the desktop recommendation adds an event or reuses the channel-toast events. ^telemetry-events

- *client autoreloaded*: the from- and to-versions.
- *update toast shown*: the installed and channel versions.
- *update prompt copy clicked*: the installed and channel versions.
- *desktop upgrade gate shown*: the shell and required desktop versions.

## Inputs to proof derivation that the spec does not otherwise show

### Directives from the designer or architect

- Desktop upgrade gate acceptance exercises the real Electron app against a running Television server, for both a gated app and a normal boot. One gated case has an update runtime that reports a downloaded update, and shows the downloaded-update message and its restart request.
- Browser gate acceptance runs in a real browser against a server that advertises a desktop requirement.
- Auto-reload acceptance runs in a real browser against a Television server that serves interfaces built for named releases. It covers both an initial connection with a stale interface and a connected client whose server restarts on a new release.
- The browser journey from update notice through server restart and reload runs both without authentication and with a real bearer token.
- Update-notification acceptance runs in a real browser. Desktop self-update notice acceptance runs in the real Electron app, with the update runtime reporting a downloaded update and no network or ToDesktop build, and shows that pressing **Restart to update** sends the restart request to the main process.
- Marked-host acceptance runs a release-build server on a host carrying `~/.tv-developer`.
- Electron notification acceptance runs in the real Electron app and crosses the system handler for external links.
- Product acceptance covers the complete update sequence by composing three real paths, under [Compositional coverage across clean seams](../arch/testing-policy.md#Compositional coverage across clean seams): the notice, a reload after a real server restart, and the desktop gate followed by a real app relaunch. It does not claim that Television installs the server upgrade.
- Telemetry acceptance for the integrated browser and Electron journeys may stop at the telemetry sink.

### Coverage owned by another spec

- The desktop app's own update is left to the desktop application's [real-host checks](./desktop-app.md#Testing).
- Delivery from the telemetry sink to PostHog is [telemetry sink architecture](../arch/telemetry/sink.md#Real PostHog integration test surface)'s.
- The specs under [update architecture](../arch/updates/index.md) own coverage of input variations and failure cases for version comparison, channel polling, reload decisions, the desktop recommendation and the desktop gate. Their proofs do not repeat the product journeys.
- [Desktop upgrade architecture](../arch/updates/desktop-upgrade-gate.md#^pre-gate-handshake) owns proof that installed shells can connect far enough to receive a gate from a current server. No separate full gate journey in a previously published desktop package is required.
- The [update notification UI](../ui/app/update-notification/index.md#Interaction), [copy button UI](../ui/app/copy-button/index.md) and [desktop upgrade gate UI](../ui/app/desktop-upgrade-gate/index.md#Interaction) own their surface mechanics: closing and reopening the notice, the modern and plain-HTTP clipboard paths, and the gate's non-dismissal and scrolling.
