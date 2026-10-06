import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TelevisionClient } from "@telepath-computer/television-shared";
import { PORT_ZERO_WARNING, runCLI } from "../../packages/cli/src/index.ts";
import { Server } from "../../packages/server/src/server.ts";
import { ServerStore } from "../../packages/server/src/server-store.ts";
import { emitSkillInstalledTelemetry, readTelemetryState, telemetryVersion, type BuiltTelemetryEvent, type SkillInstalledTelemetryOptions, type TelemetryCaptureSink, type TelemetryEnv } from "../../packages/server/src/telemetry/index.ts";
import { NO_THEME_SETTINGS } from "../helpers/telemetry-settings.ts";
import { createServingStore } from "../helpers/serving-store.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(process.cwd());
const REAL_CLI_VERSION = telemetryVersion(JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/cli/package.json"), "utf8")).version);
const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const NEXT_VERSION = telemetryVersion("0.1.171");

// Specs: [[arch/cli/index.md#^cli-telemetry-http-seam|telemetry-control HTTP seam]], [[arch/cli/index.md#^cli-skill-real-emitter-seam|skills action to real telemetry emitter]].
class BufferOutput {
  chunks: string[] = [];
  private readonly onWrite?: (chunk: string) => void;
  constructor(onWrite?: (chunk: string) => void) { this.onWrite = onWrite; }
  write(chunk: string | Uint8Array): void { this.chunks.push(String(chunk)); this.onWrite?.(String(chunk)); }
  toString(): string { return this.chunks.join(""); }
}

class RecordingTelemetrySink implements TelemetryCaptureSink {
  readonly events: BuiltTelemetryEvent[] = [];
  enqueue(event: BuiltTelemetryEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}

interface Harness {
  storagePath: string;
  targetPath: string;
  server: Server;
  store: ServerStore;
  sink: RecordingTelemetrySink;
  port: number;
}

describe("telemetry CLI node integration", () => {
  const harnesses: Harness[] = [];
  const standaloneServers: Server[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    for (const harness of harnesses.splice(0).reverse()) await harness.server.dispose();
    for (const server of standaloneServers.splice(0).reverse()) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setup(env: TelemetryEnv = TEST_TELEMETRY_ENV): Promise<Harness> {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-cli-storage-"));
    const targetPath = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-cli-target-"));
    dirs.push(storagePath, targetPath);
    writeHomeConfig(storagePath, { port: 0 });
    const store = createServingStore(storagePath);
    const sink = new RecordingTelemetrySink();
    const server = new Server({
      store,
      host: "127.0.0.1",
      port: 0,
      auth: true,
      telemetry: { env, sink, version: TEST_VERSION, launchMode: "cli" },
    });
    await server.start();
    const port = Number.parseInt(new URL(server.getBaseURL()).port, 10);
    const harness = { storagePath, targetPath, server, store, sink, port };
    harnesses.push(harness);
    return harness;
  }

  async function runTelemetryCLI(argv: string[], harness: Harness): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const exitCode = await runCLI(["--home", harness.storagePath, ...argv, "--port", String(harness.port)], { stdout, stderr });
    return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
  }

  function expectNoTelemetryMessaging(text: string): void {
    expect(text).not.toMatch(/telemetry/i);
    expect(text).not.toContain("DO_NOT_TRACK=1");
    expect(text).not.toContain("tv telemetry disable");
  }

  async function runServeOnce(input: {
    storagePath: string;
    version: ReturnType<typeof telemetryVersion>;
    env?: TelemetryEnv;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; events: BuiltTelemetryEvent[]; output: string }> {
    const output: string[] = [];
    const stdout = new BufferOutput((chunk) => output.push(chunk));
    const stderr = new BufferOutput((chunk) => output.push(chunk));
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const sink = new RecordingTelemetrySink();
    writeHomeConfig(input.storagePath, { port: 0 });
    const runPromise = runCLI(["--home", input.storagePath, "serve"], {
      stdout,
      stderr,
      createServer: (options) => {
        const server = new Server({
          store: createServingStore(options.home),
          host: "127.0.0.1",
          port: options.port,
          auth: options.auth,
          telemetry: {
            env: input.env ?? TEST_TELEMETRY_ENV,
            sink,
            version: input.version,
            launchMode: "cli",
          },
        });
        standaloneServers.push(server);
        return server;
      },
      onSignal: (signal, handler) => { signalHandlers.set(signal, handler); },
    });
    await vi.waitFor(() => {
      expect(stdout.toString()).toContain("Television server running.");
    }, { timeout: 5_000 });
    signalHandlers.get("SIGTERM")?.();
    const exitCode = await runPromise;
    return { exitCode, stdout: stdout.toString(), stderr: stderr.toString(), events: [...sink.events], output: output.join("") };
  }

  it("tv telemetry disable emits one opt-out event, preserves the GUID, and enable updates current-state properties on the next event", async () => {
    const h = await setup();
    const initialState = await readTelemetryState(h.storagePath);
    h.sink.clear();

    const disabled = await runTelemetryCLI(["telemetry", "disable"], h);
    expect(disabled).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(disabled.stdout)).toEqual({ state: "opted-out", reason: null, guidPresent: true, region: "us" });
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out"]);
    expect(h.sink.events[0]?.properties.$set).toEqual({ ...NO_THEME_SETTINGS, telemetry_opted_out: true });

    const disabledState = await readTelemetryState(h.storagePath);
    expect(disabledState).toMatchObject({ userId: initialState!.userId, optedOut: true });

    const enabled = await runTelemetryCLI(["telemetry", "enable"], h);
    expect(enabled).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(enabled.stdout)).toEqual({ state: "active", reason: null, guidPresent: true, region: "us" });
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out"]);
    expect(await readTelemetryState(h.storagePath)).toMatchObject({ userId: initialState!.userId, optedOut: false });

    const channel = h.store.listChannels()[0]!;
    const artifactPath = path.join(h.targetPath, "after-enable.md");
    writeFileSync(artifactPath, "# after enable\n", "utf8");
    const created = await runCLI([
      "create-path-artifact",
      "--channel", channel.id,
      "--title", "After Enable",
      "--path", artifactPath,
      "--no-focus",
      "--port", String(h.port),
      "--home", h.storagePath,
    ], { stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(created).toBe(0);
    expect(h.sink.events.map((event) => event.name)).toEqual(["telemetry_opted_out", "artifact_created"]);
    expect(h.sink.events[1]?.properties.$set).toMatchObject({ telemetry_opted_out: false });
  });

  it("tv status reports active, opted-out, and environment-suppressed telemetry states", async () => {
    const active = await setup();
    let status = await runTelemetryCLI(["status"], active);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).telemetry).toEqual({ state: "active", reason: null, guidPresent: true, region: "us" });

    await runTelemetryCLI(["telemetry", "disable"], active);
    status = await runTelemetryCLI(["status"], active);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).telemetry).toEqual({ state: "opted-out", reason: null, guidPresent: true, region: "us" });

    const suppressed = await setup({ ...TEST_TELEMETRY_ENV, DO_NOT_TRACK: "1" });
    status = await runTelemetryCLI(["status"], suppressed);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).telemetry).toEqual({ state: "suppressed", reason: "do-not-track", guidPresent: true, region: "us" });
  });

  it("ordinary-build tv serve emits test lifecycle events without a telemetry notice", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-lifecycle-"));
    dirs.push(storagePath);

    const first = await runServeOnce({ storagePath, version: TEST_VERSION });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("Television server running.");
    expectNoTelemetryMessaging(first.stdout);
    expect(first.events.map((event) => event.name)).toEqual(["server_installed", "server_started"]);
    expectNoTelemetryMessaging(first.stderr);
    expect(first.stderr).toBe(`${PORT_ZERO_WARNING}\n`);

    const restart = await runServeOnce({ storagePath, version: TEST_VERSION });
    expect(restart.exitCode).toBe(0);
    expectNoTelemetryMessaging(restart.stdout);
    expect(restart.events.map((event) => event.name)).toEqual(["server_started"]);
    expectNoTelemetryMessaging(restart.stderr);
    expect(restart.stderr).toBe(`${PORT_ZERO_WARNING}\n`);

    const upgrade = await runServeOnce({ storagePath, version: NEXT_VERSION });
    expect(upgrade.exitCode).toBe(0);
    expectNoTelemetryMessaging(upgrade.stdout);
    expect(upgrade.events.map((event) => event.name)).toEqual(["server_upgraded", "server_started"]);
    expectNoTelemetryMessaging(upgrade.stderr);
    expect(upgrade.stderr).toBe(`${PORT_ZERO_WARNING}\n`);
  });

  const notice = "Fully anonymized telemetry is enabled by default. Opt out: tv telemetry disable.\n";

  function noticeHost(): string {
    const host = mkdtempSync(path.join(os.tmpdir(), "television-notice-host-"));
    dirs.push(host);
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", "production");
    for (const key of ["CI", "DO_NOT_TRACK", "TV_TELEMETRY_TEST", "TELEVISION_LAUNCH_MODE", "TELEVISION_ACP_AGENT"]) vi.stubEnv(key, undefined);
    vi.stubEnv("TELEVISION_DEVELOPER_HOME", host);
    return host;
  }

  it("shows the brief notice once on first serve and stays quiet after skills-first initialization", async () => {
    const host = noticeHost();
    const storagePath = path.join(host, "serve");
    const first = await runServeOnce({ storagePath, version: TEST_VERSION, env: { ...process.env } });
    expect(first.stderr).toBe(PORT_ZERO_WARNING + "\n" + notice);
    expect(first.output.indexOf(notice)).toBeGreaterThan(first.output.indexOf("Television server running."));
    expect(await readTelemetryState(storagePath)).not.toBeNull();
    const again = await runServeOnce({ storagePath, version: TEST_VERSION, env: { ...process.env } });
    expect(again.stderr).toBe(PORT_ZERO_WARNING + "\n");

    const skillsHome = path.join(host, "skills-home");
    const bundled = path.join(host, "bundled");
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television/SKILL.md"), "tv\n");
    const stderr = new BufferOutput();
    expect(await runCLI(["--home", skillsHome, "skills", "install", path.join(host, "destination")], {
      stdout: new BufferOutput(), stderr, resolveBundledSkillsRoot: () => bundled,
      emitSkillInstalledTelemetry: (options) => emitSkillInstalledTelemetry({ ...options, sink: new RecordingTelemetrySink() }),
    })).toBe(0);
    expect(stderr.toString()).toBe(notice);
    const serve = await runServeOnce({ storagePath: skillsHome, version: TEST_VERSION, env: { ...process.env } });
    expect(serve.stderr).toBe(PORT_ZERO_WARNING + "\n");
  });

  it.each(["ordinary", "test", "marker", "DNT", "CI", "opted-out", "daemon"])("keeps the notice quiet for %s", async (mode) => {
    const host = noticeHost();
    const storagePath = path.join(host, "data");
    if (mode === "ordinary") vi.stubGlobal("__TV_TELEMETRY_BUILD__", "development");
    if (mode === "test") vi.stubEnv("TV_TELEMETRY_TEST", "1");
    if (mode === "marker") writeFileSync(path.join(host, ".tv-developer"), "");
    if (mode === "DNT") vi.stubEnv("DO_NOT_TRACK", "1");
    if (mode === "CI") vi.stubEnv("CI", "1");
    if (mode === "daemon") vi.stubEnv("TELEVISION_LAUNCH_MODE", "daemon");
    if (mode === "opted-out") {
      mkdirSync(path.join(storagePath, "state"), { recursive: true });
      writeFileSync(path.join(storagePath, "state/telemetry.json"), JSON.stringify({ schemaVersion: 1, userId: "opted-out", optedOut: true, lastVersion: "" }));
    }
    const result = await runServeOnce({ storagePath, version: TEST_VERSION, env: { ...process.env } });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(PORT_ZERO_WARNING + "\n");
  });

  it("shows the notice only after the first successful persisted installation", async () => {
    const host = noticeHost();
    const home = path.join(host, "data");
    let active: Server | undefined;
    const install = async () => {
      active = new Server({ store: createServingStore(home), host: "127.0.0.1", port: 0, auth: true,
        telemetry: { env: { ...process.env }, sink: new RecordingTelemetrySink(), version: TEST_VERSION } });
      standaloneServers.push(active);
      await active.start();
    };
    // Stands in for the client of the parent's post-install health check: it
    // answers exactly while the stand-in daemon's server is running.
    const healthServerURLs: string[] = [];
    const createClient = (serverURL: string) => {
      healthServerURLs.push(serverURL);
      return {
        health: async () => {
          if (!active) throw new Error("connect ECONNREFUSED");
          return { status: "ok", bindAddresses: ["127.0.0.1"], port: Number(new URL(active.getBaseURL()).port) };
        },
      } as unknown as TelevisionClient;
    };
    const runPersist = async ({ fail = false, serve = true, targetHome = home } = {}) => {
      const output: string[] = [];
      const stdout = new BufferOutput((chunk) => output.push(chunk));
      const stderr = new BufferOutput((chunk) => output.push(chunk));
      const code = await runCLI(["--home", targetHome, "serve", "--persist"], {
        stdout, stderr, resolveHomeDir: () => host, createClient,
        createDaemon: () => ({
          status: async () => ({ installed: Boolean(active), running: Boolean(active) }),
          uninstall: async () => { await active?.dispose(); active = undefined; },
          install: async () => {
            if (fail) throw new Error("fixture install failure");
            if (serve) await install();
          },
        }),
      });
      return { code, stdout: stdout.toString(), stderr: stderr.toString(), output: output.join("") };
    };
    const first = await runPersist();
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("Television service installed.");
    expect(first.stderr).toBe(notice);
    expect(first.output.indexOf(notice)).toBeGreaterThan(first.output.indexOf("Television service installed."));
    expect(await readTelemetryState(home)).not.toBeNull();
    expect((await runPersist()).stderr).toBe("");
    const state = (await readTelemetryState(home))!;
    writeFileSync(path.join(home, "state/telemetry.json"), JSON.stringify({ ...state, optedOut: true }));
    expect((await runPersist()).stderr).toBe("");
    const failed = await runPersist({ fail: true, targetHome: path.join(host, "failed") });
    expect(failed.code).toBe(1);
    expect(failed.stderr).not.toContain(notice.trim());

    // An installed service whose server never answers still gets the notice,
    // before the timeout error ([[arch/cli/index.md#^cli-persist-health-check]]).
    await active?.dispose();
    active = undefined;
    const unansweredHome = path.join(host, "unanswered");
    vi.useFakeTimers();
    try {
      const pending = runPersist({ serve: false, targetHome: unansweredHome });
      await vi.advanceTimersByTimeAsync(15_000);
      const unanswered = await pending;
      expect(unanswered.code).toBe(1);
      expect(unanswered.stdout).toBe("");
      // The default home's config port, as the CLI built it for the check.
      const unansweredURL = healthServerURLs.at(-1)!;
      expect(new URL(unansweredURL).hostname).toBe("localhost");
      expect(unanswered.stderr).toBe(
        notice +
          `Television service installed, but the server did not respond at ${unansweredURL} within 15 seconds. The service remains installed. See ${path.join(unansweredHome, "logs", "tv.log")} for the cause.\n`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("telemetry control commands fail clearly when no server is running", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-cli-no-server-"));
    dirs.push(storagePath);
    const unreachablePort = 9;
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    writeHomeConfig(storagePath, { port: 0 });
    const exitCode = await runCLI(["--home", storagePath, "telemetry", "disable", "--port", String(unreachablePort)], { stdout, stderr });

    expect(exitCode).toBe(1);
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain(`Could not reach Television server at http://localhost:${unreachablePort}`);
  });

  it("tv skills install emits skill_installed without a running server and without path-like payloads", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-skills-"));
    const bundled = path.join(root, "bundled");
    const destination = path.join(root, ".claude", "skills");
    const storagePath = path.join(root, "storage");
    dirs.push(root);
    const sink = new RecordingTelemetrySink();
    const emit = async (options: SkillInstalledTelemetryOptions) => {
      return await emitSkillInstalledTelemetry({ ...options, env: TEST_TELEMETRY_ENV, sink });
    };
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n", { flag: "w" });

    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const exitCode = await runCLI(["--home", storagePath, "skills", "install", destination, "--installed-by-agent", " Claude Code "], {
      stdout,
      stderr,
      resolveBundledSkillsRoot: () => bundled,
      emitSkillInstalledTelemetry: emit,
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).toBe("");
    expectNoTelemetryMessaging(stdout.toString());
    expect(sink.events.map((event) => event.name)).toEqual(["skill_installed"]);
    expect(sink.events[0]?.properties).toMatchObject({
      agent_type: "claude",
      installed_by_agent: "claude code",
      server_version: REAL_CLI_VERSION,
    });
    expect(sink.events[0]?.properties).not.toHaveProperty("$session_id");
    const serialized = JSON.stringify(sink.events[0]);
    expect(serialized).not.toContain(destination);
    expect(serialized).not.toContain(bundled);
    expect((await readTelemetryState(storagePath))?.userId).toBe(sink.events[0]?.distinctId);

    sink.clear();
    const secondStdout = new BufferOutput();
    const secondExitCode = await runCLI(["--home", storagePath, "skills", "install", destination, "--installed-by-agent", " Claude Code "], {
      stdout: secondStdout,
      stderr: new BufferOutput(),
      resolveBundledSkillsRoot: () => bundled,
      emitSkillInstalledTelemetry: emit,
    });
    expect(secondExitCode).toBe(0);
    expectNoTelemetryMessaging(secondStdout.toString());
    expect(sink.events.map((event) => event.name)).toEqual(["skill_installed"]);
  });

  it("tv skills install -i emits only after installer success and emits no installer arguments", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-cli-skills-interactive-"));
    const bundled = path.join(root, "bundled");
    const storagePath = path.join(root, "storage");
    dirs.push(root);
    const sink = new RecordingTelemetrySink();
    const emit = async (options: SkillInstalledTelemetryOptions) => {
      return await emitSkillInstalledTelemetry({ ...options, env: TEST_TELEMETRY_ENV, sink });
    };
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n", { flag: "w" });

    const success = await runCLI(["--home", storagePath, "skills", "install", "-i", "--installed-by-agent", " Codex "], {
      stdout: new BufferOutput(),
      stderr: new BufferOutput(),
      resolveBundledSkillsRoot: () => bundled,
      runSkillsInstaller: async () => {},
      emitSkillInstalledTelemetry: emit,
    });
    expect(success).toBe(0);
    expect(sink.events.map((event) => event.name)).toEqual(["skill_installed"]);
    expect(sink.events[0]?.properties).toMatchObject({ agent_type: "interactive-install", installed_by_agent: "codex" });
    const serialized = JSON.stringify(sink.events[0]);
    expect(serialized).not.toContain("add");
    expect(serialized).not.toContain(bundled);

    sink.clear();
    const failure = await runCLI(["--home", storagePath, "skills", "install", "-i"], {
      stdout: new BufferOutput(),
      stderr: new BufferOutput(),
      resolveBundledSkillsRoot: () => bundled,
      runSkillsInstaller: async () => { throw new Error("installer failed"); },
      emitSkillInstalledTelemetry: emit,
    });
    expect(failure).toBe(1);
    expect(sink.events).toEqual([]);
  });

  it("built CLI reports telemetry control connection failures outside the repo tree", () => {
    const buildDir = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-cli-built-"));
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-cli-built-storage-"));
    dirs.push(buildDir, storagePath);
    writeHomeConfig(storagePath, { port: 0 });
    const outfile = path.join(buildDir, "tv.cjs");

    execFileSync(process.execPath, [path.join(REPO_ROOT, "packages", "cli", "build.mjs"), "--outfile", outfile], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });

    for (const action of ["disable", "enable"]) {
      const result = spawnSync(outfile, ["--home", storagePath, "telemetry", action, "--port", "9"], {
        cwd: buildDir,
        encoding: "utf8",
        env: { ...process.env, VITEST: "" },
      });

      expect(result.status, action).toBe(1);
      expect(result.stdout, action).toBe("");
      expect(result.stderr, action).toContain("Could not reach Television server at http://localhost:9");
    }
  });
});
