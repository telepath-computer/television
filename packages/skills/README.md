# Television skills

`packages/skills/` is the source and build workspace for Television's bundled
agent skills.

## Layout

```text
packages/skills/
  skills.json              # manifest of bundled skills (the source of truth)
  skills/                  # source folders; skills.json selects shipped entries
    television/
      src/html-artifact-style.md
      src/theming.md
    tv-calendar/
    tv-sidebar-view/       # non-shipping prototype, omitted from skills.json
    tv-table/
    tv-tasks/
  scripts/
    build.mjs              # central copier + validator
  dist/                    # emitted bundled skill collection
```

`skills.json` lists the bundled skills explicitly. A directory under
`skills/` that is not listed there is ignored by the build (with a log
line), so stray directories — stale checkouts, gitignored build residue
from other branches — cannot break or leak into the bundle. A listed
skill with no source directory fails the build.

## Source rules

- Unbuilt skills keep `SKILL.md` at the source root.
- Built skills are responsible for emitting `dist/SKILL.md` and any supporting files their primary guidance references.
- Every emitted `SKILL.md` must have YAML frontmatter with non-empty `name`
  and `description`.
- `example/` directories are source-only reference material and are never bundled.

## Bundle rule

The central build (`npm --workspace @telepath-computer/television-skills run build`)
reads the manifest (`skills.json`) and applies one rule per listed skill:

1. If the skill has a `package.json` with `scripts.build`, run that build and
   copy `<skill>/dist/*` to `packages/skills/dist/<name>/`.
2. Otherwise, copy the source root directly to `packages/skills/dist/<name>/`,
   excluding `example/`, `docs/`, `src/`, `node_modules/`, `package.json`,
   dotfiles, `*.config.*`, `tsconfig.json`, and `playwright.config.ts`.
3. Validate every emitted `dist/<name>/SKILL.md`.

`packages/cli/build.mjs` copies `packages/skills/dist/` verbatim into
`packages/cli/dist/skills/`.

To try a skill with a real agent, install the bundled collection into an agent
skills folder with `tv skills install <path>` (see the [CLI product spec](../../specs/product/cli.md)),
or copy `packages/skills/dist/<name>/` there directly.

## Shipped skills

- `television/` is a built skill. `scripts/build.mjs` concatenates the primary
  source fragments under `src/` into `dist/SKILL.md` and emits the supporting
  theme-authoring guide as `dist/theming.md`.
- `tv-calendar/` is a built skill. Vite emits `dist/calendar.js`,
  `dist/calendar.css`, and a copied `dist/SKILL.md`.
- `tv-table/` is a source-copied skill. Its root `SKILL.md` is bundled
  directly.
- `tv-tasks/` is a built skill (`package.json` + a Vite build). It emits
  `dist/task.js`, `dist/task.css`, and a copied `dist/SKILL.md`.

## Previewing and evaluating skills

A skill with authored Storybook staging or empirical evals keeps those records under
`storybook/stories/skills/<skill>/` and `storybook/skill-evals/<skill>.json`; see
`specs/arch/making-skills.md`. A `Preview` leaf embeds skillbench over that skill's eval
outputs. Storybook mounts the built `packages/canonical/dist/canonical` root at
`/canonical`; build the canonical package before starting Storybook.

These records are optional development evidence, not bundle membership. The explicit
example is `tv-sidebar-view`: it has prototype spec, story, and eval records while
remaining absent from `skills.json` and therefore absent from shipped output.

## Authoring new skills

Create `skills/tv-<name>/SKILL.md` with YAML frontmatter carrying non-empty
`name` and `description` (the build validates this on every emitted skill).

Then register the skill by adding its directory name to `skills.json` —
unlisted directories are not bundled.

If the skill needs a build step, add a `package.json` with `scripts.build` and
make it emit `dist/SKILL.md` plus any runtime assets. If it does not, keep the
skill flat at the source root.
