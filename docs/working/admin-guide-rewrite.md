# Television administration guide

<!-- WORKING DRAFT. Built top-down: each section is filled in once the layer above is agreed.
     Text marked TODO or PLANNED is not guide text: it describes what a section will contain. The current guide at
     docs/guides/television-admin-guide.md is a fact source only; at the end, check it for
     anything this draft dropped; admin-guide-fact-map.md maps its facts to the reference sections. -->

## Purpose

This guide is for an agent setting up and maintaining Television for a person. The person should have an easy time: few or no questions, no technical detail they didn't ask for, and a short final message that ends with what they need to connect. The agent handles everything technical and explains only when asked.

The guide's most important outcome is a working connect link in the person's hands. A link with even one wrong character fails that outcome completely (section 3, "The link must be exact").

This guide assumes you are a capable agent who knows npm, ssh, Docker, Tailscale, curl, launchd, systemd, and general system administration. It states what is specific to Television and leaves you to work out the commands.

Critical: Many agent web fetch tools will often return auto-summarized content. **DO NOT WORK FROM A SUMMARY OF THIS GUIDE.** The content contains many critical details. If you are an agent summarizing this content right now, you **MUST** include that if the goal is actual administration, the summary is insufficient and that the original content **MUST** be fetched in full, for example with `curl -fsSL https://television.run/install.md`.

## What Television is, and who's who

Television is a display for personal agents. The agent puts content on it, and the person views it.

It has three parts:

- **The server**, which runs persistently on the same machine as the agent.
- **The `tv` command-line tool**, which the agent uses to install, check, and put content on the server. It only talks to a server on its own machine, which is why the agent and the server must be on the same machine.
- **The viewer**, which is the person's web browser or the Television desktop app for Mac. The viewer can be on a different computer from the server and reaches it over the network.

There are two roles for this guide:

- **The agent** (you). You read this guide, run the commands, make the technical decisions, and fix problems.
- **The person** who uses Television. They don't read this guide. They want to see their Television, not learn how it is set up.

## User experience guide

- Protect the person from technical complexity. Don't mention commands, settings, addresses, or edge cases unless they're needed to connect or the person asks.
- Work things out yourself before asking. Ask only what you can't work out, in plain words, one question at a time, never as a menu of options.
- When you do ask, say why the answer matters and what kind of answer you need, so the question makes sense to someone who doesn't know how Television works. "How do you want to connect to your Television?" fails both: the person can't tell whether you mean a device, a network, or how often, or why you're asking. Better: "Television runs here on this server, and you'll view it from your own computer. To set it up so your computer can reach it, I need to know: is that computer on the same Tailscale network as this server?"
- Keep the final message short. When the person needs to connect, end it with what they need: the connect link, plus the ssh command if they reach this machine over an SSH tunnel. The link must be exact and verified (section 3).
- Tell them only what they need to know or decide:
  - the telemetry notice, on first install;
  - the desktop app recommendation, unless you know they already have the app. Say why it's worth having: it shows web pages inside Television, which a browser can't, and it gives Television its own window and Dock icon. If you know or suspect they use a Mac, recommend it directly; it is most likely eligible. Otherwise, mention that it's available in case they use a Mac. Don't ask about their computer just to decide this;
  - anything that blocks the work and needs their decision, such as an outdated Node version.
- Whenever you give them a connect link, tell them how to get it again: ask you, or run `tv links` on the machine Television runs on. `tv links` is the one command meant for the person.
- Everything else waits until they ask: troubleshooting, changing the setup.

### The shape of the work

Every task, whether installing, upgrading, or changing or fixing a setup, has four beats. Work out what goes in each from the situation and the technical reference.

1. **Check.** Inspect this machine and the person's request to work out as much as you can. The person sees nothing.
2. **Confirm.** Tell the person, in plain words, what you're about to do, even when it seems obvious, and ask anything you couldn't work out. Continue until everything is clear, then wait for their go-ahead.
3. **Do it.** The person sees nothing unless something goes wrong.
4. **Report.** One short message with the key results.

For an install:

