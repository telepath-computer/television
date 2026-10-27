import type { Page, Route } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/application-snapshot.html";

interface BrowserSnapshot {
  ready: boolean;
  channels: Array<{
    id: string;
    name: string;
    pages: Array<{ artifactIds: string[] }>;
    artifacts: Array<{ id: string; title: string }>;
  }>;
  display: {
    focusedChannelId: string | null;
    pinnedChannelIds: string[];
  };
  focusedChannel: { id: string } | null;
  connection: { status: string };
}

async function readSnapshot(page: Page): Promise<BrowserSnapshot> {
  const value = await page.locator("#snapshot").textContent();
  if (!value) throw new Error("Application snapshot is empty");
  return JSON.parse(value) as BrowserSnapshot;
}

test("real browser application snapshot starts complete and reduces websocket updates", async ({ page, baseURL }) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-application-snapshot-e2e-"));
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const client = new TelevisionClient(serverURL);
    const existing = (await client.channels.list()).channels[0]!;
    const { channel } = await client.channels.create({
      id: "snapshot-channel",
      name: "Snapshot channel",
    });
    const { artifact } = await client.artifacts.create({
      channelID: channel.id,
      kind: "url",
      title: "Initial artifact",
      url: "https://example.com/initial",
    });
    await client.display.patch({
      focusedChannelId: channel.id,
      pinnedChannelIds: [channel.id, existing.id],
    });

    await page.goto(`${appURL}${FIXTURE}`);

    await expect(page.locator("#snapshot")).not.toHaveText("");
    await expect.poll(async () => (await readSnapshot(page)).ready).toBe(true);
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      const projected = snapshot.channels.find(({ id }) => id === channel.id);
      return {
        status: snapshot.connection.status,
        focused: snapshot.focusedChannel?.id,
        pins: snapshot.display.pinnedChannelIds,
        channel: projected && {
          name: projected.name,
          pages: projected.pages.map(({ artifactIds }) => artifactIds),
          artifacts: projected.artifacts.map(({ id, title }) => ({ id, title })),
        },
      };
    }).toEqual({
      status: "connected",
      focused: channel.id,
      pins: [channel.id, existing.id],
      channel: {
        name: "Snapshot channel",
        pages: [[artifact.id]],
        artifacts: [{ id: artifact.id, title: "Initial artifact" }],
      },
    });

    await client.channels.update({ channelID: channel.id, name: "Renamed live" });
    await client.artifacts.update({ artifactID: artifact.id, title: "Retitled live" });
    await client.display.patch({
      focusedChannelId: existing.id,
      pinnedChannelIds: [existing.id, channel.id],
    });

    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      const projected = snapshot.channels.find(({ id }) => id === channel.id);
      return {
        focused: snapshot.focusedChannel?.id,
        pins: snapshot.display.pinnedChannelIds,
        name: projected?.name,
        title: projected?.artifacts[0]?.title,
      };
    }).toEqual({
      focused: existing.id,
      pins: [existing.id, channel.id],
      name: "Renamed live",
      title: "Retitled live",
    });

    await client.artifacts.delete({ artifactID: artifact.id });
    await expect.poll(async () => {
      const projected = (await readSnapshot(page)).channels.find(({ id }) => id === channel.id);
      return { pages: projected?.pages, artifacts: projected?.artifacts };
    }).toEqual({ pages: [], artifacts: [] });
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

