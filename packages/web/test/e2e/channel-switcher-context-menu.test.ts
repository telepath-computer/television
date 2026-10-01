import { expect, type Locator, type Page } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { createArtifactFile } from "./helpers.ts";

async function openApp(page: Page, product: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  await page.addInitScript(() => localStorage.setItem("tv-channel-sidebar-collapsed", "true"));
  const appURL = await product.appURL(baseURL);
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  await page.goto(url.toString());
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await expect(page.locator(".channel-switcher")).toBeVisible();
  await page.locator(".channel-switcher").click();
}

async function clearChannels(client: TelevisionClient): Promise<void> {
  for (const channel of (await client.channels.list()).channels) {
    await client.channels.remove({ channelID: channel.id });
  }
}

function row(page: Page, id: string): Locator {
  return page.locator(`.channel-switcher-pop .channel-row[data-channel-id="${id}"]`);
}

async function menu(page: Page, id: string): Promise<Locator> {
  const target = row(page, id);
  await target.locator(".channel-menu-trigger").click();
  await expect(target.locator("tv-menu")).toBeVisible();
  await expect(page.locator(".channel-switcher-pop")).toBeVisible();
  return target.locator("tv-menu");
}

// proofs/ui/app/top-bar/index.md#^top-ac-switcher-context-menu
// Real server and browser; CSS and row motion remain enabled.
test("switcher row actions reuse channel commands without selecting or reloading artifacts", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const client = new TelevisionClient(product.serverURL);
    await clearChannels(client);
    // Keep the create footer exposed while the upper row menu is open.
    for (const name of ["Earlier one", "Earlier two", "Earlier three"]) {
      await client.channels.create({ name });
    }
    const selected = (await client.channels.create({ name: "Selected" })).channel;
    const other = (await client.channels.create({ name: "Other" })).channel;
    const path = createArtifactFile(product.home, "switcher-context-menu", "<!doctype html><h1>Live artifact</h1>", "html");
    const { artifact } = await client.artifacts.create({ channelID: selected.id, kind: "path", path, title: "Live artifact" });
    await client.display.patch({ focusedChannelId: selected.id, pinnedChannelIds: [] });
    await openApp(page, product, baseURL);
    const frame = page.locator(`.stage .page[data-page-key="${artifact.id}"] iframe.artifact-content`);
    await expect(frame).toHaveCount(1);
    await expect(frame.contentFrame().locator("h1")).toHaveText("Live artifact");
    await frame.contentFrame().locator("h1").evaluate((element) => { element.textContent = "Preserved document"; });

    await (await menu(page, other.id)).locator("tv-menu-item").filter({ hasText: /^Rename$/ }).click();
    const otherName = row(page, other.id).getByRole("textbox", { name: "Channel name" });
    await expect(otherName).toBeFocused();
    await otherName.fill("Abandon this");
    await otherName.press("Escape");
    await expect(page.locator(".channel-switcher-pop")).toBeVisible();
    await expect(row(page, other.id).getByRole("option", { name: "Other", exact: true })).toBeVisible();

    await (await menu(page, selected.id)).locator("tv-menu-item").filter({ hasText: /^Rename$/ }).click();
    const selectedName = row(page, selected.id).getByRole("textbox", { name: "Channel name" });
    await selectedName.fill("Renamed selected");
    await selectedName.press("Enter");
    await expect(page.locator(".channel-switcher-name")).toHaveText("Renamed selected");

    await (await menu(page, other.id)).locator("tv-menu-item").filter({ hasText: /^Pin$/ }).click();
    await expect(row(page, other.id).locator("..")).toHaveAttribute("data-channel-side", "pinned");
    await expect(row(page, other.id).getByRole("option")).toBeFocused();
    await expect(row(page, other.id)).toBeInViewport();
    await (await menu(page, other.id)).locator("tv-menu-item").filter({ hasText: /^Unpin$/ }).click();
    await expect(row(page, other.id).locator("..")).toHaveAttribute("data-channel-side", "unpinned");
    await expect(row(page, other.id).getByRole("option")).toBeFocused();
    await expect(row(page, other.id)).toBeInViewport();
    expect((await client.display.get()).focusedChannelId).toBe(selected.id);
    await expect(frame.contentFrame().locator("h1")).toHaveText("Preserved document");
    await expect(page.locator(".app-sidebar")).toHaveCount(0);

    // The upper trigger stays exposed when the lower row opens its menu.
    await menu(page, selected.id);
    await menu(page, other.id);
    await expect(row(page, selected.id).locator("tv-menu")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(row(page, other.id).locator("tv-menu")).toBeHidden();
    await expect(page.locator(".channel-switcher-pop")).toBeVisible();

    // A create press inside the ancestor must dismiss the menu and still act.
    await menu(page, other.id);
    await page.locator(".channel-switcher-pop").getByRole("button", { name: "New channel", exact: true }).click();
    await expect(page.locator(".channel-switcher-pop .channel-rename")).toBeFocused();
    await page.locator(".channel-switcher-pop .channel-rename").press("Escape");
    await menu(page, selected.id);
    await row(page, other.id).getByRole("option").click();
    await expect(page.locator(".channel-switcher-pop")).toHaveCount(0);
    await expect(page.locator(".channel-switcher")).not.toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".channel-switcher-pop tv-menu[open]")).toHaveCount(0);
    await expect.poll(async () => (await client.display.get()).focusedChannelId).toBe(other.id);
    await expect(page.locator(".channel-switcher-name")).toHaveText("Other");
  } finally {
    await product.dispose();
  }
});

