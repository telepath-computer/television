/**
 * The *required desktop version*: the minimum desktop release this server is
 * meant to be used with, advertised to clients on every `/events` connection
 * and enforced by the desktop upgrade gate in the served web client
 * (specs/arch/updates/desktop-upgrade-gate.md ^required-desktop-version,
 * ^required-desktop-constant).
 *
 * Bumped DELIBERATELY, BY HAND — never derived from the server's release
 * version, since most releases have no desktop release. Routine releases
 * leave it untouched. The pull request that raises it pauses npm publishing
 * so that the desktop release comes out first, and the update-channel notice
 * carrying desktop upgrade instructions follows the publish (^ops-bump).
 * `null` = this server advertises no requirement; no desktop is ever gated.
 *
 * Desktop 1.5.0 completes artifact isolation in the desktop app: it accepts
 * IPC only from its window and keeps artifact webviews apart from the
 * window's session. Earlier shells let artifact code reach the desktop app's
 * native functions. This floor and the recommendation below it are owned by
 * ^ops-first-gate.
 */
export const REQUIRED_DESKTOP_VERSION: string | null = "1.5.0";
