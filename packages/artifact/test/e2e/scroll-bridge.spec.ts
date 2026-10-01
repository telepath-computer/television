import { expect, test, type Frame, type Page } from "@playwright/test";
import { readPublishedArtifactE2EURLs } from "./artifact-e2e-urls.js";

const publishedURLs = readPublishedArtifactE2EURLs();

function hostURL(): string {
  return publishedURLs.hostURL;
}

function viewOrigin(): string {
  return publishedURLs.viewOrigin;
}

// The bridge observes wheel input for horizontal host scrolling but no longer
// prevents default vertical scrolling. This spec keeps the iframe-overflow
// pattern used by view-markdown (body flex/100vh, inner #editor overflow:auto)
// and verifies a real wheel scroll moves the native inner scroller without a
// host -> view scroll command round trip.

async function gotoScrollHarness(page: Page): Promise<Frame> {
  await page.goto(hostURL());
  await page.waitForFunction(() => typeof window.__bootScrollHarness === "function");
  await page.evaluate(() => window.__bootScrollHarness());
  await page.waitForFunction(() => {
    const iframe = document.querySelector("iframe");
    return iframe instanceof HTMLIFrameElement && iframe.src.includes("scroll=1");
  });
  const frame = page.frames().find((f) => f.url().startsWith(viewOrigin()));
  if (!frame) throw new Error("scroll-harness view frame not found");
  await frame.waitForFunction(() => document.getElementById("editor") !== null);
  return frame;
}

test.describe("scroll bridge", () => {
  test("vertical wheel inside an iframe overflow container scrolls natively", async ({
    page,
  }) => {
    const viewFrame = await gotoScrollHarness(page);

    const initialScrollTop = await viewFrame
      .locator("#editor")
      .evaluate((el) => el.scrollTop);
    expect(initialScrollTop).toBe(0);

    await viewFrame.locator("#editor").hover({ position: { x: 50, y: 100 } });
    await page.mouse.wheel(0, 200);

    await expect
      .poll(
        () => viewFrame.locator("#editor").evaluate((el) => el.scrollTop),
        { timeout: 2_000, intervals: [25, 50, 100] },
      )
      .toBeGreaterThan(0);
  });
});
