*UI spec: the system modal — the app's interrupting surface: one dialog, its contents by state.*

# System modal (UI)

The app's interrupting surface, shown as a dialog ([ui/app/dialog/index.md](../dialog/index.md)): one surface, displaying different contents by state. Its states so far: the connection interstitial — never yet connected, and connection lost — authorization, the failed first connect, and the desktop upgrade gate. The app composes it and passes the state ([ui/app/index.md](../index.md)).

**Status:** implemented stage-one authority for the connection, authorization, error, and upgrade states.

The native text field uses [foundation input styling](../../foundation/input/index.md); this surface owns its placement and interaction.

## Markup and styling

- [ui/app/system-modal/system-modal.frame](./system-modal.frame) — the dialog with the state's contents: the connection states' spinner, title and reattempt line; the unauthorized form; the error panel; and the needs-upgrade routing to the gate's surface.
- [ui/app/system-modal/content.yml](./content.yml) — the copy.

## States

- **Connecting** — never yet connected: the spinner and **Connecting**. There is no last state to show; the app renders no shell until first connect ([ui/app/index.md](../index.md)).
- **Disconnected** — the connection lost: the spinner, **Disconnected**, and the reattempt line.
- The reattempt line counts down the seconds to the next attempt — `seconds` renders one moment of it — and says **Reattempting now…** while an attempt is in flight.
- **Unauthorized** — the server requires an access token: the locked icon, **Enter access token**, a line of copy, the token field, and **Connect**. With `invalid` — a submitted token was rejected — the field carries the error tint and an alert line says so. Submitting the entered token is the surface's one interaction. An empty or whitespace-only entry is not submitted. A rejected token clears the field.
- **Error** — the first connect failed outright (a bad address, an unreachable server): **Can't connect with server**, the server's address, and the failure's own message. An app panel and nothing more, for now. The failure is not a stopping point: the connect attempts continue behind this state with their usual backoff, and a success leaves it for the app on its own.
- **Needs upgrade** — the desktop app is gated: the upgrade instructions and, when the app has downloaded its update, the restart button. The state routes to the gate's own surface ([ui/app/desktop-upgrade-gate/index.md](../desktop-upgrade-gate/index.md)), which brings its interior with it.

## Appearance

- The interior: the icon over the title where a state carries one, the supporting line beneath, all centred, at a fixed width that gives way only when the window is narrower ([ui/app/system-modal/system-modal.frame](./system-modal.frame) states the measure); height follows the contents.
- Whether the screen shows behind the modal is semantic. A state interrupting the current session — a dropped connection — **dims** it: the shell is still yours, held behind the backdrop. An app-level or before-load state **hides** it: the modal stands over no chrome, on the bare ground. Disconnected dims; connecting, unauthorized, error and needs-upgrade hide — there is no session yet. The backdrop itself is the dialog's ([ui/app/dialog/index.md](../dialog/index.md)). Hiding is compositional, not visual: a hiding state's shell is not rendered at all, so nothing exists behind the backdrop to leak through — which is why the upgrade gate needs no opaque floor of its own. That guarantee holds exactly as long as "hidden" means not mounted.

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must cover `connecting`, `error`, and `needs-upgrade`. It must cover `disconnected` with a numbered reattempt and with an attempt in flight. It must cover `unauthorized` before submission and after rejection. Each case must render only its selected interrupting surface. The connection cases must show their spinner, title, and applicable reattempt line. The error case must show the server address and supplied failure message. The `needs-upgrade` case must pass the supplied upgrade instructions and restart state to the desktop-upgrade-gate surface. It must not wrap that surface in the standard system-modal interior.

Coverage of `unauthorized` must show the locked icon, supporting copy, labeled required password field, and Connect button. Submitting an empty or whitespace-only entry must invoke no authentication. A nonblank token must have its surrounding whitespace removed and be submitted once. When the application reports that it rejected the token, the field must clear and the rejection alert must appear. A replacement token must remain submittable.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite makes no claim about panel dimensions, centring, responsive width, typography, tint, or the appearance of the backdrop.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [app-shell testing](../index.md#Testing) owns selection and precedence among interrupting states and whether the shell remains mounted behind the backdrop. The [channel-state connection lifecycle](../../../arch/channel-state/index.md#Code-governed carve-out) owns retry timing, authentication against a real server, and leaving the error or unauthorized state after a successful connection. This surface's suite does not repeat those application and server outcomes.

Under the same rule, the [desktop upgrade gate](../desktop-upgrade-gate/index.md#Testing) owns its interior, markdown, controls, non-dismissal rule, and scrolling. This surface owns only routing `needs-upgrade` to it. The [dialog](../dialog/index.md#Behaviour) owns generic modal presentation, focus containment, background inertness, and ordinary dismissal. The icon element owns the spinner's [glyph](../../foundation/icons/index.md#Markup) and [motion](../../foundation/icons/index.md#Spinning). This surface's suite must request the authored icons and the spinner's spinning state. It does not repeat the behaviors owned by the upgrade gate, dialog, or icon element.

