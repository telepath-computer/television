import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { Server } from "@telepath-computer/television-server";
import {
  expectPermanentApplicationShell,
  launchDesktop,
  launchDesktopConnectScreen,
  SIMULATE_UPDATE_AVAILABLE,
  type LaunchedDesktop,
} from "./helpers.ts";
import { observeApplicationPresentations } from "../../../web/test/e2e/application-presentation.helpers.ts";
import { waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { startUpdateChannelFixture, type UpdateChannelFixtureServer } from "../../../../test/helpers/update-channel-fixture.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

// Desktop upgrade gate acceptance (specs/product/update-notifications.md),
// on the REAL Electron app per ^ac-declaration — the shell version driven by
// TV_TEST_DESKTOP_APP_VERSION, the DECLARED MOCK of app.getVersion()
// (desktop-upgrade-gate.md ^hook-shell-version; the real version path is
// proven unhooked by ^t-shell-version-param), the server requirement by
// TV_TEST_REQUIRED_DESKTOP_VERSION:
//   ^ac-gate-blocks   — an older shell stops at the blocking gate screen and
//     the normal application boot never starts: server observation begins
//     before launch and distinguishes the one main-process
//     `/desktop/connect-check` from any renderer display, channel, or artifact
//     request.
//   ^ac-gate-fallback — with no channel available at all the gate still
//     functions, rendering the built-in default instructions.
//   ^ac-gate-not-gated — a shell exactly at the requirement boots normally
//     (the representative walk; exemption breadth in ^t-gate-decision).
//   ^ac-gate-persists — the gate holds across page reloads and reconnects,
//     the normal boot never starting; relaunching with a higher hooked
//     version (the upgrade) clears it.
//   ^ac-gate-supersedes-toast — a gated desktop app shows no server toast,
//     desktop self-update notice, desktop recommendation, or bell. Separate walks
//     pose a toast-eligible channel, a recommendation-eligible shell without
//     a server notice, and a downloaded update.
//   ^ac-gate-downloaded-update — launched with the update runtime's
//     simulation flag, a gated app changes to the downloaded-update message
//     once the runtime reports its download, and Restart to update reaches
//     the main process's restart, which test mode records.
// ^ac-gate-desktop-only runs in the browser barrier spec
// (packages/web/test/e2e/gate-boot-barrier.spec.ts) — its subject is a
// browser client.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, "../../../web/dist");
// The gate surface's authored copy, read rather than restated, so its words
// and links have one authored home.
const GATE_CONTENT = parse(
  readFileSync(path.resolve(HERE, "../../../../specs/ui/app/desktop-upgrade-gate/content.yml"), "utf8"),
) as {
  downloaded_update_instructions: string;
  fallback_instructions: string;
  restart_to_update: string;
  restarting: string;
};

const SERVER_VERSION = "1.0.0";
const REQUIRED = "2.0.0";
const OLD_SHELL = "1.0.0";
// A release of the npm package, below the recommended desktop version.
const RECOMMENDATION_ELIGIBLE_SHELL = "1.3.2";
const INERT_CHANNEL_URL = "http://127.0.0.1:9/update-channel.json";
const OBSERVATION_TIMEOUT_MS = 30_000;

const ENV_KEYS = ["TV_TEST_VERSION", "TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

const tempDirs: string[] = [];
const servers: Server[] = [];
const fixtures: UpdateChannelFixtureServer[] = [];
const launches: LaunchedDesktop[] = [];

test.afterEach(async () => {
  for (const launched of launches.splice(0)) await launched.app.close().catch(() => {});
  for (const server of servers.splice(0)) await server.dispose();
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

interface RequestRecord {
  readonly method: string;
  readonly pathname: string;
}

interface ConnectCheckRequestRecord extends RequestRecord {
  readonly desktopAppVersion: string | null;
}

interface GateServerObservation {
  readonly connectCheckRequests: ConnectCheckRequestRecord[];
  readonly functionalRequests: RequestRecord[];
  readonly entranceOrder: Array<"connect-check" | "events">;
  eventConnectionCount(): number;
  waitForEventConnection(targetCount: number): Promise<void>;
}

interface ObservedGateServer {
  readonly server: Server;
  readonly observation: GateServerObservation;
  readonly storagePath: string;
  readonly staticDir: string;
}

function observeGateServer(server: Server): GateServerObservation {
  const connectCheckRequests: ConnectCheckRequestRecord[] = [];
  const functionalRequests: RequestRecord[] = [];
  const entranceOrder: Array<"connect-check" | "events"> = [];
  const eventWaiters = new Set<(count: number) => void>();
  let eventConnectionCount = 0;

  server.httpServer.on("request", (request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    // Classification is by route, not process: a renderer-issued connect
    // check would land here rather than in functionalRequests. The reader
    // contract makes the shell the only caller.
    if (pathname === "/desktop/connect-check") {
      connectCheckRequests.push({
        method: request.method ?? "",
        pathname,
        desktopAppVersion: url.searchParams.get("desktopAppVersion"),
      });
      entranceOrder.push("connect-check");
      return;
    }
    if (
      pathname === "/display" ||
      pathname === "/channels" || pathname.startsWith("/channels/") ||
      pathname === "/artifacts" || pathname.startsWith("/artifacts/")
    ) {
      functionalRequests.push({ method: request.method ?? "", pathname });
    }
  });
  server.httpServer.on("upgrade", (request) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/events") return;
    entranceOrder.push("events");
    eventConnectionCount += 1;
    for (const waiter of eventWaiters) waiter(eventConnectionCount);
  });

  return {
    connectCheckRequests,
    functionalRequests,
    entranceOrder,
    eventConnectionCount: () => eventConnectionCount,
    waitForEventConnection(targetCount) {
      if (eventConnectionCount >= targetCount) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout>;
        const waiter = (count: number): void => {
          if (count < targetCount) return;
          eventWaiters.delete(waiter);
          clearTimeout(timeout);
          resolve();
        };
        timeout = setTimeout(() => {
          eventWaiters.delete(waiter);
          reject(new Error(`Server did not observe /events connection ${targetCount}`));
        }, OBSERVATION_TIMEOUT_MS);
        eventWaiters.add(waiter);
      });
    },
  };
}

async function startGateServer(
  input: {
    requiredDesktopVersion?: string;
    serverVersion?: string;
    channelURL?: string;
    port?: number;
    storagePath?: string;
    staticDir?: string;
  } = {},
): Promise<ObservedGateServer> {
  process.env.TV_TEST_VERSION = input.serverVersion ?? SERVER_VERSION;
  if (input.requiredDesktopVersion === undefined) delete process.env.TV_TEST_REQUIRED_DESKTOP_VERSION;
  else process.env.TV_TEST_REQUIRED_DESKTOP_VERSION = input.requiredDesktopVersion;
  process.env.TV_UPDATE_CHANNEL_URL = input.channelURL ?? INERT_CHANNEL_URL;
  delete process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS;

  const storagePath = input.storagePath ??
    mkdtempSync(path.join(os.tmpdir(), "television-upgrade-gate-server-"));
  const staticDir = input.staticDir ??
    mkdtempSync(path.join(os.tmpdir(), "television-upgrade-gate-static-"));
  if (input.storagePath === undefined) tempDirs.push(storagePath);
  if (input.staticDir === undefined) {
    tempDirs.push(staticDir);
    cpSync(WEB_DIST, staticDir, { recursive: true });
  }
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: input.port ?? 0, auth: true, staticDir });
  const observation = observeGateServer(server);
  servers.push(server);
  await server.start();
  return { server, observation, storagePath, staticDir };
}

