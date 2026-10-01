import { expect, test } from "../../../../test/helpers/playwright.ts";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import {
  launchProductServer,
  type ProductServer,
} from "../../../../test/helpers/product-server.ts";
import { createArtifactFile } from "./helpers.ts";
import { sidebarPose, sidebarProgressAt, type SidebarGeometry } from "../../../../specs/ui/app/sidebar-transition.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SIDEBAR_WIDTH_KEY = "tv-channel-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "tv-channel-sidebar-collapsed";
const COMMITTED_WIDTH_PX = 312;
const COLLAPSE_DURATION_MS = 180;
const GEOMETRY_TOLERANCE_PX = 1;
const STAGE_MEASURES = parse(readFileSync(path.join(REPO_ROOT, "specs/ui/app/stage/measures.yml"), "utf8")) as {
  page: { initial_width_px: number; initial_height_px: number };
  sizing: { width_share: number; height_share: number; reference_width_px: number; reference_height_px: number };
};

interface MotionRun {
  readonly duration: number;
  readonly boundarySamples: readonly number[];
  readonly resizeDeliveries: number;
  readonly animationFrames: number;
  readonly lifecycle: readonly string[];
  readonly transitionMarkupObserved: boolean;
  readonly unexpectedShellAnimations: readonly string[];
}

interface ReversalStart {
  readonly beforeBoundary: number;
  readonly afterBoundary: number;
  readonly duration: number;
  readonly sampleIndex: number;
  readonly trusted: boolean;
  readonly pointerType: string;
  readonly detail: number;
}

function createStoragePath(): string {
  const parent = path.join(REPO_ROOT, "tmp", "sidebar-collapse-e2e");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "run-"));
}

async function seedFocusedArtifact(
  client: TelevisionClient,
  product: ProductServer,
): Promise<void> {
  const { channel } = await client.channels.create({ name: "Collapse acceptance" });
  const artifactPath = createArtifactFile(
    product.home,
    "sidebar-collapse-live-artifact",
    `<!doctype html>
      <title>Collapse acceptance</title>
      <output id="artifact-state">initial</output>`,
    "html",
  );
  await client.artifacts.create({
    channelID: channel.id,
    kind: "path",
    title: "Live collapse artifact",
    path: artifactPath,
  });
  await client.display.patch({ focusedChannelId: channel.id });
}

async function openApp(page: Page, product: ProductServer): Promise<void> {
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.goto(product.serverURL);
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
  await expect(page.locator("#tv-test-no-css-motion")).toHaveCount(0);
  await expect(page.frameLocator("iframe.artifact-content").locator("#artifact-state"))
    .toHaveText("initial");
}

async function clickToggle(page: Page): Promise<void> {
  const toggle = page.locator(".sidebar-collapse, .sidebar-expand, .sidebar-motion-toggle");
  const box = await toggle.boundingBox();
  if (!box) throw new Error("Sidebar toggle has no pointer target");
  // The in-flight control is intentionally moving. A direct mouse action at
  // its freshly sampled centre avoids a locator stability wait while still
  // sending trusted pointer input to the live button.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function rememberToggle(page: Page): Promise<void> {
  await page.locator(".sidebar-collapse, .sidebar-expand, .sidebar-motion-toggle").evaluate((toggle) => {
    (window as unknown as { __sidebarToggle?: Element }).__sidebarToggle = toggle;
  });
}

async function expectSameToggle(page: Page): Promise<void> {
  expect(await page.locator(".sidebar-collapse, .sidebar-expand, .sidebar-motion-toggle").evaluate((toggle) =>
    (window as unknown as { __sidebarToggle?: Element }).__sidebarToggle === toggle
  )).toBe(true);
}

