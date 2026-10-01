import { DEV_VERSION, isReleaseVersion } from "@telepath-computer/television-shared";

// Stamp-only version resolution for the update-notifications domain
// (specs/arch/updates/index.md ^updates-dev-version): the __TV_VERSION__
// build define when present, else 0.0.0. The package.json fallback inside
// readServerPackageVersion() (server.ts) serves telemetry's own reporting and
// is never consulted here.
//
// The TV_TEST_* readers below are TEST-ONLY hooks (as opposed to the
// operational TV_UPDATE_CHANNEL_* family): each is consulted exactly when the
// stamp is absent — published builds define __TV_VERSION__ and short-circuit
// before any env read, so release builds are inert to them by construction
// (version-advertisement.md ^hook-server-version,
// desktop-upgrade-gate.md ^hook-required-version).

declare const __TV_VERSION__: string | undefined;

/** The build-time version stamp, or undefined when running from source. */
export function readVersionStamp(): string | undefined {
  if (typeof __TV_VERSION__ === "string" && __TV_VERSION__.length > 0) return __TV_VERSION__;
  return undefined;
}

/**
 * The server's release version as the update domain sees it: the stamp when
 * present; else TV_TEST_VERSION (valid triples only); else "0.0.0".
 */
export function resolveUpdateReleaseVersion(
  env: NodeJS.ProcessEnv = process.env,
  stamp: string | undefined = readVersionStamp(),
): string {
  if (stamp !== undefined) return stamp;
  const hook = env.TV_TEST_VERSION;
  if (hook !== undefined && isReleaseVersion(hook)) return hook;
  return DEV_VERSION;
}

/**
 * The required desktop version the server advertises, before the message
 * builder's own rules (a 0.0.0 server advertises none — that rule lives with
 * the builder): the baked constant, overridable by
 * TV_TEST_REQUIRED_DESKTOP_VERSION exactly when the stamp is absent.
 */
export function resolveRequiredDesktopVersion(
  baked: string | null,
  env: NodeJS.ProcessEnv = process.env,
  stamp: string | undefined = readVersionStamp(),
): string | null {
  if (stamp !== undefined) return baked;
  const hook = env.TV_TEST_REQUIRED_DESKTOP_VERSION;
  if (hook !== undefined && isReleaseVersion(hook)) return hook;
  return baked;
}
