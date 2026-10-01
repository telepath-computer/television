import { expect, test, type Page } from "@playwright/test";
import {
  configureTestMotion,
  startMotionObservation,
} from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/motion.html";

interface FixtureReport {
  animationName: string;
  scrollLeft: number;
  transitionProperty: string;
}

async function setup(page: Page, allowCSSMotion = false): Promise<void> {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(FIXTURE);
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
  await configureTestMotion(page, { allowCSSMotion });
}

async function trigger(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __triggerMotion(): void }).__triggerMotion();
  });
}

async function fixtureReport(page: Page): Promise<FixtureReport> {
  return page.evaluate(() =>
    (window as unknown as { __motionFixtureReport(): FixtureReport }).__motionFixtureReport()
  );
}

test.describe("shared browser motion support (^real-motion)", () => {
  test("the default disables CSS transitions and animations while settling real script and scroll motion", async ({ page }) => {
    await setup(page);
    const observation = await startMotionObservation(page, ".motion-root");

    await trigger(page);
    const motion = await observation.settle({ requireMotion: true });

    expect(motion.transitionEvents).toEqual([]);
    expect(motion.animationEvents).toEqual([]);
    expect(motion.webAnimations).toContainEqual({
      duration: 280,
      finished: true,
      kind: "web-animation",
    });
    expect(motion.scrollEvents).toBeGreaterThan(0);
    expect(motion.scrollEndEvents).toBeGreaterThan(0);
    expect(new Set(motion.scrollPositions).size).toBeGreaterThan(2);
    expect(await fixtureReport(page)).toEqual({
      animationName: "none",
      scrollLeft: 120,
      transitionProperty: "none",
    });
  });

  test("the per-test opt-out preserves authored CSS timing and event-based settlement", async ({ page }) => {
    await setup(page, true);
    const observation = await startMotionObservation(page, ".motion-root");

    await trigger(page);
    const motion = await observation.settle({ requireMotion: true });

    expect(motion.transitionEvents).toContainEqual({
      elapsedTime: 0.28,
      propertyName: "translate",
      type: "transitionend",
    });
    expect(motion.animationEvents).toContainEqual({
      animationName: "motion-probe-pulse",
      elapsedTime: 0.28,
      type: "animationend",
    });
    expect(motion.webAnimations).toContainEqual({
      duration: 280,
      finished: true,
      kind: "web-animation",
    });
    expect(motion.scrollEvents).toBeGreaterThan(0);
    expect(motion.scrollEndEvents).toBeGreaterThan(0);
    expect(new Set(motion.scrollPositions).size).toBeGreaterThan(2);
    expect(motion.animationFrameCount).toBeGreaterThan(2);
    expect(await fixtureReport(page)).toEqual({
      animationName: "motion-probe-pulse",
      scrollLeft: 120,
      transitionProperty: "translate",
    });
  });
});
