import { afterEach, describe, expect, it } from "vitest";
import type { ChildProcessByStdio } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import WebSocket from "ws";
import { parseConnectURL } from "@telepath-computer/television-shared";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILT_CLI = path.join(REPO_ROOT, "packages/cli/dist/cli.cjs");
const START_TIMEOUT_MS = 30_000;
const EVENT_TIMEOUT_MS = 10_000;

interface RunningServer {
  process: OwnedProcess;
  child: ChildProcessByStdio<null, Readable, Readable>;
  url: string;
  token: string;
}

const processes: OwnedProcess[] = [];
const tempPaths: string[] = [];

afterEach(async () => {
  for (const processHandle of processes.splice(0).reverse()) {
    await processHandle.dispose();
  }
  for (const pathname of tempPaths.splice(0).reverse()) {
    rmSync(pathname, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

function write(pathname: string, contents: string): void {
  mkdirSync(path.dirname(pathname), { recursive: true });
  writeFileSync(pathname, contents);
}

function makeBareCLI(): string {
  if (!existsSync(BUILT_CLI)) throw new Error(`Built CLI not found at ${BUILT_CLI}`);
  const cliPath = path.join(tempDir("television-storage-upgrade-cli-"), "cli.cjs");
  copyFileSync(BUILT_CLI, cliPath);
  return cliPath;
}

async function startServer(cliPath: string, storagePath: string): Promise<RunningServer> {
  const { TELEVISION_ACP_AGENT: _ignoredAgent, NODE_OPTIONS: _ignoredNodeOptions, VITEST: _ignoredVitest, ...env } = process.env;
  writeHomeConfig(storagePath, { port: 0 });
  const processHandle = spawnOwnedProcess(process.execPath, [cliPath, "--home", storagePath, "serve"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(processHandle);
  const child = processHandle.child as ChildProcessByStdio<null, Readable, Readable>;

  let stdout = "";
  let stderr = "";
  const connectURL = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for server. stderr:\n${stderr}`)), START_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const match = stdout.match(/https?:\/\/[^\s\u001B]+/);
      if (!match) return;
      cleanup();
      resolve(match[0]);
    };
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString("utf8"); };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Server exited before startup: ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });

  const parsed = parseConnectURL(connectURL);
  if (!parsed.token) throw new Error(`Server connect URL did not contain a token: ${connectURL}`);
  return { process: processHandle, child, url: parsed.serverURL, token: parsed.token };
}

async function stopServer(server: RunningServer): Promise<void> {
  const index = processes.indexOf(server.process);
  if (index >= 0) processes.splice(index, 1);
  const cleanup = await server.process.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Storage-upgrade server ${server.process.pid} survived cleanup`);
}

async function api<T>(server: RunningServer, route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(route, server.url), {
    ...init,
    headers: {
      Authorization: `Bearer ${server.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route} failed ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

async function openEvents(server: RunningServer): Promise<{ socket: WebSocket; events: Array<Record<string, unknown>> }> {
  const socket = new WebSocket(`${server.url.replace(/^http/, "ws")}/events?token=${encodeURIComponent(server.token)}`);
  const events: Array<Record<string, unknown>> = [];
  socket.on("message", (data) => {
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    if (message.type !== "server-status") events.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out opening /events websocket")), EVENT_TIMEOUT_MS);
    socket.once("open", () => { clearTimeout(timeout); resolve(); });
    socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
  return { socket, events };
}

async function waitForEvents(events: Array<Record<string, unknown>>, count: number): Promise<void> {
  const deadline = Date.now() + EVENT_TIMEOUT_MS;
  while (events.length < count) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${count} events; received ${JSON.stringify(events)}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const STORAGE_UPGRADE_TITLE =
  "boots a pre-redesign directory through current HTTP and websocket contracts, then restarts byte-stably";

describe("redesign storage upgrade acceptance", () => {
  it(STORAGE_UPGRADE_TITLE, async () => {
    const storagePath = tempDir("television-storage-upgrade-");
    const cliPath = makeBareCLI();
    const channelID = "opaque-workspace-1";
    const artifactIDs = [
      "opaque-file-artifact",
      "opaque-directory-artifact",
      "opaque-url-artifact",
      "opaque-markdown-artifact",
    ] as const;
    const htmlPath = path.join(storagePath, "artifacts", "legacy-file.html");
    const directoryPath = path.join(storagePath, "artifacts", "legacy-directory") + path.sep;
    const markdownPath = path.join(storagePath, "artifacts", "legacy-note.md");
    const artifacts = [
      { id: artifactIDs[0], kind: "path", title: "Legacy file", path: htmlPath },
      { id: artifactIDs[1], kind: "path", title: "Legacy directory", path: directoryPath },
      { id: artifactIDs[2], kind: "url", title: "Legacy URL", url: "https://example.com/reference" },
      { id: artifactIDs[3], kind: "path", title: "Legacy markdown", path: markdownPath },
    ];
    const legacyChannel = {
      id: channelID,
      name: "Authored workspace",
      layout: [
        { type: "card", artifactID: artifactIDs[0], width: 2, height: "auto" },
        {
          id: "vertical-stack",
          type: "stack",
          children: [
            {
              id: "horizontal-row",
              type: "row",
              height: 3,
              children: [
                { type: "card", artifactID: artifactIDs[1], width: 2, height: 3 },
                { type: "card", artifactID: artifactIDs[2], width: 2, height: 3 },
              ],
            },
            { type: "card", artifactID: artifactIDs[3], width: "auto", height: 3 },
          ],
        },
      ],
      onboarding: { slug: "starter", order: 7 },
      futureSibling: { preserved: true },
    };
    const currentLayout = artifactIDs.map((artifactID) => ({
      artifactIds: [artifactID],
      geometry: { kind: "single", full_screen: false },
      size: { width: 560, height: 740 },
    }));
    const currentChannel = {
      id: channelID,
      name: "Authored workspace",
      layout: currentLayout,
      onboarding: { slug: "starter" },
    };
    const legacyDisplay = {
      activeScreenID: channelID,
      activeThemeName: "paper",
      futureSibling: { order: [3, 1, 2] },
    };
    const contentBytes = new Map<string, string>([
      [htmlPath, "<!doctype html><h1>legacy file</h1>"],
      [path.join(directoryPath, "index.html"), "<!doctype html><h1>legacy directory</h1>"],
      [markdownPath, "# Legacy markdown\n"],
    ]);
    const themePath = path.join(storagePath, "themes", "paper", "theme.css");
    const themeBytes = ":root { --test-theme: paper; }";
    const themeManifestPath = path.join(storagePath, "themes", "paper", "manifest.json");
    const themeManifestBytes = `${JSON.stringify({
      name: "Paper",
      slug: "paper",
      version: "1.0.0",
      colorScheme: "light dark",
    }, null, 2)}\n`;

    write(
      path.join(storagePath, "state", "screens", `${channelID}.json`),
      JSON.stringify(legacyChannel, null, 3),
    );
    const artifactBytes = new Map<string, string>();
    for (const artifact of artifacts) {
      const metadataPath = path.join(storagePath, "state", "artifacts", `${artifact.id}.json`);
      const bytes = JSON.stringify(artifact, null, 2);
      artifactBytes.set(metadataPath, bytes);
      write(metadataPath, bytes);
    }
    for (const [pathname, bytes] of contentBytes) write(pathname, bytes);
    write(path.join(storagePath, "state", "display.json"), JSON.stringify(legacyDisplay, null, 2));
    write(themePath, themeBytes);
    write(themeManifestPath, themeManifestBytes);

    let server = await startServer(cliPath, storagePath);
    expect((await api<{ channels: unknown[] }>(server, "/channels")).channels).toEqual([currentChannel]);
    expect(await api(server, `/channels/${channelID}`)).toEqual({ channel: currentChannel, artifacts });
    expect(await api(server, "/display")).toMatchObject({
      focusedChannelId: channelID,
      pinnedChannelIds: [],
      activeThemeName: "paper",
      activeThemeColorScheme: "light dark",
      appearanceMode: "system",
    });
    expect(existsSync(path.join(storagePath, "state", "screens"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "channels", `${channelID}.json`), "utf8"))).toEqual({
      id: channelID,
      name: "Authored workspace",
      layoutVersion: 2,
      layout: currentLayout,
      onboarding: { slug: "starter" },
      futureSibling: { preserved: true },
    });
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "display.json"), "utf8"))).toEqual({
      focusedChannelId: channelID,
      pinnedChannelIds: [],
      activeThemeName: "paper",
      futureSibling: { order: [3, 1, 2] },
      appearanceMode: "system",
    });
    for (const [pathname, bytes] of [...artifactBytes, ...contentBytes]) {
      expect(readFileSync(pathname, "utf8")).toBe(bytes);
    }
    expect(readFileSync(themePath, "utf8")).toBe(themeBytes);
    expect(readFileSync(themeManifestPath, "utf8")).toBe(themeManifestBytes);

    await stopServer(server);
    const channelAfterMigration = readFileSync(path.join(storagePath, "state", "channels", `${channelID}.json`));
    const displayAfterMigration = readFileSync(path.join(storagePath, "state", "display.json"));

    server = await startServer(cliPath, storagePath);
    expect(readFileSync(path.join(storagePath, "state", "channels", `${channelID}.json`))).toEqual(channelAfterMigration);
    expect(readFileSync(path.join(storagePath, "state", "display.json"))).toEqual(displayAfterMigration);
    expect(await api(server, `/channels/${channelID}`)).toEqual({ channel: currentChannel, artifacts });
    for (const [pathname, bytes] of [...artifactBytes, ...contentBytes]) {
      expect(readFileSync(pathname, "utf8")).toBe(bytes);
    }
    expect(readFileSync(themePath, "utf8")).toBe(themeBytes);
    expect(readFileSync(themeManifestPath, "utf8")).toBe(themeManifestBytes);

    const { socket, events } = await openEvents(server);
    const renamedChannel = { ...currentChannel, name: "Renamed after migration" };
    await api(server, `/channels/${channelID}`, {
      method: "PATCH",
      body: JSON.stringify({ name: renamedChannel.name }),
    });
    await waitForEvents(events, 1);
    expect(events).toEqual([{ type: "channel-updated", channel: renamedChannel }]);
    socket.close();
    await stopServer(server);
  });
});