- The confirm message says you'll install Television on this machine, set it to start automatically, and add the Television skills so you can use it. It also carries the telemetry notice and, on a Mac, a heads-up that macOS will show a notification about a new background item, which is expected.
- The report ends with what the person needs to connect. When the desktop app recommendation applies, the report includes it with the download link and short install steps, and says the connect link can be pasted into the app or opened in a browser. It also says how to get the link again.

For an upgrade:

- The confirm message says which version you'll upgrade to. No telemetry notice.
- The report says it's done and on which version, and anything the person has to do, such as reconnecting.

## Technical reference

The facts about Television that you need to install, upgrade, and look after it. The Install and Upgrade sections below put them in order for the common cases; come back here for anything they don't cover.

### 1. The software and where it runs

#### Supported machines

The agent and the Television server run on macOS or Linux. The viewer can be any computer with a browser, or a Mac with the desktop app (section 4).

#### Package and Node

The npm package `@telepath-computer/television` provides the `tv` command. It requires Node 22.12.0 or later. npm only warns about an unsupported Node version, so check `node --version` yourself before installing. Upgrading Node changes the person's system, so it is their decision: tell them, and continue only once Node is new enough.

#### Agent and server on the same machine

The `tv` command talks only to the server on `localhost`, and has no option to reach a server elsewhere. So the agent and the server run on the same machine: the same computer, VM, or VPS, or inside the same Docker container. Only the viewer reaches across the network. If the person describes a setup with the agent and server on different machines, resolve that before installing; otherwise the install appears to succeed and every later `tv` command fails to reach the server.

#### The server service

`tv serve --persist` installs the server as a per-user launchd service on macOS or systemd user service on Linux, named `com.television.server`, and starts it. It replaces any existing Television service, so rerunning it is how you apply changed settings or run upgraded code. It records the installing shell's `PATH` and Television's environment controls, such as `DO_NOT_TRACK`, so run it from a shell where those are as the service should have them, and where `tv` resolves to the intended install.

The first install on macOS makes macOS show a notification about a new background or login item. It may name "node", "Node.js Foundation", or an unidentified developer, because macOS names the Node binary rather than Television. It is the Television service and is expected.

Plain `tv serve` runs the server in the foreground and never exits, so don't use it as a test from an agent session.

#### Television home and config file

The *Television home* holds all of the server's state: its config file `config.json`, the access token at `state/token`, the log at `logs/tv.log`, and the person's channels and artifacts. It is `~/.television` unless `~/.tv-home` exists, in which case that file holds the path to use. Each `tv` command resolves the home separately; `--home <path>` overrides it for that one command only. So if the person wants their data somewhere else, write the path into `~/.tv-home` before installing, rather than relying on `--home`. The service records its own home when installed, and keeps it until `tv serve --persist` is rerun.

Settings live in the config file and are written with `tv config set <key> <value> [<key> <value> ...]`; `tv config show` prints the home, the config file path, and the effective settings. The keys are:

- `port`: default `32848`.
- `listen`: extra IPv4 addresses to listen on, besides localhost, which is always on (section 2). Default none.
- `auth`: whether the access token is required. Default `true` (section 3).
- `installedByAgent`: the name of the agent harness that installed Television, recorded in telemetry (section 5).

With no config file, every key has its default, so an ordinary install needs none. The server reads the file only when it starts; rerun `tv serve --persist` after changing it.

To move a home, stop the service, move the directory, point `~/.tv-home` at it, and rerun `tv serve --persist`. Artifacts whose files were inside the home still point at the old location; find them with `tv list-artifacts` and repoint each with `tv update-artifact --id <id> --path <new-path>`.

#### Skills

Television ships skills that teach agents to use it: the main `television` skill and several `tv-*` skills. `tv skills install <directory>` installs them into a skills directory, replacing any earlier copies. Install them where this agent actually loads skills from, respecting any location the person has set up. Locations vary by agent; common ones are `~/.agents/skills`, `~/.openclaw/workspace/skills` (OpenClaw), and `~/.hermes/skills` (Hermes). After installing, make sure the skills are available to you, refreshing if your harness requires it. On a first install, load the `television` skill right away, because the person will likely want to try Television straight after. Skill content changes between releases, so reinstall the skills on every upgrade.

