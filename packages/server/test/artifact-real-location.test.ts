import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminRoutes } from "@telepath-computer/television-shared/resources";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { OPENCLAW_PROFILE } from "./helpers.ts";

// Where an artifact's file or folder really is (proofs/product/artifacts.md
// ^af-ac-real-location): a really-running server that requires the token,
// artifacts created, repointed and shared through its HTTP API over the real
// filesystem, and artifact paths replaced on disk by symbolic links. A key
// file without an artifact's extension, in a folder without an index page,
// stands in for a private key.

const KEY = "PRIVATE-KEY-CONTENTS\n";

interface Reply {
  status: number;
  contentType: string | null;
  body: string;
}

interface Running {
  baseURL: string;
  token: string;
  channelID: string;
}

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/** Replaces what is at `at` with a symbolic link to `target`. */
function replaceWithLink(at: string, target: string): void {
  rmSync(at, { recursive: true, force: true });
  symlinkSync(target, at);
}

/** A key file in a folder without an index page. */
function keyFile(base: string): string {
  const key = path.join(base, "keys", "id_ed25519");
  write(key, KEY);
  return key;
}

async function start(): Promise<Running> {
  const store = createServingStore(tempDir("television-real-location-home-"));
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, acpProfile: OPENCLAW_PROFILE });
  await server.start();
  servers.push(server);
  return { baseURL: server.getBaseURL(), token: store.authToken, channelID: store.listChannels()[0]!.id };
}

