import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  configureTestMotion,
  pressAndReleaseWithoutPointerMove,
  startMotionObservation,
} from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/channel-sidebar.html";
const RESEARCH_ID = "01J00000000000000000000008";
const DESIGN_ID = "01J00000000000000000000004";
const OPERATIONS_ID = "01J00000000000000000000002";
const READING_ID = "01J00000000000000000000005";
const PLANNING_ID = "01J00000000000000000000003";
const ALL_CHANNEL_IDS = [
  PLANNING_ID,
  "01J00000000000000000000012",
  READING_ID,
  RESEARCH_ID,
  "01J00000000000000000000011",
  DESIGN_ID,
  "01J00000000000000000000010",
  "01J00000000000000000000009",
  "01J00000000000000000000007",
  "01J00000000000000000000006",
  OPERATIONS_ID,
  "01J00000000000000000000001",
  "01J00000000000000000000013",
  "01J00000000000000000000014",
  "01J00000000000000000000015",
  "01J00000000000000000000016",
  "01J00000000000000000000017",
  "01J00000000000000000000018",
] as const;

interface SidebarScrollFrameSample {
  readonly timestamp: number;
  readonly scrollTop: number;
  readonly placeholderIndex: number | null;
}

interface SidebarOperations {
  focus: string[];
  pinned: string[][];
  rename: Array<{ channelId: string; name: string }>;
  create: number;
  delete: string[];
}

interface SidebarReport {
  operations: SidebarOperations;
  focusedChannelId: string;
  pinnedChannelIds: string[];
  pageSame: boolean;
  viewSame: boolean;
  frameSame: boolean;
  windowSame: boolean;
  value: string | null;
  frameScrollY: number | null;
  counterAdvanced: boolean;
  loads: number;
  drag: {
    carriedId: string | null;
    carriedSame: boolean;
    carriedRect: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    } | null;
    placeholder: { side: string; index: number } | null;
    action: string | null;
    visibleGroups: string[];
    scrollTop: number | null;
    selectedId: string | null;
    restorationAnimations: number;
  };
  capture: {
    activePointerId: number | null;
    acquired: number[];
    lost: number[];
  };
}

declare global {
  interface Window {
    __fixtureReady?: boolean;
    __channelSidebarDocumentReady?: boolean;
    __channelSidebarFixture: {
      reset(): void;
      setState(channelIds: string[], pinnedIds: string[], focusedId: string): Promise<void>;
      captureDragRow(channelId: string): void;
      rejectNextCreate(): void;
      rejectNextDelete(): void;
      rejectNextPinList(): void;
      remoteRename(channelId: string, name: string): void;
      remotePinOrder(channelIds: string[]): void;
      captureStage(): void;
      report(): SidebarReport;
    };
  }
}

async function openFixture(page: Page, allowCSSMotion = false): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);
  await configureTestMotion(page, { allowCSSMotion });
}

function channelRow(page: Page, name: string): Locator {
  return page.locator(".channel-row").filter({
    has: page.getByRole("option", { name, exact: true }),
  });
}

async function report(page: Page): Promise<SidebarReport> {
  return page.evaluate(() => window.__channelSidebarFixture.report());
}

async function scrollList(page: Page, top: number): Promise<number> {
  return page.locator(".sidebar-body").evaluate((element, target) =>
    new Promise<number>((resolve) => {
      const body = element as HTMLElement;
      if (body.scrollTop === target) {
        resolve(body.scrollTop);
        return;
      }
      body.addEventListener("scroll", () => resolve(body.scrollTop), { once: true });
      body.scrollTop = target;
    }), top);
}

async function sampleSidebarScrollFrames(
  page: Page,
  frameCount: number,
): Promise<SidebarScrollFrameSample[]> {
  return page.evaluate((count) => new Promise((resolve) => {
    const samples: SidebarScrollFrameSample[] = [];
    const sample = (timestamp: number): void => {
      const body = document.querySelector<HTMLElement>(".sidebar-body");
      if (!body) throw new Error("Expected a rendered channel sidebar body");
      const placeholder = document.querySelector<HTMLElement>(
        ".channel-group:not(.channel-group-withdrawal) .channel-placeholder",
      );
      samples.push({
        timestamp,
        scrollTop: body.scrollTop,
        placeholderIndex: placeholder === null
          ? null
          : Number(placeholder.dataset.channelIndex),
      });
      if (samples.length >= count) {
        resolve(samples);
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  }), frameCount);
}

function sidebarScrollVelocity(
  samples: readonly SidebarScrollFrameSample[],
  maximumScrollTop?: number,
): number {
  const movingSamples = maximumScrollTop === undefined
    ? samples
    : samples.filter(({ scrollTop }) =>
        scrollTop > 0.5 && scrollTop < maximumScrollTop - 0.5
      );
  const first = movingSamples[0];
  const last = movingSamples.at(-1);
  if (!first || !last || first.timestamp === last.timestamp) {
    throw new Error("Expected distinct sidebar animation-frame scroll samples");
  }
  return (last.scrollTop - first.scrollTop) /
    (last.timestamp - first.timestamp) * 1_000;
}

function expectSidebarVelocityNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(Math.abs(expected) * 0.2);
}

async function waitForPlaceholderIndex(
  page: Page,
  minimumIndex: number,
): Promise<SidebarScrollFrameSample> {
  return page.evaluate((target) => new Promise((resolve, reject) => {
    let frames = 0;
    const sample = (timestamp: number): void => {
      const body = document.querySelector<HTMLElement>(".sidebar-body");
      const placeholder = document.querySelector<HTMLElement>(
        ".channel-group:not(.channel-group-withdrawal) .channel-placeholder",
      );
      if (!body || !placeholder) {
        reject(new Error("Expected sidebar body and live drag placeholder"));
        return;
      }
      const placeholderIndex = Number(placeholder.dataset.channelIndex);
      const result = { timestamp, scrollTop: body.scrollTop, placeholderIndex };
      if (placeholderIndex >= target) {
        resolve(result);
        return;
      }
      frames += 1;
      if (frames >= 180) {
        reject(new Error(
          `Sidebar placeholder did not reach index ${target} within ${frames} frames`,
        ));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), minimumIndex);
}

async function beginChannelDrag(
  page: Page,
  channelName: string,
): Promise<{ pointerId: number; start: { x: number; y: number } }> {
  const button = page.getByRole("option", { name: channelName, exact: true });
  const acquiredBefore = (await report(page)).capture.acquired.length;
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error(`${channelName} row has no box`);
  const start = {
    x: box.x + box.width - 44,
    y: box.y + box.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y);
  await expect.poll(async () => (await report(page)).capture.acquired.length)
    .toBe(acquiredBefore + 1);
  const pointerId = (await report(page)).capture.acquired.at(-1);
  if (pointerId === undefined) throw new Error("Sidebar did not acquire pointer capture");
  expect(await page.locator(".sidebar").evaluate(
    (element, id) => element.hasPointerCapture(id),
    pointerId,
  )).toBe(true);
  const grip = await page.locator(".sidebar").evaluate((element) => ({
    previewOffsetX: Number.parseFloat(
      (element as HTMLElement).style.getPropertyValue("--channel-sidebar-drag-grip-x"),
    ),
    correctionX: Number.parseFloat(
      (element as HTMLElement).style.getPropertyValue(
        "--channel-sidebar-drag-grip-correction-x",
      ),
    ),
  }));
  expect(grip.previewOffsetX).toBeGreaterThan(0);
  expect(grip.correctionX).toBeGreaterThan(0);
  return { pointerId, start };
}

async function moveToPinnedSlot(
  page: Page,
  index: number,
): Promise<{ x: number; y: number }> {
  const sidebar = await page.locator(".sidebar").boundingBox();
  const rows = await page.locator(
    '[data-channel-side="pinned"] .channel-row:not(.dragged)',
  ).evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  }));
  if (!sidebar || rows.length === 0 || index < 0 || index > rows.length) {
    throw new Error(`Pinned slot ${index} has no complete geometry`);
  }
  const y = index === rows.length
    ? rows[rows.length - 1]!.bottom - 1
    : rows[index]!.top + 1;
  return { x: sidebar.x + 80, y };
}

async function moveAndSettleDrag(
  page: Page,
  point: { x: number; y: number },
  placeholder: { side: "pinned" | "unpinned"; index: number } | null,
  { withdrawingPlaceholder = false }: { withdrawingPlaceholder?: boolean } = {},
) {
  const motion = await startMotionObservation(page, ".sidebar");
  await page.mouse.move(point.x, point.y);
  await expect.poll(async () => (await report(page)).drag.placeholder).toEqual(placeholder);
  if (withdrawingPlaceholder) {
    await expect.poll(
      () => page.locator(".channel-group-withdrawal .channel-placeholder").count(),
      { intervals: [30, 30, 30, 30, 30, 30] },
    ).toBe(1);
  }
  const result = await motion.settle({ requireMotion: true });
  expect(result.webAnimations).toContainEqual({
    duration: 200,
    finished: true,
    kind: "web-animation",
  });
  return result;
}

async function dispatchPointerTermination(
  page: Page,
  type: "pointercancel" | "lostpointercapture",
  pointerId: number,
): Promise<void> {
  await page.locator(".sidebar").evaluate((element, value) => {
    element.dispatchEvent(new PointerEvent(value.type, {
      bubbles: true,
      pointerId: value.pointerId,
    }));
  }, { type, pointerId });
}

async function openRename(page: Page, channelName: string): Promise<Locator> {
  const row = channelRow(page, channelName);
  await row.getByTitle(`${channelName} menu`, { exact: true }).click();
  const menu = page.locator("tv-menu[open]");
  await expect(menu).toBeVisible();
  await menu.locator("tv-menu-item").filter({ hasText: /^Rename$/ }).click();
  const field = page.getByRole("textbox", { name: "Channel name" });
  await expect(field).toBeFocused();
  await expect.poll(() => field.evaluate((input: HTMLInputElement) => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    length: input.value.length,
  }))).toEqual({ start: 0, end: "Reading list".length, length: "Reading list".length });
  return field;
}

