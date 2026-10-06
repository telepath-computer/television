import { expect, test, type Page } from "@playwright/test";
import { CROSSING_DURATION_MS } from "../../src/constants.ts";
import {
  configureTestMotion,
  startMotionObservation,
  type MotionReport,
} from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/stage.html";
const ARTIFACT_IDS = ["artifact-a", "artifact-b", "artifact-c"];
const AUTHORED_PAGE_SIZES = [
  { width: 561.25, height: 741.5 },
  { width: 612.75, height: 702.25 },
  { width: 523.5, height: 763.75 },
];

interface StageGeometry {
  stage: { width: number; height: number };
  page: { width: number; height: number };
  inlinePage: { width: string; height: string };
  centerOffset: number;
  stageInset: number;
}

interface StageReport {
  pageCount: number;
  selectedArtifactID: string | null;
  selectedCenterOffset: number | null;
  filmstripPositionSame: boolean;
  selectionCalls: Array<{ channelID: string; artifactID: string }>;
  pageUpdateCalls: Array<{
    channelID: string;
    fullScreen: boolean | null;
    sizes: Array<{ width: number; height: number }>;
  }>;
  selectedFullScreen: boolean;
  geometry: StageGeometry | null;
  handles: {
    selected: string[];
    backgroundCounts: number[];
    controlOverlaps: string[];
  };
  snapOutlined: boolean;
  artifactPresses: string[];
  loads: Record<string, number>;
  pagesSame: boolean;
  viewsSame: boolean;
  framesSame: boolean;
  windowsSame: boolean;
  states: Array<string | null>;
}

interface ChannelRedrawSample {
  geometry: StageGeometry | null;
  keys: string[];
  scrollLeft: number | null;
  animations: number;
}

interface ChannelRedrawReport {
  renderCount: number;
  keySamples: string[][];
  frameSamples: ChannelRedrawSample[];
  pageKeys: string[];
  selectedArtifactID: string | null;
  loads: Record<string, number>;
  states: Array<string | null>;
  oldNodesDetached: boolean;
  freshNodes: boolean;
}

interface StageFixture {
  settle(): Promise<void>;
  startGeometryObservation(): void;
  finishGeometryObservation(): StageGeometry[];
  capture(): void;
  rerender(): void;
  replaceChannel(): Promise<ChannelRedrawReport>;
  report(): StageReport;
}

async function waitForStage(page: Page, allowCSSMotion = false): Promise<void> {
  await page.waitForFunction(
    (artifactIDs) => {
      const owner = window as unknown as {
        __fixtureReady?: boolean;
        __stageDocumentsReady?: Set<string>;
      };
      return owner.__fixtureReady === true &&
        artifactIDs.every((artifactID) => owner.__stageDocumentsReady?.has(artifactID));
    },
    ARTIFACT_IDS,
  );
  await configureTestMotion(page, { allowCSSMotion });
}

async function capture(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __stageFixture: StageFixture }).__stageFixture.capture();
  });
}

async function settleStage(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __stageFixture: StageFixture }).__stageFixture.settle()
  );
}

async function report(page: Page): Promise<StageReport> {
  return page.evaluate(() =>
    (window as unknown as { __stageFixture: StageFixture }).__stageFixture.report()
  );
}

async function replaceChannel(page: Page): Promise<ChannelRedrawReport> {
  return page.evaluate(() =>
    (window as unknown as { __stageFixture: StageFixture }).__stageFixture.replaceChannel()
  );
}

async function startGeometryObservation(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __stageFixture: StageFixture })
      .__stageFixture.startGeometryObservation()
  );
}

async function finishGeometryObservation(page: Page): Promise<StageGeometry[]> {
  return page.evaluate(() =>
    (window as unknown as { __stageFixture: StageFixture })
      .__stageFixture.finishGeometryObservation()
  );
}

