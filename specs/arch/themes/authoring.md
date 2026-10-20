*Theme-authoring guidance: the self-contained theming document bundled inside the `television` skill, the authoritative UI material it carries, and the workflow it gives an agent.*

# Theme authoring

Television gives agents one document that explains how to create and maintain an installed theme. The document travels inside the main `television` skill and carries the design vocabulary, application structure, CSS overlay surface, and executable-theme guidance an agent needs, so theme work does not depend on finding additional stylesheets or source trees.

## Authority

This spec owns the content and derivation of the *theming document*, shipped as `theming.md` beside the `television` skill's `SKILL.md`. It owns what that document teaches, what authoritative material it embeds, and the source-to-bundle proof for that file.

The installed package contract and registry remain owned by [theme architecture](index.md); user-visible selection and appearance behavior by the [product spec](../../product/themes-and-appearance.md); runtime layering and appearance resolution by [theme delivery](delivery.md); bundled themes by [bundled installation](bundled-installation.md); canonical versioning by [canonical architecture](../canonical.md); design tokens by the [foundation UI spec](../../ui/foundation/index.md); application markup and styling by the [app UI specs](../../ui/app/index.md); CLI behavior by the [CLI product spec](../../product/cli.md); and bundle membership and consumer delivery by [making skills](../making-skills.md). The [appearance explainer](../explainer-appearance.md) gives maintainers of this guidance the complete path surrounding it.

## Document role

The `television` skill's `SKILL.md` directs an agent to read `theming.md` when creating, revising, or bringing an installed theme up to date. The theming document is supporting guidance inside that skill, not an independently installed skill. A theme likewise does not produce another agent skill.

The document is self-contained for theme authoring: it carries the token catalog, styling guidance, application markup and state reference, and theme-script guidance. Instructions for creating components and implementing their behavior belong in the main `television` skill. Include component markup and states here only to explain how to style them; for example, show the selectors for invalid inputs and error messages without teaching how to validate a field or associate its message. The document does not instruct agents to fetch stylesheets or read a Television checkout to discover the supported styling surface.

## The authored theme folder

