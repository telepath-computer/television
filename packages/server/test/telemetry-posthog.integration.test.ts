/**
 * OPT-IN HOST-MUTATING SUITE.
 *
 * The persisted-daemon cases register and remove a uniquely named real user
 * service through launchd or systemd. Run them only through
 * `npm test -- local --suite telemetry-posthog-roundtrip`, with the PostHog
 * test read key available, on a host where real service installation is safe.
 * The asserted teardown path is `tv stop`; direct Daemon.uninstall() remains
 * only as failure cleanup so an interrupted assertion cannot leak a service.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Daemon } from "@rupertsworld/daemon";
import WebSocket from "ws";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  TELEMETRY_ACTIVITY_MESSAGE_TYPE,
  TELEVISION_CLIENT_META_HEADER,
} from "@telepath-computer/television-shared";
import { runCLI } from "../../cli/src/index.ts";
import {
  POSTHOG_TEST_PROJECT,
  assertPostHogIntegrationProjectIsSafe,
  resolvePostHogProject,
} from "../src/telemetry/posthog-config.ts";
import { createPostHogTransport, createTelemetrySink, type TelemetrySink } from "../src/telemetry/sink.ts";
import { isDoNotTrackEnabled, readTelemetryState } from "../src/telemetry/identity.ts";
import { createUUIDv7 } from "../src/telemetry/sessions.ts";
import {
  Server,
  ServerStore,
  telemetryVersion,
  type BuiltTelemetryEvent,
  type TelemetryEnv,
} from "../src/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

loadDotEnv();
if (isDoNotTrackEnabled(process.env.CI) || isDoNotTrackEnabled(process.env.DO_NOT_TRACK)) throw new Error("Live telemetry tests refuse CI or DO_NOT_TRACK");

const REPO_ROOT = findRepoRoot(import.meta.dirname);
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PERSISTED_DAEMON_CLI_DRIVER = path.join(import.meta.dirname, "fixtures", "persisted-daemon-cli-driver.ts");
const readKey = requirePostHogTestReadKey();
const SESSION_EVENT_GAP_MS = 2_000;
const PERSISTED_DAEMON_CLI_TIMEOUT_MS = 60_000;
const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const HTTP_CREATED = 201;
const HTTP_OK = 200;
const CHROME_LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const FRESH_INSTALL_LIFECYCLE = [
  { event: "server_installed", preTelemetry: null, oldVersion: null, newVersion: null },
];

class BufferOutput {
  private readonly chunks: string[] = [];
  write(chunk: string | Uint8Array): void { this.chunks.push(String(chunk)); }
  toString(): string { return this.chunks.join(""); }
}

function loadDotEnv(): void {
  const envPath = path.join(findRepoRoot(process.cwd()), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/.exec(trimmed);
    if (!match?.groups) continue;
    if (process.env[match.groups.key] !== undefined) continue;
    process.env[match.groups.key] = stripEnvQuotes(match.groups.value.trim());
  }
}

function findRepoRoot(start: string): string {
  let current = start;
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
        if (packageJson.name === "television-monorepo") return current;
      } catch {
        // Keep walking upward.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function stripEnvQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function requirePostHogTestReadKey(): string {
  const value = process.env.TV_POSTHOG_TEST_READ_KEY?.trim();
  if (value?.startsWith("phx_")) return value;
  throw new Error("TV_POSTHOG_TEST_READ_KEY must be set to the PostHog test project read key. Run via `npm test -- local --suite telemetry-posthog-roundtrip` so the posthog-test-key preflight checks this before Vitest starts.");
}

function builtEvent(
  name: BuiltTelemetryEvent["name"],
  distinctId: string,
  properties: Omit<BuiltTelemetryEvent["properties"], "distinct_id"> = {},
): BuiltTelemetryEvent {
  return {
    name,
    distinctId,
    properties: {
      distinct_id: distinctId,
      ...properties,
    },
  };
}

// With authentication on, `tv serve --persist` creates the home's token and
// empty storage directories before it installs the service, so the daemon's
// first boot finds storage the parent CLI created. That boot must still classify the
// data as fresh. Without authentication the parent creates no token, and the
// daemon creates the storage itself. Both installs must land exactly one
// server_installed lifecycle event in the sandbox PostHog project.
// The test driver injects a replacement createDaemon to select an isolated
// service name and source-CLI command. From runCLI's call to the returned
// daemon onward, the test crosses the real Daemon → service manager → daemon
// boot → PostHog path. After the telemetry assertion, the driver invokes
// `tv stop` against the same test-scoped daemon and proves real deregistration
// as suite hygiene; this test claims no CLI spine coverage. The telemetry
// lifecycle coverage is declared by
// [[product/telemetry.md#^ac-persist-auth-install]].
// Each install starts from a home whose config file is written before the
// first serving boot ([[product/telemetry.md#^tel-ac-persist-config-home]]).
describe("persisted daemon fresh-install classification (^t-persist-auth-install)", () => {
  it("installs and stops a daemon that creates storage without parent token pre-creation", async () => {
    await installPersistedDaemonAssertTelemetryAndStop({ config: { auth: false } });
  }, 240_000);

  it("installs and stops a persisted-auth daemon whose storage the parent CLI created with the token", async () => {
    await installPersistedDaemonAssertTelemetryAndStop({
      config: { installedByAgent: " Claude Code " },
      expectedInstalledByAgent: "claude code",
    });
  }, 240_000);
});

describe("PostHog telemetry integration", () => {
  it("lands an event in the test project with enumerated properties intact", async () => {
    assertPostHogIntegrationProjectIsSafe(POSTHOG_TEST_PROJECT.projectId);
    const distinctId = `tv-phase1-event-${randomUUID()}`;
    const testSink = createTelemetrySink({
      autoFlush: false,
      maxBufferSize: 4,
      transport: createPostHogTransport({ project: POSTHOG_TEST_PROJECT }),
    });
    testSink.enqueue(builtEvent("server_started", distinctId, {
      auth_mode: "auth",
      port: "default",
      server_version: telemetryVersion("0.1.170"),
    }));
    await testSink.flush();
    expect(testSink.pendingCount()).toBe(0);

    const eventRow = await pollPostHog(async () => {
      const rows = await hogql<[string, Record<string, unknown>]>(`
        SELECT event, properties
        FROM events
        WHERE distinct_id = ${hogqlString(distinctId)} AND event = 'server_started'
        ORDER BY timestamp DESC
        LIMIT 1
      `);
      return rows[0] ?? null;
    });

    const properties = normalizePostHogProperties(eventRow[1]);
    expect(eventRow[0]).toBe("server_started");
    expect(properties.auth_mode).toBe("auth");
    expect(properties.port).toBe("default");
    expect(properties.server_version).toBe("0.1.170");
    expectPrivatePostHogProperties(properties);
  }, 120_000);

  it("groups $session_id-stamped events in a PostHog native session", async () => {
    assertPostHogIntegrationProjectIsSafe(POSTHOG_TEST_PROJECT.projectId);
    const distinctId = `tv-phase4-session-${randomUUID()}`;
    const sessionId = createUUIDv7(Date.now());
    const sink = createTelemetrySink({
      autoFlush: false,
      maxBufferSize: 4,
      transport: createPostHogTransport({ project: POSTHOG_TEST_PROJECT }),
    });

    sink.enqueue(builtEvent("session_activity", distinctId, {
      $session_id: sessionId,
      server_version: telemetryVersion("0.1.170"),
      client_app: "browser",
      client_platform: "linux",
      browser_vendor: "chrome",
      browser_major_version: 123,
    }));
    await sink.flush();
    await delay(SESSION_EVENT_GAP_MS);
    sink.enqueue(builtEvent("screen_created", distinctId, { $session_id: sessionId, total_screens: 1, total_artifacts: 0 }));
    await sink.flush();
    expect(sink.pendingCount()).toBe(0);

    const session = await pollPostHog(async () => {
      const rows = await hogql<[string, number]>(`
        SELECT session_id, duration
        FROM sessions
        WHERE distinct_id = ${hogqlString(distinctId)} AND session_id = ${hogqlString(sessionId)}
        LIMIT 1
      `);
      const row = rows[0] ?? null;
      return row && row[1] > 0 ? row : null;
    });

    expect(session[0]).toBe(sessionId);
    expect(session[1]).toBeGreaterThan(0);
  }, 120_000);

  it("round-trips $set person properties through PostHog current state", async () => {
    assertPostHogIntegrationProjectIsSafe(POSTHOG_TEST_PROJECT.projectId);
    const distinctId = `tv-phase1-set-${randomUUID()}`;
    const sink = createTelemetrySink({
      autoFlush: false,
      maxBufferSize: 4,
      transport: createPostHogTransport({ project: POSTHOG_TEST_PROJECT }),
    });
    const personProperties = {
      auth_mode: "no-auth" as const,
      port: "custom" as const,
      total_screens: 3,
      total_artifacts: 8,
      median_artifacts_per_screen: 2,
      average_artifacts_per_screen: 2.67,
    };

    sink.enqueue(builtEvent("server_started", distinctId, {
      server_version: telemetryVersion("0.1.170"),
      $set: personProperties,
    }));
    await sink.flush();
    expect(sink.pendingCount()).toBe(0);

    const person = await pollPostHog(async () => {
      const results = await fetchPostHogPersons(distinctId);
      return results.find((candidate) => candidateMatchesDistinctId(candidate, distinctId)
        && candidate.properties.auth_mode === "no-auth"
        && candidate.properties.total_screens === 3) ?? null;
    });

    expect(person.properties).toMatchObject(personProperties);
    expectPrivatePostHogProperties(person.properties);
  }, 120_000);

  it("runs the real server telemetry saga against the PostHog test project", async () => {
    assertPostHogIntegrationProjectIsSafe(POSTHOG_TEST_PROJECT.projectId);
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-posthog-saga-storage-"));
    const targetPath = mkdtempSync(path.join(os.tmpdir(), "television-posthog-saga-target-"));
    const servers: Server[] = [];
    let active: SagaHarness | null = null;

    try {
      active = await startSagaServer(storagePath, servers);
      await flushTelemetry(active.sink);
      const initialState = await readTelemetryState(storagePath);
      expect(initialState?.userId).toEqual(expect.any(String));
      const distinctId = initialState!.userId;

      await runSagaCLI(active, ["telemetry", "disable"]);
      await flushTelemetry(active.sink);
      expect(await readTelemetryState(storagePath)).toMatchObject({ userId: distinctId, optedOut: true });

      await postSagaJSON(active, "/channels", { name: "Suppressed PostHog Saga Screen" }, HTTP_CREATED);
      await flushTelemetry(active.sink);

      await runSagaCLI(active, ["telemetry", "enable"]);
      expect(await readTelemetryState(storagePath)).toMatchObject({ userId: distinctId, optedOut: false });

      const channelStdout = await runSagaCLI(active, ["create-channel", "--name", "PostHog Saga Screen", "--no-focus"]);
      const channelId = parseCreatedChannelId(channelStdout);
      await flushTelemetry(active.sink);

      const artifactPath = path.join(targetPath, "posthog-saga.md");
      writeFileSync(artifactPath, "# PostHog saga fixture\n", "utf8");
      const artifactStdout = await runSagaCLI(active, [
        "create-path-artifact",
        "--channel", channelId,
        "--title", "PostHog Saga Artifact",
        "--path", artifactPath,
        "--no-focus",
      ]);
      const artifactId = parseCreatedArtifactId(artifactStdout);
      const secondArtifactPath = path.join(targetPath, "posthog-saga-second.md");
      writeFileSync(secondArtifactPath, "# Second PostHog saga fixture\n", "utf8");
      const secondArtifactStdout = await runSagaCLI(active, [
        "create-path-artifact",
        "--channel", channelId,
        "--title", "Second PostHog Saga Artifact",
        "--path", secondArtifactPath,
        "--no-focus",
      ]);
      const secondArtifactId = parseCreatedArtifactId(secondArtifactStdout);
      await flushTelemetry(active.sink);

      await active.server.dispose();
      active = await startSagaServer(storagePath, servers);
      await flushTelemetry(active.sink);
      expect(await readTelemetryState(storagePath)).toMatchObject({ userId: distinctId, optedOut: false });

      const browserClientId = `posthog-saga-browser-${randomUUID()}`;
      const socket = await openActivitySocket(active, browserClientId);
      try {
        const pendingBeforeActivity = active.sink.pendingCount();
        socket.send(JSON.stringify({ type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: browserClientId }));
        await expect.poll(() => active?.sink.pendingCount() ?? 0, { timeout: 5_000 }).toBeGreaterThan(pendingBeforeActivity);
        await flushTelemetry(active.sink);

        await patchSagaJSON(
          active,
          `/channels/${encodeURIComponent(channelId)}`,
          {
            layout: [
              {
                artifactIds: [secondArtifactId],
                geometry: DEFAULT_PAGE_GEOMETRY,
                size: DEFAULT_PAGE_SIZE,
              },
              {
                artifactIds: [artifactId],
                geometry: DEFAULT_PAGE_GEOMETRY,
                size: DEFAULT_PAGE_SIZE,
              },
            ],
          },
          browserTelemetryHeaders(browserClientId),
          HTTP_OK,
        );
        await flushTelemetry(active.sink);
      } finally {
        await closeSocket(socket);
      }

      await active.server.dispose();
      active = null;

      const events = await pollPostHog(async () => {
        const rows = await fetchPostHogEvents(distinctId);
        return sagaEventsPresent(rows) ? rows : null;
      });

      expect(events.every((event) => event.distinctId === distinctId)).toBe(true);
      expect(events.filter((event) => event.event === "server_installed")).toHaveLength(1);
      expect(events.filter((event) => event.event === "server_started")).toHaveLength(2);
      expect(events.filter((event) => event.event === "screen_created")).toHaveLength(1);
      expect(findPostHogEvent(events, "screen_created", (properties) => properties.total_screens === 2)).toBeUndefined();

      const started = expectPostHogEvent(events, "server_started", (properties) => properties.installed_by_agent === "openclaw");
      expect(started.properties).toMatchObject({
        server_version: TEST_VERSION,
        auth_mode: "auth",
        binds_loopback: true,
        port: "custom",
        storage_path: "custom",
        launch_mode: "cli",
      });

      const optOut = expectPostHogEvent(events, "telemetry_opted_out");
      expect(optOut.properties.distinct_id).toBe(distinctId);
      expect(optOut.properties.$set).toMatchObject({ telemetry_opted_out: true });

      const landedChannel = expectPostHogEvent(events, "screen_created", (properties) => properties.total_screens === 3);
      expect(landedChannel.properties).toMatchObject({
        total_screens: 3,
        total_artifacts: 0,
        $set: expect.objectContaining({ telemetry_opted_out: false }),
      });
      expect(landedChannel.properties).not.toHaveProperty("$session_id");

      const artifact = expectPostHogEvent(events, "artifact_created");
      expect(artifact.properties).toMatchObject({
        artifact_kind: "path",
        path_kind: "file",
        path_file_type: "markdown",
        total_screens: 3,
        total_artifacts: 1,
      });
      expect(artifact.properties).not.toHaveProperty("$session_id");

      const activity = expectPostHogEvent(events, "session_activity");
      expect(activity.properties).toMatchObject({
        server_version: TEST_VERSION,
        client_app: "browser",
        client_platform: "linux",
        browser_vendor: "chrome",
        browser_major_version: 123,
      });
      const sessionId = activity.properties.$session_id;
      expect(sessionId).toEqual(expect.any(String));

      const layout = expectPostHogEvent(events, "layout_changed");
      expect(layout.properties).toMatchObject({ change_type: "tab_reorder", $session_id: sessionId });

      const person = await pollPostHog(async () => {
        const results = await fetchPostHogPersons(distinctId);
        return results.find((candidate) => candidateMatchesDistinctId(candidate, distinctId)
          && candidate.properties.telemetry_opted_out === false
          && candidate.properties.total_screens === 3
          && candidate.properties.total_artifacts === 2) ?? null;
      });
      expect(person.properties.telemetry_opted_out).toBe(false);
      expect(person.properties).toMatchObject({
        total_screens: 3,
        total_artifacts: 2,
        installed_by_agent: "openclaw",
      });
    } finally {
      if (active) await active.server.dispose();
      for (const server of servers.reverse()) await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(targetPath, { recursive: true, force: true });
    }
  }, 240_000);
});

interface PersistedDaemonCLIResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

async function installPersistedDaemonAssertTelemetryAndStop(input: {
  /** Config file settings besides the port; authentication is on unless it sets `"auth": false`. */
  config: Record<string, unknown>;
  expectedInstalledByAgent?: string;
}): Promise<void> {
  assertPostHogIntegrationProjectIsSafe(POSTHOG_TEST_PROJECT.projectId);
  expect(resolvePostHogProject({ TV_TELEMETRY_TEST: "1" })).toBe(POSTHOG_TEST_PROJECT);

  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-posthog-persist-storage-"));
  const tokenPath = path.join(storagePath, "state", "token");
  const daemonName = `com.television.server.telemetry-${randomUUID()}`;
  const port = await allocateClosedLoopbackPort();
  const environment = persistedDaemonTestEnvironment(daemonName);
  const cleanupDaemon = new Daemon({
    name: daemonName,
    description: "Television telemetry persisted-install acceptance fixture",
    command: process.execPath,
    args: [],
  });
  let cliUninstallVerified = false;

  try {
    writeFileSync(path.join(storagePath, "config.json"), `${JSON.stringify({ port, ...input.config })}\n`);
    const install = await runPersistedDaemonCLI(["--home", storagePath, "serve", "--persist"], environment);

    expect(install.exitCode).toBe(0);
    expect(install.signal).toBeNull();
    expect(install.stderr).toBe("");
    expect(install.stdout).toContain("Television service installed.");
    if (input.config.auth !== false) expect(existsSync(tokenPath)).toBe(true);

    const state = await pollTelemetryState(storagePath);
    const events = await pollPostHog(async () => {
      const rows = await fetchPostHogEvents(state.userId);
      const hasStart = findPostHogEvent(rows, "server_started") !== undefined;
      const hasLifecycle = rows.some((event) => event.event === "server_installed" || event.event === "server_upgraded");
      return hasStart && hasLifecycle ? rows : null;
    });
    const lifecycle = events
      .filter((event) => event.event === "server_installed" || event.event === "server_upgraded")
      .map((event) => ({
        event: event.event,
        preTelemetry: event.properties.pre_telemetry ?? null,
        oldVersion: event.properties.old_version ?? null,
        newVersion: event.properties.new_version ?? null,
      }));

    expect(await cleanupDaemon.status()).toEqual({ installed: true, running: true });
    expect(lifecycle, `Observed lifecycle: ${JSON.stringify(lifecycle)}`).toEqual(FRESH_INSTALL_LIFECYCLE);
    if (input.expectedInstalledByAgent !== undefined) {
      expect(findPostHogEvent(events, "server_started")?.properties.installed_by_agent).toBe(input.expectedInstalledByAgent);
    }

    const uninstall = await runPersistedDaemonCLI(["--home", storagePath, "stop"], environment);
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.signal).toBeNull();
    expect(uninstall.stderr).toBe("");
    expect(uninstall.stdout).toBe(`${JSON.stringify({ status: "stopped" })}\n`);
    expect(await cleanupDaemon.status()).toEqual({ installed: false, running: false });
    cliUninstallVerified = true;
  } finally {
    if (!cliUninstallVerified) await cleanupDaemon.uninstall();
    rmSync(storagePath, { recursive: true, force: true });
  }
}

