// The resource walks' product harness: the built `tv` CLI as spawned
// processes over temporary homes, the servers `tv serve` starts, and real
// browsers that reach those servers at mapped plain-HTTP host names
// (proofs/product/resources/resources.md, Test hooks).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";
import { chromium, firefox, type Browser, type Frame, type Page } from "playwright";
import type * as Sdk from "../../packages/shared/src/resources/sdk.ts";
import { configureTestMotion } from "../../packages/web/test/e2e/helpers.ts";
// @ts-expect-error — repository scripts have no declaration files
import { isPlaywrightFirefoxAvailable } from "../../scripts/playwright-firefox-availability.mjs";
import { waitForApplicationRender } from "../helpers/application-readiness.ts";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(process.cwd());
const BUILT_CLI = path.join(REPO_ROOT, "packages", "cli", "dist", "cli.cjs");
export const PROCESS_TIMEOUT_MS = 30_000;
const APP_TIMEOUT_MS = 20_000;

export type BrowserName = "chromium" | "firefox";

/** A page's view of a snapshot, as the authored page records it. */
export interface Shot {
  key: string | null;
  exists: boolean;
  value: unknown;
  pending: boolean;
}

/** How an SDK call ended, as the authored page reports it. */
export type Outcome = { ok: true; value: unknown } | { ok: false; isError: boolean; code: unknown; message: unknown };

/** The authored artifact page's globals, for code run in it with `frame.evaluate`: `(window as unknown as PageWindow)`. */
export interface PageWindow {
  sdk: typeof Sdk;
  outcome(run: () => unknown): Promise<Outcome>;
  shot(snapshot: Sdk.Snapshot): Shot;
  logs: Record<string, unknown[]>;
  record(name: string): unknown[];
  pageReady: boolean;
  /** The handles the walk's own script made, by name. */
  stores: Record<string, Sdk.Store>;
}

// The same predicate as the playwright-firefox preflight and the Playwright
// configs: outside GitHub Actions a missing Firefox skips its cases, and in
// GitHub Actions it is a configuration failure.
const FIREFOX_AVAILABLE = isPlaywrightFirefoxAvailable() as boolean;
if (!FIREFOX_AVAILABLE && process.env.GITHUB_ACTIONS) {
  throw new Error("Playwright Firefox is required in GitHub CI; setup-playwright must install it.");
}

/** Whether a walk in this browser runs here; Firefox walks are skipped where Playwright's Firefox is not installed. */
export function browserAvailable(name: BrowserName): boolean {
  return name === "chromium" || FIREFOX_AVAILABLE;
}

export interface Result {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** A spawned built `tv` process that runs until stopped, with its output so far. */
export interface Running {
  owned: OwnedProcess;
  stdout(): string;
  stderr(): string;
  /** Sends SIGINT and resolves with the exit code. */
  interrupt(): Promise<number | null>;
}

export interface BuiltServer {
  home: string;
  port: number;
  /** The token the server requires, from its startup URL; null on a tokenless server. */
  token: string | null;
  /** Runs `tv --home <home> <args> --port <port>`. */
  tv(args: string[], input?: string): Promise<Result>;
  /** Starts a long-running `tv` command against this server. */
  start(args: string[]): Running;
  stop(): Promise<void>;
}

export function ok(stdout: string): Result {
  return { exitCode: 0, stdout, stderr: "" };
}

/** Parses a command's compact one-line JSON output, which it must print with status 0. */
export function parse(result: Result): any {
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout, "compact one-line JSON").toBe(`${JSON.stringify(JSON.parse(result.stdout))}\n`);
  return JSON.parse(result.stdout);
}

function cliEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "", DO_NOT_TRACK: "1" };
  delete env.TELEVISION_ACP_AGENT;
  delete env.TELEVISION_PORT;
  delete env.TELEVISION_STORAGE_PATH;
  return env;
}

/** Processes, folders and browsers for one test, cleaned up after it. */
export class ProductContext {
  private readonly processes: OwnedProcess[] = [];
  private readonly directories: string[] = [];
  private readonly browsers: Browser[] = [];