async function startMotionProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface Probe {
      root: HTMLElement;
      main: HTMLElement;
      boundarySamples: number[];
      resizeDeliveries: number;
      animationFrames: number;
      lifecycle: string[];
      durations: number[];
      observedAnimations: Animation[];
      transitionMarkupObserved: boolean;
      unexpectedShellAnimations: string[];
      resizeObserver: ResizeObserver;
      running: boolean;
      settlement: Promise<MotionRun>;
      resolveSettlement: (result: MotionRun) => void;
      settling: boolean;
    }

    const owner = window as unknown as { __sidebarMotionProbe?: Probe };
    owner.__sidebarMotionProbe?.resizeObserver.disconnect();
    if (owner.__sidebarMotionProbe) owner.__sidebarMotionProbe.running = false;
    const root = document.querySelector<HTMLElement>("#app");
    const main = root?.querySelector<HTMLElement>(".app-main");
    if (!root || !main) throw new Error("Application shell is not mounted");
    let resolveSettlement!: (result: MotionRun) => void;
    const settlement = new Promise<MotionRun>((resolve) => {
      resolveSettlement = resolve;
    });
    const probe: Probe = {
      root,
      main,
      boundarySamples: [],
      resizeDeliveries: 0,
      animationFrames: 0,
      lifecycle: [],
      durations: [],
      observedAnimations: [],
      transitionMarkupObserved: false,
      unexpectedShellAnimations: [],
      resizeObserver: new ResizeObserver(() => {
        probe.resizeDeliveries += 1;
      }),
      running: true,
      settlement,
      resolveSettlement,
      settling: false,
    };
    probe.resizeObserver.observe(main);
    owner.__sidebarMotionProbe = probe;
    const describeAnimation = (animation: Animation): string => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return target instanceof Element
        ? `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}`
        : "unknown-target";
    };
    const finishObservation = (): void => {
      if (probe.settling || probe.observedAnimations.length === 0) return;
      if (probe.root.hasAttribute("data-sidebar-transition")) return;
      probe.settling = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        probe.running = false;
        probe.resizeObserver.disconnect();
        probe.resolveSettlement({
          duration: probe.durations.at(-1) ?? 0,
          boundarySamples: [...probe.boundarySamples],
          resizeDeliveries: probe.resizeDeliveries,
          animationFrames: probe.animationFrames,
          lifecycle: [...probe.lifecycle],
          transitionMarkupObserved: probe.transitionMarkupObserved,
          unexpectedShellAnimations: [...probe.unexpectedShellAnimations],
        });
      }));
    };
    const sample = (): void => {
      if (!probe.running) return;
      const rootBox = probe.root.getBoundingClientRect();
      probe.boundarySamples.push(probe.main.getBoundingClientRect().left - rootBox.left);
      probe.animationFrames += 1;
      const shellAnimations = probe.root.getAnimations({ subtree: true });
      for (const animation of shellAnimations) {
        if (animation.id === "sidebar-collapse-boundary" &&
            !probe.observedAnimations.includes(animation)) {
          probe.observedAnimations.push(animation);
          probe.durations.push(Number(animation.effect?.getTiming().duration));
          probe.lifecycle.push("start");
          animation.addEventListener("finish", () => {
            probe.lifecycle.push("finish");
            finishObservation();
          }, { once: true });
          animation.addEventListener("cancel", () => {
            probe.lifecycle.push("cancel");
            finishObservation();
          }, { once: true });
        }
      }
      if (probe.root.hasAttribute("data-sidebar-transition")) {
        const toggle = probe.root.querySelector(":scope > .sidebar-toggle");
        if (toggle?.querySelectorAll(":scope > .sidebar-toggle-paint").length === 2) {
          probe.transitionMarkupObserved = true;
        }
        for (const animation of shellAnimations) {
          if (animation.id !== "sidebar-collapse-boundary") {
            probe.unexpectedShellAnimations.push(describeAnimation(animation));
          }
        }
      }
      finishObservation();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function settleMotion(page: Page): Promise<MotionRun> {
  return page.evaluate(async () => {
    interface Probe {
      root: HTMLElement;
      boundarySamples: number[];
      resizeDeliveries: number;
      animationFrames: number;
      lifecycle: string[];
      settlement: Promise<MotionRun>;
      resizeObserver: ResizeObserver;
      running: boolean;
    }
    const owner = window as unknown as { __sidebarMotionProbe?: Probe };
    const probe = owner.__sidebarMotionProbe;
    if (!probe) throw new Error("Sidebar motion probe is not installed");

    return probe.settlement;
  });
}

async function waitForIntermediateBoundary(
  page: Page,
  direction: "collapse" | "expand",
): Promise<number> {
  return page.evaluate(async ({ direction, width }) => {
    const root = document.querySelector<HTMLElement>("#app");
    const main = root?.querySelector<HTMLElement>(".app-main");
    if (!root || !main) throw new Error("Application shell is not mounted");
    const samples: { time: number; boundary: number; state?: AnimationPlayState; elapsed?: number | null }[] = [];
    const startedAt = performance.now();
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const boundary = main.getBoundingClientRect().left - root.getBoundingClientRect().left;
      const animation = root.getAnimations().find((candidate) =>
        candidate.id === "sidebar-collapse-boundary" &&
        candidate.playState === "running"
      );
      const observed = animation ?? root.getAnimations().find((candidate) =>
        candidate.id === "sidebar-collapse-boundary"
      );
      if (samples.length < 20) samples.push({
        time: Math.round(performance.now() - startedAt),
        boundary,
        state: observed?.playState,
        elapsed: observed?.currentTime == null ? null : Number(observed.currentTime),
      });
      if (animation && boundary > 1 && boundary < width - 1) return boundary;
    }
    throw new Error(`Collapse boundary never reached an interruptible ${direction} frame: ${JSON.stringify(samples)}`);
  }, { direction, width: COMMITTED_WIDTH_PX });
}

