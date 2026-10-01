import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Server,
  telemetryVersion,
  type BuiltTelemetryEvent,
  type TelemetryCaptureSink,
  type TelemetryEnv,
} from "@telepath-computer/television-server";
import { buildVersionedWebBundle } from "../../../../test/helpers/versioned-web-bundle.ts";
import { startUpdateChannelFixture, type UpdateChannelFixtureServer } from "../../../../test/helpers/update-channel-fixture.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

// The composed browser update journey (specs/product/update-notifications.md
// ^ac-composition — real partial chains, never a mocked mega-test): a channel
// deploy → the toast → the copy click → the server really restarting at the
// announced release (the agent's upgrade) → the stale client auto-reloading
// into the new bundle → toast and bell gone (the server now matches the
// announced release). Every leg rides mechanisms individually proven by the
// per-slice specs; this walk proves they compose.
//
// Telemetry acceptance (^ac-telemetry): the browser-side three of the four
// events — update_toast_shown, update_prompt_copy_clicked, and
// client_autoreloaded — are observed at a test sink injected in place of the
// PostHog transport (the criterion's declared carve-out; everything before
// the sink runs for real), carrying only version numbers. The fourth event
// (desktop_upgrade_gate_shown) is observed on the desktop journey
// (packages/desktop/test/e2e/update-journey.spec.ts); the sink→PostHog leg
// is owned by specs/arch/telemetry/sink.md ^t-posthog-lands
// (telemetry-posthog.integration.test.ts).
//
// The same captured corpus feeds the no-user-content serialization sweep:
// no toast text, prompt text, markdown, URL, or other user-visible string
// from the journey appears in any serialized telemetry event.

const OLD_VERSION = "1.0.0";
const NEW_VERSION = "1.1.0";
const TOAST_MARKDOWN = `**Television ${NEW_VERSION}** is out — read the [notes](https://television.run/notes-journey).`;
const PROMPT = "Please upgrade my Television server following https://television.run/install.md";
// A document-named label rides the channel document and must be ignored by
// the surface (^un-copy-button) — and must never leak into telemetry either.
const BUTTON_LABEL = "Copy the upgrade ask";
// Strings that must NEVER appear in serialized telemetry (^ac-telemetry).
const BANNED_CONTENT = [
  TOAST_MARKDOWN,
  "is out — read the",
  PROMPT,
  "television.run/notes-journey",
  "television.run/install.md",
  BUTTON_LABEL,
];

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};

class RecordingTelemetrySink implements TelemetryCaptureSink {
  readonly events: BuiltTelemetryEvent[] = [];
  enqueue(event: BuiltTelemetryEvent): void {
    this.events.push(event);
  }
}

const ENV_KEYS = ["TV_TEST_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS"] as const;
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

async function startServer(input: {
  serverVersion: string;
  staticDir: string;
  channelURL: string;
  sink: RecordingTelemetrySink;
  port?: number;
  auth?: boolean;
  storagePath?: string;
}): Promise<Server> {
  process.env.TV_TEST_VERSION = input.serverVersion;
  process.env.TV_UPDATE_CHANNEL_URL = input.channelURL;
  process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS = "200";
  let storagePath = input.storagePath;
  if (storagePath === undefined) {
    storagePath = mkdtempSync(path.join(os.tmpdir(), "television-update-journey-"));
    dirs.push(storagePath);
  }
  const store = createServingStore(storagePath);
  const server = new Server({
    store,
    port: input.port ?? 0,
    auth: input.auth ?? false,
    staticDir: input.staticDir,
    telemetry: {
      env: TEST_TELEMETRY_ENV,
      sink: input.sink,
      version: telemetryVersion(input.serverVersion),
      launchMode: "cli",
    },
  });
  servers.push(server);
  await server.start();
  return server;
}

function sinkEvent(sink: RecordingTelemetrySink, name: string): BuiltTelemetryEvent | null {
  return sink.events.find((event) => event.name === name) ?? null;
}

/** The event's own properties minus the envelope keys the sink builder adds. */
function ownProperties(event: BuiltTelemetryEvent): Record<string, unknown> {
  const { distinct_id, $session_id, $set, ...own } = event.properties as unknown as Record<string, unknown>;
  return own;
}

const toastPanel = (page: Page) => page.locator("tv-popover.update-popover");
const bell = (page: Page) => page.locator(".top-bar-controls > .update-bell");

async function waitForProductShell(page: Page): Promise<void> {
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
}

