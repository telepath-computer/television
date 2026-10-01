# Proposal: connect links, the desktop setup screen, and `tv links`

Working document. Not authority. It states the intended behavior and presentation of the change; the specs it leads to are the authority once written. Implementation is out of scope here.

Reference material: Rupert's pull request #387 in `telepath-computer/television-prerelease-archive` (branch `feat/new-onboarding`, head `1fedba8`). Its UI spec files for the setup screen and the system modal supply the detailed design when the specs are written; this proposal names where it departs from them.

## Summary

People connect to Television with one thing: a *connect link*. A connect link is the address of their Television server with the access token in it, such as `http://100.101.102.103:32848/?token=…`. On a server that runs without a token, the connect link is the plain address. The same link works in a browser and in the Mac desktop app. Nobody types or pastes a bare token anywhere in the product.

The change has five parts:

1. The Mac desktop app opens on a setup screen with one field for a connect link, in place of the two-field form for an address and a token.
2. The desktop app reconnects a saved connection by itself, and offers **Disconnect from Server** to forget it.
3. The browser and desktop connection dialogs stop asking for a token, and say what to do instead.
4. A new command, `tv links`, prints the running server's connect links.
5. The administrator guide gives users connect links only. It treats Mac users as already having the desktop app and never mentions the app to anyone else.

## Connect links

- A connect link is the server's address followed by `/?token=<token>` when the server requires a token, and the bare address when it does not.
- Opening a connect link in a browser signs that browser in and leaves the plain address in the address bar, as Television does today.
- Pasting a connect link into the desktop app's setup screen connects the app and saves the connection.
- A server listening on several addresses (for example localhost and a Tailscale address) has one connect link per address. The user needs the one that works from the computer they view Television on.

## Desktop app

### The setup screen

The app shows the setup screen when it has no saved connection: at first launch, and after Disconnect from Server.

What the user sees:

- The Clouds theme's wallpaper, blurred, filling the window, with a centred card drawn as a Television artifact frame. The title bar shows the Television icon and **Connect to Television**, with no menu or navigation.
- A heading, **Let's connect your [Television logo] Television**, with the logo inline at text height, and under it: "Television runs alongside your AI agent. Ask your agent to help you get connected, then paste the link it gives you."
- Two numbered steps, joined by a line down the left:
  1. **Give your agent this prompt**, with the prompt in monospace on a slightly tilted card and a **Copy** button beside it.
  2. **Paste the connect link from your agent**, with a link field ("Paste link here") and a **Connect** button. Under the field, a hint shows the shape of a connect link.

Both steps are always shown equally, at full strength, with plain numbered markers. Neither step is highlighted as current, neither is faded, and no step turns into a check mark. The numbering tells the user the usual order; nothing enforces it or tracks it. The user can paste into the field and connect without pressing Copy, so someone who already has a connect link goes straight to step 2.

This is the main departure from Rupert's design. His screen tracked the current step: it faded step 2 until the user pressed Copy or moved into step 2, then highlighted step 2 and checked off step 1. The faded field still worked, but it looked unusable, implying that copying the prompt was the only way forward. Showing both steps at full strength makes clear that the field is ready, and it removes the step tracking and the tests it would need.

The prompt tells the agent that it comes from the Mac desktop app's setup screen, so the agent knows the user is on a Mac with the app installed and waiting for a connect link. Draft wording:

> Curl https://television.run/install.md and follow the steps to connect the Television desktop app on my Mac. This request comes from the Television Mac app's setup screen.

Behavior:

- **Copy** copies the prompt and briefly confirms, as Television's copy button does everywhere. Pressing it changes nothing else on the screen. A single click on the prompt text selects all of it.
- **Connect**, or Return in the field, starts connecting when the field is not empty. The field accepts a connect link, a bare address, or a host and port; an address with no token connects to a server that runs without one.
- While connecting, the field and button are disabled and the button shows a spinner and **Connecting…**.
- On success, the steps fade out and a green circled check with **Connected** appears in their place, at the card's size, and the app then loads the server's interface. The connection is saved only after it succeeds.
- On failure, the screen stays as it was, the field keeps the link and can be edited, and the field is marked invalid with the failure message in place of the hint. Failure messages follow today's connect check (for example "Couldn't reach … is the server running?"), with the two token messages reworded to talk about the connect link.
- Dragging the blurred background moves the window. The card does not move the window.

Presentation details carried from Rupert's design: 16px reading text, a 640px card, 40px-tall field and Connect button (a new large control size, below), and a Copy button at the standard button size.

### Reconnecting a saved connection

- With a saved connection, the app never shows the setup screen. It shows a **Connecting** dialog over the Clouds background and connects automatically.
- If that fails for any reason, including a token the server no longer accepts, the dialog becomes **Can't connect with server**: the server's address, "Check your internet connection and that the server is running.", a countdown to the next attempt, and a red **Disconnect from Server** button. The app keeps retrying with backoff and loads the interface as soon as an attempt succeeds.
- If the server's interface itself fails to load after the app has connected, the app returns to this Can't connect dialog and keeps retrying.

### Disconnect from Server

