// Release-version model for the update-notifications domain, per
// specs/arch/updates/index.md ^updates-dev-version and
// ^updates-version-comparisons. Versions are plain major.minor.patch triples;
// exactly two comparisons exist, both deliberately minimal — no semver
// library, no prerelease or precedence rules, because the release pipeline
// never produces anything but plain triples.

/** "0.0.0" means development build: unknown-and-exempt, never "older than everything". */
export const DEV_VERSION = "0.0.0";

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TRIPLE_COMPONENTS = 3;

/** A valid release version is a plain `major.minor.patch` triple. */
export function isReleaseVersion(value: string): boolean {
  return RELEASE_VERSION_PATTERN.test(value);
}

/** Numeric triple greater-than: is `candidate` newer than `baseline`? */
export function isNewerVersion(candidate: string, baseline: string): boolean {
  const a = candidate.split(".").map(Number);
  const b = baseline.split(".").map(Number);
  for (let i = 0; i < TRIPLE_COMPONENTS; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

/**
 * Reload staleness is string inequality: the bundle either is or is not the
 * one this server serves. `0.0.0` on either side is treated as matching.
 */
export function isStaleBundle(bundleVersion: string, serverVersion: string): boolean {
  if (bundleVersion === DEV_VERSION || serverVersion === DEV_VERSION) return false;
  return bundleVersion !== serverVersion;
}
