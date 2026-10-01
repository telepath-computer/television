#!/usr/bin/env node
// Generates the upload directory ToDesktop builds the desktop app from, then
// runs `todesktop build` from it, following the build log and exiting with the
// build's status (specs/arch/desktop/distribution.md). It reads the bundle that
// `node build.mjs` wrote to dist/; the `todesktop-build` npm script runs both.
//
// Other arguments go to `todesktop build`. A developer's test build passes
// `--code-sign=false` to skip signing and notarization:
//   npm run todesktop-build --workspace @telepath-computer/television-desktop -- --code-sign=false
// `--dry-run` has the CLI check and pack the upload directory without signing
// in or uploading anything; the script then leaves out `--follow-logs`, which
// the CLI does not accept with it.
//
// Test hooks:
//   --upload-only <dir>    generate the upload directory at <dir> and stop
//                          before `todesktop build`.
//   TV_TODESKTOP_COMMAND   a command to run in place of the ToDesktop CLI.

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "../..");

const { uploadOnlyDir, buildOptions } = parseArguments(process.argv.slice(2));
const uploadDir = uploadOnlyDir ?? mkdtempSync(path.join(os.tmpdir(), "television-todesktop-upload-"));

try {
  writeUploadDirectory(uploadDir);
  if (uploadOnlyDir !== null) {
    process.stdout.write(`Upload directory written to ${uploadDir}\n`);
  } else {
    process.exitCode = runToDesktopBuild(uploadDir, buildOptions);
  }
} finally {
  if (uploadOnlyDir === null) rmSync(uploadDir, { recursive: true, force: true });
}

function parseArguments(args) {
  if (args[0] !== "--upload-only") return { uploadOnlyDir: null, buildOptions: args };
  if (args.length !== 2) fail("usage: node scripts/todesktop-build.mjs [--upload-only <dir> | <todesktop build options>]");
  const target = path.resolve(args[1]);
  if (existsSync(target)) fail(`--upload-only needs a path that does not exist yet: ${target}`);
  return { uploadOnlyDir: target, buildOptions: [] };
}

function writeUploadDirectory(target) {
  const workspace = readJSON(path.join(packageDir, "package.json"));
  const electronVersion = workspace.devDependencies?.electron;
  if (electronVersion === undefined) fail("packages/desktop/package.json declares no Electron development dependency");
  if (!existsSync(path.join(packageDir, workspace.main))) {
    fail(`${workspace.main} is missing; run \`node build.mjs\` in packages/desktop first`);
  }

  cpSync(path.join(packageDir, "dist"), path.join(target, "dist"), { recursive: true });
  cpSync(path.join(packageDir, "assets"), path.join(target, "assets"), { recursive: true });
  // The bundle's files end in .cjs because the workspace declares
  // "type": "module", and ToDesktop's CLI refuses an upload with no .js or .ts
  // file. The generated manifest declares no type, so the main bundle loads as
  // CommonJS under its .js name.
  const main = workspace.main.replace(/\.cjs$/, ".js");
  renameSync(path.join(target, workspace.main), path.join(target, main));
  copyFileSync(path.join(repoRoot, "LICENSE"), path.join(target, "LICENSE"));

  // ToDesktop's app package.json requirements: a homepage, an author with an
  // email address, the runtime in dependencies, and Electron at an exact
  // version in devDependencies.
  writeJSON(path.join(target, "package.json"), {
    name: workspace.name,
    version: workspace.version,
    main,
    homepage: workspace.homepage,
    author: workspace.author,
    license: workspace.license,
    dependencies: workspace.dependencies,
    devDependencies: { electron: electronVersion },
  });

  // Starting from the repository lockfile keeps every version Television
  // resolved; npm drops the entries this manifest does not need.
  copyFileSync(path.join(repoRoot, "package-lock.json"), path.join(target, "package-lock.json"));
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], target);

  writeJSON(path.join(target, "todesktop.json"), {
    ...readJSON(path.join(packageDir, "todesktop.json")),
    buildVersion: workspace.version,
    nodeVersion: readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim(),
  });
}

function runToDesktopBuild(target, options) {
  const override = process.env.TV_TODESKTOP_COMMAND;
  const [command, prefix] = override
    ? [override, []]
    : [process.execPath, [toDesktopCLI()]];
  const followLogs = options.includes("--dry-run") ? [] : ["--follow-logs"];
  const result = spawnSync(command, [...prefix, "build", ...followLogs, ...options], { cwd: target, stdio: "inherit" });
  if (result.error !== undefined) {
    process.stderr.write(`Could not run the ToDesktop CLI: ${result.error.message}\n`);
    return 1;
  }
  return result.status === 0 ? 0 : 1;
}

function toDesktopCLI() {
  const require = createRequire(path.join(packageDir, "package.json"));
  const manifestPath = require.resolve("@todesktop/cli/package.json");
  const manifest = readJSON(manifestPath);
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.todesktop;
  return path.join(path.dirname(manifestPath), bin);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed in ${cwd}`);
}

function readJSON(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJSON(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
