*UI spec: the dialog — the panel that interrupts the screen for an important decision or issue.*

# Dialog (UI)

A panel that obstructs the current screen: a backdrop over everything, with a centred dialog on it. A backdrop press or Escape dismisses the dialog. Pressing inside the panel does not dismiss it unless the activated control closes it; the app's environment may also withdraw it. A dialog is used to interrupt the user for an important decision or issue. Its styling is part of Television's base element vocabulary ([ui/foundation/index.md](../../foundation/index.md), Elements).

**Status:** current stage-one dialog authority. The panel and backdrop are deliberately minimal; styling grows only when a composing surface needs it.

The dialog uses the shared panel edge paints and optional border. Its direct `.dialog-content` child holds the supplied contents and scrolls within the viewport and any explicit dialog height; the native dialog paints the exterior edges without clipping. Keyboard focus indicators belong to its interactive contents.

## Markup and styling

The dialog is [ui/app/dialog/dialog.frame](./dialog.frame): the backdrop filling the window, holding the screen back, the `<dialog open>` panel centred on it holding the composing surface's content, the panel chrome, and the shared dialog format.

## Behaviour

- While a dialog shows, the screen behind it takes no input or focus.
- Anything floating over the screen (an open popover) closes as a dialog enters.
- **Presentation is immediate.** Panel and backdrop enter and leave without a CSS transition, CSS animation, or scripted presentation motion. Confirmed in [TV-582](https://linear.app/telepath-computer/issue/TV-582).

Staging poses appearance only; the mounted implementation enforces these behaviors.

## Appearance

- The backdrop covers the window edge to edge — a flat translucent layer holding the screen back — and the panel sits centred on it.
- A dialog stands over the current screen, or over no chrome at all — the backdrop dimming the app's bare ground when there is nothing to hold back. Which, is the composing surface's to say.
- The panel chrome — background, radius, shared edges and broad shadow — is stated in [foundation popover styles](../../foundation/popover/styles.css); [dialog.frame](./dialog.frame) states the overlay and content layout.
- The panel carries no padding or size of its own — contents' shape belongs to the composing surface, as with the popover.
- **The dialog format** is the vocabulary for an interruption that demands a response — the platform's `alertdialog`: a left-aligned panel at a reading width ([dialog.frame](./dialog.frame) states the measures), the question as the title, the consequence in one line beneath, and an actions row at the end holding Cancel and the action. The composing surface authors the contents; constraining further formats is deferred. The destructive action is never the default: focus rests on Cancel, and the destructive button wears `intent="danger"` ([ui/foundation/button/index.md](../../foundation/button/index.md)).

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must cover the composed dialog: one overlay holding one open native dialog. The supplied content must appear inside the panel exactly once, and the composition must not change it.

Real-browser coverage must present an alert through the browser's native modal mechanism for `<dialog>`. Presenting the alert must close an already-open popover and focus Cancel. Tab movement, programmatic focus, and real pointer input must not reach controls behind the dialog. Pressing a control inside the panel that does not close the dialog must leave the dialog presented. That press must not dismiss the dialog.

Presenting and withdrawing the dialog must happen immediately, with no CSS transition, CSS animation, or scripted presentation motion. While the dialog is presented, a backdrop press must dismiss it once and leave it withdrawn. Pressing Escape must also dismiss it once and leave it withdrawn.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite does not cover the backdrop, centring, dimensions, padding, panel chrome, or destructive colour. Those remain staging and review concerns.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [artifact-frame testing](../../app/artifact-frame/index.md#Testing), [channel deletion](../../app/sidebar/index.md#Deleting), and [system-modal testing](../../app/system-modal/index.md#Testing) own the contents, semantics, controls, and surface-specific actions of their dialog compositions. Those specs also own when their dialogs are presented or withdrawn. This dialog suite owns only rendering the shared panel and overlay, keeping focus and input from reaching controls behind the dialog, dismissing an ordinary dialog after a backdrop press or Escape, distinguishing a press inside the panel from a backdrop press, and closing an open popover when the dialog appears.

Under the same rule, [desktop-upgrade-gate testing](../../app/desktop-upgrade-gate/index.md#Testing) owns the exception in which a backdrop press and Escape leave the gate presented. [Product update acceptance](../../../product/update-notifications.md#Testing) owns the gate's blocking behavior in the real Electron app. This dialog suite does not apply its ordinary dismissal requirement to that gate. It does not repeat the gate's proof.

Under the same rule, [foundation architecture](../../../arch/ui/foundation.md#Testing) owns proof that the authoritative dialog stylesheet reaches a fresh production web build. The dialog suite requires no duplicate test of that delivery.

