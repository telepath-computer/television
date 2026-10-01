import { expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";

const APPLICATION_READY_TIMEOUT_MS = 5_000;
const MOTION_STYLE_ID = "tv-test-no-css-motion";
const DEFAULT_MAX_MOTION_FRAMES = 600;

export interface TestMotionOptions {
  /** Keep authored CSS transitions and animations for a real-motion assertion. */
  allowCSSMotion?: boolean;
}

export interface MotionEventRecord {
  readonly type: string;
  readonly propertyName: string;
  readonly elapsedTime: number;
}

export interface AnimationEventRecord {
  readonly type: string;
  readonly animationName: string;
  readonly elapsedTime: number;
}

export interface WebAnimationRecord {
  readonly kind: "css-transition" | "css-animation" | "web-animation";
  readonly duration: number;
  readonly finished: boolean;
}

export interface MotionReport {
  readonly transitionEvents: readonly MotionEventRecord[];
  readonly animationEvents: readonly AnimationEventRecord[];
  readonly webAnimations: readonly WebAnimationRecord[];
  readonly scrollEvents: number;
  readonly scrollEndEvents: number;
  readonly scrollPositions: readonly number[];
  readonly animationFrameCount: number;
}

export interface MotionSettlementOptions {
  /** Require at least one motion lifecycle, Web Animation, or scroll signal. */
  requireMotion?: boolean;
  /** Animation-frame bound for a broken or non-settling motion path. */
  maxFrames?: number;
}

export interface MotionObservation {
  settle(options?: MotionSettlementOptions): Promise<MotionReport>;
}

export function waitForApplicationShell(page: Page): Promise<void> {
  return waitForApplicationRender(page, APPLICATION_SHELL_STATES, APPLICATION_READY_TIMEOUT_MS);
}

/** Chromium-only: uses CDP to send a mouse press and release with no intervening pointer move. */
export async function pressAndReleaseWithoutPointerMove(
  page: Page,
  down: { readonly x: number; readonly y: number },
  up: { readonly x: number; readonly y: number },
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: down.x,
      y: down.y,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: down.x,
      y: down.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: up.x,
      y: up.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await session.detach();
  }
}

