import { expect, test } from "../../../../test/helpers/playwright.ts";
import { writeFileSync } from "node:fs";
import {
  createHarness,
  disposeHarness,
  openConsumer,
  proxyURL,
  TEST_ARTIFACT_POLL_CADENCE,
  trackArtifactHeadRequests,
  writeArtifactFile,
} from "./guerilla-artifact-sharing.helpers.ts";


test.describe("guerilla artifact sharing", () => {
  test("browser renders and live-reloads shared HTML artifacts from another server", async ({ page, baseURL }) => {
    const h = await createHarness();
    try {
      const producerChannel = h.producerStore.listChannels()[0]!;
      const htmlPath = writeArtifactFile(h.producerStorage, "shared", "<!doctype html><h1 id='msg'>one</h1>", "html");
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Shared", path: htmlPath });
      const sharedURL = proxyURL(h.producer, producerArtifact.id, htmlPath);
      const headRequests = trackArtifactHeadRequests(
        h.producer,
        producerArtifact.id,
        new URL(sharedURL).pathname,
      );
      const producerReferers: Array<string | undefined> = [];
      h.producer.httpServer.on("request", (request) => {
        if (request.url?.startsWith(`/artifact/${producerArtifact.id}/`)) {
          producerReferers.push(request.headers.referer);
        }
      });
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote", url: sharedURL });

      await openConsumer(page, baseURL, h.consumer);

      const iframe = page.locator(".artifact-view iframe.artifact-content");
      await expect(iframe).toHaveAttribute("src", sharedURL);
      await expect.poll(() => producerReferers.length).toBeGreaterThan(0);
      expect(producerReferers.every((referer) => referer === undefined || !referer.includes(h.consumer.getAuthToken()))).toBe(true);
      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("#msg")).toHaveText("one");
      await expect.poll(headRequests.successful).toBeGreaterThan(0);

      writeFileSync(htmlPath, "<!doctype html><h1 id='msg'>two</h1>", "utf8");
      await expect(frame.locator("#msg")).toHaveText("two", { timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4 });
    } finally {
      await disposeHarness(h);
    }
  });

  test("browser renders and live-reloads shared markdown artifacts from another server", async ({ page, baseURL }) => {
    const h = await createHarness();
    try {
      const producerChannel = h.producerStore.listChannels()[0]!;
      const markdownPath = writeArtifactFile(h.producerStorage, "shared-note", "# Draft one\n", "md");
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Shared markdown", path: markdownPath });
      const sharedURL = proxyURL(h.producer, producerArtifact.id, markdownPath);
      const headRequests = trackArtifactHeadRequests(
        h.producer,
        producerArtifact.id,
        new URL(sharedURL).pathname,
      );
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote markdown", url: sharedURL });

      await openConsumer(page, baseURL, h.consumer);

      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("h1")).toHaveText("Draft one");
      await expect.poll(headRequests.successful).toBeGreaterThan(0);

      writeFileSync(markdownPath, "# Draft two\n", "utf8");
      await expect(frame.locator("h1")).toHaveText("Draft two", { timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4 });
    } finally {
      await disposeHarness(h);
    }
  });

});
