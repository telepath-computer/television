import { expect, test } from "../../../../test/helpers/playwright.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createHarness,
  disposeHarness,
  openConsumer,
  proxyURL,
  TEST_ARTIFACT_POLL_CADENCE,
  TEST_POLL_NEGATIVE_WINDOW_MS,
  trackArtifactHeadRequests,
  writeArtifactFile,
} from "./guerilla-artifact-sharing.helpers.ts";


test.describe("guerilla artifact sharing", () => {
  test.describe.configure({ retries: 0 });

  test("browser keeps shared folder sub-pages inline and polls only the viewed document", async ({ page, baseURL }) => {
    const h = await createHarness();
    try {
      const bundle = path.join(h.producerStorage, "bundle");
      mkdirSync(bundle, { recursive: true });
      const indexPath = path.join(bundle, "index.html");
      const page2Path = path.join(bundle, "page2.html");
      writeFileSync(indexPath, "<!doctype html><h1>Home</h1><a id='next' href='page2.html'>next</a>", "utf8");
      writeFileSync(page2Path, "<!doctype html><h1 id='page'>Page two</h1>", "utf8");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Bundle", path: `${bundle}${path.sep}` });
      const sharedURL = `${h.producer.getBaseURL()}/artifact/${producerArtifact.id}/`;
      const page2URL = new URL("page2.html", sharedURL);
      const page2HeadRequests = trackArtifactHeadRequests(
        h.producer,
        producerArtifact.id,
        page2URL.pathname,
      );
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote bundle", url: sharedURL });

      await openConsumer(page, baseURL, h.consumer);
      const iframe = page.locator(".artifact-view iframe.artifact-content");
      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("h1")).toHaveText("Home");
      await frame.locator("#next").click();
      await expect(frame.locator("#page")).toHaveText("Page two");
      await expect(page.frameLocator(".artifact-view iframe.artifact-content").locator("h1")).not.toContainText("URL artifacts");
      await expect.poll(page2HeadRequests.successful).toBeGreaterThan(0);

      const displayedSrc = await iframe.getAttribute("src");
      if (!displayedSrc) throw new Error("Expected displayed folder page src");
      writeFileSync(indexPath, "<!doctype html><h1>Changed home</h1><a id='next' href='page2.html'>next</a>", "utf8");
      await page.waitForTimeout(TEST_POLL_NEGATIVE_WINDOW_MS);
      await expect(frame.locator("#page")).toHaveText("Page two");
      await expect(iframe).toHaveAttribute("src", displayedSrc);

      writeFileSync(page2Path, "<!doctype html><h1 id='page'>Changed page two</h1>", "utf8");
      await expect(frame.locator("#page")).toHaveText("Changed page two", {
        timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4,
      });
    } finally {
      await disposeHarness(h);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-browser
  test("browser leaves the last shared state visible while the producer is offline and self-heals", async ({ page, baseURL }) => {
    const h = await createHarness();
    try {
      const producerChannel = h.producerStore.listChannels()[0]!;
      const htmlPath = writeArtifactFile(h.producerStorage, "offline", "<!doctype html><h1 id='msg'>online</h1>", "html");
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Offline", path: htmlPath });
      const sharedURL = proxyURL(h.producer, producerArtifact.id, htmlPath);
      const headRequests = trackArtifactHeadRequests(
        h.producer,
        producerArtifact.id,
        new URL(sharedURL).pathname,
      );
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote", url: sharedURL });

      await openConsumer(page, baseURL, h.consumer);
      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("#msg")).toHaveText("online");
      await expect.poll(headRequests.successful).toBeGreaterThan(0);

      rmSync(htmlPath);
      await expect.poll(headRequests.failed).toBeGreaterThan(0);
      await page.waitForTimeout(TEST_ARTIFACT_POLL_CADENCE.normalMs);
      await expect(frame.locator("#msg")).toHaveText("online");

      writeFileSync(htmlPath, "<!doctype html><h1 id='msg'>back</h1>", "utf8");
      await expect(frame.locator("#msg")).toHaveText("back", {
        timeout: TEST_ARTIFACT_POLL_CADENCE.slowMs * 4,
      });
    } finally {
      await disposeHarness(h);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-raw-browser
  test("browser raw shared documents keep last-seen bytes and do not auto-recover", async ({ page, baseURL }) => {
    const h = await createHarness();
    try {
      const rawDirectory = path.join(h.producerStorage, "files", "raw-browser");
      mkdirSync(rawDirectory, { recursive: true });
      writeFileSync(path.join(rawDirectory, "index.html"), "<!doctype html><h1>Raw fixture</h1>", "utf8");
      const textPath = path.join(rawDirectory, "content.txt");
      writeFileSync(textPath, "raw one", "utf8");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "Raw", path: `${rawDirectory}${path.sep}` });
      const sharedURL = `${h.producer.getBaseURL()}/artifact/${producerArtifact.id}/content.txt`;
      const headRequests = trackArtifactHeadRequests(
        h.producer,
        producerArtifact.id,
        new URL(sharedURL).pathname,
      );
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote raw", url: sharedURL });

      await openConsumer(page, baseURL, h.consumer);
      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("body")).toContainText("raw one");
      expect(headRequests.all()).toBe(0);

      rmSync(textPath);
      await page.waitForTimeout(TEST_POLL_NEGATIVE_WINDOW_MS);
      await expect(frame.locator("body")).toContainText("raw one");
      expect(headRequests.all()).toBe(0);

      writeFileSync(textPath, "raw two changed", "utf8");
      await page.waitForTimeout(TEST_POLL_NEGATIVE_WINDOW_MS);
      await expect(frame.locator("body")).toContainText("raw one");
      await expect(frame.locator("body")).not.toContainText("raw two changed");
      expect(headRequests.all()).toBe(0);
    } finally {
      await disposeHarness(h);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-csp-browser
  test("browser CSP-blocked shared documents keep last-seen content and do not auto-recover", async ({ page, baseURL }) => {
    const h = await createHarness();
    try {
      const csp = `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; script-src 'unsafe-inline'">`;
      const htmlPath = writeArtifactFile(h.producerStorage, "csp-browser", `<!doctype html>${csp}<h1 id='msg'>csp one</h1>`, "html");
      const producerChannel = h.producerStore.listChannels()[0]!;
      const producerArtifact = h.producerStore.createArtifact({ channelID: producerChannel.id, kind: "path", title: "CSP", path: htmlPath });
      const sharedURL = proxyURL(h.producer, producerArtifact.id, htmlPath);
      const headRequests = trackArtifactHeadRequests(
        h.producer,
        producerArtifact.id,
        new URL(sharedURL).pathname,
      );
      const consumerChannel = h.consumerStore.listChannels()[0]!;
      h.consumerStore.createArtifact({ channelID: consumerChannel.id, kind: "url", title: "Remote CSP", url: sharedURL });

      await openConsumer(page, baseURL, h.consumer);
      const frame = page.frameLocator(".artifact-view iframe.artifact-content");
      await expect(frame.locator("#msg")).toHaveText("csp one");
      await expect.poll(() => frame.locator("body").evaluate(() =>
        (window as typeof window & { __televisionArtifactBridgeInstalled?: boolean })
          .__televisionArtifactBridgeInstalled === true
      )).toBe(true);
      await page.waitForTimeout(TEST_POLL_NEGATIVE_WINDOW_MS);
      expect(headRequests.all()).toBe(0);

      rmSync(htmlPath);
      await page.waitForTimeout(TEST_POLL_NEGATIVE_WINDOW_MS);
      await expect(frame.locator("#msg")).toHaveText("csp one");
      expect(headRequests.all()).toBe(0);

      writeFileSync(htmlPath, `<!doctype html>${csp}<h1 id='msg'>csp two changed</h1>`, "utf8");
      await page.waitForTimeout(TEST_POLL_NEGATIVE_WINDOW_MS);
      await expect(frame.locator("#msg")).toHaveText("csp one");
      expect(headRequests.all()).toBe(0);
    } finally {
      await disposeHarness(h);
    }
  });
});