test("real stale pin rejection converges to server truth and leaves the event connection usable", async ({ page, baseURL }) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-application-rejection-e2e-"));
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const client = new TelevisionClient(serverURL);
    const survivor = (await client.channels.list()).channels[0]!;
    const { channel: removed } = await client.channels.create({
      id: "rejection-removed-channel",
      name: "Removed before stale write",
    });
    const stalePins = [removed.id, survivor.id];
    await client.display.patch({
      focusedChannelId: removed.id,
      pinnedChannelIds: stalePins,
    });

    await page.goto(`${appURL}${FIXTURE}`);
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return {
        ready: snapshot.ready,
        status: snapshot.connection.status,
        focus: snapshot.display.focusedChannelId,
        pins: snapshot.display.pinnedChannelIds,
      };
    }).toEqual({
      ready: true,
      status: "connected",
      focus: removed.id,
      pins: stalePins,
    });

    await client.channels.remove({ channelID: removed.id });
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return {
        channels: snapshot.channels.map(({ id }) => id),
        focus: snapshot.display.focusedChannelId,
        pins: snapshot.display.pinnedChannelIds,
      };
    }).toEqual({
      channels: [survivor.id],
      focus: survivor.id,
      pins: [survivor.id],
    });

    const rejection = await page.evaluate(async (pinnedChannelIds) => {
      const application = (window as Window & {
        __application?: {
          setPinnedChannelIds(channelIds: readonly string[]): Promise<void>;
        };
      }).__application;
      if (!application) throw new Error("ApplicationService fixture is unavailable");
      try {
        await application.setPinnedChannelIds(pinnedChannelIds);
        return { resolved: true };
      } catch (error) {
        return error instanceof Error
          ? {
              resolved: false,
              name: error.name,
              message: error.message,
              status: (error as Error & { status?: number }).status,
              serverURL: (error as Error & { serverURL?: string }).serverURL,
            }
          : { resolved: false, name: "unknown", message: String(error) };
      }
    }, stalePins);

    expect(rejection).toEqual({
      resolved: false,
      name: "RequestError",
      message: `Channel not found: ${removed.id}`,
      status: 404,
      serverURL: appURL,
    });
    const serverDisplay = await client.display.get();
    const afterRejection = await readSnapshot(page);
    expect(afterRejection.display).toMatchObject({
      focusedChannelId: serverDisplay.focusedChannelId,
      pinnedChannelIds: serverDisplay.pinnedChannelIds,
    });
    expect(afterRejection.connection.status).toBe("connected");

    const { channel: later } = await client.channels.create({
      id: "rejection-later-channel",
      name: "Arrived after rejection",
    });
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return {
        usable: snapshot.channels.some(({ id }) => id === later.id),
        status: snapshot.connection.status,
      };
    }).toEqual({ usable: true, status: "connected" });
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});

test("ambiguous pin writes refetch only display after delivered and lost requests", async ({ page, baseURL }) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "tv-application-ambiguous-e2e-"));
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });

  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const appURL = await appURLForServer(serverURL, baseURL!);
    const client = new TelevisionClient(serverURL);
    const first = (await client.channels.list()).channels[0]!;
    const { channel: second } = await client.channels.create({
      id: "ambiguous-pin-channel",
      name: "Ambiguous pin target",
    });
    await client.display.patch({
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
    });

    await page.goto(`${appURL}${FIXTURE}`);
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return {
        ready: snapshot.ready,
        status: snapshot.connection.status,
        pins: snapshot.display.pinnedChannelIds,
      };
    }).toEqual({ ready: true, status: "connected", pins: [first.id] });

    for (const outcome of ["response-lost", "request-lost"] as const) {
      const targetPins = outcome === "response-lost"
        ? [second.id, first.id]
        : [second.id];
      const expectedPins = outcome === "response-lost"
        ? targetPins
        : [first.id];
      const requests: string[] = [];
      let writeIntercepted = false;
      const routePattern = `${appURL}/**`;
      const routeHandler = async (route: Route): Promise<void> => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push(`${request.method()} ${url.pathname}`);
        if (
          request.method() === "PATCH" &&
          url.pathname === "/display" &&
          !writeIntercepted
        ) {
          writeIntercepted = true;
          if (outcome === "response-lost") {
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
          }
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await page.route(routePattern, routeHandler);

      const failure = await page.evaluate(async (pinnedChannelIds) => {
        const application = (window as Window & {
          __application?: {
            setPinnedChannelIds(channelIds: readonly string[]): Promise<void>;
          };
        }).__application;
        if (!application) throw new Error("ApplicationService fixture is unavailable");
        try {
          await application.setPinnedChannelIds(pinnedChannelIds);
          return { resolved: true };
        } catch (error) {
          return error instanceof Error
            ? {
                resolved: false,
                name: error.name,
                status: (error as Error & { status?: number }).status ?? null,
                serverURL: (error as Error & { serverURL?: string }).serverURL,
              }
            : { resolved: false, name: "unknown", status: null };
        }
      }, targetPins);
      await page.unroute(routePattern, routeHandler);

      expect(failure).toEqual({
        resolved: false,
        name: "RequestError",
        status: null,
        serverURL: appURL,
      });
      expect(writeIntercepted).toBe(true);
      expect(requests).toEqual(["PATCH /display", "GET /display"]);
      expect((await client.display.get()).pinnedChannelIds).toEqual(expectedPins);
      expect((await readSnapshot(page)).display.pinnedChannelIds).toEqual(expectedPins);
      expect((await readSnapshot(page)).connection.status).toBe("connected");

      if (outcome === "response-lost") {
        await client.display.patch({ pinnedChannelIds: [first.id] });
        await expect.poll(async () => (await readSnapshot(page)).display.pinnedChannelIds)
          .toEqual([first.id]);
      }
    }
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});
