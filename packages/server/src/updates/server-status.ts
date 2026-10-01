import { DEV_VERSION, type ServerStatusMessage, type UpdateState } from "@telepath-computer/television-shared";
import { REQUIRED_DESKTOP_VERSION } from "../required-desktop-version.ts";
import { readVersionStamp, resolveRequiredDesktopVersion, resolveUpdateReleaseVersion } from "./version.ts";

/**
 * The single producer of the `server-status` message
 * (specs/arch/updates/version-advertisement.md ^events-version): sent as the
 * first message on every /events connection, and re-broadcast when the update
 * state changes. The update-channel relay populates `update`
 * (update-channel.md ^relay); null when no valid channel data applies.
 *
 * A 0.0.0 (development) server advertises no desktop requirement
 * (desktop-upgrade-gate.md ^required-desktop-constant), which also keeps the
 * requirement hook inert unless the version hook stages a release version.
 */
export function buildServerStatus(
  env: NodeJS.ProcessEnv = process.env,
  stamp: string | undefined = readVersionStamp(),
  baked: string | null = REQUIRED_DESKTOP_VERSION,
  update: UpdateState | null = null,
): ServerStatusMessage {
  const version = resolveUpdateReleaseVersion(env, stamp);
  const requiredDesktopVersion = version === DEV_VERSION ? null : resolveRequiredDesktopVersion(baked, env, stamp);
  return { type: "server-status", version, requiredDesktopVersion, update };
}
