// What every template's conformance test shares: the product server that
// global setup starts, a browser for each worker, a proxy for each test, the
// spec Storybook, and the list of a story module's exported stories.
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { StorybookSource } from "@telepath-computer/conform/storybook";
import { TelevisionClient } from "@telepath-computer/television-shared";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test } from "@playwright/test";
import { NetworkProxy } from "../../../server/test/e2e/network-proxy.ts";
import { TEST_HOST, TEST_HOST_LAUNCH } from "./template-harness.ts";
import { SERVER_ENV, type SharedServer } from "./conformance-setup.ts";

// Global setup starts one product server for every worker.
const server = JSON.parse(process.env[SERVER_ENV]!) as SharedServer;

/** Administrative requests reach the server directly, as a separate real client does. */
export const client = new TelevisionClient(server.serverURL, { token: server.token });

export const storybook = new StorybookSource({ url: process.env.TV_SPEC_STORYBOOK_URL });

export interface Conformance {
  // conform drives its own Playwright, so each worker's browser comes from that version rather than the runner's.
  browser: Browser;
  // Each story's page reaches the server through its own proxy, so held or refused traffic never carries over.
  proxy: NetworkProxy;
}

/** Launches a browser for each worker and starts a proxy for each test, closing both afterwards. */
export function useConformance(): Conformance {
  const run = {} as Conformance;
  test.beforeAll(async () => { run.browser = await chromium.launch(TEST_HOST_LAUNCH); });
  test.afterAll(async () => { await run.browser?.close(); });
  test.beforeEach(async () => { run.proxy = await NetworkProxy.start(Number(new URL(server.serverURL).port)); });
  test.afterEach(async () => { await run.proxy?.close(); });
  return run;
}

/** Creates an artifact from an installed template, storing `data` in place of its seed when given. */
export async function createArtifact(templateID: string, data?: JSONValue): Promise<string> {
  const { artifactID } = await client.templates.create({ templateID, channelID: server.channelID, source: "cli" });
  if (data !== undefined) await client.resources.json.set({ store: { artifactID }, path: "", value: data });
  return artifactID;
}

/** The page of an artifact, or of a share link, through a test's proxy. */
export function artifactURL(proxy: NetworkProxy, artifactOrShareID: string): string {
  return `http://${TEST_HOST}:${proxy.port}/artifact/${encodeURIComponent(artifactOrShareID)}/index.html`;
}

/**
 * The IDs of every story a module exports, including those its MDX does not
 * embed, from the index of the built Storybook.
 */
export function specStories(importPath: string): string[] {
  const index = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../storybook/dist/index.json"), "utf8")) as {
    entries: Record<string, { id: string; type: string; importPath: string }>;
  };
  return Object.values(index.entries)
    .filter((entry) => entry.type === "story" && entry.importPath === importPath)
    .map((entry) => entry.id);
}
