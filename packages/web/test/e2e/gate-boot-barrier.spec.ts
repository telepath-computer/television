import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { startStableFrontProxy } from "../../../../test/helpers/stable-front-proxy.ts";
import { buildVersionedWebBundle } from "../../../../test/helpers/versioned-web-bundle.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import {
  configureTestMotion,
  waitForApplicationShell,
} from "./helpers.ts";
import {
  observeApplicationPresentations,
} from "./application-presentation.helpers.ts";

// Seam tests for the boot barrier
// (specs/arch/updates/desktop-upgrade-gate.md), crossed over a real /events
// websocket in a REAL browser loaded with the Electron-mode inputs — the
// gate lives in the web client and these are its production inputs
// (^gate-seam); the shell's side is proven once by the product spine on
// e2e:desktop:
//   ^t-gate-boot-barrier — a first message requiring a newer desktop version
//     halts boot at the gate screen and NO functional application session
//     forms: no renderer-issued /channels or /display requests after the halt
//     (in this browser-hosted seam the shell connect preflight does not
//     occur at all, so NONE may appear); a later message lowering the
//     requirement to a version the shell satisfies reloads into normal boot.
// Plus the browser-side product acceptance:
//   ^ac-gate-desktop-only — a browser client is never gated.
//
// Staging as in update-notification.spec.ts: a version-stamped bundle served from
// the Television server's own staticDir (bundle matches TV_TEST_VERSION so
// the reload contract stays quiet), requirement staged via
// TV_TEST_REQUIRED_DESKTOP_VERSION (^hook-required-version), the update
// channel pointed at an inert loopback URL (^poll-silent-failure).

const SERVER_VERSION = "1.0.0";

const ENV_KEYS = ["TV_TEST_VERSION", "TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_UPDATE_CHANNEL_URL"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

const dirs: string[] = [];
const servers: Server[] = [];

test.afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function startServer(input: { staticDir: string; requiredDesktopVersion?: string; port?: number }): Promise<Server> {
  process.env.TV_TEST_VERSION = SERVER_VERSION;
  if (input.requiredDesktopVersion === undefined) delete process.env.TV_TEST_REQUIRED_DESKTOP_VERSION;
  else process.env.TV_TEST_REQUIRED_DESKTOP_VERSION = input.requiredDesktopVersion;
  process.env.TV_UPDATE_CHANNEL_URL = "http://127.0.0.1:9/update-channel.json";
  const dir = mkdtempSync(path.join(os.tmpdir(), "television-gate-barrier-e2e-"));
  dirs.push(dir);
  const store = createServingStore(dir);
  const server = new Server({ store, port: input.port ?? 0, staticDir: input.staticDir });
  servers.push(server);
  await server.start();
  return server;
}

interface BootRequestRecord {
  readonly pathname: string;
  readonly topLevelNavigation: number;
}

/** Record functional requests against the top-level document that issued them. */
function trackBootRequests(page: Page): {
  readonly requests: BootRequestRecord[];
  topLevelNavigation(): number;
} {
  const requests: BootRequestRecord[] = [];
  let topLevelNavigation = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) topLevelNavigation += 1;
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/channels" || url.pathname === "/display") {
      requests.push({ pathname: url.pathname, topLevelNavigation });
    }
  });
  return {
    requests,
    topLevelNavigation: () => topLevelNavigation,
  };
}

const gate = (page: Page) => page.locator(".desktop-upgrade-gate");


