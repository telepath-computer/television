# Television administration guide

## Purpose

This guide is for an agent setting up and maintaining Television for a person. The person should have an easy time: few or no questions, no technical detail they didn't ask for, and a short final message that ends with what they need to connect. The agent handles everything technical and explains only when asked.

The guide's most important outcome is a working connect link in the person's hands. A link with even one wrong character fails that outcome completely (section 3, "The link must be exact").

This guide assumes you are a capable agent who knows npm, ssh, Docker, Tailscale, curl, launchd, systemd, and general system administration. It states what is specific to Television and leaves you to work out the commands. It also assumes your commands run directly on the machine, not in a sandbox; if you are sandboxed, see "Running in a sandbox" in section 1.

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
- Use Television's defaults. A setting changes from its default only when the situation requires it, such as listening on a Tailscale address so the person's computer can reach Television, or when the person asks. Don't offer optional settings as choices, such as where Television keeps its data, the port, or running without a token; the person doesn't need to know they exist.
- Work things out yourself before asking. Ask only what you can't work out, in plain words, one question at a time, never as a menu of options.
- When you do ask, say why the answer matters and what kind of answer you need, so the question makes sense to someone who doesn't know how Television works. "How do you want to connect to your Television?" fails both: the person can't tell whether you mean a device, a network, or how often, or why you're asking. Better: "Television runs here on this server, and you'll view it from your own computer. To set it up so your computer can reach it, I need to know: is that computer on the same Tailscale network as this server?"
- Keep the final message short. When the person needs to connect, end it with what they need: the connect link, plus the ssh command if they reach this machine over an SSH tunnel. The link must be exact and verified (section 3).
- Tell them only what they need to know or decide:
  - the telemetry notice, on first install;
  - the desktop app recommendation, unless you know they already have the app. Say why it's worth having: it shows web pages inside Television, which a browser can't, and it gives Television its own window and Dock icon. If you know or suspect they use a Mac, recommend it directly; it is most likely eligible. Otherwise, mention that it's available in case they use a Mac. Don't ask about their computer just to decide this;
  - on a first install on a Mac, a heads-up that macOS will show a notification about a new background item;
  - anything that changes what they need to do to keep using Television;
  - anything that blocks the work and needs their decision, such as an outdated Node version.
- Whenever you give them a connect link, tell them how to get it again: ask you, or run `tv links` on the machine Television runs on. `tv links` is the one `tv` command meant for the person.
- Everything else waits until they ask: troubleshooting, changing the setup.

### The shape of the work

Every task, whether installing, upgrading, or changing or fixing a setup, has four beats. Work out what goes in each from the situation and the technical reference.

1. **Check.** Inspect this machine and the person's request to work out as much as you can. The person sees nothing.
2. **Confirm.** Before anything that changes this machine, such as installing, fixing, reconfiguring, or restarting, tell the person in plain words what you're about to do, even when it seems obvious, and ask anything you couldn't work out. Continue until everything is clear, then wait for their go-ahead. When you are only giving the person information, such as their connect link for a setup that already works, there is nothing to confirm.
3. **Do it.** The person sees nothing. If something goes wrong, fix it if you can, and tell them only if it needs their decision or changes what they'll get.
4. **Report.** One short message with the key results.

For an install:

- The confirm message says you'll install Television on this machine, set it to start automatically, and add the Television skills so you can use it. It also carries the telemetry notice and, on a Mac, a heads-up that macOS will show a notification about a new background item, which is expected.
- The report ends with what the person needs to connect. When the desktop app recommendation applies, the report includes it with the download link and short install steps, and says the connect link can be pasted into the app or opened in a browser. It also says how to get the link again.

For an upgrade:

- The confirm message says which version you'll upgrade to. No telemetry notice.
- The report says it's done and on which version, and anything the person has to do.

## Technical reference

