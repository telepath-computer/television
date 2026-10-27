import { spawnSync } from "node:child_process";

// specs/arch/test-runner/blaxel-testshards.md#Repository
export const BLAXEL_WORKER_CHECKOUT = "/workspace/television";
export const BLAXEL_DEPENDENCY_CACHE = "/cache/blaxel-testshards";

const GITHUB_HOST = "github.com";
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;
const SUPPORTED_FORMS = "https://github.com/<owner>/<repository>, git@github.com:<owner>/<repository>, or ssh://git@github.com/<owner>/<repository>";

export function githubRepositoryHttpsUrl(url) {
  return convertGithubUrl(url, "URL");
}

export function resolveBlaxelRepositoryUrl({ repoUrl = null, cwd = process.cwd() } = {}) {
  if (repoUrl) return convertGithubUrl(repoUrl, "--repo-url");
  const origin = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  if (origin.status !== 0) {
    throw new Error(`Blaxel workers fetch the repository this checkout calls origin, but git could not read an origin remote: ${(origin.stderr || "").trim()}`);
  }
  return convertGithubUrl(origin.stdout.trim(), "origin remote");
}

export function blaxelCheckoutScript({ repoUrl, commit, root = BLAXEL_WORKER_CHECKOUT }) {
  const quotedRoot = shellQuote(root);
  const quotedUrl = shellQuote(repoUrl);
  const quotedCommit = shellQuote(commit);
  return `
set -euo pipefail
if [ ! -d ${quotedRoot}/.git ]; then
  rm -rf ${quotedRoot}
  git clone --no-checkout ${quotedUrl} ${quotedRoot}
fi
cd ${quotedRoot}
git remote set-url origin ${quotedUrl}
rm -rf .testshards/logs .testshards/results
git fetch --no-tags --prune origin ${quotedCommit}
git reset --hard ${quotedCommit}
git clean -ffd
rm -rf .testshards/logs .testshards/results
`;
}

// Runs in the worker checkout and writes `hit` or `miss` to
// $TV_TEST_DEPS_CACHE_STATUS_FILE. The marker depends only on the dependency
// declarations, so a checkout that moved to another repository keeps its
// installed dependencies while those declarations match.
export function blaxelDependencyScript({ cacheDir = BLAXEL_DEPENDENCY_CACHE } = {}) {
  const quotedCacheDir = shellQuote(cacheDir);
  return `
set -euo pipefail
deps_hash=$(git ls-files '.nvmrc' 'package-lock.json' 'package.json' '*/package.json' ':!:node_modules/*' | sort | xargs sha256sum | sha256sum | awk '{print $1}')
deps_marker=${quotedCacheDir}/"deps-\${deps_hash}.ok"
if [ -d node_modules ] && [ -f "$deps_marker" ]; then
  echo hit > "$TV_TEST_DEPS_CACHE_STATUS_FILE"
  echo "dependency cache hit: \${deps_hash}"
else
  echo miss > "$TV_TEST_DEPS_CACHE_STATUS_FILE"
  echo "dependency cache miss: \${deps_hash}; running npm ci"
  npm ci --prefer-offline --no-audit --fund=false
  mkdir -p ${quotedCacheDir}
  rm -f ${quotedCacheDir}/deps-*.ok
  printf '%s\\n' "$deps_hash" > "$deps_marker"
fi
`;
}

function convertGithubUrl(url, label) {
  const value = String(url ?? "").trim();
  const location = githubLocation(value);
  const segments = location?.path.replace(/^\/+|\/+$/g, "").split("/") ?? [];
  const owner = segments[0] ?? "";
  const repository = (segments[1] ?? "").replace(/\.git$/, "");
  if (location?.host.toLowerCase() !== GITHUB_HOST || segments.length !== 2 || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repository)) {
    // The URL is left out of the message because it may carry credentials.
    throw new Error(`Blaxel workers fetch over HTTPS from a GitHub repository, but the ${label} does not name a GitHub repository. Use ${SUPPORTED_FORMS}.`);
  }
  return `https://${GITHUB_HOST}/${owner}/${repository}.git`;
}

function githubLocation(value) {
  const scp = value.match(/^git@([^:/]+):(.*)$/);
  if (scp) return { host: scp[1], path: scp[2] };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") return null;
  return { host: parsed.hostname, path: parsed.pathname };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