async function pressPage(page: Page, index: number): Promise<void> {
  const target = page.locator(".page").nth(index);
  const box = await target.boundingBox();
  if (!box) throw new Error(`Expected stage page ${index} to have a box`);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Expected a fixed viewport");
  const x = Math.min(Math.max(box.x + 12, 12), viewport.width - 12);
  const y = Math.min(Math.max(box.y + box.height / 2, 12), viewport.height - 12);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

interface ResizePointer {
  readonly handle: ReturnType<Page["locator"]>;
  readonly origin: { x: number; y: number };
}

async function beginResize(
  page: Page,
  position: string,
  delta: { x: number; y: number },
): Promise<ResizePointer> {
  const pointer = await resizePointer(page, position);
  await page.mouse.move(pointer.origin.x, pointer.origin.y);
  await page.mouse.down();
  await page.mouse.move(
    pointer.origin.x + delta.x,
    pointer.origin.y + delta.y,
  );
  return pointer;
}

async function resizePointer(
  page: Page,
  position: string,
): Promise<ResizePointer> {
  const handle = page.locator(`.page[selected] .page-handle.${position}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Expected the ${position} resize handle to have a box`);
  const selectedBox = await page.locator(".page[selected]").boundingBox();
  if (!selectedBox) throw new Error("Expected the selected page to have a box");
  const origin = {
    x: position.includes("left")
      ? selectedBox.x
      : position.includes("right")
      ? selectedBox.x + selectedBox.width
      : box.x + box.width / 2,
    y: position.includes("top")
      ? selectedBox.y
      : position.includes("bottom")
      ? selectedBox.y + selectedBox.height
      : box.y + box.height / 2,
  };
  return { handle, origin };
}

async function enterFullScreen(page: Page): Promise<StageReport> {
  await page.locator('.tab[aria-selected="true"]').dblclick();
  await settleStage(page);
  const value = await report(page);
  expectPageGeometry(value, true);
  return value;
}

function expectClose(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

function pageBox(geometry: StageGeometry): { width: number; height: number } {
  return {
    width: geometry.stage.width - 2 * geometry.stageInset,
    height: geometry.stage.height - geometry.stageInset,
  };
}

function expectedOrdinarySize(
  geometry: StageGeometry,
  stored = AUTHORED_PAGE_SIZES[1]!,
): { width: number; height: number } {
  const box = pageBox(geometry);
  const widthFactor = 1 - 0.4 + 0.4 * box.width / 1_280;
  const heightFactor = 1 - 0.4 + 0.4 * box.height / 800;
  return {
    width: Math.min(box.width, Math.max(Math.min(230, box.width), stored.width * widthFactor)),
    height: Math.min(box.height, Math.max(Math.min(230, box.height), stored.height * heightFactor)),
  };
}

function expectPageGeometry(
  value: StageReport,
  fullScreen: boolean,
  stored = AUTHORED_PAGE_SIZES[1]!,
): void {
  expect(value.selectedFullScreen).toBe(fullScreen);
  const geometry = value.geometry;
  if (!geometry) throw new Error("Expected selected page geometry");
  const box = pageBox(geometry);
  const ordinary = expectedOrdinarySize(geometry, stored);
  const expectedWidth = fullScreen ? box.width : ordinary.width;
  const expectedHeight = fullScreen ? box.height : ordinary.height;
  expect(Math.abs(geometry.page.width - expectedWidth)).toBeLessThan(1);
  expect(Math.abs(geometry.page.height - expectedHeight)).toBeLessThan(1);
  expect(Math.abs(geometry.centerOffset)).toBeLessThan(1);
}

// Timing literals restate specs/ui/app/stage/styles.css's width/height transitions:
// transition events report seconds and Web Animations reports milliseconds.
function expectPageSizeTransition(
  value: MotionReport,
  from: StageGeometry,
  to: StageGeometry,
): void {
  const changedProperties = [
    ...(Math.abs(from.page.width - to.page.width) >= 1 ? ["width"] : []),
    ...(Math.abs(from.page.height - to.page.height) >= 1 ? ["height"] : []),
  ];
  expect(changedProperties.length).toBeGreaterThan(0);
  const ends = value.transitionEvents.filter(({ type, propertyName }) =>
    type === "transitionend" && changedProperties.includes(propertyName)
  );
  expect(ends).toHaveLength(changedProperties.length);
  expect(ends).toEqual(expect.arrayContaining(changedProperties.map((propertyName) => ({
    elapsedTime: 0.28,
    propertyName,
    type: "transitionend",
  }))));
  expect(value.webAnimations.filter(({ kind, duration, finished }) =>
    kind === "css-transition" && duration === 280 && finished
  )).toHaveLength(changedProperties.length);
}

function expectCentredSamples(samples: StageGeometry[]): void {
  expect(samples.length).toBeGreaterThan(2);
  const offsets = samples.map(({ centerOffset }) => centerOffset);
  expect(Math.max(...offsets.map(Math.abs)), JSON.stringify(offsets)).toBeLessThan(1);
}

function expectRetainedDocuments(value: StageReport): void {
  expect(value).toMatchObject({
    pageCount: 3,
    artifactPresses: [],
    loads: {
      "artifact-a": 1,
      "artifact-b": 1,
      "artifact-c": 1,
    },
    pagesSame: true,
    viewsSame: true,
    framesSame: true,
    windowsSame: true,
    states: ARTIFACT_IDS.map((artifactID) => `retained:${artifactID}`),
  });
  expect(Math.abs(value.selectedCenterOffset ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
}

function expectSelectionCrossing(value: MotionReport): void {
  expect(value.transitionEvents).toContainEqual({
    elapsedTime: CROSSING_DURATION_MS / 1_000,
    propertyName: "scale",
    type: "transitionend",
  });
  expect(value.transitionEvents).toContainEqual({
    elapsedTime: CROSSING_DURATION_MS / 1_000,
    propertyName: "opacity",
    type: "transitionend",
  });
  expect(value.webAnimations).toContainEqual({
    duration: CROSSING_DURATION_MS,
    finished: true,
    kind: "web-animation",
  });
  expect(value.scrollEvents).toBeGreaterThan(0);
  expect(value.scrollEndEvents).toBeGreaterThan(0);
  expect(new Set(value.scrollPositions).size).toBeGreaterThan(2);
}

test.describe("stage stable documents", () => {
  test("keeps every keyed page and live document across an application rerender", async ({ page }) => {
    await page.goto(FIXTURE);
    await waitForStage(page);
    await capture(page);
    const observation = await startMotionObservation(page, ".stage");

    await page.evaluate(() => {
      (window as unknown as { __stageFixture: { rerender(): void } }).__stageFixture.rerender();
    });
    const motion = await observation.settle();

    expect(motion.transitionEvents).toEqual([]);
    expect(motion.animationEvents).toEqual([]);
    expect(motion.webAnimations).toEqual([]);
    expect(new Set(motion.scrollPositions).size).toBe(1);
    expect(await report(page)).toMatchObject({
      selectedArtifactID: "artifact-b",
      filmstripPositionSame: true,
      selectionCalls: [],
    });
    expectRetainedDocuments(await report(page));
  });
});

test.describe("stage selection motion (^st-ac-selection-motion)", () => {
  test("background presses centre adjacent and nonadjacent pages in the same authored time without recreating documents", async ({ page }) => {
    await page.setViewportSize({ width: 3_000, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(FIXTURE);
    await waitForStage(page, true);
    await capture(page);

    const adjacentObservation = await startMotionObservation(page, ".stage");
    await pressPage(page, 0);
    const adjacentMotion = await adjacentObservation.settle({ requireMotion: true });
    const adjacentReport = await report(page);

    expectSelectionCrossing(adjacentMotion);
    expect(adjacentReport).toMatchObject({
      selectedArtifactID: "artifact-a",
      filmstripPositionSame: false,
      selectionCalls: [{ channelID: "channel-stage", artifactID: "artifact-a" }],
    });
    expectRetainedDocuments(adjacentReport);

    const nonadjacentObservation = await startMotionObservation(page, ".stage");
    await pressPage(page, 2);
    const nonadjacentMotion = await nonadjacentObservation.settle({ requireMotion: true });
    const nonadjacentReport = await report(page);

    expectSelectionCrossing(nonadjacentMotion);
    expect(nonadjacentReport).toMatchObject({
      selectedArtifactID: "artifact-c",
      filmstripPositionSame: false,
      selectionCalls: [
        { channelID: "channel-stage", artifactID: "artifact-a" },
        { channelID: "channel-stage", artifactID: "artifact-c" },
      ],
    });
    expectRetainedDocuments(nonadjacentReport);

    const adjacentDuration = adjacentMotion.webAnimations.find(({ kind }) => kind === "web-animation")?.duration;
    const nonadjacentDuration = nonadjacentMotion.webAnimations.find(({ kind }) => kind === "web-animation")?.duration;
    expect([adjacentDuration, nonadjacentDuration]).toEqual([
      CROSSING_DURATION_MS,
      CROSSING_DURATION_MS,
    ]);
  });
});

test.describe("stage channel redraw (^st-ac-channel-redraw)", () => {
  test("replaces the complete filmstrip and centres the arriving channel in one motionless paint", async ({ page }) => {
    await page.setViewportSize({ width: 1_200, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(FIXTURE);
    await waitForStage(page, true);
    await capture(page);

    const observation = await startMotionObservation(page, ".stage");
    const value = await replaceChannel(page);
    const motion = await observation.settle();

    expect(motion.transitionEvents).toEqual([]);
    expect(motion.animationEvents).toEqual([]);
    expect(motion.webAnimations).toEqual([]);
    expect(new Set(motion.scrollPositions).size).toBe(1);
    expect(value.keySamples.length).toBeGreaterThan(0);
    for (const keys of value.keySamples) {
      expect(keys).toEqual(["artifact-d", "artifact-e"]);
    }
    expect(value.frameSamples).toHaveLength(2);
    expect(value.frameSamples[0]).toEqual(value.frameSamples[1]);
    for (const sample of value.frameSamples) {
      expect(sample.keys).toEqual(["artifact-d", "artifact-e"]);
      expect(sample.animations).toBe(0);
      expect(sample.scrollLeft).toBeGreaterThan(0);
      expect(Math.abs(sample.geometry?.centerOffset ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
    }
    expect(value).toMatchObject({
      pageKeys: ["artifact-d", "artifact-e"],
      selectedArtifactID: "artifact-e",
      loads: {
        "artifact-a": 1,
        "artifact-b": 1,
        "artifact-c": 1,
        "artifact-d": 1,
        "artifact-e": 1,
      },
      states: ["initial:artifact-d", "initial:artifact-e"],
      oldNodesDetached: true,
      freshNodes: true,
    });
  });
});

test.describe("stage page sizing", () => {
  test("artifact menu owns both handle halves without blocking the uncovered strip (^st-ac-menu-over-handles)", async ({ page }) => {
    await page.setViewportSize({ width: 1_200, height: 700 });
    await page.goto(FIXTURE);
    await waitForStage(page);
    await settleStage(page);

    const selectedPage = page.locator(".page[selected]");
    const trigger = selectedPage.locator(".artifact-menu-trigger");
    const menu = selectedPage.locator("tv-menu");
    const item = menu.locator("tv-menu-item").first();
    await trigger.click();
    await expect(menu).toBeVisible();
    await settleStage(page);

    const points = await selectedPage.evaluate((selected) => {
      const menu = selected.querySelector("tv-menu[open]");
      const item = menu?.querySelector("tv-menu-item");
      const handle = selected.querySelector(".page-handle.right");
      if (!menu || !item || !handle) throw new Error("Expected an open menu item and right resize handle");
      const menuBox = menu.getBoundingClientRect();
      const itemBox = item.getBoundingClientRect();
      const handleBox = handle.getBoundingClientRect();
      const pageBox = selected.getBoundingClientRect();
      const innerLeft = Math.max(itemBox.left, handleBox.left, pageBox.left);
      const innerRight = Math.min(itemBox.right, handleBox.right, pageBox.right);
      const outerLeft = Math.max(itemBox.left, handleBox.left, pageBox.right);
      const outerRight = Math.min(itemBox.right, handleBox.right);
      const top = Math.max(itemBox.top, handleBox.top);
      const bottom = Math.min(itemBox.bottom, handleBox.bottom);
      if (innerRight <= innerLeft || outerRight <= outerLeft || bottom <= top) {
        throw new Error("Expected the menu item to overlap both halves of the right handle band");
      }
      const away = { x: (handleBox.left + pageBox.right) / 2, y: (handleBox.top + handleBox.bottom) / 2 };
      if (away.x >= menuBox.left && away.x <= menuBox.right && away.y >= menuBox.top && away.y <= menuBox.bottom) {
        throw new Error("Expected the inner-band point to be away from the open menu");
      }
      return {
        inner: { x: (innerLeft + innerRight) / 2, y: (top + bottom) / 2 },
        outer: { x: (outerLeft + outerRight) / 2, y: (top + bottom) / 2 },
        away,
      };
    });

    for (const point of [points.outer, points.inner]) {
      await page.mouse.move(point.x, point.y);
      const hit = await item.evaluate((item, { x, y }) => {
        const target = document.elementFromPoint(x, y);
        return {
          target: target === item ? "tv-menu-item" : target?.getAttribute("class") ?? target?.tagName,
          cursor: target ? getComputedStyle(target).cursor : null,
          menuCursor: getComputedStyle(item).cursor,
        };
      }, point);
      expect(hit.target).toBe("tv-menu-item");
      expect(hit.cursor).toBe(hit.menuCursor);
    }

    await page.mouse.move(points.away.x, points.away.y);
    await expect(menu).toBeVisible();
    const awayHit = await selectedPage.evaluate((selected, { x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target === selected.querySelector(".page-handle.right") ? "page-handle right" : target?.tagName;
    }, points.away);
    expect(awayHit).toBe("page-handle right");

    await page.mouse.move(points.inner.x, points.inner.y);
    await page.mouse.down();
    await expect(page.locator(".stage")).not.toHaveAttribute("resizing", "");
    await page.mouse.up();
    await expect(menu).toBeHidden();
    await expect(selectedPage).toHaveAttribute("full-screen", "");
    expect((await report(page)).pageUpdateCalls).toEqual([{
      channelID: "channel-stage",
      fullScreen: true,
      sizes: AUTHORED_PAGE_SIZES,
    }]);
  });

  test("renders fractional stored sizes through the shared factor without animating window tracking", async ({ page }) => {
    await page.setViewportSize({ width: 1_201, height: 821 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(FIXTURE);
    await waitForStage(page, true);
    await settleStage(page);

    const initial = await report(page);
    expectPageGeometry(initial, false);
    if (!initial.geometry) throw new Error("Expected initial page geometry");
    expect(Number.isInteger(Number.parseFloat(initial.geometry.inlinePage.width))).toBe(false);
    expect(Number.isInteger(Number.parseFloat(initial.geometry.inlinePage.height))).toBe(false);

    const tracking = await startMotionObservation(page, ".stage");
    await page.setViewportSize({ width: 1_001, height: 733 });
    const motion = await tracking.settle();
    await settleStage(page);
    const resized = await report(page);

    expect(motion.transitionEvents.filter(({ propertyName }) =>
      propertyName === "width" || propertyName === "height"
    )).toEqual([]);
    expect(motion.webAnimations.filter(({ kind }) => kind === "css-transition")).toEqual([]);
    expectPageGeometry(resized, false);

    const tinyTracking = await startMotionObservation(page, ".stage");
    await page.setViewportSize({ width: 220, height: 220 });
    const tinyMotion = await tinyTracking.settle();
    await settleStage(page);
    const tiny = await report(page);
    if (!tiny.geometry) throw new Error("Expected tiny-window page geometry");
    expect(tinyMotion.transitionEvents.filter(({ propertyName }) =>
      propertyName === "width" || propertyName === "height"
    )).toEqual([]);
    expect(tiny.geometry.page).toEqual(pageBox(tiny.geometry));
    expect(Math.abs(tiny.geometry.centerOffset)).toBeLessThan(1);
  });

  test("shows non-overlapping handles only on the selected page and commits the moved rendered axis", async ({ page }) => {
    await page.setViewportSize({ width: 1_200, height: 900 });
    await page.goto(FIXTURE);
    await waitForStage(page);
    await settleStage(page);
    const before = await report(page);
    if (!before.geometry) throw new Error("Expected initial page geometry");

    expect(before.handles).toEqual({
      selected: [
        "bottom page-handle",
        "bottom-left page-handle",
        "bottom-right page-handle",
        "left page-handle",
        "page-handle right",
        "page-handle top",
        "page-handle top-left",
        "page-handle top-right",
      ].sort(),
      backgroundCounts: [0, 0],
      controlOverlaps: [],
    });

    await beginResize(page, "right", { x: 37, y: 0 });
    const during = await report(page);
    if (!during.geometry) throw new Error("Expected live resize geometry");
    expectClose(during.geometry.page.width, before.geometry.page.width + 74);
    expectClose(during.geometry.page.height, before.geometry.page.height);
    expectClose(during.geometry.centerOffset, 0);
    expect(during.snapOutlined).toBe(false);

    await page.mouse.up();
    await settleStage(page);
    const committed = await report(page);
    expect(committed.pageUpdateCalls).toHaveLength(1);
    const sizes = committed.pageUpdateCalls[0]!.sizes;
    expect(sizes[0]).toEqual(AUTHORED_PAGE_SIZES[0]);
    expect(sizes[2]).toEqual(AUTHORED_PAGE_SIZES[2]);
    expect(sizes[1]!.height).toBe(AUTHORED_PAGE_SIZES[1]!.height);
    const box = pageBox(before.geometry);
    const widthFactor = 1 - 0.4 + 0.4 * box.width / 1_280;
    expectClose(
      sizes[1]!.width,
      (before.geometry.page.width + 74) / widthFactor,
      0.05,
    );
    expectPageGeometry(committed, false, sizes[1]);
  });

  test("holds an edge at both rendered bounds and resumes as soon as the pointer returns", async ({ page }) => {
    await page.setViewportSize({ width: 1_200, height: 900 });
    await page.goto(FIXTURE);
    await waitForStage(page);
    await settleStage(page);
    const before = await report(page);
    if (!before.geometry) throw new Error("Expected initial page geometry");

    const pointer = await beginResize(page, "right", { x: -1_000, y: 0 });
    let current = await report(page);
    if (!current.geometry) throw new Error("Expected minimum-bound geometry");
    expectClose(current.geometry.page.width, 230);

    await page.mouse.move(pointer.origin.x - 1_200, pointer.origin.y);
    current = await report(page);
    if (!current.geometry) throw new Error("Expected held minimum geometry");
    expectClose(current.geometry.page.width, 230);

    const minimumTravel = (230 - before.geometry.page.width) / 2;
    await page.mouse.move(pointer.origin.x + minimumTravel + 10, pointer.origin.y);
    current = await report(page);
    if (!current.geometry) throw new Error("Expected returned minimum geometry");
    expectClose(current.geometry.page.width, 250);

    await page.mouse.move(pointer.origin.x + 1_000, pointer.origin.y);
    current = await report(page);
    if (!current.geometry) throw new Error("Expected maximum-bound geometry");
    const box = pageBox(current.geometry);
    expectClose(current.geometry.page.width, box.width);

    await page.mouse.move(pointer.origin.x + 1_200, pointer.origin.y);
    current = await report(page);
    if (!current.geometry) throw new Error("Expected held maximum geometry");
    expectClose(current.geometry.page.width, box.width);

    const maximumTravel = (box.width - before.geometry.page.width) / 2;
    await page.mouse.move(pointer.origin.x + maximumTravel - 10, pointer.origin.y);
    current = await report(page);
    if (!current.geometry) throw new Error("Expected returned maximum geometry");
    expectClose(current.geometry.page.width, box.width - 20);
    await page.mouse.up();
  });

  for (const cancellation of ["Escape", "pointer cancellation", "capture loss", "page-box change"] as const) {
    test(`${cancellation} restores the settled size and commits no snap or layout update`, async ({ page }) => {
      await page.setViewportSize({ width: 1_200, height: 900 });
      await page.goto(FIXTURE);
      await waitForStage(page);
      await settleStage(page);
      const before = await report(page);
      if (!before.geometry) throw new Error("Expected initial page geometry");

      const pointer = await beginResize(page, "bottom-right", { x: 55, y: 35 });
      const moved = await report(page);
      if (!moved.geometry) throw new Error("Expected live resize geometry");
      expect(moved.geometry.page.width).not.toBe(before.geometry.page.width);
      expect(moved.geometry.page.height).not.toBe(before.geometry.page.height);

      if (cancellation === "Escape") {
        await page.keyboard.press("Escape");
      } else if (cancellation === "pointer cancellation") {
        await pointer.handle.evaluate((handle) => {
          handle.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
        });
      } else if (cancellation === "capture loss") {
        await pointer.handle.evaluate((handle) => {
          for (let pointerId = 1; pointerId <= 10; pointerId += 1) {
            if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          }
        });
      } else {
        await page.setViewportSize({ width: 1_100, height: 820 });
        await expect(page.locator(".stage")).not.toHaveAttribute("resizing", "");
      }
      await page.mouse.up();
      await settleStage(page);

      const restored = await report(page);
      expect(restored.pageUpdateCalls).toEqual([]);
      expect(restored.snapOutlined).toBe(false);
      expectPageGeometry(restored, false);
      if (cancellation !== "page-box change" && restored.geometry) {
        expectClose(restored.geometry.page.width, before.geometry.page.width);
        expectClose(restored.geometry.page.height, before.geometry.page.height);
      }
    });
  }

  test("Option suppresses a live corner magnet and armed release enters full-screen over the settled size", async ({ page }) => {
    await page.setViewportSize({ width: 1_200, height: 900 });
    await page.goto(FIXTURE);
    await waitForStage(page);
    await settleStage(page);
    const before = await report(page);
    if (!before.geometry) throw new Error("Expected initial page geometry");
    const box = pageBox(before.geometry);
    const delta = {
      x: (box.width - 63 - before.geometry.page.width) / 2,
      y: (box.height - 63 - before.geometry.page.height) / 2,
    };

    await beginResize(page, "bottom-right", delta);
    let current = await report(page);
    if (!current.geometry) throw new Error("Expected armed geometry");
    expect(current.snapOutlined).toBe(true);
    expectClose(current.geometry.page.width, box.width);
    expectClose(current.geometry.page.height, box.height);

    await page.keyboard.down("Alt");
    current = await report(page);
    if (!current.geometry) throw new Error("Expected suppressed geometry");
    expect(current.snapOutlined).toBe(false);
    expect(current.geometry.page.width).toBeLessThan(box.width);
    expect(current.geometry.page.height).toBeLessThan(box.height);

    await page.keyboard.up("Alt");
    current = await report(page);
    expect(current.snapOutlined).toBe(true);
    await page.mouse.up();
    await settleStage(page);

    const committed = await report(page);
    expectPageGeometry(committed, true);
    expect(committed.snapOutlined).toBe(false);
    expect(committed.pageUpdateCalls).toEqual([{
      channelID: "channel-stage",
      fullScreen: true,
      sizes: AUTHORED_PAGE_SIZES,
    }]);
  });

  test.describe("full-screen handle drag", () => {
    test("leaves the mode from the page-box edge and releases one combined size-and-mode update", async ({ page }) => {
      await page.setViewportSize({ width: 1_200, height: 900 });
      await page.goto(FIXTURE);
      await waitForStage(page);
      await settleStage(page);
      const fullScreen = await enterFullScreen(page);
      if (!fullScreen.geometry) throw new Error("Expected full-screen geometry");

      expect(fullScreen.handles.selected).toHaveLength(8);
      const box = pageBox(fullScreen.geometry);
      const pointer = await beginResize(page, "right", { x: -43, y: 0 });
      const during = await report(page);
      if (!during.geometry) throw new Error("Expected live full-screen resize geometry");
      expect(during.selectedFullScreen).toBe(false);
      expectClose(during.geometry.page.width, box.width - 86);
      expectClose(during.geometry.page.height, box.height);
      expectClose(during.geometry.centerOffset, 0);
      const livePageBox = await page.locator(".page[selected]").boundingBox();
      if (!livePageBox) throw new Error("Expected the live resized page box");
      expectClose(livePageBox.x + livePageBox.width, pointer.origin.x - 43);
      expect(during.pageUpdateCalls).toHaveLength(1);

      await page.mouse.up();
      await settleStage(page);
      const committed = await report(page);
      expect(committed.pageUpdateCalls).toHaveLength(2);
      const update = committed.pageUpdateCalls[1]!;
      expect(update.channelID).toBe("channel-stage");
      expect(update.fullScreen).toBe(false);
      expect(update.sizes[0]).toEqual(AUTHORED_PAGE_SIZES[0]);
      expect(update.sizes[2]).toEqual(AUTHORED_PAGE_SIZES[2]);
      const widthFactor = 1 - 0.4 + 0.4 * box.width / 1_280;
      const heightFactor = 1 - 0.4 + 0.4 * box.height / 800;
      expectClose(update.sizes[1]!.width, (box.width - 86) / widthFactor, 0.05);
      expectClose(update.sizes[1]!.height, box.height / heightFactor, 0.05);
      expectPageGeometry(committed, false, update.sizes[1]);
    });

    test("Escape restores full-screen and leaves its beneath-size untouched", async ({ page }) => {
      await page.setViewportSize({ width: 1_200, height: 900 });
      await page.goto(FIXTURE);
      await waitForStage(page);
      await settleStage(page);
      const ordinary = await report(page);
      if (!ordinary.geometry) throw new Error("Expected ordinary geometry");
      await enterFullScreen(page);

      await beginResize(page, "bottom-right", { x: -55, y: -35 });
      expect((await report(page)).selectedFullScreen).toBe(false);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await settleStage(page);

      const restored = await report(page);
      expectPageGeometry(restored, true);
      expect(restored.pageUpdateCalls).toHaveLength(1);

      await page.locator('.tab[aria-selected="true"]').dblclick();
      await settleStage(page);
      const exited = await report(page);
      expectPageGeometry(exited, false);
      if (!exited.geometry) throw new Error("Expected ordinary geometry after exit");
      expectClose(exited.geometry.page.width, ordinary.geometry.page.width);
      expectClose(exited.geometry.page.height, ordinary.geometry.page.height);
    });

    test("a moveless handle press leaves full-screen and shared layout unchanged", async ({ page }) => {
      await page.setViewportSize({ width: 1_200, height: 900 });
      await page.goto(FIXTURE);
      await waitForStage(page);
      await settleStage(page);
      const fullScreen = await enterFullScreen(page);
      const pointer = await resizePointer(page, "right");

      await page.mouse.move(pointer.origin.x, pointer.origin.y);
      await page.mouse.down();
      await page.mouse.up();
      await settleStage(page);

      const unchanged = await report(page);
      expectPageGeometry(unchanged, true);
      expect(unchanged.geometry).toEqual(fullScreen.geometry);
      expect(unchanged.pageUpdateCalls).toHaveLength(1);
    });

    test("a corner dragged back into the arm zone re-enters over the original beneath-size", async ({ page }) => {
      await page.setViewportSize({ width: 1_200, height: 900 });
      await page.goto(FIXTURE);
      await waitForStage(page);
      await settleStage(page);
      await enterFullScreen(page);

      const pointer = await beginResize(page, "bottom-right", { x: -55, y: -45 });
      let current = await report(page);
      expect(current.selectedFullScreen).toBe(false);
      expect(current.snapOutlined).toBe(false);

      await page.mouse.move(pointer.origin.x - 10, pointer.origin.y - 10);
      current = await report(page);
      expect(current.selectedFullScreen).toBe(false);
      expect(current.snapOutlined).toBe(true);
      await page.mouse.up();
      await settleStage(page);

      const reentered = await report(page);
      expectPageGeometry(reentered, true);
      expect(reentered.pageUpdateCalls).toHaveLength(2);
      expect(reentered.pageUpdateCalls[1]).toEqual({
        channelID: "channel-stage",
        fullScreen: true,
        sizes: AUTHORED_PAGE_SIZES,
      });
    });
  });
});

test.describe("stage full-screen motion (^st-ac-fullscreen)", () => {
  test("selected-tab double-click morphs between centred stored-size rendering at two window sizes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(FIXTURE);
    await waitForStage(page, true);

    for (const viewport of [
      { width: 1_200, height: 900 },
      { width: 640, height: 480 },
    ]) {
      const resizeMotion = await startMotionObservation(page, ".stage");
      await page.setViewportSize(viewport);
      await resizeMotion.settle();
      await settleStage(page);
      const ordinary = await report(page);
      expectPageGeometry(ordinary, false);
      if (!ordinary.geometry) throw new Error("Expected ordinary page geometry");

      const entryMotion = await startMotionObservation(page, ".stage");
      await startGeometryObservation(page);
      await page.locator('.tab[aria-selected="true"]').dblclick();
      const entered = await entryMotion.settle({ requireMotion: true, maxFrames: 120 });
      const entrySamples = await finishGeometryObservation(page);
      const fullScreen = await report(page);
      if (!fullScreen.geometry) throw new Error("Expected full-screen page geometry");

      expectPageSizeTransition(entered, ordinary.geometry, fullScreen.geometry);
      expectCentredSamples(entrySamples);
      expectPageGeometry(fullScreen, true);

      const exitMotion = await startMotionObservation(page, ".stage");
      await startGeometryObservation(page);
      await page.locator('.tab[aria-selected="true"]').dblclick();
      const exited = await exitMotion.settle({ requireMotion: true, maxFrames: 120 });
      const exitSamples = await finishGeometryObservation(page);
      const restored = await report(page);
      if (!restored.geometry) throw new Error("Expected restored ordinary page geometry");

      expectPageSizeTransition(exited, fullScreen.geometry, restored.geometry);
      expectCentredSamples(exitSamples);
      expectPageGeometry(restored, false);
    }

    expect((await report(page)).pageUpdateCalls).toEqual([
      { channelID: "channel-stage", fullScreen: true, sizes: AUTHORED_PAGE_SIZES },
      { channelID: "channel-stage", fullScreen: false, sizes: AUTHORED_PAGE_SIZES },
      { channelID: "channel-stage", fullScreen: true, sizes: AUTHORED_PAGE_SIZES },
      { channelID: "channel-stage", fullScreen: false, sizes: AUTHORED_PAGE_SIZES },
    ]);
  });
});

test.describe("stage selection-only input (^st-ac-selection-only)", () => {
  test("wheel, Shift-wheel, and swipe-like ground input leave selection and documents unchanged", async ({ page }) => {
    await page.goto(FIXTURE);
    await waitForStage(page);
    await capture(page);
    const observation = await startMotionObservation(page, ".stage");

    const stage = page.locator(".stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("Expected stage box");
    const groundX = box.x + 8;
    const groundY = box.y + box.height - 4;

    await page.mouse.move(groundX, groundY);
    await page.mouse.wheel(240, 0);

    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 240);
    await page.keyboard.up("Shift");

    await page.mouse.move(groundX, groundY);
    await page.mouse.down();
    await page.mouse.move(groundX + 180, groundY, { steps: 8 });
    await page.mouse.up();
    const motion = await observation.settle();

    expect(motion.transitionEvents).toEqual([]);
    expect(motion.animationEvents).toEqual([]);
    expect(motion.scrollEvents).toBe(0);
    expect(motion.scrollEndEvents).toBe(0);
    const value = await report(page);
    expect(value).toMatchObject({
      selectedArtifactID: "artifact-b",
      filmstripPositionSame: true,
      selectionCalls: [],
    });
    expectRetainedDocuments(value);
  });
});
