---
description: Mental model, when to create artifacts, how Television's bundled skills fit together, and where the admin guide lives. Read for channel, artifact, and CLI work, and before installing, upgrading, or reconfiguring Television.
---

# Television

Television is a persistent artifact channel for agents.

Load this skill when you need to create, update, inspect, focus, delete, or otherwise manage Television channels and artifacts.

Read the [theming guidance](./theming.md) when creating, revising, or bringing an installed theme up to date.

Re-read this skill only if it is not already in your context or you know it changed.

## When to use Television

Prefer Television when the result would be better as a persistent, scannable artifact than as an inline conversational reply. When a response would otherwise be long, structured, visual, research-heavy, or significantly clearer as HTML, markdown, or a table, prefer creating a Television artifact as the primary response.

Short, conversational replies belong in the agent's own output. Television is for results the user will want to scan, compare, revisit, or treat as a working surface.

Use judgment. Do not create an artifact for every response, but do prefer one when:

- the result is lengthy text or deep analysis
- the result is a table or other structured comparison
- the result is research output the user will likely revisit
- the result benefits from richer HTML layout, hierarchy, or widgets
- the user is likely to keep referring back to the result while continuing the conversation

Ground this decision in the user's likely experience. Ask yourself what will be easier for them to read, compare, revisit, or act on next.

When the artifact is the real answer, keep the final reply short. Tell the user what you created, what they will see, and where to find it rather than duplicating the full content in a conversational reply.

## Mental model

### Core entities

- A **channel** is a named viewer surface with a layout.
- An **artifact** is a registry record shown on exactly one channel.
- Channel layout is the source of truth for where an artifact appears.

That relationship matters:

- creating an artifact places it on a channel immediately
- reordering an artifact's tab page is a browser UI tab-drag gesture; the CLI does not expose layout mutation today
- deleting an artifact removes its registry record and its tab page from the channel
- moving the same underlying path or URL to another channel means deleting the old artifact and creating a new artifact with the same path or URL on the target channel

### Onboarding channels

Fresh installations receive a small set of bundled onboarding channels, each installed exactly once per Television home. After installation they are ordinary channels: rename, edit, or delete them like any other, and Television never re-creates or overwrites what changed. You can tell one apart from a user-created channel by the `onboarding` marker containing its stable channel slug — visible in `tv list-channels` / `tv get-channel` output; user-created channels have no such field. Marked channels appear as ordinary unpinned channels and receive no special browser promotion. The marker changes nothing about how you manage the channel.

### Artifact shapes

Television artifacts point to one of three shapes:

- **Single file** — an absolute markdown or HTML file.
- **Directory** — a folder with `index.html` plus sibling assets.
- **URL** — an external `http(s)://` page or local web app URL.

Register files and directories with `tv create-path-artifact`; register URLs with `tv create-url-artifact`. See `artifact-workflow.md` for choosing a shape and authoring the underlying content.

### User-facing framing

Think in terms of what the user believes exists and where they expect to find it.

Questions to keep straight:

- should this result be markdown, HTML, or a URL pointer?
- where should the underlying file live?
- should it appear on the current channel, another existing channel, or a new channel?
- should the user see it immediately, or should it be prepared without moving their attention yet?

Those questions interact, but they are not the same question.

## Administration: install, upgrade, and server configuration

The deployed Television administrator guide lives at `https://television.run/install.md`. Fetch and follow it whenever the user asks for installation, an upgrade, an uninstall, or any administrative change to how Television is configured or deployed — network binding and listeners, auth and tokens, ports, the persistent daemon, Docker setups, the desktop client, or troubleshooting an unreachable or unhealthy server. This skill deliberately does not duplicate that material.

**Fetch the full raw content — never a summary.** Many agent web fetch tools auto-summarize pages. The guide's details are load-bearing, and a summarized version is insufficient to administer from. Retrieve the verbatim markdown, for example:

```bash
curl -fsS https://television.run/install.md
```

Read the entire document before acting. If your web fetch tool returned a summary, refetch with a method that returns the raw markdown.

## Telemetry awareness and control

Television's npm releases collect anonymous, content-free telemetry by default to understand early usage and improve the product. Telemetry records predefined usage events and content-free classifications; it does not record artifact paths or URLs, artifact titles, channel names, theme names, file contents, or user-authored text.

If the user wants to opt out, you turn telemetry off for them by running `tv telemetry disable` against the running server (`tv telemetry enable` turns it back on); `tv status` reports the current telemetry state. The command needs a live server. Television also honors the standard `DO_NOT_TRACK` environment variable when it is set, but `tv telemetry disable` is the intended way to opt out. Install- and upgrade-time telemetry duties — the disclosure to give the user and the server's `installedByAgent` setting — are covered in the admin guide (see the Administration section above).

## Related skills

Television guidance is split across bundled skills.

- Use this skill for channels, focus, artifact decisions, and the `tv` CLI. Required means the knowledge is required, not that you must re-read it before every Television action.
- Install the bundled Television skills into the agent harness skills folder with `tv skills install <path>` (for example `~/.openclaw/skills`, `~/.hermes/skills`, or `~/.agents/skills`) or use `tv skills install -i` before artifact authoring work.
- For specialized HTML work, load the matching skill such as `tv-calendar` or `tv-table`.

`markdown editor UI recovery` remains out of scope for the current Television workflow.
