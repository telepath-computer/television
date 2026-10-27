> **Archived 2026-10 from PR #20.** This ledger mapped every technical fact in the previous administrator guide to the rewritten guide's technical reference, or recorded why it was cut; the rewrite followed it, and later review changes to the reference are not reflected here. It preserves which facts from the previous guide were deliberately dropped and why, which the diff shows only as deletions. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Admin guide fact map

Every technical fact in the previous administrator guide (`docs/guides/television-admin-guide.md` before this change), mapped to a section of the rewritten guide's technical reference, or cut. The reader of the new guide is a capable agent that knows npm, ssh, Docker, Tailscale, curl, launchd, systemd and general system administration; facts it can derive from that knowledge plus the stated principles are cut.

Verdicts: **keep** (Television-specific, state it), **short** (keep the fact, drop the recipe or elaboration), **cut** (derivable, history, or owned elsewhere).

## 1. The software and where it runs

| Fact                                                                                                                                                            | Verdict                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The agent must run on macOS or Linux (README and desktop setup screen)                                                                                          | keep (missing from the current guide)            |
| `@telepath-computer/television` provides `tv`                                                                                                                   | keep                                             |
| Node 22.12.0 or later; npm's engine warning is advisory only, so check `node --version` yourself; upgrading Node is the person's decision                       | short                                            |
| `npm install -g`, verify with `tv --help` / `tv --version`; use the person's preferred Node setup if global installs don't fit                                  | cut (derivable)                                  |
| Make sure the `tv` on PATH is the intended install before installing the service                                                                                | short (matters because the service records PATH) |
| `tv serve --persist` installs a launchd/systemd service and replaces any existing one                                                                           | keep                                             |
| It records the installing shell's PATH and Television's environment controls (such as `DO_NOT_TRACK`) for the service                                           | keep                                             |
| Plain `tv serve` runs in the foreground and never exits, so it hangs an agent session                                                                           | short                                            |
| Service names: `com.television.server` plist in `~/Library/LaunchAgents`, systemd user unit of the same name                                                    | keep                                             |
| The `tv` tool talks only to `localhost:<port>`; there is no flag to point it at another machine                                                                 | keep                                             |
| "The previous `--server` flag was removed"                                                                                                                      | cut (history)                                    |
| Docker: the agent runs inside the same container as the server                                                                                                  | keep                                             |
| If the agent and server would be on different machines, resolve that before installing; otherwise `tv` commands silently fail                                   | keep                                             |
| Home resolution: `--home`, then the path in `~/.tv-home`, then `~/.television`; `--home` applies to one command only, so use `~/.tv-home` for a lasting install | keep                                             |
| Dropbox example for a custom home                                                                                                                               | cut                                              |
| The home holds `config.json`, the token at `state/token`, and the log at `logs/tv.log`                                                                          | keep                                             |
| Config keys `port`, `listen`, `auth`, `installedByAgent`; defaults; `tv config set k v [k v ...]`; `tv config show`                                             | keep                                             |
| The server reads config only at start; rerun `tv serve --persist` after a change                                                                                | keep                                             |
| Moving a home: stop, move, update `~/.tv-home`, serve                                                                                                           | short (derivable from the above)                 |
| Moving a home: artifacts whose files are inside the home still point at the old path; repoint with `tv update-artifact --id <id> --path <new>`                  | keep (not derivable)                             |
| Skills: `tv skills install <dir>`                                                                                                                               | keep                                             |
| Common skill directories: `~/.agents/skills`, `~/.openclaw/workspace/skills`, `~/.hermes/skills`; respect the person's stated preference                        | keep                                             |
| Confirm the skills are loaded afterwards, refreshing if needed                                                                                                  | short                                            |
| On first install, load the `television` skill so you can handle the person's first requests                                                                     | keep                                             |
| Skills are named `television` and `tv-*`                                                                                                                        | keep (needed for upgrade and uninstall)          |
| macOS shows a background/login-item notification naming "node", "Node.js Foundation" or an unidentified developer; it is the Television service                 | keep                                             |

## 2. How the viewer reaches the server

