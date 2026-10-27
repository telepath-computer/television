*How the onboarding bake is proven at its process boundary and packaged-file output.*

# Onboarding design bake — proof

Proves [specs/arch/onboarding/bake.md](../../../specs/arch/onboarding/bake.md).

## Coverage model

The suite invokes the real bake with real arguments, exit status, filesystem,
Frameset transform, skill builds, and content validator. It runs under the
repository Node 24 toolchain. No mechanism is mocked.

Acceptance tests cover a successful bake, rejected input, and post-write
validation failure. Contract tests cover the flat source files, document
serialization, skill assets, configuration updates, and deterministic output.
Expected markup comes from an independent invocation of the Frameset renderer;
the expected document shell is assembled from the serialization contract.
Markdown and skill-file expectations come from the input bytes.

Tests use disposable content roots, as directed by the spec. They neither bake
the committed production tree nor compare it with a golden bake. The
[content proof](content.md#^t-production-tree) covers the package that ships;
[product acceptance](../../product/onboarding/onboarding-channels.md#^ac-fresh-install)
covers installation and serving.

## Test hooks

The supported `--root`, `--designs`, and `--skills-dist` arguments let tests
supply disposable output and authored input trees; ordinary invocations default
to the repository locations defined by [Invocation](../../../specs/arch/onboarding/bake.md#Invocation).

## Acceptance assertions

Every assertion enters through a spawned `scripts/bake-onboarding.mjs` process.
Fixtures are disposable copies of the shipped tree or authored design/content
trees. All rendering, writes, and validator calls remain real.

- **Successful bake.** Baking every channel discovered from the real design manifests exits zero. A separate invocation of the production validator accepts the resulting tree. This proves the [bake operation](../../../specs/arch/onboarding/bake.md#Writing-artifacts) and its successful validation exit — *(policy-grade test: `test/node/bake-onboarding.test.ts` “bakes every design channel into a shipped-tree copy and the result passes build validation”)*. ^t-bake-succeeds
- **Rejected input writes nothing.** An unknown requested channel produces a nonzero exit naming that channel, and the starting content tree remains byte-identical. This is the principal pre-write failure from the [input contract](../../../specs/arch/onboarding/bake.md#^input-contract); the remaining rejection cases are below — *(policy-grade test: `test/node/bake-onboarding.test.ts` “rejects an unknown design channel with a nonzero exit and writes nothing”)*. ^t-bake-rejects
- **Post-write validation failure.** An authored valid frame is baked beside an unbaked channel with an orphan file. The new output is written, the real production validator rejects the resulting tree, and the process reports that error and exits nonzero while leaving the output available. This proves the failure outcome under [Updating the bundled configuration](../../../specs/arch/onboarding/bake.md#Updating-the-bundled-configuration) — *(policy-grade test: `test/node/bake-onboarding.test.ts` “surfaces a post-write validation failure as a nonzero exit, leaving the written output in place”)*. ^t-bake-validation-exit

## Contract assertions

These assertions inspect the packaged tree at the producer side of the
bake-to-installer boundary. Each still invokes the real bake process. Fixtures
are declared below; no mocks are used.

- **Baked content and shell.** Every real manifest card is covered using its flat source file. A Markdown source is copied byte-for-byte. An ordinary frame produces one HTML file containing its independently rendered markup and resolved style in the exact [document shell](../../../specs/arch/onboarding/bake.md#^baked-shell). A skill-backed frame produces a directory containing `index.html` and every permitted top-level skill file except `SKILL.md`; each skill file is copied byte-for-byte. Today's Calendar also contains the production date module, and Company To-dos the to-do store module. No other files are written for these artifacts. Authored frame fixtures cover an absent style block, an explicitly empty block, a nonempty block, the default and explicit canonical-component settings, all five title-escaping characters with the raw title retained in config, and multiple CSS and JavaScript filenames. Skill stylesheets precede skill modules, each group in filename order; their links are relative. These assertions prove [source mapping](../../../specs/arch/onboarding/bake.md#^source-shape-mapping), [frame rendering](../../../specs/arch/onboarding/bake.md#^spec-rendering), and [skill packaging](../../../specs/arch/onboarding/bake.md#^skill-assets) — *(policy-grade tests: `test/node/bake-onboarding.test.ts` “produces, for each source shape, exactly the design source's packaged form”, “escapes HTML special characters in the serialized title and keeps the config title raw”, the three “serializes the exact shell” cases, and “links multiple same-extension skill files in byte order of their names”)*. ^t-baked-content
- **Productivity date module.** Baking the authored Productivity channel copies the production date module byte-for-byte into only `todays-calendar`, and links it before the calendar skill's JavaScript module. The other Productivity documents, Company To-dos among them, receive no date module. This proves the [date-module packaging contract](../../../specs/arch/onboarding/bake.md#^relative-dates-module) — *(policy-grade test: `test/node/bake-onboarding.test.ts` “produces, for each source shape, exactly the design source's packaged form”)*. ^t-relative-dates-module
- **Productivity to-do store module.** Baking the authored Productivity channel copies `packages/server/assets/onboarding-company-todos.js` byte-for-byte into only `company-todos`, and links it with `<script type="module" src="./onboarding-company-todos.js"></script>` as the document's first script, before the canonical components module and the task skill's stylesheet and JavaScript. No other document receives it or its link. This proves the [to-do store module contract](../../../specs/arch/onboarding/bake.md#^todo-store-module) — *(policy-grade test: `test/node/bake-onboarding.test.ts` “produces, for each source shape, exactly the design source's packaged form”)*. ^t-todo-store-module
- **Custom design root.** A fixture root outside the repository design directory contains a manifest, a flat frame with inline style, and a flat Markdown document. The root options select those sources, and the outputs contain the fixture rendering and unchanged Markdown bytes. This proves [Invocation](../../../specs/arch/onboarding/bake.md#Invocation) without relying on production source paths — *(policy-grade test: `test/node/bake-onboarding.test.ts` “renders a flat frame with inline styles and copies flat Markdown from a custom root”)*. ^t-custom-design-root
- **Renderer cache isolation.** A real bake runs with its own temporary-directory environment. The entries of the checkout's shared `node_modules/.vite` cache, compared by name and inode, are unchanged afterwards, and the bake leaves nothing in its temporary directory. This proves [renderer cache isolation](../../../specs/arch/onboarding/bake.md#^renderer-cache) at the spawned-script boundary — *(policy-grade test: `test/node/bake-onboarding.test.ts` “leaves the checkout's shared Vite cache untouched and removes its own cache”)*. ^t-renderer-cache
- **Permitted CSS references.** A frame containing data URLs, same-document fragments, and comments or ordinary quoted strings resembling resource references bakes successfully. CSS escapes and case variations retain the same classification. This proves the exemptions and parsed-construct boundary in [self-contained styles](../../../specs/arch/onboarding/bake.md#^self-contained-styles) — *(policy-grade test: `test/node/bake-onboarding.test.ts` “accepts data: URIs and fragments in either case, and ignores comments and quoted string values”)*. ^t-self-containment-exemptions
- **Configuration and replacement.** New channels append in invocation order with manifest names. A channel already present retains its position and edited name while its artifacts become the manifest order, carrying each authored size, geometry and store declaration, with declarations written in the schema's key order. Replacing that channel removes stale packaged artifacts. The focus channel, unbaked entries, and unbaked folders retain their values and bytes. The config uses the declared key order, two-space indentation, and final newline. Authored fixtures include multiple new channels, an existing non-final channel, and unbaked content. This proves [configuration updates](../../../specs/arch/onboarding/bake.md#^config-update) and [folder replacement](../../../specs/arch/onboarding/bake.md#^folder-rewrite) — *(policy-grade tests: `test/node/bake-onboarding.test.ts` “appends new entries in invocation order with names seeded from the manifests”, whose fixture declares a store authored out of key order, and “rewrites an existing entry's artifacts and folder while keeping its name and position”)*. ^t-config-update

### Rejected inputs

The generated cases in `test/node/bake-onboarding.test.ts` invoke the real
process with one authored defect each. Every case requires a useful diagnostic,
nonzero exit, and byte-identical starting content tree. These are the rejection
branches derived from the [input contract](../../../specs/arch/onboarding/bake.md#^input-contract):

- **Roots:** each root missing or a regular file; content-root equality or containment in either direction with either input root; and overlap reached through a symlink.
- **Starting config:** missing, malformed JSON, a non-object value, missing `channels`, or a non-array `channels`.
- **Channel and manifest:** no requested channel, an unknown channel, a missing or unparseable manifest, a non-mapping manifest or card, an unknown manifest or card field, missing required fields, invalid or blank names/IDs/titles, missing/non-list/empty cards, duplicate card IDs or slugs, malformed channel/card/skill slugs, non-boolean `components`, and invalid shared size or geometry. The shared layout cases retain coverage of wrong types, unknown keys, missing axes, non-finite/non-positive dimensions, and invalid geometry kind or full-screen flag.
- **Store declarations:** a `store` that is not a mapping, and one with an unknown field, without `value`, with a starting value breaking the JSON store's value rules, or with a `shiftDatesFrom` that is not a calendar date in `YYYY-MM-DD` form.
- **Flat sources:** neither `<slug>.frame` nor `<slug>.md` exists, both exist, or a source file is absent from the manifest.
- **Frame declarations and compilation:** each prohibited declaration—`params`, `imports`, `data`, `script`, or `adoptedStyles`—a body composition that imports another frame, and a frame that fails compilation. Parameter coverage includes a defaulted parameter: the contract prohibits parameters, not only required arguments. Composition cases cover explicit and omitted `.frame` extensions; render examples in raw or comment blocks remain inert.
- **Skill files:** a missing or non-directory skill location, a subdirectory, a symlink or other non-regular entry, `index.html`, or a filename outside the allowed pattern. A valid skill-backed frame is covered by the successful packaging assertion.
- **CSS:** `@import` and external resource references, including `url()` and string URL forms in `image-set()` or `src()`; escaped and case-varied identifiers are treated as parsed CSS constructs.

One invocation includes a valid channel followed by a channel whose frame
fails compilation. Its unchanged output tree proves that compilation for all
requested channels precedes replacement of any channel.

The local CSS import and image fixtures include resolvable files, so validation
must reject the authored dependency before Vite can inline it. The rejection
cases are implemented by the “rejects %s and writes nothing” matrix; “keeps
render examples in raw and comment blocks inert” covers the inert composition
examples — *(policy-grade tests)*.
^t-input-contract

### Determinism

- **Contract.** Baking the same channel arguments, frames, Markdown, skill assets, relative-dates and to-do store modules, and starting config into two disposable roots, then rebaking the first, produces byte-identical trees. This proves [determinism](../../../specs/arch/onboarding/bake.md#^determinism) — *(policy-grade test: `test/node/bake-onboarding.test.ts` “produces byte-identical trees across roots and re-bakes”, whose compared trees include both production modules)*. ^t-bake-deterministic
