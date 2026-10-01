*UI spec: the setup screen — the desktop app's connect screen when it has no saved server connection, where a person's agent helps them get connected.*

# Setup screen (UI)

The desktop app shows this screen when it has no saved Television server: at first launch, and after Disconnect from Server ([desktop connection flow](../../arch/desktop/connect-flow.md#^desktop-connect-entry)).

## Markup and styling

- [setup.frame](./setup.frame) — the setup screen in each of its states.

Everything the desktop app shows before it loads a server's page wears the Clouds theme, whatever theme the server uses: this screen, and the connection dialogs the app shows while it reconnects a saved connection ([desktop connection flow](../../arch/desktop/connect-flow.md#^desktop-connect-entry)).

## States

The screen has five possible states:

- **copy** — the starting state: the person has a prompt to give their agent.
- **paste** — the person has moved on to pasting the link their agent gave them.
- **connecting** — the person has submitted a link, and the app is waiting for the server.
- **connected** — the connection succeeded.
- **error** — the connection failed. The screen shows the failure message the [desktop connection flow](../../arch/desktop/connect-flow.md) supplies.

## Interaction

- Copy copies the prompt and confirms as the [copy button](../app/copy-button/index.md#Interaction) does.
- The steps only move forward. Pressing Copy, releasing a press anywhere in step 2, or moving keyboard focus into step 2 makes step 2 current and checks step 1. Once step 2 is current it stays current, and Copy still copies.
- A faded step is still usable, so someone who already has a link can paste it without copying the prompt first.
- Pressing Connect, or Return in the field, starts connecting when the field is not empty.
- Dragging the background around the card moves the window. The card's contents stay interactive and do not move the window.
