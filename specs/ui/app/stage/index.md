*UI spec: the stage — the region artifacts are shown in, and the filmstrip of pages it holds.*

# Stage (UI)

Where the artifacts of the current channel are shown: the ground below the navbar, holding the filmstrip. The bar itself is specified in [ui/app/top-bar/index.md](../top-bar/index.md); composing the two is specified in [ui/app/index.md](../index.md).

**Status:** implemented stage-one authority; the page-sizing behaviour is settled. How a page's size is represented and carried between clients is specified in [arch/layout/index.md](../../../arch/layout/index.md).

The stage is [ui/app/stage/stage.frame](./stage.frame): the filmstrip of pages, the empty state when there are none, and the styling of both. The box an artifact renders in is the artifact frame's spec ([ui/app/artifact-frame/index.md](../artifact-frame/index.md)), composed once per page.

## Filmstrip

The filmstrip is the stage's content: the focused channel's pages in one horizontal row. The navbar's tab strip ([ui/app/tab-strip/index.md](../tab-strip/index.md)) and the filmstrip show the same thing — the channel's open artifacts, in one order. A tab and a page stand for the same artifact, and what happens to one happens to the other. Pages are separated by a gap and inset from the stage's edges — both measures stated in [ui/app/stage/stage.frame](./stage.frame) — and the row overflows the stage on both sides, the stage clipping it.