// proofs/ui/app/top-bar/index.md#^top-ac-switcher-delete
// Real browser dialog and shared application services; no motion override.
test("switcher delete restores scroll and focus after cancellation and confirmed deletion", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const client = new TelevisionClient(product.serverURL);
    await clearChannels(client);
    const channelCount = 18;
    const channels = [];
    for (let index = 0; index < channelCount; index += 1) {
      channels.push((await client.channels.create({ name: `Channel ${index}` })).channel);
    }
    const target = channels[0]!;
    const selected = channels[1]!;
    await client.display.patch({ focusedChannelId: selected.id, pinnedChannelIds: [] });
    await page.setViewportSize({ width: 800, height: 420 });
    await openApp(page, product, baseURL);
    for (const cancellation of ["Cancel", "Escape", "backdrop"]) {
      await test.step(`Restore after ${cancellation}`, async () => {
        const actions = await menu(page, target.id);
        const scroll = await page.locator(".channel-switcher-pop-body").evaluate((element) => element.scrollTop);
        expect(scroll).toBeGreaterThan(0);
        await actions.locator("tv-menu-item").filter({ hasText: /^Delete$/ }).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await expect(page.locator(".channel-switcher-pop[open]")).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
        if (cancellation === "Cancel") await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        else if (cancellation === "Escape") await page.keyboard.press("Escape");
        else await page.locator("dialog").click({ position: { x: -10, y: -10 } });
        await expect(dialog).toHaveCount(0);
        await expect(row(page, target.id).getByRole("option")).toBeFocused();
        await expect.poll(() => page.locator(".channel-switcher-pop-body").evaluate((element) => element.scrollTop)).toBe(scroll);
      });
    }
    await (await menu(page, selected.id)).locator("tv-menu-item").filter({ hasText: /^Delete$/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row(page, selected.id)).toHaveCount(0);
    await expect(page.locator('.channel-switcher-pop .channel[aria-selected="true"]')).toBeFocused();
    const focused = (await client.display.get()).focusedChannelId;
    await expect(row(page, focused!).getByRole("option")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".app-sidebar")).toHaveCount(0);
  } finally {
    await product.dispose();
  }
});

test("deleting the final switcher channel returns focus to the expand control", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const client = new TelevisionClient(product.serverURL);
    await clearChannels(client);
    const channel = (await client.channels.create({ name: "Final channel" })).channel;
    await openApp(page, product, baseURL);
    await (await menu(page, channel.id)).locator("tv-menu-item").filter({ hasText: /^Delete$/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator(".channel-switcher")).toHaveCount(0);
    await expect(page.locator(".channel-switcher-pop")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show sidebar", exact: true })).toBeFocused();
    expect((await client.channels.list()).channels).toEqual([]);
  } finally {
    await product.dispose();
  }
});

// proofs/ui/app/top-bar/index.md — switcher keyboard/highlight conformance.
test("switcher navigation shares menu highlight and keeps persistent selection", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const client = new TelevisionClient(product.serverURL);
    await clearChannels(client);
    const channels = [];
    for (const name of ["First", "Second", "Third"]) channels.push((await client.channels.create({ name })).channel);
    await client.display.patch({ focusedChannelId: channels[0]!.id, pinnedChannelIds: channels.map(channel => channel.id) });
    await openApp(page, product, baseURL);
    const options = page.locator('.channel-switcher-pop .channel[role="option"]');
    // Pointer-open leaves focus alone; arrows still enter from outside the list.
    await page.keyboard.press("ArrowUp");
    await expect(options.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options.last()).toBeFocused();
    await options.nth(1).hover();
    await expect(options.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options.last()).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(async () => (await client.display.get()).focusedChannelId).toBe(channels[2]!.id);
    await expect(page.locator(".channel-switcher-pop")).toHaveCount(0);
    await expect(page.locator(".channel-switcher")).toBeFocused();
    await page.locator(".channel-switcher").focus();
    await page.keyboard.press("Enter");
    await expect(options.first()).toBeFocused();
  } finally { await product.dispose(); }
});

