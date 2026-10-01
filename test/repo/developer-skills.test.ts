import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function put(file: string, text = "fixture") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-developer-skills-"));
  temporary.push(root);
  mkdirSync(path.join(root, "scripts"));
  for (const file of ["developer-skills.mjs", "install-developer-skills.mjs"]) {
    cpSync(path.join("scripts", file), path.join(root, "scripts", file));
  }
  put(path.join(root, "developer-skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: Fixture skill\n---\nAlpha\n");
  put(path.join(root, "developer-skills/alpha/references/context.md"), "context");
  put(path.join(root, "developer-skills/beta/SKILL.md"), "---\nname: beta\ndescription: Other fixture\n---\nBeta\n");
  put(path.join(root, "developer-skills/README.md"), "source maintenance");
  const alias = path.join(root, "checkout-alias");
  symlinkSync(root, alias);
  return alias;
}
function command(root: string, script: string, args: string[] = []) {
  return spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = lstatSync(file);
      const key = path.relative(root, file);
      if (stat.isSymbolicLink()) result[key] = `link:${readlinkSync(file)}`;
      else if (stat.isDirectory()) { result[key] = "directory"; walk(file); }
      else result[key] = readFileSync(file).toString("base64");
    }
  }
  walk(root);
  return result;
}
function commonInstall(root: string, homeDir: string, strategy: string) {
  const moduleUrl = pathToFileURL(path.join(root, "scripts/install-developer-skills.mjs")).href;
  const code = `import { installDeveloperSkills } from ${JSON.stringify(moduleUrl)}; await installDeveloperSkills([${JSON.stringify(strategy)}, "--common-dirs"], {homeDir: ${JSON.stringify(homeDir)}});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: root, encoding: "utf8", timeout: 10_000 });
}

describe("developer skill installation", () => {
  // Acceptance; invalid CLI requests cannot mutate fixture destinations. proofs/arch/developer-skills.md#^ds-arguments
  test("requires exactly one strategy and destination form", () => {
    const root = fixture();
    const destination = path.join(root, "target");
    for (const args of [[], [destination], ["--copy"], ["--copy", "--symlink", destination], ["--copy", "--copy", destination], ["--copy", "--common-dirs", destination], ["--symlink", destination, destination], ["--unknown", destination], ["--copy", "--common-dirs", "--common-dirs"]]) {
      const before = snapshot(root);
      const result = command(root, "install-developer-skills.mjs", args);
      expect(result.status).not.toBe(0);
      expect(snapshot(root)).toEqual(before);
    }
    const help = command(root, "install-developer-skills.mjs", ["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: node scripts/install-developer-skills.mjs (--copy | --symlink) (<destination> | --common-dirs)");
    expect(existsSync(destination)).toBe(false);
  });

  // Acceptance; copies, links, and strategy switches cross the real filesystem. proofs/arch/developer-skills.md#^ds-switching
  test("switches strategies without changing link sources or unrelated entries", () => {
    const root = fixture();
    const destination = path.join(root, "target");
    const source = path.join(root, "developer-skills/alpha");
    const external = path.join(root, "external");
    put(path.join(external, "keep.txt"), "untouched source");
    put(path.join(destination, "unrelated/keep.txt"));
    symlinkSync(external, path.join(destination, "alpha"));
    const before = snapshot(external);
    expect(command(root, "install-developer-skills.mjs", ["--copy", destination]).status).toBe(0);
    expect(snapshot(external)).toEqual(before);
    expect(lstatSync(path.join(destination, "alpha")).isDirectory()).toBe(true);
    put(path.join(source, "references/context.md"), "updated");
    expect(readFileSync(path.join(destination, "alpha/references/context.md"), "utf8")).toBe("context");
    put(path.join(destination, "alpha/stale.txt"));
    expect(command(root, "install-developer-skills.mjs", ["--symlink", destination]).status).toBe(0);
    expect(readlinkSync(path.join(destination, "alpha"))).toBe(realpathSync(source));
    expect(existsSync(path.join(source, "stale.txt"))).toBe(false);
    put(path.join(source, "references/context.md"), "linked update");
    expect(readFileSync(path.join(destination, "alpha/references/context.md"), "utf8")).toBe("linked update");
    const sourceBefore = snapshot(source);
    expect(command(root, "install-developer-skills.mjs", ["--copy", destination]).status).toBe(0);
    expect(snapshot(source)).toEqual(sourceBefore);
    expect(snapshot(path.join(destination, "alpha"))).toEqual(sourceBefore);
    rmSync(path.join(destination, "beta"), { recursive: true });
    symlinkSync(path.join(root, "missing"), path.join(destination, "beta"));
    expect(command(root, "install-developer-skills.mjs", ["--symlink", destination]).status).toBe(0);
    expect(readlinkSync(path.join(destination, "beta"))).toBe(realpathSync(path.join(root, "developer-skills/beta")));
    expect(readFileSync(path.join(destination, "unrelated/keep.txt"), "utf8")).toBe("fixture");
  });

  // Acceptance with authored homeDir fixture, no host home mutation. proofs/arch/developer-skills.md#^ds-destinations
  test("installs common directories and preflights unsafe destinations", () => {
    const root = fixture();
    const home = path.join(root, "fixture-home");
    const destinations = [".claude/skills", ".agents/skills", ".hermes/skills", ".openclaw/skills"];
    expect(commonInstall(root, home, "--copy").status).toBe(0);
    expect(readdirSync(home).sort()).toEqual([".agents", ".claude", ".hermes", ".openclaw"].sort());
    for (const destination of destinations) expect(snapshot(path.join(home, destination, "alpha"))).toEqual(snapshot(path.join(root, "developer-skills/alpha")));
    rmSync(path.join(home, ".openclaw/skills/beta"), { recursive: true });
    put(path.join(home, ".openclaw/skills/beta"), "conflicting file");
    const before = snapshot(root);
    expect(commonInstall(root, home, "--symlink").status).not.toBe(0);
    expect(snapshot(root)).toEqual(before);
    const alias = path.join(root, "alias");
    symlinkSync(path.join(root, "developer-skills"), alias);
    for (const destination of [alias, path.join(root, "developer-skills"), path.join(root, "developer-skills/alpha/nested"), root]) {
      const prior = snapshot(root);
      expect(command(root, "install-developer-skills.mjs", ["--copy", destination]).status).not.toBe(0);
      expect(snapshot(root)).toEqual(prior);
    }
  });
});