- The Television application menu's connection item is **Disconnect from Server**, with the keyboard shortcut ⌘,.
- It is always listed, greyed out when no connection is saved, and available as soon as one is.
- Choosing it, from the menu or from the Can't connect dialog, forgets the saved connection without asking for confirmation and shows the setup screen.

## Connection dialogs in the browser and the desktop app

These dialogs keep their present layout: centred, 400px wide, an icon above the title.

- **Connecting** and **Disconnected** behave as today. The countdown line reads "Reconnecting in Ns…" and, while an attempt is in flight, "Reconnecting now…".
- **Access token required** replaces the token form. It shows a lock icon, the title, and one line of text, with no field or button:
  - in a browser: "This server requires a valid access token to connect. Ask your agent for the current link, and paste the whole link into the address bar."
  - in the desktop app: "This server requires a valid access token to connect. Choose Television › Disconnect from Server, then try again."
- **Can't connect with server** shows the server's address, "Check your internet connection and that the server is running.", and the countdown line. It appears when the first connection fails, and also after three reconnect attempts in a row fail following a drop. In the second case the interface and any open artifacts stay rendered behind it and resume without reloading when the connection comes back. Only the desktop app's own reconnect screen offers Disconnect from Server; the server's interface never does.
- None of these dialogs closes on Escape or a click on the backdrop. Each closes only when the connection state changes.
- Desktop apps installed before this change keep their "Connect to server…" menu item; on those apps, the desktop text above names a command the app lacks. This is accepted so current apps get the exact instruction.

## Shared controls

Buttons and text fields gain a large size, 40px tall with 16px text, used by the setup screen. It becomes available to artifact authors through the shared Television stylesheet, and the copy button gains the ability to use the standard button size.

## `tv links`

`tv links` prints the connect links of the running Television server, one per line, for every address it is listening on.

- Each line is a plain connect link, with no other text and no terminal hyperlink formatting, because users copy these links rather than click them.
- The addresses are the ones the running server is actually listening on, the same addresses `tv serve` reports at startup.
- When the server requires a token, each link carries it. When the server runs without a token, each link is the bare address.
- When the server is not running, the command says so on stderr, prints no links, and exits with status 1.
- It follows the same home and `--port` rules as the other commands that contact the server.

## Administrator guide

### Connect links only

- The guide calls the link it gives users the *connect link*, consistently, wherever it gives one.
- The guide only ever gives users connect links. It never shows the user a bare token, never asks them to type a token anywhere, and never suggests saving the token in a password manager. When the user needs their link again, they ask their agent for it.
- Every place that gives the user something to connect with gives connect links: first install, the reply after an upgrade that turns authentication on, troubleshooting a rejected token, moving from the npm desktop app, and the "What to tell the user" examples. For an SSH tunnel, the user still gets the `ssh -L` command alongside the connect link.
- The guide teaches agents `tv links` as the way to get the connect links, and the end of setup tells the user they can get their connect links again at any time, by asking their agent or by running `tv links` on the server machine.
- The quick task map gains an entry for giving a user their connect link for an existing installation, including a desktop app user connecting to a server that already runs: check that the user's computer can reach the server, change the network binding if it cannot, then give the connect link.

The agent still reads the token file for its own checks (for example a `curl` health check); those are agent work and never shown to the user.

### Mac and other platforms

The guide stops recommending the desktop app. A user either has it, because they are on a Mac and started with it, or there is none for their computer.

- "Mac" means an Apple Silicon Mac running macOS 12 or later, the computers the desktop app supports. Intel Macs, Linux and Windows are other platforms.
- **Request from the setup screen.** When the request says it comes from the Mac app's setup screen, the user is on a Mac with the app installed and waiting for a connect link. The agent works out how that Mac reaches the server, installs or reconfigures Television to match, and gives the connect link with a short instruction to paste it into the app. It does not tell the user how to download the app.
- **Any other request.** The agent finds out which computer the user will view Television on, as part of the existing conversation about how they reach the server. If it is a Mac, the agent gives the connect link and also says where to download the desktop app and how to install it, in case they have not yet. This covers a Mac user who went to their agent before installing the app. *(Open question 1.)*
- **Other platforms.** The agent gives a connect link to open in a browser and does not mention a desktop app at all, including in its notes about external web pages (URL artifacts).
- Upgrades keep their present guidance about how the desktop app updates itself, for users who have it.

## Open questions

1. **Requests that do not come from the setup screen.** Confirm the rule above: the agent finds out which computer the user views Television on, and a Mac user gets the download pointer with the connect link.
2. **The browser placeholder for external web pages.** A browser showing a URL artifact says "You can view external web pages right inside Television with the desktop app" and points to the admin guide, on every computer. That conflicts with never mentioning the app to users on other platforms. Options: leave it (and have the guide tell a non-Mac user who asks that the app is Mac-only), or make the placeholder say the app is for Macs.
3. **Setup screen wording.** The draft prompt above, and using "connect link" on the screen itself (step 2's heading and the hint).

## Out of scope

- How any of this is built, tested or released.
- Changes to `tv serve` startup output, which keeps printing its links as terminal hyperlinks.
- Publishing the updated guide to `television.run/install.md`, which happens after merge; it has to be live no later than the desktop release that ships the setup screen.
