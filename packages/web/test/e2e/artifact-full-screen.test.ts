import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import {
  configureTestMotion,
  startMotionObservation,
  waitForApplicationShell,
} from "./helpers.ts";

interface PageGeometry {
  stage: { width: number; height: number };
  page: { width: number; height: number };
  centerOffset: number;
  stageInset: number;
}

const ARTIFACT_TITLE = "Full-screen document";

let storagePath: string;
let server: Server;
let client: TelevisionClient;
let channelID: string;

async function readGeometry(page: Page): Promise<PageGeometry> {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage");
    const filmstrip = document.querySelector<HTMLElement>(".filmstrip");
    const selectedPage = document.querySelector<HTMLElement>(".page[selected]");
    if (!stage || !filmstrip || !selectedPage) {
      throw new Error("Expected the production stage and selected page");
    }
    const stageBox = stage.getBoundingClientRect();
    const filmstripBox = filmstrip.getBoundingClientRect();
    const pageBox = selectedPage.getBoundingClientRect();
    const style = getComputedStyle(stage);
    return {
      stage: { width: stageBox.width, height: stageBox.height },
      page: { width: pageBox.width, height: pageBox.height },
      centerOffset: pageBox.left + pageBox.width / 2 -
        (filmstripBox.left + filmstripBox.width / 2),
      stageInset: Number.parseFloat(style.getPropertyValue("--page-inset")),
    };
  });
}

async function expectPageGeometry(page: Page, fullScreen: boolean): Promise<void> {
  const geometry = await readGeometry(page);
  const pageBox = {
    width: geometry.stage.width - 2 * geometry.stageInset,
    height: geometry.stage.height - geometry.stageInset,
  };
  const expectedWidth = fullScreen
    ? pageBox.width
    : Math.min(pageBox.width, Math.max(
      Math.min(230, pageBox.width),
      560 * (1 - 0.4 + 0.4 * pageBox.width / 1_280),
    ));
  const expectedHeight = fullScreen
    ? pageBox.height
    : Math.min(pageBox.height, Math.max(
      Math.min(230, pageBox.height),
      740 * (1 - 0.4 + 0.4 * pageBox.height / 800),
    ));
  expect(Math.abs(geometry.page.width - expectedWidth)).toBeLessThan(1);
  expect(Math.abs(geometry.page.height - expectedHeight)).toBeLessThan(1);
  expect(Math.abs(geometry.centerOffset)).toBeLessThan(1);
}

async function expectPersistedMode(fullScreen: boolean): Promise<void> {
  await expect.poll(async () => {
    const { channel } = await client.channels.get({ channelID });
    return channel.layout[0]?.geometry.full_screen;
  }).toBe(fullScreen);
}

async function toggleAndSettle(
  page: Page,
  fullScreen: boolean,
  action: () => Promise<void>,
): Promise<void> {
  const observation = await startMotionObservation(page, ".stage");
  await action();
  const selectedPage = page.locator(".page[selected]");
  if (fullScreen) {
    await expect(selectedPage).toHaveAttribute("full-screen", "");
  } else {
    await expect(selectedPage).not.toHaveAttribute("full-screen", "");
  }
  await observation.settle();
  await expectPersistedMode(fullScreen);
  await expectPageGeometry(page, fullScreen);
}

test.describe("page full-screen production walk", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    storagePath = mkdtempSync(path.join(os.tmpdir(), "television-full-screen-e2e-"));
    const store = createServingStore(storagePath);
    server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });
    await server.start();
    client = new TelevisionClient(server.getBaseURL());
    channelID = (await client.channels.list()).channels[0]!.id;
    const contentPath = path.join(storagePath, "full-screen-document.html");
    writeFileSync(contentPath, "<!doctype html><h1>Full-screen fixture</h1>", "utf8");
    await client.artifacts.create({
      channelID,
      kind: "path",
      title: ARTIFACT_TITLE,
      path: contentPath,
    });

    await page.goto(
      `${baseURL ?? ""}/packages/web/src/index.html?serverURL=${encodeURIComponent(server.getBaseURL())}&token=${server.getAuthToken()}`,
    );
    await waitForApplicationShell(page);
    await expect(page.locator(".page[selected] .artifact-view")).toHaveCount(1);
    await configureTestMotion(page);
    await expectPageGeometry(page, false);
  });

  test.afterEach(async () => {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("selected-tab double-click persists the mode and returns to the same stored size", async ({ page }) => {
    const ordinary = await readGeometry(page);
    const selectedTab = page.locator('.tab[aria-selected="true"]');
    await toggleAndSettle(page, true, () => selectedTab.dblclick());
    await toggleAndSettle(page, false, () => selectedTab.dblclick());
    const restored = await readGeometry(page);
    expect(Math.abs(restored.page.width - ordinary.page.width)).toBeLessThan(1);
    expect(Math.abs(restored.page.height - ordinary.page.height)).toBeLessThan(1);
  });

  test("a definitive rejected size write rolls the rendered page back to server truth", async ({ page }) => {
    let intercepted = false;
    let releaseRequest!: () => void;
    const heldRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const routePattern = `**/channels/${channelID}`;
    const rejectLayout = async (route: Route): Promise<void> => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      intercepted = true;
      await heldRequest;
      // Inject only invalid membership. The real route validates it and returns
      // the definitive 409 that the real ApplicationService must roll back.
      await route.continue({ postData: JSON.stringify({ layout: [] }) });
    };
    await page.route(routePattern, rejectLayout);

    await page.locator('.tab[aria-selected="true"]').dblclick();
    await expect(page.locator(".page[selected]")).toHaveAttribute("full-screen", "");
    await expect.poll(() => intercepted).toBe(true);

    const rollbackObservation = await startMotionObservation(page, ".stage");
    const rejectionResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/channels/${channelID}`
    );
    releaseRequest();
    expect((await rejectionResponse).status()).toBe(409);
    await expect(page.locator(".page[selected]")).not.toHaveAttribute("full-screen", "");
    await rollbackObservation.settle();
    await page.unroute(routePattern, rejectLayout);
    await expectPersistedMode(false);
    await expectPageGeometry(page, false);
    await expect(page.locator("#app")).toHaveAttribute(
      "data-app-state",
      "connected",
    );
  });
});
