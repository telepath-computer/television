*UI spec: the tab strip — the row of open artifacts, and the tab that stands for each.*

# Tab strip (UI)

The row of artifacts a person currently has open. When the row has tabs, one is selected; its content is what the view below shows. Each tab names its artifact; it carries no control of its own.

**Status:** stage-one authority. Stage-one tabs carry no leading icon. The strip sits in the navbar ([ui/app/top-bar/index.md](../top-bar/index.md)).

The reference frames in this directory are the visual authority ([spec-ui.md](../../../spec-ui.md)). The strip is [tab-strip.frame](./tab-strip.frame) — a `.tab-strip` composing one tab per open artifact, the row and nothing else — and one tab is [tab.frame](./tab.frame). The tab is its own frame because a tab is looked at on its own: its states — rest, hover, and selected — are judged one at a time, and the strip is judged as an arrangement of them.

Styling that exists only while a drag gesture is in flight is deliberately left to the implementation: the frames do not state it. Drag behavior is governed by the prose of this spec. ^tb-gesture-styling-carve-out

## The strip

- Tabs run from the left and stop. They do not divide the available width, so a strip holding two tabs looks like two tabs rather than two halves.
- **A tab hugs its label, between a floor and a ceiling.** Its width is the text's, up to the upper bound in [tab.frame](./tab.frame), past which the label clips and fades. Under pressure a tab compresses to the floor ([measures.yml#tab.floor_px](./measures.yml#tab.floor_px)) before the strip overflows, and the floor applies only to labels that reach it; a short tab is its own floor, never padded out. Compression must save more than the authored slack ([measures.yml#tab.floor_slack_px](./measures.yml#tab.floor_slack_px)). The implementation classifies capped and hugging cases from the label's untruncated text according to those measures. Capped tabs take the fixed floor and hugging tabs take `max-content` from [tab.frame](./tab.frame). Classification runs when the rendered label list changes and when fonts settle or finish loading; it never measures the clipped label box and never observes a tab's resulting size. ^tb-tab-bounds
- **Past compression the strip scrolls within its band.** The [navbar layout](../top-bar/index.md#layout) supplies the available band, leaving its clear drag bands outside the scrollport. The first tab retains its resting inset at the start of the scroll range. Each edge fades while more tabs remain past it; each fade disappears at that end of the scroll range. There is no divider. The fade distance is [measures.yml#overflow.fade_px](./measures.yml#overflow.fade_px). The fade preserves the background blur of the tabs. ^tb-strip-scrolls
- **Selected-tab centring moves with the stage.** Selecting a tab scrolls it toward the band's centre, stopping where the scroll runs out — moving through many tabs keeps the neighbours in view. The scroll runs over the crossing duration ([ui/app/stage/measures.yml#crossing.duration_ms](../stage/measures.yml#crossing.duration_ms)) on CSS's `ease` curve, so the tab and its page cross together. When the user's system requests reduced motion (`prefers-reduced-motion: reduce`), the selected tab centres instantly instead of sliding over the crossing duration. ^tb-selected-centres

## The tab

- A tab is a pill holding nothing but its label. Pressing anywhere along the tab selects it — the whole pill is one target.
- Labels that exceed the available width fade at the right edge. Fitting labels remain fully visible.
- Apply the fade only to the label, retaining the complete text and accessible name. The fade distance is defined in [tab.frame](./tab.frame).
- A tab's markup and styling — the tab role, how selection is marked, its shape, its hover, the selected lift — are bound by [tab.frame](./tab.frame).

## Interaction

Pointer and keyboard behavior here inherits the shell's desktop-only input boundary ([ui/app/index.md#^ap-desktop-input-scope](../index.md#^ap-desktop-input-scope)); no touch gesture is implied.

- When the strip has tabs, exactly one is selected; when a press selects — on release, never mid-drag — is specified in [ui/app/stage/index.md](../stage/index.md), Selection.
- When it has tabs, the strip is a single stop in the tab order. Reaching it moves focus to the selected tab, and the Tab key leaves the strip rather than walking it. Unmodified Left and Right leave focus and selection on that tab. Arrow-key page selection uses the application [navigation chord](../../../product/keyboard-navigation.md#^tp-chord), including while a tab holds focus; a successful move releases DOM focus under that chord's app-wide rule. A strip holding many artifacts therefore costs one key to pass, not one per tab.
- Dragging a tab reorders the channel — the gesture, and the pages moving with it, are specified in [ui/app/stage/index.md](../stage/index.md), Reordering; the shape and tint of the placeholder are stated by [tab-placeholder.frame](./tab-placeholder.frame).

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must cover an empty strip, one tab, several tabs with a middle selection, and a carried tab. Each page must produce one element with the tab role. The tabs must follow page order. Each tab must contain its complete label and no icon or child control. A nonempty strip must mark exactly one tab as selected through `aria-selected`. It must give `tabindex="0"` only to that tab. No tab may also expose selection as `aria-pressed`. A carried tab must have one `aria-hidden` placeholder immediately before it.

Real-browser coverage in Chromium and Firefox must use labels whose untruncated widths fall below and above the sum of the authored compression floor and slack. It must show that capped tabs take the compression floor and truncate. It must show that hugging tabs take `max-content` from [tab.frame](./tab.frame) and do not truncate. It must show that neither classification receives an inline minimum width. Once fonts have settled, each tab's classification, width, and truncation state must remain stable across successive frames. The classification for each tab must not be written repeatedly during those frames.

Real-browser coverage in Chromium and Firefox must verify that the label fade updates when the title, available width or font metrics change. Exercise transitions from fitting to overflowing and back, including font loading. Check selected, unselected and hover states in light and dark appearance. The complete label text and accessible name must remain intact.

Overflow integration is specified and tested under [overflow-fade architecture](../../../arch/ui/overflow-fade.md#tab-strip-integration).

When selection changes in a real browser, the strip's centring motion must run for the authored crossing duration and complete. It must not jump directly to the ending position. An interior selected tab must finish centred with both neighbours visible. The first and last tabs must stop at their respective scroll limits. Each settled position must hold after the motion completes.

Real-browser keyboard coverage must show that tabbing into the strip focuses its selected tab. It must show that unmodified Left and Right leave selection and focus unchanged and invoke no page-selection operation. It must show that the next Tab leaves the strip without visiting its remaining tabs.

Real-browser tab-drag coverage must hold a tab at each outer edge. It must show the strip scrolling in the corresponding direction until reorder slots that are out of sight become reachable. At each edge, the scrolling rate must start at the authored maximum. It must taper to zero at the edge zone's inner boundary. Scrolling must stop when the pointer leaves that zone or the drag ends. When the tabs fit, the same hold must emit no scroll and leave the strip position unchanged.

If a drag begins while selected-tab centring is in progress, the centring motion must stop before edge scrolling takes over. Font settlement during a held drag must leave the strip position unchanged. It must not trigger centring after release. If the selected artifact changes during a held drag, centring for that artifact must wait until release. It must then take priority over the strip position produced by edge scrolling. After release, a delayed strip resize must preserve the strip's position at release only when the drag actually scrolled the strip. After a drag with no edge movement, the resize must centre the selected tab.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [stage testing](../stage/index.md#Testing) owns the distinction between a release and a drag, the coupled movement of tabs and pages, and the reorder operation. [Tab-page acceptance](../../../product/tab-pages.md#Testing) owns title changes, private selection, and the shared order across real application documents and the server. Those tests prove the application-state and transport outcomes after the tab strip requests a page selection or reorder. This surface's suite does not repeat those outcomes.

Under the same rule, [keyboard-navigation architecture](../../../arch/ui/keyboard-navigation.md#Testing) owns the proof that pointer input and the application navigation chord enter the same page-selection operation. [Keyboard-navigation product acceptance](../../../product/keyboard-navigation.md#Testing) owns chord navigation from a focused tab. This surface owns the strip's unmodified Left and Right behavior and does not repeat the application chord. The [navbar's strip-centring decision](../top-bar/index.md#^tp-strip-centres) defines the strip's position and available band. This surface tests behavior within that band. It does not test the bar's stage centring or collision geometry.

Under [Test shapes and the declaration schema](../../../arch/testing-policy.md#Test shapes and the declaration schema), this surface requires no seam or acceptance test. It owns no independent transport, persistence, or native boundary.


Selected tabs use the shared panel edge paints. Their transparent one-pixel border reserves geometry, component border overrides remain ordinary borders, and keyboard focus uses `--outline-focus`.
