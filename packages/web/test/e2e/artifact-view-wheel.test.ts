import { expect, test } from "../../../../test/helpers/playwright.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TelevisionClient } from "@telepath-computer/television-shared";
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
import type { Page } from "@playwright/test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

interface SeededArtifact {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

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
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
}

async function focusedChannelID(client: TelevisionClient): Promise<string> {
  const display = await client.display.get();
  if (display.focusedChannelId) return display.focusedChannelId;
  const channels = (await client.channels.list()).channels;
  if (channels[0]) {
    await client.display.patch({ focusedChannelId: channels[0].id });
    return channels[0].id;
  }
  const { channel } = await client.channels.create({ name: "Frame outcomes" });
  await client.display.patch({ focusedChannelId: channel.id });
  return channel.id;
}

async function createPathArtifact(
  client: TelevisionClient,
  channelID: string,
  title: string,
  artifactPath: string,
): Promise<SeededArtifact> {
  const { artifact } = await client.artifacts.create({
    channelID,
    kind: "path",
    title,
    path: artifactPath,
  });
  return { id: artifact.id, title: artifact.title, path: artifactPath };
}

async function createURLArtifact(
  client: TelevisionClient,
  channelID: string,
  title: string,
  url: string,
): Promise<Pick<SeededArtifact, "id" | "title">> {
  const { artifact } = await client.artifacts.create({
    channelID,
    kind: "url",
    title,
    url,
  });
  return { id: artifact.id, title: artifact.title };
}

function tabFor(page: Page, artifactID: string) {
  return page.locator(`.tab-strip > .tab[data-artifact-id="${artifactID}"]`);
}

function pageFor(page: Page, artifactID: string) {
  return page.locator(`.stage .page[data-page-key="${artifactID}"]`);
}

function frameFor(page: Page, artifactID: string) {
  return page.frameLocator(
    `.stage .page[data-page-key="${artifactID}"] .artifact-view iframe`,
  );
}

async function selectArtifact(page: Page, artifactID: string): Promise<void> {
  const tab = tabFor(page, artifactID);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(pageFor(page, artifactID)).toHaveAttribute("selected", "");
}

async function documentScrollTop(page: Page, artifactID: string): Promise<number> {
  return frameFor(page, artifactID).locator("html").evaluate(() => {
    const offsets: number[] = [document.scrollingElement?.scrollTop ?? 0];
    const visit = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll<HTMLElement>("*")) {
        offsets.push(element.scrollTop);
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    return Math.max(...offsets);
  });
}

async function scrollDocumentWithWheel(
  page: Page,
  artifactID: string,
): Promise<void> {
  const frame = frameFor(page, artifactID);
  await expect(frame.locator("body")).toBeVisible();
  await frame.locator("body").hover({ position: { x: 80, y: 80 } });
  const before = await documentScrollTop(page, artifactID);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => documentScrollTop(page, artifactID)).toBeGreaterThan(before);
}

