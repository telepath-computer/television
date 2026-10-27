*How onboarding reference frames become complete artifact documents in Television's release bundle.*

# Onboarding design bake

The onboarding designs live under `specs/ui/onboarding-artifacts/`. The release
bundle lives under `packages/server/assets/onboarding-channels/`. The bake is
a manual repository script that renders each HTML artifact's reference frame,
writes the production document around it, copies Markdown and declared skill
assets, places the production date module beside Today's Calendar and the
to-do store module beside Company To-dos, and updates the bundled channel
configuration.

The frame remains the authority for the artifact markup and CSS. The bake adds
the document shell and asset links around that rendering.

The bake is an author-run port. Production builds, CI, and tests never run it
against the committed production content tree. Its output becomes release
content only after an author reviews and commits it.

## Invocation

```text
node scripts/bake-onboarding.mjs <channel>... [--root <content-tree>] [--designs <design-root>] [--skills-dist <dist-root>]
```

The three roots default to the production content tree, the onboarding UI-spec
directory, and `packages/skills/dist/`. Tests use the same options with fixture
inputs and disposable output directories.

The script requires the repository's Node 24 toolchain
([arch/node-versions.md](../node-versions.md)).

## Inputs

Each named design channel contains:

- `layout.yml`, carrying the channel name and ordered artifact records defined
  by the [onboarding UI spec](../../ui/onboarding-artifacts/index.md#^channel-layout);
- one argumentless `<slug>.frame` or Markdown `<slug>.md` file per artifact,
  beside the manifest;
- a manifest `skill` value when a rendered frame uses browser components
  supplied by a bundled skill;
- `components: false` when the production document must omit the canonical
  components module;
- `store` when the artifact's store starts with data.

An onboarding frame contains its artifact markup in the frame body and its
artifact CSS in the optional `style:` block. It declares no parameters,
imports, data, script, or adopted styles. A skill-backed frame writes the
public custom-element tags but does not import the skill itself. Frameset and
the baked document supply that dependency for their respective environments.

Before writing, the bake checks that its roots are real, disjoint directories;
the starting config is a JSON object with a `channels` array; every requested
channel, manifest, artifact source, slug, and declared skill exists and is
valid; manifests contain only their documented fields; card IDs and slugs are
unique; every artifact source appears in the manifest; and each artifact has
exactly one source file. It also compiles every frame before writing. A failure
names the problem, exits nonzero, and leaves the content tree unchanged.
^input-contract

All pre-write checks finish before any channel folder is replaced. The three
roots are resolved to their real paths first; the content root must not equal,
contain, or sit inside either input root, including through a symlink.

Skill directories contain only regular top-level files whose names match
`^[A-Za-z0-9][A-Za-z0-9._-]*$`; they contain no subdirectories, symlinks, or
`index.html`. These names can be copied and written into relative `href` and
`src` attributes without another encoding rule.

A frame's CSS is self-contained. It contains no `@import` and no external
resource reference; data URLs and same-document fragments are allowed. This
check applies to parsed CSS constructs rather than comments or arbitrary text.
^self-contained-styles

## Writing artifacts

The bake loads each `<slug>.frame` through the repository's Frameset transform
and calls its renderer with no arguments. The returned markup becomes the
document body. The frame's resolved `style` value becomes the contents of the
document's `style` element. ^spec-rendering

The renderer keeps its Vite cache in a private temporary directory, runs no
browser dependency optimization, and removes the directory before the bake
exits. A bake therefore never writes the checkout's shared Vite cache, which a
development or test server in the same checkout may be serving from.
^renderer-cache

The bake writes this document: ^baked-shell

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{artifact title}</title>
<link rel="stylesheet" href="/canonical/v2/styles.css">
<script type="module" src="./onboarding-relative-dates.js"></script>
<script type="module" src="./onboarding-company-todos.js"></script>
<script type="module" src="/canonical/v2/components.js"></script>
<link rel="stylesheet" href="./{skill stylesheet}">
<script type="module" src="./{skill module}"></script>
<style>
{frame style}
</style>
</head>
<body>
{rendered frame body}
</body>
</html>
```

The relative-dates line appears only for Productivity's `todays-calendar`
artifact, and the to-do store line only for its `company-todos` artifact.
The canonical components line is omitted when the manifest says
`components: false`. CSS files from the declared bundled
skill come next in filename order, followed by its JavaScript files in filename
order. Both groups are absent without a declared skill. The title is the
manifest title with `&`,
`<`, `>`, `"`, and `'`
escaped for HTML. A frame without a style block omits the `style` element.
The document uses single newlines and ends with a newline.

For each manifest card, the bake writes one packaged artifact:
^source-shape-mapping

- `<slug>.md` becomes `<channel>/<slug>.md`, byte-for-byte.
- `<slug>.frame` without a declared skill becomes
  `<channel>/<slug>.html`.
- `<slug>.frame` with a declared skill becomes
  `<channel>/<slug>/index.html`. Every regular top-level file from
  `<skills-dist>/<skill>/`, except `SKILL.md`, is copied beside it.

Productivity's `todays-calendar` artifact also receives a copy of
`packages/server/assets/onboarding-relative-dates.js` beside `index.html`.
Its module tag precedes the calendar skill module in the document head. The
bake reads the module before replacing any channel folder and copies
its bytes without transforming them. The [onboarding UI design](../../ui/onboarding-artifacts/index.md#^productivity-relative-dates)
owns its displayed-date behavior.
^relative-dates-module

Productivity's `company-todos` artifact also receives a copy of
`packages/server/assets/onboarding-company-todos.js` beside `index.html`, with
its module tag the first script in the document head, before the canonical
components module and the task skill's JavaScript. The bake reads and copies
it the same way. The
[onboarding UI design](../../ui/onboarding-artifacts/index.md#^productivity-todo-store)
owns its behavior. ^todo-store-module

The named channel folder is replaced as a unit, so removing a design source
also removes its old packaged output. Channels not named by the invocation are
not changed. ^folder-rewrite

### Bundled skill assets

`skill: tv-tasks` and `skill: tv-calendar` are packaging instructions, not
runtime agent behavior. Before the bake runs, the skills package build must
have created `packages/skills/dist/<skill>/`. The bake fails before writing if
that directory is missing. It copies those distributable browser files beside
the generated `index.html` and writes relative links to their CSS and
JavaScript into the document head. The release therefore contains everything
the task or calendar custom elements need. ^skill-assets

## Updating the bundled configuration

The bake updates `onboarding-channels.json` after writing the artifacts:
^config-update

- A new channel is appended with the design manifest's name.
- An existing channel keeps its position and human-edited name.
- Its artifact list is replaced by the manifest's ordered cards, carrying each
  slug, title, and optional size, geometry, and store.
- `focusChannel` and every channel not being baked remain unchanged.

The config is written as two-space-indented JSON with a trailing newline and
the schema's canonical key order.

After writing, the bake runs the production content-tree validator
([content validation](./content.md#^build-validation)). Validation failure is
reported, the bake exits nonzero, and the written files remain available for
inspection.

## Determinism

The same frames, Markdown, skill files, relative-dates and to-do store modules,
starting config, and channel arguments produce the same bytes. A second bake with no input change
has no diff.
^determinism

## Testing

Tests run the real script against disposable roots. They cover every input
rejection above, frame rendering and shell serialization, Markdown copying,
skill-file copying, relative-dates and to-do store module copying and linking,
config updates,
post-write validation, untouched channels,
and repeatable output. Tests do not bake the committed production tree or
compare it to a golden copy; the reviewed commit is what makes generated output
part of a release.
