import { expect, test, type Page } from "@playwright/test";
import {
  CROSSING_DURATION_MS,
  TAB_COMPRESSION_FLOOR_PX,
  TAB_COMPRESSION_FLOOR_SLACK_PX,
} from "../../src/constants.ts";
import {
  configureTestMotion,
  pressAndReleaseWithoutPointerMove,
  startMotionObservation,
  type MotionReport,
} from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/tab-strip.html";
const BASE_PAGE_WIDTH = 560.25;
const BASE_PAGE_HEIGHT = 740.5;
const GTD_TAB_TITLES = [
  "Daily Log",
  "Inbox",
  "Next Actions",
  "Next Actions (OLD)",
  "Daily Briefing",
  "Daily Practices",
  "Projects — the map",
  "Ticklers",
  "On Deck",
  "Someday / Maybe",
  "Waiting For",
  "GTD System Design",
  "GTD System Requirements (PRD)",
  "Horizons of Focus (map)",
] as const;

function authoredPageSize(artifactId: string): { width: number; height: number } {
  const index = Number(artifactId.split("-").at(-1));
  return { width: BASE_PAGE_WIDTH + index, height: BASE_PAGE_HEIGHT + index };
}

interface GestureState {
  draggedArtifactId: string | null;
  placeholderBeforeArtifactId: string | null;
  tabOrder: string[];
}

interface PageLayoutBox {
  width: number;
  height: number;
}

interface FullScreenState {
  artifactId: string | null;
  fullScreen: boolean;
}

interface TabStripReport {
  overflow: boolean;
  scrollLeft: number;
  scrollMax: number;
  selectedIndex: number;
  selectedArtifactId: string | null;
  selectedCenterOffset: number | null;
  previousVisible: boolean;
  nextVisible: boolean;
  activeArtifactId: string | null;
  tabIndexes: string[];
  selectionCalls: Array<{ channelID: string; artifactID: string }>;
  reorderCalls: Array<{
    channelID: string;
    artifactIDs: Array<string | null>;
    sizes: Array<{ width: number; height: number }>;
  }>;
  selectedPageArtifactId: string | null;
  selectedPageFullScreen: boolean;
  selectedPageCenterOffset: number | null;
  pageLayoutBoxes: Record<string, PageLayoutBox>;
  pageOrder: string[];
  draggedArtifactId: string | null;
  placeholderCount: number;
  placeholderBeforeArtifactId: string | null;
  tabOrder: string[];
  captureEvents: Array<{ type: string; pointerId: number }>;
  hasPointerCapture: boolean;
  gestureStates: GestureState[];
  fullScreenStates: FullScreenState[];
  scrollBehavior: string;
}

interface ScrollFrameSample {
  timestamp: number;
  scrollLeft: number;
  tabOrder: string[];
}

interface TabCompressionState {
  artifactId: string;
  title: string;
  compression: string | null;
  inlineMinWidth: string;
  tabWidth: number;
  rangeWidth: number;
  horizontalChrome: number;
  truncated: boolean;
}

interface CompressionStabilityReport {
  stripClientWidth: number;
  stripScrollWidth: number;
  classificationMutations: number;
  frames: TabCompressionState[][];
}

interface TabStripFixture {
  setMotionSuppressed(value: boolean): void;
  unmount(): void;
  settle(): Promise<void>;
  setTabs(count: number, selectedIndex?: number): void;
  setTitles(titles: readonly string[], selectedIndex?: number): void;
  resetGestureScenario(options?: { selected?: number; fullScreen?: boolean }): void;
  startGestureObservation(): void;
  startFullScreenObservation(): void;
  dispatchPointerCancel(): void;
  releasePointerCapture(): void;
  selectIndex(index: number): void;
  scrollTo(fraction: number): void;
  report(): TabStripReport;
}

async function delayInitialFontSettlement(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fonts = document.fonts;
    const settledReady = fonts.ready;
    let firstRead = true;
    let resolveDelayed: ((value: FontFaceSet) => void) | undefined;
    const delayedReady = new Promise<FontFaceSet>((resolve) => {
      resolveDelayed = resolve;
    });
    Object.defineProperty(fonts, "ready", {
      configurable: true,
      get: () => {
        if (!firstRead) return settledReady;
        firstRead = false;
        return delayedReady;
      },
    });

    const nativeRequestFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
    let holdNextFrame = false;
    let heldFrame: { id: number; callback: FrameRequestCallback } | null = null;
    let heldFrameId = -1;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      if (!holdNextFrame) return nativeRequestFrame(callback);
      holdNextFrame = false;
      const id = heldFrameId--;
      heldFrame = { id, callback };
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      if (heldFrame?.id === id) {
        heldFrame = null;
        return;
      }
      nativeCancelFrame(id);
    };

    const controls = window as unknown as {
      __holdNextTabStripFrame: () => void;
      __releaseTabStripFrame: () => void;
      __resolveTabStripFontSettlement: () => void;
    };
    controls.__holdNextTabStripFrame = () => {
      holdNextFrame = true;
    };
    controls.__releaseTabStripFrame = () => {
      const frame = heldFrame;
      heldFrame = null;
      frame?.callback(performance.now());
    };
    controls.__resolveTabStripFontSettlement = () => resolveDelayed?.(fonts);
  });
}

async function resizeTabStrip(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const strip = document.querySelector<HTMLElement>(".tab-strip");
    if (!strip) throw new Error("Expected a rendered tab strip");
    const originalWidth = strip.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      if (strip.getBoundingClientRect().width >= originalWidth - 1) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(strip);
    strip.style.width = `${originalWidth - 20}px`;
  }));
}

async function waitForTabStrip(page: Page, allowCSSMotion = false): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() =>
    (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true
  );
  await configureTestMotion(page, { allowCSSMotion });
  await page.evaluate(() =>
    (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture.settle()
  );
}

