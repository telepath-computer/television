import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { buildVersionedWebBundle } from "../../../../test/helpers/versioned-web-bundle.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

// Seam tests for the reload wiring
// (specs/arch/updates/version-advertisement.md ^t-reload-wiring): a
// mismatching server-status actually triggers the reload path in a REAL
// browser over a REAL /events websocket — two crossings, one per detection
// point (^reload-detection): initial connect, and the reconnect that follows
// a server restart. Decision breadth is owned by ^t-reload-decision
// (test/update-reload.test.ts); the five product acceptance criteria
// (loop-guard silence, cache freshness, bundle identity, …) are owned by the
// product spine, not re-proven here.
//
// Staging: the page is the PRODUCTION shape — a version-stamped bundle
// (TV_TEST_VERSION-style build hook ^hook-web-version via the fixture
// builder) served from the Television server's own staticDir, so the page
// origin IS the bundle-serving origin (^reload-origin-rule). The server's
// version is staged with TV_TEST_VERSION (^hook-server-version; these
// from-source runs carry no __TV_VERSION__ stamp).

const RELOAD_MARKER_KEY = "tv-reload-attempted";

interface EventStreamInternals {
  getConnectedClientCount(): number;
}

function connectedClients(server: Server): number {
  return (server as unknown as { events: EventStreamInternals }).events.getConnectedClientCount();
}

const savedVersionHook = process.env.TV_TEST_VERSION;
const savedChannelHook = process.env.TV_UPDATE_CHANNEL_URL;
const dirs: string[] = [];
const servers: Server[] = [];

test.afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedVersionHook === undefined) delete process.env.TV_TEST_VERSION;
  else process.env.TV_TEST_VERSION = savedVersionHook;
  if (savedChannelHook === undefined) delete process.env.TV_UPDATE_CHANNEL_URL;
  else process.env.TV_UPDATE_CHANNEL_URL = savedChannelHook;
});

function createDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "television-update-reload-e2e-"));
  dirs.push(dir);
  return dir;
}

async function startServer(input: { serverVersion: string; staticDir: string; port?: number }): Promise<Server> {
  process.env.TV_TEST_VERSION = input.serverVersion;
  // Keep the version-staged server off the production update channel
  // (update-channel.md ^poll-silent-failure makes the dead URL harmless).
  process.env.TV_UPDATE_CHANNEL_URL = "http://127.0.0.1:9/update-channel.json";
  const store = createServingStore(createDataDir());
  const server = new Server({ store, port: input.port ?? 0, staticDir: input.staticDir });
  servers.push(server);
  await server.start();
  return server;
}

async function readMarker(page: Page): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, RELOAD_MARKER_KEY);
}

/**
 * The current document's navigation type. Polled across the moment the page
 * reloads itself, so an evaluate can race the navigation and lose its
 * execution context — report that as "navigating" and let the poll retry
 * against the new document.
 */
async function navigationType(page: Page): Promise<string> {
  try {
    return await page.evaluate(
      () => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type,
    );
  } catch {
    return "navigating";
  }
}

async function waitForProductShell(page: Page): Promise<void> {
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
}


test.describe("reload wiring (^t-reload-wiring)", () => {
  test("wiring: a mismatching server-status on initial connect triggers the reload path", async ({ page }) => {
    const dist = await buildVersionedWebBundle("1.0.0");
    const server = await startServer({ serverVersion: "9.9.9", staticDir: dist });

    await page.goto(server.getBaseURL());

    // The stamped bundle mismatches the staged server version, so the client
    // records the loop-guard marker and reloads itself (^reload-action).
    await expect.poll(() => navigationType(page), { timeout: 20_000 }).toBe("reload");
    await waitForProductShell(page);
    expect(await readMarker(page)).toEqual({ serverVersion: "9.9.9", fromVersion: "1.0.0" });

    // Post-reload the mismatch persists (same dist); the guard holds: the
    // page stays up, same bundle, no further navigation.
    await page.evaluate(() => {
      (window as unknown as { __tvReloadSentinel?: boolean }).__tvReloadSentinel = true;
    });
    await page.waitForTimeout(1_500);
    expect(
      await page.evaluate(() => (window as unknown as { __tvReloadSentinel?: boolean }).__tvReloadSentinel ?? null),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.tvBundleVersion)).toBe("1.0.0");
    // The console diagnostics carry the resolved bundle version (^version-probe).
    expect(await page.evaluate(() => (window as unknown as { __tvVersion?: string }).__tvVersion)).toBe("1.0.0");
  });

  test("wiring: a mismatching server-status on reconnect triggers the reload path", async ({ page }) => {
    const dist = await buildVersionedWebBundle("1.0.0");

    // Matching versions first: connect must NOT reload.
    const serverA = await startServer({ serverVersion: "1.0.0", staticDir: dist });
    const port = Number(new URL(serverA.getBaseURL()).port);

    await page.goto(serverA.getBaseURL());
    await waitForProductShell(page);
    await expect.poll(() => connectedClients(serverA), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await navigationType(page)).toBe("navigate");
    expect(await readMarker(page)).toBeNull();

    // Restart at a newer version on the same port — the restart drops the
    // socket; the client reconnects and receives the new server-status
    // (^events-version), the second detection point.
    await serverA.dispose();
    await startServer({ serverVersion: "2.0.0", staticDir: dist, port });

    await expect.poll(() => navigationType(page), { timeout: 30_000 }).toBe("reload");
    await waitForProductShell(page);
    expect(await readMarker(page)).toEqual({ serverVersion: "2.0.0", fromVersion: "1.0.0" });
  });
})
