import { describe, it } from "vitest";
import { expect as pwExpect } from "@playwright/test";
import {
  buildVersionedWebBundle,
  RELOAD_POLL_TIMEOUT_MS,
  SILENCE_WINDOW_MS,
  launchServer,
  restartServerAtVersion,
  newPage,
  bundleVersion,
  navigationType,
  readMarker,
  connectionStatus,
  plantSentinel,
  sentinelAlive,
  normalized,
} from "./update-reload.e2e.helpers.ts";


describe("reload acceptance spine (restart-at-version)", () => {
  it("guards the loop: a persisting mismatch reloads exactly once, silently; a NEW release retries once (^ac-reload-guard)", async () => {
    const distA = await buildVersionedWebBundle("1.0.0");
    // Server B serves dist A: the reload cannot heal the mismatch.
    const server = await launchServer({ version: "2.0.0", staticDir: distA });

    const page = await newPage();
    await page.goto(server.url);

    // Exactly one attempt: the reload happens, the marker records it…
    await pwExpect.poll(() => navigationType(page), { timeout: RELOAD_POLL_TIMEOUT_MS }).toBe("reload");
    await pwExpect
      .poll(() => readMarker(page), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toEqual({ serverVersion: "2.0.0", fromVersion: "1.0.0" });

    // …and then silence: no further navigation, no UI, the stale interface
    // keeps running for this tab session.
    await pwExpect
      .poll(() => connectionStatus(page, normalized(server.url)), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toBe("connected");
    await plantSentinel(page);
    await page.waitForTimeout(SILENCE_WINDOW_MS);
    pwExpect(await sentinelAlive(page)).toBe(true);
    pwExpect(await bundleVersion(page)).toBe("1.0.0");
    await pwExpect(page.locator("#app")).toBeVisible();

    // A subsequent NEW server release triggers a fresh single attempt.
    await plantSentinel(page);
    await restartServerAtVersion(server, { version: "3.0.0", staticDir: distA });
    await pwExpect.poll(() => sentinelAlive(page), { timeout: RELOAD_POLL_TIMEOUT_MS }).toBe(false);
    await pwExpect
      .poll(() => readMarker(page), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toEqual({ serverVersion: "3.0.0", fromVersion: "1.0.0" });

    // And again exactly once.
    await pwExpect
      .poll(() => connectionStatus(page, normalized(server.url)), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toBe("connected");
    await plantSentinel(page);
    await page.waitForTimeout(SILENCE_WINDOW_MS);
    pwExpect(await sentinelAlive(page)).toBe(true);
  });

  it("a development (0.0.0) bundle never auto-reloads, whatever the server version (^ac-reload-dev)", async () => {
    // A 0.0.0-stamped bundle is the dev shape: an unstamped bundle resolves
    // to the identical 0.0.0 through the same resolver (the unstamped path is
    // owned by version-advertisement.md ^t-version-resolution), and the
    // exemption keys on the value (arch/updates/index.md ^updates-dev-version).
    const distDev = await buildVersionedWebBundle("0.0.0");
    const server = await launchServer({ version: "9.9.9", staticDir: distDev });

    const page = await newPage();
    await page.goto(server.url);
    await pwExpect.poll(() => bundleVersion(page)).toBe("0.0.0");
    await pwExpect
      .poll(() => connectionStatus(page, normalized(server.url)), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toBe("connected");

    // Connected with the server-status delivered — and nothing happens.
    await plantSentinel(page);
    await page.waitForTimeout(SILENCE_WINDOW_MS);
    pwExpect(await sentinelAlive(page)).toBe(true);
    pwExpect(await navigationType(page)).toBe("navigate");
    pwExpect(await readMarker(page)).toBeNull();
  });
})
