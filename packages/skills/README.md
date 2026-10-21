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
    tv-table/
    tv-tasks/
  scripts/
    build.mjs              # central copier + validator
  dist/                    # emitted bundled skill collection
  onboarding-dist/         # calendar and task browser files for onboarding
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

The package build also puts calendar and task browser files under
`packages/skills/onboarding-dist/`. The onboarding bake copies those files
into its artifact pages. `packages/cli/build.mjs` copies only
`packages/skills/dist/` into `packages/cli/dist/skills/`.

To try a skill with a real agent, install the bundled collection into an agent
skills folder with `tv skills install <path>` (see the [CLI product spec](../../specs/product/cli.md)),
or copy `packages/skills/dist/<name>/` there directly.

## Shipped skills

- `television/` is a built skill. `scripts/build.mjs` concatenates the primary
  source fragments under `src/` into `dist/SKILL.md` and emits the supporting
  `theming.md`, `resources.md`, and `templates.md` guides.

The `tv-calendar` and `tv-tasks` source folders provide browser
components. They build into `onboarding-dist/` and are not installed as agent
skills. The `tv-table` source is also not part of the shipped skill collection.

## Authoring new skills

Create `skills/tv-<name>/SKILL.md` with YAML frontmatter carrying non-empty
`name` and `description` (the build validates this on every emitted skill).

Then register the skill by adding its directory name to `skills.json` —
unlisted directories are not bundled.

If the skill needs a build step, add a `package.json` with `scripts.build` and
make it emit `dist/SKILL.md` plus any runtime assets. If it does not, keep the
skill flat at the source root.