async function resetFixture(page: Page): Promise<void> {
  await page.evaluate(() => window.__channelSidebarFixture.reset());
  await expect(page.getByRole("option", { name: "Reading list", exact: true })).toBeVisible();
}

async function openDeleteConfirmation(page: Page, channelName: string): Promise<Locator> {
  const row = channelRow(page, channelName);
  await row.getByTitle(`${channelName} menu`, { exact: true }).click();
  await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Delete$/ }).click();
  const alert = page.getByRole("alertdialog", { name: `Delete “${channelName}”?` });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    "This will permanently delete this channel from Television.",
  );
  await expect(alert.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  return alert;
}

test.describe("channel sidebar row motion (^sb-ac-row-motion)", () => {
  test("defers acknowledged row growth until the sidebar envelope settles", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openFixture(page, true);

    const collapseMotion = await startMotionObservation(page, "#app");
    await page.locator(".sidebar-collapse").click();
    await collapseMotion.settle({ requireMotion: true });
    await expect(page.locator(".sidebar-expand")).toBeVisible();

    const inFlight = await page.evaluate(async () => {
      interface DeferredRowMotion {
        readonly duration: number;
        readonly finished: boolean;
      }
      const owner = window as unknown as {
        __deferredRowMotion?: Promise<DeferredRowMotion>;
      };
      const root = document.querySelector<HTMLElement>("#app");
      const expand = root?.querySelector<HTMLButtonElement>(".sidebar-expand");
      if (!root || !expand) throw new Error("Collapsed shell is not ready");
      let resolveRowMotion!: (result: DeferredRowMotion) => void;
      owner.__deferredRowMotion = new Promise((resolve) => {
        resolveRowMotion = resolve;
      });
      let observedRowAnimation: Animation | null = null;
      const observeDeferredMotion = (): void => {
        const row = root.querySelector<HTMLElement>(
          '.channel-row[data-channel-id="01J00000000000000000000019"]',
        );
        const animation = row?.getAnimations().find((candidate) =>
          Number(candidate.effect?.getTiming().duration) === 200
        );
        if (animation && animation !== observedRowAnimation) {
          observedRowAnimation = animation;
          const duration = Number(animation.effect?.getTiming().duration);
          void animation.finished.then(
            () => resolveRowMotion({ duration, finished: true }),
            () => resolveRowMotion({ duration, finished: false }),
          );
          return;
        }
        requestAnimationFrame(observeDeferredMotion);
      };
      requestAnimationFrame(observeDeferredMotion);
      expand.click();
      const create = root.querySelector<HTMLButtonElement>(".channel-create");
      if (!create) throw new Error("In-flight sidebar did not render its create control");
      create.click();

      for (let frame = 0; frame < 30; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const row = root.querySelector<HTMLElement>(
          '.channel-row[data-channel-id="01J00000000000000000000019"]',
        );
        if (root.hasAttribute("data-sidebar-transition") && row) {
          return {
            renameFields: row.querySelectorAll(".channel-rename").length,
            animations: root.getAnimations({ subtree: true }).map((animation) => ({
              id: animation.id,
              target: (animation.effect as KeyframeEffect | null)?.target === root
                ? "root"
                : "descendant",
            })),
          };
        }
      }
      throw new Error("Acknowledged row was not observed during the sidebar envelope");
    });

    expect(inFlight.renameFields).toBe(0);
    expect(inFlight.animations).toEqual([{
      id: "sidebar-collapse-boundary",
      target: "root",
    }]);
    expect(await page.evaluate(() =>
      (window as unknown as {
        __deferredRowMotion?: Promise<{ duration: number; finished: boolean }>;
      }).__deferredRowMotion
    )).toEqual({ duration: 200, finished: true });
    await expect(page.getByRole("textbox", { name: "Channel name" })).toBeFocused();
  });

  test("creates into rename after growth and dismisses or confirms native deletion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openFixture(page, true);

    const firstRecentRow = page.getByRole("option", { name: "Interviews", exact: true });
    const firstRecentTopBefore = await firstRecentRow.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    const createMotion = await startMotionObservation(page, ".sidebar");
    const createButton = page.locator(".channel-create");
    const createdField = page.getByRole("textbox", { name: "Channel name" });
    await page.evaluate(() => {
      interface CreateMotionProbe {
        frames: number;
        observed: boolean;
      }
      const owner = window as unknown as {
        __channelSidebarCreateMotion?: CreateMotionProbe;
      };
      const probe: CreateMotionProbe = { frames: 0, observed: false };
      owner.__channelSidebarCreateMotion = probe;
      const sample = (): void => {
        const row = document.querySelector<HTMLElement>(
          '[data-channel-side="unpinned"] .channel-row',
        );
        const button = document.querySelector<HTMLButtonElement>(".channel-create");
        const growing = row?.getAnimations().some(
          ({ playState }) => playState === "running",
        ) ?? false;
        const renameFields = row?.querySelectorAll(".channel-rename").length ?? 0;
        if (growing && renameFields === 0 && button?.disabled) {
          probe.observed = true;
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return;
        }
        probe.frames += 1;
        if (probe.frames < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await createButton.click();
    const createSettlement = createMotion.settle({ requireMotion: true });
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as {
        __channelSidebarCreateMotion?: { observed: boolean };
      }).__channelSidebarCreateMotion?.observed ?? false
    )).toBe(true);
    expect((await report(page)).operations.create).toBe(1);
    await expect(createdField).toBeFocused();
    await expect.poll(() => createdField.evaluate((input: HTMLInputElement) => ({
      start: input.selectionStart,
      end: input.selectionEnd,
      value: input.value,
    }))).toEqual({ start: 0, end: "New channel".length, value: "New channel" });
    const createReport = await createSettlement;
    expect(createReport.webAnimations).toContainEqual({
      duration: 200,
      finished: true,
      kind: "web-animation",
    });
    expect(await firstRecentRow.evaluate((element) => element.getBoundingClientRect().top))
      .toBeGreaterThan(firstRecentTopBefore);
    await expect(
      page.locator('[data-channel-side="unpinned"] .channel-row').first()
        .getByRole("textbox", { name: "Channel name" }),
    ).toBeVisible();
    expect((await report(page)).operations.create).toBe(1);

    await createdField.fill("Created in sidebar");
    await createdField.press("Enter");
    await expect(page.getByRole("option", { name: "Created in sidebar", exact: true }))
      .toHaveAttribute("aria-selected", "true");

    let alert = await openDeleteConfirmation(page, "Created in sidebar");
    await alert.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole("option", { name: "Created in sidebar", exact: true }))
      .toBeVisible();
    expect((await report(page)).operations.delete).toEqual([]);

    alert = await openDeleteConfirmation(page, "Created in sidebar");
    await page.mouse.click(4, 4);
    await expect(alert).toBeHidden();
    await expect(page.getByRole("option", { name: "Created in sidebar", exact: true }))
      .toBeVisible();
    expect((await report(page)).operations.delete).toEqual([]);

    alert = await openDeleteConfirmation(page, "Created in sidebar");
    await page.keyboard.press("Escape");
    await expect(alert).toBeHidden();
    await expect(page.getByRole("option", { name: "Created in sidebar", exact: true }))
      .toBeVisible();
    expect((await report(page)).operations.delete).toEqual([]);

    alert = await openDeleteConfirmation(page, "Created in sidebar");
    const nextRow = page.getByRole("option", { name: "Interviews", exact: true });
    const nextTopBefore = await nextRow.evaluate((element) => element.getBoundingClientRect().top);
    const deleteMotion = await startMotionObservation(page, ".sidebar");
    await alert.getByRole("button", { name: "Delete", exact: true }).click();
    const deleteReport = await deleteMotion.settle({ requireMotion: true });
    expect(deleteReport.webAnimations).toContainEqual({
      duration: 200,
      finished: true,
      kind: "web-animation",
    });
    await expect(page.getByRole("option", { name: "Created in sidebar", exact: true }))
      .toHaveCount(0);
    expect(await nextRow.evaluate((element) => element.getBoundingClientRect().top))
      .toBeLessThan(nextTopBefore);
    expect((await report(page)).operations.delete).toEqual([
      "01J00000000000000000000019",
    ]);
  });

  test("definitive create and delete rejection leave the rendered server truth", async ({ page }) => {
    await openFixture(page);

    await page.evaluate(() => window.__channelSidebarFixture.rejectNextCreate());
    await page.getByRole("button", { name: "New channel", exact: true }).click();
    await expect.poll(async () => (await report(page)).operations.create).toBe(1);
    await expect(page.getByRole("textbox", { name: "Channel name" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New channel", exact: true })).toBeEnabled();

    await page.evaluate(() => window.__channelSidebarFixture.rejectNextDelete());
    const alert = await openDeleteConfirmation(page, "Reading list");
    await alert.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(async () => (await report(page)).operations.delete).toEqual([READING_ID]);
    await expect(page.getByRole("option", { name: "Reading list", exact: true })).toBeVisible();
  });
});

test.describe("channel sidebar shared scrolling (^sb-ac-scroll)", () => {
  test("both groups move in one list and repaints preserve its continuation state", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 520 });
    await openFixture(page);

    const body = page.locator(".sidebar-body");
    expect(await page.locator(".channel-group").count()).toBe(2);
    expect(await page.locator(".sidebar-body > .channel-list > .channel-group").count()).toBe(2);
    expect(await scrollList(page, 140)).toBeGreaterThan(0);
    await expect(body).toHaveAttribute("continues-start", "");

    const before = await body.evaluate((element) => element.scrollTop);
    await page.evaluate(() => {
      window.__channelSidebarFixture.remoteRename(
        "01J00000000000000000000001",
        "Archived work",
      );
    });
    await expect(page.getByRole("option", { name: "Archived work", exact: true })).toBeAttached();
    expect(await body.evaluate((element) => element.scrollTop)).toBe(before);
    await expect(body).toHaveAttribute("continues-start", "");

    expect(await scrollList(page, 0)).toBe(0);
    await expect(body).not.toHaveAttribute("continues-start");
  });
});