async function send(running: Running, route: string, init: { method?: string; body?: string; json?: unknown; token?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${running.token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const response = await fetch(`${running.baseURL}${route}`, { method: init.method ?? "GET", headers, body, redirect: "manual" });
  return { status: response.status, contentType: response.headers.get("content-type"), body: await response.text() };
}

async function create(running: Running, artifactPath: string): Promise<Reply> {
  return send(running, "/artifacts", { method: "POST", token: true, json: { channelID: running.channelID, kind: "path", title: "Artifact", path: artifactPath } });
}

/** Creates a path artifact and a read share link for it. */
async function createShared(running: Running, artifactPath: string): Promise<{ id: string; shareID: string }> {
  const created = await create(running, artifactPath);
  expect(created.status, created.body).toBeLessThan(300);
  const id = (JSON.parse(created.body) as { artifact: { id: string } }).artifact.id;
  const shared = await send(running, adminRoutes.share(id), { method: "POST", token: true, json: { access: "read" } });
  expect(shared.status, shared.body).toBeLessThan(300);
  return { id, shareID: (JSON.parse(shared.body) as { shareID: string }).shareID };
}

async function artifactPaths(running: Running): Promise<string[]> {
  const listed = await send(running, "/artifacts", { token: true });
  return (JSON.parse(listed.body) as { artifacts: Array<{ path?: string }> }).artifacts.map((artifact) => artifact.path ?? "").sort();
}

/** A single file's address: its file's name under its own ID, the link's address itself under a share ID. */
function fileAddresses(artifact: { id: string; shareID: string }, fileName: string): string[] {
  return [`/artifact/${artifact.id}/${fileName}`, `/artifact/${artifact.shareID}/`];
}

describe("where an artifact's file or folder really is (^af-ac-real-location)", () => {
  it("refuses to create or repoint an artifact to a path whose real location is not one an artifact can be created from", async () => {
    const base = tempDir("television-real-location-");
    const key = keyFile(base);
    symlinkSync(key, path.join(base, "page.html"));
    symlinkSync(key, path.join(base, "notes.md"));
    symlinkSync(path.dirname(key), path.join(base, "site"));
    write(path.join(base, "valid.html"), "<!doctype html><p>VALID-BODY</p>");
    const running = await start();
    const valid = await create(running, path.join(base, "valid.html"));
    expect(valid.status, valid.body).toBeLessThan(300);
    const validID = (JSON.parse(valid.body) as { artifact: { id: string } }).artifact.id;
    const before = await artifactPaths(running);

    for (const refused of [path.join(base, "page.html"), path.join(base, "notes.md"), `${path.join(base, "site")}${path.sep}`]) {
      expect({ refused, status: (await create(running, refused)).status }).toEqual({ refused, status: 400 });
      const repointed = await send(running, `/artifacts/${validID}`, { method: "PATCH", token: true, json: { path: refused } });
      expect({ refused, status: repointed.status }).toEqual({ refused, status: 400 });
    }
    expect(await artifactPaths(running)).toEqual(before);
  });

  it("answers a file artifact whose path became a link to another kind of file as a missing artifact", async () => {
    const base = tempDir("television-real-location-");
    const key = keyFile(base);
    write(path.join(base, "site", "page.html"), "<!doctype html><p>PAGE-BODY</p>");
    write(path.join(base, "site", "notes.md"), "# Notes\n");
    write(path.join(base, "gone", "gone.html"), "<!doctype html><p>GONE-BODY</p>");
    write(path.join(base, "gone", "gone.md"), "# Gone\n");
    const running = await start();
    const page = await createShared(running, path.join(base, "site", "page.html"));
    const notes = await createShared(running, path.join(base, "site", "notes.md"));
    const gonePage = await createShared(running, path.join(base, "gone", "gone.html"));
    const goneNotes = await createShared(running, path.join(base, "gone", "gone.md"));
    rmSync(path.join(base, "gone"), { recursive: true });
    replaceWithLink(path.join(base, "site", "page.html"), key);
    replaceWithLink(path.join(base, "site", "notes.md"), key);

    for (const [artifact, fileName, control, controlFileName] of [
      [page, "page.html", gonePage, "gone.html"],
      [notes, "notes.md", goneNotes, "gone.md"],
    ] as const) {
      const addresses = fileAddresses(artifact, fileName);
      const controlAddresses = fileAddresses(control, controlFileName);
      for (const [index, address] of addresses.entries()) {
        expect({ address, reply: await send(running, address) }).toEqual({ address, reply: await send(running, controlAddresses[index]!) });
      }
    }

    const read = await send(running, `/markdown/${notes.id}`, { token: true });
    const written = await send(running, `/markdown/${notes.id}`, { method: "PUT", token: true, body: "OVERWRITTEN\n" });
    const controlRead = await send(running, `/markdown/${goneNotes.id}`, { token: true });
    expect({ read: read.status, write: written.status, readKey: read.body.includes("PRIVATE-KEY") }).toEqual({ read: controlRead.status, write: 404, readKey: false });
    expect(readFileSync(key, "utf8")).toBe(KEY);
  });

  it("answers a folder artifact whose folder became a link to a folder without an index page as a missing artifact", async () => {
    const base = tempDir("television-real-location-");
    const key = keyFile(base);
    write(path.join(base, "site", "index.html"), "<!doctype html><p>SITE-BODY</p>");
    write(path.join(base, "gone", "index.html"), "<!doctype html><p>GONE-BODY</p>");
    const running = await start();
    const site = await createShared(running, `${path.join(base, "site")}${path.sep}`);
    const gone = await createShared(running, `${path.join(base, "gone")}${path.sep}`);
    rmSync(path.join(base, "gone"), { recursive: true });
    replaceWithLink(path.join(base, "site"), path.dirname(key));

    for (const [id, controlID] of [[site.id, gone.id], [site.shareID, gone.shareID]]) {
      for (const subpath of ["/", "/id_ed25519"]) {
        const address = `/artifact/${id}${subpath}`;
        expect({ address, reply: await send(running, address) }).toEqual({ address, reply: await send(running, `/artifact/${controlID}${subpath}`) });
      }
    }
  });

  it("answers a Markdown artifact whose file became unreadable, or a link to an unreadable file, as a missing artifact", async () => {
    // Permissions do not stop the superuser from reading.
    if (process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0)) return;
    const base = tempDir("television-real-location-");
    write(path.join(base, "site", "closed.md"), "# Closed\n");
    write(path.join(base, "site", "linked.md"), "# Linked\n");
    write(path.join(base, "other", "unreadable.md"), "# Unreadable\n");
    write(path.join(base, "gone", "gone.md"), "# Gone\n");
    const running = await start();
    const closed = await createShared(running, path.join(base, "site", "closed.md"));
    const linked = await createShared(running, path.join(base, "site", "linked.md"));
    const gone = await createShared(running, path.join(base, "gone", "gone.md"));
    rmSync(path.join(base, "gone"), { recursive: true });
    chmodSync(path.join(base, "site", "closed.md"), 0o000);
    chmodSync(path.join(base, "other", "unreadable.md"), 0o000);
    replaceWithLink(path.join(base, "site", "linked.md"), path.join(base, "other", "unreadable.md"));

    try {
      for (const [artifact, fileName] of [[closed, "closed.md"], [linked, "linked.md"]] as const) {
        const controlAddresses = fileAddresses(gone, "gone.md");
        for (const [index, address] of fileAddresses(artifact, fileName).entries()) {
          expect({ address, reply: await send(running, address) }).toEqual({ address, reply: await send(running, controlAddresses[index]!) });
        }
        const read = await send(running, `/markdown/${artifact.id}`, { token: true });
        expect({ fileName, status: read.status }).toEqual({ fileName, status: (await send(running, `/markdown/${gone.id}`, { token: true })).status });
      }
    } finally {
      chmodSync(path.join(base, "site", "closed.md"), 0o600);
      chmodSync(path.join(base, "other", "unreadable.md"), 0o600);
    }
  });

  it("serves an artifact through links at or above its path that lead to files and folders an artifact can be created from", async () => {
    const base = tempDir("television-real-location-");
    write(path.join(base, "real", "page.html"), "<!doctype html><p>LINKED-PAGE-BODY</p>");
    write(path.join(base, "parent", "site", "index.html"), "<!doctype html><p>LINKED-SITE-BODY</p>");
    symlinkSync(path.join(base, "real", "page.html"), path.join(base, "link.html"));
    symlinkSync(path.join(base, "parent"), path.join(base, "parent-link"));
    const running = await start();
    const page = await createShared(running, path.join(base, "link.html"));
    const site = await createShared(running, `${path.join(base, "parent-link", "site")}${path.sep}`);

    for (const address of fileAddresses(page, "link.html")) {
      const reply = await send(running, address);
      expect({ address, status: reply.status, served: reply.body.includes("LINKED-PAGE-BODY") }).toEqual({ address, status: 200, served: true });
    }
    for (const id of [site.id, site.shareID]) {
      const reply = await send(running, `/artifact/${id}/`);
      expect({ id, status: reply.status, served: reply.body.includes("LINKED-SITE-BODY") }).toEqual({ id, status: 200, served: true });
    }
  });
});
