import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ELECTRON_E2E_EXECUTABLE_PATH_ENV,
  getElectronE2EPlan,
  inspectElectronRuntime,
  printElectronE2EFailures,
} from "../../../../scripts/electron-e2e-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");

/** Prepare one exact, validated Electron runtime before any timed launch. */
export default async function globalSetup(): Promise<void> {
  const before = inspectElectronRuntime({ root: REPO_ROOT });
  if (before.state === "invalid") {
    throw new Error(`Electron runtime setup refused invalid existing state: ${before.reason}`);
  }
  if (before.state === "absent") installElectronRuntime();

  const plan = getElectronE2EPlan(process.env, { root: REPO_ROOT });
  if (plan.failures.length > 0 || plan.runtime.state !== "valid") {
    printElectronE2EFailures(plan);
    throw new Error("Electron runtime setup did not produce a valid runtime");
  }
  if (plan.disableSandbox) process.env.ELECTRON_DISABLE_SANDBOX = "1";
  process.env[ELECTRON_E2E_EXECUTABLE_PATH_ENV] = plan.runtime.executablePath;

  buildDesktop();
}

function installElectronRuntime(): void {
  const requireFromRoot = createRequire(path.join(REPO_ROOT, "package.json"));
  const packageManifest = requireFromRoot.resolve("electron/package.json");
  const installer = path.join(path.dirname(packageManifest), "install.js");
  execFileSync(process.execPath, [installer], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });
}

function buildDesktop(): void {
  execSync("npm --workspace @telepath-computer/television-web run build", {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execSync("npm run build --workspace @telepath-computer/television-desktop", {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}