test.describe("channel sidebar base selection and menus", () => {
  test("activates from click when only pointerup carries beyond-threshold displacement", async ({ page }) => {
    await openFixture(page);

    const reading = page.getByRole("option", { name: "Reading list", exact: true });
    const readingBox = await reading.boundingBox();
    if (!readingBox) throw new Error("Reading-list row has no box");
    const start = {
      x: readingBox.x + readingBox.width / 2,
      y: readingBox.y + readingBox.height / 2,
    };

    await page.evaluate(() => {
      window.addEventListener("pointerup", () => {
        document.body.dataset.focusCallsAtPointerUp = String(
          window.__channelSidebarFixture.report().operations.focus.length,
        );
      }, { once: true });
      window.addEventListener("click", () => {
        document.body.dataset.focusCallsAtClick = String(
          window.__channelSidebarFixture.report().operations.focus.length,
        );
      }, { once: true });
    });

    await pressAndReleaseWithoutPointerMove(
      page,
      start,
      { x: start.x + 8, y: start.y },
    );

    await expect(page.locator("body")).toHaveAttribute("data-focus-calls-at-pointer-up", "0");
    await expect(page.locator("body")).toHaveAttribute("data-focus-calls-at-click", "1");
    expect((await report(page)).operations.focus).toEqual([READING_ID]);
    expect((await report(page)).capture.acquired).toEqual([]);
  });

  test("channel options preserve keyboard activation and singular selection", async ({ page }) => {
    await openFixture(page);
    const list = page.getByRole("listbox", { name: "Channels", exact: true });
    const reading = list.getByRole("option", { name: "Reading list", exact: true });
    await reading.press("Enter");
    await expect.poll(async () => (await report(page)).operations.focus).toEqual([READING_ID]);
    await expect(reading).toHaveAttribute("aria-selected", "true");
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
    const planning = list.getByRole("option", { name: "Planning", exact: true });
    await planning.press("Space");
    await expect(planning).toHaveAttribute("aria-selected", "true");
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  });

  test("release over another row or outside the sidebar activates no channel", async ({ page }) => {
    await openFixture(page);

    const reading = page.getByRole("option", { name: "Reading list", exact: true });
    const planning = page.getByRole("option", { name: "Planning", exact: true });
    const sidebar = page.locator(".sidebar");
    const readingBox = await reading.boundingBox();
    const planningBox = await planning.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    if (!readingBox || !planningBox || !sidebarBox) {
      throw new Error("Expected channel and sidebar boxes");
    }
    const readingCentre = {
      x: readingBox.x + readingBox.width / 2,
      y: readingBox.y + readingBox.height / 2,
    };

    await pressAndReleaseWithoutPointerMove(page, readingCentre, {
      x: planningBox.x + planningBox.width / 2,
      y: planningBox.y + planningBox.height / 2,
    });
    await pressAndReleaseWithoutPointerMove(page, readingCentre, {
      x: sidebarBox.x + sidebarBox.width + 20,
      y: readingCentre.y,
    });

    expect((await report(page)).operations.focus).toEqual([]);
  });

  test("focuses on an ordinary click and pins through row menus", async ({ page }) => {
    await openFixture(page);

    const reading = page.getByRole("option", { name: "Reading list", exact: true });
    const readingBox = await reading.boundingBox();
    if (!readingBox) throw new Error("Reading-list row has no box");
    const x = readingBox.x + readingBox.width - 44;
    const y = readingBox.y + readingBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    expect((await report(page)).operations.focus).toEqual([]);
    await page.mouse.move(x + 3, y);
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.focus).toEqual([READING_ID]);
    await expect(reading).toHaveAttribute("aria-selected", "true");

    const planning = page.getByRole("option", { name: "Planning", exact: true });
    const planningBox = await planning.boundingBox();
    if (!planningBox) throw new Error("Planning row has no box");
    await page.mouse.move(planningBox.x + 30, planningBox.y + planningBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(planningBox.x + 40, planningBox.y + planningBox.height / 2);
    await page.mouse.up();
    expect((await report(page)).operations.focus).toEqual([READING_ID]);

    const readingRow = channelRow(page, "Reading list");
    await readingRow.getByTitle("Reading list menu", { exact: true }).click();
    await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Pin$/ }).click();
    await expect.poll(async () => (await report(page)).pinnedChannelIds).toEqual([
      DESIGN_ID,
      RESEARCH_ID,
      OPERATIONS_ID,
      READING_ID,
    ]);

    const pinnedReadingRow = channelRow(page, "Reading list");
    await pinnedReadingRow.getByTitle("Reading list menu", { exact: true }).click();
    await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Unpin$/ }).click();
    await expect.poll(async () => (await report(page)).pinnedChannelIds).toEqual([
      DESIGN_ID,
      RESEARCH_ID,
      OPERATIONS_ID,
    ]);
    expect((await report(page)).operations.pinned).toEqual([
      [DESIGN_ID, RESEARCH_ID, OPERATIONS_ID, READING_ID],
      [DESIGN_ID, RESEARCH_ID, OPERATIONS_ID],
    ]);
  });
});

