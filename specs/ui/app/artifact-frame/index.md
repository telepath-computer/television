*UI spec: the artifact frame — the surface that holds one artifact's document.*

# Artifact frame (UI)

The surface that holds a single artifact's document, and the affordances to interact with that artifact and see information about it, such as its title. Every artifact Television shows is shown in an artifact frame.

Another surface may wear the frame's look around content of its own, as the [setup screen](../../setup/index.md) does: the frame's `body` parameter holds that content in place of a document, and `menu` turns the title bar's menu off. Such a surface is not an artifact frame. It has no document, no artifact, and none of the frame's behavior or machinery.

**Status:** implemented stage-one frame UI authority.

## Markup and styling

- [artifact-frame.frame](./artifact-frame.frame) — the frame: an `.artifact-frame` wrapping an `<iframe>` for the document, and the title bar — the artifact icon (a button in the one case below), the name, the Back and Forward controls once the artifact has history in either direction, and the menu trigger — with the ground, its border, and the title bar's band.
- [artifact-menu.frame](./artifact-menu.frame) — the frame's menu (the [menu](../../foundation/menu/index.md) vocabulary): full-screen in or out by state, and Delete.
- [ui/app/artifact-frame/delete-confirm/delete-confirm.frame](./delete-confirm/delete-confirm.frame) — the delete confirmation: the dialog's alert ([ui/app/dialog/index.md](../dialog/index.md), Appearance) asking about this artifact by name; the frame carries the complete confirmation copy.
- [ui/app/artifact-frame/error-page/error-page.frame](./error-page/error-page.frame) — the page standing where the artifact's document would be when it cannot show: one page, its contents by state ([Error page](#error-page)).
- [ui/app/artifact-frame/content.yml](./content.yml) — the title bar's copy.
- [ui/app/artifact-frame/measures.yml](./measures.yml) — the smallest an artifact and its frame are shown at.

The document is an `<iframe>` in the browser app — the desktop app renders it as a `<webview>`, with this template's iframe standing for either — so the artifact renders as its own document with its own styling. Nothing of Television's leaks into it or out of it, with one deliberate exception: the artifact bridge, Television's own script inside served documents, which observes, relays, and cancels two named native defaults without rewriting what the document shows ([arch/artifact-frame/artifact-bridge.md](../../../arch/artifact-frame/artifact-bridge.md)).

## Edge treatment

The frame has a translucent white inner highlight over its document and titlebar, and a sharp black exterior rim above its broad shadow. Appearance selects the exterior density independently of document content or wallpaper. [Application tokens](../../foundation/tokens/app.css) and [artifact-frame.frame](./artifact-frame.frame) state the paint and geometry. The inner ring follows the frame radius and remains pointer-transparent. Circular CSS corners and broad shadows approximate window chrome; they do not reproduce native window rendering.