async function launchAgainst(server: ObservedGateServer, shellVersion: string): Promise<LaunchedDesktop> {
  const launched = await launchDesktop({
    connectTo: { serverURL: server.server.getBaseURL(), token: server.server.getAuthToken() },
    env: { TV_TEST_DESKTOP_APP_VERSION: shellVersion },
  });
  launches.push(launched);
  if (launched.userDataDir) tempDirs.push(launched.userDataDir);
  return launched;
}

async function settleApplicationPresentation(page: Page): Promise<void> {
  await page.evaluate(async () => {
    let stableFrames = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const application = document.querySelector("#app");
      const hasRunningAnimation = application?.getAnimations({ subtree: true }).some((animation) =>
        animation.pending || animation.playState === "running"
      ) ?? false;
      stableFrames = hasRunningAnimation ? 0 : stableFrames + 1;
      if (stableFrames >= 2) return;
    }
    throw new Error("Application presentation did not settle within 600 animation frames");
  });
}

async function expectExclusiveGate(page: Page): Promise<void> {
  await waitForApplicationRender(page, ["needs-upgrade"], OBSERVATION_TIMEOUT_MS);
  const root = page.locator("#app");
  await expect(root).toHaveAttribute("data-app-state", "needs-upgrade");
  await expect(root.locator(":scope > .app-sidebar, :scope > .app-main")).toHaveCount(0);
  await expect(root.locator(":scope > .system-modal-host")).toHaveCount(0);
  await expect(root.locator(":scope > .desktop-upgrade-gate")).toHaveCount(1);
  await expect(root.locator(".artifact-view")).toHaveCount(0);
  await settleApplicationPresentation(page);
}