test.describe("channel sidebar rendered drag choreography (^sb-ac-drag)", () => {
  test("withdrawal clones stay inert for row geometry, motion, and document identity", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await openFixture(page, true);
    await page.evaluate(async ({ reading, design, research }) => {
      await window.__channelSidebarFixture.setState(
        [reading, design, research],
        [design, research],
        reading,
      );

      const owner = window as unknown as {
        __channelSidebarCloneAttributes: Array<{
          kind: "preview" | "withdrawal";
          ids: number;
          popoverTargets: number;
        }>;
        __channelSidebarRowAnimations: Array<{
          channelId: string | null;
          withdrawal: boolean;
        }>;
        __channelSidebarWithdrawalClone: Element | null;
      };
      owner.__channelSidebarCloneAttributes = [];
      owner.__channelSidebarRowAnimations = [];
      owner.__channelSidebarWithdrawalClone = null;
      const append = Element.prototype.append;
      Element.prototype.append = function (...nodes) {
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          const kind = node.matches(".channel-group-withdrawal")
            ? "withdrawal"
            : node.matches(".channel-row.dragged")
            ? "preview"
            : null;
          if (kind === null) continue;
          if (kind === "withdrawal") owner.__channelSidebarWithdrawalClone = node;
          owner.__channelSidebarCloneAttributes.push({
            kind,
            ids: Number(node.hasAttribute("id")) + node.querySelectorAll("[id]").length,
            popoverTargets: Number(node.hasAttribute("trigger")) +
              node.querySelectorAll("[trigger]").length,
          });
        }
        append.apply(this, nodes);
      };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const animation = animate.call(this, keyframes, options);
        if (this.matches(".channel-group-withdrawal")) animation.pause();
        if (this.matches(".channel-row")) {
          owner.__channelSidebarRowAnimations.push({
            channelId: this.getAttribute("data-channel-id"),
            withdrawal: this.closest(".channel-group-withdrawal") !== null,
          });
        }
        return animation;
      };
    }, { reading: READING_ID, design: DESIGN_ID, research: RESEARCH_ID });
    await expect(page.getByRole("option", { name: "Reading list", exact: true }))
      .toBeVisible();

    await beginChannelDrag(page, "Reading list");
    await page.locator(
      '.channel-group[data-channel-side="unpinned"]:not(.channel-group-withdrawal)',
    ).evaluate((group, channelId) => {
      const liveRow = document.querySelector<HTMLElement>(
        `.channel-group:not(.channel-group-withdrawal) ` +
          `.channel-row[data-channel-id="${channelId}"]`,
      );
      if (liveRow === null) throw new Error("Expected a live row to seed the withdrawal clone");
      const staleRow = liveRow.cloneNode(true) as HTMLElement;
      staleRow.dataset.channelId = "withdrawal-stale-row";
      group.append(staleRow);
    }, DESIGN_ID);
    const pinnedSlot = await moveToPinnedSlot(page, 1);
    await page.mouse.move(pinnedSlot.x, pinnedSlot.y);
    await expect.poll(async () => (await report(page)).drag.placeholder).toEqual({
      side: "pinned",
      index: 1,
    });
    await expect.poll(() => page.evaluate(() => {
      const owner = window as unknown as {
        __channelSidebarWithdrawalClone?: Element | null;
      };
      return owner.__channelSidebarWithdrawalClone instanceof Element;
    })).toBe(true);
    await page.evaluate(() => {
      const owner = window as unknown as {
        __channelSidebarWithdrawalClone?: Element | null;
      };
      const withdrawal = owner.__channelSidebarWithdrawalClone;
      const sidebar = document.querySelector(".sidebar");
      if (withdrawal == null || sidebar === null) {
        throw new Error("Expected the production withdrawal clone and sidebar");
      }
      if (!withdrawal.isConnected) sidebar.appendChild(withdrawal);
    });

    const withdrawal = page.locator(".channel-group-withdrawal");
    await expect(withdrawal).toBeAttached();
    await expect(withdrawal).toHaveAttribute("aria-hidden", "true");
    expect(await withdrawal.locator("[id], [trigger]").count()).toBe(0);
    await page.locator(
      '.channel-group:not(.channel-group-withdrawal) ' +
        '.channel-row[data-channel-id="withdrawal-stale-row"]',
    ).evaluateAll((rows) => rows.forEach((row) => row.remove()));
    await page.locator(".channel-group:not(.channel-group-withdrawal)").evaluateAll(
      async (groups) => {
        const animations = groups.flatMap((group) =>
          group.getAnimations({ subtree: true })
        );
        await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
      },
    );
    const liveMenu = page.locator(
      '.channel-group:not(.channel-group-withdrawal) ' +
        `.channel-row[data-channel-id="${DESIGN_ID}"] tv-menu`,
    );
    await expect(liveMenu).toHaveCount(1);
    const liveMenuId = await liveMenu.getAttribute("trigger");
    if (!liveMenuId) throw new Error("Expected live channel menu pairing");
    expect(await page.locator(`[id="${liveMenuId}"]`).count()).toBe(1);
    expect(await page.evaluate(() => {
      const owner = window as unknown as {
        __channelSidebarCloneAttributes: unknown[];
      };
      return owner.__channelSidebarCloneAttributes;
    })).toEqual([
      { kind: "preview", ids: 0, popoverTargets: 0 },
      { kind: "withdrawal", ids: 0, popoverTargets: 0 },
    ]);

    const sidebar = await page.locator(".sidebar").boundingBox();
    if (!sidebar) throw new Error("Sidebar has no box");
    await withdrawal.evaluate((group, { channelId, top }) => {
      const staleRow = group.querySelector<HTMLElement>(
        '.channel-row[data-channel-id="withdrawal-stale-row"]',
      );
      if (staleRow === null) throw new Error("Expected a stale row in the withdrawal clone");
      staleRow.dataset.channelId = channelId;
      staleRow.style.position = "fixed";
      staleRow.style.top = `${top}px`;
    }, { channelId: DESIGN_ID, top: sidebar.y + sidebar.height - 80 });
    await page.evaluate(() => {
      const owner = window as unknown as {
        __channelSidebarRowAnimations: unknown[];
      };
      owner.__channelSidebarRowAnimations.length = 0;
    });

    const researchBox = await channelRow(page, "Research").boundingBox();
    if (!researchBox) throw new Error("Research row has no drag geometry");
    const displacement = await startMotionObservation(page, ".sidebar");
    await page.mouse.move(
      researchBox.x + 8,
      researchBox.y + researchBox.height / 2 + 1,
    );
    await expect.poll(async () => (await report(page)).drag.placeholder).toEqual({
      side: "pinned",
      index: 2,
    });
    await displacement.settle({ requireMotion: true });
    const rowAnimations = await page.evaluate(() => {
      const owner = window as unknown as {
        __channelSidebarRowAnimations: Array<{
          channelId: string | null;
          withdrawal: boolean;
        }>;
      };
      return owner.__channelSidebarRowAnimations;
    });
    expect(rowAnimations).toContainEqual({
      channelId: RESEARCH_ID,
      withdrawal: false,
    });
    expect(rowAnimations).not.toContainEqual({
      channelId: DESIGN_ID,
      withdrawal: false,
    });
    expect(rowAnimations.every(({ withdrawal: isWithdrawal }) => !isWithdrawal)).toBe(true);

    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [DESIGN_ID, RESEARCH_ID, READING_ID],
    ]);
  });

  test("renders every pose and settles one accepted or rejected list without losing context", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await openFixture(page, true);

    await page.locator(".sidebar").evaluate(async (sidebar) => {
      const unrelated = document.createElement("div");
      sidebar.append(unrelated);
      try {
        await unrelated.animate({ opacity: [0, 1] }).finished;
      } finally {
        unrelated.remove();
      }
    });
    expect((await report(page)).drag.restorationAnimations).toBe(0);

    const readingWide = await channelRow(page, "Reading list").boundingBox();
    if (!readingWide) throw new Error("Reading-list row has no box");
    await page.evaluate((channelId) => {
      window.__channelSidebarFixture.captureDragRow(channelId);
    }, READING_ID);
    const readingDrag = await beginChannelDrag(page, "Reading list");
    await expect.poll(async () => (await report(page)).drag).toMatchObject({
      carriedId: READING_ID,
      carriedSame: true,
      placeholder: { side: "unpinned", index: 12 },
      action: null,
      selectedId: RESEARCH_ID,
    });
    let dragReport = (await report(page)).drag;
    expect(dragReport.carriedRect?.width).toBeLessThan(readingWide.width);
    expect(dragReport.carriedRect?.width).toBeGreaterThanOrEqual(160);

    const sidebarBox = await page.locator(".sidebar").boundingBox();
    if (!sidebarBox) throw new Error("Sidebar has no box");
    const outside = { x: sidebarBox.x + sidebarBox.width + 120, y: readingDrag.start.y };
    await page.mouse.move(outside.x, outside.y);
    await expect.poll(async () => (await report(page)).drag.placeholder).toEqual({
      side: "unpinned",
      index: 12,
    });
    const previewGrip = await page.locator(".sidebar").evaluate((element) => ({
      x: Number.parseFloat((element as HTMLElement).style.getPropertyValue(
        "--channel-sidebar-drag-grip-x",
      )),
      y: Number.parseFloat((element as HTMLElement).style.getPropertyValue(
        "--channel-sidebar-drag-grip-y",
      )),
    }));
    dragReport = (await report(page)).drag;
    await expect(page.locator(".channel-row.dragged")).toBeVisible();
    expect(dragReport.carriedRect?.left).toBeCloseTo(outside.x - previewGrip.x, 0);
    expect(dragReport.carriedRect?.top).toBeCloseTo(outside.y - previewGrip.y, 0);
    expect(dragReport.carriedSame).toBe(true);
    expect((await report(page)).operations.pinned).toEqual([]);

    for (const index of [3, 2, 1, 0]) {
      await moveAndSettleDrag(
        page,
        await moveToPinnedSlot(page, index),
        { side: "pinned", index },
      );
      expect((await report(page)).operations.pinned).toEqual([]);
      expect((await report(page)).drag).toMatchObject({
        carriedId: READING_ID,
        carriedSame: true,
        selectedId: RESEARCH_ID,
        scrollTop: 0,
      });
    }

    expect((await report(page)).drag.restorationAnimations).toBe(0);
    const acceptedMotion = await startMotionObservation(page, ".sidebar");
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [READING_ID, DESIGN_ID, RESEARCH_ID, OPERATIONS_ID],
    ]);
    const acceptedSettlement = await acceptedMotion.settle({ requireMotion: true });
    expect(acceptedSettlement.webAnimations).toContainEqual({
      duration: 200,
      finished: true,
      kind: "web-animation",
    });
    expect((await report(page)).drag).toMatchObject({
      carriedId: null,
      placeholder: null,
      selectedId: RESEARCH_ID,
      scrollTop: 0,
      restorationAnimations: 1,
    });

    await page.evaluate(async ({ design, reading }) => {
      await window.__channelSidebarFixture.setState([design, reading], [], reading);
      window.__channelSidebarFixture.captureDragRow(reading);
    }, { design: DESIGN_ID, reading: READING_ID });
    await expect(page.getByRole("option", { name: "Reading list", exact: true })).toBeVisible();
    const noPinnedDrag = await beginChannelDrag(page, "Reading list");
    const compactSidebar = await page.locator(".sidebar").boundingBox();
    if (!compactSidebar) throw new Error("Sidebar has no box");
    await moveAndSettleDrag(
      page,
      { x: compactSidebar.x + 80, y: compactSidebar.y + 20 },
      { side: "pinned", index: 0 },
    );
    expect((await report(page)).drag.visibleGroups).toEqual(["Pinned", "Recent"]);
    expect((await report(page)).operations.pinned).toEqual([]);
    await moveAndSettleDrag(
      page,
      { x: compactSidebar.x + compactSidebar.width + 120, y: noPinnedDrag.start.y },
      { side: "unpinned", index: 0 },
      { withdrawingPlaceholder: true },
    );
    expect((await report(page)).drag.visibleGroups).toEqual(["Recent"]);
    expect((await report(page)).operations.pinned).toEqual([]);
    await moveAndSettleDrag(
      page,
      { x: compactSidebar.x + 80, y: compactSidebar.y + 20 },
      { side: "pinned", index: 0 },
    );
    const missingGroupDrop = await startMotionObservation(page, ".sidebar");
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([[READING_ID]]);
    await missingGroupDrop.settle({ requireMotion: true });
    expect(await report(page)).toMatchObject({
      pinnedChannelIds: [READING_ID],
      drag: {
        carriedId: null,
        visibleGroups: ["Pinned", "Recent"],
        restorationAnimations: 2,
      },
    });

    await page.evaluate(async (design) => {
      await window.__channelSidebarFixture.setState([design], [design], design);
      window.__channelSidebarFixture.captureDragRow(design);
    }, DESIGN_ID);
    await expect(page.getByRole("option", { name: "Design system", exact: true })).toBeVisible();
    const onlyRowDrag = await beginChannelDrag(page, "Design system");
    const onlyRowSidebar = await page.locator(".sidebar").boundingBox();
    if (!onlyRowSidebar) throw new Error("Sidebar has no box");
    const unpinPoint = {
      x: onlyRowSidebar.x + onlyRowSidebar.width + 120,
      y: onlyRowDrag.start.y,
    };
    await moveAndSettleDrag(page, unpinPoint, null, {
      withdrawingPlaceholder: true,
    });
    expect((await report(page)).drag).toMatchObject({
      carriedId: DESIGN_ID,
      carriedSame: true,
      action: "Unpin",
      visibleGroups: [],
      selectedId: DESIGN_ID,
    });
    await moveAndSettleDrag(
      page,
      { x: onlyRowSidebar.x + 80, y: onlyRowSidebar.y + 20 },
      { side: "pinned", index: 0 },
    );
    expect((await report(page)).drag.visibleGroups).toEqual(["Pinned"]);
    await moveAndSettleDrag(page, unpinPoint, null, {
      withdrawingPlaceholder: true,
    });
    expect((await report(page)).drag.visibleGroups).toEqual([]);
    const unpinMotion = await startMotionObservation(page, ".sidebar");
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([[]]);
    await unpinMotion.settle({ requireMotion: true });
    expect(await report(page)).toMatchObject({
      pinnedChannelIds: [],
      drag: {
        carriedId: null,
        placeholder: null,
        action: null,
        visibleGroups: ["Recent"],
        selectedId: DESIGN_ID,
        restorationAnimations: 3,
      },
    });

    await page.setViewportSize({ width: 1100, height: 520 });
    await resetFixture(page);
    const body = page.locator(".sidebar-body");
    const scrollBefore = await scrollList(page, 60);
    await page.evaluate((channelId) => {
      window.__channelSidebarFixture.captureDragRow(channelId);
    }, OPERATIONS_ID);
    await beginChannelDrag(page, "Operations");
    expect((await report(page)).drag.scrollTop).toBe(scrollBefore);
    await moveAndSettleDrag(page, await moveToPinnedSlot(page, 0), {
      side: "pinned",
      index: 0,
    });
    expect(await body.evaluate((element) => (element as HTMLElement).scrollTop))
      .toBe(scrollBefore);
    await page.evaluate(() => window.__channelSidebarFixture.rejectNextPinList());
    const rejectedMotion = await startMotionObservation(page, ".sidebar");
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [OPERATIONS_ID, DESIGN_ID, RESEARCH_ID],
    ]);
    const rejectedSettlement = await rejectedMotion.settle({ requireMotion: true });
    expect(rejectedSettlement.webAnimations).toContainEqual({
      duration: 200,
      finished: true,
      kind: "web-animation",
    });
    expect(await report(page)).toMatchObject({
      pinnedChannelIds: [DESIGN_ID, RESEARCH_ID, OPERATIONS_ID],
      focusedChannelId: RESEARCH_ID,
      drag: {
        carriedId: null,
        placeholder: null,
        scrollTop: scrollBefore,
        selectedId: RESEARCH_ID,
        restorationAnimations: 4,
      },
    });
  });
});

