import { afterEach, describe, expect, it } from "vitest";
import { spawnSync, type ChildProcessByStdio } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import request from "supertest";
import WebSocket from "ws";
import { runCLI } from "../../packages/cli/src/index.ts";
import { Server } from "../../packages/server/src/server.ts";
import { createServingStore } from "../helpers/serving-store.ts";
import { seedThemePackage } from "../helpers/theme-package.ts";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";
import type { Readable } from "node:stream";

const REPO_ROOT = path.resolve(process.cwd());
const START_TIMEOUT_MS = 30_000;
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const BUILT_CLI = path.join(REPO_ROOT, "packages", "cli", "dist", "cli.cjs");

/*
 * This file crosses the real CLI action/server handoff declared by
 * [[arch/cli/index.md#^bd409c7e|the HTTP/WebSocket seam]], including the focused
 * directory-path and event-broadcast crossings [[arch/cli/index.md#^1011445e]] and
 * [[arch/cli/index.md#^7cf17933]]. Registry deletion also preserves the external
 * target as required by [[product/cli.md#^e5b85571|the artifact invariant]]. Its spawned serve tests cover
 * [[product/cli.md#^c7f9f202|foreground acceptance]],
 * [[arch/cli/index.md#^fd17f122|server lifecycle]], and
 * [[arch/cli/index.md#^193e8638|authenticated startup]].
 */

class BufferOutput {
  chunks: string[] = [];
  write(chunk: string | Uint8Array): void { this.chunks.push(String(chunk)); }
  toString(): string { return this.chunks.join(""); }
}

function readLogRecords(storagePath: string): Array<Record<string, unknown>> {
  return readFileSync(path.join(storagePath, "logs", "tv.log"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function createServeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITEST: "",
  };
  delete env.TELEVISION_ACP_AGENT;
  return env;
}

function extractStartupURL(text: string): string | null {
  return text.match(/https?:\/\/[^\s\u001B]+/)?.[0] ?? null;
}

function extractStartupURLs(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/[^\s\u001B]+/g)].map((match) => match[0]))];
}

function discoverHostNonLoopbackIPv4(): string {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  throw new Error("CLI multi-listener acceptance requires an assigned non-loopback IPv4 address");
}