| Fact                                                                                                                                                                                                         | Verdict                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| How to work out the person's situation by inspecting this machine                                                                                                                                            | new (not in the current guide)                 |
| Default: `127.0.0.1:32848`; localhost is always bound                                                                                                                                                        | keep                                           |
| `listen` is one comma-separated list of IPv4 addresses, replaces the stored list, `""` clears it                                                                                                             | keep                                           |
| Every listed address must exist on the host at start, or the server exits (status 69), logs it, and the service manager retries                                                                              | keep                                           |
| Mapping: same machine or SSH tunnel → no `listen`; Tailscale → tailnet IPv4; home network → LAN IPv4 or `0.0.0.0`; inside Docker → `0.0.0.0` with the host's `-p` deciding exposure; combinations → one list | short (one table)                              |
| Tailscale is preferred over a LAN bind, which relies more on the network and the token                                                                                                                       | short                                          |
| Port: keep 32848 unless there's a real conflict; port 0 is refused                                                                                                                                           | keep                                           |
| Keep the same port on both ends of an SSH `-L` or Docker `-p` so the link stays `…:32848`                                                                                                                    | short                                          |
| Addresses are stored literally; a changed Tailscale or DHCP address stops the server until updated; `0.0.0.0` avoids this but exposes future interfaces too                                                  | short                                          |
| Docker: container network namespace, `-p 127.0.0.1:…` vs all interfaces, firewall, Tailscale sidecar, VPS prefers SSH tunnel                                                                                 | cut (standard Docker and networking knowledge) |
| Not designed for the public internet; only on the person's explicit, separately confirmed insistence, with the token on                                                                                      | keep                                           |
| Telling the person recovery commands for an address change in advance                                                                                                                                        | cut (user experience decision)                 |

## 3. Access token and connect links