test.describe("channel sidebar drag edge scroll (^sb-ac-drag-scroll)", () => {
  test("tapers both edge velocities, tracks newly revealed rows, and stops outside, on release, or without overflow", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1100, height: 320 });
    await openFixture(page, true);
    await page.evaluate(async ({ channelIds, focusedId }) => {
      await window.__channelSidebarFixture.setState(channelIds, channelIds, focusedId);
    }, { channelIds: [...ALL_CHANNEL_IDS], focusedId: PLANNING_ID });
    await expect(page.getByRole("option", { name: "Planning", exact: true })).toBeVisible();

    await beginChannelDrag(page, "Planning");
    const body = page.locator(".sidebar-body");
    const bodyBox = await body.boundingBox();
    if (!bodyBox) throw new Error("Sidebar body has no box");
    const bodyBottom = bodyBox.y + bodyBox.height;
    const x = bodyBox.x + bodyBox.width / 2;
    const initial = await report(page);
    const initialPlaceholder = initial.drag.placeholder;
    if (initialPlaceholder?.side !== "pinned") {
      throw new Error(`Expected a pinned placeholder, observed ${JSON.stringify(initialPlaceholder)}`);
    }

    await page.mouse.move(x, bodyBottom - 28.5);
    const stationaryBefore = await sampleSidebarScrollFrames(page, 6);
    expect(Math.abs(sidebarScrollVelocity(stationaryBefore))).toBeLessThan(1);
    expect(stationaryBefore.every(({ scrollTop }) => scrollTop === 0)).toBe(true);

    const motion = await startMotionObservation(page, ".sidebar");
    const maximumScrollTop = await body.evaluate((element) =>
      element.scrollHeight - element.clientHeight
    );
    const bottomOuterY = bodyBottom - 0.5;
    const expectedOuterVelocity = 800 * (28 - (bodyBottom - bottomOuterY)) / 28;
    await page.mouse.move(x, bottomOuterY);
    const outerSamples = await sampleSidebarScrollFrames(page, 10);
    const outerVelocity = sidebarScrollVelocity(outerSamples, maximumScrollTop);
    expectSidebarVelocityNear(outerVelocity, expectedOuterVelocity);
    expect(outerSamples.slice(1).every((sample, index) =>
      sample.scrollTop > outerSamples[index]!.scrollTop
    )).toBe(true);

    await page.mouse.move(x, bodyBottom - 28.5);
    await sampleSidebarScrollFrames(page, 2);
    await scrollList(page, 0);
    const bottomMiddleY = bodyBottom - 14;
    await page.mouse.move(x, bottomMiddleY);
    const middleSamples = await sampleSidebarScrollFrames(page, 10);
    const middleVelocity = sidebarScrollVelocity(middleSamples, maximumScrollTop);
    expectSidebarVelocityNear(middleVelocity, 400);
    expect(middleVelocity).toBeGreaterThan(outerVelocity * 0.35);
    expect(middleVelocity).toBeLessThan(outerVelocity * 0.65);

    await page.mouse.move(x, bodyBottom - 28.5);
    await sampleSidebarScrollFrames(page, 2);
    await scrollList(page, 0);
    const bottomNearInnerY = Math.floor(bodyBottom - 28) + 1;
    const expectedNearInnerVelocity = 800 *
      (bottomNearInnerY - (bodyBottom - 28)) / 28;
    await page.mouse.move(x, bottomNearInnerY);
    const nearInnerSamples = await sampleSidebarScrollFrames(page, 60);
    const nearInnerVelocity = sidebarScrollVelocity(nearInnerSamples, maximumScrollTop);
    expectSidebarVelocityNear(nearInnerVelocity, expectedNearInnerVelocity);
    expect(nearInnerVelocity).toBeGreaterThan(0);
    expect(nearInnerVelocity).toBeLessThan(middleVelocity * 0.15);

    await page.mouse.move(x, bottomOuterY);
    await scrollList(page, 0);
    await page.mouse.move(x, bodyBottom - 28.5);
    const beforeReveal = await report(page);
    const startIndex = beforeReveal.drag.placeholder?.index;
    if (startIndex === undefined || startIndex === null) {
      throw new Error("Expected a live pinned placeholder before edge hold");
    }
    await page.mouse.move(x, bottomOuterY);
    const revealed = await waitForPlaceholderIndex(page, startIndex + 2);
    expect(revealed.scrollTop).toBeGreaterThan(outerSamples[0]!.scrollTop);
    expect(revealed.placeholderIndex).toBeGreaterThanOrEqual(startIndex + 2);

    await page.mouse.move(x, bodyBottom - 28.5);
    const stoppedSamples = await sampleSidebarScrollFrames(page, 6);
    expect(Math.abs(sidebarScrollVelocity(stoppedSamples))).toBeLessThan(1);

    await scrollList(page, maximumScrollTop);
    await page.mouse.move(x, bodyBox.y + 28.5);
    const topMiddleY = bodyBox.y + 14;
    await page.mouse.move(x, topMiddleY);
    const topMiddleSamples = await sampleSidebarScrollFrames(page, 10);
    const topMiddleVelocity = sidebarScrollVelocity(topMiddleSamples, maximumScrollTop);
    expectSidebarVelocityNear(topMiddleVelocity, -400);

    await scrollList(page, maximumScrollTop);
    await page.mouse.move(x, bodyBox.y + 28.5);
    const topOuterY = bodyBox.y + 0.5;
    const expectedTopOuterVelocity = -800 * (28 - (topOuterY - bodyBox.y)) / 28;
    await page.mouse.move(x, topOuterY);
    const topOuterSamples = await sampleSidebarScrollFrames(page, 10);
    const topOuterVelocity = sidebarScrollVelocity(topOuterSamples, maximumScrollTop);
    expectSidebarVelocityNear(topOuterVelocity, expectedTopOuterVelocity);

    await scrollList(page, maximumScrollTop);
    await page.mouse.move(x, bodyBox.y + 28.5);
    await page.mouse.move(x, topMiddleY);
    const secondTopMiddleSamples = await sampleSidebarScrollFrames(page, 10);
    const secondTopMiddleVelocity = sidebarScrollVelocity(
      secondTopMiddleSamples,
      maximumScrollTop,
    );
    expectSidebarVelocityNear(secondTopMiddleVelocity, -400);
    expect(Math.abs(secondTopMiddleVelocity)).toBeGreaterThan(
      Math.abs(topOuterVelocity) * 0.35,
    );
    expect(Math.abs(secondTopMiddleVelocity)).toBeLessThan(
      Math.abs(topOuterVelocity) * 0.65,
    );

    // Release while the loop is still active in the top zone. The gesture's
    // common finish path, rather than a preceding zone exit, must stop it.
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).drag.carriedId).toBeNull();
    const released = await report(page);
    const afterReleaseSamples = await sampleSidebarScrollFrames(page, 6);
    expect(Math.abs(sidebarScrollVelocity(afterReleaseSamples))).toBeLessThan(1);
    expect(afterReleaseSamples.every(({ scrollTop }) =>
      Math.abs(scrollTop - (released.drag.scrollTop ?? 0)) < 0.5
    )).toBe(true);
    const settledMotion = await motion.settle({ requireMotion: true });
    expect(settledMotion.scrollEvents).toBeGreaterThan(0);

    await page.evaluate(async ({ channelIds, focusedId }) => {
      await window.__channelSidebarFixture.setState(channelIds, [], focusedId);
    }, { channelIds: [READING_ID, DESIGN_ID], focusedId: READING_ID });
    await expect(page.getByRole("option", { name: "Reading list", exact: true })).toBeVisible();
    await beginChannelDrag(page, "Reading list");
    const fittingBodyBox = await body.boundingBox();
    if (!fittingBodyBox) throw new Error("Fitting sidebar body has no box");
    const fittingBefore = await report(page);
    const fittingExtent = await body.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(fittingExtent.scrollHeight).toBe(fittingExtent.clientHeight);
    const fittingMotion = await startMotionObservation(page, ".sidebar");
    await page.mouse.move(
      fittingBodyBox.x + fittingBodyBox.width / 2,
      fittingBodyBox.y + fittingBodyBox.height - 0.5,
    );
    const fittingSamples = await sampleSidebarScrollFrames(page, 8);
    await page.mouse.up();
    const fittingSettlement = await fittingMotion.settle();
    expect(fittingSettlement.scrollEvents).toBe(0);
    expect(new Set(fittingSamples.map(({ scrollTop }) => scrollTop))).toEqual(new Set([0]));
    expect(new Set(fittingSamples.map(({ placeholderIndex }) => placeholderIndex)))
      .toEqual(new Set([fittingBefore.drag.placeholder?.index ?? null]));
    expect((await report(page))).toMatchObject({
      operations: { pinned: [] },
      drag: {
        carriedId: null,
        placeholder: null,
        scrollTop: 0,
        selectedId: fittingBefore.drag.selectedId,
      },
    });
  });
});

