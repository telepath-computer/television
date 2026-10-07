# Ledger: specs/arch/themes/delivery.md

Working document; no authority. The spec was rebuilt from an empty file. Each entry below is one statement in the new spec and says why derivation can't be trusted to get it acceptably right without being told. Sources of understanding: the old spec, `packages/server/src/themes.ts` (route), `packages/server/src/canonical.ts` (wrapper), `packages/artifact/src/browser/appearance-resolver.ts`, `packages/web/src/appearance.ts`, `packages/web/src/theme.ts`, `packages/web/src/main.ts`, `packages/desktop/src/connect.html`, and the neighbouring specs (theme architecture, product themes-and-appearance, canonical, artifact bridge, reload-navigation, desktop appearance, app UI, settings UI, authoring, appearance explainer).

## Statements kept

### Active-theme route

1. **The active package is served publicly at `/theme/`, with four named entries and other files at their package path.** A contract with theme authors, who name these files and write paths relative to them, and with every canonical wrapper already served to artifacts, which hard-codes `/theme/theme.css`.
2. **Files are served unchanged; no URL rewriting or concatenation; relative references resolve under `/theme/`.** Theme authors rely on relative `url()` and `@import` working. Inlining, bundling or rewriting is a plausible implementation choice that would break their packages.
3. **Only files inside the active package folder are reachable, symlinks included; inactive packages are not reachable.** A security decision for an unauthenticated route over the user's home directory. Derivation might plausibly serve any installed package or follow symlinks.
4. **The route is unauthenticated and open to any origin, because cross-origin stylesheet requests cannot carry the bearer token; anyone who can reach the server can read the active package.** An implementer would expect a route on an authenticated server to need authentication. This answers that objection and records the exposure as accepted.
5. **A package-root `README.md` is never served.** The authoring spec promises theme authors this (it cites `^theme-delivery-readme`). Nothing in the route's purpose would lead derivation to exclude one file.
6. **The server enforces the script gates: `main.js` needs `enableMainJS: true` and consent for the active ID; frame entries need only their flag.** This is where consent is actually enforced, since main-page script runs with the application's privileges. Derivation could plausibly gate only in the client, and could easily apply consent to the frame entries.
7. **The four entries always succeed and return an empty body when there is nothing to deliver; other unservable paths return 404.** Product and theme architecture rely on empty entries during missing-package recovery, and the product spec and theme architecture cite `^theme-delivery-script-route`. A 404 is the plausible alternative, and it would raise load errors in every document and frame.
8. **Every response must be revalidated; the validator changes with package and bytes; the query string and appearance do not affect what is served.** A contract with browser caches: the URL is stable while its content changes live, so ordinary `max-age` caching would show stale themes. Appearance not being an input is an architectural decision: one stylesheet covers both appearances.

### Canonical composition

9. **A live wrapper imports base then theme; a frozen wrapper imports base only.** This is how artifacts receive the theme at all, and the order is what makes the theme win in artifacts. Canonical decides live versus frozen, and cites this section for the composition.
10. **The wrapper copies its query string verbatim onto both imports, and the imports ignore it.** Without the copy, a running document (the markdown editor) that refreshes its canonical link would keep a stale nested theme import. Derivation would plausibly drop or interpret the query. The note on `authoredForAppVersion` explains that authored queries in existing artifacts pass through harmlessly.

### Stylesheet order

11. **In the application and live canonical documents, the theme loads after every Television stylesheet, and nothing Television provides loads after it.** A contract with theme authors, whose overrides depend on winning the cascade. Someone adding a stylesheet later in either document could silently override every theme.

### App-document selector

12. **The application root carries `data-television-document="app"`, the desktop local page counts as an application document, and app-only theme rules use the `:root[data-television-document="app"]` prefix.** A contract with theme authors, including the bundled Clouds theme, because one stylesheet loads in both kinds of document. The desktop connect-flow spec cites `^theme-delivery-app-document` for the local page.

### Appearance