| Fact                                                                                                                                                                                             | Verdict                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| The token is required on every request on every listener, including localhost; no per-listener setting                                                                                           | keep                                                                    |
| `auth false` turns it off everywhere; only on the person's explicit request; the server then prints a warning and logs it                                                                        | short                                                                   |
| Treat the token and links like a password                                                                                                                                                        | keep                                                                    |
| `tv links` prints one link per listener, with the token; prints none if the server isn't running                                                                                                 | keep                                                                    |
| Printed addresses are the server's own (`127.0.0.1`, `0.0.0.0`); substitute the address the person uses (`localhost` through a tunnel, the host's address for `0.0.0.0`), keeping port and token | keep                                                                    |
| Give the whole link; never the bare token; never ask the person to type a token or store it in a password manager                                                                                | keep                                                                    |
| Example links per connection type                                                                                                                                                                | cut (derivable)                                                         |
| For an SSH tunnel, give the `ssh -L` command along with the link                                                                                                                                 | keep (it's in the user experience guide; the reference states the fact) |

## 4. Viewers

| Fact                                                                                                                                                                                               | Verdict                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| The desktop app runs on the viewing computer; needs no Node; can't run on a headless machine                                                                                                       | keep                           |
| It shows web pages inside Television (a browser can't), plus its own window and Dock icon                                                                                                          | keep                           |
| Apple Silicon Macs on macOS 12 or later only; nothing for Intel Macs, Linux or Windows                                                                                                             | keep                           |
| Download link `https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64`, stable across releases; open the disk image, drag to Applications, open, paste the link, press Connect                       | keep                           |
| The app remembers its connection; to change it, Television › Disconnect from Server, then paste the new link                                                                                       | keep                           |
| It updates itself; a server restart never updates it; if the server needs a newer app, the app shows an update screen offering Restart to update                                                   | short                          |
| Update timing details (check at start and every ten minutes, update bell, install finishing after quit)                                                                                            | cut                            |
| How to tell whether the person already has the app                                                                                                                                                 | new (not in the current guide) |
| npm desktop app (`@telepath-computer/television-desktop`, started with `tv-desktop`, up to 1.3) gets no updates; move to the downloaded app, which reuses the saved connection                     | keep                           |
| Quit the npm app before opening the new one (macOS may bring the old one forward); macOS may ask for camera, microphone or screen permission again; uninstall the npm package where it's installed | short                          |
| Browser tabs reload themselves once after a server upgrade                                                                                                                                         | short (in section 7)           |

## 5. Telemetry

| Fact                                                                                                                | Verdict         |
| ------------------------------------------------------------------------------------------------------------------- | --------------- |
| On by default, anonymous, content-free; the notice content                                                          | keep            |
| The person's choice persists in the home across upgrades, so no notice on upgrade                                   | keep            |
| `tv telemetry disable` / `enable` need a running server; `tv status` shows the state                                | keep            |
| `installedByAgent` is the harness name (Claude Code, Codex, Hermes, OpenClaw, Pi), not a nickname, model or version | keep            |
| Quote a value with a space in the shell                                                                             | cut (derivable) |

## 6. Status and troubleshooting (merges the proposed sections 6 and 9)

| Fact                                                                                                                             | Verdict                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `tv status`: `healthy`, `daemon.installed`, `daemon.running`, `home`, `version`, `port`, `bindAddresses`                         | keep                                      |
| `/health` endpoint; the API takes the token as a bearer token; curl recipes                                                      | short (state the facts, drop the recipes) |
| Daemon not running → `tv serve --persist`; port conflict → resolve on the other side; skills in the wrong place → reinstall      | cut (derivable)                           |
| `tv` commands and the service can resolve different homes; compare `home` in `tv status` with `--home` in the service definition | keep                                      |
| "Access token required" in the browser or app means a stale or mangled link; give the current link                               | keep                                      |
| Can't connect remotely: check that the expected address is in `bindAddresses`, and the tunnel or firewall                        | short                                     |

## 7. Upgrades

| Fact                                                                                                                                                                               | Verdict         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Updates are announced in a notice in Television with a "Copy upgrade prompt" button; that's where an upgrade request usually comes from                                            | keep            |
| Upgrade the package, reinstall skills (their content changes every release), rerun `tv serve --persist` so the service runs the new code                                           | keep            |
| Recipe of check commands (`which tv`, `npm list -g …`)                                                                                                                             | cut (derivable) |
| A service installed by an older release keeps working; when it starts and the home has no config file, its settings are copied into one                                            | keep            |
| Before reinstalling: set `~/.tv-home` if the home is elsewhere; set `port`/`listen` if no config file exists yet; set `installedByAgent` if null                                   | short           |
| Tokenless mode is deprecated; on upgrade turn the token back on, tell the person and give them their link; restore tokenless only if they ask                                      | keep            |
| Before storing a Tailscale or LAN address again, check it is still current; dropping a listener makes the server unreachable from that network, so tell the person if that changes | short           |
| Verify: `tv status` `version` equals the `major.minor.patch` of `tv --version` (ignore a `(commit …)` suffix); a mismatch means the service didn't restart                         | keep            |
| Keep the home on upgrade; it holds channels, artifacts and the token                                                                                                               | short           |

## 8. Stopping and uninstalling

| Fact                                                                                                                                               | Verdict         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `tv stop` removes the service (not a pause); it won't start at login until `tv serve --persist` runs again; it leaves the package, skills and home | keep            |
| `npm uninstall -g …`                                                                                                                               | cut (derivable) |
| Remove the `television` and `tv-*` skills from every skills directory                                                                              | short           |
| Deleting the home and `~/.tv-home` loses channels, artifacts and the token; always confirm with the person first                                   | keep            |

## Cut entirely

| Content                                                                                                 | Why                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Onboarding channels (created once per home, `onboarding` marker)                                        | The `television` skill covers them; they're channel management, not administration                |
| Health-check curl recipes, troubleshooting curl and tail recipes                                        | Derivable from the stated facts                                                                   |
| Docker deployment patterns                                                                              | Standard Docker knowledge plus the one Television fact (listen on `0.0.0.0` inside the container) |
| Example link formats per connection type                                                                | Derivable from the substitution rule                                                              |
| Repeated instructions (telemetry timing five times, "don't install before the conversation" four times) | Stated once                                                                                       |
