> **Archived 2026-10 from `thopter/artifact-isolation`.** This was the task record for the human's directive to prove the desktop app's storage visibility with a matrix walk, and the walk in `packages/desktop/test/e2e/artifact-isolation.test.ts` follows the calls it records. It preserves why each gap in coverage went into the matrix, why sharing is stated per origin and cookies per host, what was left out, and the breaks that showed the walk can fail, which the isolation spec and its proof state only as outcomes. The body below is its working state, less its status section and a reference to a pull request outside this repository, and is a clue to the change, not a record of it.

# TV-958 storage-visibility matrix: task record

Working record for the human's directive to prove desktop storage visibility with a matrix walk in the real Electron app. It continues the [TV-958 task record](./tv-958-task-record.md).

## Observed matrix

Identical before and after the restart, and identical in `localStorage`, IndexedDB and cookies:

| Probe | Finds the markers of | Finds the token |
| --- | --- | --- |
| W, the window | W | yes |
| L1 | L1 | no |
| L2 | L2 | no |
| S1, S2, URL artifacts on the server's origin | S1, S2 | no |
| T1, T2, on `site-a.test` | T1, T2 | no |
| T3, on `site-b.test` | T3 | no |
| P, shared from a second server at `producer.test` | P | no |

## Breaks that show the walk can fail

Each was made in the working tree, run, and reverted with `git checkout`:

- **URL artifacts in the window's session** (the URL-artifact partition named `""`): W finds S1 and S2; S1 and S2 find W and the token.
- **Two local artifacts sharing a partition** (the key computed from the origin alone): L1 and L2 each find both.
- **A URL-artifact partition that does not persist** (named without `persist:`): before the restart the matrix holds; after it, every URL artifact finds nothing.

The first version of the test found each probe's webview by its expected session directory, so the first break failed it at setup, a webview not found, rather than in the matrix. The walk now finds each webview through the app's page, by its artifact's tab page and `getWebContentsId()`, so a webview in the wrong session is probed and the matrix shows the mistake.

## The directive's requirements

- Probes in the window's page, two local artifacts on the same origin, URL artifacts including two on one third-party origin and ones on the server's own origin, and whatever else belongs.
- Each probe writes a distinct marker, then probes for every other's; the result is compared against an expected matrix: local artifacts see only their own, URL artifacts share among themselves but see no artifact's or the window's, the window sees none of them, and nobody sees the token.
- Close three gaps in today's coverage: sharing on a third-party origin, cookies in the URL-artifact partition, and restart persistence of URL-artifact storage. Decide whether each belongs in the matrix or beside it.

## Calls made, and why

1. **All three gaps go in the matrix.** Two external page artifacts on one third-party origin show sharing there. Every probe writes a cookie as well as `localStorage` and IndexedDB, so the URL-artifact partition's cookies are probed with the rest. A second probing after a restart, without writing again, shows persistence for every partition at once, the URL-artifact partition included, rather than in a separate walk.
2. **"URL artifacts share among themselves" is stated per origin.** Within the URL-artifact partition, storage is shared only between pages of one origin, as the isolation spec already says (`^iso-desktop-sessions`). The expected matrix therefore says a URL artifact finds the markers of every URL artifact on its own origin and no other. A literal "all URL artifacts share" would be false for the third-party pages and the server-origin ones.
3. **Added probes.** A second third-party origin shows that the URL-artifact partition does not share across origins. A shared artifact from a second Television server covers the real-world shared-artifact case and the header rewriting on another host, where storage would otherwise throw.
4. **"Nobody sees the token" is stated as "only the window finds the token".** The window's page holds the token, so the matrix row for the window must include it.
5. **Left out of the matrix.**
   - The fallback partition: the real interface never uses it, and the partitions proof's fallback seam already shows it apart from the window.
   - A Markdown file artifact: its webview shows Television's own editor, where no artifact code runs, and its partition follows the same rule as the two HTML artifacts.
   - `sessionStorage`: it is per page in every arrangement, so it tells the partitions apart in no case.
6. **Cookies are written for the whole origin** (path `/`), so that a cookie reaches any same-origin page sharing its session. A cookie scoped to the page's own path would hide sharing between two artifacts' paths even in one session.
7. **Every origin in the walk is on a host of its own.** Browsers keep cookies per host, ignoring the port, so a test whose servers all listen on `127.0.0.1` would see URL artifacts on different origins share cookies, by browser rule rather than Television's. The directive says so, and the isolation spec's sentence on the URL-artifact partition (`^iso-desktop-sessions`) now says storage is kept apart by origin and cookies by host. In production this means two Television servers on one machine, reached at one host on different ports, share cookies in the URL-artifact partition. The proof will choose the hosts, for example `127.0.0.1`, `localhost` and further loopback addresses.
8. **Proof design.**
   - **Host names** come from Chromium's `--host-resolver-rules` mapping `*.test` to `127.0.0.1`, declared as a test hook as the resources proof does for browsers. Further loopback addresses such as `127.0.0.2` work on Linux but are not configured by default on a Mac, and `localhost` may resolve to `::1` first, where the servers do not listen.
   - **S1 and S2 sit at the server's own addresses of L1 and L2**, so the same documents load in two partitions; the walk tells their webviews apart by session storage path, as the storage walk it replaces did.
   - **P is added at `producer.test`**, so its cookies are on a host of their own; the producer server answers whatever `Host` it receives.
   - **The token check** looks for the token's value in every `localStorage` value and cookie a probe can read; the token is never put in IndexedDB.
   - **Writes, then reads.** Every probe writes before any reads, so each read sees every write; after the restart no probe writes, so what is found is what persisted.
   - **The matrix replaces the storage walk** under the same anchor, `^iso-t-desktop-storage`, which other proofs cite; it covers everything that walk did and more.
