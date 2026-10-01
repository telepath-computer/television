import { expect, test as base } from "@playwright/test";
import { disposeAllProductServers } from "./product-server.ts";

export { expect };

/** Playwright test registration with per-test cleanup for product servers, including interrupted launches. */
export const test = base.extend<{ productServerCleanup: void }>({
  productServerCleanup: [async ({}, use) => {
    try {
      await use();
    } finally {
      await disposeAllProductServers();
    }
  }, { auto: true }],
});
