*Arch spec: the skillbench package — the skill-eval tool: the CLI that runs eval configs and the read-only page for reviewing what agents produced.*

# Skillbench

`packages/skillbench` is the eval tool, whole: point its CLI at an eval config to generate outputs, point its page at the same config to review them. The two halves share nothing but the config and the folders beside it — the CLI writes, the page reads. How skills get made and where eval configs live is [arch/making-skills.md](./making-skills.md); this spec owns the package.

**Status:** CLI and read-only page live (v1). Later phases may migrate editing, running, and job creation into the page, one contract at a time; v1 opens no write paths from the browser.

## The CLI

```bash
npm run skillbench -- path/to/eval.json [--command "<agent command>"]
```

Runs a batch of prompts through an agent command — one fresh process per job, in parallel; the prompt is piped to the agent's **stdin**. `--command` defaults to `claude -p --permission-mode acceptEdits`. The CLI knows nothing about what jobs produce: no output checking, no log capture. Source under `src/` (TypeScript, built to `dist/` by the package build).

### Config

```json
{
  "jobs": [
    {
      "name": "Errands checklist",
      "prompt": "Read the SKILL.md staged in the current directory and follow it. …",
      "cwd": "out/tv-tasks/errands",
      "before_command": "rm -rf out/tv-tasks/errands && mkdir -p out/tv-tasks/errands && cp ../../packages/skills/dist/tv-tasks/SKILL.md … out/tv-tasks/errands/"
    }
  ]
}
```

Per job: `name` (display), `prompt` (literal, no interpolation), `cwd` (the agent's working directory — **must be relative**; it resolves against the config file, which is tracked and runs on many machines, so an absolute path is refused at parse; the job fails if the directory is missing when the agent spawns), `before_command` (optional; run via `sh -c` in the config file's directory before the agent spawns — staging lives here, and the CLI never creates or clears directories itself). A job completes when its agent process exits cleanly; a failed `before_command` fails the job without spawning, and failed jobs report why (exit code, signal, or spawn error) on their settle line. The config is deliberately self-describing: the CLI plus a config path is the entire toolchain.

## The page

Served by the Storybook dev server via this package's `middleware.mjs` (mounted at `/skillbench`, same pattern as the canonical middleware). Loaded by URL:

```
/skillbench/?eval=<repo-root-relative path to the config>
```

The server resolves the path (containment: inside the repo; escapes refuse), loads the config, and the page displays based on the job outputs present beside it — a job folder with no `index.html` reads as not-yet-run, not an error. Routes: the page assets, `GET /skillbench/api/eval?path=…` (config + per-job output presence), and `GET /skillbench/files/<repo-rel>` (artifact serving, path-shaped so artifacts' relative asset links resolve).

The interface — central artifact view, single right rail with the job list and inspector — is owned by its ui spec, [ui/skillbench/index.md](../ui/skillbench/index.md). Sizes for the artifact viewport load from `sizes.json` in this package (not hard-coded; the preserved review viewport dimensions are declared there).

## Package layout

```text
packages/skillbench/
  src/            # CLI source (built to dist/)
  test/           # CLI unit tests (surface unit:skillbench)
  middleware.mjs  # page + API + file serving, mounted by Storybook
  public/         # the page (index.html, app.js, style.css)
  sizes.json      # artifact review sizes
```
