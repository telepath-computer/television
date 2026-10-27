import { type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { appURLForServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { waitForApplicationShell } from "./helpers.ts";

export const TEST_ARTIFACT_POLL_CADENCE = { normalMs: 250, slowMs: 750 } as const;
export const TEST_POLL_NEGATIVE_WINDOW_MS = TEST_ARTIFACT_POLL_CADENCE.normalMs * 3;

export interface Harness {
  producerStorage: string;
  consumerStorage: string;
  producerStore: ServerStore;
  consumerStore: ServerStore;
  producer: Server;
  consumer: Server;
}

export interface ArtifactHeadRequests {
  readonly all: () => number;
  readonly successful: () => number;
  readonly failed: () => number;
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function createHarness(): Promise<Harness> {
  const producerStorage = tempDir("television-guerilla-producer-");
  const consumerStorage = tempDir("television-guerilla-consumer-");
  const producerStore = createServingStore(producerStorage);
  const consumerStore = createServingStore(consumerStorage);
  const producer = new Server({
    store: producerStore,
    port: 0,
    testArtifactPollCadence: TEST_ARTIFACT_POLL_CADENCE,
  });
  const consumer = new Server({ store: consumerStore, port: 0 });
  await producer.start();
  await consumer.start();
  return { producerStorage, consumerStorage, producerStore, consumerStore, producer, consumer };
}

export async function disposeHarness(harness: Harness): Promise<void> {
  await harness.producer.dispose();
  await harness.consumer.dispose();
  rmSync(harness.producerStorage, { recursive: true, force: true });
  rmSync(harness.consumerStorage, { recursive: true, force: true });
}

export async function openConsumer(page: Page, baseURL: string | undefined, consumer: Server): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appURL = await appURLForServer(consumer.getBaseURL(), baseURL);
  await page.goto(`${appURL}/packages/web/src/index.html?token=${encodeURIComponent(consumer.getAuthToken())}`);
  await waitForApplicationShell(page);
}

/** Records completed freshness responses without replacing the server transport. */
export function trackArtifactHeadRequests(
  server: Server,
  artifactID: string,
  subpath?: string,
): ArtifactHeadRequests {
  let all = 0;
  let successful = 0;
  let failed = 0;
  const prefix = `/artifact/${artifactID}/`;
  server.httpServer.prependListener("request", (request, response) => {
    if (
      request.method !== "HEAD" ||
      !request.url?.startsWith(prefix) ||
      (subpath !== undefined && new URL(request.url, server.getBaseURL()).pathname !== subpath)
    ) return;
    response.once("finish", () => {
      all += 1;
      if ((response.statusCode >= 200 && response.statusCode < 300) || response.statusCode === 304) {
        successful += 1;
      } else {
        failed += 1;
      }
    });
  });
  return { all: () => all, successful: () => successful, failed: () => failed };
}

export function writeArtifactFile(storagePath: string, name: string, content: string, extension: "html" | "md"): string {
  const dir = path.join(storagePath, "files");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.${extension}`);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function proxyURL(server: Server, artifactID: string, filePath: string): string {
  return `${server.getBaseURL()}/artifact/${artifactID}/${encodeURIComponent(path.basename(filePath))}`;
}
