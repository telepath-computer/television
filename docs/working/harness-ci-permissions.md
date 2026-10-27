# Fixture process-scope correction

CI run 40593278197 at `4a285979` exposed unreadable PID 1315 even after filtering on user IDs. Its unit artifact is retained locally under `.test-runs/2026-10-27T22-14-58-709Z-p2449-r77a22f50db287c28`. User identity does not define the fixture's processes; a same-user process can also be unreadable. The production audit correctly refuses such uncertainty.

The Linux seam fixture should supply its actual process IDs, including both registered supervisor and descendant and the unrelated-owner sentinel in the recovery case. This substitutes process enumeration only. Procfs identity/token reads, start-time revalidation, signals, flock and filesystem operations remain real. Production enumerates the whole worker. The proof must state that the fixture forfeits whole-worker enumeration to the live qualification.

Red revision `294f2562` creates a same-user nondumpable process outside the fixture's process set on a root Blaxel worker, then runs acquisition unprivileged. It must reproduce the remaining failure before the process-set correction. The distinct negative case includes an unreadable process in the fixture's process set and must keep refusing acquisition.

Red run `2026-10-27T22-20-18-339Z-p2368-rf5d94786f0cb21bd` failed exactly on that outside process (PID 4962, EACCES). The canonical file/title selection used default retries. All 22 artifacts (103,107 bytes) were downloaded and size-checked before implementation.

All runs remain on committed and pushed revisions, through the canonical Blaxel runner, on private `rose-cleanup` workers from `tv-cleanup-coordinator-rose`. No tests or builds run on the shared host. No shared worker experiments are involved.