The inner `.artifact-frame-clip` clips the document and titlebar and reserves one pixel of padding for control placement. The frame paints its broad shadow, and separate pseudo-elements paint the shared highlight and sharp rim. `--frame-border` defaults to `var(--panel-border)` and accepts an independent native CSS border. `--artifact-frame-shadow` defaults to `var(--shadow-xl)` and controls only the broad shadow; `none` leaves the rim visible. Inactive stage pages retain the rim and suppress the broad shadow. The shared paints and their disable behavior are defined in [Panels and surface edges](../../foundation/index.md#panels-and-surface-edges).

## Decisions

- **The frame has a minimum size; otherwise it fills what places it.** The minimum — [measures.yml#artifact.min_width_px](./measures.yml#artifact.min_width_px) by [measures.yml#artifact.min_height_px](./measures.yml#artifact.min_height_px) — is the smallest an artifact is shown at. Beyond it, how large an artifact appears is the containing view's decision: page sizing, and how a resize treats the minimum, are specified in [ui/app/stage/index.md](../stage/index.md), Page sizing.
- **The menu uses the shared popover placement.** It opens below the trigger with left edges aligned, flipping on either axis when space requires it ([popover placement](../../foundation/popover/index.md#placement)). The actions: Make full-screen — Exit full-screen while the mode holds ([ui/app/stage/index.md](../stage/index.md), Full-screen) — and, set apart by a separator, Delete, destructive.
- **Delete confirms before it acts.** The menu's Delete opens the confirmation — a dialog over the screen, dimmed: the session holds behind it. Cancel closes it and nothing changes; Delete removes the artifact from the channel, its tab and frame with it, the file on disk untouched ([product/artifacts.md#^af-delete-semantics](../../../product/artifacts.md#^af-delete-semantics)). The destructive action is never the default — focus rests on Cancel.
- **Back and Forward ride the bar's trailing end**, browser-style, set off from the menu caret by a divider. Both are absent while the artifact has no history in either direction. Once history exists they appear together: Back is disabled at home and live when an earlier page exists; Forward is disabled at the history tail and live after Back leaves a remembered page ahead. In the middle both are live ([product/artifact-navigation.md](../../../product/artifact-navigation.md)). The two directional capabilities determine the whole state; there is no separate navigation-presence flag.
- **The artifact icon is a button in one case only.** When a browser shows an external page artifact under browser demo mode ([product/artifacts.md#^af-demo-mode](../../../product/artifacts.md#^af-demo-mode)), the icon is a ghost icon button; pressing it loads the artifact's own URL in the frame again, wherever the page has navigated ([product/artifacts.md#^af-demo-return](../../../product/artifacts.md#^af-demo-return)). In the desktop app, for every other artifact, and without demo mode, the icon is not interactive.
- **Double-clicking the title bar toggles full-screen** — its controls aside: a double-click that lands on a button is the button's. The same mode the menu sets ([ui/app/stage/index.md](../stage/index.md), Full-screen), reached directly; the tab's double-click is its twin ([ui/app/stage/index.md](../stage/index.md)).
- **The title names both the bar and the document.** One `title` parameter is the visible name and the `<iframe>`'s accessible name, so the two cannot disagree and the document is reachable by assistive technology.
- **The frame's rounded corners clip the document.** A composited document under a scaled ancestor can still paint square through that clip, so the document's own top corners also apply the frame's radius by reference (`var(--frame-radius)`); its bottom corners stay square against the title bar. Either way, the radius is authored once. ^af-document-corners

## Error page

A standalone document standing in the frame where the artifact's own document would be, when it cannot show. It is one page whose contents follow its state; the states' composition and copy are specified in [ui/app/artifact-frame/error-page/error-page.frame](./error-page/error-page.frame) and [ui/app/artifact-frame/error-page/content.yml](./error-page/content.yml). It receives the artifact-document foundation and installed theme through `/canonical/v2/styles.css`, then applies its embedded, view-specific error-page sheet.

The states:

- **Missing** — the artifact is still registered, but the file or directory it points at is gone. The document titles itself with the missing artifact's name, falling back to the generic missing title in [content.yml](./error-page/content.yml); the frame format carries no title element, so the implementation writes it.
- **URL unsupported** — the artifact targets an external web page, which the desktop app embeds and a browser shows only under browser demo mode ([product/artifacts.md#^af-demo-mode](../../../product/artifacts.md#^af-demo-mode)).

The missing state's path chip is selected whole by one press: it exists to be copied. The URL-unsupported state links to the admin guide, which the user's agent follows to install the desktop app.

The page shows the artifact's name, path, or target when the app knows them, and reflects their later changes; how it learns them is specified in [arch/artifact-frame/artifact-bridge.md](../../../arch/artifact-frame/artifact-bridge.md).

The markdown renderer's file-not-found page deliberately duplicates this presentation; the two mechanisms stay separate.

The loading and unreachable conditions are not error-page states: their presentation is deliberately code-governed ([product/artifacts.md#^af-states-carve-out](../../../product/artifacts.md#^af-states-carve-out)). If they are designed later, they arrive here and the carve-out retires.

## Testing

A bounded browser raster regression covers the translucent frame edge and shared fractional sidebar seam at DPR1 and DPR2, including theme decoration overrides. This is an explicit exception to the general exclusion of styling assertions: fractional paint can disappear despite valid computed CSS. Other visual judgment remains part of design review.

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must prove the frame with no navigation history and with history behind or ahead. It must prove the frame while the page is in ordinary mode and while it is in full-screen mode. The suite must also prove that the production delete confirmation names the artifact. Independently, it must prove that the authoritative reference frame renders its complete confirmation copy through Frameset with its default artifact title and with supplied artifact titles, including HTML-sensitive characters rendered as text. It must prove that the artifact name in the title bar matches the document's accessible name.

The suite must prove the missing-artifact presentation before and after host metadata arrives. It must prove the URL-unsupported presentation with no target, with an HTTP(S) target, and with a non-web or invalid target. The suite must prove that each frame control requests only its matching navigation or application operation. It must prove the artifact icon is a button only for an external page artifact in a browser under browser demo mode, and a plain icon otherwise.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [artifact deletion](../../../product/artifacts.md#Testing) owns what happens in the real browser and server after the user selects Cancel or Delete in the confirmation. [Artifact navigation](../../../product/artifact-navigation.md#Testing) owns Back and Forward in the browser and Electron app. The [menu](../../foundation/menu/index.md) and [dialog](../dialog/index.md) specs own their generic opening, focus, dismissal, backdrop, and behavior that makes background content inert. The [stage](../stage/index.md#Full-screen) owns full-screen page geometry and motion. The [artifact bridge](../../../arch/artifact-frame/artifact-bridge.md) owns delivery of missing-artifact metadata and URL targets. This surface's suite does not require a duplicate product acceptance path for those interactions.

Under [artifact-frame architecture](../../../arch/artifact-frame/index.md#^frame-core-carve-out), evidence for iframe and webview routing and the status-page mechanism is code-authoritative rather than part of this UI surface's assertions.
