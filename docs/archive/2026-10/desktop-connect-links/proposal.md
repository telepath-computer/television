> **Archived 2026-10 from PR #9.** This proposal established the connect-link workflow delivered by the contribution. It preserves the combined product intent and the reasons for departing from prerelease PR #387, which the final diff and individual specs do not explain together. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Proposal: connect links, the desktop setup screen, and `tv links`

Working document. Not authority. It states the intended behavior and presentation of the change; the specs it leads to are the authority once written. Implementation is out of scope here.

Reference material: Rupert's pull request #387 in `telepath-computer/television-prerelease-archive` (branch `feat/new-onboarding`, head `1fedba8`). Its design material — the markup, styling and copy files for the setup screen, the system modal, and the controls they use — supplies the detailed design when the specs are written; this proposal names where it departs from that design. Everything else in that pull request's specs is not imported: the specs are written fresh from this proposal.

## Summary

People connect to Television with one thing: a *connect link*. A connect link is the address of their Television server with the access token in it, such as `http://100.101.102.103:32848/?token=…`. On a server that runs without a token, the connect link is the plain address. The same link works in a browser and in the Mac desktop app. Nobody types or pastes a bare token anywhere in the product.

The change has six parts:

1. The Mac desktop app opens on a setup screen with one field for a connect link, in place of the two-field form for an address and a token.
2. The desktop app reconnects a saved connection by itself, and offers **Disconnect from Server** to forget it.
3. The connection dialogs follow one consistent set of rules ([Connection states](#connection-states)): a definite answer from the server shows its own state at once, an outage escalates from Disconnected to Can't connect with server, and no dialog asks for a token.
4. A browser's placeholder for an external web page says the desktop app is currently Mac-only.
5. A new command, `tv links`, prints the running server's connect links. The CLI prints links as terminal hyperlinks only in an interactive terminal.
6. The administrator guide gives users connect links only. A Mac user who starts from the app's connect screen already has the app; another Mac user is recommended it; users on other computers are not told about it.

## Differences from Rupert's PR #387

For orientation: how this proposal differs from what PR #387 specified or planned. Everything not listed here (the setup screen's visual design, the system modal's look, the large controls, Clouds on the local page, Disconnect from Server and its ⌘, shortcut, the three-failure escalation, dialogs that cannot be dismissed, and accepting that 1.4.x apps see a menu name they lack) is carried over as PR #387 had it.

**How the specs are produced**

- The specs are written fresh from this proposal. Only PR #387's visual design (markup, styling and the workshop frames) is imported; none of its product, architecture or UI prose, or its testing directives.
- Testing sections keep only guidance a proof could not derive from the spec itself.

**Setup screen**

- No step tracking. Both steps are always at full strength, with filled numbered markers; nothing is faded, highlighted as current, or checked off. PR #387 faded step 2 until the person pressed Copy or moved into it, then checked off step 1. The screen's states are ready, connecting, connected and error.
- The prompt is "Read the Television admin guide at https://television.run/install.md and help me get Television installed. I'm on the desktop app connect screen." The last sentence is how the agent knows the person is on a Mac with the app open.
- The card is styled like an artifact frame but is not one: no artifact view, no iframe or webview, no artifact bridge.
- The two token failure messages are reworded to talk about the link, with the wording left to the implementer.

**Connection states**

- One consolidated rule set ([Connection states](#connection-states)). A definite answer from the server (a token is required or rejected, or an upgrade is required) shows its own state at once, anywhere in the life cycle.
- A desktop app starting with a saved connection whose token is rejected shows **Access token required**, not Can't connect with server as in PR #387. It stops retrying, and on the local page it carries a Disconnect from Server button with its own wording.
- Only attempts that cannot reach the server count toward the three failed reconnects.
- Disconnect from Server is promised to keep working on the upgrade gate screen. PR #387 deleted the earlier promise that the menu stays usable there.
- A 36px window drag strip appears wherever a connection dialog or the upgrade gate shows without the sidebar's drag handle. PR #387 left this open.
- How the local page matches the web app's design is left to the implementer. PR #387 planned to import the web app's dialog code into the local page.

**Admin guide**

- The guide gives users **connect links** only, named that way throughout. No bare token, no token field, no password-manager advice; users ask their agent for the link again. PR #387 planned to keep the bare token as a fallback.
- Mac-first flows: a request from the desktop app's connect screen gets a connect link to paste, with no download instructions; another Mac user is recommended the app; users on other computers are never told about it, and are told it is Mac-only only if they ask.
- The guide teaches `tv links` and reminds users they can always get their links again.

**CLI and browser**

- New command `tv links`, printing the running server's connect links, one per line. PR #387 had no CLI change.
- Links the CLI prints are terminal hyperlinks only when output goes to an interactive terminal, so agents always receive plain URLs. This also changes `tv serve` startup output.
- The browser's placeholder for external web pages says the desktop app is currently available only for Macs.

## Connect links

- A connect link is the server's address followed by `/?token=<token>` when the server requires a token, and the bare address when it does not.
- Opening a connect link in a browser signs that browser in and leaves the plain address in the address bar, as Television does today.
- Pasting a connect link into the desktop app's setup screen connects the app and saves the connection.
- A server listening on several addresses (for example localhost and a Tailscale address) has one connect link per address. The user needs the one that works from the computer they view Television on.

## Desktop app

### The setup screen

The app shows the setup screen when it has no saved connection: at first launch, and after Disconnect from Server.

What the user sees:

- The Clouds theme's wallpaper, blurred, filling the window, with a centred card styled like a Television artifact frame. The title bar shows the Television icon and **Connect to Television**, with no menu or navigation.
- The screen always wears the Clouds theme, whatever theme the server uses, as does everything else on the desktop app's local page ([Connection states](#connection-states)). It is light or dark as the desktop window currently is: the Mac's setting at first launch, and afterwards the appearance the last connected server set, which the app keeps after disconnecting.
- A heading, **Let's connect your [Television logo] Television**, with the logo inline at text height, and under it: "Television runs alongside your AI agent. Ask your agent to help you get connected, then paste the link it gives you."
- Two numbered steps, joined by a line down the left:
  1. **Give your agent this prompt**, with the prompt in monospace on a slightly tilted card and a **Copy** button beside it.
  2. **Paste the link from your agent**, with a link field ("Paste link here") and a **Connect** button. Under the field, a hint shows the shape of the link: "The link looks like `http://…:32848/?token=…`". The screen says "link" rather than "connect link"; on a screen that is only about connecting, the shorter word is clear.

Both steps are always shown equally, at full strength, with plain numbered markers. Neither step is highlighted as current, neither is faded, and no step turns into a check mark. The numbering tells the user the usual order; nothing enforces it or tracks it. The user can paste into the field and connect without pressing Copy, so someone who already has a connect link goes straight to step 2.

This is the main departure from Rupert's design. His screen tracked the current step: it faded step 2 until the user pressed Copy or moved into step 2, then highlighted step 2 and checked off step 1. The faded field still worked, but it looked unusable, implying that copying the prompt was the only way forward. Showing both steps at full strength makes clear that the field is ready, and it removes the step tracking and the tests it would need.

The prompt tells the agent that the user is on the desktop app's connect screen, so the agent knows the user is on a Mac with the app installed and waiting for a connect link. The prompt is:

> Read the Television admin guide at https://television.run/install.md and help me get Television installed. I'm on the desktop app connect screen.

Behavior:

- **Copy** copies the prompt and briefly confirms, as Television's copy button does everywhere. Pressing it changes nothing else on the screen. A single click on the prompt text selects all of it.
- **Connect**, or Return in the field, starts connecting when the field is not empty. The field accepts a connect link, a bare address, or a host and port; an address with no token connects to a server that runs without one.
- While connecting, the field and button are disabled and the button shows a spinner and **Connecting…**.
- On success, the steps fade out and a green circled check with **Connected** appears in their place, at the card's size, and the app then loads the server's interface. The connection is saved only after it succeeds.
- On failure, the screen stays as it was, the field keeps the link and can be edited, and the field is marked invalid with the failure message in place of the hint. Failure messages follow today's connect check (for example "Couldn't reach … is the server running?"), with the two token messages ("This server requires a token", "Token rejected") reworded to talk about the link, for example that the person needs the current link from their agent. The exact wording is left to whoever implements it.
- Dragging the blurred background moves the window. The card does not move the window.

Presentation details carried from Rupert's design: 16px reading text, a 640px card, 40px-tall field and Connect button (a new large control size, below), and a Copy button at the standard button size.

### Starting with a saved connection

With a saved connection, the app never shows the setup screen. It shows the **Connecting** dialog on its local page and connects automatically. What follows is set out in [Connection states](#connection-states).

### Disconnect from Server

- The Television application menu's connection item is **Disconnect from Server**, with the keyboard shortcut ⌘,.
- It is always listed, greyed out when no connection is saved, and available as soon as one is.
- It works in every state, including while the app shows the upgrade gate, so a person can always leave a server they cannot use.
- Choosing it, from the menu or from a Disconnect from Server button ([Connection states](#connection-states)), forgets the saved connection without asking for confirmation and shows the setup screen.
- Desktop apps installed before this change keep their "Connect to server…" menu item. On those apps, the desktop wording below names a command the app lacks. This is accepted so current apps get the exact instruction.

## Connection states

This section is the single statement of what a person sees while Television can't use its server, in a browser and in the desktop app: while it connects, after the connection drops, when the server can't be reached, when it wants an access token, and when it requires a newer desktop app.

### Where they appear

Connection dialogs appear in two places:

- **The server's interface**: the web app the server delivers, in a browser or loaded into the desktop app's window.
- **The desktop app's local page**: the page packaged inside the desktop app, which shows the setup screen and, while a saved connection is starting, the connection dialogs. It always wears the Clouds theme, whatever theme the server uses, light or dark as the desktop window currently is ([The setup screen](#the-setup-screen)).

### The states

| State                         | When                                                                     | What it shows                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connecting**                | Before the first connection has been made.                               | A spinning icon and **Connecting**.                                                                                                                                       |
| **Disconnected**              | A working connection has dropped.                                        | A spinning icon, **Disconnected**, and the countdown line: "Reconnecting in Ns…", or "Reconnecting now…" while an attempt is under way.                                   |
| **Can't connect with server** | The server cannot be reached ([rules](#the-rules) 2 and 3).              | **Can't connect with server**, with no icon; the server's address in monospace; "Check your internet connection and that the server is running."; and the countdown line. |
| **Access token required**     | The server has asked for a token or rejected the one it got.             | A lock icon, **Access token required**, and one line of text, with no field (wording below).                                                                              |
| **Upgrade gate**              | The server requires a newer desktop app than this one. Desktop app only. | The existing upgrade gate screen, unchanged.                                                                                                                              |

The dialogs keep their present layout: centred, 400px wide, an icon above the title where the state has one.

Access token required wording:

- In a browser: "This server requires a valid access token to connect. Ask your agent for the current link, and paste the whole link into the address bar."
- In the server's interface in the desktop app: "This server requires a valid access token to connect. Choose Television › Disconnect from Server, then try again."
- On the desktop app's local page, which has a Disconnect from Server button (rule 7): wording that points to the button and to pasting the current link. Draft: "This server requires a valid access token to connect. Disconnect from Server, then paste the current link from your agent."

### The rules

1. **A definite answer from the server shows its own state at once.** When the server asks for a token or rejects the one it got, the app shows Access token required. When the server requires a newer desktop app, the app shows the upgrade gate. This holds wherever the app is in its life cycle: the first connection, a desktop app starting with a saved connection, or a reconnect after a drop, including while Disconnected or Can't connect with server is showing. Disconnected and Can't connect with server never stand in for a definite answer. Once the upgrade gate shows, it stays until the app reloads; nothing replaces or covers it, not even a later rejected token, as today.
2. **When the server cannot be reached on the first connection,** the app shows Can't connect with server. A desktop app starting with a saved connection shows it on its local page.
3. **When a working connection drops,** the app shows Disconnected. After three reconnect attempts in a row fail to reach the server, Disconnected turns into Can't connect with server. Only attempts that cannot reach the server count; a definite answer follows rule 1.
4. **Disconnected and Can't connect with server keep retrying,** with backoff, and close by themselves when an attempt succeeds. **Access token required does not retry**: a rejected token does not fix itself, so it waits for the person to act. The upgrade gate behaves as it does today.
5. **What is behind the dialog.** After a drop, the interface and any open artifacts stay rendered behind Disconnected and Can't connect with server, and resume without reloading when the connection comes back. Before the first connection, nothing is rendered behind the dialog.
6. **No connection dialog closes on Escape or a click on the backdrop.** Each closes only when the connection state changes.
7. **Disconnecting in the desktop app.** The Disconnect from Server menu item works in every state, including the upgrade gate. On the desktop app's local page, Access token required and Can't connect with server also carry a red **Disconnect from Server** button, because that page can disconnect directly. The server's interface has no way to disconnect the app, so its dialogs and the upgrade gate carry no such button, and its desktop wording points to the menu.
8. **If the server's interface fails to load** after the desktop app has connected, the app returns to its local page and connects again exactly as it does at startup.
9. **Moving the window.** The desktop window has no title bar; the rendered interface's own areas, such as the channel sidebar's title bar and the navbar, are its drag handle. Wherever a connection dialog or the upgrade gate shows with no interface rendered behind it — on the local page, and in the server's interface while none is rendered — a 36px strip across the top of the window drags it. Over a rendered interface, including one with its sidebar collapsed, the interface's own drag areas remain the handle. The setup screen instead drags by its whole background ([The setup screen](#the-setup-screen)).

### The setup screen is the exception

The setup screen shows no connection dialogs. A failed attempt from the setup screen, including a missing or rejected token, appears as the screen's own error state under the link field. A server that requires a newer desktop app is not a failure there: the connection succeeds and is saved, the server's interface loads, and it shows the upgrade gate (rule 1).

## External web pages in a browser

A browser cannot show an external web page (a URL artifact), so it shows a placeholder in the artifact's place. The placeholder says that the Television desktop app shows external web pages right inside Television, and that the app is currently available only for Macs. It keeps its pointer to asking an agent to follow the admin guide to install the app. Draft wording:

> Television can't display external web pages directly inside a web browser. The Television desktop app can show them right inside Television; it is currently available only for Macs.
>
> To install the desktop app on a Mac, ask your agent to follow the Television admin guide: https://television.run/install.md

## Shared controls

Buttons and text fields gain a large size, 40px tall with 16px text, used by the setup screen. It becomes available to artifact authors through the shared Television stylesheet, and the copy button gains the ability to use the standard button size.

## `tv links`

`tv links` prints the connect links of the running Television server, one per line, for every address it is listening on.

- Each line is one connect link, with no other text. Links follow the CLI's hyperlink rule below.
- The addresses are the ones the running server is actually listening on, the same addresses `tv serve` reports at startup.
- When the running server requires a token, each link carries it; when it runs without one, each link is the bare address. This follows the running server, not the config file, which the server only reads when it starts. If the server rejects the home's token, the command fails instead of printing links that would not work.
- When the server is not running, the command says so on stderr, prints no links, and exits with status 1.
- It follows the same home and `--port` rules as the other commands that contact the server.

## Links in CLI output

Any link the CLI prints is a terminal hyperlink (OSC 8), with the URL as its visible text, only when the command's output goes to an interactive terminal. When output goes anywhere else, such as a pipe, a file, or an agent's shell tool, the link is printed as plain text. Some tools that capture command output strip escape sequences in a way that removes the link entirely, so an agent running `tv` must always receive the bare URL.

This applies to every link the CLI prints: `tv links`, and the connect links `tv serve` and `tv serve --persist` print at startup ("Open Television:" followed by one link per address).

## Administrator guide

### Connect links only

- The guide calls the link it gives users the *connect link*, consistently, wherever it gives one.
- The guide only ever gives users connect links. It never shows the user a bare token, never asks them to type a token anywhere, and never suggests saving the token in a password manager. When the user needs their link again, they ask their agent for it.
- Every place that gives the user something to connect with gives connect links: first install, the reply after an upgrade that turns authentication on, troubleshooting a rejected token, moving from the npm desktop app, and the "What to tell the user" examples. For an SSH tunnel, the user still gets the `ssh -L` command alongside the connect link.
- The guide teaches agents `tv links` as the way to get the connect links, and the end of setup tells the user they can get their connect links again at any time, by asking their agent or by running `tv links` on the server machine.
- The quick task map gains an entry for giving a user their connect link for an existing installation, including a desktop app user connecting to a server that already runs: check that the user's computer can reach the server, change the network binding if it cannot, then give the connect link.

The agent still reads the token file for its own checks (for example a `curl` health check); those are agent work and never shown to the user.

### Mac and other platforms

The guide recommends the desktop app only to Mac users who do not already have it. A Mac user who starts from the app's connect screen already has it, and there is no app for any other computer.

- "Mac" means an Apple Silicon Mac running macOS 12 or later, the computers the desktop app supports. Intel Macs, Linux and Windows are other platforms.
- **Request from the connect screen.** When the request says the user is on the desktop app connect screen, as the setup screen's prompt does, the user is on a Mac with the app installed and waiting for a connect link. The agent works out how that Mac reaches the server, installs or reconfigures Television to match, and gives the connect link with a short instruction to paste it into the app. It does not tell the user how to download the app.
- **Any other request.** The agent finds out which computer the user will view Television on, as part of the existing conversation about how they reach the server. If it is a Mac, the agent gives the connect link and recommends the desktop app, with where to download it and how to install it; the connect link works in the app and in a browser. This covers a Mac user who went to their agent before installing the app.
- **Other platforms.** The agent gives a connect link to open in a browser and does not bring up a desktop app, including in its notes about external web pages (URL artifacts). If the user asks about the desktop app, for example after seeing the browser's placeholder for an external web page, the agent says it is available only for Macs and that the browser is how they use Television.
- Upgrades keep their present guidance about how the desktop app updates itself, for users who have it.

## How this is specified and built

These are not user-visible behavior, but the specs need to state them.

- **The connect screen gets a UI spec.** Today the desktop connect screen's presentation is left to the code. The setup screen becomes a specified UI surface, with Rupert's design as its markup and styling.
- **The setup card looks like an artifact frame but is not one.** It reuses the artifact frame's look (its chrome and title bar), not its machinery: no artifact view, no iframe or webview, no artifact bridge.
- **The desktop app's local page looks like the web app.** The setup screen and the local page's connection dialogs match the web app's design and use the Clouds theme and its wallpaper, packaged into the desktop app. How the local page achieves that is deliberately left to the implementer, who chooses whatever is simpler and easier to maintain: for example, using the web app's stylesheets with its own markup, importing the web app's dialog code, or splitting that code so the local page imports only what it needs. The specs leave this open as well.
- **Testing sections.** A spec's `## Testing` section holds only the testing guidance a proof could not derive from the spec's own promises. Where a touched spec's Testing section only restates derivable promises, it is deleted. Where it holds guidance a proof could not derive, that guidance is kept and brought in line with this change.

## Out of scope

- How any of this is built, tested or released.
- Publishing the updated guide to `television.run/install.md`, which happens after merge; it has to be live no later than the desktop release that ships the setup screen.
