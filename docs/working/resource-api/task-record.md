# Resource API: task record for the public branch

This record holds decisions and work on `thopter/resource-api` after the change moved to this repository. The change's design proposal and implementation plan are archived under `docs/archive/2026-10/resource-api/`.

## Avoiding localStorage in the agent guidance

**Josh's decision**, 2026-10-08: skew the agent guidance toward using the artifact's JSON store for state, and advise avoiding localStorage. localStorage works today, but it may break in a future Television release, so the guidance does not present it as a good choice for any kind of state. The change covers the guidance spec and the skill text: the `television` skill's introduction and `resources.md`, and `tv-tasks` wherever it mentions localStorage.

It replaces the guidance's earlier rule that localStorage remains the right tool for state that belongs to one client, such as the active tab or unsaved text in a text area.

- **The guidance spec** (`specs/arch/resources/guidance.md`):
  - `^rg-purpose` makes the JSON store the place for an artifact's state and advises avoiding localStorage for any state, since a future release may break it. State that only matters while the page is open stays in the page; state that should survive a reload or a change of channel, such as text typed but not yet submitted, goes in the JSON store, which every client viewing the artifact shares. The rule against calling the store a better option than localStorage, or a replacement for it, stands.
  - `^rg-teaches`' first item teaches when state belongs in the page or the artifact's files, and to avoid localStorage.
  - `^rg-tv-tasks` tells the agent not to keep a to-do list in localStorage, saying that it may break in a future release.
- **The proof** (`proofs/arch/resources/guidance.md`) checks the new wording in `^rg-t-purpose`, `^rg-t-teaches` and `^rg-t-tv-tasks`. `^rg-t-purpose` adds a bounded check that every sentence naming localStorage in the shipped skills says what it cannot do, that it is broken, or that it is to be avoided.
