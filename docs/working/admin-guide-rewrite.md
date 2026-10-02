# Television administration guide

<!-- WORKING DRAFT. Built top-down: each section is filled in once the layer above is agreed.
     Sections marked TODO are placeholders stating their intent. The current guide at
     docs/guides/television-admin-guide.md is a fact source only; at the end, check it for
     anything this draft dropped. -->

## Purpose

This guide is for an agent setting up and maintaining Television for a person. The person should have an easy time: few or no questions, no technical detail they didn't ask for, and a short final message that ends with what they need to connect. The agent handles everything technical and explains only when asked.

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
- Keep the final message short. When the person needs to connect, end it with what they need: the connect link, plus the ssh command if they reach this machine over an SSH tunnel.
- Tell them only what they need to know or decide:
  - the telemetry notice, on first install;
  - the desktop app recommendation, unless you know they already have the app. Say why it's worth having: it shows web pages inside Television, which a browser can't, and it gives Television its own window and Dock icon. If you know or suspect they use a Mac, recommend it directly; it is most likely eligible. Otherwise, mention that it's available in case they use a Mac. Don't ask about their computer just to decide this;
  - anything that blocks the work and needs their decision, such as an outdated Node version.
- Everything else waits until they ask: getting the link again, troubleshooting, changing the setup.

### The shape of the work

Every task, whether installing, upgrading, or changing or fixing a setup, has four beats. Work out what goes in each from the situation and the technical reference.

1. **Check.** Inspect this machine and the person's request to work out as much as you can. The person sees nothing.
2. **Confirm.** Tell the person, in plain words, what you're about to do, even when it seems obvious, and ask anything you couldn't work out. Continue until everything is clear, then wait for their go-ahead.
3. **Do it.** The person sees nothing unless something goes wrong.
4. **Report.** One short message with the key results.

For an install:

- The confirm message says you'll install Television on this machine, set it to start automatically, and add the Television skills so you can use it. It also carries the telemetry notice and, on a Mac, a heads-up that macOS will show a notification about a new background item, which is expected.
- The report ends with what the person needs to connect. When the desktop app recommendation applies, the report includes it with the download link and short install steps, and says the connect link can be pasted into the app or opened in a browser.

For an upgrade:

- The confirm message says which version you'll upgrade to. No telemetry notice.
- The report says it's done and on which version, and anything the person has to do, such as reconnecting.

## Technical reference

TODO: an organized hierarchy of technical facts and concerns, complete enough that an agent could work out install and upgrade from it alone.

Must include: the agent and server on the same machine, in full (the `tv` tool reaches only its own machine's server; in Docker the agent runs inside the same container; if the person describes the agent and server on different machines, resolve that before installing). The desktop app: which Macs are eligible, how to tell whether the person already has it, its download link and install steps.

## Install

TODO: the install workflow, combining the user experience guide with the technical reference at medium detail. It must cover the common case fully on its own.

Must include: do not install the server until you know which computer the person will view Television from and how it reaches this machine, whether you worked that out yourself or asked. A server set up for the wrong network still reports healthy, but the person can't reach it.

## Upgrade

TODO: the upgrade workflow, same approach as Install.
