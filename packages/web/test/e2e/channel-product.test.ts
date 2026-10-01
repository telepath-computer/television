import { expect, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { TelevisionClient, type Channel } from "@telepath-computer/television-shared";
import { test } from "../../../../test/helpers/playwright.ts";
import {
  launchProductServer,
  type ProductServer,
} from "../../../../test/helpers/product-server.ts";
import {
  APPLICATION_SHELL_STATES,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";
import {
  configureTestMotion,
  createArtifactFile,
} from "./helpers.ts";

function appIndexURL(appURL: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
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

async function openCollapsedApp(
  page: Page,
  product: ProductServer,
  baseURL: string | undefined,
): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  await page.addInitScript(() => {
    localStorage.setItem("tv-channel-sidebar-collapsed", "true");
  });
  const appURL = await product.appURL(baseURL);
  await page.goto(appIndexURL(appURL));
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.locator(".channel-switcher")).toBeVisible();
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

async function expectChannelIDs(
  page: Page,
  side: "pinned" | "unpinned",
  expected: readonly string[],
): Promise<void> {
  await expect.poll(() => channelIDs(page, side)).toEqual(expected);
}

async function expectArtifactTabs(
  page: Page,
  artifacts: readonly { readonly id: string; readonly title: string }[],
): Promise<void> {
  const tabs = page.locator(".top-bar .tab-strip > .tab");
  await expect(tabs).toHaveCount(artifacts.length);
  await expect(tabs).toHaveText(artifacts.map(({ title }) => title));
  expect(await tabs.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.artifactId)
  )).toEqual(artifacts.map(({ id }) => id));
}

async function createThroughSidebar(page: Page): Promise<Channel> {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" &&
      new URL(response.url()).pathname === "/channels";
  });
  await page.locator(".channel-create").click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return ((await response.json()) as { channel: Channel }).channel;
}

async function openDeleteConfirmation(page: Page, channelID: string, name: string) {
  const row = channelRow(page, channelID);
  await row.getByTitle(`${name} menu`, { exact: true }).click();
  await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Delete$/ }).click();
  const confirmation = page.getByRole("alertdialog", { name: `Delete “${name}”?` });
  await expect(confirmation).toBeVisible();
  return confirmation;
}

async function deleteThroughSidebar(
  page: Page,
  channelID: string,
  name: string,
): Promise<void> {
  const confirmation = await openDeleteConfirmation(page, channelID, name);
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(channelRow(page, channelID)).toHaveCount(0);
}

async function focusThroughSidebar(
  page: Page,
  channelID: string,
  name: string,
): Promise<void> {
  const button = channelRow(page, channelID)
    .getByRole("option", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-selected", "true");
}

async function chooseChannelMenuAction(
  page: Page,
  channelID: string,
  name: string,
  action: "Pin" | "Unpin",
): Promise<void> {
  const row = channelRow(page, channelID);
  await row.getByTitle(`${name} menu`, { exact: true }).click();
  await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: new RegExp(`^${action}$`) }).click();
}

async function dragChannelBefore(
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
  await page.mouse.up();
}

async function expectSharedPinState(
  pages: readonly Page[],
  client: TelevisionClient,
  pinnedChannelIDs: readonly string[],
): Promise<void> {
  await Promise.all(pages.map((page) =>
    expectChannelIDs(page, "pinned", pinnedChannelIDs)
  ));
  await expect.poll(async () => (await client.display.get()).pinnedChannelIds)
    .toEqual(pinnedChannelIDs);
}

