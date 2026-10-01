import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestSurface } from "../../../../scripts/test/config.mjs";

// Authored checkout, real production CLI and native tools. No repository gate
// runs here. Each scenario owns its files and (once enabled) private mutex.
export function guidanceCheckout(runner: "vitest" | "playwright" = "vitest") {
  const parent = path.resolve(".test-runs");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, "guidance-checkout-"));
  const home = path.join(root, "home");
  mkdirSync(home);
  cpSync("scripts", path.join(root, "scripts"), { recursive: true });
  cpSync("test.prebuilt.mjs", path.join(root, "test.prebuilt.mjs"));
  cpSync(".nvmrc", path.join(root, ".nvmrc"));
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", engines: manifest.engines }));
  symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.test-runs/\nhome/\nattempts.ndjson\n");
  const testsRoot = `test/runner-fixtures/guidance/${runner}`;
  cpSync(testsRoot, path.join(root, testsRoot), { recursive: true });
  const surface: TestSurface = {
    id: `fixture:${runner}`, runner, kind: "experiment", config: `${testsRoot}/${runner}.config.ts`,
    roots: [testsRoot], excludeRoots: [], tags: ["guidance"], supports: ["file", "grep"],
    preflight: [], services: [], cwd: ".", package: null, agent: false, command: null, preCommand: null, executionGroup: null, absoluteConfig: path.join(root, testsRoot, `${runner}.config.ts`),
  };
  const registry = { suites: { all: { include: [] }, experiment: { include: [] } }, executionGroups: [{ id: "fixture", surfaces: [surface] }] };
  const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  const writeRegistry = () => write("test.config.mjs", `export default ${JSON.stringify(registry)};\n`);
  writeRegistry();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("config", "user.name", "Runner fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Authored fixture");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TV_TEST_RUNNER_SELFTEST: "1", TV_TEST_RUNNER_LOCK_PATH: path.join(root, "private-lock"), TV_GUIDANCE_ATTEMPTS: path.join(root, "attempts.ndjson") };
  delete env.TV_TEST_RUNNER_DRY_RUN;
  delete env.TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT;
  delete env.TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT;
  const run = (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(process.execPath, ["scripts/test/cli.mjs", ...args], { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 60_000 });
  return { root, home, testsRoot, surface, registry, write, writeRegistry, git, run, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
