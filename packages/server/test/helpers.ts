import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveACPAgentProfile } from "../src/config.ts";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

export const OPENCLAW_PROFILE = resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" });

export interface TestServer {
  server: Server;
  store: ServerStore;
  storagePath: string;
  baseURL: string;
  token: string;
  stop: () => Promise<void>;
}

/**
 * Spin up a real `Server` + `ServerStore` pair on an ephemeral port, backed by
 * a fresh tmpdir. The `stop()` callback shuts the server down and cleans the
 * tmpdir. Always call `stop()` in an `afterEach` (or via a dir tracker) to
 * avoid leaking processes and files.
 */
export async function createTestServer(): Promise<TestServer> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-test-server-"));
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  await server.start();

  const baseURL = server.getBaseURL();
  const token = server.getAuthToken();

  return {
    server,
    store,
    storagePath,
    baseURL,
    token,
    stop: async () => {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    },
  };
}

/** Derive the ws:// URL for a given baseURL + optional token. */
export function wsURL(baseURL: string, token?: string): string {
  const parsed = new URL(baseURL);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/ws";
  if (token !== undefined) {
    parsed.searchParams.set("token", token);
  }
  return parsed.toString();
}