13. **Every Television-managed document's root carries `data-theme="light"` or `"dark"`, set by one resolver from `system`, `light` or `dark`, with `system` following `prefers-color-scheme` live.** Theme CSS and the foundation select on this attribute and its two values, so it is a contract with theme authors.
14. **The application's appearance input comes only from confirmed `activeThemeColorScheme` and `appearanceMode`, a fixed theme's value winning, and is applied before connected content mounts and recomputed on both events.** The desktop appearance spec takes this input as its own (it cites `^theme-delivery-shell-appearance`). Applying it before mount is a decision: otherwise the first frame or webview paints with the wrong appearance.
15. **First paint uses an inline script ahead of all stylesheets, reading `television-appearance-mode` from local storage; the cache holds the resolved input, falls back to `system`, and is overwritten by confirmed state. One key per origin is an accepted limitation.** The key and its values are stored browser data that later versions read. Caching the input rather than the raw preference is a choice derivation could get wrong, since a fixed theme would then flash. The limitation is recorded so it reads as a decision.
16. **An appearance change never requests or replaces the theme stylesheet or main script; it only changes the marker and recreates the frames.** Derivation would plausibly refresh all theme resources on any theme-related change. Rerunning a consented main script on an appearance switch would be a visible defect.
17. **Application CSS sets no different `color-scheme` between the root and an artifact frame.** Artifact appearance in Chrome and Firefox depends on inheritance through those ancestors. This is a trap a later stylesheet change could fall into without any test near it failing.

### Application theme link

18. **One link to the connected server's `/theme/theme.css` gets a fresh query on each refresh, because Firefox can otherwise reuse the old sheet.** This preserves knowledge that would otherwise be lost: a stable URL looks sufficient given revalidation, and it is not.
19. **The link is added on connect without waiting for display state, refreshed on every `theme-changed` except consent-only ones, kept last, and the old one removed first.** Consent-only changes also arrive as `theme-changed`, so derivation would refresh on them. Keeping the link last carries statement 11 into the application's lifecycle. Removing the old link first prevents a late load from becoming current.
20. **The application announces when the current theme stylesheet loads, fails or is removed; `theme-changed` is not that signal; replaced links do not announce.** The overflow-fade spec depends on this (it cites `^theme-delivery-style-notification`). Derivation would plausibly remeasure on `theme-changed`, before the new styles apply.

### Main script

21. **The main script is a classic external script from `/theme/main.js` with a fresh query, added only while the active ID is consented; `document.currentScript.src` gives the package URL.** Classic versus module is a contract with theme authors, because it decides what their code can use and how it finds its own files.
22. **Each document decides from its own state: with a main-script include installed, a change of theme or loss of consent forces a full reload; without one, changes apply in place. The new appearance is cached before reloading, and the reloaded page starts from confirmed state.** The product spec cites `^theme-delivery-script-reset` for this. Deciding from server state instead of the document's own include is a plausible mistake. Caching before reload preserves knowledge that would otherwise be lost, since the reloaded first paint reads that cache.

### Sandboxed frames

23. **Frames are created from the manifest flags without consent; they are recreated on theme change, on same-theme events other than consent-only, and on effective appearance change; they are removed on no theme and on disconnect; old frames go first; nothing installs for a replaced state.** The consent-only exception and the stale-state guard are where derivation would go wrong. The product spec owns the visible restarts, and this records the mechanism decisions behind them.
24. **The frame document is generated, transparent, marginless and non-scrolling, with root `data-theme` copied at creation and matching `color-scheme` on `html` and `body`; a mismatch makes the frame opaque; scripts read `data-theme` at start and use `document.currentScript.src`.** A contract with frame script authors, who rely on these document facts. The `color-scheme` match is a non-obvious browser behavior a later change could break.
25. **The sandbox is exactly `allow-scripts`, giving an opaque origin; theme CSS cannot style the frame; failures stay inside.** A security decision. Adding `allow-same-origin` would let a consent-free script reach the application, because the script comes from the same server.
26. **If a frame takes focus, focus returns to the last application element, or to `#app`.** Browsers can still focus these frames, which is knowledge that would otherwise be lost. The app UI spec gives `#app` its `tabindex` for this fallback.

### Pointer protocol

27. **Pointer input from the application and from the artifact bridge is forwarded to frames as the pinned `ThemeFramePointerMessage`, without altering the original event.** The message shape and field meanings are a contract with frame script authors. Not cancelling or capturing the original event is a decision that keeps the application usable.
28. **Messages use target origin `"*"`, are not queued, and flow only from host to frame; the host ignores everything a frame sends; frames recognise host messages by `type` and `event.source === parent`.** The wildcard looks like a security mistake, so the reason is stated. One-way flow is a security decision. No-queueing is a contract fact frame authors need.

