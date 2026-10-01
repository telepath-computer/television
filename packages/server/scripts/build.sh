#!/usr/bin/env bash
# Build canonical artifact assets into packages/server/dist/canonical/v<n>/.
# These are what the matching /canonical/v<n>/* mounts serve at runtime.
#
# Strategy: defer to packages/canonical's own build (which produces the bundled
# stylesheet + fonts), then copy its output into our dist tree. Server
# owns the dist; canonical owns the bundling.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
package_root=$(cd "$here/.." && pwd)
repo_root=$(cd "$package_root/../.." && pwd)
canonical_dist="$repo_root/packages/canonical/dist/canonical"
server_dist="$package_root/dist/canonical"
onboarding_dist="$package_root/dist/onboarding"
themes_dist="$package_root/dist/themes"

npm --workspace @telepath-computer/canonical run build

if [ ! -d "$canonical_dist" ]; then
  echo "expected $canonical_dist after building @telepath-computer/canonical" >&2
  exit 1
fi

rm -rf "$server_dist"
mkdir -p "$(dirname "$server_dist")"
cp -R "$canonical_dist" "$server_dist"

# Validate the onboarding content tree, then ship it. Validation failure
# fails the build (specs/arch/onboarding/content.md#^build-validation);
# `set -euo pipefail` above propagates the script's non-zero exit.
node "$here/validate-onboarding.mjs" "$package_root/assets/onboarding-channels"

# Generate the runtime inventory and validate its packages before shipping.
node "$here/validate-themes.mjs" "$package_root/assets/themes"

rm -rf "$themes_dist"
mkdir -p "$themes_dist"
cp -R "$package_root/assets/themes/." "$themes_dist/"

rm -rf "$onboarding_dist"
mkdir -p "$onboarding_dist"
cp -R "$package_root/assets/onboarding-channels/." "$onboarding_dist/"

echo "  -> $server_dist"
echo "  -> $onboarding_dist"
echo "  -> $themes_dist"
