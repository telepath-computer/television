*UI spec: settings — the navbar trigger and popover for the server-wide theme and appearance preference.*

# Settings (UI)

The Settings surface consists of a trigger and its panel in the navbar. It shows the connected server's appearance preference and active installed theme, lets the user grant per-theme consent for main-page theme JavaScript, and lets the user refresh the theme registry. It reports validation errors and failures from reads or writes. This directory owns the surface's markup, interaction, content, and interior styling; the panel is a popover ([ui/foundation/popover/index.md](../../foundation/popover/index.md)).

**Status:** current authority for the settings surface.

The supporting artifacts are:

- [settings.frame](./settings.frame) — trigger, panel, labelled controls, executable-theme disclosure, refresh action, loading and failure status, and validation rows, with the panel's interior layout;
- [content.yml](./content.yml) — fixed labels and status copy.

## Displayed state

Theme options come from valid registry entries, in registry order and shown by display name. The executable-theme section appears only when a completed registry snapshot identifies the active theme as declaring `enableMainJS: true`. Iframe JavaScript declarations do not show consent controls because their scripts run only in opaque-origin sandboxed frames. ^settings-theme-javascript-consent

## Interaction

The first time the panel opens during a connection, it requests the server's current theme registry snapshot. Every later opening makes the same request and replaces the displayed list when the request completes. Refresh asks the server to scan the themes directory again and replaces the list with the completed response. A failed read or refresh retains the last completed snapshot and reports the failure. Refresh is unavailable while a registry request is active or the server is disconnected. When the connection is lost, the view discards its displayed registry. The first opening after reconnect requests a snapshot from the connected server.

Changing appearance, theme, or main-page JavaScript consent sends a write immediately through the application service. Until the server confirms a requested value, the control continues to display the value in the application snapshot. After a failed write, it displays the value in the latest confirmed application snapshot, and the panel shows a readable failure. A `theme-changed` or `appearance-changed` event updates the application snapshot, and an open panel displays the updated value. This includes a selection or consent change made by another connected client and a selection made by `tv set-theme`.

The consent toggle is checked exactly when the active theme ID belongs to the confirmed consent set. Turning it on adds that exact ID; turning it off removes it. A confirmed consent change reevaluates the active theme resources in connected clients. If the current application document has an active main-script include, turning off consent or selecting another theme forces a full application-document reload; otherwise the change applies in place. Settings reopens after that reload when it was open before the reload, and remains closed when it was closed.

The panel uses the foundation popover behaviour. Its trigger toggles it, opening it closes another non-manual popover such as the skill selector, and an outside press or Escape dismisses it. The selects use the separate selection behaviour defined by [ui/foundation/select/index.md](../../foundation/select/index.md). These actions do not reset either confirmed preference.

## Testing

Real-browser acceptance must exercise the production settings view with real pointer and keyboard input through the production `tv-select` and `tv-popover` elements. A running Television server and a temporary themes directory must provide registry and display state through real HTTP and websocket connections. No mock or test hook may replace those paths.

This acceptance must show that the controls change appearance and theme, refresh discovers an added valid package and reports an added malformed folder, and a selection from another authenticated client updates the open control. The same browser boundary covers the conditional main-page JavaScript consent surface, including an iframe-only package, another-client consent updates, a server-side failed write, and one-shot Settings restoration after the product-owned document reset. An outside press and Escape must dismiss the panel without changing any confirmed preference or consent. Opening Settings and the skill selector must preserve the foundation rule in which opening one non-manual popover closes the other.
