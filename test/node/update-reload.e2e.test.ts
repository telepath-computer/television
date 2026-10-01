import { describe, it } from "vitest";
import { expect as pwExpect } from "@playwright/test";
import {
  buildVersionedWebBundle,
  RELOAD_POLL_TIMEOUT_MS,
  launchServer,
  restartServerAtVersion,
  newPage,
  bundleVersion,
  navigationType,
  readMarker,
  connectionStatus,
  normalized,
} from "./update-reload.e2e.helpers.ts";


describe("reload acceptance spine (restart-at-version)", () => {
  it("heals a stale client: reconnect after a restart-at-B reloads into the B interface (^ac-reload-heals)", async () => {
    const distA = await buildVersionedWebBundle("1.0.0");
    const distB = await buildVersionedWebBundle("2.0.0");
    const serverA = await launchServer({ version: "1.0.0", staticDir: distA });

    const page = await newPage();
    await page.goto(serverA.url);
    await pwExpect.poll(() => bundleVersion(page)).toBe("1.0.0");
    await pwExpect
      .poll(() => connectionStatus(page, normalized(serverA.url)), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toBe("connected");
    // Matching versions: the initial connect must not reload.
    pwExpect(await navigationType(page)).toBe("navigate");

    // The shared seam of the whole update journey (^ac-composition): the
    // server restarts at a newer release, serving its newer interface.
    await restartServerAtVersion(serverA, { version: "2.0.0", staticDir: distB });

    // The dropped socket reconnects, the mismatch is detected, the client
    // reloads itself — and the reloaded page RUNS the server's current
    // interface (the B-stamped bundle), the healed state.
    await pwExpect.poll(() => navigationType(page), { timeout: RELOAD_POLL_TIMEOUT_MS }).toBe("reload");
    await pwExpect.poll(() => bundleVersion(page), { timeout: RELOAD_POLL_TIMEOUT_MS }).toBe("2.0.0");
    // No user-visible notice beyond the reload: the app boots normally.
    await pwExpect(page.locator("#app")).toBeVisible({ timeout: RELOAD_POLL_TIMEOUT_MS });
    // The healed mismatch clears the loop-guard marker on the post-reload
    // connect (version-advertisement.md ^autoreload-telemetry).
    await pwExpect.poll(() => readMarker(page), { timeout: RELOAD_POLL_TIMEOUT_MS }).toBeNull();
  });

  it("revalidates a cache-primed entry document: the reload fetches the current interface (^ac-reload-fresh)", async () => {
    const distA = await buildVersionedWebBundle("1.0.0");
    const distB = await buildVersionedWebBundle("2.0.0");
    const serverA = await launchServer({ version: "1.0.0", staticDir: distA });

    // The cache-header contract that makes the reload effective
    // (version-advertisement.md ^cache-headers): the entry document must
    // revalidate; hashed assets may cache immutably.
    const entryResponse = await fetch(new URL("/index.html", serverA.url));
    pwExpect(entryResponse.headers.get("cache-control")).toBe("no-cache");

    const page = await newPage();
    await page.goto(serverA.url);
    await pwExpect.poll(() => bundleVersion(page)).toBe("1.0.0");
    await pwExpect
      .poll(() => connectionStatus(page, normalized(serverA.url)), { timeout: RELOAD_POLL_TIMEOUT_MS })
      .toBe("connected");
    // The entry document and assets are now in the browser's cache. Restart
    // at B: if the reload were cache-served, the page would still run the
    // 1.0.0 bundle afterwards — revalidation is what delivers 2.0.0.
    await restartServerAtVersion(serverA, { version: "2.0.0", staticDir: distB });
    await pwExpect.poll(() => bundleVersion(page), { timeout: RELOAD_POLL_TIMEOUT_MS }).toBe("2.0.0");
  });

})
