import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { Server } from "@telepath-computer/television-server";
import {
  configureTestMotion,
  createArtifactFile,
  waitForApplicationShell,
} from "./helpers.ts";
import { startDevelopmentProxy } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { observeApplicationPresentations } from "./application-presentation.helpers.ts";

// Reconnect convergence acceptance
// (proofs/arch/channel-state/index.md#^cs-ac-reconnect): the real event socket
// is severed server-side, current server state changes while its events have
// no receiver, and production retry plus complete refresh must repaint the
// permanent shell without another top-level navigation. The shared test
// motion override forfeits unrelated CSS motion, not application state.

interface EventStreamInternals {
  wsServer: { clients: Set<{ terminate(): void }> };
  getConnectedClientCount(): number;
}

function eventStream(server: Server): EventStreamInternals {
  return (server as unknown as { events: EventStreamInternals }).events;
}

function terminateEventSockets(server: Server): void {
  for (const socket of eventStream(server).wsServer.clients) {
    socket.terminate();
  }
}

async function expectEventClientsConnected(server: Server, timeout: number): Promise<void> {
  await expect
    .poll(() => eventStream(server).getConnectedClientCount(), { timeout })
    .toBeGreaterThan(0);
}

async function expectEventClientsGone(server: Server, timeout: number): Promise<void> {
  await expect
    .poll(() => eventStream(server).getConnectedClientCount(), { timeout })
    .toBe(0);
}

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-reload-after-reconnect-e2e-"));
}

interface ContinuitySnapshot {
  readonly sameNodes: Record<string, boolean>;
  readonly removedNodes: readonly string[];
  readonly documentLifecycle: readonly string[];
  readonly draft: string;
  readonly scrollTop: number;
  readonly animationFrames: number;
}