function expectOnlyShellConnectCheck(observation: GateServerObservation, desktopAppVersion: string): void {
  expect(observation.connectCheckRequests).toEqual([{
    method: "GET",
    pathname: "/desktop/connect-check",
    desktopAppVersion,
  }]);
  expect(observation.entranceOrder.slice(0, 2)).toEqual(["connect-check", "events"]);
  expect(observation.functionalRequests).toEqual([]);
}

const gate = (page: Page) => page.locator(".desktop-upgrade-gate");
const toastPanel = (page: Page) => page.locator(".update-popover");
const bell = (page: Page) => page.locator(".update-bell");

/** An authored message's heading and prose as they read once rendered, links reduced to their text. */
function authoredMessage(markdown: string): { heading: string; prose: string[] } {
  const [heading, ...paragraphs] = markdown.split("\n\n");
  return {
    heading: heading!.replace(/^#\s+/, ""),
    prose: paragraphs.map((paragraph) => paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")),
  };
}

async function expectAuthoredMessage(page: Page, markdown: string): Promise<void> {
  const message = authoredMessage(markdown);
  await expect(gate(page).locator("h1")).toHaveText(message.heading);
  await expect(gate(page).locator('[data-testid="upgrade-gate-body"] > p')).toHaveText(message.prose);
}

// The built-in fallback, with its link and no restart button
// (specs/ui/app/desktop-upgrade-gate/content.yml#fallback_instructions).
async function expectFallbackInstructions(page: Page): Promise<void> {
  await expectAuthoredMessage(page, GATE_CONTENT.fallback_instructions);
  const [, text, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(GATE_CONTENT.fallback_instructions)!;
  await expect(gate(page).locator(`a[href="${href}"]`)).toHaveText(text!);
  await expect(gate(page).locator(".upgrade-gate-restart")).toHaveCount(0);
}


test("^ac-themes-desktop-required: the production floor gates an older shell and an unhooked compatible relaunch boots", async () => {
  // No required-version override: this must exercise the production floor.
  const server = await startGateServer({ serverVersion: "1.3.1" });
  const outdated = await launchAgainst(server, "0.1.216");
  await server.observation.waitForEventConnection(1);
  await expectExclusiveGate(outdated.page);
  await expectFallbackInstructions(outdated.page);
  await expect(toastPanel(outdated.page)).toHaveCount(0);
  await expect(bell(outdated.page)).toHaveCount(0);
  expectOnlyShellConnectCheck(server.observation, "0.1.216");

  const userDataDir = outdated.userDataDir!;
  await outdated.app.close();
  launches.splice(launches.indexOf(outdated), 1);
  const nextConnection = server.observation.eventConnectionCount() + 1;
  const upgraded = await launchDesktopConnectScreen({
    userDataDir,
    // Omission inherits the harness's 9.9.9 override; explicit undefined
    // reaches production app.getVersion() on the candidate package.
    env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
  });
  launches.push(upgraded);
  await server.observation.waitForEventConnection(nextConnection);
  await expectPermanentApplicationShell(upgraded.page);
  // Whether the candidate also receives the recommendation depends on its
  // version, which this criterion leaves open.
  await expect(gate(upgraded.page)).toHaveCount(0);
  const actualVersion = await upgraded.app.evaluate(({ app }) => app.getVersion());
  expect(new URL(upgraded.page.url()).searchParams.get("desktopAppVersion")).toBe(actualVersion);
  expect(server.observation.connectCheckRequests.at(-1)?.desktopAppVersion).toBe(actualVersion);
  expect(server.observation.functionalRequests.some((request) => request.pathname === "/display")).toBe(true);
});

test.describe("desktop upgrade gate", () => {
  test("^ac-gate-blocks + ^ac-gate-fallback: an older shell halts at the gate with the built-in instructions; no boot", async () => {
    const server = await startGateServer({ requiredDesktopVersion: REQUIRED });
    const { page } = await launchAgainst(server, OLD_SHELL);

    await server.observation.waitForEventConnection(1);
    await expectExclusiveGate(page);
    await expectFallbackInstructions(page);

    // The observer is installed before Electron starts. The one request is the
    // shell's permitted connect check; the renderer issues no functional request.
    expectOnlyShellConnectCheck(server.observation, OLD_SHELL);
  });

  test("^ac-gate-not-gated: a shell exactly at the requirement boots normally with no gate", async () => {
    const server = await startGateServer({ requiredDesktopVersion: REQUIRED });
    const { page } = await launchAgainst(server, REQUIRED);

    await server.observation.waitForEventConnection(1);
    await expectPermanentApplicationShell(page);
  });

  test("^ac-gate-persists: the gate holds across reload and reconnect; upgrading and relaunching clears it", async () => {
    const serverA = await startGateServer({ requiredDesktopVersion: REQUIRED });
    const port = Number(new URL(serverA.server.getBaseURL()).port);
    const first = await launchAgainst(serverA, OLD_SHELL);

    await serverA.observation.waitForEventConnection(1);
    await expectExclusiveGate(first.page);
    expectOnlyShellConnectCheck(serverA.observation, OLD_SHELL);

    const presentation = await observeApplicationPresentations(first.page);
    await presentation.settle();
    const initialDocument = await first.page.evaluate(() => performance.timeOrigin);

    // Arm both the socket and server-request instruments before reload. The
    // replacement document reaches only the gate and makes no functional request.
    const reloadConnection = serverA.observation.waitForEventConnection(
      serverA.observation.eventConnectionCount() + 1,
    );
    await first.page.reload();
    await reloadConnection;
    await expectExclusiveGate(first.page);
    await presentation.settle();
    const reloadedDocument = await first.page.evaluate(() => performance.timeOrigin);
    expect(reloadedDocument).not.toBe(initialDocument);
    expectOnlyShellConnectCheck(serverA.observation, OLD_SHELL);

    // A same-port server restart causes a real renderer reconnect. The gate
    // remains the only presentation in the existing document, and the fresh
    // server receives no functional request from that halted renderer.
    await serverA.server.dispose();
    servers.splice(servers.indexOf(serverA.server), 1);
    const serverB = await startGateServer({
      requiredDesktopVersion: REQUIRED,
      port,
      storagePath: serverA.storagePath,
      staticDir: serverA.staticDir,
    });
    await serverB.observation.waitForEventConnection(1);
    await expectExclusiveGate(first.page);
    await presentation.settle();
    expect(await first.page.evaluate(() => performance.timeOrigin)).toBe(reloadedDocument);
    expect(serverB.observation.functionalRequests).toEqual([]);

    await presentation.stop();
    const records = presentation.records().filter((record) => record.appState !== null);
    expect(records.length).toBeGreaterThan(0);
    expect(new Set(records.map((record) => record.documentID)).size).toBe(2);
    for (const record of records) {
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

    await first.app.close();
    launches.splice(launches.indexOf(first), 1);
    const upgradedConnectionCount = serverB.observation.eventConnectionCount() + 1;
    const connectCheckRequestCount = serverB.observation.connectCheckRequests.length;
    const functionalRequestCount = serverB.observation.functionalRequests.length;
    const upgraded = await launchAgainst(serverB, "2.5.0");
    await serverB.observation.waitForEventConnection(upgradedConnectionCount);
    await expectPermanentApplicationShell(upgraded.page);
    expect(serverB.observation.connectCheckRequests.slice(connectCheckRequestCount)).toEqual([{
      method: "GET",
      pathname: "/desktop/connect-check",
      desktopAppVersion: "2.5.0",
    }]);
    const upgradedFunctionalRequests = serverB.observation.functionalRequests.slice(functionalRequestCount);
    expect(upgradedFunctionalRequests.some((request) => request.pathname === "/display")).toBe(true);
    expect(upgradedFunctionalRequests.some((request) => request.pathname !== "/display")).toBe(true);
  });

  test("^ac-gate-supersedes-toast: a gated app shows channel gate instructions but no server toast and no bell", async () => {
    const fixture = await startUpdateChannelFixture({
      schemaVersion: 1,
      version: "9.9.9", // toast-eligible: newer than the server
      toast: { markdown: "**Television 9.9.9** is out!", prompt: "please upgrade" },
      desktop: { upgradeMarkdown: "Channel-published desktop upgrade steps." },
    });
    fixtures.push(fixture);
    const server = await startGateServer({ requiredDesktopVersion: REQUIRED, channelURL: fixture.url });
    const { page } = await launchAgainst(server, OLD_SHELL);

    await server.observation.waitForEventConnection(1);
    await expectExclusiveGate(page);
    await expect(gate(page)).toContainText(
      "Channel-published desktop upgrade steps.",
      { timeout: OBSERVATION_TIMEOUT_MS },
    );
    await expectExclusiveGate(page);
    await expect(toastPanel(page)).toHaveCount(0);
    await expect(bell(page)).toHaveCount(0);
    expectOnlyShellConnectCheck(server.observation, OLD_SHELL);
  });

  test("^ac-gate-supersedes-toast: a recommendation-eligible gated app shows no recommendation and no bell", async () => {
    const server = await startGateServer({ requiredDesktopVersion: REQUIRED });
    const { page } = await launchAgainst(server, RECOMMENDATION_ELIGIBLE_SHELL);

    await server.observation.waitForEventConnection(1);
    await expectExclusiveGate(page);
    await expect(toastPanel(page)).toHaveCount(0);
    await expect(bell(page)).toHaveCount(0);
    expectOnlyShellConnectCheck(server.observation, RECOMMENDATION_ELIGIBLE_SHELL);
  });

  // proofs/product/update-notifications.md#^ac-gate-downloaded-update
  test("^ac-gate-downloaded-update: a gated app whose runtime reports a download offers Restart to update, which reaches the main process", async () => {
    const server = await startGateServer({ requiredDesktopVersion: REQUIRED });
    const launched = await launchDesktop({
      connectTo: { serverURL: server.server.getBaseURL(), token: server.server.getAuthToken() },
      env: { TV_TEST_DESKTOP_APP_VERSION: OLD_SHELL },
      args: [SIMULATE_UPDATE_AVAILABLE],
    });
    launches.push(launched);
    if (launched.userDataDir) tempDirs.push(launched.userDataDir);
    const { app, page } = launched;

    await server.observation.waitForEventConnection(1);
    await expectExclusiveGate(page);
    const restart = gate(page).locator(".upgrade-gate-restart");
    await expect(restart).toHaveText(GATE_CONTENT.restart_to_update, { timeout: OBSERVATION_TIMEOUT_MS });
    await expectAuthoredMessage(page, GATE_CONTENT.downloaded_update_instructions);
    await expect(toastPanel(page)).toHaveCount(0);
    await expect(bell(page)).toHaveCount(0);

    const simulatedVersion = `${await app.evaluate(({ app: electronApp }) => electronApp.getVersion())}-simulated`;
    await restart.click();
    await expect(restart).toBeDisabled();
    await expect(restart).toHaveText(GATE_CONTENT.restarting);
    await expect.poll(async () =>
      app.evaluate(() =>
        (globalThis as typeof globalThis & { __televisionRestartToInstallLog?: string[] }).__televisionRestartToInstallLog ?? [],
      ), { timeout: 15_000 }).toEqual([simulatedVersion]);
    await expect(gate(page)).toHaveCount(1);
    expectOnlyShellConnectCheck(server.observation, OLD_SHELL);
  });
});
