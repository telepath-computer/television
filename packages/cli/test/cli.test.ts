import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RequestError, TelevisionClient } from "@telepath-computer/television-shared";
import { PORT_ZERO_WARNING, listVisibleCLICommandNames, runCLI as runRawCLI, type CLIEnvironment } from "../src/index.ts";

class BufferOutput {
  chunks: string[] = [];
  write(chunk: string | Uint8Array): void { this.chunks.push(String(chunk)); }
  toString(): string { return this.chunks.join(""); }
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL_POINTER = "Television ships bundled skills.";
// The retired-options guidance after its first sentence, as specs/product/cli.md
// (^cli-retired-options) states it. The first sentence names the options given.
const RETIRED_OPTIONS_GUIDANCE = [
  "Server settings and the storage directory are no longer command options:",
  "",
  "  --port <number>              ->  tv config set port <number>",
  "  --listen <ipv4>[,<ipv4>...]  ->  tv config set listen <ipv4>[,<ipv4>...]",
  "  --auth                       ->  tv config set auth true (the default)",
  "  --no-auth                    ->  tv config set auth false",
  "  --installed-by-agent <name>  ->  tv config set installedByAgent <name>",
  "  --storage-path <path>        ->  tv --home <path> <command>, or write <path> into ~/.tv-home",
  "",
  "tv config set writes the config file in the Television home. For a home other than the default, put --home <path> before the command name, as in tv --home <path> config set port <number>.",
  "After changing settings, rerun tv serve --persist to update an installed service.",
  "The administrator guide covers the full upgrade and is written for your agent to carry out: https://television.run/install.md",
].join("\n");
const RETIRED_SERVICE_RECORD = "service runs from a retired service definition";
// The legacy-variable warning, as specs/product/cli.md (^cli-legacy-selectors) states it.
const LEGACY_VARIABLES_WARNING = "WARNING: TELEVISION_PORT or TELEVISION_STORAGE_PATH is set in this environment, and Television no longer uses either. Set the server's port with tv config set port <number>. Television uses the home given with tv --home <path> <command>, otherwise the path written in ~/.tv-home, otherwise ~/.television.";
/*
 * This file carries the in-process contract breadth declared throughout
 * [[arch/cli/index.md]]: [[arch/cli/index.md#^e8a5216c|visible commands]],
 * [[arch/cli/index.md#^723f3673|help]], [[arch/cli/index.md#^99e06341|version]],
 * [[arch/cli/index.md#^37bb8262|parser errors]], [[arch/cli/index.md#^cf207a25|exact argv]],
 * [[arch/cli/index.md#^cli-port-parsing|ports]], [[arch/cli/index.md#^2b573706|display client calls]],
 * [[arch/cli/index.md#^c0ba6801|token files]], [[arch/cli/index.md#^72e143f1|output]],
 * [[arch/cli/index.md#^cli-set-theme-transition-contract|theme transitions]],
 * [[arch/cli/index.md#^cli-client-port-contract|client ports]], [[arch/cli/index.md#^56974173|channels]],
 * [[arch/cli/index.md#^acdde6ff|path artifacts]], [[arch/cli/index.md#^c04a4452|updates]],
 * [[arch/cli/index.md#^ca07204f|deletion output]], [[arch/cli/index.md#^2b573706|display]],
 * [[arch/cli/index.md#^be9f1ee3|serve]], [[arch/cli/index.md#^71914b4f|serve validation]],
 * [[arch/cli/index.md#^b514f2fe|persist]], [[arch/cli/index.md#^e311cbd2|uninstall]], and
 * [[arch/cli/index.md#^96862252|status]]. Individual tests cite further focused refs.
 */

type SkillInstallTelemetryOptions = Parameters<CLIEnvironment["emitSkillInstalledTelemetry"]>[0];

function telemetryFields(options: SkillInstallTelemetryOptions): Omit<SkillInstallTelemetryOptions, "env"> {
  const { env: _env, ...fields } = options;
  return fields;
}

function readLogRecords(storagePath: string): Array<Record<string, any>> {
  const logPath = path.join(storagePath, "logs", "tv.log");
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Asserts stderr is exactly the retired-options guidance naming `options`,
 * followed by the one-line help pointer.
 */
function expectRetiredOptionsGuidance(stderr: string, options: string[], label: string): void {
  const guidance = `This version of Television does not accept ${options.join(", ")}. ${RETIRED_OPTIONS_GUIDANCE}`;
  expect(stderr.startsWith(`${guidance}\n${SKILL_POINTER}`), `${label}\n${stderr}`).toBe(true);
  expect(stderr.slice(guidance.length + 1).split("\n"), label).toHaveLength(2);
}

// Each invocation gets its own temporary operating-system home unless the test
// supplies one, so a command given no --home selects a default home that the
// test owns. No case reads or writes the operator's ~/.tv-home or ~/.television.
async function runCLI(argv: string[], environment: Partial<CLIEnvironment> = {}): Promise<number> {
  if (environment.resolveHomeDir !== undefined) return runRawCLI(argv, environment);

  const operatingSystemHome = mkdtempSync(path.join(os.tmpdir(), "television-cli-os-home-"));
  try {
    return await runRawCLI(argv, { ...environment, resolveHomeDir: () => operatingSystemHome });
  } finally {
    rmSync(operatingSystemHome, { recursive: true, force: true });
  }
}

const temporaryDirectories: string[] = [];
afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** A temporary Television home, with `config.json` holding `config` when given (an object is written as JSON). */
function temporaryHome(config?: Record<string, unknown> | string): string {
  const home = temporaryDirectory("television-cli-home-");
  if (config !== undefined) writeConfig(home, config);
  return home;
}

function writeConfig(home: string, config: Record<string, unknown> | string): string {
  const configPath = path.join(home, "config.json");
  writeFileSync(configPath, typeof config === "string" ? config : JSON.stringify(config));
  return configPath;
}

function writeToken(home: string, token: string): void {
  mkdirSync(path.join(home, "state"), { recursive: true });
  writeFileSync(path.join(home, "state", "token"), token);
}

function fakeEnvironment(overrides: Partial<CLIEnvironment> = {}): Partial<CLIEnvironment> {
  const client = {
    artifacts: {
      create: vi.fn(async (input: any) => ({ artifact: { id: "artifact-1", title: input.title, ...(input.kind === "path" ? { kind: "path", path: input.path } : { kind: "url", url: input.url }) } })),
      update: vi.fn(async () => ({ artifact: { id: "artifact-1", kind: "path", title: "Updated", path: "/tmp/a.html" } })),
      delete: vi.fn(async () => ({ outcome: "deleted", kind: "path", artifactID: "artifact-1", path: "/tmp/a.html" })),
      get: vi.fn(async () => ({ artifact: { id: "artifact-1", kind: "path", title: "A", path: "/tmp/a.html" } })),
      list: vi.fn(async () => ({ artifacts: [] })),
    },
    display: { focus: vi.fn(async () => ({ channelID: "screen-1", artifactID: "artifact-1" })), patch: vi.fn(async () => {}), get: vi.fn(async () => ({ focusedChannelId: null, pinnedChannelIds: [], activeThemeName: null, acpEnabled: false })) },
    themes: { list: vi.fn(async () => ({ themes: [], errors: [] })), refresh: vi.fn(async () => ({ themes: [], errors: [] })) },
    channels: { create: vi.fn(async () => ({ channel: { id: "screen-1", name: "S", layout: [] } })), update: vi.fn(async () => ({ channel: { id: "screen-1", name: "Updated", layout: [] } })), list: vi.fn(async () => ({ channels: [] })), get: vi.fn(async () => ({ channel: { id: "screen-1", name: "S", layout: [] }, artifacts: [] })), remove: vi.fn(async () => ({ channelID: "screen-1", metadataPath: "/state/channels/screen-1.json", artifactResults: [] })) },
    telemetry: {
      status: vi.fn(async () => ({ state: "active", reason: null, guidPresent: true, region: "us" })),
      disable: vi.fn(async () => ({ state: "opted-out", reason: null, guidPresent: true, region: "us" })),
      enable: vi.fn(async () => ({ state: "active", reason: null, guidPresent: true, region: "us" })),
    },
    health: vi.fn(async () => ({ status: "ok", bindAddresses: ["127.0.0.1"], port: 32848 })),
  };
  return {
    createClient: vi.fn(() => client as any),
    createServer: vi.fn(() => ({ start: vi.fn(async function (this: any) { return this; }), dispose: vi.fn(async () => {}), getBaseURL: vi.fn(() => "http://127.0.0.1:3000"), getBaseURLs: vi.fn(() => ["http://127.0.0.1:3000"]), getAuthToken: vi.fn(() => "token") }) as any),
    createDaemon: vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: vi.fn(async () => ({ installed: false, running: false })) })),
    resolveStaticDir: () => undefined,
    resolveCanonicalDir: () => undefined,
    resolveBundledViewsPath: () => undefined,
    resolveOnboardingContentPath: () => undefined,
    resolveBundledThemesPath: () => undefined,
    resolveBundledSkillsRoot: () => undefined,
    runSkillsInstaller: vi.fn(async () => {}),
    emitSkillInstalledTelemetry: vi.fn(async () => {}),
    onSignal: vi.fn(),
    ...overrides,
  };
}

