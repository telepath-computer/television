#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadAssetManifest, loadLicenseConfig } from "./licenses/lib/config.mjs";
import {
  mergeSurfaceInventories,
  readSurfaceInventory,
  resolveInventoryRoot,
  surfaceInventoryPath,
} from "./licenses/lib/inventory.mjs";
import { renderThirdPartyNotices } from "./licenses/lib/notices.mjs";
import {
  includedLicenseSurfaces,
  licenseSurfaceForPackageDirectory,
} from "./licenses/lib/surfaces.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const runtimeDependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];
const args = new Set(process.argv.slice(2));
const knownArgs = new Set(["--help", "-h", "--manifest-only", "--tarballs", "--tarball-only"]);

for (const arg of args) {
  if (!knownArgs.has(arg)) fail(`Unknown argument ${arg}. Run with --help for usage.`);
}

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: node scripts/check-publishable.mjs [--manifest-only|--tarballs]\n\nChecks public workspace packages before release. By default it runs both modes.\n\nModes:\n  --manifest-only       lint package.json files only; no build or pack required\n  --tarballs            inspect packed tarballs and resolve them in a clean temp project; run after build\n\nManifest lint:\n  The root and every workspace package must declare \"license\": \"MIT\".\n  Public workspace packages must declare a non-empty \"engines.node\" range and\n  may not list private workspace packages in runtime dependency fields:\n  dependencies, peerDependencies, optionalDependencies.\n\nTarball check:\n  Packs each public workspace from the current working tree, extracts the actual\n  tarball bytes to verify LICENSE and any required third-party notices, asserts\n  package main/bin targets are present, then verifies npm can resolve the tarball\n  in a clean temp project. This command does not build; run the package builds\n  first.\n`);
  process.exit(0);
}

const tarballsOnly = args.has("--tarballs") || args.has("--tarball-only");
const manifestOnly = args.has("--manifest-only");
if (tarballsOnly && manifestOnly) fail("Pass either --manifest-only or --tarballs, not both.");

const shouldRunManifestLint = !tarballsOnly;
const shouldRunTarballCheck = !manifestOnly;
const started = performance.now();

try {
  const rootManifest = readJSON(path.join(repoRoot, "package.json"));
  const workspacePackages = discoverWorkspacePackages(rootManifest);
  const workspaceByName = new Map(workspacePackages.map((pkg) => [pkg.name, pkg]));
  const publishablePackages = workspacePackages.filter((pkg) => pkg.manifest.private !== true);

  if (publishablePackages.length === 0) {
    throw new Error("No publishable workspace packages found; expected at least one non-private workspace package.");
  }

  if (shouldRunManifestLint) {
    lintMITLicenseFields({ rootManifest, workspacePackages });
    lintPublishableNodeEngines(publishablePackages);
    lintPrivateWorkspaceRuntimeDependencies({ publishablePackages, workspaceByName });
    console.log(
      `[check-publishable] manifest lint passed for ${workspacePackages.length + 1} root/workspace manifest(s) ` +
      `and ${publishablePackages.length} publishable package(s): ${publishablePackages.map((pkg) => pkg.name).join(", ")}`,
    );
  }

  if (shouldRunTarballCheck) {
    checkPackedTarballs(publishablePackages);
  }

  console.log(`[check-publishable] passed in ${formatDuration(performance.now() - started)}`);
} catch (error) {
  console.error(`[check-publishable] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function discoverWorkspacePackages(rootManifest) {
  const workspacePatterns = getWorkspacePatterns(rootManifest);
  const packageDirs = new Set();

  for (const pattern of workspacePatterns) {
    for (const packageDir of expandWorkspacePattern(pattern)) {
      packageDirs.add(packageDir);
    }
  }

  const packages = [];
  const names = new Map();
  for (const packageDir of [...packageDirs].sort()) {
    const manifestPath = path.join(packageDir, "package.json");
    const manifest = readJSON(manifestPath);
    if (!manifest.name) throw new Error(`${relative(manifestPath)} is missing a package name.`);
    if (names.has(manifest.name)) {
      throw new Error(`Duplicate workspace package name ${manifest.name}: ${relative(names.get(manifest.name))} and ${relative(manifestPath)}`);
    }
    names.set(manifest.name, manifestPath);
    packages.push({
      name: manifest.name,
      dir: packageDir,
      manifestPath,
      manifest,
    });
  }

  return packages;
}

function getWorkspacePatterns(rootManifest) {
  const workspaces = rootManifest.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  if (workspaces && Array.isArray(workspaces.packages)) return workspaces.packages;
  throw new Error("Root package.json does not define npm workspaces.");
}

function expandWorkspacePattern(pattern) {
  const segments = pattern.split("/").filter(Boolean);
  let dirs = [repoRoot];

  for (const segment of segments) {
    if (segment === "*") {
      dirs = dirs.flatMap((dir) => {
        if (!existsSync(dir)) return [];
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(dir, entry.name));
      });
      continue;
    }

    if (segment.includes("*")) {
      throw new Error(`Unsupported workspace glob segment ${JSON.stringify(segment)} in ${JSON.stringify(pattern)}. This checker supports full-segment '*' globs only.`);
    }

    dirs = dirs.map((dir) => path.join(dir, segment)).filter((dir) => existsSync(dir));
  }

  return dirs.filter((dir) => existsSync(path.join(dir, "package.json")));
}

function lintMITLicenseFields({ rootManifest, workspacePackages }) {
  const manifests = [
    { name: "workspace root", manifestPath: path.join(repoRoot, "package.json"), manifest: rootManifest },
    ...workspacePackages,
  ];
  const errors = manifests
    .filter((pkg) => pkg.manifest.license !== "MIT")
    .map((pkg) => {
      const actual = pkg.manifest.license === undefined ? "a missing license field" : JSON.stringify(pkg.manifest.license);
      return `${pkg.name} (${relative(pkg.manifestPath)}) must declare license exactly \"MIT\"; found ${actual}.`;
    });

  if (errors.length > 0) {
    throw new Error(`\n${errors.map((message) => `- ${message}`).join("\n")}`);
  }
}

