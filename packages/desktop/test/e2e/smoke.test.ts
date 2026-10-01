import { expect, test } from "@playwright/test";
import { launchDesktop } from "./helpers.ts";

test("electron app launches, loads the fixture, and tears down", async () => {
  const { app, page } = await launchDesktop({
    fixture: "/packages/desktop/test/e2e/fixtures/smoke.html",
  });
  try {
    await expect(page).toHaveTitle("smoke ok");
    await expect(page.locator("h1")).toHaveText("Hello from electron e2e");
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error("BrowserWindow missing");
      return window.getMinimumSize();
    })).toEqual([500, 500]);
  } finally {
    await app.close();
  }
});