The facts about Television that you need to install, upgrade, and look after it. The Install and Upgrade sections below put them in order for the common cases; come back here for anything they don't cover.

### 1. The software and where it runs

#### Supported machines

The agent and the Television server run on macOS or Linux. The viewer can be any computer with a browser, or a Mac with the desktop app (section 4).

#### Running in a sandbox

This guide assumes your commands run without a sandbox. Installing Television installs a global npm package, writes a per-user launchd or systemd service, writes files in the person's home directory, and talks to the server over HTTP on `localhost`. A sandbox can block any of these. If you run in one, plan for that before you start: you may need your harness to grant permission or to run particular commands outside the sandbox. If you need the person to approve that, say so in the confirm message.

A sandbox can also block HTTP requests to `localhost`. Then `tv serve --persist` reports that the server did not respond, `tv status`, `tv links`, and other commands report that the server isn't running when it is, and your link verification fails. Before concluding the server is down, check whether your sandbox allows loopback requests, for example by running the same command outside it.

#### Package and Node

The npm package `@telepath-computer/television` provides the `tv` command. It requires Node 22.12.0 or later. npm only warns about an unsupported Node version, so check `node --version` yourself before installing. Upgrading Node changes the person's system, so it is their decision: tell them, and continue only once Node is new enough.

#### Agent and server on the same machine

The `tv` command talks only to the server on `localhost`, and has no option to reach a server elsewhere. So the agent and the server run on the same machine: the same computer, VM, or VPS, or inside the same Docker container. Only the viewer reaches across the network. If the person describes a setup with the agent and server on different machines, resolve that before installing; otherwise the install appears to succeed and every later `tv` command fails to reach the server.

#### The server service

`tv serve --persist` installs the server as a per-user launchd service on macOS or systemd user service on Linux, named `com.television.server`, and starts it. It then waits up to 15 seconds for a server to answer on the configured port. Success normally means the service's server is up, but the command can't tell which server answered: if another Television server already uses that port, such as one started by hand with plain `tv serve`, that server answers and the service's server can't start, and the log shows the service's server failing because the port is in use. If no server answers in time, the command fails with a message saying so; the service stays installed, and the log usually says why (section 6). It replaces any existing Television service, so rerunning it is how you apply changed settings or run upgraded code. It records the installing shell's `PATH` and Television's environment controls, such as `DO_NOT_TRACK`, so run it from a shell where those are as the service should have them, and where `tv` resolves to the intended install.

The first install on macOS makes macOS show a notification about a new background or login item. It may name "node", "Node.js Foundation", or an unidentified developer, because macOS names the Node binary rather than Television. It is the Television service and is expected.

Plain `tv serve` runs the server in the foreground and never exits, so don't use it as a test from an agent session.

#### Television home and config file

The *Television home* holds all of the server's state: its config file `config.json`, the access token at `state/token`, the log at `logs/tv.log`, and the person's channels and artifacts. It is `~/.television` unless `~/.tv-home` exists, in which case that file holds the path to use. Each `tv` command resolves the home separately; `--home <path>` overrides it for that one command only. So if the person asks to keep their data somewhere else, write the path into `~/.tv-home` before installing, rather than relying on `--home`. The service records its own home when installed, and keeps it until `tv serve --persist` is rerun.

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

`tv telemetry disable` turns telemetry off and records that the person opted out, so the Television team can tell an opt-out from someone who stopped using it; `tv telemetry enable` turns it back on. Both need a running server, so if the person opts out during the confirm step, run `tv telemetry disable` as soon as the server is up. `tv status` shows the current state. Telemetry stays off regardless of `tv telemetry enable` when `DO_NOT_TRACK` or `CI` was set for the service, or on a Television developer's machine, so check the status the command returns before telling the person the result.

`DO_NOT_TRACK=1` in the environment also suppresses all telemetry, and a service installed with it set keeps it (section 1). Prefer `tv telemetry disable`, which the person can reverse by asking you and which records the opt-out.