describe("CLI connect links", () => {
  // Contract peers for ^cli-links-contract and ^cli-osc8-visible. Real HTTP,
  // process output and daemon installation are covered by the product walks.
  function peers() {
    const authenticated = fakeEnvironment().createClient!("http://localhost:43123");
    const unauthenticated = fakeEnvironment().createClient!("http://localhost:43123");
    const health = vi.spyOn(authenticated, "health").mockResolvedValue({ status: "ok", bindAddresses: ["127.0.0.1"], port: 43123 });
    const authenticatedGet = vi.spyOn(authenticated.display, "get");
    const unauthenticatedGet = vi.spyOn(unauthenticated.display, "get");
    const createClient = vi.fn<CLIEnvironment["createClient"]>()
      .mockReturnValueOnce(authenticated)
      .mockReturnValueOnce(unauthenticated);
    return { createClient, health, authenticatedGet, unauthenticatedGet };
  }

  const unauthorized = () => new RequestError("Unauthorized", { serverURL: "http://localhost:43123", status: 401 });

  // [[arch/cli/index.md#^cli-links-contract]]
  it("exposes links in help and refuses --server before contacting a server", async () => {
    expect(listVisibleCLICommandNames()).toContain("links");
    const stdout = new BufferOutput();
    expect(await runCLI(["--help"], fakeEnvironment({ stdout, stderr: new BufferOutput() }))).toBe(0);
    expect(stdout.toString()).toMatch(/\n\s+links\b/);
    const help = new BufferOutput();
    expect(await runCLI(["links", "--help"], fakeEnvironment({ stdout: help, stderr: new BufferOutput() }))).toBe(0);
    expect(help.toString()).toContain("--port <number>");
    expect(help.toString()).not.toContain("--server");
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["links", "--server", "https://example.com"], env)).toBe(1);
    expect(stderr.toString()).toContain("does not support --server");
    expect(env.createClient).not.toHaveBeenCalled();
  });

  it.each([
    { configAuth: false, requiresToken: true, homeToken: "  live-token\n", addresses: ["127.0.0.1", "100.64.0.7"] },
    { configAuth: true, requiresToken: false, homeToken: "leftover-token\n", addresses: ["0.0.0.0"] },
    { configAuth: false, requiresToken: false, homeToken: "leftover-token\n", addresses: ["127.0.0.1"] },
    { configAuth: true, requiresToken: false, homeToken: undefined, addresses: ["127.0.0.1"] },
  ])("uses live auth=$requiresToken and health addresses despite config auth=$configAuth", async ({ configAuth, requiresToken, homeToken, addresses }) => {
    const home = temporaryHome({ port: 43200, auth: configAuth });
    if (homeToken !== undefined) writeToken(home, homeToken);
    const { createClient, health, authenticatedGet, unauthenticatedGet } = peers();
    health.mockResolvedValue({ status: "ok", bindAddresses: addresses, port: 43123 });
    if (requiresToken) unauthenticatedGet.mockRejectedValue(unauthorized());
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    expect(await runCLI(["--home", home, "links"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(0);
    expect(createClient.mock.calls).toEqual([["http://localhost:43200", homeToken?.trim()], ["http://localhost:43200", undefined]]);
    expect(health.mock.invocationCallOrder[0]).toBeLessThan(authenticatedGet.mock.invocationCallOrder[0]!);
    expect(authenticatedGet.mock.invocationCallOrder[0]).toBeLessThan(unauthenticatedGet.mock.invocationCallOrder[0]!);
    expect(stdout.toString()).toBe(addresses.map((address) => `http://${address}:43123${requiresToken ? "/?token=live-token" : ""}\n`).join(""));
    expect(stderr.toString()).toBe("");
  });

  it("uses the selected default home and the required port override", async () => {
    const operatingSystemHome = temporaryDirectory("television-links-os-home-");
    const home = temporaryHome({ port: 0 });
    writeFileSync(path.join(operatingSystemHome, ".tv-home"), `${home}\n`);
    writeToken(home, "trimmed-token\n");
    const { createClient } = peers();
    expect(await runCLI(["links", "--port", "43123"], fakeEnvironment({
      stdout: new BufferOutput(), stderr: new BufferOutput(), createClient, resolveHomeDir: () => operatingSystemHome,
    }))).toBe(0);
    expect(createClient.mock.calls).toEqual([["http://localhost:43123", "trimmed-token"], ["http://localhost:43123", undefined]]);

    writeConfig(home, { port: 43123 });
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(await runCLI(["--home", home, "links", "--port", "43123"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
  });

  it.each(["health", "authenticated", "unauthenticated"] as const)("prints no links when the %s request cannot reach the server", async (stage) => {
    const { createClient, health, authenticatedGet, unauthenticatedGet } = peers();
    const request = { health, authenticated: authenticatedGet, unauthenticated: unauthenticatedGet }[stage];
    request.mockRejectedValue(new RequestError("fetch failed", { serverURL: "http://localhost:43123" }));
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    expect(await runCLI(["--home", temporaryHome({ port: 43123 }), "links"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(1);
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe("Could not reach Television server at http://localhost:43123: fetch failed\n");
    if (stage === "health") expect(authenticatedGet).not.toHaveBeenCalled();
    if (stage !== "unauthenticated") expect(unauthenticatedGet).not.toHaveBeenCalled();
  });

  it.each([undefined, "wrong-token"])("refuses a rejected home token %s before printing any links", async (token) => {
    const home = temporaryHome({ port: 43123 });
    if (token !== undefined) writeToken(home, token);
    const { createClient, authenticatedGet, unauthenticatedGet } = peers();
    authenticatedGet.mockRejectedValue(unauthorized());
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    expect(await runCLI(["--home", home, "links"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(1);
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain(`Television server at http://localhost:43123 rejected the request as unauthorized. Check the token in ${path.join(home, "state", "token")}.`);
    expect(stderr.toString()).toContain(SKILL_POINTER);
    expect(unauthenticatedGet).not.toHaveBeenCalled();
  });

  // [[arch/cli/index.md#^cli-osc8-visible]]
  it.each(["foreground", "persisted", "links"].flatMap((caller) =>
    [true, false, undefined].flatMap((isTTY) => [true, false].map((auth) => ({ caller, isTTY, auth }))),
  ))("formats $caller output with isTTY=$isTTY and auth=$auth", async ({ caller, isTTY, auth }) => {
    const home = temporaryHome({ port: 43123, auth });
    const token = "a+b/c?&=";
    writeToken(home, token);
    const stdout = Object.assign(new BufferOutput(), isTTY === undefined ? {} : { isTTY });
    const stderr = new BufferOutput();
    const { createClient, unauthenticatedGet } = peers();
    if (auth) unauthenticatedGet.mockRejectedValue(unauthorized());
    const env = fakeEnvironment({ stdout, stderr, createClient });
    const url = `http://127.0.0.1:43123${auth ? "/?token=a%2Bb%2Fc%3F%26%3D" : ""}`;
    let exitCode: number;
    if (caller === "foreground") {
      const server = env.createServer!({} as any);
      server.getAuthToken = () => token;
      server.getBaseURLs = () => ["http://127.0.0.1:43123"];
      ({ exitCode } = await runForegroundServe(["--home", home, "serve"], { stdout, stderr, createServer: () => server }));
    } else {
      exitCode = await runCLI(["--home", home, ...(caller === "persisted" ? ["serve", "--persist"] : ["links"])], env);
    }
    expect(exitCode).toBe(0);
    const formatted = isTTY === true ? `\u001B]8;;${url}\u001B\\${url}\u001B]8;;\u001B\\` : url;
    const heading = caller === "persisted" ? "Television service installed." : "Television server running.";
    expect(stdout.toString()).toBe(caller === "links" ? `${formatted}\n` : `${heading}\nOpen Television:\n  ${formatted}\n`);
  });
});

describe("CLI Slice 1 artifact command surface", () => {
  it("lists new pointer commands and omits removed lifecycle commands", () => {
    const names = listVisibleCLICommandNames();
    expect(names).toContain("create-path-artifact");
    expect(names).toContain("create-url-artifact");
    expect(names).toContain("update-artifact");
    expect(names).toContain("delete-artifact");
    expect(names).not.toContain("create-artifact");
    expect(names).not.toContain("create-markdown-artifact");
    expect(names).not.toContain("create-web-bundle-artifact");
    expect(names).not.toContain("edit-artifact");
    expect(names).not.toContain("commit-artifact");
    expect(names).not.toContain("abandon-artifact");
    expect(names).not.toContain("attach-artifact");
    expect(names).not.toContain("detach-artifact");
  });

  it("create-path-artifact trims and sends the path pointer shape without local filesystem validation", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const target = "server-only/path/note.md";
    const env = fakeEnvironment({ stdout, stderr });
    const exitCode = await runCLI(["create-path-artifact", "--channel", "screen-1", "--title", "Note", "--path", `  ${target}  `, "--no-focus"], env);
    expect(exitCode).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.artifacts.create).toHaveBeenCalledWith({ kind: "path", title: "Note", path: target, channelID: "screen-1" });
    expect(client.display.focus).not.toHaveBeenCalled();
    expect(stdout.toString()).toContain("Path artifact artifact-1 created.");
  });

  // Spec: [[arch/cli/index.md#^07842556|URL creation trims and forms the request]].
  it("create-url-artifact trims and sends url instead of externalURL", async () => {
    const stdout = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
    const exitCode = await runCLI(["create-url-artifact", "--channel", "screen-1", "--title", "Link", "--url", " https://example.com ", "--no-focus"], env);
    expect(exitCode).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.artifacts.create).toHaveBeenCalledWith({ kind: "url", title: "Link", url: "https://example.com", channelID: "screen-1" });
    expect(client.display.focus).not.toHaveBeenCalled();
    expect(stdout.toString()).toContain("Television registered https://example.com.");
  });

  it("removed commands fail as unknown", async () => {
    for (const command of ["create-artifact", "create-markdown-artifact", "create-web-bundle-artifact", "edit-artifact", "commit-artifact", "abandon-artifact", "attach-artifact", "detach-artifact"]) {
      const stderr = new BufferOutput();
      expect(await runCLI([command], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
      expect(stderr.toString()).toContain(`Unknown tv command: ${command}`);
      expect(stderr.toString()).toContain(SKILL_POINTER);
    }
  });

  it("keeps deferred commands absent behind the directive contract", async () => {
    for (const commandName of ["restore-artifact", "list-pending-artifacts", "make-attestation-nonce"]) {
      const stderr = new BufferOutput();
      expect(await runCLI([commandName], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
      expect(stderr.toString()).toContain(`Unknown tv command: ${commandName}`);
      expect(stderr.toString()).toContain(SKILL_POINTER);
    }
  });

  it("delete-artifact prints pointer delete output", async () => {
    for (const result of [
      { outcome: "deleted", kind: "path", artifactID: "artifact-path", path: "/tmp/a.html" },
      { outcome: "deleted", kind: "url", artifactID: "artifact-url", url: "https://example.com/a" },
    ] as const) {
      const stdout = new BufferOutput();
      const client = fakeEnvironment().createClient!("", "") as any;
      client.artifacts.delete.mockResolvedValueOnce(result);
      const exitCode = await runCLI(["delete-artifact", "--id", result.artifactID], fakeEnvironment({
        stdout,
        stderr: new BufferOutput(),
        createClient: vi.fn(() => client),
      }));
      expect(exitCode).toBe(0);
      expect(stdout.toString()).toContain(`${result.kind} artifact ${result.artifactID} deleted from the registry.`);
      expect(stdout.toString()).toContain(`${result.kind}: ${result.kind === "path" ? result.path : result.url}`);
      expect(stdout.toString()).toContain(`${result.kind} target was not touched.`);
    }
  });

  it("reads auth tokens from state/token", async () => {
    for (const fixture of [
      { name: "populated", tokenBytes: "  token-from-state\n", expectedToken: "token-from-state" },
      { name: "missing", tokenBytes: undefined, expectedToken: undefined },
      { name: "whitespace-only", tokenBytes: " \n\t", expectedToken: undefined },
    ] as const) {
      const home = temporaryHome();
      mkdirSync(path.join(home, "state"));
      if (fixture.tokenBytes !== undefined) {
        writeFileSync(path.join(home, "state", "token"), fixture.tokenBytes);
      }
      const createClient = vi.fn(() => fakeEnvironment().createClient!("", "") as any);
      const exitCode = await runCLI(["--home", home, "list-artifacts"], fakeEnvironment({ createClient, stdout: new BufferOutput(), stderr: new BufferOutput() }));
      expect(exitCode).toBe(0);
      expect(createClient).toHaveBeenCalledWith(expect.any(String), fixture.expectedToken);
    }
  });

  it("keeps the visible command list aligned with the live CLI surface", () => {
    expect(listVisibleCLICommandNames()).toEqual([
      "serve",
      "config",
      "create-path-artifact",
      "create-url-artifact",
      "update-artifact",
      "delete-artifact",
      "get-artifact",
      "list-artifacts",
      "create-channel",
      "update-channel",
      "remove-channel",
      "list-channels",
      "get-channel",
      "focus-status",
      "focus-channel",
      "set-theme",
      "themes-path",
      "focus-artifact",
      "skills",
      "telemetry",
      "stop",
      "links",
      "status",
    ]);
  });

  // Specs: [[arch/cli/index.md#^723f3673|runCLI help]], [[arch/cli/index.md#^cli-home-command-surface|home command surface]].
  it("prints top-level help with the pointer command surface", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr });
    const exitCode = await runCLI([], env);
    expect(exitCode).toBe(0);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stdout.toString()).toContain("Usage: tv");
    expect(stdout.toString()).toContain("Television — virtual display for agents");
    expect(stdout.toString()).toContain("tv skills install");
    expect(stdout.toString()).toContain("create-path-artifact");
    expect(stdout.toString()).toContain("create-url-artifact");
    expect(stdout.toString()).toContain("focus-artifact");
    expect(stdout.toString()).toContain("update-channel");
    expect(stdout.toString()).toMatch(/^  --home <path>\s/m);
    expect(stdout.toString()).toMatch(/^  config\s/m);
    expect(stdout.toString()).toMatch(/^  themes-path\s/m);
    expect(stdout.toString()).toContain(
      "The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming.",
    );
    expect(stdout.toString()).toContain("Additional `tv-*` skills cover specialized artifact types.");
    expect(stdout.toString()).not.toContain("specialized artifact types and theming");
    for (const command of [
      "create-artifact",
      "create-markdown-artifact",
      "create-web-bundle-artifact",
      "edit-artifact",
      "commit-artifact",
      "abandon-artifact",
      "attach-artifact",
      "detach-artifact",
      "restore-artifact",
      "list-pending-artifacts",
      "make-attestation-nonce",
      "data-dir",
      "storage-path",
    ]) {
      expect(stdout.toString()).not.toMatch(new RegExp(`^  ${command}(?:\\s|$)`, "m"));
    }
    expect(stdout.toString()).not.toContain("tv skills show");
    expect(stdout.toString()).not.toContain("cli-capabilities.md");
    expect(stdout.toString()).not.toContain("artifact-workflow.md");
    expect(stdout.toString()).not.toContain("html-house-style.md");
    expect(stdout.toString()).not.toContain("artifact-types/table.md");
    expect(stdout.toString()).not.toContain("## User intent");
    expect(stderr.toString()).toBe("");
  });

  it("renders the same normal help for bare tv, tv help, tv -h, and tv --help", async () => {
    const bareStdout = new BufferOutput();
    const bareStderr = new BufferOutput();
    const helpStdout = new BufferOutput();
    const helpStderr = new BufferOutput();
    const shortStdout = new BufferOutput();
    const shortStderr = new BufferOutput();
    const longStdout = new BufferOutput();
    const longStderr = new BufferOutput();

    const bareExitCode = await runCLI([], fakeEnvironment({ stdout: bareStdout, stderr: bareStderr }));
    const helpExitCode = await runCLI(["help"], fakeEnvironment({ stdout: helpStdout, stderr: helpStderr }));
    const shortExitCode = await runCLI(["-h"], fakeEnvironment({ stdout: shortStdout, stderr: shortStderr }));
    const longExitCode = await runCLI(["--help"], fakeEnvironment({ stdout: longStdout, stderr: longStderr }));

    expect(bareExitCode).toBe(0);
    expect(helpExitCode).toBe(0);
    expect(shortExitCode).toBe(0);
    expect(longExitCode).toBe(0);
    expect(helpStdout.toString()).toBe(bareStdout.toString());
    expect(shortStdout.toString()).toBe(bareStdout.toString());
    expect(longStdout.toString()).toBe(bareStdout.toString());
    expect(bareStderr.toString()).toBe("");
    expect(helpStderr.toString()).toBe("");
    expect(shortStderr.toString()).toBe("");
    expect(longStderr.toString()).toBe("");
  });

  // Spec: [[arch/cli/index.md#^cli-update-channel-help|update-channel help and inventory]].
  it("update-channel help exposes the command and required options", async () => {
    expect(listVisibleCLICommandNames()).toContain("update-channel");

    const topStdout = new BufferOutput();
    const topStderr = new BufferOutput();
    const topEnv = fakeEnvironment({ stdout: topStdout, stderr: topStderr });
    expect(await runCLI(["--help"], topEnv)).toBe(0);
    expect(topStdout.toString()).toMatch(/^  update-channel \[options\]\s+Rename a channel/m);
    expect(topStderr.toString()).toBe("");
    expect(topEnv.createClient).not.toHaveBeenCalled();

    for (const argv of [["help", "update-channel"], ["update-channel", "--help"]]) {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const env = fakeEnvironment({ stdout, stderr });

      expect(await runCLI(argv, env)).toBe(0);
      expect(stdout.toString()).toContain("Usage: tv update-channel");
      expect(stdout.toString()).toContain("Rename a channel");
      expect(stdout.toString()).toContain("--channel <id>");
      expect(stdout.toString()).toContain("--name <name>");
      expect(stdout.toString()).toContain("--port <number>");
      expect(stdout.toString()).not.toContain("--storage-path");
      expect(stderr.toString()).toBe("");
      expect(env.createClient).not.toHaveBeenCalled();
    }
  });

  it("list-artifacts help omits the removed unplaced filter", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    const exitCode = await runCLI(["list-artifacts", "--help"], fakeEnvironment({ stdout, stderr }));

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("--channel <id>");
    expect(stdout.toString()).not.toContain("--unplaced");
    expect(stderr.toString()).toBe("");
  });

  it("documents exact theme ID activation and the none token", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    const exitCode = await runCLI(["help", "set-theme"], fakeEnvironment({ stdout, stderr }));

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Usage: tv set-theme");
    expect(stdout.toString()).toContain("tv set-theme paperlike");
    expect(stdout.toString()).toContain("tv set-theme none");
    expect(stdout.toString()).toContain("exact theme ID");
    expect(stdout.toString()).toContain("`none` means no theme");
    expect(stdout.toString()).not.toContain("by slug");
    expect(stdout.toString()).not.toContain("null theme");
    expect(stdout.toString()).not.toContain("PATCH /display");
    expect(stderr.toString()).toBe("");
  });

  it("describes focus status with an active theme ID", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    const exitCode = await runCLI(["help", "focus-status"], fakeEnvironment({ stdout, stderr }));

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("active theme ID");
    expect(stdout.toString()).not.toContain("active theme name");
    expect(stderr.toString()).toBe("");
  });

  // Specs: [[arch/cli/index.md#^37bb8262|unsupported options]], [[arch/cli/index.md#^cf207a25|exact argv in errors]].
  it("prints command help and rejects unsupported options", async () => {
    const stdout = new BufferOutput();
    expect(await runCLI(["help", "create-path-artifact"], fakeEnvironment({ stdout, stderr: new BufferOutput() }))).toBe(0);
    expect(stdout.toString()).toContain("--focus-artifact");
    expect(stdout.toString()).toContain(
      "The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming.",
    );
    expect(stdout.toString()).toContain("Additional `tv-*` skills cover specialized artifact types.");
    expect(stdout.toString()).not.toContain("specialized artifact types and theming");

    const focusStdout = new BufferOutput();
    expect(await runCLI(["help", "focus-artifact"], fakeEnvironment({ stdout: focusStdout, stderr: new BufferOutput() }))).toBe(0);
    expect(focusStdout.toString()).toMatch(/select\s+the artifact's tab page/);
    expect(focusStdout.toString()).toMatch(/switch to its channel when needed/);
    expect(focusStdout.toString()).not.toMatch(/scroll|highlight/i);

    const stderr = new BufferOutput();
    expect(await runCLI(["list-artifacts", "--bogus"], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
    expect(stderr.toString()).toContain("tv list-artifacts --bogus does not support --bogus");
  });

  it("keeps -h as a local subcommand help flag", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    const exitCode = await runCLI(["create-path-artifact", "-h"], fakeEnvironment({ stdout, stderr }));

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Usage: tv create-path-artifact");
    expect(stdout.toString()).toContain("tv skills install");
    expect(stdout.toString()).not.toContain("tv skills show");
    expect(stdout.toString()).not.toContain("artifact-workflow.md");
    expect(stderr.toString()).toBe("");
  });

  // Spec: [[arch/cli/index.md#^3ac55abd|standalone built-binary seam]].
  it("prints normal help from an executable built CLI binary outside the repo tree", () => {
    const buildDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-"));
    const outfile = path.join(buildDir, "tv.cjs");

    try {
      execFileSync(process.execPath, [path.join(REPO_ROOT, "packages", "cli", "build.mjs"), "--outfile", outfile], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });

      const result = spawnSync(outfile, ["help"], {
        cwd: buildDir,
        encoding: "utf8",
        env: {
          ...process.env,
          VITEST: "",
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Usage: tv");
      expect(result.stdout).toContain("tv skills install");
      expect(result.stdout).not.toContain("## User intent");
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  // Specs: [[arch/cli/index.md#^99e06341|runCLI version]],
  // [[product/versioning.md#^pv-exact-version|exact release version]].
  it("supports version output", async () => {
    const rootVersion = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
    const homesRoot = mkdtempSync(path.join(os.tmpdir(), "television-cli-version-homes-"));
    const markedHome = path.join(homesRoot, "marked");
    const unmarkedHome = path.join(homesRoot, "unmarked");
    mkdirSync(markedHome);
    mkdirSync(unmarkedHome);
    writeFileSync(path.join(markedHome, ".tv-developer"), "");

    try {
      for (const home of [markedHome, unmarkedHome]) {
        for (const argv of [["--version"], ["-V"], ["-v"]]) {
          const stdout = new BufferOutput();
          const stderr = new BufferOutput();
          expect(await runCLI(argv, fakeEnvironment({
            stdout,
            stderr,
            resolveHomeDir: () => home,
          }))).toBe(0);
          expect(stdout.toString().trim()).toBe(rootVersion);
          expect(stderr.toString()).toBe("");
        }
      }
    } finally {
      rmSync(homesRoot, { recursive: true, force: true });
    }
  });

  // Spec: [[arch/cli/index.md#^cli-port-parsing|strict port parser]].
  it("rejects port option values that are not whole decimal integers in range", async () => {
    const home = temporaryHome({ port: 0 });
    const configPath = path.join(home, "config.json");
    const configBytes = readFileSync(configPath);
    for (const value of ["123abc", "abc", "", "+1", "-1", "1.5", "70000", "0"]) {
      const stderr = new BufferOutput();
      const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
      expect(await runCLI(["--home", home, "status", "--port", value], env), value).toBe(1);
      expect(env.createClient, value).not.toHaveBeenCalled();
      expect(stderr.toString(), value).toContain(`--port ${value === "" ? '""' : value}`);
      expect(stderr.toString(), value).toContain(SKILL_POINTER);
    }
    const trailingText = new BufferOutput();
    expect(await runCLI(["--home", home, "status", "--port", "123abc"], fakeEnvironment({ stdout: new BufferOutput(), stderr: trailingText }))).toBe(1);
    expect(trailingText.toString()).toContain(`tv --home ${home} status --port 123abc received an invalid argument`);
    expect(trailingText.toString()).toContain("port must be a whole decimal integer from 1 through 65535");

    for (const value of ["123abc", "abc", "", "+1", "-1", "1.5", "70000"]) {
      const stderr = new BufferOutput();
      expect(await runCLI(["--home", home, "config", "set", "port", value], fakeEnvironment({ stdout: new BufferOutput(), stderr })), value).toBe(1);
      expect(stderr.toString(), value).toContain(SKILL_POINTER);
      expect(readFileSync(configPath), value).toEqual(configBytes);
    }
    for (const [value, port] of [["0", 0], ["65535", 65535]] as const) {
      expect(await runCLI(["--home", home, "config", "set", "port", value], fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() }))).toBe(0);
      expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ port });
    }
  });

  // Spec: [[arch/cli/index.md#^cli-package-metadata-contract|executable-only package metadata]].
  it("declares the published package as executable-only", () => {
    const cliPackageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "cli", "package.json"), "utf8"));
    expect(cliPackageJson.bin).toEqual({ tv: "dist/cli.cjs" });
    expect(cliPackageJson.files).toEqual(["dist/**"]);
    expect(cliPackageJson).not.toHaveProperty("main");
    expect(cliPackageJson).not.toHaveProperty("exports");
  });


  // Specs: [[arch/cli/index.md#^72e143f1|historical names]], [[arch/cli/index.md#^cli-home-command-surface|storage-path retired]].
  it.each(["data-dir", "storage-path"])("does not expose the old %s command name", async (command) => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    expect(await runCLI([command], fakeEnvironment({ stdout, stderr }))).toBe(1);
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain(`Unknown tv command: ${command}.`);
  });

  it("requires exactly one focus directive for create-path-artifact, create-url-artifact, and create-channel", async () => {
    for (const baseArgv of [
      ["create-path-artifact", "--channel", "screen-1", "--title", "A", "--path", "/tmp/a.html"],
      ["create-url-artifact", "--channel", "screen-1", "--title", "U", "--url", "https://example.com"],
      ["create-channel", "--name", "New"],
    ]) {
      const focusFlag = baseArgv[0] === "create-channel" ? "--focus-channel" : "--focus-artifact";
      for (const argv of [baseArgv, [...baseArgv, focusFlag, "--no-focus"]]) {
        const stderr = new BufferOutput();
        const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
        expect(await runCLI(argv, env)).toBe(1);
        expect(env.createClient).not.toHaveBeenCalled();
        expect(stderr.toString()).toContain("requires exactly one of");
      }
    }
  });

  it("create-path-artifact focuses the new artifact when requested", async () => {
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(await runCLI(["create-path-artifact", "--channel", "screen-1", "--title", "Note", "--path", "/tmp/note.md", "--focus-artifact"], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.display.focus).toHaveBeenCalledWith({ artifactID: "artifact-1" });
  });

  it("create-url-artifact focuses the new artifact when requested", async () => {
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(await runCLI(["create-url-artifact", "--channel", "screen-1", "--title", "Link", "--url", "https://example.com", "--focus-artifact"], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.display.focus).toHaveBeenCalledWith({ artifactID: "artifact-1" });
  });

  it("create-url-artifact requires --url", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["create-url-artifact", "--channel", "screen-1", "--title", "x", "--no-focus"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toMatch(/--url/);
  });

  it("update-artifact sends flat title metadata and prints confirmation", async () => {
    const stdout = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
    expect(await runCLI(["update-artifact", "--id", "artifact-1", "--title", "Updated"], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.artifacts.update).toHaveBeenCalledWith({ artifactID: "artifact-1", title: "Updated" });
    expect(stdout.toString()).toContain("Artifact artifact-1 updated.");
  });

  // Spec: [[arch/cli/index.md#^26872411|request-error formatting]].
  it("update-artifact prints a token-file hint instead of a raw 401", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const home = temporaryHome();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const update = vi.fn(async () => {
      throw new RequestError("Unauthorized", { serverURL: "http://localhost:32848", status: 401 });
    });
    const createClient = vi.fn(() => ({ ...baseClient, artifacts: { ...baseClient.artifacts, update } }));

    const exitCode = await runCLI(["--home", home, "update-artifact", "--id", "artifact-1", "--title", "Updated"], fakeEnvironment({ stdout, stderr, createClient }));

    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("rejected the request as unauthorized");
    expect(stderr.toString()).toContain(path.join(home, "state", "token"));
    expect(stderr.toString()).toContain(SKILL_POINTER);
    expect(stderr.toString()).not.toContain("Unauthorized\n");
  });

  it("update-artifact appends the stable help pointer when server refusals do not include it yet", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const update = vi.fn(async () => {
      throw new RequestError("Artifact is deleted: artifact-1", { serverURL: "http://localhost:32848", status: 400 });
    });
    const createClient = vi.fn(() => ({ ...baseClient, artifacts: { ...baseClient.artifacts, update } }));

    const exitCode = await runCLI(["update-artifact", "--id", "artifact-1", "--title", "Updated"], fakeEnvironment({ stdout, stderr, createClient }));

    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("Artifact is deleted: artifact-1");
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("update-artifact requires at least one of --title, --path, --url", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["update-artifact", "--id", "artifact-1"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toMatch(/--title, --path, or --url/);
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("update-artifact rejects --path and --url together without contacting the server", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["update-artifact", "--id", "artifact-1", "--path", "/tmp/a.md", "--url", "https://example.com"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toMatch(/--path or --url, not both/);
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("update-artifact sends a trimmed path repoint", async () => {
    const stdout = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
    expect(await runCLI(["update-artifact", "--id", "artifact-1", "--path", "  /tmp/dashboard  "], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.artifacts.update).toHaveBeenCalledWith({ artifactID: "artifact-1", path: "/tmp/dashboard" });
    expect(stdout.toString()).toContain("Artifact artifact-1 updated.");
  });

  it("update-artifact sends a trimmed url repoint", async () => {
    const stdout = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
    expect(await runCLI(["update-artifact", "--id", "artifact-1", "--url", " https://example.com/next "], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.artifacts.update).toHaveBeenCalledWith({ artifactID: "artifact-1", url: "https://example.com/next" });
  });

  it("update-artifact sends title and path together", async () => {
    const stdout = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
    expect(await runCLI(["update-artifact", "--id", "artifact-1", "--title", "Renamed", "--path", "/tmp/notes.md"], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.artifacts.update).toHaveBeenCalledWith({ artifactID: "artifact-1", title: "Renamed", path: "/tmp/notes.md" });
  });

  it("get-artifact and list-artifacts print client JSON", async () => {
    const getStdout = new BufferOutput();
    const getEnv = fakeEnvironment({ stdout: getStdout, stderr: new BufferOutput() });
    expect(await runCLI(["get-artifact", "--id", "artifact-1"], getEnv)).toBe(0);
    const getClient = (getEnv.createClient as any).mock.results[0].value;
    expect(getClient.artifacts.get).toHaveBeenCalledWith({ artifactID: "artifact-1" });
    expect(JSON.parse(getStdout.toString())).toEqual({ artifact: { id: "artifact-1", kind: "path", title: "A", path: "/tmp/a.html" } });

    const listStdout = new BufferOutput();
    const listEnv = fakeEnvironment({ stdout: listStdout, stderr: new BufferOutput() });
    expect(await runCLI(["list-artifacts"], listEnv)).toBe(0);
    const listClient = (listEnv.createClient as any).mock.results[0].value;
    expect(listClient.artifacts.list).toHaveBeenCalledWith({});
    expect(JSON.parse(listStdout.toString())).toEqual({ artifacts: [] });
  });

  it("list-artifacts forwards channel filters and rejects removed unplaced flag generically", async () => {
    const env1 = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(await runCLI(["list-artifacts", "--channel", "screen-1"], env1)).toBe(0);
    expect((env1.createClient as any).mock.results[0].value.artifacts.list).toHaveBeenCalledWith({ channelID: "screen-1" });

    const stderr = new BufferOutput();
    const env2 = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["list-artifacts", "--unplaced"], env2)).toBe(1);
    expect(env2.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("tv list-artifacts --unplaced does not support --unplaced");
  });

  // Spec: [[arch/cli/index.md#^cli-update-channel-directives|update-channel directive errors]].
  it("update-channel rejects missing required options and --id without constructing a client", async () => {
    const cases = [
      {
        argv: ["update-channel", "--name", "  Next Name  "],
        expected: 'tv update-channel --name "  Next Name  " requires --channel <id>.',
      },
      {
        argv: ["update-channel", "--channel", "screen-1"],
        expected: "tv update-channel --channel screen-1 requires --name <name>.",
      },
      {
        argv: ["update-channel", "--channel", "screen-1", "--name", "  Next Name  ", "--id", "old-screen-1"],
        expected: 'tv update-channel --channel screen-1 --name "  Next Name  " --id old-screen-1 does not support --id.',
      },
    ];

    for (const { argv, expected } of cases) {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const env = fakeEnvironment({ stdout, stderr });

      expect(await runCLI(argv, env)).toBe(1);
      expect(stdout.toString()).toBe("");
      expect(stderr.toString()).toContain(expected);
      expect(stderr.toString()).toContain(SKILL_POINTER);
      expect(env.createClient).not.toHaveBeenCalled();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-update-channel-client-boundary|update-channel client call]].
  it("update-channel passes authored values unchanged and formats the returned channel", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const update = vi.fn(async () => ({
      channel: { id: "returned-channel", name: "  Returned Name  ", layout: [] },
    }));
    const client = { ...baseClient, channels: { ...baseClient.channels, update } };
    const createClient = vi.fn(() => client);

    expect(await runCLI(
      ["update-channel", "--channel", "authored-channel", "--name", "  Authored Name  "],
      fakeEnvironment({ stdout, stderr, createClient }),
    )).toBe(0);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      channelID: "authored-channel",
      name: "  Authored Name  ",
    });
    for (const otherCall of [
      ...Object.values(client.artifacts),
      client.channels.create,
      client.channels.list,
      client.channels.get,
      client.channels.remove,
      ...Object.values(client.display),
      ...Object.values(client.themes),
      ...Object.values(client.telemetry),
      client.health,
    ]) {
      expect(otherCall).not.toHaveBeenCalled();
    }
    expect(stdout.toString()).toBe("Channel updated: returned-channel (  Returned Name  )\n");
    expect(stderr.toString()).toBe("");
  });

  it("create-channel optionally focuses the new channel", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr });
    expect(await runCLI(["create-channel", "--name", "S", "--focus-channel"], env)).toBe(0);
    const client = (env.createClient as any).mock.results[0].value;
    expect(client.channels.create).toHaveBeenCalledWith({ name: "S" });
    expect(client.display.patch).toHaveBeenCalledWith({ focusedChannelId: "screen-1" });
    expect(stdout.toString().trim()).toBe("Channel created: screen-1 (S)");
    expect(stderr.toString()).toBe("");

    const backgroundEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(await runCLI(["create-channel", "--name", "Background", "--no-focus"], backgroundEnv)).toBe(0);
    const backgroundClient = (backgroundEnv.createClient as any).mock.results[0].value;
    expect(backgroundClient.channels.create).toHaveBeenCalledWith({ name: "Background" });
    expect(backgroundClient.display.patch).not.toHaveBeenCalled();
  });

  it("remove-channel requires --channel", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["remove-channel"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("remove-channel rejects the old --id option", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["remove-channel", "--id", "screen-1"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("tv remove-channel --id screen-1 requires --channel");
  });

  it("remove-channel rejects unknown options after --channel is satisfied", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["remove-channel", "--channel", "screen-1", "--id", "old-screen-1"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("does not support --id");
  });

  it("remove-channel prints a per-artifact delete cascade summary", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const remove = vi.fn(async () => ({
      channelID: "screen-1",
      metadataPath: "/state/channels/screen-1.json",
      artifactResults: [
        { outcome: "deleted" as const, kind: "path" as const, artifactID: "art-path", path: "/Users/x/note.md" },
        { outcome: "deleted" as const, kind: "url" as const, artifactID: "art-url", url: "https://example.com" },
      ],
    }));
    const createClient = vi.fn(() => ({ ...baseClient, channels: { ...baseClient.channels, remove } }));

    expect(await runCLI(["remove-channel", "--channel", "screen-1"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(0);
    expect(stdout.toString()).toBe([
      "Channel screen-1 deleted:",
      "  metadata removed: /state/channels/screen-1.json",
      "2 referenced artifact(s):",
      "  art-path: deleted",
      "    path: /Users/x/note.md",
      "    path target was not touched.",
      "  art-url: deleted",
      "    url: https://example.com",
      "    url target was not touched.",
      "",
    ].join("\n"));
    expect(stderr.toString()).toBe("");
  });

  it("create-channel requires --name", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["create-channel", "--focus-channel"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("remove-channel, list-channels, and get-channel call channel client methods", async () => {
    const removeStdout = new BufferOutput();
    const removeStderr = new BufferOutput();
    const removeEnv = fakeEnvironment({ stdout: removeStdout, stderr: removeStderr });
    expect(await runCLI(["remove-channel", "--channel", "screen-1"], removeEnv)).toBe(0);
    expect((removeEnv.createClient as any).mock.results[0].value.channels.remove).toHaveBeenCalledWith({ channelID: "screen-1" });
    expect(removeStdout.toString()).toBe([
      "Channel screen-1 deleted:",
      "  metadata removed: /state/channels/screen-1.json",
      "No artifacts referenced by this channel.",
      "",
    ].join("\n"));
    expect(removeStderr.toString()).toBe("");

    const listStdout = new BufferOutput();
    const listStderr = new BufferOutput();
    const listEnv = fakeEnvironment({ stdout: listStdout, stderr: listStderr });
    expect(await runCLI(["list-channels"], listEnv)).toBe(0);
    expect((listEnv.createClient as any).mock.results[0].value.channels.list).toHaveBeenCalled();
    expect(JSON.parse(listStdout.toString())).toEqual({ channels: [] });
    expect(listStderr.toString()).toBe("");

    const getStdout = new BufferOutput();
    const getEnv = fakeEnvironment({ stdout: getStdout, stderr: new BufferOutput() });
    expect(await runCLI(["get-channel", "--channel", "screen-1"], getEnv)).toBe(0);
    expect((getEnv.createClient as any).mock.results[0].value.channels.get).toHaveBeenCalledWith({ channelID: "screen-1" });
    expect(JSON.parse(getStdout.toString())).toEqual({ channel: { id: "screen-1", name: "S", layout: [] }, artifacts: [] });
  });

  // Specs: [[arch/cli/index.md#^808d0b98|get-channel selection errors]], [[arch/cli/index.md#^47e6c375|validation error formatting]].
  it("get-channel reports auto-selection failures as channel-selection problems", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const createClient = vi.fn((serverURL: string, token?: string) => new TelevisionClient(serverURL, { token }));

    try {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ channels: [
        { id: "screen-1", name: "One", layout: [] },
        { id: "screen-2", name: "Two", layout: [] },
      ] }), { status: 200, headers: { "content-type": "application/json" } }));
      const multipleStderr = new BufferOutput();
      expect(await runCLI(["get-channel"], fakeEnvironment({ stdout: new BufferOutput(), stderr: multipleStderr, createClient }))).toBe(1);
      expect(multipleStderr.toString()).toContain("channelID is required when multiple channels exist. Available channels: One (screen-1), Two (screen-2)");
      expect(multipleStderr.toString()).not.toContain("Could not reach Television server");
      expect(multipleStderr.toString()).toContain(SKILL_POINTER);

      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ channels: [] }), { status: 200, headers: { "content-type": "application/json" } }));
      const zeroStderr = new BufferOutput();
      expect(await runCLI(["get-channel"], fakeEnvironment({ stdout: new BufferOutput(), stderr: zeroStderr, createClient }))).toBe(1);
      expect(zeroStderr.toString()).toContain("channelID is required, but no channels exist.");
      expect(zeroStderr.toString()).not.toContain("Could not reach Television server");
      expect(zeroStderr.toString()).toContain(SKILL_POINTER);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("focus-artifact requires --id", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["focus-artifact"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("focus-channel requires --channel", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["focus-channel"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("focus-channel rejects the old --id option", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["focus-channel", "--id", "screen-1"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("tv focus-channel --id screen-1 requires --channel");
  });

  it("focus-channel rejects unknown options after --channel is satisfied", async () => {
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
    expect(await runCLI(["focus-channel", "--channel", "screen-1", "--id", "old-screen-1"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("does not support --id");
  });

  it("focus-status, focus-channel, set-theme, and focus-artifact call display client methods", async () => {
    const statusStdout = new BufferOutput();
    const statusStderr = new BufferOutput();
    const statusEnv = fakeEnvironment({ stdout: statusStdout, stderr: statusStderr });
    const statusClient = (statusEnv.createClient as any).mock.results[0]?.value ?? fakeEnvironment().createClient!("", "") as any;
    statusClient.display.get.mockResolvedValueOnce({
      activeChannelID: "channel-compatibility-extra",
      focusedChannelId: "channel-internal",
      pinnedChannelIds: ["channel-pinned"],
      activeScreenID: null,
      activeThemeName: "paperlike",
      acpEnabled: true,
    });
    (statusEnv.createClient as any).mockReturnValue(statusClient);
    expect(await runCLI(["focus-status"], statusEnv)).toBe(0);
    expect(statusClient.display.get).toHaveBeenCalled();
    expect(JSON.parse(statusStdout.toString())).toEqual({
      activeChannelID: "channel-internal",
      activeThemeName: "paperlike",
      acpEnabled: true,
    });
    expect(statusStderr.toString()).toBe("");

    const channelStdout = new BufferOutput();
    const channelStderr = new BufferOutput();
    const channelEnv = fakeEnvironment({ stdout: channelStdout, stderr: channelStderr });
    expect(await runCLI(["focus-channel", "--channel", "screen-1"], channelEnv)).toBe(0);
    expect((channelEnv.createClient as any).mock.results[0].value.display.patch).toHaveBeenCalledWith({ focusedChannelId: "screen-1" });
    expect(channelStdout.toString().trim()).toBe("Focused channel screen-1.");
    expect(channelStderr.toString()).toBe("");

    const themeStdout = new BufferOutput();
    const themeStderr = new BufferOutput();
    const themeEnv = fakeEnvironment({ stdout: themeStdout, stderr: themeStderr });
    const exactThemeID = "Paper Theme.v2 🎨";
    expect(await runCLI(["set-theme", exactThemeID], themeEnv)).toBe(0);
    const themeClient = (themeEnv.createClient as any).mock.results[0].value;
    expect(themeClient.themes.refresh).toHaveBeenCalledOnce();
    expect(themeClient.display.patch).toHaveBeenCalledWith({ activeThemeName: exactThemeID });
    expect(themeClient.themes.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      themeClient.display.patch.mock.invocationCallOrder[0],
    );
    expect(themeStdout.toString()).toBe(`Active theme changed from 'None' to '${exactThemeID}'.\n`);
    expect(themeStderr.toString()).toBe("");

    for (const nullThemeName of ["none", "None", "NONE"]) {
      const nullThemeEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
      expect(await runCLI(["set-theme", nullThemeName], nullThemeEnv)).toBe(0);
      const nullThemeClient = (nullThemeEnv.createClient as any).mock.results[0].value;
      expect(nullThemeClient.themes.refresh).not.toHaveBeenCalled();
      expect(nullThemeClient.display.patch).toHaveBeenCalledWith({ activeThemeName: null });
    }

    const errorStdout = new BufferOutput();
    const errorStderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const patch = vi.fn(async () => {
      throw new RequestError("Theme not found: paperlike", { serverURL: "http://localhost:32848", status: 404 });
    });
    const createClient = vi.fn(() => ({ ...baseClient, display: { ...baseClient.display, patch } }));
    expect(await runCLI(["set-theme", "paperlike"], fakeEnvironment({ stdout: errorStdout, stderr: errorStderr, createClient }))).toBe(1);
    expect(errorStdout.toString()).toBe("");
    expect(errorStderr.toString()).toContain("Theme not found: paperlike");

    const artifactStdout = new BufferOutput();
    const artifactStderr = new BufferOutput();
    const artifactEnv = fakeEnvironment({ stdout: artifactStdout, stderr: artifactStderr });
    expect(await runCLI(["focus-artifact", "--id", "artifact-1"], artifactEnv)).toBe(0);
    const artifactClient = (artifactEnv.createClient as any).mock.results[0].value;
    expect(artifactClient.display.focus).toHaveBeenCalledWith({ artifactID: "artifact-1" });
    expect(artifactClient.display.get).not.toHaveBeenCalled();
    expect(artifactStdout.toString().trim()).toBe("Focused artifact artifact-1 on channel screen-1.");
    expect(artifactStderr.toString()).toBe("");

    const artifactChannelStderr = new BufferOutput();
    const artifactChannelEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: artifactChannelStderr });
    expect(await runCLI(["focus-artifact", "--id", "artifact-1", "--channel", "screen-1"], artifactChannelEnv)).toBe(1);
    expect(artifactChannelEnv.createClient).not.toHaveBeenCalled();
    expect(artifactChannelStderr.toString()).toContain("does not support --channel");
  });

  // Spec: [[arch/cli/index.md#^cli-set-theme-transition-contract|set-theme transition contract]].
  it("set-theme reports exact selection transitions and treats an opening read failure as nonfatal", async () => {
    const runTransition = async (options: {
      theme: string;
      previous: string | null | Error;
      expectedOutput: string;
      expectedSelection: string | null;
      refresh: boolean;
    }): Promise<void> => {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const baseClient = fakeEnvironment().createClient!("", "") as any;
      const get = options.previous instanceof Error
        ? vi.fn(async () => { throw options.previous; })
        : vi.fn(async () => ({
          focusedChannelId: null,
          pinnedChannelIds: [],
          activeThemeName: options.previous,
          acpEnabled: false,
        }));
      const refresh = vi.fn(async () => ({ themes: [], errors: [] }));
      const patch = vi.fn(async () => {});
      const createClient = vi.fn(() => ({
        ...baseClient,
        display: { ...baseClient.display, get, patch },
        themes: { ...baseClient.themes, refresh },
      }));

      expect(await runCLI(["set-theme", options.theme], fakeEnvironment({ stdout, stderr, createClient }))).toBe(0);
      expect(get).toHaveBeenCalledOnce();
      expect(patch).toHaveBeenCalledWith({ activeThemeName: options.expectedSelection });
      expect(get.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]);
      if (options.refresh) {
        expect(refresh).toHaveBeenCalledOnce();
        expect(get.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
        expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]);
      } else {
        expect(refresh).not.toHaveBeenCalled();
      }
      expect(stdout.toString()).toBe(`${options.expectedOutput}\n`);
      expect(stderr.toString()).toBe("");
    };

    await runTransition({
      theme: "Paper Theme.v2 🎨",
      previous: "Clouds.Exact-ID",
      expectedOutput: "Active theme changed from 'Clouds.Exact-ID' to 'Paper Theme.v2 🎨'.",
      expectedSelection: "Paper Theme.v2 🎨",
      refresh: true,
    });
    await runTransition({
      theme: "Paper Theme.v2 🎨",
      previous: "Paper Theme.v2 🎨",
      expectedOutput: "Active theme unchanged: 'Paper Theme.v2 🎨'.",
      expectedSelection: "Paper Theme.v2 🎨",
      refresh: true,
    });
    await runTransition({
      theme: "paperlike",
      previous: null,
      expectedOutput: "Active theme changed from 'None' to 'paperlike'.",
      expectedSelection: "paperlike",
      refresh: true,
    });
    await runTransition({
      theme: "NONE",
      previous: "paperlike",
      expectedOutput: "Active theme changed from 'paperlike' to 'None'.",
      expectedSelection: null,
      refresh: false,
    });
    await runTransition({
      theme: "none",
      previous: null,
      expectedOutput: "Active theme unchanged: 'None'.",
      expectedSelection: null,
      refresh: false,
    });
    await runTransition({
      theme: "paperlike",
      previous: new Error("opening display read failed"),
      expectedOutput: "Active theme: 'paperlike'.",
      expectedSelection: "paperlike",
      refresh: true,
    });
  });

  it("set-theme prints no success output when refresh, validation, or the display write fails", async () => {
    for (const failingOperation of ["refresh", "validation", "patch"] as const) {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const baseClient = fakeEnvironment().createClient!("", "") as any;
      const refresh = vi.fn(async () => {
        if (failingOperation === "refresh") throw new Error("theme refresh failed");
        return failingOperation === "validation"
          ? { themes: [], errors: [{ folder: "paperlike", error: "theme validation failed" }] }
          : { themes: [], errors: [] };
      });
      const patch = vi.fn(async () => {
        if (failingOperation === "patch") throw new Error("display write failed");
      });
      const createClient = vi.fn(() => ({
        ...baseClient,
        display: { ...baseClient.display, patch },
        themes: { ...baseClient.themes, refresh },
      }));

      expect(await runCLI(["set-theme", "paperlike"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(1);
      expect(stdout.toString()).toBe("");
      expect(stderr.toString()).toContain({
        refresh: "theme refresh failed",
        validation: "theme validation failed",
        patch: "display write failed",
      }[failingOperation]);
      if (failingOperation !== "patch") expect(patch).not.toHaveBeenCalled();
    }
  });

  it("set-theme reports matching registry errors without patching display", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const refresh = vi.fn(async () => ({
      themes: [],
      errors: [{ folder: "broken", error: "manifest version must be a valid Semantic Version" }],
    }));
    const createClient = vi.fn(() => ({
      ...baseClient,
      themes: { ...baseClient.themes, refresh },
    }));

    expect(await runCLI(["set-theme", "broken"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(baseClient.display.patch).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("broken");
    expect(stderr.toString()).toContain("manifest version must be a valid Semantic Version");
  });

  // Specs: [[arch/cli/index.md#^cli-telemetry-client-boundary|telemetry controls]], [[arch/cli/index.md#^cli-telemetry-json-boundary|JSON output]].
  it("telemetry commands call the server control endpoints and print content-free JSON", async () => {
    const disableOut = new BufferOutput();
    const disableEnv = fakeEnvironment({ stdout: disableOut, stderr: new BufferOutput() });
    expect(await runCLI(["telemetry", "disable"], disableEnv)).toBe(0);
    const disableClient = (disableEnv.createClient as any).mock.results[0].value;
    expect(disableClient.telemetry.disable).toHaveBeenCalledTimes(1);
    expect(JSON.parse(disableOut.toString())).toEqual({ state: "opted-out", reason: null, guidPresent: true, region: "us" });

    const enableOut = new BufferOutput();
    const enableEnv = fakeEnvironment({ stdout: enableOut, stderr: new BufferOutput() });
    expect(await runCLI(["telemetry", "enable"], enableEnv)).toBe(0);
    const enableClient = (enableEnv.createClient as any).mock.results[0].value;
    expect(enableClient.telemetry.enable).toHaveBeenCalledTimes(1);
    expect(JSON.parse(enableOut.toString())).toEqual({ state: "active", reason: null, guidPresent: true, region: "us" });
  });

  // Spec: [[arch/cli/index.md#^cli-telemetry-no-status|no telemetry status subcommand]].
  it("does not expose a telemetry status subcommand", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr });

    expect(await runCLI(["telemetry", "status"], env)).toBe(1);
    expect(env.createClient).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("Unknown tv command: telemetry status");
  });

  it("telemetry commands report an unreachable server clearly", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const createClient = vi.fn(() => ({
      ...baseClient,
      telemetry: {
        ...baseClient.telemetry,
        disable: vi.fn(async () => {
          throw new RequestError("fetch failed", { serverURL: "http://localhost:32848" });
        }),
      },
    }));

    expect(await runCLI(["telemetry", "disable"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(1);
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("Could not reach Television server at http://localhost:32848: fetch failed");
  });

  // Specs: [[arch/cli/index.md#^cli-skill-telemetry-boundary|skill telemetry]], [[arch/cli/index.md#^cli-skill-no-failure-telemetry-boundary|no failure telemetry]],
  // [[arch/cli/index.md#^cli-skill-telemetry-config-ignored|config installedByAgent ignored]].
  it("skills install emits content-free telemetry after direct and interactive success only", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-cli-skills-"));
    const bundled = path.join(root, "bundled");
    const destination = path.join(root, ".openclaw", "skills");
    const storagePath = temporaryHome({ installedByAgent: "Server Agent" });
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n");
    const previousAddSentinel = process.env.TV_CLI_TEST_ADD_SENTINEL;
    process.env.TV_CLI_TEST_ADD_SENTINEL = "/opt/path/with/add";
    const emitSkillInstalledTelemetry = vi.fn(async (_options: SkillInstallTelemetryOptions) => {});
    try {
      const directStdout = new BufferOutput();
      expect(await runCLI(["--home", storagePath, "skills", "install", destination, "--installed-by-agent", " Claude Code "], fakeEnvironment({
        stdout: directStdout,
        stderr: new BufferOutput(),
        resolveBundledSkillsRoot: () => bundled,
        emitSkillInstalledTelemetry,
      }))).toBe(0);
      expect(directStdout.toString()).not.toMatch(/telemetry/i);
      const directTelemetryOptions = emitSkillInstalledTelemetry.mock.calls[0]![0];
      expect(directTelemetryOptions.env).toBe(process.env);
      expect(telemetryFields(directTelemetryOptions)).toEqual({
        storagePath,
        version: expect.any(String),
        agentType: "openclaw",
        installedByAgent: " Claude Code ",
      });
      expect(JSON.stringify(telemetryFields(directTelemetryOptions))).not.toContain(destination);

      emitSkillInstalledTelemetry.mockClear();
      expect(await runCLI(["--home", storagePath, "skills", "install", destination], fakeEnvironment({
        stdout: new BufferOutput(),
        stderr: new BufferOutput(),
        resolveBundledSkillsRoot: () => bundled,
        emitSkillInstalledTelemetry,
      }))).toBe(0);
      expect(telemetryFields(emitSkillInstalledTelemetry.mock.calls[0]![0])).toEqual({
        storagePath,
        version: expect.any(String),
        agentType: "openclaw",
      });

      emitSkillInstalledTelemetry.mockClear();
      const runSkillsInstaller = vi.fn(async () => {});
      const interactiveStdout = new BufferOutput();
      expect(await runCLI(["--home", storagePath, "skills", "install", "-i", "--installed-by-agent", " Codex "], fakeEnvironment({
        stdout: interactiveStdout,
        stderr: new BufferOutput(),
        resolveBundledSkillsRoot: () => bundled,
        runSkillsInstaller,
        emitSkillInstalledTelemetry,
      }))).toBe(0);
      expect(interactiveStdout.toString()).not.toMatch(/telemetry/i);
      expect(runSkillsInstaller).toHaveBeenCalledWith(["add", bundled]);
      const interactiveTelemetryOptions = emitSkillInstalledTelemetry.mock.calls[0]![0];
      expect(interactiveTelemetryOptions.env).toBe(process.env);
      expect(telemetryFields(interactiveTelemetryOptions)).toEqual({
        storagePath,
        version: expect.any(String),
        agentType: "interactive-install",
        installedByAgent: " Codex ",
      });
      expect(JSON.stringify(telemetryFields(interactiveTelemetryOptions))).not.toContain(bundled);

      emitSkillInstalledTelemetry.mockClear();
      const failingInstaller = vi.fn(async () => { throw new Error("installer failed"); });
      expect(await runCLI(["skills", "install", "-i"], fakeEnvironment({
        stdout: new BufferOutput(),
        stderr: new BufferOutput(),
        resolveBundledSkillsRoot: () => bundled,
        runSkillsInstaller: failingInstaller,
        emitSkillInstalledTelemetry,
      }))).toBe(1);
      expect(emitSkillInstalledTelemetry).not.toHaveBeenCalled();
    } finally {
      if (previousAddSentinel === undefined) delete process.env.TV_CLI_TEST_ADD_SENTINEL;
      else process.env.TV_CLI_TEST_ADD_SENTINEL = previousAddSentinel;
    }
  });

  // Spec: [[arch/cli/index.md#^cli-skill-telemetry-best-effort-boundary|best-effort skill telemetry]].
  it("skills install succeeds when telemetry emission fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-skills-telemetry-fail-"));
    const bundled = path.join(root, "bundled");
    const destination = path.join(root, "dest");
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n");
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    const exitCode = await runCLI(["skills", "install", destination], fakeEnvironment({
      stdout,
      stderr,
      resolveBundledSkillsRoot: () => bundled,
      emitSkillInstalledTelemetry: vi.fn(async () => { throw new Error("telemetry failed"); }),
    }));

    expect(exitCode).toBe(0);
    expect(readFileSync(path.join(destination, "television", "SKILL.md"), "utf8")).toBe("tv\n");
    expect(stdout.toString()).toContain("Copied 1 bundled Television skill(s):");
    expect(stderr.toString()).toBe("");
  });

  // Spec: [[arch/cli/index.md#^cli-skill-telemetry-best-effort-boundary|bounded telemetry call]].
  it("skills install does not wait indefinitely for telemetry flushing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-skills-telemetry-hang-"));
    const bundled = path.join(root, "bundled");
    const destination = path.join(root, "dest");
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n");
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();

    const runPromise = runCLI(["skills", "install", destination], fakeEnvironment({
      stdout,
      stderr,
      resolveBundledSkillsRoot: () => bundled,
      emitSkillInstalledTelemetry: vi.fn(() => new Promise<void>(() => {})),
    }));
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_500));

    await expect(Promise.race([runPromise, timeout])).resolves.toBe(0);
    expect(stdout.toString()).toContain("Copied 1 bundled Television skill(s):");
    expect(stderr.toString()).toBe("");
  });

  it("skills install copies bundled skills, rejects a regular-file destination, and delegates interactive mode", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-skills-"));
    const bundled = path.join(root, "bundled");
    const destination = path.join(root, "dest");
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    mkdirSync(path.join(bundled, "tv-calendar"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n");
    writeFileSync(path.join(bundled, "tv-calendar", "SKILL.md"), "calendar\n");

    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const runSkillsInstaller = vi.fn(async () => {});
    expect(await runCLI(["skills", "install", destination], fakeEnvironment({ stdout, stderr, resolveBundledSkillsRoot: () => bundled, runSkillsInstaller }))).toBe(0);
    expect(runSkillsInstaller).not.toHaveBeenCalled();
    expect(readFileSync(path.join(destination, "television", "SKILL.md"), "utf8")).toBe("tv\n");
    expect(readFileSync(path.join(destination, "tv-calendar", "SKILL.md"), "utf8")).toBe("calendar\n");
    expect(stdout.toString()).toContain("Copied 2 bundled Television skill(s):");
    expect(stdout.toString()).toContain(`from: ${path.join(bundled, "television")}`);
    expect(stdout.toString()).toContain(`to:   ${path.join(destination, "television")}`);
    expect(stdout.toString()).toContain(`from: ${path.join(bundled, "tv-calendar")}`);
    expect(stdout.toString()).toContain(`to:   ${path.join(destination, "tv-calendar")}`);
    expect(stderr.toString()).toBe("");

    const fileDestination = path.join(root, "not-a-directory");
    writeFileSync(fileDestination, "occupied\n");
    const failureStderr = new BufferOutput();
    const emitSkillInstalledTelemetry = vi.fn(async () => {});
    expect(await runCLI(["skills", "install", fileDestination], fakeEnvironment({
      stdout: new BufferOutput(),
      stderr: failureStderr,
      resolveBundledSkillsRoot: () => bundled,
      emitSkillInstalledTelemetry,
    }))).toBe(1);
    expect(failureStderr.toString()).toContain(`Skills destination is not a directory: ${fileDestination}`);
    expect(emitSkillInstalledTelemetry).not.toHaveBeenCalled();

    const interactiveInstaller = vi.fn(async () => {});
    expect(await runCLI(["skills", "install", "-i"], fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput(), resolveBundledSkillsRoot: () => bundled, runSkillsInstaller: interactiveInstaller }))).toBe(0);
    expect(interactiveInstaller).toHaveBeenCalledWith(["add", bundled]);
  });

  it("errors clearly when skills install is missing both destination and -i", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const runSkillsInstaller = vi.fn(async () => {});

    const exitCode = await runCLI(["skills", "install"], fakeEnvironment({ stdout, stderr, resolveBundledSkillsRoot: () => "/tmp/television-skills", runSkillsInstaller }));

    expect(exitCode).toBe(1);
    expect(runSkillsInstaller).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("tv skills install requires a destination agent skills folder, or -i for interactive");
  });

  it("rejects a destination path when skills install -i is passed", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const runSkillsInstaller = vi.fn(async () => {});

    const exitCode = await runCLI(["skills", "install", "/tmp/agent-skills", "-i"], fakeEnvironment({ stdout, stderr, runSkillsInstaller }));

    expect(exitCode).toBe(1);
    expect(runSkillsInstaller).not.toHaveBeenCalled();
    expect(stderr.toString()).toContain("tv skills install -i does not take a destination path");
  });

  // Spec: [[arch/cli/index.md#^cli-stale-theme-skill-cleanup|stale standalone-theme cleanup]].
  it("skills install removes a stale tv-theme directory while preserving the bundled set", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-skills-stale-theme-"));
    try {
      const bundled = path.join(root, "bundled");
      const destination = path.join(root, "dest");
      mkdirSync(path.join(bundled, "television"), { recursive: true });
      mkdirSync(path.join(bundled, "tv-table"), { recursive: true });
      mkdirSync(path.join(destination, "tv-theme", "nested"), { recursive: true });
      writeFileSync(path.join(bundled, "television", "SKILL.md"), "television\n");
      writeFileSync(path.join(bundled, "tv-table", "SKILL.md"), "table\n");
      writeFileSync(path.join(destination, "tv-theme", "nested", "stale.txt"), "stale\n");
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();

      expect(await runCLI(["skills", "install", destination], fakeEnvironment({
        stdout,
        stderr,
        resolveBundledSkillsRoot: () => bundled,
      }))).toBe(0);

      expect(existsSync(path.join(destination, "tv-theme"))).toBe(false);
      expect(readFileSync(path.join(destination, "television", "SKILL.md"), "utf8")).toBe("television\n");
      expect(readFileSync(path.join(destination, "tv-table", "SKILL.md"), "utf8")).toBe("table\n");
      expect(stdout.toString()).toContain("Copied 2 bundled Television skill(s):");
      expect(stderr.toString()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-running skills install replaces destination folders with the current bundled copies", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-skills-reinstall-"));
    const bundled = path.join(root, "bundled");
    const destination = path.join(root, "dest");
    mkdirSync(path.join(bundled, "television"), { recursive: true });
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "first\n");

    await runCLI(["skills", "install", destination], fakeEnvironment({ resolveBundledSkillsRoot: () => bundled }));

    writeFileSync(path.join(destination, "television", "stale.txt"), "stale\n");
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "second\n");

    await runCLI(["skills", "install", destination], fakeEnvironment({ resolveBundledSkillsRoot: () => bundled }));

    expect(readFileSync(path.join(destination, "television", "SKILL.md"), "utf8")).toBe("second\n");
    expect(existsSync(path.join(destination, "television", "stale.txt"))).toBe(false);
  });



  it("help output does not instantiate a client and omits removed legacy commands", async () => {
    const stdout = new BufferOutput();
    const createClient = vi.fn();
    expect(await runCLI([], fakeEnvironment({ stdout, stderr: new BufferOutput(), createClient }))).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
    expect(stdout.toString()).not.toContain("create-markdown-artifact");
    expect(stdout.toString()).not.toContain("create-web-bundle-artifact");
    expect(stdout.toString()).not.toContain("edit-artifact");
  });

  it("help output is consistent across help, -h, and --help", async () => {
    const outputs: string[] = [];
    for (const argv of [["help"], ["-h"], ["--help"]]) {
      const stdout = new BufferOutput();
      expect(await runCLI(argv, fakeEnvironment({ stdout, stderr: new BufferOutput() }))).toBe(0);
      outputs.push(stdout.toString());
    }
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
  });

  it("set-theme requires a theme argument", async () => {
    const stderr = new BufferOutput();
    expect(await runCLI(["set-theme"], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
    expect(stderr.toString()).toContain("tv set-theme requires <theme>");
  });

  it("focus-channel requires a channel", async () => {
    const stderr = new BufferOutput();
    expect(await runCLI(["focus-channel"], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
    expect(stderr.toString()).toContain("tv focus-channel requires --channel");
  });

  it("focus-artifact requires an id", async () => {
    const stderr = new BufferOutput();
    expect(await runCLI(["focus-artifact"], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
    expect(stderr.toString()).toContain("tv focus-artifact requires --id");
  });

  it("focus-status reports display client errors", async () => {
    const stderr = new BufferOutput();
    const client = fakeEnvironment().createClient!("", "") as any;
    client.display.get.mockRejectedValueOnce(new Error("display down"));
    const env = fakeEnvironment({ stdout: new BufferOutput(), stderr, createClient: vi.fn(() => client) });
    expect(await runCLI(["focus-status"], env)).toBe(1);
    expect(stderr.toString()).toContain("display down");
  });

  it("remove-channel prints removed metadata and cascade summary", async () => {
    const stdout = new BufferOutput();
    const client = fakeEnvironment().createClient!("", "") as any;
    client.channels.remove.mockResolvedValueOnce({
      channelID: "screen-1",
      metadataPath: "/state/channels/screen-1.json",
      artifactResults: [{ outcome: "deleted", kind: "path", artifactID: "artifact-1", path: "/tmp/a.html" }],
    });
    const env = fakeEnvironment({ stdout, stderr: new BufferOutput(), createClient: vi.fn(() => client) });
    expect(await runCLI(["remove-channel", "--channel", "screen-1"], env)).toBe(0);
    expect(stdout.toString()).toContain("metadata removed: /state/channels/screen-1.json");
    expect(stdout.toString()).toContain("artifact-1: deleted");
  });

  it("list-channels, get-channel, and list-artifacts preserve JSON envelope shapes", async () => {
    const cases: Array<[string[], string]> = [
      [["list-channels"], "channels"],
      [["get-channel", "--channel", "screen-1"], "channel"],
      [["list-artifacts"], "artifacts"],
    ];
    for (const [argv, key] of cases) {
      const stdout = new BufferOutput();
      expect(await runCLI(argv, fakeEnvironment({ stdout, stderr: new BufferOutput() }))).toBe(0);
      expect(JSON.parse(stdout.toString())).toHaveProperty(key);
    }
  });

  // Specs: [[arch/cli/index.md#^74183a83|skills install]], [[arch/cli/index.md#^25c28caa|skills installer boundary]].
  it("skills install reports missing destination, conflicting interactive destination, and unknown options", async () => {
    const missing = new BufferOutput();
    expect(await runCLI(["skills", "install"], fakeEnvironment({ stdout: new BufferOutput(), stderr: missing }))).toBe(1);
    expect(missing.toString()).toContain("tv skills install requires a destination");

    const conflict = new BufferOutput();
    expect(await runCLI(["skills", "install", "-i", "/tmp/skills"], fakeEnvironment({ stdout: new BufferOutput(), stderr: conflict, resolveBundledSkillsRoot: () => "/tmp/bundled" }))).toBe(1);
    expect(conflict.toString()).toContain("does not take a destination path");

    const unknown = new BufferOutput();
    const runSkillsInstaller = vi.fn(async () => {});
    expect(await runCLI(["skills", "install", "/tmp/skills", "--bogus"], fakeEnvironment({ stdout: new BufferOutput(), stderr: unknown, resolveBundledSkillsRoot: () => "/tmp/bundled", runSkillsInstaller }))).toBe(1);
    expect(runSkillsInstaller).not.toHaveBeenCalled();
    expect(unknown.toString()).toContain("tv skills install /tmp/skills --bogus does not support --bogus");
    expect(unknown.toString()).toContain(SKILL_POINTER);
  });

  it("serve --persist installs a daemon with PATH, telemetry and update-channel env, and every connect URL", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const home = temporaryHome({ port: 43123, listen: ["100.64.0.7"], installedByAgent: " Claude Code " });
    const developerHome = mkdtempSync(path.join(os.tmpdir(), "television-cli-developer-home-"));
    const previous = {
      PATH: process.env.PATH,
      TELEVISION_ACP_AGENT: process.env.TELEVISION_ACP_AGENT,
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
      TV_TELEMETRY_TEST: process.env.TV_TELEMETRY_TEST,
      TELEVISION_TELEMETRY_BUILD: process.env.TELEVISION_TELEMETRY_BUILD,
      TV_UPDATE_CHANNEL_URL: process.env.TV_UPDATE_CHANNEL_URL,
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS,
    };
    process.env.PATH = "/custom/bin:/usr/bin";
    process.env.DO_NOT_TRACK = "1";
    process.env.CI = "true";
    process.env.TV_TELEMETRY_TEST = "1";
    process.env.TELEVISION_TELEMETRY_BUILD = "production";
    process.env.TV_UPDATE_CHANNEL_URL = "http://127.0.0.1:8399/update-channel.json";
    process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS = "2000";
    delete process.env.TELEVISION_ACP_AGENT;
    const install = vi.fn(async () => {});
    const uninstall = vi.fn(async () => {});
    const status = vi.fn(async () => ({ installed: false, running: false }));
    const createDaemon = vi.fn(() => ({ install, uninstall, status }));
    try {
      expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon, resolveHomeDir: () => developerHome }))).toBe(0);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(developerHome, { recursive: true, force: true });
    }
    expect(createDaemon).toHaveBeenCalledWith({
      home,
      env: {
        PATH: "/custom/bin:/usr/bin",
        TELEVISION_DEVELOPER_HOME: developerHome,
        DO_NOT_TRACK: "1",
        CI: "true",
        TV_TELEMETRY_TEST: "1",
        TV_UPDATE_CHANNEL_URL: "http://127.0.0.1:8399/update-channel.json",
        TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: "2000",
        TELEVISION_LAUNCH_MODE: "daemon",
      },
    });
    expect(status).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(uninstall).not.toHaveBeenCalled();
    const output = stdout.toString();
    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("Television service installed.");
    expect(output).toContain("http://127.0.0.1:43123/?token=");
    expect(output).toContain("http://100.64.0.7:43123/?token=");
    expect(output).not.toContain("\u001B");
    expect(stderr.toString()).toBe("");
  });

  it("serve --persist resolves a relative --home before embedding it in the daemon", async () => {
    // A persisted daemon's working directory is not the installing shell's,
    // so a relative home embedded verbatim in the daemon's serve args would
    // resolve to a different directory on every boot.
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const home = temporaryHome({ listen: ["0.0.0.0"] });
    const relative = path.relative(process.cwd(), home);
    expect(path.isAbsolute(relative)).toBe(false);
    const install = vi.fn(async () => {});
    const status = vi.fn(async () => ({ installed: false, running: false }));
    const createDaemon = vi.fn((_: { home?: string } = {}) => ({ install, uninstall: vi.fn(async () => {}), status }));

    expect(await runCLI(["--home", relative, "serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(0);

    expect(install).toHaveBeenCalledTimes(1);
    expect(createDaemon.mock.calls[0]?.[0]?.home).toBe(home);
  });

  it("serve --persist installs a daemon with the requested server options and ACP env snapshot", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const home = temporaryHome({ port: 43123, listen: ["0.0.0.0"] });
    const binDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-bin-"));
    const developerHome = mkdtempSync(path.join(os.tmpdir(), "television-cli-developer-home-"));
    const openclawPath = path.join(binDir, "openclaw");
    writeFileSync(openclawPath, "#!/bin/sh\nexit 0\n");
    chmodSync(openclawPath, 0o755);
    const previous = {
      PATH: process.env.PATH,
      TELEVISION_ACP_AGENT: process.env.TELEVISION_ACP_AGENT,
      OPENCLAW_API_KEY: process.env.OPENCLAW_API_KEY,
      OPENCLAW_HOME: process.env.OPENCLAW_HOME,
      HERMES_API_KEY: process.env.HERMES_API_KEY,
      HOME: process.env.HOME,
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
      TV_TELEMETRY_TEST: process.env.TV_TELEMETRY_TEST,
      TELEVISION_TELEMETRY_BUILD: process.env.TELEVISION_TELEMETRY_BUILD,
      TV_UPDATE_CHANNEL_URL: process.env.TV_UPDATE_CHANNEL_URL,
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS,
    };
    process.env.PATH = `${binDir}:/usr/bin`;
    process.env.TELEVISION_ACP_AGENT = "openclaw";
    process.env.OPENCLAW_API_KEY = "openclaw-key";
    process.env.OPENCLAW_HOME = "/opt/openclaw";
    process.env.HERMES_API_KEY = "hermes-key";
    process.env.HOME = "/Users/alice";
    process.env.DO_NOT_TRACK = "1";
    process.env.CI = "true";
    process.env.TV_TELEMETRY_TEST = "1";
    process.env.TELEVISION_TELEMETRY_BUILD = "production";
    delete process.env.TV_UPDATE_CHANNEL_URL;
    delete process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS;
    const install = vi.fn(async () => {});
    const status = vi.fn(async () => ({ installed: false, running: false }));
    const createDaemon = vi.fn((_: { env?: Record<string, string> } = {}) => ({ install, uninstall: vi.fn(async () => {}), status }));
    try {
      expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon, resolveHomeDir: () => developerHome }))).toBe(0);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(developerHome, { recursive: true, force: true });
    }
    expect(createDaemon).toHaveBeenCalledWith({
      home,
      env: {
        PATH: `${binDir}:/usr/bin`,
        TELEVISION_DEVELOPER_HOME: developerHome,
        TELEVISION_ACP_AGENT: "openclaw",
        OPENCLAW_API_KEY: "openclaw-key",
        OPENCLAW_HOME: "/opt/openclaw",
        DO_NOT_TRACK: "1",
        CI: "true",
        TV_TELEMETRY_TEST: "1",
        TELEVISION_LAUNCH_MODE: "daemon",
      },
    });
    const daemonOptions = createDaemon.mock.calls[0]?.[0] as { env?: Record<string, string> };
    expect(daemonOptions.env).not.toHaveProperty("HOME");
    expect(daemonOptions.env).not.toHaveProperty("HERMES_API_KEY");
    expect(status).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    const output = stdout.toString();
    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("Television service installed.");
    expect(output).toContain("http://0.0.0.0:43123/?token=");
    expect(output).not.toContain("\u001B");
    const installRecord = readLogRecords(home).find((record) => record.msg === "persisted service installed");
    expect(installRecord?.execStart).toEqual([process.execPath, process.argv[1] ?? "tv", "--home", home, "serve"]);
    expect(installRecord?.env).toEqual({
      PATH: `${binDir}:/usr/bin`,
      TELEVISION_DEVELOPER_HOME: developerHome,
      TELEVISION_ACP_AGENT: "openclaw",
      OPENCLAW_API_KEY: "[redacted]",
      OPENCLAW_HOME: "[redacted]",
      DO_NOT_TRACK: "1",
      CI: "true",
      TV_TELEMETRY_TEST: "1",
      TELEVISION_LAUNCH_MODE: "daemon",
    });
    expect(JSON.stringify(installRecord)).not.toContain("openclaw-key");
    expect(JSON.stringify(installRecord)).not.toContain("/opt/openclaw");
    expect(stderr.toString()).toBe("");
  });

  it("serve --persist logs redacted env when daemon install fails", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const home = temporaryHome({ listen: ["0.0.0.0"] });
    const binDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-bin-"));
    const openclawPath = path.join(binDir, "openclaw");
    writeFileSync(openclawPath, "#!/bin/sh\nexit 0\n");
    chmodSync(openclawPath, 0o755);
    const previous = {
      PATH: process.env.PATH,
      TELEVISION_ACP_AGENT: process.env.TELEVISION_ACP_AGENT,
      OPENCLAW_API_KEY: process.env.OPENCLAW_API_KEY,
      OPENCLAW_HOME: process.env.OPENCLAW_HOME,
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
      TV_TELEMETRY_TEST: process.env.TV_TELEMETRY_TEST,
      TELEVISION_TELEMETRY_BUILD: process.env.TELEVISION_TELEMETRY_BUILD,
    };
    process.env.PATH = binDir;
    process.env.TELEVISION_ACP_AGENT = "openclaw";
    process.env.OPENCLAW_API_KEY = "openclaw-key";
    process.env.OPENCLAW_HOME = "/opt/openclaw";
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    delete process.env.TV_TELEMETRY_TEST;
    delete process.env.TELEVISION_TELEMETRY_BUILD;
    const install = vi.fn(async () => { throw new Error("install boom"); });
    const status = vi.fn(async () => ({ installed: false, running: false }));
    const createDaemon = vi.fn(() => ({ install, uninstall: vi.fn(async () => {}), status }));
    try {
      expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(1);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    const installRecord = readLogRecords(home).find((record) => record.msg === "persisted service install failed");
    expect(installRecord).toEqual(expect.objectContaining({ outcome: "error" }));
    expect(installRecord?.env).toEqual(expect.objectContaining({ OPENCLAW_API_KEY: "[redacted]", OPENCLAW_HOME: "[redacted]" }));
    expect(JSON.stringify(installRecord)).not.toContain("openclaw-key");
    expect(JSON.stringify(installRecord)).not.toContain("/opt/openclaw");
    expect(stderr.toString()).toContain("install boom");
  });

  it("status omits daemon when platform is unsupported", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const health = vi.fn(async () => ({ status: "ok", version: "0.1.180", bindAddresses: ["127.0.0.1"], port: 32848 }));
    const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));
    const createDaemon = vi.fn(() => ({
      install: vi.fn(async () => {}),
      uninstall: vi.fn(async () => {}),
      status: vi.fn(async () => { throw new Error("not supported on this platform"); }),
    }));

    const home = temporaryHome();
    expect(await runCLI(["--home", home, "status"], fakeEnvironment({ stdout, stderr, createClient, createDaemon }))).toBe(0);

    expect(createClient).toHaveBeenCalledWith("http://localhost:32848", undefined);
    expect(JSON.parse(stdout.toString())).toEqual({
      home,
      serverURL: "http://localhost:32848",
      healthy: true,
      version: "0.1.180",
      bindAddresses: ["127.0.0.1"],
      port: 32848,
      telemetry: { state: "active", reason: null, guidPresent: true, region: "us" },
    });
    expect(stderr.toString()).toBe("");
  });

  // Specs: [[arch/cli/index.md#^cli-status-telemetry-failure-boundary|status probe tolerance]],
  // [[product/versioning.md#^pv-machine-boundary|version pass-through]].
  it("status keeps health and version fields when the telemetry probe fails", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const baseClient = fakeEnvironment().createClient!("", "") as any;
    const health = vi.fn(async () => ({
      status: "ok",
      version: "0.1.180",
      bindAddresses: ["127.0.0.1"],
      port: 32848,
    }));
    const telemetryStatus = vi.fn(async () => { throw new Error("telemetry unavailable"); });
    const createClient = vi.fn(() => ({
      ...baseClient,
      health,
      telemetry: { ...baseClient.telemetry, status: telemetryStatus },
    }));

    expect(await runCLI(["status"], fakeEnvironment({ stdout, stderr, createClient }))).toBe(0);

    expect(JSON.parse(stdout.toString())).toMatchObject({
      serverURL: "http://localhost:32848",
      healthy: true,
      version: "0.1.180",
      bindAddresses: ["127.0.0.1"],
      port: 32848,
    });
    expect(JSON.parse(stdout.toString())).not.toHaveProperty("telemetry");
    expect(stderr.toString()).toBe("");
  });

  // Specs: [[arch/cli/index.md#^96862252|status]], [[arch/cli/index.md#^cli-status-home|status home]].
  it("status reports not healthy when server is unreachable", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const health = vi.fn(async () => { throw new Error("connect ECONNREFUSED"); });
    const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));
    const daemonStatus = vi.fn(async () => ({ installed: false, running: false }));
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: daemonStatus }));

    const home = temporaryHome();
    expect(await runCLI(["--home", home, "status"], fakeEnvironment({ stdout, stderr, createClient, createDaemon }))).toBe(0);

    expect(createClient).toHaveBeenCalledWith("http://localhost:32848", undefined);
    expect(JSON.parse(stdout.toString())).toEqual({ home, serverURL: "http://localhost:32848", healthy: false, daemon: { installed: false, running: false } });
    expect(stderr.toString()).toBe("");
  });

  // Specs: [[arch/cli/index.md#^cli-status-version-pass-through|status version pass-through]],
  // [[product/versioning.md#^pv-machine-boundary|version pass-through]].
  it("status reports the server's release version alongside health", async () => {
    // The upgrade-verification read (docs/guides/television-admin-guide.md "Verify
    // health"): tv status is how an agent confirms which version a daemon
    // actually runs, via /health's version field
    // (specs/arch/updates/version-advertisement.md ^health-version).
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const health = vi.fn(async () => ({ status: "ok", version: "0.1.180", bindAddresses: ["127.0.0.1"], port: 32848 }));
    const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: vi.fn(async () => ({ installed: true, running: true })) }));
    const home = temporaryHome();

    expect(await runCLI(["--home", home, "status"], fakeEnvironment({ stdout, stderr, createClient, createDaemon }))).toBe(0);

    expect(JSON.parse(stdout.toString())).toEqual({
      home,
      serverURL: "http://localhost:32848",
      healthy: true,
      version: "0.1.180",
      bindAddresses: ["127.0.0.1"],
      port: 32848,
      telemetry: { state: "active", reason: null, guidPresent: true, region: "us" },
      daemon: { installed: true, running: true },
    });
    expect(stderr.toString()).toBe("");
  });

  // Specs: [[arch/cli/index.md#^cli-status-version-pass-through|status version pass-through]],
  // [[product/versioning.md#^pv-machine-boundary|version pass-through]].
  it.each([
    ["0.0.0", "0.0.0"],
    [undefined, undefined],
  ])("status passes through development and absent server versions", async (expectedVersion, serverVersion) => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const health = vi.fn(async () => ({
      status: "ok",
      ...(serverVersion === undefined ? {} : { version: serverVersion }),
      bindAddresses: ["127.0.0.1"],
      port: 32848,
    }));
    const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: vi.fn(async () => ({ installed: true, running: true })) }));

    expect(await runCLI(["status"], fakeEnvironment({ stdout, stderr, createClient, createDaemon }))).toBe(0);

    const result = JSON.parse(stdout.toString());
    expect(result.healthy).toBe(true);
    if (expectedVersion === undefined) expect(result).not.toHaveProperty("version");
    else expect(result.version).toBe(expectedVersion);
    expect(stderr.toString()).toBe("");
  });

  // Specs: [[arch/cli/index.md#^96862252|status]], [[arch/cli/index.md#^cli-status-home|status home]].
  it("status reports healthy and daemon status when server is reachable", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const health = vi.fn(async () => ({ status: "ok", version: "0.1.180", bindAddresses: ["127.0.0.1", "127.0.0.2"], port: 32848 }));
    const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));
    const daemonStatus = vi.fn(async () => ({ installed: true, running: true }));
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: daemonStatus }));
    const home = temporaryHome();

    expect(await runCLI(["--home", home, "status"], fakeEnvironment({ stdout, stderr, createClient, createDaemon }))).toBe(0);

    expect(health).toHaveBeenCalledTimes(1);
    expect(daemonStatus).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("http://localhost:32848", undefined);
    expect(JSON.parse(stdout.toString())).toEqual({
      home,
      serverURL: "http://localhost:32848",
      healthy: true,
      version: "0.1.180",
      bindAddresses: ["127.0.0.1", "127.0.0.2"],
      port: 32848,
      telemetry: { state: "active", reason: null, guidPresent: true, region: "us" },
      daemon: { installed: true, running: true },
    });
    expect(stderr.toString()).toBe("");
  });

  it("stop calls daemon.uninstall and prints JSON", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const uninstall = vi.fn(async () => {});
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall, status: vi.fn(async () => ({ installed: true, running: true })) }));

    expect(await runCLI(["stop"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(0);

    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout.toString())).toEqual({ status: "stopped" });
    expect(stderr.toString()).toBe("");
  });

  it("serve --persist-uninstall calls daemon.uninstall without installing", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const storagePath = temporaryHome();
    const install = vi.fn(async () => {});
    const uninstall = vi.fn(async () => {});
    const createDaemon = vi.fn(() => ({ install, uninstall, status: vi.fn(async () => ({ installed: true, running: true })) }));

    expect(await runCLI(["--home", storagePath, "serve", "--persist-uninstall"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(0);

    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.toString())).toEqual({ status: "stopped" });
    expect(readLogRecords(storagePath).find((record) => record.msg === "persisted service uninstalled")).toEqual(expect.objectContaining({ daemonName: "com.television.server", outcome: "uninstalled" }));
    expect(stderr.toString()).toBe("");
  });

  // Spec: [[arch/cli/index.md#^649f6f4b|daemon port zero guard]].
  it("serve --persist rejects port 0 before daemon creation", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const home = temporaryHome({ port: 0 });
    const configPath = path.join(home, "config.json");
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: vi.fn(async () => ({ installed: false, running: false })) }));

    expect(await runCLI(["serve", "--persist", "--home", home], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(1);

    expect(createDaemon).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain(
      `tv serve --persist --home ${home} requires a stable port, but ${configPath} sets port 0. Choose one with \`tv config set port <number>\`.`,
    );
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  // Spec: [[arch/cli/index.md#^cli-persist-health-check-contract|persist health check]].
  it("serve --persist prints startup output only after a health call resolves", async () => {
    vi.useFakeTimers();
    try {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const home = temporaryHome({ port: 43123, listen: ["100.64.0.7"] });
      writeToken(home, " token-123\n");
      const daemon = fakeDaemon();
      daemon.install.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 1_000)));
      const stdoutAtEachHealthCall: string[] = [];
      let healthCalls = 0;
      // The third call answers with fields that match nothing about the
      // installation: any resolved call is the whole test.
      const health = vi.fn(async () => {
        stdoutAtEachHealthCall.push(stdout.toString());
        healthCalls += 1;
        if (healthCalls < 3) throw new Error("connect ECONNREFUSED");
        return { status: "ok", version: "9.9.9", bindAddresses: ["10.0.0.9"], port: 1 };
      });
      const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));

      const run = runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon: daemon.createDaemon, createClient }));
      await vi.advanceTimersByTimeAsync(999);
      expect(daemon.install).toHaveBeenCalledTimes(1);
      expect(health).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(await run).toBe(0);
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(createClient).toHaveBeenCalledWith("http://localhost:43123", "token-123");
      expect(health).toHaveBeenCalledTimes(3);
      expect(stdoutAtEachHealthCall).toEqual(["", "", ""]);
      expect(stdout.toString()).toBe(
        "Television service installed.\nOpen Television:\n  http://127.0.0.1:43123/?token=token-123\n  http://100.64.0.7:43123/?token=token-123\n",
      );
      expect(stderr.toString()).toBe("");
      expect(readLogRecords(home).filter((record) => record.msg === "persisted service did not respond")).toEqual([]);

      const failedInstall = fakeDaemon();
      failedInstall.install.mockRejectedValue(new Error("launchctl load failed"));
      const failedHealth = vi.fn(async () => ({ status: "ok", bindAddresses: ["127.0.0.1"], port: 43123 }));
      const failedStdout = new BufferOutput();
      expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({
        stdout: failedStdout,
        stderr: new BufferOutput(),
        createDaemon: failedInstall.createDaemon,
        createClient: vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health: failedHealth })),
      }))).toBe(1);
      expect(failedHealth).not.toHaveBeenCalled();
      expect(failedStdout.toString()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-persist-health-timeout-contract|persist health timeout]].
  it.each([
    { label: "rejects on every call", health: async () => { throw new Error("connect ECONNREFUSED"); } },
    { label: "never settles", health: () => new Promise<never>(() => {}) },
  ])("serve --persist fails at the 15-second deadline when health $label", async ({ health: answer }) => {
    vi.useFakeTimers();
    try {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const home = temporaryHome({ port: 43123 });
      const daemon = fakeDaemon();
      let installedAt: number | undefined;
      daemon.install.mockImplementation(() => new Promise<void>((resolve) => setTimeout(() => {
        installedAt = Date.now();
        resolve();
      }, 1_000)));
      const health = vi.fn(answer);
      const createClient = vi.fn(() => ({ ...(fakeEnvironment().createClient!("", "") as any), health }));
      let settled = false;

      const run = runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon: daemon.createDaemon, createClient }));
      void run.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(daemon.install).toHaveBeenCalledTimes(1);
      expect(installedAt).toBeUndefined();
      expect(health).not.toHaveBeenCalled();
      // The install resolves at 1,000 ms; the deadline counts from there.
      await vi.advanceTimersByTimeAsync(1 + 14_999);
      expect(installedAt).toBeDefined();
      expect(Date.now() - installedAt!).toBe(14_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(settled).toBe(true);
      expect(await run).toBe(1);
      expect(stdout.toString()).toBe("");
      expect(stderr.toString()).toBe(
        `Television service installed, but the server did not respond at http://localhost:43123 within 15 seconds. The service remains installed. See ${path.join(home, "logs", "tv.log")} for the cause.\n`,
      );
      expect(readLogRecords(home).filter((record) => record.msg === "persisted service did not respond")).toEqual([
        expect.objectContaining({ daemonName: "com.television.server", healthURL: "http://localhost:43123/health", timeoutMs: 15_000 }),
      ]);
      expect(daemon.install).toHaveBeenCalledTimes(1);
      expect(daemon.uninstall).not.toHaveBeenCalled();
      expect(health).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serve --persist refreshes an installed daemon before installing", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const install = vi.fn(async () => {});
    const uninstall = vi.fn(async () => {});
    const status = vi.fn(async () => ({ installed: true, running: false }));
    const createDaemon = vi.fn(() => ({ install, uninstall, status }));

    expect(await runCLI(["serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(0);

    expect(status).toHaveBeenCalledTimes(1);
    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(uninstall.mock.invocationCallOrder[0]).toBeLessThan(install.mock.invocationCallOrder[0]!);
    expect(stderr.toString()).toBe("");
  });

  it("serve --persist fails before daemon creation when the ACP binary is missing from the persisted PATH", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const emptyPathDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-empty-bin-"));
    const previous = { PATH: process.env.PATH, TELEVISION_ACP_AGENT: process.env.TELEVISION_ACP_AGENT };
    process.env.PATH = emptyPathDir;
    process.env.TELEVISION_ACP_AGENT = "hermes";
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: vi.fn(async () => ({ installed: false, running: false })) }));
    try {
      expect(await runCLI(["serve", "--persist"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(1);
    } finally {
      if (previous.PATH === undefined) delete process.env.PATH; else process.env.PATH = previous.PATH;
      if (previous.TELEVISION_ACP_AGENT === undefined) delete process.env.TELEVISION_ACP_AGENT; else process.env.TELEVISION_ACP_AGENT = previous.TELEVISION_ACP_AGENT;
    }
    expect(createDaemon).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("Could not find ACP agent command `hermes` for `TELEVISION_ACP_AGENT=hermes` on the persisted PATH.");
  });

  it("serve rejects conflicting persist install and uninstall flags", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const createDaemon = vi.fn(() => ({ install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), status: vi.fn(async () => ({ installed: false, running: false })) }));

    expect(await runCLI(["serve", "--persist", "--persist-uninstall"], fakeEnvironment({ stdout, stderr, createDaemon }))).toBe(1);

    expect(createDaemon).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("Use either `--persist` or `--persist-uninstall`, not both.");
  });

  // ^t-exit-propagation
  it("propagates bind failure exit status while ordinary serve errors remain status 1", async () => {
    const bindFailureHome = temporaryHome({ port: 0, auth: false, listen: ["192.0.2.1"] });
    const invalidConfigHome = temporaryHome("{\"port\": 0,");
    const operatingSystemHome = temporaryDirectory("television-cli-bind-failure-os-home-");
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const ordinaryStderr = new BufferOutput();
    const previousAgent = process.env.TELEVISION_ACP_AGENT;
    delete process.env.TELEVISION_ACP_AGENT;

    try {
      const bindExitCode = await runRawCLI(["--home", bindFailureHome, "serve"], { stdout, stderr, resolveHomeDir: () => operatingSystemHome });
      expect(bindExitCode).toBe(69);
      expect(stderr.toString()).toContain("Television could not bind all required listeners");

      const ordinaryExitCode = await runRawCLI(["--home", invalidConfigHome, "serve"], {
        stdout: new BufferOutput(),
        stderr: ordinaryStderr,
        resolveHomeDir: () => operatingSystemHome,
      });
      expect(ordinaryExitCode).toBe(1);
      expect(ordinaryStderr.toString()).toContain(path.join(invalidConfigHome, "config.json"));
    } finally {
      if (previousAgent === undefined) delete process.env.TELEVISION_ACP_AGENT;
      else process.env.TELEVISION_ACP_AGENT = previousAgent;
    }
  });

  it("serve passes every resolved asset directory and daemon launch mode, then disposes only on the first signal", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const start = vi.fn(async function (this: any) { return this; });
    let finishDispose!: () => void;
    const dispose = vi.fn(async () => new Promise<void>((resolve) => { finishDispose = resolve; }));
    const createServer = vi.fn(() => ({ start, dispose, getBaseURL: vi.fn(() => "http://localhost:43123"), getBaseURLs: vi.fn(() => ["http://localhost:43123"]), getAuthToken: vi.fn(() => "token-123") }) as any);
    const previousLaunchMode = process.env.TELEVISION_LAUNCH_MODE;
    process.env.TELEVISION_LAUNCH_MODE = "daemon";

    try {
      const runPromise = runCLI(["serve"], fakeEnvironment({
        stdout,
        stderr,
        createServer,
        resolveStaticDir: () => "/tmp/television-browser",
        resolveCanonicalDir: () => "/tmp/television-canonical",
        resolveBundledViewsPath: () => "/tmp/television-views",
        resolveOnboardingContentPath: () => "/tmp/television-onboarding",
        resolveBundledThemesPath: () => "/tmp/television-themes",
        onSignal: vi.fn((signal, handler) => { signalHandlers.set(signal, handler); }),
      }));
      await vi.waitFor(() => {
        expect(createServer).toHaveBeenCalledWith(expect.objectContaining({
          staticDir: "/tmp/television-browser",
          canonicalDir: "/tmp/television-canonical",
          bundledViewsPath: "/tmp/television-views",
          onboardingContentPath: "/tmp/television-onboarding",
          bundledThemesPath: "/tmp/television-themes",
          launchMode: "daemon",
        }));
        expect([...signalHandlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
      });

      signalHandlers.get("SIGTERM")?.();
      await vi.waitFor(() => { expect(dispose).toHaveBeenCalledWith("SIGTERM"); });
      signalHandlers.get("SIGINT")?.();
      expect(dispose).toHaveBeenCalledTimes(1);
      finishDispose();
      await expect(runPromise).resolves.toBe(0);
      expect(stderr.toString()).toBe("");
    } finally {
      if (previousLaunchMode === undefined) delete process.env.TELEVISION_LAUNCH_MODE;
      else process.env.TELEVISION_LAUNCH_MODE = previousLaunchMode;
    }
  });

  // Specs: [[arch/cli/index.md#^0ffa0d0d|foreground serve port zero]], [[arch/cli/index.md#^cli-port-zero-warning-text|port zero warning text]].
  it("serve warns but supports explicit port 0 in the foreground", async () => {
    expect(PORT_ZERO_WARNING).toBe(
      "WARNING: config port 0 lets the operating system choose this server's port. Commands that contact this server must pass --port <port>, using the port from the startup URL.",
    );
    for (const [config, warns] of [[{ port: 0 }, true], [{ port: 43124 }, false]] as const) {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const signalHandlers = new Map<NodeJS.Signals, () => void>();
      let stderrWhenCreated: string | undefined;
      const start = vi.fn(async function (this: any) { return this; });
      const dispose = vi.fn(async () => {});
      const getBaseURL = vi.fn(() => "http://127.0.0.1:43124");
      const getBaseURLs = vi.fn(() => ["http://127.0.0.1:43124"]);
      const createServer = vi.fn(() => {
        stderrWhenCreated = stderr.toString();
        return { start, dispose, getBaseURL, getBaseURLs, getAuthToken: vi.fn(() => "token-123") } as any;
      });
      const runPromise = runCLI(["--home", temporaryHome(config), "serve"], fakeEnvironment({ stdout, stderr, createServer, onSignal: vi.fn((signal, handler) => { signalHandlers.set(signal, handler); }) }));
      await vi.waitFor(() => { expect(createServer).toHaveBeenCalledWith(expect.objectContaining({ port: config.port })); });
      signalHandlers.get("SIGTERM")?.();
      await expect(runPromise).resolves.toBe(0);
      if (warns) {
        expect(stderrWhenCreated).toBe(`${PORT_ZERO_WARNING}\n`);
      } else {
        expect(stderr.toString()).not.toContain("config port 0");
      }
    }
  });

  // Spec: [[arch/cli/index.md#^cli-serve-config-options|serve settings come from the config file]].
  it("serve passes the home and its config settings to createServer", async () => {
    const previousLaunchMode = process.env.TELEVISION_LAUNCH_MODE;
    const configuredHome = temporaryHome({ listen: ["127.0.0.2"], port: 43123, auth: true, installedByAgent: " Claude Code " });
    const relativeHome = path.relative(process.cwd(), configuredHome);
    expect(path.isAbsolute(relativeHome)).toBe(false);
    const unconfiguredHome = path.join(temporaryDirectory("television-cli-serve-"), "no-config-home");
    const cases: Array<{ argv: string[]; launchMode: string | undefined; expected: Record<string, unknown> }> = [
      {
        argv: ["--home", relativeHome, "serve"],
        launchMode: "unexpected-value",
        expected: { home: configuredHome, listen: ["127.0.0.2"], port: 43123, auth: true, installedByAgent: " Claude Code ", launchMode: "cli" },
      },
      {
        argv: ["--home", unconfiguredHome, "serve"],
        launchMode: undefined,
        expected: { home: unconfiguredHome, listen: [], port: 32848, auth: true, launchMode: "cli" },
      },
      {
        argv: ["--home", unconfiguredHome, "serve"],
        launchMode: "daemon",
        expected: { home: unconfiguredHome, listen: [], port: 32848, auth: true, launchMode: "daemon" },
      },
    ];

    try {
      for (const { argv, launchMode, expected } of cases) {
        if (launchMode === undefined) delete process.env.TELEVISION_LAUNCH_MODE;
        else process.env.TELEVISION_LAUNCH_MODE = launchMode;
        const stdout = new BufferOutput();
        const signalHandlers = new Map<NodeJS.Signals, () => void>();
        const createServer = vi.fn(() => ({
          start: vi.fn(async function (this: any) { return this; }),
          dispose: vi.fn(async () => {}),
          getBaseURL: vi.fn(() => "http://127.0.0.1:43123"),
          getBaseURLs: vi.fn(() => ["http://127.0.0.1:43123"]),
          getAuthToken: vi.fn(() => "token-123"),
        }) as any);
        const runPromise = runCLI(argv, fakeEnvironment({ stdout, stderr: new BufferOutput(), createServer, onSignal: vi.fn((signal, handler) => { signalHandlers.set(signal, handler); }) }));
        await vi.waitFor(() => { expect(createServer).toHaveBeenCalled(); });
        signalHandlers.get("SIGTERM")?.();
        await expect(runPromise).resolves.toBe(0);
        const options = (createServer.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
        expect(options).toMatchObject(expected);
        if (!("installedByAgent" in expected)) expect(options).not.toHaveProperty("installedByAgent");
        expect(stdout.toString()).toContain("http://127.0.0.1:43123/?token=token-123");
      }
    } finally {
      if (previousLaunchMode === undefined) delete process.env.TELEVISION_LAUNCH_MODE;
      else process.env.TELEVISION_LAUNCH_MODE = previousLaunchMode;
    }
  });

  it("serve starts without ACP when no agent is configured", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const start = vi.fn(async function (this: any) { return this; });
    const dispose = vi.fn(async () => {});
    const getBaseURL = vi.fn(() => "http://127.0.0.1:43123");
    const getBaseURLs = vi.fn(() => ["http://127.0.0.1:43123"]);
    const getAuthToken = vi.fn(() => "token-123");
    const createServer = vi.fn(() => ({ start, dispose, getBaseURL, getBaseURLs, getAuthToken }) as any);
    const previousAgent = process.env.TELEVISION_ACP_AGENT;
    delete process.env.TELEVISION_ACP_AGENT;

    const runPromise = runCLI(["serve"], fakeEnvironment({ stdout, stderr, createServer, onSignal: vi.fn((signal, handler) => { signalHandlers.set(signal, handler); }) }));
    await vi.waitFor(() => { expect(createServer).toHaveBeenCalledWith(expect.not.objectContaining({ acpProfile: expect.anything() })); });
    signalHandlers.get("SIGTERM")?.();
    await expect(runPromise).resolves.toBe(0);
    if (previousAgent === undefined) delete process.env.TELEVISION_ACP_AGENT; else process.env.TELEVISION_ACP_AGENT = previousAgent;

    expect(start).toHaveBeenCalledTimes(1);
    const output = stdout.toString();
    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("Television server running.");
    expect(output).toContain("http://127.0.0.1:43123/?token=token-123");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(stderr.toString()).toBe("");
  });

  it("serve fails before server creation when the ACP agent binary is not on PATH", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const emptyPathDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-empty-bin-"));
    const previous = { PATH: process.env.PATH, TELEVISION_ACP_AGENT: process.env.TELEVISION_ACP_AGENT };
    process.env.PATH = emptyPathDir;
    process.env.TELEVISION_ACP_AGENT = "openclaw";
    const createServer = vi.fn(() => { throw new Error("createServer should not be called"); });
    try {
      expect(await runCLI(["serve"], fakeEnvironment({ stdout, stderr, createServer: createServer as never }))).toBe(1);
    } finally {
      if (previous.PATH === undefined) delete process.env.PATH; else process.env.PATH = previous.PATH;
      if (previous.TELEVISION_ACP_AGENT === undefined) delete process.env.TELEVISION_ACP_AGENT; else process.env.TELEVISION_ACP_AGENT = previous.TELEVISION_ACP_AGENT;
    }
    expect(createServer).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("Could not find ACP agent command `openclaw` for `TELEVISION_ACP_AGENT=openclaw` on PATH.");
    expect(stderr.toString()).toContain("TELEVISION_ACP_AGENT");
    expect(stderr.toString()).toContain("PATH");
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  it("serve rejects the removed --public flag", async () => {
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const createServer = vi.fn(() => { throw new Error("createServer should not be called"); });

    expect(await runCLI(["serve", "--public"], fakeEnvironment({ stdout, stderr, createServer: createServer as never }))).toBe(1);

    expect(createServer).not.toHaveBeenCalled();
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toContain("--public");
  });

});