async function armReversalProbe(page: Page): Promise<void> {
  await page.locator(".sidebar-collapse, .sidebar-expand, .sidebar-motion-toggle").evaluate((toggle) => {
    interface ReversalProbe {
      beforeBoundary?: number;
      afterBoundary?: number;
      duration?: number;
      sampleIndex?: number;
      trusted?: boolean;
      pointerType?: string;
      detail?: number;
    }
    const owner = window as unknown as {
      __sidebarMotionProbe?: { boundarySamples: number[] };
      __sidebarReversalProbe?: ReversalProbe;
    };
    const boundary = (): number => {
      const root = document.querySelector<HTMLElement>("#app")!;
      const main = root.querySelector<HTMLElement>(".app-main")!;
      return main.getBoundingClientRect().left - root.getBoundingClientRect().left;
    };
    owner.__sidebarReversalProbe = {};
    let toggleClicks = 0;
    const observeToggle = (input: Event): void => {
      toggleClicks += 1;
      if (toggleClicks !== 2) return;
      const event = input as MouseEvent;
      owner.__sidebarReversalProbe!.beforeBoundary = boundary();
      owner.__sidebarReversalProbe!.trusted = event.isTrusted;
      owner.__sidebarReversalProbe!.pointerType = event instanceof PointerEvent
        ? event.pointerType
        : "";
      owner.__sidebarReversalProbe!.detail = event.detail;
      toggle.removeEventListener("click", observeToggle, { capture: true });
    };
    let documentClicks = 0;
    const observeDocument = (): void => {
      documentClicks += 1;
      if (documentClicks !== 2) return;
      const root = document.querySelector<HTMLElement>("#app")!;
      const animation = root.getAnimations().find((candidate) =>
        (candidate.effect as KeyframeEffect | null)?.target === root
      );
      owner.__sidebarReversalProbe!.afterBoundary = boundary();
      owner.__sidebarReversalProbe!.duration = Number(animation?.effect?.getTiming().duration);
      owner.__sidebarReversalProbe!.sampleIndex =
        owner.__sidebarMotionProbe?.boundarySamples.length ?? 0;
      document.removeEventListener("click", observeDocument);
    };
    toggle.addEventListener("click", observeToggle, { capture: true });
    document.addEventListener("click", observeDocument);
  });
}

async function reversalStart(page: Page): Promise<ReversalStart> {
  return page.evaluate(async () => {
    interface ReversalProbe {
      beforeBoundary?: number;
      afterBoundary?: number;
      duration?: number;
      sampleIndex?: number;
      trusted?: boolean;
      pointerType?: string;
      detail?: number;
    }
    const owner = window as unknown as { __sidebarReversalProbe?: ReversalProbe };
    for (let frame = 0; frame < 10; frame += 1) {
      const probe = owner.__sidebarReversalProbe;
      if (probe?.beforeBoundary !== undefined &&
          probe.afterBoundary !== undefined &&
          probe.duration !== undefined &&
          probe.sampleIndex !== undefined &&
          probe.trusted !== undefined &&
          probe.pointerType !== undefined &&
          probe.detail !== undefined) {
        return {
          beforeBoundary: probe.beforeBoundary,
          afterBoundary: probe.afterBoundary,
          duration: probe.duration,
          sampleIndex: probe.sampleIndex,
          trusted: probe.trusted,
          pointerType: probe.pointerType,
          detail: probe.detail,
        };
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error(
      `Reversal was not observed at the pointer click boundary: ${
        JSON.stringify(owner.__sidebarReversalProbe)
      }`,
    );
  });
}

function expectMonotone(samples: readonly number[], direction: "increasing" | "decreasing"): void {
  expect(samples.length).toBeGreaterThan(2);
  for (let index = 1; index < samples.length; index += 1) {
    if (direction === "increasing") {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]! - GEOMETRY_TOLERANCE_PX);
    } else {
      expect(samples[index]).toBeLessThanOrEqual(samples[index - 1]! + GEOMETRY_TOLERANCE_PX);
    }
  }
}

