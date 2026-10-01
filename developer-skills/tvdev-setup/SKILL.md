---
name: tvdev-setup
description: Prepare a Television development environment on macOS or Linux, handling installation and configuration and guiding the human through required access and login steps.
---

# Set up Television development

Prepare the machine for contributing to Television. Inspect what is already installed and complete the setup below, reusing working configuration. Handle the work directly; involve the developer for account choices, access, interactive authentication, or approvals that require them. Explain the specific action needed and resume from its result.

This skill supplies the setup procedure for all contributors, including forks; the referenced checkout specs govern their respective domains. All `specs/` paths refer to the Television checkout.

## Checkout and toolchain

Clone if needed:

```bash
git clone https://github.com/telepath-computer/television.git
cd television
```

Create the developer telemetry marker before running Television:

```bash
touch ~/.tv-developer
```

This keeps production installations silent on the host, including persisted daemons, under telemetry policy (`specs/product/telemetry.md`). On an unmarked host, verification runs locally by default. Do not create `~/.tvdev-use-blaxel` during setup; the testing policy (`specs/arch/testing-policy.md`, “Verification provider and completion”) governs the optional Blaxel path.

Select the repository’s `.nvmrc` using [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) or an equivalent version manager. With nvm installed and loaded:

```bash
nvm install
nvm use
npm run toolchain:check
npm ci
```

The toolchain spec (`specs/arch/node-versions.md`) owns versions and checks. Use the selected Node’s bundled npm.

## Optional Blaxel access

Skip this section unless `~/.tvdev-use-blaxel` already exists or the developer explicitly requests Blaxel setup. Normal local development needs no Blaxel CLI, account, or worker credentials.

