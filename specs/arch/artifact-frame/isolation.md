*Artifact isolation: the sandbox HTML artifact documents run in, in a browser, and the separate sessions that isolate them in the desktop app; the browser features artifact documents are granted; the cross-origin rules on the routes they load; and the known limitations of each.*

**Status:** adopted architecture authority.

# Artifact isolation (architecture)

**Plain english:** an artifact's page may contain hostile code, written by a third party or by the person's own agent after it read planted instructions. This spec keeps that code away from everything that carries Television's authority, such as the server's token, the app's page and its saved data, and the desktop app's native functions, by running the pages Television serves from artifacts' files in the browser's sandbox; an external web page is kept apart by its own site's origin. The desktop app instead runs artifact pages outside the sandbox, each with storage apart from the app's. It also lists what each arrangement costs artifacts.

## What this owns

This spec owns how artifact documents are isolated from Television: the *sandbox header* and the `sandbox` attribute on artifact iframes, the sessions that isolate artifact webviews in the desktop app and the header's removal there, the browser features artifact documents are granted in each runtime, the cross-origin rules on the routes artifact documents load, and the known limitations. The user-facing promise is [product/artifacts.md#^af-sandbox](../../product/artifacts.md#^af-sandbox), and which files a folder artifact serves is [product/artifacts.md#^af-folder-files](../../product/artifacts.md#^af-folder-files). How the bridge works with sandboxed documents, including the Electron preload's context isolation and the route an application link takes in the desktop app, is [artifact-bridge.md](./artifact-bridge.md). Which senders the desktop main process accepts is [desktop/index.md#^desktop-ipc-senders](../desktop/index.md#^desktop-ipc-senders), and how the desktop app names, records and deletes artifact partitions is [desktop/artifact-partitions.md](../desktop/artifact-partitions.md).

Artifact code is untrusted whoever wrote it, the person's own agent included, because an agent that reads planted instructions in a web page, a document or a tool's output can be led to write hostile code into an artifact. Television's own pages, which are the app, the Markdown editor, the error pages and the browser's placeholder for external pages, are trusted. An artifact reaches another artifact's files and store only through that artifact's ID or share ID ([product/artifacts.md#^af-artifact-id](../../product/artifacts.md#^af-artifact-id)), or, with the bindings flag on, a store through its own artifact's [binding](../../product/resources/resources.md#^rs-binding).

## The sandbox header

Every response from the artifact proxy, `/artifact/<id>/…`, and from the active-theme route, `/theme/…`, carries this header, the *sandbox header*: ^iso-sandbox-header

```http
Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads
```

The browser applies it wherever the document loads: in an artifact frame, in its own tab, in a popup, in a frame on another site, or in a desktop webview in the fallback partition. The desktop app removes it only in its artifact partitions and its URL-artifact partition ([#^iso-desktop-header](#^iso-desktop-header)). The document gets an opaque origin, which matches no other origin and has no storage, and its requests that carry an `Origin` header send `Origin: null`. The header never includes `allow-same-origin`: an artifact document comes from the app's own origin, so `allow-same-origin` would give it that origin back, and with it the app's storage and the token kept there. It never includes a top-navigation token either. `allow-popups-to-escape-sandbox` lets a site opened from an artifact in a new tab work normally there, and `allow-popups` also lets Chromium pass an application link from a sandboxed frame to the operating system ([artifact-bridge.md#^ab-link-handling](./artifact-bridge.md#^ab-link-handling)).

On the theme route, the header keeps a theme package's HTML file sandboxed if someone opens it as a page; stylesheets, scripts and images loaded as subresources ignore it.

## In the browser

The app gives an artifact iframe the `sandbox` attribute, with the sandbox header's tokens, before it assigns the frame a document the table marks sandboxed, and removes the attribute before it assigns one the table does not. The attribute does not depend on the response, so it sandboxes the document even if the response lacks the header. The browser fixes a frame's sandbox when a navigation starts, and the app reuses one iframe element across documents, so the attribute changes before each assignment of the frame's `src`, never after. ^iso-iframe-sandbox

| Document | `sandbox` attribute |
|---|---|
| A document the artifact proxy serves, including a Markdown file it renders | the sandbox header's tokens |
| A shared artifact's document, from another Television host or a share link | the sandbox header's tokens |
| The Markdown editor | none |
| The placeholder for an external page, and the artifact-missing page when the app shows it | none |
| An external page under [browser demo mode](../../product/artifacts.md#^af-demo-mode) | none |
| A theme's background and foreground frames | `allow-scripts`, as [theme delivery](../themes/delivery.md#Sandboxed frames) states |

A document's own navigation keeps its frame's sandbox, and frames it creates inherit it.

Every artifact iframe also carries `allow="clipboard-write; fullscreen; autoplay; picture-in-picture; web-share; encrypted-media"`. A sandboxed document is cross-origin to the app, so it is granted these Permissions Policy features and no others. ^iso-iframe-allow

## In the desktop app

The desktop app shows every artifact in a webview: a separate page, in a renderer process of its own, that cannot reach the window's page. Webviews do not support the `sandbox` attribute. The desktop app isolates artifact documents by session. A webview's browser storage, cookies, cache and service workers are its session's, and the window's session holds the served interface's saved data, the token among it. No artifact webview uses the window's session: each uses the persistent partition [desktop/artifact-partitions.md#^dp-sessions](../desktop/artifact-partitions.md#^dp-sessions) gives it. An artifact the connected server serves from its own files has an artifact partition of its own, and every external page artifact and shared artifact uses the one URL-artifact partition. A document in a partition has its own address's origin and that partition's browser storage. Within the URL-artifact partition, browser storage is kept apart by origin, and cookies by the browser's domain and path rules, which ignore the port, so shared artifacts from one producer share that producer's storage. The webviews of a served interface without partition support share the fallback partition ([desktop/artifact-partitions.md#^dp-attach](../desktop/artifact-partitions.md#^dp-attach)), where the sandbox header keeps sandboxing the documents a server sends it with ([#^iso-desktop-header](#^iso-desktop-header)). ^iso-desktop-sessions

The main process sets up each partition's session before the first webview that uses it is created. On each artifact partition and the URL-artifact partition, it rewrites the headers of every response that is the artifact proxy's: a response that carries Television's `X-TV-Version` header ([version-advertisement.md#^version-header](../updates/version-advertisement.md#^version-header)) to a request whose path is `/artifact/<id>` or below it, on any host. The window's session and the fallback partition rewrite nothing, so a Television document anywhere outside the artifact partitions and the URL-artifact partition keeps the sandbox. ^iso-desktop-header

- It removes the sandbox header: a `Content-Security-Policy` header whose whole value is a `sandbox` directive, and no other. The documents those partitions show therefore run unsandboxed: the Markdown editor and external pages, which the header never covers, and the documents a Television server serves from artifacts' files.
- It replaces the proxy's `Referrer-Policy: no-referrer` with `Referrer-Policy: strict-origin-when-cross-origin`, setting that policy whatever the response carried. A document's address holds its artifact's ID or share ID, which grants access to the artifact; under this policy the address goes only with requests to the document's own server, requests to other sites carry the server's origin alone as their referrer, and a request from an `https:` document to an `http:` address carries none. Map tile servers that refuse requests without a referrer, and API keys restricted to listed referrers, then work.

It changes no other header or response.

The main process sets a permission request handler and a permission check handler on the window's session and on each partition session it sets up. For a webview's web contents, they grant `clipboard-sanitized-write`, `fullscreen` and `mediaKeySystem`, Electron's permissions for the features the iframe `allow` attribute grants; autoplay, picture-in-picture and web share need no permission. They refuse every other permission a webview requests or checks. Every webview shows an artifact, whether a proxied document, an external page or the Markdown editor, so the handlers treat every webview alike. Requests and checks from the window's own web contents are granted, as they are without the handlers. ^iso-desktop-permissions

## Cross-origin rules by route

A sandboxed document's requests to its server are cross-origin, from an opaque origin. Its module scripts, fonts, `fetch` and `XMLHttpRequest` calls, the resource SDK import and the bridge's freshness poll are CORS requests; images, stylesheets and classic scripts are not. The routes that serve artifact documents and the files they load therefore allow any origin, without credentials. What they serve is public, or reached through an unguessable ID in the path, which is the capability. The routes that act with the server's token send no CORS headers and answer no CORS preflight, so no page on another origin, a sandboxed artifact included, can read their responses. The app calls them from its own origin; the CLI, agents and the desktop main process are not browsers. ^iso-routes

| Route | Authorization | Cross-origin handling |
|---|---|---|
| `/artifact/<id>/…`, the artifact proxy | the ID in the path | `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: ETag`, for the freshness poll |
| `/canonical/v<n>/…` | none | `Access-Control-Allow-Origin: *` |
| `/theme/…` | none | `Access-Control-Allow-Origin: *` |
| `/sdk/v1/…` | none | `Access-Control-Allow-Origin: *` ([sdk.md#^sdk-serving](../resources/sdk.md#^sdk-serving)) |
| `/views/artifact-missing/…`, the files of the page the proxy serves for a missing file | none | `Access-Control-Allow-Origin: *` |
| `/artifact-resources/<id>/v1/connection`, a WebSocket | the ID in the path | no `Origin` check ([resources/index.md#^rs-any-origin](../resources/index.md#^rs-any-origin)) |
| `/api/resources/v1/…` | the token | none, and no `Origin` check ([resources/index.md#^rs-any-origin](../resources/index.md#^rs-any-origin)) |
| `/channels`, `/artifacts`, `/display`, `/themes`, `/markdown`, `/telemetry`, `/demo-mode` and `/desktop/connect-check` | the token | none |
| `/events` and `/acp`, WebSockets | the token | no `Origin` check |
| `/health`, the app's page and bundle, and the other `/views/…` | none | none |

In the desktop app an artifact document has its own address's origin, so its requests to the server that serves it are same-origin and it can read the token routes' responses. Its partition never holds the token, so those routes refuse it, as they refuse any request without the token.

On a server that runs without a token, the routes the token would protect are open to any page, artifact documents included. That exposure belongs to tokenless mode ([product/resources/resources.md#^rs-tokenless](../../product/resources/resources.md#^rs-tokenless)); `Origin` and `Host` checks for it are [TV-379](https://linear.app/telepath-computer/issue/TV-379).

## Known limitations

Isolation limits what artifact documents can do. These limits are accepted. Each item says which runtime it applies to. In a browser, artifact documents run in the sandbox, which brings most of them; in the desktop app, artifact documents run unsandboxed in their partitions and are free of those. ^iso-limitations

1. **Browser storage**, in a browser. Touching `localStorage`, `sessionStorage`, `document.cookie` or IndexedDB throws `SecurityError`. Merely reading `window.localStorage` throws, so an unguarded read near the top of a script stops the rest of it.
2. **Workers**, in a browser. Web workers started from the artifact's own files fail, and service workers cannot register.
3. **Canvas readback**, in a browser. Reading pixels back from a canvas on which the artifact drew one of its own images throws `SecurityError`, unless the image was loaded with `crossorigin="anonymous"`.
4. **Download links to the artifact's own files**, in a browser. Browsers ignore a link's `download` attribute when the link leads to another origin, and the artifact's files are on an origin other than its opaque one, so the link works as an ordinary link. A file the browser can display, such as an image or a text, JSON, SVG or HTML file, replaces the artifact's page in its frame; other files download under their own names, not the link's. A link to a blob the page creates keeps its name.
5. **Moves the bridge cannot see in advance**, in a browser. The bridge sees link clicks and GET form submissions before they happen ([artifact-bridge.md](./artifact-bridge.md#Browser bridge behavior)), but not a script that assigns `location` or a form that posts.
   - A script that moves the frame to another of the artifact's own pages loads that page twice: the app learns of the move only when the new page reports its address, and then loads it again.
   - A script move, or a form that posts, to another site loads that site inside the artifact's frame, still sandboxed, and the artifact's history does not record it.
6. **Links that target the whole tab.** A link with `target="_top"` or `target="_parent"` does nothing in a browser. In the desktop app it stays in its webview.
7. **Requests to external services**, in a browser, that send an `Origin` header send `Origin: null`. A service that allows only listed origins refuses them.
8. **Third-party embeds**, such as video players, in a browser, inherit the sandbox, run with opaque origins and no storage, and may fail or degrade.
9. **Maps**, in a browser. Mapping services such as Google Maps and OpenStreetMap may not work correctly in artifacts, because the sandbox strips the referrer and other information they expect. Leaflet with Esri's World Street Map or World Imagery tiles works for simple maps, with markers, popups, panning and zooming. The `television` skill's guidance on HTML artifacts says so, and recommends Leaflet with those tiles.
10. **Pointer lock** fails. In a browser it is not among the sandbox header's tokens, and in the desktop app the [permission handlers](#^iso-desktop-permissions) refuse Electron's `pointerLock` permission.
11. **PDFs inside folder artifacts** do not display in Chromium-based browsers, which refuse to show a PDF in a sandboxed iframe ([TV-956](https://linear.app/telepath-computer/issue/TV-956)). Desktop webviews have no `sandbox` attribute and are unaffected.
12. **Browser features**, in both runtimes: those other than the six [artifact iframes](#^iso-iframe-allow) and [webviews](#^iso-desktop-permissions) are granted, such as notifications, geolocation, the camera, the microphone, reading the clipboard and MIDI, do not work ([TV-957](https://linear.app/telepath-computer/issue/TV-957)).
13. **Shared artifacts from producers on an older release**, in a browser, are sandboxed by the iframe attribute, but their producer sends neither CORS headers nor the sandbox header. Their module scripts fail, and their freshness poll cannot read the `ETag`, so they do not update live. Fragment and history changes inside them do not reach the artifact's navigation history, because their bridge relies on the Navigation API; each page they load is still recorded. [Cross-version compatibility](./artifact-bridge.md#Known limits and non-goals) is a non-goal.
14. **An updated desktop app connected to an older server.** Two boundaries apply, each to servers whose interface predates it.
    - A server whose interface does not pass application links on to the main process ([artifact-bridge.md#^ab-link-handling](./artifact-bridge.md#^ab-link-handling)) leaves application links in artifacts and in the Markdown editor doing nothing until it upgrades.
    - A server whose interface names no partitions has its artifacts share the fallback partition. Documents it sends with the sandbox header stay sandboxed there, with the limitations the header itself brings, items 1 to 4 and 7 to 9; the iframe attribute's own limits do not apply to webviews. Documents of a server too old to send the header run unsandboxed and share one storage area, apart from the app's.
15. **Application links in HTML artifacts ask each time**, in Chromium. Chromium asks the person before it opens an application link, and its prompt offers to always allow that app for the server's address. It does not apply that approval to an artifact's sandboxed document, so every application link clicked in an HTML artifact asks again. The approval does apply to the Markdown editor's application links, and the desktop app does not ask.
16. **`javascript:` links in HTML artifacts do nothing**, in a browser. A link whose address is a `javascript:` URL runs nothing in an iframe that has the `sandbox` attribute. A script that runs from the link's click handler, such as an `onclick` attribute, still runs. Desktop webviews have no `sandbox` attribute, and run such links.
17. **Shared artifacts from one producer share browser storage**, in the desktop app. They run in the URL-artifact partition with their producer's origin, so each can read what another from the same producer keeps in browser storage, as can an external page artifact whose address is on that producer's origin. Television's guidance tells agents that artifacts cannot use browser storage ([guidance.md#^rg-purpose](../resources/guidance.md#^rg-purpose)), so artifacts that follow it keep nothing there.
18. **A deleted artifact's partition stays on disk for a while**, in the desktop app. The reaper deletes it the next time it runs while the app is connected to the artifact's server, or, when the app has opened the partition since it started, after the app's next start ([desktop/artifact-partitions.md#^dp-reaper](../desktop/artifact-partitions.md#^dp-reaper)). A server the app never connects to again keeps its partitions.
19. **Website data in other sessions**, in the desktop app. Desktop releases without artifact partitions showed artifacts in the window's session, and whatever artifacts and websites kept there, such as a website's login, stays there, out of their reach. The fallback partition and the URL-artifact partition are separate too. A website used in a URL artifact therefore keeps a login only while the app shows it in the same session. A person signs in again the first time the app shows the website in the URL-artifact partition, and the first time it shows it in the fallback partition, as when an updated app is connected to an older server; both partitions persist, so a return to one finds the login made there.
20. **Agents trusted less than the server**, in both runtimes. The server reads and writes artifacts' files with the filesystem access of the account it runs as. Its check of [where an artifact's file or folder really is](../../product/artifacts.md#^af-real-location) is best-effort, and the agent administering Television is assumed to be within the same user-level trust boundary as that account. Where agents are trusted less than that, the defense is to run the server in an operating-system sandbox, which Television leaves to the operator.

## Testing

End-to-end regression tests, in a real browser and the real Electron app against a running Television server, prove that hostile artifact code cannot obtain the server's token or act with the app's authority, and that in the desktop app it cannot reach the main process ([IPC senders](../desktop/index.md#^desktop-ipc-senders), [the preload's context isolation](./artifact-bridge.md#Electron webview preload behavior)). In the desktop app they run with artifact documents unsandboxed in their partitions.

Storage visibility in the desktop app is proven by a matrix walk in the real Electron app, connected to a running Television server that requires the token. Probes run in the window's page and in artifact pages placed to tell the partitions apart: two HTML artifacts the server serves from its own files, which share its origin; two external page artifacts on one third-party origin and one on another; two URL artifacts at the server's own artifact addresses, on the window's origin; and a shared artifact from a second Television server. Every origin in the walk is on a host of its own, because cookies ignore the port. Each probe writes a marker of its own to `localStorage`, to IndexedDB and to a persistent, host-only cookie with `Path=/`, then looks for every other probe's markers and for the server's token. What each probe finds must match this matrix:

- an artifact the server serves from its own files finds its own markers and no other;
- a URL artifact finds the markers of every URL artifact on its own origin, its own included, and no other;
- the window finds its own markers and no other;
- only the window finds the token.

The walk then restarts the app and has every probe look again without writing, and the same matrix must hold, so that every partition, the URL-artifact partition included, is shown to keep its storage across a restart.