const TOKENLESS_WARNING = "WARNING: running without an auth token. Tokenless mode is insecure for typical setups — be sure you mean to run without authentication. Run `tv config set auth true` and restart to require the bearer token.";
const CONFIG_SET_RESTART_LINE = "Restart foreground `tv serve`, or rerun `tv serve --persist`, for a running server to use the new settings.";

/** Every command that contacts the server, with the other arguments it requires. */
const SERVER_COMMANDS: string[][] = [
  ["create-path-artifact", "--channel", "screen-1", "--title", "A", "--path", "/tmp/a.md", "--no-focus"],
  ["create-url-artifact", "--channel", "screen-1", "--title", "U", "--url", "https://example.com", "--no-focus"],
  ["update-artifact", "--id", "artifact-1", "--title", "T"],
  ["delete-artifact", "--id", "artifact-1"],
  ["get-artifact", "--id", "artifact-1"],
  ["list-artifacts"],
  ["create-channel", "--name", "New", "--no-focus"],
  ["update-channel", "--channel", "screen-1", "--name", "Renamed"],
  ["remove-channel", "--channel", "screen-1"],
  ["list-channels"],
  ["get-channel", "--channel", "screen-1"],
  ["focus-status"],
  ["focus-channel", "--channel", "screen-1"],
  ["set-theme", "paperlike"],
  ["focus-artifact", "--id", "artifact-1"],
  ["telemetry", "enable"],
  ["telemetry", "disable"],
  ["status"],
  ["links"],
];

