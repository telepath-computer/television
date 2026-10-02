> **Archived 2026-10 from PR #20.** This records the rulings Josh made while the administrator guide was rewritten and the principles drawn from them; the guide follows them as written. It preserves why the guide is structured as it is, which choices were deliberate, and which review suggestions were declined, none of which the guide itself states. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Administrator guide rewrite: principles and rulings

This records why the administrator guide (`docs/guides/television-admin-guide.md`, published at `https://television.run/install.md`) has its current structure and content. It collects the rulings Josh made while the guide was rewritten, and the principles that follow from them, so a later editor can tell which choices were deliberate.

## What prompted the rewrite

Josh tested the published guide with the prompt the desktop app's connect screen gives people to copy: "Read the Television admin guide at https://television.run/install.md and help me get Television installed. I'm on the desktop app connect screen." The agent was running on the same Mac Josh was sitting at. It opened by asking how he would reach that Mac, offering a numbered menu (sitting at it, Tailscale, home network, SSH, other), and it later printed the connect link in the middle of a long message.

The guide caused both failures. It required a conversation about how the person reaches the machine before every install, with no instruction to inspect the machine first, and its own suggested opening listed the network options. Several sections each added something to tell the person (stop and reinstall commands, recovery steps for a changed IP address, and more), so an agent that followed all of them produced a wall of text. The guide was 566 lines, repeated its key rules many times, and mixed reference material into the install steps.

## The guide's purpose

- **The main outcome is a working connect link in the person's hands.** An install ends with a short message whose last line is the link; everything else in the message, including how to get the link again, comes before it. Everything else in the guide serves that.
- **A link with any error fails the guide completely.** The agent copies the link from `tv links`, never retypes or shortens it, preserves case, keeps it on its own line, and verifies it before sending: it compares the link with `tv links` output and tests the link's token against an authenticated API route at the link's address.
- **Don't describe the link as "like a password".** An agent told that may refuse to show it or may shorten it. The guide says plainly that showing the person their full link is expected and correct, and that the token and links go nowhere else.

## The person and the agent

- **Protect the person from technical complexity.** No commands, settings, addresses, start and stop instructions, or edge cases such as "if your IP address changes", unless they are needed to connect or the person asks. The person can ask for help when a problem arises.
- **What the person is told is a short list:** the connect link (plus the ssh command for an SSH tunnel), the desktop app recommendation when it applies, the telemetry notice on a first install, the macOS background-item heads-up on a first install on a Mac, anything that changes what they need to do, and blockers that need their decision.
- **`tv links` is the one `tv` command meant for the person.** Whenever they get a connect link, they are told they can get it again by asking their agent or by running `tv links` on the machine Television runs on.
- **Defaults are the answer.** A setting changes from its default only when the situation requires it or the person asks. Optional settings, such as where data is kept, the port, or running without a token, are never offered as choices. A rule that only says "the person may want X" invites an agent to ask about X; the guide says "if the person asks".
- **Work things out before asking.** The agent inspects the machine and uses what it knows about the person. For the test above: a Mac running the desktop app means the person is sitting at that Mac, so there is nothing to ask.
- **Every question says why it matters and what kind of answer is wanted.** "How do you want to connect to your Television?" fails: the person can't tell whether it asks about a device, a network, or how often, or why it is being asked.
- **Confirm before changing the machine, even when the plan seems obvious.** Before installing, fixing, reconfiguring, or restarting, the agent tells the person what it is about to do, such as installing Television, setting it to start automatically, and adding skills, and waits for a go-ahead. Only giving information, such as the connect link for a setup that already works, needs no confirmation.

## The shape of every task

Every task, whether installing, upgrading, or changing or fixing a setup, has four steps: check (the agent inspects; the person sees nothing), confirm (one plain message, continuing until everything is clear), do it (the person sees nothing unless it needs their decision), and report (one short message with the key results). The steps describe the shape of the person's experience, which holds in every case; the agent works out what goes in each step from the situation. Fixed scripts of questions were rejected because agents follow them literally even when a step doesn't apply.

## The desktop app recommendation

The desktop app is strongly recommended unless the agent knows the person already has it. The recommendation says why it is worth having: it shows external web pages inside Television, which a browser can't, and it gives Television its own window and Dock icon.