// proofs/ui/app/top-bar/index.md — real-motion channel-switcher drag conformance.
test("switcher drag reorders, pins, unpins outside, and cancels without selecting or dismissing", async ({ page, baseURL }) => {
  const product = await launchProductServer();
  try {
    const client = new TelevisionClient(product.serverURL);
    await clearChannels(client);
    await page.setViewportSize({ width: 800, height: 420 });
    const extraPinned = [];
    const overflowCount = 12;
    for (let index = 0; index < overflowCount; index += 1) {
      extraPinned.push((await client.channels.create({ name: `Overflow ${index}` })).channel.id);
    }
    const channels = [];
    for (const name of ["Oldest", "Middle", "Newest"]) channels.push((await client.channels.create({ name })).channel);
    const [oldest, middle, newest] = channels;
    await client.display.patch({ focusedChannelId: oldest!.id, pinnedChannelIds: [oldest!.id, middle!.id, ...extraPinned] });
    const path = createArtifactFile(product.home, "switcher-drag-live", "<!doctype html><h1>Live artifact</h1>", "html");
    const { artifact } = await client.artifacts.create({ channelID: oldest!.id, kind: "path", path, title: "Live artifact" });
    await openApp(page, product, baseURL);
    const frame = page.locator(`.stage .page[data-page-key="${artifact.id}"] iframe.artifact-content`);
    await expect(frame.contentFrame().locator("h1")).toHaveText("Live artifact");
    await frame.contentFrame().locator("h1").evaluate(element => { element.textContent = "Preserved document"; });
    const popover = page.locator(".channel-switcher-pop");
    const centre = async (locator: Locator) => {
      const bounds = await locator.boundingBox();
      if (!bounds) throw new Error("Missing drag bounds");
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };
    const start = async (id: string) => {
      await row(page, id).getByRole("option").scrollIntoViewIfNeeded();
      const point = await centre(row(page, id).getByRole("option"));
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 12, point.y, { steps: 3 });
      await expect(popover.locator(".dragged")).toHaveCount(1);
    };
    const order = () => client.display.get().then(display => display.pinnedChannelIds);
    await start(middle!.id);
    let target = await centre(row(page, oldest!.id));
    await page.mouse.move(target.x, target.y - 8, { steps: 6 });
    await page.mouse.up();
    await expect.poll(order).toEqual([middle!.id, oldest!.id, ...extraPinned]);
    await expect(popover.locator(".dragged")).toHaveCount(0);
    await start(newest!.id);
    await popover.locator(".channel-switcher-pop-body").evaluate(element => { element.scrollTop = 0; });
    target = await centre(row(page, oldest!.id));
    await page.mouse.move(target.x, target.y - 8, { steps: 6 });
    await page.mouse.up();
    await expect.poll(order).toEqual([middle!.id, newest!.id, oldest!.id, ...extraPinned]);
    await expect(popover.locator(".dragged")).toHaveCount(0);
    const panelBox = await popover.boundingBox();
    if (!panelBox) throw new Error("Missing popover bounds");
    const outside = { x: panelBox.x + panelBox.width + 100, y: panelBox.y + 40 };
    await start(middle!.id);
    await page.mouse.move(outside.x, outside.y, { steps: 6 });
    await expect(popover.locator(".channel-drag-action")).toHaveText("Unpin");
    await page.mouse.up();
    await expect.poll(order).toEqual([newest!.id, oldest!.id, ...extraPinned]);
    await expect(popover).toBeVisible();
    await expect(row(page, middle!.id).locator("..")).toHaveAttribute("data-channel-side", "unpinned");
    await expect(popover.locator(".dragged")).toHaveCount(0);
    await start(oldest!.id);
    await page.mouse.move(outside.x, outside.y, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(popover).toBeVisible();
    await expect(popover.locator(".dragged")).toHaveCount(0);
    expect(await order()).toEqual([newest!.id, oldest!.id, ...extraPinned]);
    for (const interruption of ["pointercancel", "capture-loss"] as const) {
      await start(oldest!.id);
      await page.mouse.move(outside.x, outside.y, { steps: 6 });
      await popover.evaluate((element, kind) => {
        if (kind === "pointercancel") element.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
        else element.releasePointerCapture(1);
      }, interruption);
      await page.mouse.up();
      await expect(popover.locator(".dragged")).toHaveCount(0);
      await expect(popover).toBeVisible();
      expect(await order()).toEqual([newest!.id, oldest!.id, ...extraPinned]);
    }
    const body = popover.locator(".channel-switcher-pop-body");
    await body.evaluate(element => { element.scrollTop = 0; });
    await start(newest!.id);
    const scrollBox = await body.boundingBox();
    if (!scrollBox) throw new Error("Missing list scroll bounds");
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height - 1, { steps: 6 });
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(40);
    // Leave the edge and choose a revealed pinned slot; holding at the edge
    // indefinitely eventually reaches Recent, whose slot follows creation order.
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    await expect.poll(() => popover.locator(".channel-placeholder").getAttribute("data-channel-index").then(Number)).toBeGreaterThan(1);
    await page.mouse.up();
    await expect(popover.locator(".dragged")).toHaveCount(0);
    await expect.poll(() => order().then(ids => ids.indexOf(newest!.id))).toBeGreaterThan(1);
    await expect(popover).toBeVisible();
    await expect(page.locator(".app-sidebar")).toHaveCount(0);
    await expect(frame.contentFrame().locator("h1")).toHaveText("Preserved document");
    expect((await client.display.get()).focusedChannelId).toBe(oldest!.id);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  } finally { await product.dispose(); }
});
