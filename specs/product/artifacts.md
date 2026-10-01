*What the user can do with and rely on from an artifact: its document's independence and interactivity, its name, deleting it, a shared one outliving its producer, and what survives moving around the app.*

**Status:** adopted redesign product authority.

# Artifacts

An *artifact* is a pointer to content — held externally, or generated on the fly — that Television shows the user. Artifacts are where users interact with information and functionality that is not core to Television itself, to undertake their use cases: a document, a chart, a picture, a page from the web, put there by the user or by an agent working for them. This spec describes what a person can rely on from one: how it behaves, what identifies it, what can be done to it, and when work inside it is preserved or lost.

An artifact is displayed on the stage ([ui/app/stage/index.md](../ui/app/stage/index.md)), and belongs to exactly one channel. ^af-artifact-reference

The artifact record itself — its fields, the create and update inputs, the registry and its invariants — is not specified yet: it remains legacy documentation until it migrates ([spec-migration.md](../spec-migration.md)).

## Name

An artifact's name is its title, which its creator sets as free text. The title is shown verbatim wherever Television displays the artifact. The title has no restrictions on length or characters and is not normalized, including by trimming it. The artifact's visible and accessible names are always the same. ^af-name

## The document

An artifact's content is shown as a *document*: a page in its own right, the way a browser shows one, with its own styling, its own scripts, and its own history. Television renders it and does not rewrite it — the app's styling does not cascade in, the document's styling does not cascade out, and what the artifact draws is what its author made. ^af-document

An HTML artifact may record the Television app version it was authored against by linking its canonical stylesheet with `?authoredForAppVersion=<version>`. This is optional, advisory metadata for a future authoring agent. It does not change rendering or compatibility, and a document whose canonical URL omits it remains valid.

Television overrides three things in a document, and nothing else: ^af-native-interaction

