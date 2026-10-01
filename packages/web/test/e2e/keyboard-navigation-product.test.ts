import { expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer as createHTTPServer, type Server as HTTPServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TelevisionClient } from "@telepath-computer/television-shared";
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

type NavigationArrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

interface SeededArtifact {
  readonly id: string;
  readonly title: string;
}

interface SeededChannel {
  readonly id: string;
  readonly name: string;
  readonly artifacts: readonly SeededArtifact[];
}

interface PreservedInputState {
  readonly value: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: "forward" | "backward" | "none" | null;
  readonly connected: boolean;
}

interface NativeDocumentServer {
  readonly origin: string;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __key2PreservedInput?: HTMLInputElement;
  }
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
  options: { authoredMotion?: boolean } = {},
): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appURL = await product.appURL(baseURL);
  await page.goto(appIndexURL(appURL));
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  if (!options.authoredMotion) await configureTestMotion(page);
  const state = await page.locator("#app").getAttribute("data-app-state");
  expect(["connected", "empty-channel"]).toContain(state);
  await expect(page.locator(".top-bar .tab-strip")).toBeVisible();
}

async function clearChannels(client: TelevisionClient): Promise<void> {
  const { channels } = await client.channels.list();
  for (const channel of channels) {
    await client.channels.remove({ channelID: channel.id });
  }
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
      `<!doctype html><title>${title}</title><h1>${title}</h1>`,
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

async function seedNavigationChannel(
  client: TelevisionClient,
  product: ProductServer,
  name: string,
): Promise<SeededChannel> {
  const { channel } = await client.channels.create({ name });
  const artifacts: SeededArtifact[] = [];
  for (const index of [1, 2, 3]) {
    const title = `Navigation artifact ${index}`;
    const artifactPath = createArtifactFile(
      product.home,
      `${channel.id}-navigation-${index}`,
      `<!doctype html><title>${title}</title><body data-navigation-artifact="pending"><button id="artifact-focus">Focus ${title}</button><script>document.body.dataset.navigationArtifact = new URL(location.href).pathname.split('/')[2] ?? '';</script></body>`,
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

function tabFor(page: Page, artifactID: string): Locator {
  return page.locator(`.top-bar .tab[data-artifact-id="${artifactID}"]`);
}

async function expectSelectedPage(page: Page, artifactID: string): Promise<void> {
  await expect(tabFor(page, artifactID)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`.stage .page[data-page-key="${artifactID}"]`))
    .toHaveAttribute("selected", "");
}

async function expectReachedArtifactDocument(page: Page, artifactID: string): Promise<void> {
  const selector = `.stage .page[data-page-key="${artifactID}"][selected] .artifact-view`;
  const selectedView = page.locator(selector);
  await expect(selectedView).toHaveAttribute("data-embed-loaded", "");
  await expect(selectedView.frameLocator("iframe.artifact-content").locator("body"))
    .toHaveAttribute("data-navigation-artifact", artifactID);
  await expect.poll(() => page.locator(selector).evaluate((view) => (
    (view as unknown as { _trustedChannel?: { currentGuid?: string | null } })
      ._trustedChannel?.currentGuid ?? null
  ))).not.toBeNull();
}

function channelButton(page: Page, channelName: string): Locator {
  return page.getByRole("option", { name: channelName, exact: true });
}

async function expectFocusedChannel(page: Page, channelName: string): Promise<void> {
  await expect(channelButton(page, channelName)).toHaveAttribute("aria-selected", "true");
}

async function navigationChord(page: Page, arrow: NavigationArrow): Promise<void> {
  const platform = await page.evaluate(() => navigator.platform);
  if (platform.length === 0) throw new Error("Browser exposed no platform identity");
  const modifier = /^(Mac|iPhone|iPad|iPod)/i.test(platform) ? "Alt" : "Control";
  await page.keyboard.press(`${modifier}+${arrow}`);
}

async function beginRename(page: Page, channelName: string): Promise<Locator> {
  await page.getByTitle(`${channelName} menu`, { exact: true }).click();
  await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Rename$/ }).click();
  const input = page.getByRole("textbox", { name: "Channel name", exact: true });
  await expect(input).toBeFocused();
  return input;
}

async function preserveInput(input: Locator): Promise<PreservedInputState> {
  return input.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Rename field is not an input");
    element.setSelectionRange(1, 5, "forward");
    window.__key2PreservedInput = element;
    return readInput(element);

    function readInput(target: HTMLInputElement): PreservedInputState {
      return {
        value: target.value,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
        selectionDirection: target.selectionDirection,
        connected: target.isConnected,
      };
    }
  });
}

