import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { buildVersionedWebBundle } from "../../../../test/helpers/versioned-web-bundle.ts";
import { startUpdateChannelFixture, type UpdateChannelFixtureServer } from "../../../../test/helpers/update-channel-fixture.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

// The notice/bell browser coverage (specs/arch/updates/update-channel.md and
// specs/product/update-notifications.md), split across these numeric parts:
//
// Acceptance criteria against a really-running Television server with a
// test-authored channel document served over real HTTP and reached via
// TV_UPDATE_CHANNEL_URL (+ TV_UPDATE_CHANNEL_POLL_INTERVAL_MS for mid-run
// deploys), per ^ac-declaration:
//   ^ac-toast-shows ^ac-toast-not-newer ^ac-toast-copy ^ac-toast-dismiss
//   ^ac-bell-visible ^ac-bell-refires ^ac-toast-silent-failure
//   ^ac-toast-dev-host (spawned server with HOME at a temp dir containing
//   .tv-developer — the marker must not affect the toast; this walk proves
//   the marked-host product surface and sets TV_UPDATE_CHANNEL_URL like
//   every criterion — the no-override gating proof is ^t-marked-host-polls,
//   packages/server/test/update-channel-marked-host.test.ts).
// The desktop walk (^ac-toast-desktop) lives on the e2e:desktop surface.

const SERVER_VERSION = "1.0.0";
const FAST_POLL_MS = "200";
// Negative-assertion window: long enough for a would-be notice to appear
// (several poll cycles at the fast interval + broadcast + render).
const SILENCE_WINDOW_MS = 2_000;

const ENV_KEYS = ["TV_TEST_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS", "HOME"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

const dirs: string[] = [];
const servers: Server[] = [];
const fixtures: UpdateChannelFixtureServer[] = [];

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function channelDocument(overrides: { version?: string; markdown?: string; prompt?: string; promptButtonLabel?: string } = {}): unknown {
  const toast: Record<string, string> = {
    markdown: overrides.markdown ?? `**Television ${overrides.version ?? "1.5.0"}** is out — see the [notes](https://television.run/notes).`,
  };
  if (overrides.prompt !== undefined) toast.prompt = overrides.prompt;
  if (overrides.promptButtonLabel !== undefined) toast.promptButtonLabel = overrides.promptButtonLabel;
  return { schemaVersion: 1, version: overrides.version ?? "1.5.0", toast };
}

async function startChannelFixture(document: unknown): Promise<UpdateChannelFixtureServer> {
  const fixture = await startUpdateChannelFixture(document);
  fixtures.push(fixture);
  return fixture;
}

function createDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "television-update-notification-e2e-"));
  dirs.push(dir);
  return dir;
}

async function startServer(input: { staticDir: string; channelURL?: string; home?: string }): Promise<Server> {
  process.env.TV_TEST_VERSION = SERVER_VERSION;
  if (input.channelURL === undefined) delete process.env.TV_UPDATE_CHANNEL_URL;
  else process.env.TV_UPDATE_CHANNEL_URL = input.channelURL;
  process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS = FAST_POLL_MS;
  if (input.home !== undefined) process.env.HOME = input.home;
  const store = createServingStore(createDataDir());
  const server = new Server({ store, port: 0, staticDir: input.staticDir });
  servers.push(server);
  await server.start();
  return server;
}

interface EventStreamInternals {
  getConnectedClientCount(): number;
}

function connectedClients(server: Server): number {
  return (server as unknown as { events: EventStreamInternals }).events.getConnectedClientCount();
}

async function gotoAndConnect(page: Page, server: Server): Promise<void> {
  await page.goto(server.getBaseURL());
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  await expect.poll(() => connectedClients(server), { timeout: 15_000 }).toBeGreaterThan(0);
}

const notice = (page: Page) => page.locator("tv-popover.update-popover");
const bell = (page: Page) => page.locator(".top-bar-controls > .update-bell");
const copyButton = (page: Page) => page.locator(".update-popover .copy-button");
const laterButton = (page: Page) => page.locator(".update-popover .update-later");



test.describe("notice + bell acceptance (product/update-notifications.md)", () => {

  test("^ac-bell-visible: the bell shows while an update applies — dismissed included — and leaves when none does", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const fixture = await startChannelFixture(channelDocument({ version: "1.5.0" }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });

    await gotoAndConnect(page, server);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await expect(bell(page)).toBeVisible();
    await laterButton(page).click();
    await expect(notice(page)).not.toBeVisible();
    await expect(bell(page)).toBeVisible();

    // No dismiss affordance on the bell: with the notice down, the bell is
    // the only visible update control in the permanent cluster.
    expect(await page.locator(".top-bar-controls .update-bell:visible").count()).toBe(1);

    // A retraction deploy (not-newer version) ends the update state; the
    // bell disappears with it.
    fixture.setResponse(channelDocument({ version: SERVER_VERSION }));
    await expect(bell(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(notice(page)).toHaveCount(0);
  });

  test("^ac-bell-refires: after dismiss-forever the bell re-presents the full notice with a working copy button", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const prompt = "please upgrade television";
    const fixture = await startChannelFixture(channelDocument({ version: "1.5.0", prompt }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });

    await gotoAndConnect(page, server);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await laterButton(page).click();
    await expect(notice(page)).not.toBeVisible();

    await bell(page).click();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page).locator("strong")).toHaveText("Television 1.5.0");
    await copyButton(page).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  });

  test("^ac-toast-silent-failure: the channel going unreachable is invisible — the last notice continues to apply", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const fixture = await startChannelFixture(channelDocument({ version: "1.5.0" }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await gotoAndConnect(page, server);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });

    // Kill the channel: subsequent polls hit a dead socket.
    const requestsBeforeOutage = fixture.requests.length;
    await fixture.dispose();
    // Several fast-interval poll cycles fail during this window.
    await page.waitForTimeout(SILENCE_WINDOW_MS);

    expect(fixture.requests.length).toBe(requestsBeforeOutage);
    await expect(notice(page)).toBeVisible(); // last-known-good applies
    await expect(bell(page)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("^ac-toast-dev-host: with ~/.tv-developer on the server host, the toast shows exactly as on an unmarked host", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    // The developer-host marker in a controlled HOME: it routes telemetry
    // and must not affect update notifications (^dev-marker-no-bypass).
    const home = createDataDir();
    writeFileSync(path.join(home, ".tv-developer"), "");
    const fixture = await startChannelFixture(channelDocument({ version: "1.5.0" }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url, home });

    await gotoAndConnect(page, server);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await expect(notice(page).locator("strong")).toHaveText("Television 1.5.0");
    await expect(bell(page)).toBeVisible();
  });
})
