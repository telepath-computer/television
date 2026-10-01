import { expect, test } from "@playwright/test";
import { configureTestMotion } from "./helpers.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/stage-memory.html";
const SWITCH_COUNT = 8;
const GC_ATTEMPTS = 5;

interface CollectionReport {
  trackedViews: number;
  trackedFrames: number;
  aliveViews: number;
  aliveFrames: number;
  currentViews: number;
  currentFrames: number;
}

interface StageMemoryFixture {
  artifactsPerChannel: number;
  discardChannels(switchCount: number): Promise<CollectionReport>;
  collectionReport(): CollectionReport;
}

test.describe("stage channel memory (^st-ac-channel-memory)", () => {
  // spec: proofs/ui/app/stage/index.md#^st-ac-channel-memory
  test("collects discarded artifact views and frames after repeated channel switches", async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() =>
      (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true
    );
    await configureTestMotion(page);

    const artifactsPerChannel = await page.evaluate(() =>
      (window as unknown as { __stageMemoryFixture: StageMemoryFixture })
        .__stageMemoryFixture.artifactsPerChannel
    );
    let report = await page.evaluate(
      (switchCount) =>
        (window as unknown as { __stageMemoryFixture: StageMemoryFixture })
          .__stageMemoryFixture.discardChannels(switchCount),
      SWITCH_COUNT,
    );

    expect(report).toMatchObject({
      trackedViews: artifactsPerChannel * SWITCH_COUNT,
      trackedFrames: artifactsPerChannel * SWITCH_COUNT,
      currentViews: artifactsPerChannel,
      currentFrames: artifactsPerChannel,
    });

    for (let attempt = 0; attempt < GC_ATTEMPTS; attempt += 1) {
      await page.requestGC();
      report = await page.evaluate(() =>
        (window as unknown as { __stageMemoryFixture: StageMemoryFixture })
          .__stageMemoryFixture.collectionReport()
      );
      if (report.aliveViews === 0 && report.aliveFrames === 0) break;
    }

    expect(report).toEqual({
      trackedViews: artifactsPerChannel * SWITCH_COUNT,
      trackedFrames: artifactsPerChannel * SWITCH_COUNT,
      aliveViews: 0,
      aliveFrames: 0,
      currentViews: artifactsPerChannel,
      currentFrames: artifactsPerChannel,
    });
  });
});
