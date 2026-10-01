#!/usr/bin/env node
// Build-once artifact helper (specs/arch/test-runner/github-ci.md#build-once-fan-out).
// CLI: check | run | pack | artifact-name
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import manifest from "../../test.prebuilt.mjs";
import { loadTestConfig, selectSurfaces } from "./config.mjs";

export function prebuiltManifest() {
  return manifest;
}

export function checkManifestCoversRegistry(config, m = manifest) {
  const coverage = new Map();
  for (const build of m.builds) {
    for (const surface of build.coversPreCommands) coverage.set(surface, (coverage.get(surface) ?? 0) + 1);
  }
  const errors = [];
  for (const surface of selectSurfaces(config, { suite: "all" })) {
    if (!surface.preCommand) continue;
    const count = coverage.get(surface.id) ?? 0;
    if (count !== 1) errors.push(`surface ${surface.id} is covered by ${count} manifest recipes; expected exactly one`);
  }
  for (const [surfaceId] of coverage) {
    const surface = config.surfaces.find((candidate) => candidate.id === surfaceId);
    if (!surface) errors.push(`manifest covers unknown surface ${surfaceId}`);
    else if (!surface.preCommand) errors.push(`manifest covers surface ${surfaceId}, which declares no preCommand`);
  }
  return errors;
}

export function runRecipes({ root = process.cwd(), manifest: m = manifest } = {}) {
  for (const build of m.builds) {
    console.log(`[prebuilt:${build.id}] ${build.command.join(" ")}`);
    run(build.command[0], build.command.slice(1), { cwd: root, stdio: "inherit" });
  }
  const status = run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).stdout;
  if (status !== "") throw new Error(`prebuilt recipes left tracked files differing from the commit:\n${status.trimEnd()}`);
}

export function packUntrackedFiles(root, archivePath) {
  const listed = run("git", ["ls-files", "--others", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout.toString("latin1");
  const files = listed.split("\0").filter((file) => file && !/(^|\/)(?:node_modules|\.git|\.test-runs)(?:\/|$)/.test(file));
  fs.mkdirSync(path.dirname(path.resolve(archivePath)), { recursive: true });
  run("tar", ["--create", "--gzip", "--file", path.resolve(archivePath), "--null", "--files-from=-"], {
    cwd: root,
    input: Buffer.from(files.length ? `${files.join("\0")}\0` : "", "latin1"),
    stdio: ["pipe", "inherit", "inherit"],
  });
}

export function shouldSkipPreCommands(options, env = process.env) {
  return Boolean(options["skip-pre-commands"]) || env.TEST_SHARD_SKIP_PRECOMMANDS === "1";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, env: process.env });
  if ((result.status ?? 1) !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  return result;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const root = optionValue(args, "--root") ?? process.cwd();
  try {
    if (command === "check") {
      const errors = checkManifestCoversRegistry(loadTestConfig());
      if (errors.length) throw new Error(errors.join("\n"));
      console.log("prebuilt manifest covers the registry");
    } else if (command === "run") {
      runRecipes({ root });
    } else if (command === "pack") {
      const archive = optionValue(args, "--archive");
      if (!archive) throw new Error("pack requires --archive <file>");
      packUntrackedFiles(root, archive);
    } else if (command === "artifact-name") {
      console.log(manifest.artifactName);
    } else {
      throw new Error("Usage: node scripts/test/prebuilt.mjs <check|run [--root <dir>]|pack --archive <file> [--root <dir>]|artifact-name>");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