async function waitForOutput(read: () => string, expected: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!read().includes(expected)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for output ${expected}\n${read()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function connect(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

// The in-process server binds port 0. Its home's config file sets port 0, so
// the CLI commands given that home pass the bound port with --port.
async function startTestServer(servers: Server[], store: ReturnType<typeof createServingStore>, auth = true): Promise<{ server: Server; port: number }> {
  writeHomeConfig(store.storagePath, { port: 0 });
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth });
  servers.push(server);
  await server.start();
  return { server, port: Number.parseInt(new URL(server.getBaseURL()).port, 10) };
}

describe("CLI node integration artifact workflow", () => {
  const servers: Server[] = [];
  const processes: OwnedProcess[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const processHandle of processes.splice(0).reverse()) await processHandle.dispose();
    for (const server of servers.splice(0)) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips pointer artifacts through the real CLI, server, and proxy", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "index.html");
    writeFileSync(target, "<!doctype html><h1>CLI artifact</h1>");

    const store = createServingStore(storagePath);
    const { server, port } = await startTestServer(servers, store);
    const channel = store.listChannels()[0]!;

    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    const exitCode = await runCLI([
      "create-path-artifact",
      "--channel", channel.id,
      "--title", "CLI HTML",
      "--path", target,
      "--no-focus",
      "--port", String(port),
      "--home", storagePath,
    ], { stdout, stderr });

    expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Path artifact");
    const artifact = store.listArtifacts()[0];
    expect(artifact).toMatchObject({ kind: "path", title: "CLI HTML", path: target });

    await request(server.httpServer)
      .get(`/artifact/${artifact!.id}/${encodeURIComponent(path.basename(target))}`)
      .expect(200)
      .expect(({ text }) => expect(text).toContain("CLI artifact"));
  });

  it("accepts a directory path without a trailing separator and serves it as a directory artifact", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    writeFileSync(path.join(targetDir, "index.html"), "<!doctype html><h1>Directory artifact</h1>");

    const store = createServingStore(storagePath);
    const { server, port } = await startTestServer(servers, store);
    const channel = store.listChannels()[0]!;

    const exitCode = await runCLI([
      "create-path-artifact",
      "--channel", channel.id,
      "--title", "CLI Directory",
      "--path", targetDir,
      "--no-focus",
      "--port", String(port),
      "--home", storagePath,
    ], { stdout: new BufferOutput(), stderr: new BufferOutput() });

    expect(exitCode).toBe(0);
    const artifact = store.listArtifacts()[0];
    expect(artifact).toMatchObject({ kind: "path", title: "CLI Directory", path: `${targetDir}${path.sep}` });

    await request(server.httpServer)
      .get(`/artifact/${artifact!.id}/`)
      .expect(200)
      .expect(({ text }) => expect(text).toContain("Directory artifact"));
  });

  it("server and CLI round-trip through status, title update, get, and delete", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "status.html");
    writeFileSync(target, "<!doctype html><h1>Status</h1>");
    const store = createServingStore(storagePath);
    const { server, port } = await startTestServer(servers, store);
    const channel = store.listChannels()[0]!;

    const statusOut = new BufferOutput();
    expect(await runCLI(["status", "--port", String(port), "--home", storagePath], { stdout: statusOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(statusOut.toString())).toMatchObject({ healthy: true, serverURL: `http://localhost:${port}` });

    const createOut = new BufferOutput();
    expect(await runCLI(["create-path-artifact", "--channel", channel.id, "--title", "First", "--path", target, "--no-focus", "--port", String(port), "--home", storagePath], { stdout: createOut, stderr: new BufferOutput() })).toBe(0);
    const artifact = store.listArtifacts()[0]!;

    expect(await runCLI(["update-artifact", "--id", artifact.id, "--title", "Updated", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);

    const getOut = new BufferOutput();
    expect(await runCLI(["get-artifact", "--id", artifact.id, "--port", String(port), "--home", storagePath], { stdout: getOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(getOut.toString()).artifact).toMatchObject({ id: artifact.id, kind: "path", title: "Updated", path: target });

    // Repoint to a directory supplied without a trailing separator; the
    // server normalizes the stored path and the proxy serves the new target.
    const repointDir = path.join(targetDir, "site");
    mkdirSync(repointDir);
    writeFileSync(path.join(repointDir, "index.html"), "<!doctype html><h1>Repointed</h1>");
    expect(await runCLI(["update-artifact", "--id", artifact.id, "--path", repointDir, "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    const repointedOut = new BufferOutput();
    expect(await runCLI(["get-artifact", "--id", artifact.id, "--port", String(port), "--home", storagePath], { stdout: repointedOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(repointedOut.toString()).artifact).toMatchObject({ id: artifact.id, kind: "path", title: "Updated", path: `${repointDir}${path.sep}` });
    await request(server.httpServer)
      .get(`/artifact/${artifact.id}/`)
      .expect(200)
      .expect(({ text }) => expect(text).toContain("Repointed"));

    // A repoint to a missing target is refused by the server and reported legibly.
    const missingErr = new BufferOutput();
    expect(await runCLI(["update-artifact", "--id", artifact.id, "--path", path.join(targetDir, "nope"), "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: missingErr })).toBe(1);
    expect(missingErr.toString()).toContain("does not exist or is not readable");

    // URL artifacts repoint with --url through the same real server.
    expect(await runCLI(["create-url-artifact", "--channel", channel.id, "--title", "Link", "--url", "https://example.com/first", "--no-focus", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    const urlArtifact = store.listArtifacts().find((candidate) => candidate.kind === "url")!;
    expect(await runCLI(["update-artifact", "--id", urlArtifact.id, "--url", "https://example.com/second", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    const urlOut = new BufferOutput();
    expect(await runCLI(["get-artifact", "--id", urlArtifact.id, "--port", String(port), "--home", storagePath], { stdout: urlOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(urlOut.toString()).artifact).toMatchObject({ id: urlArtifact.id, kind: "url", url: "https://example.com/second" });
    expect(await runCLI(["delete-artifact", "--id", urlArtifact.id, "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);

    expect(await runCLI(["delete-artifact", "--id", artifact.id, "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    expect(store.listArtifacts()).toHaveLength(0);
    expect(readFileSync(path.join(repointDir, "index.html"), "utf8")).toContain("Repointed");
  });

  it("create-channel and remove-channel round-trip", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-channel-target-"));
    dirs.push(storagePath, targetDir);
    const pathTarget = path.join(targetDir, "survives.html");
    writeFileSync(pathTarget, "<!doctype html><h1>Preserved channel target</h1>");
    const urlTarget = "https://example.com/preserved-channel-target";
    const store = createServingStore(storagePath);
    const { port } = await startTestServer(servers, store);

    const createOut = new BufferOutput();
    expect(await runCLI(["create-channel", "--name", "Scratch", "--no-focus", "--port", String(port), "--home", storagePath], { stdout: createOut, stderr: new BufferOutput() })).toBe(0);
    const created = store.listChannels().find((channel) => channel.name === "Scratch")!;
    expect(createOut.toString()).toContain(created.id);

    expect(await runCLI(["create-path-artifact", "--channel", created.id, "--title", "Path", "--path", pathTarget, "--no-focus", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    expect(await runCLI(["create-url-artifact", "--channel", created.id, "--title", "URL", "--url", urlTarget, "--no-focus", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    const referencedArtifacts = store.listArtifacts();
    expect(referencedArtifacts.map((artifact) => artifact.kind).sort()).toEqual(["path", "url"]);

    const listOut = new BufferOutput();
    expect(await runCLI(["list-channels", "--port", String(port), "--home", storagePath], { stdout: listOut, stderr: new BufferOutput() })).toBe(0);
    expect(listOut.toString()).toContain("Scratch");

    const removeOut = new BufferOutput();
    expect(await runCLI(["remove-channel", "--channel", created.id, "--port", String(port), "--home", storagePath], { stdout: removeOut, stderr: new BufferOutput() })).toBe(0);
    expect(store.getChannel(created.id)).toBeUndefined();
    expect(store.listArtifacts()).toEqual([]);
    expect(removeOut.toString()).toContain("2 referenced artifact(s):");
    expect(removeOut.toString()).toContain(`path: ${pathTarget}`);
    expect(removeOut.toString()).toContain("path target was not touched.");
    expect(removeOut.toString()).toContain(`url: ${urlTarget}`);
    expect(removeOut.toString()).toContain("url target was not touched.");
    expect(existsSync(pathTarget)).toBe(true);
    expect(readFileSync(pathTarget, "utf8")).toContain("Preserved channel target");
  });

  it("focus flags on create commands control display attention", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "focus.html");
    writeFileSync(target, "<!doctype html><h1>Focus</h1>");
    const store = createServingStore(storagePath);
    const { port } = await startTestServer(servers, store);
    const channel = store.listChannels()[0]!;
    const focusEvents: Array<{ artifactID: string; channelID: string }> = [];
    store.addEventListener("artifact-focus", (event) => {
      const focus = event as { artifactID: string; channelID: string };
      focusEvents.push({ artifactID: focus.artifactID, channelID: focus.channelID });
    });

    expect(await runCLI(["create-path-artifact", "--channel", channel.id, "--title", "Quiet", "--path", target, "--no-focus", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    expect(focusEvents).toEqual([]);

    expect(await runCLI(["create-url-artifact", "--channel", channel.id, "--title", "Focused", "--url", "https://example.com", "--focus-artifact", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    const focused = store.listArtifacts().find((artifact) => artifact.kind === "url")!;
    expect(focusEvents).toEqual([{ artifactID: focused.id, channelID: channel.id }]);
  });

  it("display CLI commands set active channel, report status, and broadcast focus", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "display.html");
    writeFileSync(target, "<!doctype html><h1>Display</h1>");
    const store = createServingStore(storagePath);
    const other = store.createChannel({ name: "Other" });
    const artifact = store.createArtifact({ kind: "path", title: "Display", path: target, channelID: other.id });
    const { port } = await startTestServer(servers, store);
    const focusEvents: Array<{ artifactID: string; channelID: string }> = [];
    store.addEventListener("artifact-focus", (event) => {
      const focus = event as { artifactID: string; channelID: string };
      focusEvents.push({ artifactID: focus.artifactID, channelID: focus.channelID });
    });

    expect(await runCLI(["focus-channel", "--channel", other.id, "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    const statusOut = new BufferOutput();
    expect(await runCLI(["focus-status", "--port", String(port), "--home", storagePath], { stdout: statusOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(statusOut.toString())).toEqual({
      activeChannelID: other.id,
      activeThemeName: null,
      acpEnabled: false,
    });

    expect(await runCLI(["focus-artifact", "--id", artifact.id, "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    expect(focusEvents).toEqual([{ artifactID: artifact.id, channelID: other.id }]);
  });

  // Spec: [[arch/cli/index.md#^bd409c7e|real CLI/server theme seam]].
  // Specs: [[arch/cli/index.md#^bd409c7e|CLI/server seam]], [[arch/cli/index.md#^cli-themes-path-server-seam|themes-path names the scanned directory]].
  it("refreshes and sets a newly installed theme and reports invalid or missing themes through the real server", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const { port } = await startTestServer(servers, store);
    const exactThemeID = "Paper Theme.v2 🎨";
    const themesPathOut = new BufferOutput();
    expect(await runCLI(["--home", storagePath, "themes-path"], { stdout: themesPathOut, stderr: new BufferOutput() })).toBe(0);
    const { themesPath } = JSON.parse(themesPathOut.toString()) as { themesPath: string };
    const packageDir = path.join(themesPath, exactThemeID);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(path.join(packageDir, "manifest.json"), `${JSON.stringify({ name: exactThemeID, version: "1.0.0", colorScheme: "light dark" })}\n`);
    writeFileSync(path.join(packageDir, "theme.css"), ":root { color-scheme: light; }");

    const successOut = new BufferOutput();
    const successErr = new BufferOutput();
    expect(await runCLI(["set-theme", exactThemeID, "--port", String(port), "--home", storagePath], { stdout: successOut, stderr: successErr })).toBe(0);
    expect(successOut.toString()).toBe(`Active theme changed from 'None' to '${exactThemeID}'.\n`);
    expect(successErr.toString()).toBe("");

    const statusOut = new BufferOutput();
    expect(await runCLI(["focus-status", "--port", String(port), "--home", storagePath], { stdout: statusOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(statusOut.toString()).activeThemeName).toBe(exactThemeID);
    expect(store.getThemeRegistry().themes.map((theme) => theme.id)).toEqual([exactThemeID]);

    const brokenDir = seedThemePackage(storagePath, "broken");
    writeFileSync(
      path.join(brokenDir, "manifest.json"),
      `${JSON.stringify({ name: "Broken", version: "invalid" })}\n`,
      "utf8",
    );
    const invalidOut = new BufferOutput();
    const invalidErr = new BufferOutput();
    expect(await runCLI(["set-theme", "broken", "--port", String(port), "--home", storagePath], { stdout: invalidOut, stderr: invalidErr })).toBe(1);
    expect(invalidOut.toString()).toBe("");
    expect(invalidErr.toString()).toContain("Theme folder broken is invalid");
    expect(invalidErr.toString()).toContain("manifest version must be a valid Semantic Version");
    expect(store.getActiveThemeName()).toBe(exactThemeID);

    const missingOut = new BufferOutput();
    const missingErr = new BufferOutput();
    expect(await runCLI(["set-theme", "missing", "--port", String(port), "--home", storagePath], { stdout: missingOut, stderr: missingErr })).toBe(1);
    expect(missingOut.toString()).toBe("");
    expect(missingErr.toString()).toContain("Theme not found: missing");
    expect(missingErr.toString()).toContain("Television ships bundled skills");
    expect(store.getActiveThemeName()).toBe(exactThemeID);
  });

  it("creates URL artifacts with auth token read from storage and lists them", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const { port } = await startTestServer(servers, store);
    const channel = store.listChannels()[0]!;

    const createOut = new BufferOutput();
    expect(await runCLI([
      "create-url-artifact", "--channel", channel.id, "--title", "Remote", "--url", "https://example.com", "--no-focus", "--port", String(port), "--home", storagePath,
    ], { stdout: createOut, stderr: new BufferOutput() })).toBe(0);
    expect(createOut.toString()).toContain("URL artifact");

    const listOut = new BufferOutput();
    expect(await runCLI(["list-artifacts", "--port", String(port), "--home", storagePath], { stdout: listOut, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(listOut.toString()).artifacts).toEqual([expect.objectContaining({ kind: "url", title: "Remote", url: "https://example.com" })]);
  });

  it("enforces token auth over real localhost HTTP and WebSocket connections while the CLI still works", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const { server, port } = await startTestServer(servers, store);

    await request(server.httpServer).get("/channels").expect(401);
    const socket = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events`);
    await new Promise<void>((resolve) => socket.on("close", () => resolve()));

    const stdout = new BufferOutput();
    expect(await runCLI(["list-channels", "--port", String(port), "--home", storagePath], { stdout, stderr: new BufferOutput() })).toBe(0);
    expect(JSON.parse(stdout.toString()).channels).toHaveLength(1);
  });

  it("layout changes via PATCH /channels persist across server reconnection", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "patch.html");
    writeFileSync(target, "<!doctype html><h1>Patch</h1>");
    const firstStore = createServingStore(storagePath);
    const channel = firstStore.listChannels()[0]!;
    const { server: first } = await startTestServer(servers, firstStore);

    const createResponse = await request(first.httpServer)
      .post("/artifacts")
      .set("Authorization", `Bearer ${firstStore.authToken}`)
      .send({ kind: "path", title: "Patch", path: target, channelID: channel.id })
      .expect(201);
    const artifact = createResponse.body.artifact;
    const layout = [{
      artifactIds: [artifact.id],
      geometry: { kind: "single", full_screen: true },
      size: { width: 560, height: 740 },
    }];

    await request(first.httpServer)
      .patch(`/channels/${channel.id}`)
      .set("Authorization", `Bearer ${firstStore.authToken}`)
      .send({ layout })
      .expect(200);
    await first.dispose();
    servers.splice(servers.indexOf(first), 1);

    const secondStore = createServingStore(storagePath);
    await startTestServer(servers, secondStore);

    expect(secondStore.getChannel(channel.id)?.channel.layout).toEqual(layout);
  });

  it("persists channel layout across server restart after CLI-created artifact", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "index.html");
    writeFileSync(target, "<!doctype html><h1>Persisted</h1>");
    const firstStore = createServingStore(storagePath);
    const { server: first, port } = await startTestServer(servers, firstStore);
    const channel = firstStore.listChannels()[0]!;

    expect(await runCLI(["create-path-artifact", "--channel", channel.id, "--title", "Persisted", "--path", target, "--no-focus", "--port", String(port), "--home", storagePath], { stdout: new BufferOutput(), stderr: new BufferOutput() })).toBe(0);
    await first.dispose();
    servers.splice(servers.indexOf(first), 1);

    const secondStore = createServingStore(storagePath);
    await startTestServer(servers, secondStore);

    const snapshot = secondStore.getChannel(channel.id)!;
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ kind: "path", title: "Persisted", path: target })]);
    expect(snapshot.channel.layout).toHaveLength(1);
  });

  // Specs: [[product/cli.md#^cli-ac-bind-failure|bind-failure acceptance]], [[arch/cli/startup-bind-failure.md#^t-spine-fatal-exit]].
  it("tv serve exits with status 69 and closes all listeners after a bind failure", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-bind-failure-"));
    dirs.push(storagePath);
    writeHomeConfig(storagePath, { port: 0, auth: false, listen: ["192.0.2.1"] });
    const owned = spawnOwnedProcess(process.execPath, [BUILT_CLI, "--home", storagePath, "serve", "--print-links"], {
      cwd: REPO_ROOT,
      env: createServeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(owned);
    const child = owned.child as ChildProcessByStdio<null, Readable, Readable>;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for bind-failing CLI to exit\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, START_TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    expect(exit.signal).toBeNull();
    const fatalRecords = readLogRecords(storagePath).filter((record) => record.msg === "server startup failed");
    expect(fatalRecords).toHaveLength(1);
    const outcomes = fatalRecords[0]?.outcomes as Array<Record<string, unknown>> | undefined;
    expect(outcomes).toContainEqual(expect.objectContaining({
      address: "192.0.2.1",
      outcome: "failed",
      code: "EADDRNOTAVAIL",
    }));
    const boundLoopback = outcomes?.find((outcome) => outcome.address === "127.0.0.1" && outcome.outcome === "bound");
    expect(boundLoopback).toEqual(expect.objectContaining({ port: expect.any(Number) }));
    if (typeof boundLoopback?.port !== "number") throw new Error("fatal record did not contain the bound loopback port");
    await expect(connect("127.0.0.1", boundLoopback.port)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(exit.code).toBe(69);
  }, START_TIMEOUT_MS);

  // Spec: [[product/cli.md#^cli-ac-multi-listener-success|multi-listener success acceptance]].
  it("tv serve binds loopback and the host non-loopback IPv4 that tv config set wrote to listen", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-multi-listener-"));
    dirs.push(root);
    const home = path.join(root, "home");
    const configPath = path.join(home, "config.json");
    const nonLoopbackIPv4 = discoverHostNonLoopbackIPv4();

    const configSet = spawnSync(process.execPath, [BUILT_CLI, "--home", home, "config", "set", "port", "0", "auth", "false", "listen", nonLoopbackIPv4], {
      cwd: REPO_ROOT,
      env: createServeEnv(),
      encoding: "utf8",
    });
    expect(configSet.status, configSet.stderr).toBe(0);
    expect(configSet.stdout).toBe(
      `Updated ${configPath}: port, auth, listen.\nRestart foreground \`tv serve\`, or rerun \`tv serve --persist\`, for a running server to use the new settings.\n`,
    );
    expect(existsSync(configPath)).toBe(true);

    const owned = spawnOwnedProcess(process.execPath, [BUILT_CLI, "--home", home, "serve", "--print-links"], {
      cwd: REPO_ROOT,
      env: createServeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(owned);
    const child = owned.child as ChildProcessByStdio<null, Readable, Readable>;
    let output = "";
    child.stdout.on("data", (chunk: Buffer | string) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer | string) => { output += chunk.toString(); });

    await waitForOutput(() => output, "http://127.0.0.1:");
    await waitForOutput(() => output, `http://${nonLoopbackIPv4}:`);
    await waitForOutput(() => output, "WARNING: running without an auth token");
    expect(output).toContain(`Non-loopback listeners without auth: ${nonLoopbackIPv4}`);
    const startupURLs = extractStartupURLs(output);
    expect(startupURLs).toHaveLength(2);
    expect(startupURLs.map((url) => new URL(url).hostname)).toEqual(["127.0.0.1", nonLoopbackIPv4]);
    const ports = new Set(startupURLs.map((url) => new URL(url).port));
    expect(ports.size).toBe(1);

    for (const startupURL of startupURLs) {
      const response = await fetch(new URL("/health", startupURL), { signal: AbortSignal.timeout(2_000) });
      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual(expect.objectContaining({
        bindAddresses: ["127.0.0.1", nonLoopbackIPv4],
        origins: startupURLs.map((url) => new URL(url).origin),
        port: Number.parseInt(new URL(startupURL).port, 10),
      }));
    }

    await owned.dispose();
  }, START_TIMEOUT_MS);

  it("tv serve records lifecycle start and stop when terminated", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    dirs.push(storagePath);
    writeHomeConfig(storagePath, { port: 0, auth: false });
    const owned = spawnOwnedProcess(process.execPath, [TSX_CLI, "packages/cli/src/index.ts", "--home", storagePath, "serve", "--print-links"], {
      cwd: REPO_ROOT,
      env: createServeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(owned);
    const child = owned.child as ChildProcessByStdio<null, Readable, Readable>;
    let output = "";
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer | string) => { output += chunk.toString(); });

    const serverURL = await Promise.race([
      new Promise<string>((resolve, reject) => {
        const onData = (chunk: Buffer | string) => {
          const url = extractStartupURL(chunk.toString());
          if (url) {
            child.stdout?.off("data", onData);
            resolve(url);
          }
        };
        child.stdout?.on("data", onData);
        child.once("exit", (code) => reject(new Error(`CLI exited early (${code})\n${output}`)));
      }),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for startup\n${output}`)), START_TIMEOUT_MS);
      }),
    ]);

    const port = Number.parseInt(new URL(serverURL).port, 10);
    const healthResponse = await fetch(new URL("/health", serverURL));
    expect(healthResponse.ok).toBe(true);
    await waitForOutput(() => output, "Television server running.");
    expect(output).toContain("Television server running.");
    expect(output).toContain(`http://127.0.0.1:${port}`);
    expect(stdout).toContain(`Open Television:\n  http://127.0.0.1:${port}\n`);
    expect(stdout).not.toContain("\u001B");
    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain("WARNING: running without an auth token");
    expect(output).toContain("Tokenless mode is insecure for typical setups");

    await owned.dispose();

    const records = readLogRecords(storagePath);
    const startRecord = records.find((record) => record.msg === "server started") as { snapshot?: Record<string, unknown> } | undefined;
    const stopRecord = records.find((record) => record.msg === "server stopped") as { signal?: unknown; snapshot?: Record<string, unknown> } | undefined;
    expect(startRecord?.snapshot).toEqual(expect.objectContaining({
      authMode: "no-auth",
      bindAddresses: ["127.0.0.1"],
      boundURLs: [`http://127.0.0.1:${port}`],
      port,
      storagePath,
    }));
    expect(stopRecord).toEqual(expect.objectContaining({ signal: "SIGTERM" }));
    expect(stopRecord?.snapshot).toEqual(expect.objectContaining({
      authMode: "no-auth",
      bindAddresses: ["127.0.0.1"],
      boundURLs: [`http://127.0.0.1:${port}`],
      port,
      storagePath,
    }));
  }, START_TIMEOUT_MS);

  it("tv serve with auth does not print the no-auth startup warning", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    dirs.push(storagePath);
    writeHomeConfig(storagePath, { port: 0 });
    const owned = spawnOwnedProcess(process.execPath, [TSX_CLI, "packages/cli/src/index.ts", "--home", storagePath, "serve", "--print-links"], {
      cwd: REPO_ROOT,
      env: createServeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(owned);
    const child = owned.child as ChildProcessByStdio<null, Readable, Readable>;
    let output = "";
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer | string) => { output += chunk.toString(); });

    const serverURL = await Promise.race([
      new Promise<string>((resolve, reject) => {
        const onData = (chunk: Buffer | string) => {
          const url = extractStartupURL(chunk.toString());
          if (url) {
            child.stdout?.off("data", onData);
            resolve(url);
          }
        };
        child.stdout?.on("data", onData);
        child.once("exit", (code) => reject(new Error(`CLI exited early (${code})\n${output}`)));
      }),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for startup\n${output}`)), START_TIMEOUT_MS);
      }),
    ]);

    const port = Number.parseInt(new URL(serverURL).port, 10);
    const healthResponse = await fetch(new URL("/health", serverURL));
    expect(healthResponse.ok).toBe(true);
    await waitForOutput(() => output, "Television server running.");
    expect(output).toContain("Television server running.");
    expect(output).toContain(`http://127.0.0.1:${port}/?token=`);
    const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    expect(stdout).toContain(`Open Television:\n  http://127.0.0.1:${port}/?token=${token}\n`);
    expect(stdout).not.toContain("\u001B");
    expect(() => JSON.parse(output)).toThrow();
    expect(output).not.toContain("WARNING: running without an auth token");

    await owned.dispose();
  }, START_TIMEOUT_MS);

  // Spec: [[arch/cli/index.md#^cli-config-port-client-seam|the config port reaches the client]].
  it("reaches the server through the port in the home's config file when --port is omitted", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const { port } = await startTestServer(servers, store);
    writeHomeConfig(storagePath, { port });

    const stdout = new BufferOutput();
    const stderr = new BufferOutput();
    expect(await runCLI(["--home", storagePath, "list-channels"], { stdout, stderr })).toBe(0);
    expect(stderr.toString()).toBe("");
    expect(JSON.parse(stdout.toString()).channels).toHaveLength(1);
  });

  it("serves multiple isolated storage roots on distinct loopback ports", async () => {
    const firstStorage = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-a-"));
    const secondStorage = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-b-"));
    dirs.push(firstStorage, secondStorage);
    const firstStore = createServingStore(firstStorage);
    const secondStore = createServingStore(secondStorage);
    firstStore.createChannel({ name: "First only" });
    secondStore.createChannel({ name: "Second only" });
    const { port: firstPort } = await startTestServer(servers, firstStore);
    const { port: secondPort } = await startTestServer(servers, secondStore);

    const firstOut = new BufferOutput();
    const secondOut = new BufferOutput();
    expect(await runCLI(["list-channels", "--port", String(firstPort), "--home", firstStorage], { stdout: firstOut, stderr: new BufferOutput() })).toBe(0);
    expect(await runCLI(["list-channels", "--port", String(secondPort), "--home", secondStorage], { stdout: secondOut, stderr: new BufferOutput() })).toBe(0);
    expect(firstOut.toString()).toContain("First only");
    expect(firstOut.toString()).not.toContain("Second only");
    expect(secondOut.toString()).toContain("Second only");
    expect(secondOut.toString()).not.toContain("First only");
  });


  it("broadcasts CLI-created artifacts to multiple real /events websocket clients", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-storage-"));
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "television-cli-node-target-"));
    dirs.push(storagePath, targetDir);
    const target = path.join(targetDir, "event.html");
    writeFileSync(target, "<!doctype html><h1>Event</h1>");
    const store = createServingStore(storagePath);
    const { server, port } = await startTestServer(servers, store);
    const channel = store.listChannels()[0]!;
    const url = `${server.getBaseURL().replace(/^http/, "ws")}/events?token=${store.authToken}`;
    const first = new WebSocket(url);
    const second = new WebSocket(url);
    const firstEvents: any[] = [];
    const secondEvents: any[] = [];
    first.on("message", (data) => firstEvents.push(JSON.parse(String(data))));
    second.on("message", (data) => secondEvents.push(JSON.parse(String(data))));
    await Promise.all([
      new Promise<void>((resolve) => first.on("open", () => resolve())),
      new Promise<void>((resolve) => second.on("open", () => resolve())),
    ]);

    const stdout = new BufferOutput();
    expect(await runCLI(["create-path-artifact", "--channel", channel.id, "--title", "Event", "--path", target, "--no-focus", "--port", String(port), "--home", storagePath], { stdout, stderr: new BufferOutput() })).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    first.close(); second.close();

    // Each connection's first message is the server-status advertisement
    // (specs/arch/updates/version-advertisement.md ^events-version); the
    // broadcast under test follows it.
    expect(firstEvents.map((event) => event.type)).toEqual(["server-status", "artifact-created"]);
    expect(secondEvents.map((event) => event.type)).toEqual(["server-status", "artifact-created"]);
  });

});
