import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminRoutes } from "@telepath-computer/television-shared/resources";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { OPENCLAW_PROFILE } from "./helpers.ts";

// What a folder artifact serves (proofs/product/artifacts.md ^af-ac-folder-files):
// a really-running server, artifacts created through its HTTP API over the
// real filesystem, and a real HTTP client that sends each path exactly as
// written, so encoded dot parts reach the server undecoded.

interface Reply {
  status: number;
  contentType: string | undefined;
  body: string;
}

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, relative: string, contents: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), contents);
}

function get(baseURL: string, rawPath: string): Promise<Reply> {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path: rawPath, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        contentType: response.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function post(baseURL: string, token: string, route: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseURL}${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok, `${route} answered ${response.status}`).toBe(true);
  return await response.json() as Record<string, unknown>;
}

describe("what a folder artifact serves (^af-ac-folder-files)", () => {
  it("serves the visible files inside its folder and answers every other path as a missing file", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "television-folder-files-"));
    dirs.push(base);
    // The folder lives inside a hidden folder and is registered through a link to it.
    const folder = path.join(base, ".hidden-parent", "project");
    write(folder, "index.html", "<!doctype html><title>index</title><p>INDEX-BODY</p>");
    write(folder, "docs/real.html", "<!doctype html><p>REAL-BODY</p>");
    write(folder, ".env", "SECRET=env\n");
    write(folder, ".git/config", "[secret] git\n");
    write(folder, ".private/page.html", "<!doctype html><p>PRIVATE-BODY</p>");
    write(base, "outside/secret.txt", "outside secret\n");
    write(base, "outside-dir/secret.html", "<!doctype html><p>OUTSIDE-DIR-BODY</p>");
    symlinkSync(path.join(folder, "docs", "real.html"), path.join(folder, "alias.html"));
    symlinkSync(path.join(folder, ".env"), path.join(folder, "env-link.txt"));
    symlinkSync(path.join(folder, ".git", "config"), path.join(folder, "git-config-link"));
    symlinkSync(path.join(folder, ".private"), path.join(folder, "private-link"));
    symlinkSync(path.join(base, "outside", "secret.txt"), path.join(folder, "outside-link.txt"));
    symlinkSync(path.join(base, "outside-dir"), path.join(folder, "outside-dir-link"));
    symlinkSync(folder, path.join(base, "project-link"));

    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-folder-files-home-"));
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, acpProfile: OPENCLAW_PROFILE });
    await server.start();
    servers.push(server);
    const baseURL = server.getBaseURL();
    const token = store.authToken;

    const created = await post(baseURL, token, "/artifacts", {
      channelID: store.listChannels()[0]!.id,
      kind: "path",
      title: "Project",
      path: `${path.join(base, "project-link")}${path.sep}`,
    });
    const artifactID = (created.artifact as { id: string }).id;
    const shared = await post(baseURL, token, adminRoutes.share(artifactID), { access: "read" });
    const shareID = shared.shareID as string;

    for (const id of [artifactID, shareID]) {
      const index = await get(baseURL, `/artifact/${id}/`);
      expect(index.status).toBe(200);
      expect(index.body).toContain("INDEX-BODY");
      const alias = await get(baseURL, `/artifact/${id}/alias.html`);
      expect(alias.status).toBe(200);
      expect(alias.body).toContain("REAL-BODY");

      const missing = await get(baseURL, `/artifact/${id}/no-such-file.html`);
      expect(missing.status).toBe(404);
      for (const refused of [
        "/.env",
        "/.git/config",
        "/.private/page.html",
        "/env-link.txt",
        "/git-config-link",
        "/private-link/page.html",
        "/private-link",
        "/outside-link.txt",
        "/outside-dir-link/secret.html",
        "/%2eenv",
        "/%2Egit/config",
        "/docs/..%2f.env",
        "/docs/%2e%2e/.env",
        "/..%2foutside%2fsecret.txt",
        "/..%2f..%2foutside%2fsecret.txt",
        "/%2e%2e/%2e%2e/outside/secret.txt",
      ]) {
        expect({ refused, reply: await get(baseURL, `/artifact/${id}${refused}`) }).toEqual({ refused, reply: missing });
      }
    }
  });
});
