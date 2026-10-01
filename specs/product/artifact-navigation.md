*The user's mental model for navigating inside an artifact that has links or multiple pages: browser-like back/forward history, discarding the forward trail on a new move, and remembering where the user was.*

**Status:** adopted redesign product authority; browser and Electron acceptance conform.

# Artifact navigation

## What this owns

This spec owns the **user-facing navigation model** for artifacts whose content is navigable — artifacts that contain links or more than one page. It covers what the user can do, what they see, and what is remembered. It names internal machinery only by reference.

How this is implemented is [reload-navigation.md](../arch/artifact-frame/reload-navigation.md) (architecture). The frame an artifact is seen through is [product/artifacts.md](./artifacts.md) (product).

## Navigable artifacts

Some artifacts are a single static thing; others contain links and multiple pages the user can move through — a small site, a folder of pages, a document with internal links. When an artifact is navigable, moving through it behaves like moving through pages in a single browser tab.

One case is outside this model: an external page artifact that a browser shows under browser demo mode. Television keeps no history and no remembered place for it ([artifacts.md#^af-demo-mode](./artifacts.md#^af-demo-mode)).

## Browser-like history

Each navigable artifact keeps its own history, like one browser tab:

- **Back** returns the user to the previous page they were on within that artifact.
- **Forward** returns along the remembered trail after going back; navigating somewhere new discards it (see below).
- The artifact's original page is its *home*; going back far enough returns to home. Following a link to home returns to that same home position instead of adding a duplicate page to the history.

The controls themselves — look, placement, when they appear — are [ui/app/artifact-frame/index.md](../ui/app/artifact-frame/index.md)'s.

## Forward is discarded on a new move

If the user goes back and then navigates somewhere new, the pages that were ahead (the forward trail) are thrown away — exactly as a browser tab does. The user cannot go "forward" into a path they abandoned.

## The user's place is remembered

Where the user is within an artifact is preserved on their device. If the artifact reloads, the user moves between channels, leaves and returns to it, or the app restarts, the artifact reopens where the user left off, with its back/forward history intact.

## Links that leave Television

A modifier-click (Cmd/Ctrl) on a link to an external web site opens it outside the artifact — in a new browser tab or window in the browser, or as an external open in the desktop app — leaving the user's place in Television intact. A normal click on an HTTP(S) link follows the artifact's in-frame navigation path: the desktop app loads the destination in the frame, while the browser app shows its unsupported-external-page document there.

A user-activated link to a registered application scheme, such as `obsidian:`, opens through the browser or operating system from both markdown and HTML artifacts. It is a handoff, not artifact navigation: the artifact document, its frame URL, and its Back/Forward history remain unchanged. Because an application link has no browser document to place in another tab, an activation that ordinarily requests another browsing context — Cmd/Ctrl-click, middle-click, or an authored non-self target — has the same meaning as a plain click: one application handoff and no new browsing context. Unknown non-web schemes are treated as application links so newly installed handlers do not require Television support by name. In Electron, operating-system handoff is limited to documents served from the connected Television origin; third-party URL artifacts receive the preload but cannot use this capability. ^application-link-handoff

Browser-executable and local-resource schemes receive no operating-system handoff. In the markdown editor they do nothing. In an executable HTML artifact they retain only the behavior and authority the browser already gives that artifact's own browsing context; Television does not relay them into its navigation or to an operating-system handler. Desktop application handoff requires active user activation. This prevents silent launches but deliberately does not protect a user who activates a hostile handler URL in an artifact. ^application-link-boundary

## Testing

Acceptance must exercise navigable artifacts against a running Television server in both a real browser and the real Electron app. Persistence acceptance must cross a real browser reload, leaving and returning to a channel, and quitting and relaunching the desktop app.

Modifier-click acceptance must cover HTML and markdown links in the browser, and path, URL, and markdown artifacts in the desktop app. Desktop acceptance must reach the app's real external-open handling. It may stop at `shell.openExternal`, which hands the link to the operating system; it does not need to launch a browser.

Application-link acceptance must cover HTML and markdown artifacts in both the browser and desktop app. On Linux it must cross a registered operating-system protocol handler rather than replace the handoff, and browser acceptance must observe popup requests and transient page creation rather than infer their absence from the final page count. Desktop seam coverage must exercise the active-user and connected-origin denials, including cold scripted requests and third-party URL artifacts. Linux Ctrl/Meta input covers both modifier branches but supplies no macOS or Windows runtime claim.

Under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism), the [reload and navigation architecture spec](../arch/artifact-frame/reload-navigation.md) owns coverage of detailed history transitions and platform handoffs. The [artifact-frame UI spec](../ui/app/artifact-frame/index.md) owns coverage of the controls' visibility, enabled states, and component interaction. This spec does not require a Forward acceptance case in Electron or another set of tests for the controls' states.

