*UI spec: the system modal — the app's interrupting surface: one dialog, its contents by state.*

# System modal (UI)

The dialog that interrupts the app while it can't use a server, with its contents chosen by state.

**Status:** implemented stage-one authority for the connection, authorization, error, and upgrade states.

## Markup and styling

- [ui/app/system-modal/system-modal.frame](./system-modal.frame) — the dialog in each of its states.
- [ui/app/system-modal/content.yml](./content.yml) — the copy.

## States

- **Connecting** — the app has not connected yet.
- **Disconnected** — the connection dropped after the app had connected. The reconnect line counts down to the next attempt, then says an attempt is in flight.
- **Unauthorized** — the server requires an access token, and this app has none that the server accepts. The desktop app shows the desktop copy.
- **Error** — the app can't reach the server: the first connection failed, or reconnecting after a drop kept failing ([ui/app/index.md](../index.md#Connection states)). Attempts continue, with the same reconnect line as Disconnected, and a successful one closes the dialog. When the desktop app shows this state before it has loaded the server's page, it also offers Disconnect from Server, which forgets the saved connection ([arch/desktop/connect-flow.md](../../../arch/desktop/connect-flow.md#^desktop-disconnect-server)).
- **Needs upgrade** — the desktop app must be updated before it can use this server. The dialog shows the [desktop upgrade gate](../desktop-upgrade-gate/index.md).

Every state blocks: Escape and a backdrop press leave the dialog presented, and it goes only when the app's state changes.
