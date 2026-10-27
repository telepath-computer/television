*UI spec: the setup screen — the desktop app's connect screen when it has no saved server connection, where a person pastes the link their agent gives them.*

# Setup screen (UI)

The setup screen is what the desktop app shows when it has no saved Television server: at first launch, and after Disconnect from Server. It gives the person a prompt for their agent and a field for the link the agent returns. When and why the app shows it, and what a submitted link does, are the [desktop connection flow](../../arch/desktop/connect-flow.md#^desktop-connect-entry)'s; the [connection states explainer](../../arch/explainer-connection-states.md) follows the whole path.

## Markup and styling

- [setup.frame](./setup.frame) — the screen in each of its states, with its copy and the prompt.

The card wears the [artifact frame](../app/artifact-frame/index.md)'s look, holding the screen's content in place of a document; it is not an artifact frame. The screen wears the [Clouds theme](../themes/clouds/index.md) whatever theme the server uses, light or dark as the desktop window currently is ([arch/desktop/connect-flow.md](../../arch/desktop/connect-flow.md#^desktop-local-page)).

## States

- **ready** — the starting state: the prompt and an empty link field.
- **connecting** — the person has submitted a link and the app is waiting for the server. The field and Connect are disabled, and Connect shows that it is connecting.
- **connected** — the connection succeeded. The steps give way to a check and **Connected** in the same card, before the app loads the server's interface.
- **error** — the attempt failed. The field keeps the link, stays editable, and is marked invalid, with the failure's message under it in place of the hint. The message is the one the connection flow supplies.

## Interaction

- The two numbered steps show the usual order: give an agent the prompt, then paste the link it returns. Both are always shown at full strength and both are always usable. Nothing tracks or enforces the order, so a person who already has a link pastes it straight away.
- Copy copies the prompt and confirms as the [copy button](../app/copy-button/index.md#Interaction) does. It changes nothing else on the screen. One press on the prompt text selects all of it.
- Each agent named in the note under the introduction links to that agent's website. A link opens in the default browser through the desktop app's [external-link handling](../../arch/desktop/index.md#External links), and the setup screen stays as it was.
- Connect, or Return in the field, submits the field when it is not empty.
- Dragging the background around the card moves the window. The card's contents stay interactive and do not move the window.
