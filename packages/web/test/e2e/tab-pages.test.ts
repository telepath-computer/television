import { type Page, type Request } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test, expect } from "../../../../test/helpers/playwright.ts";
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
  pickChannelByName,
} from "./helpers.ts";

interface SeededArtifact {
  readonly id: string;
  readonly title: string;
}

interface SeededChannel {
  readonly id: string;
  readonly name: string;
  readonly artifacts: readonly SeededArtifact[];
}

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
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
  await expect(page.locator(".top-bar .tab-strip")).toBeVisible();
}

async function seedChannel(
  client: TelevisionClient,
  product: ProductServer,
  name: string,
  artifactTitles: readonly string[],
): Promise<SeededChannel> {
  const { channel } = await client.channels.create({ name });
  const artifacts: SeededArtifact[] = [];
  for (const [index, title] of artifactTitles.entries()) {
    const artifactPath = createArtifactFile(
      product.home,
      `${channel.id}-${index + 1}`,
      "<!doctype html><title>Tab-page fixture</title><h1>Tab-page fixture</h1>",
      "html",
    );
    const { artifact } = await client.artifacts.create({
      channelID: channel.id,
      kind: "path",
      title,
      path: artifactPath,
    });
    artifacts.push({ id: artifact.id, title: artifact.title });
  }
  return { id: channel.id, name: channel.name, artifacts };
}

function tabButtons(page: Page) {
  return page.locator(".top-bar .tab-strip > .tab");
}

function tabFor(page: Page, artifactID: string) {
  return page.locator(`.top-bar .tab[data-artifact-id="${artifactID}"]`);
}

async function expectTabs(
  page: Page,
  artifacts: readonly SeededArtifact[],
): Promise<void> {
  await expect(tabButtons(page)).toHaveCount(artifacts.length);
  await expect(tabButtons(page)).toHaveText(artifacts.map(({ title }) => title));
  expect(await tabButtons(page).evaluateAll((tabs) =>
    tabs.map((tab) => (tab as HTMLElement).dataset.artifactId)
  )).toEqual(artifacts.map(({ id }) => id));
}

async function expectPageOrder(
  page: Page,
  artifacts: readonly SeededArtifact[],
): Promise<void> {
  const pages = page.locator(".stage .page");
  await expect(pages).toHaveCount(artifacts.length);
  await expect.poll(() => pages.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.pageKey)
  )).toEqual(artifacts.map(({ id }) => id));
}

async function expectSelectedPage(
  page: Page,
  artifact: SeededArtifact,
): Promise<void> {
  await expect(tabFor(page, artifact.id)).toHaveAttribute("aria-selected", "true");
  const selectedPage = page.locator(`.stage .page[data-page-key="${artifact.id}"]`);
  await expect(selectedPage).toHaveAttribute("selected", "");
  await expect(selectedPage.locator(".artifact-title")).toHaveText(artifact.title);
  await expect(page.locator(".stage .page[selected]")).toHaveCount(1);
}

async function dragTabBefore(
  page: Page,
  draggedArtifactID: string,
  beforeArtifactID: string,
): Promise<void> {
  const dragged = tabFor(page, draggedArtifactID);
  const before = tabFor(page, beforeArtifactID);
  const [draggedBox, beforeBox] = await Promise.all([
    dragged.boundingBox(),
    before.boundingBox(),
  ]);
  if (!draggedBox || !beforeBox) throw new Error("Expected both drag tabs to have boxes");

  const origin = {
    x: Math.floor(draggedBox.x + draggedBox.width / 2),
    y: Math.floor(draggedBox.y + draggedBox.height / 2),
  };
  let pointerDown = false;
  try {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    pointerDown = true;
    await page.mouse.move(origin.x + 6, origin.y);
    await page.mouse.move(Math.floor(beforeBox.x - 4), origin.y);
    await page.mouse.up();
    pointerDown = false;
  } finally {
    if (pointerDown) await page.mouse.up();
  }
}

async function resizeSelectedPageRight(page: Page, travel: number): Promise<void> {
  const handle = page.locator(".stage .page[selected] .page-handle.right");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Expected the selected page's right resize handle");
  const origin = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  let pointerDown = false;
  try {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    pointerDown = true;
    await page.mouse.move(origin.x + travel, origin.y);
    await page.mouse.up();
    pointerDown = false;
  } finally {
    if (pointerDown) await page.mouse.up();
  }
}

