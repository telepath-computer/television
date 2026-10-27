*Onboarding content and server packaging: the bundled content tree under `packages/server/assets/onboarding-channels/`, the onboarding config schema that orders channels and artifacts and declares the starting values of their stores, slug rules, and server build-time validation.*

**Status:** adopted version-3 content and packaging authority; the source tree and validator conform.

# Onboarding content & server packaging

Starter channels begin as files bundled with Television. This document defines how those files are organized and checked before the server build hands validated content to the CLI package.

## What this owns

This spec owns the source-of-truth layout for bundled onboarding content, the *onboarding config* schema, including the starting value an artifact declares for its store, the slug rules that give channels and artifacts stable identity, and server build validation. How the CLI ships and resolves the validated server output is owned by [arch/cli/index.md#Build and packaged asset layout](../cli/index.md#Build and packaged asset layout). How the shipped content is installed at runtime is owned by [installer.md](./installer.md).

The onboarding artifact UI spec owns design sources for example channels ([ui/onboarding-artifacts/index.md](../../ui/onboarding-artifacts/index.md)). A design becomes shipped content only when an author ports it into this package's config and content tree through the manually run bake ([bake.md](./bake.md)). The committed package remains the authority for what a release installs.

## Content tree

Onboarding content lives in the server package at `packages/server/assets/onboarding-channels/`:

```
packages/server/assets/onboarding-channels/
  onboarding-channels.json        the onboarding config (schema below)
  <channel-slug>/                 one folder per onboarding channel
    <artifact-slug>.html         single-file HTML artifact, or
    <artifact-slug>.md           single-file markdown artifact, or
    <artifact-slug>/             directory artifact with its own assets
      index.html                 required entry document
      ...                        css/js/images referenced relatively
```

- **Folder name = channel slug.** The folder name is the *channel slug*: the stable identity key for that onboarding channel across releases and data directories. It never changes once shipped; renaming a folder is indistinguishable from deleting one channel and adding another, so existing installations receive the renamed folder as a different channel. ^slug-is-folder
- An artifact is one of three *source shapes*, each named by its *artifact slug*: a single `.html` file, a single `.md` file, or a folder containing `index.html` plus assets it references relatively. These mirror the path-artifact shapes Television renders.
- Content is self-contained: documents reference only sibling assets and Television's canonical stylesheet routes. Nothing in the tree is fetched from the network at install time.
- The production tree contains only deliberately shipped channels. The shipped set is defined solely by this config and content tree and pinned once by `test/helpers/shipped-onboarding.ts`. A channel's content is either **swap-free** — tests derive expectations from the config and packaged sources at runtime — or deliberately pinned released copy. The content-tree root `README.md` records which rule applies to each channel. Fake channels live in test fixtures. ^no-placeholder-content
- `tv-guide/welcome.html` is baked from its UI design source. It loads `/canonical/v2/styles.css` and `/canonical/v2/components.js` and uses canonical v2's live public token vocabulary. ^welcome-document

## Slugs

Channel slugs and artifact slugs:

- match `^[a-z0-9][a-z0-9-]*$`;
- contain no consecutive hyphens (`--`).

Installed artifacts' copied content is named by joining the two slugs with `--` ([copy names](./installer.md#^artifact-ids)), so banning `--` inside either slug keeps those names unique. ^slug-rules

## Onboarding config

`onboarding-channels.json` owns channel install order, the designated focus channel, display names, artifact titles, each channel's initial tab-page order, each page's initial size and geometry, and the starting value of each artifact's store that has one.

```ts
type ChannelSlug = string;  // slug rules above
type ArtifactSlug = string; // slug rules above

interface OnboardingConfig {
  version: 3;                          // artifact-order tab-page schema
  focusChannel: ChannelSlug;           // TV Guide on fresh installations
  channels: OnboardingChannelConfig[]; // array order = channel install order
}

interface OnboardingChannelConfig {
  slug: ChannelSlug;                      // equals the channel folder name
  name: string;                           // created channel's display name
  artifacts: OnboardingArtifactConfig[]; // array order = initial tab-page order
}

interface OnboardingArtifactConfig {
  slug: ArtifactSlug; // resolves to <slug>.html, <slug>.md, or <slug>/index.html
  title: string;
  size?: PageSize;         // initial reference-pixel size; shared default when absent
  geometry?: PageGeometry; // initial page mode; shared default when absent
  store?: OnboardingStoreConfig; // the starting value the installer writes to this artifact's store
}

interface OnboardingStoreConfig {
  value: JSONValue;        // the store's starting value
  shiftDatesFrom?: string; // a calendar date, YYYY-MM-DD: the installer shifts the value's dates from it to the installation day
}
```

`JSONValue` is the [JSON store's](../resources/json-store.md#^js-arch-sdk). Any artifact may declare a store, since every installed artifact has [a store](../resources/index.md#^rs-has-store), whatever its source's kind; a Markdown artifact's starting value is useless but allowed. Its starting value obeys the [JSON store's value rules and limits](../resources/json-store.md#^js-arch-values), and `shiftDatesFrom`, when present, is a valid calendar date in `YYYY-MM-DD` form. The data's structure and rules are described by a comment in the artifact's own code, as for any artifact's store. How the installer writes a declared starting value is [installer.md](./installer.md#^onboarding-store-install)'s. ^onboarding-store-config

### Initial tab pages

Each artifact entry produces one tab page, and the `artifacts` array is the page order. An entry may carry the page's `size` and `geometry` using the exact shared `PageSize` and `PageGeometry` shapes from [arch/layout/index.md](../layout/index.md). Either field may be omitted independently; the installer then supplies that field's shared default. `size` is measured in reference CSS pixels, may be fractional, and follows the shared finite-positive validation with no authored ceiling. Rendering applies the stage bounds: the artifact-frame floor is 230 × 230 CSS pixels when the page box can hold it, and the page box wins when smaller ([stage bounds](../../ui/app/stage/index.md#bounds)). Stage 1 geometry is `{ kind: "single", full_screen: boolean }`. Artifact records and initial pages therefore correspond one-to-one without a second ordering structure; the config stores no row, stack, membership, or separate layout tree. ^layout-config

A live stage-1 channel ports directly into this format. Capture it with `tv get-channel`, traverse the channel's ordered pages, and add each page's sole artifact to `artifacts` in that order with its chosen permanent slug and title. Copy each page's `size` and `geometry` onto the artifact entry, and copy each artifact's content into the matching channel folder. Drop runtime channel identity, marker, layout version, and artifact membership; the installer creates fresh identity and derives membership from the entry. Only path artifacts port. ^layout-portability

Rules:

- Version 3 is the only live schema. Bundled config and readers move in lockstep; earlier versions are not runtime inputs.
- The config is plain JSON.
- `slug` values are identity. `name`, `title`, artifact order, `size`, and `geometry` may change between releases, but changes affect only data directories that have not received that channel ([onboarding-channels.md#^fire-and-forget](../../product/onboarding/onboarding-channels.md#^fire-and-forget)).
- `channels` is non-empty, and `focusChannel` names a configured channel. The production config names `tv-guide`.
- Each channel has at least one artifact. Channel slugs are unique; artifact slugs are unique within a channel.
- `name` and `title` are non-empty after trimming.
- Artifact entries and store declarations reject unknown keys. When present, `size` and `geometry` obey the shared tab-page validation exactly; the config does not define a second layout shape.

Illustrative config shape; the production config remains the authority for what ships:

```json
{
  "version": 3,
  "focusChannel": "example-guide",
  "channels": [
    {
      "slug": "example-guide",
      "name": "Guide",
      "artifacts": [
        { "slug": "intro", "title": "Introduction" }
      ]
    },
    {
      "slug": "example-workspace",
      "name": "Workspace",
      "artifacts": [
        {
          "slug": "overview",
          "title": "Overview",
          "size": { "width": 960, "height": 640 }
        },
        {
          "slug": "notes",
          "title": "Notes",
          "geometry": { "kind": "single", "full_screen": true }
        }
      ]
    }
  ]
}
```

## Server package build

The server package build (`packages/server/scripts/build.sh`) copies the whole `assets/onboarding-channels/` tree into `packages/server/dist/onboarding/` and **fails the build** if validation fails. The validator takes the content-tree root as an explicit input, allowing tests to run its real entry point over fixture trees without replacing the build mechanism. Validation asserts: ^build-validation

- `onboarding-channels.json` exists, parses, and conforms to version 3, including non-empty channels and artifacts, non-empty names and titles, a known focus channel, exact artifact-entry keys, valid optional page size and geometry, and valid store declarations;
- every slug satisfies the slug rules;
- every configured channel slug has a matching folder;
- every configured artifact resolves to **exactly one** source shape — `<slug>.html`, `<slug>.md`, or a `<slug>/` directory;
- every directory artifact contains `index.html` at its root;
- channel slugs are unique, and artifact slugs are unique per channel;
- no unconfigured channel folder or artifact source is present.

The content-tree root `README.md` is the one permitted unreferenced file.

A clean bake copies `THIRD-PARTY-NOTICES.txt` into a committed skill-backed
artifact when that skill's built distribution contains one. The current
`company-todos` artifact includes the file; `todays-calendar` does not because
the calendar distribution has no notices to carry. Build validation does not
compare the committed tree with a fresh bake; the committed package is what
ships ([what this owns](#What this owns)).
