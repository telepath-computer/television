*Developer skill installation proven through real temporary homes and installer processes.*

# Developer skill distribution — proof

Proves [specs/arch/developer-skills.md](../../specs/arch/developer-skills.md).

## Coverage model

Acceptance tests invoke the real installer command in temporary checkouts with authored skill files. They inspect complete filesystem results and exit statuses without replacing filesystem or process mechanisms. Common-directory installation supplies a temporary home path to the exported installer entrypoint; no actual host skill directories are used. Review assesses the setup conversation; tests prove delivery mechanics, not agent judgment or harness discovery.

The CLI fixture is invoked through a directory symlink, exercising checkout path aliases while installed skill links target the canonical source directory.

## Test hooks

The exported `installDeveloperSkills` entrypoint accepts `homeDir` for a temporary home fixture. The CLI uses `os.homedir()`; the source collection remains relative to the script's checkout.

## Assertions

- **Acceptance:** installer commands reject absent, duplicate, or conflicting strategies and destination forms without creating a destination; help succeeds without installation. Covers [arguments](../../specs/arch/developer-skills.md#^developer-skill-install-arguments). *Covered by `test/repo/developer-skills.test.ts` “requires exactly one strategy and destination form”.* ^ds-arguments
- **Acceptance:** copy and symlink installation preserve unrelated entries, carry supporting files, remove stale same-skill files, and switch both ways, including from a dangling link, without modifying linked source trees. Copies remain independent; links observe source updates. Covers [filesystem](../../specs/arch/developer-skills.md#^developer-skill-install-filesystem). *Covered by `test/repo/developer-skills.test.ts` “switches strategies without changing link sources or unrelated entries”.* ^ds-switching
- **Acceptance:** common-directory installation reaches exactly the four specified directories in a temporary home. Conflicting destination files, linked destination roots, and source-overlapping destinations fail before replacing any skill. Covers [arguments](../../specs/arch/developer-skills.md#^developer-skill-install-arguments) and [filesystem](../../specs/arch/developer-skills.md#^developer-skill-install-filesystem). *Covered by `test/repo/developer-skills.test.ts` “installs common directories and preflights unsafe destinations”.* ^ds-destinations
