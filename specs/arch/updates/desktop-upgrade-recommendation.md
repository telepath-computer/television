*The deprecated desktop upgrade recommendation: how the web bundle uses a release threshold and the update notice to tell users of desktop apps installed from npm that they can move to the downloaded app, without blocking startup.*

Desktop apps installed from npm remain safe to use once they pass the gate, but they receive no more updates. The recommendation tells their users, through the ordinary update bell and notice, that the downloaded app is available and how to install it, while the user keeps working. It is deprecated: it exists only for that move, and downloaded apps, which [update themselves](../../product/update-notifications.md#^desktop-self-update), never receive it.

# Desktop upgrade recommendation

## What this owns

This module owns the web client's *desktop upgrade recommendation*: the recommended desktop version, the decision about eligibility and notice precedence after the [desktop upgrade gate](./desktop-upgrade-gate.md), delivery of the recommendation body to the shared [update-notification surface](../../ui/app/update-notification/index.md), and storage of recommendation dismissals independently from server-notice dismissals. The user-facing behavior is owned by [product/update-notifications.md](../../product/update-notifications.md); release-version validation and ordering are [arch/updates/index.md](./index.md)'s.

## The recommended desktop version

`packages/web` carries a source constant named `RECOMMENDED_DESKTOP_VERSION`. It is the release version below which the web bundle presents the recommendation. It holds the [recommended desktop version](../../product/update-notifications.md#^desktop-rec-first-release), `1.4.0`, and is never derived from the repository's release version, a server version, the update channel, or `REQUIRED_DESKTOP_VERSION`. ^desktop-rec-version

That version is the boundary between apps installed from npm and downloaded apps ([product/desktop-app.md](../../product/desktop-app.md#^desktop-npm-package)), even though the first downloaded release carries a later version ([the first desktop release](../desktop/distribution.md#^desktop-dist-first-release)), so the version alone selects the apps installed from npm, with no platform condition. Which apps it reaches, given the required floor, is [the product's](../../product/update-notifications.md#^desktop-rec-first-release). ^desktop-rec-first-version

## Web-bundle decision

The recommendation is implemented entirely in the server-served web bundle. The Electron shell supplies no recommendation logic, content, state, or IPC. Electron context and the shell version come from the existing `?mode=electron` and `?desktopAppVersion=` page parameters ([telemetry client.md#^desktop-version-param](../telemetry/client.md#^desktop-version-param)). ^desktop-rec-web-only

The recommendation applies exactly when all of these are true:

- the client is in Electron context;
- the desktop upgrade gate has allowed normal application boot;
- `?desktopAppVersion=` is a valid release-version triple other than `0.0.0` and is numerically less than `RECOMMENDED_DESKTOP_VERSION`; and
- the connected server's retained update state is null or has no applying server update toast (`UpdateState.toast === null`).

A browser, a development shell reporting `0.0.0`, a missing or malformed shell version, and a shell at or above the threshold receive no recommendation. Missing or malformed versions do not trigger a recommendation because the hard gate separately owns its conservative unknown-version rule. ^desktop-rec-condition

The surface evaluates eligibility when it mounts after the gate allows normal boot. It evaluates again whenever retained update state changes on the connection that served the web bundle. For this decision, a null retained update state means no toast. The gate has allowed normal boot when its presentation-suppression switch has not been flipped ([desktop-upgrade-gate.md#^gate-precedence](./desktop-upgrade-gate.md#^gate-precedence)). Dismissing the server toast does not make it inapplicable. ^desktop-rec-evaluation

**Ordering and precedence.** Reload is considered first, then the gate decides whether to halt startup or allow the application to boot ([gate precedence](./desktop-upgrade-gate.md#^gate-precedence)). After an allowed boot, the recommendation comes last in the [shared surface's order](../../product/update-notifications.md#^notice-precedence). ^desktop-rec-selection-precedence

## Shared notice presentation

When eligible, the recommendation uses the existing update bell and manual notice popover. Its fixed Markdown body is authored in the surface's [`desktop_upgrade_recommendation`](../../ui/app/update-notification/content.yml#desktop_upgrade_recommendation) copy. Production never imports or reads that spec artifact: `packages/web` carries a source constant named `DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN` whose value conforms to the authored YAML string verbatim. The client renders the body constant through the same standard `renderMarkdown` pipeline as channel notice bodies and hands the result to the surface with no prompt, so the recommendation shows no copy-prompt button. The body's download link follows standard external-link behavior. ^desktop-rec-render

The recommendation's dismissal is independent from the server notice's. Closing it stores the current recommended version in `localStorage` under `tv-desktop-upgrade-recommendation-dismissed`. A valid stored value equal to or newer than the current recommendation suppresses automatic presentation. Missing or malformed storage does not suppress presentation. Neither this key nor `tv-update-dismissed` affects the other notice kind. ^desktop-rec-dismissal

Dismissal suppresses automatic presentation only. The bell remains visible for as long as the recommendation applies, and clicking it re-presents the recommendation. The bell is not shown for the recommendation when the shell reaches the threshold or the desktop upgrade gate takes precedence. ^desktop-rec-bell-lifetime

The recommendation emits neither `update_toast_shown` nor `update_prompt_copy_clicked`: those events describe channel content and carry a channel version. No recommendation-specific telemetry event is defined. ^desktop-rec-no-telemetry
