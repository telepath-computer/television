import { type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { configureTestMotion, waitForApplicationShell } from "./helpers.ts";

// Browser-facing product acceptance for onboarding channels
// (specs/product/onboarding/onboarding-channels.md): a real browser drives the
// production web client against a really running built-CLI server. Real boots
// and restarts prepare server state; the stable development proxy keeps the app
// origin fixed across backend replacement. The assertions observe only the
// permanent sidebar and shared focus state — no onboarding marker drives UI.

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const SUBSET = path.join(REPO_ROOT, "test/node/fixtures/onboarding-bundles/subset");
const SUPERSET = path.join(REPO_ROOT, "test/node/fixtures/onboarding-bundles/superset");
const PRODUCTION_BUNDLE = path.join(REPO_ROOT, "packages/server/assets/onboarding-channels");
const RECONNECT_TIMEOUT_MS = 20_000;

interface BundleChannel {
  readonly slug: string;
  readonly name: string;
}

interface BundleConfig {
  readonly focusChannel: string;
  readonly channels: readonly BundleChannel[];
}

interface InstalledChannel {
  readonly id: string;
  readonly name: string;
}

interface ProductChannelState {
  readonly channels: readonly InstalledChannel[];
  readonly focusedChannelId: string | null;
  readonly pinnedChannelIds: readonly string[];
}

function readBundleConfig(root: string): BundleConfig {
  return JSON.parse(readFileSync(path.join(root, "onboarding-channels.json"), "utf8")) as BundleConfig;
}

function appIndexURL(appURL: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  return url.toString();
}

async function openApp(page: Page, product: ProductServer, baseURL: string | undefined): Promise<string> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appURL = await product.appURL(baseURL);
  await page.goto(appIndexURL(appURL));
  await waitForApplicationShell(page);
  await configureTestMotion(page);
  await expect(sidebar(page)).toBeVisible();
  return appURL;
}

async function productChannelState(product: ProductServer): Promise<ProductChannelState> {
  const { channels } = JSON.parse(product.runCLI(["list-channels"])) as {
    channels: InstalledChannel[];
  };
  const response = await fetch(new URL("/display", product.serverURL), {
    headers: { Authorization: `Bearer ${product.token}` },
  });
  expect(response.status).toBe(200);
  const display = await response.json() as {
    focusedChannelId: string | null;
    pinnedChannelIds: string[];
  };
  return {
    channels,
    focusedChannelId: display.focusedChannelId,
    pinnedChannelIds: display.pinnedChannelIds,
  };
}

function sidebar(page: Page): Locator {
  return page.getByRole("listbox", { name: "Channels" });
}

function recentGroup(page: Page): Locator {
  return sidebar(page).getByRole("group", { name: "Recent", exact: true });
}

function recentChannels(page: Page): Locator {
  return recentGroup(page).locator(".channel-row > .channel");
}

function ordinaryUnpinnedNames(state: ProductChannelState): string[] {
  if (state.pinnedChannelIds.length !== 0) {
    throw new Error(`Onboarding fixture unexpectedly pinned ${state.pinnedChannelIds.join(", ")}`);
  }
  return [...state.channels]
    .sort((left, right) => right.id.localeCompare(left.id))
    .map(({ name }) => name);
}

function focusedChannel(state: ProductChannelState): InstalledChannel {
  const focused = state.channels.find(({ id }) => id === state.focusedChannelId);
  if (!focused) throw new Error(`Focused channel ${state.focusedChannelId ?? "null"} is not installed`);
  return focused;
}

async function expectOrdinarySidebarState(
  page: Page,
  state: ProductChannelState,
  timeout?: number,
): Promise<void> {
  const names = ordinaryUnpinnedNames(state);
  await expect(recentGroup(page)).toBeVisible({ timeout });
  await expect(recentChannels(page)).toHaveText(names, { timeout });
  await expect(sidebar(page).getByRole("group", { name: "Pinned", exact: true })).toHaveCount(0);
  await expect(sidebar(page).locator(".channel[aria-selected='true']")).toHaveCount(1);
  await expect(
    recentGroup(page).getByRole("option", { name: focusedChannel(state).name, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

function singleAddedChannel(subset: BundleConfig, superset: BundleConfig): BundleChannel {
  const existing = new Set(subset.channels.map(({ slug }) => slug));
  const added = superset.channels.filter(({ slug }) => !existing.has(slug));
  if (added.length !== 1) throw new Error(`Expected one added fixture channel, found ${added.length}`);
  return added[0]!;
}

test.describe("browser onboarding outcomes", () => {
  // proofs/product/onboarding/onboarding-channels.md#^ac-new-channel-appears
  test("connecting after an upgrade shows the new ordinary unpinned sidebar channel without changing focus", async ({
    page,
    baseURL,
  }) => {
    const subset = readBundleConfig(SUBSET);
    const superset = readBundleConfig(SUPERSET);
    const added = singleAddedChannel(subset, superset);
    const product = await launchProductServer({ onboardingBundle: SUBSET });
    try {
      const before = await productChannelState(product);
      await product.restart({ onboardingBundle: SUPERSET });
      const after = await productChannelState(product);
      expect(after.focusedChannelId).toBe(before.focusedChannelId);

      await openApp(page, product, baseURL);
      await expectOrdinarySidebarState(page, after);
      await expect(recentGroup(page).getByRole("option", { name: added.name, exact: true }))
        .not.toHaveAttribute("aria-selected", "true");
    } finally {
      await product.dispose();
    }
  });

  // proofs/product/onboarding/onboarding-channels.md#^ac-new-channel-appears
  test("an open browser automatically reconnects to the new ordinary unpinned sidebar channel without changing focus", async ({
    page,
    baseURL,
  }) => {
    const subset = readBundleConfig(SUBSET);
    const superset = readBundleConfig(SUPERSET);
    const added = singleAddedChannel(subset, superset);
    const product = await launchProductServer({ onboardingBundle: SUBSET });
    try {
      const stableAppURL = await openApp(page, product, baseURL);
      const before = await productChannelState(product);
      await expectOrdinarySidebarState(page, before);

      await product.restart({ onboardingBundle: SUPERSET });
      expect(await product.appURL(baseURL!)).toBe(stableAppURL);
      const after = await productChannelState(product);
      expect(after.focusedChannelId).toBe(before.focusedChannelId);

      await expectOrdinarySidebarState(page, after, RECONNECT_TIMEOUT_MS);
      await expect(recentGroup(page).getByRole("option", { name: added.name, exact: true }))
        .not.toHaveAttribute("aria-selected", "true");
    } finally {
      await product.dispose();
    }
  });

  // proofs/product/onboarding/onboarding-channels.md#^ac-fresh-browser
  test("a fresh production installation shows every bundled channel newest-first with the designated channel focused", async ({
    page,
    baseURL,
  }) => {
    const config = readBundleConfig(PRODUCTION_BUNDLE);
    const product = await launchProductServer({ onboardingBundle: PRODUCTION_BUNDLE });
    try {
      const state = await productChannelState(product);
      expect(state.channels.map(({ name }) => name).sort())
        .toEqual(config.channels.map(({ name }) => name).sort());
      const designated = config.channels.find(({ slug }) => slug === config.focusChannel);
      if (!designated) throw new Error(`Configured focus channel ${config.focusChannel} is missing`);
      expect(focusedChannel(state).name).toBe(designated.name);

      await openApp(page, product, baseURL);
      await expectOrdinarySidebarState(page, state);
    } finally {
      await product.dispose();
    }
  });
});