- **The root appearance marker in Television-managed HTML that can run the resolver**, by setting `data-theme` on the document element so canonical and installed-theme CSS can respond to a light or dark result.
- **The navigation chord**, so stepping between pages and channels still works while focus is inside a document.
- **The link and form navigations the app commits itself**, so a move inside an artifact becomes that artifact's own history rather than the browser's. Which moves those are is deliberately unspecified — a named carve-out of the authority boundary, held by the shipping implementation ([the navigation-recording carve-out](../arch/artifact-frame/reload-navigation.md#^nav-recording-carve-out)).

For the two navigation overrides, only the browser's default action is overridden; the events still reach the document's own scripts. A document that cannot run Television's script — such as a raw image, a PDF, or HTML whose Content Security Policy blocks Television's injected script — still renders and accepts its native interactions.

Known limit: while a document that cannot run Television's script holds keyboard focus, the app's navigation shortcuts do not respond, because nothing in the document can pass the keystroke to the app. Clicking outside the document, or using the channel sidebar and tab strip, always works. The desktop app does not have this limit. ^af-hotkey-limit

## Deleting an artifact

Artifacts can be deleted. Deleting removes the artifact from its channel; its tab and frame go with it. The artifact's underlying file on disk is not touched — deletion changes what the channel shows, not what is stored. ^af-delete-semantics

Deletion asks for confirmation before acting, and names the artifact in the asking, so
nothing is removed by mistake and nothing is removed until it is confirmed. Declining
leaves the artifact, its tab, and its page exactly as they were; confirming performs the
removal above.

## Local source changes

When a path artifact points at a folder, Television treats the complete folder tree as that artifact's source. Creating, editing, renaming, or deleting a file anywhere under the folder reloads the artifact's document automatically, including when the changed file is a nested stylesheet, script, image, or data file. The reload happens whether or not the displayed page uses that file, so editing a folder can cause reloads that do not change what the user sees. ^af-folder-live-update

## Shared artifacts

Some artifacts are normally served by another Television host rather than the one a person is using. Added by its URL, a *shared artifact* sits on a channel like any other, and its document is fetched from that host whenever it loads; the content stays on the machine that shared it.

When that host goes away, the artifact keeps showing what it last showed — the loaded document stays as it is. Reloading it, by hand or by leaving the channel and returning, loads fresh instead and can land on an error page. ^af-shared-offline

When the host comes back with different content, the artifact updates itself. Some documents cannot check for new content on their own and stay as they are until reloaded; which ones, and why, is the bridge's remote-content poll ([artifact-bridge.md](../arch/artifact-frame/artifact-bridge.md)).

## External web pages in a browser (demo mode)

An artifact added by an `http:` or `https:` URL that does not make it a shared artifact ([Shared artifacts](#shared-artifacts)) is an *external page artifact*: its URL points at an ordinary web page rather than at a Television artifact. What decides is the URL's shape, not its host: a URL in the form of a Television artifact address makes a shared artifact on any host, and any other web URL, even one on a Television host, makes an external page artifact. The desktop app shows its page. A browser normally shows the unsupported-URL error page in its place ([ui/app/artifact-frame/index.md](../ui/app/artifact-frame/index.md), Error page), because a browser gives Television no way to run its own script inside such a page.

*Browser demo mode* lets a browser show those pages anyway, for demonstrations. It is on while a file named `.tv-mozfest-demo` exists in the operating-system home directory of the user running the Television server, and it takes effect when a browser next loads Television. In demo mode, a browser shows an external page artifact by loading its URL directly in the artifact frame. ^af-demo-mode

The page is the external page itself, and Television has no script inside it:

- Television overrides nothing in the page ([#^af-native-interaction](#^af-native-interaction) does not apply), and the keyboard limit applies while the page holds focus ([#^af-hotkey-limit](#^af-hotkey-limit)).
- Television keeps no history for the artifact. Back and Forward never appear in its frame, and where the user has navigated within the page is not remembered: reloading the artifact, or leaving its channel and returning, loads the artifact's own URL again.
- Theme effects that follow the pointer do not see pointer movement over the page ([themes-and-appearance.md#^theme-artifact-pointer-limit](./themes-and-appearance.md#^theme-artifact-pointer-limit)).
- A site that refuses to be shown inside another page shows whatever the browser shows for that refusal. Television does not detect or work around it.

Because the page's own links can take it anywhere, the artifact icon in the frame's title bar returns the frame to the artifact's own URL ([ui/app/artifact-frame/index.md](../ui/app/artifact-frame/index.md)). ^af-demo-return

Demo mode changes nothing else: the desktop app, every other kind of artifact, and links followed out of a Television-served artifact ([artifact-navigation.md](./artifact-navigation.md), Links that leave Television) behave the same with or without it.

## What survives moving around

- **Switching tabs preserves the document.** Moving between tab pages within a channel never reloads their artifacts: scroll position, form contents, and running scripts survive. Tab switching is the most frequent movement in the app, and losing in-document work to it would make the strip unusable for real work. ^af-tab-continuity
- **Switching channels may reload documents.** A channel's frames exist only while it is the current channel; returning to a channel loads its artifacts fresh. Unsaved state held inside a document does not survive leaving the channel. ^af-channel-reload
- **Rearranging pages may reload their documents.** Reordering tabs rearranges the channel's pages ([ui/app/stage/index.md](../ui/app/stage/index.md)); rearrangement is not promised to preserve live documents — continuity is promised to tab *switching* alone. Preserving documents through rearrangement is tracked as a future enhancement ([TV-524](https://linear.app/telepath-computer/issue/TV-524)); softening the channel-switch reload with a recency buffer is likewise tracked ([TV-525](https://linear.app/telepath-computer/issue/TV-525)). Dragging an artifact by its frame is a future milestone, not part of the current release.

## Navigation

A navigable artifact keeps browser-like history within its frame, per [artifact-navigation.md](./artifact-navigation.md), except an external page artifact shown in a browser under browser demo mode ([#^af-demo-mode](#^af-demo-mode)). That history can be stepped back and forward from the frame itself, which also shows whether either direction has anywhere to go.

## Undesigned states

The missing-artifact and unsupported-URL states are designed: the error page
([ui/app/artifact-frame/index.md](../ui/app/artifact-frame/index.md)). The two remaining states — what a person sees while
a document loads, and when a remote host is unreachable — are deliberately not specified:
their presentation is code-governed, a named carve-out of the authority boundary
([spec-migration.md](../spec-migration.md)). The carve-out covers presentation only — *when* an unreachable
producer's artifact keeps its last-seen content versus falls to an error state remains
this spec's promise ([#^af-shared-offline](#^af-shared-offline)). If these states are designed later, they
arrive here and the carve-out retires. ^af-states-carve-out

## Non-goals

- Supporting Television's in-frame features for artifacts served by an older Television installation is a non-goal: such documents render, but they establish no readiness and cannot forward the navigation chord, and any of their message shapes that still happen to work are incidental and unsupported.

## Testing

Artifact-name and document acceptance must run in a real browser.

Artifact-deletion acceptance must run in a real browser against a running Television server, invoke Delete from the artifact frame's menu, use the real confirmation, and inspect the underlying file on disk after both responses.

Tab-continuity acceptance must run against a running Television server in both a real browser and the real Electron app.

Folder-source update acceptance must run against a running Television server in both a real browser and the real Electron app. It must change a nested, non-index stylesheet or script used by a loaded folder artifact and observe the changed presentation without editing the index document or manually reloading.

Browser demo mode acceptance must run in a real browser against a running Television server. Its external pages must be served locally from an origin other than the Television server's, never fetched from a public site.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), the [artifact bridge spec](../arch/artifact-frame/artifact-bridge.md) owns acceptance in a real browser and the real Electron app for shared artifacts through producer outage and recovery, including raw documents and documents whose Content Security Policy blocks the request that checks for fresh content. The [reload and navigation architecture spec](../arch/artifact-frame/reload-navigation.md) owns real-browser acceptance for fresh loading after a channel switch. This spec does not require duplicate acceptance cases for those promises.

