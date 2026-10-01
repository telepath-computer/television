*UI spec: the setup screen — the desktop app's connect screen when it has no saved server connection, where a person's agent helps them get connected.*

# Setup screen (UI)

The desktop app shows this screen when it has no saved Television server: at first launch, and after Disconnect from Server ([desktop connection flow](../../arch/desktop/connect-flow.md#^desktop-connect-entry)).

## Markup and styling

- [setup.frame](./setup.frame) — the setup screen in each of its states.

Everything the desktop app shows before it loads a server's page wears the Clouds theme, whatever theme the server uses: this screen, and the connection dialogs the app shows while it reconnects a saved connection ([desktop connection flow](../../arch/desktop/connect-flow.md#^desktop-connect-entry)).

## States

The screen has four possible states:

- **ready** — the starting state: the prompt to give an agent, and an empty link field.
- **connecting** — the person has submitted a link, and the app is waiting for the server.
- **connected** — the connection succeeded.
- **error** — the connection failed. The screen shows the failure message the [desktop connection flow](../../arch/desktop/connect-flow.md) supplies.

## Interaction

- The two numbered steps show the usual order: give an agent the prompt, then paste the link it returns. Both are always shown at full strength and both are always usable; nothing tracks or enforces the order, so someone who already has a link pastes it straight away.
- Copy copies the prompt and confirms as the [copy button](../app/copy-button/index.md#Interaction) does. It changes nothing else on the screen.
- Pressing Connect, or Return in the field, starts connecting when the field is not empty.
- Dragging the background around the card moves the window. The card's contents stay interactive and do not move the window.
