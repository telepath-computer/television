# Resource API: task record for the public branch

This record holds decisions and work on `thopter/resource-api` after the change moved to this repository. The change's design proposal and implementation plan are archived under `docs/archive/2026-10/resource-api/`.

## Where an artifact's state lives, in the agent guidance

**Josh's first brief**, 2026-10-08: skew the agent guidance toward using the artifact's JSON store for state, and advise avoiding localStorage. localStorage works today, but it may break in a future Television release, so the guidance should not present it as a good choice for any class of state. It covered the guidance spec and the skill text: the `television` skill's introduction and `resources.md`, and `tv-tasks` wherever it mentions localStorage. A first spec, proof and test revision followed it, keeping rules about which kinds of state go where (the active tab in the page, text not yet submitted in the JSON store).

**Josh's direction**, the same day, replaces that brief. Guidance informs the agent's judgment; it is not a set of rules. It drops rules about what kinds of state go where, such as tabs, form input or per-viewer state, since those depend on what the person wants. The guidance says, in substance:

- the JSON store provides durable, multi-client, agent-readable storage, inspired by Firebase's Realtime Database;
- localStorage is also available but highly discouraged, because it may be removed in a future version of Television;
- Markdown artifacts can also act as shared, synchronized, editable state, but they lack the presentational flexibility and interactivity of HTML;
- state can also live in the third-party APIs or external services an artifact integrates with, depending on the design, the use case and the person;
- the agent decides; for a to-do list, the standard choice is the JSON store, said as information, not as a rule.

The spec and its tests keep to that substance, not to enumerated cases, and existing passages that classify state the same way are removed.

How it is carried through:

- **The guidance spec** (`specs/arch/resources/guidance.md`):
  - `^rg-purpose` lists the substance above and says that the guidance sets no rules about which kinds of state go where. It replaces the guidance's earlier rules: that keeping shared or agent-read state in localStorage is fundamentally broken, that a to-do list almost certainly belongs in a JSON store, that localStorage remains the right tool for one client's state, and that the guidance never calls the store a better option than localStorage or its replacement.
  - `^rg-document`'s pointer sends the agent to `resources.md` when an artifact needs to keep state, or when the person mentions JSON stores or resources.
  - `^rg-teaches` no longer teaches when to use a JSON store and when state belongs elsewhere, so `resources.md` loses its "When to use a JSON store" section.
  - `^rg-tv-tasks` describes the JSON store as the opening does, calls it the standard choice for a to-do list's data, and says that localStorage is available but highly discouraged.
- **The wording on Firebase** stays under `^rg-firebase`: the store is "inspired by Firebase's Realtime Database", never "Firebase-like".
- **The proof** (`proofs/arch/resources/guidance.md`) checks the substance in `^rg-t-purpose`, with a bounded check that every sentence naming localStorage in the shipped skills calls it highly discouraged, and in `^rg-t-tv-tasks`; independent guidance review judges that the guidance sets no rules about which kinds of state go where.
