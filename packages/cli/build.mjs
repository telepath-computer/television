#!/usr/bin/env node
// Build the publishable Television CLI into `packages/cli/dist/`.
//
//   1. Build the @telepath-computer/television-web workspace so its renderer
//      dist exists.
//   2. Build each bundled view via build-views.mjs (which populates
//      `packages/cli/dist/views/<id>/`).
//   3. esbuild the CLI entry into `packages/cli/dist/cli.cjs`, inlining the
//      published package version.
//   4. Copy the web dist into `packages/cli/dist/web/`.
//   5. Copy bundled installed-theme packages into `packages/cli/dist/themes/`.
//   6. Build the @telepath-computer/television-skills workspace and copy its
//      `dist/` into `packages/cli/dist/skills/`.
//   7. Aggregate the CLI and copied child inventories into the package-root
//      `THIRD-PARTY-NOTICES.txt`.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateBundledThemes } from "../../scripts/bundled-theme-manifest.mjs";
import {
  generateAggregateNotices,
  generateNoticesFromEsbuild,
} from "../../scripts/licenses/generate-notices.mjs";
import {
  readSurfaceInventory,
  resolveInventoryRoot,
} from "../../scripts/licenses/lib/inventory.mjs";
import { includedLicenseSurfaces } from "../../scripts/licenses/lib/surfaces.mjs";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const distDir = path.join(packageDir, "dist");
const webPackageDir = path.join(repoRoot, "packages", "web");
const inventoryRoot = resolveInventoryRoot({ root: repoRoot });

