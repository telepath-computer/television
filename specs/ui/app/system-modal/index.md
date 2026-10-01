*UI spec: the system modal — the dialog that interrupts Television while it cannot use a server, its contents by state.*

# System modal (UI)

The system modal is the dialog a person sees while Television can't use its server: while it connects, after the connection drops, when the server can't be reached, when it wants an access token, and when it requires a newer desktop app. It is one surface showing different contents by state, composed on the [dialog](../dialog/index.md). Which state shows, and when, is the [app shell](../index.md#Connection states)'s for the server's interface and the [desktop connection flow](../../../arch/desktop/connect-flow.md#^desktop-connect-entry)'s for the desktop app's local page. The [connection states explainer](../../../arch/explainer-connection-states.md) follows all of it from first launch to recovery.

## Markup and styling

- [ui/app/system-modal/system-modal.frame](./system-modal.frame) — the dialog in each state and place, and the desktop window's drag strip.
- [ui/app/system-modal/content.yml](./content.yml) — the copy.

The dialog shows in three places, which the frame's `context` parameter names: the server's interface in a browser (`browser`), the server's interface in the desktop app (`desktop`), and the desktop app's local page (`local`, which always wears the Clouds theme, [arch/desktop/connect-flow.md](../../../arch/desktop/connect-flow.md#^desktop-local-page)). In the server's interface the dialog wears the server's theme.

## States

- **Connecting** — before the first connection has been made: a spinning icon and **Connecting**.
- **Disconnected** — a working connection has dropped: a spinning icon, **Disconnected**, and the reconnect line. The reconnect line counts down the seconds to the next attempt and, while an attempt is under way, says **Reconnecting now…**.
- **Access token required** — the server has asked for a token or rejected the one it was given: a lock icon, **Access token required**, and one line saying what to do, which differs by place. In a browser it says to paste the whole link from the agent into the address bar. In the server's interface in the desktop app it says to choose Television › Disconnect from Server. On the local page it says to disconnect and paste the current link, and the dialog carries a **Disconnect from Server** button.
- **Can't connect with server** — the server cannot be reached: **Can't connect with server**, the server's address, a line asking the person to check their internet connection and that the server is running, and the reconnect line. On the local page the dialog also carries a **Disconnect from Server** button.
- **Needs upgrade** — the server requires a newer desktop app: the [desktop upgrade gate](../desktop-upgrade-gate/index.md)'s surface, which brings its own interior.

## Interaction

- No state is dismissed by Escape or a backdrop press. The dialog changes or leaves only when the connection state changes.
- **Disconnect from Server** is a destructive button. Pressing it hands the disconnect to the desktop app ([arch/desktop/connect-flow.md](../../../arch/desktop/connect-flow.md#^desktop-disconnect-server)).
- The desktop window has no title bar. In the desktop app, where the dialog shows with no shell behind it to drag the window by, a 36px strip across the top of the window moves the window: on the local page, and in the server's interface while no shell is rendered. Over a rendered shell, the shell's own drag areas remain the handle, as they are with the channel sidebar collapsed.

## Appearance

The interior is centred: the icon over the title where the state has one, the supporting lines beneath, and the button, if any, last, at a fixed width that gives way only when the window is narrower ([system-modal.frame](./system-modal.frame) states the measure). Whether the interface shows dimmed behind the dialog is the [app shell](../index.md#Connection states)'s.
