---
description: The `tv` CLI command surface plus the focus story — model, required decisions, theory of mind, phrase cues, and channel placement.
---

# TV CLI capabilities

Use this document when you need to reason about what the `tv` CLI can do, which command family fits the user's request, and how focus and channel placement should be decided.

## Agent recovery surfaces

The `television` skill is the primary guidance surface for Television channels, focus, and artifact work. Keep that guidance available; re-read it only if it is not already in context or you know it changed.

Install bundled Television skills with either:

```bash
tv skills install ~/.openclaw/skills
tv skills install ~/.hermes/skills
tv skills install ~/.agents/skills
tv skills install -i
```

`tv help` is normal CLI help plus routing pointers.

## Command surface

Run:

```bash
tv help
tv help <command>
```

`tv help <command>` is the source of truth for per-command semantics that are not obvious from the name — focus decisions, cascading effects, JSON vs plain-text output, and distinctions between superficially similar commands (delete-artifact vs remove-channel, focus-channel vs focus-artifact). Read it before choosing a command when you are unsure.

Commands group into four intents:

- **Channel and display commands** — create, inspect, rename, remove, or switch channels, or change the active display theme (`create-channel`, `list-channels`, `get-channel`, `update-channel`, `remove-channel`, `focus-channel`, `focus-status`, `set-theme`).
- **Artifact creation commands** — register path or URL artifacts (`create-path-artifact`, `create-url-artifact`).
- **Artifact management commands** — inspect, retitle, repoint, focus, list, or delete existing artifacts (`delete-artifact`, `get-artifact`, `list-artifacts`, `update-artifact`, `focus-artifact`).
- **Server and environment commands** — operate on the Television server and its home (`serve`, `status`, `stop`, `config`, `themes-path`, `telemetry`, `skills install`).

When the CLI rejects a command, follow the directive it prints rather than guessing flags.

### Server operation notes

Each `tv` command works with one Television home, the directory that holds an installation's config file, token, channels, artifacts, themes, and logs. A command uses the home given with `--home <path>`, otherwise the path written in `~/.tv-home`, otherwise `~/.television`. `--home` applies only to the command that receives it, so when you work with a home other than the default, pass the same `--home` to every command. The server and commands share the settings in the home's optional `config.json`; `tv config show` prints the selected home and its effective settings.

`tv status` reports the selected home, server health, and, when supported, system service status. Commands that contact the server connect to `localhost` on the config file's port, with the token from `<home>/state/token`; there is no `--server` option. They take `--port <number>` only when the config file sets port `0`, and then require it, using the port from the server's startup URL. `tv themes-path` prints the home's themes directory.

Starting, installing, upgrading, or reconfiguring the server — `tv serve`, `tv config set`, listeners, auth and tokens, ports, the persistent service (`--persist`), stopping and uninstalling (`tv stop`) — is administrator work covered by the deployed admin guide, not this skill. Before doing any of it, fetch the full raw guide as described in the Administration section of this skill; do not work from the command names alone or from a summary.

## Read vs mutate

Read commands print JSON. Workflow commands and most mutation commands print plain text. On success, `tv set-theme` prints one of these forms:

```text
Active theme changed from '<previous>' to '<new>'.
Active theme unchanged: '<selection>'.
Active theme: '<new>'.
```

The first two forms are available when the opening selection read succeeds. The third confirms activation when that read is unavailable. Theme labels preserve exact installed theme IDs and use `None` for no theme. `tv serve` startup output is human-readable connection text.

Use read commands when you need authoritative state for planning or verification. Use mutation commands when you are intentionally changing Television state.

## Focus model

Television separates state changes from focus. Choosing where an artifact lives is one decision; choosing whether the user's attention moves there is a separate one.

- **channel focus** is persistent: which channel the user is currently looking at
- **artifact focus** is transient: clients select the artifact's tab page, switching channels first when needed

There is a persisted focused channel.
There is not a persisted focused artifact.

Important consequence: creating something does not by itself answer whether the user should be taken to it now.

## Required explicit focus decisions

Create commands require an explicit focus decision.

- `tv create-channel` requires exactly one of `--focus-channel` or `--no-focus`
- `tv create-path-artifact` and `tv create-url-artifact` require exactly one of `--focus-artifact` or `--no-focus`

If you omit that decision, the CLI rejects the command. Dedicated `focus-channel` and `focus-artifact` commands can also move attention later as separate steps.

## Choosing the focus directive

Think about the user's current attention stream before deciding. Use theory of mind: what are they probably attending to right now? Do they expect an immediate reveal, or would moving their view feel jarring? What will they likely want to do next?

Rules of thumb:

- **focus now** when seeing the result immediately is part of successfully answering the request
- **`--no-focus`** when the user is likely to want the result available without breaking their current flow, or when the work should run in the background
- **direct `focus-channel` / `focus-artifact` commands** when placement and attention movement should happen as separate steps

When your action would not be visually obvious to the user — you used `--no-focus`, you placed something on a non-current channel, or you moved focus — tell them what you did, name the channel, and say what they should see. Otherwise the Television display may not change in a way they can interpret.

## Listening for focus intent in the user's language

The user's phrasing is a strong cue — not a deterministic rule, but a real signal worth listening for.

Phrases that usually indicate the user wants attention moved:

- "show me", "show me that", "let me see it", "let me review it"
- "switch to", "change to", "go to", "take me there", "open it"
- "put it on screen", "put it on my screen", "bring it up"
- references to the **active**, **current**, **showing**, or **visible** channel or artifact

Phrases that usually indicate the user wants the work to happen without disturbing their current view:

- "in the background", "while I'm doing X", "while I work on Y go and do Z"
- "set this up", "prepare it", "wire it in", "get it ready"
- "don't interrupt me", "leave my screen alone", "don't switch"

These are illustrative, not exhaustive. When the language is ambiguous or unusual, reason about the user's attention stream instead of pattern-matching keywords.

## Channel placement

Artifact creation commands require `--channel` because new artifacts need immediate channel membership. Reordering an artifact's tab page on its current channel is a browser UI tab-drag gesture; the CLI does not expose layout mutation today. To move the same underlying path or URL to a different channel, delete the old artifact and create a new artifact on the target channel with the same path or URL.

Think carefully about whether the user means:

- create something new on a channel
- reorder an artifact's tab page on its current channel in the browser UI
- delete an artifact from its channel
- recreate the same path or URL on a different channel

Those are different operations with different consequences. The per-command help text spells out which is which.

### Choosing the right channel

When deciding where an artifact should go:

- If the current channel is the right place and the user should see the result immediately, create the artifact there with `--focus-artifact`.
- If the current channel is the right place but the work should appear without interrupting their reading flow, create it with `--no-focus`.
- If the work belongs on a different existing channel, place it there. Then decide whether to focus or merely tell the user where it is.
- Sometimes a new channel is the right call.

### When to create a new channel

Reach for `tv create-channel` when:

- the request is meaningfully separate from the current channel's purpose
- the result should become its own durable workspace the user can return to
- mixing it into the current channel would make the user's mental model worse

Default to placing things on an existing channel unless one of those conditions is true. Spawning a new channel for every request fragments the user's workspace; spawning none ever forces unrelated content together.
