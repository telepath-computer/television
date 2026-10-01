*Onboarding channels: the bundled starter channels every Television installation receives exactly once — what fresh installs and upgrading users see, and the promise that deleted or edited onboarding content is never recreated.*

**Status:** adopted onboarding-channel product authority; built-process and browser acceptance conform.

# Onboarding channels

Television includes starter channels so a new installation has useful examples immediately. This document defines when those channels appear and how users can change or delete them.

## What this owns

This spec owns the user-facing behavior of Television's onboarding content: which starter channels a user receives, when they receive them, what happens to focus and pinning, and the guarantees around deletion and modification. It is implementation-agnostic. The content format, install state, and install algorithm are architecture, owned by the specs under [arch/onboarding/index.md](../../arch/onboarding/index.md).

## The onboarding bundle

Television ships with a small set of *onboarding channels*: named channels, each pre-populated with one or more artifacts, that introduce the product and give a new installation visible content from the first moment. The bundle defines an **ordered set of channels** with one designated focus channel. Each channel arrives with its configured name and an ordered artifact list. The production package contains the set; its config defines the count, slugs, names, and content rather than this spec enumerating them.

Each configured artifact becomes one tab page, in artifact-list order. The bundle may give that page an initial size and geometry using the same fields as ordinary tab pages; an omitted field uses its shared default. Stage 1 still presents one artifact per page and does not group artifacts ([the layout model](../../arch/layout/index.md#^ly-membership)). The installed pages are ordinary channel layout state, shared and editable like pages created through the product.

Onboarding channels are installed into the [Television home](../cli.md#^cli-home) a server serves, each **exactly once per home**. After installation they are ordinary channels: the user can rename them, rearrange or delete their artifacts, or delete the channels entirely, exactly as with any channel they created themselves.

An onboarding artifact may be an HTML document or markdown file. An installed markdown artifact is an ordinary markdown path artifact, presented exactly as any user-created one — markdown presentation and editor internals remain code-authoritative under [the frame-core boundary](../../arch/artifact-frame/index.md#^frame-core-carve-out).

## Fresh install

The first time a server runs against a brand-new home, every onboarding channel in the bundle is created in bundle order with its defined name, artifacts, and tab-page order. A home that holds only its [config file](../cli.md#^cli-config-file) is still brand-new. A fresh installation focuses the bundle's designated channel. ^fresh-install

Onboarding channels arrive **unpinned**. A browser lists them in the channel sidebar's ordinary unpinned order — newest first by channel id, not a second onboarding-specific order ([channels.md#^ch-unpinned-order](../channels.md#^ch-unpinned-order)). Every installed channel is present for every client like any other server channel. ^onboarding-unpinned

## Existing installations

When a release adds onboarding channels, an existing installation receives **only the channels it has never had**. Channels the home has already received — whether they still exist, were renamed, were emptied, or were deleted — are never re-created, refreshed, or amended. ^upgrade-only-new

Installing new channels into an existing installation never steals focus. The active channel changes only in the "no content yet" case: at install time, if the installation has no artifacts at all and every channel that existed before the install is empty, focus moves to the bundle's designated channel. An installation with any real content keeps its current focus untouched.

The "no content yet" allowance exists because a home can acquire a config file and empty structure — state directories and an auth token — before a human sees it, and because a user may have created channels without adding content. Either way the home holds nothing of the user's, so it gets the fresh-install focus behavior.

## Deletion and modification are respected

Once a home has received an onboarding channel, that channel and its artifacts belong to the user. Television never:

- re-creates an onboarding channel or artifact the user deleted, ^deletion-respected
- overwrites or updates onboarding content the user modified,
- applies a later release's changes to an onboarding channel the home already received. ^no-content-refresh

**Non-goal: content updates.** When a release changes the content of an existing onboarding channel, installations that already have that channel do not receive the change. Television cannot distinguish the user's own modifications from its earlier bundled content, so any update path would risk destroying user work; installed onboarding content is fire-and-forget. ^fire-and-forget

## How installed channels appear

The channel sidebar lists every onboarding channel as an ordinary unpinned channel, so onboarding needs no tab-promotion pass. There is no per-browser surfacing state or special onboarding chrome to dismiss. ^no-promotion

## When the bundle is missing

A server built or launched without the onboarding bundle installs nothing, and the bundle's absence never touches existing channels. Only against a home with no channels at all does such a server start with a single empty channel named "Default". Onboarding is additive; its absence never blocks startup. ^missing-bundle

## Telemetry

Installing onboarding channels and artifacts is server-generated activity, not user behavior, and emits **no telemetry events**: none of the channel, artifact, or layout usage telemetry that the same actions would produce when performed by a user. Telemetry's install/upgrade lifecycle events ([product/telemetry.md](../telemetry.md)) are unaffected by onboarding. ^no-install-telemetry

## Testing

Under [Tests are the validation mechanism](../../arch/testing-policy.md#Tests are the validation mechanism), [onboarding content architecture](../../arch/onboarding/content.md) owns validation of the shipped configuration and content tree, including the exact set of channels in the release. Product acceptance uses the package's channel set and designated focus channel.

At the CLI boundary, fresh-install acceptance requires the built `tv` process to run against a real temporary home. Missing-bundle acceptance must run the built product without an onboarding bundle. Upgrade acceptance must run at the built CLI boundary.

Pre-initialized-storage acceptance must start from a home containing only Television's storage directories, its authentication token, and optionally its config file, with no channels, artifacts, or display state.

[Installer architecture](../../arch/onboarding/installer.md#Migration) owns the transformations from supported earlier state files. Through the built CLI, product acceptance must cover both a home left by the release that installed only the welcome artifact and one whose onboarding state records received slugs under the earlier `screens` field.

Browser acceptance must use a real browser connected to a server started by the built `tv` CLI. Upgrade reconnection coverage must include both a browser that connects after the restart and an open browser that reconnects automatically.

[Installer architecture](../../arch/onboarding/installer.md#^telemetry-silence) owns the proof of the [promise that installation emits no telemetry](#^no-install-telemetry).

