import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { inspectElectronRuntime } from "../../scripts/electron-e2e-env.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const targetElectronVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  .devDependencies.electron as string;
const nodeVersion = "26.7.0";
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("Electron installs a complete runtime under the affected Node 26 release", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-electron-node26-"));
  roots.push(root);
  const toolRoot = path.join(root, "tool");
  const runtimeRoot = path.join(root, "runtime");
  const cacheRoot = path.join(root, "electron-cache");

  const nodeInstall = run("npm", [
    "install",
    "--prefix", toolRoot,
    "--no-package-lock",
    "--no-save",
    "--no-audit",
    "--fund=false",
    `node@${nodeVersion}`,
  ], root);
  expect(nodeInstall.status, commandFailure("install Node", nodeInstall)).toBe(0);

  const nodeBinary = path.join(toolRoot, "node_modules", "node", "bin", "node");
  const reportedVersion = run(nodeBinary, ["--version"], root);
  expect(reportedVersion.status, commandFailure("run installed Node", reportedVersion)).toBe(0);
  expect(reportedVersion.stdout.trim()).toBe(`v${nodeVersion}`);

  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify({ private: true, devDependencies: { electron: targetElectronVersion } }, null, 2)}\n`,
    { flag: "wx" },
  );
  const packageInstall = run("npm", [
    "install",
    "--prefix", runtimeRoot,
    "--ignore-scripts",
    "--no-package-lock",
    "--no-audit",
    "--fund=false",
  ], root);
  expect(packageInstall.status, commandFailure("install Electron package", packageInstall)).toBe(0);
  expect(inspectElectronRuntime({ root: runtimeRoot, platform: process.platform })).toEqual({ state: "absent" });

  const installer = path.join(runtimeRoot, "node_modules", "electron", "install.js");
  const runtimeInstall = run(nodeBinary, [installer], runtimeRoot, {
    ...process.env,
    electron_config_cache: cacheRoot,
  });
  expect(runtimeInstall.status, commandFailure("install Electron runtime", runtimeInstall)).toBe(0);
  expect(inspectElectronRuntime({ root: runtimeRoot, platform: process.platform })).toMatchObject({ state: "valid" });
}, 300_000);

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function commandFailure(label: string, result: ReturnType<typeof run>): string {
  return `${label} failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