async function expectOpenSettlement(page: Page): Promise<void> {
  await expect(page.locator(".app-sidebar")).toHaveCount(1);
  await expect(page.locator(".app-sidebar")).toHaveCSS("width", `${COMMITTED_WIDTH_PX}px`);
  await expect(page.locator(".sidebar-collapse")).toHaveAttribute("aria-label", "Collapse sidebar");
  await expect(page.locator(".sidebar-toggle, .sidebar-toggle-paint, .sidebar-toggle-seat"))
    .toHaveCount(0);
  await expect(page.locator(".top-bar-lead")).toHaveCount(0);
  expect(await page.evaluate((keys) => ({
    width: localStorage.getItem(keys.width),
    collapsed: localStorage.getItem(keys.collapsed),
  }), { width: SIDEBAR_WIDTH_KEY, collapsed: SIDEBAR_COLLAPSED_KEY })).toEqual({
    width: String(COMMITTED_WIDTH_PX),
    collapsed: null,
  });
}

async function expectCollapsedSettlement(page: Page): Promise<void> {
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.locator(".app-main")).toHaveCSS("width", "1200px");
  await expect(page.locator(".sidebar-expand")).toHaveAttribute("aria-label", "Show sidebar");
  await expect(page.locator(".sidebar-toggle, .sidebar-toggle-paint, .sidebar-toggle-seat"))
    .toHaveCount(0);
  await expect(page.locator(".channel-switcher")).toBeVisible();
  expect(await page.evaluate((keys) => ({
    width: localStorage.getItem(keys.width),
    collapsed: localStorage.getItem(keys.collapsed),
  }), { width: SIDEBAR_WIDTH_KEY, collapsed: SIDEBAR_COLLAPSED_KEY })).toEqual({
    width: String(COMMITTED_WIDTH_PX),
    collapsed: "true",
  });
}

