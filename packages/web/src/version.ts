// The web bundle's own release-version stamp
// (specs/arch/updates/version-advertisement.md ^web-version-stamp): the
// __TV_VERSION__ constant is defined only by `vite build` (vite.config.ts),
// so under the dev server — and the unit-test runner — it is undefined and
// the bundle version resolves to "0.0.0", the dev exemption of
// specs/arch/updates/index.md ^updates-dev-version.

declare const __TV_VERSION__: string | undefined;

const stampedVersion: string | undefined =
  typeof __TV_VERSION__ === "string" && __TV_VERSION__.length > 0 ? __TV_VERSION__ : undefined;

/** The version this bundle was built as; "0.0.0" when unstamped. */
export function resolveBundleVersion(stamp: string | undefined = stampedVersion): string {
  return stamp !== undefined && stamp.length > 0 ? stamp : "0.0.0";
}