test.describe("boot barrier (^t-gate-boot-barrier)", () => {
  test("a first message requiring a newer desktop halts boot at the gate; retraction reloads into a normal boot", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const serverA = await startServer({ staticDir: dist, requiredDesktopVersion: "2.0.0" });
    const port = Number(new URL(serverA.getBaseURL()).port);
    const boot = trackBootRequests(page);
    const presentation = await observeApplicationPresentations(page);

    await page.goto(`${serverA.getBaseURL()}/?mode=electron&desktopAppVersion=1.3.1`);

    // Halted at the gate: the surface renders (built-in fallback — no channel).
    await expect(gate(page)).toBeVisible({ timeout: 15_000 });
    await expect(gate(page)).toContainText("Desktop app update required");
    await configureTestMotion(page);
    await presentation.settle();
    const haltedNavigation = boot.topLevelNavigation();
    expect(haltedNavigation).toBeGreaterThan(0);
    expect(
      boot.requests.filter((request) =>
        request.topLevelNavigation === haltedNavigation
      ),
    ).toEqual([]);

    // Retraction: restart with the production floor instead of the staged
    // 2.0.0 requirement. Desktop 1.3.1 now satisfies the requirement, so
    // the client reloads into a normal boot (^gate-reevaluation).
    await serverA.dispose();
    await startServer({ staticDir: dist, port });

    await expect(gate(page)).toHaveCount(0, { timeout: 30_000 });
    await waitForApplicationShell(page);
    await presentation.settle();
    await presentation.stop();

    const records = presentation.records().filter((record) =>
      record.appState !== null
    );
    const gateRecord = records.find((record) => record.gateCount === 1);
    expect(gateRecord).toBeDefined();
    const haltedDocument = gateRecord!.documentID;
    const haltedRecords = records.filter((record) =>
      record.documentID === haltedDocument
    );
    expect(haltedRecords.length).toBeGreaterThan(0);
    for (const record of haltedRecords) {
      expect(record).toMatchObject({
        appState: "needs-upgrade",
        shellRegionCount: 0,
        sidebarCount: 0,
        mainCount: 0,
        modalHostCount: 1,
        unauthorizedCount: 0,
        gateCount: 1,
        connectingCount: 0,
        disconnectedCount: 0,
        errorCount: 0,
      });
    }

    const resumedRecords = records.filter((record) =>
      record.documentID !== haltedDocument
    );
    expect(resumedRecords.some((record) =>
      record.gateCount === 0 &&
      record.sidebarCount === 1 &&
      record.mainCount === 1
    )).toBe(true);
    expect(boot.topLevelNavigation()).toBeGreaterThan(haltedNavigation);
    expect(
      boot.requests.filter((request) =>
        request.topLevelNavigation === haltedNavigation
      ),
    ).toEqual([]);
    expect(
      boot.requests.filter((request) =>
        request.topLevelNavigation > haltedNavigation
      ).length,
    ).toBeGreaterThan(0);
  });
})


test.describe("browser clients (^ac-gate-desktop-only)", () => {
  test("a browser client is never gated, whatever requirement the server advertises", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const server = await startServer({ staticDir: dist, requiredDesktopVersion: "2.0.0" });

    await page.goto(server.getBaseURL());
    await waitForApplicationShell(page);
    expect(await gate(page).count()).toBe(0);
  });
})

// ^ap-ac-gate-uncovered: real reconnect status into the production view.
// Version inputs pose Electron eligibility; the stable front holds the origin
// while each real backend binds port 0. No state/transport mechanism is mocked.
test("a reconnect requirement replaces the outage with the lone retained gate", async ({ page }) => {
  const dist = await buildVersionedWebBundle(SERVER_VERSION);
  const initial = await startServer({ staticDir: dist });
  const front = await startStableFrontProxy(initial.getBaseURL());
  try {
    await page.goto(`${front.url}/?mode=electron&desktopAppVersion=1.3.1`);
    await waitForApplicationShell(page);
    await configureTestMotion(page);
    const presentation = await observeApplicationPresentations(page);
    await initial.dispose();
    await expect(page.locator("#app")).toHaveAttribute("data-app-state", "disconnected");
    const replacement = await startServer({ staticDir: dist, requiredDesktopVersion: "2.0.0" });
    front.setTarget(replacement.getBaseURL());
    await expect(gate(page)).toBeVisible({ timeout: 15_000 });
    await presentation.settle();
    await presentation.stop();
    const records = presentation.records().filter((record) => record.appState !== null);
    const firstGate = records.findIndex((record) => record.gateCount > 0);
    expect(firstGate).toBeGreaterThan(0);
    expect(records.slice(0, firstGate).some((record) => record.appState === "disconnected")).toBe(true);
    for (const record of records.slice(firstGate)) expect(record).toMatchObject({
      appState: "needs-upgrade", shellRegionCount: 0, modalHostCount: 1,
      gateCount: 1, unauthorizedCount: 0, connectingCount: 0, disconnectedCount: 0, errorCount: 0,
    });
  } finally {
    await front.dispose();
  }
});