The notice doesn't mention these controls. If the person asks how to control telemetry themselves, explain them: `tv telemetry disable` and `tv telemetry enable` on the machine Television runs on, `tv status` to see the current state, and `DO_NOT_TRACK=1`, which only takes effect for the service if it is set when the service is installed.

#### Recording the installing agent

Before installing the service, record which agent harness is installing Television: `tv config set installedByAgent <name>`. The name is the software running you, such as Claude Code, Codex, Hermes, OpenClaw, or Pi. Not a nickname or persona name, not a model name, and no version numbers or qualifiers.

### 6. Status and troubleshooting

#### Where to look

- **`tv status`** prints JSON: `home` (the home this command resolved), `healthy`, and, when the server answers, `version`, `port`, `bindAddresses`, and the telemetry state; plus `daemon.installed` and `daemon.running` for the service. A healthy install shows `healthy`, `daemon.installed`, and `daemon.running` all true.
- **The server's HTTP endpoints.** `/health` needs no token. API routes, such as `/channels`, take the token as a bearer token.
- **The log** at `<home>/logs/tv.log`, which records startups, failures, and listener problems.
- **The service definition.** On macOS, `~/Library/LaunchAgents/com.television.server.plist`; on Linux, `~/.config/systemd/user/com.television.server.service`. It records the home, environment, and command the service runs with.

#### Problems that aren't obvious

- **`tv` commands and the service use different homes.** `tv status` reports the home the command resolved, which the server doesn't know. If it differs from the home in the service definition, commands may report an unhealthy or unauthorized server while the service is fine. Point `~/.tv-home` at the service's home, or reinstall the service from the intended home.
- **`tv serve --persist` says the server did not respond.** The service is installed, but its server isn't answering. The log usually names the cause, such as a `listen` address that isn't on this machine or a port another program is using. Fix the setting and rerun `tv serve --persist`. If the log shows the server running, check whether a sandbox is blocking `localhost` (section 1).
- **`tv status` reports `healthy: false` soon after the computer starts or the person logs in.** The service takes a few seconds to start, and the service manager keeps restarting a server that can't start yet, for example while a Tailscale address isn't up. If `daemon.installed` is true, check again after about 15 seconds before troubleshooting.
- **The server won't stay up after a network change.** A `listen` address that no longer exists on the machine stops the server from starting; the log names the address. Update `listen` and rerun `tv serve --persist` (section 2).
- **The person sees "Access token required".** Their link's token doesn't match the server's. Check the server's token works locally; if it does, their link is stale or was corrupted. Give them their current link. In a browser, they open it; in the desktop app, they choose **Television › Disconnect from Server** and paste it.
- **The person can't reach the server from another computer.** Check that the address they use is in `bindAddresses`, that it is still this machine's address, and, for an SSH tunnel, that their tunnel is running and they're opening the `localhost` link. Then check what lies between: Tailscale connectivity, a firewall, or Docker port publishing.
- **`tv` commands say the server isn't running, but the service is running.** If you run in a sandbox, it may be blocking HTTP requests to `localhost` (section 1, "Running in a sandbox").
- **The desktop app shows "Can't connect with server".** The server can't be reached from the person's Mac. The app keeps retrying and reconnects by itself once the server is reachable.

### 7. Upgrades

The Television server never upgrades itself; the person's agent upgrades it. The downloaded desktop app updates itself (section 4).

#### How people learn about an update

When a release worth taking comes out, Television shows the person a notice with a bell icon and a **Copy upgrade prompt** button. The prompt asks their agent to fetch this guide and upgrade Television, so an upgrade request usually arrives in that form. People can also arrive from an older install's log or error message, which points to this guide when it meets settings from an earlier release.

#### What an upgrade involves