test("collapses, expands, persists, interrupts, and honors reduced motion (^ap-ac-sidebar-collapse)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const storagePath = createStoragePath();
  const product = await launchProductServer({ home: storagePath, cleanupHome: true });

  try {
    const client = new TelevisionClient(product.serverURL);
    await seedFocusedArtifact(client, product);
    await page.addInitScript(({ key, value }) => {
      if (window.top !== window) return;
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }, { key: SIDEBAR_WIDTH_KEY, value: String(COMMITTED_WIDTH_PX - 40) });
    await openApp(page, product);
    // Resize in this document: collapse must start from the new boundary,
    // not the width read at boot.
    const resizeBox = await page.locator(".app-sidebar-resize").boundingBox();
    if (!resizeBox) throw new Error("Sidebar resize handle has no pointer target");
    const resizeX = resizeBox.x + resizeBox.width / 2;
    const resizeY = resizeBox.y + resizeBox.height / 2;
    await page.mouse.move(resizeX, resizeY);
    await page.mouse.down();
    await page.mouse.move(resizeX + 40, resizeY);
    await page.mouse.up();
    await expectOpenSettlement(page);
    await rememberToggle(page);
    await page.frameLocator("iframe.artifact-content").locator("#artifact-state")
      .evaluate((state) => { state.textContent = "mutated"; });

    await startMotionProbe(page);
    await clickToggle(page);
    const collapse = await settleMotion(page);
    expect(collapse.duration).toBe(COLLAPSE_DURATION_MS);
    expect(collapse.lifecycle).toContain("finish");
    expect(collapse.resizeDeliveries).toBeGreaterThan(0);
    expect(collapse.animationFrames).toBeGreaterThan(2);
    expect(collapse.transitionMarkupObserved).toBe(true);
    expect(collapse.unexpectedShellAnimations).toEqual([]);
    expectMonotone(collapse.boundarySamples, "decreasing");
    await expectCollapsedSettlement(page);
    await expectSameToggle(page);
    await expect(page.frameLocator("iframe.artifact-content").locator("#artifact-state"))
      .toHaveText("mutated");

    await startMotionProbe(page);
    await clickToggle(page);
    const expand = await settleMotion(page);
    expect(expand.duration).toBe(COLLAPSE_DURATION_MS);
    expect(expand.lifecycle).toContain("finish");
    expect(expand.resizeDeliveries).toBeGreaterThan(0);
    expect(expand.animationFrames).toBeGreaterThan(2);
    expect(expand.transitionMarkupObserved).toBe(true);
    expect(expand.unexpectedShellAnimations).toEqual([]);
    expectMonotone(expand.boundarySamples, "increasing");
    await expectOpenSettlement(page);
    await expectSameToggle(page);

    await startMotionProbe(page);
    await clickToggle(page);
    await settleMotion(page);
    await expectCollapsedSettlement(page);
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
    await expectCollapsedSettlement(page);

    await rememberToggle(page);
    await startMotionProbe(page);
    await clickToggle(page);
    await settleMotion(page);
    await expectOpenSettlement(page);
    await expectSameToggle(page);
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-app-state", "connected");
    await expectOpenSettlement(page);

    const interruptionCases = [
      {
        name: "collapse interrupted by expand",
        initialCollapsed: false,
        firstDirection: "collapse",
        reversedDirection: "increasing",
      },
      {
        name: "expand interrupted by collapse",
        initialCollapsed: true,
        firstDirection: "expand",
        reversedDirection: "decreasing",
      },
    ] as const;
    for (const interruption of interruptionCases) {
      await test.step(interruption.name, async () => {
        if (interruption.initialCollapsed) {
          await startMotionProbe(page);
          await clickToggle(page);
          await settleMotion(page);
          await expectCollapsedSettlement(page);
        }

        await rememberToggle(page);
        await startMotionProbe(page);
        await armReversalProbe(page);
        const intermediateBoundary = waitForIntermediateBoundary(
          page,
          interruption.firstDirection,
        );
        const toggleBox = await page.locator(".sidebar-collapse, .sidebar-expand, .sidebar-motion-toggle")
          .boundingBox();
        if (!toggleBox) throw new Error("Sidebar toggle has no pointer target");
        const point = {
          x: toggleBox.x + toggleBox.width / 2,
          y: toggleBox.y + toggleBox.height / 2,
        };
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        // Start the envelope with trusted pointer input, then press the same
        // persistent control again as soon as its click handler has moved it
        // into the transition layer. Holding that second press under pointer
        // capture lets the release reverse on the first observed live frame.
        const activation = page.mouse.up();
        const reversalPress = page.mouse.down();
        await Promise.all([activation, reversalPress]);
        await intermediateBoundary;
        await page.mouse.up();
        const reversal = await reversalStart(page);
        expect(reversal.trusted).toBe(true);
        expect(reversal.pointerType).toBe("mouse");
        expect(reversal.detail).toBeGreaterThan(0);
        expect(reversal.afterBoundary).toBeCloseTo(reversal.beforeBoundary, 0);
        const reversedTarget = interruption.initialCollapsed ? 0 : COMMITTED_WIDTH_PX;
        expect(reversal.duration).toBeCloseTo(
          COLLAPSE_DURATION_MS *
            Math.abs(reversedTarget - reversal.beforeBoundary) /
            COMMITTED_WIDTH_PX,
          0,
        );
        const interrupted = await settleMotion(page);
        expect(interrupted.lifecycle).toEqual(expect.arrayContaining(["cancel", "finish"]));
        expect(interrupted.transitionMarkupObserved).toBe(true);
        expect(interrupted.unexpectedShellAnimations).toEqual([]);
        expectMonotone(
          interrupted.boundarySamples.slice(reversal.sampleIndex),
          interruption.reversedDirection,
        );
        if (interruption.initialCollapsed) {
          await expectCollapsedSettlement(page);
        } else {
          await expectOpenSettlement(page);
        }
        await expectSameToggle(page);
      });
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await clickToggle(page);
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    ));
    await expectOpenSettlement(page);
    await expectSameToggle(page);
    expect(await page.locator("#app").evaluate((root) => root.getAnimations().length)).toBe(0);

    await clickToggle(page);
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    ));
    await expectCollapsedSettlement(page);
    await expectSameToggle(page);
    expect(await page.locator("#app").evaluate((root) => root.getAnimations().length)).toBe(0);
  } finally {
    await product.dispose();
  }
});


