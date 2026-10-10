import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { OPENCLAW_PROFILE } from "./helpers.ts";
import { openOrRefusal } from "./resources/harness.ts";

// The cross-origin rules by route (proofs/arch/artifact-frame/isolation.md
// ^iso-t-routes): a really-running server with the token required, over real
// HTTP and WebSockets, with requests carrying `Origin: null`, as a sandboxed
// artifact's do, and another site's origin. The resource routes are the
// resource architecture's origin contract (resources/admin-routes.test.ts and
// resources/page-connection.test.ts).

const ORIGINS = ["null", "https://elsewhere.example"] as const;

interface Running {
  server: Server;
  baseURL: string;
  token: string;
  artifactPath: string;
  channelPath: string;
  artifactID: string;
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

function write(root: string, relative: string, contents: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), contents);
}

async function start(): Promise<Running> {
  const canonicalDir = tempDir("television-cors-canonical-");
  write(canonicalDir, "v2/styles.css", "/* canonical */\n");
  write(canonicalDir, "v2/fonts/font.woff2", "font");
  const sdkDir = tempDir("television-cors-sdk-");
  write(sdkDir, "v1/resources.js", "export {};\n");
  write(sdkDir, "v1/THIRD-PARTY-NOTICES.txt", "notices\n");
  const staticDir = tempDir("television-cors-static-");
  write(staticDir, "index.html", "<!doctype html><title>app</title>");
  write(staticDir, "assets/app.js", "export {};\n");
  write(staticDir, "views/url-unsupported/index.html", "<!doctype html><title>placeholder</title>");
  const viewsDir = tempDir("television-cors-views-");
  write(viewsDir, "artifact-missing/index.html", "<!doctype html><title>Artifact file not found</title>");
  write(viewsDir, "markdown/index.html", "<!doctype html><title>markdown</title>");
  const artifactDir = tempDir("television-cors-artifact-");
  write(artifactDir, "page.html", "<!doctype html><title>artifact</title>");

  const storagePath = tempDir("television-cors-home-");
  const store = createServingStore(storagePath, { bundledViewsPath: viewsDir });
  const server = new Server({
    store,
    host: "127.0.0.1",
    port: 0,
    auth: true,
    acpProfile: OPENCLAW_PROFILE,
    canonicalDir,
    sdkDir,
    staticDir,
  });
  await server.start();
  servers.push(server);
  const channelID = store.listChannels()[0]!.id;
  const artifact = store.createArtifact({
    channelID,
    kind: "path",
    title: "Page",
    path: path.join(artifactDir, "page.html"),
  });
  return {
    server,
    baseURL: server.getBaseURL(),
    token: store.authToken,
    artifactPath: `/artifact/${artifact.id}/page.html`,
    channelPath: `/channels/${channelID}`,
    artifactID: artifact.id,
  };
}

function corsHeaders(response: Response): Record<string, string> {
  const found: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name.startsWith("access-control-")) found[name] = value;
  });
  return found;
}

async function send(
  running: Running,
  method: string,
  route: string,
  headers: Record<string, string>,
): Promise<Response> {
  const response = await fetch(`${running.baseURL}${route}`, { method, headers });
  await response.arrayBuffer();
  return response;
}

function upgrade(running: Running, route: "/events" | "/acp", origin: string): Promise<void> {
  const url = new URL(running.baseURL);
  url.protocol = "ws:";
  url.pathname = route;
  url.searchParams.set("token", running.token);
  const socket = new WebSocket(url, { headers: { Origin: origin } });
  return openOrRefusal(socket).finally(() => socket.terminate());
}

describe("cross-origin rules by route (^iso-t-routes)", () => {
  it("allows any origin, without credentials, on the routes artifacts load", async () => {
    const running = await start();
    const publicRoutes = [
      "/canonical/v2/styles.css",
      "/canonical/v2/fonts/font.woff2",
      "/theme/theme.css",
      "/sdk/v1/resources.js",
      "/sdk/v1/THIRD-PARTY-NOTICES.txt",
      "/views/artifact-missing/",
    ];
    for (const origin of ORIGINS) {
      const proxied = await send(running, "GET", running.artifactPath, { Origin: origin });
      expect(proxied.status, origin).toBe(200);
      expect(corsHeaders(proxied), origin).toEqual({
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "ETag",
      });

      for (const route of publicRoutes) {
        const response = await send(running, "GET", route, { Origin: origin });
        expect(response.status, `${route} ${origin}`).toBe(200);
        expect(response.headers.get("access-control-allow-origin"), `${route} ${origin}`).toBe("*");
        expect(response.headers.get("access-control-allow-credentials"), `${route} ${origin}`).toBeNull();
      }
    }
  });

  it("sends no CORS header and grants no preflight on the token routes", async () => {
    const running = await start();
    const tokenRoutes: Array<[string, string]> = [
      ["GET", "/channels"],
      ["GET", running.channelPath],
      ["GET", "/artifacts"],
      ["GET", `/artifacts/${running.artifactID}`],
      ["GET", "/display"],
      ["POST", "/display/focus"],
      ["GET", "/themes"],
      ["POST", "/themes/refresh"],
      ["GET", `/markdown/${running.artifactID}`],
      ["GET", "/telemetry"],
      ["POST", "/telemetry/enable"],
      ["POST", "/telemetry/disable"],
      ["GET", "/demo-mode"],
      ["GET", "/desktop/connect-check"],
    ];
    for (const origin of ORIGINS) {
      for (const [method, route] of tokenRoutes) {
        const label = `${method} ${route} ${origin}`;
        const withToken = await send(running, method, route, { Origin: origin, Authorization: `Bearer ${running.token}` });
        expect(corsHeaders(withToken), `${label} with the token`).toEqual({});
        const withoutToken = await send(running, method, route, { Origin: origin });
        expect(withoutToken.status, `${label} without the token`).toBe(401);
        expect(corsHeaders(withoutToken), `${label} without the token`).toEqual({});
        const preflight = await send(running, "OPTIONS", route, {
          Origin: origin,
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "authorization, content-type",
        });
        expect(corsHeaders(preflight), `${label} preflight`).toEqual({});
      }
    }
  });

  it("sends no CORS header from the health probe, the app's page and bundle, or the other views", async () => {
    const running = await start();
    for (const origin of ORIGINS) {
      for (const route of ["/health", "/", "/assets/app.js", "/views/url-unsupported/", "/views/markdown/"]) {
        const response = await send(running, "GET", route, { Origin: origin });
        expect(response.status, `${route} ${origin}`).toBe(200);
        expect(corsHeaders(response), `${route} ${origin}`).toEqual({});
      }
    }
  });

  it("accepts WebSocket upgrades to /events and /acp that carry the token, from either origin", async () => {
    const running = await start();
    for (const origin of ORIGINS) {
      await upgrade(running, "/events", origin);
      await upgrade(running, "/acp", origin);
    }
  });
});