test.describe("channel sidebar pointer lifecycle (partial ^sb-ac-drag)", () => {
  test("captured release pins, reorders, and unpins exactly once without selecting", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 1000 });
    await openFixture(page);

    let target = await page.getByRole("option", { name: "Design system", exact: true })
      .boundingBox();
    if (!target) throw new Error("Design-system row has no box");
    await beginChannelDrag(page, "Reading list");
    await page.mouse.move(target.x + 8, target.y + 2);
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [READING_ID, DESIGN_ID, RESEARCH_ID, OPERATIONS_ID],
    ]);
    expect((await report(page)).operations.focus).toEqual([]);

    await resetFixture(page);
    target = await page.getByRole("option", { name: "Design system", exact: true })
      .boundingBox();
    if (!target) throw new Error("Design-system row has no box");
    await beginChannelDrag(page, "Operations");
    await page.mouse.move(target.x + 8, target.y + 2);
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [OPERATIONS_ID, DESIGN_ID, RESEARCH_ID],
    ]);
    expect((await report(page)).operations.focus).toEqual([]);

    await resetFixture(page);
    const sidebar = await page.locator(".sidebar").boundingBox();
    if (!sidebar) throw new Error("Sidebar has no box");
    const { start } = await beginChannelDrag(page, "Design system");
    await page.mouse.move(sidebar.x + sidebar.width + 120, start.y);
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [RESEARCH_ID, OPERATIONS_ID],
    ]);
    expect((await report(page)).operations.focus).toEqual([]);
    expect((await report(page)).focusedChannelId).toBe(RESEARCH_ID);
  });

  test("Escape, cancellation, and unexpected capture loss abandon while post-release loss is inert", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 520 });
    await openFixture(page);
    const scrollBefore = await scrollList(page, 60);

    let drag = await beginChannelDrag(page, "Operations");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".sidebar").evaluate(
      (element, pointerId) => !element.hasPointerCapture(pointerId),
      drag.pointerId,
    )).toBe(true);
    await page.mouse.up();
    expect((await report(page)).operations.pinned).toEqual([]);

    drag = await beginChannelDrag(page, "Operations");
    await dispatchPointerTermination(page, "pointercancel", drag.pointerId);
    await expect.poll(() => page.locator(".sidebar").evaluate(
      (element, pointerId) => !element.hasPointerCapture(pointerId),
      drag.pointerId,
    )).toBe(true);
    await page.mouse.up();
    expect((await report(page)).operations.pinned).toEqual([]);

    drag = await beginChannelDrag(page, "Operations");
    await page.locator(".sidebar").evaluate((element, pointerId) => {
      element.releasePointerCapture(pointerId);
    }, drag.pointerId);
    await expect.poll(() => page.locator(".sidebar").evaluate(
      (element, pointerId) => !element.hasPointerCapture(pointerId),
      drag.pointerId,
    )).toBe(true);
    await page.mouse.up();
    expect((await report(page)).operations.pinned).toEqual([]);

    const sidebar = await page.locator(".sidebar").boundingBox();
    if (!sidebar) throw new Error("Sidebar has no box");
    drag = await beginChannelDrag(page, "Operations");
    await page.mouse.move(sidebar.x + sidebar.width + 120, drag.start.y);
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).operations.pinned).toEqual([
      [DESIGN_ID, RESEARCH_ID],
    ]);
    await dispatchPointerTermination(page, "lostpointercapture", drag.pointerId);
    expect((await report(page)).operations.pinned).toEqual([
      [DESIGN_ID, RESEARCH_ID],
    ]);
    expect((await report(page)).operations.focus).toEqual([]);
    expect((await report(page)).focusedChannelId).toBe(RESEARCH_ID);
    expect(await page.locator(".sidebar-body").evaluate((element) =>
      (element as HTMLElement).scrollTop)).toBe(scrollBefore);
  });
});