A **page** is the box one artifact is shown in ([product/tab-pages.md#^tp-one-artifact](../../../product/tab-pages.md#^tp-one-artifact)).

- Exactly one page is **selected**, and it rests centred in the stage. Selecting another page slides the filmstrip until that page is centred ([Selection](#selection)).
- A page carries a width and a height, set by dragging its edges ([Page sizing](#page-sizing)). Its contents set its lower bound — the artifact's minimum width and height ([Bounds](#bounds)) — and full-screen is a mode over the size ([Full-screen](#full-screen)).
- Every other page is a **background page**, shown receded without artifact shadows (styling in [ui/app/stage/stage.frame](./stage.frame)) and inert: its artifact, and everything on its frame, takes no input. Pressing it selects it, and that is the only interaction a background page takes.
- The filmstrip moves only when the selection changes. There is no free scrolling: swiping or wheeling across pages does nothing. ^st-selection-only
- Moving the selection never reloads a page's document ([product/artifacts.md#^af-tab-continuity](../../../product/artifacts.md#^af-tab-continuity)).
- Changing channels swaps the filmstrip for the new channel's pages at once; no motion plays between channels. Every stateful view in the discarded filmstrip is disconnected before any view in the arriving filmstrip becomes active, so subscriptions, global listeners, and owned resources are released. Lit's `keyed()` directive must not own this replacement boundary: it resets the part's committed value before clearing and causes nested views to miss `disconnected()`, retaining view references and event handlers as a memory leak and allowing discarded views to process later events. A one-item `repeat()` keyed by channel ID provides channel identity through Lit's disconnect-aware child-part removal path. ^st-channel-redraw

## Selection

- A tab selects through the browser's `click` event on release, not on press, following the app's [draggable activation rule](../index.md#^ap-drag-click-activation). Pointer movement through [drag.yml](../drag.yml)'s threshold leaves the ordinary click intact; movement beyond it latches a drag, whose click is suppressed so the carried tab never selects.
- Selecting a tab selects its page. The pair rest aligned: the page centred in the stage, the tab centred in its band the same way, as near as the band's ends allow ([ui/app/tab-strip/index.md#^tb-selected-centres](../tab-strip/index.md#^tb-selected-centres)).
- Selecting a tab moves the filmstrip to its page over the crossing duration ([ui/app/stage/measures.yml](./measures.yml)) on CSS's `ease` curve — the same time however far apart the two pages sit.

## Reordering

The gesture inherits the shell's desktop-pointer input boundary ([ui/app/index.md#^ap-desktop-input-scope](../index.md#^ap-desktop-input-scope)); it defines no touch equivalent.

- Dragging any tab picks it up, selected or not — and picking up never selects: selection stays on the artifact it was on throughout the drag. The tab itself follows the pointer wherever it goes, in the foreground; a placeholder holds its slot in the band, a tint in the tab's own size and shape, drawn where release will drop it. The tint is specified in [tab-placeholder.frame](../tab-strip/tab-placeholder.frame).
- The others make room around the slot: when the dragged tab's centre crosses a neighbour's, they swap, the neighbour sliding over on the displacement duration ([drag.yml](../drag.yml)).
- The pages swap at the same moment, sliding in the same duration as the tabs. The selected page keeps the foreground — a dragged background page travels beneath it — and holds its place and its centre throughout, whether it is being dragged or crossed.
- The page row does not move while a tab is held: pages hold their size and place, and only the swaps below play. Picking up a tab does not leave full-screen — a full-screen page keeps its mode through the drag.
- Dragging a tab to the strip's end scrolls the strip, so a slot out of sight can be reached. Within the edge zone ([drag.yml](../drag.yml)) the strip scrolls, fastest at the very edge and tapering to nothing at the zone's inner edge — the channel sidebar's measures for the same gesture ([ui/app/sidebar/index.md](../sidebar/index.md), Pinning and reordering). A strip with nowhere to scroll does nothing.
- Releasing drops the tab into the placeholder's slot — the tab is already over it, so nothing slides further.
- Release commits the placeholder's order exactly once, wherever the pointer sits — leaving the strip does not end the drag. Swaps during the drag are provisional: no order is saved or shared before release. Escape or a cancelled drag abandons it — tabs, pages, and selection return to where they started, and no order is saved. ^st-reorder-commit

## Full-screen

- Full-screen is a mode over the page's size, not a size of its own: the page takes the stage's complete **page box** — the stage inside its authored side and bottom insets — at every window size.
- Double-clicking a tab toggles its page between ordinary and full-screen.
- A full-screen page keeps its resize handles: dragging one leaves the mode, the drag continuing from the page box as an ordinary resize ([Page sizing](#page-sizing)), and release keeps the size the drag ends at. Cancelling the drag restores the mode.
- Entering and leaving full-screen morph the page's width and height on the page transition [ui/app/stage/stage.frame](./stage.frame) states; the page stays centred throughout.
- Leaving full-screen returns the page to the size it had beneath the mode, which entering never changed ([Page sizing](#page-sizing)).
- Full-screen is shared layout state (`full_screen`) and survives server persistence ([arch/layout/index.md#^ly-fullscreen-mode](../../../arch/layout/index.md#^ly-fullscreen-mode)).

## Page sizing

A page can be made bigger or smaller by dragging its edges. This section describes how that dragging behaves — what moves while it runs, what the page is left at when it ends, and how large or small a page is allowed to get.

### The size

- A page carries a width and a height. The artifact does not choose them; it only sets how small it may be shown ([Bounds](#bounds)).
- A page's size is defined at the **reference page box**, [measures.yml#sizing.reference_width_px](./measures.yml#sizing.reference_width_px) by [measures.yml#sizing.reference_height_px](./measures.yml#sizing.reference_height_px): the width and height are the pixels the page renders at when the stage's page box is exactly that size.
- On any stage, each axis renders at `size × (1 − share + share × stage ÷ reference)`, with the shares in [measures.yml#sizing.width_share](./measures.yml#sizing.width_share) and [measures.yml#sizing.height_share](./measures.yml#sizing.height_share). In words: `1 − share` of each axis never changes, and `share` of it scales in full proportion to the stage — rendered size is linear in stage size, changing by `size × share ÷ reference` pixels per pixel of stage change, never in full proportion.
- The multiplier depends only on the stage, never on the page, so all pages resize at the same rate — except where another constraint overrules: a page held at a bound ([Bounds](#bounds)), or a full-screen page, which takes the page box itself ([Full-screen](#full-screen)) rather than the formula.
- Sizes and rendered sizes are CSS-pixel values and may be fractional; nothing quantizes them.
- A drag works in rendered pixels: release leaves the page rendering exactly the dragged size on that stage, which by the formula fixes its size — and with it what it renders on every other stage.
- Bounds apply to the rendered size ([Bounds](#bounds)): a stage too small clamps what is shown, and a larger stage shows the page whole again.
- While the window resizes, pages follow the formula exactly, with no animation — the morph ([ui/app/stage/stage.frame](./stage.frame)) is for state changes, never for window tracking — and the selected page stays centred throughout.
- A page created without an authored size starts at [measures.yml#page.initial_width_px](./measures.yml#page.initial_width_px) by [measures.yml#page.initial_height_px](./measures.yml#page.initial_height_px). Bundled onboarding may author an initial reference-pixel size for its pages ([arch/onboarding/content.md#^layout-config](../../../arch/onboarding/content.md#^layout-config)); either way, a drag replaces the page's initial size.
- Full-screen is a mode over the size, not a size of its own ([Full-screen](#full-screen)): entering leaves the size beneath the mode untouched, and leaving returns the page to it. What waits beneath is the last size a drag left the page at, never one a drag passed through — entering mid-resize preserves the size the page was already settled at, not the size it had reached when the mode took over.

### The gesture

The gesture is pointer-only, inheriting the shell's desktop input boundary ([ui/app/index.md#^ap-desktop-input-scope](../index.md#^ap-desktop-input-scope)); there is no keyboard resize.

- Only the selected page resizes. Click events on a background page are limited to selection ([Filmstrip](#filmstrip)).
- A page's side edges drag its width, its top and bottom edges its height, and its corners both.
- The page holds its centre: the edge opposite the dragged one moves with it, and the page stays centred in the stage throughout. A dimension therefore changes by twice the pointer's travel along it.
- With the exception of the full-screen snap ([Full-screen snapping](#full-screen-snapping)), the dragged edge stays under the pointer for as long as the drag runs: the size follows the pointer's travel exactly, with no lag, increment, or preferred step.
- Releasing keeps the size the drag ended at. A drag changes an axis only as far as it actually moved the page: an axis whose rendered size ends where it began — an outward pull on a page already held at a bound — leaves the size unchanged.
- A drag can be cancelled: by Escape while it runs; by the platform taking the pointer away — a browser pointer cancellation, or an unexpected loss of pointer capture; or by the stage's page box changing while the drag runs — a window resized under the gesture. Cancellation abandons the resize: the page returns to the size the drag began at, and an armed snap never fires.
- A live drag never animates. A size change that is not a drag morphs on the page's transition ([ui/app/stage/stage.frame](./stage.frame)).

### Handles

- Handles ride the page's boundary. The interior is the artifact's: nothing to grab overlaps it.
- An edge's band is [measures.yml#handles.edge_band_px](./measures.yml#handles.edge_band_px) thick, centred on the edge.
- A corner reaches down both its adjoining edges as an L, never a filled square — [measures.yml#handles.corner_reach_px](./measures.yml#handles.corner_reach_px) along each, with arms [measures.yml#handles.corner_thickness_px](./measures.yml#handles.corner_thickness_px) thick — so a grab near a corner takes both axes while the edge beyond the L's arms takes one.
- Each handle shows the cursor of the directions it drags.
- Handles never overlap controls: the frame lays out its controls clear of the bands, and a combination of measures that puts a band over a control is an invalid state.

### Bounds

- A page's minimum size is given by the minimums of its content: the artifact frame's minimum width and height ([ui/app/artifact-frame/index.md](../artifact-frame/index.md), Sizing). No separate minimum page size is stated.
- A page grows no larger than the stage's page box ([Full-screen](#full-screen); authored in [ui/app/stage/stage.frame](./stage.frame)).
- The stage's box wins over the minimum. In a window too small to hold an artifact at its minimum, the page is the stage's size and the artifact is shown under its minimum rather than overflowing the stage.
- At a bound the page stops and the pointer travels on without it. Bringing the pointer back takes the edge with it the moment the pointer reaches the bound again; the overshoot leaves nothing to make up first.

### Full-screen snapping

Dragging a corner to the stage's extents snaps the page into full-screen mode ([Full-screen](#full-screen), above).

- A corner drag **arms** when the page reaches within [measures.yml#snap.arm_px](./measures.yml#snap.arm_px) of the stage's page box on both sides. An edge drag never arms: one axis cannot reach both extents.
- Arming takes the page to the whole page box at once. The page moves without the pointer, and that is the signal — nothing else in the gesture does it, so the magnet is felt rather than announced.
- While armed the stage outlines the page box ([ui/app/stage/stage.frame](./stage.frame)). It arrives with the jump rather than before it: the outline says where release leaves the page, not where the page might go.
- Carrying the corner back out of the arming distance disarms — the page returns to the pointer, and the outline goes.
- Releasing while armed puts the page into full-screen; the size beneath the mode is the one the page was settled at when the drag began ([The size](#the-size)).
- Holding Option suppresses the magnet for as long as it is held, so a page can be sized right up to the stage without going full-screen. It applies the moment it is taken or released, whether or not the pointer is moving.

## The empty channel

A channel with no pages shows the empty-channel message specified by [stage.frame](./stage.frame) and [content.yml](./content.yml). When no channel exists, the stage shows neither pages nor the empty-channel message.

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must prove the stage's no-channel, empty-channel, and populated branches. The no-channel branch must show neither pages nor the empty-channel message. The empty-channel branch must show the authored message without pages. The populated branch must show each supplied page and artifact frame exactly once and in the supplied order. It must mark selection and `full_screen` exactly as supplied.

When channels change, the suite must prove that every discarded artifact view disconnects and releases its global frame-message subscription before any arriving view becomes active. After repeated channel changes in a real browser, discarded artifact views and frames must be eligible for garbage collection while the current channel remains rendered. The garbage-collection result proves that the stage lifecycle does not strongly retain discarded artifact views or frames. It does not prove that total process memory stays constant or that unrelated subsystems contain no leaks.

Real-browser acceptance of page selection must press a background page without delivering that press to its artifact. It must preserve every existing page and frame node. It must centre the selected page through the authored crossing motion. Adjacent and nonadjacent selections must complete in the same authored duration. Every artifact document must still be live afterward.

Real-browser acceptance of a channel change must replace the old filmstrip with the new channel's pages in one render. No page from the old filmstrip may remain mounted. The arriving selected page must be centred at its first settled paint. The replacement must start no transition, animation, or scrolling.

Real-browser acceptance of the filmstrip's selection-only input rule must cover horizontal wheel input, Shift with vertical wheel input, and a swipe-like pointer gesture on the stage ground. Each input must leave the selected page, filmstrip position, and every frame node unchanged. None may invoke a page-selection operation.

Full-screen acceptance must double-click the selected tab in a real browser to put that page into full-screen and take it back out. Each change must run and complete the authored transition of the page's width and height while the page stays centred. At two window sizes, full-screen must occupy the complete page box, and leaving it must return the page to the size it held before entry.

Real-browser acceptance of tab input must show that release selects the tab when no pointer move has latched a drag. This must remain true even if the release coordinate is beyond the drag threshold. A pointer move beyond that threshold must latch a drag and suppress its click. A captured drag must remain active after the pointer leaves the strip. A release outside the strip must end the drag once and submit an order only if the order changed. Escape, pointer cancellation, and unexpected capture loss must restore the original tab order, page order, and selection without submitting a reorder.

Real-browser acceptance of reordering must cover selected and background tabs moving across one and several slots. The carried tab must stay under the pointer above one inert placeholder. At each neighbour crossing, the placeholder, tab order, and page order must swap together through the specified displacement transition. Selection must remain on the same page. That page must stay centred and in the foreground. Page layout must not change, and text must not reflow. Release must submit the final order exactly once. It must start no further displacement or strip scrolling. A full-screen selected page must remain in that mode throughout, at the full-screen page box.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [artifact acceptance](../../../product/artifacts.md#Testing) owns document continuity through tab switching, while [What survives moving around](../../../product/artifacts.md#What survives moving around) permits document recreation during page rearrangement. Page-selection acceptance for this surface must preserve the existing frames and documents as stated above. Reorder acceptance makes no iframe or webview identity claim.

Under the same rule, [tab-page acceptance](../../../product/tab-pages.md#Testing) owns the real-browser and server outcomes for private selection and shared page reordering and sizing. [Layout architecture](../../../arch/layout/index.md#Testing) owns server validation, persistence, and broadcast. For this surface, those proofs establish the private selection outcome and the shared reorder and resize outcomes beyond this view. This suite does not repeat the paths through the server or a second client.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), the [tab strip](../tab-strip/index.md) owns its unmodified arrow-key behavior and the edge scrolling that runs while a tab drag is held. [Keyboard-navigation architecture](../../../arch/ui/keyboard-navigation.md#Testing) owns the proof that a pointer press and the application navigation chord enter the same page-selection operation. [Keyboard-navigation product acceptance](../../../product/keyboard-navigation.md#Testing) owns the chord's rendered outcomes, including when a tab holds focus. This surface does not require another rendered comparison of pointer selection with keyboard selection.

Under the same rule, the [app shell](../index.md#Testing) owns the integrated presentation when there is no channel or when the focused channel has no pages. This surface's suite proves only the stage branches described above. It does not repeat the app shell's complete presentations for no channel and an empty channel.

