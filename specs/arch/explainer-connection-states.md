*Explainer: what a person sees while Television can't use its server — the desktop setup screen, the connection dialogs in the browser and the desktop app, and the rules that choose between them.*

# Connecting and the connection dialogs

People reach Television with a connect link, in a browser or in the Mac desktop app. While Television can't use its server — before it connects, after the connection drops, when the server can't be reached, when it wants an access token, or when it requires a newer desktop app — the person sees one of a small set of screens. This account follows those screens from first launch to recovery in one place.

## How to read this

This is a derived *explainer* under [spec policy](../spec-policy.md#^explainer-type). It brings together rules owned by the linked specs; those specs remain authoritative and win if this account conflicts with them.

## Where the screens appear

The screens appear in three places:

- **The server's interface in a browser.** The web client the server delivers.
- **The server's interface in the desktop app.** The same web client, loaded into the desktop window. It has no address bar and no way to disconnect the app; the Television menu does that.
- **The desktop app's local page.** A page packaged in the app, which shows the [setup screen](../ui/setup/index.md) and the dialogs for starting a saved connection. It always wears the Clouds theme ([connection flow](./desktop/connect-flow.md#^desktop-local-page)).

## The screens

- **Setup screen** — the desktop app's connect screen when no connection is saved: a prompt for the person's agent and a field for the [connect link](../product/cli.md#^cli-connect-link) it returns ([setup screen](../ui/setup/index.md)).
- **Connecting** — the app has not connected yet.
- **Disconnected** — a working connection dropped and the app is reconnecting.
- **Can't connect with server** — the server can't be reached; the app keeps trying.
- **Access token required** — the server wants a token or rejected the one it was given; the app waits for the person.
- **Upgrade gate** — the server requires a newer desktop app ([gate](../ui/app/desktop-upgrade-gate/index.md)).

The last five are states of the [system modal](../ui/app/system-modal/index.md), which owns what each shows in each place.

## First launch of the desktop app

With no saved connection, the local page shows the setup screen. The person pastes the link their agent gave them and presses Connect. If the app's connect check passes, it saves the connection and loads the server's interface. If the check fails, for any reason, the setup screen shows the failure under the field and no dialog appears; a token problem is explained in terms of the link ([connection flow](./desktop/connect-flow.md#^desktop-connect-entry)). A server that needs a newer desktop app is not a failure here: the connection is saved, the interface loads, and it shows the upgrade gate.

## Starting the desktop app with a saved connection

The local page never shows the setup screen while a connection is saved. It shows Connecting and checks the connection. If the server answers that the token is wrong, it shows Access token required and stops trying. If the server can't be reached, it shows Can't connect with server and keeps trying until it can. On the local page both dialogs carry a Disconnect from Server button ([connection flow](./desktop/connect-flow.md#^desktop-connect-entry)).

## Inside the server's interface

In a browser, and in the desktop app once the interface has loaded, the [app shell's rules](../ui/app/index.md#^ap-connection-states) choose the state:

1. A definite answer from the server shows its own state at once: Access token required, or the upgrade gate. Disconnected and Can't connect with server never stand in for one. Once the gate shows, it stays until the page reloads.
2. A first connection that can't reach the server shows Can't connect with server.
3. A dropped connection shows Disconnected, and after three attempts in a row fail to reach the server, Can't connect with server ([escalation](../ui/app/index.md#^ap-reconnect-escalation)).
4. Disconnected and Can't connect with server keep trying and close by themselves on success. Access token required waits: in a browser the person opens a current connect link, and in the desktop app they use Disconnect from Server.
5. After a drop, the interface and its open artifacts stay rendered behind the dialog and resume without reloading. Before the first connection, and behind Access token required and the gate, nothing is rendered.

If the server's interface fails to load in the desktop app, the window returns to the local page, which starts the saved connection again ([load recovery](./desktop/connect-flow.md#^desktop-connect-load-recovery)).

## Leaving a server

Disconnect from Server forgets the saved connection and returns to the setup screen. The Television menu always lists it, enabled while a connection is saved, and it works in every state, including the upgrade gate ([Disconnect from Server](./desktop/connect-flow.md#^desktop-disconnect-server)). On the local page, Access token required and Can't connect with server also offer it as a button; the server's interface can't disconnect the app, so its wording points to the menu.

## Moving the window

The desktop window has no title bar, so the rendered shell's own areas, such as the channel sidebar's titlebar and the navbar, are its drag handle. Where a dialog shows with no shell behind it, on the local page or in the server's interface, a 36px strip across the top of the window moves the window instead; the setup screen drags by its background ([system modal](../ui/app/system-modal/index.md#Interaction), [setup screen](../ui/setup/index.md#Interaction)).

## No dismissal

None of these dialogs closes on Escape or a backdrop press. Each changes or leaves only when the connection state changes ([system modal](../ui/app/system-modal/index.md#Interaction)).
