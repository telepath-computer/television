import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { connect, createServer as createNetServer, type Socket } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { disposeAllOwnedProcesses, spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(process.cwd());
const BUILT_CLI = path.join(REPO_ROOT, "packages", "cli", "dist", "cli.cjs");
const CLI_BUILD_SCRIPT = path.join(REPO_ROOT, "packages", "cli", "build.mjs");
const DEVELOPER_MARKER = ".tv-developer";
const PROCESS_TIMEOUT_MS = 30_000;
const BUNDLED_SKILLS_MANIFEST = path.join(REPO_ROOT, "packages", "skills", "skills.json");

interface CLIResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface RunningCLI {
  process: OwnedProcess;
  port: number;
  startupURL: string;
  /** Everything the server has written to stdout and stderr so far. */
  output(): { stdout: string; stderr: string };
}

function cliEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITEST: "",
    DO_NOT_TRACK: "1",
  };
  delete env.TELEVISION_ACP_AGENT;
  delete env.TELEVISION_PORT;
  delete env.TELEVISION_STORAGE_PATH;
  return { ...env, ...overrides };
}

async function runNodeEntry(entryPath: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<CLIResult> {
  const owned = spawnOwnedProcess(process.execPath, [entryPath, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? cliEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  owned.child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
  owned.child.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

  try {
    const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for CLI exit\nstdout:\n${stdout}\nstderr:\n${stderr}`)), PROCESS_TIMEOUT_MS);
      owned.child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      owned.child.once("close", (exitCode, signal) => {
        clearTimeout(timeout);
        resolve({ exitCode, signal });
      });
    });
    return { exitCode, signal, stdout, stderr };
  } finally {
    await owned.dispose();
  }
}

async function runBuiltCLI(args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; cliPath?: string } = {}): Promise<CLIResult> {
  return runNodeEntry(options.cliPath ?? BUILT_CLI, args, options);
}

async function buildStandaloneCLI(outfile: string, env: NodeJS.ProcessEnv): Promise<CLIResult> {
  return runNodeEntry(CLI_BUILD_SCRIPT, ["--outfile", outfile], { env });
}

/**
 * Serves `home` with the built CLI under the test-runner recipe: the home's
 * config file sets port 0, and client commands pass the acquired port.
 */
async function startBuiltCLI(home: string, auth = true): Promise<RunningCLI> {
  writeHomeConfig(home, auth ? { port: 0 } : { port: 0, auth: false });
  return startBuiltServer(["--home", home, "serve", "--print-links"], cliEnvironment());
}

/** Spawns the built CLI with `args`, which start a foreground server, and waits until it serves `/health`. */
async function startBuiltServer(args: string[], env: NodeJS.ProcessEnv): Promise<RunningCLI> {
  const owned = spawnOwnedProcess(process.execPath, [BUILT_CLI, ...args], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  const startupURL = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for CLI startup\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, PROCESS_TIMEOUT_MS);
    const inspect = () => {
      const url = stdout.match(/https?:\/\/[^\s\u001B]+/)?.[0];
      if (!url) return;
      cleanup();
      resolve(url);
    };
    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      inspect();
    };
    const onStderr = (chunk: Buffer | string) => { stderr += chunk.toString(); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`CLI exited before startup (code ${code}, signal ${signal})\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      owned.child.off("exit", onExit);
      owned.child.off("error", onError);
    };

    owned.child.stdout?.on("data", onStdout);
    owned.child.stderr?.on("data", onStderr);
    owned.child.once("exit", onExit);
    owned.child.once("error", onError);
  });

  const healthURL = new URL("/health", startupURL);
  const health = await fetch(healthURL);
  expect(health.ok).toBe(true);
  return {
    process: owned,
    port: Number.parseInt(new URL(startupURL).port, 10),
    startupURL,
    output: () => ({ stdout, stderr }),
  };
}

async function allocateClosedLoopbackPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a dynamic loopback port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function makeTempDir(prefix: string, dirs: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function readBuiltVersion(): string {
  return (JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "cli", "package.json"), "utf8")) as { version: string }).version;
}

function readBundledSkillNames(): string[] {
  const manifest = JSON.parse(readFileSync(BUNDLED_SKILLS_MANIFEST, "utf8")) as { skills?: unknown };
  const names = manifest.skills;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error(`${BUNDLED_SKILLS_MANIFEST} must contain a skills array of non-empty names`);
  }
  return names as string[];
}

function listTreeRecursive(root: string, prefix = ""): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      entries.push(`${relative}${path.sep}`);
      entries.push(...listTreeRecursive(root, relative));
    } else {
      entries.push(relative);
    }
  }
  return entries;
}

