*Developer skill distribution: the editable source collection and its installation into agent skill directories under the developer’s home.*

# Developer skill distribution

A checkout carries the developer skills its agents need. Maintainers edit one collection, and each developer installs that collection into the skill directories of the agent tools they use.

## Sources

`developer-skills/` is the single editable source. Each skill is a directory containing `SKILL.md` and its supporting files. `developer-skills/README.md` documents maintenance and is not a skill.

## Home installation

`node scripts/install-developer-skills.mjs (--copy | --symlink) (<destination> | --common-dirs)` requires exactly one strategy and one destination form, with no default. Invalid or conflicting arguments fail before filesystem changes. `--help` prints usage without installing. ^developer-skill-install-arguments

An explicit destination names an agent's skills directory. `--common-dirs` targets four directories under the invoking user's home: `.claude/skills`, `.agents/skills`, `.hermes/skills`, and `.openclaw/skills`. Codex, Pi, and OpenCode share `.agents/skills`. The command creates all four locations whether or not the corresponding agent tool is installed.

Copy installation copies each complete skill directory. Symlink installation creates one link per skill directory to its absolute source directory in the selected checkout. Both strategies replace same-named installed directories or links and preserve unrelated entries. Switching strategies unlinks existing skill links without traversing them or modifying their source. Dangling skill links can be replaced. Same-named regular files and symlinked destination roots are refused; destinations that would overwrite or install into the source collection are refused. All destinations are checked before replacement begins. ^developer-skill-install-filesystem

Agents discover the developer skills through this installation. Setup installs the collection into the developer's home with the strategy the developer chooses, explains the difference, and reports its scope: copies require explicit refreshes after the source changes; symlinks follow edits and updates to a stable checkout that must remain at its path.

## Testing

Exercise installation and switching against real temporary filesystem trees. Tests must not install into the developer's actual home directories. Demonstrate that switching away from a symlink leaves its target intact.