// `--outfile <path>` lets tests build an isolated CLI binary into a tempdir
// without disturbing the package's own `dist/`. No renderer or view bundles
// are copied in that mode — just the standalone CLI executable.
function parseOutfileOverride(argv) {
  const flagIndex = argv.indexOf("--outfile");
  if (flagIndex === -1) return null;
  const value = argv[flagIndex + 1];
  if (!value) throw new Error("--outfile requires a value");
  return path.resolve(value);
}
const outfileOverride = parseOutfileOverride(process.argv.slice(2));

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status ?? "signal"})`);
  }
}

const packageVersion = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).version;

function resolveDeveloperCommitSha() {
  if (!existsSync(path.join(os.homedir(), ".tv-developer"))) return undefined;

  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim();
    throw new Error(`Developer-host CLI build could not resolve Git HEAD${detail ? `: ${detail}` : "."}`);
  }

  const commitSha = result.stdout.trim();
  if (commitSha.length === 0) {
    throw new Error("Developer-host CLI build resolved an empty Git HEAD.");
  }
  return commitSha;
}

const developerCommitSha = resolveDeveloperCommitSha();
const cliOutfile = outfileOverride ?? path.join(distDir, "cli.cjs");

// When --outfile is used we only produce the standalone binary (tests use
// this). The full package build also runs the renderer + views and copies
// their output in.
if (!outfileOverride) {
  rmSync(distDir, { recursive: true, force: true });
  run("npm", ["--workspace", "@telepath-computer/television-web", "run", "build"], repoRoot);
  run("npm", ["--workspace", "@telepath-computer/television-server", "run", "build"], repoRoot);
  run("npm", ["--workspace", "@telepath-computer/television-skills", "run", "build"], repoRoot);
  run("node", [path.join(packageDir, "build-views.mjs")], repoRoot);
}

generateBundledThemes();

const cliBuildResult = await build({
  entryPoints: [path.join(packageDir, "src", "index.ts")],
  bundle: true,
  // engines.node >=22 is advisory. Node 18 syntax lets below-floor consumers
  // parse the bundle after npm's warning.
  platform: "node",
  target: "node18",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  // Build-time constants. In the built CLI these resolve to the sibling
  // directories shipped alongside the binary. In dev (tsx running src
  // directly), these are undefined and the CLI falls back to package-local
  // paths resolved via import.meta.url.
  define: {
    __TV_STATIC_DIR__: JSON.stringify("./web"),
    __TV_VIEWS_DIR__: JSON.stringify("./views"),
    __TV_CANONICAL_DIR__: JSON.stringify("./canonical"),
    __TV_ONBOARDING_CONTENT_DIR__: JSON.stringify("./onboarding"),
    __TV_BUNDLED_THEMES_DIR__: JSON.stringify("./themes"),
    __TV_TELEMETRY_BUILD__: JSON.stringify(process.env.TV_NPM_RELEASE === "1" ? "production" : "development"),
    __TV_VERSION__: JSON.stringify(packageVersion),
    __TV_DEVELOPER_COMMIT__: developerCommitSha === undefined ? "undefined" : JSON.stringify(developerCommitSha),
  },
  // `skills` here means the external Vercel skills installer package, not
  // Television's own `packages/skills/` workspace (package name
  // `@telepath-computer/television-skills`). We keep the
  // installer external so the built CLI resolves its executable from runtime
  // dependencies instead of trying to bundle it.
  external: ["skills", "skills/*"],
  outfile: cliOutfile,
  metafile: !outfileOverride,
  // The dev-mode `import.meta.url` fallback is dead code in the built CLI
  // (the __TV_* define constants always short-circuit before it evaluates).
  // esbuild can't statically prove that, so silence the warning.
  logOverride: { "empty-import-meta": "silent" },
});

chmodSync(cliOutfile, 0o755);

if (!outfileOverride) {
  if (cliBuildResult.metafile === undefined) {
    throw new Error("Full CLI build produced no esbuild metafile");
  }
  // This early notices write is CLI-only and partial; the aggregate write below replaces it before the build returns.
  generateNoticesFromEsbuild({
    surface: "cli",
    metafile: cliBuildResult.metafile,
    cwd: process.cwd(),
    root: repoRoot,
    inventoryRoot,
    outputPath: path.join(distDir, "THIRD-PARTY-NOTICES.txt"),
  });

  const webSrc = path.join(webPackageDir, "dist");
  if (!existsSync(webSrc)) {
    throw new Error(`Web build produced no dist/ at ${webSrc}`);
  }
  const webDest = path.join(distDir, "web");
  rmSync(webDest, { recursive: true, force: true });
  cpSync(webSrc, webDest, { recursive: true });

  const artifactMissingViewSrc = path.join(webSrc, "views", "artifact-missing");
  if (!existsSync(path.join(artifactMissingViewSrc, "index.html"))) {
    throw new Error(`Web build produced no artifact-missing view at ${artifactMissingViewSrc}`);
  }
  cpSync(artifactMissingViewSrc, path.join(distDir, "views", "artifact-missing"), { recursive: true });

  // Canonical artifact assets, produced by the canonical package builder. Copy
  // the complete version root so the bundled CLI can serve every
  // /canonical/v<n>/* mount from a sibling directory of cli.cjs.
  const canonicalSrc = path.join(repoRoot, "packages/server/dist/canonical");
  if (!existsSync(canonicalSrc)) {
    throw new Error(`Server build produced no canonical bundle at ${canonicalSrc}`);
  }
  const canonicalDest = path.join(distDir, "canonical");
  rmSync(canonicalDest, { recursive: true, force: true });
  cpSync(canonicalSrc, canonicalDest, { recursive: true });

  // Onboarding content tree, validated and shipped by the server build. A
  // missing config is a packaging regression and must fail the build, not
  // silently produce a CLI that installs nothing.
  const onboardingSrc = path.join(repoRoot, "packages/server/dist/onboarding");
  if (!existsSync(path.join(onboardingSrc, "onboarding-channels.json"))) {
    throw new Error(`Server build produced no onboarding content tree at ${onboardingSrc}`);
  }
  const onboardingDest = path.join(distDir, "onboarding");
  rmSync(onboardingDest, { recursive: true, force: true });
  cpSync(onboardingSrc, onboardingDest, { recursive: true });

  // Optional installed-theme packages, validated and shipped by the server
  // build. The complete tree stays beside cli.cjs for serving bootstrap.
  const themesSrc = path.join(repoRoot, "packages/server/dist/themes");
  if (!existsSync(themesSrc)) {
    throw new Error(`Server build produced no bundled theme tree at ${themesSrc}`);
  }
  const themesDest = path.join(distDir, "themes");
  rmSync(themesDest, { recursive: true, force: true });
  cpSync(themesSrc, themesDest, { recursive: true });

  // Bundled skills. The @telepath-computer/television-skills workspace build
  // (run earlier) produces packages/skills/dist/<name>/.... Copy that tree
  // into the packaged CLI so `tv skills install` can hand the whole
  // collection to the bundled `skills` dependency.
  const skillsSrc = path.join(repoRoot, "packages/skills/dist");
  if (!existsSync(skillsSrc)) {
    throw new Error(`Skills build produced no dist/ at ${skillsSrc}`);
  }
  const skillsDest = path.join(distDir, "skills");
  rmSync(skillsDest, { recursive: true, force: true });
  cpSync(skillsSrc, skillsDest, { recursive: true });

  const surfaceNames = includedLicenseSurfaces("cli");
  const inventories = surfaceNames.map((surface) => readSurfaceInventory(inventoryRoot, surface));
  generateAggregateNotices({
    surface: "cli",
    inventories,
    assetSurfaces: surfaceNames,
    root: repoRoot,
    outputPath: path.join(distDir, "THIRD-PARTY-NOTICES.txt"),
  });
  copyFileSync(path.join(repoRoot, "LICENSE"), path.join(packageDir, "LICENSE"));

  process.stdout.write(`  -> ${path.relative(repoRoot, path.join(distDir, "cli.cjs"))}\n`);
  process.stdout.write(`  -> ${path.relative(repoRoot, webDest)}\n`);
  process.stdout.write(`  -> ${path.relative(repoRoot, canonicalDest)}\n`);
  process.stdout.write(`  -> ${path.relative(repoRoot, onboardingDest)}\n`);
  process.stdout.write(`  -> ${path.relative(repoRoot, themesDest)}\n`);
  process.stdout.write(`  -> ${path.relative(repoRoot, skillsDest)}\n`);
}
