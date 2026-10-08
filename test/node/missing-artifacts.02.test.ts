import { afterEach, beforeEach, describe, it } from "vitest";
import type { ChildProcessByStdio } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import type { Readable } from "node:stream";
import { expect as pwExpect } from "@playwright/test";
import { parseConnectURL } from "@telepath-computer/television-shared";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILT_CLI = path.join(REPO_ROOT, "packages/cli/dist/cli.cjs");

interface ServerHarness {
  process: OwnedProcess;
  child: ChildProcessByStdio<null, Readable, Readable>;
  url: string;
  token: string;
  storagePath: string;
}

async function waitForServer(child: ChildProcessByStdio<null, Readable, Readable>): Promise<{ url: string; token: string }> {
  let stdout = "";
  let stderr = "";
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for server. stderr:\n${stderr}`)), 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    const parse = () => {
      const match = stdout.match(/https?:\/\/[^\s\u001B]+/);
      if (!match) return;
      const parsed = parseConnectURL(match[0]);
      if (!parsed.token) return;
      cleanup();
      resolve({ url: parsed.serverURL, token: parsed.token });
    };
    const onStdout = (chunk: Buffer) => { stdout += chunk.toString("utf8"); parse(); };
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString("utf8"); };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`server exited before startup: ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`)); };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function startServer(storagePath = mkdtempSync(path.join(os.tmpdir(), "television-missing-storage-"))): Promise<ServerHarness> {
  if (!existsSync(BUILT_CLI)) throw new Error(`Built CLI not found at ${BUILT_CLI}`);
  const { TELEVISION_ACP_AGENT: _ignoredAgent, NODE_OPTIONS: _ignoredNodeOptions, VITEST: _ignoredVitest, ...env } = process.env;
  writeHomeConfig(storagePath, { port: 0 });
  const processHandle = spawnOwnedProcess(BUILT_CLI, ["--home", storagePath, "serve", "--print-links"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const child = processHandle.child as ChildProcessByStdio<null, Readable, Readable>;
  try {
    const { url, token } = await waitForServer(child);
    return { process: processHandle, child, url, token, storagePath };
  } catch (error) {
    await processHandle.dispose();
    throw error;
  }
}

async function stopServerProcess(h: ServerHarness): Promise<void> {
  const cleanup = await h.process.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Missing-artifacts server ${h.process.pid} survived cleanup`);
}

async function stopServer(h: ServerHarness): Promise<void> {
  await stopServerProcess(h);
  rmSync(h.storagePath, { recursive: true, force: true });
}