function fakeDaemon() {
  const install = vi.fn(async () => {});
  const uninstall = vi.fn(async () => {});
  const status = vi.fn(async () => ({ installed: false, running: false }));
  const createDaemon = vi.fn((_options?: { home: string; env: Record<string, string> }) => ({ install, uninstall, status }));
  return { createDaemon, install, uninstall, status };
}

/** Runs a foreground serve against a fake adapter, sending SIGTERM once the command waits for a signal. */
async function runForegroundServe(argv: string[], overrides: Partial<CLIEnvironment> = {}) {
  const stdout = new BufferOutput();
  const stderr = new BufferOutput();
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const createServer = vi.fn((_options: Record<string, unknown>) => ({
    start: vi.fn(async function (this: any) { return this; }),
    dispose: vi.fn(async () => {}),
    getBaseURL: vi.fn(() => "http://127.0.0.1:43123"),
    getBaseURLs: vi.fn(() => ["http://127.0.0.1:43123"]),
    getAuthToken: vi.fn(() => "token-123"),
  }) as any);
  let settled = false;
  const runPromise = runCLI(argv, fakeEnvironment({
    stdout,
    stderr,
    createServer,
    onSignal: vi.fn((signal, handler) => { signalHandlers.set(signal, handler); }),
    ...overrides,
  })).finally(() => { settled = true; });
  await vi.waitFor(() => { expect(settled || signalHandlers.has("SIGTERM")).toBe(true); });
  signalHandlers.get("SIGTERM")?.();
  const exitCode = await runPromise;
  return { exitCode, stdout: stdout.toString(), stderr: stderr.toString(), createServer };
}