// The walk runs in BOTH server auth modes (^ac-composition): authless, and
// authed with a real bearer token — carried in the page URL, consumed and
// stored by the client, authenticating the socket for real, and surviving
// the auto-reload (the token lives in the store, so the authed variant
// reuses one storage dir across the restart, exactly as a real upgrade
// preserves storage). Belt and suspenders: the update mechanisms sit outside
// the auth boundary today, and this is the standing defense for the day one
// of them stops being.

test.describe("browser update journey", () => {

for (const authMode of ["authless", "authed"] as const) {
  const auth = authMode === "authed";

  test(`channel deploy → toast → copy → real server upgrade → auto-reload → quiet, ${authMode} (^ac-composition, ^ac-telemetry)`, async ({ page }) => {
  const sink = new RecordingTelemetrySink();
  const distOld = await buildVersionedWebBundle(OLD_VERSION);
  const distNew = await buildVersionedWebBundle(NEW_VERSION);
  const fixture = await startUpdateChannelFixture({
    schemaVersion: 1,
    version: NEW_VERSION,
    toast: { markdown: TOAST_MARKDOWN, prompt: PROMPT, promptButtonLabel: BUTTON_LABEL },
  });
  fixtures.push(fixture);
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-update-journey-"));
  dirs.push(storagePath);

  // Leg 1 — the channel names a newer release; the connected client toasts.
  const serverA = await startServer({ serverVersion: OLD_VERSION, staticDir: distOld, channelURL: fixture.url, sink, auth, storagePath });
  const port = Number(new URL(serverA.getBaseURL()).port);
  if (auth) {
    const connectURL = new URL(serverA.getBaseURL());
    connectURL.searchParams.set("token", serverA.getAuthToken());
    await page.goto(connectURL.toString());
  } else {
    await page.goto(serverA.getBaseURL());
  }
  await waitForProductShell(page);
  await expect(toastPanel(page)).toBeVisible({ timeout: 15_000 });
  await expect(toastPanel(page).locator("strong")).toHaveText(`Television ${NEW_VERSION}`);

  // Leg 2 — the user copies the upgrade prompt for their agent.
  await expect(page.locator(".update-popover .copy-button-idle"))
    .toHaveText("Copy upgrade prompt");
  await page.locator(".update-popover .copy-button").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(PROMPT);

  // Sink observations for the toast events (^ac-telemetry): version numbers only.
  await expect.poll(() => sinkEvent(sink, "update_toast_shown"), { timeout: 15_000 }).not.toBeNull();
  await expect.poll(() => sinkEvent(sink, "update_prompt_copy_clicked"), { timeout: 15_000 }).not.toBeNull();
  expect(ownProperties(sinkEvent(sink, "update_toast_shown")!)).toEqual({
    server_version: OLD_VERSION,
    channel_version: NEW_VERSION,
  });
  expect(ownProperties(sinkEvent(sink, "update_prompt_copy_clicked")!)).toEqual({
    server_version: OLD_VERSION,
    channel_version: NEW_VERSION,
  });

  // Leg 3 — "the agent upgrades the server": a REAL restart at the announced
  // release on the same port, serving the new release's bundle.
  await serverA.dispose();
  const serverB = await startServer({ serverVersion: NEW_VERSION, staticDir: distNew, channelURL: fixture.url, sink, port, auth, storagePath });

  // Leg 4 — the stale client self-heals: reconnect → mismatch → auto-reload
  // into the new bundle.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.tvBundleVersion).catch(() => "navigating"), {
      timeout: 30_000,
    })
    .toBe(NEW_VERSION);

  // Leg 5 — the server now matches the announced release: toast and bell are
  // gone, and the reload telemetry landed at the sink. In authed mode the
  // committed shell state also proves the stored token survived the reload;
  // an unauthorized page cannot satisfy APP-2's readiness handoff.
  await waitForProductShell(page);
  await expect.poll(() => sinkEvent(sink, "client_autoreloaded"), { timeout: 15_000 }).not.toBeNull();
  expect(ownProperties(sinkEvent(sink, "client_autoreloaded")!)).toEqual({
    from_version: OLD_VERSION,
    to_version: NEW_VERSION,
  });
  await page.waitForTimeout(1_000);
  await expect(toastPanel(page)).toHaveCount(0);
  await expect(bell(page)).toHaveCount(0);
  void serverB;

  // No-user-content serialization sweep (^ac-telemetry): nothing the user saw
  // — markdown, prompt, label, URLs — appears in ANY serialized telemetry
  // event captured across the whole journey.
  expect(sink.events.length).toBeGreaterThan(0);
  const serialized = sink.events.map((event) => JSON.stringify(event));
  for (const banned of BANNED_CONTENT) {
    for (const event of serialized) {
      expect(event, `banned content "${banned.slice(0, 40)}…"`).not.toContain(banned);
    }
  }
  });
}
})
