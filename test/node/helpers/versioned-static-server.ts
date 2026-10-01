import path from "node:path";
import { Server } from "../../../packages/server/src/server.ts";
import { createServingStore } from "../../helpers/serving-store.ts";

// Spawn entry for the reload acceptance spine
// (specs/product/update-notifications.md ^ac-declaration: a really-running
// Television server, driven as a separate process): serves a chosen
// version-stamped web bundle as its GUI staticDir, with the server's own
// release version staged through TV_TEST_VERSION in the environment
// (specs/arch/updates/index.md ^updates-test-hooks) — the CLI's `serve`
// resolves its staticDir only in built form, so the harness needs this thin
// from-source entry.
//
// Usage: tsx versioned-static-server.ts --port N --home DIR --static-dir DIR
// Prints "READY <baseURL>" once listening; disposes on SIGTERM/SIGINT.

function requireArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

const port = Number(requireArg("--port"));
const storagePath = path.resolve(requireArg("--home"));
const staticDir = path.resolve(requireArg("--static-dir"));

const store = createServingStore(storagePath);
const server = new Server({ store, host: "127.0.0.1", port, auth: false, staticDir });

await server.start();
process.stdout.write(`READY ${server.getBaseURL()}\n`);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void server.dispose().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
