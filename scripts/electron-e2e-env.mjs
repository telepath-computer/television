import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripCursorAgentEnv } from "./test/cursor-agent-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ELECTRON_E2E_EXECUTABLE_PATH_ENV = "TV_ELECTRON_E2E_EXECUTABLE_PATH";

export function getElectronE2EInvocation(plan, extraArgs = []) {
  const playwrightArgs = ["playwright", "test", "--config=packages/desktop/playwright.config.ts", ...extraArgs];
  return plan.useXvfb
    ? { command: "xvfb-run", args: ["-a", "npx", ...playwrightArgs] }
    : { command: "npx", args: playwrightArgs };
}

/** Environment for spawning Electron e2e (Playwright + Electron child processes). */
export function prepareElectronE2EEnv(env = process.env, plan = {}) {
  const next = stripCursorAgentEnv(env);
  if (plan.disableSandbox) {
    next.ELECTRON_DISABLE_SANDBOX = "1";
  }
  return next;
}

export function inspectElectronRuntime({
  root = repoRoot,
  platform = process.platform,
  readPlistValue,
} = {}) {
  let targetVersion;
  let packageRoot;
  let packageManifest;
  try {
    const rootManifest = readJSON(path.join(root, "package.json"));
    targetVersion = rootManifest.devDependencies?.electron;
    if (typeof targetVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
      return invalidRuntime("the root Electron declaration is missing or is not an exact version");
    }
    const requireFromRoot = createRequire(path.join(root, "package.json"));
    const packageManifestPath = requireFromRoot.resolve("electron/package.json");
    packageRoot = path.dirname(packageManifestPath);
    packageManifest = readJSON(packageManifestPath);
  } catch (error) {
    return invalidRuntime(`the Electron package could not be resolved: ${errorMessage(error)}`);
  }

  if (packageManifest.version !== targetVersion) {
    return invalidRuntime(
      `the installed Electron package version ${JSON.stringify(packageManifest.version)} does not match ${targetVersion}`,
    );
  }

  const pathFile = path.join(packageRoot, "path.txt");
  const distDirectory = path.join(packageRoot, "dist");
  const versionFile = path.join(distDirectory, "version");
  if (!fs.existsSync(pathFile) && !fs.existsSync(versionFile) && directoryAbsentOrEmpty(distDirectory)) {
    return { state: "absent" };
  }

  let recordedPath;
  let recordedVersion;
  try {
    recordedPath = fs.readFileSync(pathFile, "utf8");
    recordedVersion = fs.readFileSync(versionFile, "utf8");
  } catch (error) {
    return invalidRuntime(`the generated Electron runtime is incomplete: ${errorMessage(error)}`);
  }
  if (recordedVersion !== targetVersion) {
    return invalidRuntime(
      `the generated Electron runtime version ${JSON.stringify(recordedVersion)} does not match ${targetVersion}`,
    );
  }

  if (platform === "linux") {
    return validateNativeRuntime(packageRoot, recordedPath, "electron");
  }
  if (platform === "darwin") {
    return validateMacRuntime(packageRoot, recordedPath, readPlistValue);
  }
  return invalidRuntime(`Electron has no runtime layout for platform ${platform}`);
}

