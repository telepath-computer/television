*UI spec: the app shell — its two interface regions and the noninteractive visual layers that installed themes can place around them.*

# App (UI)

Television's window contains a narrow region down the left and the rest of the interface beside it. Installed themes can also draw across the window on noninteractive surfaces behind or above those regions. This spec owns the shell and those visual layers, but nothing inside the two interface regions.

**Status:** current stage-one shell authority. The shell divides the window into `.app-sidebar` and `.app-main` — the navbar over the stage — and composes all three. What is in each is theirs: [ui/app/sidebar/index.md](./sidebar/index.md), [ui/app/top-bar/index.md](./top-bar/index.md) and [ui/app/stage/index.md](./stage/index.md). It also owns the body-level theme layers described below. The production implementation is `packages/web/src/views/television-app.ts`, with runtime frame documents owned by [theme delivery](../../arch/themes/delivery.md#sandboxed-frames).

## Markup and styling

- [app.frame](./app.frame) — shell markup and composition.
- [styles.css](./styles.css) — shell layout and styling.

The optional theme frames and connection-state presentations are specified below because `app.frame` does not render them.

The application document loads the complete [foundation](../foundation/index.css) before its surface styles. Its root carries `data-television-document="app"` so themes can target the application separately from artifact documents.

Installed themes follow the complete foundation and application surface sheets through the runtime theme link. [Clouds](../themes/clouds/index.md) is the default theme for a new installation and is selected for an unset data directory; it is not part of the foundation.

The wallpaper region establishes a backdrop boundary: tab blur samples its wallpaper without sampling the adjacent sidebar or other surrounding content. This boundary preserves viewport positioning for fixed popovers. [styles.css](./styles.css) states the treatment.

## Theme visual layers

The application body contains four ordered layers. From back to front they are the optional `#theme-iframe-background`, `#app`, the permanent `#foreground-overlay`, and the optional `#theme-iframe-overlay`. The background and foreground iframe elements appear only while the active registered theme enables their respective scripts. Theme delivery supplies each frame's architecture-owned `srcdoc` and owns its replacement lifecycle. The empty foreground div is always present so ordinary theme CSS can produce a viewport effect without JavaScript. The [appearance explainer](../../arch/explainer-appearance.md) follows the effective appearance through the frame hosts and their generated documents. ^app-theme-visual-layers

All three theme surfaces are fixed to the viewport. The background frame uses z-index `0`, the application uses `1`, the foreground div uses `2147483646`, and the foreground iframe uses `2147483647`. The three theme surfaces' z-index values and `pointer-events: none` declarations are important. The frame elements also have `sandbox="allow-scripts"`, `inert`, `tabindex="-1"`, and `aria-hidden="true"`; the foreground div has `inert` and `aria-hidden="true"`. Important host declarations pin each frame element's `color-scheme` to the light or dark value in the application root's effective `data-theme`. Themes may use the stable IDs for other styling while this scheme and the structural and interaction protections remain in force.

`#app` carries `tabindex="-1"` as the programmatic fallback for [theme-frame focus restoration](../../arch/themes/delivery.md#sandboxed-frames) and remains outside sequential focus navigation. Native modal dialogs use the browser top layer, which renders above all four ordinary stacking layers. Popover placement and stacking follow [the popover layer contract](../foundation/popover/index.md#layer).

## Selection

Selection is off across the app. These are the surfaces of an application, not a document: dragging across a list of channels never smears a highlight over it, and a stray double-click never leaves a word highlighted in the chrome. Text meant to be read, quoted or copied turns it back on for itself.

The stance is the app's own, so it reaches only what the app composes — an artifact's document is untouched by it, and so is the foundation any document builds on.

The shell contains its surfaces within the window. A filmstrip or tab strip may overflow inside its own band, but neither region creates document-level horizontal scrolling: the browser document always stays at the window's width. ^ap-root-contained

## Input and viewport scope

Stage one targets desktop-sized windows and pointer/keyboard input. It promises no narrow mobile arrangement and no touch gesture vocabulary; a mobile or touch-only presentation may be unusable. Channel-sidebar, tab, and stage gestures inherit this app-wide boundary rather than each defining a device matrix. ^ap-desktop-input-scope

A surface that combines ordinary activation or navigation with pointer dragging performs the ordinary action through a real browser `click` handler. Pointer events arm, carry, and terminate the drag; once movement latches a drag, the surface suppresses the click associated with that gesture. Channel rows and tabs inherit this rule, as does any later draggable app control. ^ap-drag-click-activation

The desktop app's window resizes no smaller than [ui/app/measures.yml#window.min_width_px](./measures.yml#window.min_width_px) by [ui/app/measures.yml#window.min_height_px](./measures.yml#window.min_height_px). The bound is the desktop shell's alone — a browser window is the person's, and the app makes no claim on it. ^ap-window-minimum

## Resizing the channel sidebar

A pointer drag on the boundary between `.app-sidebar` and `.app-main` resizes the channel sidebar, reflowing both regions live — the channel sidebar at the chosen width, `.app-main` taking the remaining width; release keeps the width. The width is clamped between [ui/app/measures.yml#sidebar.min_width_px](./measures.yml#sidebar.min_width_px) and [ui/app/measures.yml#sidebar.max_width_px](./measures.yml#sidebar.max_width_px); the default is [ui/app/measures.yml#sidebar.default_width_px](./measures.yml#sidebar.default_width_px). The width is client state, not styling: the client maintains `--sidebar-width` on the application root at the current width — the committed width, or the default — and no stylesheet authors the property, so styling may read the live width but a stylesheet value never determines it. A committed width is remembered per browser; the storage contract is [arch/channel-state/index.md#^cs-sidebar-width-key](../../arch/channel-state/index.md#^cs-sidebar-width-key)'s. ^ap-sidebar-resize

- The grab band is [ui/app/measures.yml#sidebar.resize_band_px](./measures.yml#sidebar.resize_band_px) wide and straddles the boundary, half on each side, wearing the `col-resize` cursor. The boundary keeps its resting appearance throughout: hover, drag, and release change the width and the cursor, never the boundary's treatment. ^ap-resize-band
- The drag tracks the pointer's travel from the grab point, clamped to the bounds, and follows the pointer wherever it goes — over the stage and its artifact documents included. Release commits the width and persists it. Escape, pointer cancellation, and unexpected capture loss abandon the drag, restore the width the drag started from, and persist nothing; capture loss after a completed release is inert. ^ap-resize-commit
- Double-clicking the band clears the committed width, returning the channel sidebar to the default.
- The gesture is pointer-only, inheriting the desktop input boundary ([#^ap-desktop-input-scope](#^ap-desktop-input-scope)); there is no keyboard resize. A stored width outside the bounds applies clamped.

## Collapsing the channel sidebar

The collapse control hides the sidebar; the expand control restores it at the previous width. [app.frame](./app.frame) defines the two layouts, and the [navbar spec](./top-bar/index.md#the-lead-group) defines the controls available while collapsed. Collapsed-state persistence follows [channel-state architecture](../../arch/channel-state/index.md#^cs-sidebar-collapsed-key). ^ap-sidebar-collapse

### The transition

[sidebar-transition.ts](./sidebar-transition.ts) defines `sidebarPose(progress, geometry)` for the changing visual properties and `sidebarProgressAt(start, target, elapsedMs, durationMs)` for timing. Production may copy the calculations or produce equivalent results. ^ap-collapse-function

Progress measures boundary travel from expanded (`0`) to collapsed (`1`); geometry measures the resting [sidebar](./sidebar/sidebar.frame) and [navbar](./top-bar/top-bar.frame) layouts in pixels, with horizontal positions relative to the left edge of the app. Duration comes from [sidebar.collapse.duration_ms](./measures.yml#sidebar.collapse.duration_ms).

One toggle remains usable throughout the transition, retaining its size and vertical position. Activating it during motion reverses from the current progress. Reduced motion settles immediately. The sidebar contents retain their width, spacing, and scroll position while sliding. The switcher stays at its collapsed resting position while visible. ^ap-collapse-choreography

The main region fills the space to the right of the sidebar boundary. Within it, the [navbar](./top-bar/index.md#layout) uses the returned lead reservation and the [stage](./stage/index.md#page-sizing) reflows its content. Shell layout follows each pose without additional delayed motion; animation inside artifact documents remains independent. ^ap-collapse-reflow

Changes between fitting and overflowing content introduce no jumps. Both endpoints join their resting layouts without a finishing snap or delayed fade. ^ap-collapse-monotone

Collapse and expansion preserve channel selection, tab order, page selection, and artifact document state without reloading artifacts. Playback with live artifacts remains smooth, without pauses, flashes, or delayed catch-up.

## Connection states

While the server's interface can't use its server, the [system modal](./system-modal/index.md) shows one state at a time, chosen by these rules. The [connection states explainer](../../arch/explainer-connection-states.md) follows these rules alongside the desktop app's own screens. ^ap-connection-states

- **A definite answer from the server shows its own state at once.** When the server asks for an access token or rejects the one it was given, the state is Access token required. When the desktop app is gated ([arch/updates/desktop-upgrade-gate.md](../../arch/updates/desktop-upgrade-gate.md#^boot-barrier)), the state is the upgrade gate. This holds on the first connection and on every reconnect, including while Disconnected or Can't connect with server is showing; neither of those ever stands in for a definite answer. Once the upgrade gate shows, it stays until the page reloads: nothing replaces or covers it, including a later rejected token ([^gate-screen](../../arch/updates/desktop-upgrade-gate.md#^gate-screen)).
- **Access token required waits.** A rejected token does not fix itself, so the app makes no further attempts, and a browser forgets the token it had stored. In a browser, the person recovers by opening a current connect link; in the desktop app, by Disconnect from Server.
- **A first connection that cannot reach the server** shows Can't connect with server. Before that the state is Connecting.
- **A dropped connection** shows Disconnected. After three reconnect attempts in a row fail to reach the server, it shows Can't connect with server. Only attempts that cannot reach the server count toward the three, and a successful connection starts the count again. ^ap-reconnect-escalation
- **Disconnected and Can't connect with server keep trying,** and leave by themselves when an attempt succeeds.
- **What is behind the dialog.** After a session has existed, the shell, with its live artifact frames, stays mounted behind Disconnected and Can't connect with server, and resumes without reloading when the connection returns. Before any session, and for Access token required and the upgrade gate, no shell is rendered; the dialog stands on the app's bare ground.
## Testing

Under [What a UI surface's suite is responsible for](../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must prove the shell composition for the `connected`, `no-channel`, `empty-channel`, `connecting`, `disconnected`, `unauthorized`, `error`, and `needs-upgrade` application states. The permanent foreground div is sampled in every state in that matrix. When the facts for more than one connection state are true, the suite must prove that the [connection-state rules](#connection-states) select one presentation. It must also prove that two system-modal states never appear together.

Acceptance of the connection states runs in a real browser against a running server, one that requires a token where a token is involved. A rejected stored token is covered both during boot and after a session has been established.

Acceptance of a dropped connection holds the shell's identity: the shell and its live artifact frames remain the same nodes, and artifact document state stays intact, through Disconnected, through [the escalation](#^ap-reconnect-escalation) to Can't connect with server, and through reconnecting.

At desktop window widths, real-browser acceptance must show that an overflowing tab strip or stage remains contained inside the shell. The document must have no horizontal scroll range. An attempt to scroll the document horizontally must leave the window's horizontal scroll position unchanged.

Real-browser acceptance of [Selection](#Selection) must show that dragging across ordinary interface text creates no selection. It must also show that double-clicking ordinary interface text creates no selection. It must also show that dragging across text that has enabled selection selects that text.

The [desktop-only input and viewport boundary](#Input and viewport scope) does not require a matrix of tests to prove that narrow mobile layouts or touch-only input are unsupported.

Acceptance of the resize drag must include a path whose pointer crosses an artifact's document, where an embedded document could swallow the gesture's pointer events.

The resize band's node and styling are implementation-owned and enter conformance as a declared exemption ([arch/ui/conformance.md](../../arch/ui/conformance.md)); the frames and [styles.css](./styles.css) do not state them. ^ap-resize-band-exemption

Under [The suite does not assert styling adherence](../../arch/testing-policy.md#^ui-styling-out), this surface's suite does not cover shell padding or gaps, backgrounds, or the appearance of its two regions.

Under [Tests are the validation mechanism](../../arch/testing-policy.md#Tests are the validation mechanism), [desktop upgrade architecture](../../arch/updates/desktop-upgrade-gate.md#Testing) owns the real `server-status` path into the boot barrier. [Product update acceptance](../../product/update-notifications.md#Testing) owns the real Electron gate and relaunch. Together, those proofs establish that the gate appears without the shell or connection interstitial. They also establish that removing the desktop version requirement causes the normal shell to appear. This suite does not repeat the server or Electron paths.

Under the same rule, the [sidebar](./sidebar/index.md), [navbar](./top-bar/index.md), [stage](./stage/index.md), and [system modal](./system-modal/index.md) own their contents and behavior. This surface's suite proves only where these child surfaces and theme layers appear and which connection states replace the shell or appear over it. [Theme delivery](../../arch/themes/delivery.md#testing) owns real-browser sandbox, pointer forwarding, focus restoration, lifecycle, appearance, and frame transparency behavior.

Under [Tests are the validation mechanism](../../arch/testing-policy.md#Tests are the validation mechanism), [channel-state architecture](../../arch/channel-state/index.md#Code-governed carve-out) owns reconnection and convergence on server truth. [Channel product acceptance](../../product/channels.md#Testing) points to this spec for what happens to the entire shell while disconnected. For this surface, the disconnection acceptance above proves the mounted shell's continuity. It does not repeat coverage of convergence on server truth.

### Sidebar animation

Compare the rendered production shell with the [motion reference](./sidebar-transition.ts):

- **Poses:** sample both endpoints, the toggle docking position, a mid-wipe position, and an earlier slide position. Check the returned properties and the composed navbar and stage layout.
- **Playback:** sample collapse and expansion with a controlled browser clock, including interrupted reversal and reduced motion.
- **Continuity:** verify that artifact frames and documents survive, selection is preserved, and expansion restores the previous width.

Apply the [real-motion testing rules](../../arch/testing-policy.md#^real-motion). Human review assesses smoothness with populated artifacts; sampled checks do not establish perceived smoothness.
