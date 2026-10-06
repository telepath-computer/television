# TV-856 task record

Branch `thopter/serve-persist-fix-tv-856`. Ticket: `tv serve --persist` should wait for the server to be healthy before reporting success. Earlier ticket TV-506 (Planned) proposes the same probe; `specs/arch/cli/startup-bind-failure.md` lists it as a non-goal tracked there.

Handoff: the human gave the ticket alone and reviews spec deltas at PR time. The supervisor arranges every independent review; stages are committed, pushed, and reported.

## Shape

One slice: spec deltas → proofs → tests + code → PR.

## Decisions derived from the ticket and specs

- **What counts as answering.** The same request `tv status` makes: `GET /health` on `http://localhost:<config port>`. The ticket's aim is that the next `tv status` sees a healthy server.
- **Deadline: 15 seconds.** The ticket says "a few seconds". The bind-failure spec names the reinstall race (a new instance meeting `EADDRINUSE` from the terminating old one) as transient and handled by the service manager's restart, which comes after `RestartSec=5` on Linux and launchd's 10-second throttle on macOS. A deadline shorter than one macOS restart cycle would report failure for a state the specs call transient, which is the false-failure this ticket exists to remove. TV-506 proposed 10–15 seconds.
- **Failure.** Exit 1 (the ordinary error status; the CLI does not know the cause), nothing on stdout, an error naming the URL, the deadline, that the service remains installed, and `<home>/logs/tv.log`. No uninstall or rollback (TV-506; the installed, retrying service is the design). One CLI log record so tv.log shows when the install was judged unhealthy.
- **Telemetry notice.** The telemetry spec prints it "after successful … service installation". Installation succeeded on the failure path too, so the notice still prints, before the error. No telemetry spec change.
- **Connect URLs** stay derived from the config file, as before.
- **Server partial-bind window.** None: `Server.start()` binds and, on a failed bind, closes its listeners without yielding to the I/O poll phase, so a half-started server never answers the check.
- **Admin guide.** Describe the wait and the failure; add the sandbox case (a sandbox blocking loopback makes the check fail although the server runs); the ticket's "retry `tv status` before troubleshooting" note for a service starting at login or restarting.

## Known limits (report, not in scope)

- The check cannot tell which server answered. If another Television server already holds the port (a foreground `tv serve`), the check passes while the service cannot bind. On macOS, if `launchctl unload` returns before the old server exits, the first poll of a reinstall could reach the old server. Distinguishing them needs an instance identity in `/health` — an architecture change outside the ticket.
- TV-506 duplicates this ticket.

## Status

- [x] spec deltas drafted (product/cli.md, arch/cli/index.md, arch/cli/startup-bind-failure.md, arch/test-runner/test-runner.md; admin guide)
- [x] spec review round 1 FAIL (one blocker): the product spec and guide promised the service's server was up, while the check accepts any server answering on the port. Fixed by stating success as an answer on the configured port and naming the foreground-server case in the product spec and guide. The PR description must call out this port-conflict limit for human review.
- [x] spec review round 2 PASS (c56cf00e)
- [x] proofs drafted: product/cli.md (immediate `tv status` after install and reinstall; new ^cli-ac-persist-unanswered), arch/cli/index.md (two daemon-block contracts; HTTP crossing; fake timers declared), product/telemetry.md ^t-disclosure-persist (notice before the timeout error; stand-in health client). startup-bind-failure and test-runner proofs need no change: their specs gained no testable promise. Awaiting proof review.
- [x] proof review round 1 FAIL: new obligations were cited as covered by existing tests. Now marked test to be written, with existing coverage named separately; timing coverage described precisely (fake-clock contract owns the exact deadline; acceptance shows the real process waits and keeps the service).
- [x] proof review round 2 PASS (e82696df)
- [x] tests + code: red confirmed for the three new cli.test.ts contracts and the telemetry never-answering run (against the original CLI source); green after `waitForHealth` in `installPersistedService`. Daemon-acceptance: immediate `tv status` after install and reinstall, new unanswered phase, persist-uninstall installs over it. Daemon-acceptance NOT run: the human has not cleared it for this host. telemetry-posthog-roundtrip (real uniquely named service via the source driver; crosses the check too) not run either: opt-in, needs the PostHog test key, and installs a user service.
- [x] verification: Blaxel `npm run verify` on e60e2088 failed only `test/repo/test-infrastructure-addresses.test.ts` (literal `http://localhost:32848` in the telemetry test; now derived from the URL the CLI gives its client). On 18458053: passed, 23/23 surfaces, 0 recovered flakes, attestation refs/testpass/1/71055d65…. Daemon-acceptance and telemetry-posthog-roundtrip not run (need clearance).
- [x] implementation review round 1 FAIL: daemon-acceptance unrun (blocker, needed human permission). Refinement taken: fake install resolves after 1,000 ms so the contracts show polling and the deadline start at resolution (da70e0b1).
- [x] daemon-acceptance on da70e0b1, Linux 6.8.0-90-generic x86_64, Node v24.21.0, systemd user manager: passed in 28.7 s. Unanswered install exited 1 after 15,340 ms with 3 bind-failure records; service removed afterwards. Global tv replaced: 1.4.13 (commit 940a744a) → packed 1.4.23 (commit da70e0b1), left installed as the suite does.
- [x] telemetry-posthog-roundtrip on da70e0b1 (human-approved; test read key passed by env var only, never written or printed): passed, 6/6, 1 m 54 s; both persisted-daemon installs from source exited 0 inside the wait. Foreground from-source boot measured at ~0.4 s (3 runs, fresh homes).
- [ ] implementation review round 2
- [ ] PR
