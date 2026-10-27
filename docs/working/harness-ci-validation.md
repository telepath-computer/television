# Worker audit permission regression

The ready-PR unit job at `ca2f9024` failed all seven Linux worker-lease seam cases. It ran as an unprivileged GitHub user; each acquisition attempted to read `/proc/1/environ` before its fixture-token filter. The production helper's refusal on unknown ownership follows the converged release/recovery specification. Ignoring all permission errors would instead permit reuse without a clean audit.

The fixture must scope observations to its own operating-system user before reading process environments, as well as its declared owner tokens afterwards. Production retains a whole-worker audit with explicit refusal on unreadable ownership. Credential-changing processes matter: Linux may expose root-owned procfs files for a nondumpable process whose actual UID is still the fixture's user. Read the UIDs from procfs status, not directory ownership.

Primary Linux documentation: [environ access check](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html), [procfs ownership and dumpability](https://man7.org/linux/man-pages/man5/proc_pid.5.html).

## Validation

- Red revision: `6b5721cb`. Runs only on private Blaxel pool `rose-cleanup` from dedicated coordinator `tv-cleanup-coordinator-rose`.
- Red run `2026-10-27T22-09-09-927Z-p2368-re5fbca05226aef55`: one selected failure, exactly `EACCES: permission denied, open '/proc/1/environ'`. All 22 artifacts (106,383 bytes) downloaded with size checks. Command: `npm test -- blaxel --pool rose-cleanup --file test/repo/blaxel-worker-lease.test.ts --grep "fixture audit runs without root access" --run-dir-output /tmp/rose-ci-red-run.txt`.
- Regression runs the real generated command under UID 65534 when the test host is root. Additional checks require an unreadable whole-worker audit to retain the lease and leftovers, and a same-user nondumpable child to remain an audit failure.
- No tests, builds, static checks, servers or browsers run on the shared development host.
- Primitive pre-commit discovery listed existing recovery/ownership decisions and reported truncation. This is incomplete discovery, not an authority clearance. The correction follows the converged fail-closed spec and changes no standing policy.
