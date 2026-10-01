import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

// Seam tests for the server's version advertisement surfaces
// (specs/arch/updates/version-advertisement.md), each crossed over real HTTP
// or a real /events websocket against a listening Server:
//   ^t-version-surfaces   — version source → GET /health payload
//   ^t-version-header     — global version middleware → every HTTP response
//   ^t-cache-headers      — the GUI bundle's static mount → response headers
//   ^t-server-status-on-connect — connection establishment → first message
// The update-domain version is staged through the sanctioned TV_TEST_VERSION
// hook (^hook-server-version) and TV_TEST_REQUIRED_DESKTOP_VERSION
// (desktop-upgrade-gate.md ^hook-required-version); both are read only
// because these from-source runs carry no __TV_VERSION__ stamp.

interface Harness {
  server: Server;
  store: ReturnType<typeof createServingStore>;
  baseURL: string;
  token: string;
}

const servers: Server[] = [];
const dirs: string[] = [];
const envKeys = ["TV_TEST_VERSION", "TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_UPDATE_CHANNEL_URL"] as const;
// A version-staged server would otherwise boot-poll the PRODUCTION update
// channel (update-channel.md ^dev-version-no-poll lifts at a release
// version); point it at an unroutable loopback URL — failure is silent by
// contract (^poll-silent-failure) and no request leaves the host.
const INERT_CHANNEL_URL = "http://127.0.0.1:9/update-channel.json";
const savedEnv = new Map<string, string | undefined>();

function setHookEnv(env: Partial<Record<(typeof envKeys)[number], string>>): void {
  for (const key of envKeys) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

function makeStaticDir(): string {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-version-adv-static-"));
  dirs.push(staticDir);
  writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>gui</title>");
  mkdirSync(path.join(staticDir, "assets"));
  writeFileSync(path.join(staticDir, "assets", "app-C4fe1x.js"), "console.log('hashed asset');");
  mkdirSync(path.join(staticDir, "views", "url-unsupported"), { recursive: true });
  writeFileSync(path.join(staticDir, "views", "url-unsupported", "index.html"), "<!doctype html>");
  return staticDir;
}

async function harness(env: Partial<Record<(typeof envKeys)[number], string>> = {}): Promise<Harness> {
  setHookEnv({ TV_UPDATE_CHANNEL_URL: INERT_CHANNEL_URL, ...env });
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-version-adv-"));
  dirs.push(storagePath);
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, staticDir: makeStaticDir() });
  servers.push(server);
  await server.start();
  return { server, store, baseURL: server.getBaseURL(), token: store.authToken };
}

function openEvents(baseURL: string, token: string): { ws: WebSocket; messages: unknown[] } {
  const ws = new WebSocket(`${baseURL.replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`);
  const messages: unknown[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  return { ws, messages };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("GET /health version (^t-version-surfaces)", () => {
  it("includes the update-domain release version, unauthenticated", async () => {
    const h = await harness({ TV_TEST_VERSION: "9.9.9" });
    const response = await fetch(`${h.baseURL}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.version).toBe("9.9.9");
  });

  it("reports 0.0.0 for an unstamped, unhooked development server", async () => {
    const h = await harness();
    const body = (await (await fetch(`${h.baseURL}/health`)).json()) as { version: string };
    expect(body.version).toBe("0.0.0");
  });
});

describe("X-TV-Version response header (^t-version-header)", () => {
  it("rides every response: static GUI, API success, API unauthorized, and 404s", async () => {
    const h = await harness({ TV_TEST_VERSION: "9.9.9" });

    const staticResponse = await fetch(`${h.baseURL}/index.html`);
    expect(staticResponse.headers.get("x-tv-version")).toBe("9.9.9");

    const apiResponse = await fetch(`${h.baseURL}/channels`, { headers: { authorization: `Bearer ${h.token}` } });
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get("x-tv-version")).toBe("9.9.9");

    const unauthorized = await fetch(`${h.baseURL}/channels`);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("x-tv-version")).toBe("9.9.9");

    const missing = await fetch(`${h.baseURL}/no-such-path-anywhere`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-tv-version")).toBe("9.9.9");
  });

  it("is listed in Access-Control-Expose-Headers on the CORS'd API routes", async () => {
    const h = await harness();
    const response = await fetch(`${h.baseURL}/channels`, { headers: { authorization: `Bearer ${h.token}` } });
    const exposed = response.headers.get("access-control-expose-headers") ?? "";
    expect(exposed.toLowerCase()).toContain("x-tv-version");
  });
});

describe("GUI bundle cache headers (^t-cache-headers)", () => {
  it("serves the entry document and any bundle-mount html with Cache-Control: no-cache", async () => {
    const h = await harness();
    for (const pathName of ["/", "/index.html", "/views/url-unsupported/index.html"]) {
      const response = await fetch(`${h.baseURL}${pathName}`);
      expect(response.status, pathName).toBe(200);
      expect(response.headers.get("cache-control"), pathName).toBe("no-cache");
    }
  });

  it("serves the bundle's hashed assets with immutable caching", async () => {
    const h = await harness();
    const response = await fetch(`${h.baseURL}/assets/app-C4fe1x.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("server-status on connect (^t-server-status-on-connect)", () => {
  it("delivers server-status as the first message, carrying version, requirement, and update state", async () => {
    const h = await harness({ TV_TEST_VERSION: "9.9.9", TV_TEST_REQUIRED_DESKTOP_VERSION: "8.8.8" });
    const { ws, messages } = openEvents(h.baseURL, h.token);
    try {
      await waitFor(() => messages.length >= 1);
      expect(messages[0]).toEqual({
        type: "server-status",
        version: "9.9.9",
        requiredDesktopVersion: "8.8.8",
        update: null,
      });
    } finally {
      ws.close();
    }
  });

  it("arrives before any broadcast event under a concurrent store-mutation storm (race-shaped)", async () => {
    const h = await harness({ TV_TEST_VERSION: "9.9.9" });

    // Broadcast storm: rapid store mutations while connections establish.
    // Every mutation broadcasts synchronously to whatever sockets are open,
    // so a connection that establishes mid-storm is exactly the race the
    // first-message ordering must survive (^events-version).
    let storming = true;
    const storm = (async () => {
      let n = 0;
      while (storming) {
        h.store.createChannel({ name: `storm-${n++}` });
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    try {
      for (let i = 0; i < 5; i++) {
        const { ws, messages } = openEvents(h.baseURL, h.token);
        try {
          // Wait until this socket has seen the storm interleave (≥2 messages:
          // the status plus at least one broadcast) so the ordering claim is
          // about a connection that demonstrably raced live traffic.
          await waitFor(() => messages.length >= 2);
          expect((messages[0] as { type: string }).type).toBe("server-status");
        } finally {
          ws.close();
        }
      }
    } finally {
      storming = false;
      await storm;
    }
  });
});
