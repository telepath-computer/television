import path from "node:path";
import { expect, test } from "@playwright/test";
import { ELECTRON_E2E_EXECUTABLE_PATH_ENV } from "../../../../scripts/electron-e2e-env.mjs";
import { launchDesktop } from "./helpers.ts";

// proofs/arch/desktop/e2e-harness.md#^desktop-t-e2e-runtime-handoff
test("global setup hands Playwright the validated Electron executable", async () => {
  const executablePath = process.env[ELECTRON_E2E_EXECUTABLE_PATH_ENV];
  expect(executablePath).toBeDefined();
  expect(path.isAbsolute(executablePath!)).toBe(true);

  const previousOverride = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  process.env.ELECTRON_OVERRIDE_DIST_PATH = path.join(path.dirname(executablePath!), "missing-override");
  try {
    const { app, page } = await launchDesktop({ fixture: "/packages/desktop/test/e2e/fixtures/smoke.html" });
    try {
      await expect(page.locator("h1")).toHaveText("Hello from electron e2e");
    } finally {
      await app.close();
    }
  } finally {
    if (previousOverride === undefined) delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
    else process.env.ELECTRON_OVERRIDE_DIST_PATH = previousOverride;
  }
});
