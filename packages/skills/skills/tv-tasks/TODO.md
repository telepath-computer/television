# tv-tasks — follow-ups

Open items for the task component and the artifact it composes into. Previewed
in Storybook (`Skills/Tasks` — run `npm run storybook` from the repo root).

## Features

- [ ] **Checklist progress** — sub-item count (e.g. `1/3`); deferred — no subtask
      model yet

## Follow-ups

- [ ] **Migrate evals to the published runner** — the npm-published
      `@telepath-computer/skillbench` (per-job commands, log capture via stdout
      redirection, cron mode) is the planned replacement for the in-repo
      runner at `packages/skillbench` (a private workspace that happens to
      share the npm name). Blocked on a home for staging: the published one
      requires job `cwd`s to exist at spawn and has no `before_command`.
      Adopt once it grows create-if-missing `cwd` (or a file-level `setup`
      command); until then the in-repo runner stays.

## Open questions

- Keep `area` (a grouping above project) or is project enough?
- Surface a start / scheduled date separate from the due date?
