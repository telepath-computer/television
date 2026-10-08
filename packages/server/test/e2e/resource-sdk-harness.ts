// The browser harness for the resource SDK's contracts
// (proofs/arch/resources/sdk.md, Test hooks): a mapped plain-HTTP host name,
// authored artifact pages that load the SDK as the server serves it, and the
// network proxy where a test names it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import type * as Sdk from "../../../shared/src/resources/sdk.ts";
import { ResourceTestContext, type RunningServer, type StartOptions } from "../resources/harness.ts";
import { NetworkProxy } from "./network-proxy.ts";

export const SDK_DIR = fileURLToPath(new URL("../../dist/sdk", import.meta.url));

/** A host name the browser resolves to the loopback server: a plain-HTTP origin that is not localhost. */
export const TEST_HOST = "tv-sdk.test";

/** Browser launch options mapping the test host name to the loopback server. */
export const MAPPED_HOST_LAUNCH = { args: [`--host-resolver-rules=MAP ${TEST_HOST} 127.0.0.1`] };

/** A page's view of a snapshot, as the authored page records it. */
export interface Shot {
  key: string | null;
  exists: boolean;
  value: unknown;
  pending: boolean;
}

/** How an SDK call ended, as the authored page reports it. */
export type Outcome = { ok: true; value: unknown } | { ok: false; isError: boolean; code: unknown; message: unknown };

declare global {
  interface Window {
    sdk: typeof Sdk;
    sdkReady: boolean;
    outcome: (run: () => unknown) => Promise<Outcome>;
    /**
     * How `run` ends before the page's next task, or "waiting" while it has not. A call that fails at once
     * settles within microtasks; one that fails only when a reconnection attempt fails takes a task or more.
     */
    atOnce: (run: () => unknown) => Promise<Outcome | "waiting">;
    shot: (snapshot: Sdk.Snapshot) => Shot;
    logs: Record<string, unknown[]>;
    record: (name: string) => unknown[];
  }
}

/**
 * The authored artifact page: it imports the SDK from the server that served
 * it, as artifact code does, and gives tests small helpers for reading
 * outcomes and snapshots.
 */
const PAGE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Resource SDK page</title>
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
window.atOnce = (run) => Promise.race([window.outcome(run), new Promise((resolve) => setTimeout(() => resolve("waiting"), 0))]);
window.shot = (snapshot) => ({
  key: snapshot.key,
  exists: snapshot.exists(),
  value: snapshot.exists() ? snapshot.val() : undefined,
  pending: snapshot.metadata.hasPendingWrites,
});
window.logs = {};
window.record = (name) => (window.logs[name] = []);
window.sdkReady = true;
</script>
`;

/** The URL of a page on the mapped host name at `port`. */
export function pageURL(port: number, pagePath: string): string {
  return `http://${TEST_HOST}:${port}${pagePath}`;
}

export function artifactPath(artifactID: string, rest = ""): string {
  return `/artifact/${encodeURIComponent(artifactID)}/${rest}`;
}

/** Loads a page and waits for its SDK; every test page first checks that it is not a secure context. */
export async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.sdkReady === true);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
}

/** Polls the page until `check` returns true. */
export async function pageWaitFor(page: Page, check: () => boolean, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(check, undefined, { timeout: timeoutMs });
}

/** Servers, proxies and folders for one test, cleaned up after it. */
export class SdkTestContext {
  readonly resources = new ResourceTestContext();
  private readonly proxies: NetworkProxy[] = [];
  private readonly folders: string[] = [];

  start(options: StartOptions = {}): Promise<RunningServer> {
    return this.resources.start({ auth: true, sdkDir: SDK_DIR, ...options });
  }

  async proxy(server: RunningServer): Promise<NetworkProxy> {
    const proxy = await NetworkProxy.start(serverPort(server));
    this.proxies.push(proxy);
    return proxy;
  }

  /**
   * Registers a folder artifact serving the authored page as `index.html` and
   * `sub/page.html`, and returns its ID. With a fixed `id`, as earlier
   * releases' onboarding gave, the artifact has no store.
   */
  createPageArtifact(server: RunningServer, title = "Page", options: { id?: string } = {}): string {
    const folder = this.folder("television-sdk-page-");
    writeFileSync(path.join(folder, "index.html"), PAGE_HTML);
    mkdirSync(path.join(folder, "sub"));
    writeFileSync(path.join(folder, "sub", "page.html"), PAGE_HTML);
    const channel = server.store.listChannels()[0]!;
    return server.store.createArtifact({ ...options, kind: "path", title, channelID: channel.id, path: folder }).id;
  }

  /** A page artifact whose own store holds `value`, written through the administrative routes; returns its ID and the store's resource ID. */
  async pageWithStore(server: RunningServer, value: JSONValue, title = "Page"): Promise<{ artifactID: string; resourceID: string }> {
    const artifactID = this.createPageArtifact(server, title);
    const written = await server.jsonSet({ artifactID }, "", value);
    if (written.status !== 200) throw new Error(`writing the store of ${title} failed: ${JSON.stringify(written.body)}`);
    return { artifactID, resourceID: server.storePointer(artifactID)! };
  }

  /** A folder for the server's static root holding the authored page at `/plain.html`, a path of another form. */
  staticPageFolder(): string {
    const folder = this.folder("television-sdk-static-");
    writeFileSync(path.join(folder, "plain.html"), PAGE_HTML);
    return folder;
  }

  async cleanup(): Promise<void> {
    for (const proxy of this.proxies.splice(0)) await proxy.close();
    await this.resources.cleanup();
    for (const folder of this.folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  }

  private folder(prefix: string): string {
    const folder = mkdtempSync(path.join(os.tmpdir(), prefix));
    this.folders.push(folder);
    return folder;
  }
}

/** The port a running server listens on. */
export function serverPort(server: RunningServer): number {
  return Number(new URL(server.baseURL).port);
}

/** Waits real time, for traffic the test expects not to see. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
