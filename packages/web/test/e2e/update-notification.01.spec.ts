import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
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
// Component seams against the fixture page (specs/arch/testing-policy.md;
// update state injected):
//   ^t-toast-render — the notice body renders exactly as the standard
//     markdown pipeline renders elsewhere; links carry target="_blank"
//     rel="noopener noreferrer"; the copy-button label is the surface's
//     own "Copy upgrade prompt" regardless of document fields
//     (specs/ui/app/update-notification/index.md ^un-copy-button).
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

const FIXTURE = "/packages/web/test/e2e/fixtures/update-notification.html";
const SERVER_VERSION = "1.0.0";
const FAST_POLL_MS = "200";
// Negative-assertion window: long enough for a would-be notice to appear
// (several poll cycles at the fast interval + broadcast + render).
const SILENCE_WINDOW_MS = 2_000;

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

async function startServer(input: { staticDir: string; channelURL?: string }): Promise<Server> {
  process.env.TV_TEST_VERSION = SERVER_VERSION;
  if (input.channelURL === undefined) delete process.env.TV_UPDATE_CHANNEL_URL;
  else process.env.TV_UPDATE_CHANNEL_URL = input.channelURL;
  process.env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS = FAST_POLL_MS;
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
const copyIdleLabel = (page: Page) => page.locator(".update-popover .copy-button-idle");
const laterButton = (page: Page) => page.locator(".update-popover .update-later");

async function gotoFixture(page: Page, search = ""): Promise<void> {
  await page.goto(`${FIXTURE}${search}`);
  await page.waitForFunction(() => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true);
  await configureTestMotion(page);
}

async function sendStatus(page: Page, toast: Record<string, unknown> | null): Promise<void> {
  await page.evaluate((state) => {
    (window as unknown as { __sendStatus(toast: unknown): void }).__sendStatus(state);
  }, toast);
}

async function expectNoticeBodySelectable(page: Page, selectionTarget: Locator): Promise<void> {
  await expect.poll(() => notice(page).evaluate((panel) => getComputedStyle(panel).userSelect))
    .toBe("text");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await selectionTarget.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
}

test.describe("notice rendering seam (^t-toast-render)", () => {
  test("renders the body through the standard markdown pipeline, links external, the surface's own copy label", async ({ page }) => {
    await gotoFixture(page);
    const markdown = "A **bold** notice with a [link](https://television.run/notes).\n\n- one\n- two";
    await sendStatus(page, { version: "1.5.0", markdown, prompt: "upgrade my television server" });

    await expect(notice(page)).toBeVisible();

    // Pipeline parity: the notice body is the pipeline's output placed
    // verbatim as the panel's leading content — the surface adds no rendering
    // treatment of its own; only the trailing action-row is its own.
    const { bodyHTML, pipelineHTML } = await page.evaluate((source) => {
      const panel = document.querySelector("tv-popover.update-popover");
      const clone = panel?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelector(".update-actions")?.remove();
      if (clone) {
        const comments = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
        const found: Comment[] = [];
        while (comments.nextNode()) found.push(comments.currentNode as Comment);
        for (const comment of found) comment.remove();
      }
      const render = (window as unknown as { __renderMarkdown(text: string): string }).__renderMarkdown;
      return {
        bodyHTML: clone?.innerHTML.trim() ?? null,
        pipelineHTML: render(source).trim(),
      };
    }, markdown);
    expect(bodyHTML).toBe(pipelineHTML);

    const link = notice(page).locator("a");
    await expect(link).toHaveAttribute("href", "https://television.run/notes");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    // The app shell disables selection by default; the complete notice body
    // restores ordinary browser selection (^un-ac-body-selection).
    await expectNoticeBodySelectable(page, notice(page).locator("strong"));

    // The label is the surface's own, never document-supplied (^un-copy-button).
    await expect(copyIdleLabel(page)).toHaveText("Copy upgrade prompt");
  });
});

// proofs/arch/updates/desktop-self-update-notice.md#^desktop-self-update-notice-t-render
test.describe("desktop self-update notice rendering seam (^desktop-self-update-notice-t-render)", () => {
  test("renders the downloaded version through markdown with Later and the restart button", async ({ page }) => {
    await gotoFixture(page, "?mode=electron&desktopAppVersion=1.5.0&desktopUpdate=1.6.0");

    await expect(notice(page)).toBeVisible();
    await expect(notice(page).locator("h3")).toHaveText("Desktop app update ready");
    await expect(notice(page)).toContainText("Version 1.6.0 has downloaded and installs when you restart the app.");
    const rendered = await notice(page).evaluate((panel) => {
      const fixtureWindow = window as unknown as {
        __renderMarkdown(markdown: string): string;
        __desktopSelfUpdateNoticeMarkdown(version: string): string;
      };
      const expected = document.createElement("div");
      expected.innerHTML = fixtureWindow.__renderMarkdown(fixtureWindow.__desktopSelfUpdateNoticeMarkdown("1.6.0"));
      const bodyElements = [...panel.children].filter((child) => !child.classList.contains("update-actions"));
      return {
        actual: bodyElements.map((element) => element.outerHTML),
        expected: [...expected.children].map((element) => element.outerHTML),
      };
    });
    expect(rendered.actual).toEqual(rendered.expected);
    await expect(notice(page).locator(".update-actions > *")).toHaveCount(2);
    await expect(laterButton(page)).toHaveCount(1);
    await expect(copyButton(page)).toHaveCount(0);
    await expect(notice(page).locator(".update-actions > .update-restart")).toHaveText("Restart to update");
    await expectNoticeBodySelectable(page, notice(page).locator("h3"));
  });
});

test.describe("desktop recommendation rendering seam (^desktop-rec-t-render)", () => {
  test("renders the authored recommendation through markdown with its download link and Later alone", async ({ page }) => {
    // 1.3.2 is a release of the npm package; the fixture's server requires no desktop version.
    await gotoFixture(page, "?mode=electron&desktopAppVersion=1.3.2");

    await expect(notice(page)).toBeVisible();
    await expect(notice(page).locator("h3")).toHaveText(
      "Recommended desktop upgrade available",
    );
    // Restated from specs/ui/app/update-notification/content.yml#desktop_upgrade_recommendation.
    await expect(notice(page)).toContainText(
      "The Television desktop app is now a downloaded Mac app that updates itself. This copy was installed with npm and receives no more updates.",
    );
    const steps = notice(page).locator("ol > li");
    await expect(steps).toHaveText([
      "Download Television for Mac.",
      "Open the downloaded disk image and drag Television to Applications.",
      "Quit this app, then open Television from Applications. It keeps your saved server connection.",
    ]);
    const link = steps.first().locator("a");
    await expect(link).toHaveText("Download Television for Mac");
    await expect(link).toHaveAttribute("href", "https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expectNoticeBodySelectable(page, notice(page).locator("h3"));
    await expect(laterButton(page)).toHaveCount(1);
    await expect(copyButton(page)).toHaveCount(0);
  });
});

test.describe("notice + bell acceptance (product/update-notifications.md)", () => {
  test("^ac-toast-shows: a newer channel version shows the rendered notice in a connected client", async ({ page }) => {
    // The versioned production build includes the permanent root composition.
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const fixture = await startChannelFixture(channelDocument({ version: "1.5.0" }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });

    await gotoAndConnect(page, server);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });

    // The notice's markdown rendered as the interface renders markdown.
    await expect(notice(page).locator("strong")).toHaveText("Television 1.5.0");
    const link = notice(page).locator("a");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    // This notice carries no prompt: no copy button (^ac-toast-copy's flip side).
    await expect(copyButton(page)).toHaveCount(0);
  });

  test("^ac-toast-not-newer: an equal channel version shows no notice and no bell", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const fixture = await startChannelFixture(channelDocument({ version: SERVER_VERSION }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });

    await gotoAndConnect(page, server);
    // The channel HAS been polled (the fixture records requests), so silence
    // is a decision, not a not-yet.
    await expect.poll(() => fixture.requests.length).toBeGreaterThan(0);
    await page.waitForTimeout(SILENCE_WINDOW_MS);
    await expect(notice(page)).toHaveCount(0);
    await expect(bell(page)).toHaveCount(0);
  });

  test("^ac-toast-copy: the copy button carries the surface's own label and places the prompt on the clipboard", async ({ page }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const prompt = "Upgrade my Television server following https://television.run/install.md";
    // A document-named label stays valid on the wire and is deliberately
    // ignored (^un-copy-button).
    const fixture = await startChannelFixture(
      channelDocument({ version: "1.5.0", prompt, promptButtonLabel: "Copy the upgrade ask" }),
    );
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });

    await gotoAndConnect(page, server);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await expect(copyIdleLabel(page)).toHaveText("Copy upgrade prompt");
    await copyButton(page).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  });

  test("^ac-toast-dismiss: dismissal survives reload and profile reopen; a newer notice pops fresh", async ({ page, context }) => {
    const dist = await buildVersionedWebBundle(SERVER_VERSION);
    const fixture = await startChannelFixture(channelDocument({ version: "1.5.0" }));
    const server = await startServer({ staticDir: dist, channelURL: fixture.url });
    let activePage = page;

    await gotoAndConnect(activePage, server);
    await expect(notice(activePage)).toBeVisible({ timeout: 15_000 });
    await laterButton(activePage).click();
    await expect(notice(activePage)).not.toBeVisible();

    // The dismissed version stays down after reloading the same document.
    await activePage.reload();
    await waitForApplicationRender(activePage, APPLICATION_SHELL_STATES, 15_000);
    await configureTestMotion(activePage);
    await expect(bell(activePage)).toBeVisible({ timeout: 15_000 }); // state applies again…
    await activePage.waitForTimeout(SILENCE_WINDOW_MS);
    await expect(notice(activePage)).not.toBeVisible(); // …but the notice stays down.

    // Closing and reopening a page in the same browser profile retains the
    // dismissal. The visible bell positively controls the no-auto-show check.
    await activePage.close();
    activePage = await context.newPage();
    await gotoAndConnect(activePage, server);
    await expect(bell(activePage)).toBeVisible({ timeout: 15_000 });
    await activePage.waitForTimeout(SILENCE_WINDOW_MS);
    await expect(notice(activePage)).not.toBeVisible();

    // A strictly newer channel deploy pops a fresh notice.
    fixture.setResponse(channelDocument({ version: "1.6.0" }));
    await expect(notice(activePage)).toBeVisible({ timeout: 15_000 });
    await expect(notice(activePage).locator("strong")).toHaveText("Television 1.6.0");
  });
})
