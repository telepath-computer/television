*UI spec: the copy button — a control that copies a value and briefly confirms, without resizing.*

# Copy button (UI)

A button that copies a value to the clipboard and briefly confirms the copy in place. It is a reusable control meant to be composed by other surfaces (e.g. [app/update-notification/index.md](../update-notification/index.md), [app/skill-selector/index.md](../skill-selector/index.md)); this directory owns its interaction, markup, and styling ([spec-ui.md](../../../spec-ui.md)).

**Status:** stage-one reusable native-button control authority, implemented by a production lit-html template helper. Skill selector and update notification consume the shared helper.

The supporting artifacts, each authoritative:

- [copy-button.frame](./copy-button.frame) — the button's rendered markup. The native `<button>` classed `copy-button` carries the idle and done content and is followed by its polite status region; `copied` is reflected on the button while confirming. The button keeps the caller's label as its accessible name while the visible content swaps, so the adjacent status supplies the confirmation announcement without also renaming the focused control. Both icons are composed from [ui/foundation/icons/index.md](../../foundation/icons/index.md) rather than named here, so the drawings arrive inline and their styles travel with the rendering. The frame also states the confirm swap: the done content overlays the idle content so the button never resizes, and the announcement stays outside visual layout.
- [content.yml](./content.yml) — the button's own fixed string (the "Copied" confirmation).

The `.frame` is the authoritative rendered truth for this surface.

Conformance of the implementation to these artifacts is automated ([arch/ui/conformance.md](../../../arch/ui/conformance.md)); the assertions below prove the surface's behavior.

## Interaction

- Activating the button copies its `prompt` to the clipboard and briefly swaps the button to a centred check and the "Copied" confirmation, then reverts. It uses `navigator.clipboard.writeText` when available; otherwise it synchronously falls back inside the activation gesture to `document.execCommand("copy")` on a hidden selected textarea, so plain-HTTP Television remains supported. A rejected asynchronous modern write degrades silently and is not retried after the gesture; confirmation is optimistic. ^cb-clipboard-fallback
- A caller may supply an `onActivate` callback. Each activation invokes it exactly once after the clipboard write is attempted. The callback reports activation, not clipboard success; composing surfaces use it for behavior they own, including content-free telemetry. ^cb-activate-callback
- The button does not resize during the swap and its container does not reflow: the idle content keeps reserving its width while the confirmation overlays it.
- The confirmation is announced to assistive technology, so a copy is perceivable without sight.

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must prove the idle and copied states. It must prove that each activation attempts to copy the prompt. When an optional `onActivate` callback is supplied, the suite must prove that each activation invokes the callback exactly once after the copy attempt. The suite must also prove that the caller's label remains the accessible name while the polite status announces the optimistic confirmation. It must prove that the button returns to idle after exactly 1.4 seconds.

When `navigator.clipboard.writeText` is available but rejects, the suite must prove that the rejection is not exposed. It must prove that the `document.execCommand("copy")` fallback is not attempted after the activation gesture. It must also prove that the optimistic confirmation still appears.

Successful clipboard acceptance must activate the production control in a real browser. It must show that the exact prompt reaches the system clipboard through `navigator.clipboard.writeText`. It must also show that the exact prompt reaches the system clipboard through the synchronous `document.execCommand("copy")` fallback when the modern API is unavailable.

Confirmation acceptance must also exercise the production control's real timer in a real browser. It must show that activation enters the copied state and later returns the button to idle.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite does not cover icon alignment, whether the button's width changes, or whether its container reflows while the visible content changes.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), the [skill selector](../skill-selector/index.md#Interaction) and [update notification](../update-notification/index.md#Interaction) own the prompt values they pass. Each of those specs also owns what its `onActivate` callback does. This surface's proof covers copying and confirmation for every caller. Composing surfaces do not repeat those paths.

## Decisions

- The control is a native `<button>` classed `copy-button`: focus, keyboard, and role come for free. Its markup is spec-owned light DOM — the surface, not code, holds the idle/done structure and the swap.
- The idle `label` and the `prompt` are the caller's, passed per use; the "Copied" confirmation is the button's own content. Placement, `intent`, and size are the caller's.
- **The announcement lives beside the button, not inside it** ([TV-599](https://linear.app/telepath-computer/issue/TV-599/copy-button-decide-where-the-copied-announcement-lives)). A status region inside the button would join its name-from-contents computation — the focused control's accessible name would become "…label… Copied" mid-confirmation — and renaming the button itself would change the control's identity under the user. The adjacent visually hidden `role="status"` `aria-live="polite"` region pre-exists in the DOM and announces by text change, while the button keeps the caller's label throughout.
- The "Copied" confirmation shows for **1.4 seconds**, then the button returns to its idle label. The dwell is the button's own behaviour — not a caller parameter — long enough to read, short enough to feel responsive. It is UI ([spec-ui.md](../../../spec-ui.md) motion and interactivity), specified here and verified on the mounted implementation.
- Copy-to-clipboard mechanics are behaviour, likewise specified here and verified on the implementation; the CSS owns only the no-resize swap.
