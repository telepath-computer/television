*UI spec: the desktop upgrade gate screen — the blocking surface a gated desktop app renders instead of the interface.*

# Desktop upgrade gate (UI)

The upgrade message a halted desktop app shows — one centered, scrollable panel whose content is the selected message — the downloaded-update message, channel-published instructions or the built-in fallback — as markdown pipeline output, placed verbatim, with a restart button under the downloaded-update message. This directory owns the surface's interaction, markup, and styling ([spec-ui.md](../../../spec-ui.md)); the surface fills the window as the system modal's needs-upgrade state ([ui/app/system-modal/index.md](../system-modal/index.md)), whose dialog owns the backdrop. What gating *means* and the gate's promises are owned by [product/update-notifications.md#The desktop upgrade gate](../../../product/update-notifications.md#The desktop upgrade gate); the boot barrier, message selection and restart action by [arch/updates/desktop-upgrade-gate.md](../../../arch/updates/desktop-upgrade-gate.md).

The production implementation is `packages/web/src/views/desktop-upgrade-gate.ts`. It composes the shared native dialog element ([ui/app/dialog/index.md](../dialog/index.md)) and consumes ordinary dismissal intent without withdrawing the blocking surface.

The supporting artifacts, each authoritative:

- [ui/app/desktop-upgrade-gate/desktop-upgrade-gate.frame](./desktop-upgrade-gate.frame) — the surface's rendered markup, whole; its parameters are `body`, the selected message's markdown output, and `restart`, the restart button's state.
- [ui/app/desktop-upgrade-gate/content.yml](./content.yml) — the surface's copy: the downloaded-update message and the built-in fallback instructions (markdown), and the restart button's labels ([arch/updates/desktop-upgrade-gate.md#^gate-instructions](../../../arch/updates/desktop-upgrade-gate.md#^gate-instructions) owns the selection, and [the product](../../../product/update-notifications.md#^gate-instructions-fallback) what each message tells the user). The template imports only the button labels — the selected message arrives as the `body` argument; a stated exception to [spec-ui.md](../../../spec-ui.md)'s imported-content shape.

## Interaction

- The surface offers no dismiss and no copy affordance. It is the blocking exception to the dialog's ordinary Escape and backdrop dismissal: both inputs leave the gate presented.
- Its only control is the restart button, which appears with the downloaded-update message: the primary action, labelled **Restart to update**. Pressing it hands the restart to the gate's owner once ([^gate-restart](../../../arch/updates/desktop-upgrade-gate.md#^gate-restart)); the button then reads **Restarting…** and is disabled until the page unloads. ^gate-ui-restart
- Links in the message are the only other interactive content, with the markdown pipeline's standard external-link behavior.
- The panel scrolls when instructions exceed the viewport; the backdrop never scrolls.

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must prove that channel instructions appear as the dialog's only body. It must also prove that the built-in fallback appears as the dialog's only body. In both cases, the suite must prove that the surface adds no controls, dismissal affordance, or copy affordance. The fallback must contain its authored download link. The downloaded-update message must appear as the dialog's body with one primary restart button labelled **Restart to update** and no other control; restarting, the button must read **Restarting…** and be disabled.

Real-browser acceptance must show that pressing the restart button hands the restart to the owner exactly once. It must show that a backdrop press leaves the native dialog open and modal. It must show that Escape also leaves the native dialog open and modal. When the instructions are longer than the viewport, real-browser acceptance must show that wheel input inside them scrolls the instructions. It must also show that the dialog, backdrop, document, and window stay in place.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite does not cover the panel's measurements or reading width. It does not cover which CSS declarations produce overflow or the local styling of the instruction prose.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [desktop upgrade architecture](../../../arch/updates/desktop-upgrade-gate.md#Testing) owns the choice among the downloaded-update message, channel instructions and the built-in fallback, and what the restart does. It also owns the standard markdown pipeline, including external-link behavior. [Product update acceptance](../../../product/update-notifications.md#Testing) owns the startup barrier in the real Electron app. It also owns which instructions take precedence, whether the gate persists, and whether a relaunch reaches the normal interface. The [system modal](../system-modal/index.md#States) owns routing its `needs-upgrade` state to this surface. The [dialog](../dialog/index.md) owns generic modal presentation, focus containment, background inertness, and ordinary dismissal. Together, these proofs establish which content reaches the gate. They also establish how the app reaches the gate and how it presents the gate. This surface's suite is responsible for proving that a backdrop press and Escape leave the native dialog open and modal. It is also responsible for proving that wheel input inside instructions longer than the viewport scrolls those instructions while the dialog, backdrop, document, and window stay in place.

## Decisions

- No chrome: no fixed heading or fixed text beyond the restart button's labels — whoever authors the message authors the rest of the screen.
- The gate stands over no chrome, on the app's bare ground under the dialog's backdrop — the same look as every hidden state ([ui/app/system-modal/index.md](../system-modal/index.md), Appearance). Nothing renders behind a halted app.