async function preservedInputState(page: Page): Promise<PreservedInputState> {
  return page.evaluate(() => {
    const input = window.__key2PreservedInput;
    if (!input) throw new Error("No preserved rename input");
    return {
      value: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      selectionDirection: input.selectionDirection,
      connected: input.isConnected,
    };
  });
}

function minimalPdf(): Buffer {
  const stream = "BT /F1 18 Tf 72 720 Td (Television keyboard dead zone) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

async function launchNativeDocumentServer(): Promise<NativeDocumentServer> {
  const image = readFileSync(path.join(REPO_ROOT, "packages/desktop/assets/icon.png"));
  const pdf = minimalPdf();
  const server = createHTTPServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname.endsWith("/raw.png")) {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": image.byteLength,
      });
      response.end(image);
      return;
    }
    if (pathname.endsWith("/focused.pdf")) {
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.byteLength,
      });
      response.end(pdf);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Native document server did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    dispose: () => closeHTTPServer(server),
  };
}

function closeHTTPServer(server: HTTPServer): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createDeadZoneArtifacts(
  client: TelevisionClient,
  product: ProductServer,
  channelID: string,
  nativeOrigin: string,
): Promise<readonly SeededArtifact[]> {
  const cspPath = createArtifactFile(
    product.home,
    "keyboard-dead-zone-csp",
    `<!doctype html>
      <meta http-equiv="Content-Security-Policy" content="script-src 'none'">
      <title>CSP dead zone</title>
      <input id="dead-zone-field" value="CSP-blocked document">`,
    "html",
  );
  const finalPath = createArtifactFile(
    product.home,
    "keyboard-dead-zone-positive",
    "<!doctype html><title>Positive target</title><h1>Positive target</h1>",
    "html",
  );
  const fixtureID = "01J00000000000000000000000";
  const fixtures = [
    {
      title: "Raw image dead zone",
      kind: "url" as const,
      url: `${nativeOrigin}/artifact/${fixtureID}/raw.png`,
    },
    {
      title: "PDF dead zone",
      kind: "url" as const,
      url: `${nativeOrigin}/artifact/${fixtureID}/focused.pdf`,
    },
    { title: "CSP dead zone", kind: "path" as const, path: cspPath },
    { title: "Positive target", kind: "path" as const, path: finalPath },
  ];

  const artifacts: SeededArtifact[] = [];
  for (const fixture of fixtures) {
    const { artifact } = await client.artifacts.create({
      channelID,
      ...fixture,
    });
    artifacts.push({ id: artifact.id, title: artifact.title });
  }
  return artifacts;
}

async function focusSelectedArtifactDocument(page: Page, kind: "image" | "pdf" | "csp"): Promise<void> {
  const frameSelector = ".stage .page[selected] .artifact-view iframe";
  await expect(page.locator(frameSelector)).toBeVisible();
  const frame = page.frameLocator(frameSelector);
  if (kind === "csp") {
    await frame.locator("#dead-zone-field").click();
    await expect(frame.locator("#dead-zone-field")).toBeFocused();
  } else {
    await frame.locator("body").click({ position: { x: 40, y: 40 } });
  }
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? null))
    .toBe("IFRAME");
}

