# Worker audit permission regression

The ready-PR unit job at `ca2f9024` failed all seven Linux worker-lease seam cases. It ran as an unprivileged GitHub user; each acquisition attempted to read `/proc/1/environ` before its fixture-token filter. The production helper's refusal on unknown ownership follows the converged release/recovery specification. Ignoring all permission errors would instead permit reuse without a clean audit.

The fixture must scope observations to its own operating-system user before reading process environments, as well as its declared owner tokens afterwards. Production retains a whole-worker audit with explicit refusal on unreadable ownership. Credential-changing processes matter: Linux may expose root-owned procfs files for a nondumpable process whose actual UID is still the fixture's user. Read the UIDs from procfs status, not directory ownership.

Primary Linux documentation: [environ access check](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html), [procfs ownership and dumpability](https://man7.org/linux/man-pages/man5/proc_pid.5.html).

## Validation

- Red revision: `6b5721cb`. Runs only on private Blaxel pool `rose-cleanup` from dedicated coordinator `tv-cleanup-coordinator-rose`.
- Red run `2026-10-27T22-09-09-927Z-p2368-re5fbca05226aef55`: one selected failure, exactly `EACCES: permission denied, open '/proc/1/environ'`. All 22 artifacts (106,383 bytes) downloaded with size checks. Command: `npm test -- blaxel --pool rose-cleanup --file test/repo/blaxel-worker-lease.test.ts --grep "fixture audit runs without root access" --run-dir-output /tmp/rose-ci-red-run.txt`.
- Regression runs the real generated command under UID 65534 when the test host is root. Additional checks require an unreadable whole-worker audit to retain the lease and leftovers, and a same-user nondumpable child to remain an audit failure.
- Green revision `704f484f`: whole `blaxel-worker-lease.test.ts` passed 10/10 in run `2026-10-27T22-11-06-608Z-p2970-r1fab74ce978afb24`; adjacent `blaxel-lease-contracts.test.ts` passed 10/10 in run `2026-10-27T22-11-39-709Z-p3087-r4ec4d055bae07cf6`. Both used the canonical Blaxel runner with default retry settings on the private pool, first infrastructure attempt, no test failures/recoveries, leaks or infrastructure failures. Downloaded and size-checked all 44 artifacts (165,216 bytes).
- One closing renewal warning occurred in the 31-second worker-lease run. Read-only SDK history shows release PID 6099 succeeded (teardown confirmed), then renewal PID 6510 failed with exit 42, both finishing at 22:11:38 UTC. The contract run's release PID 9983 succeeded at 22:11:49. Source inspection confirms renewal stops in the finalizer after release, allowing this diagnostic race. Results were already retained and worker reuse was safe; this warning does not establish loss during active ownership. The history is retained in `/tmp/rose-ci-worker-history.json`.
- No tests, builds, static checks, servers or browsers run on the shared development host.
- Primitive pre-commit discovery listed existing recovery/ownership decisions and reported truncation. This is incomplete discovery, not an authority clearance. The correction follows the converged fail-closed spec and changes no standing policy.