/** Control the native clock only; production still computes and applies every pose. */
async function pauseNextMotion(page: Page, input: "pointer" | "keyboard" = "pointer"): Promise<void> {
  await page.evaluate(() => {
    const owner = window as unknown as { __referenceClock?: Animation };
    const previous = owner.__referenceClock;
    delete owner.__referenceClock;
    const pause = () => {
      const clock = document.querySelector("#app")?.getAnimations().find((animation) =>
        animation.id === "sidebar-collapse-boundary" && animation !== previous
      );
      if (!clock) { requestAnimationFrame(pause); return; }
      clock.pause();
      clock.currentTime = 0;
      owner.__referenceClock = clock;
    };
    requestAnimationFrame(pause);
  });
  if (input === "keyboard") await page.keyboard.press("Enter");
  else await clickToggle(page);
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __referenceClock?: Animation }).__referenceClock,
  ));
}

async function sampleMotion(page: Page, elapsedMs: number) {
  return page.evaluate(async (elapsed) => {
    const clock = (window as unknown as { __referenceClock: Animation }).__referenceClock;
    clock.currentTime = elapsed;
    // Let the production callback and resulting ResizeObservers finish before sampling.
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const root = document.querySelector<HTMLElement>("#app")!;
    const main = root.querySelector<HTMLElement>(".app-main")!;
    const toggle = root.querySelector<HTMLElement>(":scope > .sidebar-toggle")!;
    const lead = root.querySelector<HTMLElement>(".top-bar-lead")!;
    const switcher = root.querySelector<HTMLElement>(".channel-switcher")!;
    const titlebar = root.querySelector<HTMLElement>(".channel-create")!;
    const page = root.querySelector<HTMLElement>(".page[selected]")!;
    const strip = root.querySelector<HTMLElement>(".filmstrip")!;
    const tabs = root.querySelector<HTMLElement>(".tab-strip")!;
    const controls = root.querySelector<HTMLElement>(".top-bar-controls")!;
    const origin = root.getBoundingClientRect().left;
    const box = (element: Element) => element.getBoundingClientRect();
    const centre = (element: Element) => box(element).left + box(element).width / 2;
    const clipDistance = (paint: Element, side: "left" | "right"): number => {
      const values = getComputedStyle(paint).clipPath.slice(6, -1).match(/calc\([^)]*\)|[^\s]+/g)!;
      const value = side === "right" ? values[1] ?? values[0]! : values[3] ?? values[1] ?? values[0]!;
      const subtraction = value.match(/^calc\(100% - (.+)px\)$/);
      if (subtraction) return box(paint).width - Number(subtraction[1]);
      return value.endsWith("%") ? box(paint).width * Number.parseFloat(value) / 100 : Number.parseFloat(value);
    };
    const pageInset = Number.parseFloat(getComputedStyle(root).getPropertyValue("--page-inset"));
    return {
      boundary: box(main).left - origin,
      toggleTop: box(toggle).top,
      toggleWidth: box(toggle).width,
      toggleHeight: box(toggle).height,
      expandedVisibleWidth: box(toggle.querySelector(".expanded-paint")!).width - clipDistance(toggle.querySelector(".expanded-paint")!, "right"),
      switcherLeft: box(switcher).left - origin,
      switcherRight: box(switcher).right,
      toggleLeft: box(toggle).left - origin,
      wipe: clipDistance(toggle.querySelector(".collapsed-paint")!, "left"),
      titlebarOpacity: Number(getComputedStyle(titlebar).opacity),
      switcherOpacity: Number(getComputedStyle(switcher).opacity),
      leadReservation: box(lead).width,
      pageCentre: centre(page),
      stageCentre: centre(strip),
      pageWidth: box(page).width,
      pageHeight: box(page).height,
      pageBoxWidth: strip.clientWidth - 2 * pageInset,
      pageBoxHeight: strip.clientHeight - pageInset,
      tabsCentre: centre(tabs),
      stageWidth: strip.clientWidth,
      tabsLeft: box(tabs).left,
      tabsRight: box(tabs).right,
      controlsLeft: box(controls).left,
      mainLeft: box(main).left,
      selection: page.getAttribute("data-page-key"),
    };
  }, elapsedMs);
}

async function finishReferenceMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __referenceClock: Animation }).__referenceClock.finish();
  });
  await expect(page.locator("#app")).not.toHaveAttribute("data-sidebar-transition");
}