async function api<T>(h: ServerHarness, route: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(new URL(route, h.url), {
    ...init,
    headers: { Authorization: `Bearer ${h.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${route} failed ${res.status}: ${await res.text()}`);
  return await res.json() as T;
}

async function createArtifact(h: ServerHarness, input: { title: string; path: string }): Promise<string> {
  const { focusedChannelId } = await api<{ focusedChannelId: string | null }>(h, "/display");
  if (focusedChannelId === null) throw new Error("Missing-artifacts test server has no focused channel");
  const { artifact } = await api<{ artifact: { id: string } }>(h, "/artifacts", {
    method: "POST",
    body: JSON.stringify({ kind: "path", title: input.title, path: input.path, channelID: focusedChannelId }),
  });
  return artifact.id;
}

async function openApp(browser: Browser, h: ServerHarness): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${h.url}/?token=${h.token}`);
  await page.locator(".artifact-view").first().waitFor({ state: "visible", timeout: 20_000 });
  return page;
}


describe("missing artifacts production e2e", () => {
  let server: ServerHarness;
  let browser: Browser;
  const tempPaths: string[] = [];

  beforeEach(async () => {
    server = await startServer();
    browser = await chromium.launch();
  });

  afterEach(async () => {
    await browser?.close();
    await stopServer(server);
    for (const p of tempPaths.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  function tempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "television-missing-target-"));
    tempPaths.push(dir);
    return dir;
  }

  it("shows and recovers markdown and HTML not-found when an enclosing folder moves away", async () => {
    const dir = tempDir();
    const outer = path.join(dir, "outer");
    const folder = path.join(outer, "shared");
    const movedOuter = path.join(dir, "outer-moved");
    mkdirSync(folder, { recursive: true });
    const note = path.join(folder, "note.md");
    const html = path.join(folder, "page.html");
    writeFileSync(note, "# Nested markdown", "utf8");
    writeFileSync(html, "<!doctype html><h1>Nested HTML</h1>", "utf8");
    await createArtifact(server, { title: "Nested Note", path: note });
    await createArtifact(server, { title: "Nested HTML", path: html });

    const page = await openApp(browser, server);
    const noteCard = page.locator(".artifact-view").filter({ hasText: "Nested Note" });
    const htmlCard = page.locator(".artifact-view").filter({ hasText: "Nested HTML" });
    await pwExpect(noteCard.locator("iframe").contentFrame().locator(".cm-content")).toContainText("Nested markdown");
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("h1")).toContainText("Nested HTML");

    renameSync(outer, movedOuter);
    await pwExpect(noteCard).toContainText("Artifact file not found", { timeout: 15_000 });
    await pwExpect(noteCard).toContainText(note);
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("body")).toContainText("Artifact file not found", { timeout: 15_000 });
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("body")).toContainText(html);

    renameSync(movedOuter, outer);
    writeFileSync(note, "# Nested markdown restored", "utf8");
    writeFileSync(html, "<!doctype html><h1>Nested HTML restored</h1>", "utf8");
    await pwExpect(noteCard.locator("iframe").contentFrame().locator(".cm-content")).toContainText("Nested markdown restored", { timeout: 20_000 });
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("h1")).toContainText("Nested HTML restored", { timeout: 20_000 });
  });

  it("shows and recovers HTML not-found for live deletion, reload, directory watcher death, move-away, and keeps asset 404 plain", async () => {
    const dir = tempDir();
    const file = path.join(dir, "page.html");
    writeFileSync(file, "<!doctype html><h1>Initial HTML</h1>", "utf8");
    await createArtifact(server, { title: "HTML", path: file });
    const page = await openApp(browser, server);
    const htmlCard = page.locator(".artifact-view").filter({ hasText: "HTML" });
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("h1")).toContainText("Initial HTML");

    const moved = path.join(dir, "page-moved.html");
    renameSync(file, moved);
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("body")).toContainText("Artifact file not found", { timeout: 15_000 });
    await pwExpect(htmlCard.locator("iframe").contentFrame().locator("body")).toContainText(file);
    await page.reload();
    const reloadedHtmlCard = page.locator(".artifact-view").filter({ hasText: "HTML" });
    await pwExpect(reloadedHtmlCard.locator("iframe").contentFrame().locator("body")).toContainText("Artifact file not found", { timeout: 15_000 });

    renameSync(moved, file);
    writeFileSync(file, "<!doctype html><h1>Restored HTML</h1>", "utf8");
    await pwExpect(reloadedHtmlCard.locator("iframe").contentFrame().locator("h1")).toContainText("Restored HTML", { timeout: 15_000 });

    const bundle = path.join(dir, "bundle");
    mkdirSync(bundle);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html><link rel='stylesheet' href='missing.css'><h1>Bundle HTML</h1>", "utf8");
    await createArtifact(server, { title: "Bundle", path: `${bundle}${path.sep}` });
    await page.reload();
    await pwExpect(page.frameLocator(".artifact-view iframe").last().locator("h1")).toContainText("Bundle HTML");
    await pwExpect(page.frameLocator(".artifact-view iframe").last().locator("body")).not.toContainText("Artifact file not found");

    const bundleMoved = path.join(dir, "bundle-moved");
    renameSync(bundle, bundleMoved);
    await pwExpect(page.frameLocator(".artifact-view iframe").last().locator("body")).toContainText("Artifact file not found", { timeout: 15_000 });
    mkdirSync(bundle);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html><h1>Bundle restored</h1>", "utf8");
    await pwExpect(page.frameLocator(".artifact-view iframe").last().locator("h1")).toContainText("Bundle restored", { timeout: 20_000 });
  });
})