1. **Upgrade the package** to `@telepath-computer/television@latest`, after checking Node (section 1), and confirm `tv --version` reports the new release. Compare the latest version on the npm registry with both the installed version and the running version from `tv status` first; if all three match, there is nothing to upgrade.
2. **Reinstall the skills** into the directory where they are already installed. Find it by looking for the installed `television` and `tv-*` skills where this agent loads skills from.
3. **Reinstall the service** with `tv serve --persist`, so it runs the new code. Check the settings first, as the next subsection describes. The restart makes Television unavailable for a few seconds; open browser tabs and the desktop app reconnect by themselves.
4. **Verify.** In `tv status`, `healthy`, `daemon.installed`, and `daemon.running` are true, and `version` equals the `major.minor.patch` that `tv --version` reports; ignore a `(commit …)` suffix on development builds. A different version means the service didn't restart onto the new code.

Keep the Television home: it holds the person's channels, artifacts, and token, and the token is unchanged, so their connect link keeps working. Don't repeat the telemetry notice.

After the upgrade, open browser tabs reload themselves once when they reconnect; the person does nothing. A desktop app keeps working unless the new server needs a newer app, in which case it shows a screen saying it needs an update (section 4).

#### Settings before reinstalling the service

`tv config show` shows the settings the service will use. Before rerunning `tv serve --persist`, check:

- **The home.** Releases before the Television home kept data in `~/.television`, or in a directory given with `--storage-path` or `TELEVISION_STORAGE_PATH`. That directory already has the home's layout. If it isn't `~/.television`, write its path into `~/.tv-home` so the reinstalled service and every `tv` command use it in place. `TELEVISION_PORT` and `TELEVISION_STORAGE_PATH` are now ignored; a warning appears while either is set.
- **Settings from an older service.** Older releases took settings as command options, which the service definition still holds. A service from an older release keeps running after the package upgrade, and the first time it starts with no config file in its home, it writes its old options into one. If `tv config show` reports `configFileExists` as false, set `port` and `listen` from the old service definition yourself; if that definition has no `--auth` option, the service ran without a token, and the access token item below applies. Reinstalling then replaces the old definition. Releases from before the config file have no `tv config` commands, so on those, read the old service definition before upgrading the package and run `tv config show` after.
- **The access token (rare).** A home from a much older release can have `auth` set to `false`. Television expects the token: set `auth` to `true` unless the person has explicitly asked to run without one. The person then needs a new link: tell them in the confirm message, and give it to them in the report. In a browser they open it; in the desktop app they choose **Television › Disconnect from Server** and paste it. If they then ask to go back to no token, set it back.
- **Listen addresses.** If `listen` holds a Tailscale or LAN address, check it is still this machine's address (section 2). If the set of addresses changes, the person may lose a way of reaching Television; tell them.
- **`installedByAgent`.** If it is unset, set it (section 5).

#### Moving from the npm desktop app to the downloaded app

Desktop apps up to Television 1.3 were installed with the npm package `@telepath-computer/television-desktop` and started with `tv-desktop`. That package gets no more updates. A small number of people still use it. The downloaded app replaces it and keeps its saved server connection, so the person doesn't need to reconnect.

**Recognizing it.** The npm app may be on this machine or on the person's own Mac. On this machine, the npm package is installed globally. On their Mac you can't check, so recognize it from what they tell you:

- they start the app with `tv-desktop`;
- the app shows a notice saying that the desktop app is now a downloaded Mac app that updates itself, and that this copy was installed with npm and receives no more updates. The notice gives the download link and steps but no prompt for an agent, so the person may simply ask you about it;
- an npm app older than the server requires shows a screen saying the desktop app needs to be updated, with a download link.

When you find the npm package on this machine during an upgrade, tell the person and offer the move.

**The person's steps.** They make the move themselves, like installing any Mac app:

1. Download the app and drag it to Applications (section 4, steps 1 and 2).
2. Quit the npm app, then open Television from Applications. While the npm app is running, macOS may bring it forward instead of the new app.
3. From then on, open Television from Applications, the Dock, or Spotlight, not with `tv-desktop`.