- The agent knows the person has the app: no need to discuss it.
- The agent knows or suspects the person uses a Mac: recommend it directly. An unverified Mac is most likely eligible.
- The agent doesn't know: mention it as available in case they use a Mac.
- The agent knows there is no Mac: treated the same as not knowing, because it is rare and a one-line mention costs little.

The agent never asks about the person's computer just to decide this.

## Structure

The guide was built top-down, with each layer agreed before the next was written:

1. **Purpose.**
2. **What Television is, and who's who**, at a high level: the server, the `tv` tool, the viewer, and the two roles (the agent and the person).
3. **User experience guide**: the rules above, and the four steps.
4. **Technical reference**: an organized hierarchy of the facts specific to Television, complete enough that an agent could work out an install or upgrade from it alone.
5. **Install workflow**, and 6. **Upgrade workflow**: syntheses of the user experience guide and the reference for the common cases. They add no rules of their own, and say so: if a situation isn't covered or seems to differ, the user experience guide and the reference govern. They still fully cover the common case, because agents act on what is in front of them.

## Writing for a capable agent

The reader is assumed to know npm, ssh, Docker, Tailscale, curl, launchd, systemd, and general system administration. The guide states what is specific to Television and leaves the agent to work out commands. Recipes the agent can derive from stated facts are left out: npm install and uninstall commands, curl and tail checks once the guide has said that `/health` needs no token, that the API takes a bearer token, and where the log is, and Docker deployment patterns beyond the one Television-specific fact (listen on `0.0.0.0` inside the container).

The guide also assumes the agent's commands run without a sandbox, and says so. A sandboxed agent plans for what the sandbox blocks and may need permission to install. One non-obvious consequence is called out: a sandbox that blocks requests to `localhost` makes a running server look down.

Strong wording is kept where it prevents a known failure. The instruction not to work from a summary of the guide keeps the original guide's emphatic wording, because web fetch tools often summarize.

## Rare cases stay in the reference

Cases that rarely happen get their details in the technical reference and only a pointer in the workflows. The clearest example is an install from a much older release that ran without an access token: switching the token on during an upgrade means the person needs a new link. It is documented in the upgrade reference and marked rare, and appears nowhere in the user experience guide.

Moving people off the npm-installed desktop app (`tv-desktop`) is uncommon but still affects some people, so it has its own subsection in the upgrade reference, including how to recognize it when the old app is on the person's Mac rather than the agent's machine.

## Telemetry

The first-install notice says that telemetry is on by default, anonymous and content-free, used to understand early usage and improve Television, and that the agent will turn it off if asked. It names no commands. The guide still gives the agent `tv telemetry disable` and `enable`, `DO_NOT_TRACK=1`, and `tv status`, so it can explain them if the person wants to control telemetry themselves. The telemetry spec's description of the admin guide's disclosure (`specs/product/telemetry.md`, the administrator guide entry under Disclosure) was changed to match.

## Left out on purpose

- **Why a browser can't show external web pages** (sites refusing to be embedded, keyboard shortcuts that can't be captured inside them, unreliable navigation tracking). The agent only needs the behavior and the fix, the desktop app. If people ask why, the answer belongs in the `television` skill.
- **Onboarding channels.** The `television` skill covers them; they concern managing channels, not administration.

## Review

A Codex reviewer (gpt-6-astra) compared the rewrite with the previous guide and the specs; its findings were treated as advice. Adopted: checking the running version as well as the installed one before declaring an upgrade unnecessary; handling very old services (no config file, no `tv config` commands, possibly no token) in the upgrade reference only, leaving the normal upgrade path unchanged; applying the `listen` setting from the reference rather than a separate rule in the workflow; describing `tv stop` precisely; checking telemetry status after changing it; confirming only before changes; and putting the link last. Declined: weakening the evidence that a running desktop app means the person is at this Mac, because the confirm message already names the machine and more caveats would add exceptions; and restoring desktop update timing details.

## Related

- `tv stop` uninstalls the service, although its name suggests a pause with a matching start. The guide warns that it is not a pause. The command's naming is tracked in TV-926.
- `docs/working/admin-guide-fact-map.md` maps every technical fact in the previous guide to a section of the new technical reference, or records why it was cut.