function expectByteIdenticalTree(source: string, installed: string): void {
  expect(existsSync(source), `packaged skill tree ${source}`).toBe(true);
  expect(existsSync(installed), `installed skill tree ${installed}`).toBe(true);
  const sourceEntries = listTreeRecursive(source);
  const sourceFiles = sourceEntries.filter((relative) => !relative.endsWith(path.sep));
  expect(sourceFiles.length, `packaged skill files in ${source}`).toBeGreaterThan(0);
  expect(listTreeRecursive(installed), installed).toEqual(sourceEntries);
  for (const relative of sourceFiles) {
    const sourceBytes = readFileSync(path.join(source, relative));
    const installedBytes = readFileSync(path.join(installed, relative));
    expect(installedBytes.equals(sourceBytes), `${installed}/${relative}`).toBe(true);
  }
}

describe("CLI product spine acceptance", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await disposeAllOwnedProcesses();
    for (const dir of dirs.splice(0).reverse()) rmSync(dir, { recursive: true, force: true });
  });

  // [[product/cli.md#^cli-ac-links]]: built processes, real config/token files
  // and HTTP. The config changes while the running server keeps its settings.
  it("links follows running authentication across config edits and an authless restart", async () => {
    const home = makeTempDir("television-cli-links-", dirs);
    const running = await startBuiltCLI(home);
    const token = readFileSync(path.join(home, "state", "token"), "utf8").trim();
    const health = await (await fetch(new URL("/health", running.startupURL))).json() as { origins: string[] };
    const expected = health.origins.map((origin) => `${origin}/?token=${token}\n`).join("");
    const links = () => runBuiltCLI(["--home", home, "links", "--port", String(running.port)]);
    expect(await links()).toEqual({ exitCode: 0, signal: null, stdout: expected, stderr: "" });

    const config = await runBuiltCLI(["--home", home, "config", "set", "auth", "false"]);
    expect(config.exitCode, config.stderr).toBe(0);
    const afterEdit = await links();
    expect(afterEdit).toEqual({ exitCode: 0, signal: null, stdout: expected, stderr: "" });
    for (const link of afterEdit.stdout.trim().split("\n")) {
      const url = new URL(link);
      const response = await fetch(new URL("/display", url), { headers: { authorization: `Bearer ${url.searchParams.get("token")}` } });
      expect(response.status).toBe(200);
    }
    await running.process.dispose();

    const authless = await startBuiltServer(["--home", home, "serve", "--print-links"], cliEnvironment());
    expect(readFileSync(path.join(home, "state", "token"), "utf8").trim()).toBe(token);
    const restored = await runBuiltCLI(["--home", home, "config", "set", "auth", "true"]);
    expect(restored.exitCode, restored.stderr).toBe(0);
    const authlessHealth = await (await fetch(new URL("/health", authless.startupURL))).json() as { origins: string[] };
    expect(await runBuiltCLI(["--home", home, "links", "--port", String(authless.port)])).toEqual({
      exitCode: 0, signal: null, stderr: "",
      stdout: authlessHealth.origins.map((origin) => `${origin}\n`).join(""),
    });
  });

  // [[product/cli.md#^cli-ac-links-unauthorized]]
  it("links rejects a wrong home token without printing links", async () => {
    const home = makeTempDir("television-cli-links-server-", dirs);
    const running = await startBuiltCLI(home);
    const clientHome = makeTempDir("television-cli-links-client-", dirs);
    writeHomeConfig(clientHome, { port: 0 });
    mkdirSync(path.join(clientHome, "state"));
    writeFileSync(path.join(clientHome, "state", "token"), "wrong-token\n");
    const result = await runBuiltCLI(["--home", clientHome, "links", "--port", String(running.port)]);
    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Television server at http://localhost:${running.port} rejected the request as unauthorized. Check the token in ${path.join(clientHome, "state", "token")}.`);
    expect(result.stderr).toContain("Television ships bundled skills.");
  });

  // [[product/cli.md#^cli-ac-links-unreachable]]: a TCP forwarder keeps the
  // client endpoint reserved. It relays real traffic and closes on connection
  // failure; it supplies no HTTP response or substitute Television behavior.
  it("links reports an unreachable server without printing links", async () => {
    const home = makeTempDir("television-cli-links-unreachable-", dirs);
    const running = await startBuiltCLI(home);
    const sockets = new Set<Socket>();
    const front = createNetServer((socket) => {
      const upstream = connect(running.port, "127.0.0.1");
      const close = () => { socket.destroy(); upstream.destroy(); };
      for (const peer of [socket, upstream]) {
        sockets.add(peer);
        peer.on("error", close);
        peer.on("close", () => { sockets.delete(peer); close(); });
      }
      socket.pipe(upstream).pipe(socket);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        front.once("error", reject);
        front.listen(0, "127.0.0.1", resolve);
      });
      const address = front.address();
      if (!address || typeof address === "string") throw new Error("TCP forwarder did not bind");
      const serverURL = `http://localhost:${address.port}`;
      expect((await fetch(`${serverURL}/health`)).ok).toBe(true);
      await running.process.dispose();
      const result = await runBuiltCLI(["--home", home, "links", "--port", String(address.port)]);
      expect(result.exitCode).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`Could not reach Television server at ${serverURL}:`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => front.close((error) => error ? reject(error) : resolve()));
    }
  });

  // Spec: [[product/cli.md#^cli-ac-help-version|help and version acceptance]].
  it("prints help and version through the built CLI process boundary", async () => {
    const help = await runBuiltCLI(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.signal).toBeNull();
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("Usage: tv [options] [command]");
    expect(help.stdout).toContain("Agent workflow note:");

    const unmarkedRuntimeHome = makeTempDir("television-cli-acceptance-version-home-", dirs);
    const version = await runBuiltCLI(["--version"], {
      env: cliEnvironment({ HOME: unmarkedRuntimeHome }),
    });
    expect(version.exitCode).toBe(0);
    expect(version.signal).toBeNull();
    expect(version.stderr).toBe("");
    expect(version.stdout.trim()).toBe(readBuiltVersion());
  });

  // Specs: [[product/cli.md#^cli-ac-developer-version|developer-version acceptance]],
  // [[arch/cli/index.md#^cli-build-developer-git-boundary|developer build Git boundary]].
  it("shows the commit only for a marked build running under a marked home", async () => {
    const buildRoot = makeTempDir("television-cli-acceptance-developer-build-", dirs);
    const markedBuildHome = makeTempDir("television-cli-acceptance-marked-build-home-", dirs);
    const unmarkedBuildHome = makeTempDir("television-cli-acceptance-unmarked-build-home-", dirs);
    const markedRuntimeHome = makeTempDir("television-cli-acceptance-marked-runtime-home-", dirs);
    const unmarkedRuntimeHome = makeTempDir("television-cli-acceptance-unmarked-runtime-home-", dirs);
    const gitlessPath = makeTempDir("television-cli-acceptance-gitless-path-", dirs);
    writeFileSync(path.join(markedBuildHome, DEVELOPER_MARKER), "");
    writeFileSync(path.join(markedRuntimeHome, DEVELOPER_MARKER), "");

    const markedCLI = path.join(buildRoot, "marked.cjs");
    const unmarkedCLI = path.join(buildRoot, "unmarked.cjs");
    const markedBuild = await buildStandaloneCLI(markedCLI, cliEnvironment({ HOME: markedBuildHome }));
    expect(markedBuild.exitCode).toBe(0);
    expect(markedBuild.signal).toBeNull();
    const unmarkedBuild = await buildStandaloneCLI(unmarkedCLI, cliEnvironment({
      HOME: unmarkedBuildHome,
      PATH: gitlessPath,
    }));
    expect(unmarkedBuild.exitCode).toBe(0);
    expect(unmarkedBuild.signal).toBeNull();

    const releaseVersion = readBuiltVersion();
    const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const builds = [
      { cliPath: markedCLI, marked: true },
      { cliPath: unmarkedCLI, marked: false },
    ];
    const runtimeHomes = [
      { home: markedRuntimeHome, marked: true },
      { home: unmarkedRuntimeHome, marked: false },
    ];

    for (const build of builds) {
      for (const runtime of runtimeHomes) {
        const expected = build.marked && runtime.marked
          ? `${releaseVersion} (commit ${headCommit})`
          : releaseVersion;
        for (const flag of ["--version", "-V", "-v"]) {
          const result = await runBuiltCLI([flag], {
            cliPath: build.cliPath,
            env: cliEnvironment({ HOME: runtime.home }),
          });
          expect(result.exitCode, `${path.basename(build.cliPath)} ${flag}`).toBe(0);
          expect(result.signal).toBeNull();
          expect(result.stdout.trim()).toBe(expected);
          expect(result.stderr).toBe("");
        }
      }
    }
  });

  // Spec: [[arch/cli/index.md#^cli-build-developer-git-boundary|developer build Git boundary]].
  it("fails a marked build when Git provenance is unavailable", async () => {
    const buildRoot = makeTempDir("television-cli-acceptance-missing-git-build-", dirs);
    const markedBuildHome = makeTempDir("television-cli-acceptance-missing-git-home-", dirs);
    const gitlessPath = makeTempDir("television-cli-acceptance-missing-git-path-", dirs);
    const outfile = path.join(buildRoot, "tv.cjs");
    writeFileSync(path.join(markedBuildHome, DEVELOPER_MARKER), "");

    const build = await buildStandaloneCLI(outfile, cliEnvironment({
      HOME: markedBuildHome,
      PATH: gitlessPath,
    }));

    expect(build.exitCode).not.toBe(0);
    expect(build.signal).toBeNull();
    expect(existsSync(outfile)).toBe(false);
  });

  // Spec: [[arch/cli/index.md#^cli-sdk-served|the packaged SDK served by tv serve]].
  it("serves the packaged resource SDK's bytes from a full-build tv serve", async () => {
    const running = await startBuiltCLI(makeTempDir("television-cli-acceptance-sdk-", dirs));
    const response = await fetch(new URL("/sdk/v1/resources.js", running.startupURL));
    expect(response.status).toBe(200);
    const served = Buffer.from(await response.arrayBuffer());
    expect(served.equals(readFileSync(path.join(REPO_ROOT, "packages", "cli", "dist", "sdk", "v1", "resources.js")))).toBe(true);
  });

  // [[product/cli.md#^cli-ac-startup-links]]: piped output holds no token, only the command that prints the links.
  it("prints no link on piped startup output, only the tv links command that prints them", async () => {
    const home = makeTempDir("television-cli-startup-links-", dirs);
    writeHomeConfig(home, { port: 0 });
    const owned = spawnOwnedProcess(process.execPath, [BUILT_CLI, "--home", home, "serve"], { cwd: REPO_ROOT, env: cliEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    owned.child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    owned.child.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    await vi.waitFor(() => { expect(stdout).toContain("to print the links that open Television."); }, { timeout: PROCESS_TIMEOUT_MS, interval: 50 });
    const command = /^Run `(.+)` to print the links that open Television\.$/m.exec(stdout)?.[1] ?? "";
    const port = Number(/ --port (\d+)$/.exec(command)?.[1]);
    expect(stdout).toBe(`Television server running.\nRun \`tv --home ${home} links --port ${port}\` to print the links that open Television.\n`);
    const token = readFileSync(path.join(home, "state", "token"), "utf8").trim();
    expect(token.length).toBeGreaterThan(0);
    expect(`${stdout}${stderr}`).not.toContain(token);

    // The command, run as printed, prints the server's token-bearing links.
    const links = await runBuiltCLI(command.split(" ").slice(1));
    expect(links.exitCode, links.stderr).toBe(0);
    const printed = links.stdout.trim().split("\n");
    expect(printed).toContain(`http://127.0.0.1:${port}/?token=${token}`);
    for (const link of printed) expect(new URL(link).searchParams.get("token")).toBe(token);
  });

  // Specs: [[product/cli.md#^cli-ac-workflow-success|workflow success acceptance]],
  // [[product/cli.md#^cli-ac-default-auth|authentication on by default]].
  it("completes a representative workflow command through a real server", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-workflow-", dirs);
    const running = await startBuiltCLI(storagePath);
    expect(JSON.parse(readFileSync(path.join(storagePath, "config.json"), "utf8"))).toEqual({ port: 0 });
    const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    expect(token.length).toBeGreaterThan(0);
    expect(new URL(running.startupURL).searchParams.get("token")).toBe(token);
    expect(running.output().stderr).not.toContain("running without an auth token");

    const result = await runBuiltCLI([
      "--home", storagePath,
      "create-channel", "--name", "Acceptance Channel", "--no-focus",
      "--port", String(running.port),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^Channel created: \S+ \(Acceptance Channel\)\s*$/);
  });

  // Spec: [[product/cli.md#^cli-ac-update-channel-success|update-channel success acceptance]].
  it("update-channel renames a channel through the built CLI and real server", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-update-channel-", dirs);
    const artifactRoot = makeTempDir("television-cli-acceptance-update-channel-artifact-", dirs);
    const artifactPath = path.join(artifactRoot, "fixture.md");
    writeFileSync(artifactPath, "# Referenced artifact\n");
    const running = await startBuiltCLI(storagePath);
    const headers = {
      Authorization: `Bearer ${readFileSync(path.join(storagePath, "state", "token"), "utf8").trim()}`,
      "Content-Type": "application/json",
    };

    const createChannelResponse = await fetch(new URL("/channels", running.startupURL), {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Before rename" }),
    });
    expect(createChannelResponse.status).toBe(201);
    const { channel: createdChannel } = await createChannelResponse.json() as {
      channel: { id: string; name: string; layout: unknown[] };
    };

    const createArtifactResponse = await fetch(new URL("/artifacts", running.startupURL), {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "path",
        title: "Rename continuity fixture",
        path: artifactPath,
        channelID: createdChannel.id,
      }),
    });
    expect(createArtifactResponse.status).toBe(201);

    const beforeResponse = await fetch(new URL(`/channels/${encodeURIComponent(createdChannel.id)}`, running.startupURL), { headers });
    expect(beforeResponse.status).toBe(200);
    const before = await beforeResponse.json() as {
      channel: { id: string; name: string; layout: unknown[] };
      artifacts: unknown[];
    };
    expect(before.channel.layout).toHaveLength(1);
    expect(before.artifacts).toHaveLength(1);

    const authoredName = "  Renamed by built CLI  ";
    const result = await runBuiltCLI([
      "--home", storagePath,
      "update-channel", "--channel", createdChannel.id, "--name", authoredName,
      "--port", String(running.port),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe(`Channel updated: ${createdChannel.id} (${authoredName})\n`);
    expect(result.stderr).toBe("");

    const afterResponse = await fetch(new URL(`/channels/${encodeURIComponent(createdChannel.id)}`, running.startupURL), { headers });
    expect(afterResponse.status).toBe(200);
    const after = await afterResponse.json() as typeof before;
    expect(after.channel.id).toBe(before.channel.id);
    expect(after.channel.name).toBe(authoredName);
    expect(after.channel.layout).toEqual(before.channel.layout);
    expect(after.artifacts).toEqual(before.artifacts);
  });

  // Spec: [[product/cli.md#^cli-ac-update-channel-not-found|update-channel unknown-channel acceptance]].
  it("update-channel reports an unknown channel through the built CLI and real server", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-update-channel-missing-", dirs);
    const running = await startBuiltCLI(storagePath);
    const channelID = "missing-channel-for-update";

    const result = await runBuiltCLI([
      "--home", storagePath,
      "update-channel", "--channel", channelID, "--name", "Never applied",
      "--port", String(running.port),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(new RegExp(
      `^Channel not found: ${channelID}\\nTelevision ships bundled skills\\.`,
    ));
    expect(result.stderr).toContain("The main skill is `television`");
    expect(result.stderr).toContain("Install all bundled skills with `tv skills install <path>`");
  });

  // Spec: [[product/cli.md#^cli-ac-directive-error|directive-error acceptance]].
  it("returns exit 1 and recovery guidance for a directive error", async () => {
    const result = await runBuiltCLI(["list-artifacts", "--bogus"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("tv list-artifacts --bogus does not support --bogus.");
    expect(result.stderr).toContain("Television ships bundled skills.");
  });

  // Spec: [[product/cli.md#^cli-ac-current-recovery-pointer|current recovery guidance acceptance]].
  it("routes directive-error recovery through the main television skill", async () => {
    const result = await runBuiltCLI(["list-artifacts", "--bogus"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming.",
    );
    expect(result.stderr).toContain("Additional `tv-*` skills cover specialized artifact types.");
    expect(result.stderr).not.toContain("specialized artifact types and theming");
  });

  // Spec: [[product/cli.md#^cli-ac-retired-options|retired options acceptance]].
  it("prints the upgrade guidance for retired options and does nothing else", async () => {
    const root = makeTempDir("television-cli-acceptance-retired-", dirs);
    const home = path.join(root, "home");
    for (const [args, named] of [
      [["--home", home, "serve", "--port", "43123"], "--port"],
      [["--home", home, "serve", "--persist", "--listen", "0.0.0.0"], "--listen"],
      [["--home", home, "list-channels", "--storage-path", path.join(root, "old-storage")], "--storage-path"],
    ] as const) {
      const result = await runBuiltCLI([...args], { env: cliEnvironment({ TELEVISION_LAUNCH_MODE: "" }) });
      const label = args.join(" ");
      expect(result.exitCode, label).toBe(1);
      expect(result.stdout, label).toBe("");
      expect(result.stderr.startsWith(`This version of Television does not accept ${named}. Server settings`), `${label}\n${result.stderr}`).toBe(true);
      expect(result.stderr, label).toContain("  --auth                       ->  tv config set auth true (the default)\n");
      expect(result.stderr, label).toContain("rerun tv serve --persist to update an installed service.");
      expect(result.stderr, label).toContain("https://television.run/install.md\nTelevision ships bundled skills.");
    }
    expect(existsSync(home)).toBe(false);
  });

  // Spec: [[product/cli.md#^cli-ac-retired-service|transitional service path acceptance]].
  it("starts a server from an earlier release's service definition", async () => {
    const home = path.join(makeTempDir("television-cli-acceptance-retired-service-", dirs), "home");
    // The arguments and launch mode an earlier release's service definition
    // stores, with port 0 in place of its stable port so that the server binds
    // a port the operating system assigns.
    const running = await startBuiltServer(
      // The hidden --print-links flag lets the test read the port the server bound.
      ["serve", "--port", "0", "--storage-path", home, "--installed-by-agent", "Claude Code", "--print-links"],
      cliEnvironment({ TELEVISION_LAUNCH_MODE: "daemon" }),
    );
    try {
      expect(running.port).toBeGreaterThan(0);
      expect(new URL(running.startupURL).searchParams.has("token")).toBe(false);
      await vi.waitFor(() => { expect(running.output().stderr).toContain("WARNING: running without an auth token."); });
      expect(JSON.parse(readFileSync(path.join(home, "config.json"), "utf8"))).toEqual({ port: 0, auth: false, installedByAgent: "Claude Code" });
      const records = readFileSync(path.join(home, "logs", "tv.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { msg?: string });
      const retiredRecord = JSON.stringify(records.find((record) => record.msg === "service runs from a retired service definition"));
      expect(retiredRecord).toContain("tv serve --persist");
      expect(retiredRecord).toContain("https://television.run/install.md");

      // A client command accepts --port only while its home's config port is 0,
      // so this reaches the server through the config file the path wrote.
      const listed = await runBuiltCLI(["--home", home, "list-channels", "--port", String(running.port)]);
      expect(listed.exitCode, listed.stderr).toBe(0);
    } finally {
      await running.process.dispose();
    }
  });

  // Spec: [[product/cli.md#^cli-ac-connection-failure|connection-failure acceptance]].
  it("reports a connection failure through the built CLI process boundary", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-unreachable-", dirs);
    writeHomeConfig(storagePath, { port: 0 });
    const port = await allocateClosedLoopbackPort();
    const result = await runBuiltCLI(["--home", storagePath, "list-channels", "--port", String(port)]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Could not reach Television server at http://localhost:${port}:`);
    expect(result.stderr).not.toContain("Television ships bundled skills.");
  });

  // Spec: [[product/cli.md#^cli-ac-unauthorized|token-rejection acceptance]].
  it("reports a 401 rejection with the token-file recovery path", async () => {
    const serverStorage = makeTempDir("television-cli-acceptance-auth-server-", dirs);
    const clientStorage = makeTempDir("television-cli-acceptance-auth-client-", dirs);
    const running = await startBuiltCLI(serverStorage);
    mkdirSync(path.join(clientStorage, "state"), { recursive: true });
    writeFileSync(path.join(clientStorage, "state", "token"), "wrong-token\n");
    writeHomeConfig(clientStorage, { port: 0 });

    const result = await runBuiltCLI(["--home", clientStorage, "list-channels", "--port", String(running.port)]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Television server at http://localhost:${running.port} rejected the request as unauthorized.`);
    expect(result.stderr).toContain(`Check the token in ${path.join(clientStorage, "state", "token")}.`);
  });

  // Spec: [[product/cli.md#^cli-ac-channel-selection|channel-selection acceptance]].
  it("reports multiple-channel selection failure without calling it a reachability failure", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-channel-selection-", dirs);
    const running = await startBuiltCLI(storagePath);
    const setup = await runBuiltCLI([
      "--home", storagePath,
      "create-channel", "--name", "Another Channel", "--no-focus",
      "--port", String(running.port),
    ]);
    expect(setup.exitCode).toBe(0);

    const result = await runBuiltCLI(["--home", storagePath, "get-channel", "--port", String(running.port)]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("channelID is required when multiple channels exist.");
    expect(result.stderr).not.toContain("Could not reach Television server");
  });

  // Specs: [[product/cli.md#^cli-ac-status|status acceptance]],
  // [[product/cli.md#^cli-ac-status-version|status/version agreement]],
  // [[product/cli.md#^cli-ac-status-home|status reports the home]],
  // [[product/versioning.md#^pv-machine-boundary|version pass-through]].
  it("reports healthy and unhealthy status as successful process outcomes", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-status-", dirs);
    const running = await startBuiltCLI(storagePath);

    const health = await fetch(new URL("/health", running.startupURL));
    expect(health.ok).toBe(true);
    const healthBody = await health.json() as Record<string, unknown>;
    expect(healthBody.version).toBe(readBuiltVersion());
    expect(healthBody).not.toHaveProperty("home");
    expect(JSON.stringify(healthBody)).not.toContain(storagePath);
    expect(JSON.stringify(healthBody)).not.toContain(path.sep + "state");

    const version = await runBuiltCLI(["--version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stderr).toBe("");

    const healthy = await runBuiltCLI(["--home", storagePath, "status", "--port", String(running.port)]);
    expect(healthy.exitCode).toBe(0);
    expect(healthy.stderr).toBe("");
    expect(JSON.parse(healthy.stdout)).toMatchObject({
      home: storagePath,
      serverURL: `http://localhost:${running.port}`,
      healthy: true,
      version: readBuiltVersion(),
      port: running.port,
    });
    expect(JSON.parse(healthy.stdout).version).toBe(version.stdout.trim().split(" ", 1)[0]);

    await running.process.dispose();
    const unhealthy = await runBuiltCLI(["--home", storagePath, "status", "--port", String(running.port)]);
    expect(unhealthy.exitCode).toBe(0);
    expect(unhealthy.stderr).toBe("");
    expect(JSON.parse(unhealthy.stdout)).toMatchObject({
      home: storagePath,
      serverURL: `http://localhost:${running.port}`,
      healthy: false,
    });
  });

  // Spec: [[product/cli.md#^cli-ac-stale-theme-skill-cleanup|stale standalone-theme cleanup acceptance]].
  it("removes a stale tv-theme directory through the built CLI process boundary", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-stale-theme-storage-", dirs);
    const destination = makeTempDir("television-cli-acceptance-stale-theme-destination-", dirs);
    const packagedSkills = path.join(REPO_ROOT, "packages", "cli", "dist", "skills");
    const manifestSkillNames = readBundledSkillNames();
    mkdirSync(path.join(destination, "tv-theme", "nested"), { recursive: true });
    writeFileSync(path.join(destination, "tv-theme", "nested", "stale.txt"), "stale\n");

    const result = await runBuiltCLI(["--home", storagePath, "skills", "install", destination]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Copied ${manifestSkillNames.length} bundled Television skill(s):`);
    expect(existsSync(path.join(destination, "tv-theme"))).toBe(false);
    expectByteIdenticalTree(packagedSkills, destination);
    expect(readFileSync(path.join(destination, "television", "SKILL.md"), "utf8")).toContain("./theming.md");
    expect(readFileSync(path.join(destination, "television", "theming.md"), "utf8")).toContain(
      "# Authoring Television themes",
    );
  });

  // Spec: [[product/cli.md#^cli-ac-skills-copy|packaged skills-copy acceptance]].
  it("copies the packaged bundled skills through the built CLI process boundary", async () => {
    const storagePath = makeTempDir("television-cli-acceptance-skills-storage-", dirs);
    const destination = makeTempDir("television-cli-acceptance-skills-destination-", dirs);
    const manifestSkillNames = readBundledSkillNames();
    const result = await runBuiltCLI(["--home", storagePath, "skills", "install", destination]);

    const installedSkillNames = readdirSync(destination).sort();
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Copied ${manifestSkillNames.length} bundled Television skill(s):`);
    expect(installedSkillNames).toEqual([...manifestSkillNames].sort());
    expect(installedSkillNames).toContain("television");
    expectByteIdenticalTree(path.join(REPO_ROOT, "packages", "cli", "dist", "skills"), destination);

    const installedTelevisionSkill = readFileSync(path.join(destination, "television", "SKILL.md"), "utf8");
    expect(installedTelevisionSkill).toContain("# HTML artifact style");
    expect(installedTelevisionSkill).toContain("/canonical/v2/components.js");
    expect(installedTelevisionSkill).toContain(
      "/canonical/v2/styles.css?authoredForAppVersion=<version>",
    );
    expect(installedTelevisionSkill).toContain("advisory authoring context");
    expect(installedTelevisionSkill).toContain(
      "clients select the artifact's tab page, switching channels first when needed",
    );
    expect(installedTelevisionSkill).toContain("remove its tab page from the channel");
    expect(installedTelevisionSkill).toContain("`update-channel`");
    expect(installedTelevisionSkill).not.toContain("scroll and highlight the artifact");
    expect(installedTelevisionSkill).not.toContain("remove its card from its channel");

    const installedTasksSkill = readFileSync(path.join(destination, "tv-tasks", "SKILL.md"), "utf8");
    expect(installedTasksSkill).toContain("/canonical/v2/styles.css?authoredForAppVersion=<version>");
    expect(installedTasksSkill).toContain("Television's frame already names the artifact");
    expect(installedTasksSkill).not.toContain("Television card");

    const installedTheming = readFileSync(path.join(destination, "television", "theming.md"), "utf8");
    expect(installedTelevisionSkill).toContain("./theming.md");
    expect(installedTheming).toContain("# Authoring Television themes");
    expect(installedTheming).toContain("`tv status`");
    expect(installedTheming).toContain("<themesPath>/<theme-id>/");
    expect(installedTheming).toContain('"authoredForAppVersion": "<app-version>"');
    expect(installedTheming).toContain("preserve that filesystem string exactly");
    expect(installedTheming).not.toContain("Placeholder —");
    expect(installedTheming).not.toContain("{{INJECT_");
    expect(installedTheming).not.toContain('"slug"');
    expect(installedTheming).not.toContain("<television-app>");
    expect(installedTheming).not.toContain("tv state");
  });

  // Spec: [[product/cli.md#^cli-ac-default-home|default-home selection]].
  it("selects the default home from the operating-system home and ~/.tv-home", async () => {
    const operatingSystemHome = makeTempDir("television-cli-acceptance-os-home-", dirs);
    const otherHome = makeTempDir("television-cli-acceptance-other-home-", dirs);
    const env = cliEnvironment({ HOME: operatingSystemHome });
    const expectHome = async (args: string[], home: string): Promise<void> => {
      const show = await runBuiltCLI([...args, "config", "show"], { env });
      expect(show.exitCode, show.stderr).toBe(0);
      expect(show.stderr).toBe("");
      expect(JSON.parse(show.stdout)).toEqual({
        home,
        configPath: path.join(home, "config.json"),
        configFileExists: false,
        settings: { port: 32848, listen: [], auth: true, installedByAgent: null },
      });
      const themesPath = await runBuiltCLI([...args, "themes-path"], { env });
      expect(themesPath.exitCode, themesPath.stderr).toBe(0);
      expect(themesPath.stdout).toBe(`${JSON.stringify({ themesPath: path.join(home, "themes") })}\n`);
    };

    await expectHome([], path.join(operatingSystemHome, ".television"));
    writeFileSync(path.join(operatingSystemHome, ".tv-home"), "~/tv-elsewhere/\n");
    await expectHome([], path.join(operatingSystemHome, "tv-elsewhere"));
    await expectHome(["--home", otherHome], otherHome);
  });

  // Spec: [[product/cli.md#^cli-ac-legacy-variables-warning|legacy-variable warning]].
  it("warns about TELEVISION_STORAGE_PATH and still selects the default home", async () => {
    const operatingSystemHome = makeTempDir("television-cli-acceptance-legacy-os-home-", dirs);
    const oldStorage = makeTempDir("television-cli-acceptance-legacy-storage-", dirs);
    const show = await runBuiltCLI(["config", "show"], {
      env: cliEnvironment({ HOME: operatingSystemHome, TELEVISION_STORAGE_PATH: oldStorage, TELEVISION_LAUNCH_MODE: "" }),
    });

    expect(show.exitCode, show.stderr).toBe(0);
    expect(show.stderr).toBe(
      "WARNING: TELEVISION_PORT or TELEVISION_STORAGE_PATH is set in this environment, and Television no longer uses either. Set the server's port with tv config set port <number>. Television uses the home given with tv --home <path> <command>, otherwise the path written in ~/.tv-home, otherwise ~/.television.\n",
    );
    expect(JSON.parse(show.stdout).home).toBe(path.join(operatingSystemHome, ".television"));
  });

  // Spec: [[product/cli.md#^cli-ac-invalid-config|an invalid config file stops tv serve]].
  it("stops tv serve before binding when the config file is malformed", async () => {
    const home = makeTempDir("television-cli-acceptance-invalid-config-", dirs);
    const configPath = path.join(home, "config.json");
    const malformed = "{\"port\": 0,\n";
    writeFileSync(configPath, malformed);

    const result = await runBuiltCLI(["--home", home, "serve"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith(`Config file ${configPath} is not valid JSON: `), result.stderr).toBe(true);
    expect(result.stderr).toContain("\nTelevision ships bundled skills.");
    expect(result.stderr).toContain("Install all bundled skills with `tv skills install <path>`");
    expect(readFileSync(configPath, "utf8")).toBe(malformed);
  });
});
