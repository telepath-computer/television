# CLI trim: round 1 context

- **Area:** CLI.
- **Specs:** `specs/product/cli.md`, `specs/arch/cli/index.md`, `specs/arch/cli/startup-bind-failure.md`, `specs/arch/cli/admin-guide.md` (unchanged).
- **Base commit:** `f6cdd91e417e1f94c8617baebb016e921c21d6e5` (`git merge-base HEAD origin/thopter/spec-tightening`). See the trim with `git diff f6cdd91e..HEAD -- specs`.
- **Round:** 1, so there is no previous review.

## What the trimmer intended

The product spec is mostly the CLI's contract with the people and agents who run `tv`: commands, options, output text and JSON, exit statuses, the home and config file people write, and compatibility with services and data from earlier releases. Most of it was kept. Cuts there remove restatements of rules owned elsewhere in the same spec or by tab-pages, making-skills and the connect-link definition, plus a few statements that describe absent features.

The architecture spec lost the most. The table of exact `TelevisionClient` calls per command was replaced by three bullets that keep only the call orderings the product spec leaves open (`tv status`, `tv links`, `tv set-theme`), on the policy ground that the shared client is internal to the product's running code. Restatements of product rules (config validity, `tv config set` parsing, retired-option ordering, the transitional service path, the legacy-variable warning, link formatting, persisted environment contents, set-theme output, health-wait acceptance, skills install) were cut or reduced to pointers. The build's 16-step list became a list of what the package ships. Process instructions and a section that restated which commands read the config were removed.

The startup bind-failure spec lost its forward plan for splitting into a server spec tree, its non-goals list of future work, and history framing ("is unchanged", "the existing"). The rationale for all-or-nothing startup was kept and rewritten more plainly.

No citation was repointed in another file. Block ref `^cli-home-only-commands` was removed with its paragraph; nothing cites it (the proof's `^cli-home-only-commands-contract` is a different anchor).

Mismatches the trimmer found between spec and code are not fixed in this branch; they will be reported in the review document.
