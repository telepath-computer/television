import { test as base } from "vitest";
import { disposeAllProductServers, disposeSourceCLIBuilds } from "./product-server.ts";
import { disposeVersionedWebBuilds } from "./versioned-web-bundle.ts";

/** Test registration for Vitest callers of the reusable product builders. */
export const test = base.extend<{ workerBuildCleanup: void }>({
  workerBuildCleanup: [async ({}, use) => {
    try {
      await use();
    } finally {
      await disposeAllProductServers();
      await Promise.all([disposeSourceCLIBuilds(), disposeVersionedWebBuilds()]);
    }
  }, { scope: "worker", auto: true }],
});
export const it = test;
