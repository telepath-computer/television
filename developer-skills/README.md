# Maintaining developer skills

Edit skills in this directory. Each skill is a directory containing `SKILL.md` and its supporting files. Agents use the skills through an installation into the developer's home skill directories, so after changing a skill, developers who installed copies rerun the installer; symlink installations follow the edit.

The installer requires an explicit strategy and destination:

```bash
node scripts/install-developer-skills.mjs --copy /path/to/skills
node scripts/install-developer-skills.mjs --symlink /path/to/skills
node scripts/install-developer-skills.mjs --copy --common-dirs
```

`--common-dirs` targets the supported skill directories under the current user's home. Copy and symlink modes replace only these developer skills and preserve unrelated entries. Copies need refreshing after source updates. Symlinks follow a stable checkout as it changes. `specs/arch/developer-skills.md` owns the mechanics.