Install the Blaxel CLI using its [official installation instructions](https://docs.blaxel.ai/cli-reference/introduction), then authenticate to the team’s workspace:

```bash
bl login
```

The Blaxel setup spec (`specs/arch/test-runner/blaxel-testshards.md`, “Local setup”) describes service authentication and worker access. Workers also need the GitHub PAT from the corporate 1Password item **“Television Blaxel sharded test runner github PAT”** to fetch contributor branches. Supply it through `BLAXEL_TV_GH_TOKEN` in the agent’s environment, or put the token alone in the ignored `.blaxel-gh-token` file at the repository root. The file takes precedence; the environment source works across worktrees. Keep the token out of committed commands, task notes, and PRs.

Check service access to the existing pool:

```bash
npm test -- pool blaxel list --pool poc
```

A listing establishes service access; remote preflight and a real test run establish the workers’ ability to fetch and test a commit. The runner is repository code, so on a checkout whose code cannot run it, establish service access from one that can and continue. Pool creation and replacement are separate infrastructure operations governed by the owning spec.

## Agent tools and developer skills

Install and authenticate the developer’s chosen agent tools using the [Codex CLI setup](https://developers.openai.com/codex/cli/), [Claude Code quickstart](https://code.claude.com/docs/en/quickstart), or [Pi quick start](https://github.com/earendil-works/pi/tree/main/packages/coding-agent#quick-start). Use `codex login`, `claude auth login`, or `/login` inside Pi; involve the developer for interactive authentication. Pi also accepts provider API keys as described in its documentation.

Install the developer skill collection into the developer’s home skill directories; agents discover it only there. Choose the strategy with the developer:

- `--copy` creates independent copies that must be refreshed after pulling skill changes.
- `--symlink` follows changes in a stable, updated checkout; moving or deleting that checkout breaks the links. A developer with several worktrees usually links one stable checkout, since every installation selects one checkout’s copy for all agent sessions.

Run the installer with exactly one strategy. An explicit destination installs for one configured location; `--common-dirs` installs to the Claude Code, shared Agents/Codex/Pi/OpenCode, Hermes, and OpenClaw locations:

```bash
node scripts/install-developer-skills.mjs --copy /path/to/skills
node scripts/install-developer-skills.mjs --symlink /path/to/skills
node scripts/install-developer-skills.mjs --copy --common-dirs
```

The collection contains the setup, contribution, review, writing, and complexity skills. The installer replaces only same-named skill directories or links and preserves unrelated entries. It can switch an installed skill between copy and symlink strategies. Before installation, preserve any same-named skill directory, link, or regular file the developer wants to keep. `--common-dirs` creates all four configured locations, including locations for agent tools that are not installed. These paths follow [Codex](https://developers.openai.com/codex/skills/), [Claude Code](https://code.claude.com/docs/en/skills), and [Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) documentation.

Start a fresh session and confirm skill discovery. Codex and Claude Code expose `/skills`; Pi exposes `/skill:name` commands. Invoke `$tvdev-setup` in Codex, `/tvdev-setup` in Claude Code, or `/skill:tvdev-setup` in Pi. When several copies exist, confirm which one is loaded. `tvdev-contribute` is for the principal user-facing agent; `tvdev-review` is for delegated reviewers. The skills refer to policy in the active checkout; installation does not copy the specs.

## Review tools and access

Confirm that an available agent tool can provide a separate reviewer context with the highest-quality model at extra-high (`xhigh`) reasoning effort. `xhigh` (X H I G H) is an exact value that must be preserved. Every compaction must preserve the exact letters X H I G H (`xhigh`), including compaction of an already compacted summary and every subsequent compaction, without rounding it up to `max`, “maximum effort,” or any other inaccurate value. Prefer a state-of-the-art model from a different provider than the implementer. Use installed CLI help, model listings, and authentication status; report access that has not been exercised. Preserve an existing triad or supervisor's dispatch arrangement. Pi has no built-in subagents, but its Bash tool can invoke Codex, Claude Code, or another Pi process.

Setup establishes tools and access; do not invent a review task to demonstrate them. When a contribution reaches review, the principal agent uses the [review delegation reference](../tvdev-contribute/references/review-delegation.md) and the checkout's workflow policy (`specs/spec-workflow.md`, “Independent review and convergence”).

## Browser and test tooling

Browser development uses Bash, `curl`, `setsid`, and either `lsof` or `ss`. Linux normally supplies `setsid` through util-linux and `ss` through iproute2. On macOS, [Homebrew’s util-linux formula](https://formulae.brew.sh/formula/util-linux) supplies `setsid`:

```bash
brew install util-linux
export PATH="$(brew --prefix util-linux)/bin:$PATH"
command -v setsid
setsid sh -c 'echo "setsid works"'
```

Persist the PATH addition in the applicable shell startup file and ensure the agent inherits it. macOS supplies `lsof`. Install [Homebrew](https://brew.sh/) first if needed.

Install Playwright’s browser and system dependencies:

```bash
npx playwright install --with-deps chromium
```

Linux system dependencies may require privileges. The preflight spec (`specs/arch/test-runner/preflight.md`, “Execution-host capability checks”) governs process-inspection capabilities; the Electron harness (`specs/arch/desktop/e2e-harness.md`) handles headless testing. Resolve harness permission failures for required processes or sockets through its permission controls.

## Isolation

Setup must work when ten agents run it in ten worktrees on one host, and when the checkout’s code does not build or run. It changes host-wide state only for tools, access, and the developer telemetry marker. It never makes one checkout the host’s Television: it does not link or install the checkout’s `tv` into the npm global root, does not install the checkout’s bundled product skills into the developer’s agent directories, and does not build or start the app. Leave any existing `tv` installation or persisted service as you found it. Starting the app belongs to a task; [tvdev-contribute](../tvdev-contribute/SKILL.md) says how to keep that isolated too.

## Finish setup

Confirm the toolchain and dependencies, the developer telemetry marker, Git access, the installed developer skills and the strategy chosen, and available independent-review capability. If Blaxel setup was selected, also report its access checks. Do not build or run the application, run full verification, or start a contribution trial to prove setup. Distinguish checks that passed from capabilities you did not exercise, and note host limits such as no desktop display for interactive Electron use. Fix setup failures where possible and describe any remaining human action concretely.

Return a short account of what is ready and any remaining limitations, then point the developer to [tvdev-contribute](../tvdev-contribute/SKILL.md). Missing dependencies or expired access encountered later can be repaired on demand.