async function settleInput(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function readChannelState(client: TelevisionClient, channelID: string) {
  const [{ channel }, { artifacts }] = await Promise.all([
    client.channels.get({ channelID }),
    client.artifacts.list({ channelID }),
  ]);
  return {
    pages: channel.layout.map(({ artifactIds }) => [...artifactIds]),
    artifacts: artifacts
      .map(({ id, title }) => ({ id, title }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function contentManagementWrite(request: Request): string | null {
  if (request.method() === "GET") return null;
  const { pathname } = new URL(request.url());
  return pathname === "/artifacts" || pathname.startsWith("/artifacts/") ||
      pathname === "/channels" || pathname.startsWith("/channels/")
    ? `${request.method()} ${pathname}`
    : null;
}

// Product acceptance for specs/product/tab-pages.md: one real browser drives
// the permanent production root against a really-running server. Channels and
// artifacts are fixtures created through TelevisionClient, and every create,
// retitle, remove, focus, and channel-focus action under test crosses the same
// production HTTP and websocket boundaries. The standing CSS-motion override
// forfeits only CSS motion, which none of these assertions claims.
test.describe("local tab-page product outcomes", () => {
  test("artifact creation appends a page and retitling updates its tab label", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channel = await seedChannel(client, product, "Creation channel", [
        "Existing one",
        "Existing two",
      ]);
      await client.display.patch({ focusedChannelId: channel.id });
      await openApp(page, product, baseURL);
      await expectTabs(page, channel.artifacts);
      await expectSelectedPage(page, channel.artifacts[0]!);

      const createdPath = createArtifactFile(
        product.home,
        "created-without-focus",
        "<!doctype html><h1>Created without focus</h1>",
        "html",
      );
      const { artifact: created } = await client.artifacts.create({
        channelID: channel.id,
        kind: "path",
        title: "Created without focus",
        path: createdPath,
      });
      const appended = { id: created.id, title: created.title };
      await expectTabs(page, [...channel.artifacts, appended]);
      await expectSelectedPage(page, channel.artifacts[0]!);
      await expect(page.locator(`.stage .page[data-page-key="${created.id}"]`)).toHaveCount(1);
      await expect.poll(async () =>
        (await client.channels.get({ channelID: channel.id })).channel.layout.at(-1)
          ?.artifactIds
      ).toEqual([created.id]);

      await client.artifacts.update({
        artifactID: created.id,
        title: "Retitled through production",
      });
      await expect(tabFor(page, created.id)).toHaveText("Retitled through production");
      await expect(page.locator(`.stage .page[data-page-key="${created.id}"] .artifact-title`))
        .toHaveText("Retitled through production");
      await expectSelectedPage(page, channel.artifacts[0]!);
    } finally {
      await product.dispose();
    }
  });

  test("selection survives a channel return while unseen channels and reload choose first", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const first = await seedChannel(client, product, "Memory first", [
        "First page",
        "Remembered page",
      ]);
      const second = await seedChannel(client, product, "Memory unseen", [
        "Unseen first page",
        "Unseen second page",
      ]);
      await client.display.patch({
        focusedChannelId: first.id,
        pinnedChannelIds: [first.id, second.id],
      });
      await openApp(page, product, baseURL);
      await expectSelectedPage(page, first.artifacts[0]!);

      await tabFor(page, first.artifacts[1]!.id).click();
      await expectSelectedPage(page, first.artifacts[1]!);

      await pickChannelByName(page, second.name);
      await expectSelectedPage(page, second.artifacts[0]!);

      await pickChannelByName(page, first.name);
      await expectSelectedPage(page, first.artifacts[1]!);

      await page.reload();
      await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
      await configureTestMotion(page);
      await expectSelectedPage(page, first.artifacts[0]!);
    } finally {
      await product.dispose();
    }
  });

  test("selected-page removal falls forward, then backward, then to no selection", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channel = await seedChannel(client, product, "Removal channel", [
        "Removal first",
        "Removal middle",
        "Removal last",
      ]);
      await client.display.patch({ focusedChannelId: channel.id });
      await openApp(page, product, baseURL);

      await tabFor(page, channel.artifacts[1]!.id).click();
      await expectSelectedPage(page, channel.artifacts[1]!);

      await client.artifacts.delete({ artifactID: channel.artifacts[1]!.id });
      await expectTabs(page, [channel.artifacts[0]!, channel.artifacts[2]!]);
      await expectSelectedPage(page, channel.artifacts[2]!);

      await client.artifacts.delete({ artifactID: channel.artifacts[2]!.id });
      await expectTabs(page, [channel.artifacts[0]!]);
      await expectSelectedPage(page, channel.artifacts[0]!);

      await client.artifacts.delete({ artifactID: channel.artifacts[0]!.id });
      await expectTabs(page, []);
      await expect(page.locator(".top-bar .tab[aria-selected='true']")).toHaveCount(0);
      await expect(page.locator(".stage .page[selected]")).toHaveCount(0);
      await expect(page.locator(".stage-empty")).toContainText("No artifacts yet");
      await expect.poll(async () =>
        (await client.channels.get({ channelID: channel.id })).channel.layout
      ).toEqual([]);
    } finally {
      await product.dispose();
    }
  });

  test("artifact focus selects its page and switches channel when needed", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const first = await seedChannel(client, product, "Focus first", [
        "Focus first page",
        "Focus same-channel target",
      ]);
      const second = await seedChannel(client, product, "Focus second", [
        "Focus second first",
        "Focus cross-channel target",
      ]);
      await client.display.patch({
        focusedChannelId: first.id,
        pinnedChannelIds: [first.id, second.id],
      });
      await openApp(page, product, baseURL);
      await expectSelectedPage(page, first.artifacts[0]!);

      await client.display.focus({ artifactID: first.artifacts[1]!.id });
      await expectSelectedPage(page, first.artifacts[1]!);
      await expect(page.getByRole("option", { name: first.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");

      await client.display.focus({ artifactID: second.artifacts[1]!.id });
      await expect(page.getByRole("option", { name: second.name, exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expectSelectedPage(page, second.artifacts[1]!);
    } finally {
      await product.dispose();
    }
  });

  test("Delete and Backspace on a focused tab perform no content operation", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channel = await seedChannel(client, product, "Keyboard channel", [
        "Protected first",
        "Protected second",
      ]);
      await client.display.patch({ focusedChannelId: channel.id });
      await openApp(page, product, baseURL);
      await expectTabs(page, channel.artifacts);
      await expectSelectedPage(page, channel.artifacts[0]!);

      const selectedTab = tabFor(page, channel.artifacts[0]!.id);
      await selectedTab.focus();
      await expect(selectedTab).toBeFocused();
      const before = await readChannelState(client, channel.id);
      const writes: string[] = [];
      page.on("request", (request) => {
        const write = contentManagementWrite(request);
        if (write !== null) writes.push(write);
      });

      await page.keyboard.press("Delete");
      await settleInput(page);
      await page.keyboard.press("Backspace");
      await settleInput(page);

      expect(writes).toEqual([]);
      expect(await readChannelState(client, channel.id)).toEqual(before);
      await expectTabs(page, channel.artifacts);
      await expectSelectedPage(page, channel.artifacts[0]!);
      await expect(selectedTab).toBeFocused();
    } finally {
      await product.dispose();
    }
  });
});

// Shared product acceptance for specs/product/tab-pages.md: two connected
// production application documents consume one really-running server. Setup
// and mutations cross TelevisionClient's real HTTP and websocket boundaries;
// the tab reorder uses real pointer input. The standing CSS-motion override
// forfeits only CSS motion, which this final-state walk does not claim.
test.describe("shared tab-page product outcomes", () => {
  test("resizing a page with real pointer input is observed by another connected client", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const observer = await page.context().newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channel = await seedChannel(client, product, "Shared page resize", [
        "Resizable first",
        "Unchanged second",
      ]);
      await client.display.patch({ focusedChannelId: channel.id });
      await Promise.all([
        openApp(page, product, baseURL),
        openApp(observer, product, baseURL),
      ]);
      await Promise.all([
        expectSelectedPage(page, channel.artifacts[0]!),
        expectSelectedPage(observer, channel.artifacts[0]!),
      ]);

      const beforeLayout = (await client.channels.get({ channelID: channel.id })).channel.layout;
      const beforePrimaryWidth = (await page.locator(".page[selected]").boundingBox())?.width;
      const beforeObserverWidth = (await observer.locator(".page[selected]").boundingBox())?.width;
      if (beforePrimaryWidth === undefined || beforeObserverWidth === undefined) {
        throw new Error("Expected both selected page boxes");
      }

      await resizeSelectedPageRight(page, 32);
      await expect.poll(async () =>
        (await client.channels.get({ channelID: channel.id })).channel.layout[0]!.size.width
      ).toBeGreaterThan(beforeLayout[0]!.size.width);
      const afterLayout = (await client.channels.get({ channelID: channel.id })).channel.layout;

      expect(afterLayout[0]!.size.height).toBe(beforeLayout[0]!.size.height);
      expect(afterLayout[1]!.size).toEqual(beforeLayout[1]!.size);
      await expect.poll(async () =>
        (await observer.locator(".page[selected]").boundingBox())?.width ?? 0
      ).toBeGreaterThan(beforeObserverWidth + 60);
      await expect.poll(async () => {
        const [primaryBox, observerBox] = await Promise.all([
          page.locator(".page[selected]").boundingBox(),
          observer.locator(".page[selected]").boundingBox(),
        ]);
        return Math.abs((primaryBox?.width ?? 0) - (observerBox?.width ?? 0));
      }).toBeLessThan(1);
    } finally {
      await observer.close();
      await product.dispose();
    }
  });

  test("converges creation, retitle, focus, and drag order while tab selection stays local", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const observer = await page.context().newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      const primary = await seedChannel(client, product, "Shared page mutations", [
        "Shared first",
        "Shared second",
      ]);
      const focusTarget = await seedChannel(client, product, "Shared focus target", [
        "Focus target first",
        "Focus target common",
      ]);
      await client.display.patch({ focusedChannelId: primary.id });
      await Promise.all([
        openApp(page, product, baseURL),
        openApp(observer, product, baseURL),
      ]);
      await Promise.all([
        expectSelectedPage(page, primary.artifacts[0]!),
        expectSelectedPage(observer, primary.artifacts[0]!),
      ]);

      const createdPath = createArtifactFile(
        product.home,
        "shared-created-without-focus",
        "<!doctype html><h1>Shared creation</h1>",
        "html",
      );
      const { artifact: createdArtifact } = await client.artifacts.create({
        channelID: primary.id,
        kind: "path",
        title: "Shared created",
        path: createdPath,
      });
      const created = { id: createdArtifact.id, title: createdArtifact.title };
      const appended = [...primary.artifacts, created];
      await Promise.all([
        expectTabs(page, appended),
        expectPageOrder(page, appended),
        expectTabs(observer, appended),
        expectPageOrder(observer, appended),
      ]);
      await Promise.all([
        expectSelectedPage(page, primary.artifacts[0]!),
        expectSelectedPage(observer, primary.artifacts[0]!),
      ]);

      await client.artifacts.update({
        artifactID: created.id,
        title: "Shared retitled",
      });
      const retitled = { ...created, title: "Shared retitled" };
      const retitledOrder = [...primary.artifacts, retitled];
      await Promise.all([
        expectTabs(page, retitledOrder),
        expectTabs(observer, retitledOrder),
      ]);

      await dragTabBefore(page, retitled.id, primary.artifacts[0]!.id);
      const reordered = [retitled, ...primary.artifacts];
      await Promise.all([
        expectTabs(page, reordered),
        expectPageOrder(page, reordered),
        expectTabs(observer, reordered),
        expectPageOrder(observer, reordered),
      ]);
      await expect.poll(async () =>
        (await client.channels.get({ channelID: primary.id })).channel.layout.map(
          ({ artifactIds }) => artifactIds,
        )
      ).toEqual(reordered.map(({ id }) => [id]));

      const commonPage = focusTarget.artifacts[1]!;
      await client.display.focus({ artifactID: commonPage.id });
      await Promise.all([
        expect(page.getByRole("option", { name: focusTarget.name, exact: true }))
          .toHaveAttribute("aria-selected", "true"),
        expect(observer.getByRole("option", { name: focusTarget.name, exact: true }))
          .toHaveAttribute("aria-selected", "true"),
        expectSelectedPage(page, commonPage),
        expectSelectedPage(observer, commonPage),
      ]);

      await tabFor(page, focusTarget.artifacts[0]!.id).click();
      await expectSelectedPage(page, focusTarget.artifacts[0]!);

      // A later shared event must render in the peer before the invariance reads.
      const selectionBarrier = { ...commonPage, title: "Focus target barrier" };
      await client.artifacts.update({
        artifactID: selectionBarrier.id,
        title: selectionBarrier.title,
      });
      await expect(tabFor(observer, selectionBarrier.id)).toHaveText(selectionBarrier.title);

      await expectSelectedPage(observer, selectionBarrier);
      expect((await client.display.get()).focusedChannelId).toBe(focusTarget.id);
      expect(
        (await client.channels.get({ channelID: focusTarget.id })).channel.layout.map(
          ({ artifactIds }) => artifactIds,
        ),
      ).toEqual(focusTarget.artifacts.map(({ id }) => [id]));
    } finally {
      await observer.close();
      await product.dispose();
    }
  });
});