export function createArtifactFile(storagePath: string, name: string, content: string, extension: "md" | "html"): string {
  const dir = path.join(storagePath, "artifact-files");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.${extension}`);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/** Activates a channel by name through the permanent production sidebar. */
export async function pickChannelByName(page: Page, name: string): Promise<void> {
  const channel = page.getByRole("option", { name, exact: true });
  await expect(channel).toBeVisible();
  await channel.click();
  await expect(channel).toHaveAttribute("aria-selected", "true");
}

/**
 * Applies the standing CSS-motion test policy to the current top-level page.
 * The default removes CSS transitions and animations. Real-motion assertions
 * opt out explicitly; scrolling, script animations, and animation-frame loops
 * stay real in both modes.
 */
export async function configureTestMotion(
  page: Page,
  { allowCSSMotion = false }: TestMotionOptions = {},
): Promise<void> {
  await page.evaluate(
    ({ allowCSSMotion, styleID }) =>
      new Promise<void>((resolve) => {
        document.getElementById(styleID)?.remove();
        if (!allowCSSMotion) {
          const style = document.createElement("style");
          style.id = styleID;
          style.textContent = `
            *, *::before, *::after {
              transition: none !important;
              animation: none !important;
            }
          `;
          document.head.appendChild(style);
        }
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    { allowCSSMotion, styleID: MOTION_STYLE_ID },
  );
}

/**
 * Installs lifecycle and scroll recorders before an action starts. Settlement
 * is driven by browser events, scoped Web Animations API state, scroll
 * positions, and consecutive animation frames; it never sleeps.
 */
export async function startMotionObservation(
  page: Page,
  rootSelector: string,
): Promise<MotionObservation> {
  const id = await page.evaluate((selector) => {
    interface BrowserMotionState {
      root: HTMLElement;
      transitionEvents: MotionEventRecord[];
      animationEvents: AnimationEventRecord[];
      webAnimations: Map<Animation, { kind: WebAnimationRecord["kind"]; duration: number; finished: boolean }>;
      scrollEvents: number;
      scrollEndEvents: number;
      cleanup(): void;
    }

    const owner = window as unknown as {
      __tvMotionObservationCount?: number;
      __tvMotionObservations?: Map<string, BrowserMotionState>;
    };
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) throw new Error(`Motion observation root not found: ${selector}`);

    owner.__tvMotionObservationCount = (owner.__tvMotionObservationCount ?? 0) + 1;
    const observationID = `motion-${owner.__tvMotionObservationCount}`;
    const transitionEvents: MotionEventRecord[] = [];
    const animationEvents: AnimationEventRecord[] = [];
    const webAnimations = new Map<Animation, { kind: WebAnimationRecord["kind"]; duration: number; finished: boolean }>();
    const scrollElements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    let scrollEvents = 0;
    let scrollEndEvents = 0;

    const onTransition = (event: Event): void => {
      const transition = event as TransitionEvent;
      transitionEvents.push({
        type: transition.type,
        propertyName: transition.propertyName,
        elapsedTime: transition.elapsedTime,
      });
    };
    const onAnimation = (event: Event): void => {
      const animation = event as AnimationEvent;
      animationEvents.push({
        type: animation.type,
        animationName: animation.animationName,
        elapsedTime: animation.elapsedTime,
      });
    };
    const onScroll = (): void => {
      scrollEvents += 1;
    };
    const onScrollEnd = (): void => {
      scrollEndEvents += 1;
    };

    for (const type of ["transitionrun", "transitionstart", "transitionend", "transitioncancel"]) {
      root.addEventListener(type, onTransition);
    }
    for (const type of ["animationstart", "animationiteration", "animationend", "animationcancel"]) {
      root.addEventListener(type, onAnimation);
    }
    for (const element of scrollElements) {
      element.addEventListener("scroll", onScroll);
      element.addEventListener("scrollend", onScrollEnd);
    }

    const state: BrowserMotionState = {
      root,
      transitionEvents,
      animationEvents,
      webAnimations,
      get scrollEvents() {
        return scrollEvents;
      },
      get scrollEndEvents() {
        return scrollEndEvents;
      },
      cleanup() {
        for (const type of ["transitionrun", "transitionstart", "transitionend", "transitioncancel"]) {
          root.removeEventListener(type, onTransition);
        }
        for (const type of ["animationstart", "animationiteration", "animationend", "animationcancel"]) {
          root.removeEventListener(type, onAnimation);
        }
        for (const element of scrollElements) {
          element.removeEventListener("scroll", onScroll);
          element.removeEventListener("scrollend", onScrollEnd);
        }
      },
    };
    owner.__tvMotionObservations ??= new Map();
    owner.__tvMotionObservations.set(observationID, state);
    return observationID;
  }, rootSelector);

  return {
    settle: (options = {}) => settleMotionObservation(page, id, options),
  };
}

async function settleMotionObservation(
  page: Page,
  id: string,
  {
    requireMotion = false,
    maxFrames = DEFAULT_MAX_MOTION_FRAMES,
  }: MotionSettlementOptions,
): Promise<MotionReport> {
  return page.evaluate(
    async ({ id, maxFrames, requireMotion }) => {
      interface BrowserAnimationRecord {
        kind: WebAnimationRecord["kind"];
        duration: number;
        finished: boolean;
      }
      interface BrowserMotionState {
        root: HTMLElement;
        transitionEvents: MotionEventRecord[];
        animationEvents: AnimationEventRecord[];
        webAnimations: Map<Animation, BrowserAnimationRecord>;
        scrollEvents: number;
        scrollEndEvents: number;
        cleanup(): void;
      }
      const owner = window as unknown as {
        __tvMotionObservations?: Map<string, BrowserMotionState>;
      };
      const state = owner.__tvMotionObservations?.get(id);
      if (!state) throw new Error(`Motion observation not found: ${id}`);

      const scrollPositions: number[] = [];
      const readScrollPosition = (): number =>
        [state.root, ...state.root.querySelectorAll<HTMLElement>("*")]
          .reduce((sum, element) => sum + element.scrollLeft + element.scrollTop, 0);
      const classify = (animation: Animation): WebAnimationRecord["kind"] => {
        if (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition) {
          return "css-transition";
        }
        if (typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation) {
          return "css-animation";
        }
        return "web-animation";
      };
      const recordAnimations = (animations: Animation[]): void => {
        for (const animation of animations) {
          if (state.webAnimations.has(animation)) continue;
          const duration = Number(animation.effect?.getTiming().duration);
          const record: BrowserAnimationRecord = {
            kind: classify(animation),
            duration,
            finished: false,
          };
          state.webAnimations.set(animation, record);
          void animation.finished.then(
            () => { record.finished = true; },
            () => undefined,
          );
        }
      };

      let stableFrames = 0;
      let previousScrollPosition = readScrollPosition();
      let observedMotion = false;
      let animationFrameCount = 0;

      try {
        for (; animationFrameCount < maxFrames; animationFrameCount += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const animations = state.root.getAnimations({ subtree: true });
          recordAnimations(animations);
          const scrollPosition = readScrollPosition();
          scrollPositions.push(scrollPosition);
          const activeAnimations = animations.filter((animation) =>
            animation.pending || animation.playState === "running"
          );
          observedMotion ||= state.transitionEvents.length > 0 ||
            state.animationEvents.length > 0 ||
            state.webAnimations.size > 0 ||
            state.scrollEvents > 0 ||
            Math.abs(scrollPosition - previousScrollPosition) > 0.1;
          const waitingForScrollEnd = state.scrollEvents > 0 && state.scrollEndEvents === 0;

          if ((!requireMotion || observedMotion) &&
              activeAnimations.length === 0 &&
              !waitingForScrollEnd &&
              Math.abs(scrollPosition - previousScrollPosition) <= 0.1) {
            stableFrames += 1;
          } else {
            stableFrames = 0;
          }
          previousScrollPosition = scrollPosition;
          if (stableFrames >= 2) break;
        }

        if (requireMotion && !observedMotion) {
          throw new Error(`Motion observation ${id} saw no motion signal`);
        }
        if (stableFrames < 2) {
          throw new Error(`Motion observation ${id} did not settle within ${maxFrames} animation frames`);
        }
        await Promise.resolve();

        return {
          transitionEvents: [...state.transitionEvents],
          animationEvents: [...state.animationEvents],
          webAnimations: [...state.webAnimations.values()].map((record) => ({ ...record })),
          scrollEvents: state.scrollEvents,
          scrollEndEvents: state.scrollEndEvents,
          scrollPositions,
          animationFrameCount: animationFrameCount + 1,
        };
      } finally {
        state.cleanup();
        owner.__tvMotionObservations?.delete(id);
      }
    },
    { id, maxFrames, requireMotion },
  );
}