### Artifact documents

29. **Television-managed artifact documents install the resolver fixed at `system` and get their appearance from the browser (inherited `color-scheme`) or Electron's app-wide native theme, never from a message; Safari is a known gap; theme frames do not rely on this.** This is an architectural decision derivation would plausibly make differently, by posting the preference into each frame. The Safari gap is owned by the product spec and is only pointed to here.

### Inputs to proof derivation

30. **Fact: browsers, Firefox especially, reuse already-loaded stylesheets by URL, so refresh coverage changes only a nested import and the markdown refresh is proven in Firefox.** A test that changes the entry file passes even when the nested-refresh mechanism is broken. A proof writer would not know to avoid that.
31. **Coverage owned elsewhere: product owns the acceptance paths; desktop appearance owns Electron native and webview appearance.** Without this, a proof writer would duplicate those paths in this spec's proof.

## Left out, and why (main groups)

- **The authored-version query (`authoredForAppVersion`) and where authors get the version.** The product artifacts spec and making-skills own its meaning and the guidance; this spec only needs it to pass through (statement 10).
- **Resolver install details:** the idempotent global controller, `__televisionAppearanceResolver`, and first-install-wins. Same-build internals; any working choice would do.
- **Vite `head-prepend` and the UTF-8 response header.** Implementation means to "first in head" (statement 15).
- **Registry lookup through `GET /themes` for frame flags, and retry after a failed lookup.** Derivable from "frames follow the registered flags". Theme architecture owns the API.
- **Main-script loader isolation from the module graph, and effects not being rolled back.** The product spec owns both promises.
- **Main-script rerun triggers beyond the consent-only and appearance exceptions.** These follow from the product's "package refresh reruns" and statement 19's event rule.
- **Settings reopening after a reset reload (`reopenSettings=1`).** The Settings UI spec owns the promise. The URL marker is a mechanism any reasonable choice could replace.
- **Pointer coordinate mapping from artifact frames.** The artifact bridge owns it.
- **Artifact proxy placement of the resolver relative to CSP and the bridge.** The artifact bridge owns it.
- **Which artifact documents reload or refresh on theme change.** Reload-navigation owns it.
- **The markdown editor and error pages loading the resolver before `/canonical/v2/styles.css`.** Covered by statement 29 and arch/ui; the order is derivable from "before styles".
- **Electron detail and the frozen v1 rules.** The desktop appearance and canonical specs own them.
- **Most of the old testing section.** It restated promises, or asked for real-browser crossings the testing policy already requires. The first-paint measurement technique was dropped as code- and proof-governed.

## Citations and anchors

- Block refs cited from other specs are all kept on the statements that carry their meaning: `^theme-delivery-script-route`, `^theme-delivery-script-reset`, `^theme-delivery-style-notification`, `^theme-delivery-readme`, `^theme-delivery-app-document`, `^theme-delivery-shell-appearance`.
- Block refs that nothing outside the old spec cited were dropped: `^theme-delivery-route`, `-wrapper-query`, `-canonical`, `-resolver`, `-app-link`, `-script`, `-embedded`, `-artifact-documents`, `^theme-frame-pointer-contract`, `^theme-frame-pointer-one-way`, `^theme-settings-reopen`.
- Heading anchors that other specs cite are kept, except two:
  - `#testing` is now the policy heading `#inputs-to-proof-derivation-that-the-spec-does-not-otherwise-show`. Old links from `specs/ui/app/index.md` and `proofs/arch/themes/delivery.md` now point at a missing heading. The link test does not check heading anchors.
  - `#embedded-document-platform-behavior` (cited by the appearance explainer) is folded into `#artifact-documents`.
- `#main-script` is still a heading, but only the old spec used it.
- The proof `proofs/arch/themes/delivery.md` needs re-deriving against the new spec; this task did not touch it.

## Spec and code notes

- The README exclusion in code compares case-insensitively (`readme.md` is also refused). The spec names `README.md` only, and either behavior is acceptable.
- The route validator in code hashes theme ID, manifest version and bytes. The spec states only the property that matters: it changes whenever the active package or the bytes served change.
