import { expect, test as base } from "@playwright/test";
import { disposeAllProductServers, disposeSourceCLIBuilds } from "./product-server.ts";
import { disposeVersionedWebBuilds } from "./versioned-web-bundle.ts";

export { expect };

/** Playwright test registration with per-test cleanup for product servers, including interrupted launches, and their app proxies. */
export const test = base.extend<{ productServerCleanup: void }, { workerBuildCleanup: void }>({
  workerBuildCleanup: [async ({}, use) => {
    try {
      await use();
    } finally {
      // Keep runtime files if a live server could not be stopped.
      await disposeAllProductServers();
      await Promise.all([disposeSourceCLIBuilds(), disposeVersionedWebBuilds()]);
    }
  }, { scope: "worker", auto: true }],
  productServerCleanup: [async ({}, use) => {
    try {
      await use();
    } finally {
      await disposeAllProductServers();
    }
  }, { auto: true }],
});