// Product acceptance for specs/product/keyboard-navigation.md. These cases
// drive the real CI-host chord through the permanent application against a
// really-running built CLI server. Authored channels, pages, and documents are
// fixtures; no production mechanism is replaced.
test.describe("keyboard product walks", () => {
  test("moves between page ends from a focused chrome field without changing its text selection (^tp-ac-chord)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      await clearChannels(client);
      const channel = await seedChannel(client, product, "Horizontal movement", [
        "First page",
        "Middle page",
        "Last page",
      ]);
      await client.display.patch({ focusedChannelId: channel.id });
      await openApp(page, product, baseURL);
      await expectSelectedPage(page, channel.artifacts[0]!.id);

      let input = await beginRename(page, channel.name);
      const firstBoundary = await preserveInput(input);
      await navigationChord(page, "ArrowLeft");
      await expectSelectedPage(page, channel.artifacts[0]!.id);
      await expect(input).toBeFocused();
      expect(await preservedInputState(page)).toEqual(firstBoundary);

      await navigationChord(page, "ArrowRight");
      await expectSelectedPage(page, channel.artifacts[1]!.id);
      await expect(input).toHaveCount(0);
      expect(await preservedInputState(page)).toEqual({
        ...firstBoundary,
        connected: false,
      });
      await expect(page.locator("body")).toBeFocused();

      await tabFor(page, channel.artifacts[2]!.id).click();
      await expectSelectedPage(page, channel.artifacts[2]!.id);
      input = await beginRename(page, channel.name);
      const lastBoundary = await preserveInput(input);
      await navigationChord(page, "ArrowRight");
      await expectSelectedPage(page, channel.artifacts[2]!.id);
      await expect(input).toBeFocused();
      expect(await preservedInputState(page)).toEqual(lastBoundary);
    } finally {
      await product.dispose();
    }
  });

  test("continues repeated page traversal across artifact, focused tab, shell background, and sidebar focus (^tp-ac-chord-focus-continuity-browser, ^tp-ac-chord-focused-tab-browser)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      await clearChannels(client);
      const channel = await seedNavigationChannel(
        client,
        product,
        "Repeated navigation",
      );
      await client.display.patch({ focusedChannelId: channel.id });
      await openApp(page, product, baseURL);

      const [first, second, third] = channel.artifacts;
      if (!first || !second || !third) throw new Error("Expected three navigation artifacts");
      for (const artifact of channel.artifacts) {
        await expect(page.locator(
          `.stage .page[data-page-key="${artifact.id}"] .artifact-view`,
        )).toHaveAttribute("data-embed-loaded", "");
      }

      const expectSelectionAndDocument = async (artifact: SeededArtifact): Promise<void> => {
        await expectSelectedPage(page, artifact.id);
        await expectReachedArtifactDocument(page, artifact.id);
      };
      const traverseBothWays = async (): Promise<void> => {
        await navigationChord(page, "ArrowRight");
        await expectSelectionAndDocument(second);
        await expect(page.locator("body")).toBeFocused();
        await navigationChord(page, "ArrowRight");
        await expectSelectionAndDocument(third);
        await navigationChord(page, "ArrowLeft");
        await expectSelectionAndDocument(second);
        await navigationChord(page, "ArrowLeft");
        await expectSelectionAndDocument(first);
      };

      await expectSelectionAndDocument(first);
      const firstFrame = page.frameLocator(
        `.stage .page[data-page-key="${first.id}"] .artifact-view iframe.artifact-content`,
      );
      await firstFrame.locator("#artifact-focus").click();
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? null))
        .toBe("IFRAME");
      await traverseBothWays();

      const firstTab = tabFor(page, first.id);
      await firstTab.click();
      await expect(firstTab).toBeFocused();
      await traverseBothWays();

      const shellBackground = page.locator(".stage");
      await shellBackground.click({ position: { x: 4, y: 4 } });
      await traverseBothWays();

      const sidebarRegion = page.locator(".sidebar-titlebar");
      await sidebarRegion.click({ position: { x: 100, y: 18 } });
      await traverseBothWays();
    } finally {
      await product.dispose();
    }
  });

  test("walks pinned then newest unpinned channels and publishes each focus to a second client (^tp-ac-chord-vertical)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const observer = await page.context().newPage();
    try {
      const client = new TelevisionClient(product.serverURL);
      await clearChannels(client);
      const oldest = await seedChannel(client, product, "Unpinned oldest", []);
      const pinnedFirst = await seedChannel(client, product, "Pinned first", []);
      const newest = await seedChannel(client, product, "Unpinned newest", []);
      const pinnedSecond = await seedChannel(client, product, "Pinned second", []);
      const ordered = [pinnedFirst, pinnedSecond, newest, oldest] as const;
      await client.display.patch({
        focusedChannelId: pinnedFirst.id,
        pinnedChannelIds: [pinnedFirst.id, pinnedSecond.id],
      });

      await Promise.all([
        openApp(page, product, baseURL),
        openApp(observer, product, baseURL),
      ]);
      const renderedOrder = await page.locator(".channel-row").evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.channelId)
      );
      expect(renderedOrder).toEqual(ordered.map(({ id }) => id));
      await expectFocusedChannel(page, pinnedFirst.name);
      await expectFocusedChannel(observer, pinnedFirst.name);

      await channelButton(page, pinnedFirst.name).focus();
      await navigationChord(page, "ArrowUp");
      await expectFocusedChannel(page, pinnedFirst.name);
      await expectFocusedChannel(observer, pinnedFirst.name);
      await expect(channelButton(page, pinnedFirst.name)).toBeFocused();

      for (let index = 1; index < ordered.length; index += 1) {
        const current = ordered[index - 1]!;
        const target = ordered[index]!;
        await channelButton(page, current.name).focus();
        await navigationChord(page, "ArrowDown");
        await expectFocusedChannel(page, target.name);
        await expectFocusedChannel(observer, target.name);
        await expect.poll(async () => (await client.display.get()).focusedChannelId)
          .toBe(target.id);
      }

      await channelButton(page, oldest.name).focus();
      await navigationChord(page, "ArrowDown");
      await expectFocusedChannel(page, oldest.name);
      await expectFocusedChannel(observer, oldest.name);
      await expect(channelButton(page, oldest.name)).toBeFocused();
      expect((await client.display.get()).focusedChannelId).toBe(oldest.id);
    } finally {
      await observer.close();
      await product.dispose();
    }
  });

  test("keeps raw image, PDF, and CSP-blocked documents as browser dead zones until chrome focus returns (^tp-ac-chord-deadzone)", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    const nativeDocuments = await launchNativeDocumentServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      await clearChannels(client);
      const { channel: nextChannel } = await client.channels.create({ name: "After dead zones" });
      const { channel } = await client.channels.create({ name: "Dead zones" });
      const artifacts = await createDeadZoneArtifacts(
        client,
        product,
        channel.id,
        nativeDocuments.origin,
      );
      await client.display.patch({ focusedChannelId: channel.id });
      // This matrix deliberately keeps authored CSS motion. It claims no
      // transition comparison; it only avoids the default override required
      // to stay absent by the product authority's dead-zone fixture note.
      await openApp(page, product, baseURL, { authoredMotion: true });

      for (const [index, kind] of (["image", "pdf", "csp"] as const).entries()) {
        const artifact = artifacts[index]!;
        const target = artifacts[index + 1]!;
        await tabFor(page, artifact.id).click();
        await expectSelectedPage(page, artifact.id);
        await focusSelectedArtifactDocument(page, kind);

        await navigationChord(page, "ArrowRight");
        await expectSelectedPage(page, artifact.id);
        await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? null))
          .toBe("IFRAME");
        await navigationChord(page, "ArrowDown");
        await expectSelectedPage(page, artifact.id);
        await expectFocusedChannel(page, channel.name);
        expect((await client.display.get()).focusedChannelId).toBe(channel.id);

        const chrome = page.getByTitle(`${channel.name} menu`, { exact: true });
        await chrome.focus();
        await expect(chrome).toBeFocused();
        await navigationChord(page, "ArrowRight");
        await expectSelectedPage(page, target.id);
        await chrome.focus();
        await navigationChord(page, "ArrowDown");
        await expectFocusedChannel(page, nextChannel.name);
        await expect.poll(async () => (await client.display.get()).focusedChannelId)
          .toBe(nextChannel.id);
        await client.display.patch({ focusedChannelId: channel.id });
        await expectFocusedChannel(page, channel.name);
      }
    } finally {
      await nativeDocuments.dispose();
      await product.dispose();
    }
  });
});
