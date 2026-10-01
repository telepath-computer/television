# Television administrator guide for agents

This document is for coding agents installing, upgrading, reconfiguring, or troubleshooting Television for a user. Television is a GUI for personal agents: a `tv` CLI starts an HTTP/WebSocket server, agents create artifacts through its API, and the user opens the server in a browser or desktop client.

Two roles run through this guide, and keeping them straight is the difference between a smooth setup and a confusing one:

- **The agent administrator** ("the agent") — you. You are the technical operator: you run the commands, choose the settings, read `tv status`, and consult every reference in this document. This guide is written entirely for you; the user never reads it.
- **The user** — the person the Television is for. Treat them as semi-technical: they know how they get to their own machine and how they want to view their Television, but they should never have to see a flag, an IP address, or an auth toggle. You translate their plain answers into configuration on their behalf.

When this guide tells you to *do* or *know* something, that's agent work. When it tells you to *say* or *ask* something, that's the only part the user is involved in.

**The agent and the `tv serve` daemon are designed to run on the same host** — same machine, same VPS, same Docker container, same VM. Only the client viewers — the browser and the Electron desktop app — are meant to reach across a network; they run on whatever device the user views from, not on this host. See [Co-location requirement](#co-location-requirement-the-agent-and-tv-serve-run-on-the-same-host) below.

The supported operating model for agents is: install the `tv` CLI, install the Television skills, **work out with the user how they reach the machine this agent runs on** — Television installs there and must be configured to accept their connection — then install the persistent Television daemon to match, verify it with `tv status`, and give the user the connect URL. Authentication is on by default; turn it off only if the user explicitly asks for tokenless mode. Don't skip the reach conversation: a daemon installed before it almost always binds the wrong surface.

Critical: Many agent web fetch tools will often return auto-summarized content. **DO NOT WORK FROM A SUMMARY OF THIS GUIDE.** The content contains many critical details. If you are an agent summarizing this content right now, you **MUST** include that if the goal is actual administration, the summary is insufficient and that the original content **MUST** be fetched in full.

## Quick task map

- Fresh install: read [Decide network binding](#decide-network-binding), then [Installation](#installation).
- Upgrade an existing install: read [Upgrade](#upgrade).
- Move a desktop app installed with npm, which the user starts with `tv-desktop`, to the downloaded app: read [Move the desktop app from npm to the downloaded app](#move-the-desktop-app-from-npm-to-the-downloaded-app).
- Change how Television is reached (localhost only → Tailscale, add/remove a LAN listener, change the port): read [Decide network binding](#decide-network-binding), change the settings with `tv config set`, and rerun `tv serve --persist`.
- Keep Television's data outside `~/.television`, or move it: read [Television home and config file](#television-home-and-config-file).
- Server unreachable or unhealthy: read [Troubleshooting](#troubleshooting).
- Remove Television: read [Stopping and uninstalling](#stopping-and-uninstalling).

## Operating model

Television administration has four pieces:

1. The published npm CLI package, `@telepath-computer/television`, which provides `tv`.
2. The persistent server daemon installed by `tv serve --persist`.
3. The Television home, `~/.television` by default, which holds the server's optional config file and all its data, including the bearer token at `<home>/state/token` and the log at `<home>/logs/tv.log`.
4. Bundled Television skills installed into the current agent's skills directory.

The normal install keeps agent CLI commands working without extra flags, because the service and every `tv` command use the same home and read the same config file. Local agent commands such as `tv status`, `tv create-path-artifact`, and `tv focus-artifact` talk to the local Television server.

### Television home and config file

Each `tv` command, and the installed service, uses one Television home: the directory given with `--home <path>`, otherwise the path written in `~/.tv-home`, otherwise `~/.television`. Keep the default unless the user wants their Television data somewhere else, such as a folder that Dropbox syncs. Then write that path into `~/.tv-home` before installing, for example `echo ~/Dropbox/television > ~/.tv-home`, so every later command and agent session finds it without `--home`. `--home` applies only to the command that receives it, so don't use it for a lasting installation.

The server's settings live in `<home>/config.json`. Write them with `tv config set <key> <value> [<key> <value> ...]`. The keys are `port`, `listen` (one comma-separated list of IPv4 addresses), `auth` (`true` or `false`), and `installedByAgent`. A key that is not set keeps its default: port `32848`, no listeners besides localhost, and authentication on, so an ordinary install needs no config file. `tv config show` prints the selected home, the config file's path, and the effective settings. The server reads the file only when it starts; rerun `tv serve --persist` after changing it.

To move a home, stop the service with `tv stop`, move the directory, write its new path into `~/.tv-home`, and run `tv serve --persist`. Artifacts whose files are inside the home, such as those in its `artifacts` folder, still point at the old location: find them with `tv list-artifacts` and repoint each with `tv update-artifact --id <id> --path <new-path>`.

### Onboarding channels

A fresh installation receives the onboarding channels defined by its bundled package on its first serve; each is installed exactly once per home. After installation they are ordinary channels — the user can rename, edit, or delete them, and Television never re-creates or overwrites what they change. You can tell an onboarding channel apart from a user-created one by the `onboarding` marker containing its stable channel slug in metadata JSON — visible in `tv list-channels` output and in `<home>/state/channels/<channelID>.json`; user-created channels have no such field. Marked channels appear as ordinary unpinned channels and receive no special browser promotion. Treat them exactly like any other channel when managing content.

### Telemetry disclosure and agent runtime harness name

Television collects anonymous, content-free telemetry by default to understand early usage and improve the product. You are responsible for telling the user when you first install Television. This is a first-install disclosure only: the user's telemetry choice is persisted in the Television home and survives upgrades, so don't repeat the notice when upgrading.

Turning telemetry off is agent work — something you *do*, not a step the user runs. If the user wants to opt out, run `tv telemetry disable` against the running server (`tv telemetry enable` turns it back on); `tv status` shows the current state. The command needs a live server, so during a fresh install apply it only after the daemon is up — not while disclosing telemetry before anything is installed.

On first install, *say* this to the user in plain language: Television telemetry is on by default; it is anonymous and content-free; it is used to understand early usage and improve Television; and if they would like to opt out, they can just tell you and you will turn it off. Don't hand the user a command or a setting to apply — turning it off is yours to *do*, not theirs.

Before you install the daemon, record the agent runtime harness name with `tv config set installedByAgent <agent-runtime-harness-name>`. The value is the agent runtime harness name: the software running the agent, such as Codex, Claude Code, Hermes, OpenClaw, or Pi. Do not use a personalized nickname, persona name, model name, or any value with version numbers or qualifiers. If the name contains a space, quote it in the shell, for example `tv config set installedByAgent "Claude Code"`.

### Co-location requirement: the agent and `tv serve` run on the same host

Television is designed for the agent and the `tv serve` daemon to live in the **same host environment** — the same physical machine, the same VPS, the same Docker container, the same VM. Whatever address space contains the agent process must also contain the daemon. They are not intended to run separately across a network.

This is a hard design choice, not a recommendation:

- The `tv` CLI talks to `localhost:<port>` and nothing else. There is no `--server <url>` flag; the previous one was removed. Cross-host CLI use is not supported.
- The reach-mode and bind decisions below are entirely about how the **client viewers** — the browser and the Electron desktop app — reach the server. They are the only pieces meant to be separable from the host, and both run on whatever device the user views from, never on this host.

Concretely: if Television runs on a VPS, the agent also runs on that VPS. If Television runs inside a Docker container, the agent runs inside that same container (or you run them both on the host, with no Docker). You do not run the agent on your laptop and `tv serve` on a VPS; you SSH or tailnet into the VPS, run the agent there, and let the browser reach back across the network.

If a user describes a setup where the agent and the daemon are on different machines, stop and resolve that before installing — the install will appear to succeed and then the agent's `tv` commands will silently fail to reach the server.

With no config file, `tv serve --persist` binds `127.0.0.1` on port `32848` and requires the bearer token, even on loopback. Keep the default port unless the user has an unavoidable conflict (see [Port](#port-agent-reference)). To expose additional IPv4 listeners, set `listen` as [Decide network binding](#decide-network-binding) describes.

Television is intended to be used over local loopback or a private network such as Tailscale. Treat the bearer token like a password. The agent does not know, and cannot infer from the host alone, how the user wants the server reached — that is an interview decision; see [Decide network binding](#decide-network-binding).

## Decide network binding

Television installs on the machine where the user's primary personal agent runs — the machine this agent is on. That isn't a decision to make. The one thing to work out is **how the user reaches that machine from wherever they physically sit**, because that is exactly how they will reach Television. You arrive at that through a short conversation, then translate it into the `listen` setting yourself — the user never sees a setting.

> **Two rules, no exceptions:**
>
> 1. **Never install before the conversation.** Do not run `tv serve --persist` until you have worked out, with the user, how they reach this host. A silent install binds the wrong surface and only looks like success.
> 2. **Never interrogate with jargon.** Do not put a menu of reach modes or IP literals to the user, and do not discuss auth unless the user raises it. They chose an agent precisely so they would not have to learn any of this.

Everything below the conversation is **agent reference** — the server's rules and the answer-to-setting mapping, written for you and you alone. Consult it *while* talking; never read it, its settings, or its IP addresses back to the user. The instructions you actually act on are in [The conversation](#the-conversation).

The server's rules (agent reference):

- Localhost (`127.0.0.1`) is always bound; you cannot turn it off.
- Authentication is on by default: the server requires the token on every request, on every listener including localhost. There is no per-listener auth. Run `tv config set auth false` only when the user explicitly asks to run tokenless for an unusual reason; it turns the token off on every listener.
- `tv config set listen` takes one comma-separated list of IPv4 addresses and replaces the stored list; `tv config set listen ""` clears it. Each address must be assigned to the host whenever the server starts, or the server fails to start.

### The conversation

Work through four beats, in plain language, one thing at a time:

1. **Explain the premise — don't just jump to a question.** In a sentence or two, tell the user *why* you're asking: Television runs right here on the machine their agent runs on (it is not a service hosted somewhere else), so the one thing to set up is making it reachable from wherever they actually do their computing. Give them that picture before you ask anything; a bare "how do you reach this machine?" with no framing leaves a semi-technical user guessing at what you mean. See [Co-location requirement](#co-location-requirement-the-agent-and-tv-serve-run-on-the-same-host).
2. **Work out how they reach this machine.** This is the heart of the interview. Ask how they get to this machine today and let the answer set the binding: sitting right at it → localhost, expose nothing; they SSH in → an SSH tunnel over the connection they already use; they use Tailscale → bind the tailnet address; it is a machine on their own network → a LAN bind. Ask, listen, and follow up only as needed. If the agent runs inside a container the mechanics differ — see [Docker](#docker-agent-reference).
3. **Confirm where the skills will be installed.** Television ships skills that must land in *this* agent's skills directory, and there is no single standard location — it varies by agent framework and by how the user set things up. Do not silently guess. Work out the most likely directory for this agent (see [Install Television skills](#install-television-skills-for-the-agent) for the common locations), propose it in one plain sentence, and get a yes before installing. Example: *"I'll put the Television skills in `~/.openclaw/workspace/skills` — that's where this agent loads them from. Sound right?"*
4. **Confirm the plan, then install.** Say back in one plain sentence what you're about to do — how they'll reach it and where the skills go — then proceed to [Install the daemon](#install-the-daemon). No further questions are needed once they've confirmed.

A good opening explains before it asks: *"Television runs right here on the same machine I'm on — it's not hosted anywhere else — so the main thing to sort out is how you'll get to it from wherever you actually work. When you want to look at it, are you sitting at this machine, or reaching it from another device — say over SSH, Tailscale, or your home network?"* That framing gives a semi-technical user the picture first; from their answer you can usually settle the rest with one short follow-up.

Never repeat either failure: **silently running the install** (then reporting a healthy `tv status` the user cannot actually reach), or **handing the user the reach options as a checklist** to fill in. Both leave a daemon running and both are wrong.

### Port (agent reference)

**Strongly prefer the default `32848`.** Change it only when the user has a real reason, such as an unavoidable port conflict. The port is a config setting, and every `tv` command reads it from the same file as the server, so a change needs one step: `tv config set port <n>`, then `tv serve --persist`. The service refuses port `0`, which lets the operating system choose a port and is meant for development.

For SSH tunnels, the `-L` forward should target the same port on both ends to keep the URL `http://localhost:32848` on the user's laptop. For Docker, the `docker run -p <host>:<container>` mapping should use the same port on both sides for the same reason.

### Translate the answers into settings (agent reference)

| Reach mode | `tv config set listen` value |
| --- | --- |
| Localhost only | not set |
| SSH tunnel (VPS or any remote host) | not set — the daemon is localhost-only; the user runs `ssh -L 32848:localhost:32848 user@host` |
| Tailscale (localhost is always bound too) | `"$(tailscale ip -4)"` |
| LAN (single interface) | `<lan-ipv4>` |
| LAN (every interface) | `0.0.0.0` |
| Docker, host loopback only | inside container: `0.0.0.0`; host publish: `docker run -p 127.0.0.1:32848:32848 ...` |
| Docker, host LAN | inside container: `0.0.0.0`; host publish: `docker run -p 32848:32848 ...` (or `0.0.0.0:32848:32848`) |
| Mix of the above | one comma-separated list, such as `"$(tailscale ip -4),192.168.1.42"` |

Every reach mode keeps authentication on. `tv config set auth false` exists only for the rare case where the user explicitly asks to run without a token.

Television is meant to run beside the agent on a host the user already reaches privately — local, SSH, Tailscale, or their own LAN. It is **not** designed to be exposed directly to the public internet, which is why there is no public-reach row above. If a user insists on that anyway, treat it as an explicit, separately-confirmed exception, always with authentication on.

Any server started without auth prints a stderr warning that the tokenless server is open to browser pages the operator opens, and writes the choice to `<home>/logs/tv.log`. When non-loopback listeners are present, the warning names them. That warning is not an error — it is the operator's audit trail for the rare explicit user request to run unauthenticated.

### Literal IP capture caveat (agent reference)

`listen` values are stored **literally** in the config file. They are not re-resolved when the server restarts.

- `tv config set listen "$(tailscale ip -4)"` evaluates in your shell, and the numeric IP is what the file stores. If the tailnet IP later changes (rare but possible: account changes, re-registration, multi-account devices), the persisted server exits with status 69, records the failed address in `<home>/logs/tv.log`, and is retried by the service manager. Store the new address with `tv config set listen`, keeping any other listeners in the list, then rerun `tv serve --persist`.
- Same caveat for DHCP-assigned LAN addresses. If the user's host gets a new LAN IP, the server fails to start until you store the new address and rerun `tv serve --persist`.
- `0.0.0.0` sidesteps this because the wildcard binds whatever interfaces exist at startup. The trade-off is that future interfaces are also exposed.

Tell the user the recovery commands in advance — "if your Tailscale or LAN IP ever changes, run `tv config set listen <new-ip>`, then `tv serve --persist`" — so they aren't surprised later.

### Docker (agent reference)

When Television runs inside a Docker container, the bind decision splits in two: where Television listens *inside* the container, and how Docker publishes that port *on the host*.

The [co-location requirement](#co-location-requirement-the-agent-and-tv-serve-run-on-the-same-host) still applies: the agent runs inside the same container as `tv serve`. The `docker run -p` mapping is purely for the *browser* to reach the server. Do not run the agent on the host and the daemon in a container (or vice versa) — the `tv` CLI talks only to its own loopback and will not cross the container boundary.

Key facts:

- The container has its own network namespace. `127.0.0.1` inside the container is *not* the host's `127.0.0.1` — it is only reachable from inside the same container. A localhost-only `tv serve` inside a container cannot be reached from the host, from other containers, or from the network.
- For Television to be reachable from outside the container, the daemon **must** bind to `0.0.0.0` inside the container: run `tv config set listen 0.0.0.0` there.
- Where the port is exposed on the *host* is controlled by `docker run -p <host>:<container>`. That host-side bind, not the in-container bind, is what determines the actual trust boundary.

Pattern recommendations:

- **Browser on the same host as Docker.** Publish to host loopback only:
  ```bash
  docker run -p 127.0.0.1:32848:32848 ...
  ```
  Inside the container, set `listen` to `0.0.0.0` and run `tv serve --persist`. User opens `http://localhost:32848` on the host.

- **Browser on another device on the LAN.** Publish to all host interfaces (Docker's `-p 32848:32848` default) and run the daemon with auth:
  ```bash
  docker run -p 32848:32848 ...
  ```
  Inside the container, set `listen` to `0.0.0.0` and run `tv serve --persist`. The host's firewall must allow inbound `32848`.

- **Browser on another machine via Tailscale.** Two options:
  1. Run Tailscale on the host and publish to the host's tailnet IP: `docker run -p $(tailscale ip -4):32848:32848 ...`, with `listen` set to `0.0.0.0` inside.
  2. Run Tailscale inside the container (e.g., the `tailscale/tailscale` sidecar). The container then has its own tailnet IP and Television can be reached on `http://<container-tailscale-ipv4>:32848`. Set `listen` to `0.0.0.0` inside the container; no `docker run -p` is needed in this case.

- **VPS running Docker.** Same advice as the bare-VPS case: prefer an SSH tunnel. Publish only to host loopback (`-p 127.0.0.1:32848:32848`) and have the user `ssh -L 32848:localhost:32848 user@vps-host`. Public publishing on a VPS (`-p 0.0.0.0:32848:32848`) is the same risk surface as `listen` set to `0.0.0.0` on a bare VPS; keep authentication on.

User-side checklist when Television runs in Docker:

- The published host port matches what the user is trying to open in the browser.
- The host's firewall allows that port (for LAN or public publishing).
- The `tv` CLI on the host cannot talk to a Docker-only Television unless the port is published to host loopback or the user runs `tv` *inside* the container — the `tv` client speaks `localhost:<port>` only and does not cross the host/container boundary.

## Installation

Before running install commands, give the telemetry disclosure from [Telemetry disclosure and agent runtime harness name](#telemetry-disclosure-and-agent-runtime-harness-name). A fresh install is the moment when the user must hear that telemetry is on by default and that they can opt out anytime by asking you. If they ask to opt out, apply it yourself with `tv telemetry disable` *after the daemon is up* (the command needs a live server; see [Check health](#check-health)) — don't leave it for the user to do.

### Install the CLI

Before installing, check `node --version`. The Television CLI package requires Node `>=22.12.0`. If the host uses an older runtime, stop and tell the user that the runtime is unsupported. Upgrading Node is a change to the user's system and is their decision. Let the user upgrade Node, or get their explicit approval before doing it for them. Continue only after `node --version` reports `22.12.0` or later; do not rely on npm's advisory engine warning as the only notice.

Install the published npm package so the `tv` binary is available:

```bash
npm install -g @telepath-computer/television
```

Verify:

```bash
tv --help
tv --version
```

If global npm installs are not appropriate on the host, use the user's preferred Node package setup. Ensure the `tv` command you run is the intended installed CLI before creating the daemon.

### Install Television skills for the agent

Identify the current agent's skills directory, then **propose it to the user and get a yes before installing** (this is a beat in [the conversation](#the-conversation)) — locations vary widely and a silent guess often lands the skills where the agent can't load them. Common locations:

- Shared agent setups often use `~/.agents/skills`.
- OpenCLAW often uses `~/.openclaw/workspace/skills` for an agent's skills directory, but also supports `~/.agents/skills`.
- Hermes often uses `~/.hermes/skills`.
- Claude Code, Codex, and other sidecar agents may have their own skills/instructions location; use the user's preferred location when known.

If the user has given you specific instructions on where they prefer their skills to live, respect those. Install the bundled Television skills into the appropriate directory:

```bash
tv skills install <skills-directory>
```

For example, for a default OpenCLAW setup:

```bash
tv skills install ~/.openclaw/workspace/skills
```

Confirm that the installed skills are now available to you after installing them, including any refreshing as needed. Missing skills produces a frustrating user experience.

### Pre-load the main `television` skill

If the user is installing TV for the first time, assume the user will want to explore the Television experience right away. Have the skill loaded already so you can make sense of any initial fast-follow requests to add content to the TV.

### Install the daemon

> **Stop.** Do not run this until you have had [the conversation](#the-conversation) about how the user reaches this host. Installing first — before you know how they connect — is the single most common way this goes wrong; a healthy `tv status` on the wrong binding is not success.

**Before installing the persistent server for the first time on macOS, tell the user that macOS will show a notification about a new background or login item.** It may identify the item with generic language such as "node," "Node.js Foundation," or "Item from unidentified developer." This is the Television server daemon (macOS names the user's Node binary rather than Television), so the notification is expected and safe.

Install in three steps:

1. If the user wants their Television data outside `~/.television`, write that path into `~/.tv-home` ([Television home and config file](#television-home-and-config-file)).
2. With `tv config set`, record `installedByAgent` ([Telemetry disclosure and agent runtime harness name](#telemetry-disclosure-and-agent-runtime-harness-name)), the `listen` addresses from [Decide network binding](#decide-network-binding), and `port` only if it must change.
3. Run `tv serve --persist`.

Examples by reach mode:

```bash
# Localhost only — also works for SSH-tunnel access
tv config set installedByAgent <agent-runtime-harness-name>
tv serve --persist

# Tailscale + localhost
tv config set installedByAgent <agent-runtime-harness-name> listen "$(tailscale ip -4)"
tv serve --persist

# Tailscale and one LAN interface
tv config set installedByAgent <agent-runtime-harness-name> listen "$(tailscale ip -4),192.168.1.42"
tv serve --persist
```

Reminders the install must respect:

- `tv config set auth false` makes the server tokenless; it then prints a stderr warning at startup and logs the choice. Use it only when the user explicitly asks to run without a token; a tokenless server accepts API control from browser pages the operator opens.
- `tv serve --persist` replaces any existing service. To change settings, run `tv config set`, then `tv serve --persist` again.
- `tv serve --persist` also records the installing shell's `PATH` and Television's environment controls, such as `DO_NOT_TRACK`, for the service. Run it from a shell where these are as the service should have them.

Do not run plain `tv serve` (without `--persist`) as a smoke test unless you intentionally manage it as a long-running foreground server process. Plain `tv serve` starts the server in the foreground and does not exit on success, so it will hang an automated agent session. Install the daemon, then check it from a separate command.

### Check health

Verify the server and daemon:

```bash
tv status
```

The result should report `healthy: true` and a daemon status with `installed: true` and `running: true` on supported platforms.

You can also verify the local health endpoint directly:

```bash
curl -fsS http://localhost:32848/health
```

For an API check, call a real API route with the token. `tv status` prints the Television `home`, and the token is in `<home>/state/token`:

```bash
TOKEN="$(cat <home>/state/token)"
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:32848/channels
```

## User connection URL

After installation, tell the user how to open Television. Use the listener that matches how they will actually reach it:

```text
# Same machine
http://localhost:32848

# SSH tunnel: user runs `ssh -L 32848:localhost:32848 user@host`, then opens
http://localhost:32848

# Tailscale (from another tailnet device)
http://<tailscale-ipv4>:32848

# LAN (from another device on the same network)
http://<lan-ipv4>:32848
```

For SSH tunnels, give the user the full ssh command, not just the URL. They will need to run it (and keep that terminal open) before the URL works.

`tv status` prints every bound URL the daemon is currently serving — read that and quote the appropriate one back to the user rather than guessing. A required bind failure prevents the daemon from starting; the service manager retries it, and each failed attempt is recorded in `<home>/logs/tv.log`.

Give the user the URL. With authentication on, `tv serve --persist` prints each URL with the token in it, and the token is also in `<home>/state/token`. Give the user a complete authenticated browser URL (`<server-url>/?token=<token>`) as the primary click target. Also print the **complete, untruncated** token by itself — the whole string, not a prefix or summary — plus the file path (`<home>/state/token`) as a fallback for manual entry, the desktop client's token field, and password-manager storage. For a tokenless daemon, give the bare URL, tell them no token is required, and mention that the server is open to local processes and browser pages they open. Tailscale remains the preferred remote-access path; a LAN bind is supported but puts more of the trust on the user's network and on the bearer token.

Also decide whether to offer the desktop client: it uses the same server URL and is the only client that renders URL artifacts as full external web page content rather than a placeholder.

### Desktop client (recommended for URL artifacts)

**The desktop client is a client-side viewer, like the browser — it runs on the machine the user views Television from, which is often not this host.** The [co-location requirement](#co-location-requirement-the-agent-and-tv-serve-run-on-the-same-host) does not apply to it. It needs no Node or npm on that machine, and it cannot run on a headless host.

The Television desktop app runs on Apple Silicon Macs with macOS 12 or later. There is no desktop app for any other computer, including Intel Macs, Linux and Windows; users there view Television in the browser. **The principal reason to install it is full support for URL artifacts.** Browser clients show a placeholder for URL artifacts; the Electron client renders external web pages and local web apps inside the artifact card via webview. If the user wants to display external web pages on a TV screen, the desktop client is the only real option.

The desktop client also provides a native app experience — a real window, Dock icon, and OS integration — which some users prefer over a browser tab. That's a secondary benefit; URL artifact support is the main one.

The user installs the app themselves, like any Mac app, even when they view Television on this machine. Give them the download link and these steps:

1. On the Mac, open `https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64` in a browser. The link stays the same across releases and downloads a disk image of the latest desktop release.
2. Open the downloaded disk image and drag Television to Applications.
3. Open Television from Applications, the Dock or Spotlight.
4. In the connect window, enter the server URL above and the token. Tokenless servers leave the token field blank only when the user explicitly asked to run without a token.

The desktop app updates itself. It checks for a new desktop release when it starts and every ten minutes and downloads it in the background. When the download finishes, the update bell lights and a notice offers **Restart to update**, which installs the update and reopens the app. An update the user does not restart into installs after they quit the app. The installation finishes a short time after the app quits, so an app opened again straight away can still be the earlier version; it then offers the update again. Updating it needs no reinstall, and restarting the Television daemon never updates it.

When walking the user through install, ask whether they intend to use URL artifacts (external web pages or web apps on their TV). If yes, and they view Television from an Apple Silicon Mac, give them the link and steps now. If they're unsure or only want path artifacts, mention that the desktop client can be installed anytime later.

## Upgrade

### How updates reach users

Releases worth taking are announced through a curated update channel; running servers pick it up within a few minutes and show the user a corner toast with a **"Copy upgrade prompt"** button. If a user hands you "Please upgrade my Television server following https://television.run/install.md", that button is where it came from, and this section is the procedure.

After you upgrade the server, browser tabs self-heal: an out-of-date tab silently reloads itself once on reconnect, so no hard refresh is needed. The desktop app downloaded from Television's link updates itself ([Desktop client](#desktop-client-recommended-for-url-artifacts)); upgrading the server never updates it. If the upgraded server needs a newer desktop app than the user has, the app shows a full-window screen, in place of the normal interface, saying that the desktop app needs an update. The downloaded app keeps checking for updates behind that screen; once it has downloaded the update, the screen offers **Restart to update**, which installs it and reopens the app.

Desktop apps installed with npm, which the user starts with `tv-desktop`, receive no more updates. They show a desktop upgrade recommendation that gives the user the download link and the steps to move to the downloaded app. If the user asks you about it, [Move the desktop app from npm to the downloaded app](#move-the-desktop-app-from-npm-to-the-downloaded-app) is the procedure. An npm app older than the server requires shows that update screen instead, which gives the user the same download link; the procedure is the same.

The telemetry disclosure is a first-install step, not an upgrade step — the user's telemetry choice is persisted in the Television home and survives the upgrade, so don't repeat the notice here. If the user asks about telemetry or wants to opt out during an upgrade, handle it per [Telemetry disclosure and agent runtime harness name](#telemetry-disclosure-and-agent-runtime-harness-name): run `tv telemetry disable` once the daemon is running again after the reinstall (verify with `tv status`) — the command needs a live server, and don't leave it for the user to do.

1. On the server host, check Node and identify the installed CLI:

   ```bash
   node --version
   which tv
   tv --version
   npm list -g @telepath-computer/television --depth=0
   tv status
   ```

   Note the `port` and `bindAddresses` that `tv status` reports; step 4 may need them.

   Television requires Node `>=22.12.0`. If it reports a lower version, stop: Node upgrades are the user's decision — see [Install the CLI](#install-the-cli). Continue only after `node --version` reports `22.12.0` or later.

2. Upgrade the CLI and server package:

   ```bash
   npm install -g @telepath-computer/television@latest
   ```

   Run `tv --version` again to confirm the shell resolves the upgraded global package. A service installed by an earlier release keeps working through a temporary compatibility path. When the service next starts and the home has no config file, the path copies the service's old settings into a new one; if the home already has a config file, the service uses that file's settings. Step 4 replaces the service with one that reads the config file directly.

3. Reinstall the bundled skills into the agent's active skills directory. Skill content changes across releases, so reinstall the skills whenever you upgrade the CLI. Use the directory selected during installation. If that directory is unknown, inspect this agent's configuration and locate the skills directory that contains the installed `television` and `tv-*` skills; confirm it is the directory this agent loads before continuing. Then run:

   ```bash
   tv skills install <skills-directory>
   ```

   This command replaces each installed Television skill directory with the copy bundled in the upgraded CLI package.

4. Reinstall the persistent daemon so it runs the upgraded code. The service takes its settings from the Television home's config file, so check these first:

   - If Television's data was kept in a directory other than `~/.television`, write that directory's path into `~/.tv-home` first. Television then uses its channels, artifacts, and token in place.
   - If the old service used a custom port or listen addresses and `tv config show` reports `configFileExists` as `false`, set them with `tv config set`. A service that has restarted since step 2 has already written them.
   - If `tv config show` reports `auth` as `false`, run `tv config set auth true`: tokenless mode is deprecated.
   - If `tv config show` reports `installedByAgent` as `null`, set it as [Telemetry disclosure and agent runtime harness name](#telemetry-disclosure-and-agent-runtime-harness-name) describes.

   Then reinstall:

   ```bash
   tv serve --persist
   ```

   If a listener came from `tailscale ip -4` or a DHCP LAN address, confirm it is still the host's current address (`tailscale ip -4`) before storing it — see [Literal IP capture caveat](#literal-ip-capture-caveat-agent-reference). Dropping a listener silently downgrades the surface — a Tailscale-reachable daemon becomes localhost-only again; if the surface must change, tell the user.

   A service that ran without a token before the upgrade requires one now. Tell the user the auth mode has changed and what to expect: it's very easy — they open a URL with the token already in it (`<server-url>/?token=<token>`) in the browser, or paste the token into the desktop app. Give them that URL plus the bare token to save in a password manager. If the user then asks to restore tokenless access, run `tv config set auth false` and `tv serve --persist`. If the user wants to change how they reach the server, take them back through [Decide network binding](#decide-network-binding) and set the new values before this reinstall.

5. Verify that the daemon is running the installed release:

   ```bash
   tv --version
   tv status
   ```

   In `tv status`, require `healthy: true`, `daemon.installed: true`, and `daemon.running: true`. Its `version` value must equal the release-version portion of `tv --version` — the `major.minor.patch` before the optional `(commit …)` developer-build annotation. Do not proceed to client updates until all four checks pass. A `version` mismatch means the daemon did not restart onto the upgraded code; repeat step 4.

6. **Get the user's clients onto the new code.** The daemon restart alone does not update a running client, but most of this now happens by itself (see [How updates reach users](#how-updates-reach-users)):

   - **Browser:** open tabs reload themselves once when they reconnect to the upgraded server — no user action needed. Only if a tab somehow still shows stale behavior should you ask for a manual hard refresh.
   - **Desktop app:** the downloaded desktop app updates itself, and a daemon restart never updates it. If the upgraded server needs a newer desktop release, the app shows a screen saying that it needs an update until it has downloaded that release; the screen then offers **Restart to update**, which installs it. If the user still starts the desktop app with `tv-desktop`, it was installed with npm: follow [Move the desktop app from npm to the downloaded app](#move-the-desktop-app-from-npm-to-the-downloaded-app). If `npm ls -g @telepath-computer/television-desktop` lists the package on this host, do that now.

An npm package upgrade does not require deleting the Television home; keeping it in place preserves channels, artifacts, and the existing token. Delete it only when the user explicitly wants a permanent reset.

### Move the desktop app from npm to the downloaded app

Desktop apps up to Television 1.3 were installed with the npm package `@telepath-computer/television-desktop` and started with `tv-desktop`. That package receives no more updates. The downloaded app replaces it and opens with the server connection the npm app saved, so the user does not reconnect. Use this procedure when the user asks you about the desktop recommendation, when their app shows a screen saying that it needs an update and they start it with `tv-desktop`, or when you find the npm package during an upgrade.

The downloaded app runs only on the Macs that [Desktop client](#desktop-client-recommended-for-url-artifacts) names; on any other computer the user views Television in the browser.

The user makes the move themselves, like installing any Mac app. Give them these steps, which are the ones the desktop recommendation shows:

1. Download the new app and drag it to Applications, as steps 1 and 2 in [Desktop client](#desktop-client-recommended-for-url-artifacts) describe.
2. Quit the npm app, then open Television from Applications. While the npm app is running, macOS may bring it forward in place of the new app. The new app opens with the saved server connection. If it shows the connect window instead, enter the server URL and token as for a first install ([User connection URL](#user-connection-url)).
3. From then on, open Television from Applications, the Dock or Spotlight, not with `tv-desktop`. It updates itself. macOS may ask again for camera, microphone or screen-recording permission, because the downloaded app is signed differently from the npm app.

Once the user has the new app open, remove the npm package if `npm ls -g @telepath-computer/television-desktop` lists it on this machine: `npm uninstall -g @telepath-computer/television-desktop`. Saved connections and settings stay. If the package is on another machine, it does no harm there; the user just stops using `tv-desktop`.

## Stopping and uninstalling

Stop and remove the persistent daemon:

```bash
tv stop
```

`tv stop` uninstalls the persisted launchd/systemd service and stops the Television server process managed by that service. It is not just a temporary pause command; after `tv stop`, Television will not start again on login/boot until `tv serve --persist` is run again. It does not remove the npm package, skills, or the Television home.

To remove the npm package:

```bash
npm uninstall -g @telepath-computer/television
```

To remove installed skills, delete the `television` skill and any `tv-*` skills from the agent's skills folder(s). Due to a diversity of skill folder locations for most agents, be thorough in searching them out.

To permanently remove server data, delete the Television home, the `home` that `tv status` prints (usually `~/.television`), and `~/.tv-home` if it exists. Deleting the home is non-recoverable unless the user has backups; it removes channels, artifacts, and the token. **Always ask for confirmation** before deleting the user's Television home.

## Troubleshooting

Start with the built-in status check:

```bash
tv status
```

Then check the local HTTP endpoint and durable log, where `<home>` is the `home` that `tv status` prints:

```bash
curl -fsS http://localhost:32848/health
TOKEN="$(cat <home>/state/token)"
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:32848/channels
# for deliberate tokenless installs only:
curl -fsS http://localhost:32848/channels
tail -n 200 <home>/logs/tv.log
```

Common issues:

- **Daemon is not installed or not running.** Reinstall with `tv serve --persist`; it uses the settings that `tv config show` prints.
- **Port already in use.** Stop the conflicting service or stop/reinstall Television after the conflict is resolved. Prefer resolving the conflict on the other side rather than moving Television off `32848`; if it must move, see [Port](#port-agent-reference).
- **`tv` commands reach a different installation than the service.** Each command resolves its home separately. Compare `home` in `tv status` with the `--home` in the service definition (platform locations below). If they differ, write the service's home into `~/.tv-home`, or reinstall the service from the intended home.
- **Token mismatch.** Read the current token from `<home>/state/token`, make sure the user has copied it exactly, and test it against the local server:

  ```bash
  TOKEN="$(cat <home>/state/token)"
  curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:32848/channels
  ```

  If the curl command succeeds, the token is valid and the user's browser/client likely has a copied, stale, or malformed token. Give the user the current token again.
- **Skills installed to the wrong directory.** Reinstall skills into the agent framework's active skills directory.
- **User cannot open the GUI remotely.** Establish how they are reaching the host. For an SSH tunnel, confirm the `ssh -L <port>:localhost:<port> user@host` command is running and the user is opening `http://localhost:<port>` on the laptop side; the daemon side should be a normal localhost-only install, with no `listen` addresses. For Tailscale, confirm `tailscale ip -4` returns an address and that `tv status` lists it in `bindAddresses`; give the user `http://<tailscale-ip>:32848` and the token. For a LAN bind, confirm the LAN address appears in `bindAddresses` and that the user's firewall lets the port through.

Platform locations and commands:

- macOS plist: `~/Library/LaunchAgents/com.television.server.plist`
- macOS daemon status: `launchctl list com.television.server`
- Linux user unit: `~/.config/systemd/user/com.television.server.service`
- Linux daemon status: `systemctl --user status com.television.server.service`

## What to tell the user

Give the user:

1. The URL to open in their browser.
2. Whether a token is required.
   - With authentication on (the default): read the token from `<home>/state/token`, append it to the chosen browser URL as `?token=<token>`, and give that complete authenticated URL as the primary link to click. Also print the **complete, untruncated** token by itself and name the file path in case they need manual entry, the desktop client's token field, password-manager storage, or retrieval later.
   - If tokenless: give the bare URL, tell the user no token is required, token fields stay blank, and the server is open to local processes and browser pages they open.
3. The desktop client situation. URL artifacts (external web pages and web apps on a TV screen) only render in the Electron desktop client; browser clients show a placeholder.
   - If the user already has the desktop app: tell them to open Television from Applications when they want to display external web pages, and that it updates itself.
   - If they don't: explain that the browser URL still works for file-backed artifacts, but URL artifacts won't render fully there. If they want external-web-page support and view Television from an Apple Silicon Mac, give them the download link and install steps ([Desktop client](#desktop-client-recommended-for-url-artifacts)), or note that they can install it later anytime.
4. What changed: installed, upgraded, reconfigured, or troubleshot.
5. How to stop or reinstall the daemon if needed.

Examples:

Tailscale install:

```text
Television is installed and running.
Open it — this link has your token built in, just click:
  http://100.x.y.z:32848/?token=k7m2-9xPq4nV8R3jL1cBwA6sYfHzD0eUtG5oI-token-example-untruncated-string
Your token (only if you enter it by hand — e.g. the desktop client's token field — or to save it; file: ~/.television/state/token):
  k7m2-9xPq4nV8R3jL1cBwA6sYfHzD0eUtG5oI-token-example-untruncated-string

Desktop app (recommended if you want external web pages on your TV):
  Not yet installed. On your Mac, download it from
    https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64
  open the downloaded file and drag Television to Applications.
  Then open Television, point it at http://100.x.y.z:32848 and paste the token. It updates itself.

I installed the persistent Television daemon and updated the Television skills. Telemetry is on by default; it's anonymous and content-free, used only to understand early usage and improve Television. If you'd rather opt out, just tell me and I'll turn it off.
If the machine's Tailscale IP changes, ask me to update Television, or run:
  tv config set listen "$(tailscale ip -4)"
  tv serve --persist
```

SSH-tunnel install (VPS):

```text
Television is installed and running on the VPS, localhost-only.
To open it, run on your laptop:
  ssh -L 32848:localhost:32848 user@vps-host
Then open it — this link has your token built in, just click after the SSH tunnel is up:
  http://localhost:32848/?token=k7m2-9xPq4nV8R3jL1cBwA6sYfHzD0eUtG5oI-token-example-untruncated-string
Your token (only if you enter it by hand — e.g. the desktop client's token field — or to save it; file: ~/.television/state/token):
  k7m2-9xPq4nV8R3jL1cBwA6sYfHzD0eUtG5oI-token-example-untruncated-string

Desktop app: optional. If you want URL artifacts (external web pages on your TV) and your laptop is an Apple Silicon Mac, download it there from
  https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64
open the downloaded file and drag Television to Applications.
The desktop app connects to the same URL (http://localhost:32848 via the SSH tunnel) and uses the same token.

I installed the persistent Television daemon and updated the Television skills. Telemetry is on by default; it's anonymous and content-free, used only to understand early usage and improve Television. If you'd rather opt out, just tell me and I'll turn it off.
Keep the ssh -L session open while you use the GUI.
```

## Agent checklist

1. Determine the task: install, upgrade, troubleshoot, or uninstall.
2. Have [the conversation](#the-conversation) about how the user reaches this host (sitting at it / SSH / Tailscale / their own LAN) — in plain language, before installing anything, never a jargon checklist. Translate the answer into the `listen` setting yourself. See [Decide network binding](#decide-network-binding).
3. On first install (not upgrades), give the telemetry disclosure from [Telemetry disclosure and agent runtime harness name](#telemetry-disclosure-and-agent-runtime-harness-name). If the user says they want to opt out, note it now and apply it yourself once the server is running (step 7) — `tv telemetry disable` needs a live server, so it can't run before the daemon is up.
4. Check `node --version`, then install or upgrade `@telepath-computer/television` if needed. Node `>=22.12.0` is required; if the runtime is older, stop — Node upgrades are the user's decision (see [Install the CLI](#install-the-cli)).
5. Install bundled Television skills into the directory you proposed and the user confirmed during [the conversation](#the-conversation) — don't silently guess the location.
6. Set `installedByAgent` and any needed `listen` addresses with `tv config set`, then install or reinstall with `tv serve --persist`. **When installing Television for the first time on macOS, tell the user before running that command to expect the generic background/login-item notification described in [Install the daemon](#install-the-daemon).** This warning does not apply to upgrades. An SSH-tunnel setup is still a localhost-only install on the server side. Authentication is on by default, including after upgrading a service that ran without a token; give the user the complete token URL and bare token in step 8. Use tokenless mode only if the user explicitly asks to run without a token.
7. Verify `tv status`. If the user asked to opt out of telemetry, now that the server is running run `tv telemetry disable` and re-check `tv status` — this is the point where the command works, since it needs a live server.
8. Give the user the full authenticated browser URL (and, for SSH tunnels, the `ssh -L` command) and any relevant operational notes. With authentication on, also print the **complete, untruncated** token and token file path as the manual-entry fallback. For tokenless installs, give the bare URL, say no token is required, and say the server is deliberately open on that host.
9. Cover the desktop client in the final response. URL artifacts only render fully in the Electron desktop client; browsers show a placeholder. The desktop client runs on the machine the user views Television from, which is often not this host.
   - If the user wants URL artifact support, views Television from an Apple Silicon Mac and doesn't have the desktop app yet, give them the download link and install steps from [Desktop client](#desktop-client-recommended-for-url-artifacts).
   - If they already have it, remind them to open it from Applications and that it's the right client for URL artifacts.
   - If the user starts the desktop app with `tv-desktop`, follow [Move the desktop app from npm to the downloaded app](#move-the-desktop-app-from-npm-to-the-downloaded-app).
   - If the user has no URL artifact intent and declined, note that they can install it later anytime.