export function getElectronE2EPlan(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform;
  const release = options.release ?? os.release();
  const failures = [];
  const notes = [];
  const runtime = inspectElectronRuntime({
    root: options.root ?? repoRoot,
    platform,
    readPlistValue: options.readPlistValue,
  });
  const plan = {
    failures,
    notes,
    runtime,
    useXvfb: false,
    disableSandbox: env.ELECTRON_DISABLE_SANDBOX === "1",
    platform: `${platform} ${release}`,
  };

  if (runtime.state === "invalid") {
    failures.push([`Electron runtime is invalid: ${runtime.reason}`]);
  }

  if (platform !== "linux") {
    return plan;
  }

  const commandExists = options.commandExists ?? defaultCommandExists;
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    if (commandExists("xvfb-run")) {
      plan.useXvfb = true;
      notes.push("No DISPLAY/WAYLAND_DISPLAY detected; Electron e2e will run under xvfb-run -a.");
    } else {
      failures.push([
        "Electron needs a display server on headless Linux, and xvfb-run is not available.",
        "Install Playwright's Linux dependencies:",
        "  npx playwright install --with-deps chromium",
        "Or install xvfb through your system package manager.",
      ]);
    }
  }

  if (runtime.state === "valid" && env.ELECTRON_DISABLE_SANDBOX !== "1") {
    const inspectSandbox = options.inspectSandbox ?? defaultInspectSandbox;
    const sandboxPath = path.join(path.dirname(runtime.executablePath), "chrome-sandbox");
    let sandbox;
    try {
      sandbox = inspectSandbox(sandboxPath);
    } catch (error) {
      sandbox = { error: errorMessage(error) };
    }
    const configured = sandbox.error === undefined
      && sandbox.uid === 0
      && (sandbox.mode & 0o4000) !== 0;
    if (!configured) {
      const reason = sandbox.error ?? `chrome-sandbox uid=${sandbox.uid}, mode=${(sandbox.mode & 0o7777).toString(8)}`;
      plan.disableSandbox = true;
      notes.push(
        `Electron setuid sandbox is not configured (${reason}); ELECTRON_DISABLE_SANDBOX=1 will be set for this test run.`,
      );
    }
  }

  return plan;
}

export function printElectronE2EFailures(plan) {
  console.error("Electron e2e preflight failed.");
  console.error(`Platform: ${plan.platform}`);
  console.error("");
  for (const [index, failure] of plan.failures.entries()) {
    if (plan.failures.length > 1) {
      console.error(`${index + 1}. ${failure[0]}`);
      for (const line of failure.slice(1)) console.error(`   ${line}`);
    } else {
      for (const line of failure) console.error(line);
    }
    console.error("");
  }
}

function validateNativeRuntime(packageRoot, recordedPath, expectedPath) {
  if (recordedPath !== expectedPath) {
    return invalidRuntime(`path.txt contains ${JSON.stringify(recordedPath)} instead of ${JSON.stringify(expectedPath)}`);
  }
  const executablePath = path.join(packageRoot, "dist", expectedPath);
  return executableIsValid(executablePath)
    ? { state: "valid", executablePath }
    : invalidRuntime(`the Electron executable is missing or is not executable: ${executablePath}`);
}

function validateMacRuntime(packageRoot, recordedPath, readPlistValue) {
  const upstreamPath = "Electron.app/Contents/MacOS/Electron";
  if (recordedPath !== upstreamPath) {
    return invalidRuntime(`path.txt contains an unexpected macOS executable path: ${JSON.stringify(recordedPath)}`);
  }

  const bundleName = "Electron.app";
  const executablePath = path.join(packageRoot, "dist", recordedPath);
  const contents = path.join(packageRoot, "dist", bundleName, "Contents");
  const plist = path.join(contents, "Info.plist");
  const frameworks = path.join(contents, "Frameworks");
  if (!executableIsValid(executablePath) || !regularFile(plist) || !nonemptyDirectory(frameworks)) {
    return invalidRuntime(`the ${bundleName} layout is incomplete`);
  }

  const readValue = readPlistValue ?? defaultReadPlistValue;
  const expectedValues = { CFBundleExecutable: "Electron" };
  for (const [key, expected] of Object.entries(expectedValues)) {
    let actual;
    try {
      actual = readValue(plist, key);
    } catch (error) {
      return invalidRuntime(`could not read ${key} from ${plist}: ${errorMessage(error)}`);
    }
    if (actual !== expected) {
      return invalidRuntime(`${key} is ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
    }
  }
  return { state: "valid", executablePath };
}

function defaultReadPlistValue(plist, key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `plutil exited ${result.status}`);
  return result.stdout.replace(/\r?\n$/, "");
}

function directoryAbsentOrEmpty(directory) {
  try {
    return fs.readdirSync(directory).length === 0;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
}

function executableIsValid(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function regularFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function nonemptyDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function invalidRuntime(reason) {
  return { state: "invalid", reason };
}

function defaultInspectSandbox(sandboxPath) {
  const stat = fs.statSync(sandboxPath);
  return { uid: stat.uid, mode: stat.mode };
}

function defaultCommandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
