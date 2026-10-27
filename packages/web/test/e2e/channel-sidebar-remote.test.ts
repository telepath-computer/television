import { expect, type Page } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test } from "../../../../test/helpers/playwright.ts";
import {
  APPLICATION_SHELL_STATES,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";
import {
  launchProductServer,
  type ProductServer,
} from "../../../../test/helpers/product-server.ts";
import { configureTestMotion } from "./helpers.ts";

function appIndexURL(appURL: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  return url.toString();
}

async function openApp(
  page: Page,
  product: ProductServer,
  baseURL: string | undefined,
): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appURL = await product.appURL(baseURL);
  await page.goto(appIndexURL(appURL));
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  await expect(page.getByRole("listbox", { name: "Channels" })).toBeVisible();
}

function channelRow(page: Page, channelID: string) {
  return page.locator(`.channel-row[data-channel-id="${channelID}"]`);
}

async function channelIDs(
  page: Page,
  side: "pinned" | "unpinned",
): Promise<string[]> {
  return page.locator(
    `.sidebar-body > .channel-list > .channel-group[data-channel-side="${side}"]:not(.channel-group-withdrawal) > .channel-row`,
  ).evaluateAll((rows) =>
    rows.map((row) => (row as HTMLElement).dataset.channelId ?? "")
  );
}

function recordPinnedChannelEvents(page: Page): string[][] {
  const pinnedChannelEvents: string[][] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        const event = JSON.parse(
          typeof payload === "string" ? payload : payload.toString("utf8"),
        ) as { type?: unknown; pinnedChannelIds?: unknown };
        if (
          event.type === "pinned-channels-changed" &&
          Array.isArray(event.pinnedChannelIds) &&
          event.pinnedChannelIds.every((channelId) => typeof channelId === "string")
        ) {
          pinnedChannelEvents.push([...event.pinnedChannelIds]);
        }
      } catch {
        // Other websocket protocols and non-JSON frames are outside this recorder.
      }
    });
  });
  return pinnedChannelEvents;
}

async function expectChannelState(
  page: Page,
  pinnedChannelIDs: readonly string[],
  allChannelIDs: readonly string[],
): Promise<void> {
  const sortedAllChannelIDs = [...allChannelIDs].sort();
  await expect.poll(async () => {
    const pinned = await channelIDs(page, "pinned");
    const unpinned = await channelIDs(page, "unpinned");
    const rendered = [...pinned, ...unpinned];
    return {
      pinned,
      rendered: [...rendered].sort(),
      uniqueCount: new Set(rendered).size,
    };
  }).toEqual({
    pinned: pinnedChannelIDs,
    rendered: sortedAllChannelIDs,
    uniqueCount: sortedAllChannelIDs.length,
  });
}

async function holdChannelBefore(
  page: Page,
  dragged: { readonly id: string; readonly name: string },
  target: { readonly id: string },
): Promise<void> {
  const button = channelRow(page, dragged.id)
    .getByRole("option", { name: dragged.name, exact: true });
  await button.scrollIntoViewIfNeeded();
  const sourceBox = await button.boundingBox();
  if (!sourceBox) throw new Error(`${dragged.name} has no drag geometry`);
  const start = {
    x: sourceBox.x + sourceBox.width - 44,
    y: sourceBox.y + sourceBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y);
  await expect(channelRow(page, dragged.id)).toHaveClass(/\bdragged\b/);

  const targetBox = await channelRow(page, target.id).boundingBox();
  if (!targetBox) throw new Error(`Channel ${target.id} has no drop geometry`);
  await page.mouse.move(targetBox.x + 8, targetBox.y + 2);
  await expect(page.locator(
    '.channel-placeholder[data-channel-side="pinned"][data-channel-index="0"]',
  )).toBeVisible();
}

async function pinThroughMenu(
  page: Page,
  channel: { readonly id: string; readonly name: string },
): Promise<void> {
  const row = channelRow(page, channel.id);
  await row.getByTitle(`${channel.name} menu`, { exact: true }).click();
  await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Pin$/ }).click();
}

// Acceptance for specs/ui/app/sidebar/index.md ^sb-ac-drag-remote. Both pages
// run the production application against one built-CLI server. CSS motion is
// waived because this assertion observes only the settled concurrent outcome.
test("remote pin update during a held drag leaves one valid shared order", async ({
  page,
  browser,
  baseURL,
}) => {
  const product = await launchProductServer();
  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();
  const heldBrowserPinEvents = recordPinnedChannelEvents(page);
  try {
    const client = new TelevisionClient(product.serverURL);
    const { channel: pinnedFirst } = await client.channels.create({
      name: "Pinned first",
    });
    const { channel: draggedStale } = await client.channels.create({
      name: "Dragged stale",
    });
    const { channel: remotePin } = await client.channels.create({
      name: "Remote pin",
    });
    await client.display.patch({
      focusedChannelId: pinnedFirst.id,
      pinnedChannelIds: [pinnedFirst.id, draggedStale.id],
    });
    const allChannelIDs = (await client.channels.list()).channels.map(({ id }) => id);

    await Promise.all([
      openApp(page, product, baseURL),
      openApp(observer, product, baseURL),
    ]);
    await Promise.all([
      expectChannelState(
        page,
        [pinnedFirst.id, draggedStale.id],
        allChannelIDs,
      ),
      expectChannelState(
        observer,
        [pinnedFirst.id, draggedStale.id],
        allChannelIDs,
      ),
    ]);

    await holdChannelBefore(page, draggedStale, pinnedFirst);
    await pinThroughMenu(observer, remotePin);

    const remoteOrder = [pinnedFirst.id, draggedStale.id, remotePin.id];
    await expect.poll(async () => (await client.display.get()).pinnedChannelIds)
      .toEqual(remoteOrder);
    await expectChannelState(observer, remoteOrder, allChannelIDs);
    await expect.poll(() => heldBrowserPinEvents).toContainEqual(remoteOrder);

    // The assertion deliberately does not inspect the transient pose here:
    // authority permits either immediate interruption or stale-release nullification.
    await page.mouse.up();

    await Promise.all([
      expectChannelState(page, remoteOrder, allChannelIDs),
      expectChannelState(observer, remoteOrder, allChannelIDs),
    ]);
    await expect.poll(async () => (await client.display.get()).pinnedChannelIds)
      .toEqual(remoteOrder);
  } finally {
    await observerContext.close();
    await product.dispose();
  }
});
