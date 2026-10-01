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
  dispose(): Promise<void>;
}

/** Real Television API server with a static index page at `/` for post-connect navigation. */
export async function startConnectTestServer(): Promise<ConnectTestServer> {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-connect-e2e-server-"));
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-connect-e2e-static-"));
  cpSync(WEB_DIST, staticDir, { recursive: true });

  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, staticDir });
  await server.start();

  return {
    serverURL: server.getBaseURL(),
    token: server.getAuthToken(),
    storagePath,
    async dispose() {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      rmSync(staticDir, { recursive: true, force: true });
    },
  };
}