async function installContinuityObservation(page: Page): Promise<ContinuitySnapshot> {
  await page.evaluate(() => {
    const root = document.querySelector("#app");
    const sidebar = root?.querySelector(":scope > .app-sidebar");
    const main = root?.querySelector(":scope > .app-main");
    const topBar = main?.querySelector(":scope > .top-bar");
    const stage = main?.querySelector(":scope > .stage");
    const page = stage?.querySelector(":scope .page[selected]");
    const artifactView = page?.querySelector(".artifact-view");
    const iframe = artifactView?.querySelector<HTMLIFrameElement>("iframe.artifact-content");
    const frameWindow = iframe?.contentWindow;
    const frameDocument = iframe?.contentDocument;
    const input = frameDocument?.querySelector<HTMLInputElement>("#draft");
    if (!root || !sidebar || !main || !topBar || !stage || !page ||
        !artifactView || !iframe || !frameWindow || !frameDocument || !input) {
      throw new Error("Complete APP-3 continuity surface is not mounted");
    }

    input.value = "draft retained through reconnect";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const scrollingElement = frameDocument.scrollingElement;
    if (!scrollingElement) throw new Error("Artifact document has no scrolling element");
    scrollingElement.scrollTop = 420;

    const refs: Record<string, Node> = {
      root,
      sidebar,
      main,
      topBar,
      stage,
      page,
      artifactView,
      iframe,
    };
    const removedNodes: string[] = [];
    const documentLifecycle: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          for (const [name, ref] of Object.entries(refs)) {
            if (removed === ref || removed.contains(ref)) removedNodes.push(name);
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    frameWindow.addEventListener("pagehide", () => documentLifecycle.push("pagehide"));
    frameWindow.addEventListener("beforeunload", () => documentLifecycle.push("beforeunload"));

    const owner = window as unknown as {
      __tvApp3Continuity?: {
        refs: Record<string, Node>;
        frameWindow: Window;
        frameDocument: Document;
        input: HTMLInputElement;
        observer: MutationObserver;
        removedNodes: string[];
        documentLifecycle: string[];
      };
    };
    owner.__tvApp3Continuity = {
      refs,
      frameWindow,
      frameDocument,
      input,
      observer,
      removedNodes,
      documentLifecycle,
    };
  });
  return readContinuityObservation(page);
}

async function readContinuityObservation(
  page: Page,
  { stop = false }: { stop?: boolean } = {},
): Promise<ContinuitySnapshot> {
  return page.evaluate((shouldStop) => {
    const owner = window as unknown as {
      __tvApp3Continuity?: {
        refs: Record<string, Node>;
        frameWindow: Window;
        frameDocument: Document;
        input: HTMLInputElement;
        observer: MutationObserver;
        removedNodes: string[];
        documentLifecycle: string[];
      };
    };
    const state = owner.__tvApp3Continuity;
    if (!state) throw new Error("APP-3 continuity observation is not installed");
    const currentRoot = document.querySelector("#app");
    const currentMain = currentRoot?.querySelector(":scope > .app-main");
    const currentStage = currentMain?.querySelector(":scope > .stage");
    const currentPage = currentStage?.querySelector(":scope .page[selected]");
    const currentArtifactView = currentPage?.querySelector(".artifact-view");
    const currentIframe = currentArtifactView?.querySelector<HTMLIFrameElement>("iframe.artifact-content");
    const currentFrameDocument = currentIframe?.contentDocument;
    const result: ContinuitySnapshot = {
      sameNodes: {
        root: currentRoot === state.refs.root,
        sidebar: currentRoot?.querySelector(":scope > .app-sidebar") === state.refs.sidebar,
        main: currentMain === state.refs.main,
        topBar: currentMain?.querySelector(":scope > .top-bar") === state.refs.topBar,
        stage: currentStage === state.refs.stage,
        page: currentPage === state.refs.page,
        artifactView: currentArtifactView === state.refs.artifactView,
        iframe: currentIframe === state.refs.iframe,
        contentWindow: currentIframe?.contentWindow === state.frameWindow,
        document: currentFrameDocument === state.frameDocument,
        input: currentFrameDocument?.querySelector("#draft") === state.input,
      },
      removedNodes: [...state.removedNodes],
      documentLifecycle: [...state.documentLifecycle],
      draft: state.input.value,
      scrollTop: state.frameDocument.scrollingElement?.scrollTop ?? -1,
      animationFrames: Number(
        (state.frameWindow as unknown as { app3AnimationFrames?: number }).app3AnimationFrames ?? 0,
      ),
    };
    if (shouldStop) {
      state.observer.disconnect();
      delete owner.__tvApp3Continuity;
    }
    return result;
  }, stop);
}

function expectContinuity(snapshot: ContinuitySnapshot): void {
  expect(snapshot.sameNodes).toEqual({
    root: true,
    sidebar: true,
    main: true,
    topBar: true,
    stage: true,
    page: true,
    artifactView: true,
    iframe: true,
    contentWindow: true,
    document: true,
    input: true,
  });
  expect(snapshot.removedNodes).toEqual([]);
  expect(snapshot.documentLifecycle).toEqual([]);
  expect(snapshot.draft).toBe("draft retained through reconnect");
  expect(snapshot.scrollTop).toBe(420);
}

async function openApp(page: Page, baseURL: string | undefined, server: Server): Promise<void> {
  if (!baseURL) {
    throw new Error("Expected Playwright baseURL");
  }
  const serverURL = server.getBaseURL();
  const token = server.getAuthToken();
  await page.goto(
    `${baseURL}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&token=${encodeURIComponent(token)}`,
  );
  // Generous timeout: first load may pay cold Vite transforms, and the app
  // auto-retries its initial /events connect on a 1s backoff under load.
  await waitForApplicationShell(page);
  await configureTestMotion(page);
}

async function mutateWhileDisconnected(
  server: Server,
  mutate: () => void | Promise<void>,
): Promise<void> {
  await expectEventClientsConnected(server, 10_000);
  terminateEventSockets(server);
  await expectEventClientsGone(server, 5_000);

  await mutate();
  expect(eventStream(server).getConnectedClientCount()).toBe(0);

  await expectEventClientsConnected(server, 15_000);
}

test.describe("reload after reconnect (real server)", () => {
  test("channels, pins, focus, and pages changed while disconnected converge in the redesigned shell", async ({
    page,
    baseURL,
  }) => {
    const storagePath = createDataDir();
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0 });

    try {
      const first = store.listChannels()[0]!;
      const firstPath = createArtifactFile(storagePath, "reload-first", "# First", "md");
      store.createArtifact({ channelID: first.id, title: "First page", kind: "path", path: firstPath });
      const second = store.createChannel({ name: "Second Channel" });
      const secondPath = createArtifactFile(storagePath, "reload-second", "# Second", "md");
      const secondBefore = store.createArtifact({
        channelID: second.id,
        title: "Second before",
        kind: "path",
        path: secondPath,
      });
      const removed = store.createChannel({ name: "Removed While Away" });
      store.patchDisplay({
        focusedChannelId: first.id,
        pinnedChannelIds: [first.id, removed.id],
      });

      let topLevelNavigations = 0;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) topLevelNavigations += 1;
      });

      await server.start();
      await openApp(page, baseURL, server);
      const navigationCountAfterOpen = topLevelNavigations;
      expect(navigationCountAfterOpen).toBeGreaterThan(0);
      await expect(
        page.locator(`.channel-row[data-channel-id="${first.id}"] .channel`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".tab-strip .tab-label")).toHaveText(["First page"]);

      let arrivedId: string | null = null;
      let secondCurrentId: string | null = null;
      await mutateWhileDisconnected(server, () => {
        store.updateChannel({
          channelID: first.id,
          fields: { name: "Renamed While Away" },
        });
        const currentPath = createArtifactFile(
          storagePath,
          "reload-second-current",
          "# Current",
          "md",
        );
        secondCurrentId = store.createArtifact({
          channelID: second.id,
          title: "Second current",
          kind: "path",
          path: currentPath,
        }).id;
        const arrived = store.createChannel({ name: "Arrived While Away" });
        arrivedId = arrived.id;
        const arrivedPath = createArtifactFile(
          storagePath,
          "reload-arrived",
          "# Arrived",
          "md",
        );
        store.createArtifact({
          channelID: arrived.id,
          title: "Arrived page",
          kind: "path",
          path: arrivedPath,
        });
        store.removeChannel(removed.id);
        store.patchDisplay({
          focusedChannelId: second.id,
          pinnedChannelIds: [second.id, arrived.id],
        });
      });

      expect(arrivedId).not.toBeNull();
      expect(secondCurrentId).not.toBeNull();
      const pinnedRows = page.getByRole("group", { name: "Pinned", exact: true }).locator(".channel-row");
      await expect.poll(() =>
        pinnedRows.evaluateAll((rows) =>
          rows.map((row) => (row as HTMLElement).dataset.channelId)
        )
      ).toEqual([second.id, arrivedId]);
      await expect(
        page.locator(`.channel-row[data-channel-id="${second.id}"] .channel`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.locator(`.channel-row[data-channel-id="${first.id}"] .channel`),
      ).toHaveText("Renamed While Away");
      await expect(
        page.locator(`.channel-row[data-channel-id="${removed.id}"]`),
      ).toHaveCount(0);

      const tabs = page.locator(".tab-strip .tab");
      await expect(tabs.locator(".tab-label")).toHaveText([
        "Second before",
        "Second current",
      ]);
      await expect(tabs.nth(0)).toHaveAttribute("data-artifact-id", secondBefore.id);
      await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
      await expect(tabs.nth(1)).toHaveAttribute("data-artifact-id", secondCurrentId!);
      await expect(page.locator(".stage .page")).toHaveCount(2);
      await expect(page.locator(`.stage .page[data-page-key="${secondBefore.id}"]`))
        .toHaveAttribute("selected", "");
      expect(topLevelNavigations).toBe(navigationCountAfterOpen);
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("outage escalation preserves the live shell and artifact document through automatic reconnect", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Expected Playwright baseURL");
    const storagePath = createDataDir();
    const store = createServingStore(storagePath);
    const visibleChannel = store.listChannels()[0]!;
    const sourceChannel = store.createChannel({ name: "Continuity source" });
    const sourcePath = createArtifactFile(
      storagePath,
      "continuity",
      `<!doctype html>
        <label>Draft <input id="draft" value="initial"></label>
        <div style="height: 2400px"></div>
        <script>
          window.app3AnimationFrames = 0;
          const advance = () => {
            window.app3AnimationFrames += 1;
            requestAnimationFrame(advance);
          };
          requestAnimationFrame(advance);
        </script>`,
      "html",
    );
    store.patchDisplay({ focusedChannelId: visibleChannel.id });
    let server = new Server({ store, port: 0 });
    let proxy: Awaited<ReturnType<typeof startDevelopmentProxy>> | undefined;

    try {
      await server.start();
      const client = new TelevisionClient(server.getBaseURL(), { token: server.getAuthToken() });
      const { artifact: sourceArtifact } = await client.artifacts.create({
        channelID: sourceChannel.id,
        title: "Continuity source",
        kind: "path",
        path: sourcePath,
      });

      proxy = await startDevelopmentProxy({
        productServerURL: server.getBaseURL(),
        viteBaseURL: baseURL,
      });
      // The artifact remains a real, authored server artifact. Presenting it
      // through its same-server Television URL exercises the complete CLIENT-7
      // reconnect while correctly avoiding the intentional path-document
      // refresh; APP-3's subject is identity of the already-loaded document.
      const sharedURL = `${proxy.url}/artifact/${sourceArtifact.id}/${encodeURIComponent(path.basename(sourcePath))}`;
      const { artifact: visibleArtifact } = await client.artifacts.create({
        channelID: visibleChannel.id,
        title: "Continuity document",
        kind: "url",
        url: sharedURL,
      });

      let topLevelNavigations = 0;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) topLevelNavigations += 1;
      });
      await page.goto(
        `${proxy.url}/packages/web/src/index.html?serverURL=${encodeURIComponent(proxy.url)}&token=${encodeURIComponent(server.getAuthToken())}`,
      );
      await waitForApplicationShell(page);
      await configureTestMotion(page);
      await expect(
        page.locator(`.stage .page[data-page-key="${visibleArtifact.id}"] .artifact-view`),
      ).toHaveCount(1);
      await expect(page.frameLocator(".artifact-view iframe").locator("#draft")).toBeVisible();
      const navigationCountAfterOpen = topLevelNavigations;
      const before = await installContinuityObservation(page);
      expectContinuity(before);
      expect(before.animationFrames).toBeGreaterThan(0);
      const presentation = await observeApplicationPresentations(page);

      expect(eventStream(server).getConnectedClientCount()).toBeGreaterThan(0);
      await server.dispose();
      await expect(
        page.locator("#app[data-app-state='disconnected'] .system-modal-host .system-modal h2"),
      ).toHaveText("Disconnected");
      await expect(page.locator("#app[data-app-state='disconnected'] > .app-sidebar")).toHaveCount(1);
      await expect(page.locator("#app[data-app-state='disconnected'] > .app-main")).toHaveCount(1);
      await presentation.settle();
      const interrupted = await readContinuityObservation(page);
      expectContinuity(interrupted);
      expect(interrupted.animationFrames).toBeGreaterThan(before.animationFrames);

      await expect(page.locator("#app")).toHaveAttribute("data-app-state", "error", { timeout: 20_000 });
      await expect(page.locator(".system-modal")).toContainText("Reconnecting in");
      await presentation.settle();
      expectContinuity(await readContinuityObservation(page));
      server = new Server({ store: createServingStore(storagePath), port: 0 });
      await server.start();
      proxy.setProductServerURL(server.getBaseURL());
      await expectEventClientsConnected(server, 15_000);
      await expect(page.locator("#app")).toHaveAttribute(
        "data-app-state",
        /^(connected|no-channel|empty-channel)$/,
      );
      await expect(page.locator(".system-modal-host")).toHaveCount(0);
      await presentation.settle();
      await presentation.stop();
      const resumed = await readContinuityObservation(page, { stop: true });
      expectContinuity(resumed);
      expect(resumed.animationFrames).toBeGreaterThan(interrupted.animationFrames);
      expect(topLevelNavigations).toBe(navigationCountAfterOpen);

      const records = presentation.records().filter((record) =>
        record.appState !== null
      );
      const disconnectedRecords = records.filter((record) =>
        record.appState === "disconnected" || record.appState === "error"
      );
      for (const count of [0, 1, 2, 3]) {
        const attempts = disconnectedRecords.filter((record) => record.failedReconnectAttempts === count);
        expect(attempts.length, `observed ${count} completed failures`).toBeGreaterThan(0);
        for (const record of attempts) expect(record.appState).toBe(count < 3 ? "disconnected" : "error");
      }
      for (const state of ["disconnected", "error"]) {
        expect(disconnectedRecords.some((record) => record.appState === state && /Reconnecting in \d+s…/.test(record.reconnectLine))).toBe(true);
        expect(disconnectedRecords.some((record) => record.appState === state && record.reconnectLine.includes("Reconnecting now…"))).toBe(true);
      }
      expect(disconnectedRecords.length).toBeGreaterThan(0);
      for (const record of disconnectedRecords) {
        expect(record).toMatchObject({
          shellRegionCount: 2,
          sidebarCount: 1,
          mainCount: 1,
          modalHostCount: 1,
          unauthorizedCount: 0,
          gateCount: 0,
          connectingCount: 0,
          disconnectedCount: record.appState === "disconnected" ? 1 : 0,
          errorCount: record.appState === "error" ? 1 : 0,
        });
      }
      expect(
        records.filter((record) => record.modalHostCount > 0),
      ).toEqual(disconnectedRecords);
    } finally {
      await proxy?.dispose();
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  test("control: focused-channel switch while disconnected converges without another navigation", async ({
    page,
    baseURL,
  }) => {
    const storagePath = createDataDir();
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0 });

    try {
      const first = store.listChannels()[0]!;
      const firstPath = createArtifactFile(storagePath, "reload-control-first", "# First", "md");
      store.createArtifact({ channelID: first.id, title: "First page", kind: "path", path: firstPath });
      const second = store.createChannel({ name: "Second Channel" });
      const secondPath = createArtifactFile(storagePath, "reload-control-second", "# Second", "md");
      const secondArtifact = store.createArtifact({
        channelID: second.id,
        title: "Second page",
        kind: "path",
        path: secondPath,
      });
      store.patchDisplay({ focusedChannelId: first.id });

      let topLevelNavigations = 0;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) topLevelNavigations += 1;
      });

      await server.start();
      await openApp(page, baseURL, server);
      const navigationCountAfterOpen = topLevelNavigations;
      expect(navigationCountAfterOpen).toBeGreaterThan(0);
      await expect(page.locator(".tab-strip .tab-label")).toHaveText(["First page"]);

      await mutateWhileDisconnected(server, () => {
        store.patchDisplay({ focusedChannelId: second.id });
      });

      await expect(
        page.locator(`.channel-row[data-channel-id="${second.id}"] .channel`),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".tab-strip .tab-label")).toHaveText(["Second page"]);
      await expect(
        page.locator(`.stage .page[data-page-key="${secondArtifact.id}"]`),
      ).toHaveAttribute("selected", "");
      expect(topLevelNavigations).toBe(navigationCountAfterOpen);
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
