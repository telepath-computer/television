import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  disposeAllOwnedProcesses,
  ownedProcessCount,
  spawnOwnedProcess,
} from "../helpers/owned-process.ts";
import { startStableFrontProxy } from "../helpers/stable-front-proxy.ts";
import { readLinuxProcess, readMacOSProcesses } from "../../scripts/test/process-lifecycle.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LISTENER_CHILD = path.join(REPO_ROOT, "test/runner-fixtures/process-lifecycle/listener-child.mjs");
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await disposeAllOwnedProcesses();
  for (const server of servers.splice(0).reverse()) await closeServer(server);
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("owned test process helper", () => {
  it("inherits the surface owner, creates a process group, and disposes idempotently with TERM", async () => {
    const ownerToken = process.env.TV_TEST_SURFACE_OWNER;
    expect(ownerToken).toMatch(/^tv1\./);
    const directory = mkdtempSync(path.join(os.tmpdir(), "tv-owned-process-"));
    temporaryDirectories.push(directory);
    const readyFile = path.join(directory, "ready.json");

    const owned = spawnOwnedProcess(process.execPath, [LISTENER_CHILD], {
      cwd: REPO_ROOT,
      env: { ...process.env, TV_LIFECYCLE_READY_FILE: readyFile },
      stdio: ["ignore", "pipe", "pipe"],
      termGraceMs: 500,
    });
    expect(ownedProcessCount()).toBe(1);
    const ready = await waitForJson<{ pid: number; url: string; ownerToken: string }>(readyFile);
    expect(ready.ownerToken).toBe(ownerToken);
    const processInfo = process.platform === "darwin"
      ? readMacOSProcesses().find((entry) => entry.pid === ready.pid)
      : readLinuxProcess(ready.pid);
    expect(processInfo).toMatchObject({ pid: ready.pid, pgid: ready.pid, ownerToken });
    expect((await fetch(ready.url)).status).toBe(200);

    const firstCleanup = await owned.dispose();
    expect(firstCleanup).toEqual({ termSent: true, killSent: false, outcome: "terminated" });
    expect(await owned.dispose()).toEqual(firstCleanup);
    expect(ownedProcessCount()).toBe(0);
    await expectProcessGone(ready.pid);
  });

  it("registers a child immediately for shared prompt cleanup", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tv-owned-process-registry-"));
    temporaryDirectories.push(directory);
    const readyFile = path.join(directory, "ready.json");
    const owned = spawnOwnedProcess(process.execPath, [LISTENER_CHILD], {
      cwd: REPO_ROOT,
      env: { ...process.env, TV_LIFECYCLE_READY_FILE: readyFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ready = await waitForJson<{ pid: number }>(readyFile);
    expect(ownedProcessCount()).toBe(1);
    await disposeAllOwnedProcesses();
    expect(ownedProcessCount()).toBe(0);
    await expectProcessGone(ready.pid);
    expect((await owned.dispose()).outcome).toBe("terminated");
  });
});

describe("stable front proxy", () => {
  it("keeps one kernel-selected URL while forwarding to successive port-0 backends", async () => {
    const first = await startBackend("first");
    const second = await startBackend("second");
    expect(new URL(first.url).port).not.toBe(new URL(second.url).port);
    const front = await startStableFrontProxy(first.url);
    const stableURL = front.url;
    const frontPort = Number(new URL(stableURL).port);

    expect(await (await fetch(stableURL)).text()).toBe("first");
    front.setTarget(second.url);
    expect(front.url).toBe(stableURL);
    expect(await (await fetch(stableURL)).text()).toBe("second");

    await front.dispose();
    await expectPortCanRebind(frontPort);
  });
});

async function startBackend(body: string): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => response.end(body));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("backend did not bind TCP");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function waitForJson<T>(file: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (processExists(pid)) {
    if (Date.now() >= deadline) throw new Error(`PID ${pid} remained alive`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function expectPortCanRebind(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await closeServer(server);
}
