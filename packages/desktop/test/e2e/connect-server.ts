import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@telepath-computer/television-server";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, "../../../web/dist");

export interface ConnectTestServer {
  serverURL: string;
  token: string;
  storagePath: string;
  readonly server: Server;
  stop(): Promise<void>;
  restart(): Promise<void>;
  dispose(): Promise<void>;
}

/** Real Television server serving the built application, with retained storage across restart. */
export async function startConnectTestServer(options: { auth?: boolean } = {}): Promise<ConnectTestServer> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-connect-e2e-server-"));
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-connect-e2e-static-"));
  cpSync(WEB_DIST, staticDir, { recursive: true });

  const create = () => new Server({ store: createServingStore(storagePath), host: "127.0.0.1", port: 0, auth: options.auth ?? true, staticDir });
  let server = create();
  let stopped = false;
  await server.start();

  return {
    get serverURL() { return server.getBaseURL(); },
    get server() { return server; },
    token: server.getAuthToken(),
    storagePath,
    async stop() { if (!stopped) { stopped = true; await server.dispose(); } },
    async restart() { server = create(); stopped = false; await server.start(); },
    async dispose() {
      if (!stopped) await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(staticDir, { recursive: true, force: true });
    },
  };
}