Theme authoring produces one folder directly inside the themes directory that [`tv themes-path`](../../product/cli.md#^cli-themes-path) prints for the installation's [Television home](../../product/cli.md#^cli-home). Its immediate directory name is the exact theme ID used for selection. The agent does not choose an ID beginning with `.`, because [theme discovery](index.md#registry-scan) ignores dot-prefixed directories; it otherwise preserves the filesystem string without normalizing, validating, or treating any value as reserved. Before writing, the agent checks whether the target folder already exists. It never writes into a theme folder it did not author. Reusing any existing theme ID requires explicit user confirmation; that confirmation does not permit writing into a folder the agent did not author. In addition to the runtime manifest, entry stylesheet, optional executable entry, and optional assets governed by [theme architecture](index.md#installed-package-contract), the agent writes `README.md` in that folder.

All theme-authoring work stays inside that theme folder. The agent does not edit Television's installed source and does not suggest doing so. If the user asks for something a theme cannot do and presses for a source edit, the agent says the edit is unsupported: it can break features, and the next npm update replaces the installed source and discards the change. If the user still wants it, the agent recognizes that it is the user's computer and makes the requested change.

The manifest carries the display name, package version, and `colorScheme`, plus the optional app version the theme was authored against. The agent writes `colorScheme` as `light dark` for a theme that follows the appearance preference, `light` for a fixed-light theme, or `dark` for a fixed-dark theme. The agent copies a running server's exact release version from `tv status` into `authoredForAppVersion` without translation. A missing status version or the `0.0.0` development sentinel does not establish an authored-against release. The agent sets `authoredForAppVersion` when creating or deliberately re-rendering the theme against a known Television surface, preserves it during unrelated maintenance, and omits it when the target app version cannot be established. Package `version` remains independent from that advisory authoring context.

The README records useful context for future agents that informs the theme:

- the user's statements about intent, requirements, and reasoning thereof;
- references or source material needed to understand that intent;
- non-obvious design decisions and their reasons;
- the purpose of selector-level rules whose target may move as Television changes;
- the reason each JavaScript surface is needed, the effects it owns, and its expected resource cost;
- asset provenance and any handling context a future maintainer needs; and
- maintenance context that cannot be recovered reliably from the stylesheet and script alone.

The agent maintains the README along with the theme content. Selector-level CSS rules also carry concise purpose comments where the target alone does not preserve the reason for the rule.

When adapting a theme to a changed Television styling surface, the agent reads the theme's README and commented stylesheet, compares it to the current theming document to map that intent into updated implementation.

A `README.md` in the active package is not served: [theme delivery](delivery.md#^theme-delivery-readme) excludes it from the `/theme/` route. No exception exists for bundled packages — a README in the installed Clouds package is likewise unserved.

## Material carried by the theming document

### Bundled-theme upgrade notice

The document includes this section:

> ### Bundled theme upgrades
>
> Television may occasionally upgrade an installed bundled theme to deliver important Television fixes. Before replacing it, Television copies its current folder to a hidden timestamped backup beside the theme.

### Token vocabulary

The document includes the complete [foundation tokens](../../ui/foundation/index.md#tokens) and [application tokens](../../ui/foundation/tokens/app.css), including their definitions and comments.

Present the complete catalog under one **Token catalog** section heading, in a CSS code block. Group tokens by type or component using descriptive comments, such as typography, colors, spacing, inputs, sidebar, and tabs, rather than source filenames. Preserve the definitions and explanatory comments from the stylesheets. Foundation and application tokens appear together, with their scope clearly identified.

The token catalog comes directly from the stylesheets and is not maintained separately. It is the document’s only token catalog. The surrounding prose explains scope and how to set values. Token purposes belong in the catalog comments, rather than separate prose lists of which tokens style which components.

The guidance distinguishes foundation tokens, used by both the app and artifacts, from application tokens, used only by the app.

### App-shell selector and markup reference

The reference covers the markup, selectors, and states defined in the [app UI specs](../../ui/app/index.md), grouped by UI component.

For each component, the reference provides:

- a markup outline preserving element nesting and sibling relationships;
- the classes, IDs, custom elements, and state attributes, including ARIA states, defined by the UI spec; and
- concise descriptions connecting selectors to the elements and states they style.

Explain relationships and constraints that are not apparent from the outline and that affect selector targeting or interaction, such as document boundaries, focus indicators, and window-drag regions. Describe default layout only when it helps the author understand how to target or change it. Omit repeated content, incidental action wording, and behavioral narration that adds no styling information. Explain shared scope and override rules once rather than repeating them for each component.

The guidance explains that these selectors describe the app UI for the matching Television release and may change between releases. The same theme stylesheet loads in the app and supported artifacts, so app-only CSS rules begin with `:root[data-television-document="app"]` to avoid matching similarly named elements inside artifacts. Rules intended for both documents remain unprefixed. An app selector can style an artifact frame, but cannot reach the document inside its iframe.

#### Writing and maintaining the reference

An agent writes the reference from the app UI specs and keeps it in sync with them. The build inserts the written reference rather than generating it from the specs. Automated checks and review verify synchronization as described under [Testing](#testing).

### Styling technique

The document briefly teaches how theme CSS is written:

- A theme is a **partial overlay**: override only what the design needs; untouched styling comes from the foundation and app.
- Override documented tokens at `:root` wherever they express the intended change. Use CSS selectors against existing markup only when tokens are insufficient, keeping rules narrowly scoped and preserving interaction states. Explain that styling existing markup with CSS does not require changing the DOM. Explain this order of preference once.
- Root token overrides apply in both appearances. Appearance-specific overrides use `[data-theme="light"]` and `[data-theme="dark"]` after shared root statements, so they win when specificity is equal.
- Identify `--color-surface`, `--color-surface-muted`, `--color-text`, and `--color-text-muted` as the four semantic colors that establish a basic readable scheme. Tell authors to state the four together for every look the theme defines. Explain that accent, application wallpaper and the eight base hue values are optional overrides that retain foundation defaults when omitted; they do not derive from the four semantic colors. State what accent and wallpaper control, and that each overridden base hue regenerates its complete color scale.
- Explain briefly that theme CSS loads last and overrides foundation defaults with ordinary selectors, while application rules can still win if their selectors are more specific.
- Teach app-only selector scoping as described in the [app reference](#app-shell-selector-and-markup-reference), without repeating that explanation for each component.
- Explain `color-scheme` and its relationship to appearance as specified under [Appearance and scope](#appearance-and-scope).

### Shared controls and panels

The document explains the [shared interaction rules](../../ui/foundation/index.md#interaction-states) once: readable, perceptible feedback, automatic active and hover derivation, and explicit state overrides. It distinguishes the lightness-aware active derivation used by ordinary and semantic filled controls from the text-color wash used by wallpaper-overlay controls. It explains that a root-level resting override retains automatic active derivation, while a selector that gives individual controls different colors must set resting and active tokens together because an inherited active value was derived at its ancestor. It tells authors to change the wallpaper-overlay background for one coordinated treatment across unselected tabs, ordinary navbar controls and the empty-stage message; automatic states and tab aliases then require no tab-specific override. It reserves tab tokens for a treatment that differs from the shared overlay and requires both resting and active tab backgrounds because tab active defaults to the overlay active value rather than deriving from tab resting background. Hover continues to derive automatically, and selected background remains separate. Describe the panel edge treatment and which other surfaces reuse it under [panels and surface edges](../../ui/foundation/index.md#panels-and-surface-edges), without repeating token definitions. These rules apply with or without wallpaper images.

### Image backgrounds

Image backgrounds are optional. When a theme includes one, the document teaches the following under **Image backgrounds**, with setup before readability guidance.

#### Adding an image

Put the image inside the theme package and set `--app-wallpaper-image` to a relative `url(...)` at the app-scoped root. Include a minimal example with an optional dark-appearance image. Explain stylesheet-relative URL resolution, `none`, and using `--app-wallpaper` for a complete background declaration.

#### Readability and interaction

Choose wallpaper-overlay background and text together. Explain that unselected tabs, ordinary navbar overlay controls and the empty-stage message share this treatment. Offer translucent surface fills with matching text as starting points for busy images; blur alone does not ensure contrast. Increase opacity or use a solid surface when necessary.

Apply the shared [interaction states](../../ui/foundation/index.md#interaction-states) guidance to controls over the image. Check states in every appearance the theme supports over bright and dark image regions and different window crops; preserve keyboard focus. The placeholder uses the resting treatment only.

Teach shared interaction rules once in the document and refer to them here. Keep image setup and image-specific checks in this section.

### Theme effects and scripts

The document introduces theme effects as optional visual additions, such as textures, tint overlays, or animated backgrounds, used when the requested design calls for them. Apply the token-first guidance above to effects as well: prefer CSS, use sandboxed iframe JavaScript when CSS is insufficient and application DOM access is unnecessary, and use main-page JavaScript only when application DOM access is necessary.

The document includes the practical details authors need from these owning specs:

- [Theme package contract](index.md#installed-package-contract): script declarations, matching files, and validation.
- [App visual layers](../../ui/app/index.md#theme-visual-layers): available effect locations, selectors, stacking, appearance, and interaction restrictions.
- [Theme state](index.md#selection-and-display-state) and [Settings](../../ui/app/settings/index.md#interaction): main-page consent and how the user grants or withdraws it.
- [Theme delivery](delivery.md#application-theme-javascript): execution and sandbox restrictions, refresh and cleanup behavior, asset resolution, and failures, including the exact [pointer message protocol](delivery.md#host-to-frame-pointer-protocol).

The shipped guidance contains those details so authors can use it without consulting the source specs.

For sandboxed frame scripts, the guidance explains that Television keeps each frame element's `color-scheme` matched to its document root's declared scheme using the effective `data-theme`, which keeps the frame transparent. It tells authors to read `data-theme` from the frame document's root once at startup. An effective appearance change recreates each enabled frame and reruns its script, so the script needs no appearance listener. The guidance warns that changing `color-scheme` on the frame document's root breaks the match and forces the frame opaque. Theme CSS cannot cross into a frame document.

Before asking the user to enable main-page JavaScript in Settings, the authoring agent inspects and explains the script. The agent does not grant consent on the user's behalf.

The guidance explains how to write scripts that tolerate reruns, manage their own nodes, listeners, and timers, and use reasonable CPU and GPU resources. Main scripts should avoid unnecessary dependence on application internals, which are not a stable JavaScript theme API. ^theme-authoring-javascript

### Worked example

The document points the agent at the installed Clouds package, the `clouds` folder in the directory `tv themes-path` prints, as the worked example — app-only scoping, a relative asset reference, purpose-specific shell rules, use of the carried vocabulary. Nothing from Clouds is inlined into the document: the installed copy is available on the local filesystem. Its version may meet or exceed Television's minimum, and it may include user edits, so it is a structural example rather than a promise of the currently shipped design.

### Runtime model and import mechanics

The document explains these runtime facts:

- the installed folder and manifest requirements, including the required `colorScheme`, the three optional JavaScript declarations, and the fact that extra authoring files are not runtime metadata;
- one entry stylesheet reaches the app and artifacts that load a theme-capable live canonical version, while all JavaScript entries remain application-only;
- eligible files in the active package are served byte-for-byte; `main.js` is empty unless both its manifest and consent gates are open, each iframe entry is empty unless its own manifest gate is open, and relative `@import` and `url(...)` references resolve from the stable active-package path without rewriting or a path constructed from the theme ID;
- the app keeps the active entry after the complete foundation and application surface styles, and refreshes that link when selection or any file in the watched active package changes;
- the frozen canonical v1 is served as built assets with no theme overlay — among canonical versions, themes reach only live versions and their vocabulary;
- an effective appearance change does not reload the entry stylesheet, the app or artifact documents, or the main script; it recreates each enabled theme frame and reruns its entry script, while a stored preference change under a fixed theme changes no presentation;
- registry refresh is required for package discovery and for publishing `colorScheme` or JavaScript-declaration changes into the registry, while saving any file in the active package uses the live-update path; per-theme main-script consent is persisted display state and is independent of both mechanisms; and
- a live package edit refreshes affected application and artifact surfaces according to [theme delivery](delivery.md#artifact-documents), including the different continuity behavior of HTML and markdown artifacts.

### Theme selection

The document describes the two mechanisms for changing the active theme, and only these: the user's Settings UI and the `tv set-theme <theme-id>` CLI command. Agents use the CLI, preserving an installed theme's exact ID. The names and semantics of the null theme and default theme come from the settled [product vocabulary](../../product/themes-and-appearance.md#theme-packages-the-null-theme-and-the-default-theme); the theming document uses `None` or describes having no theme and never exposes the internal term `null theme`.

When its opening selection read succeeds, `tv set-theme` reports the previous and new selections on stdout, so activating the authored theme also puts the user's prior selection in the agent's context. If that read fails, activation continues and stdout confirms only the new selection. The workflow needs no separate pre-activation read and does not assume prior-selection context is always available. Exact output is owned by [the CLI product spec](../../product/cli.md).

### Appearance and scope

The document states the appearance mechanics as bare technical facts, so an agent familiar with common light/dark approaches knows exactly which one Television uses:

- Television dynamically maintains a `data-theme="light"` / `data-theme="dark"` attribute on the application root by combining the manifest's `colorScheme` with the server-wide appearance preference: `light dark` follows the preference, while `light` and `dark` fix the root to that value; Television-managed artifact documents install the same resolver with fixed `system`, so their marker follows the browser iframe or Electron webview appearance path; each generated theme-frame document starts with the app's effective value and is recreated when that value changes;
- themes hinge appearance-dependent styling exclusively on selectors targeting that root attribute, while frame scripts read its value at startup;
- themes do not use `light-dark()` or `prefers-color-scheme` media queries;
- the foundation color sheet supplies Television's zero-specificity `color-scheme` in every theme-capable app or artifact document; and
- theme CSS does not declare `color-scheme`. The manifest is the theme's one declaration of whether it follows both appearances or fixes one, and the foundation matches browser-native chrome such as scrollbars and form controls to the resulting `data-theme`.

The product and architecture specs own the attribute's value set.

A token statement at `:root` applies in both modes. A fixed dark-only or light-only theme therefore states the four semantic colors and its other token overrides at `:root`, uses no mode blocks, and declares the matching `colorScheme` in its manifest. A theme with mode variants declares `"colorScheme": "light dark"` and states each semantic-color set and any other intended differences under `[data-theme="dark"]` or `[data-theme="light"]`, after shared root statements. A theme that customizes only one Television appearance can supply only that mode block and leave the other appearance on foundation defaults. No other token category is required to have paired values. The workflow inspects both effective appearances for an adaptive theme. For a fixed theme it inspects the one effective appearance under both a matching and an opposing stored preference, confirming that the theme remains fixed.

## Authoring workflow

The theming document directs the agent to:

1. gather visual intent, references, palette and typography direction, and the app or artifact surfaces that matter;
2. run `tv themes-path` for the themes directory and `tv status` for the target Television app version, giving these and every later `tv` command the same `--home` when the installation is not the [default home](../../product/cli.md#^cli-home-selection), which a user can move by writing its path into `~/.tv-home`;
3. choose and preserve an exact filesystem-derived theme ID, check whether its folder exists, confirm with the user before reusing any existing ID, and choose another ID rather than write into a folder the agent did not author;
4. choose the least invasive theme surface that can realize the intent, then write the manifest with its `colorScheme`, entry stylesheet, README, any justified executable entries, and relative assets as one folder, recording advisory authored-against app-version metadata when the target version is known;
5. activate the authored package with `tv set-theme <theme-id>`, then iterate on the files in its watched package tree;
6. when the package declares `main.js`, inspect and explain it and ask the user to grant consent from Settings; for iframe entries, account for the sandbox, pointer-message contract, and frame replacement lifecycle;
7. verify the app shell and an artifact using the theme-capable live canonical version in every appearance the theme supports, including a fixed theme under matching and opposing stored preferences, and check readability, assets, intended cross-document scope, stacking, and whether every foreground addition preserves ordinary application interaction; and
8. leave the README, stylesheet, script, and manifest consistent for the next maintainer.

Verification is visual by nature. When the agent can render the app and an artifact headlessly *and* can interpret screenshots, it offers the user an optional screenshot review — the app shell and one artifact using the theme-capable live canonical version in two verification states: light and dark effective appearance for an adaptive theme, or matching and opposing stored preferences for a fixed theme (four captures) — saying up front that it takes time and letting the user decide. Captures are temporary resources: written to a temporary location and deleted after review, never left in the theme folder or anywhere else on the filesystem. Without those capabilities, or if the user declines, the agent asks the user to inspect the same app-and-artifact states.

The guidance distinguishes registry refresh from live active-package editing and warns when an edit causes a document reload or preserves document state. It does not tell an agent to install, update, or remove theme packages through controls the product does not provide.

## Bundle derivation

The main `SKILL.md` is composed from the authored skill fragments and links to `theming.md`. The builder composes `theming.md` from authored guidance, the complete ordered production token sheets, and the authored component reference. It preserves the guidance and token definitions and comments, and omits source filename labels from the published catalog. Reference freshness metadata, including source hashes, stays in the source and is omitted from the document agents receive. Nothing is derived from served output, canonical copies, or Clouds.

The skills manifest contains no standalone theme skill. Generic validation, copying into `packages/skills/dist/television/`, CLI packaging, and direct installation follow [making skills](../making-skills.md).

## Testing

Source-to-bundle coverage crosses both the real `television` builder and the real manifest-driven repository build. Fixture-driven coverage proves complete ordered token insertion and authored-reference insertion. The filesystem seam proves the shipped vocabulary matches production copies and the guidance describes the supported element APIs and theme workflow.

Automated reference checks run in the repository test suite and must:

- Compare the source files recorded in the reference with every `.frame` and `.css` file under `specs/ui/app/`, plus `specs/ui/app/index.md`, which defines the app document marker. Missing, additional, or duplicate source entries fail the check.
- Compare a recorded SHA-256 content hash for each source file with its current contents. A mismatch fails the check. Review and, where needed, update the reference before updating the recorded hash.
- Check that classes, IDs, custom-element names, attribute names, and literal state values named in markup outlines and inline selector examples occur in the source specs. Match complete names so that a longer name containing the same text does not satisfy the check.

These checks do not prove that a selector combination is valid or that an explanation is correct. Independent review checks selector meaning, markup relationships, states supplied by templates, and whether each component is actually described. The [theme-authoring proof](../../../proofs/arch/themes/authoring.md) identifies the tests and review evidence for these requirements.

Consumer delivery composes with the byte-identical package and direct-install crossings owned by [making skills](../making-skills.md) and [the CLI product spec](../../product/cli.md). This guidance requires no browser or agent-evaluation coverage.
