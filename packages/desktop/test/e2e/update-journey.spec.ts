import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  Server,
  telemetryVersion,
  type BuiltTelemetryEvent,
  type TelemetryCaptureSink,
  type TelemetryEnv,
} from "@telepath-computer/television-server";
import { expectConnectedPage, launchDesktop, type LaunchedDesktop } from "./helpers.ts";
import { startUpdateChannelFixture, type UpdateChannelFixtureServer } from "../../../../test/helpers/update-channel-fixture.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

// The composed desktop update journey (specs/product/update-notifications.md
// ^ac-composition — a real partial chain): an outdated shell halts at the
// gate with the channel's published instructions → the user "upgrades and
// relaunches" (the relaunch reports a version meeting the requirement,
// through the declared TV_TEST_DESKTOP_APP_VERSION mock of app.getVersion())
// → the relaunched app boots normally, and the update toast the gate was
// suppressing now shows.
//
// Telemetry acceptance (^ac-telemetry): the fourth event —
// desktop_upgrade_gate_shown — is observed at a test sink injected in place
// of the PostHog transport, carrying only version numbers; the browser
// journey (packages/web/test/e2e/update-journey.spec.ts) observes the other
// three, and sink.md ^t-posthog-lands owns the sink→PostHog leg. The same
// corpus feeds the no-user-content serialization sweep: neither the gate
// instructions nor the toast content appears in any serialized event.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, "../../../web/dist");

const SERVER_VERSION = "1.0.0";
const REQUIRED = "2.0.0";
const CHANNEL_VERSION = "1.1.0";
// Channel-authored instructions start from the gate's built-in text; the
// release-specific heading tells them apart from it.
const GATE_HEADING = "Desktop app update required for the journey release";
const GATE_MARKDOWN =
  `# ${GATE_HEADING}\n\n` +
  "This version of the Television desktop app does not work with this server and needs to be updated. [Download the latest version for Mac](https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64) and install it.";
const TOAST_MARKDOWN = `**Television ${CHANNEL_VERSION}** has shipped — [journey notes](https://television.run/journey-notes).`;
const PROMPT = "Agent, please upgrade this Television server for the journey.";
const BANNED_CONTENT = [
  GATE_MARKDOWN,
  GATE_HEADING,
  TOAST_MARKDOWN,
  "journey notes",
  PROMPT,
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

const ENV_KEYS = ["TV_TEST_VERSION", "TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS"] as const;


test.describe("desktop update journey", () => {

test("gate with channel instructions → upgrade-and-relaunch → normal boot with the toast (^ac-composition, ^ac-telemetry)", async () => {
  const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
  const tempDirs: string[] = [];
  const launches: LaunchedDesktop[] = [];
  let server: Server | null = null;
  let fixture: UpdateChannelFixtureServer | null = null;

  try {
    const sink = new RecordingTelemetrySink();
    fixture = await startUpdateChannelFixture({
      schemaVersion: 1,
      version: CHANNEL_VERSION,
      toast: { markdown: TOAST_MARKDOWN, prompt: PROMPT },
      desktop: { upgradeMarkdown: GATE_MARKDOWN },
    });

    process.env.TV_TEST_VERSION = SERVER_VERSION;
    process.env.TV_TEST_REQUIRED_DESKTOP_VERSION = REQUIRED;
    process.env.TV_UPDATE_CHANNEL_URL = fixture.url;
    delete process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS;

    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-desktop-journey-server-"));
    const staticDir = mkdtempSync(path.join(os.tmpdir(), "television-desktop-journey-static-"));
    tempDirs.push(storagePath, staticDir);
    cpSync(WEB_DIST, staticDir, { recursive: true });
    const store = createServingStore(storagePath);
    server = new Server({
      store,
      host: "127.0.0.1",
      port: 0,
      auth: true,
      staticDir,
      telemetry: {
        env: TEST_TELEMETRY_ENV,
        sink,
        version: telemetryVersion(SERVER_VERSION),
        launchMode: "cli",
      },
    });
    await server.start();

    // Leg 1 — the outdated shell halts at the gate, which renders the
    // CHANNEL's published instructions (preferred over the fallback).
    const gatedRun = await launchDesktop({
      connectTo: { serverURL: server.getBaseURL(), token: server.getAuthToken() },
      env: { TV_TEST_DESKTOP_APP_VERSION: "1.0.0" },
    });
    launches.push(gatedRun);
    if (gatedRun.userDataDir) tempDirs.push(gatedRun.userDataDir);

    const gate = gatedRun.page.locator(".desktop-upgrade-gate");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(gate).toContainText(GATE_HEADING, { timeout: 30_000 });
    expect(await gatedRun.page.locator(".top-bar-controls > .update-popover").count()).toBe(0);

    // Sink observation for the gate event (^ac-telemetry): versions only.
    await expect.poll(() => sink.events.find((event) => event.name === "desktop_upgrade_gate_shown") ?? null, {
      timeout: 15_000,
    }).not.toBeNull();
    const gateEvent = sink.events.find((event) => event.name === "desktop_upgrade_gate_shown")!;
    const { distinct_id, $session_id, $set, ...own } = gateEvent.properties as unknown as Record<string, unknown>;
    expect(own).toEqual({ desktop_app_version: "1.0.0", required_desktop_version: REQUIRED });

    // Leg 2 — the user upgrades the desktop app and relaunches: the relaunch
    // reports a version meeting the requirement.
    await gatedRun.app.close();
    launches.splice(launches.indexOf(gatedRun), 1);
    const upgradedRun = await launchDesktop({
      connectTo: { serverURL: server.getBaseURL(), token: server.getAuthToken() },
      env: { TV_TEST_DESKTOP_APP_VERSION: REQUIRED },
    });
    launches.push(upgradedRun);
    if (upgradedRun.userDataDir) tempDirs.push(upgradedRun.userDataDir);

    // Leg 3 — a normal boot: no gate, the interface forms, and the toast the
    // gate was superseding now presents (the channel still names a release
    // newer than the server).
    await expectConnectedPage(upgradedRun.page);
    expect(await upgradedRun.page.locator(".desktop-upgrade-gate").count()).toBe(0);
    await expect(upgradedRun.page.locator(".top-bar-controls > .update-popover")).toBeVisible({ timeout: 30_000 });

    // No-user-content serialization sweep (^ac-telemetry) over the whole
    // journey's corpus: gate instructions, toast markdown, and prompt text
    // never reach serialized telemetry.
    expect(sink.events.length).toBeGreaterThan(0);
    const serialized = sink.events.map((event) => JSON.stringify(event));
    for (const banned of BANNED_CONTENT) {
      for (const event of serialized) {
        expect(event, `banned content "${banned.slice(0, 40)}…"`).not.toContain(banned);
      }
    }
  } finally {
    for (const launched of launches) await launched.app.close().catch(() => {});
    if (server) await server.dispose();
    if (fixture) await fixture.dispose();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
})