async function readChannel(client: TelevisionClient, channelID: string) {
  const [{ channel }, { artifacts }] = await Promise.all([
    client.channels.get({ channelID }),
    client.artifacts.list({ channelID }),
  ]);
  return {
    channel,
    artifacts: [...artifacts].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function launchRemoteTarget(): Promise<{
  readonly url: string;
  readonly requests: readonly string[];
  dispose(): Promise<void>;
}> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? ""} ${request.url ?? ""}`);
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("remote target remains available");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Remote-target server did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/target`,
    requests,
    async dispose(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

// Product acceptance for specs/product/channels.md. These walks use the
// permanent production sidebar against a built-CLI server and observe settled
// application snapshots in independent browser clients. CSS motion is waived:
// SIDEBAR-2 and SIDEBAR-5 retain the gesture, timing, and choreography proofs.
test.describe("channel lifecycle product outcomes", () => {
  test("creation, rename, cancellation, and confirmed deletion converge without touching targets", async ({
    page,
    context,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const remoteTarget = await launchRemoteTarget();
    const observer = await context.newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      const baselineChannels = (await client.channels.list()).channels;
      const baselineRecent = baselineChannels.map(({ id }) => id)
        .sort((left, right) => right.localeCompare(left));
      await client.display.patch({
        focusedChannelId: baselineRecent[0] ?? null,
        pinnedChannelIds: [],
      });
      await Promise.all([
        openApp(page, product, baseURL),
        openApp(observer, product, baseURL),
      ]);
      await Promise.all([
        expectChannelIDs(page, "unpinned", baselineRecent),
        expectChannelIDs(observer, "unpinned", baselineRecent),
      ]);

      const created = await createThroughSidebar(page);
      expect(created).toMatchObject({ name: "New channel", layout: [] });
      const expectedCreatedOrder = [created.id, ...baselineRecent];
      await Promise.all([
        expectChannelIDs(page, "unpinned", expectedCreatedOrder),
        expectChannelIDs(observer, "unpinned", expectedCreatedOrder),
      ]);
      const birthRenameField = channelRow(page, created.id)
        .getByRole("textbox", { name: "Channel name" });
      await expect(birthRenameField).toBeFocused();
      await expect(channelRow(observer, created.id)
        .getByRole("option", { name: "New channel", exact: true })).toBeVisible();
      expect(await readChannel(client, created.id)).toMatchObject({
        channel: { id: created.id, name: "New channel", layout: [] },
        artifacts: [],
      });
      expect((await client.display.get()).pinnedChannelIds).toEqual([]);

      await birthRenameField.fill("Created empty");
      await birthRenameField.press("Enter");
      for (const connectedPage of [page, observer]) {
        await expect(channelRow(connectedPage, created.id)
          .getByRole("option", { name: "Created empty", exact: true }))
          .toBeVisible();
      }
      expect(await readChannel(client, created.id)).toMatchObject({
        channel: { id: created.id, name: "Created empty", layout: [] },
        artifacts: [],
      });

      const pathContent = "PRODUCT-1 path target survives channel deletion\n";
      const targetPath = createArtifactFile(
        product.home,
        "product-1-surviving-target",
        pathContent,
        "md",
      );
      const { artifact: pathArtifact } = await client.artifacts.create({
        channelID: created.id,
        kind: "path",
        title: "Surviving path",
        path: targetPath,
      });
      const { artifact: urlArtifact } = await client.artifacts.create({
        channelID: created.id,
        kind: "url",
        title: "Surviving URL",
        url: remoteTarget.url,
      });
      const beforeRename = await readChannel(client, created.id);
      expect(beforeRename.channel.layout.flatMap(({ artifactIds }) => artifactIds))
        .toEqual([pathArtifact.id, urlArtifact.id]);
      const lifecycleArtifacts = [pathArtifact, urlArtifact];
      await Promise.all([
        expectArtifactTabs(page, lifecycleArtifacts),
        expectArtifactTabs(observer, lifecycleArtifacts),
      ]);
      const displayBeforeRename = await client.display.get();
      expect(displayBeforeRename).toMatchObject({
        focusedChannelId: created.id,
        pinnedChannelIds: [],
      });

      const createdRow = channelRow(page, created.id);
      await createdRow.getByTitle("Created empty menu", { exact: true }).click();
      await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Rename$/ }).click();
      const populatedRenameField = createdRow
        .getByRole("textbox", { name: "Channel name" });
      await expect(populatedRenameField).toBeFocused();
      await populatedRenameField.fill("Shared lifecycle");
      await populatedRenameField.press("Enter");
      await Promise.all([
        expect(channelRow(page, created.id)
          .getByRole("option", { name: "Shared lifecycle", exact: true })).toBeVisible(),
        expect(channelRow(observer, created.id)
          .getByRole("option", { name: "Shared lifecycle", exact: true })).toBeVisible(),
      ]);
      const afterRename = await readChannel(client, created.id);
      expect(afterRename).toEqual({
        ...beforeRename,
        channel: { ...beforeRename.channel, name: "Shared lifecycle" },
      });
      expect(await client.display.get()).toMatchObject({
        focusedChannelId: displayBeforeRename.focusedChannelId,
        pinnedChannelIds: displayBeforeRename.pinnedChannelIds,
      });
      await Promise.all([
        expectChannelIDs(page, "unpinned", expectedCreatedOrder),
        expectChannelIDs(observer, "unpinned", expectedCreatedOrder),
        expectArtifactTabs(page, lifecycleArtifacts),
        expectArtifactTabs(observer, lifecycleArtifacts),
      ]);
      for (const connectedPage of [page, observer]) {
        await expect(channelRow(connectedPage, created.id)
          .getByRole("option", { name: "Shared lifecycle", exact: true }))
          .toHaveAttribute("aria-selected", "true");
      }

      let confirmation = await openDeleteConfirmation(
        page,
        created.id,
        "Shared lifecycle",
      );
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      expect(await readChannel(client, created.id)).toEqual(afterRename);
      expect(readFileSync(targetPath, "utf8")).toBe(pathContent);
      expect(await (await fetch(remoteTarget.url)).text())
        .toBe("remote target remains available");
      await expect(channelRow(observer, created.id)
        .getByRole("option", { name: "Shared lifecycle", exact: true })).toBeVisible();

      confirmation = await openDeleteConfirmation(page, created.id, "Shared lifecycle");
      await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
      await Promise.all([
        expect(channelRow(page, created.id)).toHaveCount(0),
        expect(channelRow(observer, created.id)).toHaveCount(0),
      ]);
      await expect.poll(async () =>
        (await client.channels.list()).channels.map(({ id }) => id)
      ).not.toContain(created.id);
      const survivingArtifactIDs = (await client.artifacts.list()).artifacts
        .map(({ id }) => id);
      expect(survivingArtifactIDs).not.toContain(pathArtifact.id);
      expect(survivingArtifactIDs).not.toContain(urlArtifact.id);
      for (const connectedPage of [page, observer]) {
        await expect(connectedPage.locator(
          `.top-bar .tab[data-artifact-id="${pathArtifact.id}"], ` +
            `.top-bar .tab[data-artifact-id="${urlArtifact.id}"]`,
        )).toHaveCount(0);
      }
      expect(readFileSync(targetPath, "utf8")).toBe(pathContent);
      expect(await (await fetch(remoteTarget.url)).text())
        .toBe("remote target remains available");
      expect(remoteTarget.requests.every((request) => request.startsWith("GET "))).toBe(true);

      const [overlapA, overlapB] = await Promise.all([
        createThroughSidebar(page),
        createThroughSidebar(observer),
      ]);
      expect(overlapA.id).not.toBe(overlapB.id);
      const fieldA = channelRow(page, overlapA.id)
        .getByRole("textbox", { name: "Channel name" });
      const fieldB = channelRow(observer, overlapB.id)
        .getByRole("textbox", { name: "Channel name" });
      await Promise.all([expect(fieldA).toBeVisible(), expect(fieldB).toBeVisible()]);
      await expect(channelRow(page, overlapB.id)
        .getByRole("textbox", { name: "Channel name" })).toHaveCount(0);
      await expect(channelRow(observer, overlapA.id)
        .getByRole("textbox", { name: "Channel name" })).toHaveCount(0);
      expect((await readChannel(client, overlapA.id)).channel.layout).toEqual([]);
      expect((await readChannel(client, overlapB.id)).channel.layout).toEqual([]);

      await Promise.all([
        fieldA.fill("Overlap from first client"),
        fieldB.fill("Overlap from second client"),
      ]);
      await Promise.all([fieldA.press("Enter"), fieldB.press("Enter")]);
      for (const connectedPage of [page, observer]) {
        await expect(channelRow(connectedPage, overlapA.id)
          .getByRole("option", { name: "Overlap from first client", exact: true }))
          .toBeVisible();
        await expect(channelRow(connectedPage, overlapB.id)
          .getByRole("option", { name: "Overlap from second client", exact: true }))
          .toBeVisible();
      }
      const expectedOverlapOrder = [overlapA.id, overlapB.id]
        .sort((left, right) => right.localeCompare(left));
      const expectedFinalOrder = [...expectedOverlapOrder, ...baselineRecent];
      await Promise.all([
        expectChannelIDs(page, "unpinned", expectedFinalOrder),
        expectChannelIDs(observer, "unpinned", expectedFinalOrder),
      ]);
      expect((await client.channels.get({ channelID: overlapA.id })).channel.name)
        .toBe("Overlap from first client");
      expect((await client.channels.get({ channelID: overlapB.id })).channel.name)
        .toBe("Overlap from second client");
    } finally {
      await remoteTarget.dispose();
      await product.dispose();
    }
  });

  test("shared focus follows both clients without reordering newest-first recent channels", async ({
    page,
    context,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const observer = await context.newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      await client.channels.create({ name: "Recent older" });
      await client.channels.create({ name: "Recent middle" });
      await client.channels.create({ name: "Recent newest" });
      const channels = (await client.channels.list()).channels;
      const recentOrder = channels.map(({ id }) => id)
        .sort((left, right) => right.localeCompare(left));
      const channelByID = new Map(channels.map((channel) => [channel.id, channel]));
      const initial = channelByID.get(recentOrder[0]!);
      const oldest = channelByID.get(recentOrder.at(-1)!);
      const middle = channelByID.get(recentOrder[1]!);
      if (!initial || !oldest || !middle) throw new Error("Expected seeded recent channels");
      await client.display.patch({
        focusedChannelId: initial.id,
        pinnedChannelIds: [],
      });
      await Promise.all([
        openApp(page, product, baseURL),
        openApp(observer, product, baseURL),
      ]);
      await Promise.all([
        expectChannelIDs(page, "unpinned", recentOrder),
        expectChannelIDs(observer, "unpinned", recentOrder),
      ]);

      await focusThroughSidebar(page, oldest.id, oldest.name);
      await expect(channelRow(observer, oldest.id)
        .getByRole("option", { name: oldest.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(oldest.id);
      await Promise.all([
        expectChannelIDs(page, "unpinned", recentOrder),
        expectChannelIDs(observer, "unpinned", recentOrder),
      ]);

      await focusThroughSidebar(observer, middle.id, middle.name);
      await expect(channelRow(page, middle.id)
        .getByRole("option", { name: middle.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(middle.id);
      await Promise.all([
        expectChannelIDs(page, "unpinned", recentOrder),
        expectChannelIDs(observer, "unpinned", recentOrder),
      ]);
    } finally {
      await product.dispose();
    }
  });

  test("switcher focus reaches both clients while the selecting client stays collapsed", async ({
    browser,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const selectingContext = await browser.newContext();
    const observerContext = await browser.newContext();
    const selectingPage = await selectingContext.newPage();
    const observerPage = await observerContext.newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      const { channel: initial } = await client.channels.create({ name: "Switcher initial" });
      const { channel: destination } = await client.channels.create({
        name: "Switcher destination",
      });
      await client.display.patch({
        focusedChannelId: initial.id,
        pinnedChannelIds: [],
      });
      await Promise.all([
        openCollapsedApp(selectingPage, product, baseURL),
        openApp(observerPage, product, baseURL),
      ]);

      let selectingNavigations = 0;
      let observerNavigations = 0;
      selectingPage.on("framenavigated", (frame) => {
        if (frame === selectingPage.mainFrame()) selectingNavigations += 1;
      });
      observerPage.on("framenavigated", (frame) => {
        if (frame === observerPage.mainFrame()) observerNavigations += 1;
      });

      await selectingPage.locator(".channel-switcher").click();
      await selectingPage.locator(".channel-switcher-pop")
        .getByRole("option", { name: destination.name, exact: true })
        .click();

      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(destination.id);
      await expect(selectingPage.locator(".channel-switcher-name"))
        .toHaveText(destination.name);
      await expect(channelRow(observerPage, destination.id)
        .getByRole("option", { name: destination.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect(selectingPage.locator(".channel-switcher"))
        .not.toHaveAttribute("aria-expanded", "true");
      await expect(selectingPage.locator(".channel-switcher-pop"))
        .toHaveCount(0);
      await expect(selectingPage.locator(".app-sidebar")).toHaveCount(0);
      await expect(observerPage.locator(".app-sidebar")).toBeVisible();
      expect(selectingNavigations).toBe(0);
      expect(observerNavigations).toBe(0);
    } finally {
      await selectingContext.close();
      await observerContext.close();
      await product.dispose();
    }
  });

  test("pin append, marked drag placement, unpin, and reorder converge in both clients", async ({
    page,
    context,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const observer = await context.newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      const { channel: pinnedFirst } = await client.channels.create({ name: "Pinned first" });
      const { channel: pinnedSecond } = await client.channels.create({ name: "Pinned second" });
      const { channel: appendByMenu } = await client.channels.create({ name: "Append by menu" });
      const { channel: placeByDrag } = await client.channels.create({ name: "Place by drag" });
      const defaultChannel = (await client.channels.list()).channels
        .find(({ id }) => ![
          pinnedFirst.id,
          pinnedSecond.id,
          appendByMenu.id,
          placeByDrag.id,
        ].includes(id));
      if (!defaultChannel) throw new Error("Expected the default channel");
      await client.display.patch({
        focusedChannelId: pinnedFirst.id,
        pinnedChannelIds: [pinnedFirst.id, pinnedSecond.id],
      });
      await Promise.all([
        openApp(page, product, baseURL),
        openApp(observer, product, baseURL),
      ]);
      await expectSharedPinState(
        [page, observer],
        client,
        [pinnedFirst.id, pinnedSecond.id],
      );

      await chooseChannelMenuAction(
        page,
        appendByMenu.id,
        appendByMenu.name,
        "Pin",
      );
      await expectSharedPinState(
        [page, observer],
        client,
        [pinnedFirst.id, pinnedSecond.id, appendByMenu.id],
      );

      await dragChannelBefore(page, placeByDrag, pinnedSecond);
      await expectSharedPinState(
        [page, observer],
        client,
        [pinnedFirst.id, placeByDrag.id, pinnedSecond.id, appendByMenu.id],
      );

      await chooseChannelMenuAction(page, placeByDrag.id, placeByDrag.name, "Unpin");
      await expectSharedPinState(
        [page, observer],
        client,
        [pinnedFirst.id, pinnedSecond.id, appendByMenu.id],
      );
      const expectedRecent = [placeByDrag.id, defaultChannel.id]
        .sort((left, right) => right.localeCompare(left));
      await Promise.all([
        expectChannelIDs(page, "unpinned", expectedRecent),
        expectChannelIDs(observer, "unpinned", expectedRecent),
      ]);

      await dragChannelBefore(page, appendByMenu, pinnedFirst);
      await expectSharedPinState(
        [page, observer],
        client,
        [appendByMenu.id, pinnedFirst.id, pinnedSecond.id],
      );
      await Promise.all([
        expectChannelIDs(page, "unpinned", expectedRecent),
        expectChannelIDs(observer, "unpinned", expectedRecent),
      ]);
    } finally {
      await product.dispose();
    }
  });

  test("focused deletion selects pinned, newest recent, and no-channel successors", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const { channel: pinnedFirst } = await client.channels.create({ name: "Pinned first" });
      const { channel: pinnedSecond } = await client.channels.create({ name: "Pinned second" });
      const { channel: firstDeletion } = await client.channels.create({
        name: "Delete with pins",
      });
      await client.display.patch({
        focusedChannelId: firstDeletion.id,
        pinnedChannelIds: [pinnedFirst.id, pinnedSecond.id],
      });
      await openApp(page, product, baseURL);
      await expect(channelRow(page, firstDeletion.id)
        .getByRole("option", { name: firstDeletion.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");

      await deleteThroughSidebar(page, firstDeletion.id, firstDeletion.name);
      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(pinnedFirst.id);
      await expect(channelRow(page, pinnedFirst.id)
        .getByRole("option", { name: pinnedFirst.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");

      const afterPinnedSuccessor = (await client.channels.list()).channels;
      const oldest = [...afterPinnedSuccessor]
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (!oldest) throw new Error("Expected a channel to test the recent successor");
      const expectedNewest = afterPinnedSuccessor
        .filter(({ id }) => id !== oldest.id)
        .sort((left, right) => right.id.localeCompare(left.id))[0];
      if (!expectedNewest) throw new Error("Expected a newest surviving channel");
      await client.display.patch({
        focusedChannelId: oldest.id,
        pinnedChannelIds: [],
      });
      await expect(channelRow(page, oldest.id)
        .getByRole("option", { name: oldest.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");

      await deleteThroughSidebar(page, oldest.id, oldest.name);
      await expect.poll(() => client.display.get()).toMatchObject({
        focusedChannelId: expectedNewest.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        acpEnabled: false,
      });
      await expect(channelRow(page, expectedNewest.id)
        .getByRole("option", { name: expectedNewest.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");

      const beforeLast = (await client.channels.list()).channels;
      for (const channel of beforeLast.filter(({ id }) => id !== expectedNewest.id)) {
        await focusThroughSidebar(page, channel.id, channel.name);
        await deleteThroughSidebar(page, channel.id, channel.name);
      }
      await focusThroughSidebar(page, expectedNewest.id, expectedNewest.name);
      await deleteThroughSidebar(page, expectedNewest.id, expectedNewest.name);

      await expect(page.locator("#app")).toHaveAttribute("data-app-state", "no-channel");
      await expect(page.locator(".channel-group")).toHaveCount(0);
      await expect(page.locator(".channel-create")).toBeVisible();
      await expect.poll(async () => (await client.channels.list()).channels).toEqual([]);
      await expect.poll(() => client.display.get()).toMatchObject({
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: null,
        acpEnabled: false,
      });
    } finally {
      await product.dispose();
    }
  });
});