test("matches the executable sidebar motion reference (^ap-ac-sidebar-motion-reference)", async ({ page }) => {
  test.setTimeout(90_000);
  const product = await launchProductServer({ home: createStoragePath(), cleanupHome: true });
  try {
    await seedFocusedArtifact(new TelevisionClient(product.serverURL), product);
    await page.addInitScript(({ key, width }) => localStorage.setItem(key, String(width)), {
      key: SIDEBAR_WIDTH_KEY, width: COMMITTED_WIDTH_PX,
    });
    await openApp(page, product);
    await page.evaluate(() => {
      const owner = window as unknown as { __originalArtifact?: Element };
      owner.__originalArtifact = document.querySelector("iframe.artifact-content")!;
    });
    const artifact = page.frameLocator("iframe.artifact-content");
    await artifact.locator("#artifact-state").evaluate((state) => {
      (window as unknown as { __originalDocument?: Document }).__originalDocument = document;
      state.textContent = "preserved";
    });
    const expanded = await page.locator(".sidebar-collapse").evaluate((toggle) => {
      const root = toggle.closest("#app")!;
      const box = toggle.getBoundingClientRect();
      return { left: box.left - root.getBoundingClientRect().left, top: box.top, width: box.width, height: box.height };
    });
    const selectedKey = await page.locator(".page[selected]").getAttribute("data-page-key");
    // Measure the real resting layouts, without taking geometry from production helpers.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await clickToggle(page);
    await expectCollapsedSettlement(page);
    const geometry: SidebarGeometry = await page.evaluate(({ width, expandedLeft }) => {
      const root = document.querySelector("#app")!;
      const toggle = root.querySelector(".sidebar-expand")!.getBoundingClientRect();
      const switcher = root.querySelector(".channel-switcher")!.getBoundingClientRect();
      return {
        expandedSidebarWidth: width,
        expandedToggleLeft: expandedLeft,
        collapsedToggleLeft: toggle.left - root.getBoundingClientRect().left,
        toggleWidth: toggle.width,
        toggleSwitcherGap: switcher.left - toggle.right,
        collapsedLeadReservation: root.querySelector(".top-bar-lead")!.getBoundingClientRect().width,
        hasSwitcher: true,
      };
    }, { width: COMMITTED_WIDTH_PX, expandedLeft: expanded.left });
    await clickToggle(page);
    await expectOpenSettlement(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const compare = async (elapsed: number, start: number, target: number) => {
      const progress = sidebarProgressAt(start, target, elapsed, COLLAPSE_DURATION_MS);
      const expected = sidebarPose(progress, geometry);
      const actual = await sampleMotion(page, elapsed);
      for (const [label, observed, wanted] of [
        ["boundary", actual.boundary, expected.sidebarBoundary],
        ["toggle", actual.toggleLeft, expected.toggleLeft],
        ["wipe", actual.wipe, expected.toggleWipe],
        ["expanded paint", actual.expandedVisibleWidth, expected.toggleWipe],
        ["toggle top", actual.toggleTop, expanded.top],
        ["toggle width", actual.toggleWidth, expanded.width],
        ["toggle height", actual.toggleHeight, expanded.height],
        ["tab centre", actual.tabsCentre, actual.stageCentre],
        ["lead", actual.leadReservation, expected.leadReservation],
        ["selected page centre", actual.pageCentre, actual.stageCentre],
      ] as const) {
        expect(Math.abs(observed - wanted), label).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
      }
      expect(Math.abs(actual.titlebarOpacity - expected.titlebarOpacity), "titlebar opacity").toBeLessThanOrEqual(0.01);
      expect(Math.abs(actual.switcherOpacity - expected.switcherOpacity), "switcher opacity").toBeLessThanOrEqual(0.01);
      expect(actual.tabsLeft).toBeGreaterThanOrEqual(actual.mainLeft - GEOMETRY_TOLERANCE_PX);
      expect(actual.tabsRight).toBeLessThanOrEqual(actual.controlsLeft + GEOMETRY_TOLERANCE_PX);
      if (expected.switcherOpacity > 0) {
        expect(Math.abs(actual.switcherLeft - geometry.collapsedToggleLeft - geometry.toggleWidth - geometry.toggleSwitcherGap))
          .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
      }
      const { page: initial, sizing } = STAGE_MEASURES;
      const expectedWidth = Math.min(actual.pageBoxWidth, initial.initial_width_px *
        (1 - sizing.width_share + sizing.width_share * actual.pageBoxWidth / sizing.reference_width_px));
      const expectedHeight = Math.min(actual.pageBoxHeight, initial.initial_height_px *
        (1 - sizing.height_share + sizing.height_share * actual.pageBoxHeight / sizing.reference_height_px));
      expect(Math.abs(actual.pageWidth - expectedWidth), "authored page width").toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
      expect(Math.abs(actual.pageHeight - expectedHeight), "authored page height").toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
      expect(actual.selection).toBe(selectedKey);
    };

    await page.locator(".sidebar-collapse").focus();
    await pauseNextMotion(page, "keyboard");
    await expect(page.locator(".sidebar-motion-toggle")).toBeFocused();
    const dockingBoundary = geometry.collapsedToggleLeft + geometry.expandedSidebarWidth - geometry.expandedToggleLeft;
    const midWipeBoundary = geometry.collapsedToggleLeft + geometry.toggleWidth / 2;
    const progressSamples = [0, 0.25, 1 - dockingBoundary / COMMITTED_WIDTH_PX, 1 - midWipeBoundary / COMMITTED_WIDTH_PX];
    for (const progress of progressSamples) {
      await compare(COLLAPSE_DURATION_MS * (1 - Math.sqrt(1 - progress)), 0, 1);
    }
    for (const elapsed of [45, 90, 135]) await compare(elapsed, 0, 1);
    await finishReferenceMotion(page);
    await expectCollapsedSettlement(page);

    await pauseNextMotion(page);
    for (const elapsed of [0, 45, 90]) await compare(elapsed, 1, 0);
    const reversalStart = sidebarProgressAt(1, 0, 90, COLLAPSE_DURATION_MS);
    await pauseNextMotion(page);
    await compare(0, reversalStart, 1);
    await compare(45, reversalStart, 1);
    await finishReferenceMotion(page);
    await expectCollapsedSettlement(page);
    await pauseNextMotion(page);
    await compare(135, 1, 0);
    await finishReferenceMotion(page);
    await expectOpenSettlement(page);
    expect(await page.evaluate(() => document.querySelector("iframe.artifact-content") ===
      (window as unknown as { __originalArtifact: Element }).__originalArtifact)).toBe(true);
    expect(await artifact.locator("#artifact-state").evaluate(() => document ===
      (window as unknown as { __originalDocument: Document }).__originalDocument)).toBe(true);
    await expect(artifact.locator("#artifact-state")).toHaveText("preserved");
    await expect(page.locator(".page[selected]")).toHaveAttribute("data-page-key", selectedKey!);
    await page.locator(".sidebar-collapse").focus();
    await pauseNextMotion(page, "keyboard");
    await expect(page.locator(".sidebar-motion-toggle")).toBeFocused();
    await finishReferenceMotion(page);
    await expect(page.locator(".sidebar-expand")).toBeFocused();
    await pauseNextMotion(page, "keyboard");
    await expect(page.locator(".sidebar-motion-toggle")).toBeFocused();
    await finishReferenceMotion(page);
    await expect(page.locator(".sidebar-collapse")).toBeFocused();
  } finally {
    await product.dispose();
  }
});

test("keeps clear drag bands while a wide lead appears beside a narrow sidebar", async ({ page }) => {
  test.setTimeout(90_000);
  const sidebarWidth = 160;
  const leftGap = 8;
  const rightDragGap = 48;
  const product = await launchProductServer({ home: createStoragePath(), cleanupHome: true });
  try {
    const client = new TelevisionClient(product.serverURL);
    await seedFocusedArtifact(client, product);
    const { channels } = await client.channels.list();
    const channel = channels.find((candidate) => candidate.name === "Collapse acceptance")!;
    await client.channels.update({ channelID: channel.id, name: "A channel name long enough to fill the switcher and exceed the narrow sidebar" });
    await page.addInitScript(({ key, width }) => localStorage.setItem(key, String(width)), {
      key: SIDEBAR_WIDTH_KEY, width: sidebarWidth,
    });
    await openApp(page, product);
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.locator(".app-sidebar")).toHaveCSS("width", `${sidebarWidth}px`);
    for (const direction of ["collapse", "expand"]) {
      let visibleSamples = 0;
      await pauseNextMotion(page);
      for (const elapsed of [5, 15, 45, 90, 110, 135, 165]) {
        const actual = await sampleMotion(page, elapsed);
        if (actual.switcherOpacity > 0) {
          visibleSamples += 1;
          expect(actual.tabsLeft - actual.switcherRight, `${direction}: left drag band at ${elapsed}ms`)
            .toBeGreaterThanOrEqual(leftGap - 0.1);
        }
        expect(actual.controlsLeft - actual.tabsRight, `${direction}: right drag band at ${elapsed}ms`)
          .toBeGreaterThanOrEqual(rightDragGap - 0.1);
      }
      expect(visibleSamples, `${direction} samples include a visible switcher`).toBeGreaterThan(0);
      await finishReferenceMotion(page);
    }
  } finally {
    await product.dispose();
  }
});
