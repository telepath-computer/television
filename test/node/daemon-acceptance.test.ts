/*
 * OPT-IN PRODUCTION-IDENTITY DAEMON ACCEPTANCE SURFACE.
 *
 * This test packs and globally installs the publishable `tv` package, replaces
 * the real `com.television.server` user service, and leaves the installed `tv`
 * package in the active npm global prefix. It must run only on a designated
 * developer host through:
 *
 *   TV_DAEMON_TEST_HOST=1 npm test -- local --suite daemon-acceptance
 *
 * Persisted serve cannot accept port 0, so each service port is obtained by
 * binding loopback port 0 and releasing it immediately before installation.
 * This is a declared exception to the continuously reserved test-port rule in
 * [[arch/test-runner/test-runner.md#^test-dynamic-ports]]: the production
 * persisted-service contract requires a stable nonzero port before install.
 *
 * Specs: [[product/cli.md#^cli-ac-persist-install]],
 * [[product/cli.md#^cli-ac-persist-reinstall]],
 * [[product/cli.md#^cli-ac-persist-stop]],
 * [[arch/cli/index.md#^cli-daemon-service-seam]], and
 * [[arch/cli/index.md#^cli-daemon-uninstall-service-seam]].
 */
import { spawn } from "node:child_process";
import { constants as fsConstants, accessSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { Daemon } from "@rupertsworld/daemon";
import { describe, expect, it } from "vitest";

const DAEMON_TEST_HOST_ENV = "TV_DAEMON_TEST_HOST";
const DIRTY_START_ENV = "TV_DAEMON_TEST_DIRTY_START";
const DAEMON_NAME = "com.television.server";
const DAEMON_DESCRIPTION = "Television server — virtual display for agents";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI_PACKAGE_DIR = path.join(REPO_ROOT, "packages", "cli");
const CLI_PACKAGE_NAME = "@telepath-computer/television";
const PACKAGE_VERSION = JSON.parse(readFileSync(path.join(CLI_PACKAGE_DIR, "package.json"), "utf8")).version as string;
const COMMAND_TIMEOUT_MS = 120_000;
const STATE_TIMEOUT_MS = 45_000;

if (process.env[DAEMON_TEST_HOST_ENV] !== "1") {
  throw new Error(
    `${DAEMON_TEST_HOST_ENV}=1 is required for the daemon acceptance suite. ` +
    "This test installs or replaces the real tv binary and com.television.server user service. " +
    "Run it only on a designated developer host that is not intended to run a normal Television server.",
  );
}

interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface InstalledCLI {
  binaryPath: string;
  env: NodeJS.ProcessEnv;
}

interface ServiceManagerState {
  definitionCount: number;
  registrationCount: number;
  runningCount: number;
}

interface InstalledDaemon {
  definition: string;
  health: Record<string, unknown>;
}

describe("production-installed persisted daemon acceptance", () => {
  it("installs, refreshes, boots, stops, and persist-uninstalls the production service", async () => {
    const workRoot = mkdtempSync(path.join(os.tmpdir(), "television-daemon-acceptance-"));
    const observer = createProductionDaemonObserver();
    let installedCLI: InstalledCLI | null = null;

    try {
      await bulldozeService(observer, "initial foundation");
      installedCLI = await packAndInstallProductionCLI(workRoot);

      if (process.env[DIRTY_START_ENV] === "1") {
        const dirtyHome = path.join(workRoot, "dirty-home");
        const dirtyPort = await allocateReleasedLoopbackPort();
        await installAndProveBoot(installedCLI, observer, dirtyHome, dirtyPort);
        logHarness(`dirty-start fixture installed ${DAEMON_NAME} on port ${dirtyPort}`);
        await bulldozeService(observer, "dirty-start foundation");
      }

      const initialHome = path.join(workRoot, "initial-home");
      const initialPort = await allocateReleasedLoopbackPort();
      const initialInstallation = await installAndProveBoot(
        installedCLI,
        observer,
        initialHome,
        initialPort,
      );

      // Exercise production refresh without bulldozing the live installation.
      // The second persist command must take the CLI's status → uninstall →
      // install path and replace the existing definition rather than adding a
      // second registration.
      const refreshedHome = path.join(workRoot, "refreshed-home");
      const refreshedPort = await allocateReleasedLoopbackPort();
      const refreshedInstallation = await installAndProveBoot(
        installedCLI,
        observer,
        refreshedHome,
        refreshedPort,
      );
      expect(refreshedInstallation.definition).not.toBe(initialInstallation.definition);
      assertServiceDefinitionDoesNotReference(
        refreshedInstallation.definition,
        initialHome,
        initialPort,
      );
      expect(await observer.status()).toEqual({ installed: true, running: true });
      expect(await inspectServiceManager()).toEqual({
        definitionCount: 1,
        registrationCount: 1,
        runningCount: 1,
      });
      await expectHealthGone(initialPort);

      const stopped = await runCommand(installedCLI.binaryPath, ["--home", refreshedHome, "stop"], {
        env: installedCLI.env,
      });
      expect(stopped).toEqual({
        exitCode: 0,
        signal: null,
        stdout: `${JSON.stringify({ status: "stopped" })}\n`,
        stderr: "",
      });
      await expectServiceGone(observer, "tv stop");

      const persistUninstallHome = path.join(workRoot, "persist-uninstall-home");
      const persistUninstallPort = await allocateReleasedLoopbackPort();
      await installAndProveBoot(installedCLI, observer, persistUninstallHome, persistUninstallPort);

      const persistUninstalled = await runCommand(installedCLI.binaryPath, [
        "--home",
        persistUninstallHome,
        "serve",
        "--persist-uninstall",
      ], { env: installedCLI.env });
      expect(persistUninstalled).toEqual({
        exitCode: 0,
        signal: null,
        stdout: `${JSON.stringify({ status: "stopped" })}\n`,
        stderr: "",
      });
      await expectServiceGone(observer, "tv serve --persist-uninstall");
    } finally {
      await bulldozeService(observer, "final cleanup");
      rmSync(workRoot, { recursive: true, force: true });
      if (installedCLI) {
        logHarness(`left the freshly packed tv ${PACKAGE_VERSION} installed at ${installedCLI.binaryPath}`);
      }
    }
  });
});

async function packAndInstallProductionCLI(workRoot: string): Promise<InstalledCLI> {
  const previousBinaries = discoverPathBinaries("tv", process.env.PATH);
  const previousVersions = await Promise.all(previousBinaries.map(async (binaryPath) => ({
    binaryPath,
    version: await readVersion(binaryPath),
  })));
  logHarness(`bulldozer found tv binaries: ${JSON.stringify(previousVersions)}`);

  const packDir = path.join(workRoot, "pack");
  mkdirSync(packDir, { recursive: true });
  const pack = await runCommand(npmCommand(), ["pack", CLI_PACKAGE_DIR, "--json", "--pack-destination", packDir], {
    cwd: REPO_ROOT,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  expect(pack.exitCode, pack.stderr).toBe(0);
  expect(pack.signal).toBeNull();
  const packRecords = JSON.parse(pack.stdout) as Array<{ filename: string; name: string; version: string }>;
  expect(packRecords).toHaveLength(1);
  expect(packRecords[0]).toMatchObject({ name: CLI_PACKAGE_NAME, version: PACKAGE_VERSION });
  const tarballPath = path.join(packDir, packRecords[0]!.filename);
  expect(existsSync(tarballPath)).toBe(true);

  const prefixResult = await runCommand(npmCommand(), ["prefix", "--global"], { cwd: REPO_ROOT });
  expect(prefixResult.exitCode, prefixResult.stderr).toBe(0);
  const globalPrefix = prefixResult.stdout.trim();
  expect(globalPrefix).not.toBe("");

  const install = await runCommand(npmCommand(), ["install", "--global", "--force", "--ignore-scripts", tarballPath], {
    cwd: REPO_ROOT,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  expect(install.exitCode, install.stderr).toBe(0);
  expect(install.signal).toBeNull();

  const rootResult = await runCommand(npmCommand(), ["root", "--global"], { cwd: REPO_ROOT });
  expect(rootResult.exitCode, rootResult.stderr).toBe(0);
  const binaryPath = path.join(globalPrefix, "bin", "tv");
  const packageEntryPath = path.join(rootResult.stdout.trim(), "@telepath-computer", "television", "dist", "cli.cjs");
  expect(realpathSync(binaryPath)).toBe(realpathSync(packageEntryPath));

  const env = productionCLIEnvironment(globalPrefix);
  const version = await runCommand(binaryPath, ["--version"], { env });
  logHarness(`installed binary version probe: ${JSON.stringify(version)}`);
  expect(version.exitCode, version.stderr).toBe(0);
  expect(version.signal).toBeNull();
  // On a host with ~/.tv-developer the build appends its commit
  // (specs/product/cli.md#^cli-developer-version); the release version before
  // it must be the packed version.
  expect(version.stdout).toMatch(/^\S+( \(commit [0-9a-f]{40}\))?\n$/);
  expect(version.stdout.split(/[ \n]/)[0]).toBe(PACKAGE_VERSION);
  expect(version.stderr).toBe("");

  logHarness(`installed packed ${CLI_PACKAGE_NAME}@${PACKAGE_VERSION} at ${binaryPath}`);
  return { binaryPath, env };
}

// Installs from a new temporary home whose config file, written by the
// installed `tv config set`, holds only the stable port; authentication stays
// on by default.
async function installAndProveBoot(
  installedCLI: InstalledCLI,
  observer: Daemon,
  home: string,
  port: number,
): Promise<InstalledDaemon> {
  const configSet = await runCommand(installedCLI.binaryPath, ["--home", home, "config", "set", "port", String(port)], {
    env: installedCLI.env,
  });
  expect(configSet.exitCode, configSet.stderr).toBe(0);
  expect(JSON.parse(readFileSync(path.join(home, "config.json"), "utf8"))).toEqual({ port });

  const install = await runCommand(installedCLI.binaryPath, ["--home", home, "serve", "--persist"], { env: installedCLI.env });

  const serverURL = `http://127.0.0.1:${port}`;
  const token = readFileSync(path.join(home, "state", "token"), "utf8").trim();
  expect(token).not.toBe("");
  const connectURL = `${serverURL}/?token=${token}`;
  const terminalURL = `\u001B]8;;${connectURL}\u001B\\${connectURL}\u001B]8;;\u001B\\`;
  expect(install).toEqual({
    exitCode: 0,
    signal: null,
    stdout: `Television service installed.\nOpen Television:\n  ${terminalURL}\n`,
    stderr: "",
  });

  await pollUntil(`service ${DAEMON_NAME} to become installed and running`, async () => {
    const status = await observer.status();
    const manager = await inspectServiceManager();
    return status.installed && status.running &&
      manager.definitionCount === 1 && manager.registrationCount === 1 && manager.runningCount === 1
      ? { status, manager }
      : null;
  });

  const definition = assertProductionServiceDefinition(installedCLI, home);
  const health = await pollUntil(`health endpoint ${serverURL}/health`, async () => {
    try {
      const response = await fetch(`${serverURL}/health`, { signal: AbortSignal.timeout(1_000) });
      return response.ok ? await response.json() as Record<string, unknown> : null;
    } catch {
      return null;
    }
  });
  expect(health).toEqual(expect.objectContaining({
    version: PACKAGE_VERSION,
    bindAddresses: ["127.0.0.1"],
    port,
  }));

  // A client finds the service through its home's config port, with no --port.
  const status = await runCommand(installedCLI.binaryPath, ["--home", home, "status"], { env: installedCLI.env });
  expect(status.exitCode, status.stderr).toBe(0);
  expect(JSON.parse(status.stdout)).toMatchObject({ home, serverURL: `http://localhost:${port}`, healthy: true, port });
  return { definition, health };
}

// The service carries home-only arguments: no port, listener,
// authentication, installed-by, or storage setting.
function assertProductionServiceDefinition(installedCLI: InstalledCLI, home: string): string {
  const definitionPath = serviceDefinitionPath();
  const definition = readFileSync(definitionPath, "utf8");
  const expectedArgs = [
    process.execPath,
    installedCLI.binaryPath,
    "--home",
    home,
    "serve",
  ];
  for (const option of ["--port", "--listen", "--auth", "--no-auth", "--installed-by-agent", "--storage-path"]) {
    expect(definition).not.toContain(option);
  }

  if (process.platform === "linux") {
    expect(definition).toContain(`Description=${DAEMON_DESCRIPTION}\n`);
    expect(definition).toContain(`ExecStart=${expectedArgs.join(" ")}\n`);
    expect(definition).toContain("Environment=PATH=");
    expect(definition).toContain("Environment=DO_NOT_TRACK=1\n");
    expect(definition).toContain(`Environment=TELEVISION_DEVELOPER_HOME=${os.homedir()}\n`);
    expect(definition).toContain("Environment=TELEVISION_LAUNCH_MODE=daemon\n");
    expect(definition).not.toContain("TV_TEST_DAEMON_NAME");
    expect(definition).toContain("Restart=always\n");
    expect(definition).toContain("RestartSec=5\n");
    expect(definition).toContain("WantedBy=default.target\n");
    expect(definition).not.toContain("RestartSteps=");
    expect(definition).not.toContain("RestartMaxDelaySec=");
    return definition;
  }

  if (process.platform === "darwin") {
    expect(definition).toContain(`<string>${DAEMON_NAME}</string>`);
    for (const arg of expectedArgs) expect(definition).toContain(`<string>${arg}</string>`);
    expect(definition).toContain("<key>PATH</key>");
    expect(definition).toContain("<key>DO_NOT_TRACK</key>\n    <string>1</string>");
    expect(definition).toContain(`<key>TELEVISION_DEVELOPER_HOME</key>\n    <string>${os.homedir()}</string>`);
    expect(definition).toContain("<key>TELEVISION_LAUNCH_MODE</key>\n    <string>daemon</string>");
    expect(definition).not.toContain("TV_TEST_DAEMON_NAME");
    expect(definition).toContain("<key>KeepAlive</key>\n    <true/>");
    expect(definition).toContain("<key>RunAtLoad</key>\n    <true/>");
    expect(definition).not.toContain("<key>StandardErrorPath</key>");
    return definition;
  }

  throw new Error(`daemon acceptance does not support ${process.platform}`);
}

function assertServiceDefinitionDoesNotReference(definition: string, home: string, port: number): void {
  expect(definition).not.toContain(home);
  if (process.platform === "linux") {
    expect(definition).not.toContain(`--port ${port}`);
    return;
  }
  if (process.platform === "darwin") {
    expect(definition).not.toContain(`<string>${port}</string>`);
    return;
  }
  throw new Error(`daemon acceptance does not support ${process.platform}`);
}

async function expectHealthGone(port: number): Promise<void> {
  await pollUntil(`old health endpoint http://127.0.0.1:${port}/health to stop`, async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
      return null;
    } catch {
      return true;
    }
  });
}

async function bulldozeService(observer: Daemon, phase: string): Promise<void> {
  const before = await observer.status();
  const managerBefore = await inspectServiceManager();
  logHarness(`bulldozer ${phase}: found ${JSON.stringify({ daemon: before, serviceManager: managerBefore })}`);
  await observer.uninstall();
  await expectServiceGone(observer, `bulldozer ${phase}`);
  logHarness(`bulldozer ${phase}: removed ${DAEMON_NAME}`);
}

async function expectServiceGone(observer: Daemon, phase: string): Promise<void> {
  const gone = await pollUntil(`${phase} to remove ${DAEMON_NAME}`, async () => {
    const status = await observer.status();
    const manager = await inspectServiceManager();
    return !status.installed && !status.running &&
      manager.definitionCount === 0 && manager.registrationCount === 0 && manager.runningCount === 0
      ? { status, manager }
      : null;
  });
  expect(gone).toEqual({
    status: { installed: false, running: false },
    manager: { definitionCount: 0, registrationCount: 0, runningCount: 0 },
  });
}

function createProductionDaemonObserver(): Daemon {
  return new Daemon({
    name: DAEMON_NAME,
    description: DAEMON_DESCRIPTION,
    command: process.execPath,
    args: [],
  });
}

async function inspectServiceManager(): Promise<ServiceManagerState> {
  const definitionCount = existsSync(serviceDefinitionPath()) ? 1 : 0;
  if (process.platform === "linux") {
    const active = await runCommand("systemctl", ["--user", "is-active", `${DAEMON_NAME}.service`]);
    const enabled = await runCommand("systemctl", ["--user", "is-enabled", `${DAEMON_NAME}.service`]);
    return {
      definitionCount,
      registrationCount: enabled.exitCode === 0 ? 1 : 0,
      runningCount: active.exitCode === 0 ? 1 : 0,
    };
  }
  if (process.platform === "darwin") {
    const listed = await runCommand("launchctl", ["list", DAEMON_NAME]);
    return {
      definitionCount,
      registrationCount: listed.exitCode === 0 ? 1 : 0,
      runningCount: listed.exitCode === 0 ? 1 : 0,
    };
  }
  throw new Error(`daemon acceptance does not support ${process.platform}`);
}

function serviceDefinitionPath(): string {
  if (process.platform === "linux") {
    return path.join(os.homedir(), ".config", "systemd", "user", `${DAEMON_NAME}.service`);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "LaunchAgents", `${DAEMON_NAME}.plist`);
  }
  throw new Error(`daemon acceptance does not support ${process.platform}`);
}

function productionCLIEnvironment(globalPrefix: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DO_NOT_TRACK: "1" };
  for (const key of Object.keys(env)) {
    if (
      key === "CI" ||
      key === "VITEST" ||
      key === "TELEVISION_ACP_AGENT" ||
      key === "TELEVISION_TELEMETRY_BUILD" ||
      key === "TV_TELEMETRY_TEST" ||
      key === "TV_UPDATE_CHANNEL_URL" ||
      key === "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS" ||
      key.startsWith("OPENCLAW_") ||
      key.startsWith("HERMES_")
    ) {
      delete env[key];
    }
  }
  env.PATH = [path.join(globalPrefix, "bin"), process.env.PATH ?? ""].filter(Boolean).join(path.delimiter);
  return env;
}

function discoverPathBinaries(name: string, pathValue: string | undefined): string[] {
  const binaries: string[] = [];
  for (const directory of (pathValue ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      const resolved = realpathSync(candidate);
      if (!binaries.includes(resolved)) binaries.push(resolved);
    } catch {
      // Missing, inaccessible, or broken PATH entry.
    }
  }
  return binaries;
}

async function readVersion(binaryPath: string): Promise<string> {
  const env = { ...process.env };
  delete env.VITEST;
  const result = await runCommand(binaryPath, ["--version"], { env, timeoutMs: 10_000 });
  return result.exitCode === 0 ? result.stdout.trim() : `unreadable (exit ${result.exitCode ?? result.signal ?? "unknown"})`;
}

async function allocateReleasedLoopbackPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function pollUntil<T>(description: string, check: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

  return await new Promise<CommandResult>((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Timed out running ${command} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

function logHarness(message: string): void {
  process.stderr.write(`[daemon-acceptance] ${message}\n`);
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
