import { type Page } from "@playwright/test";
import { TelevisionClient, type TabPage } from "@telepath-computer/television-shared";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion, createArtifactFile, pickChannelByName } from "./helpers.ts";

// Product acceptance for moving an artifact to another channel
// (specs/product/artifacts.md#^af-move; proofs/product/artifacts.md#^af-ac-move).
// Two application documents drive the production root against a really-running
// server. Channels, artifacts, the store value, and the share link are fixtures
// created through the production API, and the move crosses the production move
// route. The store is read by the artifact's ID through the production resource
// API; a page reading its own store by that ID is the resources page acceptance's. The standing CSS-motion override forfeits only CSS motion, which this
// acceptance does not claim.

function appIndexURL(appURL: string, token: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  url.searchParams.set("token", token);
  return url.toString();
}

async function openApp(page: Page, product: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  await page.goto(appIndexURL(await product.appURL(baseURL), product.token));
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
}

const MOVED_PAGE = "<!doctype html><title>Moved note</title><h1 id=\"heading\">Moved note</h1>";

function pageFor(page: Page, artifactID: string) {
  return page.locator(`.stage .page[data-page-key="${artifactID}"]`);
}

async function pageKeys(page: Page): Promise<string[]> {
  return page.locator(".stage .page").evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.pageKey ?? ""));
}

/** The width the stage sets on a page; background pages also carry a scale transform, which this excludes. */
async function renderedWidth(page: Page, artifactID: string): Promise<number> {
  return pageFor(page, artifactID).evaluate((element) => parseFloat((element as HTMLElement).style.width));
}

test("a moved artifact leaves its channel in both clients and opens last on the new one with its size, store, and share link", async ({
  page,
  baseURL,
}) => {
  // Share links need the server's token, so this server requires one.
  const product = await launchProductServer({ auth: true });
  const observer = await page.context().newPage();
  try {
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const { channel: source } = await client.channels.create({ name: "Move source" });
    const { channel: target } = await client.channels.create({ name: "Move target" });
    const create = async (channelID: string, title: string, html: string) => (await client.artifacts.create({
      channelID,
      kind: "path",
      title,
      path: createArtifactFile(product.home, `${channelID}-${title.replaceAll(" ", "-")}`, html, "html"),
    })).artifact;
    const moved = await create(source.id, "Moved note", MOVED_PAGE);
    const remaining = await create(source.id, "Stays behind", "<!doctype html><title>Stays</title><h1>Stays</h1>");
    const existing = await create(target.id, "Already there", "<!doctype html><title>There</title><h1>There</h1>");

    // The moved page carries a non-default size, so its new page must keep it.
    const movedSize = { width: 500, height: 600 };
    const sourceLayout = (await client.channels.get({ channelID: source.id })).channel.layout;
    await client.channels.update({
      channelID: source.id,
      layout: sourceLayout.map((tabPage): TabPage =>
        tabPage.artifactIds[0] === moved.id ? { ...tabPage, size: movedSize } : tabPage),
    });
    const existingSize = (await client.channels.get({ channelID: target.id })).channel.layout[0]!.size;
    await client.resources.json.set({ store: { artifactID: moved.id }, path: "note", value: "kept through the move" });
    const share = await client.resources.share({ artifactID: moved.id });

    await client.display.patch({ focusedChannelId: source.id });
    await Promise.all([openApp(page, product, baseURL), openApp(observer, product, baseURL)]);
    for (const document of [page, observer]) {
      await expect(pageFor(document, moved.id)).toHaveAttribute("selected", "");
    }

    const result = await client.artifacts.move({ artifactID: moved.id, channelID: target.id });
    expect(result).toEqual({ outcome: "moved", artifactID: moved.id, channelID: target.id });

    for (const document of [page, observer]) {
      await expect.poll(() => pageKeys(document)).toEqual([remaining.id]);
      await expect(pageFor(document, remaining.id)).toHaveAttribute("selected", "");
      await expect(document.locator(".top-bar .tab-strip > .tab")).toHaveCount(1);
    }

    for (const document of [page, observer]) {
      await pickChannelByName(document, "Move target");
      await expect.poll(() => pageKeys(document)).toEqual([existing.id, moved.id]);
      await expect(pageFor(document, moved.id)).not.toHaveAttribute("full-screen", "");
      // Every page scales by the same factor, so rendered widths keep the ratio
      // of the stored sizes.
      await expect.poll(async () =>
        (await renderedWidth(document, moved.id)) / (await renderedWidth(document, existing.id))
      ).toBeCloseTo(movedSize.width / existingSize.width, 2);
      await document.locator(`.top-bar .tab[data-artifact-id="${moved.id}"]`).click();
      const frame = pageFor(document, moved.id).locator("iframe.artifact-content").contentFrame();
      await expect(frame.locator("#heading")).toHaveText("Moved note");
    }

    // A page reaches its store by its artifact ID, which the move keeps.
    expect((await client.artifacts.get({ artifactID: moved.id })).artifact.id).toBe(moved.id);
    expect(await client.resources.json.get({ store: { artifactID: moved.id }, path: "note" }))
      .toEqual({ exists: true, value: "kept through the move" });
    const shared = await fetch(new URL(share.path, product.serverURL));
    expect(shared.status).toBe(200);
    expect(await shared.text()).toContain("Moved note");
  } finally {
    await observer.close();
    await product.dispose();
  }
});
