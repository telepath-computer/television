*The desktop self-update notice: how the web client tells the user of a downloaded desktop app that an update has downloaded, through the shared update bell and notice, and hands the notice the restart that installs it.*

# Desktop self-update notice

The downloaded desktop app downloads its updates in the background and reports each downloaded update to the served interface through the native preload bridge ([desktop updates](../desktop/updates.md#^desktop-updates-ops)). The web client turns that report into the *desktop self-update notice*: the shared update bell and notice, with a restart button, as [product update notifications](../../product/update-notifications.md#^desktop-self-update) describes.

## What this owns

This module owns when the desktop self-update notice applies, its place among the shared surface's notices, the handoff of its body and restart action to the [update-notification surface](../../ui/app/update-notification/index.md), its dismissal persistence, its bell lifetime, and its absence of telemetry. The bridge operations and the restart itself are [desktop updates](../desktop/updates.md)'s. The server notice is [the update channel's](./update-channel.md), and the recommendation for npm-installed apps is [the recommendation's](./desktop-upgrade-recommendation.md). A gated app shows the downloaded update on the gate screen instead, under [the gate's instructions](./desktop-upgrade-gate.md#^gate-instructions).

## When it applies

The desktop self-update notice applies exactly when all of these are true:

- the client is in Electron context ([the gate's rule](./desktop-upgrade-gate.md#^electron-context));
- the desktop upgrade gate has allowed normal application boot, that is, its presentation-suppression switch has not been flipped ([^gate-precedence](./desktop-upgrade-gate.md#^gate-precedence));
- the native preload bridge provides `onDesktopUpdateDownloaded`, and it has reported a version.

A browser, and a desktop app whose bridge lacks the operation, never receive the notice. ^desktop-self-update-notice-condition

The surface subscribes to the operation when it mounts after the gate allows normal boot. It evaluates the notice then, whenever the bridge reports a version, and whenever the retained update state changes on the connection that served the web bundle. ^desktop-self-update-notice-evaluation

## Precedence

The notice takes the second place in the [shared surface's order](../../product/update-notifications.md#^notice-precedence): after the server notice, which applies as [the update channel](./update-channel.md#^bell) says, and before the recommendation. ^desktop-self-update-notice-precedence

## Body and restart

The body is authored in the surface's [`desktop_self_update_notice`](../../ui/app/update-notification/content.yml#desktop_self_update_notice) copy, which contains the placeholder `{version}`. Production never reads that spec artifact: `packages/web` carries a source constant named `DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN` whose value conforms to the authored string verbatim. The client replaces the placeholder with the reported version, renders the result through the standard `renderMarkdown` pipeline and hands it to the surface with no prompt and with a restart action. ^desktop-self-update-notice-render

The restart action calls the bridge's `restartToInstallUpdate()` once, and the surface then shows that the restart is under way ([^un-restart-button](../../ui/app/update-notification/index.md#^un-restart-button)) until the page unloads. The app quits once the runtime is ready to install ([^desktop-updates-restart](../desktop/updates.md#^desktop-updates-restart)), which unloads the page. ^desktop-self-update-notice-restart

## Dismissal and bell

Closing the notice stores the reported version in `localStorage` under `tv-desktop-self-update-dismissed`. The notice does not present automatically while the stored value equals the reported version; a different reported version presents it again. Missing storage does not suppress presentation. Neither this key nor the server notice's or the recommendation's affects another notice kind. ^desktop-self-update-notice-dismissal

Dismissal suppresses automatic presentation only. The bell stays visible for as long as the notice applies, and clicking it presents the notice again. ^desktop-self-update-notice-bell

The notice emits neither `update_toast_shown` nor `update_prompt_copy_clicked`, which describe channel content, and no event of its own is defined. ^desktop-self-update-notice-no-telemetry

## Testing

Under [Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams), coverage of the notice's selection and state may use a stand-in for the bridge operations. It must show that a browser, a gated client, a bridge without `onDesktopUpdateDownloaded`, and a bridge that has reported nothing produce no desktop self-update notice, and that a reported version produces one. It must show that an applying server notice, dismissed or not, keeps the desktop self-update notice from presenting and keeps the bell on the server notice, and that when the server notice ceases to apply, a desktop self-update notice that has not been dismissed presents in the same session. It must show that a reported version reaching an already mounted surface presents the notice. Dismissal coverage must show that the stored version suppresses automatic presentation for that version only, that a different reported version presents again, and that the three dismissal keys are independent. It must show that the restart action calls `restartToInstallUpdate()` exactly once.

Real-browser coverage must render the body through the standard markdown pipeline with the reported version in place of the placeholder. The real-Electron path from the runtime's report to the notice and its restart request is [product update acceptance](../../product/update-notifications.md#Testing)'s.