The new app opens with the saved server connection. If it shows the connect screen instead, give them their connect link. macOS may ask again for camera, microphone, or screen-recording permission, because the downloaded app is signed differently.

**Afterwards,** remove the npm package wherever you can see it installed. Saved connections and settings belong to the app's data, not the package, and stay. A copy left on a machine you can't reach does no harm once the person stops using `tv-desktop`.

### 8. Stopping and uninstalling

`tv stop` removes the service and stops the server that the service runs. A server started by hand with plain `tv serve` is not affected. It is not a pause: Television won't start again, at login or otherwise, until `tv serve --persist` runs again. It leaves the package, the skills, and the Television home in place, so reinstalling the service brings everything back as it was.

To uninstall completely, also remove the npm package and the Television skills, the `television` and `tv-*` skills, from every skills directory where they were installed. If the person uses the desktop app, they remove it from their Mac themselves, like any Mac app.

Deleting the Television home, and `~/.tv-home` if it exists, permanently deletes the person's channels, artifacts, and token. Always get the person's explicit confirmation first, and say plainly that it can't be undone unless they have a backup.

## Install

Use this when the person wants Television set up, including when it is already installed and they just need to connect, as from the desktop app's connect screen. It follows the four beats in the user experience guide.

This workflow adds no new rules. It puts the user experience guide and the technical reference in order for the common cases. Follow it, and if your situation isn't covered here or seems to differ, those two sections govern.

### 1. Check

Work out, without involving the person:

- **What's already here.** Whether `tv` is installed, and if so, what `tv status` reports. If Television is installed and healthy, go to "When Television is already installed" below. If it is installed but not healthy, work out what's wrong (section 6), and include the fix in the confirm message.
- **This machine.** It must be macOS or Linux, with Node 22.12.0 or later (section 1). If your commands run in a sandbox, plan for what it blocks (section 1, "Running in a sandbox").
- **Which computer the person will view Television on, and how it reaches this machine** (section 2). This decides the `listen` setting.
- **Whether they have the desktop app** (section 4).
- **This agent's skills directory** (section 1).

Don't install anything until you know which computer the person will view Television on and how it reaches this machine, whether you worked that out or asked. A server set up for the wrong network still reports healthy, but the person can't reach it.

### 2. Confirm

Send one message, in plain words:

- what you're about to do: install Television on this machine, set it to start automatically, and add the Television skills so you can use it;
- anything you couldn't work out, asked with why it matters;
- anything that blocks the install and needs their decision, such as an outdated Node version;
- the telemetry notice (section 5);
- on a Mac, a heads-up that macOS will show a notification about a new background item, which is expected.

Then wait for their go-ahead. For a person on the desktop app connect screen with the app on this Mac, the whole message can be:

> I'll set up Television here on this Mac: install it, set it to start automatically, and add the Television skills so I can put things on it. When it's ready, I'll give you a link to paste into the app. macOS will show a notice about a new background item; that's Television, and it's expected. Television sends anonymous, content-free usage data to help improve it; tell me anytime if you'd like that off. OK to go ahead?

### 3. Do it

1. Install the package, if it isn't installed (section 1).
2. Install the skills, make sure they're available to you, and load the `television` skill (section 1).
3. Set `installedByAgent` (section 5), and apply the `listen` setting that section 2 gives for how the person reaches this machine. If the person has asked to keep their data outside `~/.television`, write that path into `~/.tv-home` first.
4. Run `tv serve --persist`. If it says the server did not respond, work out why (section 6) before going on.
5. Check `tv status` (section 6). If the person asked to turn telemetry off, run `tv telemetry disable` now.
6. Get the connect link from `tv links`, adjust its address if needed, and verify it exactly as section 3 requires.

If something fails, fix it if you can. Tell the person only if it needs their decision or changes what they'll get.

