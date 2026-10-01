import { afterAll, afterEach, beforeAll } from "vitest";
import type { ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { expect as pwExpect } from "@playwright/test";
export { buildVersionedWebBundle } from "../helpers/versioned-web-bundle.ts";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { startStableFrontProxy, type StableFrontProxy } from "../helpers/stable-front-proxy.ts";

// The reload acceptance spine (specs/product/update-notifications.md):
// one acceptance test per anchored criterion — ^ac-reload-heals,
// ^ac-reload-fresh, ^ac-reload-guard, ^ac-reload-dev, ^ac-reload-origin-only
// — on the boundary the criteria declare (^ac-declaration): a really-running
// Television server spawned as a separate process, driven by a real Chromium
// page over real HTTP and websockets; no mocks anywhere on the path. Version
// staging uses only the sanctioned hooks (specs/arch/updates/index.md
// ^updates-test-hooks): TV_TEST_VERSION on the spawned server's environment,
// TV_TEST_WEB_VERSION through the fixture bundle builder.
//
// The restart-at-version harness: one port-0 front listener keeps the browser
// origin stable while each versioned backend independently binds port 0. On a
// restart, the old backend stops, the new backend publishes its URL, the front
// updates its target, and GET /health must report the new version before any
// assertion — readiness over sleeps. The only fixed waits below are bounded
// observation windows behind NEGATIVE assertions ("no further reload
// happens"), which have no readiness signal to poll.
//
// Runs on the e2e:node surface (real processes + sockets; sandbox-disabled
// per AGENTS.md). Tests in this file run sequentially (vitest default within
// a file) so each test owns and disposes its front/backend pair.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVER_ENTRY = path.join(REPO_ROOT, "test", "node", "helpers", "versioned-static-server.ts");

const RELOAD_MARKER_KEY = "tv-reload-attempted";
const HEALTH_POLL_TIMEOUT_MS = 30_000;
export const RELOAD_POLL_TIMEOUT_MS = 20_000;
// Bounded observation window for negative assertions: long enough to catch a
// wrongly-scheduled reload (the client acts on server-status immediately on
// connect), short enough not to dominate the run.
export const SILENCE_WINDOW_MS = 2_000;

interface ServerHarness {
  process: OwnedProcess;
  backendURL: string;
  front: StableFrontProxy;
  url: string;
  storagePath: string;
}

const harnesses: ServerHarness[] = [];
const dirs: string[] = [];
let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  for (const harness of harnesses.splice(0)) await stopServerProcess(harness);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export async function launchServer(input: { version: string; staticDir: string }): Promise<ServerHarness> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-update-reload-node-"));
  dirs.push(storagePath);
  const backend = await launchBackend({ ...input, storagePath });
  const front = await startStableFrontProxy(backend.url);
  const harness: ServerHarness = { process: backend.process, backendURL: backend.url, front, url: front.url, storagePath };
  harnesses.push(harness);
  await pollHealthVersion(harness.url, input.version);
  return harness;
}

async function launchBackend(input: { version: string; staticDir: string; storagePath: string }): Promise<{ process: OwnedProcess; url: string }> {
  const { TELEVISION_ACP_AGENT: _agent, NODE_OPTIONS: _nodeOptions, VITEST: _vitest, ...env } = process.env;
  const owned = spawnOwnedProcess(
    process.execPath,
    [TSX_CLI, SERVER_ENTRY, "--port", "0", "--home", input.storagePath, "--static-dir", input.staticDir],
    {
      cwd: REPO_ROOT,
      env: {
        ...env,
        TV_TEST_VERSION: input.version,
        // Keep the version-staged server off the production update channel
        // (update-channel.md ^poll-silent-failure makes the dead URL harmless).
        TV_UPDATE_CHANNEL_URL: "http://127.0.0.1:9/update-channel.json",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    return { process: owned, url: await waitForReadyLine(owned.child as ChildProcessByStdio<null, Readable, Readable>) };
  } catch (error) {
    await owned.dispose();
    throw error;
  }
}

async function waitForReadyLine(child: ChildProcessByStdio<null, Readable, Readable>): Promise<string> {
  let stdout = "";
  let stderr = "";
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for READY. stderr:\n${stderr}`)),
      HEALTH_POLL_TIMEOUT_MS,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    const parse = () => {
      const match = stdout.match(/READY (http:\/\/[^\s]+)/);
      if (!match) return;
      cleanup();
      resolve(match[1]!);
    };
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      parse();
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`server exited before READY: ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function pollHealthVersion(url: string, version: string): Promise<void> {
  await pwExpect
    .poll(
      async () => {
        try {
          const response = await fetch(new URL("/health", url));
          const body = (await response.json()) as { version?: string };
          return body.version ?? null;
        } catch {
          return null;
        }
      },
      { timeout: HEALTH_POLL_TIMEOUT_MS },
    )
    .toBe(version);
}

async function stopServerProcess(harness: ServerHarness): Promise<void> {
  await harness.front.dispose();
  const cleanup = await harness.process.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Versioned backend ${harness.process.pid} survived cleanup`);
}

/** Keep the front URL stable while replacing the independently bound backend. */
export async function restartServerAtVersion(
  harness: ServerHarness,
  input: { version: string; staticDir: string },
): Promise<ServerHarness> {
  const cleanup = await harness.process.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Versioned backend ${harness.process.pid} survived cleanup`);
  const backend = await launchBackend({ ...input, storagePath: harness.storagePath });
  harness.process = backend.process;
  harness.backendURL = backend.url;
  harness.front.setTarget(backend.url);
  await pollHealthVersion(harness.url, input.version);
  return harness;
}

export async function newPage(): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return await context.newPage();
}

/** The page's bundle stamp; null while a navigation is in flight. */
export async function bundleVersion(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => document.documentElement.dataset.tvBundleVersion ?? null);
  } catch {
    return null;
  }
}

/** Navigation type of the current document, tolerant of in-flight reloads. */
export async function navigationType(page: Page): Promise<string> {
  try {
    return await page.evaluate(
      () => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type,
    );
  } catch {
    return "navigating";
  }
}

export async function readMarker(page: Page): Promise<unknown> {
  try {
    return await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    }, RELOAD_MARKER_KEY);
  } catch {
    return "navigating";
  }
}

/** Status of the app's connection to `serverURL`, via the exposed e2e seam. */
export async function connectionStatus(page: Page, serverURL: string): Promise<string | null> {
  try {
    return await page.evaluate((url) => {
      const telepath = (window as unknown as {
        __telepath?: { connectionOwner?: { connection: { url: string; status: string } } };
      }).__telepath;
      const connection = telepath?.connectionOwner?.connection;
      return connection?.url === url ? connection.status : null;
    }, serverURL);
  } catch {
    return null;
  }
}

/** Plant a sentinel on the current document; it survives exactly until the next navigation. */
export async function plantSentinel(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __tvNavSentinel?: boolean }).__tvNavSentinel = true;
  });
}

export async function sentinelAlive(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      () => (window as unknown as { __tvNavSentinel?: boolean }).__tvNavSentinel === true,
    );
  } catch {
    return false;
  }
}

/** Normalized connection URL as the client stores it (no trailing slash). */
export function normalized(url: string): string {
  return new URL(url).origin;
}