test.describe("channel sidebar native rename (^sb-ac-rename)", () => {
  test("focuses and selects the field and implements every commit and restore exit without moving the list", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 520 });
    await openFixture(page);
    await scrollList(page, 120);
    const body = page.locator(".sidebar-body");

    let field = await openRename(page, "Reading list");
    const scrollBefore = await body.evaluate((element) => element.scrollTop);
    await field.fill("Renamed with Enter");
    await field.press("Enter");
    await expect(page.getByRole("option", { name: "Renamed with Enter", exact: true })).toBeVisible();
    expect((await report(page)).operations.rename.at(-1)).toEqual({
      channelId: READING_ID,
      name: "Renamed with Enter",
    });
    expect(await body.evaluate((element) => element.scrollTop)).toBe(scrollBefore);

    await resetFixture(page);
    field = await openRename(page, "Reading list");
    await field.fill("Renamed with check");
    await page.locator(".channel-rename-commit").click();
    await expect(page.getByRole("option", { name: "Renamed with check", exact: true })).toBeVisible();
    expect((await report(page)).operations.rename.at(-1)).toEqual({
      channelId: READING_ID,
      name: "Renamed with check",
    });

    await resetFixture(page);
    field = await openRename(page, "Reading list");
    await field.fill("Renamed on blur");
    await page.locator(".sidebar-titlebar").click({ position: { x: 100, y: 10 } });
    await expect(page.getByRole("option", { name: "Renamed on blur", exact: true })).toBeVisible();
    expect((await report(page)).operations.rename.at(-1)).toEqual({
      channelId: READING_ID,
      name: "Renamed on blur",
    });

    await resetFixture(page);
    field = await openRename(page, "Reading list");
    await field.fill("Discarded with Escape");
    await field.press("Escape");
    await expect(page.getByRole("option", { name: "Reading list", exact: true })).toBeVisible();
    expect((await report(page)).operations.rename).toEqual([]);

    field = await openRename(page, "Reading list");
    await field.fill("");
    await page.locator(".sidebar-titlebar").click({ position: { x: 100, y: 10 } });
    await expect(page.getByRole("option", { name: "Reading list", exact: true })).toBeVisible();
    expect((await report(page)).operations.rename).toEqual([]);
    expect(await body.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  });
});

