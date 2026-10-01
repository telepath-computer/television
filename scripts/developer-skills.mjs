import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const sourceRoot = path.join(repoRoot, "developer-skills");

export async function statIfPresent(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function skillNames() {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Skill sources must be ordinary files/directories: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    const skill = await statIfPresent(path.join(sourceRoot, entry.name, "SKILL.md"));
    if (!skill?.isFile()) throw new Error(`Missing regular SKILL.md: ${entry.name}`);
    names.push(entry.name);
  }
  if (!names.length) throw new Error("No developer skills found");
  return names.sort();
}

// Include directory membership so the installer carries empty directories too.
async function inventory(root) {
  const out = new Map();
  async function walk(file, relative) {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Expected ordinary file/directory: ${file}`);
    if (stat.isDirectory()) {
      out.set(relative, null);
      for (const name of (await readdir(file)).sort()) await walk(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) out.set(relative, await readFile(file));
    else throw new Error(`Unsupported skill entry: ${file}`);
  }
  await walk(root, "");
  return out;
}

export async function sourceInventory(names) {
  const out = new Map([["", null]]);
  for (const name of names) {
    for (const [file, content] of await inventory(path.join(sourceRoot, name))) out.set(path.join(name, file), content);
  }
  return out;
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function checkDestination(destination) {
  const target = path.resolve(destination);
  const stat = await statIfPresent(target);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Destination must be an ordinary directory: ${target}`);
  // Resolve existing ancestors before creating anything, including paths through aliases.
  let ancestor = target;
  const missing = [];
  while (!(await statIfPresent(ancestor))) { missing.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const resolved = path.join(await realpath(ancestor), ...missing);
  const source = await realpath(sourceRoot);
  if (contains(source, resolved) || contains(resolved, source)) throw new Error(`Destination overlaps developer-skills source: ${target}`);
  return target;
}