  temporaryDirectory(prefix: string): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
    this.directories.push(directory);
    return directory;
  }

  spawnBuilt(args: string[]): Running {
    const owned = spawnOwnedProcess(process.execPath, [BUILT_CLI, ...args], {
      cwd: REPO_ROOT,
      env: cliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.processes.push(owned);
    let stdout = "";
    let stderr = "";
    owned.child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    owned.child.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
    const exited = new Promise<number | null>((resolve) => owned.child.once("close", (code) => resolve(code)));
    return {
      owned,
      stdout: () => stdout,
      stderr: () => stderr,
      interrupt: async () => {
        owned.child.kill("SIGINT");
        return exited;
      },
    };
  }

  /** Runs one built `tv` command to completion, with `input` as its standard input. */
  async runBuilt(args: string[], input = ""): Promise<Result> {
    const running = this.spawnBuilt(args);
    running.owned.child.stdin?.end(input);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out: tv ${args.join(" ")}\n${running.stdout()}\n${running.stderr()}`)), PROCESS_TIMEOUT_MS);
      running.owned.child.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    return { exitCode, stdout: running.stdout(), stderr: running.stderr() };
  }

  /**
   * Serves `home` with the built CLI. The home's config file sets port 0,
   * with `listen` adding listening addresses, and commands pass the acquired
   * port. Serving a home again starts a new server over the same data.
   */
  async serve(home: string, options: { auth?: boolean; listen?: string[] } = {}): Promise<BuiltServer> {
    writeHomeConfig(home, {
      port: 0,
      ...(options.auth === false ? { auth: false } : {}),
      ...(options.listen === undefined ? {} : { listen: options.listen }),
    });
    const server = this.spawnBuilt(["--home", home, "serve", "--print-links"]);
    await vi.waitFor(() => expect(server.stdout()).toMatch(/https?:\/\/[^\s\u001B]+/), { timeout: PROCESS_TIMEOUT_MS, interval: 20 });
    const startup = new URL(server.stdout().match(/https?:\/\/[^\s\u001B]+/)![0]);
    const port = Number.parseInt(startup.port, 10);
    const withPort = (args: string[]) => ["--home", home, ...args, "--port", String(port)];
    return {
      home,
      port,
      token: startup.searchParams.get("token"),
      tv: (args, input) => this.runBuilt(withPort(args), input),
      start: (args) => this.spawnBuilt(withPort(args)),
      stop: async () => {
        await server.interrupt();
      },
    };
  }

  /** Launches a browser whose resolver maps each of `hosts` to the loopback address. */
  async launch(name: BrowserName, hosts: string[]): Promise<Browser> {
    const browser = name === "chromium"
      ? await chromium.launch({ args: [`--host-resolver-rules=${hosts.map((host) => `MAP ${host} 127.0.0.1`).join(", ")}`] })
      : await firefox.launch({ firefoxUserPrefs: { "network.dns.localDomains": hosts.join(",") } });
    this.browsers.push(browser);
    return browser;
  }

  async cleanup(): Promise<void> {
    for (const browser of this.browsers.splice(0)) await browser.close();
    for (const owned of this.processes.splice(0).reverse()) await owned.dispose();
    for (const directory of this.directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  }
}

/** A server's origin at a mapped host name. */
export function origin(server: BuiltServer, host: string): string {
  return `http://${host}:${server.port}`;
}

/** Creates a channel and focuses it, so the app shows the artifacts added to it. */
export async function focusedChannel(server: BuiltServer, name: string): Promise<string> {
  const created = await server.tv(["create-channel", "--name", name, "--focus-channel"]);
  expect(created.exitCode, created.stderr).toBe(0);
  return /Channel created: (\S+)/.exec(created.stdout)![1]!;
}

/** Registers a folder as a path artifact on `channelID` with the built CLI, and returns its ID. */
export async function createPathArtifact(server: BuiltServer, channelID: string, title: string, folder: string): Promise<string> {
  const created = await server.tv(["create-path-artifact", "--channel", channelID, "--title", title, "--path", folder, "--no-focus"]);
  expect(created.exitCode, created.stderr).toBe(0);
  return /Path artifact (\S+) created\./.exec(created.stdout)![1]!;
}

/** The errors a page and its frames report: uncaught exceptions, and console errors such as a module that failed to load. */
export interface PageErrors {
  list(): string[];
}

/**
 * Opens the Television app that `server` serves, at `host`, holding the
 * server's token as a person's browser does after following the connect
 * link, and applies the default CSS-motion override, which forfeits only
 * motion that no resource walk claims. `at` is the origin the browser uses,
 * such as an HTTPS front's, whose certificate the page then accepts.
 */
export async function openApp(browser: Browser, server: BuiltServer, host: string, at = origin(server, host)): Promise<{ page: Page; errors: PageErrors }> {
  const page = await browser.newPage(at.startsWith("https:") ? { ignoreHTTPSErrors: true } : {});
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${at}/${server.token === null ? "" : `?token=${server.token}`}`);
  await waitForApplicationRender(page, ["connected"], APP_TIMEOUT_MS);
  await configureTestMotion(page);
  return { page, errors: { list: () => [...errors] } };
}

/** The frame the app shows for the artifact document at `url`. */
export async function frameAt(page: Page, url: string): Promise<Frame> {
  let frame: Frame | undefined;
  await vi.waitFor(() => {
    frame = page.frames().find((candidate) => candidate.url().startsWith(url));
    expect(frame, `a frame at ${url}`).toBeDefined();
  }, { timeout: APP_TIMEOUT_MS, interval: 50 });
  return frame!;
}

/** The frame the app shows for an authored artifact page at `url`, once the page says it is ready. */
export async function artifactFrame(page: Page, url: string): Promise<Frame> {
  const frame = await frameAt(page, url);
  await frame.waitForFunction(() => (window as unknown as { pageReady?: boolean }).pageReady === true, undefined, { timeout: APP_TIMEOUT_MS });
  return frame;
}

/** An artifact document's URL on a server at a mapped host name. */
export function artifactURL(server: BuiltServer, host: string, artifactID: string): string {
  return `${origin(server, host)}/artifact/${artifactID}/`;
}

/**
 * Shares an artifact at `access` with the built CLI, which creates its link
 * or changes the link's level, and returns the share ID and the link at a
 * mapped host name, after checking that the command printed that link for
 * every address.
 */
export async function share(server: BuiltServer, artifactID: string, access: "read" | "read-write", host: string): Promise<{ shareID: string; link: string; printed: string }> {
  const shared = await server.tv(["share-artifact", "--id", artifactID, "--access", access]);
  expect(shared.exitCode, shared.stderr).toBe(0);
  const lines = shared.stdout.split("\n").filter(Boolean);
  const shareID = /^\/artifact\/([^/]+)\/$/.exec(new URL(lines[0]!).pathname)?.[1];
  expect(shareID, shared.stdout).toBeDefined();
  for (const line of lines) expect(new URL(line).pathname).toBe(`/artifact/${shareID}/`);
  return { shareID: shareID!, link: `${origin(server, host)}/artifact/${shareID}/`, printed: shared.stdout };
}

/**
 * Writes an authored HTML artifact folder whose page imports the SDK from the
 * server that serves it, runs `script` as a module with the SDK's exports in
 * scope as `sdk`, and gives tests small helpers: `outcome` for how a call
 * ended, `shot` for a snapshot, and `logs` and `record` for what callbacks
 * heard. The page sets `pageReady` once `script` has run.
 */
export function writeArtifactPage(context: ProductContext, title: string, script: string): string {
  const folder = context.temporaryDirectory("television-resource-page-");
  writeFileSync(path.join(folder, "index.html"), `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<h1>${title}</h1>
<script type="module">
import * as sdk from "/sdk/v1/resources.js";
window.sdk = sdk;
window.outcome = async (run) => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, isError: error instanceof Error, code: error && error.code, message: error && error.message };
  }
};
window.shot = (snapshot) => ({
  key: snapshot.key,
  exists: snapshot.exists(),
  value: snapshot.exists() ? snapshot.val() : undefined,
  pending: snapshot.metadata.hasPendingWrites,
});
window.logs = {};
window.record = (name) => (window.logs[name] = []);
${script}
window.pageReady = true;
</script>
`);
  return folder;
}