function lintPublishableNodeEngines(publishablePackages) {
  const errors = publishablePackages
    .filter((pkg) => typeof pkg.manifest.engines?.node !== "string" || pkg.manifest.engines.node.trim() === "")
    .map((pkg) => `${pkg.name} (${relative(pkg.manifestPath)}) must declare a non-empty engines.node range.`);

  if (errors.length > 0) {
    throw new Error(`\n${errors.map((message) => `- ${message}`).join("\n")}`);
  }
}

function lintPrivateWorkspaceRuntimeDependencies({ publishablePackages, workspaceByName }) {
  const errors = [];

  for (const pkg of publishablePackages) {
    for (const field of runtimeDependencyFields) {
      const dependencies = pkg.manifest[field] ?? {};
      for (const dependencyName of Object.keys(dependencies)) {
        const workspaceDependency = workspaceByName.get(dependencyName);
        if (!workspaceDependency || workspaceDependency.manifest.private !== true) continue;
        errors.push(
          `${pkg.name} (${relative(pkg.manifestPath)}) lists private workspace package ${dependencyName} (${relative(workspaceDependency.manifestPath)}) in ${field}. ` +
          "Published consumers will try to resolve that package from npm. Move it to devDependencies and bundle it, or make the dependency publishable and publish it first.",
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`\n${errors.map((message) => `- ${message}`).join("\n")}`);
  }
}

function checkPackedTarballs(publishablePackages) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "television-publishable-"));
  const packDir = path.join(tempRoot, "packs");
  mkdirSync(packDir, { recursive: true });

  try {
    for (const pkg of publishablePackages) {
      const packStarted = performance.now();
      const pack = run(npmCommand, ["pack", "--workspace", pkg.name, "--pack-destination", packDir, "--json", "--ignore-scripts"], { cwd: repoRoot });
      const packResult = parsePackResult(pack.stdout, pkg.name);
      assertPackedManifestTargets(pkg, packResult);

      const tarballPath = path.join(packDir, packResult.filename);
      if (!existsSync(tarballPath)) throw new Error(`npm pack for ${pkg.name} reported ${packResult.filename}, but the tarball was not created.`);
      assertPackedLegalFiles(pkg, tarballPath, tempRoot);

      const consumerDir = mkdtempSync(path.join(tempRoot, "consumer-"));
      writeFileSync(path.join(consumerDir, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
      run(npmCommand, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--fund=false", tarballPath], { cwd: consumerDir });
      console.log(`[check-publishable] tarball check passed for ${pkg.name} (${formatDuration(performance.now() - packStarted)})`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertPackedLegalFiles(pkg, tarballPath, tempRoot) {
  const extractDir = mkdtempSync(path.join(tempRoot, "extract-"));
  run("tar", ["-xzf", tarballPath, "-C", extractDir], { cwd: repoRoot });
  const packedRoot = path.join(extractDir, "package");

  const packedLicense = readPackedFile(pkg, packedRoot, "LICENSE");
  const rootLicense = readFileSync(path.join(repoRoot, "LICENSE"));
  if (!packedLicense.equals(rootLicense)) {
    throw new Error(`Packed tarball for ${pkg.name}: LICENSE must be byte-identical to the repository root LICENSE.`);
  }

  const noticePath = "dist/THIRD-PARTY-NOTICES.txt";
  const expectedNotices = expectedPackageNotices(pkg);
  const packedNotices = readOptionalFile(path.join(packedRoot, noticePath));
  const builtNotices = readOptionalFile(path.join(pkg.dir, noticePath));

  if (expectedNotices === null) {
    if (builtNotices !== null) {
      throw new Error(`Built package for ${pkg.name}: ${noticePath} exists even though the package has no third-party entries.`);
    }
    if (packedNotices !== null) {
      throw new Error(`Packed tarball for ${pkg.name}: ${noticePath} exists even though the package has no third-party entries.`);
    }
    return;
  }

  if (packedNotices === null) {
    throw new Error(`Packed tarball for ${pkg.name}: ${noticePath} is missing.`);
  }
  if (packedNotices.length === 0) {
    throw new Error(`Packed tarball for ${pkg.name}: ${noticePath} is empty.`);
  }
  const expectedBytes = Buffer.from(expectedNotices);
  if (builtNotices === null) {
    throw new Error(`Built package for ${pkg.name}: ${noticePath} is missing.`);
  }
  if (!builtNotices.equals(expectedBytes)) {
    throw new Error(`Built package for ${pkg.name}: ${noticePath} differs from the notices generated from its licensing inputs.`);
  }
  if (!packedNotices.equals(builtNotices)) {
    throw new Error(`Packed tarball for ${pkg.name}: ${noticePath} differs from the built package bytes.`);
  }
}

function expectedPackageNotices(pkg) {
  const packageDirectory = relative(pkg.dir).split(path.sep).join("/");
  const declaration = licenseSurfaceForPackageDirectory(packageDirectory);
  if (declaration === null) {
    throw new Error(`No licensing surface is declared for publishable package ${pkg.name} at ${packageDirectory}.`);
  }
  const surface = declaration.surface;
  const config = loadLicenseConfig({ root: repoRoot });
  const assets = loadAssetManifest({ root: repoRoot, config });
  const inventoryRoot = resolveInventoryRoot({ root: repoRoot });
  const assetSurfaces = includedLicenseSurfaces(surface);
  const missingSurface = assetSurfaces.find(
    (candidate) => !existsSync(surfaceInventoryPath(inventoryRoot, candidate)),
  );
  if (missingSurface !== undefined) {
    throw new Error(
      `Publishable package ${pkg.name} needs building: licensing inventory ${missingSurface} is missing.`,
    );
  }
  const inventories = assetSurfaces.map((candidate) => readSurfaceInventory(inventoryRoot, candidate));
  const inventory = mergeSurfaceInventories(surface, inventories);
  return renderThirdPartyNotices({
    surface,
    inventory,
    assetSurfaces,
    config,
    assets,
    root: repoRoot,
  });
}

function readOptionalFile(filePath) {
  try {
    return readFileSync(filePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function readPackedFile(pkg, packedRoot, packagePath) {
  try {
    return readFileSync(path.join(packedRoot, packagePath));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`Packed tarball for ${pkg.name}: ${packagePath} is missing.`);
    }
    throw new Error(`Could not read ${packagePath} from packed tarball for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertPackedManifestTargets(pkg, packResult) {
  const packedFiles = new Set((packResult.files ?? []).map((file) => normalizePackagePath(file.path)));
  const requiredTargets = manifestTargets(pkg.manifest);
  const missingTargets = requiredTargets.filter((target) => !packedFiles.has(target.path));

  if (missingTargets.length === 0) return;

  const missing = missingTargets
    .map((target) => `- ${target.field} points at ${target.path}, but that file is not in the packed tarball`)
    .join("\n");
  throw new Error(
    `Packed tarball for ${pkg.name} is missing package manifest target(s):\n${missing}\n` +
    "Run the package build before checking/publishing, and confirm package.json files/files globs include the built outputs.",
  );
}

function manifestTargets(manifest) {
  const targets = [];
  if (typeof manifest.main === "string") targets.push({ field: "main", path: normalizePackagePath(manifest.main) });

  if (typeof manifest.bin === "string") {
    targets.push({ field: "bin", path: normalizePackagePath(manifest.bin) });
  } else if (manifest.bin && typeof manifest.bin === "object" && !Array.isArray(manifest.bin)) {
    for (const [name, targetPath] of Object.entries(manifest.bin)) {
      if (typeof targetPath === "string") targets.push({ field: `bin.${name}`, path: normalizePackagePath(targetPath) });
    }
  }

  return targets;
}

function parsePackResult(stdout, packageName) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Could not parse npm pack --json output for ${packageName}: ${error instanceof Error ? error.message : String(error)}\n${stdout}`);
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry?.filename) throw new Error(`npm pack --json output for ${packageName} did not include a filename.`);
  if (!Array.isArray(entry.files)) throw new Error(`npm pack --json output for ${packageName} did not include a files list.`);
  return entry;
}

function run(command, commandArgs, { cwd }) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const display = [command, ...commandArgs].map(shellDisplay).join(" ");
    throw new Error(`${display} failed in ${relative(cwd)}\n${result.stdout}${result.stderr}`.trim());
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

function readJSON(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizePackagePath(packagePath) {
  const normalized = packagePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Package manifest target must stay inside the package: ${packagePath}`);
  }
  return normalized;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fail(message) {
  console.error(`[check-publishable] failed: ${message}`);
  process.exit(1);
}

function shellDisplay(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
