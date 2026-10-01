import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { PRODUCTION_UPDATE_CHANNEL_URL } from "../src/updates/update-channel.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

// ^t-marked-host-polls (specs/arch/updates/update-channel.md): host state →
// poll gating at the server boundary. A really-constructed Server resolves
// its version (TV_TEST_VERSION, version-advertisement.md ^hook-server-version)
// and developer-home state (TELEVISION_DEVELOPER_HOME, the same resolution
// telemetry uses) from the process environment. The HTTP boundary is MOCKED —
// declared: the scenario under proof is precisely the ABSENCE of the
// TV_UPDATE_CHANNEL_URL override, so the only reachable target is the
// production channel URL, which tests must never actually fetch;
// real-network polling coverage is carried by ^t-poll-fetch
// (update-channel.seam.test.ts). The assertion discriminates by
// construction: gating that consulted the marker would make no fetch at all
// (^dev-marker-no-bypass).

const ENV_KEYS = ["TV_TEST_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS", "TELEVISION_DEVELOPER_HOME"] as const;

const servers: Server[] = [];
const dirs: string[] = [];
const savedEnv = new Map<string, string | undefined>();

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe("poll gating on a developer-marked host (^t-marked-host-polls)", () => {
  it("a release-stamped server with .tv-developer under the resolved home boot-polls the production channel", async () => {
    const markerHome = mkdtempSync(path.join(os.tmpdir(), "television-marked-host-home-"));
    dirs.push(markerHome);
    writeFileSync(path.join(markerHome, ".tv-developer"), "");
    setEnv({ TV_TEST_VERSION: "1.0.0", TELEVISION_DEVELOPER_HOME: markerHome });

    // The declared HTTP mock: capture the poller's fetch without letting a
    // production request leave the host. A not-ok response exercises the
    // silent-failure path (^poll-silent-failure), so no state is adopted.
    const fetchSpy = vi.fn(async (..._args: unknown[]) => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);

    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-marked-host-storage-"));
    dirs.push(storagePath);
    const server = new Server({ store: createServingStore(storagePath), host: "127.0.0.1", port: 0, auth: false });
    servers.push(server);
    await server.start();

    await expect
      .poll(() =>
        fetchSpy.mock.calls.some((call) => String(call[0]).startsWith(`${PRODUCTION_UPDATE_CHANNEL_URL}?`)),
      )
      .toBe(true);
  });
});