// Product acceptance for specs/product/artifacts.md. Every case drives
// the permanent application in a real browser against a really-running server.
// Authored documents are fixtures created through the production API. The
// standing CSS-motion override forfeits only motion, which no case claims.
test.describe("artifact frame browser product outcomes", () => {
  test("keeps the visible and accessible artifact names equal while isolating shell and document styles (^af-ac-title, ^af-ac-isolation)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channelID = await focusedChannelID(client);
      const title = "Style-isolated artifact";
      const artifactPath = createArtifactFile(
        product.home,
        "style-isolation",
        `<!doctype html>
          <style>
            html, body { min-height: 100%; }
            body { background: var(--white, rgb(7, 11, 13)); }
            .artifact-view { border-width: 0 !important; border-radius: 0 !important; }
            .artifact-title { visibility: hidden !important; color: rgb(251, 1, 2) !important; }
          </style>
          <h1 id="document-title" class="artifact-title">Authored document</h1>`,
        "html",
      );
      const artifact = await createPathArtifact(
        client,
        channelID,
        title,
        artifactPath,
      );
      await openApp(page, product, baseURL);

      const frameView = pageFor(page, artifact.id).locator(".artifact-view");
      const visibleTitle = frameView.locator(".artifact-title");
      const iframe = frameView.locator("iframe");
      await expect(visibleTitle).toHaveText(title);
      await expect(visibleTitle).toBeVisible();
      await expect(iframe).toHaveAttribute("title", title);
      await expect(page.getByTitle(title)).toBeVisible();

      await expect(frameFor(page, artifact.id).locator("body")).toHaveCSS(
        "background-color",
        "rgb(7, 11, 13)",
      );
      const shellStyle = await frameView.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        documentWidth: element.querySelector("iframe")!.getBoundingClientRect().width,
        radius: getComputedStyle(element).borderRadius,
        titleVisibility: getComputedStyle(
          element.querySelector<HTMLElement>(".artifact-title")!,
        ).visibility,
      }));
      expect(shellStyle.width).toBeGreaterThan(0);
      expect(shellStyle.documentWidth).toBeCloseTo(shellStyle.width, 0);
      expect(shellStyle.radius).not.toBe("0px");
      expect(shellStyle.titleVisibility).toBe("visible");
    } finally {
      await product.dispose();
    }
  });

  test("frame menu deletion cancels safely then removes the artifact, tab, and page without deleting its file (^af-ac-delete)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channelID = await focusedChannelID(client);
      const artifacts: SeededArtifact[] = [];
      for (let index = 0; index < 3; index += 1) {
        const artifactPath = createArtifactFile(
          product.home,
          `delete-fixture-${index}`,
          `<!doctype html><h1>Delete fixture ${index}</h1>`,
          "html",
        );
        artifacts.push(await createPathArtifact(
          client,
          channelID,
          `Delete fixture ${index}`,
          artifactPath,
        ));
      }
      const target = artifacts[0]!;
      await openApp(page, product, baseURL);
      await expect(page.locator(".tab-strip > .tab")).toHaveCount(3);
      await expect(page.locator(".stage .page")).toHaveCount(3);
      await expect(page.locator(".stage .artifact-view")).toHaveCount(3);

      const menuTrigger = page.getByRole("button", {
        name: `${target.title} menu`,
        exact: true,
      });
      await menuTrigger.click();
      await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Delete$/ }).click();
      const alert = page.getByRole("alertdialog").filter({ hasText: target.title });
      const cancel = alert.getByRole("button", { name: "Cancel", exact: true });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(`Delete “${target.title}”?`);
      await expect(cancel).toBeFocused();
      await cancel.click();
      await expect(alert).toHaveCount(0);

      expect(existsSync(target.path)).toBe(true);
      expect((await client.artifacts.list({ channelID })).artifacts.map(({ id }) => id))
        .toContain(target.id);
      expect((await client.channels.get({ channelID })).channel.layout
        .some(({ artifactIds }) => artifactIds.includes(target.id))).toBe(true);
      await expect(tabFor(page, target.id)).toHaveCount(1);
      await expect(pageFor(page, target.id)).toHaveCount(1);
      await expect(pageFor(page, target.id).locator(".artifact-view")).toHaveCount(1);

      await menuTrigger.click();
      await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Delete$/ }).click();
      await page.getByRole("alertdialog").filter({ hasText: target.title })
        .getByRole("button", { name: "Delete", exact: true })
        .click();

      await expect(tabFor(page, target.id)).toHaveCount(0);
      await expect(pageFor(page, target.id)).toHaveCount(0);
      await expect(page.locator(".tab-strip > .tab")).toHaveCount(2);
      await expect(page.locator(".stage .page")).toHaveCount(2);
      await expect(page.locator(".stage .artifact-view")).toHaveCount(2);
      await expect.poll(async () =>
        (await client.artifacts.list({ channelID })).artifacts.map(({ id }) => id)
      ).not.toContain(target.id);
      expect((await client.channels.get({ channelID })).channel.layout
        .some(({ artifactIds }) => artifactIds.includes(target.id))).toBe(false);
      expect(existsSync(target.path)).toBe(true);
    } finally {
      await product.dispose();
    }
  });

  test("keeps raw image and CSP-blocked documents natively interactive without bridge readiness (^af-ac-native)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channelID = await focusedChannelID(client);

      const nativeSourceDirectory = path.join(
        product.home,
        "native-document-sources",
      );
      mkdirSync(nativeSourceDirectory, { recursive: true });
      writeFileSync(
        path.join(nativeSourceDirectory, "index.html"),
        "<!doctype html><h1>Native document sources</h1>",
        "utf8",
      );
      copyFileSync(
        path.join(REPO_ROOT, "packages/desktop/assets/icon.png"),
        path.join(nativeSourceDirectory, "oversized.png"),
      );
      writeFileSync(
        path.join(nativeSourceDirectory, "csp.html"),
        `<!doctype html>
          <meta http-equiv="Content-Security-Policy" content="script-src 'self'">
          <button id="native-action">Use native document</button>
          <output id="native-result">ready</output>
          <script src="interaction.js"></script>`,
        "utf8",
      );
      writeFileSync(
        path.join(nativeSourceDirectory, "interaction.js"),
        `document.querySelector('#native-action').addEventListener('click', () => {
          document.querySelector('#native-result').textContent = 'clicked';
        });`,
        "utf8",
      );
      const { channel: sourceChannel } = await client.channels.create({
        name: "Native document sources",
      });
      const source = await createPathArtifact(
        client,
        sourceChannel.id,
        "Native document source bundle",
        nativeSourceDirectory,
      );
      const sourceURL = `${product.serverURL}/artifact/${source.id}`;
      const image = await createURLArtifact(
        client,
        channelID,
        "Oversized raw image",
        `${sourceURL}/oversized.png`,
      );
      const csp = await createURLArtifact(
        client,
        channelID,
        "CSP external interaction",
        `${sourceURL}/csp.html`,
      );
      await openApp(page, product, baseURL);

      await expect(frameFor(page, image.id).locator("img")).toBeVisible();
      const imageExtent = await frameFor(page, image.id).locator("html").evaluate(() => ({
        clientHeight: document.scrollingElement?.clientHeight ?? 0,
        scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
      }));
      if (imageExtent.scrollHeight <= imageExtent.clientHeight) {
        await frameFor(page, image.id).locator("img").click({
          position: { x: 100, y: 100 },
        });
      }
      await scrollDocumentWithWheel(page, image.id);

      await selectArtifact(page, csp.id);
      const cspFrame = frameFor(page, csp.id);
      await expect(cspFrame.locator("#native-result")).toHaveText("ready");
      expect(await cspFrame.locator("html").evaluate(() =>
        (window as Window & { __televisionArtifactBridgeInstalled?: boolean })
          .__televisionArtifactBridgeInstalled ?? false
      )).toBe(false);
      await cspFrame.locator("#native-action").click();
      await expect(cspFrame.locator("#native-result")).toHaveText("clicked");
    } finally {
      await product.dispose();
    }
  });

  test("preserves typed, scrolled, and running iframe state through a tab switch without another load (^af-ac-tab-continuity)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channelID = await focusedChannelID(client);
      const firstPath = createArtifactFile(
        product.home,
        "continuity-first",
        `<!doctype html>
          <input id="continuity-input" value="">
          <output id="continuity-counter">0</output>
          <div style="height: 2600px"></div>
          <p id="continuity-end">End</p>
          <script>
            window.__continuityCounter = 0;
            window.setInterval(() => {
              window.__continuityCounter += 1;
              document.querySelector('#continuity-counter').textContent =
                String(window.__continuityCounter);
            }, 16);
          </script>`,
        "html",
      );
      const secondPath = createArtifactFile(
        product.home,
        "continuity-second",
        "<!doctype html><h1>Second live document</h1>",
        "html",
      );
      const first = await createPathArtifact(
        client,
        channelID,
        "Continuity first",
        firstPath,
      );
      const second = await createPathArtifact(
        client,
        channelID,
        "Continuity second",
        secondPath,
      );
      let firstDocumentLoads = 0;
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          request.method() === "GET" &&
          url.pathname.startsWith(`/artifact/${first.id}/`)
        ) {
          firstDocumentLoads += 1;
        }
      });
      await openApp(page, product, baseURL);

      const firstFrameElement = pageFor(page, first.id).locator(".artifact-view iframe");
      await expect(firstFrameElement).toBeVisible();
      const originalFrameHandle = await firstFrameElement.elementHandle();
      if (!originalFrameHandle) throw new Error("Expected first iframe element");
      const firstFrame = frameFor(page, first.id);
      const input = firstFrame.locator("#continuity-input");
      await input.fill("work survives tab selection");
      await firstFrame.locator("body").hover({ position: { x: 80, y: 80 } });
      await page.mouse.wheel(0, 700);
      await expect.poll(() => documentScrollTop(page, first.id)).toBeGreaterThan(0);
      const scrollBeforeSwitch = await documentScrollTop(page, first.id);
      await expect.poll(() => firstFrame.locator("#continuity-counter").evaluate((element) =>
        Number(element.textContent)
      )).toBeGreaterThan(0);
      const counterBeforeSwitch = await firstFrame.locator("#continuity-counter")
        .evaluate((element) => Number(element.textContent));
      expect(firstDocumentLoads).toBe(1);

      await selectArtifact(page, second.id);
      await expect(frameFor(page, second.id).locator("h1")).toHaveText(
        "Second live document",
      );
      await expect(firstFrameElement).toBeAttached();
      await expect.poll(() => firstFrame.locator("#continuity-counter").evaluate((element) =>
        Number(element.textContent)
      )).toBeGreaterThan(counterBeforeSwitch);

      await selectArtifact(page, first.id);
      const returnedFrameHandle = await firstFrameElement.elementHandle();
      if (!returnedFrameHandle) throw new Error("Expected returned iframe element");
      expect(await originalFrameHandle.evaluate(
        (element, returned) => element === returned,
        returnedFrameHandle,
      )).toBe(true);
      await expect(input).toHaveValue("work survives tab selection");
      expect(await documentScrollTop(page, first.id)).toBe(scrollBeforeSwitch);
      expect(await firstFrame.locator("#continuity-counter").evaluate((element) =>
        Number(element.textContent)
      )).toBeGreaterThan(counterBeforeSwitch);
      expect(firstDocumentLoads).toBe(1);
    } finally {
      await product.dispose();
    }
  });

  test("delivers missing-path metadata through the bundled browser document (^ab-ac-missing-browser-seam)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const channelID = await focusedChannelID(client);
      const missingPath = createArtifactFile(
        product.home,
        "missing-frame-document",
        "<!doctype html><h1>Temporary frame document</h1>",
        "html",
      );
      const artifact = await createPathArtifact(
        client,
        channelID,
        "Missing frame document",
        missingPath,
      );
      unlinkSync(missingPath);
      await openApp(page, product, baseURL);

      const frame = frameFor(page, artifact.id);
      await expect(frame.locator("h1")).toHaveText("Artifact file not found");
      await expect(frame.locator("#missing-path")).toHaveText(
        missingPath,
      );
      await expect.poll(() => frame.locator("html").evaluate(() => document.title))
        .toBe(artifact.title);
    } finally {
      await product.dispose();
    }
  });
});