describe("CLI homes and the config file", () => {
  // Spec: [[arch/cli/index.md#^cli-home-errors-formatting|home and config errors]].
  it("reports home selection and config errors with the help pointer before constructing a client", async () => {
    for (const homeOption of ["", "   "]) {
      const stderr = new BufferOutput();
      const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
      expect(await runCLI(["--home", homeOption, "list-channels"], env), JSON.stringify(homeOption)).toBe(1);
      expect(stderr.toString()).toContain("--home");
      expect(stderr.toString()).toContain(SKILL_POINTER);
      expect(env.createClient).not.toHaveBeenCalled();
    }

    const operatingSystemHome = temporaryDirectory("television-cli-invalid-pointer-");
    const pointerPath = path.join(operatingSystemHome, ".tv-home");
    writeFileSync(pointerPath, "~otheruser/television\n");
    const pointerStderr = new BufferOutput();
    const pointerEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: pointerStderr, resolveHomeDir: () => operatingSystemHome });
    expect(await runCLI(["list-channels"], pointerEnv)).toBe(1);
    expect(pointerStderr.toString()).toContain(pointerPath);
    expect(pointerStderr.toString()).toContain("~ followed by a user name is not supported");
    expect(pointerStderr.toString()).toContain(SKILL_POINTER);
    expect(pointerEnv.createClient).not.toHaveBeenCalled();
    const givenHomeEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput(), resolveHomeDir: () => operatingSystemHome });
    expect(await runCLI(["--home", temporaryHome(), "list-channels"], givenHomeEnv)).toBe(0);

    const invalidHome = temporaryHome("{\"port\": 43123,");
    const configStderr = new BufferOutput();
    const configEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: configStderr });
    expect(await runCLI(["--home", invalidHome, "list-channels"], configEnv)).toBe(1);
    expect(configStderr.toString()).toContain(path.join(invalidHome, "config.json"));
    expect(configStderr.toString()).toContain("not valid JSON");
    expect(configStderr.toString()).toContain(SKILL_POINTER);
    expect(configEnv.createClient).not.toHaveBeenCalled();
  });

  // Spec: [[arch/cli/index.md#^cli-help-without-home|help and version use no home]].
  it("prints help and version without resolving a home", async () => {
    const rootVersion = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
    const invalidPointerHome = temporaryDirectory("television-cli-help-pointer-");
    writeFileSync(path.join(invalidPointerHome, ".tv-home"), "one\ntwo\n");
    const missingHome = path.join(temporaryDirectory("television-cli-help-missing-"), "absent");
    const cases: Array<{ argv: string[]; resolveHomeDir?: () => string }> = [
      { argv: ["--home", "", "--help"] },
      { argv: ["--help"], resolveHomeDir: () => invalidPointerHome },
      ...["--version", "-V", "-v"].flatMap((flag) => [
        { argv: ["--home", "", flag] },
        { argv: ["--home", missingHome, flag] },
        { argv: [flag, "--home", missingHome] },
        { argv: [flag], resolveHomeDir: () => invalidPointerHome },
      ]),
    ];
    for (const { argv, resolveHomeDir } of cases) {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      expect(await runCLI(argv, fakeEnvironment({ stdout, stderr, ...(resolveHomeDir ? { resolveHomeDir } : {}) })), argv.join(" ")).toBe(0);
      if (argv.includes("--help")) expect(stdout.toString()).toContain("Usage: tv [options] [command]");
      else expect(stdout.toString().trim()).toBe(rootVersion);
      expect(stderr.toString()).toBe("");
    }
  });

  // Spec: [[arch/cli/index.md#^cli-home-position|--home before or after the command]].
  it("accepts --home before and after the command name", async () => {
    const home = temporaryHome({ port: 43200 });
    writeToken(home, "position-token\n");
    for (const argv of [["--home", home, "list-channels"], ["list-channels", "--home", home]]) {
      const createClient = vi.fn(() => fakeEnvironment().createClient!("", "") as any);
      expect(await runCLI(argv, fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput(), createClient })), argv.join(" ")).toBe(0);
      expect(createClient).toHaveBeenCalledWith("http://localhost:43200", "position-token");
    }
  });

  // Spec: [[arch/cli/index.md#^cli-client-port-contract|client-port rule]].
  it("requires --port under config port 0 and refuses it under a nonzero config port", async () => {
    const portZeroHome = temporaryHome({ port: 0 });
    const portZeroConfig = path.join(portZeroHome, "config.json");
    for (const command of SERVER_COMMANDS) {
      const stderr = new BufferOutput();
      const env = fakeEnvironment({ stdout: new BufferOutput(), stderr });
      expect(await runCLI(["--home", portZeroHome, ...command], env), command.join(" ")).toBe(1);
      expect(stderr.toString(), command.join(" ")).toContain(`requires --port because ${portZeroConfig} sets port 0. Pass the port from the Television server's startup URL.`);
      expect(stderr.toString(), command.join(" ")).toContain(SKILL_POINTER);
      expect(env.createClient, command.join(" ")).not.toHaveBeenCalled();
    }
    const listStderr = new BufferOutput();
    expect(await runCLI(["--home", portZeroHome, "list-channels"], fakeEnvironment({ stdout: new BufferOutput(), stderr: listStderr }))).toBe(1);
    expect(listStderr.toString()).toContain(`tv --home ${portZeroHome} list-channels requires --port because ${portZeroConfig} sets port 0.`);

    const withPort = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
    expect(await runCLI(["--home", portZeroHome, "list-channels", "--port", "43123"], withPort)).toBe(0);
    expect(withPort.createClient).toHaveBeenCalledWith("http://localhost:43123", undefined);

    const noConfigHome = temporaryHome();
    const nonzeroHome = temporaryHome({ port: 43200 });
    for (const [home, port] of [[noConfigHome, 32848], [nonzeroHome, 43200]] as const) {
      const configPath = path.join(home, "config.json");
      for (const command of [["list-channels"], ["status"]]) {
        const env = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
        expect(await runCLI(["--home", home, ...command], env)).toBe(0);
        expect(env.createClient).toHaveBeenCalledWith(`http://localhost:${port}`, undefined);

        const stderr = new BufferOutput();
        const refusedEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr });
        expect(await runCLI(["--home", home, ...command, "--port", "43123"], refusedEnv)).toBe(1);
        expect(stderr.toString()).toContain(`tv --home ${home} ${command.join(" ")} --port 43123 does not accept --port because ${configPath} sets port ${port}. Omit --port to use the configured port.`);
        expect(stderr.toString()).toContain(SKILL_POINTER);
        expect(refusedEnv.createClient).not.toHaveBeenCalled();
      }
    }

    const invalidHome = temporaryHome({ port: "43123" });
    for (const command of [["list-channels"], ["status"]]) {
      const stdout = new BufferOutput();
      const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
      expect(await runCLI(["--home", invalidHome, ...command], env)).toBe(1);
      expect(env.createClient).not.toHaveBeenCalled();
      expect(stdout.toString()).toBe("");
    }
  });

  // Spec: [[arch/cli/index.md#^cli-config-set-contract|config set parsing and confirmation]].
  it("config set parses each value by key and writes the config file", async () => {
    const home = path.join(temporaryDirectory("television-cli-config-set-"), "new-home");
    const configPath = path.join(home, "config.json");
    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const env = fakeEnvironment({ stdout, stderr });
    expect(await runCLI([
      "--home", home, "config", "set",
      "port", "43123",
      "listen", " 100.64.0.7, ,192.168.1.42 ",
      "auth", "false",
      "installedByAgent", " Claude Code ",
    ], env)).toBe(0);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      port: 43123,
      listen: ["100.64.0.7", "192.168.1.42"],
      auth: false,
      installedByAgent: " Claude Code ",
    });
    expect(stdout.toString()).toBe(`Updated ${configPath}: port, listen, auth, installedByAgent.\n${CONFIG_SET_RESTART_LINE}\n`);
    expect(stderr.toString()).toBe("");
    expect(env.createClient).not.toHaveBeenCalled();

    const secondStdout = new BufferOutput();
    expect(await runCLI(["--home", home, "config", "set", "listen", "", "auth", "true"], fakeEnvironment({ stdout: secondStdout, stderr: new BufferOutput() }))).toBe(0);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ port: 43123, listen: [], auth: true, installedByAgent: " Claude Code " });
    expect(secondStdout.toString()).toBe(`Updated ${configPath}: listen, auth.\n${CONFIG_SET_RESTART_LINE}\n`);

    const bytes = readFileSync(configPath);
    for (const value of ["True", "yes", "1"]) {
      const valueStderr = new BufferOutput();
      expect(await runCLI(["--home", home, "config", "set", "auth", value], fakeEnvironment({ stdout: new BufferOutput(), stderr: valueStderr })), value).toBe(1);
      expect(valueStderr.toString()).toContain(SKILL_POINTER);
      expect(readFileSync(configPath)).toEqual(bytes);
    }
  });

  // Spec: [[arch/cli/index.md#^cli-config-set-refusals|config set refusals]].
  it("config set refuses bad invocations and invalid results without changing the file", async () => {
    const directiveCases: string[][] = [
      [],
      ["port", "43123", "auth"],
      ["bogus", "1"],
      ["port", "1", "port", "2"],
      ["port", "abc"],
      ["auth", "maybe"],
    ];
    for (const pairs of directiveCases) {
      const existingHome = temporaryHome({ port: 43123 });
      const configPath = path.join(existingHome, "config.json");
      const bytes = readFileSync(configPath);
      const stderr = new BufferOutput();
      expect(await runCLI(["--home", existingHome, "config", "set", ...pairs], fakeEnvironment({ stdout: new BufferOutput(), stderr })), pairs.join(" ")).toBe(1);
      expect(stderr.toString(), pairs.join(" ")).toContain(SKILL_POINTER);
      expect(readFileSync(configPath)).toEqual(bytes);

      const missingHome = path.join(temporaryDirectory("television-cli-config-refusal-"), "home");
      expect(await runCLI(["--home", missingHome, "config", "set", ...pairs], fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() }))).toBe(1);
      expect(existsSync(path.join(missingHome, "config.json")), pairs.join(" ")).toBe(false);
    }

    const storedCases: Array<[string, string[]]> = [
      [JSON.stringify({ port: 43123 }), ["listen", "example.com"]],
      ["{\"port\": 43123,", ["port", "5"]],
      [JSON.stringify({ bogus: 1 }), ["port", "5"]],
    ];
    for (const [contents, pairs] of storedCases) {
      const home = temporaryHome(contents);
      const configPath = path.join(home, "config.json");
      const stderr = new BufferOutput();
      expect(await runCLI(["--home", home, "config", "set", ...pairs], fakeEnvironment({ stdout: new BufferOutput(), stderr })), contents).toBe(1);
      expect(stderr.toString()).toContain(configPath);
      expect(stderr.toString()).toContain(SKILL_POINTER);
      expect(readFileSync(configPath, "utf8")).toBe(contents);
      expect(readdirSync(home)).toEqual(["config.json"]);
    }
  });

  // Spec: [[arch/cli/index.md#^cli-config-show-contract|config show]].
  it("config show prints the effective settings with installedByAgent as null when absent", async () => {
    const missingHome = temporaryHome();
    const emptyHome = temporaryHome({});
    const fullHome = temporaryHome({ port: 0, listen: ["100.64.0.7"], auth: false, installedByAgent: "Claude Code" });
    const defaults = { port: 32848, listen: [], auth: true, installedByAgent: null };
    for (const [home, configFileExists, settings] of [
      [missingHome, false, defaults],
      [emptyHome, true, defaults],
      [fullHome, true, { port: 0, listen: ["100.64.0.7"], auth: false, installedByAgent: "Claude Code" }],
    ] as const) {
      const stdout = new BufferOutput();
      const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
      expect(await runCLI(["--home", home, "config", "show"], env)).toBe(0);
      expect(stdout.toString()).toBe(`${JSON.stringify({ home, configPath: path.join(home, "config.json"), configFileExists, settings })}\n`);
      expect(env.createClient).not.toHaveBeenCalled();
    }

    const invalidHome = temporaryHome({ auth: "yes" });
    const stderr = new BufferOutput();
    expect(await runCLI(["--home", invalidHome, "config", "show"], fakeEnvironment({ stdout: new BufferOutput(), stderr }))).toBe(1);
    expect(stderr.toString()).toContain(path.join(invalidHome, "config.json"));
    expect(stderr.toString()).toContain(SKILL_POINTER);
  });

  // Spec: [[arch/cli/index.md#^cli-themes-path-contract|themes-path]].
  it("themes-path prints the home's themes directory, even with a malformed config file", async () => {
    const home = temporaryHome("{not json");
    const relativeHome = path.relative(process.cwd(), home);
    for (const homeOption of [home, relativeHome]) {
      const stdout = new BufferOutput();
      const env = fakeEnvironment({ stdout, stderr: new BufferOutput() });
      expect(await runCLI(["--home", homeOption, "themes-path"], env)).toBe(0);
      expect(stdout.toString()).toBe(`{"themesPath":${JSON.stringify(path.join(home, "themes"))}}\n`);
      expect(env.createClient).not.toHaveBeenCalled();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-home-only-commands-contract|commands that do not contact the server]].
  it("runs the home-only commands without reading the config file and refuses --port on them", async () => {
    const home = temporaryHome("{not json");
    const bundled = temporaryDirectory("television-cli-home-only-bundled-");
    mkdirSync(path.join(bundled, "television"));
    writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n");
    const destination = path.join(temporaryDirectory("television-cli-home-only-skills-"), "skills");
    const commands = [["themes-path"], ["stop"], ["serve", "--persist-uninstall"], ["skills", "install", destination]];
    for (const command of commands) {
      const { createDaemon, uninstall } = fakeDaemon();
      const env = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput(), createDaemon, resolveBundledSkillsRoot: () => bundled });
      expect(await runCLI(["--home", home, ...command], env), command.join(" ")).toBe(0);
      expect(env.createClient).not.toHaveBeenCalled();
      if (command[0] !== "themes-path" && command[0] !== "skills") expect(uninstall).toHaveBeenCalledTimes(1);
    }
    expect(readLogRecords(home).filter((record) => record.msg === "persisted service uninstalled")).toHaveLength(2);

    for (const command of [["config", "set", "port", "5"], ["config", "show"], ...commands]) {
      const stderr = new BufferOutput();
      const env = fakeEnvironment({ stdout: new BufferOutput(), stderr, createDaemon: fakeDaemon().createDaemon, resolveBundledSkillsRoot: () => bundled });
      expect(await runCLI(["--home", temporaryHome(), ...command, "--port", "43123"], env), command.join(" ")).toBe(1);
      if (command[0] === "serve") expectRetiredOptionsGuidance(stderr.toString(), ["--port"], command.join(" "));
      else expect(stderr.toString(), command.join(" ")).toContain("does not support --port.");
      expect(env.createClient).not.toHaveBeenCalled();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-legacy-variables-ignored|legacy variables ignored]].
  it("ignores TELEVISION_PORT and TELEVISION_STORAGE_PATH", async () => {
    const home = temporaryHome({ port: 43123 });
    writeToken(home, "home-token\n");
    const otherDirectory = temporaryHome({ port: 45555 });
    writeToken(otherDirectory, "other-token\n");
    try {
      for (const [port, storagePath] of [["45555", otherDirectory], ["not-a-port", ""]]) {
        vi.stubEnv("TELEVISION_PORT", port);
        vi.stubEnv("TELEVISION_STORAGE_PATH", storagePath);

        const clientEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
        expect(await runCLI(["--home", home, "list-channels"], clientEnv)).toBe(0);
        expect(clientEnv.createClient).toHaveBeenCalledWith("http://localhost:43123", "home-token");

        const serve = await runForegroundServe(["--home", home, "serve"]);
        expect(serve.exitCode).toBe(0);
        expect(serve.createServer).toHaveBeenCalledWith(expect.objectContaining({ home, port: 43123, listen: [], auth: true }));

        const { createDaemon } = fakeDaemon();
        expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput(), createDaemon }))).toBe(0);
        expect(createDaemon).toHaveBeenCalledWith(expect.objectContaining({ home }));
        const daemonEnv = createDaemon.mock.calls[0]![0]!.env;
        expect(daemonEnv).not.toHaveProperty("TELEVISION_PORT");
        expect(daemonEnv).not.toHaveProperty("TELEVISION_STORAGE_PATH");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-legacy-variables-warning|legacy-variable warning]].
  it("warns when TELEVISION_PORT or TELEVISION_STORAGE_PATH is set, outside the daemon launch mode", async () => {
    const home = temporaryHome({ port: 43123 });
    writeToken(home, "home-token\n");
    const setVariables = () => {
      vi.stubEnv("TELEVISION_PORT", "45555");
      vi.stubEnv("TELEVISION_STORAGE_PATH", "/tmp/television-old-storage");
    };
    try {
      vi.stubEnv("TELEVISION_LAUNCH_MODE", "");
      for (const [port, storagePath] of [
        ["45555", ""], ["not-a-port", ""], ["", "/tmp/television-old-storage"], ["not-a-port", "/tmp/television-old-storage"], ["", ""],
      ]) {
        vi.stubEnv("TELEVISION_PORT", port);
        vi.stubEnv("TELEVISION_STORAGE_PATH", storagePath);
        for (const argv of [["--home", home, "list-channels"], ["--home", home, "config", "show"], ["--version"], ["--help"]]) {
          const label = `TELEVISION_PORT=${port} TELEVISION_STORAGE_PATH=${storagePath} tv ${argv.join(" ")}`;
          const stderr = new BufferOutput();
          expect(await runCLI(argv, fakeEnvironment({ stdout: new BufferOutput(), stderr })), label).toBe(0);
          expect(stderr.toString(), label).toBe(port || storagePath ? `${LEGACY_VARIABLES_WARNING}\n` : "");
        }
      }

      // The warning comes first, and the command still runs.
      setVariables();
      const serve = await runForegroundServe(["--home", home, "serve"]);
      expect(serve.exitCode).toBe(0);
      expect(serve.stderr.startsWith(`${LEGACY_VARIABLES_WARNING}\n`), serve.stderr).toBe(true);
      expect(serve.createServer).toHaveBeenCalledTimes(1);
      const { createDaemon } = fakeDaemon();
      const persistStderr = new BufferOutput();
      expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout: new BufferOutput(), stderr: persistStderr, createDaemon }))).toBe(0);
      expect(persistStderr.toString().startsWith(`${LEGACY_VARIABLES_WARNING}\n`), persistStderr.toString()).toBe(true);
      expect(createDaemon).toHaveBeenCalledTimes(1);

      // A retired-options refusal writes only the refusal.
      const refusalStderr = new BufferOutput();
      expect(await runCLI(["--home", home, "serve", "--port", "43123"], fakeEnvironment({ stdout: new BufferOutput(), stderr: refusalStderr }))).toBe(1);
      expectRetiredOptionsGuidance(refusalStderr.toString(), ["--port"], "refusal with legacy variables set");

      // The daemon launch mode writes no warning, on the transitional path or not.
      vi.stubEnv("TELEVISION_LAUNCH_MODE", "daemon");
      const retiredHome = path.join(temporaryDirectory("television-cli-legacy-warning-"), "home");
      for (const argv of [["--home", home, "serve"], ["serve", "--port", "43124", "--storage-path", retiredHome]]) {
        const daemonServe = await runForegroundServe(argv);
        expect(daemonServe.exitCode, argv.join(" ")).toBe(0);
        expect(daemonServe.stderr, argv.join(" ")).not.toContain("TELEVISION_PORT or TELEVISION_STORAGE_PATH");
        expect(daemonServe.createServer, argv.join(" ")).toHaveBeenCalledTimes(1);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-retired-options-check|retired options refused with guidance]].
  it("refuses the retired options with the upgrade guidance before anything else", async () => {
    vi.stubEnv("TELEVISION_LAUNCH_MODE", "");
    try {
      const home = path.join(temporaryDirectory("television-cli-retired-"), "home");
      const retiredServeOptions = [
        ["--port", "43123"], ["--port=43123"], ["--port"], ["--listen", "100.64.0.7"], ["--listen=100.64.0.7"], ["--listen"],
        ["--auth"], ["--auth=true"], ["--no-auth"], ["--no-auth=true"],
        ["--installed-by-agent", "Claude"], ["--installed-by-agent=Claude"], ["--installed-by-agent"],
        ["--storage-path", "/tmp/television-a"], ["--storage-path=/tmp/television-a"], ["--storage-path"],
      ];
      const retiredInvocations: Array<{ argv: string[]; named: string[] }> = [
        ...[[], ["--persist"], ["--persist-uninstall"]].flatMap((form) => retiredServeOptions.map((option) => ({
          argv: ["--home", home, "serve", ...form, ...option],
          named: [option[0]!.split("=")[0]!],
        }))),
        { argv: ["--home", home, "list-channels", "--storage-path", "/tmp/television-a"], named: ["--storage-path"] },
        { argv: ["--home", home, "config", "show", "--storage-path=/tmp/television-a"], named: ["--storage-path"] },
        { argv: ["--storage-path", "/tmp/television-a", "--home", home, "list-channels"], named: ["--storage-path"] },
        { argv: ["--home", home, "serve", "--help", "--port", "43123"], named: ["--port"] },
        { argv: ["--version", "--storage-path", "/tmp/television-a"], named: ["--storage-path"] },
        { argv: ["--home", home, "serve", "--bogus", "--port", "43123"], named: ["--port"] },
        // Each option is named once, in the order it first appears, without its value.
        {
          argv: ["--storage-path=/tmp/television-a", "--home", home, "serve", "--no-auth", "--port", "43123", "--listen=100.64.0.7", "--port=43124", "--no-auth"],
          named: ["--storage-path", "--no-auth", "--port", "--listen"],
        },
      ];
      for (const { argv, named } of retiredInvocations) {
        const label = argv.join(" ");
        const stdout = new BufferOutput();
        const stderr = new BufferOutput();
        const { createDaemon } = fakeDaemon();
        const env = fakeEnvironment({ stdout, stderr, createDaemon });
        expect(await runCLI(argv, env), label).toBe(1);
        expectRetiredOptionsGuidance(stderr.toString(), named, label);
        expect(stdout.toString(), label).toBe("");
        expect(env.createServer, label).not.toHaveBeenCalled();
        expect(env.createClient, label).not.toHaveBeenCalled();
        expect(createDaemon, label).not.toHaveBeenCalled();
      }
      expect(existsSync(home)).toBe(false);

      // The refusal comes before home selection, even from a malformed ~/.tv-home.
      const operatingSystemHome = temporaryDirectory("television-cli-retired-os-home-");
      writeFileSync(path.join(operatingSystemHome, ".tv-home"), "~otheruser/television\n");
      const pointerStderr = new BufferOutput();
      expect(await runCLI(["serve", "--port", "43123"], fakeEnvironment({ stdout: new BufferOutput(), stderr: pointerStderr, resolveHomeDir: () => operatingSystemHome }))).toBe(1);
      expectRetiredOptionsGuidance(pointerStderr.toString(), ["--port"], "malformed ~/.tv-home");

      // A retired option after -- is an operand, not an option.
      const operandStderr = new BufferOutput();
      await runCLI(["--home", temporaryHome(), "list-channels", "--", "--storage-path"], fakeEnvironment({ stdout: new BufferOutput(), stderr: operandStderr }));
      expect(operandStderr.toString()).not.toContain("does not accept --storage-path");

      // A client command's --port and tv skills install --installed-by-agent keep working.
      const clientEnv = fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() });
      expect(await runCLI(["--home", temporaryHome({ port: 0 }), "list-channels", "--port", "43123"], clientEnv)).toBe(0);
      expect(vi.mocked(clientEnv.createClient!).mock.calls[0]?.[0]).toBe("http://localhost:43123");
      const bundled = temporaryDirectory("television-cli-retired-bundled-");
      mkdirSync(path.join(bundled, "television"), { recursive: true });
      writeFileSync(path.join(bundled, "television", "SKILL.md"), "tv\n");
      const destination = path.join(temporaryDirectory("television-cli-retired-skills-"), "skills");
      expect(await runCLI(["--home", temporaryHome(), "skills", "install", destination, "--installed-by-agent", "Claude"], fakeEnvironment({
        stdout: new BufferOutput(),
        stderr: new BufferOutput(),
        resolveBundledSkillsRoot: () => bundled,
      }))).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-retired-service-contract|transitional service path]].
  it("starts an earlier release's service definition through the transitional path", async () => {
    vi.stubEnv("TELEVISION_LAUNCH_MODE", "daemon");
    vi.stubEnv("TELEVISION_PORT", "");
    try {
      const root = temporaryDirectory("television-cli-retired-service-");
      const readConfigFile = (home: string) => JSON.parse(readFileSync(path.join(home, "config.json"), "utf8"));
      const retiredRecords = (home: string) => readLogRecords(home).filter((record) => record.msg === RETIRED_SERVICE_RECORD);

      // The first boot writes every option into a home with no config file.
      const home = path.join(root, "home");
      const first = await runForegroundServe([
        "serve", "--port", "43123", "--listen", "127.0.0.2", "--listen", "127.0.0.3,127.0.0.4", "--no-auth",
        "--storage-path", home, "--installed-by-agent", "Claude Code",
      ]);
      expect(first.exitCode, first.stderr).toBe(0);
      const written = { port: 43123, listen: ["127.0.0.2", "127.0.0.3", "127.0.0.4"], auth: false, installedByAgent: "Claude Code" };
      expect(readConfigFile(home)).toEqual(written);
      expect(first.createServer).toHaveBeenCalledWith(expect.objectContaining({ home, ...written }));
      expect(retiredRecords(home)).toHaveLength(1);
      expect(JSON.stringify(retiredRecords(home)[0])).toContain("tv serve --persist");
      expect(JSON.stringify(retiredRecords(home)[0])).toContain("https://television.run/install.md");

      // A later boot leaves a config file changed with tv config set alone, and records again.
      expect(await runCLI(["--home", home, "config", "set", "port", "44123", "auth", "true"], fakeEnvironment({ stdout: new BufferOutput(), stderr: new BufferOutput() }))).toBe(0);
      const edited = readFileSync(path.join(home, "config.json"), "utf8");
      const later = await runForegroundServe(["serve", "--port", "43123", "--no-auth", "--storage-path", home]);
      expect(later.exitCode, later.stderr).toBe(0);
      expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe(edited);
      expect(later.createServer).toHaveBeenCalledWith(expect.objectContaining({ home, port: 44123, auth: true }));
      expect(retiredRecords(home)).toHaveLength(2);

      // With no --port, a valid TELEVISION_PORT supplies the port; with no auth option, auth is false.
      vi.stubEnv("TELEVISION_PORT", "45123");
      const environmentPortHome = path.join(root, "environment-port");
      const environmentPort = await runForegroundServe(["serve", "--storage-path", environmentPortHome]);
      expect(environmentPort.exitCode, environmentPort.stderr).toBe(0);
      expect(readConfigFile(environmentPortHome)).toEqual({ port: 45123, auth: false });

      // An unparsable TELEVISION_PORT is ignored; --auth writes auth true.
      vi.stubEnv("TELEVISION_PORT", "not-a-port");
      const ignoredPortHome = path.join(root, "ignored-port");
      const ignoredPort = await runForegroundServe(["serve", "--auth", "--storage-path", ignoredPortHome]);
      expect(ignoredPort.exitCode, ignoredPort.stderr).toBe(0);
      expect(readConfigFile(ignoredPortHome)).toEqual({ auth: true });
      expect(ignoredPort.createServer).toHaveBeenCalledWith(expect.objectContaining({ home: ignoredPortHome, port: 32848, auth: true }));

      // A value the config rules reject stops the start as an invalid config file does.
      const invalidHome = path.join(root, "invalid");
      const invalid = await runForegroundServe(["serve", "--listen", "example.com", "--storage-path", invalidHome]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain(path.join(invalidHome, "config.json"));
      expect(invalid.stderr).toContain(SKILL_POINTER);
      expect(existsSync(path.join(invalidHome, "config.json"))).toBe(false);
      expect(invalid.createServer).not.toHaveBeenCalled();
      expect(readLogRecords(invalidHome).map((record) => record.msg)).toContain("server startup refused before binding");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-retired-service-contract|transitional service path]].
  it("keeps the retired-options refusal where the transitional path does not apply", async () => {
    try {
      const root = temporaryDirectory("television-cli-retired-refusal-");
      const home = path.join(root, "home");
      const cases: Array<{ launchMode: string; argv: string[]; named: string[] }> = [
        { launchMode: "daemon", argv: ["--home", home, "serve", "--port", "43123"], named: ["--port"] },
        { launchMode: "daemon", argv: ["serve", "--persist", "--port", "43123", "--storage-path", home], named: ["--port", "--storage-path"] },
        { launchMode: "daemon", argv: ["serve", "--persist-uninstall", "--storage-path", home], named: ["--storage-path"] },
        { launchMode: "cli", argv: ["serve", "--port", "43123", "--storage-path", home], named: ["--port", "--storage-path"] },
        { launchMode: "", argv: ["serve", "--port", "43123", "--storage-path", home], named: ["--port", "--storage-path"] },
      ];
      for (const { launchMode, argv, named } of cases) {
        vi.stubEnv("TELEVISION_LAUNCH_MODE", launchMode);
        const label = `${launchMode}: ${argv.join(" ")}`;
        const { createDaemon } = fakeDaemon();
        const result = await runForegroundServe(argv, { createDaemon });
        expect(result.exitCode, label).toBe(1);
        expectRetiredOptionsGuidance(result.stderr, named, label);
        expect(result.createServer, label).not.toHaveBeenCalled();
        expect(createDaemon, label).not.toHaveBeenCalled();
      }
      expect(existsSync(home)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Spec: [[arch/cli/index.md#^cli-serve-invalid-config|invalid config stops serve]].
  it("stops serve and serve --persist on an invalid config file and records the refused start", async () => {
    for (const contents of ["{\"port\": 43123,", JSON.stringify({ listen: ["example.com"] })]) {
      const home = temporaryHome(contents);
      const configPath = path.join(home, "config.json");
      const { exitCode, stderr, createServer } = await runForegroundServe(["--home", home, "serve"]);
      expect(exitCode, contents).toBe(1);
      expect(stderr).toContain(configPath);
      expect(stderr).toContain(SKILL_POINTER);
      expect(createServer).not.toHaveBeenCalled();
      const refusal = readLogRecords(home).find((record) => record.msg === "server startup refused before binding");
      expect(JSON.stringify(refusal?.error)).toContain(configPath);

      const { createDaemon } = fakeDaemon();
      const persistStderr = new BufferOutput();
      expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout: new BufferOutput(), stderr: persistStderr, createDaemon }))).toBe(1);
      expect(persistStderr.toString()).toContain(configPath);
      expect(persistStderr.toString()).toContain(SKILL_POINTER);
      expect(createDaemon).not.toHaveBeenCalled();
      expect(readFileSync(configPath, "utf8")).toBe(contents);
    }
  });

  // Spec: [[arch/cli/index.md#^cli-tokenless-warnings|tokenless warnings]].
  it("prints the tokenless warnings only when the config file turns authentication off", async () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ auth: false }, [TOKENLESS_WARNING]],
      [{ auth: false, listen: ["100.64.0.7"] }, [TOKENLESS_WARNING, "Non-loopback listeners without auth: 100.64.0.7"]],
      [{ auth: false, listen: ["0.0.0.0"] }, [TOKENLESS_WARNING, "Non-loopback listeners without auth: 0.0.0.0"]],
      [{ listen: ["100.64.0.7"] }, []],
      [{}, []],
    ];
    for (const [config, lines] of cases) {
      const { exitCode, stderr } = await runForegroundServe(["--home", temporaryHome(config), "serve"]);
      expect(exitCode).toBe(0);
      expect(stderr.split("\n").filter(Boolean), JSON.stringify(config)).toEqual(lines);
    }
  });

  // Spec: [[arch/cli/index.md#^cli-persist-token-output|persisted connect URLs carry the home's token]].
  it("serve --persist prints token-bearing URLs from the home's token file only when authentication is on", async () => {
    const home = path.join(temporaryDirectory("television-cli-persist-token-"), "home");
    const tokenPath = path.join(home, "state", "token");
    const daemon = fakeDaemon();
    let tokenExistedAtInstall = false;
    daemon.install.mockImplementation(async () => { tokenExistedAtInstall = existsSync(tokenPath); });
    const stdout = new BufferOutput();
    expect(await runCLI(["--home", home, "serve", "--persist"], fakeEnvironment({ stdout, stderr: new BufferOutput(), createDaemon: daemon.createDaemon }))).toBe(0);
    expect(daemon.install).toHaveBeenCalledTimes(1);
    expect(tokenExistedAtInstall).toBe(true);
    const token = readFileSync(tokenPath, "utf8").trim();
    expect(token.length).toBeGreaterThan(0);
    expect(stdout.toString()).toContain(`http://127.0.0.1:32848/?token=${token}`);
    expect(existsSync(path.join(home, "config.json"))).toBe(false);

    const tokenlessHome = temporaryHome({ port: 43123, auth: false });
    const tokenlessStdout = new BufferOutput();
    expect(await runCLI(["--home", tokenlessHome, "serve", "--persist"], fakeEnvironment({ stdout: tokenlessStdout, stderr: new BufferOutput(), createDaemon: fakeDaemon().createDaemon }))).toBe(0);
    expect(tokenlessStdout.toString()).toContain("http://127.0.0.1:43123");
    expect(tokenlessStdout.toString()).not.toContain("?token=");
  });
});