test.describe("channel-sidebar updates preserve the stage (^sb-ac-stage-continuity)", () => {
  test("remote rename and pin-order repaints retain the live document and its activity", async ({ page }) => {
    await openFixture(page);
    await page.waitForFunction(() => window.__channelSidebarDocumentReady === true);
    await page.evaluate(() => window.__channelSidebarFixture.captureStage());

    await page.evaluate(({ researchId, operationsId, designId }) => {
      window.__channelSidebarFixture.remoteRename(researchId, "Research renamed remotely");
      window.__channelSidebarFixture.remotePinOrder([researchId, operationsId, designId]);
    }, { researchId: RESEARCH_ID, operationsId: OPERATIONS_ID, designId: DESIGN_ID });
    await expect(page.getByRole("option", { name: "Research renamed remotely", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    expect(await report(page)).toMatchObject({
      operations: {
        focus: [],
        pinned: [],
        rename: [],
        create: 0,
        delete: [],
      },
      focusedChannelId: RESEARCH_ID,
      pinnedChannelIds: [RESEARCH_ID, OPERATIONS_ID, DESIGN_ID],
      pageSame: true,
      viewSame: true,
      frameSame: true,
      windowSame: true,
      value: "typed and retained",
      frameScrollY: 180,
      counterAdvanced: true,
      loads: 1,
    });
  });
});
