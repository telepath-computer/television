#!/usr/bin/env node
import { cp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkDestination, skillNames, sourceInventory, sourceRoot, statIfPresent } from "./developer-skills.mjs";

const usage = "Usage: node scripts/install-developer-skills.mjs (--copy | --symlink) (<destination> | --common-dirs)";

export async function installDeveloperSkills(args, { homeDir = os.homedir() } = {}) {
  if (args.length === 1 && args[0] === "--help") { console.log(usage); return; }
  const strategies = args.filter((arg) => arg === "--copy" || arg === "--symlink");
  const common = args.filter((arg) => arg === "--common-dirs");
  const destinations = args.filter((arg) => !arg.startsWith("--"));
  const unknown = args.filter((arg) => arg.startsWith("--") && !["--copy", "--symlink", "--common-dirs"].includes(arg));
  if (strategies.length !== 1 || common.length > 1 || common.length + destinations.length !== 1 || unknown.length) throw new Error(usage);
  const targets = common.length
    ? [
        path.join(homeDir, ".claude", "skills"),
        path.join(homeDir, ".agents", "skills"),
        path.join(homeDir, ".hermes", "skills"),
        path.join(homeDir, ".openclaw", "skills"),
      ]
    : destinations;
  const names = await skillNames();
  await sourceInventory(names);
  // Validate every destination before replacing any entry. lstat never follows skill links.
  for (const target of targets) {
    await checkDestination(target);
    for (const name of names) {
      const entry = path.join(target, name);
      const stat = await statIfPresent(entry);
      if (stat && !stat.isDirectory() && !stat.isSymbolicLink()) throw new Error(`Refusing to replace a regular file: ${entry}`);
    }
  }
  const source = await realpath(sourceRoot);
  for (const target of targets) {
    await mkdir(target, { recursive: true });
    for (const name of names) {
      const entry = path.join(target, name);
      await rm(entry, { recursive: true, force: true });
      if (strategies[0] === "--symlink") await symlink(path.join(source, name), entry, "dir");
      else await cp(path.join(source, name), entry, { recursive: true });
    }
    console.log(`Installed ${names.length} developer skills (${strategies[0].slice(2)}) into ${path.resolve(target)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try { await installDeveloperSkills(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