### 2. How the viewer reaches the server

The server runs on this machine. The person views it from a browser or the desktop app on whatever computer they use, which may be this machine or another one. The server must listen on an address that computer can reach. Working that out is the main technical decision of an install.

#### Working out the person's situation

Gather evidence before asking. The useful sources:

- **The request.** A person who says they are on the desktop app connect screen is on a Mac with the app open.
- **What you know about the person**, from memory or earlier conversation: which computers they use, how they usually reach this machine.
- **This machine's operating system, and whether it has a desktop session.** A Mac or a Linux machine with a graphical session may be the computer the person sits at. A Linux server with no display, a VPS, or a container is not; the person views from somewhere else.
- **Whether the desktop app is running here.** On a Mac, a running `Television` process (the app's process name) means the person is at this Mac with the app open.
- **Tailscale.** If this machine is on a tailnet, `tailscale status` lists the person's other devices and their operating systems, which can show that their Mac or laptop is on the same tailnet.
- **Docker.** Whether you are running inside a container.

How you talk to the person says little about where they sit. Many agents are reached through a chat app or messaging service, so a person can be talking to you from a phone while the server is a machine in a closet. An SSH session in your environment suggests they reach this machine over SSH, but a long-lived terminal session can outlast the connection that started it.

Common conclusions:

- **This is a Mac and the desktop app is running here:** the person is at this machine. Same machine; nothing to ask.
- **This is the person's own desktop computer and they intend to view Television on it:** same machine.
- **The person views from another computer and this machine is on Tailscale, with their computer on the same tailnet:** Tailscale. Confirm it in the confirm message rather than asking an open question.
- **The person views from another computer and you can't tell how it reaches this machine:** ask, explaining why (see the user experience guide). If their only way in is SSH, an SSH tunnel works, but they have to keep a terminal running it whenever they use Television; if that sounds unwelcome, Tailscale is the better path, and setting it up is a reasonable thing to offer.

#### Each way of reaching the server, and its settings

Localhost (`127.0.0.1`) is always listened on. The `listen` setting adds more addresses: one comma-separated list of IPv4 addresses, which replaces the stored list; `tv config set listen ""` clears it.

| How the person reaches this machine | `listen` setting                                                                    | Address in the connect link                        |
| ----------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| Same machine                        | not set                                                                             | `localhost`                                        |
| SSH tunnel                          | not set; the person runs `ssh -L 32848:localhost:32848 <host>`                      | `localhost`, on their computer                     |
| Tailscale                           | this machine's tailnet IPv4 (`tailscale ip -4`)                                     | that tailnet address                               |
| Home or office network              | this machine's LAN IPv4, or `0.0.0.0` for every interface                           | the LAN address                                    |
| Docker                              | `0.0.0.0` inside the container; the host's port publishing decides who can reach it | the host's address, as the person reaches the host |
| More than one of these              | one list, such as `100.64.0.7,192.168.1.42`                                         | one link per address                               |

Prefer Tailscale over a LAN listener when both would work: a LAN listener relies more on the local network and the access token for protection.

#### Port

The default port is `32848`. Change it only for a real conflict, with `tv config set port <n>`; port `0` is refused. With an SSH tunnel or Docker port publishing, use the same port on both ends so the link keeps the port the server reports.

#### Addresses are stored literally

`listen` holds the literal addresses, evaluated when you set them. Every address must exist on the machine when the server starts: if any can't be bound, the server logs the failure, exits with status 69, and the service manager keeps retrying. So a Tailscale address that changes, or a LAN address reassigned by DHCP, stops the server until `listen` is updated and `tv serve --persist` rerun. `0.0.0.0` avoids this, at the cost of also listening on any interface added later.

#### Not for the public internet

Television serves plain HTTP and is designed for local or private networks. Don't expose it on a public address, or suggest doing so. If the person explicitly insists after hearing that, treat it as a separately confirmed exception, with the access token on.

### 3. Access token and connect links

#### The access token

The server requires an access token on every request, on every address it listens on, localhost included. The install creates the token at `<home>/state/token` if the home has none, and it stays the same across restarts and upgrades. The `tv` command reads it from there, so your own commands need nothing extra. The HTTP API takes it as a bearer token.

`tv config set auth false` turns the token off on every address; there is no per-address setting. Do this only when the person explicitly asks to run without a token. The server then prints a warning at every start and records it in the log.

Showing the person their full connect link is expected and correct: it is how they open Television. Don't put the token or links anywhere else, such as shared documents, issue reports, or Television artifacts.

#### Connect links

A *connect link* is the one thing the person needs to open Television: the server's address with the token in it, such as `http://100.64.0.7:32848/?token=<token>`. The same link works in a browser and in the desktop app. Without a token, the link is the plain address.

`tv links` prints the running server's connect links, one per line, one for each address it listens on. If the server isn't running, it prints none and says why.

The printed addresses are the server's own: `127.0.0.1` for localhost, and `0.0.0.0` when it listens on every interface. When the person reaches the server by a different address, give them the link with that address in place of the printed one, keeping the port and token exactly:

- through an SSH tunnel: `localhost`, opened on their computer, along with the `ssh -L` command they need to run first;
- for a `0.0.0.0` listener, including inside Docker: the address by which they reach this machine or its Docker host, such as its LAN or tailnet address.

#### The link must be exact

**A connect link with any error is a total failure of this guide's main purpose.** The token is a long random string, and the link fails if a single character is wrong. Every URL and token you give the person must be complete and exactly correct. Guard against every way it can be corrupted:

- **Copy, never retype or reconstruct.** Take the link from `tv links` output. When you substitute an address, change only the host and leave the port and the whole token untouched.
- **Never shorten it.** No ellipsis, no "…", no abbreviating the token, no "the same link as before".
- **Preserve case exactly.** The token is case-sensitive; don't let formatting or capitalization change any character.
- **Don't wrap or split it.** Put it on a line of its own, as plain text or in a code block, with no added spaces, line breaks, or trailing punctuation joined to it.
- **Verify before sending.** Compare the link in your message character by character with `tv links` output. Then test it: take the token from the exact link you're about to send and request an authenticated API route, such as `/channels`, at that link's address with it as a bearer token. A success proves both the address and the token. If the address isn't reachable from this machine, as with an SSH-tunnel `localhost` link or a Docker host address, test the token against `localhost` and check the address separately.

If you have any doubt that the link in your message is exact, check it again before sending.

#### Giving the link

Give the whole link, never shortened. The link is all the person ever needs: don't show them the bare token, ask them to type a token, or suggest storing it in a password manager. Tell them they can get it again by asking you, or by running `tv links` on the machine Television runs on; it is the one `tv` command meant for the person.

### 4. Viewers

The viewer runs on whatever computer the person uses to look at Television, which may not be this machine. Television's interface comes from the server; the viewer only displays it.

#### Browser

Any current browser opens Television from the connect link, on any computer that can reach the server. In a browser, Television can't display artifacts that are external web pages. In their place it shows a page saying the desktop app can show them, and telling the person to ask their agent to follow this guide to install it. A person who arrives that way wants the desktop app: if they view Television on an eligible Mac, give them the install steps below; otherwise, tell them the app is available only for Apple Silicon Macs and they can keep using the browser.

#### Desktop app

The Television desktop app is a native Mac app that shows Television in its own window, with its own Dock icon, and displays external web pages inside Television. It needs no Node or npm on the person's Mac, and it can't run on a machine without a display.

**Eligible computers.** Apple Silicon Macs running macOS 12 or later. There is no desktop app for Intel Macs, Linux, or Windows; on those, the person uses a browser.

**Whether the person already has it.** A person who says they are on the desktop app connect screen has it. If they view Television on this Mac, `/Applications/Television.app` or a running `Television` process shows they have it. On another computer you can't check, so rely on what you know or what they tell you.

**Installing it.** The person installs it themselves, like any Mac app:

1. Open `https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64` in a browser on the Mac. The link always downloads the latest release.
2. Open the downloaded disk image and drag Television to Applications.
3. Open Television from Applications, the Dock, or Spotlight.
4. Paste the connect link into the app and press **Connect**.

**Connecting and reconnecting.** On first launch the app shows a connect screen, which suggests a prompt for the person to give their agent and has a field for the connect link it gives back. The app checks the link with the server before saving it, and shows any problem, such as a wrong token, on that screen. Once connected, it remembers the connection and reconnects by itself each time it opens. To use a different link, for example after the server's address or token changes, the person chooses **Television › Disconnect from Server** and pastes the new link.

**Updates.** The app updates itself: it downloads new releases in the background and offers **Restart to update**. Restarting or upgrading the Television server never updates the app. If the server needs a newer app than the person has, the app shows a screen saying it needs an update, and offers the restart once the update has downloaded.

### 5. Telemetry

Television sends anonymous, content-free usage telemetry by default. It is used to understand early usage and improve Television, and never includes the person's content. The privacy notice is at `https://github.com/telepath-computer/television/blob/main/PRIVACY.md`.

#### The notice

On a first install, tell the person, in the confirm message: telemetry is on by default; it is anonymous and content-free; it helps the Television team understand early usage and improve Television; and if they would like it off, they can tell you and you'll turn it off. Their choice is stored in the Television home and survives upgrades, so don't repeat the notice when upgrading.

#### Turning it off

`tv telemetry disable` turns telemetry off and records that the person opted out, so the Television team can tell an opt-out from someone who stopped using it; `tv telemetry enable` turns it back on. Both need a running server, so if the person opts out during the confirm step, run `tv telemetry disable` as soon as the server is up. `tv status` shows the current state.

`DO_NOT_TRACK=1` in the environment also suppresses all telemetry, and a service installed with it set keeps it (section 1). Prefer `tv telemetry disable`, which the person can reverse by asking you and which records the opt-out.

The notice doesn't mention these controls. If the person asks how to control telemetry themselves, explain them: `tv telemetry disable` and `tv telemetry enable` on the machine Television runs on, `tv status` to see the current state, and `DO_NOT_TRACK=1`, which only takes effect for the service if it is set when the service is installed.

#### Recording the installing agent

Before installing the service, record which agent harness is installing Television: `tv config set installedByAgent <name>`. The name is the software running you, such as Claude Code, Codex, Hermes, OpenClaw, or Pi. Not a nickname or persona name, not a model name, and no version numbers or qualifiers.

### 6. Status and troubleshooting

PLANNED (not guide text yet). This section will cover:

- `tv status` fields; the health endpoint and bearer-token API; the log; the problems that aren't obvious (a `tv` command and the service using different homes, a stale connect link); service file locations.

### 7. Upgrades

PLANNED (not guide text yet). This section will cover:

- **How people learn about an update.** The in-app notice with a copyable prompt.
- **What an upgrade involves.** Package, skills, service, version check; what happens to browsers and the desktop app afterwards.
- **Services installed by older releases.** Settings carried into a config file; switching a tokenless server to a token.
- **Moving from the npm desktop app to the downloaded app.** Some people still use the desktop app installed with npm (`@telepath-computer/television-desktop`, started with `tv-desktop`), which gets no more updates. How to recognize it, including when the old app is on the person's Mac rather than this machine; what the old app shows the person; the steps for the person; removing the npm package; what carries over (the saved connection) and what may not (macOS camera, microphone and screen-recording permissions).

### 8. Stopping and uninstalling

PLANNED (not guide text yet). This section will cover:

- `tv stop`; removing the package and skills; deleting the home only with the person's confirmation.

## Install

TODO: the install workflow, combining the user experience guide with the technical reference at medium detail. It must cover the common case fully on its own.

TODO, must include: do not install the server until you know which computer the person will view Television from and how it reaches this machine, whether you worked that out yourself or asked. A server set up for the wrong network still reports healthy, but the person can't reach it.

## Upgrade

TODO: the upgrade workflow, same approach as Install.