async function report(page: Page): Promise<TabStripReport> {
  return page.evaluate(() =>
    (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture.report()
  );
}

async function prepareGestureScenario(page: Page): Promise<void> {
  await waitForTabStrip(page);
  await page.evaluate(async () => {
    const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
      .__tabStripFixture;
    fixture.resetGestureScenario();
    await fixture.settle();
    fixture.startGestureObservation();
  });
}

async function tabCentre(
  page: Page,
  artifactId: string,
): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-artifact-id="${artifactId}"]`).boundingBox();
  if (!box) throw new Error(`Expected tab ${artifactId} to have a box`);
  return {
    x: Math.floor(box.x + box.width / 2),
    y: Math.floor(box.y + box.height / 2),
  };
}

async function tabBox(
  page: Page,
  artifactId: string,
): Promise<{ left: number; right: number; centerY: number }> {
  const box = await page.locator(`[data-artifact-id="${artifactId}"]`).boundingBox();
  if (!box) throw new Error(`Expected tab ${artifactId} to have a box`);
  return {
    left: box.x,
    right: box.x + box.width,
    centerY: box.y + box.height / 2,
  };
}

async function sampleCompressionFrames(
  page: Page,
  frameCount: number,
): Promise<CompressionStabilityReport> {
  return page.evaluate((count) => new Promise((resolve) => {
    const strip = document.querySelector<HTMLElement>(".tab-strip");
    if (!strip) throw new Error("Expected a rendered tab strip");
    const frames: TabCompressionState[][] = [];
    let classificationMutations = 0;
    const observer = new MutationObserver((records) => {
      classificationMutations += records.length;
    });
    observer.observe(strip, {
      attributes: true,
      attributeFilter: ["data-compression"],
      subtree: true,
    });
    const sample = (): void => {
      frames.push([...strip.querySelectorAll<HTMLElement>(".tab")].map((tab) => {
        const label = tab.querySelector<HTMLElement>(".tab-label");
        if (!label) throw new Error("Expected every tab to have a label");
        const range = document.createRange();
        range.selectNodeContents(label);
        const tabStyle = getComputedStyle(tab);
        const labelBox = label.getBoundingClientRect();
        return {
          artifactId: tab.dataset.artifactId ?? "",
          title: label.textContent?.trim() ?? "",
          compression: tab.dataset.compression ?? null,
          inlineMinWidth: tab.style.minWidth,
          tabWidth: tab.getBoundingClientRect().width,
          rangeWidth: range.getBoundingClientRect().width,
          horizontalChrome: Number.parseFloat(tabStyle.paddingLeft) +
            Number.parseFloat(tabStyle.paddingRight) +
            Number.parseFloat(tabStyle.borderLeftWidth) +
            Number.parseFloat(tabStyle.borderRightWidth),
          truncated: range.getBoundingClientRect().width > labelBox.width,
        };
      }));
      if (frames.length >= count) {
        observer.disconnect();
        resolve({
          stripClientWidth: strip.clientWidth,
          stripScrollWidth: strip.scrollWidth,
          classificationMutations,
          frames,
        });
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  }), frameCount);
}

async function sampleScrollFrames(
  page: Page,
  frameCount: number,
): Promise<ScrollFrameSample[]> {
  return page.evaluate((count) => new Promise((resolve) => {
    const samples: ScrollFrameSample[] = [];
    const sample = (timestamp: number): void => {
      const strip = document.querySelector<HTMLElement>(".tab-strip");
      if (!strip) throw new Error("Expected a rendered tab strip");
      samples.push({
        timestamp,
        scrollLeft: strip.scrollLeft,
        tabOrder: [...strip.querySelectorAll<HTMLElement>(".tab")].map((tab) =>
          tab.dataset.artifactId ?? ""
        ),
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

function scrollVelocity(samples: readonly ScrollFrameSample[]): number {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.timestamp === first.timestamp) {
    throw new Error("Expected distinct animation-frame scroll samples");
  }
  return (last.scrollLeft - first.scrollLeft) /
    (last.timestamp - first.timestamp) * 1_000;
}

async function waitForCarriedSlot(
  page: Page,
  artifactId: string,
  minimumSlot: number,
): Promise<ScrollFrameSample> {
  return page.evaluate(({ artifactId, minimumSlot }) => new Promise((resolve, reject) => {
    let frames = 0;
    const sample = (timestamp: number): void => {
      const strip = document.querySelector<HTMLElement>(".tab-strip");
      if (!strip) {
        reject(new Error("Expected a rendered tab strip"));
        return;
      }
      const tabOrder = [...strip.querySelectorAll<HTMLElement>(".tab")].map((tab) =>
        tab.dataset.artifactId ?? ""
      );
      if (tabOrder.indexOf(artifactId) >= minimumSlot) {
        resolve({ timestamp, scrollLeft: strip.scrollLeft, tabOrder });
        return;
      }
      frames += 1;
      if (frames >= 180) {
        reject(new Error(
          `Carried tab ${artifactId} did not reach slot ${minimumSlot} within ${frames} frames`,
        ));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { artifactId, minimumSlot });
}

function expectVelocityNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(Math.abs(expected) * 0.2);
}

async function renderedPages(page: Page) {
  return page.locator(".page").evaluateAll(elements => Object.fromEntries(elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return [(element as HTMLElement).dataset.pageKey, {
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    }];
  })));
}

async function sampleDisplacementFrame(
  page: Page,
  x: number,
  y: number,
): Promise<{
  targets: string[];
  startTimes: number[];
  tabOrder: string[];
  pageOrder: string[];
  selectedCenterOffset: number | null;
  topArtifactId: string | null;
}> {
  return page.evaluate(({ x, y }) => new Promise((resolve) => {
    let frames = 0;
    const sample = (): void => {
      const animations = document.getAnimations().filter((animation) =>
        Number(animation.effect?.getTiming().duration) === 200 &&
        (animation.pending || animation.playState === "running")
      );
      frames += 1;
      if (frames < 4 && animations.some(({ startTime }) => startTime === null)) {
        requestAnimationFrame(sample);
        return;
      }
      const filmstrip = document.querySelector<HTMLElement>(".filmstrip");
      const selected = document.querySelector<HTMLElement>(".page[selected]");
      const filmstripBox = filmstrip?.getBoundingClientRect();
      const selectedBox = selected?.getBoundingClientRect();
      resolve({
        targets: animations.map((animation) => {
          const target = animation.effect instanceof KeyframeEffect
            ? animation.effect.target as HTMLElement | null
            : null;
          if (target?.classList.contains("page")) {
            return `page:${target.dataset.pageKey ?? ""}`;
          }
          if (target?.classList.contains("tab")) {
            return `tab:${target.dataset.artifactId ?? ""}`;
          }
          return "unknown";
        }),
        startTimes: animations.flatMap((animation) =>
          typeof animation.startTime === "number" ? [animation.startTime] : []
        ),
        tabOrder: [...document.querySelectorAll<HTMLElement>(".tab")].map((tab) =>
          tab.dataset.artifactId ?? ""
        ),
        pageOrder: [...document.querySelectorAll<HTMLElement>(".page")].map((page) =>
          page.dataset.pageKey ?? ""
        ),
        selectedCenterOffset: selectedBox && filmstripBox
          ? selectedBox.left + selectedBox.width / 2 -
            (filmstripBox.left + filmstripBox.width / 2)
          : null,
        topArtifactId: document.elementFromPoint(x, y)
          ?.closest<HTMLElement>(".tab")?.dataset.artifactId ?? null,
      });
    };
    requestAnimationFrame(sample);
  }), { x, y });
}

function expectOriginalGestureState(
  value: TabStripReport,
  label?: string,
  provisionalOrder?: string[],
): void {
  expect(value, label).toMatchObject({
    selectedArtifactId: "artifact-0",
    selectedPageArtifactId: "artifact-0",
    draggedArtifactId: null,
    placeholderCount: 0,
    placeholderBeforeArtifactId: null,
    tabOrder: ["artifact-0", "artifact-1", "artifact-2", "artifact-3"],
    pageOrder: ["artifact-0", "artifact-1", "artifact-2", "artifact-3"],
    selectionCalls: [],
    reorderCalls: [],
    hasPointerCapture: false,
  });
  expect(value.gestureStates, label).toEqual([
    {
      draggedArtifactId: null,
      placeholderBeforeArtifactId: null,
      tabOrder: ["artifact-0", "artifact-1", "artifact-2", "artifact-3"],
    },
    {
      draggedArtifactId: "artifact-2",
      placeholderBeforeArtifactId: "artifact-2",
      tabOrder: ["artifact-0", "artifact-1", "artifact-2", "artifact-3"],
    },
    ...(provisionalOrder
      ? [{
          draggedArtifactId: "artifact-2",
          placeholderBeforeArtifactId: "artifact-2",
          tabOrder: provisionalOrder,
        }]
      : []),
    {
      draggedArtifactId: null,
      placeholderBeforeArtifactId: null,
      tabOrder: ["artifact-0", "artifact-1", "artifact-2", "artifact-3"],
    },
  ]);
  expect(value.captureEvents.map(({ type }) => type), label).toEqual([
    "gotpointercapture",
    "lostpointercapture",
  ]);
}

function expectAnimatedSelectionCrossing(motion: MotionReport): void {
  expect(motion.transitionEvents).toEqual([]);
  expect(motion.animationEvents).toEqual([]);
  expect(motion.webAnimations).toContainEqual(
    { kind: "web-animation", duration: CROSSING_DURATION_MS, finished: true },
  );
  expect(motion.scrollEvents).toBeGreaterThan(0);
  expect(motion.scrollEndEvents).toBeGreaterThan(0);
  const sampledPositions = new Set(
    motion.scrollPositions.map((position) => Math.round(position * 10) / 10),
  );
  expect(sampledPositions.size).toBeGreaterThan(2);
  const settled = motion.scrollPositions.slice(-2);
  expect(settled).toHaveLength(2);
  expect(Math.abs(settled[1]! - settled[0]!)).toBeLessThanOrEqual(0.1);
}

function expectInstantScroll(motion: MotionReport): void {
  expect(motion.transitionEvents).toEqual([]);
  expect(motion.animationEvents).toEqual([]);
  expect(motion.webAnimations).toEqual([]);
  expect(motion.scrollEvents).toBeGreaterThan(0);
  expect(motion.scrollEndEvents).toBeGreaterThan(0);
  const sampledPositions = new Set(
    motion.scrollPositions.map((position) => Math.round(position * 10) / 10),
  );
  expect(sampledPositions.size).toBe(1);
}

// proofs/ui/app/tab-strip/index.md#^tb-ac-label-overflow
test.describe("tab label overflow", () => {
  async function setTitles(page: Page, titles: readonly string[]): Promise<void> {
    await page.evaluate(async (next) => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture;
      fixture.setTitles(next);
      await fixture.settle();
    }, titles);
  }

  async function expectLabels(page: Page, titles: readonly string[], overflowing: boolean[]): Promise<void> {
    for (const [index, title] of titles.entries()) {
      const tab = page.getByRole("tab").nth(index);
      await expect(tab).toHaveAccessibleName(title);
      await expect(tab.locator(".tab-label")).toHaveText(title);
    }
    await expect.poll(() => page.locator(".tab-label").evaluateAll(labels => labels.map(label => ({
      overflowing: label.scrollWidth > label.clientWidth,
      marked: label.hasAttribute("data-overflow"),
    })))).toEqual(overflowing.map(value => ({ overflowing: value, marked: value })));
  }

  for (const appearance of ["light", "dark"]) {
    test(`updates after title and available-width changes in ${appearance} appearance`, async ({ page }) => {
      await waitForTabStrip(page);
      await page.evaluate(mode => { document.documentElement.dataset.theme = mode; }, appearance);
      const titles = ["Quarterly planning notes", "Quarterly planning notes", "Map"];
      await setTitles(page, titles);
      await expectLabels(page, titles, [false, false, false]);
      await page.locator(".fixture-row").evaluate(row => {
        (row as HTMLElement).style.gridTemplateColumns = "auto 250px auto";
      });
      await expectLabels(page, titles, [true, true, false]);
      for (const index of [0, 1]) {
        const tab = page.getByRole("tab").nth(index);
        await tab.hover();
        await expect(tab).toHaveAttribute("aria-selected", index === 0 ? "true" : "false");
        await expectLabels(page, titles, [true, true, false]);
      }
      await page.locator(".fixture-row").evaluate(row => {
        (row as HTMLElement).style.gridTemplateColumns = "auto 700px auto";
      });
      await expectLabels(page, titles, [false, false, false]);
      const longTitles = ["Quarterly planning notes and follow-up actions for the entire team", titles[1]!, "Map"];
      await setTitles(page, longTitles);
      await expectLabels(page, longTitles, [true, false, false]);
      await setTitles(page, titles);
      await expectLabels(page, titles, [false, false, false]);
    });
  }

  test("updates when an applied theme changes font metrics and is removed", async ({ page }) => {
    await page.route("**/theme/theme.css?*", route => route.fulfill({
      contentType: "text/css",
      body: ".tab { font-size: 60px; }",
    }));
    await waitForTabStrip(page);
    const titles = ["Planning notes"];
    await setTitles(page, titles);
    await expectLabels(page, titles, [false]);
    await page.evaluate(async () => {
      const links = (window as unknown as { __themeLinks: { refreshThemeLink(url: string): HTMLLinkElement } }).__themeLinks;
      const link = links.refreshThemeLink(location.origin);
      await new Promise<void>((resolve, reject) => {
        link.addEventListener("load", () => resolve(), { once: true });
        link.addEventListener("error", () => reject(new Error("fixture theme failed")), { once: true });
      });
    });
    await expectLabels(page, titles, [true]);
    await page.evaluate(() => {
      (window as unknown as { __themeLinks: { clearThemeLink(): void } }).__themeLinks.clearThemeLink();
    });
    await expectLabels(page, titles, [false]);
  });

  test("updates after subsequent native font loads in both directions", async ({ page }) => {
    await waitForTabStrip(page);
    const titles = ["Planning notes"];
    await setTitles(page, titles);
    await page.addStyleTag({ content: ".tab { font: 16px monospace; }" });
    await expectLabels(page, titles, [false]);
    for (const [family, adjustment, overflowing] of [
      ["WideTabFixture", "400%", true],
      ["NarrowTabFixture", "50%", false],
    ] as const) {
      await page.evaluate(async ({ family, adjustment }) => {
        const style = document.createElement("style");
        style.textContent = `@font-face {
          font-family: "${family}";
          src: url("/packages/web/src/foundation/fonts/Hind-Variable.woff2");
          size-adjust: ${adjustment};
        }`;
        document.head.append(style);
        const tab = document.querySelector<HTMLElement>(".tab")!;
        tab.style.fontFamily = `"${family}", monospace`;
        const faces = await document.fonts.load(`16px "${family}"`);
        await document.fonts.ready;
        if (faces.length !== 1 || faces[0]!.status !== "loaded") {
          throw new Error("Expected a real font load");
        }
      }, { family, adjustment });
      await expectLabels(page, titles, [overflowing]);
    }
  });
});

test.describe("tab compression stability (^tb-ac-compression-stability)", () => {
  test("keeps GTD compression and truncation stable for 120 frames", async ({ page }) => {
    await waitForTabStrip(page);
    await page.evaluate(async (titles) => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture;
      fixture.setTitles(titles);
      await fixture.settle();
    }, GTD_TAB_TITLES);

    const sampled = await sampleCompressionFrames(page, 120);
    expect(sampled.stripScrollWidth).toBeGreaterThan(sampled.stripClientWidth);
    expect(sampled.frames).toHaveLength(120);
    expect(sampled.classificationMutations).toBe(0);

    const first = sampled.frames[0];
    expect(first).toHaveLength(14);
    expect(first?.some(({ compression }) => compression === "capped")).toBe(true);
    expect(first?.some(({ compression }) => compression === "hugging")).toBe(true);
    for (const state of first ?? []) {
      expect(state.compression).toBe(
        Math.ceil(state.rangeWidth) + state.horizontalChrome >
            TAB_COMPRESSION_FLOOR_PX + TAB_COMPRESSION_FLOOR_SLACK_PX
          ? "capped"
          : "hugging",
      );
      expect(state.inlineMinWidth).toBe("");
      if (state.compression === "capped") {
        expect(Math.abs(state.tabWidth - TAB_COMPRESSION_FLOOR_PX))
          .toBeLessThanOrEqual(0.01);
        expect(state.truncated).toBe(true);
      } else {
        expect(state.truncated).toBe(false);
        expect(Math.abs(
          state.tabWidth - (state.rangeWidth + state.horizontalChrome),
        )).toBeLessThanOrEqual(0.01);
      }
    }

    const stableState = first?.map((state) => ({
      artifactId: state.artifactId,
      compression: state.compression,
      tabWidth: state.tabWidth,
      truncated: state.truncated,
    }));
    for (const frame of sampled.frames.slice(1)) {
      expect(frame.map((state) => ({
        artifactId: state.artifactId,
        compression: state.compression,
        tabWidth: state.tabWidth,
        truncated: state.truncated,
      }))).toEqual(stableState);
    }
  });
});

test.describe("tab-strip overflow (^tb-ac-scroll)", () => {
  async function expectEdgeMasks(page: Page, left: boolean, right: boolean): Promise<void> {
    const masks = page.locator(".tab-strip [data-item-edge-fade]");
    // The fade zone can intersect more than one tab, depending on the gap.
    await expect.poll(() => masks.count()).toBeGreaterThan(0);
    // Distance properties are shared by all masked tabs; prove that a mask
    // actually reaches each active edge, not just that those values are set.
    await expect.poll(() => page.locator(".tab-strip").evaluate(strip => {
      const bounds = strip.getBoundingClientRect();
      const start = bounds.left + strip.clientLeft;
      const end = start + strip.clientWidth;
      const masked = [...strip.querySelectorAll("[data-item-edge-fade]")];
      return {
        left: masked.some(tab => {
          const box = tab.getBoundingClientRect();
          return box.right > start && box.left < start + 24;
        }),
        right: masked.some(tab => {
          const box = tab.getBoundingClientRect();
          return box.left < end && box.right > end - 24;
        }),
      };
    })).toEqual({ left, right });
    for (const mask of await masks.all()) {
      await expect(mask).toHaveCSS("--item-fade-left", left ? "24px" : "0px");
      await expect(mask).toHaveCSS("--item-fade-right", right ? "24px" : "0px");
    }
  }

  test("disconnecting the view clears masks and stops helper updates", async ({ page }) => {
    await waitForTabStrip(page);
    await expectEdgeMasks(page, false, true);
    const retained = await page.locator(".tab-strip").evaluate(async (element) => {
      const strip = element as HTMLElement;
      strip.dispatchEvent(new Event("scroll"));
      (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture.unmount();
      const cleared = () => [...strip.querySelectorAll<HTMLElement>(".tab")].every((tab) =>
        !tab.hasAttribute("data-item-edge-fade") &&
        ["start", "end", "left", "right"].every((name) =>
          tab.style.getPropertyValue(`--item-fade-${name}`) === ""));
      const clearedAtDisconnect = cleared();
      // Retain the detached DOM as ordinary nodes, without remounting the view.
      // Real resizing and scrolling must no longer recreate its masks.
      strip.style.width = "300px";
      document.body.append(strip);
      strip.scrollLeft = 100;
      strip.firstElementChild!.classList.add("after-disconnect");
      document.documentElement.dataset.theme = "dark";
      document.dispatchEvent(new Event("television-theme-styles-changed"));
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      const clearedAfterChanges = cleared();
      strip.remove();
      return { clearedAtDisconnect, clearedAfterChanges };
    });
    expect(retained).toEqual({ clearedAtDisconnect: true, clearedAfterChanges: true });
  });

  test("fades a selected edge tab while both scroll edges have remaining content", async ({ page }) => {
    await waitForTabStrip(page);
    const selection = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() => {
      (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture.setTabs(14, 6);
    });
    await selection.settle({ requireMotion: true });
    await page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>(".tab-strip")!;
      const selected = strip.querySelector<HTMLElement>('[aria-selected="true"]')!;
      strip.scrollLeft += selected.getBoundingClientRect().right -
        strip.getBoundingClientRect().left - strip.clientWidth + 12;
    });
    const selected = page.locator('.tab[aria-selected="true"]');
    await expect(selected).toHaveAttribute("data-item-edge-fade", "");
    await expect(selected).toHaveCSS("--item-fade-left", "24px");
    await expect(selected).toHaveCSS("--item-fade-right", "24px");
  });

  test("marks overflow throughout the scroll range and clears it when the list fits", async ({ page }) => {
    await waitForTabStrip(page);
    const strip = page.locator(".tab-strip");
    const fades = strip.locator("[data-item-edge-fade]");

    await expect(strip).toHaveAttribute("data-overflow", "");
    await expectEdgeMasks(page, false, true);

    const interiorObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.scrollTo(0.5)
    );
    const interiorMotion = await interiorObservation.settle({ requireMotion: true });
    expect(interiorMotion.scrollEvents).toBeGreaterThan(0);
    expect(interiorMotion.scrollEndEvents).toBeGreaterThan(0);
    await expect(strip).toHaveAttribute("data-overflow", "");
    await expectEdgeMasks(page, true, true);

    const endObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.scrollTo(1)
    );
    const endMotion = await endObservation.settle({ requireMotion: true });
    expect(endMotion.scrollEvents).toBeGreaterThan(0);
    expect(endMotion.scrollEndEvents).toBeGreaterThan(0);
    await expect(strip).toHaveAttribute("data-overflow", "");
    await expectEdgeMasks(page, true, false);

    const resetObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.scrollTo(0)
    );
    await resetObservation.settle({ requireMotion: true });

    const replacementObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.setTabs(2, 0)
    );
    await replacementObservation.settle();
    await expect(strip).not.toHaveAttribute("data-overflow", "");
    await expect(fades).toHaveCount(0);
    const final = await report(page);
    expect(final.scrollMax).toBe(0);
    expect(final.scrollLeft).toBe(0);
  });
});

test.describe("selected-tab centring (^tb-ac-selected-centres)", () => {
  test("moves an interior selection over the crossing duration, clamps its ends, and holds settled", async ({ page }) => {
    await waitForTabStrip(page, true);

    const interiorObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.selectIndex(6)
    );
    expectAnimatedSelectionCrossing(
      await interiorObservation.settle({ requireMotion: true }),
    );
    const interior = await report(page);
    expect(interior.selectedIndex).toBe(6);
    expect(Math.abs(interior.selectedCenterOffset ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
    expect(interior.previousVisible).toBe(true);
    expect(interior.nextVisible).toBe(true);
    expect(interior.scrollBehavior).toBe("auto");

    const startObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.selectIndex(0)
    );
    expectAnimatedSelectionCrossing(
      await startObservation.settle({ requireMotion: true }),
    );
    const start = await report(page);
    expect(start.selectedIndex).toBe(0);
    expect(Math.abs(start.scrollLeft)).toBeLessThan(0.5);

    const endObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.selectIndex(13)
    );
    expectAnimatedSelectionCrossing(
      await endObservation.settle({ requireMotion: true }),
    );
    const end = await report(page);
    expect(end.selectedIndex).toBe(13);
    expect(Math.abs(end.scrollLeft - end.scrollMax)).toBeLessThan(0.5);
  });

  test("poses a rebuilt strip without starting selection motion", async ({ page }) => {
    await waitForTabStrip(page, true);

    const observation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.setTabs(10, 6)
    );

    expectInstantScroll(await observation.settle({ requireMotion: true }));
    const rebuilt = await report(page);
    expect(rebuilt.selectedIndex).toBe(6);
    expect(Math.abs(rebuilt.selectedCenterOffset ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
  });

  test("centres instantly when reduced motion is preferred", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await waitForTabStrip(page, true);

    const observation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.selectIndex(6)
    );

    expectInstantScroll(await observation.settle({ requireMotion: true }));
    const selected = await report(page);
    expect(selected.selectedIndex).toBe(6);
    expect(Math.abs(selected.selectedCenterOffset ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
  });
});

test.describe("tab press and termination (^sn-ac-tab-input)", () => {
  test("selects from click when only pointerup carries beyond-threshold displacement", async ({ page }) => {
    await prepareGestureScenario(page);
    const target = await tabCentre(page, "artifact-2");

    await page.evaluate(() => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture;
      window.addEventListener("pointerup", () => {
        document.body.dataset.selectionCallsAtPointerUp = String(
          fixture.report().selectionCalls.length,
        );
      }, { once: true });
      window.addEventListener("click", () => {
        document.body.dataset.selectionCallsAtClick = String(
          fixture.report().selectionCalls.length,
        );
      }, { once: true });
    });

    await pressAndReleaseWithoutPointerMove(
      page,
      target,
      { x: target.x + 8, y: target.y },
    );

    await expect(page.locator("body")).toHaveAttribute("data-selection-calls-at-pointer-up", "0");
    await expect(page.locator("body")).toHaveAttribute("data-selection-calls-at-click", "1");
    expect(await report(page)).toMatchObject({
      selectedArtifactId: "artifact-2",
      selectedPageArtifactId: "artifact-2",
      draggedArtifactId: null,
      selectionCalls: [{ channelID: "channel-tabs", artifactID: "artifact-2" }],
      reorderCalls: [],
      hasPointerCapture: false,
    });
  });

  test("selects from a keyboard-generated click", async ({ page }) => {
    await prepareGestureScenario(page);

    await page.evaluate(() => {
      window.addEventListener("click", (event) => {
        document.body.dataset.activationClickDetail = String((event as MouseEvent).detail);
      }, { capture: true, once: true });
    });
    await page.locator('[data-artifact-id="artifact-2"]').press("Enter");

    await expect(page.locator("body")).toHaveAttribute("data-activation-click-detail", "0");
    await expect(page.locator('[data-artifact-id="artifact-2"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect((await report(page)).selectionCalls).toEqual([
      { channelID: "channel-tabs", artifactID: "artifact-2" },
    ]);
  });

  test("selects through click at the 4 px drag threshold and updates the paired stage page", async ({ page }) => {
    await prepareGestureScenario(page);
    const target = await tabCentre(page, "artifact-2");

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    expect(await report(page)).toMatchObject({
      selectedArtifactId: "artifact-0",
      selectedPageArtifactId: "artifact-0",
      draggedArtifactId: null,
      placeholderCount: 0,
      selectionCalls: [],
      reorderCalls: [],
      hasPointerCapture: false,
    });

    await page.mouse.move(target.x + 4, target.y);
    expect(await report(page)).toMatchObject({
      selectedArtifactId: "artifact-0",
      selectedPageArtifactId: "artifact-0",
      draggedArtifactId: null,
      placeholderCount: 0,
      selectionCalls: [],
      reorderCalls: [],
      hasPointerCapture: false,
    });

    await page.mouse.up();
    await expect(page.locator('[data-artifact-id="artifact-2"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator('#gesture-stage-mount .page[data-page-key="artifact-2"]'))
      .toHaveAttribute("selected", "");
    expect(await report(page)).toMatchObject({
      selectedArtifactId: "artifact-2",
      selectedPageArtifactId: "artifact-2",
      draggedArtifactId: null,
      placeholderCount: 0,
      selectionCalls: [{ channelID: "channel-tabs", artifactID: "artifact-2" }],
      reorderCalls: [],
      hasPointerCapture: false,
      captureEvents: [],
    });
  });

  test("keeps a beyond-threshold drag captured outside and finalizes the placeholder once without selecting", async ({ page }) => {
    await prepareGestureScenario(page);
    const target = await tabCentre(page, "artifact-2");

    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 5, target.y);
    await expect(page.locator('[data-artifact-id="artifact-2"]')).toHaveClass(/\bdragged\b/);
    expect(await report(page)).toMatchObject({
      selectedArtifactId: "artifact-0",
      selectedPageArtifactId: "artifact-0",
      draggedArtifactId: "artifact-2",
      placeholderCount: 1,
      placeholderBeforeArtifactId: "artifact-2",
      selectionCalls: [],
      reorderCalls: [],
      hasPointerCapture: true,
    });

    await page.mouse.move(target.x + 5, 10);
    expect(await report(page)).toMatchObject({
      draggedArtifactId: "artifact-2",
      placeholderCount: 1,
      hasPointerCapture: true,
    });
    await page.mouse.up();
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.settle()
    );

    expectOriginalGestureState(await report(page));
  });

  test("Escape, pointer cancellation, and unexpected capture loss restore without operations", async ({ page }) => {
    await prepareGestureScenario(page);

    for (const exit of ["Escape", "pointercancel", "capture-loss"] as const) {
      await page.evaluate(async () => {
        const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
          .__tabStripFixture;
        fixture.resetGestureScenario();
        await fixture.settle();
        fixture.startGestureObservation();
      });
      const target = await tabCentre(page, "artifact-2");
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await page.mouse.move(target.x + 5, target.y);
      await expect(page.locator('[data-artifact-id="artifact-2"]')).toHaveClass(/\bdragged\b/);
      const first = await tabBox(page, "artifact-0");
      await page.mouse.move(Math.floor(first.left - 2), first.centerY);
      expect(await report(page), exit).toMatchObject({
        tabOrder: ["artifact-2", "artifact-0", "artifact-1", "artifact-3"],
        pageOrder: ["artifact-2", "artifact-0", "artifact-1", "artifact-3"],
        reorderCalls: [],
        selectionCalls: [],
      });

      try {
        if (exit === "Escape") {
          await page.keyboard.press("Escape");
        } else if (exit === "pointercancel") {
          await page.evaluate(() =>
            (window as unknown as { __tabStripFixture: TabStripFixture })
              .__tabStripFixture.dispatchPointerCancel()
          );
        } else {
          await page.evaluate(() =>
            (window as unknown as { __tabStripFixture: TabStripFixture })
              .__tabStripFixture.releasePointerCapture()
          );
          // Chromium processes the pending capture override, and therefore
          // emits lostpointercapture, immediately before the next pointer event.
          await page.mouse.move(target.x + 6, target.y);
        }
        await page.evaluate(() =>
          (window as unknown as { __tabStripFixture: TabStripFixture })
            .__tabStripFixture.settle()
        );

        expectOriginalGestureState(
          await report(page),
          exit,
          ["artifact-2", "artifact-0", "artifact-1", "artifact-3"],
        );
      } finally {
        await page.mouse.up();
      }
    }
  });
});

test.describe("tab-drag edge scroll (^tb-ac-drag-scroll)", () => {
  test("cancels a live selection crossing when an edge drag takes over scrolling", async ({ page }) => {
    await waitForTabStrip(page, true);
    const origin = await tabCentre(page, "artifact-1");
    const stripBox = await page.locator(".tab-strip").boundingBox();
    if (!stripBox) throw new Error("Expected the tab strip to have a box");

    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    try {
      await page.evaluate(() =>
        (window as unknown as { __tabStripFixture: TabStripFixture })
          .__tabStripFixture.selectIndex(13)
      );
      await page.evaluate((crossingDurationMs) => new Promise<void>(
        (resolve, reject) => {
          let frames = 0;
          const sample = (): void => {
            const strip = document.querySelector<HTMLElement>(".tab-strip");
            if (!strip) {
              reject(new Error("Expected a rendered tab strip"));
              return;
            }
            const crossing = strip.getAnimations().find((animation) =>
              Number(animation.effect?.getTiming().duration) ===
                crossingDurationMs &&
              (animation.pending || animation.playState === "running")
            );
            if (crossing && strip.scrollLeft > 10) {
              resolve();
              return;
            }
            frames += 1;
            if (frames >= 20) {
              reject(new Error("Selection crossing did not reach an intermediate position"));
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        },
      ), CROSSING_DURATION_MS);

      await page.mouse.move(origin.x + 5, origin.y);
      const afterPickup = await page.locator(".tab-strip").evaluate(
        (strip, crossingDurationMs) => ({
          activeCrossings: strip.getAnimations().filter((animation) =>
            Number(animation.effect?.getTiming().duration) ===
              crossingDurationMs &&
            (animation.pending || animation.playState === "running")
          ).length,
          scrollLeft: strip.scrollLeft,
        }),
        CROSSING_DURATION_MS,
      );
      const leftOuterX = stripBox.x + 0.5;
      await page.mouse.move(leftOuterX, origin.y);
      const edgeSamples = await sampleScrollFrames(page, 8);
      const positions = edgeSamples.map(({ scrollLeft }) => scrollLeft);

      expect(positions).toEqual([...positions].sort((left, right) => right - left));
      expect(positions.at(-1)).toBeLessThan(positions[0]!);
      expect(positions[0]).toBeLessThanOrEqual(afterPickup.scrollLeft);
      expect(afterPickup.activeCrossings).toBe(0);
    } finally {
      await page.mouse.up();
    }
  });

  test("tapers both edge velocities, tracks newly revealed slots, and stops outside or on release", async ({ page }) => {
    await delayInitialFontSettlement(page);
    await waitForTabStrip(page, true);
    await page.evaluate(() => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture;
      fixture.startGestureObservation();
    });

    const carriedArtifactId = "artifact-1";
    const origin = await tabCentre(page, carriedArtifactId);
    const stripBox = await page.locator(".tab-strip").boundingBox();
    if (!stripBox) throw new Error("Expected the tab strip to have a box");
    const right = stripBox.x + stripBox.width;
    const rightOuterX = right - 0.5;
    const rightMiddleX = right - 14;
    const rightNearInnerX = Math.floor(right - 28) + 1;
    const expectedOuterVelocity = 800 * (28 - (right - rightOuterX)) / 28;
    const expectedMiddleVelocity = 400;
    const expectedNearInnerVelocity = 800 *
      (rightNearInnerX - (right - 28)) / 28;

    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, origin.y);
    await expect(page.locator(`[data-artifact-id="${carriedArtifactId}"]`))
      .toHaveClass(/\bdragged\b/);

    const rightObservation = await startMotionObservation(page, ".tab-strip");
    await page.mouse.move(rightOuterX, origin.y);
    const outerSamples = await sampleScrollFrames(page, 10);
    const outerVelocity = scrollVelocity(outerSamples);
    expectVelocityNear(outerVelocity, expectedOuterVelocity);
    expect(outerSamples.slice(1).every((sample, index) =>
      sample.scrollLeft > outerSamples[index]!.scrollLeft
    )).toBe(true);

    await page.mouse.move(rightMiddleX, origin.y);
    const middleSamples = await sampleScrollFrames(page, 10);
    const middleVelocity = scrollVelocity(middleSamples);
    expectVelocityNear(middleVelocity, expectedMiddleVelocity);
    expect(middleVelocity).toBeGreaterThan(outerVelocity * 0.35);
    expect(middleVelocity).toBeLessThan(outerVelocity * 0.65);

    await page.mouse.move(right - 28.5, origin.y);
    const beforeFontSettlement = await report(page);
    expect(beforeFontSettlement.scrollLeft).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as unknown as { __resolveTabStripFontSettlement: () => void })
        .__resolveTabStripFontSettlement();
    });
    const fontSettlementSamples = await sampleScrollFrames(page, 4);
    expect(fontSettlementSamples.every(({ scrollLeft }) =>
      Math.abs(scrollLeft - beforeFontSettlement.scrollLeft) < 0.5
    )).toBe(true);

    await page.mouse.move(rightNearInnerX, origin.y);
    const nearInnerSamples = await sampleScrollFrames(page, 60);
    const nearInnerVelocity = scrollVelocity(nearInnerSamples);
    expectVelocityNear(nearInnerVelocity, expectedNearInnerVelocity);
    expect(nearInnerVelocity).toBeGreaterThan(0);
    expect(nearInnerVelocity).toBeLessThan(middleVelocity * 0.15);

    await page.mouse.move(rightOuterX, origin.y);
    const holdStart = await report(page);
    const holdStartSlot = holdStart.tabOrder.indexOf(carriedArtifactId);
    const revealedSlot = holdStartSlot + 2;
    const initiallyOffscreenArtifactId = holdStart.tabOrder[revealedSlot];
    if (!initiallyOffscreenArtifactId) {
      throw new Error(`Expected a tab after carried slot ${holdStartSlot}`);
    }
    const initiallyOffscreen = await tabBox(page, initiallyOffscreenArtifactId);
    expect(initiallyOffscreen.left).toBeGreaterThan(right);
    const revealed = await waitForCarriedSlot(
      page,
      carriedArtifactId,
      revealedSlot,
    );
    expect(revealed.scrollLeft).toBeGreaterThan(holdStart.scrollLeft);
    expect(revealed.tabOrder.indexOf(carriedArtifactId)).toBeGreaterThanOrEqual(
      revealedSlot,
    );

    await page.mouse.move(right - 28.5, origin.y);
    const stoppedSamples = await sampleScrollFrames(page, 6);
    expect(Math.abs(scrollVelocity(stoppedSamples))).toBeLessThan(1);
    const rightMotion = await rightObservation.settle({ requireMotion: true });
    expect(rightMotion.scrollEvents).toBeGreaterThan(0);

    const leftOuterX = stripBox.x + 0.5;
    const expectedLeftVelocity = -800 * (28 - (leftOuterX - stripBox.x)) / 28;
    await page.mouse.move(leftOuterX, origin.y);
    const leftSamples = await sampleScrollFrames(page, 10);
    expectVelocityNear(scrollVelocity(leftSamples), expectedLeftVelocity);

    await page.mouse.up();
    const released = await report(page);
    const afterReleaseSamples = await sampleScrollFrames(page, 6);
    expect(Math.abs(scrollVelocity(afterReleaseSamples))).toBeLessThan(1);
    expect(afterReleaseSamples.every(({ scrollLeft }) =>
      Math.abs(scrollLeft - released.scrollLeft) < 0.5
    )).toBe(true);
    expect(released).toMatchObject({
      draggedArtifactId: null,
      placeholderCount: 0,
      hasPointerCapture: false,
      reorderCalls: [{
        channelID: "channel-tabs",
        artifactIDs: released.tabOrder,
      }],
    });
  });

  test("drops an ordinary centre request latched during a plain drag", async ({ page }) => {
    await delayInitialFontSettlement(page);
    await waitForTabStrip(page, true);
    const setupObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture;
      fixture.setTabs(14, 6);
    });
    await setupObservation.settle();
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.scrollTo(0)
    );

    const origin = await tabCentre(page, "artifact-1");
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, origin.y);
    const beforeRelease = (await report(page)).scrollLeft;
    expect(beforeRelease).toBe(0);
    await page.evaluate(() => {
      const controls = window as unknown as {
        __holdNextTabStripFrame: () => void;
        __resolveTabStripFontSettlement: () => void;
      };
      controls.__holdNextTabStripFrame();
      controls.__resolveTabStripFontSettlement();
    });
    await page.mouse.up();
    await page.evaluate(() => {
      (window as unknown as { __releaseTabStripFrame: () => void })
        .__releaseTabStripFrame();
    });

    const afterReleaseSamples = await sampleScrollFrames(page, 4);
    expect(afterReleaseSamples.every(({ scrollLeft }) =>
      Math.abs(scrollLeft - beforeRelease) < 0.5
    )).toBe(true);

    const selectionObservation = await startMotionObservation(page, ".tab-strip");
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.selectIndex(5)
    );
    expectAnimatedSelectionCrossing(
      await selectionObservation.settle({ requireMotion: true }),
    );
    const afterSelection = await report(page);
    expect(afterSelection.selectedArtifactId).not.toBe("artifact-6");
    expect(Math.abs(afterSelection.selectedCenterOffset ?? Infinity)).toBeLessThan(1);
  });

  test("defers selection centring until edge and plain drags finish", async ({ page }) => {
    await waitForTabStrip(page, true);

    for (const edgeScroll of [true, false]) {
      const setupObservation = await startMotionObservation(page, ".tab-strip");
      await page.evaluate(() =>
        (window as unknown as { __tabStripFixture: TabStripFixture })
          .__tabStripFixture.setTabs(14, 0)
      );
      await setupObservation.settle();
      const origin = await tabCentre(page, "artifact-1");
      const stripBox = await page.locator(".tab-strip").boundingBox();
      if (!stripBox) throw new Error("Expected the tab strip to have a box");
      const right = stripBox.x + stripBox.width;
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await page.mouse.move(origin.x + 5, origin.y);
      if (edgeScroll) {
        await page.mouse.move(right - 0.5, origin.y);
        const scrollingSamples = await sampleScrollFrames(page, 8);
        expect(scrollingSamples.at(-1)!.scrollLeft).toBeGreaterThan(
          scrollingSamples[0]!.scrollLeft,
        );
        await page.mouse.move(right - 28.5, origin.y);
      }
      const beforeSelection = await report(page);
      await page.evaluate(() => {
        (window as unknown as { __tabStripFixture: TabStripFixture })
          .__tabStripFixture.selectIndex(6);
      });
      const heldSamples = await sampleScrollFrames(page, 3);
      expect(heldSamples.every(({ scrollLeft }) =>
        Math.abs(scrollLeft - beforeSelection.scrollLeft) < 0.5
      )).toBe(true);
      const selectedDuringDrag = (await report(page)).selectedArtifactId;
      expect(selectedDuringDrag).not.toBe("artifact-0");

      const releaseObservation = await startMotionObservation(page, ".tab-strip");
      await page.mouse.up();
      expectAnimatedSelectionCrossing(
        await releaseObservation.settle({ requireMotion: true }),
      );
      const afterRelease = await report(page);
      expect(afterRelease.selectedArtifactId).toBe(selectedDuringDrag);
      expect(Math.abs(afterRelease.selectedCenterOffset ?? Infinity)).toBeLessThan(1);
    }
  });

  test("preserves only actual edge movement across a late resize delivery", async ({ page }) => {
    await waitForTabStrip(page, true);

    const origin = await tabCentre(page, "artifact-1");
    const stripBox = await page.locator(".tab-strip").boundingBox();
    if (!stripBox) throw new Error("Expected the tab strip to have a box");
    const right = stripBox.x + stripBox.width;
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, origin.y);
    await page.mouse.move(right - 0.5, origin.y);
    await sampleScrollFrames(page, 8);
    await page.mouse.move(right - 28.5, origin.y);
    const edgePosition = (await sampleScrollFrames(page, 3)).at(-1)!.scrollLeft;
    expect(edgePosition).toBeGreaterThan(0);
    await page.mouse.up();
    await resizeTabStrip(page);
    const afterEdgeResize = await sampleScrollFrames(page, 4);
    expect(afterEdgeResize.every(({ scrollLeft }) =>
      Math.abs(scrollLeft - edgePosition) < 0.5
    )).toBe(true);

    await page.evaluate(async () => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture;
      fixture.setTabs(14, 6);
      await fixture.settle();
      fixture.scrollTo(0);
    });
    const plainOrigin = await tabCentre(page, "artifact-1");
    await page.mouse.move(plainOrigin.x, plainOrigin.y);
    await page.mouse.down();
    await page.mouse.move(plainOrigin.x + 5, plainOrigin.y);
    await page.mouse.up();
    await resizeTabStrip(page);
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.settle()
    );
    const afterPlainResize = await report(page);
    expect(afterPlainResize.scrollLeft).toBeGreaterThan(0);
    expect(Math.abs(afterPlainResize.selectedCenterOffset ?? Infinity)).toBeLessThan(1);
  });

  test("emits no scroll and leaves scroll position unchanged when the tabs fit", async ({ page }) => {
    await waitForTabStrip(page, true);
    await page.evaluate(async () => {
      const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture;
      fixture.setTabs(2, 0);
      await fixture.settle();
    });
    expect(await report(page)).toMatchObject({ scrollLeft: 0, scrollMax: 0 });

    const origin = await tabCentre(page, "artifact-1");
    const stripBox = await page.locator(".tab-strip").boundingBox();
    if (!stripBox) throw new Error("Expected the tab strip to have a box");
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, origin.y);

    const observation = await startMotionObservation(page, ".tab-strip");
    await page.mouse.move(stripBox.x + stripBox.width - 0.5, origin.y);
    const heldSamples = await sampleScrollFrames(page, 8);
    await page.mouse.up();
    const motion = await observation.settle();
    expect(motion.scrollEvents).toBe(0);
    expect(new Set(heldSamples.map(({ scrollLeft }) => scrollLeft))).toEqual(new Set([0]));
    expect(await report(page)).toMatchObject({
      scrollLeft: 0,
      scrollMax: 0,
      draggedArtifactId: null,
      placeholderCount: 0,
      tabOrder: ["artifact-0", "artifact-1"],
      reorderCalls: [],
    });
  });
});

test.describe("coupled tab/page reorder motion (^sn-ac-reorder-motion)", () => {
  const scenarios = [
    {
      label: "selected ordinary tab moves right by one slot",
      selected: 1,
      carried: "artifact-1",
      destination: "artifact-2",
      direction: "right" as const,
      fullScreen: false,
      expectedOrder: ["artifact-0", "artifact-2", "artifact-1", "artifact-3"],
    },
    {
      label: "background ordinary tab moves right across the selection",
      selected: 2,
      carried: "artifact-0",
      destination: "artifact-3",
      direction: "right" as const,
      fullScreen: false,
      expectedOrder: ["artifact-1", "artifact-2", "artifact-3", "artifact-0"],
    },
    {
      label: "selected full-screen tab moves left across every neighbour",
      selected: 3,
      carried: "artifact-3",
      destination: "artifact-0",
      direction: "left" as const,
      fullScreen: true,
      expectedOrder: ["artifact-3", "artifact-0", "artifact-1", "artifact-2"],
    },
  ];

  test("paints a carried tab above the selected artifact below the tab band", async ({ page }) => {
    await prepareGestureScenario(page);
    const origin = await tabCentre(page, "artifact-2");
    const iframe = page.locator('#gesture-stage-mount .page[selected] iframe');
    const box = await iframe.boundingBox();
    if (!box) throw new Error("Expected the selected artifact to have a rendered iframe");
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, origin.y);
    await page.mouse.move(point.x, point.y);
    await expect.poll(() => page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.closest(".tab[dragging]")
        ?.getAttribute("data-artifact-id"), point))
      .toBe("artifact-2");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(async () => (await report(page)).captureEvents.map(({ type }) => type))
      .toEqual(["gotpointercapture", "lostpointercapture"]);
    expectOriginalGestureState(await report(page));
  });

  test("couples selected/background adjacent/far reorders without pickup geometry changes and with one final write", async ({ page }) => {
    await waitForTabStrip(page, true);

    for (const scenario of scenarios) {
      await configureTestMotion(page);
      const setupMotion = await startMotionObservation(page, "#gesture-shell");
      await page.evaluate(async ({ selected, fullScreen }) => {
        const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
          .__tabStripFixture;
        fixture.resetGestureScenario({ selected, fullScreen });
        await fixture.settle();
      }, scenario);
      await setupMotion.settle();
      await configureTestMotion(page, { allowCSSMotion: true });
      await page.evaluate(() => {
        const fixture = (window as unknown as { __tabStripFixture: TabStripFixture })
          .__tabStripFixture;
        fixture.startGestureObservation();
        fixture.startFullScreenObservation();
      });

      const selectedArtifactId = `artifact-${scenario.selected}`;
      const before = await report(page);
      const originalLayout = before.pageLayoutBoxes;
      const originalRendered = await renderedPages(page);
      const origin = await tabCentre(page, scenario.carried);
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();

      const pickupObservation = await startMotionObservation(page, "#gesture-shell");
      await page.mouse.move(origin.x + 5, origin.y);
      const pickup = await pickupObservation.settle();
      expect(pickup.transitionEvents, scenario.label).toEqual([]);
      expect(await renderedPages(page), scenario.label).toEqual(originalRendered);

      const pickedUp = await report(page);
      expect(pickedUp, scenario.label).toMatchObject({
        selectedArtifactId,
        selectedPageArtifactId: selectedArtifactId,
        selectedPageFullScreen: scenario.fullScreen,
        draggedArtifactId: scenario.carried,
        placeholderCount: 1,
        placeholderBeforeArtifactId: scenario.carried,
        reorderCalls: [],
        selectionCalls: [],
        hasPointerCapture: true,
      });
      expect(Math.abs(pickedUp.selectedPageCenterOffset ?? Infinity), scenario.label)
        .toBeLessThan(1);
      expect(pickedUp.pageLayoutBoxes, scenario.label).toEqual(originalLayout);

      const destination = await tabBox(page, scenario.destination);
      const crossX = scenario.direction === "right"
        ? Math.ceil(destination.right + 2)
        : Math.floor(destination.left - 2);
      const crossY = Math.round(destination.centerY + 100);
      const displacementObservation = await startMotionObservation(page, "#gesture-shell");
      await page.mouse.move(crossX, crossY);
      const displacementFrame = await sampleDisplacementFrame(page, crossX, crossY);
      const displacement = await displacementObservation.settle({ requireMotion: true });

      expect(displacementFrame.targets.some((target) => target.startsWith("tab:")), scenario.label)
        .toBe(true);
      expect(displacementFrame.targets.some((target) => target.startsWith("page:")), scenario.label)
        .toBe(true);
      expect(displacementFrame.startTimes.length, scenario.label).toBeGreaterThan(1);
      expect(displacementFrame.tabOrder, scenario.label).toEqual(scenario.expectedOrder);
      expect(displacementFrame.pageOrder, scenario.label).toEqual(scenario.expectedOrder);
      expect(
        Math.max(...displacementFrame.startTimes) - Math.min(...displacementFrame.startTimes),
        scenario.label,
      ).toBeLessThan(1);
      expect(Math.abs(displacementFrame.selectedCenterOffset ?? Infinity), scenario.label)
        .toBeLessThan(1);
      expect(displacementFrame.topArtifactId, scenario.label).toBe(scenario.carried);
      const displacementAnimations = displacement.webAnimations.filter(({ kind, duration }) =>
        kind === "web-animation" && duration === 200
      );
      expect(displacementAnimations.length, scenario.label).toBeGreaterThan(1);
      expect(displacementAnimations.every(({ finished }) => finished), scenario.label).toBe(true);

      const provisional = await report(page);
      expect(provisional, scenario.label).toMatchObject({
        tabOrder: scenario.expectedOrder,
        pageOrder: scenario.expectedOrder,
        selectedArtifactId,
        selectedPageArtifactId: selectedArtifactId,
        selectedPageFullScreen: scenario.fullScreen,
        draggedArtifactId: scenario.carried,
        reorderCalls: [],
        selectionCalls: [],
      });
      expect(Math.abs(provisional.selectedPageCenterOffset ?? Infinity), scenario.label)
        .toBeLessThan(1);
      expect(provisional.pageLayoutBoxes, scenario.label).toEqual(originalLayout);

      const beforeRelease = await renderedPages(page);
      const releaseObservation = await startMotionObservation(page, "#gesture-shell");
      await page.mouse.up();
      const release = await releaseObservation.settle();
      expect(release.transitionEvents, scenario.label).toEqual([]);
      expect(release.webAnimations.some(({ kind, duration }) =>
        kind === "web-animation" && duration === 200
      ), scenario.label).toBe(false);
      expect(release.scrollEvents, scenario.label).toBe(0);

      const settled = await report(page);
      expect(settled, scenario.label).toMatchObject({
        tabOrder: scenario.expectedOrder,
        pageOrder: scenario.expectedOrder,
        selectedArtifactId,
        selectedPageArtifactId: selectedArtifactId,
        selectedPageFullScreen: scenario.fullScreen,
        draggedArtifactId: null,
        placeholderCount: 0,
        selectionCalls: [],
        reorderCalls: [{
          channelID: "channel-tabs",
          artifactIDs: scenario.expectedOrder,
          sizes: scenario.expectedOrder.map(authoredPageSize),
        }],
        hasPointerCapture: false,
      });
      expect(Math.abs(settled.selectedPageCenterOffset ?? Infinity), scenario.label)
        .toBeLessThan(1);
      expect(settled.pageLayoutBoxes, scenario.label).toEqual(originalLayout);
      expect(await renderedPages(page), scenario.label).toEqual(beforeRelease);
      expect(
        settled.fullScreenStates.every(({ artifactId, fullScreen }) =>
          artifactId === selectedArtifactId && fullScreen === scenario.fullScreen
        ),
        scenario.label,
      ).toBe(true);
    }
  });
});

test.describe("production shell reorder conduit", () => {
  test("carries one provisional order from the top-bar tab gesture into Stage", async ({ page }) => {
    await page.goto("/packages/web/test/e2e/fixtures/keyboard-navigation.html");
    await page.waitForFunction(() =>
      (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true
    );
    await configureTestMotion(page);

    const constants = await page.evaluate(() =>
      (window as unknown as {
        __keyboardNavigationFixture: {
          constants: { firstArtifactId: string; secondArtifactId: string };
        };
      }).__keyboardNavigationFixture.constants
    );
    const order = () => page.evaluate(() => ({
      tabs: [...document.querySelectorAll<HTMLElement>(".tab")]
        .map(({ dataset }) => dataset.artifactId ?? ""),
      pages: [...document.querySelectorAll<HTMLElement>(".page")]
        .map(({ dataset }) => dataset.pageKey ?? ""),
      selectedPage: document.querySelector<HTMLElement>(".page[selected]")?.dataset.pageKey ?? null,
      held: document.querySelector(".tab[dragging]") !== null,
    }));
    const original = [constants.firstArtifactId, constants.secondArtifactId];
    const provisional = [constants.secondArtifactId, constants.firstArtifactId];
    expect(await order()).toEqual({
      tabs: original,
      pages: original,
      selectedPage: constants.firstArtifactId,
      held: false,
    });

    const first = await tabCentre(page, constants.firstArtifactId);
    const second = await tabCentre(page, constants.secondArtifactId);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(second.x + 6, second.y);
    await page.mouse.move(first.x - 10, first.y);

    await expect.poll(order).toEqual({
      tabs: provisional,
      pages: provisional,
      selectedPage: constants.firstArtifactId,
      held: true,
    });

    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(order).toEqual({
      tabs: original,
      pages: original,
      selectedPage: constants.firstArtifactId,
      held: false,
    });
  });
});

test.describe("tab-strip keyboard movement (^tb-ac-keyboard)", () => {
  test("keeps selection and focus on the selected tab for plain arrows and leaves in one Tab", async ({ page }) => {
    await waitForTabStrip(page);
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.setTabs(7, 3)
    );
    await page.evaluate(() =>
      (window as unknown as { __tabStripFixture: TabStripFixture })
        .__tabStripFixture.settle()
    );

    const selectedTab = page.locator('[data-artifact-id="artifact-3"]');
    await page.locator("#before").focus();
    await page.keyboard.press("Tab");
    await expect(selectedTab).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(selectedTab).toHaveAttribute("aria-selected", "true");
    await expect(selectedTab).toBeFocused();
    expect((await report(page)).selectionCalls).toEqual([]);

    await page.keyboard.press("ArrowLeft");
    await expect(selectedTab).toHaveAttribute("aria-selected", "true");
    await expect(selectedTab).toBeFocused();

    const value = await report(page);
    expect(value.tabIndexes).toEqual(["-1", "-1", "-1", "0", "-1", "-1", "-1"]);
    expect(value.selectionCalls).toEqual([]);

    await page.keyboard.press("Tab");
    await expect(page.locator("#after")).toBeFocused();
  });
});

// proofs/arch/ui/overflow-fade.md#^of-ac-style-refresh
test("refreshes overflow after applied theme and effective appearance changes", async ({ page }) => {
  await page.route("**/theme/theme.css?*", route => route.fulfill({
    contentType: "text/css",
    body: ":root { --fixture-gap: 4px; } :root[data-theme=dark] { --fixture-gap: 24px; }",
  }));
  await waitForTabStrip(page);
  await page.addStyleTag({ content: `
    :root { --fixture-gap: 0px; }
    .fixture-row { grid-template-columns: auto 300px auto; }
    .tab-strip { padding: 0; margin: 0; gap: var(--fixture-gap); }
    .tab { flex: 0 0 100px; min-width: 100px !important; max-width: 100px; }
  ` });
  await page.evaluate(async () => {
    const fixture = (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture;
    fixture.setTabs(3, 0);
    await fixture.settle();
  });
  const strip = page.locator(".tab-strip");
  await expect(strip).not.toHaveAttribute("data-overflow");
  await page.evaluate(async () => {
    const links = (window as unknown as { __themeLinks: { refreshThemeLink(url: string): HTMLLinkElement } }).__themeLinks;
    const link = links.refreshThemeLink(location.origin);
    await new Promise<void>((resolve, reject) => {
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => reject(new Error("fixture theme failed")), { once: true });
    });
  });
  await expect(strip).toHaveAttribute("data-overflow");
  await expect.poll(() => strip.locator(".tab").nth(2).evaluate(el => (el as HTMLElement).style.getPropertyValue("--item-fade-end"))).toBe("92px");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect.poll(() => strip.locator(".tab").nth(2).evaluate(el => (el as HTMLElement).style.getPropertyValue("--item-fade-end"))).toBe("52px");
  expect(await strip.evaluate(el => el.scrollLeft)).toBe(0);
  await page.evaluate(() => {
    (window as unknown as { __themeLinks: { clearThemeLink(): void } }).__themeLinks.clearThemeLink();
  });
  await expect(strip).not.toHaveAttribute("data-overflow");
  await expect(strip.locator("[data-item-edge-fade]")).toHaveCount(0);
});


test("updates overflow before paint during sidebar motion (^tb-ac-sidebar-motion-layout)", async ({ page }) => {
  await waitForTabStrip(page, true);
  await page.evaluate(async () => {
    const fixture = (window as unknown as { __tabStripFixture: TabStripFixture }).__tabStripFixture;
    fixture.setMotionSuppressed(true);
    await fixture.settle();
  });
  for (const width of [3000, 520]) {
    const result = await page.evaluate((nextWidth) => new Promise<{ overflow: boolean; needed: boolean }>((resolve) => {
      const strip = document.querySelector<HTMLElement>(".tab-strip")!;
      const row = document.querySelector<HTMLElement>(".fixture-row")!;
      const observer = new ResizeObserver(() => {
        if (Math.abs(strip.clientWidth - nextWidth) > 1) return;
        observer.disconnect();
        resolve({ overflow: strip.hasAttribute("data-overflow"), needed: strip.scrollWidth > strip.clientWidth + 1 });
      });
      observer.observe(strip);
      row.style.gridTemplateColumns = `auto ${nextWidth}px auto`;
    }), width);
    expect(result.needed).toBe(width === 520);
    expect(result.overflow).toBe(result.needed);
  }
});