async function runPersistedDaemonCLI(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<PersistedDaemonCLIResult> {
  const child = spawn(process.execPath, [TSX_CLI, PERSISTED_DAEMON_CLI_DRIVER, ...argv], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

  return await new Promise<PersistedDaemonCLIResult>((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, PERSISTED_DAEMON_CLI_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Timed out waiting for persisted-daemon CLI\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
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

function persistedDaemonTestEnvironment(daemonName: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITEST: "true",
    TV_TELEMETRY_TEST: "1",
    TV_TEST_DAEMON_NAME: daemonName,
  };
  delete env.TELEVISION_ACP_AGENT;
  return env;
}

async function pollTelemetryState(storagePath: string): Promise<NonNullable<Awaited<ReturnType<typeof readTelemetryState>>>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await readTelemetryState(storagePath);
    if (state) return state;
    await delay(50);
  }
  throw new Error(`Timed out waiting for daemon telemetry state under ${storagePath}.`);
}

async function hogql<Row>(query: string): Promise<Row[]> {
  const response = await fetch(new URL(`/api/projects/${POSTHOG_TEST_PROJECT.projectId}/query/`, POSTHOG_TEST_PROJECT.apiHost), {
    method: "POST",
    headers: {
      authorization: `Bearer ${readKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: `${query}\n-- telemetry integration poll ${Date.now()} ${Math.random()}` } }),
  });
  if (!response.ok) throw new Error(`PostHog HogQL failed with HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json() as { results?: Row[] };
  return body.results ?? [];
}

interface PostHogPerson {
  id?: number | string;
  distinct_ids?: string[];
  properties: Record<string, unknown>;
}

async function fetchPostHogPersons(distinctId: string): Promise<PostHogPerson[]> {
  const url = new URL(`/api/projects/${POSTHOG_TEST_PROJECT.projectId}/persons/`, POSTHOG_TEST_PROJECT.apiHost);
  url.searchParams.set("search", distinctId);
  const response = await fetch(url, { headers: { authorization: `Bearer ${readKey}` } });
  if (!response.ok) throw new Error(`PostHog persons query failed with HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json() as { results?: PostHogPerson[] };
  return body.results ?? [];
}

interface SagaHarness {
  server: Server;
  store: ServerStore;
  sink: TelemetrySink;
  storagePath: string;
}

interface PostHogEventRow {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

async function startSagaServer(storagePath: string, servers: Server[]): Promise<SagaHarness> {
  // The home's config file sets port 0, so saga CLI commands pass the bound port.
  writeFileSync(path.join(storagePath, "config.json"), `${JSON.stringify({ port: 0 })}\n`);
  const store = createServingStore(storagePath);
  const sink = createTelemetrySink({
    autoFlush: false,
    maxBufferSize: 100,
    transport: createPostHogTransport({ project: POSTHOG_TEST_PROJECT }),
  });
  const server = new Server({
    store,
    host: LOOPBACK_HOST,
    port: EPHEMERAL_PORT,
    auth: true,
    telemetry: {
      env: TEST_TELEMETRY_ENV,
      sink,
      version: TEST_VERSION,
      launchMode: "cli",
      installedByAgent: " OpenClaw ",
    },
  });
  await server.start();
  servers.push(server);
  return { server, store, sink, storagePath };
}

async function flushTelemetry(sink: TelemetrySink): Promise<void> {
  await sink.flush();
  expect(sink.pendingCount()).toBe(0);
}

async function runSagaCLI(harness: SagaHarness, argv: string[]): Promise<string> {
  const stdout = new BufferOutput();
  const stderr = new BufferOutput();
  const port = new URL(harness.server.getBaseURL()).port;
  const exitCode = await runCLI(["--home", harness.storagePath, ...argv, "--port", port], { stdout, stderr });
  expect(stderr.toString()).toBe("");
  expect(exitCode).toBe(0);
  return stdout.toString();
}

async function postSagaJSON(
  harness: SagaHarness,
  pathname: string,
  body: Record<string, unknown>,
  expectedStatus: number,
): Promise<unknown> {
  return await sendSagaJSON(harness, "POST", pathname, body, {}, expectedStatus);
}

async function patchSagaJSON(
  harness: SagaHarness,
  pathname: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  expectedStatus: number,
): Promise<unknown> {
  return await sendSagaJSON(harness, "PATCH", pathname, body, headers, expectedStatus);
}

async function sendSagaJSON(
  harness: SagaHarness,
  method: "POST" | "PATCH",
  pathname: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  expectedStatus: number,
): Promise<unknown> {
  const response = await fetch(new URL(pathname, harness.server.getBaseURL()), {
    method,
    headers: {
      authorization: `Bearer ${harness.store.authToken}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(expectedStatus);
  if (response.status === 204) return null;
  return await response.json() as unknown;
}

function browserTelemetryHeaders(clientId: string): Record<string, string> {
  return {
    [TELEVISION_CLIENT_META_HEADER]: JSON.stringify({
      clientId,
      clientApp: "browser",
      userAgent: CHROME_LINUX_UA,
    }),
  };
}

async function openActivitySocket(harness: SagaHarness, clientId: string): Promise<WebSocket> {
  const url = new URL("/events", harness.server.getBaseURL());
  url.protocol = "ws:";
  url.searchParams.set("token", harness.store.authToken);
  url.searchParams.set("clientId", clientId);
  url.searchParams.set("clientApp", "browser");
  url.searchParams.set("userAgent", CHROME_LINUX_UA);
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

function parseCreatedChannelId(stdout: string): string {
  const match = /^Channel created: (?<id>\S+) /m.exec(stdout);
  if (!match?.groups?.id) throw new Error(`Could not parse created channel id from stdout: ${stdout}`);
  return match.groups.id;
}

function parseCreatedArtifactId(stdout: string): string {
  const match = /^Path artifact (?<id>\S+) created\./m.exec(stdout);
  if (!match?.groups?.id) throw new Error(`Could not parse created artifact id from stdout: ${stdout}`);
  return match.groups.id;
}

async function fetchPostHogEvents(distinctId: string): Promise<PostHogEventRow[]> {
  const rows = await hogql<[string, string, Record<string, unknown> | string, string]>(`
    SELECT event, distinct_id, properties, timestamp
    FROM events
    WHERE distinct_id = ${hogqlString(distinctId)}
    ORDER BY timestamp ASC
    LIMIT 100
  `);
  return rows.map(([event, eventDistinctId, properties, timestamp]) => ({
    event,
    distinctId: eventDistinctId,
    properties: normalizePostHogProperties(properties),
    timestamp,
  }));
}

function sagaEventsPresent(events: PostHogEventRow[]): boolean {
  return events.filter((event) => event.event === "server_started").length >= 2 &&
    findPostHogEvent(events, "server_installed") !== undefined &&
    findPostHogEvent(events, "telemetry_opted_out") !== undefined &&
    findPostHogEvent(events, "screen_created", (properties) => properties.total_screens === 3) !== undefined &&
    findPostHogEvent(events, "artifact_created", (properties) => properties.artifact_kind === "path" && properties.total_artifacts === 1) !== undefined &&
    findPostHogEvent(events, "session_activity", (properties) => properties.client_app === "browser" && typeof properties.$session_id === "string") !== undefined &&
    findPostHogEvent(events, "layout_changed", (properties) => properties.change_type === "tab_reorder" && typeof properties.$session_id === "string") !== undefined;
}

function findPostHogEvent(
  events: PostHogEventRow[],
  eventName: string,
  predicate: (properties: Record<string, unknown>) => boolean = () => true,
): PostHogEventRow | undefined {
  return events.find((event) => event.event === eventName && predicate(event.properties));
}

function expectPostHogEvent(
  events: PostHogEventRow[],
  eventName: string,
  predicate?: (properties: Record<string, unknown>) => boolean,
): PostHogEventRow {
  const event = findPostHogEvent(events, eventName, predicate);
  expect(event, `Expected PostHog event ${eventName}`).toBeDefined();
  return event!;
}

function normalizePostHogProperties(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value;
}

function candidateMatchesDistinctId(candidate: PostHogPerson, distinctId: string): boolean {
  return candidate.distinct_ids?.includes(distinctId) ?? false;
}

function hogqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollPostHog<T>(probe: () => Promise<T | null>): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 90_000) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for PostHog ingestion.");
}

// proofs/arch/telemetry/sink.md#^t-posthog-lands and #^tel-t-posthog-person
function expectPrivatePostHogProperties(properties: Record<string, unknown>): void {
  expect([undefined, null, "", "0.0.0.0"]).toContain(properties.$ip);
  expect(Object.keys(properties).filter((key) =>
    (key.startsWith("$geoip_") && key !== "$geoip_disable") || key.startsWith("$initial_geoip_"),
  )).toEqual([]);
}