### 4. Report

One short message, in this order, ending with the link:

- the desktop app recommendation, when it applies (user experience guide), with the download link and steps from section 4;
- for an SSH tunnel, the `ssh -L` command to run first, and that it must stay running while they use Television;
- how to open the link: paste it into the desktop app and press **Connect**, or open it in a browser;
- that they can get the link again by asking you, or by running `tv links` on this machine;
- last, the connect link, complete and verified, on a line of its own.

For the person on the connect screen above:

> Television is ready. Paste this link into the app and press Connect. If you ever need it again, ask me, or run `tv links` on this Mac.
>
> `<the connect link, complete>`

### When Television is already installed

If the person needs to connect to a working install, check whether the current `listen` setting lets their computer reach it (section 2). If it does, give them the verified link, with the report's other parts that apply. If it doesn't, confirm the change with them, update `listen`, rerun `tv serve --persist`, and then give them the link. Don't repeat the telemetry notice.

### When the person wants the desktop app

A person can arrive asking only for the desktop app, for example from the browser's page about external web pages (section 4). If Television is installed and they view it on an eligible Mac, give them the download link and steps, and their verified connect link to paste into the app. If their computer isn't eligible, say the app is available only for Apple Silicon Macs and they can keep using the browser.

## Upgrade

Use this when the person asks to upgrade Television, usually by pasting the prompt from Television's update notice. It follows the four beats in the user experience guide; section 7 holds the details.

Like Install, this workflow adds no new rules. It puts the user experience guide and the technical reference in order for the common cases. Follow it, and if your situation isn't covered here or seems to differ, those two sections govern.

### 1. Check

Work out, without involving the person:

- **The installed and latest versions.** `tv --version` and `tv status` for what's installed and running; the npm registry for the latest release. If both the installed and the running versions are the latest release, tell the person and stop.
- **Node** is still 22.12.0 or later (section 1).
- **Where the skills are installed** (section 7).
- **The settings the service will use**: work through the settings checks in section 7.
- **An npm desktop app** installed on this machine (section 7).

### 2. Confirm

Send one message, in plain words:

- what you're about to do: upgrade Television from the installed version to the new one, and update its skills; Television will be unavailable for a few seconds and open windows reconnect by themselves;
- in the rare cases where section 7 says the person's connection changes, that they'll need a new link;
- anything that needs their decision, such as an outdated Node version;
- if you found the npm desktop app on this machine, an offer to move them to the downloaded app.

No telemetry notice. Then wait for their go-ahead.

### 3. Do it

1. Upgrade the package and confirm the new version (section 7).
2. Reinstall the skills into the same directory.
3. Fix the settings you found in the check (section 7), then run `tv serve --persist`.
4. Verify the running version matches the installed one (section 7).
5. In the rare case that the person needs a new link (section 7), get it from `tv links` and verify it exactly as section 3 requires.

### 4. Report

One short message: Television is upgraded, and to which version. Add only what the person needs to act on:

- the steps to move off the npm desktop app, if that applies (section 7);
- in the rare case they need a new connect link (section 7), the link, complete and verified, with how to use it: open it in a browser, or in the desktop app choose **Television › Disconnect from Server** and paste it; and that they can get it again by asking you or running `tv links` on this machine.

## Read this guide in full

**DO NOT WORK FROM A TRUNCATED OR SUMMARIZED COPY OF THIS GUIDE.** Web fetch tools and file readers often return only the beginning or the end of a long document, or a summary of it. Any of these leaves out instructions you need, and following a partial guide leads to a broken setup or a connect link that doesn't work.

If you did not read every section from Purpose through this one, stop and get the whole guide before doing anything else. Go to whatever lengths are necessary: fetch it with `curl -fsSL https://television.run/install.md`, save it to a file, and read that file in parts until you have read all of it. This section is the last one; if you have reached it after reading everything above it, you have the whole guide.
